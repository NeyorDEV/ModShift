import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, validateConfig, writeConfig } from '../../src/config/config.js';
import { analyzePack } from '../../src/core/engine.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { buildMigrationPlan } from '../../src/migrate/plan.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

describe('exclude list', () => {
  it('is validated like ignore', () => {
    expect(validateConfig({ exclude: ['create'] }, 'c.json')).toEqual({ exclude: ['create'] });
    expect(() => validateConfig({ exclude: 'create' }, 'c.json')).toThrow(ConfigError);
  });

  it('removes analysed mods from the migrated pack, with their now useless dependencies', async () => {
    const pack = parseMrpack(packFixture('mrpack-forge'), 'f.mrpack');
    const { client } = createFakeClient();
    const analysis = await analyzePack(
      pack,
      { minecraftVersion: '1.21.1', loader: 'neoforge' },
      client,
    );
    const plan = buildMigrationPlan(pack, analysis, {
      loaderVersion: '21.1.77',
      exclude: ['create'],
    });

    expect(plan.mods.map((m) => m.title)).toEqual(['Just Enough Items']);
    expect(plan.excluded.find((m) => m.project?.slug === 'create')?.reason).toBe(
      'Excluded by modshift.config.json (rule "create").',
    );
    expect(plan.warnings).toContain('Flywheel: not added, only required by excluded mods');
    // Le rapport d'analyse, lui, garde le mod.
    expect(analysis.mods.some((m) => m.project?.slug === 'create')).toBe(true);
  });
});

describe('writeConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-write-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a stable, valid file that loadConfig reads back', async () => {
    const path = join(dir, 'modshift.config.json');
    const config = {
      mappings: { rubidium: 'embeddium' },
      exclude: ['create'],
      ignore: [],
      target: { minecraftVersion: '1.21.1', loader: 'neoforge' as const },
    };
    await writeConfig(path, config);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      $schema: './schemas/modshift.config.schema.json',
      target: { minecraftVersion: '1.21.1', loader: 'neoforge' },
      exclude: ['create'],
      mappings: { rubidium: 'embeddium' },
    });
    expect((await loadConfig(path)).config).toEqual({
      target: config.target,
      exclude: ['create'],
      mappings: config.mappings,
    });
  });

  it('refuses to write an invalid configuration', async () => {
    await expect(writeConfig(join(dir, 'c.json'), { mappings: { a: '' } })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});
