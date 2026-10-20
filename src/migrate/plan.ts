import type { AnalysisResult, LoaderChange, ModAnalysis, VersionRef } from '../core/types.js';
import type { MigrationTarget, ModPack, PackIndexFile } from '../types.js';
import {
  type EnvValue,
  ENV_VALUES,
  isAllowedDownloadUrl,
  isSpecSafePath,
  MRPACK_FORMAT_VERSION,
  type MrpackFile,
  type MrpackIndex,
} from './mrpackSpec.js';
import { matchesModRef } from '../config/config.js';
import { getLoader } from '../loaders/registry.js';
import { MODSHIFT_VERSION } from '../version.js';

// Origine d'un mod dans le pack migré.
export type PlannedModSource = 'kept' | 'updated' | 'dependency' | 'alternative';

export interface PlannedMod {
  source: PlannedModSource;
  title: string;
  projectId: string;
  version: VersionRef;
  file: MrpackFile;
  // Fichier du pack d'origine remplacé (kept / updated / alternative).
  replaces?: string;
  requiredBy?: string[];
  // Mod identifié seulement par son mod id (le fichier d'origine n'est pas connu de Modrinth).
  unverified?: boolean;
  // Version retenue pour un loader de repli (« fallback compatibility, to test »).
  fallbackLoader?: string;
  // Même projet, version d'un autre loader (mod multi-loader), ex. { from: 'forge', to: 'fabric' }.
  loaderChange?: LoaderChange;
}

export type LoaderVersionSource = 'option' | 'config' | 'source-pack';

export interface MigrationPlan {
  target: MigrationTarget;
  loaderVersion?: string;
  loaderVersionSource?: LoaderVersionSource;
  index: MrpackIndex;
  mods: PlannedMod[];
  // Fichiers non-mods de l'index d'origine repris tels quels (non vérifiés).
  keptFiles: MrpackFile[];
  // Fichiers non repris, avec la raison.
  droppedFiles: { path: string; reason: string }[];
  // Mods du pack d'origine absents du pack migré.
  excluded: ModAnalysis[];
  warnings: string[];
}

export interface PlanOptions {
  loaderVersion?: string;
  // Provenance de `loaderVersion` (--loader-version ou modshift.config.json).
  loaderVersionSource?: 'option' | 'config';
  // Liste « exclude » de modshift.config.json : mods retirés du pack migré.
  exclude?: string[];
}

// Version du loader cible : option explicite, sinon celle du pack source si le loader
// et la version de Minecraft sont identiques. Sinon inconnue (l'utilisateur doit la fournir).
export function resolveLoaderVersion(
  pack: ModPack,
  target: MigrationTarget,
  explicit?: string,
  explicitSource: 'option' | 'config' = 'option',
): { version?: string; source?: LoaderVersionSource } {
  if (explicit) return { version: explicit, source: explicitSource };
  if (
    pack.loaderVersion &&
    pack.loader === target.loader &&
    pack.minecraftVersion === target.minecraftVersion
  ) {
    return { version: pack.loaderVersion, source: 'source-pack' };
  }
  return {};
}

function normalizeEnv(env: ModPack['mods'][number]['env']): MrpackFile['env'] {
  if (!env) return undefined;
  const client = ENV_VALUES.includes(env.client ?? '') ? (env.client as EnvValue) : undefined;
  const server = ENV_VALUES.includes(env.server ?? '') ? (env.server as EnvValue) : undefined;
  return client && server ? { client, server } : undefined;
}

// Construit l'entrée d'index d'une version Modrinth ; renvoie la raison si impossible.
function fileFromVersion(
  version: VersionRef,
  env: MrpackFile['env'],
): MrpackFile | { error: string } {
  const file = version.file;
  if (!file) return { error: 'the Modrinth version has no file' };
  const path = `mods/${file.fileName}`;
  if (!isSpecSafePath(path) || file.fileName.includes('/')) {
    return { error: `unsafe file name "${file.fileName}"` };
  }
  if (!isAllowedDownloadUrl(file.url)) {
    return { error: `download URL not allowed by the .mrpack format (${file.url})` };
  }
  return {
    path,
    hashes: { sha1: file.sha1, sha512: file.sha512 },
    ...(env ? { env } : {}),
    downloads: [file.url],
    fileSize: file.size,
  };
}

// Fichier non-mod de l'index d'origine : repris seulement s'il respecte encore le format.
function keptIndexFile(file: PackIndexFile): MrpackFile | { error: string } {
  const { sha1, sha512 } = file.hashes;
  if (!sha1 || !sha512) return { error: 'missing sha1 or sha512 hash' };
  if (file.downloads.length === 0 || !file.downloads.every(isAllowedDownloadUrl)) {
    return { error: 'download URL missing or not allowed by the .mrpack format' };
  }
  if (file.fileSize === undefined) return { error: 'missing fileSize' };
  const env = normalizeEnv(file.env);
  return {
    path: file.path,
    hashes: { sha1, sha512 },
    ...(env ? { env } : {}),
    downloads: file.downloads,
    fileSize: file.fileSize,
  };
}

// Titres des mods exclus par la configuration (pour écarter leurs dépendances).
function excludedByConfigTitles(excluded: ModAnalysis[], hasExcludeRules: boolean): string[] {
  if (!hasExcludeRules) return [];
  return excluded
    .filter((m) => m.reason?.startsWith('Excluded by modshift.config.json'))
    .flatMap((m) => (m.project ? [m.project.title] : []));
}

export function buildMigrationPlan(
  pack: ModPack,
  analysis: AnalysisResult,
  options: PlanOptions = {},
): MigrationPlan {
  const target = analysis.target;
  const { version: loaderVersion, source: loaderVersionSource } = resolveLoaderVersion(
    pack,
    target,
    options.loaderVersion,
    options.loaderVersionSource,
  );
  const warnings: string[] = [];
  const mods: PlannedMod[] = [];
  const excluded: ModAnalysis[] = [];
  const droppedFiles: MigrationPlan['droppedFiles'] = [];
  const projectIds = new Set<string>();
  const paths = new Set<string>();

  // Ajoute un mod s'il n'est pas déjà présent (même projet ou même chemin).
  const add = (mod: Omit<PlannedMod, 'file'>, env: MrpackFile['env']): boolean => {
    if (projectIds.has(mod.projectId)) return true;
    const file = fileFromVersion(mod.version, env);
    if ('error' in file) {
      warnings.push(`${mod.title}: not included, ${file.error}`);
      return false;
    }
    if (paths.has(file.path)) {
      warnings.push(`${mod.title}: not included, ${file.path} is already used by another mod`);
      return false;
    }
    projectIds.add(mod.projectId);
    paths.add(file.path);
    mods.push({ ...mod, file });
    return true;
  };

  const envByPath = new Map(pack.mods.map((m) => [m.path, normalizeEnv(m.env)]));
  for (const mod of analysis.mods) {
    const env = envByPath.get(mod.path);
    const excludeRule = options.exclude?.find((pattern) =>
      matchesModRef(pattern, {
        fileName: mod.fileName,
        slug: mod.project?.slug,
        projectId: mod.project?.id,
      }),
    );
    if (excludeRule) {
      excluded.push({
        ...mod,
        reason: `Excluded by modshift.config.json (rule "${excludeRule}").`,
      });
      continue;
    }
    if (
      (mod.status === 'compatible' || mod.status === 'update-found') &&
      mod.project &&
      mod.targetVersion
    ) {
      const ok = add(
        {
          source: mod.status === 'compatible' ? 'kept' : 'updated',
          title: mod.project.title,
          projectId: mod.project.id,
          version: mod.targetVersion,
          replaces: mod.fileName,
          ...(mod.identification === 'mod-id' ? { unverified: true } : {}),
          ...(mod.fallback ? { fallbackLoader: mod.fallback.loader } : {}),
          ...(mod.loaderChange ? { loaderChange: mod.loaderChange } : {}),
        },
        env,
      );
      if (!ok) excluded.push(mod);
      continue;
    }
    const adopted = mod.adoptedAlternative;
    if (adopted) {
      const ok = add(
        {
          source: 'alternative',
          title: adopted.project.title,
          projectId: adopted.project.id,
          version: adopted.version,
          replaces: mod.fileName,
        },
        env,
      );
      // Le mod d'origine reste listé comme exclu : l'alternative n'est qu'une suggestion.
      if (!ok) warnings.push(`${mod.fileName}: adopted alternative could not be included`);
    }
    excluded.push(mod);
  }

  // Une dépendance ajoutée uniquement pour des mods exclus n'a plus de raison d'être.
  const excludedTitles = new Set(excludedByConfigTitles(excluded, options.exclude !== undefined));
  for (const dep of analysis.dependencies.added) {
    if (excludedTitles.size > 0 && dep.requiredBy.every((title) => excludedTitles.has(title))) {
      warnings.push(`${dep.project.title}: not added, only required by excluded mods`);
      continue;
    }
    add(
      {
        source: 'dependency',
        title: dep.project.title,
        projectId: dep.project.id,
        version: dep.version,
        requiredBy: dep.requiredBy,
        ...(dep.fallback ? { fallbackLoader: dep.fallback.loader } : {}),
      },
      undefined,
    );
  }

  const keptFiles: MrpackFile[] = [];
  for (const file of pack.indexFiles ?? []) {
    const kept = keptIndexFile(file);
    if ('error' in kept) {
      droppedFiles.push({ path: file.path, reason: kept.error });
    } else if (paths.has(kept.path)) {
      droppedFiles.push({ path: file.path, reason: 'duplicated path' });
    } else {
      paths.add(kept.path);
      keptFiles.push(kept);
    }
  }

  const mrpackKey = getLoader(target.loader).mrpackKey;
  const sourceLabel = [pack.minecraftVersion, pack.loader].filter(Boolean).join(' ') || 'unknown';
  const name = `${pack.name ?? 'Migrated pack'} (${target.minecraftVersion} ${target.loader})`;
  const index: MrpackIndex = {
    formatVersion: MRPACK_FORMAT_VERSION,
    game: 'minecraft',
    versionId: `${pack.version ?? '1.0.0'}+${target.loader}-${target.minecraftVersion}`.slice(
      0,
      512,
    ),
    name: name.slice(0, 512),
    summary: `Migrated by ModShift ${MODSHIFT_VERSION} from ${sourceLabel} to ${target.minecraftVersion} ${target.loader}.`,
    files: [...mods.map((m) => m.file), ...keptFiles],
    dependencies: {
      minecraft: target.minecraftVersion,
      ...(loaderVersion && mrpackKey ? { [mrpackKey]: loaderVersion } : {}),
    },
  };

  return {
    target,
    loaderVersion,
    loaderVersionSource,
    index,
    mods,
    keptFiles,
    droppedFiles,
    excluded,
    warnings,
  };
}
