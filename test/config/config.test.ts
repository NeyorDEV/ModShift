import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, matchesModRef, validateConfig } from '../../src/config/config.js';

const sample = {
  $schema: './schemas/modshift.config.schema.json',
  target: { minecraftVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.77' },
  ignore: ['optifine*.jar', 'old-minimap'],
  mappings: { rubidium: 'embeddium' },
};

describe('validateConfig', () => {
  it('accepts a complete configuration', () => {
    expect(validateConfig(sample, 'c.json')).toEqual({
      target: sample.target,
      ignore: sample.ignore,
      mappings: sample.mappings,
    });
    expect(validateConfig({}, 'c.json')).toEqual({});
  });

  it.each([
    [[], 'the configuration must be a JSON object'],
    [{ ignores: [] }, 'unknown key "ignores"'],
    [{ target: 'x' }, '"target" must be an object'],
    [{ target: { mc: '1' } }, 'unknown key "target.mc"'],
    [{ target: { loader: 'not-a-loader' } }, '"target.loader" must be one of'],
    [{ target: { side: 'dedicated' } }, '"target.side" must be one of: client, server, both'],
    [{ target: { minecraftVersion: ' ' } }, '"target.minecraftVersion" must be a non-empty string'],
    [{ ignore: ['ok', 3] }, '"ignore" must be an array of non-empty strings'],
    [{ mappings: [] }, '"mappings" must be an object'],
    [{ mappings: { a: '' } }, '"mappings.a" must map to a non-empty Modrinth slug or id'],
  ])('rejects %j', (raw, message) => {
    expect(() => validateConfig(raw, 'c.json')).toThrow(ConfigError);
    expect(() => validateConfig(raw, 'c.json')).toThrow(message);
  });

  it('matches the published JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../schemas/modshift.config.schema.json', import.meta.url)),
        'utf8',
      ),
    ) as object;
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(sample)).toBe(true);
    expect(validate({ ignores: [] })).toBe(false);
  });
});

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds modshift.config.json in the working directory, or returns an empty config', async () => {
    expect(await loadConfig(undefined, dir)).toEqual({ config: {} });
    await writeFile(join(dir, 'modshift.config.json'), JSON.stringify(sample));
    expect(await loadConfig(undefined, dir)).toMatchObject({
      path: join(dir, 'modshift.config.json'),
      config: { mappings: { rubidium: 'embeddium' } },
    });
  });

  it('reads an explicit path and reports missing or invalid files', async () => {
    await writeFile(join(dir, 'other.json'), '{"ignore": ["a.jar"]}');
    expect((await loadConfig('other.json', dir)).config).toEqual({ ignore: ['a.jar'] });
    await expect(loadConfig('missing.json', dir)).rejects.toThrow(/missing\.json: file not found/);
    await writeFile(join(dir, 'bad.json'), '{oops');
    await expect(loadConfig('bad.json', dir)).rejects.toThrow(/bad\.json: invalid JSON/);
  });
});

describe('matchesModRef', () => {
  const mod = {
    fileName: 'OptiFine_1.20.1_HD_U_I6.jar',
    slug: 'optifine-x',
    projectId: 'ABCD1234',
  };
  it.each([
    ['optifine*.jar', true],
    ['*.jar', true],
    ['OptiFine_1.20.1_HD_U_I6.jar', true],
    ['optifine_1.20.1_hd_u_i6.jar', true],
    ['optifine-x', true],
    ['ABCD1234', true],
    ['abcd1234', false],
    ['optifine', false],
    ['opti(fine*', false],
  ])('%s → %s', (pattern, expected) => {
    expect(matchesModRef(pattern, mod)).toBe(expected);
  });
});
