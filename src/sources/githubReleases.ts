// Exemple de source tierce : GitHub Releases.
//
// Contrat vérifié dans la description OpenAPI officielle de l'API REST de GitHub
// (github/rest-api-description, descriptions/api.github.com) et dans la documentation
// (github/docs) :
// - GET https://api.github.com/repos/{owner}/{repo}/releases?per_page=… (100 au maximum) ;
// - chaque release : tag_name, name, draft, prerelease, published_at, html_url, assets[] ;
// - chaque asset : name, browser_download_url, size, state (uploaded | open), digest
//   (« sha256:… », peut être null) ;
// - en-têtes : User-Agent obligatoire, Accept: application/vnd.github+json, jeton optionnel en
//   « Authorization: Bearer … ». Sans X-GitHub-Api-Version, la version par défaut est utilisée.
//   Sans jeton : 60 requêtes par heure.
//
// Les dépôts sont déclarés par l'utilisateur (`sources.github-releases.repositories` dans
// modshift.config.json). Le jeton vient uniquement de la variable GITHUB_TOKEN.

import { matchesModRef } from '../config/config.js';
import { DEFAULT_USER_AGENT } from '../modrinth/client.js';
import { acceptedLoaders } from '../loaders/registry.js';
import { type Loader, LOADERS } from '../types.js';
import {
  CANDIDATE_NOTE,
  type CandidateRequest,
  type ModSource,
  type SourceCandidate,
  type SourceDeps,
} from './types.js';

export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';
const API = 'https://api.github.com';
const REPOSITORY_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_CANDIDATES = 3;

export interface GitHubReleasesOptions {
  // Mod (fichier, slug, id de projet Modrinth ou mod id du jar) → « owner/repo ».
  repositories: Record<string, string>;
  // Inclure les pré-versions (false par défaut).
  prereleases?: boolean;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  state: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GitHubAsset[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOptions(options: unknown): asserts options is GitHubReleasesOptions {
  if (!isObject(options)) throw new Error('"sources.github-releases" must be an object');
  for (const key of Object.keys(options)) {
    if (key !== 'repositories' && key !== 'prereleases') {
      throw new Error(`unknown key "sources.github-releases.${key}"`);
    }
  }
  const { repositories, prereleases } = options;
  if (!isObject(repositories)) {
    throw new Error('"sources.github-releases.repositories" must be an object');
  }
  for (const [mod, repo] of Object.entries(repositories)) {
    if (typeof repo !== 'string' || !REPOSITORY_PATTERN.test(repo)) {
      throw new Error(
        `"sources.github-releases.repositories.${mod}" must be "owner/repo" (got ${JSON.stringify(repo)})`,
      );
    }
  }
  if (prereleases !== undefined && typeof prereleases !== 'boolean') {
    throw new Error('"sources.github-releases.prereleases" must be true or false');
  }
}

function repositoryFor(mod: CandidateRequest, options: GitHubReleasesOptions): string | undefined {
  for (const [pattern, repo] of Object.entries(options.repositories)) {
    if (
      matchesModRef(pattern, {
        fileName: mod.fileName,
        slug: mod.slug,
        projectId: mod.projectId,
      }) ||
      mod.modIds.includes(pattern)
    ) {
      return repo;
    }
  }
  return undefined;
}

// Mots d'un nom de fichier, pour comparer versions et loaders sans faux positifs
// (« 1.21.1 » ne doit pas correspondre à « 1.21.10 », ni « forge » à « neoforge »).
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .flatMap((word) => word.split(/\.(?=[a-z])|(?<=[a-z])\./))
    .filter(Boolean);
}

// Un asset correspond à la cible si son nom cite la version de Minecraft et ne cite pas un
// loader non accepté par la cible (replis documentés inclus). Heuristique sur le nom : le
// résultat reste « à vérifier ».
export function assetMatches(
  name: string,
  target: { minecraftVersion: string; loader: Loader },
): string | undefined {
  if (!/\.jar$/i.test(name) || /-(sources|dev|javadoc)\.jar$/i.test(name)) return undefined;
  const words = tokens(name.replace(/\.jar$/i, ''));
  const mc = target.minecraftVersion;
  if (!words.some((w) => w === mc || w === `mc${mc}`)) return undefined;
  const accepted = acceptedLoaders(target.loader);
  const named = LOADERS.filter((l) => words.includes(l));
  if (named.length > 0 && !named.some((l) => accepted.includes(l))) return undefined;
  const loader = named.find((l) => accepted.includes(l));
  return loader
    ? `file name mentions Minecraft ${mc} and ${loader}`
    : `file name mentions Minecraft ${mc} (no loader in the name)`;
}

export function githubReleasesSource(deps: SourceDeps = {}): ModSource {
  const fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
  const userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
  return {
    id: 'github-releases',
    name: 'GitHub Releases',
    description:
      'Looks for a matching .jar in the releases of repositories you list (GITHUB_TOKEN optional).',
    validateOptions,
    async findCandidates(mod, target, context) {
      const options = context.options as GitHubReleasesOptions | undefined;
      if (!options) return [];
      const repo = repositoryFor(mod, options);
      if (!repo) return [];
      if (context.offline) {
        context.warn(
          `${mod.title ?? mod.fileName}: GitHub Releases of ${repo} not checked offline.`,
        );
        return [];
      }
      const headers: Record<string, string> = {
        'User-Agent': userAgent,
        Accept: 'application/vnd.github+json',
      };
      const token = context.env[GITHUB_TOKEN_ENV];
      if (token) headers.Authorization = `Bearer ${token}`;
      const url = `${API}/repos/${repo}/releases?per_page=30`;
      context.debug(`GET ${url}`);
      let releases: GitHubRelease[];
      try {
        const response = await fetchImpl(url, { headers });
        if (response.status === 404) {
          context.warn(
            `GitHub Releases: repository ${repo} not found (or private without a token).`,
          );
          return [];
        }
        if (response.status === 403 || response.status === 429) {
          context.warn(
            `GitHub Releases: rate limit reached for ${repo} (60 requests/hour without a token; set ${GITHUB_TOKEN_ENV}).`,
          );
          return [];
        }
        if (!response.ok) {
          context.warn(`GitHub Releases: ${repo} answered HTTP ${response.status}.`);
          return [];
        }
        const body: unknown = await response.json();
        releases = Array.isArray(body) ? (body as GitHubRelease[]) : [];
      } catch (error) {
        context.warn(
          `GitHub Releases: cannot reach the GitHub API for ${repo} (${(error as Error).message}).`,
        );
        return [];
      }

      const candidates: SourceCandidate[] = [];
      const sorted = releases
        .filter((r) => !r.draft && (options.prereleases === true || !r.prerelease))
        .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
      for (const release of sorted) {
        for (const asset of release.assets ?? []) {
          if (asset.state !== 'uploaded') continue;
          if (!asset.browser_download_url.startsWith('https://github.com/')) continue;
          const reason = assetMatches(asset.name, target);
          if (!reason) continue;
          const sha256 = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined;
          candidates.push({
            source: 'github-releases',
            title: mod.title ?? mod.fileName,
            version: release.tag_name,
            fileName: asset.name,
            url: asset.browser_download_url,
            pageUrl: release.html_url,
            size: asset.size,
            ...(sha256 ? { hashes: { sha256 } } : {}),
            ...(release.published_at ? { publishedAt: release.published_at } : {}),
            reason: `${repo} release ${release.tag_name}: ${reason}`,
            note: CANDIDATE_NOTE,
          });
          if (candidates.length >= MAX_CANDIDATES) return candidates;
        }
      }
      return candidates;
    },
  };
}
