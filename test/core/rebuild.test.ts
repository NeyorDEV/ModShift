import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { ModrinthVersion } from '../../src/modrinth/types.js';
import type { ModPack } from '../../src/types.js';
import { renderTable } from '../../src/report/table.js';
import { createFakeClient, loadCatalog } from '../helpers/fakeModrinth.js';

// Cas réel : Packet Fixer, Stella, SkyOcean… publient « 3.3.6 » pour 26.2 puis un autre fichier
// « 3.3.6 » pour 26.3. Le rapport affichait « 3.3.6 → 3.3.6 » sans explication.
function version(id: string, number: string, gameVersion: string, hash: string): ModrinthVersion {
  return {
    id,
    project_id: 'REBUILD1',
    name: id,
    version_number: number,
    game_versions: [gameVersion],
    loaders: ['fabric'],
    version_type: 'release',
    date_published: '2024-09-01T00:00:00Z',
    dependencies: [],
    status: 'listed',
    files: [
      {
        hashes: { sha1: hash.repeat(20), sha512: hash.repeat(64) },
        url: `https://cdn.modrinth.com/data/fixture/${id}.jar`,
        filename: `${id}.jar`,
        primary: true,
        size: 1000,
      },
    ],
  };
}

function catalog() {
  const base = loadCatalog();
  base.projects.push({
    id: 'REBUILD1',
    slug: 'rebuild-mod',
    title: 'Rebuild Mod',
    description: 'A mod republished for each Minecraft version.',
    categories: ['utility'],
    project_type: 'mod',
    loaders: ['fabric'],
    game_versions: ['1.20.1', '1.21.1'],
    downloads: 1000,
  });
  base.versions.push(
    version('v1rebuild-old', '3.3.6', '1.20.1', 'c3'),
    version('v1rebuild-new', '3.3.6', '1.21.1', 'c4'),
  );
  return base;
}

const pack: ModPack = {
  source: 'mrpack',
  minecraftVersion: '1.20.1',
  loader: 'fabric',
  mods: [
    {
      fileName: 'rebuild-mod-3.3.6.jar',
      path: 'mods/rebuild-mod-3.3.6.jar',
      origin: 'index',
      hashes: { sha1: 'c3'.repeat(20) },
      metadata: [],
    },
  ],
  otherFiles: [],
  warnings: [],
};

describe('same version number rebuilt for the target', () => {
  it('explains an update that keeps the version number', async () => {
    const { client } = createFakeClient(catalog());
    const result = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    const mod = result.mods[0];
    expect(mod).toMatchObject({
      status: 'update-found',
      currentVersion: { id: 'v1rebuild-old', versionNumber: '3.3.6' },
      targetVersion: { id: 'v1rebuild-new', versionNumber: '3.3.6' },
      reason: 'Same version number, file built for Minecraft 1.21.1.',
    });
    expect(renderTable(result)).toContain('Same version number, file built for Minecraft 1.21.1.');
  });
});
