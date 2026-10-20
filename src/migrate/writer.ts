import { strToU8, unzipSync, zipSync } from 'fflate';
import type { ModPack } from '../types.js';
import { InputError } from '../input/errors.js';
import { isModJarPath } from '../input/mrpack.js';
import {
  isSpecSafePath,
  MRPACK_INDEX_FILE,
  OVERRIDE_FOLDERS,
  validateMrpackArchive,
  type MrpackIndex,
} from './mrpackSpec.js';

export interface CollectedOverrides {
  // Fichiers à recopier, indexés par leur nom dans le nouveau .mrpack.
  files: Record<string, Uint8Array>;
  // Fichiers d'overrides non recopiés (jars de mods : gérés par l'analyse ; chemins dangereux).
  skipped: { path: string; reason: string }[];
}

// Récupère les overrides du pack d'origine pour les recopier dans le pack migré.
// - .mrpack : overrides/, client-overrides/, server-overrides/ conservés tels quels ;
// - CurseForge : le dossier d'overrides du manifest devient overrides/ ;
// - dossier de .jar : aucun override.
// Les .jar de mods/ sont exclus : chaque mod passe par l'analyse (remplacé ou exclu).
export function collectOverrides(
  archive: Uint8Array | undefined,
  pack: ModPack,
): CollectedOverrides {
  const curseForgeOverridesDir = pack.overridesDir ?? 'overrides';
  const result: CollectedOverrides = { files: {}, skipped: [] };
  if (!archive || pack.source === 'folder') return result;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive);
  } catch (error) {
    throw new InputError('Cannot re-read the source pack archive', { cause: error });
  }

  const mappings: [string, string][] =
    pack.source === 'mrpack'
      ? OVERRIDE_FOLDERS.map((f) => [f, f])
      : [[`${curseForgeOverridesDir.replace(/\/+$/, '')}/`, 'overrides/']];

  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const mapping = mappings.find(([from]) => name.startsWith(from));
    if (!mapping) continue;
    const relative = name.slice(mapping[0].length);
    if (isModJarPath(relative)) {
      result.skipped.push({ path: name, reason: 'mod jar (handled by the analysis)' });
      continue;
    }
    if (!isSpecSafePath(relative)) {
      result.skipped.push({ path: name, reason: 'unsafe path' });
      continue;
    }
    result.files[`${mapping[1]}${relative}`] = content;
  }
  return result;
}

// Erreur levée si le pack généré viole le format .mrpack (garde-fou avant écriture).
export class InvalidMrpackError extends Error {
  constructor(readonly violations: string[]) {
    super(`Generated pack is not a valid .mrpack:\n- ${violations.join('\n- ')}`);
    this.name = 'InvalidMrpackError';
  }
}

// Assemble l'archive .mrpack et vérifie qu'elle respecte le format avant de la renvoyer.
export function buildMrpackArchive(
  index: MrpackIndex,
  overrides: Record<string, Uint8Array>,
  mtime = new Date(),
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [MRPACK_INDEX_FILE]: strToU8(`${JSON.stringify(index, null, 2)}\n`),
  };
  for (const name of Object.keys(overrides).sort()) {
    const content = overrides[name];
    if (content) files[name] = content;
  }
  const archive = zipSync(files, { level: 6, mtime });
  const violations = validateMrpackArchive(archive);
  if (violations.length > 0) throw new InvalidMrpackError(violations);
  return archive;
}
