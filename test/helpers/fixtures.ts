import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES_DIR, ...parts);
}

export function readJsonFixture<T = unknown>(...parts: string[]): T {
  return JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as T;
}

// Construit une archive zip en mémoire à partir d'un dossier de fixtures.
// Tout sous-dossier dont le nom se termine par « .jar » est lui-même zippé
// (permet de décrire des .jar imbriqués dans un pack sous forme de fichiers lisibles).
export function zipFixtureDir(dir: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = relative(dir, full).split('\\').join('/');
      if (statSync(full).isDirectory()) {
        if (name.endsWith('.jar')) files[rel] = zipFixtureDir(full);
        else walk(full);
      } else {
        files[rel] = new Uint8Array(readFileSync(full));
      }
    }
  };
  walk(dir);
  return zipSync(files, { mtime: new Date('2024-01-01T00:00:00Z') });
}

export function jarFixture(name: string): Uint8Array {
  return zipFixtureDir(fixturePath('jars', name));
}

export function packFixture(name: string): Uint8Array {
  return zipFixtureDir(fixturePath('packs', name));
}
