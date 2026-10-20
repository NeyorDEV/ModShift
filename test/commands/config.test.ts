import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMrpack } from '../../src/input/mrpack.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let fabricPath: string;
let forgePath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-cfgcli-'));
  fabricPath = join(dir, 'fabric.mrpack');
  forgePath = join(dir, 'forge.mrpack');
  await writeFile(fabricPath, packFixture('mrpack-fabric'));
  await writeFile(forgePath, packFixture('mrpack-forge'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const writeConfig = (value: unknown, name = 'modshift.config.json') =>
  writeFile(join(dir, name), JSON.stringify(value));

describe('modshift.config.json in the CLI', () => {
  it('provides the default target when --mc/--loader are omitted', async () => {
    await writeConfig({ target: { minecraftVersion: '1.21.1', loader: 'neoforge' } });
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', forgePath, '-f', 'json', '--no-cache');
    expect(io.err).toContain(`Using configuration ${join(dir, 'modshift.config.json')}`);
    expect(JSON.parse(io.out)).toMatchObject({
      target: { minecraftVersion: '1.21.1', loader: 'neoforge' },
    });
  });

  it('lets command-line options override the configured target', async () => {
    await writeConfig({ target: { minecraftVersion: '1.20.1', loader: 'forge' } });
    const io = createIo({ cwd: dir });
    await run(
      io,
      'analyze',
      fabricPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '-f',
      'json',
      '-q',
      '--no-cache',
    );
    expect(JSON.parse(io.out)).toMatchObject({
      target: { minecraftVersion: '1.21.1', loader: 'fabric' },
    });
  });

  it('asks for a target when neither options nor config provide one', async () => {
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', fabricPath, '--loader', 'fabric');
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(
      /missing target Minecraft version: pass --mc <version> or set "target\.minecraftVersion"/,
    );
  });

  it('applies ignore and mappings, and --no-config disables them', async () => {
    await writeConfig(
      { ignore: ['old-minimap'], mappings: { 'mystery-mod.jar': 'journeymap' } },
      'rules.json',
    );
    const io = createIo({ cwd: dir });
    await run(
      io,
      'analyze',
      fabricPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--config',
      'rules.json',
      '-f',
      'markdown',
      '-q',
      '--no-cache',
    );
    expect(io.out).toContain('## Ignored (modshift.config.json)');
    expect(io.out).toContain('- Old Minimap (`old-minimap-1.0.jar`), rule `old-minimap`');
    expect(io.out).toContain(
      'Replaced by JourneyMap (mapping "mystery-mod.jar" in modshift.config.json).',
    );

    const plain = createIo({ cwd: dir });
    await run(
      plain,
      'analyze',
      fabricPath,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--no-config',
      '-f',
      'markdown',
      '-q',
      '--no-cache',
    );
    expect(plain.out).not.toContain('Ignored');
  });

  it('explains invalid configuration files', async () => {
    await writeConfig({ targets: {} });
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', fabricPath, '--mc', '1.21.1', '--loader', 'fabric');
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain('modshift.config.json: unknown key "targets"');
    expect(io.err).toContain(
      'hint: Fix the file (see schemas/modshift.config.schema.json) or pass --no-config',
    );
    expect(io.requests).toBe(0);
  });

  it('migrate uses the configured loader version and lists ignored mods', async () => {
    await writeConfig({
      target: { minecraftVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.77' },
      ignore: ['rubidium-*.jar'],
    });
    const io = createIo({ cwd: dir });
    const out = join(dir, 'out.mrpack');
    await run(io, 'migrate', forgePath, '--out', out, '-q', '--no-cache');
    expect(io.exitCode).toBeUndefined();
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'out.mrpack');
    expect(migrated.loaderVersion).toBe('21.1.77');
    const report = await readFile(join(dir, 'MIGRATION_REPORT.md'), 'utf8');
    expect(report).toContain('neoforge 21.1.77 (from modshift.config.json)');
    expect(report).toContain('## Ignored mods');
    expect(report).toContain('_None: every mod has a version for the target._');
  });
});
