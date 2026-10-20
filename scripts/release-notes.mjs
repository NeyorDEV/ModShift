#!/usr/bin/env node
// Extrait de CHANGELOG.md la section d'une version, pour les notes de la release GitHub.
// Usage : node scripts/release-notes.mjs v1.2.3 [CHANGELOG.md]
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Renvoie le contenu de la section « ## [x.y.z] » (sans son titre), ou undefined si absente.
 * @param {string} changelog
 * @param {string} version version avec ou sans « v » initial
 * @returns {string | undefined}
 */
export function extractReleaseNotes(changelog, version) {
  const wanted = version.replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const heading = /^## \[([^\]]+)\]/;
  const start = lines.findIndex((line) => heading.exec(line)?.[1] === wanted);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => heading.test(line) || /^\[[^\]]+\]:\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body.length > 0 ? body : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!version) {
    process.stderr.write('usage: node scripts/release-notes.mjs <version> [CHANGELOG.md]\n');
    process.exit(2);
  }
  const notes = extractReleaseNotes(readFileSync(file, 'utf8'), version);
  if (!notes) {
    process.stderr.write(
      `No "## [${version.replace(/^v/, '')}]" section with content in ${file}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
