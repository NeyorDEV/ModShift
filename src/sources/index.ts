import type { AnalysisResult } from '../core/types.js';
import type { CurseForgeClient } from '../curseforge/client.js';
import type { ModPack } from '../types.js';
import { curseForgeSource } from './curseforge.js';
import { githubReleasesSource } from './githubReleases.js';
import { modrinthSource } from './modrinth.js';
import { SourceRegistry } from './registry.js';
import type { CandidateRequest, ModSource, SourceContext, SourceDeps } from './types.js';

export { SourceRegistry, SourceRegistryError } from './registry.js';
export { curseForgeSource } from './curseforge.js';
export { githubReleasesSource, GITHUB_TOKEN_ENV } from './githubReleases.js';
export { modrinthSource } from './modrinth.js';
export * from './types.js';

// Registre par défaut : Modrinth (principale), CurseForge, GitHub Releases.
export function createDefaultRegistry(
  deps: SourceDeps & { createCurseForgeClient: (apiKey: string) => CurseForgeClient },
): SourceRegistry {
  return new SourceRegistry()
    .register(modrinthSource)
    .register(curseForgeSource({ createClient: deps.createCurseForgeClient }))
    .register(githubReleasesSource(deps));
}

export type ContextFor = (source: ModSource) => SourceContext;

// Étape « prepare » de chaque source, dans l'ordre du registre.
export async function prepareWithSources(
  pack: ModPack,
  registry: SourceRegistry,
  contextFor: ContextFor,
): Promise<void> {
  for (const source of registry.list()) {
    if (source.prepare) await source.prepare(pack, contextFor(source));
  }
}

// Demande aux sources des fichiers pour les mods sans version Modrinth pour la cible, et les
// range dans `mod.external`. Ce sont des pistes à vérifier : le plan de migration les ignore.
export async function findExternalCandidates(
  analysis: AnalysisResult,
  pack: ModPack,
  registry: SourceRegistry,
  contextFor: ContextFor,
): Promise<void> {
  const finders = registry.list().filter((s) => s.findCandidates);
  if (finders.length === 0) return;
  for (const mod of analysis.mods) {
    if (mod.status !== 'not-found' && mod.status !== 'alternative-suggested') continue;
    const entry = pack.mods.find((m) => m.path === mod.path);
    const request: CandidateRequest = {
      fileName: mod.fileName,
      slug: mod.project?.slug,
      projectId: mod.project?.id,
      title: mod.project?.title,
      modIds: entry?.metadata.map((m) => m.modId) ?? [],
    };
    for (const source of finders) {
      const context = contextFor(source);
      const found = (await source.findCandidates?.(request, analysis.target, context)) ?? [];
      if (found.length > 0) mod.external = [...(mod.external ?? []), ...found];
    }
  }
}
