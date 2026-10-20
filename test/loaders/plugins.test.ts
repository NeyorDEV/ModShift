import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import { loadPack } from '../../src/input/index.js';
import { readJarMetadata } from '../../src/input/jar.js';
import { pluginSlug, readTopLevelYaml } from '../../src/input/plugin.js';
import { LOADER_DEFINITIONS, type LoaderId } from '../../src/loaders/registry.js';
import type { ModrinthProject, ModrinthVersion } from '../../src/modrinth/types.js';
import type { ModPack } from '../../src/types.js';
import { createIo, run } from '../helpers/cli.js';
import { type Catalog, createFakeClient } from '../helpers/fakeModrinth.js';
import { jarFixture } from '../helpers/fixtures.js';

describe('plugin metadata', () => {
  it('reads plugin.yml (Bukkit/Spigot/Paper) with inline and block lists', () => {
    expect(readJarMetadata(jarFixture('plugin-bukkit'), 'chestshop.jar').metadata).toEqual([
      {
        loader: 'bukkit',
        modId: 'chestshop',
        name: 'ChestShop',
        version: '3.12.2',
        dependencies: [
          { modId: 'vault', required: true },
          { modId: 'worldguard', required: false },
          { modId: 'lwc', required: false },
        ],
      },
    ]);
  });

  it('reads paper-plugin.yml, bungee.yml and velocity-plugin.json', () => {
    expect(readJarMetadata(jarFixture('plugin-paper'), 'd.jar').metadata[0]).toMatchObject({
      loader: 'paper',
      modId: 'dynmap',
      version: '3.7-beta-4',
    });
    expect(readJarMetadata(jarFixture('plugin-bungee'), 'b.jar').metadata[0]).toMatchObject({
      loader: 'bungeecord',
      modId: 'bungeetab',
    });
    expect(readJarMetadata(jarFixture('plugin-velocity'), 'v.jar').metadata[0]).toEqual({
      loader: 'velocity',
      modId: 'proxychat',
      name: 'ProxyChat',
      version: '1.4.0',
      dependencies: [
        { modId: 'luckperms', required: false },
        { modId: 'signedvelocity', required: true },
      ],
    });
  });

  it('only reads top-level YAML keys', () => {
    expect(readTopLevelYaml('name: "A B" # comment\nnested:\n  key: x\nlist: [a, "b"]\n')).toEqual({
      name: 'A B',
      nested: [],
      list: ['a', 'b'],
    });
    expect(pluginSlug(' Chest Shop+ ')).toBe('chest-shop');
  });
});

describe('server folders', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-plugins-'));
    await mkdir(join(dir, 'plugins'));
    await writeFile(join(dir, 'plugins', 'ChestShop.jar'), jarFixture('plugin-bukkit'));
    await writeFile(join(dir, 'plugins', 'Dynmap.jar'), jarFixture('plugin-paper'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the plugins/ folder of a server', async () => {
    const pack = await loadPack(dir);
    expect(pack.mods.map((m) => m.path)).toEqual(['plugins/ChestShop.jar', 'plugins/Dynmap.jar']);
  });

  it('Paper target: native Paper plugin, Spigot plugin through a documented fallback', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(
      await loadPack(dir),
      { minecraftVersion: '1.21.1', loader: 'paper' },
      client,
    );
    const chest = result.mods.find((m) => m.fileName === 'ChestShop.jar');
    expect(chest).toMatchObject({
      status: 'update-found',
      identification: 'mod-id',
      targetVersion: { id: 'v2chest' },
      fallback: { loader: 'spigot', note: 'fallback compatibility, to test' },
    });
    expect(chest?.reason).toContain('a Spigot version running on Paper (PaperMC docs');
    expect(result.mods.find((m) => m.fileName === 'Dynmap.jar')).toMatchObject({
      status: 'update-found',
      targetVersion: { id: 'v2dynmap' },
      fallback: undefined,
    });
  });

  it('Spigot target: no undocumented fallback, so the Paper plugin has no version', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(
      await loadPack(dir),
      { minecraftVersion: '1.21.1', loader: 'spigot' },
      client,
      { maxAlternatives: 0 },
    );
    expect(result.mods.find((m) => m.fileName === 'Dynmap.jar')?.status).toBe('not-found');
    expect(result.mods.find((m) => m.fileName === 'ChestShop.jar')?.fallback).toBeUndefined();
  });

  it('Purpur accepts Paper and Spigot; Waterfall accepts BungeeCord; Velocity stays strict', async () => {
    const { client } = createFakeClient();
    const purpur = await analyzePack(
      await loadPack(dir),
      { minecraftVersion: '1.21.1', loader: 'purpur' },
      client,
    );
    expect(purpur.mods.map((m) => m.fallback?.loader)).toEqual(['spigot', undefined]);

    const proxyDir = join(dir, 'proxy');
    await mkdir(join(proxyDir, 'plugins'), { recursive: true });
    await writeFile(join(proxyDir, 'plugins', 'BungeeTab.jar'), jarFixture('plugin-bungee'));
    await writeFile(join(proxyDir, 'plugins', 'ProxyChat.jar'), jarFixture('plugin-velocity'));
    const waterfall = await analyzePack(
      await loadPack(proxyDir),
      { minecraftVersion: '1.21.1', loader: 'waterfall' },
      client,
      { maxAlternatives: 0 },
    );
    expect(waterfall.mods.map((m) => [m.fileName, m.status, m.fallback?.loader])).toEqual([
      ['BungeeTab.jar', 'update-found', 'bungeecord'],
      ['ProxyChat.jar', 'not-found', undefined],
    ]);
    const velocity = await analyzePack(
      await loadPack(proxyDir),
      { minecraftVersion: '1.21.1', loader: 'velocity' },
      client,
      { maxAlternatives: 0 },
    );
    expect(velocity.mods.map((m) => m.status)).toEqual(['not-found', 'update-found']);
  });

  it('migrate refuses plugin platforms with a clear message', async () => {
    const io = createIo();
    await run(
      io,
      'migrate',
      dir,
      '--mc',
      '1.21.1',
      '--loader',
      'paper',
      '--out',
      join(dir, 'x.mrpack'),
      '--no-cache',
    );
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain('Paper cannot be the target of a .mrpack');
    expect(io.err).toContain('use "modshift analyze"');
    expect(io.requests).toBe(0);
  });
});

describe('every registered loader', () => {
  // Catalogue synthétique : un projet avec une version native pour chaque loader du registre.
  const catalog: Catalog = {
    projects: [
      {
        id: 'MULTI001',
        slug: 'multi',
        title: 'Multi',
        description: '',
        categories: [],
        project_type: 'mod',
        loaders: LOADER_DEFINITIONS.map((d) => d.id),
        game_versions: ['1.21.1'],
      } satisfies ModrinthProject,
    ],
    versions: [
      {
        id: 'v0multi',
        project_id: 'MULTI001',
        name: 'old',
        version_number: '1.0',
        game_versions: ['1.20.1'],
        loaders: ['forge'],
        version_type: 'release',
        date_published: '2023-01-01T00:00:00Z',
        dependencies: [],
        files: [
          {
            hashes: { sha1: 'e'.repeat(40), sha512: 'e'.repeat(128) },
            url: 'https://cdn.modrinth.com/x.jar',
            filename: 'x.jar',
            primary: true,
            size: 1,
          },
        ],
      },
      ...LOADER_DEFINITIONS.map((d, i): ModrinthVersion => ({
        id: `v-${d.id}`,
        project_id: 'MULTI001',
        name: d.id,
        version_number: `2.${i}`,
        game_versions: ['1.21.1'],
        loaders: [d.id],
        version_type: 'release',
        date_published: '2024-01-01T00:00:00Z',
        dependencies: [],
        files: [],
      })),
    ],
  };
  const pack: ModPack = {
    source: 'folder',
    mods: [
      {
        fileName: 'x.jar',
        path: 'mods/x.jar',
        origin: 'folder',
        hashes: { sha1: 'e'.repeat(40) },
        metadata: [],
      },
    ],
    otherFiles: [],
    warnings: [],
  };

  it.each(LOADER_DEFINITIONS.map((d) => d.id as LoaderId))(
    '%s: picks the native version',
    async (loader) => {
      const { client } = createFakeClient(catalog);
      const result = await analyzePack(pack, { minecraftVersion: '1.21.1', loader }, client);
      expect(result.mods[0]).toMatchObject({
        status: 'update-found',
        targetVersion: { id: `v-${loader}` },
      });
      expect(result.mods[0]?.fallback).toBeUndefined();
    },
  );
});
