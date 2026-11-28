import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'spikes/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'tests/**/*.test.mjs',
    ],
    environment: 'node',
  },
});
