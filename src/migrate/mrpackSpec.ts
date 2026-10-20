import { strFromU8, unzipSync } from 'fflate';
import type { Loader } from '../types.js';

// Règles du format .mrpack, relevées dans le code source de Modrinth (voir docs/mrpack-format.md).

export const MRPACK_INDEX_FILE = 'modrinth.index.json';
export const MRPACK_FORMAT_VERSION = 1;
export const OVERRIDE_FOLDERS = ['overrides/', 'client-overrides/', 'server-overrides/'] as const;
export const ALLOWED_DOWNLOAD_DOMAINS = [
  'cdn.modrinth.com',
  'github.com',
  'raw.githubusercontent.com',
];
export const DEPENDENCY_KEYS = ['minecraft', 'forge', 'neoforge', 'fabric-loader', 'quilt-loader'];
export const ENV_VALUES = ['required', 'optional', 'unsupported', 'unknown'];

export const LOADER_DEPENDENCY_KEY: Record<Loader, string> = {
  forge: 'forge',
  neoforge: 'neoforge',
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
};

export type EnvValue = 'required' | 'optional' | 'unsupported' | 'unknown';

export interface MrpackFile {
  path: string;
  hashes: { sha1: string; sha512: string };
  env?: { client: EnvValue; server: EnvValue };
  downloads: string[];
  fileSize: number;
}

export interface MrpackIndex {
  formatVersion: 1;
  game: 'minecraft';
  versionId: string;
  name: string;
  summary?: string;
  files: MrpackFile[];
  dependencies: Record<string, string>;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Chemin relatif Unix « sûr » au sens de Modrinth (SafeRelativeUtf8UnixPathBuf).
export function isSpecSafePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) {
    return false;
  }
  return path
    .split('/')
    .every((part) => part !== '..' && part !== '' && !WINDOWS_RESERVED.test(part));
}

// URL de téléchargement acceptée : absolue, déjà normalisée, sur un domaine autorisé.
export function isAllowedDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.href === value &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    ALLOWED_DOWNLOAD_DOMAINS.includes(url.hostname)
  );
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Valide un modrinth.index.json (déjà parsé). Renvoie la liste des violations (vide si valide).
export function validateMrpackIndex(index: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(index)) return ['index must be a JSON object'];

  if (index.formatVersion !== MRPACK_FORMAT_VERSION) errors.push('formatVersion must be 1');
  if (index.game !== 'minecraft') errors.push('game must be "minecraft"');
  for (const field of ['versionId', 'name'] as const) {
    const value = index[field];
    if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
      errors.push(`${field} must be a string of 1 to 512 characters`);
    }
  }
  if (
    index.summary !== undefined &&
    (typeof index.summary !== 'string' || index.summary.length > 2048)
  ) {
    errors.push('summary must be a string of at most 2048 characters');
  }

  const deps = index.dependencies;
  if (!isObject(deps)) {
    errors.push('dependencies must be an object');
  } else {
    for (const [key, value] of Object.entries(deps)) {
      if (!DEPENDENCY_KEYS.includes(key)) errors.push(`unknown dependency "${key}"`);
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(`dependency "${key}" must be a non-empty string`);
      }
    }
    if (typeof deps.minecraft !== 'string') errors.push('dependencies.minecraft is required');
  }

  if (!Array.isArray(index.files)) {
    errors.push('files must be an array');
    return errors;
  }
  const seenPaths = new Set<string>();
  index.files.forEach((file: unknown, i) => {
    const at = `files[${i}]`;
    if (!isObject(file)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof file.path !== 'string' || !isSpecSafePath(file.path)) {
      errors.push(`${at}.path is not a safe relative path`);
    } else if (seenPaths.has(file.path)) {
      errors.push(`${at}.path "${file.path}" is duplicated`);
    } else {
      seenPaths.add(file.path);
    }
    const hashes = file.hashes;
    if (
      !isObject(hashes) ||
      typeof hashes.sha1 !== 'string' ||
      !/^[0-9a-f]{40}$/.test(hashes.sha1)
    ) {
      errors.push(`${at}.hashes.sha1 must be a 40-character hex string`);
    }
    if (
      !isObject(hashes) ||
      typeof hashes.sha512 !== 'string' ||
      !/^[0-9a-f]{128}$/.test(hashes.sha512)
    ) {
      errors.push(`${at}.hashes.sha512 must be a 128-character hex string`);
    }
    if (file.env !== undefined) {
      const env = file.env;
      if (
        !isObject(env) ||
        !ENV_VALUES.includes(String(env.client)) ||
        !ENV_VALUES.includes(String(env.server))
      ) {
        errors.push(`${at}.env must define client and server as ${ENV_VALUES.join('/')}`);
      }
    }
    if (
      !Array.isArray(file.downloads) ||
      file.downloads.length === 0 ||
      !file.downloads.every((d) => typeof d === 'string' && isAllowedDownloadUrl(d))
    ) {
      errors.push(`${at}.downloads must list URLs on ${ALLOWED_DOWNLOAD_DOMAINS.join(', ')}`);
    }
    if (
      typeof file.fileSize !== 'number' ||
      !Number.isInteger(file.fileSize) ||
      file.fileSize < 0 ||
      file.fileSize > 0xffffffff
    ) {
      errors.push(`${at}.fileSize must be an unsigned 32-bit integer`);
    }
  });
  return errors;
}

// Valide une archive .mrpack complète : index présent et valide, chemins des overrides sûrs,
// au moins un fichier ou un dossier d'overrides.
export function validateMrpackArchive(data: Uint8Array): string[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    return ['not a valid zip archive'];
  }
  const indexData = entries[MRPACK_INDEX_FILE];
  if (!indexData) return [`missing ${MRPACK_INDEX_FILE}`];
  let index: unknown;
  try {
    index = JSON.parse(strFromU8(indexData));
  } catch {
    return [`${MRPACK_INDEX_FILE} is not valid JSON`];
  }
  const errors = validateMrpackIndex(index);
  const names = Object.keys(entries);
  for (const name of names) {
    // Les entrées de dossier (« overrides/config/ ») sont tolérées.
    if (name === MRPACK_INDEX_FILE || name.endsWith('/')) continue;
    const folder = OVERRIDE_FOLDERS.find((f) => name.startsWith(f));
    if (!folder) {
      errors.push(`unexpected archive entry "${name}"`);
    } else if (!isSpecSafePath(name.slice(folder.length))) {
      errors.push(`unsafe override path "${name}"`);
    }
  }
  const files = isObject(index) && Array.isArray(index.files) ? index.files : [];
  if (files.length === 0 && !names.some((n) => n.startsWith('overrides/'))) {
    errors.push('pack has no files');
  }
  return errors;
}
