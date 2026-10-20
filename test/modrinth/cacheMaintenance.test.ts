import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCache } from '../../src/modrinth/cache.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const HOUR = 3_600_000;

// Remplit un cache avec des entrées d'âges différents (horloge contrôlée).
async function seed(): Promise<{ clock: { t: number }; cache: FileCache }> {
  const clock = { t: 0 };
  const cache = new FileCache(dir, () => clock.t);
  await cache.set('old', { a: 1 });
  clock.t = 10 * HOUR;
  await cache.set('recent', { b: 2 });
  clock.t = 12 * HOUR;
  return { clock, cache };
}

describe('FileCache maintenance', () => {
  it('reports entry count, size, age range and expired entries', async () => {
    const { cache } = await seed();
    await writeFile(join(dir, `${'f'.repeat(64)}.json`), '{broken');
    await writeFile(join(dir, 'README.txt'), 'not a cache entry');

    const stats = await cache.stats(5 * HOUR);
    expect(stats).toMatchObject({
      dir,
      entries: 2,
      expired: 1,
      corrupted: 1,
      oldest: 0,
      newest: 10 * HOUR,
    });
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('handles a missing directory', async () => {
    const cache = new FileCache(join(dir, 'nope'));
    expect(await cache.stats()).toEqual({
      dir: join(dir, 'nope'),
      entries: 0,
      bytes: 0,
      expired: 0,
      corrupted: 0,
    });
    expect(await cache.clear()).toBe(0);
  });

  it('clears only expired (and corrupted) entries when asked', async () => {
    const { cache } = await seed();
    await writeFile(join(dir, `${'e'.repeat(64)}.json`), '{broken');
    expect(await cache.clear({ olderThanMs: 5 * HOUR })).toBe(2);
    expect(await cache.get('old')).toBeUndefined();
    expect(await cache.get('recent')).toEqual({ storedAt: 10 * HOUR, body: { b: 2 } });
  });

  it('clears everything but leaves foreign files alone', async () => {
    const { cache } = await seed();
    await writeFile(join(dir, 'notes.txt'), 'keep me');
    expect(await cache.clear()).toBe(2);
    expect(await readdir(dir)).toEqual(['notes.txt']);
  });
});
