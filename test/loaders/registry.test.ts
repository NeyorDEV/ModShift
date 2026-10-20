import { describe, expect, it } from 'vitest';
import {
  acceptedLoaders,
  fallbackFor,
  getLoader,
  isLoaderId,
  LOADER_DEFINITIONS,
  LOADER_IDS,
  MRPACK_KEY_TO_LOADER,
  supportsMrpack,
} from '../../src/loaders/registry.js';

describe('loader registry', () => {
  it('has unique ids and only fallbacks to registered loaders, each with a source', () => {
    expect(new Set(LOADER_IDS).size).toBe(LOADER_IDS.length);
    for (const definition of LOADER_DEFINITIONS) {
      for (const fallback of definition.fallbacks) {
        expect(isLoaderId(fallback.loader), `${definition.id} → ${fallback.loader}`).toBe(true);
        expect(fallback.source.length).toBeGreaterThan(10);
      }
    }
  });

  it('knows mod loaders, server plugins and proxies', () => {
    expect(getLoader('neoforge').kind).toBe('mod-loader');
    expect(getLoader('paper')).toMatchObject({ kind: 'server-plugin', folder: 'plugins' });
    expect(getLoader('velocity').kind).toBe('proxy-plugin');
    expect(isLoaderId('rift')).toBe(true);
    expect(isLoaderId('not-a-loader')).toBe(false);
    expect(() => getLoader('nope' as never)).toThrow(/Unknown loader/);
  });

  it('lists the target first, then its documented fallbacks', () => {
    expect(acceptedLoaders('quilt')).toEqual(['quilt', 'fabric']);
    expect(acceptedLoaders('paper')).toEqual(['paper', 'spigot', 'bukkit']);
    expect(acceptedLoaders('purpur')).toEqual(['purpur', 'paper', 'spigot', 'bukkit']);
    expect(acceptedLoaders('waterfall')).toEqual(['waterfall', 'bungeecord']);
    // Aucune règle non documentée : Forge/NeoForge, Spigot/Bukkit et Velocity restent stricts.
    expect(acceptedLoaders('neoforge')).toEqual(['neoforge']);
    expect(acceptedLoaders('forge')).toEqual(['forge']);
    expect(acceptedLoaders('spigot')).toEqual(['spigot']);
    expect(acceptedLoaders('velocity')).toEqual(['velocity']);
  });

  it('tells when a version only runs through a fallback', () => {
    expect(fallbackFor('quilt', ['fabric'])).toMatchObject({ loader: 'fabric' });
    expect(fallbackFor('quilt', ['fabric', 'quilt'])).toBeUndefined();
    expect(fallbackFor('purpur', ['bukkit'])?.source).toContain('Purpur');
    expect(fallbackFor('fabric', ['quilt'])).toBeUndefined();
  });

  it('maps .mrpack dependency keys only for the four supported loaders', () => {
    expect(MRPACK_KEY_TO_LOADER).toEqual({
      forge: 'forge',
      neoforge: 'neoforge',
      'fabric-loader': 'fabric',
      'quilt-loader': 'quilt',
    });
    expect(supportsMrpack('fabric')).toBe(true);
    expect(supportsMrpack('paper')).toBe(false);
  });
});
