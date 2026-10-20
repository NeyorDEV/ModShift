import { beforeAll, describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { AnalysisResult } from '../../src/core/types.js';
import { modEntryFromJar } from '../../src/input/jar.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { parseCurseForgeZip } from '../../src/input/curseforge.js';
import type { ModPack } from '../../src/types.js';
import { createFakeClient, loadCatalog, type Catalog } from '../helpers/fakeModrinth.js';
import { jarFixture, packFixture } from '../helpers/fixtures.js';

const fabricPack = () => parseMrpack(packFixture('mrpack-fabric'), 'fixture.mrpack');
const byFile = (result: AnalysisResult, fileName: string) =>
  result.mods.find((m) => m.fileName === fileName);

describe('analyzePack — 1.20.1 Fabric → 1.21.1 Fabric', () => {
  let result: AnalysisResult;
  beforeAll(async () => {
    const { client } = createFakeClient();
    result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
  });

  it('keeps a version that already supports the target', () => {
    const mod = byFile(result, 'modmenu-7.2.2.jar');
    expect(mod).toMatchObject({ status: 'compatible', identification: 'hash' });
    expect(mod?.targetVersion?.id).toBe('v1menu');
  });

  it('finds updates, preferring releases over newer betas', () => {
    expect(byFile(result, 'sodium-fabric-0.5.8.jar')).toMatchObject({
      status: 'update-found',
      project: { id: 'AANobbMI', title: 'Sodium' },
      currentVersion: { id: 'v1sodium' },
      targetVersion: { id: 'v2sodium', versionNumber: '0.6.0', file: { fileName: 'v2sodium.jar' } },
    });
    expect(byFile(result, 'fabric-api-0.92.0.jar')?.targetVersion?.id).toBe('v2fapi');
  });

  it('suggests alternatives (marked as to verify) when no version exists', () => {
    const mod = byFile(result, 'old-minimap-1.0.jar');
    expect(mod?.status).toBe('alternative-suggested');
    expect(mod?.reason).toContain('to verify');
    expect(mod?.alternatives.map((a) => [a.project.title, a.reason])).toEqual([
      ["Xaero's Minimap", 'similar-name'],
      // Même thème (carte) avant un mod plus populaire mais d'un autre thème.
      // Même thème et mot-clé « minimap » ; JEI (même catégorie large « utility », très populaire)
      // n'a aucun lien réel avec une minimap : il n'est plus proposé.
      ['JourneyMap', 'same-category'],
    ]);
    expect(mod?.alternatives.every((a) => a.note === 'suggestion, to verify')).toBe(true);
    // Les projets déjà présents dans le pack ne sont pas proposés.
    expect(mod?.alternatives.some((a) => a.project.id === 'mOgUt4GM')).toBe(false);
  });

  it('reports unknown files as not found', () => {
    expect(byFile(result, 'mystery-mod.jar')).toMatchObject({
      status: 'not-found',
      identification: 'none',
      reason:
        'Unknown file hash on Modrinth. The file may come from another site (CurseForge, GitHub) or have been modified.',
    });
    expect(byFile(result, 'local-mod.jar')?.reason).toContain('mod id "localmod"');
  });

  it('adds missing required dependencies and reports unavailable ones', () => {
    expect(result.dependencies.added).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ id: 'CLOTHCFG' }),
        version: expect.objectContaining({ id: 'v2cloth' }),
        requiredBy: ['Sodium'],
      }),
    ]);
    expect(result.dependencies.missing).toEqual([
      {
        projectId: 'TEXTLIB1',
        title: 'Text Lib',
        requiredBy: ['Mod Menu'],
        reason: 'No version for Minecraft 1.21.1 / fabric',
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it('summarises statuses and pack info', () => {
    expect(result.summary).toEqual({
      compatible: 1,
      'update-found': 2,
      'alternative-suggested': 1,
      'not-found': 2,
    });
    expect(result.pack).toMatchObject({
      source: 'mrpack',
      minecraftVersion: '1.20.1',
      loader: 'fabric',
    });
    expect(result.otherFilesCount).toBe(2);
  });
});

describe('analyzePack — other targets', () => {
  it('switches loader: Fabric → NeoForge', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      client,
    );
    expect(byFile(result, 'sodium-fabric-0.5.8.jar')?.targetVersion?.id).toBe('v2sodiumneo');
    const fapi = byFile(result, 'fabric-api-0.92.0.jar');
    expect(fapi?.status).toBe('alternative-suggested');
    expect(fapi?.alternatives[0]).toMatchObject({
      project: { title: 'Forgified Fabric API' },
      reason: 'similar-name',
    });
    // Aucun projet NeoForge lié à Mod Menu : pas d'alternative sans rapport.
    expect(byFile(result, 'modmenu-7.2.2.jar')?.status).toBe('not-found');
  });

  it('accepts Fabric versions for a Quilt target', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'quilt' },
      client,
    );
    expect(byFile(result, 'modmenu-7.2.2.jar')?.status).toBe('compatible');
    expect(byFile(result, 'sodium-fabric-0.5.8.jar')?.targetVersion?.id).toBe('v2sodium');
  });

  it('can disable alternatives', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
      { maxAlternatives: 0 },
    );
    expect(byFile(result, 'old-minimap-1.0.jar')?.status).toBe('not-found');
  });

  it('identifies jars unknown to Modrinth by mod id (unverified)', async () => {
    const { client } = createFakeClient();
    const { entry } = modEntryFromJar(jarFixture('forge-jei'), 'mods/jei.jar', 'folder');
    const pack: ModPack = { source: 'folder', mods: [entry], otherFiles: [], warnings: [] };
    const result = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      client,
    );
    expect(result.mods[0]).toMatchObject({
      status: 'update-found',
      identification: 'mod-id',
      targetVersion: { id: 'v1jei' },
    });
    expect(result.mods[0]?.reason).toContain('unverified');
  });

  it('explains why CurseForge references cannot be resolved', async () => {
    const { client } = createFakeClient();
    const pack = parseCurseForgeZip(packFixture('curseforge-forge'), 'cf.zip');
    const result = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      client,
    );
    expect(result.mods[0]?.reason).toBe(
      'CurseForge file (project 238222, file 4712866) cannot be identified without a CurseForge API key (set CURSEFORGE_API_KEY).',
    );
  });

  it('caches API responses: a second analysis sends no new request', async () => {
    const { client, calls } = createFakeClient();
    const target = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;
    await analyzePack(fabricPack(), target, client);
    const count = calls.length;
    await analyzePack(fabricPack(), target, client);
    expect(calls.length).toBe(count);
  });
});

describe('analyzePack — conflicts', () => {
  it('flags incompatible projects present in the final list', async () => {
    const catalog: Catalog = structuredClone(loadCatalog());
    const fapi = catalog.versions.find((v) => v.id === 'v2fapi');
    fapi?.dependencies.push({
      version_id: null,
      project_id: 'AANobbMI',
      file_name: null,
      dependency_type: 'incompatible',
    });
    const { client } = createFakeClient(catalog);
    const result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    expect(result.conflicts).toEqual([
      {
        kind: 'incompatible',
        project: expect.objectContaining({ id: 'AANobbMI' }),
        declaredBy: 'Fabric API',
        explanation:
          'Fabric API declares Sodium as incompatible: they may crash or misbehave together. Keep only one of them (ModShift does not remove either automatically).',
      },
    ]);
  });

  it('explains pinned dependency versions that differ from the selected one', async () => {
    const catalog: Catalog = structuredClone(loadCatalog());
    // Mod Menu exige une version précise de Fabric API (celle de 1.20.1).
    const menu = catalog.versions.find((v) => v.id === 'v1menu');
    menu?.dependencies.splice(0, 1, {
      version_id: 'v1fapi',
      project_id: 'P7dR8mSH',
      file_name: null,
      dependency_type: 'required',
    });
    const { client } = createFakeClient(catalog);
    const result = await analyzePack(
      fabricPack(),
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'pinned-version',
        declaredBy: 'Mod Menu',
        explanation: expect.stringContaining(
          'Mod Menu requires a specific version of Fabric API (version id v1fapi), but Fabric API 0.104.0 was selected',
        ),
      }),
    ]);
  });

  it('reports the same project present twice', async () => {
    const pack = fabricPack();
    const sodium = pack.mods[0];
    if (sodium)
      pack.mods.push({ ...sodium, fileName: 'sodium-copy.jar', path: 'mods/sodium-copy.jar' });
    const { client } = createFakeClient();
    const result = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'duplicate',
        declaredBy: 'sodium-fabric-0.5.8.jar, sodium-copy.jar',
        explanation: expect.stringContaining('Sodium is present 2 times'),
      }),
    ]);
  });
});
