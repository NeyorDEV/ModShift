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
});
