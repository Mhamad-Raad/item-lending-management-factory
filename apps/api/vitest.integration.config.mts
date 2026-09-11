import { config } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Local runs read the repository-root .env; CI sets the same variables in the job environment.
config({ path: '../../.env', quiet: true });

// Integration tests run against a real PostgreSQL (DATABASE_URL / DATABASE_MIGRATE_URL of a test DB),
// one file at a time because they share the database.
export default defineConfig({
  oxc: false,
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    globalSetup: ['./test/global-setup.ts'],
    // The application under test connects to the test database as the runtime role.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_TEST_URL ?? '',
      // Request logs would bury the assertion that actually failed.
      LOG_LEVEL: 'fatal',
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
