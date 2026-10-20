# Changelog

All notable changes to ModShift are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Security

- Bounded zip extraction (entry count, declared sizes) against zip bombs; zip-slip paths are
  rejected. See `SECURITY.md`.
