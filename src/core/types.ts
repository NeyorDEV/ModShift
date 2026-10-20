import type { COMPAT_LAYER_NOTE } from '../loaders/compatLayers.js';
import type { VersionType } from '../modrinth/types.js';
import type { SourceCandidate } from '../sources/types.js';
import type { ModSide, TargetSide } from './sides.js';
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
  // Champ `environment` de Modrinth (côté client / serveur), s'il est connu.
  environment?: string;
  file?: {
    fileName: string;
    url: string;
    sha1: string;
    sha512: string;
    size: number;
  };
}

export const ALTERNATIVE_NOTE = 'suggestion, to verify';
export const FALLBACK_NOTE = 'fallback compatibility, to test';

// Version retenue pour un loader de repli (ex. version Fabric sur une cible Quilt).
export interface FallbackCompatibility {
  // Loader de la version retenue.
  loader: string;
  // Source officielle de la règle de repli.
  source: string;
  note: typeof FALLBACK_NOTE;
}

// Mod qui pourrait tourner sur la cible via une couche de compatibilité (ex. Sinytra Connector).
// Simple signalement : jamais inclus automatiquement dans le pack migré.
export interface CompatLayerHint {
  layer: string;
  name: string;
  // Loader de la version qui serait chargée par la couche.
  runs: string;
  version: VersionRef;
  requires: { slug: string; title: string }[];
  caveat?: string;
  source: string;
  note: typeof COMPAT_LAYER_NOTE;
}

// Changement de loader pour un même projet (mod multi-loader), ex. { from: 'forge', to: 'fabric' }.
export interface LoaderChange {
  from: string;
  to: string;
}

export interface Alternative {
  project: ProjectRef;
  downloads: number;
  // similar-name : nom proche (portage, fork) ; same-category : même catégorie Modrinth.
  reason: 'similar-name' | 'same-category';
  // Score de pertinence (0–100) et explication (catégories, nom, mots-clés, popularité).
  score: number;
  explanation: string;
  note: typeof ALTERNATIVE_NOTE;
}

// Alternative retenue automatiquement (option --include-alternatives) : toujours une suggestion.
export interface AdoptedAlternative {
  project: ProjectRef;
  version: VersionRef;
  reason: Alternative['reason'];
  note: typeof ALTERNATIVE_NOTE;
  side?: ModSide;
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
  adoptedAlternative?: AdoptedAlternative;
  // Remplacement imposé par une correspondance de modshift.config.json.
  mapping?: { rule: string; original?: ProjectRef };
  // Présent quand la version cible ne tourne sur le loader cible que par repli.
  fallback?: FallbackCompatibility;
  // Présent quand le pack change de loader et que le même projet a une version pour la cible.
  loaderChange?: LoaderChange;
  // Présent quand aucune version native n'existe mais qu'une couche de compatibilité pourrait
  // charger la version d'un autre loader (« experimental, not guaranteed »).
  compatLayer?: CompatLayerHint;
  // Côté client / serveur de la version retenue (présent quand une version cible existe).
  side?: ModSide;
  // Fichiers proposés par d'autres sources (ex. GitHub Releases) : à vérifier, jamais ajoutés
  // automatiquement au pack migré.
  external?: SourceCandidate[];
  // Explication lisible du statut (surtout pour not-found / alternative-suggested).
  reason?: string;
}

export interface AddedDependency {
  project: ProjectRef;
  version: VersionRef;
  requiredBy: string[];
  fallback?: FallbackCompatibility;
  side?: ModSide;
}

export interface MissingDependency {
  projectId: string;
  title?: string;
  requiredBy: string[];
  reason: string;
}

// incompatible : A déclare B incompatible et les deux sont dans la liste finale ;
// pinned-version : A exige une version précise de B, mais une autre a été retenue pour la cible ;
// duplicate : le même projet apparaît plusieurs fois dans le pack d'origine.
export type ConflictKind = 'incompatible' | 'pinned-version' | 'duplicate';

export interface Conflict {
  kind: ConflictKind;
  // Projet concerné (déclaré incompatible, version imposée, ou dupliqué)…
  project: ProjectRef;
  // … par ce projet (titre), ou les fichiers en double pour « duplicate ».
  declaredBy: string;
  // Explication lisible et action recommandée.
  explanation: string;
}

// Mod écarté par la liste « ignore » de modshift.config.json.
export interface IgnoredMod {
  fileName: string;
  path: string;
  project?: ProjectRef;
  rule: string;
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
  // Installation visée (--side) : les rapports signalent les mods inutiles ou incertains.
  side: TargetSide;
  mods: ModAnalysis[];
  dependencies: {
    added: AddedDependency[];
    missing: MissingDependency[];
  };
  conflicts: Conflict[];
  ignored: IgnoredMod[];
  summary: Record<ModStatus, number>;
  // Nombre de fichiers non-mods (resource packs, configs…) non analysés.
  otherFilesCount: number;
  warnings: string[];
}
