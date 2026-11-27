import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as viteBuild, resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  applyServeCspToHtml,
  buildServeCsp,
  createXmlensViteConfig,
  PRODUCTION_CSP,
} from '../vite.config';

const INDEX_HTML_PATH = resolve(process.cwd(), 'packages/app/index.html');

function extractCspMetaContent(html) {
  const tagMatch = /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html);
  if (!tagMatch) {
    return null;
  }
  const contentMatch = /\bcontent=(?:"([^"]*)"|'([^']*)')/i.exec(tagMatch[0]);
  return contentMatch?.[1] ?? contentMatch?.[2] ?? null;
}

describe('ADR-0007 dev/prod CSP separation', () => {
  it('keeps the canonical strict CSP in packages/app/index.html source', () => {
    const sourceHtml = readFileSync(INDEX_HTML_PATH, 'utf8');
    expect(extractCspMetaContent(sourceHtml)).toBe(PRODUCTION_CSP);
    expect(sourceHtml).not.toContain('unsafe-inline');
    expect(sourceHtml).not.toContain('unsafe-eval');
    expect(sourceHtml).not.toContain('csp-nonce');
  });

  it('produces dist/index.html with exact strict production CSP and zero dev-only directives', async () => {
    const tempOutDir = mkdtempSync(join(tmpdir(), 'xmlens-csp-build-'));
    try {
      const prodConfig = createXmlensViteConfig({ command: 'build' });
      expect(prodConfig.html).toBeUndefined();
      expect(prodConfig.plugins).toBeUndefined();

      await viteBuild({
        ...prodConfig,
        configFile: false,
        logLevel: 'silent',
        build: {
          ...prodConfig.build,
          outDir: tempOutDir,
          emptyOutDir: true,
        },
      });

      const builtHtml = readFileSync(join(tempOutDir, 'index.html'), 'utf8');
      expect(extractCspMetaContent(builtHtml)).toBe(PRODUCTION_CSP);
      expect(builtHtml).not.toContain('unsafe-inline');
      expect(builtHtml).not.toContain('unsafe-eval');
      expect(builtHtml).not.toContain('nonce-');
      expect(builtHtml).not.toContain('csp-nonce');
      expect(builtHtml).not.toContain('ws:');
      expect(builtHtml).not.toContain('wss:');
    } finally {
      rmSync(tempOutDir, { recursive: true, force: true });
    }
  });

  it('configures per-process cspNonce and ws:/wss: only in serve mode without unsafe-inline or unsafe-eval', async () => {
    const serveConfig = createXmlensViteConfig({ command: 'serve' });
    const nonce = serveConfig.html?.cspNonce;
    expect(typeof nonce).toBe('string');
    expect(nonce?.length).toBeGreaterThanOrEqual(16);

    const resolvedServe = await resolveConfig(serveConfig, 'serve');
    expect(resolvedServe.html?.cspNonce).toBe(nonce);

    const resolvedBuild = await resolveConfig(
      createXmlensViteConfig({ command: 'build' }),
      'build',
    );
    expect(resolvedBuild.html?.cspNonce).toBeUndefined();

    const sourceHtml = readFileSync(INDEX_HTML_PATH, 'utf8');
    const servedHtml = applyServeCspToHtml(sourceHtml, nonce);
    const serveCsp = extractCspMetaContent(servedHtml);
    expect(serveCsp).toBe(buildServeCsp(nonce));
    expect(serveCsp).toContain(`'nonce-${nonce}'`);
    expect(serveCsp).toContain('connect-src');
    expect(serveCsp).toContain('ws:');
    expect(serveCsp).not.toContain('unsafe-inline');
    expect(serveCsp).not.toContain('unsafe-eval');
  });
});
