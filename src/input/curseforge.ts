import type { Loader, ModEntry, ModPack } from '../types.js';
import { InputError } from './errors.js';
import { modEntryFromJar } from './jar.js';
import { parseCurseForgeLoaderId } from './loaderIds.js';
import { isModJarPath } from './mrpack.js';
import { asRecord, asString, parseLenientJson, readZip, zipText } from './zip.js';

const MANIFEST_FILE = 'manifest.json';

// Lit un export CurseForge (zip contenant manifest.json).
// Les fichiers référencés par projectID/fileID ne peuvent pas être identifiés sans
// l'API CurseForge (clé requise, hors périmètre) : ils sont conservés avec leur référence.
// Les .jar présents dans les overrides sont, eux, lus et hachés localement.
export function parseCurseForgeZip(data: Uint8Array, label = 'curseforge zip'): ModPack {
  // On lit d'abord le manifest pour connaître le nom du dossier d'overrides.
  const manifestEntries = readZip(data, label, (name) => name === MANIFEST_FILE);
  const manifestText = zipText(manifestEntries, MANIFEST_FILE);
  if (manifestText === undefined) {
    throw new InputError(`${label}: missing ${MANIFEST_FILE}`);
  }
  const manifest = asRecord(parseLenientJson(manifestText, MANIFEST_FILE));
  const minecraft = asRecord(manifest?.minecraft);
  if (!manifest || !minecraft || manifest.manifestType !== 'minecraftModpack') {
    throw new InputError(`${label}: ${MANIFEST_FILE} is not a CurseForge modpack manifest`);
  }

  const warnings: string[] = [];
  if (manifest.manifestVersion !== undefined && manifest.manifestVersion !== 1) {
    warnings.push(
      `${label}: unsupported manifestVersion ${String(manifest.manifestVersion)} (expected 1), reading it anyway`,
    );
  }
  const overridesDir = `${asString(manifest.overrides) ?? 'overrides'}/`;
  const otherFiles: string[] = [];
  const overrideJars = readZip(data, label, (name) => {
    if (!name.startsWith(overridesDir) || name.endsWith('/')) return false;
    if (isModJarPath(name.slice(overridesDir.length))) return true;
    otherFiles.push(name);
    return false;
  });

  const mods: ModEntry[] = [];
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const rawFile of files) {
    const file = asRecord(rawFile);
    const projectId = file?.projectID;
    const fileId = file?.fileID;
    if (typeof projectId !== 'number' || typeof fileId !== 'number') {
      warnings.push(`${label}: ignoring a manifest file entry without projectID/fileID`);
      continue;
    }
    const ref = `curseforge:${projectId}:${fileId}`;
    mods.push({
      fileName: ref,
      path: ref,
      origin: 'index',
      hashes: {},
      metadata: [],
      curseforge: { projectId, fileId, required: file?.required !== false },
    });
  }
  // Les références CurseForge sont résolues plus tard via l'API (clé CURSEFORGE_API_KEY), voir
  // src/curseforge/resolve.ts ; sans clé, la commande l'indique par un avertissement.

  for (const [name, content] of Object.entries(overrideJars)) {
    const { entry, warnings: jarWarnings } = modEntryFromJar(
      content,
      name.slice(overridesDir.length),
      'override',
    );
    mods.push(entry);
    warnings.push(...jarWarnings);
  }

  // Loader principal (« primary ») ou, à défaut, le premier déclaré.
  const modLoaders = (Array.isArray(minecraft.modLoaders) ? minecraft.modLoaders : [])
    .map(asRecord)
    .filter((l) => l !== undefined);
  const primary = modLoaders.find((l) => l.primary === true) ?? modLoaders[0];
  const parsedLoader = parseCurseForgeLoaderId(asString(primary?.id) ?? '');
  let loader: Loader | undefined;
  if (primary && !parsedLoader) {
    warnings.push(`${label}: unknown mod loader "${asString(primary.id) ?? ''}"`);
  } else {
    loader = parsedLoader?.loader;
  }

  return {
    source: 'curseforge',
    overridesDir: overridesDir.slice(0, -1),
    name: asString(manifest.name),
    version: asString(manifest.version),
    author: asString(manifest.author),
    minecraftVersion: asString(minecraft.version),
    loader,
    loaderVersion: parsedLoader?.version,
    mods,
    otherFiles: otherFiles.sort(),
    warnings,
  };
}
