import type { VersionType } from '../modrinth/types.js';
import type { Loader, MigrationTarget, ModOrigin, PackSource } from '../types.js';

export const MOD_STATUSES = [
  'compatible',
  'update-found',
  'alternative-suggested',
  'not-found',
] as const;

// compatible : la version actuelle fonctionne déjà sur la cible ;
// update-found : une autre version du même projet existe pour la cible ;
// alternative-suggested : aucune version, mais des projets similaires (à vérifier) existent ;
// not-found : ni version ni alternative (ou mod non identifié).
export type ModStatus = (typeof MOD_STATUSES)[number];

// Comment le mod a été identifié sur Modrinth.
export type Identification = 'hash' | 'mod-id' | 'none';

export interface ProjectRef {
  id: string;
  slug: string;
  title: string;
  categories: string[];
}

export interface VersionRef {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  versionType: VersionType;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  file?: {
    fileName: string;
    url: string;
    sha1: string;
    sha512: string;
    size: number;
  };
}

export const ALTERNATIVE_NOTE = 'suggestion, to verify';

export interface Alternative {
  project: ProjectRef;
  downloads: number;
  // similar-name : nom proche (portage, fork) ; same-category : même catégorie Modrinth.
  reason: 'similar-name' | 'same-category';
  note: typeof ALTERNATIVE_NOTE;
}

export interface ModAnalysis {
  fileName: string;
  path: string;
  origin: ModOrigin;
  status: ModStatus;
  identification: Identification;
  project?: ProjectRef;
  currentVersion?: VersionRef;
  targetVersion?: VersionRef;
  alternatives: Alternative[];
  // Explication lisible du statut (surtout pour not-found / alternative-suggested).
  reason?: string;
}

export interface AddedDependency {
  project: ProjectRef;
  version: VersionRef;
  requiredBy: string[];
}

export interface MissingDependency {
  projectId: string;
  title?: string;
  requiredBy: string[];
  reason: string;
}

export interface Conflict {
  // Projet présent dans la liste finale et déclaré incompatible…
  project: ProjectRef;
  // … par ce projet.
  declaredBy: string;
}

export interface AnalysisResult {
  pack: {
    name?: string;
    version?: string;
    source: PackSource;
    minecraftVersion?: string;
    loader?: Loader;
  };
  target: MigrationTarget;
  mods: ModAnalysis[];
  dependencies: {
    added: AddedDependency[];
    missing: MissingDependency[];
  };
  conflicts: Conflict[];
  summary: Record<ModStatus, number>;
  // Nombre de fichiers non-mods (resource packs, configs…) non analysés.
  otherFilesCount: number;
  warnings: string[];
}
