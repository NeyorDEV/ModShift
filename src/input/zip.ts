import { strFromU8, unzipSync } from 'fflate';
import { InputError } from './errors.js';

export type ZipEntries = Record<string, Uint8Array>;

// Décompresse une archive zip en mémoire. `filter` permet de ne décompresser
// que les entrées utiles (les .jar peuvent être volumineux).
export function readZip(
  data: Uint8Array,
  label: string,
  filter?: (name: string) => boolean,
): ZipEntries {
  try {
    return unzipSync(data, filter ? { filter: (file) => filter(file.name) } : undefined);
  } catch (error) {
    throw new InputError(`Cannot read ${label}: not a valid zip file`, { cause: error });
  }
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
