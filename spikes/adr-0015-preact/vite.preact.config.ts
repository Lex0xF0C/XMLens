import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist/preact',
    emptyOutDir: true,
    rollupOptions: { input: 'index.preact.html' },
  },
});
