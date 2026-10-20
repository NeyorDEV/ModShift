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

## Phase 2 — Input parsing ✅

Done (`src/input/`):

- `.mrpack`: `modrinth.index.json` (name, version, Minecraft version, loader from
  `dependencies`), mod files with their SHA-1/SHA-512, `env`, downloads; `.jar` files found in
  `overrides/`, `client-overrides/`, `server-overrides/` are read and hashed locally.
- CurseForge zip: `manifest.json` (Minecraft version, primary loader such as `forge-47.2.0`,
  `files[]` project/file IDs, custom overrides folder) + override jars.
- Folder of `.jar`: uses the `mods/` subfolder if present (instance folder), otherwise the
  folder itself; non-recursive.
- Jar metadata: `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`,
  `META-INF/neoforge.mods.toml` (mod id, name, version, dependencies), `${file.jarVersion}`
  resolved from `META-INF/MANIFEST.MF`. Multi-loader jars report every loader.
- `loadPack(path)` auto-detects the format (archive content, not file extension).
- Fixtures are plain, readable files in `test/fixtures/`; a helper zips them at test time
  (folders named `*.jar` become nested jars). Fixture hashes and IDs are fake.

Decisions:

- Only `mods/*.jar` entries are treated as mods. Other files (resource packs, shaders,
  configs) are kept in `otherFiles` and not analysed for now.
- Paths that escape the instance folder (`..`, absolute) are ignored with a warning, as the
  `.mrpack` format requires.
- Platform dependencies (`minecraft`, `java`, `fabricloader`, `forge`, `neoforge`…) are dropped
  from jar dependency lists; Forge/NeoForge `incompatible`/`discouraged` entries too.
- Early NeoForge mods (1.20.x) using `mods.toml` are recognised by their `neoforge` dependency.
- `fabric.mod.json` is parsed leniently (raw control characters are tolerated) because Fabric's
  own parser accepts them.
- CurseForge `files[]` references are kept but cannot be identified (no CurseForge API): they
  will be reported as "not found" with an explicit reason.
- For folders, the source loader is inferred only when a strict majority of jars agree; the
  source Minecraft version is unknown (it is not needed for the analysis).

## Phase 3 — Modrinth client ✅

Done (`src/modrinth/`):

- `ModrinthClient` for the endpoints ModShift needs: `POST /version_files` (hash lookup,
  SHA-1 or SHA-512), `GET /project/{id}`, `GET /projects`, `GET /project/{id}/version`
  (filtered by `loaders` / `game_versions`, `include_changelog=false`), `GET /versions`,
  `GET /search` (facets).
- Explicit User-Agent: `NeyorDEV/ModShift/<version> (https://github.com/NeyorDEV/ModShift)`, as
  Modrinth requires.
- Rate limiting: local sliding window (300 requests / 60 s, Modrinth's documented limit) plus the
  `X-Ratelimit-Remaining` / `X-Ratelimit-Reset` response headers. On `429` the client waits for the
  announced reset and retries.
- Retries with exponential backoff (1 s, 2 s, 4 s; 3 retries) on network errors, timeouts
  (30 s) and 5xx. Other 4xx errors fail immediately (`ModrinthApiError`); `404` on
  project lookups returns `null` / `[]`.
- Cache: `ResponseCache` interface with `FileCache` (one JSON file per request, SHA-256 of the key,
  atomic writes, corrupted files ignored) and `MemoryCache`. Default directory:
  `$MODSHIFT_CACHE_DIR`, else `$XDG_CACHE_HOME/modshift`, else `~/.cache/modshift`. Default TTL 24 h.
  `404` results are cached too.
- Offline mode: the cache is used whatever the entry age; a cache miss raises
  `OfflineCacheMissError` and no request is sent.
- Tests use an injected mock `fetch` (`test/helpers/mockFetch.ts`) and a fake clock, so retries and
  rate-limit waits run instantly.

Decisions:

- `fetch` and time (`now`, `sleep`) are injected instead of using an HTTP mocking library: no extra
  dependency and fully deterministic tests.
- Bulk requests (hashes, ids) are split into batches of 100 to keep URLs and bodies small.
- Requests are sent one at a time (the limiter serialises them). Simple and well within the rate
  limit; parallelism can be added later if analysis feels slow.

## Phase 4 — Compatibility engine & dependencies ✅

Done (`src/core/`):

- `analyzePack(pack, target, api)` runs these steps:
  1. identify files by hash (`POST /version_files`, SHA-1, or SHA-512 when only that is known);
  2. fallback for local jars unknown to Modrinth: look up a project whose slug equals the jar's
     mod id (also trying `_` → `-`). Marked `identification: "mod-id"` and "unverified";
  3. fetch target versions per project (`loaders` + `game_versions` filters);
  4. status per mod: **compatible** (the current file already supports the target),
     **update-found**, **alternative-suggested**, or **not-found**, each with a reason;
  5. resolve dependencies on the final list (compatible + updated mods).
- Best version choice: native loader first (Quilt before Fabric on a Quilt target), then
  release > beta > alpha, then most recent; draft/unlisted versions are skipped.
- Alternatives (max 3 by default, `maxAlternatives: 0` disables them). First a name search
  (catches ports and forks), keeping only hits that share a significant word with the original
  title. Then a search in the same Modrinth categories, sorted by downloads. Both are filtered on
  the target loader, Minecraft version and `project_type:mod`. Projects already in the pack are
  excluded. Every alternative carries `note: "suggestion, to verify"`.
- Dependencies: required dependencies (by `project_id`, or `version_id` resolved through
  `GET /versions`) are added recursively in a target-compatible version
  (`dependencies.added`, with `requiredBy`). Those without such a version are listed in
  `dependencies.missing`. `incompatible` declarations between two projects of the final list are
  reported in `conflicts`. `optional` and `embedded` dependencies are ignored.
- Tests run the real `ModrinthClient` against an in-memory fake Modrinth
  (`test/helpers/fakeModrinth.ts`) driven by `test/fixtures/modrinth/catalog.json` (fake data).

Decisions:

- Quilt targets accept Fabric versions. Forge and NeoForge are kept strictly separate, even though
  NeoForge 1.20.1 could load some Forge mods; that case is rare and error-prone.
- A mod whose current file already supports the target stays **compatible** even if a newer
  version exists (minimal change); upgrading everything can be a later option.
- Alternatives are not used for dependency resolution: the user must pick them first.
- Dependencies declared only in jar metadata (unidentified jars) are not resolved; Modrinth
  dependency data is the source of truth.

## Phase 5 — CLI `analyze` and reports ✅

Done:

- `modshift analyze <pack> --mc <version> --loader <loader>` with `--format table|json|markdown`
  (`md` alias), `--output`, `--offline`, `--no-cache`, `--cache-dir`, `--max-alternatives`,
  `--quiet`, `--no-color`.
- Reports (`src/report/`):
  - table: aligned columns, optional ANSI colors (TTY only, honours `NO_COLOR`), long notes
    truncated;
  - JSON: the full `AnalysisResult` plus `schemaVersion` (1) and `generator`;
  - Markdown: summary, mods table with Modrinth links, alternatives section, dependencies,
    conflicts, warnings; pipes are escaped.
- Errors are printed without a stack trace and exit with code 1: invalid options, unreadable
  pack, network failure after retries, offline cache miss.
- Progress messages go to stderr, so stdout stays clean for `--format json`.
- CLI tests run the full program (parsing → analysis → report) against the fake Modrinth, with a
  real on-disk cache in a temp folder (the offline test reuses it).
- Smoke test of the built binary: in this sandbox, `api.modrinth.com` is blocked by the network
  policy. The CLI retries 3 times (1 s, 2 s, 4 s) and exits with
  `error: Network error while calling …`, as intended. **No analysis against the real Modrinth API
  could be run from this environment.**

Decisions:

- The exit code does not depend on statuses (a pack with "not found" mods still exits 0); a
  `--fail-on` option can be added later for CI use.
- The "to verify" warning is placed at the start of the alternatives note, so table truncation
  never hides it.
- Colors use raw ANSI codes (no `chalk`/`picocolors` dependency).

## Phase 6 — `migrate` command ✅

Done:

- `modshift migrate <pack> --mc <v> --loader <l> --out <file.mrpack>` with `--loader-version`,
  `--include-alternatives`, `--dry-run`, `--force` and the shared options (`--offline`,
  `--no-cache`, `--cache-dir`, `--max-alternatives`, `--quiet`).
- `src/migrate/`:
  - `mrpackSpec.ts`: format rules and validators (`validateMrpackIndex`, `validateMrpackArchive`);
  - `plan.ts`: `buildMigrationPlan` (pure) turns an `AnalysisResult` into the new index plus
    included and excluded mods; `resolveLoaderVersion`;
  - `writer.ts`: `collectOverrides` (copies `overrides/`, `client-overrides/` and
    `server-overrides/`; CurseForge overrides become `overrides/`; mod jars are never copied) and
    `buildMrpackArchive`, which re-validates the archive and throws `InvalidMrpackError`;
  - `report.ts`: `MIGRATION_REPORT.md` and the console plan.
- The pack contains:
  - compatible mods (same file) and updated mods, with their Modrinth file;
  - added dependencies;
  - adopted alternatives (only with `--include-alternatives`, flagged "suggestion, to verify");
  - non-mod index files from the source `.mrpack` (resource packs…), kept unchanged when they
    still satisfy the format;
  - overrides.
- Excluded mods (no compatible version) are listed in `MIGRATION_REPORT.md` with their reason and
  alternatives. The report is written next to `--out`.
- Engine: new `adoptAlternatives` option. It takes the first alternative (in relevance order) that
  has a target version, adds it to dependency resolution, and records it in
  `ModAnalysis.adoptedAlternative`. The mod's status stays `alternative-suggested`.
- Input: `ModPack.indexFiles` (raw non-mod index entries) and `ModPack.overridesDir`
  (CurseForge).

Format rules (see `docs/mrpack-format.md`, with sources):

- The public docs (`support.modrinth.com`, `docs.modrinth.com`) are blocked here, so the rules
  were read from Modrinth's own source code on raw.githubusercontent.com: the labrinth validator,
  `PackFormat`, `SafeRelativeUtf8UnixPathBuf` and `WHITELISTED_MODPACK_DOMAINS`.
- `sha1` **and** `sha512` are mandatory for every file. Allowed download domains:
  `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`. `fileSize` is a u32. Paths are
  strict (no `..`, backslash, drive prefix or Windows device names). The installer requires
  `dependencies.minecraft`.

Decisions:

- **Loader version:** the official loader metadata services (meta.fabricmc.net, meta.quiltmc.org,
  maven.neoforged.net, files.minecraftforge.net) are blocked here, so their formats cannot be
  verified. `migrate` therefore needs `--loader-version`, except when the source pack already uses
  the same loader and Minecraft version (its version is reused). The check runs before any API
  request, and the error message points to the loader's website. `--dry-run` only warns.
- Mods that are not identified or have no compatible version are never copied, even when they
  were local jars in `overrides/mods/`: an old jar would probably crash the game.
- A Modrinth file whose URL is not on an allowed domain (theoretical) is excluded with a warning,
  never written.
- The pack is always built and validated, even in `--dry-run`, so format problems show up early.
- `--out` must end with `.mrpack`, must differ from the input, and is never overwritten without
  `--force`.
- Generated metadata: `name` = `<source name> (<mc> <loader>)`; `versionId` =
  `<source version>+<loader>-<mc>`; `summary` mentions ModShift and the source/target.
- `MIGRATION_REPORT.md` has a fixed name (as requested): two migrations into the same folder
  overwrite each other's report.

## Phase 7 — End-to-end tests & coverage ✅

Done:

- `test/e2e/scenarios.test.ts` runs the full CLI (read → analyse → plan → `.mrpack` → report)
  against the fake Modrinth, with real files in a temp folder:
  - **1.20.1 Forge → 1.21.1 NeoForge** (`test/fixtures/packs/mrpack-forge`): JEI and Create
    updated, Flywheel added as Create's dependency, Rubidium excluded with Sodium/Embeddium as
    alternatives, `env` and overrides kept; also with `--include-alternatives`;
  - **Fabric → Quilt**: Quilt-native versions first, Fabric otherwise, `quilt-loader` dependency;
  - **unidentifiable mods** (folder of jars): unknown jars excluded with reasons, a mod-id match
    included but flagged "identified by mod id only, unverified";
  - **missing dependency**: the mod is kept and the dependency is reported;
  - `analyze --format json` on the Forge pack.
- Automatic validation of every generated pack (`test/helpers/mrpackAssertions.ts`):
  - format rules (`validateMrpackArchive`);
  - JSON Schema `schemas/modrinth.index.schema.json` checked with `ajv` (dev dependency only);
  - hash coherence: each `mods/` entry matches the Modrinth file (sha1, sha512, size, URL).
- `test/migrate/schema.test.ts` checks that the schema itself rejects invalid indexes.
- Coverage: `npm run test:coverage` (`@vitest/coverage-v8`, also run in CI) with thresholds of
  80 % (statements, branches, functions, lines) on `src/core/**` and `src/input/**`.
  - Current: core 93 % statements / 80.3 % branches; input 95 % / 84 %; overall 92.9 % / 83 %.
  - Reports are written to `coverage/` (git-ignored).
- Catalog fixture extended with Forge/NeoForge projects (Create, Flywheel, Rubidium, Embeddium) and
  a Forge JEI version.

Decisions:

- `ajv` is a dev dependency used only by tests. The runtime keeps its own validator
  (`mrpackSpec.ts`) because it also checks rules a schema cannot express (canonical URLs, Windows
  device names, duplicate paths).
- Mods identified only by their mod id are included when a target version exists, but the
  report marks them as unverified (`PlannedMod.unverified`).

## Phase 8 — Robustness ✅

Done:

- **Actionable errors** (`src/errorMessages.ts`): `describeError()` turns each known error into
  `error: <message>` plus `hint: <what to do>`. Unknown errors still crash with a stack trace (they
  are bugs).
  - network: check the connection/proxy, or use `--offline`;
  - invalid pack: the formats ModShift accepts;
  - rate limit (new `RateLimitError`, thrown when `429` persists after retries): wait N s, cached
    responses are reused;
  - offline cache miss: run once online;
  - Modrinth 5xx: retry later (status page);
  - other 4xx and `InvalidMrpackError`: open an issue.
- Unidentifiable mods: the reason now says the file may come from another site or have been
  modified.
- **Logs** (`src/commands/logger.ts`): three levels (`--quiet`, normal, `-v/--verbose`), always on
  stderr.
  - The progress bar (per-project version lookup, `onProgressTick` in the engine) is drawn only
    when stderr is a TTY and is cleared before any other line.
  - `--verbose` logs every request (method, path, status, duration), cache hits and retries,
    through the new `ModrinthClientOptions.onEvent`.
  - Rate-limit pauses of 2 s or more are always announced (`RateLimiter` `onWait`).
- `createSession()` (`src/commands/analyze.ts`) is shared by `analyze` and `migrate`: logger,
  client (cache, offline, events) and the option checks (`--quiet` + `--verbose`, `--offline` +
  `--no-cache`).
- **Conflicts** now have a `kind` and an `explanation` (with the recommended action), shown in
  every report and in `MIGRATION_REPORT.md`:
  - `incompatible`: A declares B incompatible and both are in the final list;
  - `pinned-version`: A requires a specific `version_id` of B, but another B version was
    selected for the target;
  - `duplicate`: the same project appears in several files of the source pack.

Decisions:

- Conflicts are reported, never resolved automatically: picking which mod to drop needs the
  user's judgement (the interactive mode, phase 14, can ask).
- `CliIo` gained `stderrIsTTY` and `columns`; test IOs set them explicitly.

## Next steps

Work plan agreed with the user: phases 9 → 16, then phases 17 → 22 (third message), in order.
Push after every phase. The PR stays a draft until the end. Never change GitHub settings or
publish anything (npm, Marketplace, Pages): list manual actions here instead.

- **Phase 9, offline and cache:** `--offline` already exists (Phase 3). To do:
  - `modshift cache clear` / `modshift cache stats` (count, size, oldest/newest entry);
  - a configurable TTL (`--cache-ttl <duration>` and/or an env var). It is passed to
    `ModrinthClient` through `createSession` in `src/commands/analyze.ts`
    (`cacheTtlMs` already exists);
  - offline cache misses should name the missing request kind.
- **Phase 10, CurseForge API:** `CURSEFORGE_API_KEY` only; disabled with a clear message without a
  key. Check the official docs (they will probably be blocked here, so document that).
- **Phase 11:** `modshift.config.json` (loader preferences, ignore list, manual mappings) and a
  security review (zip-slip, size limits, jars never executed).
- **Phase 12:** npm packaging (no publish), tag-triggered release workflow, full README,
  CONTRIBUTING.md, issue templates.
- **Phases 13–16:**
  - loader registry and fallback loaders (only rules found in official docs);
  - interactive mode (maintained prompt library, decision logic kept testable);
  - `modshift ui` on 127.0.0.1;
  - final docs.
- **Phases 17–22:**
  - cross-loader migration and Sinytra Connector hints (experimental, never auto-included);
  - `--side client|server`;
  - concurrency and benchmarks;
  - source plugin system with a GitHub Releases source;
  - reusable GitHub Action;
  - VitePress docs site with a Pages deploy workflow (not enabled).

Pitfalls:

- `test/fixtures/modrinth/catalog.json` was generated by a throw-away script (not committed). Edit
  the JSON directly; keep IDs and hashes fake and hashes as hex of the right length (40 / 128), or
  the `.mrpack` validator rejects them.
- npm 10 crashes when resolving new dev dependencies from scratch (`edgesOut`). Use
  `npx -y npm@11 install -D <pkg>`; `npm ci` with npm 10 then works.
- Prettier formats `docs/` and `PROGRESS.md`: run `npx prettier --write .` before committing.
- Not verified against the live Modrinth API (network blocked here): do a manual run.

## Known issues

- None blocking. No problem needed more than one fix attempt.
