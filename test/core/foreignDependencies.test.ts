import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { ModrinthProject, ModrinthVersion } from '../../src/modrinth/types.js';
import type { ModPack } from '../../src/types.js';
import { createFakeClient, loadCatalog } from '../helpers/fakeModrinth.js';

// Cas observé sur la vraie API : Zoomify publie un seul fichier pour Fabric et NeoForge, qui
// déclare KotlinLangForge (NeoForge seulement). Modrinth ne dit pas pour quel loader est la
// dépendance : pour une cible Fabric, elle ne doit pas être signalée comme manquante.
function project(id: string, title: string, loaders: string[]): ModrinthProject {
  return {
    id,
    slug: id.toLowerCase(),
    title,
    description: `${title}.`,
    categories: ['utility'],
    project_type: 'mod',
    loaders,
    game_versions: ['1.21.1'],
    downloads: 1000,
  };
}

function version(
  id: string,
  projectId: string,
  loaders: string[],
  hash: string,
  deps: string[] = [],
) {
  return {
    id,
    project_id: projectId,
    name: id,
    version_number: '1.0.0',
    game_versions: ['1.21.1'],
    loaders,
    version_type: 'release',
    date_published: '2024-09-01T00:00:00Z',
    dependencies: deps.map((d) => ({
      version_id: null,
      project_id: d,
      file_name: null,
      dependency_type: 'required',
    })),
    status: 'listed',
    files: [
      {
        hashes: { sha1: hash.repeat(40).slice(0, 40), sha512: hash.repeat(128).slice(0, 128) },
        url: `https://cdn.modrinth.com/data/fixture/${id}.jar`,
        filename: `${id}.jar`,
        primary: true,
        size: 1000,
      },
    ],
  } satisfies ModrinthVersion;
}

function catalog() {
  const base = loadCatalog();
  base.projects.push(
    project('ZOOMIFY1', 'Zoomify', ['fabric', 'neoforge']),
    project('SINGLEF1', 'Single Loader Mod', ['fabric']),
    project('KLFORGE1', 'KotlinLangForge', ['neoforge']),
  );
  base.versions.push(
    version('v1zoom', 'ZOOMIFY1', ['fabric', 'neoforge'], 'a7', ['KLFORGE1']),
    version('v1single', 'SINGLEF1', ['fabric'], 'a8', ['KLFORGE1']),
    version('v1klf', 'KLFORGE1', ['neoforge'], 'a9'),
  );
  return base;
}

const pack = (hashes: string[]): ModPack => ({
  source: 'mrpack',
  minecraftVersion: '1.21.1',
  loader: 'fabric',
  mods: hashes.map((h, i) => ({
    fileName: `mod-${i}.jar`,
    path: `mods/mod-${i}.jar`,
    origin: 'index',
    hashes: { sha1: h.repeat(40).slice(0, 40) },
    metadata: [],
  })),
  otherFiles: [],
  warnings: [],
});

const target = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;

describe('dependencies of multi-loader files', () => {
  it('ignores a dependency published only for another loader of a multi-loader file', async () => {
    const { client } = createFakeClient(catalog());
    const result = await analyzePack(pack(['a7']), target, client);
    expect(result.dependencies.missing).toEqual([]);
    expect(result.warnings).toContain(
      'KotlinLangForge (required by Zoomify) ignored: only published for neoforge, so probably needed by another loader of a multi-loader file.',
    );
  });

  it('still reports it as missing when a single-loader file requires it', async () => {
    const { client } = createFakeClient(catalog());
    const result = await analyzePack(pack(['a7', 'a8']), target, client);
    expect(result.dependencies.missing).toEqual([
      expect.objectContaining({
        title: 'KotlinLangForge',
        requiredBy: ['Zoomify', 'Single Loader Mod'],
      }),
    ]);
  });
});
