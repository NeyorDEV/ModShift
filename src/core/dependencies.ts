import type { ModrinthDependency, ModrinthVersion } from '../modrinth/types.js';
import type { MigrationTarget } from '../types.js';
import { acceptedLoaders, fallbackCompatibility, pickBestVersion } from './loaders.js';
import { type ModrinthApi, toProjectRef, toVersionRef } from './refs.js';
import { sideOf } from './sides.js';
import { DEFAULT_CONCURRENCY, mapConcurrent } from '../concurrency.js';
import type { AddedDependency, Conflict, MissingDependency, ProjectRef } from './types.js';

export interface SelectedVersion {
  project: ProjectRef;
  version: ModrinthVersion;
}

export interface DependencyResolution {
  added: AddedDependency[];
  missing: MissingDependency[];
  conflicts: Conflict[];
  warnings: string[];
}

// Résout les identifiants de projet des dépendances qui ne donnent qu'un `version_id`.
async function resolveProjectIds(
  api: ModrinthApi,
  deps: ModrinthDependency[],
): Promise<Map<ModrinthDependency, string>> {
  const versionIds = deps.flatMap((d) => (!d.project_id && d.version_id ? [d.version_id] : []));
  const versionToProject = new Map<string, string>();
  if (versionIds.length > 0) {
    for (const v of await api.getVersions(versionIds)) versionToProject.set(v.id, v.project_id);
  }
  const result = new Map<ModrinthDependency, string>();
  for (const dep of deps) {
    const projectId =
      dep.project_id ?? (dep.version_id ? versionToProject.get(dep.version_id) : undefined);
    if (projectId) result.set(dep, projectId);
  }
  return result;
}

// Ajoute récursivement les dépendances requises manquantes (en version compatible avec la cible),
// signale celles qui n'existent pas pour la cible, et détecte les incompatibilités déclarées.
export async function resolveDependencies(
  api: ModrinthApi,
  selected: SelectedVersion[],
  target: MigrationTarget,
  options: { concurrency?: number } = {},
): Promise<DependencyResolution> {
  const present = new Map<string, SelectedVersion>();
  for (const s of selected) present.set(s.project.id, s);

  const added = new Map<string, AddedDependency>();
  const missing = new Map<string, MissingDependency>();
  const warnings: string[] = [];
  let queue = [...selected];

  while (queue.length > 0) {
    const round = queue;
    queue = [];

    const required = round.flatMap((s) =>
      s.version.dependencies
        .filter((d) => d.dependency_type === 'required')
        // Fichier publié pour plusieurs loaders : Modrinth ne dit pas pour lequel est la dépendance.
        .map((dep) => ({ dep, by: s.project.title, multiLoader: s.version.loaders.length > 1 })),
    );
    const projectIds = await resolveProjectIds(
      api,
      required.map((r) => r.dep),
    );

    // Regroupe les besoins par projet et note qui les demande.
    const needed = new Map<string, string[]>();
    // Projets demandés uniquement par des fichiers multi-loaders.
    const onlyMultiLoader = new Map<string, boolean>();
    for (const { dep, by, multiLoader } of required) {
      const projectId = projectIds.get(dep);
      if (!projectId) {
        warnings.push(
          `${by}: cannot resolve a required dependency (${dep.file_name ?? 'unknown'})`,
        );
        continue;
      }
      const known = added.get(projectId) ?? missing.get(projectId);
      if (known) {
        if (!known.requiredBy.includes(by)) known.requiredBy.push(by);
        continue;
      }
      if (present.has(projectId)) continue;
      const list = needed.get(projectId) ?? [];
      if (!list.includes(by)) list.push(by);
      needed.set(projectId, list);
      onlyMultiLoader.set(projectId, (onlyMultiLoader.get(projectId) ?? true) && multiLoader);
    }
    if (needed.size === 0) continue;

    const raw = new Map((await api.getProjects([...needed.keys()])).map((p) => [p.id, p]));
    const projects = new Map([...raw].map(([id, p]) => [id, toProjectRef(p)]));
    // Versions des dépendances de ce tour en parallèle, traitées ensuite dans l'ordre.
    const entries = [...needed];
    const bests = await mapConcurrent(
      entries,
      options.concurrency ?? DEFAULT_CONCURRENCY,
      async ([projectId]) =>
        projects.has(projectId)
          ? pickBestVersion(
              await api.getProjectVersions(projectId, {
                loaders: acceptedLoaders(target.loader),
                gameVersions: [target.minecraftVersion],
              }),
              target,
            )
          : undefined,
    );
    for (const [i, [projectId, requiredBy]] of entries.entries()) {
      const project = projects.get(projectId);
      if (!project) {
        missing.set(projectId, { projectId, requiredBy, reason: 'Unknown Modrinth project' });
        continue;
      }
      const best = bests[i];
      const projectLoaders = raw.get(projectId)?.loaders;
      const accepted = acceptedLoaders(target.loader);
      if (
        !best &&
        onlyMultiLoader.get(projectId) &&
        projectLoaders !== undefined &&
        projectLoaders.length > 0 &&
        !projectLoaders.some((l) => accepted.includes(l))
      ) {
        // Ex. Zoomify (un fichier Fabric + NeoForge) déclare KotlinLangForge, publié pour NeoForge
        // seulement : la dépendance concerne l'autre loader, elle n'est pas manquante pour la cible.
        warnings.push(
          `${project.title} (required by ${requiredBy.join(', ')}) ignored: only published for ${projectLoaders.join(', ')}, so probably needed by another loader of a multi-loader file.`,
        );
        continue;
      }
      if (!best) {
        missing.set(projectId, {
          projectId,
          title: project.title,
          requiredBy,
          reason: `No version for Minecraft ${target.minecraftVersion} / ${target.loader}`,
        });
        continue;
      }
      const selection = { project, version: best };
      present.set(projectId, selection);
      const fallback = fallbackCompatibility(best, target);
      added.set(projectId, {
        project,
        version: toVersionRef(best),
        requiredBy,
        ...(fallback ? { fallback } : {}),
        side: sideOf(raw.get(projectId), best),
      });
      queue.push(selection);
    }
  }

  const conflicts = await findConflicts(api, [...present.values()]);
  return {
    added: [...added.values()],
    missing: [...missing.values()],
    conflicts,
    warnings,
  };
}

// Détecte, dans la liste finale :
// - les paires (A déclare B incompatible) où A et B sont tous deux présents ;
// - les dépendances requises épinglées sur une version précise (`version_id`) alors qu'une autre
//   version de B a été retenue pour la cible.
async function findConflicts(api: ModrinthApi, finalList: SelectedVersion[]): Promise<Conflict[]> {
  const byId = new Map(finalList.map((s) => [s.project.id, s]));
  const relevant = finalList.flatMap((s) =>
    s.version.dependencies
      .filter(
        (d) =>
          d.dependency_type === 'incompatible' ||
          (d.dependency_type === 'required' && d.version_id),
      )
      .map((dep) => ({ dep, by: s })),
  );
  if (relevant.length === 0) return [];
  const projectIds = await resolveProjectIds(
    api,
    relevant.map((i) => i.dep),
  );
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();
  for (const { dep, by } of relevant) {
    const projectId = projectIds.get(dep);
    const other = projectId ? byId.get(projectId) : undefined;
    if (!other || other.project.id === by.project.id) continue;
    const a = by.project.title;
    const b = other.project.title;

    if (dep.dependency_type === 'incompatible') {
      const key = `incompatible:${by.project.id}->${other.project.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        kind: 'incompatible',
        project: other.project,
        declaredBy: a,
        explanation: `${a} declares ${b} as incompatible: they may crash or misbehave together. Keep only one of them (ModShift does not remove either automatically).`,
      });
    } else if (dep.version_id && dep.version_id !== other.version.id) {
      const key = `pinned:${by.project.id}->${other.project.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        kind: 'pinned-version',
        project: other.project,
        declaredBy: a,
        explanation: `${a} requires a specific version of ${b} (version id ${dep.version_id}), but ${b} ${other.version.version_number} was selected for the target. Check that ${a} works with it.`,
      });
    }
  }
  return conflicts;
}
