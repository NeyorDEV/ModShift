import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ModPack } from '../types.js';
import { parseCurseForgeZip } from './curseforge.js';
import { InputError } from './errors.js';
import { parseModsFolder } from './folder.js';
import { parseMrpack } from './mrpack.js';
import { readZip } from './zip.js';

export { InputError } from './errors.js';
export { parseCurseForgeZip } from './curseforge.js';
export { parseModsFolder } from './folder.js';
export { parseMrpack } from './mrpack.js';
export { readJarMetadata } from './jar.js';

export type PackFormat = 'mrpack' | 'curseforge';

// Taille maximale d'une archive de pack lue en mémoire.
export const MAX_PACK_FILE_BYTES = 1024 * 1024 * 1024;

// Détecte le format d'une archive à partir des fichiers qu'elle contient.
export function detectArchiveFormat(data: Uint8Array, label: string): PackFormat {
  const names = new Set<string>();
  readZip(data, label, (name) => {
    names.add(name);
    return false;
  });
  if (names.has('modrinth.index.json')) return 'mrpack';
  if (names.has('manifest.json')) return 'curseforge';
  throw new InputError(
    `${label}: unknown archive format (expected modrinth.index.json or manifest.json)`,
  );
}

// Charge un modpack depuis un chemin : .mrpack, zip CurseForge ou dossier de .jar.
export async function loadPack(path: string): Promise<ModPack> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    throw new InputError(`Cannot access ${path}`, { cause: error });
  }
  if (info.isDirectory()) return parseModsFolder(path);
  if (!info.isFile()) throw new InputError(`${path} is not a regular file or a directory`);
  // Évite de charger en mémoire un fichier démesuré (un modpack pèse rarement plus de 100 Mo).
  if (info.size > MAX_PACK_FILE_BYTES) {
    throw new InputError(
      `${basename(path)} is ${Math.round(info.size / 1024 / 1024)} MiB, larger than the ${MAX_PACK_FILE_BYTES / 1024 / 1024} MiB limit`,
    );
  }

  const data = new Uint8Array(await readFile(path));
  const label = basename(path);
  return detectArchiveFormat(data, label) === 'mrpack'
    ? parseMrpack(data, label)
    : parseCurseForgeZip(data, label);
}
