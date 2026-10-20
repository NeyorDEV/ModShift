import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CurseForgeClient } from '../../src/curseforge/client.js';
import { missingKeyWarning, resolveCurseForgeRefs } from '../../src/curseforge/resolve.js';
import { parseCurseForgeZip } from '../../src/input/curseforge.js';
import { createIo, run } from '../helpers/cli.js';
import { FAKE_CF_KEY, fakeCurseForgeHandler } from '../helpers/fakeCurseForge.js';
import { packFixture } from '../helpers/fixtures.js';
import { createMockFetch } from '../helpers/mockFetch.js';

const cfPack = () => parseCurseForgeZip(packFixture('curseforge-forge'), 'cf.zip');

describe('resolveCurseForgeRefs', () => {
  it('fills file names, SHA-1 and project slugs from the API', async () => {
    const pack = cfPack();
    const client = new CurseForgeClient({
      apiKey: FAKE_CF_KEY,
      fetch: createMockFetch(fakeCurseForgeHandler()).fetch,
    });
    expect(await resolveCurseForgeRefs(pack, client)).toEqual({ resolved: 2, unresolved: 0 });
    expect(pack.mods[0]).toMatchObject({
      fileName: 'jei-1.20.1-forge-15.2.0.27.jar',
      path: 'mods/jei-1.20.1-forge-15.2.0.27.jar',
      hashes: { sha1: '7'.repeat(40) },
      fileSize: 2000,
      curseforge: { resolved: true, slug: 'jei', name: 'Just Enough Items (JEI)' },
    });
    expect(pack.mods[1]?.curseforge).toMatchObject({ slug: 'architectury-api', required: false });
    expect(missingKeyWarning(pack)).toBeUndefined();
  });

  it('warns about files the API does not return', async () => {
    const pack = cfPack();
    const client = new CurseForgeClient({
      apiKey: FAKE_CF_KEY,
      fetch: createMockFetch(fakeCurseForgeHandler({ files: [], mods: [] })).fetch,
    });
    expect(await resolveCurseForgeRefs(pack, client)).toEqual({ resolved: 0, unresolved: 2 });
    expect(pack.warnings).toContain(
      'CurseForge file 4712866 (project 238222) was not returned by the API (deleted or private?)',
    );
    expect(missingKeyWarning(pack)).toMatch(/^2 CurseForge file reference\(s\) not identified/);
  });
});

describe('CLI with CurseForge packs', () => {
  let dir: string;
  let packPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-cf-'));
    packPath = join(dir, 'cf.zip');
    await writeFile(packPath, packFixture('curseforge-forge'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const analyze = ['--mc', '1.21.1', '--loader', 'neoforge', '-f', 'json', '-q', '--no-cache'];
  type Report = {
    mods: { fileName: string; status: string; identification: string; reason?: string }[];
    warnings: string[];
  };

  it('without a key: disables resolution with a clear warning', async () => {
    const io = createIo();
    await run(io, 'analyze', packPath, ...analyze);
    const report = JSON.parse(io.out) as Report;
    expect(report.warnings).toContain(
      '2 CurseForge file reference(s) not identified: set CURSEFORGE_API_KEY (a key from https://console.curseforge.com) to resolve them.',
    );
    expect(report.mods[0]?.reason).toContain('without a CurseForge API key');
  });

  it('with a key: identifies the same file on Modrinth by its SHA-1', async () => {
    const io = createIo({ env: { CURSEFORGE_API_KEY: FAKE_CF_KEY } });
    await run(io, 'analyze', packPath, ...analyze);
    const report = JSON.parse(io.out) as Report;
    expect(report.mods[0]).toMatchObject({
      fileName: 'jei-1.20.1-forge-15.2.0.27.jar',
      status: 'update-found',
      identification: 'hash',
    });
    expect(report.mods[1]).toMatchObject({
      fileName: 'architectury-9.2.14-forge.jar',
      status: 'not-found',
      reason:
        'CurseForge mod "Architectury API": this file is not on Modrinth and no Modrinth project matches the slug "architectury-api".',
    });
    expect(report.warnings.some((w) => w.includes('CURSEFORGE_API_KEY'))).toBe(false);
  });

  it('a rejected key stops with an actionable hint', async () => {
    const io = createIo({ env: { CURSEFORGE_API_KEY: 'invalid' } });
    await run(io, 'analyze', packPath, '--mc', '1.21.1', '--loader', 'neoforge', '--no-cache');
    expect(io.exitCode).toBe(1);
    expect(io.err).toMatch(
      /error: CurseForge rejected the API key \(HTTP 403\).*\nhint: Check the key in CURSEFORGE_API_KEY/,
    );
    expect(io.err).not.toContain('invalid');
  });
});
