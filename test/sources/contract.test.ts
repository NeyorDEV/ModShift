import { CurseForgeClient } from '../../src/curseforge/client.js';
import { curseForgeSource } from '../../src/sources/curseforge.js';
import { githubReleasesSource } from '../../src/sources/githubReleases.js';
import { modrinthSource } from '../../src/sources/modrinth.js';
import { CANDIDATE_NOTE, type ModSource } from '../../src/sources/types.js';
import { fakeGitHub } from '../helpers/fakeGitHub.js';
import { describeSourceContract } from './contract.js';

describeSourceContract('Modrinth (primary)', { make: () => modrinthSource });

describeSourceContract('CurseForge', {
  // Aucune clé dans le contexte de test : le client n'est jamais créé.
  make: (fetch) =>
    curseForgeSource({ createClient: (apiKey) => new CurseForgeClient({ apiKey, fetch }) }),
});

describeSourceContract('GitHub Releases', {
  make: (fetch) => githubReleasesSource({ fetch }),
  candidates: {
    fetch: fakeGitHub().fetch,
    options: { repositories: { 'local-mod.jar': 'example-org/local-mod' } },
    request: { fileName: 'local-mod.jar', modIds: ['localmod'] },
    target: { minecraftVersion: '1.21.1', loader: 'fabric' },
  },
  invalidOptions: [
    'nope',
    {},
    { repositories: { 'a.jar': 'not a repo' } },
    { repositories: {}, extra: true },
    { repositories: {}, prereleases: 'yes' },
  ],
});

// Exemple de source tierce minimale (miroir déclaré dans la config) : le contrat suffit à
// l'intégrer, sans toucher au moteur.
function mirrorSource(): ModSource {
  return {
    id: 'example-mirror',
    name: 'Example mirror',
    description: 'Maps file names to URLs on a mirror declared in the config.',
    validateOptions(options) {
      if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new Error('"sources.example-mirror" must be an object of file name → URL');
      }
    },
    async findCandidates(mod, target, context) {
      if (context.offline) return [];
      const url = (context.options as Record<string, string> | undefined)?.[mod.fileName];
      if (!url) return [];
      return [
        {
          source: 'example-mirror',
          title: mod.title ?? mod.fileName,
          version: target.minecraftVersion,
          fileName: url.split('/').pop() ?? mod.fileName,
          url,
          reason: 'declared in the config',
          note: CANDIDATE_NOTE,
        },
      ];
    },
  };
}

describeSourceContract('third-party example', {
  make: () => mirrorSource(),
  invalidOptions: ['x', null, []],
});
