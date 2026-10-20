import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isLoader, LOADERS, type Loader } from '../types.js';

export const CONFIG_FILE = 'modshift.config.json';

// Fichier de configuration optionnel (modshift.config.json).
export interface ModShiftConfig {
  // Cible par défaut quand --mc / --loader / --loader-version ne sont pas fournis.
  target?: {
    minecraftVersion?: string;
    loader?: Loader;
    loaderVersion?: string;
  };
  // Mods à ignorer : nom de fichier (joker « * » accepté), slug ou id de projet Modrinth.
  ignore?: string[];
  // Correspondances manuelles : mod d'origine (fichier, slug ou id) → projet Modrinth (slug ou id).
  mappings?: Record<string, string>;
}

export interface LoadedConfig {
  config: ModShiftConfig;
  // Chemin du fichier lu (absent si aucune configuration).
  path?: string;
}

export class ConfigError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ConfigError';
  }
}

const KNOWN_KEYS = new Set(['$schema', 'target', 'ignore', 'mappings']);
const TARGET_KEYS = new Set(['minecraftVersion', 'loader', 'loaderVersion']);
// Un fichier de configuration raisonnable fait quelques kilo-octets.
const MAX_CONFIG_BYTES = 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

// Valide le contenu (déjà parsé) d'un fichier de configuration. Les clés inconnues sont refusées
// pour qu'une faute de frappe ne passe pas inaperçue.
export function validateConfig(raw: unknown, path: string): ModShiftConfig {
  if (!isObject(raw)) throw new ConfigError(path, 'the configuration must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new ConfigError(path, `unknown key "${key}" (expected: target, ignore, mappings)`);
    }
  }
  const config: ModShiftConfig = {};

  if (raw.target !== undefined) {
    if (!isObject(raw.target)) throw new ConfigError(path, '"target" must be an object');
    for (const key of Object.keys(raw.target)) {
      if (!TARGET_KEYS.has(key)) throw new ConfigError(path, `unknown key "target.${key}"`);
    }
    const { minecraftVersion, loader, loaderVersion } = raw.target;
    if (minecraftVersion !== undefined && !nonEmptyString(minecraftVersion)) {
      throw new ConfigError(path, '"target.minecraftVersion" must be a non-empty string');
    }
    if (loader !== undefined && (typeof loader !== 'string' || !isLoader(loader))) {
      throw new ConfigError(path, `"target.loader" must be one of: ${LOADERS.join(', ')}`);
    }
    if (loaderVersion !== undefined && !nonEmptyString(loaderVersion)) {
      throw new ConfigError(path, '"target.loaderVersion" must be a non-empty string');
    }
    config.target = {
      ...(minecraftVersion !== undefined ? { minecraftVersion: minecraftVersion.trim() } : {}),
      ...(loader !== undefined ? { loader: loader as Loader } : {}),
      ...(loaderVersion !== undefined ? { loaderVersion: loaderVersion.trim() } : {}),
    };
  }

  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || !raw.ignore.every(nonEmptyString)) {
      throw new ConfigError(path, '"ignore" must be an array of non-empty strings');
    }
    config.ignore = raw.ignore.map((s) => s.trim());
  }

  if (raw.mappings !== undefined) {
    if (!isObject(raw.mappings)) {
      throw new ConfigError(
        path,
        '"mappings" must be an object ("old mod": "new Modrinth project")',
      );
    }
    const mappings: Record<string, string> = {};
    for (const [from, to] of Object.entries(raw.mappings)) {
      if (!nonEmptyString(from) || !nonEmptyString(to)) {
        throw new ConfigError(
          path,
          `"mappings.${from}" must map to a non-empty Modrinth slug or id`,
        );
      }
      mappings[from.trim()] = to.trim();
    }
    config.mappings = mappings;
  }
  return config;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// Charge la configuration : chemin explicite (--config), sinon modshift.config.json dans le
// dossier courant s'il existe. Sans fichier, la configuration est vide.
export async function loadConfig(
  explicitPath: string | undefined,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  const path = explicitPath ? resolve(cwd, explicitPath) : join(cwd, CONFIG_FILE);
  if (!(await isFile(path))) {
    if (explicitPath) throw new ConfigError(path, 'file not found');
    return { config: {} };
  }
  if ((await stat(path)).size > MAX_CONFIG_BYTES) {
    throw new ConfigError(path, 'file is larger than 1 MiB');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(path, `invalid JSON (${(error as Error).message})`);
  }
  return { config: validateConfig(raw, path), path };
}

// Une entrée d'ignore/mapping correspond-elle à ce mod ? Nom de fichier (joker « * » possible,
// insensible à la casse), slug ou id de projet Modrinth (exacts).
export function matchesModRef(
  pattern: string,
  mod: { fileName: string; slug?: string; projectId?: string },
): boolean {
  if (pattern === mod.slug || pattern === mod.projectId) return true;
  if (!pattern.includes('*')) return pattern.toLowerCase() === mod.fileName.toLowerCase();
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );
  return regex.test(mod.fileName);
}
