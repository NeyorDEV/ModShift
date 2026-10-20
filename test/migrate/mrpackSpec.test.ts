import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  isAllowedDownloadUrl,
  isSpecSafePath,
  type MrpackIndex,
  validateMrpackArchive,
  validateMrpackIndex,
} from '../../src/migrate/mrpackSpec.js';

const validIndex = (): MrpackIndex => ({
  formatVersion: 1,
  game: 'minecraft',
  versionId: '1.0.0',
  name: 'Pack',
  files: [
    {
      path: 'mods/a.jar',
      hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
      env: { client: 'required', server: 'optional' },
      downloads: ['https://cdn.modrinth.com/data/AAAA/versions/BBBB/a.jar'],
      fileSize: 10,
    },
  ],
  dependencies: { minecraft: '1.21.1', neoforge: '21.1.77' },
});

describe('isSpecSafePath', () => {
  it.each([
    ['mods/a.jar', true],
    ['config/sub/file.toml', true],
    ['', false],
    ['/abs.jar', false],
    ['mods\\a.jar', false],
    ['C:/a.jar', false],
    ['mods/../a.jar', false],
    ['mods//a.jar', false],
    ['mods/CON', false],
    ['mods/nul.txt', false],
    ['mods/console.jar', true],
  ])('%j → %s', (path, expected) => {
    expect(isSpecSafePath(path)).toBe(expected);
  });
});

describe('isAllowedDownloadUrl', () => {
  it.each([
    ['https://cdn.modrinth.com/data/x/a.jar', true],
    ['https://github.com/o/r/releases/download/v1/a.jar', true],
    ['https://raw.githubusercontent.com/o/r/main/a.jar', true],
    ['https://example.com/a.jar', false],
    ['https://cdn.modrinth.com/data/x/a b.jar', false],
    ['ftp://cdn.modrinth.com/a.jar', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAllowedDownloadUrl(url)).toBe(expected);
  });
});

describe('validateMrpackIndex', () => {
  it('accepts a valid index', () => {
    expect(validateMrpackIndex(validIndex())).toEqual([]);
  });

  it('reports every violation', () => {
    const index = {
      formatVersion: 2,
      game: 'other',
      versionId: '',
      name: 'x'.repeat(513),
      summary: 'y'.repeat(2049),
      files: [
        {
          path: '../a.jar',
          hashes: { sha1: 'zz' },
          downloads: [],
          fileSize: -1,
          env: { client: 'yes' },
        },
        {
          path: 'mods/b.jar',
          hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
          downloads: ['https://cdn.modrinth.com/b.jar'],
          fileSize: 1,
        },
        {
          path: 'mods/b.jar',
          hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
          downloads: ['https://cdn.modrinth.com/b.jar'],
          fileSize: 1.5,
        },
      ],
      dependencies: { 'fabric-loader': '0.16.0', rift: '1' },
    };
    expect(validateMrpackIndex(index)).toEqual([
      'formatVersion must be 1',
      'game must be "minecraft"',
      'versionId must be a string of 1 to 512 characters',
      'name must be a string of 1 to 512 characters',
      'summary must be a string of at most 2048 characters',
      'unknown dependency "rift"',
      'dependencies.minecraft is required',
      'files[0].path is not a safe relative path',
      'files[0].hashes.sha1 must be a 40-character hex string',
      'files[0].hashes.sha512 must be a 128-character hex string',
      'files[0].env must define client and server as required/optional/unsupported/unknown',
      'files[0].downloads must list URLs on cdn.modrinth.com, github.com, raw.githubusercontent.com',
      'files[0].fileSize must be an unsigned 32-bit integer',
      'files[2].path "mods/b.jar" is duplicated',
      'files[2].fileSize must be an unsigned 32-bit integer',
    ]);
    expect(validateMrpackIndex([])).toEqual(['index must be a JSON object']);
  });
});

describe('validateMrpackArchive', () => {
  const index = (value: unknown) => strToU8(JSON.stringify(value));

  it('accepts index + overrides', () => {
    const archive = zipSync({
      'modrinth.index.json': index(validIndex()),
      'overrides/config/a.toml': strToU8('a=1'),
      'client-overrides/options.txt': strToU8('x'),
    });
    expect(validateMrpackArchive(archive)).toEqual([]);
  });

  it('rejects stray entries, missing index and empty packs', () => {
    expect(validateMrpackArchive(strToU8('nope'))).toEqual(['not a valid zip archive']);
    expect(validateMrpackArchive(zipSync({ 'a.txt': strToU8('') }))).toEqual([
      'missing modrinth.index.json',
    ]);
    expect(validateMrpackArchive(zipSync({ 'modrinth.index.json': strToU8('{') }))).toEqual([
      'modrinth.index.json is not valid JSON',
    ]);
    expect(
      validateMrpackArchive(
        zipSync({
          'modrinth.index.json': index({ ...validIndex(), files: [] }),
          'mods/a.jar': strToU8(''),
        }),
      ),
    ).toEqual(['unexpected archive entry "mods/a.jar"', 'pack has no files']);
  });
});
