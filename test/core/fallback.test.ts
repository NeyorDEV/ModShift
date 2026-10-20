import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { buildMigrationPlan } from '../../src/migrate/plan.js';
import { renderMigrationReport, renderPlanText } from '../../src/migrate/report.js';
import { renderMarkdown, renderTable } from '../../src/report/index.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

const quilt = { minecraftVersion: '1.21.1', loader: 'quilt' } as const;

async function analyzeForQuilt() {
  const pack = parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack');
  const { client } = createFakeClient();
  return { pack, result: await analyzePack(pack, quilt, client) };
}

describe('fallback compatibility (Fabric versions on Quilt)', () => {
  it('flags mods and dependencies that only have a Fabric version', async () => {
    const { result } = await analyzeForQuilt();
    const sodium = result.mods.find((m) => m.fileName === 'sodium-fabric-0.5.8.jar');
    expect(sodium?.fallback).toEqual({
      loader: 'fabric',
      source: expect.stringContaining('quilt-loader'),
      note: 'fallback compatibility, to test',
    });
    expect(sodium?.reason).toMatch(
      /^Fallback compatibility, to test: a Fabric version running on Quilt \(QuiltMC\/quilt-loader README/,
    );
    // Mod Menu a une version Quilt native : pas de repli.
    expect(result.mods.find((m) => m.fileName === 'modmenu-7.2.2.jar')?.fallback).toBeUndefined();
    expect(result.dependencies.added[0]).toMatchObject({
      project: { title: 'Cloth Config API' },
      fallback: { loader: 'fabric' },
    });
  });

  it('does not flag anything for a native target', async () => {
    const pack = parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack');
    const { client } = createFakeClient();
    const result = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'fabric' },
      client,
    );
    expect(result.mods.some((m) => m.fallback)).toBe(false);
    expect(result.dependencies.added.some((d) => d.fallback)).toBe(false);
  });

  it('shows the warning in every report', async () => {
    const { pack, result } = await analyzeForQuilt();
    expect(renderTable(result)).toContain('[fabric version: fallback compatibility, to test]');
    expect(renderMarkdown(result)).toContain(
      '15.0.0 (fabric version: fallback compatibility, to test)',
    );
    const plan = buildMigrationPlan(pack, result, { loaderVersion: '0.27.1' });
    expect(plan.mods.find((m) => m.title === 'Sodium')?.fallbackLoader).toBe('fabric');
    expect(renderMigrationReport(plan, result, 'out.mrpack')).toContain(
      '| Sodium | 0.6.0 | updated, fabric version: fallback compatibility, to test |',
    );
    expect(renderPlanText(plan, result, 'Dry run', 0)).toContain(
      '↑ Sodium 0.5.8 → 0.6.0 [fabric version: fallback compatibility, to test]',
    );
  });
});
