import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CacheEntry {
  // Horodatage (ms) de l'enregistrement.
  storedAt: number;
  body: unknown;
}

// Cache des réponses de l'API, indexé par une clé (méthode + URL + corps).
export interface ResponseCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, body: unknown): Promise<void>;
}

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Dossier de cache par défaut : $MODSHIFT_CACHE_DIR, sinon $XDG_CACHE_HOME/modshift, sinon ~/.cache/modshift.
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MODSHIFT_CACHE_DIR) return env.MODSHIFT_CACHE_DIR;
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'modshift');
}

export class MemoryCache implements ResponseCache {
  readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, body: unknown): Promise<void> {
    this.entries.set(key, { storedAt: this.now(), body });
  }
}

// Cache sur disque : un fichier JSON par clé (nom = SHA-256 de la clé).
// Un fichier illisible ou corrompu est traité comme absent.
export class FileCache implements ResponseCache {
  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private fileFor(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.fileFor(key), 'utf8')) as Partial<
        CacheEntry & { key: string }
      >;
      if (parsed.key !== key || typeof parsed.storedAt !== 'number') return undefined;
      return { storedAt: parsed.storedAt, body: parsed.body ?? null };
    } catch {
      return undefined;
    }
  }

  async set(key: string, body: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.fileFor(key);
    // Écriture atomique : fichier temporaire puis renommage.
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ key, storedAt: this.now(), body }));
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  // Fichiers d'entrées présents dans le dossier (les fichiers étrangers sont ignorés).
  private async entryFiles(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
    } catch {
      return [];
    }
  }

  // Statistiques du cache ; `ttlMs` permet de compter les entrées expirées.
  async stats(ttlMs?: number): Promise<CacheStats> {
    const stats: CacheStats = { dir: this.dir, entries: 0, bytes: 0, expired: 0, corrupted: 0 };
    for (const name of await this.entryFiles()) {
      const path = join(this.dir, name);
      try {
        const [info, text] = await Promise.all([stat(path), readFile(path, 'utf8')]);
        stats.bytes += info.size;
        const storedAt = (JSON.parse(text) as Partial<CacheEntry>).storedAt;
        if (typeof storedAt !== 'number') throw new Error('invalid entry');
        stats.entries++;
        stats.oldest = Math.min(stats.oldest ?? storedAt, storedAt);
        stats.newest = Math.max(stats.newest ?? storedAt, storedAt);
        if (ttlMs !== undefined && this.now() - storedAt >= ttlMs) stats.expired++;
      } catch {
        stats.corrupted++;
      }
    }
    return stats;
  }

  // Supprime les entrées (toutes, ou seulement les expirées/corrompues). Renvoie le nombre supprimé.
  async clear(options: { olderThanMs?: number } = {}): Promise<number> {
    let removed = 0;
    for (const name of await this.entryFiles()) {
      const path = join(this.dir, name);
      if (options.olderThanMs !== undefined) {
        try {
          const storedAt = (JSON.parse(await readFile(path, 'utf8')) as Partial<CacheEntry>)
            .storedAt;
          if (typeof storedAt === 'number' && this.now() - storedAt < options.olderThanMs) {
            continue;
          }
        } catch {
          // Entrée corrompue : supprimée.
        }
      }
      await rm(path, { force: true });
      removed++;
    }
    return removed;
  }
}

export interface CacheStats {
  dir: string;
  entries: number;
  bytes: number;
  // Horodatages (ms) de la plus ancienne et de la plus récente entrée.
  oldest?: number;
  newest?: number;
  expired: number;
  corrupted: number;
}
