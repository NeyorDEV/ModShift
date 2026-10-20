import type { ModrinthProject, ModrinthVersion } from '../modrinth/types.js';
import type { MigrationTarget, ModEntry, ModPack } from '../types.js';
import { findAlternatives } from './alternatives.js';
import { resolveDependencies, type SelectedVersion } from './dependencies.js';
import { acceptedLoaders, pickBestVersion, versionSupportsTarget } from './loaders.js';
import { type ModrinthApi, toProjectRef, toVersionRef } from './refs.js';
import {
  type AdoptedAlternative,
  ALTERNATIVE_NOTE,
  type Alternative,
  type AnalysisResult,
  type ModAnalysis,
  MOD_STATUSES,
  type ModStatus,
} from './types.js';

export interface AnalyzeOptions {
  // Nombre maximal d'alternatives proposées par mod introuvable (0 pour désactiver).
  maxAlternatives?: number;
  // Adopte la meilleure alternative (la première ayant une version pour la cible) :
  // elle entre dans la liste finale et ses dépendances sont résolues. Reste une suggestion.
  adoptAlternatives?: boolean;
  onProgress?: (message: string) => void;
}

interface Identified {
  project: ModrinthProject;
  currentVersion?: ModrinthVersion;
  by: 'hash' | 'mod-id';
}

// Étape 1 : identification par hash (SHA-1 de préférence, SHA-512 sinon) via POST /version_files.
async function identifyByHash(
  api: ModrinthApi,
  mods: ModEntry[],
): Promise<Map<ModEntry, ModrinthVersion>> {
  const result = new Map<ModEntry, ModrinthVersion>();
  const sha1Mods = mods.filter((m) => m.hashes.sha1);
  const sha512Mods = mods.filter((m) => !m.hashes.sha1 && m.hashes.sha512);
  if (sha1Mods.length > 0) {
    const found = await api.getVersionsFromHashes(
      sha1Mods.map((m) => m.hashes.sha1 ?? ''),
      'sha1',
    );
    for (const m of sha1Mods) {
      const version = found[m.hashes.sha1 ?? ''];
      if (version) result.set(m, version);
    }
  }
  if (sha512Mods.length > 0) {
    const found = await api.getVersionsFromHashes(
      sha512Mods.map((m) => m.hashes.sha512 ?? ''),
      'sha512',
    );
    for (const m of sha512Mods) {
      const version = found[m.hashes.sha512 ?? ''];
      if (version) result.set(m, version);
    }
  }
  return result;
}

// Étape 2 (repli) : un jar inconnu de Modrinth mais dont le mod id correspond à un slug.
// Identification non vérifiée (le fichier n'est pas celui publié sur Modrinth).
async function identifyByModId(
  api: ModrinthApi,
  entry: ModEntry,
): Promise<ModrinthProject | undefined> {
  const modIds = [...new Set(entry.metadata.map((m) => m.modId))];
  for (const modId of modIds) {
    const candidates = [...new Set([modId, modId.replace(/_/g, '-')])];
    for (const slug of candidates) {
      const project = await api.getProject(slug);
      if (project && project.project_type === 'mod') return project;
    }
  }
  return undefined;
}

export function emptySummary(): Record<ModStatus, number> {
  return Object.fromEntries(MOD_STATUSES.map((s) => [s, 0])) as Record<ModStatus, number>;
}

// Analyse un modpack pour une cible (version de Minecraft + loader).
export async function analyzePack(
  pack: ModPack,
  target: MigrationTarget,
  api: ModrinthApi,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const maxAlternatives = options.maxAlternatives ?? 3;
  const progress = options.onProgress ?? (() => undefined);
  const warnings = [...pack.warnings];

  progress(`Identifying ${pack.mods.length} mod file(s) on Modrinth…`);
  const byHash = await identifyByHash(api, pack.mods);
  const projects = new Map(
    (await api.getProjects([...new Set([...byHash.values()].map((v) => v.project_id))])).map(
      (p) => [p.id, p],
    ),
  );

  const identified = new Map<ModEntry, Identified>();
  for (const entry of pack.mods) {
    const version = byHash.get(entry);
    const project = version ? projects.get(version.project_id) : undefined;
    if (version && project) {
      identified.set(entry, { project, currentVersion: version, by: 'hash' });
    } else if (!entry.curseforge && entry.metadata.length > 0) {
      const guessed = await identifyByModId(api, entry);
      if (guessed) identified.set(entry, { project: guessed, by: 'mod-id' });
    }
  }

  // Étape 3 : versions disponibles pour la cible (une requête par projet distinct).
  progress(`Looking for versions for Minecraft ${target.minecraftVersion} / ${target.loader}…`);
  const bestByProject = new Map<string, ModrinthVersion | undefined>();
  for (const { project } of identified.values()) {
    if (bestByProject.has(project.id)) continue;
    const versions = await api.getProjectVersions(project.id, {
      loaders: acceptedLoaders(target.loader),
      gameVersions: [target.minecraftVersion],
    });
    bestByProject.set(project.id, pickBestVersion(versions, target));
  }

  // Étape 4 : statut de chaque mod, et alternatives pour ceux sans version.
  const packProjectIds = new Set([...identified.values()].map((i) => i.project.id));
  const selected = new Map<string, SelectedVersion>();
  const mods: ModAnalysis[] = [];

  for (const entry of pack.mods) {
    const base = {
      fileName: entry.fileName,
      path: entry.path,
      origin: entry.origin,
      alternatives: [],
    };
    const id = identified.get(entry);

    if (!id) {
      mods.push({
        ...base,
        status: 'not-found',
        identification: 'none',
        reason: unidentifiedReason(entry),
      });
      continue;
    }

    const project = toProjectRef(id.project);
    const current = id.currentVersion;
    const identification = id.by;
    const idNote = identification === 'mod-id' ? 'Identified by mod id only (unverified). ' : '';
    const common = {
      ...base,
      identification,
      project,
      currentVersion: current ? toVersionRef(current) : undefined,
    };

    if (current && versionSupportsTarget(current, target)) {
      mods.push({
        ...common,
        status: 'compatible',
        targetVersion: toVersionRef(current),
        reason: idNote || undefined,
      });
      selected.set(project.id, { project, version: current });
      continue;
    }

    const best = bestByProject.get(project.id);
    if (best) {
      mods.push({
        ...common,
        status: 'update-found',
        targetVersion: toVersionRef(best),
        reason: idNote || undefined,
      });
      selected.set(project.id, { project, version: best });
      continue;
    }

    progress(`Searching alternatives for ${project.title}…`);
    const alternatives = await findAlternatives(api, project, target, {
      max: maxAlternatives,
      excludeProjectIds: packProjectIds,
    });
    const noVersion = `${idNote}No version for Minecraft ${target.minecraftVersion} / ${target.loader}.`;
    const adopted = options.adoptAlternatives
      ? await adoptAlternative(api, alternatives, target, selected)
      : undefined;
    mods.push({
      ...common,
      status: alternatives.length > 0 ? 'alternative-suggested' : 'not-found',
      alternatives,
      adoptedAlternative: adopted,
      reason:
        alternatives.length > 0
          ? `${noVersion} Alternatives are suggestions, to verify.`
          : noVersion,
    });
  }

  // Étape 5 : dépendances requises et incompatibilités de la liste finale.
  progress('Resolving dependencies…');
  const deps = await resolveDependencies(api, [...selected.values()], target);
  warnings.push(...deps.warnings);

  const summary = emptySummary();
  for (const mod of mods) summary[mod.status]++;

  return {
    pack: {
      name: pack.name,
      version: pack.version,
      source: pack.source,
      minecraftVersion: pack.minecraftVersion,
      loader: pack.loader,
    },
    target,
    mods,
    dependencies: { added: deps.added, missing: deps.missing },
    conflicts: deps.conflicts,
    summary,
    otherFilesCount: pack.otherFiles.length,
    warnings,
  };
}

// Retient la première alternative (ordre de pertinence) qui a une version pour la cible.
async function adoptAlternative(
  api: ModrinthApi,
  alternatives: Alternative[],
  target: MigrationTarget,
  selected: Map<string, SelectedVersion>,
): Promise<AdoptedAlternative | undefined> {
  for (const alternative of alternatives) {
    const versions = await api.getProjectVersions(alternative.project.id, {
      loaders: acceptedLoaders(target.loader),
      gameVersions: [target.minecraftVersion],
    });
    const best = pickBestVersion(versions, target);
    if (!best) continue;
    selected.set(alternative.project.id, { project: alternative.project, version: best });
    return {
      project: alternative.project,
      version: toVersionRef(best),
      reason: alternative.reason,
      note: ALTERNATIVE_NOTE,
    };
  }
  return undefined;
}

function unidentifiedReason(entry: ModEntry): string {
  if (entry.curseforge) {
    return `CurseForge file (project ${entry.curseforge.projectId}, file ${entry.curseforge.fileId}) cannot be resolved without the CurseForge API.`;
  }
  const modIds = [...new Set(entry.metadata.map((m) => m.modId))];
  return modIds.length > 0
    ? `Unknown file hash on Modrinth and no Modrinth project matches mod id "${modIds.join('", "')}".`
    : 'Unknown file hash on Modrinth.';
}
