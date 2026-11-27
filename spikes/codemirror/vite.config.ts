import { defineConfig } from 'vite';
import { createDevCspPlugin } from '../../vite.config';

function generateSpikeDevNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export default defineConfig(({ command }) => {
  const isServe = command === 'serve';
  const devNonce = isServe ? generateSpikeDevNonce() : undefined;

  return {
    root: 'spikes/codemirror',
    base: './',
    cacheDir: '../../node_modules/.vite-spike-cm',
    ...(devNonce
      ? {
          html: { cspNonce: devNonce },
          plugins: [createDevCspPlugin(devNonce)],
        }
      : {}),
    build: {
      outDir: '../../.spike-dist/codemirror',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: 3100,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      port: 3100,
    },
  };
});
