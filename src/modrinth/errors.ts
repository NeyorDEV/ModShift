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
  constructor(readonly url: string) {
    super(`Offline mode: no cached response for ${url}`);
    this.name = 'OfflineCacheMissError';
  }
}
