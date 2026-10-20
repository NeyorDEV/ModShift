import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Pas de réseau réel en test : voir test/setup.ts
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // Objectif : au moins 80 % sur le moteur de compatibilité et le parsing des entrées.
      thresholds: {
        'src/core/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/input/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
