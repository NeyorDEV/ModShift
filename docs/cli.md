# Command-line reference

Generated from `modshift <command> --help` (ModShift 0.1.0). Regenerate with
`npm run build && npm run docs:cli`. Explanations and examples are in the README.

## `modshift`

```text
Usage: modshift [options] [command]

Migrate a Minecraft modpack to another Minecraft version and/or mod loader.

Options:
  -V, --version                   output the version number
  -i, --interactive               start the guided interactive mode (same as
                                  "modshift interactive")
  -h, --help                      display help for command

Commands:
  analyze [options] <pack>        Check, mod by mod, whether a modpack can move
                                  to a target version/loader
  migrate [options] <pack>        Build a new .mrpack for the target, with a
                                  MIGRATION_REPORT.md next to it
  interactive|i [options] [pack]  Guided migration: choose the target, review
                                  each mod, save your choices
  ui [options]                    Start the local web interface
                                  (http://127.0.0.1 only)
  cache                           Inspect or clear the local API cache
```

## `modshift analyze`

```text
Usage: modshift analyze [options] <pack>

Check, mod by mod, whether a modpack can move to a target version/loader

Arguments:
  pack                    .mrpack file, CurseForge export .zip, or folder of
                          .jar files

Options:
  --mc <version>          target Minecraft version, e.g. 1.21.1 (or "target" in
                          the config)
  --loader <loader>       target mod loader: forge, neoforge, fabric, quilt,
                          liteloader, modloader, rift, babric, bta-babric,
                          legacy-fabric, ornithe, bukkit, spigot, paper, purpur,
                          sponge, bungeecord, waterfall, velocity (or "target"
                          in the config)
  --side <side>           installation the pack is for: client, server or both
                          (or "target.side" in the config)
  --config <file>         configuration file (default: ./modshift.config.json if
                          present)
  --no-config             ignore modshift.config.json
  --offline               use only cached API responses (no network) (default:
                          false)
  --no-cache              do not read or write the local API cache
  --cache-dir <dir>       cache directory (default: ~/.cache/modshift)
  --cache-ttl <duration>  how long cached responses stay valid, e.g. 30m, 12h,
                          7d, 0 (default: $MODSHIFT_CACHE_TTL or 24h)
  --max-alternatives <n>  alternatives suggested per missing mod (0 to disable)
                          (default: "3")
  --concurrency <n>       Modrinth requests sent at the same time, 1-16 (rate
                          limit still applies) (default: "4")
  -v, --verbose           log every API request, cache hit and retry on stderr
                          (default: false)
  -q, --quiet             no progress messages on stderr (default: false)
  -f, --format <format>   report format: table, json or markdown (default:
                          "table")
  -o, --output <file>     write the report to a file instead of stdout
  --no-color              disable colors in the table report
  -h, --help              display help for command
```

## `modshift migrate`

```text
Usage: modshift migrate [options] <pack>

Build a new .mrpack for the target, with a MIGRATION_REPORT.md next to it

Arguments:
  pack                        .mrpack file, CurseForge export .zip, or folder of
                              .jar files

Options:
  --mc <version>              target Minecraft version, e.g. 1.21.1 (or "target"
                              in the config)
  --loader <loader>           target mod loader: forge, neoforge, fabric, quilt,
                              liteloader, modloader, rift, babric, bta-babric,
                              legacy-fabric, ornithe, bukkit, spigot, paper,
                              purpur, sponge, bungeecord, waterfall, velocity
                              (or "target" in the config)
  --side <side>               installation the pack is for: client, server or
                              both (or "target.side" in the config)
  --config <file>             configuration file (default:
                              ./modshift.config.json if present)
  --no-config                 ignore modshift.config.json
  --offline                   use only cached API responses (no network)
                              (default: false)
  --no-cache                  do not read or write the local API cache
  --cache-dir <dir>           cache directory (default: ~/.cache/modshift)
  --cache-ttl <duration>      how long cached responses stay valid, e.g. 30m,
                              12h, 7d, 0 (default: $MODSHIFT_CACHE_TTL or 24h)
  --max-alternatives <n>      alternatives suggested per missing mod (0 to
                              disable) (default: "3")
  --concurrency <n>           Modrinth requests sent at the same time, 1-16
                              (rate limit still applies) (default: "4")
  -v, --verbose               log every API request, cache hit and retry on
                              stderr (default: false)
  -q, --quiet                 no progress messages on stderr (default: false)
  --out <file>                output .mrpack file
  --loader-version <version>  target loader version (required unless the source
                              pack uses the same loader and Minecraft version)
  --include-alternatives      include the best alternative for mods without a
                              compatible version (suggestions, to verify)
                              (default: false)
  --dry-run                   show what would be done without writing any file
                              (default: false)
  --force                     overwrite the output file if it exists (default:
                              false)
  -h, --help                  display help for command
```

## `modshift interactive`

```text
Usage: modshift interactive|i [options] [pack]

Guided migration: choose the target, review each mod, save your choices

Arguments:
  pack                    .mrpack file, CurseForge export .zip, or folder of
                          .jar files

Options:
  --config <file>         where choices are saved (default:
                          ./modshift.config.json)
  --offline               use only cached API responses (no network) (default:
                          false)
  --no-cache              do not read or write the local API cache
  --cache-dir <dir>       cache directory (default: ~/.cache/modshift)
  --cache-ttl <duration>  how long cached responses stay valid, e.g. 30m, 12h,
                          7d, 0 (default: $MODSHIFT_CACHE_TTL or 24h)
  --max-alternatives <n>  alternatives suggested per missing mod (0 to disable)
                          (default: "3")
  --concurrency <n>       Modrinth requests sent at the same time, 1-16 (rate
                          limit still applies) (default: "4")
  -v, --verbose           log every API request, cache hit and retry on stderr
                          (default: false)
  -h, --help              display help for command
```

## `modshift ui`

```text
Usage: modshift ui [options]

Start the local web interface (http://127.0.0.1 only)

Options:
  --port <port>           port to listen on (default: any free port)
  --no-open               do not open the browser
  --offline               use only cached API responses (no network) (default:
                          false)
  --no-cache              do not read or write the local API cache
  --cache-dir <dir>       cache directory (default: ~/.cache/modshift)
  --cache-ttl <duration>  how long cached responses stay valid, e.g. 30m, 12h,
                          7d, 0 (default: $MODSHIFT_CACHE_TTL or 24h)
  --max-alternatives <n>  alternatives suggested per missing mod (0 to disable)
                          (default: "3")
  --concurrency <n>       Modrinth requests sent at the same time, 1-16 (rate
                          limit still applies) (default: "4")
  -v, --verbose           log every API request, cache hit and retry on stderr
                          (default: false)
  -h, --help              display help for command
```

## `modshift cache stats`

```text
Usage: modshift cache stats [options]

Show the number, size and age of cached API responses

Options:
  --cache-dir <dir>       cache directory (default: ~/.cache/modshift)
  --cache-ttl <duration>  lifetime used to count expired entries (default: 24h)
  --json                  print the statistics as JSON (default: false)
  -h, --help              display help for command
```

## `modshift cache clear`

```text
Usage: modshift cache clear [options]

Delete cached API responses (all of them, or only expired ones)

Options:
  --cache-dir <dir>       cache directory (default: ~/.cache/modshift)
  --expired               only delete expired or unreadable entries (default:
                          false)
  --cache-ttl <duration>  lifetime used with --expired (default: 24h)
  -h, --help              display help for command
```
