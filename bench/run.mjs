#!/usr/bin/env node
// Benchmark reproductible de ModShift sur des packs synthétiques de 200 et 500 mods, contre un
// faux Modrinth en mémoire. Mesure le traitement LOCAL (lecture du pack, analyse, plan et
// écriture du .mrpack) : ni le réseau réel ni la limite de débit de Modrinth ne sont mesurés.
//
// Usage : npm run bench  (ou : npm run build && node bench/run.mjs [--sizes 200,500]
//         [--latency 0,20] [--concurrency 1,4,8] [--runs 5] [--json])
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import {
  analyzePack,
  buildMigrationPlan,
  buildMrpackArchive,
  loadPack,
  MemoryCache,
  ModrinthClient,
} from '../dist/index.js';
import { RateLimiter } from '../dist/modrinth/rateLimiter.js';
import { createFakeFetch } from './fakeApi.mjs';
import { generate } from './synthetic.mjs';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const list = (value) => value.split(',').map(Number);
const sizes = list(option('sizes', '200,500'));
const latencies = list(option('latency', '0,20'));
const concurrencies = list(option('concurrency', '1,4,8'));
const runs = Number(option('runs', '5'));
const asJson = process.argv.includes('--json');

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function once(file, data, latencyMs, concurrency) {
  const fake = createFakeFetch(data.catalog, { latencyMs });
  const client = new ModrinthClient({
    fetch: fake.fetch,
    cache: new MemoryCache(),
    // Limite de débit désactivée : avec 300 requêtes/min, elle dominerait toute mesure
    // (voir « Requests » dans les résultats pour le temps minimal qu'elle imposerait).
    rateLimiter: new RateLimiter({ maxRequests: Number.MAX_SAFE_INTEGER }),
  });
  const start = performance.now();
  const pack = await loadPack(file);
  const loaded = performance.now();
  const analysis = await analyzePack(pack, data.target, client, { concurrency });
  const analysed = performance.now();
  const plan = buildMigrationPlan(pack, analysis, { loaderVersion: '0.16.5' });
  buildMrpackArchive(plan.index, {});
  const end = performance.now();
  return {
    totalMs: end - start,
    loadMs: loaded - start,
    analyseMs: analysed - loaded,
    migrateMs: end - analysed,
    requests: fake.stats.requests,
    peakInFlight: fake.stats.peakInFlight,
    summary: analysis.summary,
  };
}

const dir = await mkdtemp(join(os.tmpdir(), 'modshift-bench-'));
const results = [];
try {
  for (const size of sizes) {
    const data = generate(size);
    const file = join(dir, `bench-${size}.mrpack`);
    await writeFile(file, data.mrpack);
    for (const latencyMs of latencies) {
      for (const concurrency of concurrencies) {
        await once(file, data, latencyMs, concurrency); // échauffement (JIT), non compté
        const samples = [];
        for (let r = 0; r < runs; r++) samples.push(await once(file, data, latencyMs, concurrency));
        const last = samples[samples.length - 1];
        results.push({
          size,
          latencyMs,
          concurrency,
          medianMs: Math.round(median(samples.map((s) => s.totalMs))),
          loadMs: Math.round(median(samples.map((s) => s.loadMs))),
          analyseMs: Math.round(median(samples.map((s) => s.analyseMs))),
          migrateMs: Math.round(median(samples.map((s) => s.migrateMs))),
          requests: last.requests,
          peakInFlight: last.peakInFlight,
          // Temps minimal imposé par 300 requêtes/minute si le cache est vide.
          rateLimitFloorS: Math.round(Math.max(0, last.requests - 300) / 5),
          summary: last.summary,
        });
      }
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

const machine = `${os.cpus()[0]?.model ?? 'unknown CPU'} (${os.cpus().length} threads), Node ${process.version}, ${os.platform()} ${os.arch()}`;
if (asJson) {
  process.stdout.write(`${JSON.stringify({ machine, runs, results }, null, 2)}\n`);
} else {
  process.stdout.write(`Machine: ${machine}\nMedian of ${runs} runs (after one warm-up run).\n\n`);
  process.stdout.write(
    '| Mods | Simulated latency | Concurrency | Total (median) | Load | Analyse | Plan + .mrpack | Requests | Peak in flight |\n',
  );
  process.stdout.write('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n');
  for (const r of results) {
    process.stdout.write(
      `| ${r.size} | ${r.latencyMs} ms | ${r.concurrency} | ${r.medianMs} ms | ${r.loadMs} ms | ${r.analyseMs} ms | ${r.migrateMs} ms | ${r.requests} | ${r.peakInFlight} |\n`,
    );
  }
  const big = results.find((r) => r.size === Math.max(...sizes));
  if (big) {
    process.stdout.write(
      `\nWith Modrinth's 300 requests/minute and an empty cache, ${big.requests} requests take at least ~${big.rateLimitFloorS} s whatever the concurrency.\n`,
    );
  }
}
