import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  filterMods,
  modrinthUrl,
  notesFor,
  sortMods,
  versionLabel,
} from '../../src/ui/public/logic.js';

const mod = (fileName: string, status: string, extra: Record<string, unknown> = {}) => ({
  fileName,
  status,
  alternatives: [] as { project: { title: string } }[],
  ...extra,
});

const mods = [
  mod('b.jar', 'not-found', { reason: 'Unknown file hash on Modrinth.' }),
  mod('a.jar', 'update-found', {
    project: { title: 'Sodium', slug: 'sodium' },
    currentVersion: { versionNumber: '0.5.8', versionType: 'release' },
    targetVersion: { versionNumber: '0.6.0', versionType: 'beta' },
  }),
  mod('c.jar', 'compatible', { project: { title: 'Mod Menu', slug: 'modmenu' } }),
  mod('d.jar', 'alternative-suggested', {
    project: { title: 'Old Minimap', slug: 'old-minimap' },
    alternatives: [{ project: { title: "Xaero's Minimap" } }],
  }),
];

describe('UI logic', () => {
  it('sorts by status order, name or version, both directions', () => {
    expect(sortMods(mods, 'status').map((m) => m.fileName)).toEqual([
      'c.jar',
      'a.jar',
      'd.jar',
      'b.jar',
    ]);
    expect(sortMods(mods, 'status', 'desc').map((m) => m.fileName)).toEqual([
      'b.jar',
      'd.jar',
      'a.jar',
      'c.jar',
    ]);
    expect(sortMods(mods, 'name').map((m) => m.fileName)).toEqual([
      'b.jar',
      'c.jar',
      'd.jar',
      'a.jar',
    ]);
    // « — » (aucune version) est trié après les numéros de version.
    expect(sortMods(mods, 'target').map((m) => m.fileName)[0]).toBe('a.jar');
    // Copie : la liste d'origine n'est pas modifiée.
    expect(mods[0]?.fileName).toBe('b.jar');
  });

  it('filters by status and free text (name, file, slug, reason)', () => {
    expect(filterMods(mods, { status: 'compatible' }).map((m) => m.fileName)).toEqual(['c.jar']);
    expect(filterMods(mods, { text: 'SODIUM' }).map((m) => m.fileName)).toEqual(['a.jar']);
    expect(filterMods(mods, { text: 'hash' }).map((m) => m.fileName)).toEqual(['b.jar']);
    expect(filterMods(mods, { status: 'compatible', text: 'sodium' })).toEqual([]);
    expect(filterMods(mods)).toHaveLength(4);
  });

  it('formats labels and counts', () => {
    expect(versionLabel(undefined)).toBe('—');
    expect(versionLabel({ versionNumber: '1.0', versionType: 'alpha' })).toBe('1.0 (alpha)');
    expect(notesFor(mods[3] as never)).toBe("Suggestions (to verify): Xaero's Minimap");
    expect(countByStatus(mods)).toEqual({
      compatible: 1,
      'update-found': 1,
      'alternative-suggested': 1,
      'not-found': 1,
    });
  });

  it('only builds Modrinth links from safe slugs', () => {
    expect(modrinthUrl({ slug: 'sodium' })).toBe('https://modrinth.com/project/sodium');
    expect(modrinthUrl({ slug: 'javascript:alert(1)' })).toBe('https://modrinth.com/');
    expect(modrinthUrl({ slug: '../x' })).toBe('https://modrinth.com/');
  });
});
