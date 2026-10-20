// Registre des loaders connus de ModShift.
//
// Noms : identifiants de loaders Modrinth, recoupés dans deux clients Modrinth répandus
// (packwiz `modrinth/modrinth.go`, Prism Launcher `launcher/modplatform/ModIndex.cpp`) ;
// l'API et la doc Modrinth ne sont pas accessibles depuis l'environnement de développement.
//
// Replis (`fallbacks`) : uniquement ceux affirmés par la documentation officielle du loader
// cible (sources ci-dessous et dans docs/loaders.md). Rien n'est supposé.

export type LoaderKind = 'mod-loader' | 'server-plugin' | 'proxy-plugin';

export interface LoaderFallback {
  // Loader dont les versions fonctionnent aussi sur le loader cible.
  loader: string;
  // Source officielle de cette règle.
  source: string;
}

export interface LoaderDefinition {
  id: string;
  name: string;
  kind: LoaderKind;
  // Clé de `dependencies` dans modrinth.index.json ; absente si le format .mrpack ne la gère pas.
  mrpackKey?: string;
  // Dossier d'installation dans une instance / un serveur.
  folder: 'mods' | 'plugins';
  // Site où trouver les versions du loader (cité dans les messages d'erreur de `migrate`).
  website?: string;
  fallbacks: LoaderFallback[];
}

const QUILT_LOADER_README = 'QuiltMC/quilt-loader README (Fabric APIs that any Fabric mod can use)';
const PAPER_DOCS =
  'PaperMC docs, "Getting started": drop-in replacement for CraftBukkit and Spigot';
const PURPUR_README =
  'PurpurMC/Purpur README: drop-in replacement for Paper, with Paper, Spigot and Bukkit APIs';
const WATERFALL_README = 'PaperMC/Waterfall README: fork of BungeeCord tracking upstream';

export const LOADER_DEFINITIONS = [
  // Loaders de mods acceptés par le format .mrpack.
  {
    id: 'forge',
    name: 'Forge',
    kind: 'mod-loader',
    mrpackKey: 'forge',
    folder: 'mods',
    website: 'https://files.minecraftforge.net/',
    fallbacks: [],
  },
  {
    id: 'neoforge',
    name: 'NeoForge',
    kind: 'mod-loader',
    mrpackKey: 'neoforge',
    folder: 'mods',
    website: 'https://neoforged.net/',
    fallbacks: [],
  },
  {
    id: 'fabric',
    name: 'Fabric',
    kind: 'mod-loader',
    mrpackKey: 'fabric-loader',
    folder: 'mods',
    website: 'https://fabricmc.net/develop/',
    fallbacks: [],
  },
  {
    id: 'quilt',
    name: 'Quilt',
    kind: 'mod-loader',
    mrpackKey: 'quilt-loader',
    folder: 'mods',
    website: 'https://quiltmc.org/',
    fallbacks: [{ loader: 'fabric', source: QUILT_LOADER_README }],
  },
  // Anciens loaders et variantes pour anciennes versions (analyse seulement).
  { id: 'liteloader', name: 'LiteLoader', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  {
    id: 'modloader',
    name: "Risugami's ModLoader",
    kind: 'mod-loader',
    folder: 'mods',
    fallbacks: [],
  },
  { id: 'rift', name: 'Rift', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  { id: 'babric', name: 'Babric', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  { id: 'bta-babric', name: 'BTA (Babric)', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  { id: 'legacy-fabric', name: 'Legacy Fabric', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  { id: 'ornithe', name: 'Ornithe', kind: 'mod-loader', folder: 'mods', fallbacks: [] },
  // Plugins de serveur.
  { id: 'bukkit', name: 'Bukkit', kind: 'server-plugin', folder: 'plugins', fallbacks: [] },
  { id: 'spigot', name: 'Spigot', kind: 'server-plugin', folder: 'plugins', fallbacks: [] },
  {
    id: 'paper',
    name: 'Paper',
    kind: 'server-plugin',
    folder: 'plugins',
    fallbacks: [
      { loader: 'spigot', source: PAPER_DOCS },
      { loader: 'bukkit', source: PAPER_DOCS },
    ],
  },
  {
    id: 'purpur',
    name: 'Purpur',
    kind: 'server-plugin',
    folder: 'plugins',
    fallbacks: [
      { loader: 'paper', source: PURPUR_README },
      { loader: 'spigot', source: PURPUR_README },
      { loader: 'bukkit', source: PURPUR_README },
    ],
  },
  { id: 'sponge', name: 'Sponge', kind: 'server-plugin', folder: 'plugins', fallbacks: [] },
  // Plugins de proxy.
  { id: 'bungeecord', name: 'BungeeCord', kind: 'proxy-plugin', folder: 'plugins', fallbacks: [] },
  {
    id: 'waterfall',
    name: 'Waterfall',
    kind: 'proxy-plugin',
    folder: 'plugins',
    fallbacks: [{ loader: 'bungeecord', source: WATERFALL_README }],
  },
  { id: 'velocity', name: 'Velocity', kind: 'proxy-plugin', folder: 'plugins', fallbacks: [] },
] as const satisfies readonly LoaderDefinition[];

export type LoaderId = (typeof LOADER_DEFINITIONS)[number]['id'];

export const LOADER_IDS: readonly LoaderId[] = LOADER_DEFINITIONS.map((d) => d.id);

const BY_ID = new Map<string, LoaderDefinition>(LOADER_DEFINITIONS.map((d) => [d.id, d]));

export function isLoaderId(value: string): value is LoaderId {
  return BY_ID.has(value);
}

export function getLoader(id: LoaderId): LoaderDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`Unknown loader ${id}`);
  return definition;
}

// Loaders dont les versions sont acceptées pour une cible : le loader lui-même d'abord,
// puis ses replis documentés, dans l'ordre de préférence.
export function acceptedLoaders(target: LoaderId): string[] {
  return [target, ...getLoader(target).fallbacks.map((f) => f.loader)];
}

// Règle de repli qui permet à `versionLoaders` de tourner sur `target` (si pas de version native).
export function fallbackFor(
  target: LoaderId,
  versionLoaders: readonly string[],
): LoaderFallback | undefined {
  if (versionLoaders.includes(target)) return undefined;
  return getLoader(target).fallbacks.find((f) => versionLoaders.includes(f.loader));
}

// Le format .mrpack ne déclare que forge, neoforge, fabric-loader et quilt-loader.
export function supportsMrpack(target: LoaderId): boolean {
  return getLoader(target).mrpackKey !== undefined;
}

// Clé de modrinth.index.json → loader (lecture des packs).
export const MRPACK_KEY_TO_LOADER: Record<string, LoaderId> = Object.fromEntries(
  LOADER_DEFINITIONS.flatMap((d) => ('mrpackKey' in d ? [[d.mrpackKey, d.id]] : [])),
);
