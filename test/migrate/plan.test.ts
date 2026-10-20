import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import { parseCurseForgeZip } from '../../src/input/curseforge.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { validateMrpackIndex } from '../../src/migrate/mrpackSpec.js';
import { buildMigrationPlan, resolveLoaderVersion } from '../../src/migrate/plan.js';
import { renderMigrationReport, renderPlanText } from '../../src/migrate/report.js';
import {
  buildMrpackArchive,
  collectOverrides,
  InvalidMrpackError,
} from '../../src/migrate/writer.js';
import type { MigrationTarget, ModPack } from '../../src/types.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

const fabric121: MigrationTarget = { minecraftVersion: '1.21.1', loader: 'fabric' };

async function plan(options: { adoptAlternatives?: boolean; loaderVersion?: string } = {}) {
  const pack = parseMrpack(packFixture('mrpack-fabric'), 'fixture.mrpack');
  const { client } = createFakeClient();
  const analysis = await analyzePack(pack, fabric121, client, {
    adoptAlternatives: options.adoptAlternatives,
  });
  return {
    pack,
    analysis,
    plan: buildMigrationPlan(pack, analysis, { loaderVersion: options.loaderVersion ?? '0.16.5' }),
  };
}

describe('resolveLoaderVersion', () => {
  const pack = {
    minecraftVersion: '1.20.1',
    loader: 'fabric',
    loaderVersion: '0.15.11',
  } as ModPack;

  it('prefers the explicit option, then the source pack when loader and version match', () => {
    expect(resolveLoaderVersion(pack, fabric121, '0.16.5')).toEqual({
      version: '0.16.5',
      source: 'option',
    });
    expect(resolveLoaderVersion(pack, { minecraftVersion: '1.20.1', loader: 'fabric' })).toEqual({
      version: '0.15.11',
      source: 'source-pack',
    });
    expect(resolveLoaderVersion(pack, fabric121)).toEqual({});
    expect(resolveLoaderVersion(pack, { minecraftVersion: '1.20.1', loader: 'quilt' })).toEqual({});
  });
});

describe('buildMigrationPlan', () => {
  it('keeps compatible mods, updates the others and adds dependencies', async () => {
    const { plan: p } = await plan();
    expect(p.mods.map((m) => [m.source, m.title, m.version.id])).toEqual([
      ['updated', 'Sodium', 'v2sodium'],
      ['updated', 'Fabric API', 'v2fapi'],
      ['kept', 'Mod Menu', 'v1menu'],
      ['dependency', 'Cloth Config API', 'v2cloth'],
    ]);
    expect(p.excluded.map((m) => m.fileName)).toEqual([
      'old-minimap-1.0.jar',
      'mystery-mod.jar',
      'local-mod.jar',
    ]);
  });

  it('builds a valid index with target dependencies, hashes, sizes and env', async () => {
    const { plan: p } = await plan();
    expect(validateMrpackIndex(p.index)).toEqual([]);
    expect(p.index.dependencies).toEqual({ minecraft: '1.21.1', 'fabric-loader': '0.16.5' });
    expect(p.index.name).toBe('Fixture Fabric Pack (1.21.1 fabric)');
    expect(p.index.versionId).toBe('1.0.0+fabric-1.21.1');
    const sodium = p.index.files.find((f) => f.path === 'mods/v2sodium.jar');
    expect(sodium).toEqual({
      path: 'mods/v2sodium.jar',
      hashes: { sha1: 'a1'.repeat(20), sha512: 'a1'.repeat(64) },
      env: { client: 'required', server: 'unsupported' },
      downloads: ['https://cdn.modrinth.com/data/fixture/v2sodium.jar'],
      fileSize: 1000,
    });
    // Le resource pack de l'index d'origine est repris tel quel.
    expect(p.keptFiles.map((f) => f.path)).toEqual(['resourcepacks/faithful.zip']);
  });

  it('includes the best alternative only on request, still flagged as a suggestion', async () => {
    const { plan: p } = await plan({ adoptAlternatives: true });
    const alt = p.mods.find((m) => m.source === 'alternative');
    expect(alt).toMatchObject({ title: "Xaero's Minimap", replaces: 'old-minimap-1.0.jar' });
    expect(
      p.excluded.find((m) => m.fileName === 'old-minimap-1.0.jar')?.adoptedAlternative?.note,
    ).toBe('suggestion, to verify');
    expect((await plan()).plan.mods.some((m) => m.source === 'alternative')).toBe(false);
  });

  it('drops source index files that no longer satisfy the format', async () => {
    const { pack, analysis } = await plan();
    pack.indexFiles = [
      {
        path: 'resourcepacks/a.zip',
        hashes: { sha1: 'a'.repeat(40) },
        downloads: ['https://cdn.modrinth.com/a.zip'],
        fileSize: 1,
      },
      {
        path: 'resourcepacks/b.zip',
        hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
        downloads: ['https://example.com/b.zip'],
        fileSize: 1,
      },
      {
        path: 'resourcepacks/c.zip',
        hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
        downloads: ['https://cdn.modrinth.com/c.zip'],
      },
    ];
    expect(buildMigrationPlan(pack, analysis).droppedFiles).toEqual([
      { path: 'resourcepacks/a.zip', reason: 'missing sha1 or sha512 hash' },
      {
        path: 'resourcepacks/b.zip',
        reason: 'download URL missing or not allowed by the .mrpack format',
      },
      { path: 'resourcepacks/c.zip', reason: 'missing fileSize' },
    ]);
  });

  it('excludes mods whose Modrinth file cannot be put in an index', async () => {
    const { pack, analysis } = await plan();
    const sodium = analysis.mods[0];
    if (sodium?.targetVersion?.file) sodium.targetVersion.file.url = 'https://example.com/x.jar';
    const p = buildMigrationPlan(pack, analysis, { loaderVersion: '0.16.5' });
    expect(p.excluded[0]?.fileName).toBe('sodium-fabric-0.5.8.jar');
    expect(p.warnings[0]).toContain('download URL not allowed');
  });
});

describe('overrides and archive', () => {
  it('copies .mrpack overrides but not mod jars', () => {
    const pack = parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack');
    const result = collectOverrides(packFixture('mrpack-fabric'), pack);
    expect(Object.keys(result.files)).toEqual(['overrides/config/sodium-options.json']);
    expect(result.skipped).toEqual([
      { path: 'overrides/mods/local-mod.jar', reason: 'mod jar (handled by the analysis)' },
    ]);
  });

  it('maps CurseForge overrides to overrides/', () => {
    const data = packFixture('curseforge-forge');
    const result = collectOverrides(data, parseCurseForgeZip(data, 'cf.zip'));
    expect(Object.keys(result.files)).toEqual(['overrides/config/jei-client.toml']);
  });

  it('writes an archive that round-trips, and refuses invalid indexes', async () => {
    const { plan: p } = await plan();
    const archive = buildMrpackArchive(p.index, { 'overrides/a.txt': new Uint8Array([1]) });
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual(['modrinth.index.json', 'overrides/a.txt']);
    expect(JSON.parse(strFromU8(entries['modrinth.index.json'] ?? new Uint8Array()))).toEqual(
      p.index,
    );

    expect(() => buildMrpackArchive({ ...p.index, game: 'other' as 'minecraft' }, {})).toThrow(
      InvalidMrpackError,
    );
  });
});

describe('migration report', () => {
  it('lists included and excluded mods with alternatives and warnings', async () => {
    const { plan: p, analysis } = await plan({ adoptAlternatives: true });
    const md = renderMigrationReport(p, analysis, 'out.mrpack');
    expect(md).toMatchSnapshot();
  });

  it('renders a console summary', async () => {
    const { plan: p, analysis } = await plan();
    const text = renderPlanText(p, analysis, 'Dry run', 1);
    expect(text).toContain('↑ Sodium 0.5.8 → 0.6.0');
    expect(text).toContain('+ Cloth Config API 15.0.0 (dependency of Sodium)');
    expect(text).toContain('! missing dependency Text Lib (required by Mod Menu)');
  });
});
