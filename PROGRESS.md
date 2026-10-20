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

## Phase 9 — Offline mode & cache ✅

Done:

- `FileCache.stats(ttlMs?)` / `FileCache.clear({ olderThanMs? })` (`src/modrinth/cache.ts`).
  They only touch files named like entries (`<sha256>.json`), so foreign files in the directory
  are never deleted. Unreadable entries are counted, and removed by `clear --expired`.
- `modshift cache stats [--cache-dir] [--cache-ttl] [--json]` and
  `modshift cache clear [--cache-dir] [--expired [--cache-ttl]]` (`src/commands/cache.ts`).
- Configurable lifetime: `--cache-ttl <duration>` on `analyze`/`migrate`, or `MODSHIFT_CACHE_TTL`.
  Accepted values: `90s`, `30m`, `12h`, `7d`, `0` = always refresh; default `24h`.
  - Parsing: `src/duration.ts`; resolution: `resolveCacheTtl()` in `src/commands/analyze.ts`.
  - Invalid values are rejected before any request, and the error names their source (option or
    env var).
- Offline: `OfflineCacheMissError` now names the missing request, through `describeRequest()` in
  `src/modrinth/errors.ts` (e.g. "the hash lookup of 6 file(s)", "versions of project X"). An
  uncached alternatives **search** no longer aborts the analysis: it becomes a warning, and the
  mod is reported without alternatives. Required lookups (hashes, versions, dependencies) still
  stop with the hint "run once without --offline".

Decisions:

- Offline mode never reads expired entries any differently: any cached entry is used, whatever its
  age (unchanged since Phase 3).
- Durations without a unit are rejected (except `0`) to avoid ambiguity (seconds vs. hours).

## Phase 10 — CurseForge support ✅

Done:

- `src/curseforge/client.ts`: `CurseForgeClient` with `POST /v1/mods/files` and `POST /v1/mods`
  (batched ids), the `x-api-key` header, retries on 429/5xx (`Retry-After`), the shared response
  cache (TTL, `--offline`) and errors with hints (`CurseForgeApiError` 401/403 → "check the key",
  `CurseForgeNetworkError`).
- The key comes **only** from `CURSEFORGE_API_KEY` (`curseForgeApiKey()`). It never reaches cache
  keys, logs or error messages (tested). There is no key in code, tests or fixtures: tests use
  `FAKE_CF_KEY = 'test-key-not-a-real-curseforge-key'` against a fake server
  (`test/helpers/fakeCurseForge.ts`, data in `test/fixtures/curseforge/api.json`).
- `src/curseforge/resolve.ts`: `resolveCurseForgeRefs()` fills the file name, path, **SHA-1** and
  size, plus the project name and slug. The engine then identifies the same jar on Modrinth by
  hash, and falls back to the CurseForge slug as a Modrinth slug (unverified).
- `Session.prepare(pack)` (`src/commands/analyze.ts`) runs the resolution for `analyze` and
  `migrate`. Without a key it adds the warning
  "N CurseForge file reference(s) not identified: set CURSEFORGE_API_KEY…". The feature is
  disabled, not an error.
- Fuller manifest reading: `author`, and a warning for an unknown `manifestVersion`. `required:
false` is kept on the reference.
- `CliIo.env` and `CliIo.createCurseForgeApi` make the environment and client injectable (tests
  never read `process.env`).
- Docs: `docs/curseforge-api.md`.

Decisions:

- **Verification:** `docs.curseforge.com` and `api.curseforge.com` are blocked here. Endpoints,
  header, `data` wrapper, fields and enums (`hashes[].algo` 1 = SHA-1) were cross-checked in packwiz
  (`curseforge/request.go`) and Prism Launcher (`launcher/modplatform/flame/*.cpp`), which agree.
  Not run against the live API.
- **Terms of use:** metadata only; never download from CurseForge, never write CurseForge URLs (the
  `.mrpack` format forbids them anyway). Mods are matched on Modrinth, which is also Prism
  Launcher's approach for mods whose distribution is disabled.
- `allowModDistribution` is not used (not confirmed by the reference clients).

## Phase 11 — Configuration & security review ✅

Done:

- **`modshift.config.json`** (`src/config/config.ts`, schema in
  `schemas/modshift.config.schema.json`):
  - `target.minecraftVersion` / `target.loader` / `target.loaderVersion`: defaults for `--mc`,
    `--loader`, `--loader-version` (command-line options win);
  - `ignore`: file names (`*` wildcard, case-insensitive), Modrinth slugs or project ids; ignored
    mods are skipped **before any lookup** and listed in every report (`AnalysisResult.ignored`);
  - `mappings`: `"old mod" → "Modrinth slug or id"`. The match uses the file name, slug or id, and
    also works for unidentified files. The mod becomes `update-found` with `mapping` and the
    reason "Replaced by X (mapping … in modshift.config.json)", or `not-found` when the
    replacement has no target version. An unknown replacement project gives a warning, and the mod
    is analysed normally.
  - Lookup: `--config <file>`, else `./modshift.config.json` if it exists; `--no-config` disables
    it. Validation is strict (unknown keys rejected, 1 MiB max) and `ConfigError` comes with a
    hint.
  - `CliIo.cwd` is injectable; test IOs use a non-existent folder so no local config leaks into
    tests.
- **Security review** (`SECURITY.md`):
  - zip bombs: `readZip` checks declared sizes and entry counts before inflating (fflate allocates
    from the declared size); limits are in `DEFAULT_ZIP_LIMITS` / `METADATA_ZIP_LIMITS`; pack files
    over 1 GiB are refused; `collectOverrides` uses the same bounded reader;
  - zip slip: entries are never written by their archive name, and paths are validated (already
    there since phases 2 and 6);
  - jars are never executed (grep shows no `eval` / child process / dynamic import);
  - symbolic links are skipped in folders; `loadPack` refuses non-regular files.
- Fix: `migrate` now checks the loader version **before** CurseForge resolution (no request
  before a usage error).

Decisions:

- Mappings are explicit user choices, so they are reported as replacements, not "suggestions".
- Limits are generous (packs of a few hundred MB work) but bounded; they are not configurable yet.

## Phase 12 — Release readiness ✅ (nothing published)

Done:

- **npm package** (`package.json`):
  - `repository`, `homepage`, `bugs`, `author`, `main`/`types`/`exports`, `bin`;
  - `files`: built `.js` and `.d.ts`, `schemas/`, `CHANGELOG.md` (README and LICENSE are added
    by npm). Build without source maps (`tsconfig.build.json`);
  - `prepack` = clean + build; `prepublishOnly` = lint + typecheck + tests;
  - `npm pack --dry-run`: 93 files, about 55 kB.
- **Public API** `src/index.ts` (`import { analyzePack, loadPack, ModrinthClient, … } from
'modshift'`), with types.
- `test/package.test.ts`: `src/version.ts` = `package.json` version, exports, and metadata.
- **Release workflow** `.github/workflows/release.yml` on `v*.*.*` tags: checks that the tag
  matches `package.json`, runs lint, format, typecheck and tests with coverage, then `npm pack`
  and `gh release create` with notes extracted from `CHANGELOG.md`
  (`scripts/release-notes.mjs`, tested) and the tarball attached. Pre-release when the tag has a
  `-`. **No `npm publish`.**
- `CHANGELOG.md` (Keep a Changelog), with section `[0.1.0]`.
- Full `README.md`: features, installation, quick start, commands, option tables, environment
  variables, exit codes, config, CurseForge, cache, real output, how it works, FAQ, limits,
  programmatic API, contributing, security, licence.
  - The example output was captured from the test fixtures with the mock API, and the README
    says so.
- `CONTRIBUTING.md`, and `.github/ISSUE_TEMPLATE/` (bug report, feature request, wrong
  match/suggestion, security link).

Decisions:

- Release notes come from `CHANGELOG.md` rather than from commits: they are more readable and
  checked by a test.
- The `modshift` name was free on npm on 2026-10-20 (`npm view modshift` → 404), which may change.

## Phase 13 — Loader registry & fallback compatibility ✅

Done:

- `src/loaders/registry.ts`: a single **registry** (`LOADER_DEFINITIONS`) replaces the hard-coded
  lists. Each entry has an id, name, kind (`mod-loader` / `server-plugin` / `proxy-plugin`), the
  `.mrpack` key (only `forge`, `neoforge`, `fabric-loader`, `quilt-loader`), the folder
  (`mods` / `plugins`), an optional website, and its **fallbacks** with their official source.
  `Loader`, `LOADERS`, `acceptedLoaders`, `MRPACK_LOADER_KEYS` and the loader-version hint all come
  from it.
- Loaders added: `liteloader`, `modloader`, `rift`, `babric`, `bta-babric`, `legacy-fabric`,
  `ornithe`; `bukkit`, `spigot`, `paper`, `purpur`, `sponge`; `bungeecord`, `waterfall`,
  `velocity`.
- Documented fallbacks only:
  - Quilt ← Fabric (QuiltMC/quilt-loader README);
  - Paper ← Spigot, Bukkit (PaperMC docs, `getting-started.mdx`: "drop-in replacement for both
    CraftBukkit and Spigot");
  - Purpur ← Paper, Spigot, Bukkit (Purpur README);
  - Waterfall ← BungeeCord (Waterfall README).
- A version picked through a fallback carries `fallback {loader, source, note: "fallback
compatibility, to test"}` (`ModAnalysis` and `AddedDependency`). It is explained in the reason and
  labelled in every report (table, Markdown, `MIGRATION_REPORT.md`, console plan). A native version
  is always preferred.
- `migrate` refuses targets that `.mrpack` cannot declare (Paper, Velocity…), before any request,
  and suggests `analyze`.
- Plugin metadata (`src/input/plugin.ts`): `plugin.yml`, `paper-plugin.yml`, `bungee.yml`
  (minimal YAML reader, top-level keys only), `velocity-plugin.json`. A folder with `plugins/` is
  read like an instance with `mods/`.
- Docs: `docs/loaders.md` (table, sources, rules left out); README "Loaders" section.
- Tests:
  - registry consistency;
  - plugin metadata;
  - server folders on Paper, Spigot, Purpur, Waterfall and Velocity targets (native, fallback and
    strict cases);
  - Fabric → Quilt fallback in every report;
  - a native-version check for **each** registered loader (synthetic catalog).

Decisions and verification:

- Loader names: the Modrinth API (`/v2/tag/loader`) and docs are blocked here. The names were
  cross-checked in packwiz (`modrinth/modrinth.go`) and Prism Launcher
  (`launcher/modplatform/ModIndex.cpp`). Names confirmed by neither (e.g. `folia`) were left out.
- **Not applied, for lack of a reachable official source:** NeoForge ← Forge (1.20.1), and
  Spigot ← Bukkit (SpigotMC's site is blocked). Velocity is not BungeeCord-compatible.
- Shader/resource-pack "loaders" (`iris`, `optifine`, `canvas`, `vanilla`, `minecraft`,
  `datapack`) are not targets.
- `plugin.yml` declares `bukkit` (the most general platform); Paper and Purpur accept it through
  their documented fallbacks.

## Phase 14 — Interactive mode ✅

Done:

- `modshift interactive [pack]` (alias `i`, or `modshift -i`), in `src/commands/interactive.ts`:
  1. pack (argument or prompt), target Minecraft version and loader (from the registry; defaults
     come from the config, else the source pack);
  2. analysis with the saved `mappings`, then the table report;
  3. review scope: mods that need attention (`needsReview`: not a safe update, a fallback, or a
     mod-id match), all mods, or none;
  4. per-mod choice: accept / use one of the alternatives / exclude / ignore;
  5. save to `modshift.config.json` (`writeConfig`, validated), then optionally build the pack
     (`runMigrate`, loader version asked and saved in `target.loaderVersion`). Plugin platforms
     skip that step.
- Pure decision logic in `src/interactive/decisions.ts`: `optionsFor`, `defaultOption` (saved
  decision, else accept, else exclude, never an alternative nobody chose), `applyDecision`
  (returns a copy; replaces earlier choices for the same key), `decisionKey` (original slug, else
  file name), `needsReview`, `summarizeDecisions`.
- Config: new **`exclude`** list. Excluded mods are analysed and reported, but left out of the
  pack, together with the added dependencies that only they required. `ignore` still means "not
  analysed".
- `Prompter` interface (`src/interactive/prompter.ts`): the real implementation uses
  **`@inquirer/prompts` 8.7.3** (pinned exactly; MIT; active, latest release 2026-10-19; `npm audit`
  clean). It is imported on demand, so the other commands do not load it. Ctrl+C →
  `PromptCancelledError` → exit code 130, nothing saved.
- Non-interactive mode unchanged: without a TTY on stdin, `interactive` refuses and points to
  `analyze`/`migrate`.
- Node engines changed to `^20.17.0 || >=22.13.0` (required by Inquirer).
- Fix: the default cache directory and TTL come from the injected environment (`CliIo.env`).
  `test/setup.ts` redirects `MODSHIFT_CACHE_DIR` to a temp folder (one run had written to
  `~/.cache/modshift`).
- Tests: decision logic, and the full flow with a scripted prompter
  (`test/helpers/scriptedPrompter.ts`): saving, replay through `analyze`, defaults from the config,
  plugin platform, cancel, missing TTY, `--no-config`.

Decisions:

- Choices are stored with the existing config keys (`mappings` / `exclude` / `ignore`), not a new
  "decisions" format: they replay with every command, without a second format.
- A version published more than two weeks ago (8.7.3) was preferred over the release from the day
  before (8.7.4).

## Phase 15 — Local web UI ✅

Done:

- `modshift ui [--port <n>] [--no-open]` plus the cache options (`src/commands/ui.ts`). It opens the
  browser through `xdg-open` / `open` / `explorer.exe`, without a shell. Ctrl+C closes the server
  and deletes its temporary files.
- Server `src/ui/server.ts` (`node:http`, no framework):
  - listens on **127.0.0.1 only**, random port by default;
  - random token in the URL, then the `X-ModShift-Token` header (compared in constant time);
  - `Host` check against DNS rebinding;
  - static files from a **whitelist** (`STATIC_FILES`); no path is built from the URL;
  - API: `GET /api/info`, `POST /api/analyze?mc&loader&maxAlternatives&name` (raw pack body,
    200 MiB max, 413 above), `POST /api/migrate {sessionId, loaderVersion, includeAlternatives}`,
    `GET /api/sessions/:id/download/{mrpack|report|analysis}`, `DELETE /api/sessions/:id`;
  - sessions in memory, one subfolder per session in `mkdtemp(modshift-ui-*)`, expiry after 1 h,
    everything deleted by `close()`;
  - headers: CSP `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, COOP/CORP,
    `Permissions-Policy`;
  - errors: upstream errors (network, quota, Modrinth/CurseForge, offline) → 502; input errors →
    400, with the hint.
- Page `src/ui/public/` (`index.html`, `style.css`, `app.js`, `logic.js`): drag-and-drop, target
  (loaders from the registry, grouped by kind), status chips and filter, search, sortable table,
  detail dialog (versions, loaders, fallback, reason, alternatives, dependencies, Modrinth link),
  build and downloads (through `fetch` + blob, since the token is a header), light/dark theme
  (system preference plus a toggle in `localStorage`), responsive, keyboard-accessible. Data goes
  in with `textContent` only.
- Build: `scripts/copy-ui-assets.mjs` copies the assets to `dist/ui/public`; the npm `files` include
  them. ESLint declares browser globals for `src/ui/public/**/*.js`.
- Tests:
  - `test/ui/server.test.ts`: exposure, headers, whitelist, Host check, token, analyze/migrate,
    validated download, plugin platforms, invalid uploads, zip bomb, 413, session ids, temp
    folder;
  - `test/ui/logic.test.ts`: sorting, filters, labels, safe links;
  - `test/ui/browser.e2e.test.ts`: **headless Chromium** through `playwright-core` 1.63.0 (dev,
    pinned, downloads no browser). Upload, filters, detail, build, download of a valid `.mrpack`,
    no JS or CSP errors. It runs if a browser is found (`MODSHIFT_CHROMIUM`,
    `/opt/pw-browsers/chromium`, `/usr/bin/google-chrome`, …), otherwise it is skipped; GitHub's
    Ubuntu runners ship Google Chrome.

Decisions:

- No framework or bundler: the page is about 700 lines of HTML/CSS/JS served as is. The pure logic
  (`logic.js` + `logic.d.ts`) is tested in Node.
- Folders of jars cannot be uploaded (only archives); use the CLI for folders.
- The 1 h sessions live in memory: restarting `modshift ui` loses them, by design.

## Phase 16 — Polish ✅

Done:

- README: Node badge (`20.17+ | 22.13+`), two real UI screenshots (light and dark, taken with
  headless Chromium from the fixture pack and labelled as fake data, in `docs/images/`), features
  of phases 13–15, a link to the CLI reference, updated limitations.
- `docs/cli.md`: complete option reference **generated** from each command's `--help`
  (`npm run docs:cli`, script `scripts/gen-cli-docs.mjs`). CI regenerates it and fails if the
  committed file is stale.
- `CHANGELOG.md`: loaders, fallbacks, interactive mode, web UI and the engines change added to
  `[0.1.0]` (not published yet).
- **UI fix found on the screenshots:** class rules (`.downloads { display: flex }`) overrode the
  `hidden` attribute, so the download buttons showed before any build. A global `[hidden]` rule
  fixes it, and the browser test checks it (reproduced: it fails without the fix).
- CI: `actions/checkout@v5` and `actions/setup-node@v5` (v4 runs on Node 20, deprecated on
  GitHub). The browser E2E test **runs in CI** (GitHub's Chrome), confirmed in the job logs.

## Phase 17 — Cross-loader migration ✅

Done (branch `feat/cross-loader-migration`):

- **Same project first.** The engine already queried the same project for the target loader;
  a version picked for another loader than the pack's is now recorded as `loaderChange
{from, to}` with the reason "Same project: its Fabric version replaces the Forge one
  (multi-loader mod)", shown in the analysis reports, `MIGRATION_REPORT.md`, the plan text and
  the UI. Not set when the same file is kept, nor for a fallback that keeps the pack's loader
  (Fabric version on Quilt).
- **Ranked alternatives** (`src/core/alternatives.ts`): both searches (similar name, same
  categories) always run, candidates are merged and scored by `scoreAlternative`: shared thematic
  categories 40, shared title words 30, popularity 20 (log10 of downloads / 7), description
  keywords 10. Each `Alternative` has `score` (0–100) and `explanation` (e.g. "similar name
  (minimap) · same categories (adventure, utility) · 1.0M downloads"). Shown in every report,
  the interactive mode and the UI; `MIGRATION_REPORT.md` has a "Why these alternatives" section.
  The fixture order changed as intended: JourneyMap (same theme) now ranks above JEI (more
  downloads, other theme).
- **Compatibility layers** (`src/loaders/compatLayers.ts`), verified from the projects' own files
  on raw.githubusercontent.com:
  - Sinytra Connector, `dev` README: Fabric mods on **NeoForge**, 1.21.1 "primary supported
    version"; requires `connector` + `forgified-fabric-api` (which _replaces_ Fabric API);
  - Sinytra Connector, `1.20.1` branch README: Fabric mods on **MinecraftForge** 1.20.1, LTS
    (critical bugfixes only);
  - Kilt, `version/1.20.1` README + `fabric.mod.json`: Forge mods on **Fabric** 1.20.1, "very
    experimental", "may break worlds"; requires `kilt`, `fabric-api`, `fabric-language-kotlin`.
    Its NeoForge 1.21.1 build is "in progress": not listed.
    A mod with no target version but a version for the layer's source loader and the target MC
    version gets `compatLayer` (note "experimental, not guaranteed"); one extra request per such
    mod and layer. The plan **never** includes it. `analyzePack(..., { compatLayers: false })`
    disables the check (no CLI flag, to keep the CLI small). Offline cache misses become warnings.
- Fixtures: `test/fixtures/packs/mrpack-forge-to-fabric` (JEI multi-loader, Create and Rubidium
  with alternatives, Storage Tweaks with no equivalent) and catalog additions (`v1jeifabric`,
  Create Fabric, Storage Tweaks). Tests: `test/core/alternatives.test.ts`,
  `crossLoader.test.ts`, `compatLayers.test.ts`.
- README section "Changing loader (e.g. Forge → Fabric)" (ModShift does not convert mod code),
  `docs/loaders.md` "Compatibility layers" with sources, CHANGELOG.
- 335 tests; coverage core 94.6 %, input 94.6 %.

## Phase 18 — Client/server sides ✅

Done (branch `feat/client-server-sides`):

- Verified in Modrinth's OpenAPI spec (raw.githubusercontent.com `modrinth/code`
  `apps/docs/public/openapi.yaml`): project `client_side` / `server_side` (`required`, `optional`,
  `unsupported`, `unknown`) are **deprecated** in favour of an `environment` field (on versions:
  `client_and_server`, `client_only`, `client_only_server_optional`, `singleplayer_only`,
  `server_only`, `server_only_client_optional`, `dedicated_server_only`, `client_or_server`,
  `client_or_server_prefers_both`, `unknown`). The mapping between them is copied from labrinth's
  `convert_v3_environment_to_v2_side_types` (`apps/labrinth/src/routes/v2_reroute.rs`), including
  the fixed sides of plugins, data packs, shaders and resource packs.
- `src/core/sides.ts`: `sideOf(project, version)` (version `environment` first, then project
  fields, else unknown), `sideCategory` (client / server / both / unknown; `unsupported` on both
  sides counts as unknown), `neededOn(side, target)`, `mrpackEnv`.
- `ModAnalysis.side`, `AddedDependency.side`, `AdoptedAlternative.side`, `VersionRef.environment`,
  `AnalysisResult.side` (target installation, `both` by default).
- `--side client|server|both` on `analyze` and `migrate`, `target.side` in the config (validator
  and JSON Schema). With `server` (or `client`), mods not needed are excluded with a reason, their
  own dependencies dropped; unknown sides are **kept with a warning**. `.mrpack` `env` comes from
  the source pack, else from Modrinth when both sides are known.
- Reports: Markdown section "Client and server" (client-only, server-only, unknown/ambiguous,
  not needed), one summary line in the table, side row in the UI detail panel.
- Fixtures: `environment` on some catalog versions (Sodium, Mod Menu, Xaero client-only; Fabric
  API both), Cloth Config with unknown sides. Tests: `test/core/sides.test.ts`,
  `test/commands/side.test.ts`, config validation. 357 tests; coverage core 95.2 %, input 94.6 %.
- Not done (kept simple): no `--side` in `interactive` or the web UI (they use `both`).

## Phase 19 — Concurrency & benchmarks ✅

Done (branch `perf/concurrent-requests`):

- `src/concurrency.ts`: `mapConcurrent(items, limit, fn)`, an ordered promise pool (results in
  input order, no new call after the first error), `DEFAULT_CONCURRENCY` 4, `MAX_CONCURRENCY` 16.
  No dependency added.
- Engine: version lookups (step 3), alternatives + compatibility layer searches (new step "3 bis",
  `searchReplacements`, prefetched for every identified mod without a target version) and each
  dependency round (`resolveDependencies(..., { concurrency })`) run in the pool. Adopting an
  alternative stays sequential (it depends on what is already selected), and warnings are pushed
  in pack order, so results are **identical** whatever the concurrency (tested with deep equality
  and with the CLI's JSON output).
- `RateLimiter` already serialises `acquire()`: tested with 12 parallel calls and a fake clock,
  never more than `maxRequests` per window. It stays the only gate on the request rate.
- `ModrinthClient` coalesces identical requests in flight (`inFlight` map keyed like the cache):
  the benchmark showed duplicate category searches with concurrency > 1.
- `--concurrency <n>` (1–16, default 4) on `analyze`, `migrate`, `interactive` and `ui`
  (`parseConcurrency`); `docs/cli.md` regenerated.
- `bench/` (`npm run bench`): `synthetic.mjs` (deterministic 200/500-mod packs and catalog),
  `fakeApi.mjs` (indexed in-memory Modrinth, optional artificial latency), `run.mjs` (warm-up +
  median of N runs, Markdown or `--json`), `bench/README.md` (method). Uses `dist/` (build first).
  Results in the README "Performance" section, stated as local processing with a fake API.
  The rate limiter is disabled in the bench; the script prints the minimum time the real 300
  requests/minute would impose (≈ 49 s for the 500-mod pack's 545 requests).
- 366 tests.

## Phase 20 — Mod source plugins ✅

Done (branch `feat/source-plugins`):

- **Contract** (`src/sources/types.ts`): `ModSource { id, name, description, primary?,
validateOptions?, prepare?, findCandidates? }`, `SourceContext { env, options, offline, warn,
log, debug }`, `CandidateRequest`, `SourceCandidate` (note "external source, to verify").
  Simplest design that needs no engine rewrite: Modrinth stays the **primary** source queried by
  the engine; plugins add `prepare` (before analysis) and `findCandidates` (after it, for
  `not-found` / `alternative-suggested` mods).
- **Registry** (`src/sources/registry.ts`): id pattern, no duplicates, a single primary source,
  `validateOptions(config.sources)`; `createDefaultRegistry` registers `modrinth`, `curseforge`
  (the former session code, unchanged behaviour) and `github-releases`.
- **GitHub Releases** (`src/sources/githubReleases.ts`), contract verified in GitHub's OpenAPI
  description (raw.githubusercontent.com `github/rest-api-description`) and `github/docs`
  sources: `GET /repos/{owner}/{repo}/releases`, asset `name`, `browser_download_url`, `size`,
  `state`, nullable `digest`; `User-Agent` required, `Accept: application/vnd.github+json`,
  optional `Authorization: Bearer` from `GITHUB_TOKEN` only; no `X-GitHub-Api-Version` (the
  default version is used; the current value could not be checked). Name matching by whole
  tokens (1.21.1 ≠ 1.21.10, forge ≠ neoforge), documented fallbacks accepted.
- Config key `sources` (structure checked by `validateConfig`, content by each source in
  `loadSettings`), JSON Schema updated. `CliIo.fetch` lets tests inject a fake GitHub.
- `ModAnalysis.external`; reports: "Other sources (to verify)" (Markdown, `MIGRATION_REPORT.md`),
  a table line, UI detail rows. The plan **never** includes them.
- Public API exports the registry, the contract and the built-in sources.
- Tests: reusable `test/sources/contract.ts` (`describeSourceContract`), run for the 3 built-ins
  and a third-party example; GitHub source, registry and CLI tests with fake release data
  (`test/fixtures/github/releases.json`). 407 tests.
- `docs/plugins.md`, README "Other sources (plugins)", SECURITY (GITHUB_TOKEN), CHANGELOG.
- Not done (kept simple): the web UI does not use the registry (its CurseForge resolution is
  unchanged, no GitHub source there); the CLI never loads third-party code (programmatic API
  only, on purpose).

## Known limitations

- **Never run against the live APIs.** Modrinth (`api.modrinth.com`, docs), CurseForge and the
  loader metadata services are blocked from the development environment. Contracts were checked
  against Modrinth's OpenAPI spec and source code, and against packwiz and Prism Launcher. A
  manual run with real packs is needed before a release.
- `migrate` needs a loader version (`--loader-version` or `target.loaderVersion`), except when the
  source pack already uses the same loader and Minecraft version.
- Only `mods/*.jar` and plugins are analysed. Resource packs and shaders are copied unchanged
  (when they still satisfy the `.mrpack` format) but not checked.
- Alternatives (name or category search) and mod-id/slug matches are heuristics: always check
  them.
- Unapplied fallbacks for lack of an official source: NeoForge ← Forge (1.20.1), Spigot ← Bukkit.
- Compatibility layers are only reported for the documented combinations (Connector on NeoForge
  1.21.1 / Forge 1.20.1, Kilt on Fabric 1.20.1); exact MC versions only (no 1.21 or 1.20).
- Relevance weights are a heuristic tuned on fixtures, not on real search results.
- Sides depend on Modrinth metadata, which authors often leave as `optional`/`optional`: a mod
  marked so stays in a server pack. `interactive` and the web UI do not offer `--side` yet.
- With an empty cache, Modrinth's 300 requests/minute dominate big packs (≈ 50 s for 500 mods).
  The benchmark measures local processing only; no real-network benchmark exists.
- Conflicts (incompatible, pinned versions, duplicates) are reported, never resolved
  automatically.
- A dependency that only an excluded mod needed is dropped, but not its own transitive
  dependencies.
- Web UI: archives only (no folder upload), sessions in memory (lost on restart), English only.
- `plugin.yml` is read with a minimal YAML reader (top-level keys only).
- Other sources (GitHub Releases) only produce suggestions matched by file name; they never
  enter the migrated pack (no SHA-1/SHA-512 from GitHub). Not tested against the live GitHub API.
- npm publishing, GitHub Pages and the Marketplace are manual steps (see "Manual actions").

## Ideas for later

- Optional automatic loader versions through the official meta services (Fabric/Quilt meta,
  NeoForge/Forge maven), behind an option, once they can be verified.
- Resource pack and shader analysis (Modrinth loaders `minecraft`, `iris`, `optifine`).
- `--upgrade-all` to also update mods that are already compatible; `--fail-on <status>` for CI.
- "Explain" mode per mod (full decision log), and a report diff between two analyses.
- UI translations; drag and drop of a whole instance folder (zipped in the browser).
- Export to other formats (packwiz, CurseForge manifest) for users of other launchers.

## Branches & PRs

At the user's request, every phase now has its own branch, named after its task and stacked on
the previous one, with its own draft PR whose base is the previous branch:

| Branch                        | Content              | PR                           |
| ----------------------------- | -------------------- | ---------------------------- |
| `feat/modpack-migration-cli`  | phases 1–8           | NeyorDEV/ModShift#2 → `main` |
| `feat/offline-cache`          | phase 9              | NeyorDEV/ModShift#3 → #2     |
| `feat/curseforge-api`         | phase 10             | NeyorDEV/ModShift#4 → #3     |
| `feat/config-and-security`    | phase 11             | NeyorDEV/ModShift#5 → #4     |
| `chore/release-readiness`     | phase 12             | NeyorDEV/ModShift#6 → #5     |
| `feat/loader-registry`        | phase 13             | NeyorDEV/ModShift#7 → #6     |
| `feat/interactive-mode`       | phase 14             | NeyorDEV/ModShift#8 → #7     |
| `feat/web-ui`                 | phase 15             | NeyorDEV/ModShift#9 → #8     |
| `docs/finishing-touches`      | phase 16             | NeyorDEV/ModShift#10 → #9    |
| `feat/cross-loader-migration` | phase 17             | NeyorDEV/ModShift#11 → #10   |
| `feat/client-server-sides`    | phase 18             | NeyorDEV/ModShift#12 → #11   |
| `perf/concurrent-requests`    | phase 19             | NeyorDEV/ModShift#13 → #12   |
| `feat/source-plugins`         | phase 20             | draft PR → #13               |
| next phases                   | one branch per phase | one draft PR each            |

- PR NeyorDEV/ModShift#1 (old branch `claude/great-galileo-gi0422`) is closed and superseded by
  #2.
- Commits are authored as `NeyorDEV <180453958+NeyorDEV@users.noreply.github.com>` (repo-local git
  config, unsigned), with no Claude trailer. All earlier commits were rewritten once to that
  author, at the user's explicit request.
- Merge order: #2 into `main`, then retarget each next PR to `main` (GitHub does this
  automatically when the base branch is deleted after a merge) and merge it in turn.

## Manual actions for the maintainer

- **Delete the remote branch `claude/great-galileo-gi0422`** (GitHub → Branches). The session's git
  proxy refuses to delete it, and its PR #1 is already closed.
- Run ModShift once against the real Modrinth API (blocked from the cloud environment).
- **npm publish (when ready):**
  1. check that the `modshift` name is still free (`npm view modshift`);
  2. merge the PRs;
  3. move `CHANGELOG.md` `Unreleased` to a version and bump `package.json` + `src/version.ts`;
  4. push the `vX.Y.Z` tag (the release workflow creates the GitHub release);
  5. run `npm publish` from a clean checkout of the tag.
- Optional: try CurseForge resolution with a real key (`CURSEFORGE_API_KEY=… modshift analyze
export.zip …`), which could not be done from here.

## Next steps

Phases 1–20 are done. Then 21 and 22, in order, one branch and one draft PR per phase (base = the
previous phase's branch). At the end, take every PR out of draft with a summary.

- **Phase 21, GitHub Action "ModShift Check"** (branch `feat/github-action`):
  - `action/action.yml`, a **composite** action (simplest: no bundled JS, no new dependency):
    `actions/setup-node`, install ModShift (from the action's own checkout:
    `npm ci && npm run build` in `${{ github.action_path }}/..`, since nothing is published on
    npm), run `analyze --format markdown` (and optionally `--format json` for a summary/exit
    code) on the pack path given as input;
  - inputs: `pack`, `mc`, `loader`, `side`, `config`, `fail-on` (e.g. `not-found`), `comment`
    (`true` / `false`), `token` (default `${{ github.token }}`), `curseforge-api-key` (optional,
    passed as env var only);
  - outputs: report path, counts per status;
  - write the report to `$GITHUB_STEP_SUMMARY`; PR comment via `gh api` with the token
    (update one comment identified by a hidden marker instead of posting a new one each run);
    permissions needed: `pull-requests: write` (document it);
  - a workflow example in the README (`on: pull_request`, `paths: ['**/*.mrpack', ...]`), and a
    test workflow in `.github/workflows/` that runs the action on a fixture pack **without**
    network? Not possible: analyze needs Modrinth. Options: run with `--offline` and a cache
    prepared from fixtures, or only lint `action.yml` (actionlint is not installed; keep a small
    Node test that parses the YAML structure). Decide the simplest and note it;
  - **do not publish on the Marketplace** (manual action).
- **Phase 22:** VitePress docs site in `docs/` and a GitHub Pages deploy workflow (Pages **not**
  enabled: manual action). Careful: `docs/` already holds `mrpack-format.md`,
  `curseforge-api.md`, `loaders.md`, `cli.md` and `images/`; reuse them as pages.

Pitfalls:

- `test/fixtures/modrinth/catalog.json` was generated by a throw-away script (not committed). Edit
  the JSON directly; keep IDs and hashes fake and hashes as hex of the right length (40 / 128), or
  the `.mrpack` validator rejects them.
- npm 10 crashes when resolving new dev dependencies from scratch (`edgesOut`). Use
  `npx -y npm@11 install -D <pkg>`; `npm ci` with npm 10 then works.
- Prettier formats `docs/` and `PROGRESS.md`: run `npx prettier --write .` before committing.
- The test CLI IO (`test/helpers/cli.ts`) uses a fake clock. A client built with the real clock
  but a no-op `sleep` busy-waits on rate-limit pauses (a test once took 37 s).
- Not verified against the live Modrinth API (network blocked here): do a manual run.
- Search fixtures: the fake `/search` uses project-level `loaders` and `game_versions`, so a new
  project in `catalog.json` can change alternatives in other tests (snapshots). Check
  `npx vitest run -u` diffs before accepting them.
- In tests, `createIo({ prompter })` simulates a TTY; without `prompter`, `interactive` refuses.
  Commander calls `process.exit` on unknown options: in tests, call `runInteractive` directly to
  test those cases.

## Known issues

- The session's git proxy silently ignores deleting `claude/great-galileo-gi0422` (manual action
  above). Otherwise none blocking.
