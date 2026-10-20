// Types partagés du domaine ModShift.

import { isLoaderId, LOADER_IDS, type LoaderId } from './loaders/registry.js';

// Les loaders sont définis dans le registre src/loaders/registry.ts.
export const LOADERS = LOADER_IDS;
export type Loader = LoaderId;

export function isLoader(value: string): value is Loader {
  return isLoaderId(value);
}

export interface FileHashes {
  sha1?: string;
  sha512?: string;
}

// Dépendance déclarée dans les métadonnées d'un .jar.
export interface JarDependency {
  modId: string;
  required: boolean;
  versionRange?: string;
}

// Métadonnées lues dans un .jar (un jar « multi-loader » peut en contenir plusieurs).
export interface JarMetadata {
  loader: Loader;
  modId: string;
  name?: string;
  version?: string;
  dependencies: JarDependency[];
}

export type PackSource = 'mrpack' | 'curseforge' | 'folder';

// Origine d'un mod : listé dans l'index du pack, présent dans les overrides, ou fichier d'un dossier.
export type ModOrigin = 'index' | 'override' | 'folder';

export interface CurseForgeFileRef {
  projectId: number;
  fileId: number;
  // `required: false` dans le manifest : fichier optionnel (désactivé par défaut dans CurseForge).
  required: boolean;
  // Renseignés par la résolution via l'API CurseForge (src/curseforge/resolve.ts).
  resolved?: boolean;
  name?: string;
  slug?: string;
}

export interface ModEntry {
  // Nom du fichier (ex. « sodium-fabric-0.5.8.jar »).
  fileName: string;
  // Chemin relatif dans le pack (ex. « mods/sodium-fabric-0.5.8.jar »).
  path: string;
  origin: ModOrigin;
  hashes: FileHashes;
  // Métadonnées lues dans le jar, quand le jar est disponible localement.
  metadata: JarMetadata[];
  // Référence CurseForge (manifest.json), non résolvable sans clé API.
  curseforge?: CurseForgeFileRef;
  downloads?: string[];
  fileSize?: number;
  env?: { client?: string; server?: string };
}

// Entrée brute de modrinth.index.json pour un fichier non-mod (resource pack, shader…).
export interface PackIndexFile {
  path: string;
  hashes: FileHashes;
  downloads: string[];
  fileSize?: number;
  env?: { client?: string; server?: string };
}

export interface ModPack {
  source: PackSource;
  name?: string;
  version?: string;
  author?: string;
  minecraftVersion?: string;
  loader?: Loader;
  loaderVersion?: string;
  mods: ModEntry[];
  // Fichiers non-mods (resource packs, shaders, configs…) conservés tels quels.
  otherFiles: string[];
  // Fichiers non-mods listés dans l'index d'un .mrpack (repris tels quels par `migrate`).
  indexFiles?: PackIndexFile[];
  // Dossier d'overrides déclaré par un manifest CurseForge (« overrides » par défaut).
  overridesDir?: string;
  warnings: string[];
}

// Cible de migration.
export interface MigrationTarget {
  minecraftVersion: string;
  loader: Loader;
}
