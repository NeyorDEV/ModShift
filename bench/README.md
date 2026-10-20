# Benchmarks

`npm run bench` builds ModShift, then runs `bench/run.mjs`. Options:
`node bench/run.mjs --sizes 200,500 --latency 0,20 --concurrency 1,4,8 --runs 5 [--json]`.

## What is measured

**ModShift's own processing only**, from a `.mrpack` file on disk to a migrated `.mrpack` in
memory: reading the pack (`loadPack`), the analysis (`analyzePack`), the migration plan and the
archive (`buildMigrationPlan`, `buildMrpackArchive`).

**Not measured:** the real network, the real Modrinth API, and Modrinth's rate limit (300
requests per minute). The Modrinth client talks to an in-memory fake (`fakeApi.mjs`), with its
rate limiter disabled.

## Method

- **Data** (`synthetic.mjs`): deterministic, fake hashes and IDs, Fabric 1.20.1 → 1.21.1. For each
  pack size: 65 % of mods have an update, 10 % are already compatible, 15 % have no target version
  (alternative searches are sent, the fake search returns no hit), 10 % are unknown to Modrinth.
  20 % require one of 20 shared libraries.
- **Fake API** (`fakeApi.mjs`): the Modrinth endpoints ModShift uses, answered from precomputed
  indexes so the fake does not weigh on the timings. `--latency` adds an artificial delay to each
  request, to show the effect of `--concurrency` when requests wait on I/O. **It is a simulation,
  not a measurement of real network latency.**
- **Timing**: one warm-up run, then the median of `--runs` runs, each with a fresh client and an
  empty in-memory cache.
