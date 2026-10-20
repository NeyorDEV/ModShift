# Contributing to ModShift

Thanks for helping! This guide covers the development setup and the conventions the project
follows.

## Setup

```bash
git clone https://github.com/NeyorDEV/ModShift.git
cd ModShift
npm ci           # Node.js 20+
npm run build
node dist/cli.js --help
```

> If `npm install <package>` fails on npm 10 with `Cannot read properties of null (reading
'edgesOut')`, run `npx -y npm@11 install …` instead. `npm ci` works with any npm version.

## Checks

Run these before opening a pull request (CI runs the same on Node 20 and 22):

```bash
npm run lint           # ESLint (typescript-eslint strict)
npm run format:check   # Prettier (npm run format to fix)
npm run typecheck      # tsc --noEmit, strict mode
npm run test:coverage  # Vitest, coverage thresholds on src/core and src/input
npm run build
```

## Conventions

- **Language:** code, identifiers, commit messages and documentation in English. Code comments are
  in French (the existing convention).
- **TypeScript strict**, ESM, no `any`. Prefer small pure functions; inject I/O (`fetch`, clock,
  file system paths) so it can be tested.
- **Tests never use the real network.** The global `fetch` throws during tests. Use the helpers in
  `test/helpers/`:
  - `createMockFetch` / `jsonResponse` for HTTP mocks;
  - `fakeModrinth.ts` / `fakeCurseForge.ts`, in-memory APIs driven by `test/fixtures/`;
  - `cli.ts` (`createIo`, `run`) to run the whole CLI with a fake clock.
- **Fixtures** are readable files in `test/fixtures/` (folders named `*.jar` are zipped at test
  time). IDs and hashes in fixtures are fake; keep hashes as lowercase hex of the right length.
- **No secrets** anywhere in the repository. API keys come from environment variables only.
- **Dependencies:** keep them few. Explain in the pull request why a new one is needed.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `chore:`, `ci:`, `build:`. Explain **why** in the body.
- One logical change per commit; no unrelated refactoring.
- Add or update tests for every behaviour change, and update `CHANGELOG.md` (`Unreleased`) for
  user-visible changes.
- Pull requests target `main`. Describe what changed, why, and how you tested it.

## Project layout

```
src/
  input/       pack readers (.mrpack, CurseForge zip, jar folder) and jar metadata
  modrinth/    Modrinth API client, cache, rate limiter
  curseforge/  CurseForge API client and manifest resolution
  core/        compatibility engine, alternatives, dependency resolution
  migrate/     .mrpack format rules, migration plan, writer, migration report
  report/      table / JSON / Markdown renderers
  config/      modshift.config.json
  commands/    CLI commands (analyze, migrate, cache) and logging
  cli.ts       entry point
docs/          format notes (mrpack, CurseForge API)
schemas/       JSON Schemas (modrinth.index.json, modshift.config.json)
test/          Vitest tests, helpers and fixtures
```

## Releasing (maintainers)

1. Move the `Unreleased` entries of `CHANGELOG.md` to a new `## [x.y.z]` section.
2. Bump `version` in `package.json` **and** `src/version.ts` (a test checks they match).
3. Merge, then push a `vx.y.z` tag. The release workflow runs every check and creates the GitHub
   release with the npm tarball.
4. Publish to npm manually: `npm publish` (runs `prepublishOnly`).
