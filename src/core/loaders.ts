import type { ModrinthVersion, VersionType } from '../modrinth/types.js';
import type { Loader, MigrationTarget } from '../types.js';

// Loaders dont les mods peuvent tourner sur la cible.
// Quilt charge les mods Fabric : une version Fabric est acceptée pour une cible Quilt.
// NeoForge 1.20.1 pouvait charger certains mods Forge, mais ce n'est plus vrai ensuite :
// par simplicité, Forge et NeoForge sont traités comme strictement distincts.
export function acceptedLoaders(target: Loader): Loader[] {
  return target === 'quilt' ? ['quilt', 'fabric'] : [target];
}

export function versionSupportsTarget(version: ModrinthVersion, target: MigrationTarget): boolean {
  const loaders = acceptedLoaders(target.loader);
  return (
    version.game_versions.includes(target.minecraftVersion) &&
    version.loaders.some((l) => (loaders as string[]).includes(l))
  );
}

const VERSION_TYPE_RANK: Record<VersionType, number> = { release: 0, beta: 1, alpha: 2 };

// Choisit la meilleure version compatible avec la cible :
// loader natif d'abord (Quilt avant Fabric), puis release > beta > alpha, puis la plus récente.
export function pickBestVersion(
  versions: ModrinthVersion[],
  target: MigrationTarget,
): ModrinthVersion | undefined {
  const native = (v: ModrinthVersion) => (v.loaders.includes(target.loader) ? 0 : 1);
  return versions
    .filter((v) => versionSupportsTarget(v, target))
    .filter((v) => v.status === undefined || v.status === 'listed' || v.status === 'archived')
    .sort(
      (a, b) =>
        native(a) - native(b) ||
        (VERSION_TYPE_RANK[a.version_type] ?? 3) - (VERSION_TYPE_RANK[b.version_type] ?? 3) ||
        Date.parse(b.date_published) - Date.parse(a.date_published),
    )[0];
}
