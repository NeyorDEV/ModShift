import { isSpecSafePath } from '../migrate/mrpackSpec.js';
import type { ModPack } from '../types.js';
import { CF_HASH_ALGO_SHA1, CURSEFORGE_API_KEY_ENV, type CurseForgeClient } from './client.js';

export interface CurseForgeResolution {
  resolved: number;
  unresolved: number;
}

// Complète les références CurseForge d'un pack (projectID/fileID) avec ce que renvoie l'API :
// nom de fichier, SHA-1 (qui permet ensuite d'identifier le même fichier sur Modrinth),
// nom et slug du projet (repli d'identification, non vérifié).
// Aucun fichier n'est téléchargé depuis CurseForge.
export async function resolveCurseForgeRefs(
  pack: ModPack,
  client: CurseForgeClient,
): Promise<CurseForgeResolution> {
  const refs = pack.mods.filter((m) => m.curseforge);
  if (refs.length === 0) return { resolved: 0, unresolved: 0 };

  const files = new Map(
    (await client.getFiles(refs.map((m) => m.curseforge?.fileId ?? 0))).map((f) => [f.id, f]),
  );
  const mods = new Map(
    (await client.getMods(refs.map((m) => m.curseforge?.projectId ?? 0))).map((m) => [m.id, m]),
  );

  let resolved = 0;
  for (const entry of refs) {
    const ref = entry.curseforge;
    if (!ref) continue;
    const file = files.get(ref.fileId);
    const mod = mods.get(ref.projectId);
    if (mod) {
      ref.name = mod.name;
      ref.slug = mod.slug;
    }
    if (!file) {
      pack.warnings.push(
        `CurseForge file ${ref.fileId} (project ${ref.projectId}) was not returned by the API (deleted or private?)`,
      );
      continue;
    }
    resolved++;
    ref.resolved = true;
    const path = `mods/${file.fileName}`;
    if (!file.fileName.includes('/') && isSpecSafePath(path)) {
      entry.fileName = file.fileName;
      entry.path = path;
    }
    const sha1 = file.hashes?.find((h) => h.algo === CF_HASH_ALGO_SHA1)?.value.toLowerCase();
    if (sha1 && /^[0-9a-f]{40}$/.test(sha1)) entry.hashes = { sha1 };
    if (typeof file.fileLength === 'number') entry.fileSize = file.fileLength;
  }
  return { resolved, unresolved: refs.length - resolved };
}

// Avertissement quand des références CurseForge restent non résolues faute de clé.
export function missingKeyWarning(pack: ModPack): string | undefined {
  const count = pack.mods.filter((m) => m.curseforge && !m.curseforge.resolved).length;
  if (count === 0) return undefined;
  return `${count} CurseForge file reference(s) not identified: set ${CURSEFORGE_API_KEY_ENV} (a key from https://console.curseforge.com) to resolve them.`;
}
