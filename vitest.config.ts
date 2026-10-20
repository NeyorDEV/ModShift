import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Pas de réseau réel en test : voir test/setup.ts
    restoreMocks: true,
  },
});
