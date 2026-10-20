#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { MODSHIFT_VERSION } from './version.js';

// Construit le programme CLI (exporté pour pouvoir le tester sans lancer de processus).
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('modshift')
    .description('Migrate a Minecraft modpack to another Minecraft version and/or mod loader.')
    .version(MODSHIFT_VERSION);
  return program;
}

// Point d'entrée uniquement quand le fichier est exécuté directement
// (realpath pour gérer le lien symbolique créé par `npm install -g`).
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  buildProgram().parse();
}
