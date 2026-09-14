import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // §14.1: the ledger math is the rule book every total is checked against, so every line and branch is tested.
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 100, branches: 100 },
    },
  },
});
