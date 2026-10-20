import type {
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthVersion,
} from '../../src/modrinth/types.js';
import { ModrinthClient } from '../../src/modrinth/client.js';
import { MemoryCache } from '../../src/modrinth/cache.js';
import { readJsonFixture } from './fixtures.js';
import { createMockFetch, jsonResponse, type RecordedRequest } from './mockFetch.js';

export interface Catalog {
  projects: ModrinthProject[];
  versions: ModrinthVersion[];
}

export function loadCatalog(name = 'catalog.json'): Catalog {
  return readJsonFixture<Catalog>('modrinth', name);
}

function parseJsonParam(url: URL, name: string): string[] | undefined {
  const raw = url.searchParams.get(name);
  return raw ? (JSON.parse(raw) as string[]) : undefined;
}

function toHit(p: ModrinthProject): ModrinthSearchHit {
  return {
    project_id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    // Comme Modrinth, la recherche mélange loaders et catégories.
    categories: [...p.categories, ...(p.loaders ?? [])],
    project_type: p.project_type,
    versions: p.game_versions ?? [],
    downloads: p.downloads ?? 0,
  };
}

function matchesFacet(hit: ModrinthSearchHit, facet: string): boolean {
  const [type, value] = facet.split(':');
  if (type === 'categories') return hit.categories.includes(value ?? '');
  if (type === 'versions') return hit.versions.includes(value ?? '');
  if (type === 'project_type') return hit.project_type === value;
  return false;
}

// Faux serveur Modrinth en mémoire : implémente les endpoints utilisés par ModShift
// à partir d'un catalogue de fixtures. Aucune requête réseau réelle.
export function fakeModrinthHandler(catalog: Catalog) {
  const findProject = (idOrSlug: string) =>
    catalog.projects.find((p) => p.id === idOrSlug || p.slug === idOrSlug);

  return (req: RecordedRequest): Response => {
    const path = req.url.pathname.replace(/^\/v2/, '');

    if (req.method === 'POST' && path === '/version_files') {
      const { hashes, algorithm } = req.body as { hashes: string[]; algorithm: 'sha1' | 'sha512' };
      const result: Record<string, ModrinthVersion> = {};
      for (const hash of hashes) {
        const version = catalog.versions.find((v) =>
          v.files.some((f) => f.hashes[algorithm] === hash),
        );
        if (version) result[hash] = version;
      }
      return jsonResponse(result);
    }

    if (path === '/projects') {
      const ids = parseJsonParam(req.url, 'ids') ?? [];
      return jsonResponse(ids.map(findProject).filter((p) => p));
    }

    if (path === '/versions') {
      const ids = parseJsonParam(req.url, 'ids') ?? [];
      return jsonResponse(catalog.versions.filter((v) => ids.includes(v.id)));
    }

    const versionsMatch = /^\/project\/([^/]+)\/version$/.exec(path);
    if (versionsMatch) {
      const project = findProject(decodeURIComponent(versionsMatch[1] ?? ''));
      if (!project) return jsonResponse({ error: 'not_found' }, 404);
      const loaders = parseJsonParam(req.url, 'loaders');
      const gameVersions = parseJsonParam(req.url, 'game_versions');
      return jsonResponse(
        catalog.versions.filter(
          (v) =>
            v.project_id === project.id &&
            (!loaders || v.loaders.some((l) => loaders.includes(l))) &&
            (!gameVersions || v.game_versions.some((g) => gameVersions.includes(g))),
        ),
      );
    }

    const projectMatch = /^\/project\/([^/]+)$/.exec(path);
    if (projectMatch) {
      const project = findProject(decodeURIComponent(projectMatch[1] ?? ''));
      return project ? jsonResponse(project) : jsonResponse({ error: 'not_found' }, 404);
    }

    if (path === '/search') {
      const facets = (JSON.parse(req.url.searchParams.get('facets') ?? '[]') as string[][]) ?? [];
      const queryWords = (req.url.searchParams.get('query') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w);
      const score = (hit: ModrinthSearchHit) =>
        queryWords.filter((w) => hit.title.toLowerCase().includes(w)).length;
      const limit = Number(req.url.searchParams.get('limit') ?? '10');
      const hits = catalog.projects
        .map(toHit)
        .filter((hit) => facets.every((group) => group.some((f) => matchesFacet(hit, f))))
        .filter((hit) => queryWords.length === 0 || score(hit) > 0)
        .sort((a, b) =>
          req.url.searchParams.get('index') === 'downloads'
            ? b.downloads - a.downloads
            : score(b) - score(a) || b.downloads - a.downloads,
        )
        .slice(0, limit);
      return jsonResponse({ hits, offset: 0, limit, total_hits: hits.length });
    }

    return jsonResponse({ error: 'not_found', path }, 404);
  };
}

// Client Modrinth réel branché sur le faux serveur (cache mémoire, pas d'attente réelle).
export function createFakeClient(catalog: Catalog = loadCatalog()) {
  const mock = createMockFetch(fakeModrinthHandler(catalog));
  const client = new ModrinthClient({
    fetch: mock.fetch,
    cache: new MemoryCache(),
    sleep: async () => undefined,
  });
  return { client, calls: mock.calls };
}
