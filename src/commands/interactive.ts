import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { CONFIG_FILE, loadConfig, type ModShiftConfig, writeConfig } from '../config/config.js';
import { analyzePack } from '../core/engine.js';
import type { ModAnalysis } from '../core/types.js';
import { loadPack } from '../input/index.js';
import {
  applyDecision,
  type Decision,
  defaultOption,
  needsReview,
  optionsFor,
  summarizeDecisions,
} from '../interactive/decisions.js';
import type { Prompter } from '../interactive/prompter.js';
import { LOADER_DEFINITIONS, supportsMrpack } from '../loaders/registry.js';
import { resolveLoaderVersion } from '../migrate/plan.js';
import { renderTable } from '../report/index.js';
import { STATUS_LABELS } from '../report/labels.js';
import {
  type CliIo,
  createSession,
  parseMaxAlternatives,
  parseTarget,
  UsageError,
} from './analyze.js';
import { runMigrate } from './migrate.js';

export interface InteractiveCommandOptions {
  config?: string | false;
  offline: boolean;
  cache: boolean;
  cacheDir?: string;
  cacheTtl?: string;
  maxAlternatives: string;
  verbose?: boolean;
}

export interface InteractiveResult {
  config: ModShiftConfig;
  configPath: string;
  saved: boolean;
  decisions: Decision[];
  migratedTo?: string;
}

const KIND_LABELS = {
  'mod-loader': 'mod loader',
  'server-plugin': 'server plugins',
  'proxy-plugin': 'proxy plugins',
} as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function modTitle(mod: ModAnalysis): string {
  const name = mod.project?.title ?? mod.fileName;
  const reason = mod.reason ? `\n  ${mod.reason}` : '';
  return `${name} (${mod.fileName}): ${STATUS_LABELS[mod.status]}${reason}`;
}

// Assistant : choix du pack et de la cible, rapport, décisions mod par mod, sauvegarde dans
// modshift.config.json, puis migration facultative. Toutes les questions passent par `prompter`.
export async function runInteractive(
  packArg: string | undefined,
  options: InteractiveCommandOptions,
  io: CliIo,
  prompter: Prompter,
): Promise<InteractiveResult> {
  if (options.config === false) {
    throw new UsageError(
      'the interactive mode saves its choices in a configuration file: remove --no-config',
    );
  }
  const maxAlternatives = parseMaxAlternatives(options.maxAlternatives);
  const cwd = io.cwd ?? process.cwd();
  const configPath = resolve(cwd, options.config ?? CONFIG_FILE);
  const session = createSession({ ...options, quiet: false }, io);
  const say = (text: string) => io.stdout(`${text}\n`);

  // Une configuration absente n'est pas une erreur : elle sera créée.
  const existing = (await exists(configPath)) ? (await loadConfig(configPath, cwd)).config : {};
  if (await exists(configPath)) say(`Using configuration ${configPath}`);

  // 1. Pack et cible.
  const packPath =
    packArg ??
    (await prompter.input('Modpack to migrate (.mrpack, CurseForge .zip or folder of jars):', {
      validate: (value) => (value.trim() ? true : 'Please enter a path.'),
    }));
  const pack = await loadPack(resolve(cwd, packPath.trim()));
  session.logger.info(`Loaded ${pack.mods.length} mod(s) from ${packPath} (${pack.source}).`);
  await session.prepare(pack);

  const mc = await prompter.input('Target Minecraft version:', {
    default: existing.target?.minecraftVersion ?? pack.minecraftVersion,
    validate: (value) => {
      try {
        parseTarget(value, 'fabric');
        return true;
      } catch (error) {
        return (error as Error).message;
      }
    },
  });
  const loaderChoices = LOADER_DEFINITIONS.map((d) => ({
    label: d.name,
    description: `${KIND_LABELS[d.kind]}${'mrpackKey' in d ? '' : ' (analysis only, no .mrpack)'}`,
  }));
  const defaultLoader = existing.target?.loader ?? pack.loader;
  const loaderIndex = await prompter.select(
    'Target loader:',
    loaderChoices,
    Math.max(
      0,
      LOADER_DEFINITIONS.findIndex((d) => d.id === defaultLoader),
    ),
  );
  const loader = LOADER_DEFINITIONS[loaderIndex]?.id ?? 'fabric';
  const target = parseTarget(mc, loader);

  // 2. Analyse (les correspondances déjà enregistrées sont appliquées ; les mods ignorés restent
  //    visibles pour pouvoir changer d'avis).
  const analysis = await analyzePack(pack, target, session.api, {
    maxAlternatives,
    mappings: existing.mappings,
    ...session.progress,
  });
  session.logger.endProgress();
  io.stdout(renderTable(analysis, { color: io.isTTY && !(io.env ?? process.env).NO_COLOR }));

  // 3. Décisions mod par mod.
  const toReview = analysis.mods.filter(needsReview);
  const scope = await prompter.select(
    'Which mods do you want to review?',
    [
      { label: `Only those that need attention (${toReview.length})` },
      { label: `All mods (${analysis.mods.length})` },
      { label: 'None: keep the analysis as it is' },
    ],
    0,
  );
  const reviewed = scope === 0 ? toReview : scope === 1 ? analysis.mods : [];

  let config: ModShiftConfig = {
    ...existing,
    target: {
      ...existing.target,
      minecraftVersion: target.minecraftVersion,
      loader: target.loader,
    },
  };
  const decisions: Decision[] = [];
  for (const mod of reviewed) {
    const choices = optionsFor(mod);
    const fallback = defaultOption(existing, mod);
    const defaultIndex = Math.max(
      0,
      choices.findIndex(
        (c) =>
          c.value.action === fallback.action &&
          (c.value.action !== 'alternative' ||
            (fallback.action === 'alternative' && c.value.project.id === fallback.project.id)),
      ),
    );
    const index = await prompter.select(modTitle(mod), choices, defaultIndex);
    const decision = choices[index]?.value ?? fallback;
    decisions.push(decision);
    config = applyDecision(config, mod, decision);
  }
  // Les mods non revus gardent leurs décisions précédentes : `config` part de `existing`.

  const summary = summarizeDecisions(decisions);
  say(
    `\nDecisions: ${summary.accepted} accepted, ${summary.alternatives} alternative(s) chosen, ${summary.excluded} excluded, ${summary.ignored} ignored.`,
  );

  // 4. Sauvegarde.
  const saved = await prompter.confirm(`Save these choices to ${configPath}?`, true);
  if (!saved) {
    say('Nothing was saved.');
    return { config, configPath, saved, decisions };
  }
  await writeConfig(configPath, config);
  say(
    `Saved ${configPath}. Replay later with: modshift analyze ${packPath} --config ${configPath}`,
  );

  // 5. Migration facultative (seulement pour les loaders que le format .mrpack accepte).
  if (!supportsMrpack(target.loader)) return { config, configPath, saved, decisions };
  if (!(await prompter.confirm('Build the migrated .mrpack now?', true))) {
    return { config, configPath, saved, decisions };
  }
  const base = basename(packPath, extname(packPath)) || 'modpack';
  const out = await prompter.input('Output file:', {
    default: join(
      dirname(resolve(cwd, packPath)),
      `${base}-${target.minecraftVersion}-${target.loader}.mrpack`,
    ),
    validate: (value) =>
      value.toLowerCase().endsWith('.mrpack') ? true : 'The file must end with .mrpack.',
  });
  const known = resolveLoaderVersion(pack, target, existing.target?.loaderVersion);
  const loaderVersion = await prompter.input(
    `${LOADER_DEFINITIONS[loaderIndex]?.name ?? loader} version for Minecraft ${target.minecraftVersion}:`,
    {
      default: known.version,
      validate: (value) =>
        value.trim() ? true : 'A loader version is required by the .mrpack format.',
    },
  );
  // La version du loader est enregistrée pour rejouer la migration sans la redemander.
  config = { ...config, target: { ...config.target, loaderVersion: loaderVersion.trim() } };
  await writeConfig(configPath, config);
  const force =
    (await exists(resolve(cwd, out))) &&
    (await prompter.confirm(`${out} exists. Overwrite it?`, false));
  if ((await exists(resolve(cwd, out))) && !force) {
    say('Migration skipped: the output file already exists.');
    return { config, configPath, saved, decisions };
  }
  await runMigrate(
    resolve(cwd, packPath),
    {
      mc: target.minecraftVersion,
      loader: target.loader,
      out: resolve(cwd, out),
      loaderVersion: loaderVersion.trim(),
      config: configPath,
      includeAlternatives: false,
      dryRun: false,
      force,
      offline: options.offline,
      cache: options.cache,
      cacheDir: options.cacheDir,
      cacheTtl: options.cacheTtl,
      maxAlternatives: options.maxAlternatives,
      quiet: true,
    },
    io,
  );
  return { config, configPath, saved, decisions, migratedTo: resolve(cwd, out) };
}
