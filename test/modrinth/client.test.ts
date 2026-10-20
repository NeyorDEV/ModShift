import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultCacheDir,
  DEFAULT_USER_AGENT,
  FileCache,
  MemoryCache,
  ModrinthApiError,
  ModrinthClient,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimiter,
} from '../../src/modrinth/index.js';
import { createFakeClock, createMockFetch, jsonResponse } from '../helpers/mockFetch.js';

const version = (id: string, projectId: string) => ({
  id,
  project_id: projectId,
  name: id,
  version_number: '1.0.0',
  game_versions: ['1.21.1'],
  loaders: ['fabric'],
  version_type: 'release',
  date_published: '2024-08-01T00:00:00Z',
  dependencies: [],
  files: [],
});

function makeClient(
  handler: Parameters<typeof createMockFetch>[0],
  extra: ConstructorParameters<typeof ModrinthClient>[0] = {},
) {
  const clock = createFakeClock();
  const mock = createMockFetch(handler);
  const client = new ModrinthClient({
    fetch: mock.fetch,
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  });
  return { client, clock, calls: mock.calls };
}

describe('ModrinthClient requests', () => {
  it('sends an explicit User-Agent and posts hashes to /version_files', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({ ['a'.repeat(40)]: version('V1', 'P1') }),
    );
    const result = await client.getVersionsFromHashes(['a'.repeat(40), 'a'.repeat(40)], 'sha1');

    expect(Object.keys(result)).toEqual(['a'.repeat(40)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe('https://api.modrinth.com/v2/version_files');
    expect(calls[0]?.body).toEqual({ hashes: ['a'.repeat(40)], algorithm: 'sha1' });
    expect(calls[0]?.headers['user-agent']).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).toMatch(/^NeyorDEV\/ModShift\/\d+\.\d+\.\d+ \(.+\)$/);
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('splits large hash lists into batches of 100', async () => {
    const { client, calls } = makeClient(() => jsonResponse({}));
    const hashes = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(40, '0'));
    await client.getVersionsFromHashes(hashes);
    expect(calls.map((c) => (c.body as { hashes: string[] }).hashes.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it('filters project versions by loaders and game versions', async () => {
    const { client, calls } = makeClient(() => jsonResponse([version('V2', 'P1')]));
    const versions = await client.getProjectVersions('sodium', {
      loaders: ['fabric', 'quilt'],
      gameVersions: ['1.21.1'],
    });
    expect(versions).toHaveLength(1);
    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/v2/project/sodium/version');
    expect(url?.searchParams.get('loaders')).toBe('["fabric","quilt"]');
    expect(url?.searchParams.get('game_versions')).toBe('["1.21.1"]');
    expect(url?.searchParams.get('include_changelog')).toBe('false');
  });

  it('returns null / [] for unknown projects (404)', async () => {
    const { client } = makeClient(() => jsonResponse({ error: 'not_found' }, 404));
    expect(await client.getProject('nope')).toBeNull();
    expect(await client.getProjectVersions('nope')).toEqual([]);
  });

  it('encodes ids and search facets as JSON', async () => {
    const { client, calls } = makeClient((req) =>
      req.url.pathname.endsWith('/search')
        ? jsonResponse({ hits: [], offset: 0, limit: 5, total_hits: 0 })
        : jsonResponse([]),
    );
    await client.getProjects(['B', 'A']);
    await client.getVersions(['V1']);
    await client.search({
      query: 'minimap',
      facets: [['categories:utility'], ['versions:1.21.1']],
      index: 'downloads',
      limit: 5,
    });
    expect(calls[0]?.url.searchParams.get('ids')).toBe('["A","B"]');
    expect(calls[1]?.url.pathname).toBe('/v2/versions');
    expect(Object.fromEntries(calls[2]?.url.searchParams ?? [])).toEqual({
      query: 'minimap',
      facets: '[["categories:utility"],["versions:1.21.1"]]',
      index: 'downloads',
      limit: '5',
    });
  });

  it('throws ModrinthApiError on other client errors without retrying', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ error: 'bad' }, 400));
    await expect(client.getVersions(['x'])).rejects.toBeInstanceOf(ModrinthApiError);
    expect(calls).toHaveLength(1);
  });
});

describe('ModrinthClient retries', () => {
  it('retries server errors with exponential backoff', async () => {
    let n = 0;
    const { client, clock, calls } = makeClient(() =>
      ++n < 3 ? jsonResponse({}, 503) : jsonResponse([]),
    );
    await client.getVersions(['x']);
    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it('retries network failures, then gives up with ModrinthNetworkError', async () => {
    const { client, clock, calls } = makeClient(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.getVersions(['x'])).rejects.toBeInstanceOf(ModrinthNetworkError);
    expect(calls).toHaveLength(4);
    expect(clock.sleeps).toEqual([1000, 2000, 4000]);
  });

  it('waits for X-Ratelimit-Reset after a 429', async () => {
    let n = 0;
    const { client, clock, calls } = makeClient(() =>
      ++n === 1
        ? jsonResponse({ error: 'ratelimited' }, 429, {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '12',
          })
        : jsonResponse([]),
    );
    await client.getVersions(['x']);
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([12_000]);
  });
});

describe('RateLimiter', () => {
  it('never exceeds the local window limit', async () => {
    const clock = createFakeClock(0);
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000, ...clock });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.time).toBe(1000);
  });

  it('pauses when the server reports no remaining requests', async () => {
    const clock = createFakeClock(0);
    const limiter = new RateLimiter(clock);
    limiter.update(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5' }));
    await limiter.acquire();
    expect(clock.sleeps).toEqual([5000]);
    limiter.update(new Headers({ 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '30' }));
    await limiter.acquire();
    expect(clock.sleeps).toEqual([5000]);
  });
});

describe('ModrinthClient cache', () => {
  it('serves fresh entries from the cache and refreshes expired ones', async () => {
    const cacheClock = createFakeClock();
    const cache = new MemoryCache(cacheClock.now);
    const { client, calls, clock } = makeClient(() => jsonResponse([version('V1', 'P1')]), {
      cache,
      cacheTtlMs: 60_000,
    });
    await client.getVersions(['V1']);
    await client.getVersions(['V1']);
    expect(calls).toHaveLength(1);

    clock.time += 120_000;
    await client.getVersions(['V1']);
    expect(calls).toHaveLength(2);
  });

  it('caches 404 results as null', async () => {
    const cache = new MemoryCache();
    const { client, calls } = makeClient(() => jsonResponse({}, 404), { cache });
    expect(await client.getProject('missing')).toBeNull();
    expect(await client.getProject('missing')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('offline mode only uses the cache, regardless of age', async () => {
    const cache = new MemoryCache(() => 0);
    const online = makeClient(() => jsonResponse([version('V1', 'P1')]), { cache });
    await online.client.getVersions(['V1']);

    const offline = makeClient(
      () => {
        throw new Error('network must not be used offline');
      },
      { cache, offline: true },
    );
    expect(await offline.client.getVersions(['V1'])).toHaveLength(1);
    await expect(offline.client.getVersions(['V2'])).rejects.toBeInstanceOf(OfflineCacheMissError);
    expect(offline.calls).toHaveLength(0);
  });

  it('refuses offline mode without a cache', () => {
    expect(() => new ModrinthClient({ offline: true })).toThrow(/requires a cache/);
  });
});

describe('FileCache', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('persists entries on disk and ignores corrupted files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modshift-cache-'));
    dirs.push(dir);
    const cache = new FileCache(join(dir, 'nested'), () => 42);
    expect(await cache.get('k')).toBeUndefined();
    await cache.set('k', { a: 1 });
    expect(await new FileCache(join(dir, 'nested')).get('k')).toEqual({
      storedAt: 42,
      body: { a: 1 },
    });

    const [file] = await readdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', file ?? ''), '{not json');
    expect(await cache.get('k')).toBeUndefined();
  });

  it('resolves the default cache directory from the environment', () => {
    expect(defaultCacheDir({ MODSHIFT_CACHE_DIR: '/x' })).toBe('/x');
    expect(defaultCacheDir({ XDG_CACHE_HOME: '/xdg' })).toBe(join('/xdg', 'modshift'));
  });
});

describe('test setup', () => {
  it('forbids real network access through the global fetch', () => {
    expect(() => fetch('https://api.modrinth.com/v2/')).toThrow(/forbidden in tests/);
  });
});
