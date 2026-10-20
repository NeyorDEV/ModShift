#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { type CliIo, runAnalyze } from './commands/analyze.js';
import { runCacheClear, runCacheStats } from './commands/cache.js';
import { runMigrate } from './commands/migrate.js';
import { CONFIG_FILE } from './config/config.js';
import { describeError, formatError } from './errorMessages.js';
import { ModrinthClient } from './modrinth/client.js';
import { LOADERS } from './types.js';
import { MODSHIFT_VERSION } from './version.js';

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: Boolean(process.stdout.isTTY),
  stderrIsTTY: Boolean(process.stderr.isTTY),
  columns: process.stderr.columns,
  createApi: (options) => new ModrinthClient(options),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

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

  // Exécute une commande en affichant les erreurs attendues sans pile d'appels.
  const guarded =
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      try {
        await fn(...args);
      } catch (error) {
        const described = describeError(error);
        if (!described) throw error;
        io.stderr(formatError(described));
        io.setExitCode(1);
      }
    };

  withCommonOptions(
    program
      .command('analyze')
      .description('Check, mod by mod, whether a modpack can move to a target version/loader'),
  )
    .option('-f, --format <format>', 'report format: table, json or markdown', 'table')
    .option('-o, --output <file>', 'write the report to a file instead of stdout')
    .option('--no-color', 'disable colors in the table report')
    .action(guarded((pack: string, options) => runAnalyze(pack, options, io)));

  withCommonOptions(
    program
      .command('migrate')
      .description('Build a new .mrpack for the target, with a MIGRATION_REPORT.md next to it'),
  )
    .requiredOption('--out <file>', 'output .mrpack file')
    .option(
      '--loader-version <version>',
      'target loader version (required unless the source pack uses the same loader and Minecraft version)',
    )
    .option(
      '--include-alternatives',
      'include the best alternative for mods without a compatible version (suggestions, to verify)',
      false,
    )
    .option('--dry-run', 'show what would be done without writing any file', false)
    .option('--force', 'overwrite the output file if it exists', false)
    .action(guarded((pack: string, options) => runMigrate(pack, options, io)));

  const cache = program.command('cache').description('Inspect or clear the local API cache');
  cache
    .command('stats')
    .description('Show the number, size and age of cached API responses')
    .option('--cache-dir <dir>', 'cache directory (default: ~/.cache/modshift)')
    .option('--cache-ttl <duration>', 'lifetime used to count expired entries (default: 24h)')
    .option('--json', 'print the statistics as JSON', false)
    .action(guarded((options) => runCacheStats(options, io)));
  cache
    .command('clear')
    .description('Delete cached API responses (all of them, or only expired ones)')
    .option('--cache-dir <dir>', 'cache directory (default: ~/.cache/modshift)')
    .option('--expired', 'only delete expired or unreadable entries', false)
    .option('--cache-ttl <duration>', 'lifetime used with --expired (default: 24h)')
    .action(guarded((options) => runCacheClear(options, io)));

  return program;
}

// Options communes à analyze et migrate.
function withCommonOptions(command: Command): Command {
  return command
    .argument('<pack>', '.mrpack file, CurseForge export .zip, or folder of .jar files')
    .option('--mc <version>', 'target Minecraft version, e.g. 1.21.1 (or "target" in the config)')
    .option(
      '--loader <loader>',
      `target mod loader: ${LOADERS.join(', ')} (or "target" in the config)`,
    )
    .option('--config <file>', `configuration file (default: ./${CONFIG_FILE} if present)`)
    .option('--no-config', `ignore ${CONFIG_FILE}`)
    .option('--offline', 'use only cached API responses (no network)', false)
    .option('--no-cache', 'do not read or write the local API cache')
    .option('--cache-dir <dir>', 'cache directory (default: ~/.cache/modshift)')
    .option(
      '--cache-ttl <duration>',
      'how long cached responses stay valid, e.g. 30m, 12h, 7d, 0 (default: $MODSHIFT_CACHE_TTL or 24h)',
    )
    .option('--max-alternatives <n>', 'alternatives suggested per missing mod (0 to disable)', '3')
    .option('-q, --quiet', 'no progress messages on stderr', false)
    .option('-v, --verbose', 'log every API request, cache hit and retry on stderr', false);
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
