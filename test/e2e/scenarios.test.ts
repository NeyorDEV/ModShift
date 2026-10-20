import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIo, run } from '../helpers/cli.js';
import { loadCatalog } from '../helpers/fakeModrinth.js';
import { jarFixture, packFixture } from '../helpers/fixtures.js';
import { assertValidGeneratedPack } from '../helpers/mrpackAssertions.js';

// Scénarios de bout en bout : CLI complète (lecture → analyse → plan → .mrpack → rapport),
// faux Modrinth en mémoire, fichiers réels dans un dossier temporaire.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-e2e-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function migrate(input: string, ...args: string[]) {
  const io = createIo();
  const out = join(dir, 'out.mrpack');
  await run(io, 'migrate', input, '--out', out, '--no-cache', '-q', ...args);
  expect(io.err).toBe('');
  expect(io.exitCode).toBeUndefined();
  const pack = assertValidGeneratedPack(new Uint8Array(await readFile(out)), loadCatalog());
  const report = await readFile(join(dir, 'MIGRATION_REPORT.md'), 'utf8');
  return { io, ...pack, report };
}

async function writePack(name: string): Promise<string> {
  const path = join(dir, `${name}.mrpack`);
  await writeFile(path, packFixture(name));
  return path;
}

describe('E2E: 1.20.1 Forge → 1.21.1 NeoForge', () => {
  it('updates mods, adds dependencies, excludes Forge-only mods and keeps overrides', async () => {
    const input = await writePack('mrpack-forge');
    const { index, entries, report } = await migrate(
      input,
      '--mc',
      '1.21.1',
      '--loader',
      'neoforge',
      '--loader-version',
      '21.1.77',
    );
    expect(index.dependencies).toEqual({ minecraft: '1.21.1', neoforge: '21.1.77' });
    expect(index.files.map((f) => f.path)).toEqual([
      'mods/v1jei.jar',
      'mods/v2create.jar',
      'mods/v2fly.jar',
    ]);
    // L'environnement client/serveur du pack d'origine est conservé.
    expect(index.files[1]?.env).toEqual({ client: 'required', server: 'required' });
    expect(Object.keys(entries).sort()).toEqual([
      'modrinth.index.json',
      'overrides/config/create-common.toml',
    ]);
    expect(report).toContain('| Flywheel | 1.0.0 | added dependency | required by Create |');
    expect(report).toMatch(
      /\| Rubidium \| rubidium-0\.7\.1\.jar \| No version for Minecraft 1\.21\.1 \/ neoforge\./,
    );
    expect(report).toContain(
      '[Sodium](https://modrinth.com/mod/sodium), [Embeddium](https://modrinth.com/mod/embeddium)',
    );
  });

  it('includes the best alternative with --include-alternatives', async () => {
    const input = await writePack('mrpack-forge');
    const { index, report } = await migrate(
      input,
      '--mc',
      '1.21.1',
      '--loader',
      'neoforge',
      '--loader-version',
      '21.1.77',
      '--include-alternatives',
    );
    expect(index.files.map((f) => f.path)).toContain('mods/v2sodiumneo.jar');
    expect(report).toContain(
      '| Sodium | 0.6.0-neoforge | alternative — suggestion, to verify | replaces rubidium-0.7.1.jar |',
    );
  });
});

describe('E2E: Fabric → Quilt', () => {
  it('uses Quilt-native versions first and Fabric versions otherwise', async () => {
    const input = await writePack('mrpack-fabric');
    const { index, report } = await migrate(
      input,
      '--mc',
      '1.21.1',
      '--loader',
      'quilt',
      '--loader-version',
      '0.27.1',
    );
    expect(index.dependencies).toEqual({ minecraft: '1.21.1', 'quilt-loader': '0.27.1' });
    expect(index.files.map((f) => f.path)).toEqual([
      'mods/v2sodium.jar',
      'mods/v2fapi.jar',
      'mods/v1menu.jar',
      'mods/v2cloth.jar',
      'resourcepacks/faithful.zip',
    ]);
    expect(report).toContain('| Mod Menu | 7.2.2 | kept (already compatible) |');
  });
});

describe('E2E: pack with unidentifiable mods', () => {
  it('excludes unknown jars with a reason and flags mod-id matches as unverified', async () => {
    const mods = join(dir, 'instance', 'mods');
    await mkdir(mods, { recursive: true });
    await writeFile(join(mods, 'jei-local.jar'), jarFixture('forge-jei'));
    await writeFile(join(mods, 'library.jar'), jarFixture('no-metadata'));
    await writeFile(join(mods, 'quilty.jar'), jarFixture('quilt-mod'));

    const { index, report, io } = await migrate(
      join(dir, 'instance'),
      '--mc',
      '1.21.1',
      '--loader',
      'neoforge',
      '--loader-version',
      '21.1.77',
    );
    expect(index.files.map((f) => f.path)).toEqual(['mods/v1jei.jar']);
    expect(report).toContain('replaces jei-local.jar (identified by mod id only, unverified)');
    expect(report).toContain('| library.jar | library.jar | Unknown file hash on Modrinth. | — |');
    expect(report).toContain('no Modrinth project matches mod id "example_quilt"');
    expect(io.out).toContain('Excluded:');
  });
});

describe('E2E: pack with a missing dependency', () => {
  it('keeps the mod but reports the dependency that has no version for the target', async () => {
    const input = await writePack('mrpack-fabric');
    const { index, report } = await migrate(
      input,
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--loader-version',
      '0.16.5',
    );
    expect(index.files.map((f) => f.path)).toContain('mods/v1menu.jar');
    expect(index.files.some((f) => f.path.includes('text'))).toBe(false);
    expect(report).toContain('## Missing dependencies');
    expect(report).toContain(
      '- **Text Lib** (required by Mod Menu): No version for Minecraft 1.21.1 / fabric',
    );
  });
});

describe('E2E: analyze', () => {
  it('reports the Forge pack as JSON', async () => {
    const io = createIo();
    await run(
      io,
      'analyze',
      await writePack('mrpack-forge'),
      '--mc',
      '1.21.1',
      '--loader',
      'neoforge',
      '-f',
      'json',
      '-q',
      '--no-cache',
    );
    const report = JSON.parse(io.out) as { summary: Record<string, number> };
    expect(report.summary).toEqual({
      compatible: 0,
      'update-found': 2,
      'alternative-suggested': 1,
      'not-found': 0,
    });
  });
});
