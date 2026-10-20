import { describe, expect, it } from 'vitest';
import {
  CurseForgeApiError,
  CurseForgeClient,
  curseForgeApiKey,
  CurseForgeNetworkError,
} from '../../src/curseforge/client.js';
import { MemoryCache } from '../../src/modrinth/cache.js';
import { OfflineCacheMissError } from '../../src/modrinth/errors.js';
import { FAKE_CF_KEY, fakeCurseForgeHandler } from '../helpers/fakeCurseForge.js';
import { createMockFetch, jsonResponse } from '../helpers/mockFetch.js';

const noSleep = async () => undefined;

describe('curseForgeApiKey', () => {
  it('reads the key from CURSEFORGE_API_KEY only, ignoring blank values', () => {
    expect(curseForgeApiKey({ CURSEFORGE_API_KEY: ' abc ' })).toBe('abc');
    expect(curseForgeApiKey({ CURSEFORGE_API_KEY: '  ' })).toBeUndefined();
    expect(curseForgeApiKey({})).toBeUndefined();
  });
});

describe('CurseForgeClient', () => {
  it('posts file and mod ids with the x-api-key header', async () => {
    const mock = createMockFetch(fakeCurseForgeHandler());
    const client = new CurseForgeClient({ apiKey: FAKE_CF_KEY, fetch: mock.fetch, sleep: noSleep });

    const files = await client.getFiles([4712867, 4712866, 4712866]);
    expect(files.map((f) => f.fileName).sort()).toEqual([
      'architectury-9.2.14-forge.jar',
      'jei-1.20.1-forge-15.2.0.27.jar',
    ]);
    const mods = await client.getMods([238222]);
    expect(mods).toEqual([expect.objectContaining({ slug: 'jei' })]);

    expect(mock.calls[0]).toMatchObject({
      method: 'POST',
      url: new URL('https://api.curseforge.com/v1/mods/files'),
      body: { fileIds: [4712866, 4712867] },
    });
    expect(mock.calls[0]?.headers['x-api-key']).toBe(FAKE_CF_KEY);
    expect(mock.calls[0]?.headers['user-agent']).toMatch(/^NeyorDEV\/ModShift\//);
    expect(await client.getFiles([])).toEqual([]);
    expect(mock.calls).toHaveLength(2);
  });

  it('reports a rejected key without exposing it', async () => {
    const mock = createMockFetch(fakeCurseForgeHandler());
    const client = new CurseForgeClient({ apiKey: 'wrong-key', fetch: mock.fetch, sleep: noSleep });
    const error = await client.getFiles([1]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CurseForgeApiError);
    expect((error as Error).message).toBe(
      'CurseForge rejected the API key (HTTP 403) for https://api.curseforge.com/v1/mods/files',
    );
    expect((error as Error).message).not.toContain('wrong-key');
  });

  it('retries 429 and 5xx, then network errors fail clearly', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const mock = createMockFetch(() => {
      n++;
      if (n === 1) return jsonResponse({}, 429, { 'retry-after': '3' });
      if (n === 2) return jsonResponse({}, 503);
      return jsonResponse({ data: [{ id: 1, modId: 2, fileName: 'a.jar' }] });
    });
    const client = new CurseForgeClient({
      apiKey: FAKE_CF_KEY,
      fetch: mock.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(await client.getFiles([1])).toHaveLength(1);
    expect(sleeps).toEqual([3000, 2000]);

    const down = new CurseForgeClient({
      apiKey: FAKE_CF_KEY,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
      sleep: noSleep,
    });
    await expect(down.getFiles([1])).rejects.toBeInstanceOf(CurseForgeNetworkError);
  });

  it('caches responses (without the key) and works offline from the cache', async () => {
    const cache = new MemoryCache();
    const mock = createMockFetch(fakeCurseForgeHandler());
    const online = new CurseForgeClient({
      apiKey: FAKE_CF_KEY,
      fetch: mock.fetch,
      cache,
      sleep: noSleep,
    });
    await online.getMods([238222]);
    await online.getMods([238222]);
    expect(mock.calls).toHaveLength(1);
    expect([...cache.entries.keys()].join()).not.toContain(FAKE_CF_KEY);

    const offline = new CurseForgeClient({ apiKey: FAKE_CF_KEY, cache, offline: true });
    expect(await offline.getMods([238222])).toHaveLength(1);
    await expect(offline.getMods([1])).rejects.toBeInstanceOf(OfflineCacheMissError);
  });
});
