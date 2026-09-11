import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not Vite's default transform) so Nest decorators emit design-time metadata.
export default defineConfig({
  oxc: false,
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Nest decorators write their metadata through reflect-metadata, which `main.ts` imports
    // in production and the test entry points do not.
    setupFiles: ['reflect-metadata'],
  },
});
