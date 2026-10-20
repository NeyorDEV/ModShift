import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config/config.js';
import { isValidLoaderVersion } from '../../src/loaders/loaderVersion.js';
import { createIo, run } from '../helpers/cli.js';
import { packFixture } from '../helpers/fixtures.js';

describe('loader version format', () => {
  it.each(['0.16.5', '21.1.77', '47.3.0', '0.27.1-beta.1', '1.20.1-47.3.0', '21.1.0+build_3'])(
    'accepts %s',
    (version) => expect(isValidLoaderVersion(version)).toBe(true),
  );

  it.each(['<version>', '', ' 0.16.5', '0.16 .5', '-0.16.5', 'x'.repeat(65), '0.16.5;rm'])(
    'rejects %j',
    (version) => expect(isValidLoaderVersion(version)).toBe(false),
  );

  it('rejects an invalid target.loaderVersion in the config', () => {
    expect(() => validateConfig({ target: { loaderVersion: '<version>' } }, 'c.json')).toThrow(
      'invalid loader version "<version>"',
    );
  });

  it('migrate refuses a placeholder copied from an example, before any request', async () => {
    // Cas réel : « --loader-version <version> » recopié tel quel produisait un pack invalide.
    const dir = await mkdtemp(join(tmpdir(), 'modshift-loader-version-'));
    try {
      const pack = join(dir, 'pack.mrpack');
      await writeFile(pack, packFixture('mrpack-fabric'));
      const out = join(dir, 'out.mrpack');
      const io = createIo();
      await run(
        io,
        'migrate',
        pack,
        '--mc',
        '1.21.1',
        '--loader',
        'fabric',
        '--loader-version',
        '<version>',
        '--out',
        out,
        '--no-cache',
        '-q',
      );
      expect(io.exitCode).toBe(1);
      expect(io.err).toContain('invalid loader version "<version>"');
      expect(io.requests).toBe(0);
      expect(existsSync(out)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
