import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/routeTree.gen.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/public/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Security requirement: raw SQL only through tagged templates (parameterised).
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use the $queryRaw tagged template (parameterised).' },
        { property: '$executeRawUnsafe', message: 'Use the $executeRaw tagged template (parameterised).' },
      ],
      // Nest dependency injection needs value imports of injected classes.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['Route'] }],
      // Security requirement: React escaping everywhere.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden.',
        },
      ],
    },
  },
  {
    // Security requirement (§10.1 S7): tokens live in memory only; the preferences are the one thing kept in storage.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/preferences.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'localStorage', property: 'setItem', message: 'Only lib/preferences.ts writes to localStorage.' },
        { object: 'sessionStorage', property: 'setItem', message: 'Nothing is kept in sessionStorage.' },
      ],
      'no-restricted-globals': ['error', { name: 'indexedDB', message: 'Nothing is kept in IndexedDB.' }],
    },
  },
  {
    // TanStack Router route files export `Route` next to components; the router plugin handles HMR.
    files: ['apps/web/src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  prettier,
);
