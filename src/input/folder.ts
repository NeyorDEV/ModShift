import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Loader, ModEntry, ModPack } from '../types.js';
import { InputError } from './errors.js';
import { readJarFile } from './jar.js';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// Lit un dossier de .jar. Si le dossier contient un sous-dossier `mods/`
// (dossier d'instance), c'est celui-ci qui est analysé. Lecture non récursive.
export async function parseModsFolder(dir: string): Promise<ModPack> {
  if (!(await isDirectory(dir))) {
    throw new InputError(`${dir} is not a directory`);
  }
  const modsDir = (await isDirectory(join(dir, 'mods'))) ? join(dir, 'mods') : dir;
  const names = (await readdir(modsDir, { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.jar'))
    .map((d) => d.name)
    .sort();

  const mods: ModEntry[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const { entry, warnings: jarWarnings } = await readJarFile(
      join(modsDir, name),
      `mods/${name}`,
      'folder',
    );
    mods.push(entry);
    warnings.push(...jarWarnings);
  }
  if (mods.length === 0) {
    warnings.push(`${modsDir}: no .jar file found`);
  }

  const loader = inferLoader(mods);
  if (loader) {
    warnings.push(`Source loader inferred from jar metadata: ${loader}`);
  }
  return { source: 'folder', loader, mods, otherFiles: [], warnings };
}

// Déduit le loader source : celui déclaré par la majorité stricte des jars ayant des métadonnées.
export function inferLoader(mods: ModEntry[]): Loader | undefined {
  const counts = new Map<Loader, number>();
  let withMetadata = 0;
  for (const mod of mods) {
    const loaders = new Set(mod.metadata.map((m) => m.loader));
    if (loaders.size === 0) continue;
    withMetadata++;
    for (const loader of loaders) counts.set(loader, (counts.get(loader) ?? 0) + 1);
  }
  let best: Loader | undefined;
  let bestCount = 0;
  for (const [loader, count] of counts) {
    if (count > bestCount) {
      best = loader;
      bestCount = count;
    }
  }
  return best && bestCount * 2 > withMetadata ? best : undefined;
}
