import { acceptedLoaders, fallbackFor, getLoader } from '../loaders/registry.js';
import type { ModrinthVersion, VersionType } from '../modrinth/types.js';
import type { Loader, MigrationTarget } from '../types.js';
import { type FallbackCompatibility, FALLBACK_NOTE, type LoaderChange } from './types.js';

// Loaders acceptés pour une cible (le loader lui-même puis ses replis documentés) :
// voir src/loaders/registry.ts. Forge et NeoForge restent distincts (aucune source officielle
// accessible ne confirme la compatibilité de NeoForge 1.20.1 avec les mods Forge).
export { acceptedLoaders } from '../loaders/registry.js';

// Décrit le repli utilisé par une version (undefined si elle vise le loader cible lui-même).
export function fallbackCompatibility(
  version: ModrinthVersion,
  target: MigrationTarget,
): FallbackCompatibility | undefined {
  const rule = fallbackFor(target.loader, version.loaders);
  return rule ? { loader: rule.loader, source: rule.source, note: FALLBACK_NOTE } : undefined;
}

// Phrase ajoutée à la raison d'un mod retenu par repli.
export function fallbackReason(fallback: FallbackCompatibility, target: MigrationTarget): string {
  return `Fallback compatibility, to test: a ${getLoader(fallback.loader as Loader).name} version running on ${getLoader(target.loader).name} (${fallback.source}).`;
}

// Migration inter-loaders (ex. Forge → Fabric) : le même projet Modrinth publie aussi une version
// pour le loader cible (mod multi-loader). ModShift ne convertit pas le code du mod : il retient
// la version que l'auteur publie pour ce loader.
export function loaderChange(
  packLoader: Loader | undefined,
  version: ModrinthVersion,
  target: MigrationTarget,
): LoaderChange | undefined {
  if (!packLoader || packLoader === target.loader) return undefined;
  const to = version.loaders.includes(target.loader)
    ? target.loader
    : (fallbackFor(target.loader, version.loaders)?.loader ?? target.loader);
  // Version du loader d'origine retenue par repli (ex. Fabric sur Quilt) : pas de changement.
  return to === packLoader ? undefined : { from: packLoader, to };
}

export function loaderChangeReason(change: LoaderChange): string {
  const from = getLoader(change.from as Loader).name;
  const to = getLoader(change.to as Loader).name;
  return `Same project: its ${to} version replaces the ${from} one (multi-loader mod).`;
}

export function versionSupportsTarget(version: ModrinthVersion, target: MigrationTarget): boolean {
  const loaders = acceptedLoaders(target.loader);
  return (
    version.game_versions.includes(target.minecraftVersion) &&
    version.loaders.some((l) => loaders.includes(l))
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
