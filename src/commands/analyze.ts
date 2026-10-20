import { writeFile } from 'node:fs/promises';
import { analyzePack } from '../core/engine.js';
import type { ModrinthApi } from '../core/refs.js';
import type { AnalysisResult } from '../core/types.js';
import { loadConfig, type ModShiftConfig } from '../config/config.js';
import type { Prompter } from '../interactive/prompter.js';
import { loadPack } from '../input/index.js';
import { DEFAULT_CACHE_TTL_MS, defaultCacheDir, FileCache } from '../modrinth/cache.js';
import { formatDuration, parseDuration } from '../duration.js';
import type { ModrinthClientOptions } from '../modrinth/client.js';
import { REPORT_FORMATS, renderReport, type ReportFormat } from '../report/index.js';
import { createLogger, type Logger } from './logger.js';
import {
  CurseForgeClient,
  type CurseForgeClientOptions,
  curseForgeApiKey,
} from '../curseforge/client.js';
import { missingKeyWarning, resolveCurseForgeRefs } from '../curseforge/resolve.js';
import { isLoader, LOADERS, type MigrationTarget, type ModPack } from '../types.js';

export interface AnalyzeCommandOptions {
  mc?: string;
  loader?: string;
  // Chemin de modshift.config.json, ou false avec --no-config.
  config?: string | false;
  format: string;
  output?: string;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
  cacheTtl?: string;
  maxAlternatives: string;
  quiet: boolean;
  verbose?: boolean;
  color: boolean;
}

// Dépendances injectables de la CLI (les tests remplacent le client et les sorties).
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  // stdout est-il un terminal (couleurs du tableau) ?
  isTTY: boolean;
  // stderr est-il un terminal (barre de progression) ?
  stderrIsTTY: boolean;
  columns?: number;
  createApi: (options: ModrinthClientOptions) => ModrinthApi;
  // Client CurseForge (optionnel : les tests injectent un faux serveur).
  createCurseForgeApi?: (options: CurseForgeClientOptions) => CurseForgeClient;
  // Variables d'environnement (CURSEFORGE_API_KEY, MODSHIFT_CACHE_TTL) ; process.env par défaut.
  env?: NodeJS.ProcessEnv;
  // Dossier courant (recherche de modshift.config.json) ; process.cwd() par défaut.
  cwd?: string;
  // Mode interactif : l'entrée standard est-elle un terminal, et comment poser les questions.
  stdinIsTTY?: boolean;
  createPrompter?: () => Promise<Prompter>;
  setExitCode: (code: number) => void;
}

// Erreur d'utilisation (option invalide) : message clair, sans pile d'appels.
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const MC_VERSION_PATTERN =
  /^[0-9]+\.[0-9]+(\.[0-9]+)?([-+.][0-9A-Za-z.-]+)?$|^[0-9]{2}w[0-9]{2}[a-z]$/;

export function parseTarget(mc: string, loader: string): MigrationTarget {
  const normalizedLoader = loader.trim().toLowerCase();
  if (!isLoader(normalizedLoader)) {
    throw new UsageError(`Invalid loader "${loader}" (expected one of: ${LOADERS.join(', ')})`);
  }
  if (!MC_VERSION_PATTERN.test(mc.trim())) {
    throw new UsageError(`Invalid Minecraft version "${mc}" (example: 1.21.1)`);
  }
  return { minecraftVersion: mc.trim(), loader: normalizedLoader };
}

function parseFormat(format: string): ReportFormat {
  const normalized = format.trim().toLowerCase();
  const alias = normalized === 'md' ? 'markdown' : normalized;
  if (!(REPORT_FORMATS as readonly string[]).includes(alias)) {
    throw new UsageError(
      `Invalid format "${format}" (expected one of: ${REPORT_FORMATS.join(', ')})`,
    );
  }
  return alias as ReportFormat;
}

export function parseMaxAlternatives(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 20) {
    throw new UsageError(
      `Invalid --max-alternatives "${value}" (expected an integer from 0 to 20)`,
    );
  }
  return n;
}

export async function runAnalyze(
  packPath: string,
  options: AnalyzeCommandOptions,
  io: CliIo,
): Promise<AnalysisResult> {
  const format = parseFormat(options.format);
  const maxAlternatives = parseMaxAlternatives(options.maxAlternatives);
  const session = createSession(options, io);
  const { config, target } = await loadSettings(options, session.logger, io);
  const pack = await loadPack(packPath);
  session.logger.info(`Loaded ${pack.mods.length} mod(s) from ${packPath} (${pack.source}).`);
  await session.prepare(pack);

  const result = await analyzePack(pack, target, session.api, {
    maxAlternatives,
    ignore: config.ignore,
    mappings: config.mappings,
    ...session.progress,
  });
  session.logger.endProgress();

  const color = options.color && io.isTTY && !options.output && !process.env.NO_COLOR;
  const report = renderReport(result, format, { color });
  if (options.output) {
    await writeFile(options.output, report);
    session.logger.info(`Report written to ${options.output}`);
  } else {
    io.stdout(report);
  }
  return result;
}

// Options communes aux commandes qui interrogent Modrinth.
export interface SessionOptions {
  quiet: boolean;
  verbose?: boolean;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
  // Durée de validité du cache (« 12h », « 7d », « 0 »…) ; sinon $MODSHIFT_CACHE_TTL, sinon 24 h.
  cacheTtl?: string;
}

export interface Settings {
  config: ModShiftConfig;
  configPath?: string;
  target: MigrationTarget;
}

// Charge modshift.config.json (sauf --no-config) et en déduit la cible : les options de la ligne
// de commande l'emportent sur la configuration.
export async function loadSettings(
  options: { config?: string | false; mc?: string; loader?: string },
  logger: Logger,
  io: CliIo,
): Promise<Settings> {
  const { config, path } =
    options.config === false
      ? { config: {} as ModShiftConfig, path: undefined }
      : await loadConfig(options.config, io.cwd ?? process.cwd());
  if (path) logger.info(`Using configuration ${path}`);
  const mc = options.mc ?? config.target?.minecraftVersion;
  const loader = options.loader ?? config.target?.loader;
  if (!mc) {
    throw new UsageError(
      'missing target Minecraft version: pass --mc <version> or set "target.minecraftVersion" in modshift.config.json',
    );
  }
  if (!loader) {
    throw new UsageError(
      'missing target loader: pass --loader <loader> or set "target.loader" in modshift.config.json',
    );
  }
  return { config, configPath: path, target: parseTarget(mc, loader) };
}

export interface Session {
  logger: Logger;
  api: ModrinthApi;
  // Rappels de progression à passer à analyzePack.
  progress: { onProgress: (message: string) => void; onProgressTick: Logger['progress'] };
  // Étapes à appliquer au pack chargé avant l'analyse (résolution CurseForge).
  prepare: (pack: ModPack) => Promise<void>;
}

// Durée de validité du cache : option, puis variable d'environnement, puis 24 h par défaut.
export function resolveCacheTtl(
  option: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = option ?? env.MODSHIFT_CACHE_TTL;
  if (raw === undefined || raw === '') return DEFAULT_CACHE_TTL_MS;
  const ms = parseDuration(raw);
  if (ms === undefined) {
    const source = option !== undefined ? '--cache-ttl' : 'MODSHIFT_CACHE_TTL';
    throw new UsageError(
      `Invalid ${source} "${raw}" (expected a duration such as 30m, 12h, 7d, or 0 to always refresh)`,
    );
  }
  return ms;
}

// Prépare le journal (quiet / normal / verbose) et le client Modrinth (cache, hors-ligne, logs).
export function createSession(options: SessionOptions, io: CliIo): Session {
  if (options.quiet && options.verbose) {
    throw new UsageError('--quiet and --verbose cannot be used together');
  }
  if (options.offline && !options.cache) {
    throw new UsageError('--offline needs the cache: remove --no-cache');
  }
  const logger = createLogger({
    write: io.stderr,
    level: options.quiet ? 'quiet' : options.verbose ? 'verbose' : 'normal',
    isTTY: io.stderrIsTTY,
    width: io.columns,
  });
  const env = io.env ?? process.env;
  const cacheDir = options.cacheDir ?? defaultCacheDir(env);
  const cacheTtlMs = resolveCacheTtl(options.cacheTtl, env);
  if (options.cache) {
    logger.debug(`cache directory: ${cacheDir} (entries valid for ${formatDuration(cacheTtlMs)})`);
  }
  const api = io.createApi({
    cache: options.cache ? new FileCache(cacheDir) : undefined,
    cacheTtlMs,
    offline: options.offline,
    onEvent: (event) => logger.clientEvent(event),
  });
  const cache = options.cache ? new FileCache(cacheDir) : undefined;
  const prepare = async (pack: ModPack): Promise<void> => {
    if (!pack.mods.some((m) => m.curseforge)) return;
    const apiKey = curseForgeApiKey(env);
    if (!apiKey) {
      // Sans clé, la résolution CurseForge est simplement désactivée (pas une erreur).
      const warning = missingKeyWarning(pack);
      if (warning) pack.warnings.push(warning);
      return;
    }
    const count = pack.mods.filter((m) => m.curseforge).length;
    logger.info(`Resolving ${count} CurseForge file reference(s)…`);
    const clientOptions: CurseForgeClientOptions = {
      apiKey,
      cache,
      cacheTtlMs,
      offline: options.offline,
    };
    const client = io.createCurseForgeApi
      ? io.createCurseForgeApi(clientOptions)
      : new CurseForgeClient(clientOptions);
    const result = await resolveCurseForgeRefs(pack, client);
    logger.debug(`CurseForge: ${result.resolved} resolved, ${result.unresolved} unresolved`);
  };
  return {
    logger,
    api,
    prepare,
    progress: {
      onProgress: (message) => logger.info(message),
      onProgressTick: (done, total, label) => logger.progress(done, total, label),
    },
  };
}
