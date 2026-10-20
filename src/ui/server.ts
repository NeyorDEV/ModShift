import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTarget } from '../commands/analyze.js';
import { analyzePack } from '../core/engine.js';
import type { ModrinthApi } from '../core/refs.js';
import type { AnalysisResult } from '../core/types.js';
import type { CurseForgeClient, CurseForgeClientOptions } from '../curseforge/client.js';
import {
  curseForgeApiKey,
  CurseForgeApiError,
  CurseForgeClient as DefaultCurseForgeClient,
  CurseForgeNetworkError,
} from '../curseforge/client.js';
import {
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimitError,
} from '../modrinth/errors.js';
import { missingKeyWarning, resolveCurseForgeRefs } from '../curseforge/resolve.js';
import { describeError } from '../errorMessages.js';
import { loadPack } from '../input/index.js';
import { getLoader, LOADER_DEFINITIONS, supportsMrpack } from '../loaders/registry.js';
import { buildMigrationPlan, resolveLoaderVersion } from '../migrate/plan.js';
import { MIGRATION_REPORT_FILE, renderMigrationReport } from '../migrate/report.js';
import { buildMrpackArchive, collectOverrides } from '../migrate/writer.js';
import type { ResponseCache } from '../modrinth/cache.js';
import type { ModrinthClientOptions } from '../modrinth/client.js';
import { renderJson } from '../report/json.js';
import type { ModPack } from '../types.js';
import { MODSHIFT_VERSION } from '../version.js';

// Serveur web local de `modshift ui`.
// Sécurité : écoute uniquement sur 127.0.0.1, jeton aléatoire exigé pour l'API, contrôle de
// l'en-tête Host (anti DNS rebinding), fichiers statiques servis depuis une liste fixe,
// taille d'envoi bornée, écritures limitées à un dossier temporaire par session.

export const UI_HOST = '127.0.0.1';
export const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const TOKEN_HEADER = 'x-modshift-token';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
// Liste blanche : aucun chemin n'est construit à partir de l'URL demandée.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/logic.js': { file: 'logic.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export interface UiServerOptions {
  // 0 (défaut) : port libre choisi par le système.
  port?: number;
  maxUploadBytes?: number;
  createApi: (options: ModrinthClientOptions) => ModrinthApi;
  cache?: ResponseCache;
  cacheTtlMs?: number;
  offline?: boolean;
  // Requêtes simultanées vers Modrinth pendant une analyse.
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
  createCurseForgeApi?: (options: CurseForgeClientOptions) => CurseForgeClient;
  // Jeton imposé (tests) ; aléatoire par défaut.
  token?: string;
  sessionTtlMs?: number;
  now?: () => number;
}

export interface UiServer {
  // URL à ouvrir (contient le jeton).
  url: string;
  origin: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

interface UiSession {
  id: string;
  dir: string;
  createdAt: number;
  pack: ModPack;
  packFile: string;
  analysis: AnalysisResult;
  maxAlternatives: number;
  files: Partial<Record<'mrpack' | 'report', string>>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Uint8Array,
  type: string,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

// Lit le corps de la requête en refusant au-delà de `limit` octets (413).
async function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, `Upload too large (limit ${Math.round(limit / 1024 / 1024)} MiB)`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    // Au-delà de la limite, le reste est lu sans être conservé (pour pouvoir répondre 413
    // proprement) ; au-delà de 4 fois la limite, la connexion est coupée.
    if (size > limit * 4) {
      req.destroy();
      break;
    }
    if (size <= limit) chunks.push(buffer);
  }
  if (size > limit) {
    throw new HttpError(413, `Upload too large (limit ${Math.round(limit / 1024 / 1024)} MiB)`);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  try {
    const value = JSON.parse(
      Buffer.from(await readBody(req, MAX_JSON_BYTES)).toString('utf8'),
    ) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Nom de fichier sûr pour Content-Disposition.
function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'download';
}

export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const maxUpload = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const sessionTtl = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const root = await mkdtemp(join(tmpdir(), 'modshift-ui-'));
  const sessions = new Map<string, UiSession>();
  const api = options.createApi({
    cache: options.cache,
    cacheTtlMs: options.cacheTtlMs,
    offline: options.offline,
  });
  let port = 0;

  const dropSession = async (id: string): Promise<void> => {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session) await rm(session.dir, { recursive: true, force: true });
  };
  const expire = async (): Promise<void> => {
    for (const session of [...sessions.values()]) {
      if (now() - session.createdAt > sessionTtl) await dropSession(session.id);
    }
  };
  const timer = setInterval(() => void expire(), 60_000);
  timer.unref();

  const getSession = (id: unknown): UiSession => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
      throw new HttpError(400, 'Invalid session id');
    }
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, 'Unknown or expired session: analyse the pack again');
    return session;
  };

  const analyze = async (req: IncomingMessage, url: URL): Promise<unknown> => {
    const target = parseTarget(
      url.searchParams.get('mc') ?? '',
      url.searchParams.get('loader') ?? '',
    );
    const maxAlternatives = Math.min(
      20,
      Math.max(0, Number(url.searchParams.get('maxAlternatives') ?? '3') || 0),
    );
    const fileName = safeFileName(url.searchParams.get('name') ?? 'pack.mrpack');
    const data = await readBody(req, maxUpload);
    if (data.byteLength === 0)
      throw new HttpError(400, 'Empty upload: drop a .mrpack or CurseForge .zip file');

    const id = randomUUID();
    const dir = join(root, id);
    await mkdir(dir);
    const packFile = join(dir, `upload-${fileName}`);
    await writeFile(packFile, data);
    try {
      const pack = await loadPack(packFile);
      await resolveCurseForge(pack);
      const analysis = await analyzePack(pack, target, api, {
        maxAlternatives,
        concurrency: options.concurrency,
      });
      const session: UiSession = {
        id,
        dir,
        createdAt: now(),
        pack,
        packFile,
        analysis,
        maxAlternatives,
        files: {},
      };
      sessions.set(id, session);
      return { sessionId: id, fileName, analysis, canMigrate: supportsMrpack(target.loader) };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  };

  const resolveCurseForge = async (pack: ModPack): Promise<void> => {
    if (!pack.mods.some((m) => m.curseforge)) return;
    const apiKey = curseForgeApiKey(env);
    if (!apiKey) {
      const warning = missingKeyWarning(pack);
      if (warning) pack.warnings.push(warning);
      return;
    }
    const cfOptions: CurseForgeClientOptions = {
      apiKey,
      cache: options.cache,
      offline: options.offline,
    };
    const client =
      options.createCurseForgeApi?.(cfOptions) ?? new DefaultCurseForgeClient(cfOptions);
    await resolveCurseForgeRefs(pack, client);
  };

  const migrate = async (req: IncomingMessage): Promise<unknown> => {
    const body = await readJson(req);
    const session = getSession(body.sessionId);
    const { target } = session.analysis;
    if (!supportsMrpack(target.loader)) {
      throw new HttpError(
        400,
        `${getLoader(target.loader).name} cannot be the target of a .mrpack`,
      );
    }
    const explicit =
      typeof body.loaderVersion === 'string' && body.loaderVersion.trim()
        ? body.loaderVersion.trim()
        : undefined;
    const loaderVersion = resolveLoaderVersion(session.pack, target, explicit);
    if (!loaderVersion.version) {
      throw new HttpError(
        400,
        `Enter the ${getLoader(target.loader).name} version to write into the pack`,
        getLoader(target.loader).website,
      );
    }
    // Avec les alternatives, l'analyse est refaite (réponses en cache) pour les adopter.
    const analysis =
      body.includeAlternatives === true
        ? await analyzePack(session.pack, target, api, {
            maxAlternatives: session.maxAlternatives,
            adoptAlternatives: true,
            concurrency: options.concurrency,
          })
        : session.analysis;
    const plan = buildMigrationPlan(session.pack, analysis, {
      loaderVersion: loaderVersion.version,
      loaderVersionSource: 'option',
    });
    const overrides = collectOverrides(
      new Uint8Array(await readFile(session.packFile)),
      session.pack,
    );
    const archive = buildMrpackArchive(plan.index, overrides.files);
    const mrpack = join(session.dir, 'migrated.mrpack');
    const report = join(session.dir, MIGRATION_REPORT_FILE);
    await writeFile(mrpack, archive);
    await writeFile(report, renderMigrationReport(plan, analysis, 'migrated.mrpack'));
    session.files = { mrpack, report };
    return {
      included: plan.mods.map((m) => ({
        title: m.title,
        source: m.source,
        version: m.version.versionNumber,
      })),
      excluded: plan.excluded.map((m) => m.project?.title ?? m.fileName),
      loaderVersion: loaderVersion.version,
      downloads: {
        mrpack: `/api/sessions/${session.id}/download/mrpack`,
        report: `/api/sessions/${session.id}/download/report`,
      },
    };
  };

  const download = async (res: ServerResponse, id: string, kind: string): Promise<void> => {
    const session = getSession(id);
    const base = safeFileName(session.analysis.pack.name ?? 'modpack');
    const { minecraftVersion, loader } = session.analysis.target;
    if (kind === 'analysis') {
      send(res, 200, renderJson(session.analysis), 'application/json; charset=utf-8', {
        'Content-Disposition': `attachment; filename="${base}-analysis.json"`,
      });
      return;
    }
    const file =
      kind === 'mrpack'
        ? session.files.mrpack
        : kind === 'report'
          ? session.files.report
          : undefined;
    if (!file)
      throw new HttpError(
        404,
        kind === 'mrpack' || kind === 'report'
          ? 'Build the migrated pack first'
          : 'Unknown download',
      );
    const name =
      kind === 'mrpack' ? `${base}-${minecraftVersion}-${loader}.mrpack` : MIGRATION_REPORT_FILE;
    send(
      res,
      200,
      await readFile(file),
      kind === 'mrpack' ? 'application/x-modrinth-modpack+zip' : 'text/markdown; charset=utf-8',
      {
        'Content-Disposition': `attachment; filename="${safeFileName(name)}"`,
      },
    );
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Anti DNS rebinding : seul l'hôte local exact est accepté.
    const host = req.headers.host ?? '';
    if (host !== `${UI_HOST}:${port}` && host !== `localhost:${port}`) {
      throw new HttpError(403, 'Forbidden host');
    }
    const url = new URL(req.url ?? '/', `http://${UI_HOST}:${port}`);
    const method = req.method ?? 'GET';

    const asset = STATIC_FILES[url.pathname];
    if (asset) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      send(res, 200, await readFile(join(PUBLIC_DIR, asset.file)), asset.type);
      return;
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (!sameToken(req.headers[TOKEN_HEADER] as string | undefined, token)) {
      throw new HttpError(
        401,
        'Missing or invalid session token: open the URL printed by "modshift ui"',
      );
    }

    if (method === 'GET' && url.pathname === '/api/info') {
      sendJson(res, 200, {
        version: MODSHIFT_VERSION,
        offline: options.offline ?? false,
        maxUploadBytes: maxUpload,
        loaders: LOADER_DEFINITIONS.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          mrpack: 'mrpackKey' in d,
        })),
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/analyze') {
      sendJson(res, 200, await analyze(req, url));
      return;
    }
    if (method === 'POST' && url.pathname === '/api/migrate') {
      sendJson(res, 200, await migrate(req));
      return;
    }
    const match = /^\/api\/sessions\/([^/]+)\/download\/([a-z]+)$/.exec(url.pathname);
    if (method === 'GET' && match?.[1] && match[2]) {
      await download(res, match[1], match[2]);
      return;
    }
    const del = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (method === 'DELETE' && del?.[1]) {
      getSession(del[1]);
      await dropSession(del[1]);
      sendJson(res, 200, { deleted: true });
      return;
    }
    throw new HttpError(404, 'Not found');
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, hint: error.hint });
        return;
      }
      const described = describeError(error);
      if (described) {
        // Erreurs de l'API distante (réseau, quota, Modrinth/CurseForge) : 502 ; entrées : 400.
        const upstream =
          error instanceof ModrinthNetworkError ||
          error instanceof ModrinthApiError ||
          error instanceof RateLimitError ||
          error instanceof OfflineCacheMissError ||
          error instanceof CurseForgeApiError ||
          error instanceof CurseForgeNetworkError;
        const status = upstream ? 502 : 400;
        sendJson(res, status, { error: described.message, hint: described.hint });
        return;
      }
      sendJson(res, 500, { error: 'Internal error (see the terminal running "modshift ui")' });
      process.stderr.write(
        `modshift ui: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    });
  });
  server.requestTimeout = 10 * 60 * 1000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Jamais 0.0.0.0 : uniquement l'interface locale.
    server.listen(options.port ?? 0, UI_HOST, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const origin = `http://${UI_HOST}:${port}`;

  return {
    url: `${origin}/?token=${token}`,
    origin,
    port,
    token,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await rm(root, { recursive: true, force: true });
    },
  };
}
