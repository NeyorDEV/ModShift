import { describe, expect, it } from 'vitest';
import { modrinthSource } from '../../src/sources/modrinth.js';
import { SourceRegistry } from '../../src/sources/registry.js';
import {
  CANDIDATE_NOTE,
  type CandidateRequest,
  type ModSource,
  type SourceContext,
} from '../../src/sources/types.js';
import type { FetchLike } from '../../src/modrinth/client.js';
import type { MigrationTarget, ModPack } from '../../src/types.js';

// Suite de tests de contrat réutilisable : toute source (intégrée ou tierce) doit la passer.
// `make(fetch)` construit la source avec un fetch donné ; `candidates` décrit un cas où la
// source doit trouver au moins un fichier (avec ses options et son faux serveur).
export interface ContractScenario {
  make: (fetch: FetchLike) => ModSource;
  candidates?: {
    fetch: FetchLike;
    options: unknown;
    request: CandidateRequest;
    target: MigrationTarget;
  };
  // Options invalides que validateOptions doit refuser.
  invalidOptions?: unknown[];
}

export function contextFor(options: unknown = undefined, overrides: Partial<SourceContext> = {}) {
  const warnings: string[] = [];
  const context: SourceContext = {
    env: {},
    options,
    offline: false,
    warn: (message) => warnings.push(message),
    log: () => undefined,
    debug: () => undefined,
    ...overrides,
  };
  return { context, warnings };
}

const emptyPack = (): ModPack => ({
  source: 'mrpack',
  mods: [],
  otherFiles: [],
  warnings: [],
});

const networkDown: FetchLike = async () => {
  throw new TypeError('fetch failed');
};

export function describeSourceContract(label: string, scenario: ContractScenario): void {
  describe(`source contract: ${label}`, () => {
    const source = scenario.make(networkDown);

    it('has a stable id, a name and a description', () => {
      expect(source.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
      expect(source.name.trim()).not.toBe('');
      expect(source.description.trim()).not.toBe('');
    });

    it('can be registered once, next to the primary Modrinth source', () => {
      const registry = new SourceRegistry();
      if (!source.primary) registry.register(modrinthSource);
      registry.register(source);
      expect(registry.get(source.id)).toBe(source);
      expect(() => registry.register(source)).toThrow(/already registered/);
    });

    it('declares at least one extension point unless it is the primary source', () => {
      if (source.primary) {
        expect(source.prepare).toBeUndefined();
        expect(source.findCandidates).toBeUndefined();
      } else {
        expect(Boolean(source.prepare ?? source.findCandidates)).toBe(true);
      }
    });

    if (scenario.invalidOptions) {
      it('rejects invalid options with a readable message', () => {
        expect(source.validateOptions).toBeTypeOf('function');
        for (const options of scenario.invalidOptions ?? []) {
          expect(() => source.validateOptions?.(options)).toThrow(/\S/);
        }
      });
    }

    if (source.prepare) {
      it('prepare leaves a pack without references unchanged, even with the network down', async () => {
        const pack = emptyPack();
        const { context, warnings } = contextFor();
        await source.prepare?.(pack, context);
        expect(pack).toEqual(emptyPack());
        expect(warnings).toEqual([]);
      });
    }

    if (source.findCandidates) {
      const request: CandidateRequest = scenario.candidates?.request ?? {
        fileName: 'unknown.jar',
        modIds: [],
      };
      const target: MigrationTarget = scenario.candidates?.target ?? {
        minecraftVersion: '1.21.1',
        loader: 'fabric',
      };

      it('findCandidates returns nothing without options', async () => {
        const { context } = contextFor(undefined);
        expect(await source.findCandidates?.(request, target, context)).toEqual([]);
      });

      if (scenario.candidates) {
        const found = scenario.candidates;
        it('findCandidates returns well-formed suggestions, marked to verify', async () => {
          const { context } = contextFor(found.options);
          const candidates =
            (await scenario
              .make(found.fetch)
              .findCandidates?.(found.request, found.target, context)) ?? [];
          expect(candidates.length).toBeGreaterThan(0);
          for (const c of candidates) {
            expect(c.source).toBe(source.id);
            expect(c.url).toMatch(/^https:\/\//);
            expect(c.fileName.trim()).not.toBe('');
            expect(c.reason.trim()).not.toBe('');
            expect(c.note).toBe(CANDIDATE_NOTE);
          }
        });

        it('findCandidates sends nothing offline', async () => {
          let calls = 0;
          const counting: FetchLike = async (...args) => {
            calls++;
            return found.fetch(...args);
          };
          const { context } = contextFor(found.options, { offline: true });
          expect(
            await scenario.make(counting).findCandidates?.(found.request, found.target, context),
          ).toEqual([]);
          expect(calls).toBe(0);
        });

        it('findCandidates turns a network failure into a warning, not an error', async () => {
          const { context, warnings } = contextFor(found.options);
          expect(await source.findCandidates?.(found.request, found.target, context)).toEqual([]);
          expect(warnings.length).toBeGreaterThan(0);
        });
      }
    }
  });
}
