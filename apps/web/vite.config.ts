import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same-origin in every environment: the dev/preview server proxies /api to the local API,
// exactly like Caddy does in production.
const apiProxy = { '/api': { target: 'http://localhost:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [
    // Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 5175, not Vite's default 5173: that port is commonly held by another local dev server (Q33).
  server: { port: 5175, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: { target: 'es2023', sourcemap: true },
});
