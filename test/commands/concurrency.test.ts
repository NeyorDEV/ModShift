import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConcurrency } from '../../src/commands/analyze.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-concurrency-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const args = () => [
  'analyze',
  packPath,
  '--mc',
  '1.21.1',
  '--loader',
  'fabric',
  '--no-cache',
  '-q',
];

describe('--concurrency', () => {
  it('produces the same report with one or many parallel requests', async () => {
    const one = createIo();
    await run(one, ...args(), '--format', 'json', '--concurrency', '1');
    const many = createIo();
    await run(many, ...args(), '--format', 'json', '--concurrency', '16');
    expect(many.exitCode).toBeUndefined();
    expect(many.out).toBe(one.out);
  });

  it('rejects values outside 1–16', async () => {
    for (const value of ['0', '17', 'two']) {
      const io = createIo();
      await run(io, ...args(), '--concurrency', value);
      expect(io.exitCode).toBe(1);
      expect(io.err).toContain(
        `Invalid --concurrency "${value}" (expected an integer from 1 to 16)`,
      );
    }
    expect(parseConcurrency(undefined)).toBe(4);
  });
});
