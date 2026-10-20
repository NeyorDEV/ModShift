import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMrpack } from '../../src/input/mrpack.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-side-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const target = ['--mc', '1.21.1', '--loader', 'fabric', '--no-cache', '-q'];

async function migrate(...extra: string[]) {
  const io = createIo({ cwd: dir });
  const out = join(dir, 'out.mrpack');
  await run(
    io,
    'migrate',
    packPath,
    ...target,
    '--loader-version',
    '0.16.5',
    '--out',
    out,
    ...extra,
  );
  return { io, out };
}

describe('--side', () => {
  it('server: leaves client-only mods and their own dependencies out of the pack', async () => {
    const { io, out } = await migrate('--side', 'server');
    expect(io.exitCode).toBeUndefined();
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'out.mrpack');
    // Sodium et Mod Menu sont client-only ; Cloth Config n'était requis que par Sodium.
    expect(migrated.mods.map((m) => m.path)).toEqual(['mods/v2fapi.jar']);
    const report = await readFile(join(dir, 'MIGRATION_REPORT.md'), 'utf8');
    expect(report).toContain(
      'Not needed on a dedicated server (--side server): client-only according to Modrinth.',
    );
    expect(report).toContain('Cloth Config API: not added, only required by excluded mods');
  });

  it('client: keeps every mod and flags those with an unknown side', async () => {
    const { out } = await migrate('--side', 'client');
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'out.mrpack');
    expect(migrated.mods).toHaveLength(4);
    const report = await readFile(join(dir, 'MIGRATION_REPORT.md'), 'utf8');
    expect(report).toContain(
      'Cloth Config API: client/server side unknown on Modrinth, kept; check whether a client needs it.',
    );
  });

  it('fills .mrpack env from Modrinth for added dependencies whose side is known', async () => {
    const { out } = await migrate();
    const index = JSON.parse(
      new TextDecoder().decode(
        (await import('fflate')).unzipSync(new Uint8Array(await readFile(out)))[
          'modrinth.index.json'
        ],
      ),
    ) as { files: { path: string; env?: unknown }[] };
    // Cloth Config : côté inconnu, donc pas d'env inventé.
    expect(index.files.find((f) => f.path === 'mods/v2cloth.jar')?.env).toBeUndefined();
  });

  it('reports sides in analyze and reads target.side from the config', async () => {
    await writeFile(
      join(dir, 'modshift.config.json'),
      JSON.stringify({ target: { side: 'server' } }),
    );
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', packPath, ...target, '--format', 'markdown');
    expect(io.out).toContain('Target installation: **server**');
    expect(io.out).toContain('- **Client-only:** Sodium, Mod Menu');
    expect(io.out).toContain('left out of migrated packs: Sodium, Mod Menu.');
  });

  it('rejects an invalid side', async () => {
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', packPath, ...target, '--side', 'dedicated');
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain('Invalid --side "dedicated" (expected one of: client, server, both)');
  });
});
