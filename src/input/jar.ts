import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { JarDependency, JarMetadata, ModEntry, ModOrigin } from '../types.js';
import { computeHashes } from './hash.js';
import {
  BUKKIT_PLUGIN_FILE,
  BUNGEE_PLUGIN_FILE,
  PAPER_PLUGIN_FILE,
  parseBukkitPluginYml,
  parseBungeeYml,
  parsePaperPluginYml,
  parseVelocityPluginJson,
  PLUGIN_METADATA_FILES,
  VELOCITY_PLUGIN_FILE,
} from './plugin.js';
import {
  asRecord,
  asString,
  METADATA_ZIP_LIMITS,
  parseLenientJson,
  readZip,
  zipText,
} from './zip.js';

const FABRIC_FILE = 'fabric.mod.json';
const QUILT_FILE = 'quilt.mod.json';
const FORGE_FILE = 'META-INF/mods.toml';
const NEOFORGE_FILE = 'META-INF/neoforge.mods.toml';
const MANIFEST_FILE = 'META-INF/MANIFEST.MF';
const METADATA_FILES = new Set([
  FABRIC_FILE,
  QUILT_FILE,
  FORGE_FILE,
  NEOFORGE_FILE,
  MANIFEST_FILE,
  ...PLUGIN_METADATA_FILES,
]);

// Identifiants de « plateforme » qui ne sont pas de vrais mods à résoudre.
const PLATFORM_IDS = new Set([
  'minecraft',
  'java',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'forge',
  'neoforge',
]);

export interface JarReadResult {
  metadata: JarMetadata[];
  warnings: string[];
}

// Lit les métadonnées d'un .jar : mods (fabric.mod.json, quilt.mod.json, mods.toml,
// neoforge.mods.toml) et plugins (plugin.yml, paper-plugin.yml, bungee.yml, velocity-plugin.json).
// Un jar sans métadonnées reconnues renvoie une liste vide (pas d'erreur).
export function readJarMetadata(data: Uint8Array, label: string): JarReadResult {
  const entries = readZip(data, label, (name) => METADATA_FILES.has(name), METADATA_ZIP_LIMITS);
  const warnings: string[] = [];
  const metadata: JarMetadata[] = [];
  const manifestVersion = parseManifestVersion(zipText(entries, MANIFEST_FILE));

  // Chaque format est lu indépendamment : un fichier invalide ne bloque pas les autres.
  const attempt = (file: string, reader: (text: string) => JarMetadata[]): void => {
    const text = zipText(entries, file);
    if (text === undefined) return;
    try {
      metadata.push(...reader(text));
    } catch (error) {
      warnings.push(`${label}: cannot parse ${file} (${(error as Error).message})`);
    }
  };

  attempt(FABRIC_FILE, (text) => parseFabricModJson(text, label));
  attempt(QUILT_FILE, (text) => parseQuiltModJson(text, label));
  attempt(NEOFORGE_FILE, (text) => parseModsToml(text, 'neoforge', manifestVersion));
  attempt(FORGE_FILE, (text) => parseModsToml(text, 'forge', manifestVersion));
  // Plugins de serveur / proxy.
  attempt(PAPER_PLUGIN_FILE, parsePaperPluginYml);
  attempt(BUKKIT_PLUGIN_FILE, parseBukkitPluginYml);
  attempt(BUNGEE_PLUGIN_FILE, parseBungeeYml);
  attempt(VELOCITY_PLUGIN_FILE, (text) => parseVelocityPluginJson(text, label));

  return { metadata, warnings };
}

export function parseFabricModJson(text: string, label = FABRIC_FILE): JarMetadata[] {
  const json = asRecord(parseLenientJson(text, label));
  const modId = asString(json?.id);
  if (!json || !modId) throw new Error('missing "id"');
  const dependencies: JarDependency[] = [
    ...fabricDependencies(json.depends, true),
    ...fabricDependencies(json.recommends, false),
  ];
  return [
    {
      loader: 'fabric',
      modId,
      name: asString(json.name),
      version: asString(json.version),
      dependencies,
    },
  ];
}

function fabricDependencies(value: unknown, required: boolean): JarDependency[] {
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record)
    .filter(([modId]) => !PLATFORM_IDS.has(modId))
    .map(([modId, range]) => ({
      modId,
      required,
      versionRange: Array.isArray(range) ? range.join(' || ') : asString(range),
    }));
}

export function parseQuiltModJson(text: string, label = QUILT_FILE): JarMetadata[] {
  const loader = asRecord(asRecord(parseLenientJson(text, label))?.quilt_loader);
  const modId = asString(loader?.id);
  if (!loader || !modId) throw new Error('missing "quilt_loader.id"');
  const dependencies: JarDependency[] = [];
  if (Array.isArray(loader.depends)) {
    for (const dep of loader.depends) {
      const depRecord = asRecord(dep);
      const depId = typeof dep === 'string' ? dep : asString(depRecord?.id);
      if (!depId || PLATFORM_IDS.has(depId)) continue;
      const versions = depRecord?.versions;
      dependencies.push({
        modId: depId,
        required: depRecord?.optional !== true,
        versionRange: Array.isArray(versions) ? versions.join(' || ') : asString(versions),
      });
    }
  }
  return [
    {
      loader: 'quilt',
      modId,
      name: asString(asRecord(loader.metadata)?.name),
      version: asString(loader.version),
      dependencies,
    },
  ];
}

// Parse un mods.toml (Forge, ou NeoForge ≤ 1.20.4) ou un neoforge.mods.toml.
export function parseModsToml(
  text: string,
  fileLoader: 'forge' | 'neoforge',
  manifestVersion?: string,
): JarMetadata[] {
  const toml = parseToml(text) as Record<string, unknown>;
  const mods = Array.isArray(toml.mods) ? toml.mods : [];
  const allDependencies = asRecord(toml.dependencies) ?? {};
  const result: JarMetadata[] = [];

  for (const rawMod of mods) {
    const mod = asRecord(rawMod);
    const modId = asString(mod?.modId);
    if (!mod || !modId) continue;
    const rawDeps = allDependencies[modId];
    const deps = (Array.isArray(rawDeps) ? rawDeps : []).map(asRecord);

    // Les premiers NeoForge (1.20.x) utilisaient mods.toml : on les reconnaît
    // à leur dépendance sur « neoforge ».
    const dependsOnNeoForge = deps.some((d) => d?.modId === 'neoforge');
    const loader = fileLoader === 'neoforge' || dependsOnNeoForge ? 'neoforge' : 'forge';

    let version = asString(mod.version);
    if (version?.includes('${file.jarVersion}')) {
      version = manifestVersion;
    }

    const dependencies: JarDependency[] = [];
    for (const dep of deps) {
      const depId = asString(dep?.modId);
      if (!depId || PLATFORM_IDS.has(depId)) continue;
      // Forge : `mandatory = true|false` ; NeoForge : `type = "required"|"optional"|…`
      // (« required » par défaut). « incompatible »/« discouraged » ne sont pas à installer.
      const type = asString(dep?.type)?.toLowerCase();
      if (type === 'incompatible' || type === 'discouraged') continue;
      const required =
        typeof dep?.mandatory === 'boolean'
          ? dep.mandatory
          : type === undefined || type === 'required';
      dependencies.push({ modId: depId, required, versionRange: asString(dep?.versionRange) });
    }

    result.push({ loader, modId, name: asString(mod.displayName), version, dependencies });
  }
  return result;
}

function parseManifestVersion(text: string | undefined): string | undefined {
  const match = text?.match(/^Implementation-Version:\s*(.+?)\s*$/m);
  return match?.[1];
}

// Construit une entrée de mod à partir du contenu brut d'un .jar.
export function modEntryFromJar(
  data: Uint8Array,
  path: string,
  origin: ModOrigin,
): { entry: ModEntry; warnings: string[] } {
  const fileName = basename(path);
  let metadata: JarMetadata[] = [];
  let warnings: string[] = [];
  try {
    ({ metadata, warnings } = readJarMetadata(data, fileName));
  } catch (error) {
    warnings = [`${fileName}: ${(error as Error).message}`];
  }
  return {
    entry: {
      fileName,
      path,
      origin,
      hashes: computeHashes(data),
      metadata,
      fileSize: data.byteLength,
    },
    warnings,
  };
}

export async function readJarFile(
  filePath: string,
  packPath: string,
  origin: ModOrigin,
): Promise<{ entry: ModEntry; warnings: string[] }> {
  const data = await readFile(filePath);
  return modEntryFromJar(new Uint8Array(data), packPath, origin);
}
