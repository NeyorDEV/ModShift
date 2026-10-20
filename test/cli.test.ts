import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { parseTarget } from '../src/commands/analyze.js';
import { MODSHIFT_VERSION } from '../src/version.js';
import { createIo, run } from './helpers/cli.js';
import { packFixture } from './helpers/fixtures.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-cli-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cli', () => {
  it('exposes name and version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('modshift');
    expect(program.version()).toBe(MODSHIFT_VERSION);
  });

  it('analyze prints a table report and progress on stderr', async () => {
    const io = createIo();
    await run(
      io,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-dir',
      join(dir, 'cache'),
    );
    expect(io.exitCode).toBeUndefined();
    expect(io.out).toContain('✔ compatible');
    expect(io.out).toContain(
      'Summary: 1 compatible, 2 update found, 1 alternative suggested, 2 not found',
    );
    expect(io.err).toContain('Loaded 6 mod(s)');
  });

  it('analyze --format json writes machine-readable output', async () => {
    const io = createIo();
    await run(
      io,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'NeoForge',
      '--format',
      'json',
      '--quiet',
      '--no-cache',
    );
    const report = JSON.parse(io.out) as { target: unknown };
    expect(report.target).toEqual({ minecraftVersion: '1.21.1', loader: 'neoforge' });
    expect(io.err).toBe('');
  });

  it('analyze --format markdown --output writes a file', async () => {
    const io = createIo();
    const output = join(dir, 'report.md');
    await run(
      io,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '-f',
      'md',
      '-o',
      output,
      '--no-cache',
    );
    expect(io.out).toBe('');
    expect(await readFile(output, 'utf8')).toContain('# ModShift report: Fixture Fabric Pack');
  });

  it('--offline answers from the cache filled by a previous run', async () => {
    const cacheDir = join(dir, 'cache');
    const online = createIo();
    await run(
      online,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-dir',
      cacheDir,
      '-q',
    );
    expect((await readdir(cacheDir)).length).toBeGreaterThan(0);

    const offline = createIo({ networkDown: true });
    await run(
      offline,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-dir',
      cacheDir,
      '-q',
      '--offline',
    );
    expect(offline.requests).toBe(0);
    expect(offline.out).toBe(online.out);
  });

  it('--offline fails cleanly on a cache miss', async () => {
    const io = createIo();
    await run(
      io,
      'analyze',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-dir',
      join(dir, 'empty'),
      '--offline',
    );
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(
      /error: Offline mode: the cache has no entry for the hash lookup of 6 file\(s\) \(https:\/\/api\.modrinth\.com\/v2\/version_files\)\nhint: Run the same command once without --offline/,
    );
  });

  it('reports network failures without a stack trace', async () => {
    const io = createIo({ networkDown: true });
    await run(io, 'analyze', packPath, '--mc', '1.21.1', '--loader', 'fabric', '--no-cache');
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain(
      'error: Network error while calling https://api.modrinth.com/v2/version_files',
    );
  });

  it.each([
    [['--loader', 'rift'], /Invalid loader "rift"/],
    [['--loader', 'fabric', '--format', 'xml'], /Invalid format "xml"/],
    [['--loader', 'fabric', '--max-alternatives', '-1'], /Invalid --max-alternatives/],
    [['--loader', 'fabric', '--offline', '--no-cache'], /--offline needs the cache/],
  ])('rejects invalid options %j', async (extra, message) => {
    const io = createIo();
    await run(io, 'analyze', packPath, '--mc', '1.21.1', ...extra);
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(message);
    expect(io.requests).toBe(0);
  });

  it('reports unreadable packs', async () => {
    const io = createIo();
    await run(io, 'analyze', join(dir, 'missing.mrpack'), '--mc', '1.21.1', '--loader', 'fabric');
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(/error: Cannot access/);
  });
});

describe('parseTarget', () => {
  it('accepts releases, pre-releases and snapshots', () => {
    expect(parseTarget('1.21.1', 'fabric').minecraftVersion).toBe('1.21.1');
    expect(parseTarget('1.21', 'quilt').minecraftVersion).toBe('1.21');
    expect(parseTarget('1.21.2-pre1', 'fabric').minecraftVersion).toBe('1.21.2-pre1');
    expect(parseTarget('24w33a', 'fabric').minecraftVersion).toBe('24w33a');
    expect(() => parseTarget('latest', 'fabric')).toThrow(/Invalid Minecraft version/);
  });
});
