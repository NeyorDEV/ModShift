import { readJsonFixture } from './fixtures.js';
import { createMockFetch, jsonResponse, type RecordedRequest } from './mockFetch.js';

// Faux GitHub en mémoire : GET /repos/example-org/local-mod/releases (fixture), 404 sinon.
export function fakeGitHub() {
  const { releases } = readJsonFixture<{ releases: unknown[] }>('github', 'releases.json');
  return createMockFetch((req: RecordedRequest) => {
    if (req.url.hostname !== 'api.github.com') throw new TypeError('fetch failed');
    if (req.url.pathname === '/repos/example-org/local-mod/releases') return jsonResponse(releases);
    return jsonResponse({ message: 'Not Found' }, 404);
  });
}
