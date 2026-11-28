import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface RecordedCspViolation {
  readonly violatedDirective: string;
  readonly effectiveDirective: string;
  readonly blockedURI: string;
  readonly sourceFile: string;
  readonly lineNumber: number;
}

declare global {
  interface Window {
    __xmlensSpikeCspViolations?: RecordedCspViolation[];
  }
}

async function attachDiagnosticsCollectors(page: Page): Promise<{
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly readCspViolations: () => Promise<RecordedCspViolation[]>;
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.addInitScript(() => {
    window.__xmlensSpikeCspViolations = [];
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        window.__xmlensSpikeCspViolations?.push({
          violatedDirective: event.violatedDirective,
          effectiveDirective: event.effectiveDirective,
          blockedURI: event.blockedURI,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
        });
      },
      true,
    );
  });

  return {
    consoleErrors,
    pageErrors,
    readCspViolations: () => page.evaluate(() => window.__xmlensSpikeCspViolations ?? []),
  };
}

test.describe('CodeMirror 6 ShadowRoot CSP Spike (ADR-0005 / ADR-0006)', () => {
  test('mounts inside ShadowRoot with adoptedStyleSheets, zero CSP/console/page errors, and passes axe', async ({
    page,
  }) => {
    const collectors = await attachDiagnosticsCollectors(page);

    await page.goto('./');
    await page.click('#spike-sample');

    await expect(page.locator('#spike-status-state')).toContainText('Well-formed');
    await expect(page.locator('#spike-status-csp')).toHaveText('CSP violations: 0');

    const shadowStats = await page.evaluate(() => {
      const host = document.getElementById('cm-host');
      const shadow = host?.shadowRoot;
      return {
        hasShadow: Boolean(shadow),
        styleElementCount: shadow ? shadow.querySelectorAll('style').length : -1,
        adoptedSheetCount: shadow ? shadow.adoptedStyleSheets.length : -1,
        editorAriaLabel: shadow?.querySelector('.cm-content')?.getAttribute('aria-label') ?? null,
      };
    });

    expect(shadowStats.hasShadow).toBe(true);
    expect(shadowStats.styleElementCount).toBe(0);
    expect(shadowStats.adoptedSheetCount).toBeGreaterThan(0);
    expect(shadowStats.editorAriaLabel).toBe('XML Input');

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);

    expect(await collectors.readCspViolations()).toEqual([]);
    expect(collectors.consoleErrors).toEqual([]);
    expect(collectors.pageErrors).toEqual([]);
  });

  test('supports Undo/Redo after Format, Tab focus exit, and zero CSP/console errors', async ({
    page,
  }) => {
    const collectors = await attachDiagnosticsCollectors(page);

    await page.goto('./');
    await page.click('#spike-sample');
    await expect(page.locator('#spike-status-state')).toContainText('Well-formed');

    await page.click('#spike-format');
    await page.click('#spike-undo');
    await page.click('#spike-redo');

    const editorContent = page.locator('#cm-host .cm-content');
    await editorContent.click();
    const beforeTabText = await editorContent.textContent();
    await page.keyboard.press('Tab');

    const afterTabState = await page.evaluate(() => {
      const host = document.getElementById('cm-host');
      const shadow = host?.shadowRoot;
      return {
        shadowActiveTag: shadow?.activeElement?.tagName ?? null,
        afterText: shadow?.querySelector('.cm-content')?.textContent ?? null,
      };
    });

    expect(afterTabState.shadowActiveTag).toBeNull();
    expect(afterTabState.afterText).toBe(beforeTabText);

    expect(await collectors.readCspViolations()).toEqual([]);
    expect(collectors.consoleErrors).toEqual([]);
    expect(collectors.pageErrors).toEqual([]);
  });
});
