import type { ModrinthDependency, ModrinthVersion } from '../modrinth/types.js';
import type { MigrationTarget } from '../types.js';
import { acceptedLoaders, pickBestVersion } from './loaders.js';
import { type ModrinthApi, toProjectRef, toVersionRef } from './refs.js';
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
        .map((dep) => ({ dep, by: s.project.title })),
    );
    const projectIds = await resolveProjectIds(
      api,
      required.map((r) => r.dep),
    );

    // Regroupe les besoins par projet et note qui les demande.
    const needed = new Map<string, string[]>();
    for (const { dep, by } of required) {
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
    }
    if (needed.size === 0) continue;

    const projects = new Map(
      (await api.getProjects([...needed.keys()])).map((p) => [p.id, toProjectRef(p)]),
    );
    for (const [projectId, requiredBy] of needed) {
      const project = projects.get(projectId);
      if (!project) {
        missing.set(projectId, { projectId, requiredBy, reason: 'Unknown Modrinth project' });
        continue;
      }
      const versions = await api.getProjectVersions(projectId, {
        loaders: acceptedLoaders(target.loader),
        gameVersions: [target.minecraftVersion],
      });
      const best = pickBestVersion(versions, target);
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
      added.set(projectId, { project, version: toVersionRef(best), requiredBy });
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
