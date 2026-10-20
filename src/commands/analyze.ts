import { writeFile } from 'node:fs/promises';
import { analyzePack } from '../core/engine.js';
import type { ModrinthApi } from '../core/refs.js';
import type { AnalysisResult } from '../core/types.js';
import { loadPack } from '../input/index.js';
import { defaultCacheDir, FileCache } from '../modrinth/cache.js';
import type { ModrinthClientOptions } from '../modrinth/client.js';
import { REPORT_FORMATS, renderReport, type ReportFormat } from '../report/index.js';
import { createLogger, type Logger } from './logger.js';
import { isLoader, LOADERS, type MigrationTarget } from '../types.js';

export interface AnalyzeCommandOptions {
  mc: string;
  loader: string;
  format: string;
  output?: string;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
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
  const target = parseTarget(options.mc, options.loader);
  const format = parseFormat(options.format);
  const maxAlternatives = parseMaxAlternatives(options.maxAlternatives);
  const session = createSession(options, io);
  const pack = await loadPack(packPath);
  session.logger.info(`Loaded ${pack.mods.length} mod(s) from ${packPath} (${pack.source}).`);

  const result = await analyzePack(pack, target, session.api, {
    maxAlternatives,
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
}

export interface Session {
  logger: Logger;
  api: ModrinthApi;
  // Rappels de progression à passer à analyzePack.
  progress: { onProgress: (message: string) => void; onProgressTick: Logger['progress'] };
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
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  if (options.cache) logger.debug(`cache directory: ${cacheDir}`);
  const api = io.createApi({
    cache: options.cache ? new FileCache(cacheDir) : undefined,
    offline: options.offline,
    onEvent: (event) => logger.clientEvent(event),
  });
  return {
    logger,
    api,
    progress: {
      onProgress: (message) => logger.info(message),
      onProgressTick: (done, total, label) => logger.progress(done, total, label),
    },
  };
}
