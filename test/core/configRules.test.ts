import { describe, expect, it } from 'vitest';
import { analyzePack } from '../../src/core/engine.js';
import { parseMrpack } from '../../src/input/mrpack.js';
import { createFakeClient } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';

const fabricPack = () => parseMrpack(packFixture('mrpack-fabric'), 'p.mrpack');
const forgePack = () => parseMrpack(packFixture('mrpack-forge'), 'f.mrpack');
const fabric = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;
const neoforge = { minecraftVersion: '1.21.1', loader: 'neoforge' } as const;

describe('ignore rules', () => {
  it('skips mods matched by file name, wildcard, slug or project id', async () => {
    const { client, calls } = createFakeClient();
    const result = await analyzePack(fabricPack(), fabric, client, {
      ignore: ['mystery-*.jar', 'old-minimap', 'mOgUt4GM'],
    });
    expect(result.ignored).toEqual([
      expect.objectContaining({ fileName: 'modmenu-7.2.2.jar', rule: 'mOgUt4GM' }),
      expect.objectContaining({ fileName: 'old-minimap-1.0.jar', rule: 'old-minimap' }),
      {
        fileName: 'mystery-mod.jar',
        path: 'mods/mystery-mod.jar',
        project: undefined,
        rule: 'mystery-*.jar',
      },
    ]);
    expect(result.mods.map((m) => m.fileName)).toEqual([
      'sodium-fabric-0.5.8.jar',
      'fabric-api-0.92.0.jar',
      'local-mod.jar',
    ]);
    // Aucune version ni recherche d'alternatives pour un mod ignoré.
    expect(calls.some((c) => c.url.pathname.includes('/project/OLDMAP01/version'))).toBe(false);
    expect(calls.some((c) => c.url.pathname.endsWith('/search'))).toBe(false);
    // Text Lib n'est plus requis : Mod Menu est ignoré.
    expect(result.dependencies.missing).toEqual([]);
  });
});

describe('manual mappings', () => {
  it('replaces a mod by the configured Modrinth project', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(forgePack(), neoforge, client, {
      mappings: { rubidium: 'embeddium' },
    });
    const mod = result.mods.find((m) => m.fileName === 'rubidium-0.7.1.jar');
    expect(mod).toMatchObject({
      status: 'update-found',
      project: { id: 'EMBEDIUM', title: 'Embeddium' },
      currentVersion: { id: 'v1rubidium' },
      targetVersion: { id: 'v1embed' },
      mapping: { rule: 'rubidium', original: { id: 'RUBIDIUM' } },
      reason: 'Replaced by Embeddium (mapping "rubidium" in modshift.config.json).',
      alternatives: [],
    });
  });

  it('maps unidentified files by name, and reports targets without a version', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(fabricPack(), fabric, client, {
      mappings: { 'mystery-mod.jar': 'xaeros-minimap', 'local-mod.jar': 'rubidium' },
    });
    expect(result.mods.find((m) => m.fileName === 'mystery-mod.jar')).toMatchObject({
      status: 'update-found',
      identification: 'none',
      targetVersion: { id: 'v1xaero' },
    });
    expect(result.mods.find((m) => m.fileName === 'local-mod.jar')).toMatchObject({
      status: 'not-found',
      reason:
        'Mapped to Rubidium in modshift.config.json, but it has no version for Minecraft 1.21.1 / fabric.',
    });
  });

  it('warns about mappings to unknown projects and analyses the mod normally', async () => {
    const { client } = createFakeClient();
    const result = await analyzePack(fabricPack(), fabric, client, {
      mappings: { sodium: 'does-not-exist' },
    });
    expect(result.warnings).toContain(
      'Mapping "sodium" → "does-not-exist" ignored: no Modrinth project "does-not-exist".',
    );
    expect(result.mods[0]?.targetVersion?.id).toBe('v2sodium');
  });
});
