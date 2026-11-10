import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  base: './',
  build: {
    outDir: '../web/editor',
    emptyOutDir: true,
    target: 'es2022',
    cssTarget: 'safari16',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5517,
  },
  worker: {
    format: 'es',
  },
});
