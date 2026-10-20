// Sous-ensemble typé des objets de l'API Modrinth v2 utilisés par ModShift.
// Référence : spécification OpenAPI officielle (Labrinth v2.7.0).

export type HashAlgorithm = 'sha1' | 'sha512';

export type DependencyType = 'required' | 'optional' | 'incompatible' | 'embedded';

export type VersionType = 'release' | 'beta' | 'alpha';

export interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  file_name: string | null;
  dependency_type: DependencyType;
}

export interface ModrinthVersionFile {
  hashes: { sha1: string; sha512: string };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  file_type?: string | null;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: VersionType;
  date_published: string;
  dependencies: ModrinthDependency[];
  files: ModrinthVersionFile[];
  status?: string;
  // Environnement pris en charge (client_only, server_only…), voir src/core/sides.ts.
  environment?: string;
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  additional_categories?: string[];
  project_type: string;
  client_side?: string;
  server_side?: string;
  loaders?: string[];
  game_versions?: string[];
  downloads?: number;
}

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  project_type: string;
  versions: string[];
  downloads: number;
  author?: string;
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export type SearchIndex = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export interface SearchParams {
  query?: string;
  // Facettes : liste de groupes combinés par ET ; chaque groupe est un OU de conditions.
  facets?: string[][];
  index?: SearchIndex;
  limit?: number;
  offset?: number;
}
