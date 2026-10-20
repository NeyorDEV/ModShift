import { describe, expect, it } from 'vitest';
import { computeHashes } from '../../src/input/hash.js';
import { modEntryFromJar, readJarMetadata } from '../../src/input/jar.js';
import { jarFixture } from '../helpers/fixtures.js';

describe('readJarMetadata', () => {
  it('reads fabric.mod.json, tolerating raw control characters and skipping platform deps', () => {
    const { metadata, warnings } = readJarMetadata(jarFixture('fabric-sodium'), 'sodium.jar');
    expect(warnings).toEqual([]);
    expect(metadata).toEqual([
      {
        loader: 'fabric',
        modId: 'sodium',
        name: 'Sodium',
        version: '0.5.8+mc1.20.1',
        dependencies: [
          { modId: 'fabric-api', required: true, versionRange: '*' },
          { modId: 'indium', required: false, versionRange: '>=1.0.0' },
        ],
      },
    ]);
  });

  it('reads quilt.mod.json', () => {
    const { metadata } = readJarMetadata(jarFixture('quilt-mod'), 'quilt.jar');
    expect(metadata).toEqual([
      {
        loader: 'quilt',
        modId: 'example_quilt',
        name: 'Example Quilt Mod',
        version: '2.1.0',
        dependencies: [
          { modId: 'qsl', required: true, versionRange: '>=6.0.0' },
          { modId: 'modmenu', required: false, versionRange: undefined },
        ],
      },
    ]);
  });

  it('reads Forge mods.toml and resolves ${file.jarVersion} from MANIFEST.MF', () => {
    const { metadata } = readJarMetadata(jarFixture('forge-jei'), 'jei.jar');
    expect(metadata).toEqual([
      {
        loader: 'forge',
        modId: 'jei',
        name: 'Just Enough Items',
        version: '15.2.0.27',
        dependencies: [
          { modId: 'architectury', required: true, versionRange: '[9.0,)' },
          { modId: 'jade', required: false, versionRange: '*' },
        ],
      },
    ]);
  });

  it('reads neoforge.mods.toml and ignores incompatible entries', () => {
    const { metadata } = readJarMetadata(jarFixture('neoforge-mod'), 'example.jar');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      loader: 'neoforge',
      modId: 'examplemod',
      version: '1.4.2',
    });
    expect(metadata[0]?.dependencies).toEqual([
      { modId: 'curios', required: true, versionRange: '[9.0,)' },
      { modId: 'jei', required: false, versionRange: undefined },
    ]);
  });

  it('detects early NeoForge mods that still use mods.toml', () => {
    const { metadata } = readJarMetadata(jarFixture('neoforge-legacy'), 'legacy.jar');
    expect(metadata[0]).toMatchObject({ loader: 'neoforge', modId: 'legacyneo' });
  });

  it('returns every loader of a multi-loader jar', () => {
    const { metadata } = readJarMetadata(jarFixture('multi-loader'), 'multi.jar');
    expect(metadata.map((m) => m.loader).sort()).toEqual(['fabric', 'neoforge']);
  });

  it('returns no metadata for a jar without mod descriptors', () => {
    expect(readJarMetadata(jarFixture('no-metadata'), 'lib.jar')).toEqual({
      metadata: [],
      warnings: [],
    });
  });
});

describe('modEntryFromJar', () => {
  it('hashes the jar and reports invalid archives as warnings', () => {
    const data = jarFixture('fabric-sodium');
    const { entry } = modEntryFromJar(data, 'mods/sodium.jar', 'folder');
    expect(entry.hashes).toEqual(computeHashes(data));
    expect(entry.hashes.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.hashes.sha512).toMatch(/^[0-9a-f]{128}$/);
    expect(entry.fileName).toBe('sodium.jar');

    const broken = modEntryFromJar(new TextEncoder().encode('not a zip'), 'mods/bad.jar', 'folder');
    expect(broken.entry.metadata).toEqual([]);
    expect(broken.warnings[0]).toContain('not a valid zip');
  });
});
