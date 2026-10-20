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

## Remaining

- Phase 4: compatibility engine & dependency resolution.
- Phase 5: `analyze` command and reports.
