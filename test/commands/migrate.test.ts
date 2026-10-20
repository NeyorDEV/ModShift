import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateMrpackArchive } from '../../src/migrate/mrpackSpec.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-migrate-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = () => [
  'migrate',
  packPath,
  '--mc',
  '1.21.1',
  '--loader',
  'fabric',
  '--loader-version',
  '0.16.5',
  '--no-cache',
  '-q',
];

describe('modshift migrate', () => {
  it('writes a valid .mrpack and MIGRATION_REPORT.md next to it', async () => {
    const io = createIo();
    const out = join(dir, 'out', 'migrated.mrpack');
    await import('node:fs/promises').then((fs) => fs.mkdir(join(dir, 'out')));
    await run(io, ...base(), '--out', out);

    expect(io.exitCode).toBeUndefined();
    const archive = new Uint8Array(await readFile(out));
    expect(validateMrpackArchive(archive)).toEqual([]);
    const migrated = parseMrpack(archive, 'migrated.mrpack');
    expect(migrated).toMatchObject({
      minecraftVersion: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.16.5',
    });
    expect(migrated.mods.map((m) => m.path).sort()).toEqual([
      'mods/v1menu.jar',
      'mods/v2cloth.jar',
      'mods/v2fapi.jar',
      'mods/v2sodium.jar',
    ]);
    expect(migrated.otherFiles).toEqual([
      'overrides/config/sodium-options.json',
      'resourcepacks/faithful.zip',
    ]);

    const report = await readFile(join(dir, 'out', 'MIGRATION_REPORT.md'), 'utf8');
    expect(report).toContain('## Excluded mods');
    expect(report).toContain('Old Minimap');
    expect(io.out).toContain('Migrated pack written to');
  });

  it('--dry-run prints the plan and writes nothing', async () => {
    const io = createIo();
    const before = await readdir(dir);
    await run(io, ...base(), '--out', join(dir, 'migrated.mrpack'), '--dry-run');
    expect(await readdir(dir)).toEqual(before);
    expect(io.out).toContain('Dry run: nothing was written.');
    expect(io.out).toContain('↑ Sodium 0.5.8 → 0.6.0');
    expect(io.out).toContain('- Old Minimap');
  });

  it('--dry-run without a loader version only warns', async () => {
    const io = createIo();
    await run(
      io,
      'migrate',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--out',
      join(dir, 'x.mrpack'),
      '--dry-run',
      '--no-cache',
      '-q',
    );
    expect(io.exitCode).toBeUndefined();
    expect(io.out).toContain('a real run needs --loader-version');
  });

  it('--include-alternatives adds the best alternative, flagged as a suggestion', async () => {
    const io = createIo();
    const out = join(dir, 'alt.mrpack');
    await run(io, ...base(), '--out', out, '--include-alternatives');
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'alt.mrpack');
    expect(migrated.mods.map((m) => m.path)).toContain('mods/v1xaero.jar');
    expect(io.out).toContain(
      "~ Xaero's Minimap 24.5.0 (alternative to old-minimap-1.0.jar: suggestion, to verify)",
    );
  });

  it('reuses the source loader version when loader and Minecraft version do not change', async () => {
    const io = createIo();
    const out = join(dir, 'same.mrpack');
    await run(
      io,
      'migrate',
      packPath,
      '--mc',
      '1.20.1',
      '--loader',
      'fabric',
      '--out',
      out,
      '--no-cache',
      '-q',
    );
    expect(io.exitCode).toBeUndefined();
    expect(parseMrpack(new Uint8Array(await readFile(out)), 'same.mrpack').loaderVersion).toBe(
      '0.15.11',
    );
  });

  it.each([
    [['--out', 'x.zip'], /--out must be a \.mrpack file/],
    [['--out', '__PACK__'], /--out must be different from the input pack/],
    [
      ['--out', 'o.mrpack', '--include-alternatives', '--max-alternatives', '0'],
      /--include-alternatives needs/,
    ],
  ])('rejects invalid options %j', async (extra, message) => {
    const io = createIo();
    const args = extra.map((a) =>
      a === '__PACK__' ? packPath : a.endsWith('.mrpack') || a.endsWith('.zip') ? join(dir, a) : a,
    );
    await run(io, ...base(), ...args);
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(message);
    expect(io.requests).toBe(0);
  });

  it('refuses to overwrite an existing file without --force', async () => {
    const out = join(dir, 'exists.mrpack');
    await writeFile(out, 'old');
    const io = createIo();
    await run(io, ...base(), '--out', out);
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(/already exists: use --force/);

    const forced = createIo();
    await run(forced, ...base(), '--out', out, '--force');
    expect(forced.exitCode).toBeUndefined();
    expect(validateMrpackArchive(new Uint8Array(await readFile(out)))).toEqual([]);
  });

  it('asks for --loader-version when it cannot be inferred, before any request', async () => {
    const io = createIo();
    await run(
      io,
      'migrate',
      packPath,
      '--mc',
      '1.21.1',
      '--loader',
      'neoforge',
      '--out',
      join(dir, 'n.mrpack'),
      '--no-cache',
    );
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain(
      'error: Cannot determine the neoforge version for Minecraft 1.21.1: pass --loader-version <version>',
    );
    expect(io.requests).toBe(0);
  });
});
