import type { ModrinthClient } from '../modrinth/client.js';
import type { ModrinthProject, ModrinthVersion } from '../modrinth/types.js';
import type { ProjectRef, VersionRef } from './types.js';

// Sous-ensemble du client utilisé par le moteur (facilite les tests).
export type ModrinthApi = Pick<
  ModrinthClient,
  | 'getVersionsFromHashes'
  | 'getProject'
  | 'getProjects'
  | 'getProjectVersions'
  | 'getVersions'
  | 'search'
>;

export function toProjectRef(project: ModrinthProject): ProjectRef {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    categories: project.categories ?? [],
    // Seulement pour les packs de ressources, shaders… (page Modrinth et dossier différents).
    ...(project.project_type && project.project_type !== 'mod'
      ? { projectType: project.project_type }
      : {}),
  };
}

export function toVersionRef(version: ModrinthVersion): VersionRef {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  return {
    id: version.id,
    projectId: version.project_id,
    name: version.name,
    versionNumber: version.version_number,
    versionType: version.version_type,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    datePublished: version.date_published,
    ...(version.environment ? { environment: version.environment } : {}),
    file: file
      ? {
          fileName: file.filename,
          url: file.url,
          sha1: file.hashes.sha1,
          sha512: file.hashes.sha512,
          size: file.size,
        }
      : undefined,
  };
}
