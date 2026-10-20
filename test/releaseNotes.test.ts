import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractReleaseNotes } from '../scripts/release-notes.mjs';

const changelog = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-11-01

### Added

- Thing.

## [1.0.0] - 2026-10-01

- First.

[1.1.0]: https://example.com/compare
`;

describe('extractReleaseNotes', () => {
  it('returns the section of a version, with or without the "v" prefix', () => {
    expect(extractReleaseNotes(changelog, 'v1.1.0')).toBe('### Added\n\n- Thing.');
    expect(extractReleaseNotes(changelog, '1.0.0')).toBe('- First.');
  });

  it('returns undefined for missing or empty sections', () => {
    expect(extractReleaseNotes(changelog, '2.0.0')).toBeUndefined();
    expect(extractReleaseNotes(changelog, 'Unreleased')).toBeUndefined();
  });

  it('finds the current version in the real CHANGELOG.md', () => {
    const real = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    expect(extractReleaseNotes(real, pkg.version)).toContain('modshift analyze');
  });
});
