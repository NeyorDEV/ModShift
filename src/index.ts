// API publique du paquet npm `modshift` (utilisation programmatique, hors CLI).

export { analyzePack, type AnalyzeOptions } from './core/engine.js';
export type * from './core/types.js';
export { MOD_STATUSES, ALTERNATIVE_NOTE } from './core/types.js';
export { acceptedLoaders, pickBestVersion } from './core/loaders.js';
export type { ModrinthApi } from './core/refs.js';

export {
  loadPack,
  parseMrpack,
  parseCurseForgeZip,
  parseModsFolder,
  InputError,
} from './input/index.js';

export {
  ModrinthClient,
  DEFAULT_USER_AGENT,
  type ModrinthClientOptions,
  type ClientEvent,
} from './modrinth/client.js';
export { FileCache, MemoryCache, defaultCacheDir, type ResponseCache } from './modrinth/cache.js';
export {
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimitError,
} from './modrinth/errors.js';

export { CurseForgeClient, curseForgeApiKey } from './curseforge/client.js';
export { resolveCurseForgeRefs } from './curseforge/resolve.js';

export { buildMigrationPlan, type MigrationPlan, type PlannedMod } from './migrate/plan.js';
export { buildMrpackArchive, collectOverrides, InvalidMrpackError } from './migrate/writer.js';
export {
  validateMrpackArchive,
  validateMrpackIndex,
  type MrpackIndex,
} from './migrate/mrpackSpec.js';
export { renderMigrationReport } from './migrate/report.js';

export { renderReport, renderJson, renderMarkdown, renderTable } from './report/index.js';
export { loadConfig, validateConfig, type ModShiftConfig } from './config/config.js';

// Sources de mods (plugins) : voir docs/plugins.md.
export {
  CANDIDATE_NOTE,
  createDefaultRegistry,
  curseForgeSource,
  findExternalCandidates,
  githubReleasesSource,
  modrinthSource,
  prepareWithSources,
  SourceRegistry,
  SourceRegistryError,
  type CandidateRequest,
  type ModSource,
  type SourceCandidate,
  type SourceContext,
} from './sources/index.js';

export type { Loader, MigrationTarget, ModEntry, ModPack } from './types.js';
export { LOADERS } from './types.js';
export { MODSHIFT_VERSION } from './version.js';
