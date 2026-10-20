import { describe, expect, it } from 'vitest';
import { assetMatches, githubReleasesSource } from '../../src/sources/githubReleases.js';
import { fakeGitHub } from '../helpers/fakeGitHub.js';
import { jsonResponse, createMockFetch } from '../helpers/mockFetch.js';
import { contextFor } from './contract.js';

const target = { minecraftVersion: '1.21.1', loader: 'fabric' } as const;
const options = { repositories: { localmod: 'example-org/local-mod' } };
const request = { fileName: 'local-mod.jar', modIds: ['localmod'] };

describe('assetMatches', () => {
  it.each([
    ['local-mod-fabric-1.21.1-2.0.0.jar', 'file name mentions Minecraft 1.21.1 and fabric'],
    ['local-mod-mc1.21.1-2.0.0.jar', 'file name mentions Minecraft 1.21.1 (no loader in the name)'],
    ['local-mod-1.21.1.fabric.jar', 'file name mentions Minecraft 1.21.1 and fabric'],
  ])('accepts %s', (name, reason) => {
    expect(assetMatches(name, target)).toBe(reason);
  });

  it.each([
    'local-mod-fabric-1.21.10-2.0.0.jar',
    'local-mod-neoforge-1.21.1.jar',
    'local-mod-fabric-1.21.1-sources.jar',
    'local-mod-fabric-1.21.1.zip',
    'local-mod-fabric-1.20.1.jar',
  ])('rejects %s', (name) => {
    expect(assetMatches(name, target)).toBeUndefined();
  });

  it('accepts documented fallback loaders, and keeps forge apart from neoforge', () => {
    expect(
      assetMatches('x-fabric-1.21.1.jar', { minecraftVersion: '1.21.1', loader: 'quilt' }),
    ).toBe('file name mentions Minecraft 1.21.1 and fabric');
    expect(
      assetMatches('x-neoforge-1.21.1.jar', { minecraftVersion: '1.21.1', loader: 'forge' }),
    ).toBeUndefined();
  });
});

describe('GitHub Releases source', () => {
  it('proposes the newest stable matching asset, skipping drafts, pre-releases and uploads in progress', async () => {
    const mock = fakeGitHub();
    const { context } = contextFor(options);
    const candidates = await githubReleasesSource({ fetch: mock.fetch }).findCandidates?.(
      request,
      target,
      context,
    );
    expect(candidates).toEqual([
      {
        source: 'github-releases',
        title: 'local-mod.jar',
        version: 'v2.0.0',
        fileName: 'local-mod-fabric-1.21.1-2.0.0.jar',
        url: 'https://github.com/example-org/local-mod/releases/download/v2.0.0/local-mod-fabric-1.21.1-2.0.0.jar',
        pageUrl: 'https://github.com/example-org/local-mod/releases/tag/v2.0.0',
        size: 2048,
        hashes: { sha256: 'ab'.repeat(32) },
        publishedAt: '2024-09-01T00:00:00Z',
        reason:
          'example-org/local-mod release v2.0.0: file name mentions Minecraft 1.21.1 and fabric',
        note: 'external source, to verify',
      },
    ]);
    const [call] = mock.calls;
    expect(call?.url.toString()).toBe(
      'https://api.github.com/repos/example-org/local-mod/releases?per_page=30',
    );
    expect(call?.headers['user-agent']).toMatch(/^NeyorDEV\/ModShift\//);
    expect(call?.headers.accept).toBe('application/vnd.github+json');
    expect(call?.headers.authorization).toBeUndefined();
  });

  it('includes pre-releases on request and sends the optional token', async () => {
    const mock = fakeGitHub();
    const { context } = contextFor(
      { ...options, prereleases: true },
      { env: { GITHUB_TOKEN: 'test-token-not-real' } },
    );
    const candidates = await githubReleasesSource({ fetch: mock.fetch }).findCandidates?.(
      request,
      target,
      context,
    );
    expect(candidates?.[0]?.version).toBe('v2.1.0-beta');
    expect(mock.calls[0]?.headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('only queries repositories listed for the mod', async () => {
    const mock = fakeGitHub();
    const { context } = contextFor(options);
    const source = githubReleasesSource({ fetch: mock.fetch });
    expect(
      await source.findCandidates?.({ fileName: 'other.jar', modIds: [] }, target, context),
    ).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });

  it.each([
    [404, 'repository example-org/local-mod not found (or private without a token)'],
    [
      403,
      'rate limit reached for example-org/local-mod (60 requests/hour without a token; set GITHUB_TOKEN)',
    ],
    [500, 'example-org/local-mod answered HTTP 500'],
  ])('turns HTTP %i into a warning', async (status, message) => {
    const mock = createMockFetch(() => jsonResponse({ message: 'x' }, status));
    const { context, warnings } = contextFor(options);
    expect(
      await githubReleasesSource({ fetch: mock.fetch }).findCandidates?.(request, target, context),
    ).toEqual([]);
    expect(warnings).toEqual([`GitHub Releases: ${message}.`]);
  });
});
