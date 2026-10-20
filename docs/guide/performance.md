<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Performance

ModShift sends up to `--concurrency` requests to Modrinth at the same time (4 by default, 1–16).
The client's rate limiter remains the only gate on the request rate, identical requests in flight
are sent once, and reports are identical whatever the concurrency.

Benchmark (`npm run bench`, method in [`bench/README.md`](/guide/performance#method)). It measures **local
processing only**, against an **in-memory fake Modrinth**: no real network, no real API, no rate
limit. The "simulated latency" rows add an artificial 20 ms delay per request to show what
concurrency changes when requests wait on I/O; they are not real network measurements.

Intel Xeon @ 2.80 GHz (4 threads), Node 22.22, Linux x64, median of 5 runs:

| Mods | Simulated latency | `--concurrency 1` | `--concurrency 4` | `--concurrency 8` | Requests |
| ---: | ----------------: | ----------------: | ----------------: | ----------------: | -------: |
|  200 |                 0 |             48 ms |             50 ms |             35 ms |      224 |
|  200 |             20 ms |             4.7 s |             1.3 s |             0.7 s |      224 |
|  500 |                 0 |             70 ms |             70 ms |             59 ms |      545 |
|  500 |             20 ms |            11.4 s |             3.1 s |             1.7 s |      545 |

What this means in practice:

- ModShift's own work is small (well under 0.1 s for 500 mods). Real runs are dominated by the
  network and by Modrinth.
- With an **empty cache**, Modrinth's limit of 300 requests per minute applies: the 545 requests
  of a 500-mod pack need at least about 50 s, whatever `--concurrency`. Concurrency helps below
  that limit and for smaller packs; later runs use the cache.

## Method

`npm run bench` builds ModShift, then runs `bench/run.mjs`. Options:
`node bench/run.mjs --sizes 200,500 --latency 0,20 --concurrency 1,4,8 --runs 5 [--json]`.

### What is measured

**ModShift's own processing only**, from a `.mrpack` file on disk to a migrated `.mrpack` in
memory: reading the pack (`loadPack`), the analysis (`analyzePack`), the migration plan and the
archive (`buildMigrationPlan`, `buildMrpackArchive`).

**Not measured:** the real network, the real Modrinth API, and Modrinth's rate limit (300
requests per minute). The Modrinth client talks to an in-memory fake (`fakeApi.mjs`), with its
rate limiter disabled.

### Method

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
