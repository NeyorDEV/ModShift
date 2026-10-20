#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { type CliIo, runAnalyze, UsageError } from './commands/analyze.js';
import { InputError } from './input/errors.js';
import { ModrinthClient } from './modrinth/client.js';
import {
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
} from './modrinth/errors.js';
import { LOADERS } from './types.js';
import { MODSHIFT_VERSION } from './version.js';

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: Boolean(process.stdout.isTTY),
  createApi: (options) => new ModrinthClient(options),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

// Erreurs « attendues » : affichées sans pile d'appels.
function isKnownError(error: unknown): error is Error {
  return (
    error instanceof UsageError ||
    error instanceof InputError ||
    error instanceof OfflineCacheMissError ||
    error instanceof ModrinthNetworkError ||
    error instanceof ModrinthApiError
  );
}

// Construit le programme CLI (exporté pour pouvoir le tester sans lancer de processus).
export function buildProgram(io: CliIo = defaultIo): Command {
  const program = new Command();
  program
    .name('modshift')
    .description('Migrate a Minecraft modpack to another Minecraft version and/or mod loader.')
    .version(MODSHIFT_VERSION)
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    });

  program
    .command('analyze')
    .description('Check, mod by mod, whether a modpack can move to a target version/loader')
    .argument('<pack>', '.mrpack file, CurseForge export .zip, or folder of .jar files')
    .requiredOption('--mc <version>', 'target Minecraft version (e.g. 1.21.1)')
    .requiredOption('--loader <loader>', `target mod loader (${LOADERS.join(', ')})`)
    .option('-f, --format <format>', 'report format: table, json or markdown', 'table')
    .option('-o, --output <file>', 'write the report to a file instead of stdout')
    .option('--offline', 'use only cached API responses (no network)', false)
    .option('--no-cache', 'do not read or write the local API cache')
    .option('--cache-dir <dir>', 'cache directory (default: ~/.cache/modshift)')
    .option('--max-alternatives <n>', 'alternatives suggested per missing mod (0 to disable)', '3')
    .option('-q, --quiet', 'no progress messages on stderr', false)
    .option('--no-color', 'disable colors in the table report')
    .action(async (pack: string, options) => {
      try {
        await runAnalyze(pack, options, io);
      } catch (error) {
        if (!isKnownError(error)) throw error;
        io.stderr(`error: ${error.message}\n`);
        io.setExitCode(1);
      }
    });

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
  buildProgram()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(
        `unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
