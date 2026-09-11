import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against a real PostgreSQL (DATABASE_URL / DATABASE_MIGRATE_URL of a test DB),
// one file at a time because they share the database.
export default defineConfig({
  oxc: false,
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
