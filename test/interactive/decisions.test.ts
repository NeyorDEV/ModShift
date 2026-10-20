import { beforeAll, describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { AnalysisResult, ModAnalysis } from '../../src/core/types.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import {
  applyDecision,
  decisionKey,
  defaultOption,
  needsReview,
  optionsFor,
  savedDecision,
  summarizeDecisions,
} from '../../src/interactive/decisions.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

let result: AnalysisResult;
const byFile = (name: string): ModAnalysis => {
  const mod = result.mods.find((m) => m.fileName === name);
  if (!mod) throw new Error(name);
  return mod;
};

beforeAll(async () => {
  const { client } = createFakeClient();
  result = await analyzePack(
    parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack'),
    { minecraftVersion: '1.21.1', loader: 'fabric' },
    client,
  );
});

describe('options', () => {
  it('offers to accept an update, then exclude or ignore', () => {
    const sodium = byFile('sodium-fabric-0.5.8.jar');
    expect(optionsFor(sodium).map((o) => o.label)).toEqual([
      'Accept the update to 0.6.0',
      'Exclude it from the migrated pack',
      'Ignore it',
    ]);
    expect(optionsFor(byFile('modmenu-7.2.2.jar'))[0]?.label).toBe(
      'Keep 7.2.2 (already compatible)',
    );
  });

  it('lists every alternative, marked as a suggestion', () => {
    const labels = optionsFor(byFile('old-minimap-1.0.jar')).map((o) => o.label);
    expect(labels).toEqual([
      "Use Xaero's Minimap instead (suggestion, to verify)",
      'Use Just Enough Items instead (suggestion, to verify)',
      'Use JourneyMap instead (suggestion, to verify)',
      'Exclude it from the migrated pack',
      'Ignore it',
    ]);
  });

  it('only offers exclude or ignore when nothing is available', () => {
    expect(optionsFor(byFile('mystery-mod.jar')).map((o) => o.value.action)).toEqual([
      'exclude',
      'ignore',
    ]);
  });

  it('flags what needs a review', () => {
    expect(result.mods.filter(needsReview).map((m) => m.fileName)).toEqual([
      'old-minimap-1.0.jar',
      'mystery-mod.jar',
      'local-mod.jar',
    ]);
  });
});

describe('defaults and saved decisions', () => {
  it('defaults to accept, else exclude (never an unchosen alternative)', () => {
    expect(defaultOption({}, byFile('sodium-fabric-0.5.8.jar'))).toEqual({ action: 'accept' });
    expect(defaultOption({}, byFile('old-minimap-1.0.jar'))).toEqual({ action: 'exclude' });
  });

  it('replays decisions found in the config', () => {
    const sodium = byFile('sodium-fabric-0.5.8.jar');
    expect(decisionKey(sodium)).toBe('sodium');
    expect(savedDecision({ ignore: ['sodium'] }, sodium)).toEqual({ action: 'ignore' });
    expect(defaultOption({ exclude: ['sodium'] }, sodium)).toEqual({ action: 'exclude' });
    expect(decisionKey(byFile('mystery-mod.jar'))).toBe('mystery-mod.jar');
  });
});

describe('applyDecision', () => {
  it('writes alternatives as mappings, and ignore/exclude as lists, replacing older choices', () => {
    const minimap = byFile('old-minimap-1.0.jar');
    const xaero = minimap.alternatives[0]?.project;
    if (!xaero) throw new Error('no alternative');
    let config = applyDecision({ ignore: ['old-minimap'] }, minimap, {
      action: 'alternative',
      project: xaero,
    });
    expect(config).toEqual({
      ignore: [],
      exclude: [],
      mappings: { 'old-minimap': 'xaeros-minimap' },
    });

    config = applyDecision(config, minimap, { action: 'exclude' });
    expect(config).toEqual({ ignore: [], exclude: ['old-minimap'], mappings: {} });

    config = applyDecision(config, byFile('mystery-mod.jar'), { action: 'ignore' });
    expect(config.ignore).toEqual(['mystery-mod.jar']);
  });

  it('accepting clears an earlier ignore/exclude but keeps an existing replacement', async () => {
    const sodium = byFile('sodium-fabric-0.5.8.jar');
    expect(applyDecision({ exclude: ['sodium'] }, sodium, { action: 'accept' }).exclude).toEqual(
      [],
    );

    const { client } = createFakeClient();
    const mapped = await analyzePack(
      parseMrpack(packFixture('mrpack-forge'), 'f.mrpack'),
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      client,
      { mappings: { rubidium: 'embeddium' } },
    );
    const rubidium = mapped.mods.find((m) => m.fileName === 'rubidium-0.7.1.jar');
    if (!rubidium) throw new Error('rubidium');
    expect(decisionKey(rubidium)).toBe('rubidium');
    expect(optionsFor(rubidium)[0]?.label).toBe('Keep the replacement Embeddium 1.0.11');
    const config = { mappings: { rubidium: 'embeddium' } };
    expect(defaultOption(config, rubidium)).toEqual({ action: 'accept' });
    expect(applyDecision(config, rubidium, { action: 'accept' }).mappings).toEqual({
      rubidium: 'embeddium',
    });
  });

  it('does not modify the original config', () => {
    const original = { ignore: ['a'] };
    applyDecision(original, byFile('mystery-mod.jar'), { action: 'ignore' });
    expect(original).toEqual({ ignore: ['a'] });
  });

  it('summarises decisions', () => {
    expect(
      summarizeDecisions([
        { action: 'accept' },
        { action: 'accept' },
        { action: 'ignore' },
        { action: 'exclude' },
      ]),
    ).toEqual({ accepted: 2, alternatives: 0, ignored: 1, excluded: 1 });
  });
});
