import { defineConfig } from 'vite';

export default defineConfig({
  root: 'packages/app',
  base: './',
  cacheDir: '../../node_modules/.vite',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
