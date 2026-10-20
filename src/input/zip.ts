import { strFromU8, unzipSync } from 'fflate';
import { InputError } from './errors.js';

export type ZipEntries = Record<string, Uint8Array>;

// Limites contre les archives malveillantes (« zip bombs ») : fflate alloue chaque entrée
// d'après la taille décompressée déclarée dans l'archive, on vérifie donc ces tailles
// déclarées et le nombre d'entrées avant toute décompression.
export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const MiB = 1024 * 1024;

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 50_000,
  maxEntryBytes: 256 * MiB,
  maxTotalBytes: 1024 * MiB,
};

// Métadonnées de mod (fabric.mod.json, mods.toml…) : quelques kilo-octets en pratique.
export const METADATA_ZIP_LIMITS: ZipLimits = {
  ...DEFAULT_ZIP_LIMITS,
  maxEntryBytes: 8 * MiB,
  maxTotalBytes: 32 * MiB,
};

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / MiB)} MiB`;
}

// Décompresse une archive zip en mémoire. `filter` permet de ne décompresser
// que les entrées utiles (les .jar peuvent être volumineux).
export function readZip(
  data: Uint8Array,
  label: string,
  filter?: (name: string) => boolean,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipEntries {
  let entries = 0;
  let total = 0;
  let violation: string | undefined;
  let result: ZipEntries;
  try {
    result = unzipSync(data, {
      filter: (file) => {
        if (violation) return false;
        entries++;
        if (entries > limits.maxEntries) {
          violation = `more than ${limits.maxEntries} entries`;
          return false;
        }
        if (filter && !filter(file.name)) return false;
        if (file.originalSize > limits.maxEntryBytes) {
          violation = `entry "${file.name}" would expand to ${formatMiB(file.originalSize)} (limit ${formatMiB(limits.maxEntryBytes)})`;
          return false;
        }
        total += file.originalSize;
        if (total > limits.maxTotalBytes) {
          violation = `content would expand to more than ${formatMiB(limits.maxTotalBytes)}`;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    throw new InputError(`Cannot read ${label}: not a valid zip file`, { cause: error });
  }
  if (violation) {
    throw new InputError(`Refusing to read ${label}: ${violation} (possible zip bomb)`);
  }
  return result;
}

export function zipText(entries: ZipEntries, name: string): string | undefined {
  const entry = entries[name];
  return entry ? strFromU8(entry) : undefined;
}

// Parse du JSON en tolérant les caractères de contrôle bruts que certains
// mods laissent dans leurs fichiers (Fabric utilise un parseur permissif).
export function parseLenientJson(text: string, label: string): unknown {
  // Retire un éventuel BOM UTF-8 (U+FEFF) en début de fichier.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      // eslint-disable-next-line no-control-regex
      return JSON.parse(cleaned.replace(/[\u0000-\u001F]+/g, ' '));
    } catch (error) {
      throw new InputError(`Invalid JSON in ${label}`, { cause: error });
    }
  }
}

// Petits utilitaires de lecture sûre d'objets JSON non typés.
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
