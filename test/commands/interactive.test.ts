import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMrpack } from '../../src/input/mrpack.js';
import { runInteractive } from '../../src/commands/interactive.js';
import { PromptCancelledError } from '../../src/interactive/prompter.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';
import { createScriptedPrompter, type ScriptedStep } from '../helpers/scriptedPrompter.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-interactive-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const target: ScriptedStep[] = [
  { match: /^Target Minecraft version/, answer: '1.21.1' },
  { match: /^Target loader/, answer: 'Fabric' },
];

describe('modshift interactive', () => {
  it('reviews mods, saves the choices and builds the pack', async () => {
    const prompter = createScriptedPrompter([
      ...target,
      { match: /^Which mods/, answer: 0 },
      { match: /^Old Minimap/, answer: "Use Xaero's Minimap" },
      { match: /^mystery-mod\.jar/, answer: 'Ignore' },
      { match: /^local-mod\.jar/, answer: 'Exclude' },
      { match: /^Save these choices/, answer: true },
      { match: /^Build the migrated/, answer: true },
      { match: /^Output file/, answer: undefined },
      { match: /^Fabric version for Minecraft 1\.21\.1/, answer: '0.16.5' },
    ]);
    const io = createIo({ cwd: dir, prompter });
    await run(io, 'interactive', packPath, '--no-cache');
    expect(io.exitCode).toBeUndefined();
    expect(io.err).not.toContain('error');

    // Le rapport est affiché avant les questions.
    expect(io.out).toContain(
      'Summary: 1 compatible, 2 update found, 1 alternative suggested, 2 not found',
    );
    expect(io.out).toContain(
      'Decisions: 0 accepted, 1 alternative(s) chosen, 1 excluded, 1 ignored.',
    );

    const config = JSON.parse(await readFile(join(dir, 'modshift.config.json'), 'utf8')) as unknown;
    expect(config).toEqual({
      $schema: './schemas/modshift.config.schema.json',
      target: { minecraftVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5' },
      ignore: ['mystery-mod.jar'],
      exclude: ['local-mod.jar'],
      mappings: { 'old-minimap': 'xaeros-minimap' },
    });

    const out = join(dir, 'pack-1.21.1-fabric.mrpack');
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'out.mrpack');
    expect(migrated.mods.map((m) => m.path)).toContain('mods/v1xaero.jar');
    expect(migrated.loaderVersion).toBe('0.16.5');
  });

  it('saved choices replay with the non-interactive commands', async () => {
    const prompter = createScriptedPrompter([
      ...target,
      { match: /^Which mods/, answer: 0 },
      { match: /^Old Minimap/, answer: 'Use JourneyMap' },
      { match: /^mystery-mod\.jar/, answer: undefined },
      { match: /^local-mod\.jar/, answer: undefined },
      { match: /^Save these choices/, answer: true },
      { match: /^Build the migrated/, answer: false },
    ]);
    await run(createIo({ cwd: dir, prompter }), 'interactive', packPath, '--no-cache');

    const io = createIo({ cwd: dir });
    await run(io, 'analyze', packPath, '-f', 'json', '-q', '--no-cache');
    const report = JSON.parse(io.out) as {
      mods: { fileName: string; project?: { title: string } }[];
    };
    expect(report.mods.find((m) => m.fileName === 'old-minimap-1.0.jar')?.project?.title).toBe(
      'JourneyMap',
    );
  });

  it('proposes previous decisions as defaults', async () => {
    await writeFile(
      join(dir, 'modshift.config.json'),
      JSON.stringify({ ignore: ['mystery-mod.jar'], exclude: ['old-minimap'] }),
    );
    const prompter = createScriptedPrompter([
      ...target,
      { match: /^Which mods/, answer: 0 },
      { match: /^Old Minimap/, answer: undefined },
      { match: /^mystery-mod\.jar/, answer: undefined },
      { match: /^local-mod\.jar/, answer: undefined },
      { match: /^Save these choices/, answer: false },
    ]);
    const io = createIo({ cwd: dir, prompter });
    await run(io, 'interactive', packPath, '--no-cache');
    const defaultLabel = (re: RegExp) => {
      const s = prompter.selects.find((x) => re.test(x.message));
      return s?.choices[s.defaultIndex ?? 0];
    };
    expect(defaultLabel(/^Old Minimap/)).toBe('Exclude it from the migrated pack');
    expect(defaultLabel(/^mystery-mod\.jar/)).toBe('Ignore it');
    expect(defaultLabel(/^Target loader/)).toBe('Fabric');
    expect(io.out).toContain('Nothing was saved.');
  });

  it('asks for the pack when none is given and stops before migrating plugin platforms', async () => {
    const prompter = createScriptedPrompter([
      { match: /^Modpack to migrate/, answer: 'pack.mrpack' },
      { match: /^Target Minecraft version/, answer: '1.21.1' },
      { match: /^Target loader/, answer: 'Paper' },
      { match: /^Which mods/, answer: 'None' },
      { match: /^Save these choices/, answer: true },
    ]);
    // `modshift -i` utilise le cache par défaut : on le redirige dans le dossier temporaire.
    const io = createIo({ cwd: dir, prompter, env: { MODSHIFT_CACHE_DIR: join(dir, 'cache') } });
    await run(io, '-i');
    expect(io.exitCode).toBeUndefined();
    expect(prompter.asked.some((m) => m.startsWith('Build the migrated'))).toBe(false);
    expect(await exists(join(dir, 'modshift.config.json'))).toBe(true);
  });

  it('exits with code 130 when the user cancels, saving nothing', async () => {
    const prompter = createScriptedPrompter([
      ...target,
      { match: /^Which mods/, answer: new PromptCancelledError() },
    ]);
    const io = createIo({ cwd: dir, prompter });
    await run(io, 'interactive', packPath, '--no-cache');
    expect(io.exitCode).toBe(130);
    expect(io.err.endsWith('Interactive session cancelled: nothing was saved.\n')).toBe(true);
    expect(await exists(join(dir, 'modshift.config.json'))).toBe(false);
  });

  it('requires a terminal and a config file', async () => {
    const noTty = createIo({ cwd: dir });
    await run(noTty, 'interactive', packPath);
    expect(noTty.err).toMatch(/the interactive mode needs a terminal/);

    await expect(
      runInteractive(
        packPath,
        { config: false, offline: false, cache: false, maxAlternatives: '3' },
        createIo({ cwd: dir }),
        createScriptedPrompter([]),
      ),
    ).rejects.toThrow(/remove --no-config/);
  });
});
