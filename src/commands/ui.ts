import { spawn } from 'node:child_process';
import { parseConcurrency, resolveCacheTtl, type CliIo, UsageError } from './analyze.js';
import { defaultCacheDir, FileCache } from '../modrinth/cache.js';
import { startUiServer, type UiServer } from '../ui/server.js';

export interface UiCommandOptions {
  port?: string;
  open: boolean;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
  cacheTtl?: string;
  concurrency?: string;
}

// Ouvre l'URL dans le navigateur par défaut. Aucun shell : la commande et l'URL (construite par
// ModShift, jamais issue d'une entrée) sont passées en arguments.
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['explorer.exe', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid --port "${value}" (expected 0-65535, 0 = any free port)`);
  }
  return port;
}

// `modshift ui` : démarre le serveur local et renvoie son handle (la CLI attend Ctrl+C).
export async function runUi(
  options: UiCommandOptions,
  io: CliIo,
  open: (url: string) => boolean = openBrowser,
): Promise<UiServer> {
  const port = parsePort(options.port);
  if (options.offline && !options.cache) {
    throw new UsageError('--offline needs the cache: remove --no-cache');
  }
  const env = io.env ?? process.env;
  const server = await startUiServer({
    port,
    createApi: io.createApi,
    createCurseForgeApi: io.createCurseForgeApi,
    cache: options.cache ? new FileCache(options.cacheDir ?? defaultCacheDir(env)) : undefined,
    cacheTtlMs: resolveCacheTtl(options.cacheTtl, env),
    offline: options.offline,
    concurrency: parseConcurrency(options.concurrency),
    env,
  });
  io.stdout(`ModShift UI running at ${server.url}\n`);
  io.stdout('Only reachable from this computer (127.0.0.1). Press Ctrl+C to stop.\n');
  if (options.open && !open(server.url)) {
    io.stdout('Could not open a browser: open the URL above manually.\n');
  }
  return server;
}
