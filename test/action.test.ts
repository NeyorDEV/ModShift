import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeArgs,
  buildComment,
  COMMENT_MARKER,
  failingStatuses,
  MAX_COMMENT_LENGTH,
  parseBoolean,
  parseFailOn,
  pullRequestNumber,
  upsertComment,
} from '../action/lib.mjs';
import { createMockFetch, jsonResponse } from './helpers/mockFetch.js';

describe('action inputs', () => {
  it('parses fail-on and booleans strictly', () => {
    expect(parseFailOn(' not-found, alternative-suggested ')).toEqual([
      'not-found',
      'alternative-suggested',
    ]);
    expect(parseFailOn('')).toEqual([]);
    expect(() => parseFailOn('broken')).toThrow('invalid fail-on status "broken"');
    expect(parseBoolean('comment', 'TRUE')).toBe(true);
    expect(parseBoolean('comment', '')).toBe(false);
    expect(() => parseBoolean('comment', 'yes')).toThrow('input "comment" must be true or false');
  });

  it('builds the analyze command without a shell', () => {
    expect(
      analyzeArgs(
        { pack: 'pack; rm -rf /.mrpack', mc: '1.21.1', loader: 'fabric', cacheDir: '/c' },
        'json',
        '/out.json',
      ),
    ).toEqual([
      'analyze',
      '--format',
      'json',
      '--output',
      '/out.json',
      '--quiet',
      '--mc',
      '1.21.1',
      '--loader',
      'fabric',
      '--cache-dir',
      '/c',
      '--',
      'pack; rm -rf /.mrpack',
    ]);
  });

  it('fails only on the statuses asked for', () => {
    const summary = {
      compatible: 3,
      'update-found': 1,
      'alternative-suggested': 0,
      'not-found': 2,
    };
    expect(failingStatuses(summary, ['not-found', 'alternative-suggested'])).toEqual(['not-found']);
    expect(failingStatuses(summary, [])).toEqual([]);
  });

  it('finds the pull request number in the event payload', () => {
    expect(pullRequestNumber({ pull_request: { number: 12 } })).toBe(12);
    expect(pullRequestNumber({ issue: { number: 7, pull_request: {} } })).toBe(7);
    expect(pullRequestNumber({ push: {} })).toBeUndefined();
  });
});

describe('pull request comment', () => {
  it('starts with a hidden marker and is truncated under the GitHub limit', () => {
    const body = buildComment('# Report\n' + 'x'.repeat(100_000), { runUrl: 'https://run' });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    expect(body).toContain('report truncated');
    expect(body.endsWith('Full report: https://run')).toBe(true);
  });

  const options = (fetch: Parameters<typeof upsertComment>[0]['fetch']) => ({
    fetch,
    apiUrl: 'https://api.github.com',
    repository: 'owner/repo',
    number: 5,
    token: 'test-token-not-real',
    body: `${COMMENT_MARKER}\nnew`,
    userAgent: 'test',
  });

  it('creates the comment the first time', async () => {
    const mock = createMockFetch((req) =>
      req.method === 'GET'
        ? jsonResponse([{ id: 1, body: 'someone else' }])
        : jsonResponse({}, 201),
    );
    expect(await upsertComment(options(mock.fetch))).toBe('created');
    const post = mock.calls[1];
    expect(post?.method).toBe('POST');
    expect(post?.url.pathname).toBe('/repos/owner/repo/issues/5/comments');
    expect(post?.headers.authorization).toBe('Bearer test-token-not-real');
    expect(post?.body).toEqual({ body: `${COMMENT_MARKER}\nnew` });
  });

  it('updates its own comment on later runs', async () => {
    const mock = createMockFetch((req) =>
      req.method === 'GET'
        ? jsonResponse([
            { id: 1, body: 'hi' },
            { id: 42, body: `${COMMENT_MARKER}\nold` },
          ])
        : jsonResponse({}),
    );
    expect(await upsertComment(options(mock.fetch))).toBe('updated');
    expect(mock.calls[1]?.method).toBe('PATCH');
    expect(mock.calls[1]?.url.pathname).toBe('/repos/owner/repo/issues/comments/42');
  });

  it('reports a refused write (e.g. from a fork)', async () => {
    const mock = createMockFetch((req) =>
      req.method === 'GET' ? jsonResponse([]) : jsonResponse({ message: 'nope' }, 403),
    );
    await expect(upsertComment(options(mock.fetch))).rejects.toThrow(
      'creating the comment failed: HTTP 403',
    );
  });
});

// Orchestration de run.mjs contre une CLI factice (aucune requête : la vraie analyse a ses
// propres tests).
describe('action runner', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'modshift-action-'));
    await mkdir(join(root, 'dist'));
    await writeFile(
      join(root, 'dist', 'cli.js'),
      `import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const output = args[args.indexOf('--output') + 1];
const format = args[args.indexOf('--format') + 1];
writeFileSync(output, format === 'json'
  ? JSON.stringify({ summary: { compatible: 2, 'update-found': 1, 'alternative-suggested': 0, 'not-found': 1 } })
  : '# ModShift report\\n\\nargs: ' + args.join(' '));
`,
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const runAction = (env: Record<string, string>) => {
    const outputs = join(root, 'outputs');
    const summary = join(root, 'summary.md');
    const runner = fileURLToPath(new URL('../action/run.mjs', import.meta.url));
    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [runner], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          MODSHIFT_ROOT: root,
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: outputs,
          GITHUB_STEP_SUMMARY: summary,
          MODSHIFT_PACK: 'pack.mrpack',
          MODSHIFT_MC: '1.21.1',
          MODSHIFT_LOADER: 'fabric',
          MODSHIFT_COMMENT: 'false',
          ...env,
        },
      });
    } catch (error) {
      const e = error as { status: number; stdout: string };
      status = e.status;
      stdout = e.stdout;
    }
    return { status, stdout, outputs, summary };
  };

  it('writes the job summary and the outputs', async () => {
    const { status, outputs, summary } = runAction({});
    expect(status).toBe(0);
    expect(await readFile(summary, 'utf8')).toContain(
      '# ModShift report\n\nargs: analyze --format markdown',
    );
    const lines = (await readFile(outputs, 'utf8')).trim().split('\n');
    expect(lines).toContain('not-found=1');
    expect(lines).toContain(`report=${join(root, 'modshift-report.md')}`);
  });

  it('fails the job on the statuses given in fail-on', () => {
    const { status, stdout } = runAction({ MODSHIFT_FAIL_ON: 'not-found' });
    expect(status).toBe(1);
    expect(stdout).toContain('::error title=ModShift Check::mods with status not-found (1)');
  });

  it('rejects invalid inputs before running anything', () => {
    const { status, stdout } = runAction({ MODSHIFT_FAIL_ON: 'oops' });
    expect(status).toBe(1);
    expect(stdout).toContain('invalid fail-on status "oops"');
  });

  it('skips the comment outside pull requests', () => {
    const { status, stdout } = runAction({ MODSHIFT_COMMENT: 'true', MODSHIFT_TOKEN: 'x' });
    expect(status).toBe(0);
    expect(stdout).toContain('Not a pull request: no comment posted');
  });
});
