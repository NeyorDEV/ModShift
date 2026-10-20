// Contrat des sources de mods (plugins).
//
// Modrinth reste la source principale : le moteur l'interroge directement pour identifier les
// fichiers, trouver les versions et résoudre les dépendances. Une source ajoute deux points
// d'extension, tous deux optionnels :
// - `prepare` : compléter le pack avant l'analyse (ex. CurseForge : références → hashes, que
//   Modrinth reconnaît ensuite) ;
// - `findCandidates` : proposer, pour un mod sans version Modrinth pour la cible, des fichiers
//   trouvés ailleurs (ex. GitHub Releases). Ce sont des pistes « à vérifier » : jamais ajoutées
//   automatiquement au pack migré.

import type { FetchLike } from '../modrinth/client.js';
import type { MigrationTarget, ModPack } from '../types.js';

export const CANDIDATE_NOTE = 'external source, to verify';

export interface SourceContext {
  // Variables d'environnement (jetons optionnels, ex. GITHUB_TOKEN) ; jamais lues ailleurs.
  env: NodeJS.ProcessEnv;
  // Options de la source dans modshift.config.json (`sources.<id>`), déjà validées.
  options: unknown;
  offline: boolean;
  // Avertissement affiché dans les rapports.
  warn: (message: string) => void;
  // Message de progression (stderr) et détail visible avec --verbose.
  log: (message: string) => void;
  debug: (message: string) => void;
}

// Mod pour lequel une source peut proposer un fichier.
export interface CandidateRequest {
  fileName: string;
  // Projet Modrinth, s'il a été identifié.
  slug?: string;
  projectId?: string;
  title?: string;
  // Identifiants lus dans le jar (fabric.mod.json, mods.toml…).
  modIds: string[];
}

export interface SourceCandidate {
  // Identifiant de la source qui l'a trouvé.
  source: string;
  title: string;
  version: string;
  fileName: string;
  // URL de téléchargement (https).
  url: string;
  // Page à consulter avant usage (release, projet…).
  pageUrl?: string;
  size?: number;
  // Empreintes connues (ex. sha256 fourni par GitHub) ; .mrpack exige sha1 et sha512.
  hashes?: { sha1?: string; sha256?: string; sha512?: string };
  publishedAt?: string;
  // Pourquoi ce fichier correspond à la cible (ex. « name contains 1.21.1 and fabric »).
  reason: string;
  note: typeof CANDIDATE_NOTE;
}

export interface ModSource {
  // Identifiant stable : minuscules, chiffres et tirets (clé de `sources` dans la config).
  id: string;
  name: string;
  description: string;
  // Source principale (Modrinth) : interrogée par le moteur lui-même, sans point d'extension.
  primary?: boolean;
  // Valide `sources.<id>` de modshift.config.json ; lève une Error au message lisible.
  validateOptions?: (options: unknown) => void;
  prepare?: (pack: ModPack, context: SourceContext) => Promise<void>;
  findCandidates?: (
    mod: CandidateRequest,
    target: MigrationTarget,
    context: SourceContext,
  ) => Promise<SourceCandidate[]>;
}

// Dépendances injectables des sources intégrées (les tests passent un faux fetch).
export interface SourceDeps {
  fetch?: FetchLike;
  userAgent?: string;
}
