import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
}
