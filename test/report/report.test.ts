import { beforeAll, describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import type { AnalysisResult } from '../../src/core/types.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { renderJson, renderMarkdown, renderReport, renderTable } from '../../src/report/index.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

let result: AnalysisResult;
beforeAll(async () => {
  const { client } = createFakeClient();
  result = await analyzePack(
    parseMrpack(packFixture('mrpack-fabric'), 'fixture.mrpack'),
    { minecraftVersion: '1.21.1', loader: 'fabric' },
    client,
  );
});

describe('JSON report', () => {
  it('is valid JSON with a schema version and every status', () => {
    const json = JSON.parse(renderJson(result)) as Record<string, unknown> & AnalysisResult;
    expect(json.schemaVersion).toBe(1);
    expect(json.generator).toMatch(/^modshift /);
    expect(json.target).toEqual({ minecraftVersion: '1.21.1', loader: 'fabric' });
    expect(new Set(json.mods.map((m) => m.status))).toEqual(
      new Set(['compatible', 'update-found', 'alternative-suggested', 'not-found']),
    );
    expect(
      json.mods.flatMap((m) => m.alternatives).every((a) => a.note === 'suggestion, to verify'),
    ).toBe(true);
  });
});

describe('Markdown report', () => {
  it('renders summary, mods, alternatives, dependencies and warnings', () => {
    const md = renderMarkdown(result);
    expect(md).toMatchSnapshot();
  });

  it('escapes pipes in table cells', () => {
    const tricky = structuredClone(result);
    const first = tricky.mods[0];
    if (first?.project) first.project.title = 'A | B';
    expect(renderMarkdown(tricky)).toContain('[A \\| B]');
  });
});

describe('table report', () => {
  it('renders an aligned plain-text table without colors by default', () => {
    const text = renderTable(result);
    expect(text).not.toContain('\u001b[');
    expect(text).toMatchSnapshot();
  });

  it('adds ANSI colors on demand', () => {
    expect(renderTable(result, { color: true })).toContain('\u001b[32m✔ compatible');
  });

  it('is selected by renderReport', () => {
    expect(renderReport(result, 'table')).toBe(renderTable(result));
    expect(renderReport(result, 'json')).toBe(renderJson(result));
    expect(renderReport(result, 'markdown')).toBe(renderMarkdown(result));
  });
});
