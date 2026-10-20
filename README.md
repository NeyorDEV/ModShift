# ModShift

> Migrate a Minecraft modpack to another Minecraft version and/or mod loader.

[![CI](https://github.com/NeyorDEV/ModShift/actions/workflows/ci.yml/badge.svg)](https://github.com/NeyorDEV/ModShift/actions/workflows/ci.yml)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

Moving a modpack from, say, **1.20.1 Forge** to **1.21.1 NeoForge** usually means checking every
mod by hand: is there a version for the new target? If not, what replaces it? Which dependencies
are now missing? **ModShift automates that.** It reads your pack, identifies each mod on
[Modrinth](https://modrinth.com), finds a compatible version, suggests alternatives, resolves
dependencies and can write a migrated `.mrpack`.

> ModShift does **not** convert mod code. It looks for versions or equivalents of your mods for
> the target. A mod with no port stays a mod with no port.

## Contents

- [Features](#features) · [Installation](#installation) · [Quick start](#quick-start)
- [Commands](#commands) · [Options](#options) · [Configuration file](#configuration-file)
- [CurseForge packs](#curseforge-packs) · [Cache and offline mode](#cache-and-offline-mode)
- [Example output](#example-output) · [How it works](#how-it-works) · [FAQ](#faq)
- [Limitations](#limitations) · [Programmatic API](#programmatic-api)
- [Contributing](#contributing) · [Security](#security) · [License](#license)

## Features

- **Inputs:** Modrinth `.mrpack`, CurseForge export `.zip` (`manifest.json`), or a folder of
  `.jar` files (an instance folder with a `mods/` subfolder works too).
- **Identification:** by SHA-1/SHA-512 hash on Modrinth (exact). As a fallback, the jar's mod id
  (`fabric.mod.json`, `quilt.mod.json`, `mods.toml`, `neoforge.mods.toml`) is tried as a Modrinth
  slug, reported as _unverified_.
- **Status for every mod:**
  - `compatible`: your current file already supports the target;
  - `update found`: another version of the same project does;
  - `alternative suggested`: no version, but similar mods exist. These are **suggestions, to
    verify**;
  - `not found`: nothing usable, with the reason.
- **Dependencies:** missing required dependencies are added. Missing dependencies,
  incompatibilities, pinned versions and duplicates are explained.
- **Migration:** `modshift migrate` writes a new `.mrpack` that follows Modrinth's own validation
  rules, plus a `MIGRATION_REPORT.md` listing what was excluded and why.
- **Reports:** console table, JSON or Markdown.
- **Offline-friendly:** a local cache of API responses, `--offline`, and `modshift cache` commands.
- **Configurable:** an optional `modshift.config.json` with a default target, an ignore list and
  manual mappings.
- **Polite to Modrinth:** explicit User-Agent, client-side rate limiting, retries with backoff.

## Installation

ModShift needs **Node.js 20.17+ or 22.13+**.

```bash
# From npm (once published)
npm install --global modshift

# From source
git clone https://github.com/NeyorDEV/ModShift.git
cd ModShift
npm ci
npm run build
npm link        # makes the `modshift` command available
```

## Quick start

```bash
# 1. What would break when moving to 1.21.1 NeoForge?
modshift analyze my-pack.mrpack --mc 1.21.1 --loader neoforge

# 2. Preview the migration without writing anything
modshift migrate my-pack.mrpack --mc 1.21.1 --loader neoforge --loader-version 21.1.77 \
  --out my-pack-1.21.1.mrpack --dry-run

# 3. Write the migrated pack and MIGRATION_REPORT.md
modshift migrate my-pack.mrpack --mc 1.21.1 --loader neoforge --loader-version 21.1.77 \
  --out my-pack-1.21.1.mrpack
```

## Commands

| Command                                         | What it does                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `modshift analyze <pack> --mc <v> --loader <l>` | Reports, mod by mod, what is available for the target.              |
| `modshift migrate <pack> … --out <file>`        | Writes a migrated `.mrpack` and a `MIGRATION_REPORT.md` next to it. |
| `modshift interactive [pack]` (or `-i`)         | Guided mode: review each mod, save your choices, build the pack.    |
| `modshift cache stats [--json]`                 | Shows the size and age of the local cache.                          |
| `modshift cache clear [--expired]`              | Deletes cached API responses (all, or only expired ones).           |

`<pack>` is a `.mrpack`, a CurseForge export `.zip`, or a folder of `.jar` files. The format is
detected from the archive's content, not its extension.

## Interactive mode

```bash
modshift interactive my-pack.mrpack     # or simply: modshift -i
```

The assistant asks for the target Minecraft version and loader, shows the report, then lets you
decide, mod by mod (by default only the ones that need attention):

- **accept** the update (or keep the compatible version);
- **use one of the alternatives** (each still marked "suggestion, to verify");
- **exclude** the mod from migrated packs (it stays in reports);
- **ignore** it (no longer analysed).

Your choices are saved in `modshift.config.json` (as `mappings`, `exclude` and `ignore`, next to
the target), so they can be replayed by the non-interactive commands, for example in CI:

```bash
modshift migrate my-pack.mrpack --out my-pack-1.21.1.mrpack   # uses modshift.config.json
```

The interactive mode needs a terminal. In scripts it refuses to start; use `analyze` and `migrate`
instead. Press Ctrl+C at any time to quit without saving (exit code 130).

## Options

### Common to `analyze` and `migrate`

| Option                   | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--mc <version>`         | Target Minecraft version (e.g. `1.21.1`). Required unless set in the config.                                         |
| `--loader <loader>`      | Target loader, e.g. `neoforge`, `fabric`, `paper` ([full list](docs/loaders.md)). Required unless set in the config. |
| `--config <file>`        | Configuration file (default: `./modshift.config.json` if it exists).                                                 |
| `--no-config`            | Ignore `modshift.config.json`.                                                                                       |
| `--offline`              | Only use cached API responses; never touch the network.                                                              |
| `--no-cache`             | Do not read or write the cache.                                                                                      |
| `--cache-dir <dir>`      | Cache directory (default below).                                                                                     |
| `--cache-ttl <duration>` | How long cached responses stay valid: `30m`, `12h`, `7d`, `0` (default `24h`).                                       |
| `--max-alternatives <n>` | Alternatives suggested per missing mod, `0`–`20` (default `3`).                                                      |
| `-q, --quiet`            | No progress output on stderr.                                                                                        |
| `-v, --verbose`          | Log every API request, cache hit and retry on stderr.                                                                |

### `analyze`

| Option                  | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `-f, --format <format>` | `table` (default), `json` or `markdown` (`md`).           |
| `-o, --output <file>`   | Write the report to a file instead of stdout.             |
| `--no-color`            | Plain table without colors (`NO_COLOR` is also honoured). |

### `migrate`

| Option                       | Description                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--out <file.mrpack>`        | Output pack (required). `MIGRATION_REPORT.md` is written in the same folder.                                                   |
| `--loader-version <version>` | Target loader version written into the pack. Needed unless the source pack already uses the same loader and Minecraft version. |
| `--include-alternatives`     | Include the best alternative for each mod without a version. It stays flagged as a suggestion in the report.                   |
| `--dry-run`                  | Show what would be done; write nothing.                                                                                        |
| `--force`                    | Overwrite `--out` if it exists.                                                                                                |

### Environment variables

| Variable             | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `MODSHIFT_CACHE_DIR` | Cache directory (else `$XDG_CACHE_HOME/modshift`, else `~/.cache/modshift`). |
| `MODSHIFT_CACHE_TTL` | Default for `--cache-ttl`.                                                   |
| `CURSEFORGE_API_KEY` | Enables CurseForge resolution (see below). Never stored by ModShift.         |
| `NO_COLOR`           | Disables colors.                                                             |

### Exit codes

`0` when the command completes, whatever the mod statuses; `1` on errors (invalid options or pack,
network failure, offline cache miss…). Every error comes with a `hint:` line that says what to do.

## Configuration file

`modshift.config.json` (optional; JSON Schema in
[`schemas/modshift.config.schema.json`](schemas/modshift.config.schema.json)):

```json
{
  "$schema": "./schemas/modshift.config.schema.json",
  "target": { "minecraftVersion": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.77" },
  "ignore": ["optifine*.jar"],
  "exclude": ["old-minimap"],
  "mappings": { "rubidium": "embeddium", "my-local-mod.jar": "sodium" }
}
```

- `target`: defaults for `--mc`, `--loader` and `--loader-version`. Command-line options win.
- `ignore`: mods left out entirely. Entries are file names (`*` wildcard), Modrinth slugs or
  project ids.
- `exclude`: mods that are analysed and reported, but left out of migrated packs (with the
  dependencies only they needed).
- `mappings`: "this mod → that Modrinth project". A mapping is your explicit choice, so it is
  reported as a replacement, not a suggestion. It also works for files Modrinth does not know.

Unknown keys are rejected, so a typo cannot silently do nothing.

## CurseForge packs

A CurseForge export only lists project/file IDs. To identify them, ModShift needs the CurseForge
API, which requires a key:

```bash
export CURSEFORGE_API_KEY="…"   # from https://console.curseforge.com
modshift analyze my-export.zip --mc 1.21.1 --loader neoforge
```

ModShift fetches each file's name and SHA-1, then finds **the same jar on Modrinth** by hash. The
CurseForge slug is an unverified fallback. Nothing is downloaded from CurseForge. Without a key,
these mods are reported as not identified, with instructions; jars inside the export's
`overrides/` folder are analysed either way. Details in
[`docs/curseforge-api.md`](docs/curseforge-api.md).

## Cache and offline mode

API responses are cached as JSON files (24 h by default):

```bash
modshift analyze pack.mrpack --mc 1.21.1 --loader fabric            # fills the cache
modshift analyze pack.mrpack --mc 1.21.1 --loader fabric --offline  # no network at all
modshift cache stats
modshift cache clear --expired
```

In `--offline` mode, any cached entry is used whatever its age. A missing entry names the request
(for example "the hash lookup of 42 file(s)"). Uncached alternative searches are skipped with a
warning instead of failing the whole run.

## Example output

The output below is **real ModShift output on the test fixtures** (`test/fixtures/packs/mrpack-forge`,
fake data served by the test suite's mock API). It was not produced against the live Modrinth API.

`modshift analyze my-pack.mrpack --mc 1.21.1 --loader neoforge`:

```text
ModShift — Fixture Forge Pack  1.20.1 forge → 1.21.1 neoforge

Status                   Mod                Current    Target  Notes
───────────────────────  ─────────────────  ─────────  ──────  ──────────────────────────────────────────
↑ update found           Just Enough Items  15.2.0.27  19.8.0
↑ update found           Create             0.5.1.f    6.0.0
? alternative suggested  Rubidium           0.7.1      —       Suggestions (to verify): Sodium, Embeddium

Dependencies added:
  + Flywheel 1.0.0 (required by Create)

Summary: 0 compatible, 2 update found, 1 alternative suggested, 0 not found
Alternatives are suggestions, to verify before use.
1 non-mod file(s) (resource packs, configs…) were not analysed.
```

`modshift migrate my-pack.mrpack --mc 1.21.1 --loader neoforge --loader-version 21.1.77 --out my-pack-1.21.1.mrpack`:

```text
Migrated pack written to my-pack-1.21.1.mrpack
Report written to MIGRATION_REPORT.md

Target: Minecraft 1.21.1, neoforge 21.1.77 (from --loader-version)
Pack: 3 mod(s), 0 other file(s), 1 override file(s)

Included:
  ↑ Just Enough Items 15.2.0.27 → 19.8.0
  ↑ Create 0.5.1.f → 6.0.0
  + Flywheel 1.0.0 (dependency of Create)

Excluded:
  - Rubidium: No version for Minecraft 1.21.1 / neoforge. Alternatives are suggestions, to verify. Suggestions (to verify): Sodium, Embeddium
```

When something goes wrong, the error says what to do:

```text
error: Network error while calling https://api.modrinth.com/v2/version_files (fetch failed)
hint: Check your internet connection, proxy or firewall (api.modrinth.com must be reachable). To reuse results from a previous run, add --offline.
```

## How it works

1. **Read** the pack: the `.mrpack` index (hashes) and override jars, or the CurseForge manifest
   and override jars, or a folder of jars (hashed locally, metadata read from the jar).
2. **Identify** files on Modrinth by hash (`POST /v2/version_files`), with the mod-id fallback.
3. **Look up** each project's versions for the target loader and Minecraft version
   (`GET /v2/project/{id}/version`). Preference order: native loader, then release > beta > alpha,
   then newest.
4. **Suggest** alternatives for mods without a version: a Modrinth search by similar name, then by
   the same categories, both filtered on the target.
5. **Resolve** required dependencies recursively, and detect conflicts.
6. **Migrate** (optional): build and validate the new `.mrpack`, and copy overrides.

### Loaders

Targets can be mod loaders (`forge`, `neoforge`, `fabric`, `quilt`, plus older ones such as
`legacy-fabric` or `rift`), server plugin platforms (`bukkit`, `spigot`, `paper`, `purpur`,
`sponge`) or proxies (`bungeecord`, `waterfall`, `velocity`). `migrate` only targets the four loaders
the `.mrpack` format supports; `analyze` works for all of them, for example on a server's `plugins/`
folder.

When a mod has no version for the target loader, ModShift also accepts a version for a loader the
target is **officially documented** to run: Quilt ← Fabric, Paper ← Spigot/Bukkit,
Purpur ← Paper/Spigot/Bukkit, Waterfall ← BungeeCord. These are reported as
**"fallback compatibility, to test"**. Forge and NeoForge stay separate. Sources and the rules
deliberately left out are listed in [`docs/loaders.md`](docs/loaders.md).

## FAQ

**Is the migrated pack guaranteed to work?**
No. ModShift only uses the metadata authors publish on Modrinth. Always test the pack, and back up
your worlds before opening them with a new version.

**Why does `migrate` ask for `--loader-version`?**
A `.mrpack` must name the exact loader version. ModShift reuses the source pack's version when the
loader and Minecraft version do not change. Otherwise, pick one on the loader's website, or set
`target.loaderVersion` in the config.

**Why are some mods "not found" although they exist?**
The file may come from another site (CurseForge, GitHub) or have been modified, so its hash is
unknown to Modrinth. Use `mappings` in the config to point it at the right project.

**Are suggested alternatives equivalent to the original mod?**
No. They are search results in the same category or with a similar name: check them before use.
`--include-alternatives` adds the best one to the pack, still flagged as a suggestion.

**Does ModShift support resource packs and shaders?**
They are kept unchanged in migrated `.mrpack` files but not checked yet.

**Does it work without internet?**
Yes, with `--offline`, once the cache has been filled by a previous run.

## Limitations

- ModShift finds versions and equivalents; it never converts or patches mod code.
- Only `mods/*.jar` are analysed; resource packs, shaders and configs are copied unchanged.
- CurseForge references need a `CURSEFORGE_API_KEY`.
- Alternatives and mod-id matches are heuristics: they can be wrong.
- Requests are sequential. Large packs take a while the first time; later runs use the cache.

## Programmatic API

```ts
import { analyzePack, loadPack, ModrinthClient, FileCache, defaultCacheDir } from 'modshift';

const pack = await loadPack('my-pack.mrpack');
const api = new ModrinthClient({ cache: new FileCache(defaultCacheDir()) });
const result = await analyzePack(pack, { minecraftVersion: '1.21.1', loader: 'neoforge' }, api);
console.log(result.summary);
```

Types are included. See [`src/index.ts`](src/index.ts) for everything that is exported.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup,
conventions (TypeScript strict, Conventional Commits, tests without network) and how to propose a
change. Development notes and design decisions live in [PROGRESS.md](PROGRESS.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability and how ModShift handles untrusted
packs (zip-slip and zip-bomb protection, jars never executed).

## License

[MIT](LICENSE) © ModShift contributors
