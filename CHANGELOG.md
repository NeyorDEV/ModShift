# Changelog

All notable changes to ModShift are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- An update that keeps the same version number (a file rebuilt for the target Minecraft
  version, e.g. `3.3.6 → 3.3.6`) is now explained in the report instead of looking like an error.
- Resource packs and shaders listed in a pack (e.g. Faithful 32x in a CurseForge export) were
  searched as mods for the target loader and reported as not found. They are now looked up
  under their own Modrinth loaders, installed in `resourcepacks/` or `shaderpacks/`, linked to
  their right Modrinth page, and never get mod alternatives.

## [0.1.0] - 2026-10-20

First public version.

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
- Concurrent Modrinth requests (`--concurrency <n>`, 1–16, default 4) within the client's rate
  limit, with identical parallel requests sent only once. Reports stay identical whatever the
  concurrency.
- Mod source plugins: a `ModSource` contract and a registry (Modrinth primary, CurseForge,
  GitHub Releases), a `sources` config key, a reusable contract test suite and
  `docs/plugins.md`. Files found on other sources are reported "to verify" and never added to
  migrated packs.
- "ModShift Check" GitHub Action in `action/` (job summary, one updated pull request comment,
  outputs per status, `fail-on`). Not published on the Marketplace.
- Documentation site (VitePress) in `docs/`, its guide pages generated from the README, and a
  GitHub Pages deployment workflow (Pages itself not enabled).
- `bench/`: reproducible benchmarks on synthetic 200 and 500 mod packs against an in-memory fake
  Modrinth (`npm run bench`).

### Security

- Bounded zip extraction (entry count, declared sizes) against zip bombs; zip-slip paths are
  rejected. See `SECURITY.md`.
- Web interface: loopback only, per-run token, Host header check, bounded uploads, temporary files
  only, strict Content Security Policy.

### Changed

- Node.js requirement: `^20.17.0 || >=22.13.0` (needed by the prompt library).

### Fixed

Found while testing against the real Modrinth API (Fabulously Optimized 1.21.1 → 26.3):

- `migrate` (and the config and web UI) now reject a loader version that is not a version, such
  as a `<version>` or `X.Y.Z` placeholder copied from an example (a version must contain a
  digit), instead of writing an invalid pack.
- Unrelated alternatives: a popular mod sharing only a broad category (e.g. Xaero's Minimap for
  CIT Resewn) is no longer suggested; a candidate needs a similar name or two shared keywords
  (one generic word such as "screen" is not enough).
- A dependency published only for another loader (e.g. KotlinLangForge, NeoForge only, declared
  by Zoomify's single Fabric + NeoForge file) is no longer reported as missing for the target;
  a warning explains why it was ignored.

[Unreleased]: https://github.com/NeyorDEV/ModShift/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NeyorDEV/ModShift/releases/tag/v0.1.0
