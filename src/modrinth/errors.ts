// Erreur HTTP renvoyée par l'API Modrinth (hors 404 tolérés et erreurs réessayées).
export class ModrinthApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly responseBody?: string,
  ) {
    super(`Modrinth API error ${status} for ${url}`);
    this.name = 'ModrinthApiError';
  }
}

// Erreur réseau persistante après épuisement des tentatives.
export class ModrinthNetworkError extends Error {
  constructor(
    readonly url: string,
    options?: ErrorOptions,
  ) {
    const cause = options?.cause instanceof Error ? ` (${options.cause.message})` : '';
    super(`Network error while calling ${url}${cause}`, options);
    this.name = 'ModrinthNetworkError';
  }
}

// Quota de requêtes Modrinth dépassé, même après les tentatives prévues.
export class RateLimitError extends Error {
  constructor(
    readonly url: string,
    // Délai annoncé par le serveur avant la réinitialisation du quota, en secondes.
    readonly resetSeconds: number | undefined,
    readonly limit: number | undefined,
  ) {
    super(
      `Modrinth rate limit reached${limit ? ` (${limit} requests per minute)` : ''} while calling ${url}`,
    );
    this.name = 'RateLimitError';
  }
}

// Requête impossible en mode hors-ligne : la réponse n'est pas dans le cache.
export class OfflineCacheMissError extends Error {
  constructor(
    readonly url: string,
    // Description lisible de la requête manquante (ex. « versions of project AANobbMI »).
    readonly what: string = url,
  ) {
    super(`Offline mode: the cache has no entry for the ${what} (${url})`);
    this.name = 'OfflineCacheMissError';
  }
}

// Décrit une requête Modrinth en termes compréhensibles par l'utilisateur.
export function describeRequest(method: string, url: string, body?: unknown): string {
  const { pathname, searchParams } = new URL(url);
  const path = pathname.replace(/^\/v2/, '');
  if (method === 'POST' && path === '/version_files') {
    const count = Array.isArray((body as { hashes?: unknown[] } | undefined)?.hashes)
      ? (body as { hashes: unknown[] }).hashes.length
      : 0;
    return `hash lookup of ${count} file(s)`;
  }
  const versions = /^\/project\/([^/]+)\/version$/.exec(path);
  if (versions?.[1]) return `versions of project ${decodeURIComponent(versions[1])}`;
  const project = /^\/project\/([^/]+)$/.exec(path);
  if (project?.[1]) return `project ${decodeURIComponent(project[1])}`;
  if (path === '/projects') return 'project details';
  if (path === '/versions') return 'version details';
  if (path === '/search') {
    const query = searchParams.get('query');
    return query ? `search "${query}"` : 'category search';
  }
  return `request ${method} ${path}`;
}
