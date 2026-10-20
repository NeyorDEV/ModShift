import { request as httpRequest } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/modrinth/cache.js';
import { ModrinthClient } from '../../src/modrinth/client.js';
import { startUiServer, type UiServer } from '../../src/ui/server.js';
import { fakeModrinthHandler, loadCatalog } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';
import { createMockFetch } from '../helpers/mockFetch.js';
import { assertValidGeneratedPack } from '../helpers/mrpackAssertions.js';

const TOKEN = 'test-token-0123456789';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json: () => Record<string, unknown>;
}

// Client HTTP minimal vers 127.0.0.1 (le fetch global est désactivé dans les tests).
function call(
  server: UiServer,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    token?: string | null;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: `127.0.0.1:${server.port}`,
      ...(options.token === null ? {} : { 'X-ModShift-Token': options.token ?? TOKEN }),
      ...options.headers,
    };
    const req = httpRequest(
      { host: '127.0.0.1', port: server.port, path, method: options.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body.toString('utf8')) as Record<string, unknown>,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const upload = (server: UiServer, data: Uint8Array, query = 'mc=1.21.1&loader=fabric') =>
  call(server, `/api/analyze?${query}&name=pack.mrpack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  });

const postJson = (server: UiServer, path: string, value: unknown) =>
  call(server, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });

let server: UiServer;
async function start(extra: Partial<Parameters<typeof startUiServer>[0]> = {}): Promise<UiServer> {
  const mock = createMockFetch(fakeModrinthHandler(loadCatalog()));
  return startUiServer({
    token: TOKEN,
    createApi: (options) =>
      new ModrinthClient({ ...options, fetch: mock.fetch, sleep: async () => undefined }),
    cache: new MemoryCache(),
    env: {},
    ...extra,
  });
}
beforeEach(async () => {
  server = await start();
});
afterEach(async () => {
  await server.close();
});

describe('UI server: network exposure and static files', () => {
  it('listens on 127.0.0.1 only and prints a tokenised URL', () => {
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.url).toBe(`${server.origin}/?token=${TOKEN}`);
  });

  it('serves the page with security headers', async () => {
    const page = await call(server, '/', { token: null });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.body.toString()).toContain('<title>ModShift</title>');
    expect((await call(server, '/app.js', { token: null })).headers['content-type']).toContain(
      'text/javascript',
    );
  });

  it('serves only whitelisted files', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/server.ts', '/logic.d.ts']) {
      expect((await call(server, path, { token: null })).status, path).toBe(404);
    }
    expect((await call(server, '/', { method: 'POST', token: null })).status).toBe(405);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const evil = await call(server, '/', { headers: { Host: `evil.example:${server.port}` } });
    expect(evil.status).toBe(403);
    const localhost = await call(server, '/', { headers: { Host: `localhost:${server.port}` } });
    expect(localhost.status).toBe(200);
  });

  it('requires the session token for the API', async () => {
    expect((await call(server, '/api/info', { token: null })).status).toBe(401);
    expect((await call(server, '/api/info', { token: 'wrong' })).status).toBe(401);
    const info = await call(server, '/api/info');
    expect(info.status).toBe(200);
    expect(info.json().loaders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'neoforge', mrpack: true })]),
    );
  });
});

describe('UI server: analyze and migrate', () => {
  it('analyses an uploaded pack and builds a valid migrated pack', async () => {
    const analysed = await upload(server, packFixture('mrpack-fabric'));
    expect(analysed.status).toBe(200);
    const body = analysed.json() as {
      sessionId: string;
      canMigrate: boolean;
      analysis: { summary: Record<string, number> };
    };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.canMigrate).toBe(true);
    expect(body.analysis.summary).toEqual({
      compatible: 1,
      'update-found': 2,
      'alternative-suggested': 1,
      'not-found': 2,
    });

    const before = await call(server, `/api/sessions/${body.sessionId}/download/mrpack`);
    expect(before.status).toBe(404);

    const missingVersion = await postJson(server, '/api/migrate', { sessionId: body.sessionId });
    expect(missingVersion.status).toBe(400);
    expect(missingVersion.json().error).toMatch(/Enter the Fabric version/);

    const migrated = await postJson(server, '/api/migrate', {
      sessionId: body.sessionId,
      loaderVersion: '0.16.5',
      includeAlternatives: true,
    });
    expect(migrated.status).toBe(200);
    expect(migrated.json().included).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Xaero's Minimap", source: 'alternative' }),
      ]),
    );

    const mrpack = await call(server, `/api/sessions/${body.sessionId}/download/mrpack`);
    expect(mrpack.status).toBe(200);
    expect(mrpack.headers['content-disposition']).toBe(
      'attachment; filename="Fixture-Fabric-Pack-1.21.1-fabric.mrpack"',
    );
    assertValidGeneratedPack(new Uint8Array(mrpack.body), loadCatalog());

    const report = await call(server, `/api/sessions/${body.sessionId}/download/report`);
    expect(report.body.toString()).toContain('# Migration report: Fixture Fabric Pack');
    const analysis = await call(server, `/api/sessions/${body.sessionId}/download/analysis`);
    expect(JSON.parse(analysis.body.toString()).schemaVersion).toBe(1);
  });

  it('only offers the analysis for plugin platforms', async () => {
    const analysed = (
      await upload(server, packFixture('mrpack-fabric'), 'mc=1.21.1&loader=paper')
    ).json();
    expect(analysed.canMigrate).toBe(false);
    const migrate = await postJson(server, '/api/migrate', {
      sessionId: analysed.sessionId,
      loaderVersion: '1',
    });
    expect(migrate.status).toBe(400);
    expect(migrate.json().error).toBe('Paper cannot be the target of a .mrpack');
  });

  it('validates uploads and parameters', async () => {
    expect((await upload(server, new Uint8Array())).status).toBe(400);
    const notZip = await upload(server, strToU8('not a zip'));
    expect(notZip.status).toBe(400);
    expect(notZip.json().hint).toMatch(/ModShift reads a Modrinth \.mrpack/);
    expect(
      (await upload(server, packFixture('mrpack-fabric'), 'mc=latest&loader=fabric')).status,
    ).toBe(400);
    expect(
      (await upload(server, packFixture('mrpack-fabric'), 'mc=1.21.1&loader=rift2')).status,
    ).toBe(400);

    // Zip bomb : taille décompressée annoncée énorme.
    const bomb = new Uint8Array(zipSync({ 'modrinth.index.json': strToU8('{}') }));
    const view = new DataView(bomb.buffer);
    for (let i = 0; i + 46 <= bomb.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0xfffffff0, true);
    }
    const refused = await upload(server, bomb);
    expect(refused.status).toBe(400);
    expect(refused.json().error).toMatch(/possible zip bomb/);
  });

  it('refuses uploads above the size limit', async () => {
    const small = await start({ maxUploadBytes: 1000 });
    try {
      const res = await upload(small, packFixture('mrpack-fabric'));
      expect(res.status).toBe(413);
      expect(res.json().error).toMatch(/Upload too large/);
    } finally {
      await small.close();
    }
  });

  it('checks session ids and JSON bodies', async () => {
    expect((await call(server, '/api/sessions/../../x/download/mrpack')).status).toBe(404);
    expect((await call(server, '/api/sessions/not-a-uuid/download/mrpack')).status).toBe(400);
    expect(
      (
        await call(
          server,
          `/api/sessions/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/download/mrpack`,
        )
      ).status,
    ).toBe(404);
    expect((await call(server, '/api/migrate', { method: 'POST', body: '{}' })).status).toBe(415);
    expect(
      (
        await call(server, '/api/migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{oops',
        })
      ).status,
    ).toBe(400);
  });

  it('writes only inside its temporary folder and removes it on close', async () => {
    const before = new Set(await readdir(tmpdir()));
    const own = await start();
    const created = (await readdir(tmpdir())).filter(
      (n) => !before.has(n) && n.startsWith('modshift-ui-'),
    );
    expect(created).toHaveLength(1);
    const analysed = (await upload(own, packFixture('mrpack-fabric'))).json();
    expect(
      (await call(own, `/api/sessions/${String(analysed.sessionId)}`, { method: 'DELETE' })).json(),
    ).toEqual({ deleted: true });
    await own.close();
    await expect(stat(`${tmpdir()}/${created[0] ?? ''}`)).rejects.toThrow();
  });
});
