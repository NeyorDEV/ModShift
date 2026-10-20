<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Getting started

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
