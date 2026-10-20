import { buildProgram } from '../../src/cli.js';
import type { CliIo } from '../../src/commands/analyze.js';
import { CurseForgeClient } from '../../src/curseforge/client.js';
import type { Prompter } from '../../src/interactive/prompter.js';
import { ModrinthClient } from '../../src/modrinth/client.js';
import { fakeCurseForgeHandler } from './fakeCurseForge.js';
import { type Catalog, fakeModrinthHandler, loadCatalog } from './fakeModrinth.js';
import { createFakeClock, createMockFetch, type MockHandler } from './mockFetch.js';

export interface TestIo extends CliIo {
  out: string;
  err: string;
  exitCode: number | undefined;
  requests: number;
}

export interface TestIoOptions {
  networkDown?: boolean;
  catalog?: Catalog;
  // Remplace entièrement le faux serveur (ex. pour simuler un rate limit).
  handler?: MockHandler;
  isTTY?: boolean;
  stderrIsTTY?: boolean;
  // Variables d'environnement vues par la CLI (jamais process.env en test).
  env?: NodeJS.ProcessEnv;
  // Dossier courant vu par la CLI (recherche de modshift.config.json).
  cwd?: string;
  // Mode interactif : réponses scriptées (simule aussi un terminal sur l'entrée standard).
  prompter?: Prompter;
}

// IO de test : sorties capturées, client Modrinth branché sur le faux serveur.
export function createIo(options: TestIoOptions = {}): TestIo {
  const fake = options.handler ?? fakeModrinthHandler(options.catalog ?? loadCatalog());
  const mock = createMockFetch((req) => {
    if (options.networkDown) throw new TypeError('fetch failed');
    return fake(req);
  });
  const clock = createFakeClock();
  const cfMock = createMockFetch(fakeCurseForgeHandler());
  const io: TestIo = {
    out: '',
    err: '',
    exitCode: undefined,
    get requests() {
      return mock.calls.length;
    },
    isTTY: options.isTTY ?? false,
    stderrIsTTY: options.stderrIsTTY ?? false,
    stdout: (text) => {
      io.out += text;
    },
    stderr: (text) => {
      io.err += text;
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    env: options.env ?? {},
    // Par défaut un dossier inexistant : aucun modshift.config.json local ne fuit dans les tests.
    cwd: options.cwd ?? '/nonexistent-modshift-test-cwd',
    stdinIsTTY: options.prompter !== undefined,
    createPrompter: options.prompter ? async () => options.prompter as Prompter : undefined,
    // Faux serveur CurseForge : n'est utilisé que si env.CURSEFORGE_API_KEY est défini.
    createCurseForgeApi: (cfOptions) =>
      new CurseForgeClient({
        ...cfOptions,
        fetch: cfMock.fetch,
        now: clock.now,
        sleep: clock.sleep,
        maxRetries: 1,
      }),
    createApi: (clientOptions) =>
      new ModrinthClient({
        ...clientOptions,
        fetch: mock.fetch,
        // Horloge virtuelle : les attentes (backoff, rate limit) sont instantanées.
        now: clock.now,
        sleep: clock.sleep,
        maxRetries: 1,
      }),
  };
  return io;
}

export async function run(io: CliIo, ...args: string[]): Promise<void> {
  await buildProgram(io).parseAsync(args, { from: 'user' });
}
