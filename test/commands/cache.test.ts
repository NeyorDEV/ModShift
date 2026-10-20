import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCacheStats } from '../../src/commands/cache.js';
import { FileCache } from '../../src/modrinth/cache.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let cacheDir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-cachecmd-'));
  cacheDir = join(dir, 'cache');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Remplit le cache comme le ferait une vraie analyse.
async function fillCache(): Promise<void> {
  const packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
  const io = createIo();
  await run(
    io,
    'analyze',
    packPath,
    '--mc',
    '1.21.1',
    '--loader',
    'fabric',
    '-q',
    '--cache-dir',
    cacheDir,
  );
  expect(io.exitCode).toBeUndefined();
}

describe('modshift cache', () => {
  it('stats reports entries filled by an analysis', async () => {
    await fillCache();
    const files = await readdir(cacheDir);
    const io = createIo();
    await run(io, 'cache', 'stats', '--cache-dir', cacheDir);
    expect(io.out).toContain(`Cache directory: ${cacheDir}`);
    expect(io.out).toContain(`Entries: ${files.length} (`);
    expect(io.out).toContain('Expired (older than 1d): 0');

    const json = createIo();
    await run(json, 'cache', 'stats', '--cache-dir', cacheDir, '--json');
    expect(JSON.parse(json.out)).toMatchObject({
      entries: files.length,
      expired: 0,
      ttlMs: 86_400_000,
    });
  });

  it('stats shows dates and expired entries with a custom TTL', async () => {
    const cache = new FileCache(cacheDir, () => Date.UTC(2026, 0, 1));
    await cache.set('k', {});
    const io = createIo();
    await runCacheStats({ cacheDir, cacheTtl: '1h' }, io, () => Date.UTC(2026, 0, 3));
    expect(io.out).toContain('Oldest entry: 2026-01-01 00:00 UTC (2d ago)');
    expect(io.out).toContain('Expired (older than 1h): 1');
  });

  it('clear removes everything, or only expired entries', async () => {
    await fillCache();
    const count = (await readdir(cacheDir)).length;

    const expired = createIo();
    await run(expired, 'cache', 'clear', '--cache-dir', cacheDir, '--expired');
    expect(expired.out).toBe(`Removed 0 expired entries from ${cacheDir}\n`);

    const all = createIo();
    await run(all, 'cache', 'clear', '--cache-dir', cacheDir);
    expect(all.out).toBe(`Removed ${count} entries from ${cacheDir}\n`);
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it('rejects --cache-ttl without --expired', async () => {
    const io = createIo();
    await run(io, 'cache', 'clear', '--cache-dir', cacheDir, '--cache-ttl', '1h');
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(/--cache-ttl only applies with --expired/);
  });
});
