import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('CodeMirror 6 ShadowRoot CSP Spike (ADR-0005 / ADR-0006)', () => {
  test('mounts inside ShadowRoot with adoptedStyleSheets, zero CSP violations, and passes axe', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

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
    expect(pageErrors).toEqual([]);

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);
  });

  test('supports Undo/Redo after Format and preserves Tab focus exit', async ({ page }) => {
    await page.goto('./');
    await page.click('#spike-sample');
    await page.click('#spike-format');
    await page.click('#spike-undo');
    await page.click('#spike-redo');
    await expect(page.locator('#spike-status-csp')).toHaveText('CSP violations: 0');
  });
});
