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

// Poids du score de pertinence (sur 100).
const WEIGHTS = { categories: 40, name: 30, keywords: 10, popularity: 20 };

function themes(categories: string[]): string[] {
  return categories.filter((c) => !NON_THEMATIC_CATEGORIES.has(c));
}

function formatDownloads(downloads: number): string {
  if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M downloads`;
  if (downloads >= 1_000) return `${Math.round(downloads / 1_000)}k downloads`;
  return `${downloads} downloads`;
}

// Score de pertinence d'un candidat (0–100) et explication lisible.
export function scoreAlternative(
  hit: ModrinthSearchHit,
  original: { title: string; categories: string[]; description?: string },
): { score: number; explanation: string; nameMatch: boolean } {
  const wanted = themes(original.categories);
  const shared = themes(hit.categories).filter((c) => wanted.includes(c));
  const categoryScore = wanted.length > 0 ? shared.length / wanted.length : 0;

  const titleWords = new Set(words(original.title));
  const sharedTitle = words(hit.title).filter((w) => titleWords.has(w));
  const nameScore = titleWords.size > 0 ? Math.min(1, sharedTitle.length / titleWords.size) : 0;

  // Mots-clés : mots du titre et de la description d'origine retrouvés dans la description du candidat.
  const keywords = new Set([...titleWords, ...words(original.description ?? '').slice(0, 20)]);
  const hitText = new Set(words(`${hit.title} ${hit.description}`));
  const sharedKeywords = [...keywords].filter((w) => hitText.has(w));
  const keywordScore =
    keywords.size > 0 ? Math.min(1, sharedKeywords.length / Math.min(keywords.size, 5)) : 0;

  // Popularité sur une échelle logarithmique (10 millions de téléchargements ≈ maximum).
  const popularityScore = Math.min(1, Math.log10(Math.max(1, hit.downloads)) / 7);

  const score = Math.round(
    WEIGHTS.categories * categoryScore +
      WEIGHTS.name * nameScore +
      WEIGHTS.keywords * keywordScore +
      WEIGHTS.popularity * popularityScore,
  );
  const parts: string[] = [];
  if (sharedTitle.length > 0) parts.push(`similar name (${sharedTitle.join(', ')})`);
  if (shared.length > 0) parts.push(`same categories (${shared.join(', ')})`);
  const extraKeywords = sharedKeywords.filter((w) => !sharedTitle.includes(w));
  if (extraKeywords.length > 0) parts.push(`keywords (${extraKeywords.slice(0, 3).join(', ')})`);
  parts.push(formatDownloads(hit.downloads));
  return { score, explanation: parts.join(' · '), nameMatch: sharedTitle.length > 0 };
}

// Cherche des projets compatibles avec la cible pouvant remplacer `project`, puis les classe par
// pertinence (catégories communes, nom proche, mots-clés, popularité) :
// 1. recherche par nom (portages, forks : « X Reforged », « X Fabric »…) ;
// 2. recherche dans les mêmes catégories, par téléchargements.
// Les résultats sont des suggestions : ils doivent être vérifiés par l'utilisateur.
export async function findAlternatives(
  api: ModrinthApi,
  project: ProjectRef,
  target: MigrationTarget,
  options: { max: number; excludeProjectIds: Set<string>; description?: string },
): Promise<Alternative[]> {
  if (options.max <= 0) return [];
  const baseFacets = [
    acceptedLoaders(target.loader).map((l) => `categories:${l}`),
    [`versions:${target.minecraftVersion}`],
    ['project_type:mod'],
  ];
  const candidates = new Map<string, ModrinthSearchHit>();
  const seen = new Set<string>([project.id, ...options.excludeProjectIds]);
  const collect = (hits: ModrinthSearchHit[]): void => {
    for (const hit of hits) {
      if (!seen.has(hit.project_id) && !candidates.has(hit.project_id)) {
        candidates.set(hit.project_id, hit);
      }
    }
  };

  const byName = await api.search({
    query: project.title,
    facets: baseFacets,
    index: 'relevance',
    limit: SEARCH_LIMIT,
  });
  // La recherche plein texte de Modrinth est large : seuls les titres partageant un mot
  // significatif avec l'original sont retenus depuis cette recherche.
  collect(byName.hits.filter((hit) => sharesSignificantWord(hit.title, project.title)));

  const categories = themes(project.categories);
  if (categories.length > 0) {
    const byCategory = await api.search({
      facets: [...baseFacets, categories.map((c) => `categories:${c}`)],
      index: 'downloads',
      limit: SEARCH_LIMIT,
    });
    collect(byCategory.hits);
  }

  const original = {
    title: project.title,
    categories: project.categories,
    description: options.description,
  };
  return [...candidates.values()]
    .map((hit) => ({ hit, ...scoreAlternative(hit, original) }))
    .sort((a, b) => b.score - a.score || b.hit.downloads - a.hit.downloads)
    .slice(0, options.max)
    .map(({ hit, score, explanation, nameMatch }) => ({
      project: hitToProject(hit),
      downloads: hit.downloads,
      reason: nameMatch ? ('similar-name' as const) : ('same-category' as const),
      score,
      explanation,
      note: ALTERNATIVE_NOTE,
    }));
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
