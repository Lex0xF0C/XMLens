import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite';

export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';";

function generateDevNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Builds the dev-server-only CSP string for `vite serve`: keeps `script-src 'self'`,
 * authorizes Vite's injected `<style data-vite-dev-id>` via a per-process nonce (Option b),
 * and permits HMR WebSockets without `'unsafe-inline'` or `'unsafe-eval'`.
 */
export function buildServeCsp(nonce: string): string {
  if (!nonce || /['"\s;]/.test(nonce)) {
    throw new Error('Invalid CSP nonce value.');
  }
  return `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'self';`;
}

/**
 * Replaces the canonical production CSP string inside served HTML during `vite serve`.
 * Never invoked during `vite build`.
 */
export function applyServeCspToHtml(html: string, nonce: string): string {
  if (!html.includes(PRODUCTION_CSP)) {
    throw new Error('Canonical production CSP meta tag not found in HTML source.');
  }
  return html.replace(PRODUCTION_CSP, buildServeCsp(nonce));
}

export function createDevCspPlugin(nonce: string): Plugin {
  return {
    name: 'xmlens-dev-csp',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return applyServeCspToHtml(html, nonce);
      },
    },
  };
}

export function createXmlensViteConfig(env: Pick<ConfigEnv, 'command'>): UserConfig {
  const isServe = env.command === 'serve';
  const devNonce = isServe ? generateDevNonce() : undefined;

  return {
    root: 'packages/app',
    base: './',
    cacheDir: '../../node_modules/.vite',
    ...(devNonce
      ? {
          html: { cspNonce: devNonce },
          plugins: [createDevCspPlugin(devNonce)],
        }
      : {}),
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
  };
}

export default defineConfig((env) => createXmlensViteConfig(env));
