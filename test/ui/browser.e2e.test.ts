import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/modrinth/cache.js';
import { ModrinthClient } from '../../src/modrinth/client.js';
import { startUiServer, type UiServer } from '../../src/ui/server.js';
import { fakeModrinthHandler, loadCatalog } from '../helpers/fakeModrinth.js';
import { packFixture } from '../helpers/fixtures.js';
import { createMockFetch } from '../helpers/mockFetch.js';
import { assertValidGeneratedPack } from '../helpers/mrpackAssertions.js';

// Test de bout en bout minimal dans un vrai navigateur (Chromium headless), contre le serveur
// local et le faux Modrinth. Ignoré si aucun Chromium/Chrome n'est disponible.
const candidates = [
  process.env.MODSHIFT_CHROMIUM,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => typeof p === 'string' && p.length > 0);
const executablePath = candidates.find((p) => existsSync(p));

describe.skipIf(!executablePath)('web UI in a browser', () => {
  let browser: Browser;
  let server: UiServer;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modshift-e2e-ui-'));
    const mock = createMockFetch(fakeModrinthHandler(loadCatalog()));
    server = await startUiServer({
      createApi: (options) =>
        new ModrinthClient({ ...options, fetch: mock.fetch, sleep: async () => undefined }),
      cache: new MemoryCache(),
      env: {},
    });
    browser = await chromium.launch({ executablePath, headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('analyses a dropped pack, filters the results and downloads the migrated pack', async () => {
    const page = await browser.newPage({ acceptDownloads: true });
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });

    await page.goto(server.url);
    // Le jeton est retiré de la barre d'adresse.
    expect(page.url()).toBe(`${server.origin}/`);
    await page.waitForSelector('#loader option[value="fabric"]', { state: 'attached' });

    const packPath = join(dir, 'pack.mrpack');
    await writeFile(packPath, packFixture('mrpack-fabric'));
    await page.setInputFiles('#file-input', packPath);
    await page.fill('#mc', '1.21.1');
    await page.selectOption('#loader', 'fabric');
    await page.click('#analyze');

    await page.waitForSelector('#mods-table tbody tr');
    expect(await page.locator('#mods-table tbody tr').count()).toBe(6);
    await expect
      .poll(async () => (await page.locator('#summary').innerText()).replace(/\s+/g, ' '))
      .toContain('Update found 2');

    // Filtre par statut puis recherche texte.
    await page.selectOption('#status-filter', 'not-found');
    expect(await page.locator('#mods-table tbody tr').count()).toBe(2);
    await page.selectOption('#status-filter', '');
    await page.fill('#search', 'sodium');
    expect(await page.locator('#mods-table tbody tr').count()).toBe(1);

    // Détail d'un mod.
    await page.click('#mods-table tbody tr');
    await expect.poll(() => page.locator('#detail-title').innerText()).toBe('Sodium');
    expect(await page.locator('#detail-body').innerText()).toContain('0.6.0');
    await page.keyboard.press('Escape');

    // Construction et téléchargement du pack migré (liens invisibles avant la construction).
    expect(await page.isVisible('#download-mrpack')).toBe(false);
    await page.fill('#loader-version', '0.16.5');
    await page.click('#build');
    await page.waitForSelector('#downloads:not([hidden])');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-mrpack'),
    ]);
    const saved = join(dir, 'migrated.mrpack');
    await download.saveAs(saved);
    const { index } = assertValidGeneratedPack(
      new Uint8Array(await readFile(saved)),
      loadCatalog(),
    );
    expect(index.dependencies).toEqual({ minecraft: '1.21.1', 'fabric-loader': '0.16.5' });

    // Aucune erreur JavaScript ni violation de CSP.
    expect(problems).toEqual([]);
  }, 60_000);
});
