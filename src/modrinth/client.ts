import { MODSHIFT_VERSION } from '../version.js';
import { DEFAULT_CACHE_TTL_MS, type ResponseCache } from './cache.js';
import {
  describeRequest,
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimitError,
} from './errors.js';
import { defaultSleep, RateLimiter, type Sleep } from './rateLimiter.js';
import type {
  HashAlgorithm,
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion,
  SearchParams,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://api.modrinth.com/v2';

// Modrinth exige un User-Agent identifiant clairement l'application (projet/version + contact).
export const DEFAULT_USER_AGENT = `NeyorDEV/ModShift/${MODSHIFT_VERSION} (https://github.com/NeyorDEV/ModShift)`;

// Taille des lots pour les requêtes groupées (hash, ids) : limite la taille des URL et des corps.
const BATCH_SIZE = 100;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ModrinthClientOptions {
  baseUrl?: string;
  userAgent?: string;
  // Implémentation de fetch injectable (les tests fournissent un mock).
  fetch?: FetchLike;
  cache?: ResponseCache;
  cacheTtlMs?: number;
  // Hors-ligne : uniquement le cache (sans limite d'âge), aucune requête réseau.
  offline?: boolean;
  rateLimiter?: RateLimiter;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: Sleep;
  // Événements de transport (requêtes, cache, tentatives, attentes) pour les logs --verbose.
  onEvent?: (event: ClientEvent) => void;
}

export type ClientEvent =
  | { type: 'request'; method: string; url: string; status: number; durationMs: number }
  | { type: 'cache-hit'; method: string; url: string }
  | { type: 'retry'; url: string; reason: string; delayMs: number }
  | { type: 'rate-limit-wait'; waitMs: number };

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  // Renvoie `null` au lieu de lever une erreur sur un 404.
  allowNotFound?: boolean;
}

export interface ProjectVersionFilter {
  loaders?: string[];
  gameVersions?: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

// Délai demandé par le serveur (en secondes) via X-Ratelimit-Reset ou Retry-After.
function serverResetSeconds(headers: Headers): number | undefined {
  for (const name of ['x-ratelimit-reset', 'retry-after']) {
    const value = Number(headers.get(name));
    if (headers.has(name) && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

export class ModrinthClient {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  readonly baseUrl: string;
  readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly cache: ResponseCache | undefined;
  private readonly cacheTtlMs: number;
  private readonly offline: boolean;
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly emit: (event: ClientEvent) => void;
  // Nombre de requêtes réellement envoyées (utile pour les statistiques et les tests).
  requestCount = 0;

  constructor(options: ModrinthClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.cache = options.cache;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.offline = options.offline ?? false;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.emit = options.onEvent ?? (() => undefined);
    this.rateLimiter =
      options.rateLimiter ??
      new RateLimiter({
        now: this.now,
        sleep: this.sleep,
        onWait: (waitMs) => this.emit({ type: 'rate-limit-wait', waitMs }),
      });
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (this.offline && !this.cache) {
      throw new Error('Offline mode requires a cache');
    }
  }

  // --- Endpoints ---------------------------------------------------------

  // POST /version_files : identifie des fichiers par leur hash. Les hash inconnus sont absents du résultat.
  async getVersionsFromHashes(
    hashes: string[],
    algorithm: HashAlgorithm = 'sha1',
  ): Promise<Record<string, ModrinthVersion>> {
    const result: Record<string, ModrinthVersion> = {};
    const unique = [...new Set(hashes)].sort();
    for (const batch of chunk(unique, BATCH_SIZE)) {
      const map = await this.request<Record<string, ModrinthVersion>>('POST', '/version_files', {
        body: { hashes: batch, algorithm },
      });
      Object.assign(result, map);
    }
    return result;
  }

  // GET /project/{id|slug} ; `null` si le projet n'existe pas.
  getProject(idOrSlug: string): Promise<ModrinthProject | null> {
    return this.request<ModrinthProject>('GET', `/project/${encodeURIComponent(idOrSlug)}`, {
      allowNotFound: true,
    });
  }

  // GET /projects?ids=[...]
  async getProjects(ids: string[]): Promise<ModrinthProject[]> {
    const result: ModrinthProject[] = [];
    for (const batch of chunk([...new Set(ids)].sort(), BATCH_SIZE)) {
      const projects = await this.request<ModrinthProject[]>('GET', '/projects', {
        query: { ids: JSON.stringify(batch) },
      });
      result.push(...(projects ?? []));
    }
    return result;
  }

  // GET /project/{id}/version filtré par loaders et versions de Minecraft ; [] si projet inconnu.
  async getProjectVersions(
    idOrSlug: string,
    filter: ProjectVersionFilter = {},
  ): Promise<ModrinthVersion[]> {
    const versions = await this.request<ModrinthVersion[]>(
      'GET',
      `/project/${encodeURIComponent(idOrSlug)}/version`,
      {
        query: {
          loaders: filter.loaders ? JSON.stringify(filter.loaders) : undefined,
          game_versions: filter.gameVersions ? JSON.stringify(filter.gameVersions) : undefined,
          include_changelog: false,
        },
        allowNotFound: true,
      },
    );
    return versions ?? [];
  }

  // GET /versions?ids=[...]
  async getVersions(ids: string[]): Promise<ModrinthVersion[]> {
    const result: ModrinthVersion[] = [];
    for (const batch of chunk([...new Set(ids)].sort(), BATCH_SIZE)) {
      const versions = await this.request<ModrinthVersion[]>('GET', '/versions', {
        query: { ids: JSON.stringify(batch) },
      });
      result.push(...(versions ?? []));
    }
    return result;
  }

  // GET /search
  async search(params: SearchParams): Promise<ModrinthSearchResult> {
    const result = await this.request<ModrinthSearchResult>('GET', '/search', {
      query: {
        query: params.query,
        facets: params.facets ? JSON.stringify(params.facets) : undefined,
        index: params.index,
        limit: params.limit,
        offset: params.offset,
      },
    });
    return result ?? { hits: [], offset: 0, limit: 0, total_hits: 0 };
  }

  // --- Transport ---------------------------------------------------------

  buildUrl(path: string, query: RequestOptions['query'] = {}): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const url = this.buildUrl(path, options.query);
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    const cacheKey = `${method} ${url}${bodyText ? ` ${bodyText}` : ''}`;

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached && (this.offline || this.now() - cached.storedAt < this.cacheTtlMs)) {
        this.emit({ type: 'cache-hit', method, url });
        return cached.body as T | null;
      }
    }
    if (this.offline) {
      throw new OfflineCacheMissError(url, describeRequest(method, url, options.body));
    }

    // Requêtes parallèles identiques (ex. deux recherches dans la même catégorie) : une seule part
    // réellement, les autres attendent sa réponse, ce qui épargne le quota de Modrinth.
    const pending = this.inFlight.get(cacheKey);
    if (pending) return (await pending) as T | null;
    const promise = (async () => {
      const body = await this.fetchWithRetries(method, url, bodyText, options.allowNotFound);
      if (this.cache) await this.cache.set(cacheKey, body);
      return body;
    })();
    this.inFlight.set(cacheKey, promise);
    try {
      return (await promise) as T | null;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async fetchWithRetries(
    method: string,
    url: string,
    bodyText: string | undefined,
    allowNotFound = false,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries;
      const backoffMs = this.retryBaseDelayMs * 2 ** attempt;
      await this.rateLimiter.acquire();

      let response: Response;
      const startedAt = this.now();
      try {
        this.requestCount++;
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: bodyText,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        // Erreur réseau (DNS, connexion, délai dépassé) : nouvelle tentative avec backoff exponentiel.
        if (!canRetry) throw new ModrinthNetworkError(url, { cause: error });
        const reason = error instanceof Error ? error.message : String(error);
        this.emit({ type: 'retry', url, reason, delayMs: backoffMs });
        await this.sleep(backoffMs);
        continue;
      }
      this.emit({
        type: 'request',
        method,
        url,
        status: response.status,
        durationMs: this.now() - startedAt,
      });

      this.rateLimiter.update(response.headers);

      if (response.ok) {
        return (await response.json()) as unknown;
      }
      if (response.status === 404 && allowNotFound) {
        return null;
      }
      if (response.status === 429) {
        // Quota dépassé : on attend la fin de la fenêtre annoncée par le serveur.
        const resetSeconds = serverResetSeconds(response.headers);
        if (!canRetry) {
          const limit = Number(response.headers.get('x-ratelimit-limit'));
          throw new RateLimitError(
            url,
            resetSeconds,
            Number.isFinite(limit) && limit > 0 ? limit : undefined,
          );
        }
        this.rateLimiter.blockUntilReset(resetSeconds ?? backoffMs / 1000);
        continue;
      }
      if (response.status >= 500 && canRetry) {
        this.emit({ type: 'retry', url, reason: `HTTP ${response.status}`, delayMs: backoffMs });
        await this.sleep(backoffMs);
        continue;
      }
      throw new ModrinthApiError(response.status, url, await response.text().catch(() => ''));
    }
  }
}
