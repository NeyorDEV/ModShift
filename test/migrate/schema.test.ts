import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../schemas/modrinth.index.schema.json', import.meta.url)),
    'utf8',
  ),
) as object;
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

const file = {
  path: 'mods/a.jar',
  hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
  downloads: ['https://cdn.modrinth.com/data/x/a.jar'],
  fileSize: 1,
};
const index = {
  formatVersion: 1,
  game: 'minecraft',
  versionId: '1',
  name: 'p',
  files: [file],
  dependencies: { minecraft: '1.21.1', neoforge: '21.1.77' },
};

describe('modrinth.index.schema.json', () => {
  it('accepts a valid index', () => {
    expect(validate(index)).toBe(true);
  });

  it.each([
    ['wrong formatVersion', { ...index, formatVersion: 2 }],
    ['missing minecraft dependency', { ...index, dependencies: { neoforge: '1' } }],
    ['unknown loader key', { ...index, dependencies: { minecraft: '1', rift: '1' } }],
    ['missing sha512', { ...index, files: [{ ...file, hashes: { sha1: 'a'.repeat(40) } }] }],
    ['path escaping the instance', { ...index, files: [{ ...file, path: 'mods/../../a.jar' }] }],
    ['absolute path', { ...index, files: [{ ...file, path: '/a.jar' }] }],
    [
      'forbidden download domain',
      { ...index, files: [{ ...file, downloads: ['https://example.com/a.jar'] }] },
    ],
    ['fractional fileSize', { ...index, files: [{ ...file, fileSize: 1.5 }] }],
    [
      'invalid env value',
      { ...index, files: [{ ...file, env: { client: 'yes', server: 'required' } }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(validate(value)).toBe(false);
  });
});
