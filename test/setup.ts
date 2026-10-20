import { beforeEach, vi } from 'vitest';

// Garde-fou : les tests ne doivent JAMAIS appeler le vrai réseau.
// Toute utilisation du fetch global échoue immédiatement ; les tests
// doivent injecter un fetch simulé (voir test/helpers/mockFetch.ts).
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Real network access is forbidden in tests: inject a mock fetch instead.');
  });
});
