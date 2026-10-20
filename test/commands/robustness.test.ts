import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageError } from '../../src/commands/analyze.js';
import { createLogger } from '../../src/commands/logger.js';
import { describeError, formatError } from '../../src/errorMessages.js';
import { InputError } from '../../src/input/errors.js';
import { InvalidMrpackError } from '../../src/migrate/writer.js';
import {
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimitError,
} from '../../src/modrinth/errors.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';
import { jsonResponse } from '../helpers/mockFetch.js';

describe('describeError', () => {
  it.each([
    [new UsageError('bad option'), /--help/],
    [
      new InputError('x.mrpack: missing modrinth.index.json'),
      /\.mrpack, a CurseForge export \.zip/,
    ],
    [new RateLimitError('u', 42, 300), /Wait about 42 s/],
    [
      new ModrinthNetworkError('u', { cause: new Error('ENOTFOUND') }),
      /internet connection.*--offline/,
    ],
    [new OfflineCacheMissError('u'), /without --offline to fill the cache/],
    [new ModrinthApiError(503, 'u'), /status\.modrinth\.com/],
    [new ModrinthApiError(400, 'u'), /open an issue/],
    [new InvalidMrpackError(['game must be "minecraft"']), /ModShift bug: no file was written/],
  ])('gives an actionable hint for %s', (error, hint) => {
    expect(describeError(error)?.hint).toMatch(hint);
  });

  it('leaves unexpected errors to the caller', () => {
    expect(describeError(new TypeError('boom'))).toBeUndefined();
  });

  it('formats message and hint on two lines', () => {
    expect(formatError({ message: 'm', hint: 'h' })).toBe('error: m\nhint: h\n');
    expect(formatError({ message: 'm' })).toBe('error: m\n');
    expect(new RateLimitError('https://x/y', undefined, 300).message).toBe(
      'Modrinth rate limit reached (300 requests per minute) while calling https://x/y',
    );
  });
});

describe('logger', () => {
  const make = (level: 'quiet' | 'normal' | 'verbose', isTTY: boolean) => {
    let out = '';
    const logger = createLogger({ write: (t) => (out += t), level, isTTY, width: 60 });
    return {
      logger,
      get out() {
        return out;
      },
    };
  };

  it('draws a progress bar on a terminal and clears it before other lines', () => {
    const l = make('normal', true);
    l.logger.progress(1, 4, 'Sodium');
    expect(l.out).toBe('\r\u001b[2K[██████░░░░░░░░░░░░░░░░░░] 1/4 Sodium');
    l.logger.info('hello');
    expect(l.out.endsWith('\r\u001b[2Khello\n')).toBe(true);
  });

  it('never draws a bar when stderr is not a terminal, or in quiet mode', () => {
    const plain = make('normal', false);
    plain.logger.progress(1, 4, 'x');
    expect(plain.out).toBe('');
    const quiet = make('quiet', true);
    quiet.logger.progress(1, 4, 'x');
    quiet.logger.info('hidden');
    expect(quiet.out).toBe('');
  });

  it('prints debug lines and client events only in verbose mode', () => {
    const verbose = make('verbose', false);
    verbose.logger.clientEvent({
      type: 'request',
      method: 'GET',
      url: 'https://api.modrinth.com/v2/project/x?a=1',
      status: 200,
      durationMs: 12,
    });
    verbose.logger.clientEvent({
      type: 'cache-hit',
      method: 'POST',
      url: 'https://api.modrinth.com/v2/version_files',
    });
    verbose.logger.clientEvent({
      type: 'retry',
      url: 'https://api.modrinth.com/v2/x',
      reason: 'HTTP 503',
      delayMs: 1000,
    });
    expect(verbose.out).toBe(
      '[debug] GET /v2/project/x?… → 200 (12 ms)\n' +
        '[debug] POST /v2/version_files → cache\n' +
        '[debug] retrying /v2/x in 1000 ms (HTTP 503)\n',
    );
    const normal = make('normal', false);
    normal.logger.clientEvent({ type: 'cache-hit', method: 'GET', url: 'https://x/y' });
    normal.logger.debug('hidden');
    expect(normal.out).toBe('');
  });

  it('always announces long rate-limit pauses', () => {
    const normal = make('normal', false);
    normal.logger.clientEvent({ type: 'rate-limit-wait', waitMs: 12_500 });
    normal.logger.clientEvent({ type: 'rate-limit-wait', waitMs: 300 });
    expect(normal.out).toBe('Modrinth rate limit reached: waiting 13 s…\n');
  });
});

describe('CLI robustness', () => {
  let dir: string;
  let packPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-robust-'));
    packPath = join(dir, 'pack.mrpack');
    await writeFile(packPath, packFixture('mrpack-fabric'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const analyze = (...extra: string[]) => [
    'analyze',
    packPath,
    '--mc',
    '1.21.1',
    '--loader',
    'fabric',
    '--no-cache',
    ...extra,
  ];

  it('explains a persistent rate limit with a hint', async () => {
    const io = createIo({
      handler: () =>
        jsonResponse({ error: 'ratelimited' }, 429, {
          'x-ratelimit-limit': '300',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '37',
        }),
    });
    await run(io, ...analyze('-q'));
    expect(io.exitCode).toBe(1);
    expect(io.err).toBe(
      'error: Modrinth rate limit reached (300 requests per minute) while calling https://api.modrinth.com/v2/version_files\n' +
        'hint: Wait about 37 s and run the command again: responses already received are cached and will not be requested again.\n',
    );
  });

  it('adds a hint to network errors and invalid packs', async () => {
    const io = createIo({ networkDown: true });
    await run(io, ...analyze('-q'));
    expect(io.err).toMatch(
      /^error: Network error while calling .* \(fetch failed\)\nhint: Check your internet connection/,
    );

    const broken = join(dir, 'broken.mrpack');
    await writeFile(broken, 'not a zip');
    const io2 = createIo();
    await run(io2, 'analyze', broken, '--mc', '1.21.1', '--loader', 'fabric');
    expect(io2.err).toMatch(
      /^error: Cannot read broken\.mrpack: not a valid zip file\nhint: ModShift reads/,
    );
  });

  it('--verbose logs every request', async () => {
    const io = createIo();
    await run(io, ...analyze('--verbose'));
    expect(io.err).toContain('[debug] POST /v2/version_files → 200');
    expect(io.err).toContain('[debug] GET /v2/project/AANobbMI/version?… → 200');
  });

  it('rejects --quiet together with --verbose', async () => {
    const io = createIo();
    await run(io, ...analyze('-q', '-v'));
    expect(io.err).toMatch(/--quiet and --verbose cannot be used together/);
  });

  it('shows a progress bar only when stderr is a terminal', async () => {
    const tty = createIo({ stderrIsTTY: true });
    await run(tty, ...analyze());
    expect(tty.err).toMatch(/\[█+░*\] \d+\/\d+ /);
    const plain = createIo();
    await run(plain, ...analyze());
    expect(plain.err).not.toContain('█');
  });
});
