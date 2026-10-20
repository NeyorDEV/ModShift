# ModShift — Progress

## Phase 1 — Project setup ✅

Done:

- npm package (ESM, Node >= 20), TypeScript strict (`noUncheckedIndexedAccess`), build with `tsc`.
- ESLint 9 (flat config, `typescript-eslint` strict) + Prettier, Vitest.
- GitHub Actions CI: lint, format check, typecheck, build, tests on Node 20 and 22.
- README, LICENSE (MIT), minimal CLI skeleton (`modshift --version`).
- Test setup that stubs the global `fetch` so that any accidental real network call fails.

Decisions:

- **Runtime dependencies kept minimal**: `commander` (CLI), `fflate` (zip read/write, pure JS),
  `smol-toml` (TOML parsing for `mods.toml`). HTTP uses Node's native `fetch`.
- **Vitest pinned to 4.1.x** (not 5.x) because Vitest 5 requires Node >= 22 and we support
  Node 20. TypeScript pinned to 5.9 (the 7.x native compiler is not yet supported by
  `typescript-eslint`).
- npm 10 crashes (`Cannot read properties of null (reading 'edgesOut')`) when resolving the
  Vitest 4.1.12 peer set from scratch; the lockfile was generated with npm 11. `npm ci` on npm 10
  works fine with that lockfile.
- Modrinth's docs site is not reachable from the dev environment; the API was checked against the
  official OpenAPI spec (`modrinth/code` repository, `apps/docs/public/openapi.yaml`, v2.7.0).

## Remaining

- Phase 2: input parsing (.mrpack, CurseForge manifest, jar metadata).
- Phase 3: Modrinth client, cache, rate limiting.
- Phase 4: compatibility engine & dependency resolution.
- Phase 5: `analyze` command and reports.
