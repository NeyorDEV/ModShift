import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { AnalysisResult } from '../../src/core/types.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { COMPAT_LAYERS, compatLayersFor } from '../../src/loaders/compatLayers.js';
import { buildMigrationPlan } from '../../src/migrate/plan.js';
import { renderMigrationReport } from '../../src/migrate/report.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import type { MigrationTarget } from '../../src/types.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

const byFile = (result: AnalysisResult, fileName: string) =>
  result.mods.find((m) => m.fileName === fileName);

async function analyse(fixture: string, target: MigrationTarget, compatLayers?: boolean) {
  const pack = parseMrpack(packFixture(fixture), `${fixture}.mrpack`);
  const { client } = createFakeClient();
  const result = await analyzePack(pack, target, client, { compatLayers });
  return { pack, result };
}

describe('compatibility layer registry', () => {
  it('only lists the documented loader and Minecraft version pairs', () => {
    expect(COMPAT_LAYERS.map((l) => [l.id, l.runs, l.on, l.minecraftVersions])).toEqual([
      ['sinytra-connector', 'fabric', 'neoforge', ['1.21.1']],
      ['sinytra-connector-1.20.1', 'fabric', 'forge', ['1.20.1']],
      ['kilt', 'forge', 'fabric', ['1.20.1']],
    ]);
    expect(compatLayersFor({ loader: 'neoforge', minecraftVersion: '1.21.1' })).toHaveLength(1);
    expect(compatLayersFor({ loader: 'neoforge', minecraftVersion: '1.20.1' })).toEqual([]);
    expect(compatLayersFor({ loader: 'fabric', minecraftVersion: '1.21.1' })).toEqual([]);
    expect(compatLayersFor({ loader: 'quilt', minecraftVersion: '1.20.1' })).toEqual([]);
  });
});

describe('compatibility layer hints', () => {
  it('flags Fabric mods that Sinytra Connector could load on NeoForge 1.21.1, never in the pack', async () => {
    const target = { minecraftVersion: '1.21.1', loader: 'neoforge' } as const;
    const { pack, result } = await analyse('mrpack-fabric', target);
    const modmenu = byFile(result, 'modmenu-7.2.2.jar');
    expect(modmenu?.compatLayer).toMatchObject({
      layer: 'sinytra-connector',
      runs: 'fabric',
      version: { id: 'v1menu' },
      requires: [{ slug: 'connector' }, { slug: 'forgified-fabric-api' }],
      note: 'experimental, not guaranteed',
    });
    expect(modmenu?.reason).toContain(
      'could run through Sinytra Connector (experimental, not guaranteed; not added to the pack)',
    );
    // Fabric API est remplacée par Forgified Fabric API : pas de signalement.
    expect(byFile(result, 'fabric-api-0.92.0.jar')?.compatLayer).toBeUndefined();
    // Un mod ayant une version native n'est pas concerné.
    expect(byFile(result, 'sodium-fabric-0.5.8.jar')?.compatLayer).toBeUndefined();

    const plan = buildMigrationPlan(pack, result, { loaderVersion: '21.1.219' });
    expect(plan.mods.map((m) => m.projectId)).not.toContain('mOgUt4GM');
    expect(plan.index.files.some((f) => f.path.includes('v1menu'))).toBe(false);
    const report = renderMigrationReport(plan, result, 'out.mrpack');
    expect(report).toContain('## Compatibility layers (experimental, not guaranteed)');
    expect(report).toContain('ModShift never adds them to the migrated pack');
    expect(renderMarkdown(result)).toContain(
      '- **Mod Menu**: fabric version 7.2.2 through Sinytra Connector.',
    );
  });

  it('flags Forge mods that Kilt could load on Fabric 1.20.1, with its caveat', async () => {
    const target = { minecraftVersion: '1.20.1', loader: 'fabric' } as const;
    const { pack, result } = await analyse('mrpack-forge-to-fabric', target);
    const create = byFile(result, 'create-1.20.1-0.5.1.f.jar');
    expect(create?.compatLayer).toMatchObject({
      layer: 'kilt',
      runs: 'forge',
      version: { id: 'v1create' },
      caveat: expect.stringContaining('may break worlds'),
    });
    expect(byFile(result, 'storage-tweaks-1.0.0.jar')?.compatLayer?.layer).toBe('kilt');
    const plan = buildMigrationPlan(pack, result, { loaderVersion: '0.16.5' });
    expect(plan.mods.some((m) => m.version.loaders.includes('forge'))).toBe(false);
  });

  it('gives no hint outside the documented versions, or when disabled', async () => {
    const other = await analyse('mrpack-forge-to-fabric', {
      minecraftVersion: '1.21.1',
      loader: 'fabric',
    });
    expect(other.result.mods.some((m) => m.compatLayer)).toBe(false);
    const disabled = await analyse(
      'mrpack-fabric',
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      false,
    );
    expect(disabled.result.mods.some((m) => m.compatLayer)).toBe(false);
  });
});
