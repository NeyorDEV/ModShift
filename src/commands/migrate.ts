import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { analyzePack } from '../core/engine.js';
import type { AnalysisResult } from '../core/types.js';
import { loadPack } from '../input/index.js';
import { buildMigrationPlan, type MigrationPlan, resolveLoaderVersion } from '../migrate/plan.js';
import { MIGRATION_REPORT_FILE, renderMigrationReport, renderPlanText } from '../migrate/report.js';
import { buildMrpackArchive, collectOverrides } from '../migrate/writer.js';
import type { Loader } from '../types.js';
import {
  type CliIo,
  createSession,
  parseMaxAlternatives,
  parseTarget,
  UsageError,
} from './analyze.js';

export interface MigrateCommandOptions {
  mc: string;
  loader: string;
  out: string;
  loaderVersion?: string;
  includeAlternatives: boolean;
  dryRun: boolean;
  force: boolean;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
  maxAlternatives: string;
  quiet: boolean;
  verbose?: boolean;
}

export interface MigrateResult {
  analysis: AnalysisResult;
  plan: MigrationPlan;
  packPath: string;
  reportPath: string;
  written: boolean;
}

// Où trouver la version d'un loader (message d'erreur actionnable).
const LOADER_VERSION_HELP: Record<Loader, string> = {
  fabric: 'https://fabricmc.net/develop/',
  quilt: 'https://quiltmc.org/',
  forge: 'https://files.minecraftforge.net/',
  neoforge: 'https://neoforged.net/',
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function runMigrate(
  packPath: string,
  options: MigrateCommandOptions,
  io: CliIo,
): Promise<MigrateResult> {
  const target = parseTarget(options.mc, options.loader);
  const maxAlternatives = parseMaxAlternatives(options.maxAlternatives);
  if (options.includeAlternatives && maxAlternatives === 0) {
    throw new UsageError('--include-alternatives needs --max-alternatives greater than 0');
  }
  const outPath = resolve(options.out);
  if (!outPath.toLowerCase().endsWith('.mrpack')) {
    throw new UsageError(`--out must be a .mrpack file (got "${options.out}")`);
  }
  if (outPath === resolve(packPath)) {
    throw new UsageError('--out must be different from the input pack');
  }
  if (!options.dryRun && !options.force && (await exists(outPath))) {
    throw new UsageError(`${options.out} already exists: use --force to overwrite it`);
  }
  const reportPath = join(dirname(outPath), MIGRATION_REPORT_FILE);

  const session = createSession(options, io);
  const pack = await loadPack(packPath);
  session.logger.info(`Loaded ${pack.mods.length} mod(s) from ${packPath} (${pack.source}).`);

  // Vérifié avant toute requête : sans version de loader, le pack généré serait inutilisable.
  const loaderVersion = resolveLoaderVersion(pack, target, options.loaderVersion);
  if (!loaderVersion.version && !options.dryRun) {
    throw new UsageError(
      `Cannot determine the ${target.loader} version for Minecraft ${target.minecraftVersion}: ` +
        `pass --loader-version <version> (see ${LOADER_VERSION_HELP[target.loader]}).`,
    );
  }

  const analysis = await analyzePack(pack, target, session.api, {
    maxAlternatives,
    adoptAlternatives: options.includeAlternatives,
    ...session.progress,
  });
  session.logger.endProgress();
  const plan = buildMigrationPlan(pack, analysis, { loaderVersion: options.loaderVersion });

  const isArchive = pack.source !== 'folder';
  const overrides = collectOverrides(
    isArchive ? new Uint8Array(await readFile(packPath)) : undefined,
    pack,
  );
  for (const skipped of overrides.skipped) {
    if (skipped.reason === 'unsafe path') {
      plan.warnings.push(`Override ${skipped.path} not copied: unsafe path`);
    }
  }
  // Le pack est construit (et validé) même en dry-run, pour signaler tout problème de format.
  const archive = buildMrpackArchive(plan.index, overrides.files);
  const report = renderMigrationReport(plan, analysis, basename(outPath));
  const overrideCount = Object.keys(overrides.files).length;

  if (options.dryRun) {
    const lines = ['Dry run: nothing was written.', `Would write ${options.out} and ${reportPath}`];
    if (!plan.loaderVersion) {
      lines.push(
        `Warning: the ${target.loader} version is unknown; a real run needs --loader-version.`,
      );
    }
    io.stdout(renderPlanText(plan, analysis, lines.join('\n'), overrideCount));
    return { analysis, plan, packPath: outPath, reportPath, written: false };
  }

  await writeFile(outPath, archive);
  await writeFile(reportPath, report);
  io.stdout(
    renderPlanText(
      plan,
      analysis,
      `Migrated pack written to ${options.out}\nReport written to ${reportPath}`,
      overrideCount,
    ),
  );
  return { analysis, plan, packPath: outPath, reportPath, written: true };
}
