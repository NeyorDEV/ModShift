// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Globales du navigateur utilisées par l'interface web (src/ui/public) : déclarées ici pour
// éviter une dépendance supplémentaire.
const browserGlobals = Object.fromEntries(
  [
    'window',
    'document',
    'fetch',
    'URL',
    'URLSearchParams',
    'localStorage',
    'sessionStorage',
    'setTimeout',
  ].map((name) => [name, 'readonly']),
);

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'docs/.vitepress/cache/',
      'docs/.vitepress/dist/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/ui/public/**/*.js'],
    languageOptions: { globals: browserGlobals },
  },
  // Scripts Node (benchmarks, action GitHub, scripts) : globales Web standard disponibles dans Node 20+.
  {
    files: ['bench/**/*.mjs', 'action/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        ['Response', 'URL', 'setTimeout', 'fetch'].map((name) => [name, 'readonly']),
      ),
    },
  },
);
