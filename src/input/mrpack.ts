import type { FileHashes, Loader, ModEntry, ModPack } from '../types.js';
import { InputError } from './errors.js';
import { modEntryFromJar } from './jar.js';
import { MRPACK_LOADER_KEYS } from './loaderIds.js';
import { asRecord, asString, parseLenientJson, readZip, zipText } from './zip.js';

const INDEX_FILE = 'modrinth.index.json';
const OVERRIDE_PREFIXES = ['overrides/', 'client-overrides/', 'server-overrides/'];

// Un chemin de l'index ne doit jamais sortir du dossier d'instance (exigence du format .mrpack).
export function isSafeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-zA-Z]:/.test(path)
  ) {
    return false;
  }
  return !path.split(/[\\/]/).includes('..');
}

export function isModJarPath(path: string): boolean {
  return /^mods\/[^/]+\.jar$/i.test(path);
}

function overrideRelativePath(name: string): string | undefined {
  const prefix = OVERRIDE_PREFIXES.find((p) => name.startsWith(p));
  return prefix ? name.slice(prefix.length) : undefined;
}

// Lit un pack Modrinth (.mrpack) : l'index et les .jar placés dans les overrides.
export function parseMrpack(data: Uint8Array, label = 'mrpack'): ModPack {
  const otherFiles: string[] = [];
  const entries = readZip(data, label, (name) => {
    if (name === INDEX_FILE) return true;
    const relative = overrideRelativePath(name);
    if (relative === undefined || name.endsWith('/')) return false;
    if (isModJarPath(relative)) return true;
    otherFiles.push(name);
    return false;
  });

  const indexText = zipText(entries, INDEX_FILE);
  if (indexText === undefined) {
    throw new InputError(`${label}: missing ${INDEX_FILE}`);
  }
  const index = asRecord(parseLenientJson(indexText, INDEX_FILE));
  if (!index || index.game !== 'minecraft' || !Array.isArray(index.files)) {
    throw new InputError(`${label}: ${INDEX_FILE} is not a Minecraft modpack index`);
  }

  const warnings: string[] = [];
  const mods: ModEntry[] = [];

  for (const rawFile of index.files) {
    const file = asRecord(rawFile);
    const path = asString(file?.path);
    if (!file || !path) {
      warnings.push(`${label}: ignoring an index entry without "path"`);
      continue;
    }
    if (!isSafeRelativePath(path)) {
      warnings.push(`${label}: ignoring unsafe path "${path}"`);
      continue;
    }
    if (!isModJarPath(path)) {
      otherFiles.push(path);
      continue;
    }
    const hashes = asRecord(file.hashes);
    const env = asRecord(file.env);
    mods.push({
      fileName: path.slice('mods/'.length),
      path,
      origin: 'index',
      hashes: {
        sha1: asString(hashes?.sha1),
        sha512: asString(hashes?.sha512),
      } satisfies FileHashes,
      metadata: [],
      downloads: Array.isArray(file.downloads)
        ? file.downloads.filter((d): d is string => typeof d === 'string')
        : undefined,
      fileSize: typeof file.fileSize === 'number' ? file.fileSize : undefined,
      env: env ? { client: asString(env.client), server: asString(env.server) } : undefined,
    });
  }

  // Les .jar embarqués dans les overrides sont lus et hachés localement.
  for (const [name, content] of Object.entries(entries)) {
    const relative = overrideRelativePath(name);
    if (relative === undefined) continue;
    const { entry, warnings: jarWarnings } = modEntryFromJar(content, relative, 'override');
    mods.push(entry);
    warnings.push(...jarWarnings);
  }

  const dependencies = asRecord(index.dependencies) ?? {};
  let loader: Loader | undefined;
  let loaderVersion: string | undefined;
  for (const [key, value] of Object.entries(dependencies)) {
    const mapped = MRPACK_LOADER_KEYS[key];
    if (mapped) {
      loader = mapped;
      loaderVersion = asString(value);
    }
  }

  return {
    source: 'mrpack',
    name: asString(index.name),
    version: asString(index.versionId),
    minecraftVersion: asString(dependencies.minecraft),
    loader,
    loaderVersion,
    mods,
    otherFiles: otherFiles.sort(),
    warnings,
  };
}
