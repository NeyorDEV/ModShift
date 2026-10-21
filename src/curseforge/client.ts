import type { ResponseCache } from '../modrinth/cache.js';
import { DEFAULT_CACHE_TTL_MS } from '../modrinth/cache.js';
import { OfflineCacheMissError } from '../modrinth/errors.js';
import type { FetchLike } from '../modrinth/client.js';
import { defaultSleep, type Sleep } from '../modrinth/rateLimiter.js';
import { MODSHIFT_VERSION } from '../version.js';

// Client minimal de l'API CurseForge (« Eternal API »).
// Les docs officielles (docs.curseforge.com) sont inaccessibles depuis l'environnement de
// développement : endpoints et formats vérifiés dans deux clients open source répandus,
// packwiz (curseforge/request.go) et Prism Launcher (launcher/modplatform/flame/FlameAPI.cpp).
// Voir docs/curseforge-api.md.

export const CURSEFORGE_BASE_URL = 'https://api.curseforge.com';
export const CURSEFORGE_API_KEY_ENV = 'CURSEFORGE_API_KEY';

// Valeur de `hashes[].algo` pour SHA-1 (1 = SHA-1, 2 = MD5).
export const CF_HASH_ALGO_SHA1 = 1;

export interface CurseForgeFile {
  id: number;
  modId: number;
  displayName?: string;
  fileName: string;
  fileLength?: number;
  // Peut être null quand l'auteur interdit la distribution par des tiers.
  downloadUrl?: string | null;
  gameVersions?: string[];
  hashes?: { value: string; algo: number }[];
}

export interface CurseForgeMod {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  // Classe CurseForge : 6 mod, 12 pack de ressources, 6552 shader, 17 monde (Prism Launcher,
  // FlameAPI.cpp ; packwiz, curseforge.go).
  classId?: number;
  links?: { websiteUrl?: string };
}

export class CurseForgeApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(
      status === 401 || status === 403
        ? `CurseForge rejected the API key (HTTP ${status}) for ${url}`
        : `CurseForge API error ${status} for ${url}`,
    );
    this.name = 'CurseForgeApiError';
  }
}

export class CurseForgeNetworkError extends Error {
  constructor(
    readonly url: string,
    options?: ErrorOptions,
  ) {
    const cause = options?.cause instanceof Error ? ` (${options.cause.message})` : '';
    super(`Network error while calling ${url}${cause}`, options);
    this.name = 'CurseForgeNetworkError';
  }
}

export interface CurseForgeClientOptions {
  // Clé API : fournie uniquement par la variable d'environnement CURSEFORGE_API_KEY.
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  cache?: ResponseCache;
  cacheTtlMs?: number;
  offline?: boolean;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleep?: Sleep;
  now?: () => number;
}

// Lit la clé dans l'environnement ; jamais ailleurs (ni fichier, ni option de ligne de commande).
export function curseForgeApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env[CURSEFORGE_API_KEY_ENV]?.trim();
  return key ? key : undefined;
}

export class CurseForgeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly cache: ResponseCache | undefined;
  private readonly cacheTtlMs: number;
  private readonly offline: boolean;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(options: CurseForgeClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? CURSEFORGE_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.cache = options.cache;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.offline = options.offline ?? false;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  // POST /v1/mods/files {"fileIds": [...]} → fichiers (nom, hashes, projet).
  async getFiles(fileIds: number[]): Promise<CurseForgeFile[]> {
    if (fileIds.length === 0) return [];
    return this.post<CurseForgeFile[]>('/v1/mods/files', {
      fileIds: [...new Set(fileIds)].sort((a, b) => a - b),
    });
  }

  // POST /v1/mods {"modIds": [...]} → projets (nom, slug).
  async getMods(modIds: number[]): Promise<CurseForgeMod[]> {
    if (modIds.length === 0) return [];
    return this.post<CurseForgeMod[]>('/v1/mods', {
      modIds: [...new Set(modIds)].sort((a, b) => a - b),
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const bodyText = JSON.stringify(body);
    // La clé n'entre jamais dans la clé de cache ni dans les messages d'erreur.
    const cacheKey = `curseforge POST ${url} ${bodyText}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached && (this.offline || this.now() - cached.storedAt < this.cacheTtlMs)) {
        return cached.body as T;
      }
    }
    if (this.offline) {
      throw new OfflineCacheMissError(url, `CurseForge request ${path}`);
    }

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries;
      const delay = this.retryBaseDelayMs * 2 ** attempt;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'User-Agent': `NeyorDEV/ModShift/${MODSHIFT_VERSION} (https://github.com/NeyorDEV/ModShift)`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: bodyText,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (!canRetry) throw new CurseForgeNetworkError(url, { cause: error });
        await this.sleep(delay);
        continue;
      }
      if (response.ok) {
        const json = (await response.json()) as { data?: T };
        const data = (json.data ?? []) as T;
        if (this.cache) await this.cache.set(cacheKey, data);
        return data;
      }
      if ((response.status === 429 || response.status >= 500) && canRetry) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
        continue;
      }
      throw new CurseForgeApiError(response.status, url);
    }
  }
}
