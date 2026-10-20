import { describe, expect, it } from 'vitest';
import { sharesSignificantWord } from '../../src/core/alternatives.js';
import { acceptedLoaders, pickBestVersion, versionSupportsTarget } from '../../src/core/loaders.js';
import type { ModrinthVersion } from '../../src/modrinth/types.js';

const v = (id: string, extra: Partial<ModrinthVersion> = {}): ModrinthVersion => ({
  id,
  project_id: 'P',
  name: id,
  version_number: id,
  game_versions: ['1.21.1'],
  loaders: ['fabric'],
  version_type: 'release',
  date_published: '2024-01-01T00:00:00Z',
  dependencies: [],
  files: [],
  ...extra,
});

const fabric = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;

describe('loaders', () => {
  it('lets Quilt load Fabric mods, keeps other loaders strict', () => {
    expect(acceptedLoaders('quilt')).toEqual(['quilt', 'fabric']);
    expect(acceptedLoaders('neoforge')).toEqual(['neoforge']);
    expect(acceptedLoaders('forge')).toEqual(['forge']);
  });

  it('checks Minecraft version and loader', () => {
    expect(versionSupportsTarget(v('a'), fabric)).toBe(true);
    expect(versionSupportsTarget(v('a', { game_versions: ['1.21'] }), fabric)).toBe(false);
    expect(versionSupportsTarget(v('a', { loaders: ['forge'] }), fabric)).toBe(false);
  });

  it('picks native loader, then release, then most recent', () => {
    const versions = [
      v('old', { date_published: '2024-01-01T00:00:00Z' }),
      v('new', { date_published: '2024-05-01T00:00:00Z' }),
      v('beta', { version_type: 'beta', date_published: '2024-09-01T00:00:00Z' }),
      v('draft', { status: 'draft', date_published: '2025-01-01T00:00:00Z' }),
      v('wrong', { game_versions: ['1.20.1'] }),
    ];
    expect(pickBestVersion(versions, fabric)?.id).toBe('new');
    expect(pickBestVersion([v('beta', { version_type: 'beta' })], fabric)?.id).toBe('beta');
    expect(pickBestVersion([v('wrong', { loaders: ['forge'] })], fabric)).toBeUndefined();

    const quilt = { minecraftVersion: '1.21.1', loader: 'quilt' } as const;
    const mixed = [
      v('fab', { date_published: '2024-09-01T00:00:00Z' }),
      v('qui', { loaders: ['quilt'] }),
    ];
    expect(pickBestVersion(mixed, quilt)?.id).toBe('qui');
  });

  it('matches significant title words only', () => {
    expect(sharesSignificantWord("Xaero's Minimap", 'Old Minimap')).toBe(true);
    expect(sharesSignificantWord('Forgified Fabric API', 'Fabric API')).toBe(true);
    expect(sharesSignificantWord('Better Mod', 'Some Mod')).toBe(false);
  });
});
