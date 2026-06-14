import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: '/',
  build: {
    outDir: '../backend/web/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:8080', changeOrigin: true },
      '/v1':      { target: 'http://localhost:8080', changeOrigin: true },
      '/x':       { target: 'http://localhost:8080', changeOrigin: true, ws: true },
      '/healthz': { target: 'http://localhost:8080' },
    },
  },
});
