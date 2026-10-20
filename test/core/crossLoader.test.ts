import { beforeAll, describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { AnalysisResult } from '../../src/core/types.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { buildMigrationPlan } from '../../src/migrate/plan.js';
import { renderMigrationReport } from '../../src/migrate/report.js';
import type { ModPack } from '../../src/types.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

// Migration inter-loaders 1.20.1 Forge → 1.21.1 Fabric : mods multi-loaders (même projet),
// alternatives classées et mod sans équivalent.
describe('cross-loader migration — 1.20.1 Forge → 1.21.1 Fabric', () => {
  let pack: ModPack;
  let result: AnalysisResult;
  const byFile = (fileName: string) => result.mods.find((m) => m.fileName === fileName);

  beforeAll(async () => {
    pack = parseMrpack(packFixture('mrpack-forge-to-fabric'), 'forge.mrpack');
    const { client } = createFakeClient();
    result = await analyzePack(pack, { minecraftVersion: '1.21.1', loader: 'fabric' }, client);
  });

  it('keeps a multi-loader mod by switching to its Fabric version of the same project', () => {
    const jei = byFile('jei-1.20.1-forge-15.2.0.27.jar');
    expect(jei).toMatchObject({
      status: 'update-found',
      project: { id: 'JEIJEIJE' },
      targetVersion: { id: 'v1jeifabric', loaders: ['fabric'] },
      loaderChange: { from: 'forge', to: 'fabric' },
    });
    expect(jei?.alternatives).toEqual([]);
    expect(jei?.reason).toBe(
      'Same project: its Fabric version replaces the Forge one (multi-loader mod).',
    );
  });

  it('suggests ranked, explained alternatives for Forge-only mods', () => {
    const create = byFile('create-1.20.1-0.5.1.f.jar');
    expect(create?.status).toBe('alternative-suggested');
    expect(create?.loaderChange).toBeUndefined();
    expect(create?.alternatives[0]).toMatchObject({
      project: { title: 'Create Fabric' },
      reason: 'similar-name',
      explanation: expect.stringContaining('similar name (create)'),
    });
    expect(create?.alternatives[0]?.explanation).toContain(
      'same categories (technology, decoration)',
    );

    const rubidium = byFile('rubidium-0.7.1.jar');
    expect(rubidium?.alternatives.map((a) => a.project.title)).toContain('Sodium');
    expect(rubidium?.alternatives[0]?.explanation).toContain('same categories (optimization)');
  });

  it('reports a mod without any equivalent as not found', () => {
    expect(byFile('storage-tweaks-1.0.0.jar')).toMatchObject({
      status: 'not-found',
      alternatives: [],
      reason: 'No version for Minecraft 1.21.1 / fabric.',
    });
  });

  it('builds a Fabric pack with the same-project mods only (alternatives stay suggestions)', () => {
    const plan = buildMigrationPlan(pack, result, { loaderVersion: '0.16.5' });
    expect(plan.index.dependencies).toEqual({ minecraft: '1.21.1', 'fabric-loader': '0.16.5' });
    expect(plan.mods.map((m) => m.projectId)).toEqual(['JEIJEIJE']);
    expect(plan.excluded.map((m) => m.fileName)).toEqual([
      'create-1.20.1-0.5.1.f.jar',
      'rubidium-0.7.1.jar',
      'storage-tweaks-1.0.0.jar',
    ]);
    const report = renderMigrationReport(plan, result, 'out.mrpack');
    expect(plan.mods[0]?.loaderChange).toEqual({ from: 'forge', to: 'fabric' });
    expect(report).toContain('same project, fabric version (was forge)');
    expect(report).toContain('## Why these alternatives');
    expect(report).toContain('ModShift does not convert mod code');
  });
});
