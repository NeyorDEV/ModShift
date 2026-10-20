import { describe, expect, it } from 'vitest';
import { CurseForgeClient } from '../../src/curseforge/client.js';
import { createDefaultRegistry } from '../../src/sources/index.js';
import { modrinthSource } from '../../src/sources/modrinth.js';
import { SourceRegistry } from '../../src/sources/registry.js';

const registry = () =>
  createDefaultRegistry({ createCurseForgeClient: (apiKey) => new CurseForgeClient({ apiKey }) });

describe('SourceRegistry', () => {
  it('lists the built-in sources in call order', () => {
    expect(
      registry()
        .list()
        .map((s) => s.id),
    ).toEqual(['modrinth', 'curseforge', 'github-releases']);
  });

  it('refuses invalid ids, empty names and a second primary source', () => {
    const r = new SourceRegistry();
    expect(() => r.register({ ...modrinthSource, id: 'Bad Id' })).toThrow(/invalid source id/);
    expect(() => r.register({ ...modrinthSource, id: 'nameless', name: ' ' })).toThrow(/no name/);
    r.register(modrinthSource);
    expect(() => r.register({ ...modrinthSource, id: 'other-primary' })).toThrow(
      /only one primary/,
    );
  });

  it('validates the "sources" section of the config', () => {
    const r = registry();
    expect(() =>
      r.validateOptions({ 'github-releases': { repositories: { 'a.jar': 'owner/repo' } } }),
    ).not.toThrow();
    expect(() => r.validateOptions({ gitlab: {} })).toThrow(
      'unknown source "gitlab" (known: modrinth, curseforge, github-releases)',
    );
    expect(() => r.validateOptions({ curseforge: {} })).toThrow(
      'source "curseforge" takes no options',
    );
  });
});
