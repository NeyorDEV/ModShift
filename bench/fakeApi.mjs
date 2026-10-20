// Faux serveur Modrinth en mémoire pour les benchmarks (aucune requête réseau).
// Index précalculés pour que le faux serveur ne pèse pas dans les mesures ; une latence
// artificielle optionnelle simule le temps d'aller-retour d'une requête.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const param = (url, name) => {
  const raw = url.searchParams.get(name);
  return raw ? JSON.parse(raw) : undefined;
};

export function createFakeFetch(catalog, { latencyMs = 0 } = {}) {
  const projects = new Map();
  for (const p of catalog.projects) {
    projects.set(p.id, p);
    projects.set(p.slug, p);
  }
  const versionsById = new Map(catalog.versions.map((v) => [v.id, v]));
  const versionsByProject = new Map();
  const byHash = { sha1: new Map(), sha512: new Map() };
  for (const v of catalog.versions) {
    const list = versionsByProject.get(v.project_id) ?? [];
    list.push(v);
    versionsByProject.set(v.project_id, list);
    for (const f of v.files) {
      byHash.sha1.set(f.hashes.sha1, v);
      byHash.sha512.set(f.hashes.sha512, v);
    }
  }
  const stats = { requests: 0, inFlight: 0, peakInFlight: 0 };

  const handle = (url, init) => {
    const path = url.pathname.replace(/^\/v2/, '');
    if (init.method === 'POST' && path === '/version_files') {
      const { hashes, algorithm } = JSON.parse(init.body);
      const result = {};
      for (const hash of hashes) {
        const v = byHash[algorithm].get(hash);
        if (v) result[hash] = v;
      }
      return json(result);
    }
    if (path === '/projects') {
      return json((param(url, 'ids') ?? []).map((id) => projects.get(id)).filter(Boolean));
    }
    if (path === '/versions') {
      return json((param(url, 'ids') ?? []).map((id) => versionsById.get(id)).filter(Boolean));
    }
    const versions = /^\/project\/([^/]+)\/version$/.exec(path);
    if (versions) {
      const project = projects.get(decodeURIComponent(versions[1]));
      if (!project) return json({ error: 'not_found' }, 404);
      const loaders = param(url, 'loaders');
      const gameVersions = param(url, 'game_versions');
      return json(
        (versionsByProject.get(project.id) ?? []).filter(
          (v) =>
            (!loaders || v.loaders.some((l) => loaders.includes(l))) &&
            (!gameVersions || v.game_versions.some((g) => gameVersions.includes(g))),
        ),
      );
    }
    if (path === '/search') {
      // Recherche simplifiée : aucune alternative trouvée (le coût mesuré est celui des requêtes).
      return json({ hits: [], offset: 0, limit: 10, total_hits: 0 });
    }
    return json({ error: 'not_found', path }, 404);
  };

  const fetch = async (input, init = {}) => {
    stats.requests++;
    stats.inFlight++;
    stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight);
    try {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return handle(new URL(String(input)), init);
    } finally {
      stats.inFlight--;
    }
  };
  return { fetch, stats };
}
