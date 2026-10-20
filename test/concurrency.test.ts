import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../src/concurrency.js';
import { analyzePack } from '../src/core/engine.js';
import { parseMrpack } from '../src/input/mrpack.js';
import { MemoryCache } from '../src/modrinth/cache.js';
import { ModrinthClient } from '../src/modrinth/client.js';
import type { FetchLike } from '../src/modrinth/client.js';
import { RateLimiter } from '../src/modrinth/rateLimiter.js';
import { fakeModrinthHandler, loadCatalog } from './helpers/fakeModrinth.js';
import { packFixture } from './helpers/fixtures.js';
import { createFakeClock, createMockFetch } from './helpers/mockFetch.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapConcurrent', () => {
  it('keeps the input order and never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapConcurrent([5, 1, 4, 2, 3, 0], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      for (let i = 0; i < n; i++) await tick();
      active--;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(3);
  });

  it('stops starting new calls after an error and rethrows it', async () => {
    const started: number[] = [];
    await expect(
      mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        await tick();
        if (n === 1) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(6);
  });

  it('handles empty lists and invalid limits', async () => {
    expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
    expect(await mapConcurrent([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });
});

describe('RateLimiter under concurrent acquire()', () => {
  it('never lets more than maxRequests through per window', async () => {
    const clock = createFakeClock();
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000, ...clock });
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        await limiter.acquire();
        times.push(clock.time);
      }),
    );
    expect(times).toHaveLength(12);
    for (const t of times) {
      expect(times.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(5);
    }
  });
});

describe('analyzePack with concurrent requests', () => {
  // Client branché sur le faux Modrinth, avec une latence simulée et un compteur de requêtes
  // simultanées.
  function delayedClient() {
    const mock = createMockFetch(fakeModrinthHandler(loadCatalog()));
    const stats = { active: 0, peak: 0 };
    const fetch: FetchLike = async (input, init) => {
      stats.active++;
      stats.peak = Math.max(stats.peak, stats.active);
      await tick();
      try {
        return await mock.fetch(input, init);
      } finally {
        stats.active--;
      }
    };
    const client = new ModrinthClient({
      fetch,
      cache: new MemoryCache(),
      sleep: async () => undefined,
    });
    return { client, stats };
  }

  const pack = () => parseMrpack(packFixture('mrpack-fabric'), 'fixture.mrpack');
  const target = { minecraftVersion: '1.21.1', loader: 'neoforge' } as const;

  it('gives the same result whatever the concurrency', async () => {
    const sequential = await analyzePack(pack(), target, delayedClient().client, {
      concurrency: 1,
    });
    const parallel = await analyzePack(pack(), target, delayedClient().client, {
      concurrency: 8,
    });
    expect(parallel).toEqual(sequential);
  });

  it('keeps the number of requests in flight within the limit', async () => {
    const one = delayedClient();
    await analyzePack(pack(), target, one.client, { concurrency: 1 });
    expect(one.stats.peak).toBe(1);
    const three = delayedClient();
    await analyzePack(pack(), target, three.client, { concurrency: 3 });
    expect(three.stats.peak).toBeGreaterThan(1);
    expect(three.stats.peak).toBeLessThanOrEqual(3);
  });
});
