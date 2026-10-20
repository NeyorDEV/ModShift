import type { ModrinthSearchHit } from '../modrinth/types.js';
import type { MigrationTarget } from '../types.js';
import { LOADERS } from '../types.js';
import { acceptedLoaders } from './loaders.js';
import type { ModrinthApi } from './refs.js';
import { ALTERNATIVE_NOTE, type Alternative, type ProjectRef } from './types.js';

const SEARCH_LIMIT = 5;

// Catégories Modrinth qui sont en réalité des loaders (mélangés aux catégories dans la recherche).
const NON_THEMATIC_CATEGORIES = new Set<string>([...LOADERS, 'minecraft', 'datapack']);

function hitToProject(hit: ModrinthSearchHit): ProjectRef {
  return { id: hit.project_id, slug: hit.slug, title: hit.title, categories: hit.categories };
}

// Cherche des projets compatibles avec la cible pouvant remplacer `project` :
// 1. même nom (portages, forks : « X Reforged », « X Fabric »…), par pertinence ;
// 2. mêmes catégories, par téléchargements.
// Les résultats sont des suggestions : ils doivent être vérifiés par l'utilisateur.
export async function findAlternatives(
  api: ModrinthApi,
  project: ProjectRef,
  target: MigrationTarget,
  options: { max: number; excludeProjectIds: Set<string> },
): Promise<Alternative[]> {
  if (options.max <= 0) return [];
  const baseFacets = [
    acceptedLoaders(target.loader).map((l) => `categories:${l}`),
    [`versions:${target.minecraftVersion}`],
    ['project_type:mod'],
  ];
  const results: Alternative[] = [];
  const seen = new Set<string>([project.id, ...options.excludeProjectIds]);
  const add = (hits: ModrinthSearchHit[], reason: Alternative['reason']): void => {
    for (const hit of hits) {
      if (results.length >= options.max) return;
      if (seen.has(hit.project_id)) continue;
      seen.add(hit.project_id);
      results.push({
        project: hitToProject(hit),
        downloads: hit.downloads,
        reason,
        note: ALTERNATIVE_NOTE,
      });
    }
  };

  const byName = await api.search({
    query: project.title,
    facets: baseFacets,
    index: 'relevance',
    limit: SEARCH_LIMIT,
  });
  // On ne garde que les résultats dont le titre partage un mot significatif avec l'original,
  // la recherche plein texte de Modrinth étant volontairement large.
  add(
    byName.hits.filter((hit) => sharesSignificantWord(hit.title, project.title)),
    'similar-name',
  );

  const categories = project.categories.filter((c) => !NON_THEMATIC_CATEGORIES.has(c));
  if (results.length < options.max && categories.length > 0) {
    const byCategory = await api.search({
      facets: [...baseFacets, categories.map((c) => `categories:${c}`)],
      index: 'downloads',
      limit: SEARCH_LIMIT,
    });
    add(byCategory.hits, 'same-category');
  }
  return results;
}

const STOP_WORDS = new Set(['the', 'mod', 'mods', 'for', 'and', 'api', 'lib', 'of']);

function words(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

export function sharesSignificantWord(a: string, b: string): boolean {
  const set = new Set(words(b));
  return words(a).some((w) => set.has(w));
}
