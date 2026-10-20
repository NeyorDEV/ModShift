<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Commands and options

| Command                                         | What it does                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `modshift analyze <pack> --mc <v> --loader <l>` | Reports, mod by mod, what is available for the target.              |
| `modshift migrate <pack> … --out <file>`        | Writes a migrated `.mrpack` and a `MIGRATION_REPORT.md` next to it. |
| `modshift interactive [pack]` (or `-i`)         | Guided mode: review each mod, save your choices, build the pack.    |
| `modshift ui [--port <n>] [--no-open]`          | Local web interface on `http://127.0.0.1` (drag and drop a pack).   |
| `modshift cache stats [--json]`                 | Shows the size and age of the local cache.                          |
| `modshift cache clear [--expired]`              | Deletes cached API responses (all, or only expired ones).           |

`<pack>` is a `.mrpack`, a CurseForge export `.zip`, or a folder of `.jar` files. The format is
detected from the archive's content, not its extension.

## Options

## Common to `analyze` and `migrate`

| Option                   | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--mc <version>`         | Target Minecraft version (e.g. `1.21.1`). Required unless set in the config.                                         |
| `--loader <loader>`      | Target loader, e.g. `neoforge`, `fabric`, `paper` ([full list](/loaders)). Required unless set in the config.        |
| `--side <side>`          | Installation the pack is for: `client`, `server` or `both` (default). See [Client and server](/guide/client-server). |
| `--config <file>`        | Configuration file (default: `./modshift.config.json` if it exists).                                                 |
| `--no-config`            | Ignore `modshift.config.json`.                                                                                       |
| `--offline`              | Only use cached API responses; never touch the network.                                                              |
| `--no-cache`             | Do not read or write the cache.                                                                                      |
| `--cache-dir <dir>`      | Cache directory (default below).                                                                                     |
| `--cache-ttl <duration>` | How long cached responses stay valid: `30m`, `12h`, `7d`, `0` (default `24h`).                                       |
| `--max-alternatives <n>` | Alternatives suggested per missing mod, `0`–`20` (default `3`).                                                      |
| `-q, --quiet`            | No progress output on stderr.                                                                                        |
| `-v, --verbose`          | Log every API request, cache hit and retry on stderr.                                                                |

## `analyze`

| Option                  | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `-f, --format <format>` | `table` (default), `json` or `markdown` (`md`).           |
| `-o, --output <file>`   | Write the report to a file instead of stdout.             |
| `--no-color`            | Plain table without colors (`NO_COLOR` is also honoured). |

## `migrate`

| Option                       | Description                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--out <file.mrpack>`        | Output pack (required). `MIGRATION_REPORT.md` is written in the same folder.                                                   |
| `--loader-version <version>` | Target loader version written into the pack. Needed unless the source pack already uses the same loader and Minecraft version. |
| `--include-alternatives`     | Include the best alternative for each mod without a version. It stays flagged as a suggestion in the report.                   |
| `--dry-run`                  | Show what would be done; write nothing.                                                                                        |
| `--force`                    | Overwrite `--out` if it exists.                                                                                                |

## Environment variables

| Variable             | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `MODSHIFT_CACHE_DIR` | Cache directory (else `$XDG_CACHE_HOME/modshift`, else `~/.cache/modshift`). |
| `MODSHIFT_CACHE_TTL` | Default for `--cache-ttl`.                                                   |
| `CURSEFORGE_API_KEY` | Enables CurseForge resolution (see below). Never stored by ModShift.         |
| `GITHUB_TOKEN`       | Optional token for the GitHub Releases source. Never stored by ModShift.     |
| `NO_COLOR`           | Disables colors.                                                             |

## Exit codes

`0` when the command completes, whatever the mod statuses; `1` on errors (invalid options or pack,
network failure, offline cache miss…). Every error comes with a `hint:` line that says what to do.
