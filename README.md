# ModShift

> Migrate a Minecraft modpack to another Minecraft version and/or mod loader.

ModShift is an open-source command-line tool (TypeScript, Node.js 20+) that takes a modpack —
for example **1.20.1 Forge** — and checks, mod by mod, whether it can be moved to a target such as
**1.21.1 NeoForge**. It uses the public [Modrinth API v2](https://docs.modrinth.com/api/) to find
compatible versions, suggest alternatives and resolve dependencies.

> **Status:** early development. The `analyze` command works; generating a migrated `.mrpack`
> (`migrate`) is the next step. See [PROGRESS.md](./PROGRESS.md).

## Features

- **Inputs:** Modrinth `.mrpack`, CurseForge export `.zip` (`manifest.json`), or a folder of `.jar`
  files (an instance folder with a `mods/` subfolder works too).
- **Identification** by SHA-1 / SHA-512 hash through Modrinth. For local jars unknown to Modrinth,
  ModShift reads `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml` or
  `META-INF/neoforge.mods.toml` and tries the mod id as a Modrinth slug (reported as unverified).
- **Per-mod status:**
  - `compatible`: the current file already supports the target;
  - `update found`: another version of the same project supports the target;
  - `alternative suggested`: no version for the target, but similar mods exist.
    These are **suggestions, to verify**;
  - `not found`: nothing usable was found (with the reason).
- **Dependencies:** missing required dependencies are added in a compatible version; unavailable
  ones and declared incompatibilities are reported.
- **Reports:** console table, JSON or Markdown.
- **Cache & offline:** API responses are cached locally (24 h); `--offline` works from the cache
  only.

## Installation

```bash
git clone https://github.com/NeyorDEV/ModShift.git
cd ModShift
npm ci
npm run build
npm link   # optional: makes the `modshift` command available
```

## Usage

```bash
modshift analyze <pack> --mc <version> --loader <forge|neoforge|fabric|quilt> [options]
```

Examples:

```bash
# 1.20.1 Forge pack → 1.21.1 NeoForge, table in the terminal
modshift analyze my-pack.mrpack --mc 1.21.1 --loader neoforge

# Markdown report written to a file
modshift analyze my-pack.mrpack --mc 1.21.1 --loader fabric --format markdown -o report.md

# JSON for scripts, from a folder of jars, without progress messages
modshift analyze ~/.minecraft/mods --mc 1.21.1 --loader fabric --format json --quiet

# Re-run without network, using previously cached API responses
modshift analyze my-pack.mrpack --mc 1.21.1 --loader fabric --offline
```

| Option                   | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `--mc <version>`         | Target Minecraft version (e.g. `1.21.1`). Required.                 |
| `--loader <loader>`      | Target loader: `forge`, `neoforge`, `fabric` or `quilt`. Required.  |
| `-f, --format <format>`  | `table` (default), `json` or `markdown` (`md`).                     |
| `-o, --output <file>`    | Write the report to a file instead of stdout.                       |
| `--offline`              | Use only cached API responses; never touch the network.             |
| `--no-cache`             | Do not read or write the cache.                                     |
| `--cache-dir <dir>`      | Cache directory (default below).                                    |
| `--max-alternatives <n>` | Alternatives suggested per missing mod, `0` to disable (default 3). |
| `-q, --quiet`            | No progress messages on stderr.                                     |
| `--no-color`             | Disable colors in the table report (`NO_COLOR` is also honoured).   |

The exit code is `0` when the analysis completes (whatever the statuses) and `1` on errors (invalid
input, network failure, offline cache miss).

### Cache

Responses are stored as JSON files in `$MODSHIFT_CACHE_DIR`, else `$XDG_CACHE_HOME/modshift`, else
`~/.cache/modshift`. Entries are reused for 24 hours online; in `--offline` mode they are used
regardless of age.

### Notes and limitations

- **CurseForge:** the CurseForge API needs an API key, so it is out of scope. ModShift reads the
  `manifest.json` format, but files referenced by CurseForge project/file IDs cannot be identified
  and are reported as `not found` with an explanation. Jars inside the export's `overrides/`
  folder are analysed normally.
- **Loaders:** Fabric versions are accepted for a Quilt target (Quilt loads Fabric mods). Forge
  and NeoForge are treated as distinct loaders.
- **Scope:** only `mods/*.jar` are analysed. Resource packs, shaders and configs are counted but not
  checked.
- **Alternatives** come from Modrinth search (similar name, then same category, filtered on the
  target). They are not equivalent replacements: always check them.

## Modrinth API usage

ModShift follows the [Modrinth API rules](https://docs.modrinth.com/api/):

- it sends a uniquely identifying `User-Agent`
  (`NeyorDEV/ModShift/<version> (https://github.com/NeyorDEV/ModShift)`);
- it stays under the documented rate limit (300 requests/minute) with a client-side limiter, and
  honours `X-Ratelimit-Remaining` / `X-Ratelimit-Reset` and `429` responses;
- it retries network errors and 5xx responses with exponential backoff;
- it uses bulk endpoints (`POST /version_files`, `GET /projects`, `GET /versions`) and caches
  responses.

No API key or token is needed or stored.

## Development

```bash
npm ci
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck
npm run build
npm test              # Vitest
```

Tests never hit the real network: the Modrinth client receives an injected mock `fetch`, an
in-memory fake Modrinth (`test/helpers/fakeModrinth.ts`) serves fixture data, and the global
`fetch` throws during tests. Fixtures in `test/fixtures/` are readable files (zipped at test time),
and all IDs and hashes in them are fake.

Project layout:

```
src/
  input/     pack readers (.mrpack, CurseForge zip, jar folder) and jar metadata
  modrinth/  API client, cache, rate limiter
  core/      compatibility engine, alternatives, dependency resolution
  report/    table / JSON / Markdown renderers
  commands/  CLI commands
  cli.ts     entry point
```

## License

MIT
