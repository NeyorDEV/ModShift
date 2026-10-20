import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputError, loadPack, parseMrpack } from '../../src/input/index.js';
import { readZip } from '../../src/input/zip.js';
import { jarFixture, packFixture } from '../helpers/fixtures.js';

// Réécrit, dans le répertoire central, la taille décompressée déclarée de chaque entrée :
// simule une « zip bomb » dont les en-têtes annoncent une taille énorme.
function forgeDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return out;
}

const limits = { maxEntries: 3, maxEntryBytes: 100, maxTotalBytes: 150 };

describe('readZip limits', () => {
  it('rejects archives with too many entries', () => {
    const zip = zipSync({ a: strToU8('1'), b: strToU8('2'), c: strToU8('3'), d: strToU8('4') });
    expect(() => readZip(zip, 'many.zip', undefined, limits)).toThrow(
      'Refusing to read many.zip: more than 3 entries (possible zip bomb)',
    );
  });

  it('rejects an entry or a total that would expand beyond the limits', () => {
    const big = zipSync({ a: new Uint8Array(101) });
    expect(() => readZip(big, 'big.zip', undefined, limits)).toThrow(/entry "a" would expand to/);
    const total = zipSync({ a: new Uint8Array(80), b: new Uint8Array(80) });
    expect(() => readZip(total, 't.zip', undefined, limits)).toThrow(/would expand to more than/);
  });

  it('only counts entries selected by the filter towards size limits', () => {
    const zip = zipSync({ small: new Uint8Array(10), huge: new Uint8Array(500) });
    expect(Object.keys(readZip(zip, 'f.zip', (n) => n === 'small', limits))).toEqual(['small']);
  });

  it('refuses a forged 4 GiB entry before allocating memory', () => {
    const forged = forgeDeclaredSize(zipSync({ 'modrinth.index.json': strToU8('{}') }), 0xfffffff0);
    expect(() => parseMrpack(forged, 'bomb.mrpack')).toThrow(/possible zip bomb/);
  });

  it('applies tighter limits to jar metadata', () => {
    // fabric.mod.json annonçant 64 Mio : refusé pour un fichier de métadonnées.
    const forged = forgeDeclaredSize(
      zipSync({ 'fabric.mod.json': strToU8('{}') }),
      64 * 1024 * 1024,
    );
    const pack = zipSync({
      'modrinth.index.json': strToU8(
        JSON.stringify({ game: 'minecraft', files: [], dependencies: {} }),
      ),
      'overrides/mods/evil.jar': forged,
    });
    const parsed = parseMrpack(pack, 'p.mrpack');
    expect(parsed.warnings[0]).toMatch(
      /^evil\.jar: Refusing to read evil\.jar: entry "fabric\.mod\.json" would expand to 64 MiB/,
    );
  });
});

describe('path safety', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-safety-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ignores zip-slip paths in .mrpack indexes and overrides', () => {
    const pack = zipSync({
      'modrinth.index.json': strToU8(
        JSON.stringify({
          game: 'minecraft',
          files: [{ path: '../../etc/evil.jar', hashes: {}, downloads: [] }],
          dependencies: { minecraft: '1.20.1' },
        }),
      ),
    });
    const parsed = parseMrpack(pack, 'slip.mrpack');
    expect(parsed.mods).toEqual([]);
    expect(parsed.warnings).toEqual(['slip.mrpack: ignoring unsafe path "../../etc/evil.jar"']);
  });

  it('does not follow symbolic links when reading a folder of jars', async () => {
    await writeFile(join(dir, 'real.jar'), jarFixture('fabric-sodium'));
    await symlink('/etc/hostname', join(dir, 'link.jar')).catch(() => undefined);
    const pack = await loadPack(dir);
    expect(pack.mods.map((m) => m.fileName)).toEqual(['real.jar']);
  });

  it('rejects paths that are neither files nor directories', async () => {
    await expect(loadPack('/dev/null')).rejects.toBeInstanceOf(InputError);
  });

  it('still reads regular packs', () => {
    expect(parseMrpack(packFixture('mrpack-fabric'), 'ok.mrpack').mods).toHaveLength(6);
  });
});
