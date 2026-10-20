import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMrpack } from '../../src/input/mrpack.js';
import { createIo, run } from '../helpers/cli.js';
import { fakeGitHub } from '../helpers/fakeGitHub.js';
import { packFixture } from '../helpers/fixtures.js';

let dir: string;
let packPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modshift-sources-'));
  packPath = join(dir, 'pack.mrpack');
  await writeFile(packPath, packFixture('mrpack-fabric'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const target = ['--mc', '1.21.1', '--loader', 'fabric', '--no-cache', '-q'];
const writeConfig = (config: unknown) =>
  writeFile(join(dir, 'modshift.config.json'), JSON.stringify(config));

describe('mod sources from the config', () => {
  it('reports a GitHub release for an unknown mod but keeps it out of the migrated pack', async () => {
    await writeConfig({
      sources: { 'github-releases': { repositories: { localmod: 'example-org/local-mod' } } },
    });
    const github = fakeGitHub();
    const io = createIo({ cwd: dir });
    io.fetch = github.fetch;
    const out = join(dir, 'out.mrpack');
    await run(io, 'migrate', packPath, ...target, '--loader-version', '0.16.5', '--out', out);
    expect(io.exitCode).toBeUndefined();
    expect(github.calls).toHaveLength(1);

    const report = await readFile(join(dir, 'MIGRATION_REPORT.md'), 'utf8');
    expect(report).toContain('## Other sources (to verify)');
    expect(report).toContain(
      '- **local-mod.jar**: [local-mod-fabric-1.21.1-2.0.0.jar](https://github.com/example-org/local-mod/releases/download/v2.0.0/local-mod-fabric-1.21.1-2.0.0.jar)',
    );
    const migrated = parseMrpack(new Uint8Array(await readFile(out)), 'out.mrpack');
    expect(migrated.mods.some((m) => m.path.includes('local-mod'))).toBe(false);
  });

  it('makes no GitHub request without a "sources" section', async () => {
    const github = fakeGitHub();
    const io = createIo({ cwd: dir });
    io.fetch = github.fetch;
    await run(io, 'analyze', packPath, ...target);
    expect(io.exitCode).toBeUndefined();
    expect(github.calls).toHaveLength(0);
  });

  it('rejects invalid source options before any request', async () => {
    await writeConfig({ sources: { 'github-releases': { repositories: { localmod: 'nope' } } } });
    const io = createIo({ cwd: dir });
    await run(io, 'analyze', packPath, ...target);
    expect(io.exitCode).toBe(1);
    expect(io.err).toContain(
      '"sources.github-releases.repositories.localmod" must be "owner/repo" (got "nope")',
    );
    expect(io.requests).toBe(0);
  });
});
