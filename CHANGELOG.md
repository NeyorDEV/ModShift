# Changelog

All notable changes to ModShift are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Cross-loader migration (e.g. Forge → Fabric): multi-loader mods keep the same Modrinth project
  and the switch is reported explicitly.
- Alternatives are ranked by relevance (shared categories, similar name, description keywords,
  popularity), with a score and an explanation for each suggestion in every report.
- Compatibility layer hints (Sinytra Connector, Kilt), limited to the combinations their authors
  document and marked "experimental, not guaranteed". They are never added to the migrated pack.
- Client/server detection from Modrinth metadata (`environment`, else `client_side` /
  `server_side`), `--side client|server|both` and `target.side` in the config. Client-only or
  server-only mods are listed, ambiguous ones flagged, and `.mrpack` `env` filled from Modrinth
  when the source pack has none.

## [0.1.0]

First public version (not yet published to npm).

### Added

- `modshift analyze`: per-mod compatibility report (compatible, update found, alternative
  suggested, not found) as a console table, JSON or Markdown.
- `modshift migrate`: a new `.mrpack` that follows Modrinth's own validator rules, plus a
  `MIGRATION_REPORT.md` listing excluded mods and suggested alternatives. Options
  `--include-alternatives`, `--dry-run`, `--loader-version`, `--force`.
- Inputs: Modrinth `.mrpack`, CurseForge export `.zip`, folder of `.jar` files. Jar metadata from
  Fabric, Quilt, Forge and NeoForge.
- Modrinth API client with an explicit User-Agent, rate limiting (300 requests/minute,
  `X-Ratelimit-*`, `429`), retries with backoff and a local cache.
- Dependency resolution: missing required dependencies are added. Missing dependencies,
  incompatibilities, pinned versions and duplicates are reported with explanations.
- Offline mode (`--offline`), `--cache-ttl` / `MODSHIFT_CACHE_TTL`, `modshift cache stats` and
  `modshift cache clear`.
- CurseForge support: manifest references resolved through the CurseForge API when
  `CURSEFORGE_API_KEY` is set (metadata only, nothing downloaded from CurseForge).
- Optional `modshift.config.json`: default target, ignore list, manual mappings (JSON Schema in
  `schemas/`).
- Actionable error messages, a progress bar and `--verbose` logs.
- Programmatic API (`import { analyzePack } from 'modshift'`) with TypeScript types.
- Loader registry: older mod loaders (LiteLoader, Rift, Legacy Fabric, Ornithe…), server plugin
  platforms (Bukkit, Spigot, Paper, Purpur, Sponge) and proxies (BungeeCord, Waterfall, Velocity),
  with plugin metadata (`plugin.yml`, `paper-plugin.yml`, `bungee.yml`, `velocity-plugin.json`).
- Fallback compatibility, documented by each loader (Quilt ← Fabric, Paper ← Spigot/Bukkit,
  Purpur ← Paper/Spigot/Bukkit, Waterfall ← BungeeCord), reported as "fallback compatibility, to
  test".
- `modshift interactive` (`-i`): guided migration with per-mod decisions saved to
  `modshift.config.json`; new `exclude` list.
- `modshift ui`: local web interface on 127.0.0.1 (drag and drop, sortable and filterable results,
  per-mod details, downloads, light/dark theme).
- `docs/cli.md`: command reference generated from the CLI help.

### Security

- Bounded zip extraction (entry count, declared sizes) against zip bombs; zip-slip paths are
  rejected. See `SECURITY.md`.
- Web interface: loopback only, per-run token, Host header check, bounded uploads, temporary files
  only, strict Content Security Policy.

### Changed

- Node.js requirement: `^20.17.0 || >=22.13.0` (needed by the prompt library).
