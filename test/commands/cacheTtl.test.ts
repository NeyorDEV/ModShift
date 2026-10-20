import { describe, expect, it } from 'vitest';
import { resolveCacheTtl } from '../../src/commands/analyze.js';
import { formatDuration, parseDuration } from '../../src/duration.js';
import { DEFAULT_CACHE_TTL_MS } from '../../src/modrinth/cache.js';
import { createIo, run } from '../helpers/cli.js';

describe('parseDuration', () => {
  it.each([
    ['90s', 90_000],
    ['30m', 1_800_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
    ['1.5h', 5_400_000],
    [' 2D ', 172_800_000],
    ['0', 0],
    ['0s', 0],
  ])('%j → %d ms', (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it.each(['', '12', 'abc', '-1h', '1w', '1h30m'])('rejects %j', (value) => {
    expect(parseDuration(value)).toBeUndefined();
  });

  it('formats durations with the largest fitting unit', () => {
    expect([30_000, 1_800_000, 43_200_000, 604_800_000].map(formatDuration)).toEqual([
      '30s',
      '30m',
      '12h',
      '7d',
    ]);
  });
});

describe('resolveCacheTtl', () => {
  it('prefers the option, then MODSHIFT_CACHE_TTL, then 24 h', () => {
    expect(resolveCacheTtl('1h', { MODSHIFT_CACHE_TTL: '2h' })).toBe(3_600_000);
    expect(resolveCacheTtl(undefined, { MODSHIFT_CACHE_TTL: '2h' })).toBe(7_200_000);
    expect(resolveCacheTtl(undefined, {})).toBe(DEFAULT_CACHE_TTL_MS);
  });

  it('names the source of an invalid value', () => {
    expect(() => resolveCacheTtl('soon', {})).toThrow(/Invalid --cache-ttl "soon"/);
    expect(() => resolveCacheTtl(undefined, { MODSHIFT_CACHE_TTL: 'x' })).toThrow(
      /Invalid MODSHIFT_CACHE_TTL "x"/,
    );
  });

  it('is validated by the CLI before any request', async () => {
    const io = createIo();
    await run(
      io,
      'analyze',
      'pack.mrpack',
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-ttl',
      '3 weeks',
    );
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(/Invalid --cache-ttl "3 weeks"/);
    expect(io.requests).toBe(0);
  });
});
