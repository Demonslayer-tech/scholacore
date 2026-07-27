import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ScholaCore Academy — Telegram Mini App build config.
// `base: './'` matters: Telegram's WebView serves the bundle from a
// non-root path, so absolute asset URLs (`/assets/...`) 404 in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020'
  }
});
