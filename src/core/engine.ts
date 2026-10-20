import { matchesModRef } from '../config/config.js';
import { COMPAT_LAYER_NOTE, compatLayersFor } from '../loaders/compatLayers.js';
import { getLoader } from '../loaders/registry.js';
import { OfflineCacheMissError } from '../modrinth/errors.js';
import type { ModrinthProject, ModrinthVersion } from '../modrinth/types.js';
import type { Loader, MigrationTarget, ModEntry, ModPack } from '../types.js';
import { DEFAULT_CONCURRENCY, mapConcurrent } from '../concurrency.js';
import { findAlternatives } from './alternatives.js';
import { resolveDependencies, type SelectedVersion } from './dependencies.js';
import {
  acceptedLoaders,
  fallbackCompatibility,
  fallbackReason,
  loaderChange,
  loaderChangeReason,
  pickBestVersion,
  versionSupportsTarget,
} from './loaders.js';
import { type ModrinthApi, toProjectRef, toVersionRef } from './refs.js';
import { sideOf, type TargetSide } from './sides.js';
import {
  type AdoptedAlternative,
  ALTERNATIVE_NOTE,
  type Alternative,
  type AnalysisResult,
  type CompatLayerHint,
  type Conflict,
  type IgnoredMod,
  type ModAnalysis,
  type ProjectRef,
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
  // Avancement de l'étape la plus longue (une requête par projet), pour une barre de progression.
  onProgressTick?: (done: number, total: number, label: string) => void;
  // Règles de modshift.config.json.
  ignore?: string[];
  mappings?: Record<string, string>;
  // Installation visée (client, serveur ou les deux) ; « both » par défaut.
  side?: TargetSide;
  // Requêtes simultanées vers Modrinth (4 par défaut) ; le débit reste limité par le client.
  concurrency?: number;
  // Signale les mods qu'une couche de compatibilité pourrait charger (vrai par défaut).
  compatLayers?: boolean;
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
  // Mod ids des métadonnées, puis slug CurseForge (souvent identique au slug Modrinth).
  const modIds = [
    ...new Set([
      ...entry.metadata.map((m) => m.modId),
      ...(entry.curseforge?.slug ? [entry.curseforge.slug] : []),
    ]),
  ];
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
    } else if (entry.metadata.length > 0 || entry.curseforge?.slug) {
      const guessed = await identifyByModId(api, entry);
      if (guessed) identified.set(entry, { project: guessed, by: 'mod-id' });
    }
  }

  // Étape 2 bis : règles de modshift.config.json (mods ignorés, correspondances manuelles).
  const ignored: IgnoredMod[] = [];
  const ignoredEntries = new Set<ModEntry>();
  const mapped = new Map<ModEntry, { rule: string; project: ModrinthProject }>();
  const mappingRules = Object.entries(options.mappings ?? {});
  for (const entry of pack.mods) {
    const id = identified.get(entry);
    const ref = { fileName: entry.fileName, slug: id?.project.slug, projectId: id?.project.id };
    const ignoreRule = options.ignore?.find((pattern) => matchesModRef(pattern, ref));
    if (ignoreRule) {
      ignoredEntries.add(entry);
      ignored.push({
        fileName: entry.fileName,
        path: entry.path,
        project: id ? toProjectRef(id.project) : undefined,
        rule: ignoreRule,
      });
      continue;
    }
    const mapping = mappingRules.find(([from]) => matchesModRef(from, ref));
    if (!mapping) continue;
    const [rule, to] = mapping;
    const replacement = await api.getProject(to);
    if (replacement) {
      mapped.set(entry, { rule, project: replacement });
    } else {
      warnings.push(`Mapping "${rule}" → "${to}" ignored: no Modrinth project "${to}".`);
    }
  }

  // Étape 3 : versions disponibles pour la cible (une requête par projet distinct).
  progress(`Looking for versions for Minecraft ${target.minecraftVersion} / ${target.loader}…`);
  const bestByProject = new Map<string, ModrinthVersion | undefined>();
  // Projets à interroger : mods identifiés non ignorés (ou leur remplaçant configuré).
  const lookedUp = pack.mods.flatMap((entry) => {
    if (ignoredEntries.has(entry)) return [];
    const project = mapped.get(entry)?.project ?? identified.get(entry)?.project;
    return project ? [project] : [];
  });
  const distinctProjects = [...new Map(lookedUp.map((p) => [p.id, p])).values()];
  const tick = options.onProgressTick ?? (() => undefined);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  // Requêtes en parallèle (le limiteur de débit du client reste le seul garde-fou) ; les
  // résultats sont rangés par projet, donc indépendants de l'ordre de fin.
  let done = 0;
  tick(0, distinctProjects.length, distinctProjects[0]?.title ?? 'done');
  await mapConcurrent(distinctProjects, concurrency, async (project) => {
    const versions = await api.getProjectVersions(project.id, {
      loaders: acceptedLoaders(target.loader),
      gameVersions: [target.minecraftVersion],
    });
    bestByProject.set(project.id, pickBestVersion(versions, target));
    done++;
    if (done < distinctProjects.length) tick(done, distinctProjects.length, project.title);
  });
  tick(distinctProjects.length, distinctProjects.length, 'done');

  // Étape 3 bis : alternatives et couches de compatibilité des mods sans version, cherchées en
  // parallèle. L'adoption éventuelle d'une alternative reste séquentielle (étape 4).
  const packProjectIds = new Set(lookedUp.map((p) => p.id));
  const withoutVersion = [
    ...new Map(
      pack.mods.flatMap((entry) => {
        const id = identified.get(entry);
        if (ignoredEntries.has(entry) || mapped.has(entry) || !id) return [];
        if (id.currentVersion && versionSupportsTarget(id.currentVersion, target)) return [];
        if (bestByProject.get(id.project.id)) return [];
        return [[id.project.id, id.project] as const];
      }),
    ).values(),
  ];
  const replacements = new Map<string, Replacements>();
  await mapConcurrent(withoutVersion, concurrency, async (raw) => {
    progress(`Searching alternatives for ${raw.title}…`);
    replacements.set(
      raw.id,
      await searchReplacements(api, toProjectRef(raw), raw.description, target, {
        maxAlternatives,
        excludeProjectIds: packProjectIds,
        compatLayers: options.compatLayers !== false,
      }),
    );
  });

  // Étape 4 : statut de chaque mod, et alternatives pour ceux sans version.
  const selected = new Map<string, SelectedVersion>();
  const mods: ModAnalysis[] = [];

  for (const entry of pack.mods) {
    const base = {
      fileName: entry.fileName,
      path: entry.path,
      origin: entry.origin,
      alternatives: [],
    };
    if (ignoredEntries.has(entry)) continue;
    const id = identified.get(entry);

    const map = mapped.get(entry);
    if (map) {
      // Remplacement choisi par l'utilisateur : ce n'est pas une suggestion.
      const replacement = toProjectRef(map.project);
      const best = bestByProject.get(replacement.id);
      const mapping = { rule: map.rule, original: id ? toProjectRef(id.project) : undefined };
      const common = {
        ...base,
        identification: id?.by ?? ('none' as const),
        project: replacement,
        currentVersion: id?.currentVersion ? toVersionRef(id.currentVersion) : undefined,
        mapping,
      };
      if (best) {
        const fallback = fallbackCompatibility(best, target);
        mods.push({
          ...common,
          status: 'update-found',
          targetVersion: toVersionRef(best),
          fallback,
          reason: joinReasons(
            `Replaced by ${replacement.title} (mapping "${map.rule}" in modshift.config.json).`,
            fallback && fallbackReason(fallback, target),
          ),
        });
        selected.set(replacement.id, { project: replacement, version: best });
      } else {
        mods.push({
          ...common,
          status: 'not-found',
          reason: `Mapped to ${replacement.title} in modshift.config.json, but it has no version for Minecraft ${target.minecraftVersion} / ${target.loader}.`,
        });
      }
      continue;
    }

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
      const fallback = fallbackCompatibility(current, target);
      mods.push({
        ...common,
        status: 'compatible',
        targetVersion: toVersionRef(current),
        fallback,
        reason: joinReasons(idNote, fallback && fallbackReason(fallback, target)),
      });
      selected.set(project.id, { project, version: current });
      continue;
    }

    const best = bestByProject.get(project.id);
    if (best) {
      const fallback = fallbackCompatibility(best, target);
      const change = loaderChange(pack.loader, best, target);
      mods.push({
        ...common,
        status: 'update-found',
        targetVersion: toVersionRef(best),
        fallback,
        loaderChange: change,
        reason: joinReasons(
          idNote,
          change && loaderChangeReason(change),
          fallback && fallbackReason(fallback, target),
        ),
      });
      selected.set(project.id, { project, version: best });
      continue;
    }

    const found = replacements.get(project.id) ?? { alternatives: [], warnings: [] };
    const { alternatives, compatLayer } = found;
    // Une seule fois par projet, même s'il apparaît dans plusieurs fichiers.
    warnings.push(...found.warnings.splice(0));
    const noVersion = `${idNote}No version for Minecraft ${target.minecraftVersion} / ${target.loader}.`;
    const adopted = options.adoptAlternatives
      ? await adoptAlternative(api, alternatives, target, selected)
      : undefined;
    mods.push({
      ...common,
      status: alternatives.length > 0 ? 'alternative-suggested' : 'not-found',
      alternatives,
      adoptedAlternative: adopted,
      compatLayer,
      reason: joinReasons(
        alternatives.length > 0
          ? `${noVersion} Alternatives are suggestions, to verify.`
          : noVersion,
        compatLayer && compatLayerReason(compatLayer),
      ),
    });
  }

  // Côté client / serveur des versions retenues (environment de la version, sinon projet).
  const projectData = new Map<string, ModrinthProject>();
  for (const id of identified.values()) projectData.set(id.project.id, id.project);
  for (const map of mapped.values()) projectData.set(map.project.id, map.project);
  for (const mod of mods) {
    if (mod.project && mod.targetVersion) {
      mod.side = sideOf(projectData.get(mod.project.id), mod.targetVersion);
    }
    if (mod.adoptedAlternative) {
      mod.adoptedAlternative.side = sideOf(undefined, mod.adoptedAlternative.version);
    }
  }

  // Étape 5 : dépendances requises et incompatibilités de la liste finale.
  progress('Resolving dependencies…');
  const deps = await resolveDependencies(api, [...selected.values()], target, { concurrency });
  warnings.push(...deps.warnings);
  const conflicts = [...findDuplicates(mods), ...deps.conflicts];

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
    side: options.side ?? 'both',
    mods,
    dependencies: { added: deps.added, missing: deps.missing },
    conflicts,
    ignored,
    summary,
    otherFilesCount: pack.otherFiles.length,
    warnings,
  };
}

// Assemble des morceaux d'explication (vides ignorés) ; undefined si rien à dire.
function joinReasons(...parts: (string | undefined)[]): string | undefined {
  const text = parts
    .map((p) => p?.trim())
    .filter((p) => p)
    .join(' ');
  return text || undefined;
}

// Le même projet présent dans plusieurs fichiers (ex. deux versions d'un même mod).
function findDuplicates(mods: ModAnalysis[]): Conflict[] {
  const byProject = new Map<string, ModAnalysis[]>();
  for (const mod of mods) {
    if (!mod.project) continue;
    byProject.set(mod.project.id, [...(byProject.get(mod.project.id) ?? []), mod]);
  }
  return [...byProject.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const project = list[0]?.project as ProjectRef;
      const files = list.map((m) => m.fileName).join(', ');
      return {
        kind: 'duplicate' as const,
        project,
        declaredBy: files,
        explanation: `${project.title} is present ${list.length} times (${files}). Only one copy is kept in a migrated pack; remove the others from the source pack.`,
      };
    });
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

interface Replacements {
  alternatives: Alternative[];
  compatLayer?: CompatLayerHint;
  warnings: string[];
}

// Alternatives et couche de compatibilité d'un projet sans version pour la cible.
async function searchReplacements(
  api: ModrinthApi,
  project: ProjectRef,
  description: string | undefined,
  target: MigrationTarget,
  options: { maxAlternatives: number; excludeProjectIds: Set<string>; compatLayers: boolean },
): Promise<Replacements> {
  const result: Replacements = { alternatives: [], warnings: [] };
  try {
    result.alternatives = await findAlternatives(api, project, target, {
      max: options.maxAlternatives,
      excludeProjectIds: options.excludeProjectIds,
      description,
    });
  } catch (error) {
    // Hors-ligne, une recherche absente du cache ne doit pas bloquer toute l'analyse.
    if (!(error instanceof OfflineCacheMissError)) throw error;
    result.warnings.push(
      `${project.title}: alternatives not available offline (${error.what} is not cached).`,
    );
  }
  if (options.compatLayers) {
    try {
      result.compatLayer = await findCompatLayer(api, project, target);
    } catch (error) {
      if (!(error instanceof OfflineCacheMissError)) throw error;
      result.warnings.push(
        `${project.title}: compatibility layers not checked offline (${error.what} is not cached).`,
      );
    }
  }
  return result;
}

function compatLayerReason(hint: CompatLayerHint): string {
  return `Its ${getLoader(hint.runs as Loader).name} version could run through ${hint.name} (${COMPAT_LAYER_NOTE}; not added to the pack).`;
}

// Cherche une version d'un autre loader que la cible pourrait charger via une couche de
// compatibilité documentée (src/loaders/compatLayers.ts). Une requête par couche applicable.
async function findCompatLayer(
  api: ModrinthApi,
  project: ProjectRef,
  target: MigrationTarget,
): Promise<CompatLayerHint | undefined> {
  for (const layer of compatLayersFor(target)) {
    if (layer.replaces?.includes(project.slug)) continue;
    const versions = await api.getProjectVersions(project.id, {
      loaders: [layer.runs],
      gameVersions: [target.minecraftVersion],
    });
    const best = pickBestVersion(versions, { ...target, loader: layer.runs });
    if (!best) continue;
    return {
      layer: layer.id,
      name: layer.name,
      runs: layer.runs,
      version: toVersionRef(best),
      requires: layer.requires,
      caveat: layer.caveat,
      source: layer.source,
      note: COMPAT_LAYER_NOTE,
    };
  }
  return undefined;
}

function unidentifiedReason(entry: ModEntry): string {
  const cf = entry.curseforge;
  if (cf && !cf.resolved) {
    return `CurseForge file (project ${cf.projectId}, file ${cf.fileId}) cannot be identified without a CurseForge API key (set CURSEFORGE_API_KEY).`;
  }
  if (cf) {
    return `CurseForge mod "${cf.name ?? entry.fileName}": this file is not on Modrinth and no Modrinth project matches the slug "${cf.slug ?? '?'}".`;
  }
  const modIds = [...new Set(entry.metadata.map((m) => m.modId))];
  // Piste concrète : le fichier vient souvent d'un autre site, ou a été modifié/recompilé.
  const hint = 'The file may come from another site (CurseForge, GitHub) or have been modified.';
  return modIds.length > 0
    ? `Unknown file hash on Modrinth and no Modrinth project matches mod id "${modIds.join('", "')}". ${hint}`
    : `Unknown file hash on Modrinth. ${hint}`;
}
