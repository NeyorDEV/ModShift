#!/usr/bin/env node
// Copie les fichiers statiques de l'interface web (src/ui/public) dans dist/ui/public après `tsc`.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const from = 'src/ui/public';
const to = 'dist/ui/public';
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  // Les .d.ts ne servent qu'aux tests.
  if (/\.(html|css|js)$/.test(name)) copyFileSync(join(from, name), join(to, name));
}
