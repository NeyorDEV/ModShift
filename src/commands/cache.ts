import { formatDuration } from '../duration.js';
import { defaultCacheDir, FileCache } from '../modrinth/cache.js';
import { type CliIo, resolveCacheTtl, UsageError } from './analyze.js';

export interface CacheCommandOptions {
  cacheDir?: string;
  cacheTtl?: string;
  json?: boolean;
  expired?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number, now: number): string {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC (${formatDuration(now - ms)} ago)`;
}

// `modshift cache stats` : contenu du cache local.
export async function runCacheStats(
  options: CacheCommandOptions,
  io: CliIo,
  now: () => number = Date.now,
): Promise<void> {
  const ttlMs = resolveCacheTtl(options.cacheTtl);
  const cache = new FileCache(options.cacheDir ?? defaultCacheDir(), now);
  const stats = await cache.stats(ttlMs);
  if (options.json) {
    io.stdout(`${JSON.stringify({ ...stats, ttlMs }, null, 2)}\n`);
    return;
  }
  const lines = [
    `Cache directory: ${stats.dir}`,
    `Entries: ${stats.entries} (${formatBytes(stats.bytes)})`,
  ];
  if (stats.oldest !== undefined && stats.newest !== undefined) {
    lines.push(`Oldest entry: ${formatDate(stats.oldest, now())}`);
    lines.push(`Newest entry: ${formatDate(stats.newest, now())}`);
  }
  lines.push(`Expired (older than ${formatDuration(ttlMs)}): ${stats.expired}`);
  if (stats.corrupted > 0) {
    lines.push(
      `Unreadable entries: ${stats.corrupted} (removed by "modshift cache clear --expired")`,
    );
  }
  io.stdout(`${lines.join('\n')}\n`);
}

// `modshift cache clear` : vide le cache (ou seulement les entrées expirées).
export async function runCacheClear(options: CacheCommandOptions, io: CliIo): Promise<void> {
  if (options.cacheTtl !== undefined && !options.expired) {
    throw new UsageError('--cache-ttl only applies with --expired');
  }
  const cache = new FileCache(options.cacheDir ?? defaultCacheDir());
  const ttlMs = resolveCacheTtl(options.cacheTtl);
  const removed = await cache.clear(options.expired ? { olderThanMs: ttlMs } : {});
  const what = options.expired
    ? `expired entr${removed === 1 ? 'y' : 'ies'}`
    : `entr${removed === 1 ? 'y' : 'ies'}`;
  io.stdout(`Removed ${removed} ${what} from ${cache.dir}\n`);
}
