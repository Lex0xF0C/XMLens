import { expect, test } from '@playwright/test';
import {
  assertCleanPage,
  attachDiagnosticsCollectors,
  buildInputFilePayload,
  buildShiftJisSampleBytes,
  detectPlatformShortcuts,
  dispatchSyntheticFileDrop,
  dispatchSyntheticPlainTextDrag,
  encodeUtf16LeBomBytes,
  encodeUtf8BomBytes,
  encodeUtf8Bytes,
  expectNoAxeViolations,
  readEditorLines,
  readEditorText,
  readShadowEditorDomState,
  t,
  type LocaleCode,
} from './helpers';

const LOCALES: readonly LocaleCode[] = ['en', 'ja'];
const THEMES = ['light', 'dark', 'high-contrast'] as const;

for (const locale of LOCALES) {
  test.describe(`XMLens production app (${locale})`, () => {
    test('mounts inside ShadowRoot with zero CSP/console/network errors and passes axe across states and dialogs', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);

      const editorContent = page.locator('#cm-host .cm-content');
      await expect(editorContent).toBeVisible();

      const shadowState = await readShadowEditorDomState(page);
      expect(shadowState.hasShadow).toBe(true);
      expect(shadowState.styleElementCount).toBe(0);
      expect(shadowState.adoptedSheetCount).toBeGreaterThan(0);
      expect(shadowState.editorAriaLabel).toBe(t(locale, 'pane.editorHeading'));

      await expect(page.locator('.diag-message')).toContainText(t(locale, 'preview.empty'));
      await expectNoAxeViolations(page);

      // Sample loaded state
      await page.getByRole('button', { name: t(locale, 'toolbar.loadSample') }).click();
      await expect(page.locator('footer.status-bar')).toContainText(
        t(locale, 'statusBar.wellFormed'),
      );
      await expectNoAxeViolations(page);

      // About dialog open -> axe -> Escape closes and restores focus
      await page.locator('#about-button').click();
      const aboutDialog = page.locator('dialog.about-dialog:not(.save-dialog)');
      await expect(aboutDialog).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(aboutDialog).not.toBeVisible();
      await expect(page.locator('#about-button')).toBeFocused();

      // Save dialog open -> axe -> Escape closes and restores focus
      await page.locator('#save-button').click();
      const saveDialog = page.locator('dialog.save-dialog');
      await expect(saveDialog).toBeVisible();
      await expect(page.locator('#save-filename-input')).toBeFocused();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(saveDialog).not.toBeVisible();
      await expect(page.locator('#save-button')).toBeFocused();

      // Malformed XML diagnostics state + Search panel open -> axe
      await editorContent.click();
      const shortcuts = await detectPlatformShortcuts(page);
      await page.keyboard.press(`${shortcuts.mod}+a`);
      await page.keyboard.type('<root><broken></root>');
      await expect(page.locator('.diag-list .diag-item-btn').first()).toBeVisible();
      await expect(page.locator('footer.status-bar')).toContainText(
        t(locale, 'statusBar.notWellFormed'),
      );

      await page.locator('#search-button').click();
      await expect(page.locator('#cm-host .cm-panel.cm-search')).toBeVisible();
      await expectNoAxeViolations(page);

      await assertCleanPage(collectors);
    });

    test('passes axe WCAG 2.2 AA across Light, Dark, and High contrast themes with diagnostics and Search panel', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);

      const editorContent = page.locator('#cm-host .cm-content');
      await editorContent.click();
      await page.keyboard.type('<root><broken></root>');
      await expect(page.locator('.diag-list .diag-item-btn').first()).toBeVisible();

      await page.locator('#search-button').click();
      await expect(page.locator('#cm-host .cm-panel.cm-search')).toBeVisible();

      for (const theme of THEMES) {
        await page.locator('#theme-select').selectOption(theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectNoAxeViolations(page);
      }

      await assertCleanPage(collectors);
    });

    test('updates UI and ShadowRoot attributes in-place on language switch while preserving focus, selection, text, and Undo', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      const otherLocale: LocaleCode = locale === 'en' ? 'ja' : 'en';
      await page.goto(`./?lang=${locale}`);

      // Empty document: switching #locale-select updates placeholder inside ShadowRoot
      await expect(page.locator('#cm-host .cm-placeholder')).toContainText(
        t(locale, 'preview.placeholder'),
      );
      await page.locator('#locale-select').selectOption(otherLocale);
      await expect(page.locator('html')).toHaveAttribute('lang', otherLocale);
      await expect(page.locator('#cm-host .cm-placeholder')).toContainText(
        t(otherLocale, 'preview.placeholder'),
      );
      await page.locator('#locale-select').selectOption(locale);

      // Non-empty focused document: verify applyLocale preserves Undo history, focus, selection, and text
      const editorContent = page.locator('#cm-host .cm-content');
      await editorContent.click();
      await page.keyboard.type('<doc><child/></doc>');
      await page.locator('#format-button').click();
      await expect.poll(async () => (await readEditorLines(page)).length).toBeGreaterThan(1);

      // Focus editor, switch locale in-place, and confirm Format Undo history survived
      await editorContent.click();
      await page.evaluate((nextLocale) => {
        const select = document.getElementById('locale-select') as HTMLSelectElement | null;
        if (!select) {
          throw new Error('Missing #locale-select');
        }
        select.value = nextLocale;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, otherLocale);

      await expect(page.locator('html')).toHaveAttribute('lang', otherLocale);
      await expect(page.locator('#format-button')).toHaveText(t(otherLocale, 'toolbar.format'));
      await expect(page.locator('footer.status-bar')).toContainText(
        t(otherLocale, 'statusBar.language'),
      );

      const shadowAfterFirstSwitch = await readShadowEditorDomState(page);
      expect(shadowAfterFirstSwitch.editorAriaLabel).toBe(t(otherLocale, 'pane.editorHeading'));
      expect(shadowAfterFirstSwitch.activeInsideContent).toBe(true);

      const shortcuts = await detectPlatformShortcuts(page);
      await page.keyboard.press(shortcuts.undo);
      await expect.poll(() => readEditorText(page)).toBe('<doc><child/></doc>');

      // Type text, select it, switch locale in-place back to initial locale, and verify selection/focus
      await page.keyboard.press(`${shortcuts.mod}+a`);
      await page.keyboard.type('<doc>alpha');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Shift+ArrowLeft');
      }

      await page.evaluate((nextLocale) => {
        const select = document.getElementById('locale-select') as HTMLSelectElement | null;
        if (!select) {
          throw new Error('Missing #locale-select');
        }
        select.value = nextLocale;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, locale);

      const shadowAfterSecondSwitch = await readShadowEditorDomState(page);
      expect(shadowAfterSecondSwitch.editorAriaLabel).toBe(t(locale, 'pane.editorHeading'));
      expect(shadowAfterSecondSwitch.activeInsideContent).toBe(true);

      await page.keyboard.type('BETA');
      const textAfterReplace = await readEditorText(page);
      expect(textAfterReplace).toBe('<doc>BETA');

      await assertCleanPage(collectors);
    });

    test('resets Undo history on sample load and supports single-step Format -> Undo -> Redo', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);
      const shortcuts = await detectPlatformShortcuts(page);

      const editorContent = page.locator('#cm-host .cm-content');
      await editorContent.click();
      await page.keyboard.type('<prior/>');

      // Load sample replaces EditorState and clears prior Undo history
      await page.getByRole('button', { name: t(locale, 'toolbar.loadSample') }).click();
      await expect(page.locator('footer.status-bar')).toContainText(
        t(locale, 'statusBar.wellFormed'),
      );
      const sampleText = await readEditorText(page);
      expect(sampleText).toContain('<akomaNtoso');

      await editorContent.click();
      await page.keyboard.press(shortcuts.undo);
      expect(await readEditorText(page)).toBe(sampleText);

      // Format -> Undo -> Redo in single steps
      await page.keyboard.press(`${shortcuts.mod}+a`);
      await page.keyboard.type('<root><a><b/></a></root>');
      await expect(page.locator('footer.status-bar')).toContainText(
        t(locale, 'statusBar.wellFormed'),
      );

      await page.locator('#format-button').click();
      await expect.poll(async () => (await readEditorLines(page)).length).toBeGreaterThan(1);
      const formattedText = await readEditorText(page);

      await editorContent.click();
      await page.keyboard.press(shortcuts.undo);
      await expect.poll(() => readEditorText(page)).toBe('<root><a><b/></a></root>');

      await page.keyboard.press(shortcuts.redo);
      await expect.poll(() => readEditorText(page)).toBe(formattedText);

      await assertCleanPage(collectors);
    });

    test('supports Tab / Shift+Tab focus exit without inserting tabs and keyboard Search panel flow', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);
      const shortcuts = await detectPlatformShortcuts(page);

      const editorContent = page.locator('#cm-host .cm-content');
      await editorContent.click();
      await page.keyboard.type('<root><broken></root>');
      const firstDiagBtn = page.locator('.diag-list .diag-item-btn').first();
      await expect(firstDiagBtn).toBeVisible();

      const beforeTabText = await readEditorText(page);
      await editorContent.click();
      await page.keyboard.press('Tab');
      await expect(firstDiagBtn).toBeFocused();
      expect(await readEditorText(page)).toBe(beforeTabText);

      await editorContent.click();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#theme-select')).toBeFocused();
      expect(await readEditorText(page)).toBe(beforeTabText);

      // Search panel via toolbar button -> Tab navigation -> Escape returns focus to .cm-content
      await page.locator('#search-button').click();
      const searchPanel = page.locator('#cm-host .cm-panel.cm-search');
      await expect(searchPanel).toBeVisible();
      expect((await readShadowEditorDomState(page)).activeControlName).toBe('search');

      await page.keyboard.press('Tab');
      expect((await readShadowEditorDomState(page)).activeControlName).not.toBe('search');
      expect((await readShadowEditorDomState(page)).activeInsideContent).toBe(false);

      await page.keyboard.press('Escape');
      await expect(searchPanel).toHaveCount(0);
      expect((await readShadowEditorDomState(page)).activeInsideContent).toBe(true);

      // Search panel via Mod+F shortcut -> Escape returns focus to .cm-content
      await page.keyboard.press(shortcuts.search);
      await expect(searchPanel).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(searchPanel).toHaveCount(0);
      expect((await readShadowEditorDomState(page)).activeInsideContent).toBe(true);

      await assertCleanPage(collectors);
    });

    test('opens UTF-8, UTF-8 BOM, UTF-16LE BOM, Shift_JIS, and rejects >1 MiB files via file input', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);

      const fileInput = page.locator('input.hidden-file-input');
      const statusBar = page.locator('footer.status-bar');

      await fileInput.setInputFiles({
        name: 'utf8.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(
          encodeUtf8Bytes('<?xml version="1.0" encoding="UTF-8"?>\n<root>日本語UTF8</root>'),
        ),
      });
      await expect.poll(() => readEditorText(page)).toContain('日本語UTF8');
      await expect(statusBar).toContainText(t(locale, 'statusBar.encoding', { value: 'UTF-8' }));
      await expect(statusBar).toContainText(t(locale, 'statusBar.wellFormed'));

      await fileInput.setInputFiles({
        name: 'utf8-bom.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(encodeUtf8BomBytes('<root>BOMテスト</root>')),
      });
      await expect.poll(() => readEditorText(page)).toContain('BOMテスト');
      await expect(statusBar).toContainText(
        t(locale, 'statusBar.encoding', {
          value: t(locale, 'statusBar.encodingWithBom', { encoding: 'UTF-8' }),
        }),
      );

      await fileInput.setInputFiles({
        name: 'utf16le.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(
          encodeUtf16LeBomBytes(
            '<?xml version="1.0" encoding="UTF-16"?>\n<root>UTF16テスト</root>',
          ),
        ),
      });
      await expect.poll(() => readEditorText(page)).toContain('UTF16テスト');
      await expect(statusBar).toContainText(
        t(locale, 'statusBar.encoding', {
          value: t(locale, 'statusBar.encodingWithBom', { encoding: 'UTF-16LE' }),
        }),
      );

      await fileInput.setInputFiles({
        name: 'sjis.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(buildShiftJisSampleBytes()),
      });
      await expect.poll(() => readEditorText(page)).toContain('<root>あい</root>');
      await expect(statusBar).toContainText(
        t(locale, 'statusBar.encoding', { value: 'Shift_JIS' }),
      );
      await expect(statusBar).toContainText(t(locale, 'statusBar.wellFormed'));

      const oversizedPayload = `<root>${'a'.repeat(1024 * 1024 + 64)}</root>`;
      await fileInput.setInputFiles({
        name: 'too-large.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(encodeUtf8Bytes(oversizedPayload)),
      });
      await expect(statusBar).toContainText(t(locale, 'statusBar.tooLarge'));
      await expect(page.locator('.diag-message')).toContainText(
        t(locale, 'preview.tooLarge', { limitMb: 1 }),
      );

      await assertCleanPage(collectors);
    });

    test('intercepts file drops on .cm-content and .cm-gutters, resets Undo, and ignores plain-text drags', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);
      const shortcuts = await detectPlatformShortcuts(page);

      const editorContent = page.locator('#cm-host .cm-content');
      const statusBar = page.locator('footer.status-bar');

      // 1. Drop onto .cm-content
      await editorContent.click();
      await page.keyboard.type('<beforeContentDrop/>');

      const contentDrop = await dispatchSyntheticFileDrop(
        page,
        '.cm-content',
        'dropped-content.xml',
        encodeUtf8BomBytes('<root>FromContentDrop</root>'),
      );
      expect(contentDrop.dragEnterDefaultPrevented).toBe(true);
      expect(contentDrop.dragOverDefaultPrevented).toBe(true);
      expect(contentDrop.dropDefaultPrevented).toBe(true);
      expect(contentDrop.hadDragOverClassOnDragOver).toBe(true);
      expect(contentDrop.hasDragOverClassAfterDrop).toBe(false);

      await expect.poll(() => readEditorText(page)).toBe('<root>FromContentDrop</root>');
      await expect(statusBar).toContainText(
        t(locale, 'statusBar.encoding', {
          value: t(locale, 'statusBar.encodingWithBom', { encoding: 'UTF-8' }),
        }),
      );
      await editorContent.click();
      await page.keyboard.press(shortcuts.undo);
      expect(await readEditorText(page)).toBe('<root>FromContentDrop</root>');

      // 2. Drop onto .cm-gutters (must cross ShadowRoot via composed: true)
      await page.keyboard.press(`${shortcuts.mod}+a`);
      await page.keyboard.type('<beforeGutterDrop/>');

      const gutterDrop = await dispatchSyntheticFileDrop(
        page,
        '.cm-gutters',
        'dropped-gutter.xml',
        buildShiftJisSampleBytes(),
      );
      expect(gutterDrop.dragEnterDefaultPrevented).toBe(true);
      expect(gutterDrop.dragOverDefaultPrevented).toBe(true);
      expect(gutterDrop.dropDefaultPrevented).toBe(true);
      expect(gutterDrop.hadDragOverClassOnDragOver).toBe(true);
      expect(gutterDrop.hasDragOverClassAfterDrop).toBe(false);

      await expect.poll(() => readEditorText(page)).toContain('<root>あい</root>');
      await expect(statusBar).toContainText(
        t(locale, 'statusBar.encoding', { value: 'Shift_JIS' }),
      );
      await editorContent.click();
      await page.keyboard.press(shortcuts.undo);
      expect(await readEditorText(page)).toContain('<root>あい</root>');

      // 3. Plain-text non-file drag must NOT be intercepted
      const textDrag = await dispatchSyntheticPlainTextDrag(page, '<ignored/>');
      expect(textDrag.dragEnterDefaultPrevented).toBe(false);
      expect(textDrag.dragOverDefaultPrevented).toBe(false);
      expect(textDrag.hadDragOverClass).toBe(false);

      await assertCleanPage(collectors);
    });

    test('triggers debounced diagnostics after typing and jumps caret + updates XPath on diagnostic click', async ({
      page,
    }) => {
      const collectors = await attachDiagnosticsCollectors(page);
      await page.goto(`./?lang=${locale}`);

      const editorContent = page.locator('#cm-host .cm-content');
      await editorContent.click();
      await page.keyboard.type('<root><broken></root><tail/>');

      const diagBtn = page.locator('.diag-list .diag-item-btn').first();
      await expect(diagBtn).toBeVisible();
      await expect(page.locator('#cm-host .cm-lintRange-error').first()).toBeVisible();

      // Move caret back to offset 0 before `<root>` and verify XPath clears to `—`
      await editorContent.click();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('ArrowLeft');
      }
      await expect(page.locator('#status-xpath')).toHaveText(
        t(locale, 'statusBar.xpath', { value: t(locale, 'statusBar.xpathNone') }),
      );

      // Click diagnostic button -> focuses editor, moves caret to error offset, updates XPath
      await diagBtn.click();
      expect((await readShadowEditorDomState(page)).activeInsideContent).toBe(true);
      await expect(page.locator('#status-xpath')).toContainText('/root');

      await assertCleanPage(collectors);
    });
  });
}
