import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { CurseForgeClient } from '../../src/curseforge/client.js';
import { resolveCurseForgeRefs } from '../../src/curseforge/resolve.js';
import { buildMigrationPlan } from '../../src/migrate/plan.js';
import type { ModrinthVersion } from '../../src/modrinth/types.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import type { ModPack } from '../../src/types.js';
import { createFakeClient, loadCatalog } from '../helpers/fakeModrinth.js';

// Cas réel : un export CurseForge listait « Faithful 32x » (pack de ressources) parmi ses mods ;
// ModShift le cherchait sous le loader « fabric » et le déclarait introuvable.
function version(
  id: string,
  projectId: string,
  gameVersion: string,
  hash: string,
): ModrinthVersion {
  return {
    id,
    project_id: projectId,
    name: id,
    version_number: gameVersion,
    game_versions: [gameVersion],
    // Packs de ressources : loader « minecraft » (labrinth, validate/resourcepack.rs).
    loaders: ['minecraft'],
    version_type: 'release',
    date_published: '2024-09-01T00:00:00Z',
    dependencies: [],
    status: 'listed',
    files: [
      {
        hashes: { sha1: hash.repeat(20), sha512: hash.repeat(64) },
        url: `https://cdn.modrinth.com/data/fixture/${id}.zip`,
        filename: `${id}.zip`,
        primary: true,
        size: 1000,
      },
    ],
  };
}

function catalog() {
  const base = loadCatalog();
  for (const [id, title] of [
    ['FAITHFL1', 'Faithful Fixture'],
    ['OLDPACK1', 'Old Texture Pack'],
  ] as const) {
    base.projects.push({
      id,
      slug: id.toLowerCase(),
      title,
      description: `${title}, a resource pack.`,
      categories: ['16x'],
      project_type: 'resourcepack',
      loaders: ['minecraft'],
      game_versions: ['1.20.1', '1.21.1'],
      downloads: 1000,
    });
  }
  base.versions.push(
    version('v1faith', 'FAITHFL1', '1.20.1', 'b6'),
    version('v2faith', 'FAITHFL1', '1.21.1', 'b7'),
    // Pas de version 1.21.1 : introuvable, sans recherche d'alternatives parmi les mods.
    version('v1oldpack', 'OLDPACK1', '1.20.1', 'e8'),
  );
  return base;
}

const entry = (name: string, hash: string) => ({
  fileName: name,
  path: `resourcepacks/${name}`,
  origin: 'index' as const,
  hashes: { sha1: hash.repeat(20) },
  metadata: [],
});

const pack = (): ModPack => ({
  source: 'curseforge',
  minecraftVersion: '1.20.1',
  loader: 'fabric',
  mods: [entry('Faithful 32x - 1.20.1.zip', 'b6'), entry('old-pack.zip', 'e8')],
  otherFiles: [],
  warnings: [],
});

describe('resource packs listed among the mods', () => {
  it('finds their version under the "minecraft" loader and installs them in resourcepacks/', async () => {
    const { client, calls } = createFakeClient(catalog());
    const result = await analyzePack(
      pack(),
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    const [faithful, old] = result.mods;
    expect(faithful).toMatchObject({
      status: 'update-found',
      project: { id: 'FAITHFL1', projectType: 'resourcepack' },
      targetVersion: { id: 'v2faith' },
    });
    expect(old).toMatchObject({
      status: 'not-found',
      alternatives: [],
      reason: 'No version for Minecraft 1.21.1 (resource pack).',
    });
    // Aucune recherche d'alternatives (ce serait des mods) pour un pack de ressources.
    expect(calls.some((c) => c.url.pathname.endsWith('/search'))).toBe(false);

    const plan = buildMigrationPlan(pack(), result, { loaderVersion: '0.16.5' });
    expect(plan.index.files.map((f) => f.path)).toContain('resourcepacks/v2faith.zip');
    expect(renderMarkdown(result)).toContain(
      '[Faithful Fixture](https://modrinth.com/resourcepack/faithfl1)',
    );
  });

  it('puts CurseForge resource packs (class 12) and shaders (class 6552) in their folders', async () => {
    const cfPack: ModPack = {
      source: 'curseforge',
      mods: [1, 2, 3].map((n) => ({
        fileName: `curseforge:${n}:${n}`,
        path: `mods/curseforge-${n}`,
        origin: 'index' as const,
        hashes: {},
        metadata: [],
        curseforge: { projectId: n, fileId: n * 10, required: true },
      })),
      otherFiles: [],
      warnings: [],
    };
    const client = {
      getFiles: async () => [
        { id: 10, modId: 1, fileName: 'pack.zip', hashes: [] },
        { id: 20, modId: 2, fileName: 'shader.zip', hashes: [] },
        { id: 30, modId: 3, fileName: 'mod.jar', hashes: [] },
      ],
      getMods: async () => [
        { id: 1, name: 'Pack', slug: 'pack', classId: 12 },
        { id: 2, name: 'Shader', slug: 'shader', classId: 6552 },
        { id: 3, name: 'Mod', slug: 'mod', classId: 6 },
      ],
    } as unknown as CurseForgeClient;
    await resolveCurseForgeRefs(cfPack, client);
    expect(cfPack.mods.map((m) => m.path)).toEqual([
      'resourcepacks/pack.zip',
      'shaderpacks/shader.zip',
      'mods/mod.jar',
    ]);
  });
});
