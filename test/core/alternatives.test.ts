import { describe, expect, it } from 'vitest';
import { scoreAlternative } from '../../src/core/alternatives.js';
import type { ModrinthSearchHit } from '../../src/modrinth/types.js';

function hit(overrides: Partial<ModrinthSearchHit>): ModrinthSearchHit {
  return {
    project_id: 'p',
    slug: 'p',
    title: 'Project',
    description: '',
    categories: [],
    project_type: 'mod',
    downloads: 0,
    versions: [],
    ...overrides,
  };
}

const minimap = { title: 'Old Minimap', categories: ['fabric', 'utility', 'adventure'] };

describe('scoreAlternative', () => {
  it('prefers a mod of the same theme over a more popular unrelated one', () => {
    const sameTheme = scoreAlternative(
      hit({
        title: 'JourneyMap',
        categories: ['fabric', 'utility', 'adventure'],
        downloads: 500_000,
      }),
      minimap,
    );
    const popular = scoreAlternative(
      hit({ title: 'Just Enough Items', categories: ['fabric', 'utility'], downloads: 9_000_000 }),
      minimap,
    );
    expect(sameTheme.score).toBeGreaterThan(popular.score);
  });

  it('explains the score with shared categories, name, keywords and downloads', () => {
    const result = scoreAlternative(
      hit({
        title: "Xaero's Minimap",
        description: 'A lightweight minimap showing nearby waypoints.',
        categories: ['fabric', 'utility'],
        downloads: 1_000_000,
      }),
      { ...minimap, description: 'Simple minimap with waypoints.' },
    );
    expect(result.nameMatch).toBe(true);
    expect(result.explanation).toBe(
      'similar name (minimap) · same categories (utility) · keywords (waypoints) · 1.0M downloads',
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('ignores loader categories when comparing themes', () => {
    const result = scoreAlternative(hit({ categories: ['fabric'], downloads: 10 }), minimap);
    expect(result.explanation).toBe('10 downloads');
    expect(result.nameMatch).toBe(false);
  });

  it('finds no real link between mods that only share a broad category (real-run regression)', () => {
    // Cas observé sur la vraie API : Xaero's Minimap proposé pour CIT Resewn (seule la catégorie
    // « utility » et la popularité étaient communes).
    const result = scoreAlternative(
      hit({
        title: "Xaero's Minimap",
        description: 'Displays a minimap for Minecraft with waypoints, for Fabric.',
        categories: ['fabric', 'utility', 'adventure'],
        downloads: 90_000_000,
      }),
      {
        title: 'CIT Resewn',
        categories: ['fabric', 'utility', 'decoration'],
        description: 'Re-implements custom item textures for Minecraft on Fabric.',
      },
    );
    expect(result.nameMatch).toBe(false);
    expect(result.keywordMatch).toBe(false);
  });

  it('needs two shared keywords without a similar name (real-run regression)', () => {
    // Cas observé : Xaero's Minimap proposé pour Paginated Advancements à cause du seul mot « screen ».
    const original = {
      title: 'Paginated Advancements & Custom Frames',
      categories: ['fabric', 'utility'],
      description: 'Makes the advancements screen paginated and bigger.',
    };
    const oneWord = scoreAlternative(
      hit({ title: "Xaero's Minimap", description: 'A minimap on your screen.' }),
      original,
    );
    expect(oneWord.keywordMatch).toBe(false);
    const twoWords = scoreAlternative(
      hit({ title: 'Better Progress', description: 'A bigger, paginated progress screen.' }),
      original,
    );
    expect(twoWords.keywordMatch).toBe(true);
  });
});
