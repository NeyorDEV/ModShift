import { writeFile } from 'node:fs/promises';
import { analyzePack } from '../core/engine.js';
import type { ModrinthApi } from '../core/refs.js';
import type { AnalysisResult } from '../core/types.js';
import { CONFIG_FILE, ConfigError, loadConfig, type ModShiftConfig } from '../config/config.js';
import type { Prompter } from '../interactive/prompter.js';
import { loadPack } from '../input/index.js';
import { DEFAULT_CACHE_TTL_MS, defaultCacheDir, FileCache } from '../modrinth/cache.js';
import { formatDuration, parseDuration } from '../duration.js';
import type { FetchLike, ModrinthClientOptions } from '../modrinth/client.js';
import { REPORT_FORMATS, renderReport, type ReportFormat } from '../report/index.js';
import { createLogger, type Logger } from './logger.js';
import { CurseForgeClient, type CurseForgeClientOptions } from '../curseforge/client.js';
import {
  createDefaultRegistry,
  findExternalCandidates,
  type ModSource,
  prepareWithSources,
  type SourceContext,
  type SourceRegistry,
} from '../sources/index.js';
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from '../concurrency.js';
import { TARGET_SIDES, type TargetSide } from '../core/sides.js';
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
  // client, server ou both (défaut : target.side de la config, sinon both).
  side?: string;
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
  // fetch des sources HTTP tierces (GitHub Releases) ; fetch global par défaut.
  fetch?: FetchLike;
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

export function parseSide(value: string): TargetSide {
  const normalized = value.trim().toLowerCase();
  if (!(TARGET_SIDES as readonly string[]).includes(normalized)) {
    throw new UsageError(`Invalid --side "${value}" (expected one of: ${TARGET_SIDES.join(', ')})`);
  }
  return normalized as TargetSide;
}

export function parseConcurrency(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENCY) {
    throw new UsageError(
      `Invalid --concurrency "${value}" (expected an integer from 1 to ${MAX_CONCURRENCY})`,
    );
  }
  return n;
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
  const { config, target, side } = await loadSettings(
    options,
    session.logger,
    io,
    session.registry,
  );
  const pack = await loadPack(packPath);
  session.logger.info(`Loaded ${pack.mods.length} mod(s) from ${packPath} (${pack.source}).`);
  await session.prepare(pack, config);

  const result = await analyzePack(pack, target, session.api, {
    maxAlternatives,
    concurrency: session.concurrency,
    side,
    ignore: config.ignore,
    mappings: config.mappings,
    ...session.progress,
  });
  session.logger.endProgress();
  await session.findCandidates(result, pack, config);

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
  // Requêtes simultanées (--concurrency) ; 4 par défaut.
  concurrency?: string;
}

export interface Settings {
  config: ModShiftConfig;
  configPath?: string;
  target: MigrationTarget;
  side: TargetSide;
}

// Charge modshift.config.json (sauf --no-config) et en déduit la cible : les options de la ligne
// de commande l'emportent sur la configuration.
export async function loadSettings(
  options: { config?: string | false; mc?: string; loader?: string; side?: string },
  logger: Logger,
  io: CliIo,
  registry?: SourceRegistry,
): Promise<Settings> {
  const { config, path } =
    options.config === false
      ? { config: {} as ModShiftConfig, path: undefined }
      : await loadConfig(options.config, io.cwd ?? process.cwd());
  if (path) logger.info(`Using configuration ${path}`);
  if (registry && config.sources) {
    try {
      registry.validateOptions(config.sources);
    } catch (error) {
      throw new ConfigError(path ?? CONFIG_FILE, (error as Error).message);
    }
  }
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
  const side =
    options.side !== undefined ? parseSide(options.side) : (config.target?.side ?? 'both');
  return { config, configPath: path, target: parseTarget(mc, loader), side };
}

export interface Session {
  logger: Logger;
  api: ModrinthApi;
  // Rappels de progression à passer à analyzePack.
  progress: { onProgress: (message: string) => void; onProgressTick: Logger['progress'] };
  // Requêtes simultanées à passer à analyzePack.
  concurrency: number;
  // Sources de mods (registre extensible).
  registry: SourceRegistry;
  // Étapes à appliquer au pack chargé avant l'analyse (résolution CurseForge).
  prepare: (pack: ModPack, config?: ModShiftConfig) => Promise<void>;
  // Fichiers proposés par les autres sources pour les mods sans version Modrinth.
  findCandidates: (result: AnalysisResult, pack: ModPack, config?: ModShiftConfig) => Promise<void>;
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
  const concurrency = parseConcurrency(options.concurrency);
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
  const registry = createDefaultRegistry({
    fetch: io.fetch,
    createCurseForgeClient: (apiKey) => {
      const clientOptions: CurseForgeClientOptions = {
        apiKey,
        cache,
        cacheTtlMs,
        offline: options.offline,
      };
      return io.createCurseForgeApi
        ? io.createCurseForgeApi(clientOptions)
        : new CurseForgeClient(clientOptions);
    },
  });
  const contextFor =
    (config: ModShiftConfig, warnings: string[]) =>
    (source: ModSource): SourceContext => ({
      env,
      options: config.sources?.[source.id],
      offline: options.offline,
      warn: (message) => warnings.push(message),
      log: (message) => logger.info(message),
      debug: (message) => logger.debug(message),
    });
  // Sources de mods : CurseForge complète le pack avant l'analyse ; GitHub Releases (si
  // configuré) propose ensuite des fichiers pour les mods introuvables.
  const prepare = (pack: ModPack, config: ModShiftConfig = {}): Promise<void> =>
    prepareWithSources(pack, registry, contextFor(config, pack.warnings));
  const findCandidates = (
    result: AnalysisResult,
    pack: ModPack,
    config: ModShiftConfig = {},
  ): Promise<void> =>
    findExternalCandidates(result, pack, registry, contextFor(config, result.warnings));
  return {
    logger,
    api,
    registry,
    prepare,
    findCandidates,
    concurrency,
    progress: {
      onProgress: (message) => logger.info(message),
      onProgressTick: (done, total, label) => logger.progress(done, total, label),
    },
  };
}
