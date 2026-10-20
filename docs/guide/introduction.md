<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Introduction

> Migrate a Minecraft modpack to another Minecraft version and/or mod loader.

Moving a modpack from, say, **1.20.1 Forge** to **1.21.1 NeoForge** usually means checking every
mod by hand: is there a version for the new target? If not, what replaces it? Which dependencies
are now missing? **ModShift automates that.** It reads your pack, identifies each mod on
[Modrinth](https://modrinth.com), finds a compatible version, suggests alternatives, resolves
dependencies and can write a migrated `.mrpack`. Use it from the command line, through a guided
interactive mode, or in a small local web page.

![ModShift web interface: a Forge 1.20.1 pack analysed for NeoForge 1.21.1](../images/ui-light.png)

_Screenshot of the test suite's fixture pack (fake data), analysed in `modshift ui`._

> ModShift does **not** convert mod code. It looks for versions or equivalents of your mods for
> the target. A mod with no port stays a mod with no port.

## Features

- **Inputs:** Modrinth `.mrpack`, CurseForge export `.zip` (`manifest.json`), or a folder of
  `.jar` files (an instance folder with `mods/`, or a server folder with `plugins/`).
- **Loaders:** Forge, NeoForge, Fabric, Quilt and older mod loaders; Bukkit, Spigot, Paper, Purpur
  and Sponge server plugins; BungeeCord, Waterfall and Velocity proxies. Documented cross-loader
  compatibility (e.g. Fabric mods on Quilt) is reported as "fallback compatibility, to test".
- **Identification:** by SHA-1/SHA-512 hash on Modrinth (exact). As a fallback, the jar's mod id
  (`fabric.mod.json`, `quilt.mod.json`, `mods.toml`, `neoforge.mods.toml`) is tried as a Modrinth
  slug, reported as _unverified_.
- **Status for every mod:**
  - `compatible`: your current file already supports the target;
  - `update found`: another version of the same project does;
  - `alternative suggested`: no version, but similar mods exist. These are **suggestions, to
    verify**;
  - `not found`: nothing usable, with the reason.
- **Changing loader** (e.g. Forge → Fabric): multi-loader mods keep the same project; other mods
  get alternatives ranked by relevance, each with an explanation. Mods a compatibility layer could
  load are flagged as **experimental, not guaranteed**, never added automatically.
- **Dependencies:** missing required dependencies are added. Missing dependencies,
  incompatibilities, pinned versions and duplicates are explained.
- **Migration:** `modshift migrate` writes a new `.mrpack` that follows Modrinth's own validation
  rules, plus a `MIGRATION_REPORT.md` listing what was excluded and why.
- **Reports:** console table, JSON or Markdown.
- **Offline-friendly:** a local cache of API responses, `--offline`, and `modshift cache` commands.
- **Configurable:** an optional `modshift.config.json` with a default target, ignore and exclude
  lists and manual mappings, written for you by the interactive mode.
- **Three ways to use it:** CLI commands for scripts and CI, `modshift interactive` to decide mod
  by mod, and `modshift ui` for a local web page (127.0.0.1 only).
- **Polite to Modrinth:** explicit User-Agent, client-side rate limiting, retries with backoff.
