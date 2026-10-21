// Types de contenu d'un pack autres que les mods : packs de ressources et shaders.
//
// Sources (code de Modrinth, validateurs de labrinth) : apps/labrinth/src/validate/resourcepack.rs
// accepte le loader « minecraft » ; shader.rs accepte « optifine » et « iris », « canvas »
// (CanvasShaderValidator) et « vanilla ». Dossiers d'installation : « resourcepacks » (packwiz,
// curseforge.go) et « shaderpacks » (dossier lu par Iris et OptiFine).

import type { MigrationTarget } from '../types.js';
import { acceptedLoaders } from './loaders.js';

export type ContentType = 'mod' | 'resourcepack' | 'shader';

export function contentTypeOf(projectType: string | undefined): ContentType {
  return projectType === 'resourcepack' || projectType === 'shader' ? projectType : 'mod';
}

// Loaders Modrinth sous lesquels chercher une version pour la cible. Un pack de ressources ne
// dépend pas du loader de mods : seule la version de Minecraft compte.
export function loadersFor(type: ContentType, target: MigrationTarget): string[] {
  if (type === 'resourcepack') return ['minecraft'];
  if (type === 'shader') return ['iris', 'optifine', 'canvas', 'vanilla'];
  return acceptedLoaders(target.loader);
}

export const CONTENT_FOLDERS: Record<ContentType, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
};

// Libellé lisible dans les raisons (« No version for Minecraft 26.3 (resource pack). »).
export const CONTENT_LABELS: Record<ContentType, string> = {
  mod: 'mod',
  resourcepack: 'resource pack',
  shader: 'shader',
};

// Segment d'URL des pages de projet Modrinth (modrinth.com/<segment>/<slug>).
export function modrinthPageUrl(project: { slug: string; projectType?: string }): string {
  return `https://modrinth.com/${contentTypeOf(project.projectType)}/${project.slug}`;
}
