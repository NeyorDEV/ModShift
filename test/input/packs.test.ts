import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectArchiveFormat,
  InputError,
  loadPack,
  parseCurseForgeZip,
  parseMrpack,
} from '../../src/input/index.js';
import { inferLoader } from '../../src/input/folder.js';
import { isSafeRelativePath } from '../../src/input/mrpack.js';
import { jarFixture, packFixture } from '../helpers/fixtures.js';

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'modshift-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('parseMrpack', () => {
  const pack = parseMrpack(packFixture('mrpack-fabric'), 'fixture.mrpack');

  it('reads pack info and target dependencies', () => {
    expect(pack).toMatchObject({
      source: 'mrpack',
      name: 'Fixture Fabric Pack',
      version: '1.0.0',
      minecraftVersion: '1.20.1',
      loader: 'fabric',
      loaderVersion: '0.15.11',
    });
  });

  it('lists index mods with their hashes and override jars with computed hashes', () => {
    expect(pack.mods.map((m) => [m.path, m.origin])).toEqual([
      ['mods/sodium-fabric-0.5.8.jar', 'index'],
      ['mods/fabric-api-0.92.0.jar', 'index'],
      ['mods/modmenu-7.2.2.jar', 'index'],
      ['mods/old-minimap-1.0.jar', 'index'],
      ['mods/mystery-mod.jar', 'index'],
      ['mods/local-mod.jar', 'override'],
    ]);
    expect(pack.mods[0]?.hashes.sha1).toBe('1'.repeat(40));
    expect(pack.mods[0]?.env).toEqual({ client: 'required', server: 'unsupported' });
    const local = pack.mods[5];
    expect(local?.hashes.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(local?.metadata[0]).toMatchObject({ loader: 'fabric', modId: 'localmod' });
  });

  it('keeps non-mod files and rejects unsafe paths', () => {
    expect(pack.otherFiles).toEqual([
      'overrides/config/sodium-options.json',
      'resourcepacks/faithful.zip',
    ]);
    expect(pack.warnings).toEqual(['fixture.mrpack: ignoring unsafe path "../escape.jar"']);
  });

  it('fails on archives without an index', () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi') });
    expect(() => parseMrpack(zip, 'x.mrpack')).toThrow(InputError);
  });
});

describe('isSafeRelativePath', () => {
  it.each([
    ['mods/a.jar', true],
    ['config/sub/a.toml', true],
    ['../a.jar', false],
    ['mods/../../a.jar', false],
    ['/etc/passwd', false],
    ['C:/Windows/a.jar', false],
    ['', false],
  ])('%s → %s', (path, expected) => {
    expect(isSafeRelativePath(path)).toBe(expected);
  });
});

describe('parseCurseForgeZip', () => {
  const pack = parseCurseForgeZip(packFixture('curseforge-forge'), 'fixture.zip');

  it('reads minecraft version and primary loader', () => {
    expect(pack).toMatchObject({
      source: 'curseforge',
      name: 'Fixture Forge Pack',
      version: '2.3.0',
      minecraftVersion: '1.20.1',
      loader: 'forge',
      loaderVersion: '47.2.0',
    });
  });

  it('keeps CurseForge references and reads override jars', () => {
    expect(pack.mods.map((m) => m.curseforge ?? m.metadata[0]?.modId)).toEqual([
      { projectId: 238222, fileId: 4712866, required: true },
      { projectId: 419699, fileId: 4712867, required: false },
      'localforge',
    ]);
    expect(pack.otherFiles).toEqual(['overrides/config/jei-client.toml']);
    expect(pack.warnings).toEqual([
      'fixture.zip: ignoring a manifest file entry without projectID/fileID',
    ]);
  });

  it('rejects a manifest that is not a modpack', () => {
    const zip = zipSync({ 'manifest.json': strToU8('{"manifestType":"other"}') });
    expect(() => parseCurseForgeZip(zip, 'x.zip')).toThrow(/not a CurseForge modpack/);
  });
});

describe('loadPack', () => {
  it('detects the archive format', () => {
    expect(detectArchiveFormat(packFixture('mrpack-fabric'), 'a')).toBe('mrpack');
    expect(detectArchiveFormat(packFixture('curseforge-forge'), 'b')).toBe('curseforge');
    expect(() => detectArchiveFormat(zipSync({ 'x.txt': strToU8('') }), 'c')).toThrow(
      /unknown archive format/,
    );
  });

  it('loads .mrpack and CurseForge zip files from disk', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'pack.mrpack'), packFixture('mrpack-fabric'));
    await writeFile(join(dir, 'cf.zip'), packFixture('curseforge-forge'));
    expect((await loadPack(join(dir, 'pack.mrpack'))).source).toBe('mrpack');
    expect((await loadPack(join(dir, 'cf.zip'))).source).toBe('curseforge');
  });

  it('loads a folder of jars (using its mods/ subfolder) and infers the loader', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'mods'));
    await writeFile(join(dir, 'mods', 'sodium.jar'), jarFixture('fabric-sodium'));
    await writeFile(join(dir, 'mods', 'multi.jar'), jarFixture('multi-loader'));
    await writeFile(join(dir, 'mods', 'lib.jar'), jarFixture('no-metadata'));
    await writeFile(join(dir, 'mods', 'notes.txt'), 'ignored');

    const pack = await loadPack(dir);
    expect(pack.source).toBe('folder');
    expect(pack.mods.map((m) => m.path)).toEqual([
      'mods/lib.jar',
      'mods/multi.jar',
      'mods/sodium.jar',
    ]);
    expect(pack.loader).toBe('fabric');
    expect(pack.minecraftVersion).toBeUndefined();
  });

  it('fails on a missing path', async () => {
    await expect(loadPack('/definitely/not/here.mrpack')).rejects.toThrow(InputError);
  });
});

describe('inferLoader', () => {
  const mod = (...loaders: ('fabric' | 'forge')[]) => ({
    fileName: 'x.jar',
    path: 'mods/x.jar',
    origin: 'folder' as const,
    hashes: {},
    metadata: loaders.map((loader) => ({ loader, modId: 'x', dependencies: [] })),
  });

  it('requires a strict majority', () => {
    expect(inferLoader([mod('forge'), mod('forge'), mod('fabric')])).toBe('forge');
    expect(inferLoader([mod('forge'), mod('fabric')])).toBeUndefined();
    expect(inferLoader([mod()])).toBeUndefined();
  });
});
