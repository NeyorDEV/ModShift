import type { CurseForgeFile, CurseForgeMod } from '../../src/curseforge/client.js';
import { readJsonFixture } from './fixtures.js';
import { jsonResponse, type RecordedRequest } from './mockFetch.js';

export interface CurseForgeCatalog {
  files: CurseForgeFile[];
  mods: CurseForgeMod[];
}

// Clé factice pour les tests : jamais une vraie clé.
export const FAKE_CF_KEY = 'test-key-not-a-real-curseforge-key';

export function loadCurseForgeCatalog(): CurseForgeCatalog {
  return readJsonFixture<CurseForgeCatalog>('curseforge', 'api.json');
}

// Faux serveur CurseForge : POST /v1/mods/files et POST /v1/mods ; vérifie l'en-tête x-api-key.
export function fakeCurseForgeHandler(catalog: CurseForgeCatalog = loadCurseForgeCatalog()) {
  return (req: RecordedRequest): Response => {
    if (req.headers['x-api-key'] !== FAKE_CF_KEY) return jsonResponse({ error: 'Forbidden' }, 403);
    if (req.method === 'POST' && req.url.pathname === '/v1/mods/files') {
      const ids = (req.body as { fileIds: number[] }).fileIds;
      return jsonResponse({ data: catalog.files.filter((f) => ids.includes(f.id)) });
    }
    if (req.method === 'POST' && req.url.pathname === '/v1/mods') {
      const ids = (req.body as { modIds: number[] }).modIds;
      return jsonResponse({ data: catalog.mods.filter((m) => ids.includes(m.id)) });
    }
    return jsonResponse({ error: 'not found' }, 404);
  };
}
