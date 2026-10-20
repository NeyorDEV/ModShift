import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as Record<string, unknown> & { version: string; bin: Record<string, string>; files: string[] };

describe('npm package', () => {
  it('keeps src/version.ts in sync with package.json (User-Agent, releases)', () => {
    expect(api.MODSHIFT_VERSION).toBe(pkg.version);
  });

  it('exposes the programmatic API', () => {
    for (const name of [
      'analyzePack',
      'loadPack',
      'ModrinthClient',
      'buildMigrationPlan',
      'buildMrpackArchive',
      'validateMrpackIndex',
      'renderReport',
      'loadConfig',
    ]) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(api.LOADERS).toEqual(
      expect.arrayContaining(['forge', 'neoforge', 'fabric', 'quilt', 'paper']),
    );
  });

  it('declares the metadata needed to publish', () => {
    expect(pkg).toMatchObject({
      name: 'modshift',
      license: 'MIT',
      type: 'module',
      bin: { modshift: 'dist/cli.js' },
      types: './dist/index.d.ts',
      repository: { url: 'git+https://github.com/NeyorDEV/ModShift.git' },
    });
    expect(pkg.files).toContain('schemas');
  });
});
