import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { MemoryCache } from '../../src/modrinth/cache.js';
import { ModrinthClient } from '../../src/modrinth/client.js';
import { describeRequest } from '../../src/modrinth/errors.js';
import { fakeModrinthHandler, loadCatalog } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';
import { createMockFetch } from '../helpers/mockFetch.js';

const API = 'https://api.modrinth.com/v2';

describe('describeRequest', () => {
  it.each([
    ['POST', `${API}/version_files`, { hashes: ['a', 'b'] }, 'hash lookup of 2 file(s)'],
    ['GET', `${API}/project/AANobbMI/version?loaders=x`, undefined, 'versions of project AANobbMI'],
    ['GET', `${API}/project/sodium`, undefined, 'project sodium'],
    ['GET', `${API}/projects?ids=[]`, undefined, 'project details'],
    ['GET', `${API}/versions?ids=[]`, undefined, 'version details'],
    ['GET', `${API}/search?query=Old%20Minimap`, undefined, 'search "Old Minimap"'],
    ['GET', `${API}/search?facets=[]`, undefined, 'category search'],
    ['GET', `${API}/tag/loader`, undefined, 'request GET /tag/loader'],
  ])('%s %s → %s', (method, url, body, expected) => {
    expect(describeRequest(method, url, body)).toBe(expected);
  });
});

describe('offline analysis', () => {
  it('skips uncached alternative searches with a warning instead of failing', async () => {
    const cache = new MemoryCache();
    const pack = () => parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack');
    const target = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;

    // Premier passage en ligne sans alternatives : les recherches ne sont pas mises en cache.
    const mock = createMockFetch(fakeModrinthHandler(loadCatalog()));
    const online = new ModrinthClient({ fetch: mock.fetch, cache });
    await analyzePack(pack(), target, online, { maxAlternatives: 0 });

    const offline = new ModrinthClient({ cache, offline: true });
    const result = await analyzePack(pack(), target, offline);
    expect(result.summary['update-found']).toBe(2);
    expect(result.mods.find((m) => m.fileName === 'old-minimap-1.0.jar')?.status).toBe('not-found');
    expect(result.warnings).toContain(
      'Old Minimap: alternatives not available offline (search "Old Minimap" is not cached).',
    );
  });
});
