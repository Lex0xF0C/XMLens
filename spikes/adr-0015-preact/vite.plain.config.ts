import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist/plain',
    emptyOutDir: true,
    rollupOptions: { input: 'index.plain.html' },
  },
});
