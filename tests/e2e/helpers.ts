import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import enCatalog from '../../locales/en.json';
import jaCatalog from '../../locales/ja.json';

export type LocaleCode = 'en' | 'ja';
export type MessageKey = keyof typeof enCatalog;

const CATALOGS: Readonly<Record<LocaleCode, Readonly<Record<string, string>>>> = {
  en: enCatalog,
  ja: jaCatalog,
};

export function t(
  locale: LocaleCode,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = CATALOGS[locale][key] ?? enCatalog[key];
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const val = params[name];
    return val !== undefined ? String(val) : `{${name}}`;
  });
}

export interface RecordedCspViolation {
  readonly violatedDirective: string;
  readonly effectiveDirective: string;
  readonly blockedURI: string;
  readonly sourceFile: string;
  readonly lineNumber: number;
}

declare global {
  interface Window {
    __xmlensCspViolations?: RecordedCspViolation[];
  }
}

export interface DiagnosticsCollectors {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly disallowedRequests: string[];
  readonly readCspViolations: () => Promise<RecordedCspViolation[]>;
}

const EXPECTED_ORIGIN = 'http://127.0.0.1:3000';

function isAllowedRequestUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return true;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' && parsed.origin === EXPECTED_ORIGIN;
  } catch {
    return false;
  }
}

export async function attachDiagnosticsCollectors(page: Page): Promise<DiagnosticsCollectors> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const disallowedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!isAllowedRequestUrl(url)) {
      disallowedRequests.push(url);
    }
  });

  await page.addInitScript(() => {
    window.__xmlensCspViolations = [];
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        window.__xmlensCspViolations?.push({
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
    disallowedRequests,
    readCspViolations: () => page.evaluate(() => window.__xmlensCspViolations ?? []),
  };
}

export async function assertCleanPage(collectors: DiagnosticsCollectors): Promise<void> {
  expect(await collectors.readCspViolations()).toEqual([]);
  expect(collectors.consoleErrors).toEqual([]);
  expect(collectors.pageErrors).toEqual([]);
  expect(collectors.disallowedRequests).toEqual([]);
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

export interface PlatformShortcuts {
  readonly mod: 'Meta' | 'Control';
  readonly undo: string;
  readonly redo: string;
  readonly search: string;
}

export async function detectPlatformShortcuts(page: Page): Promise<PlatformShortcuts> {
  const isMac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  const mod = isMac ? 'Meta' : 'Control';
  return {
    mod,
    undo: `${mod}+z`,
    redo: isMac ? 'Meta+Shift+z' : 'Control+y',
    search: `${mod}+f`,
  };
}

export async function readEditorLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.getElementById('cm-host');
    const shadow = host?.shadowRoot;
    if (!shadow) {
      return [];
    }
    return Array.from(shadow.querySelectorAll('.cm-line')).map((el) => el.textContent ?? '');
  });
}

export async function readEditorText(page: Page): Promise<string> {
  const lines = await readEditorLines(page);
  return lines.join('\n');
}

export interface ShadowEditorDomState {
  readonly hasShadow: boolean;
  readonly styleElementCount: number;
  readonly adoptedSheetCount: number;
  readonly editorAriaLabel: string | null;
  readonly editorAriaPlaceholder: string | null;
  readonly activeInsideContent: boolean;
  readonly activeControlName: string | null;
}

export async function readShadowEditorDomState(page: Page): Promise<ShadowEditorDomState> {
  return page.evaluate(() => {
    const host = document.getElementById('cm-host');
    const shadow = host?.shadowRoot ?? null;
    const content = shadow?.querySelector('.cm-content') ?? null;
    const active = shadow?.activeElement ?? null;
    return {
      hasShadow: shadow !== null,
      styleElementCount: shadow ? shadow.querySelectorAll('style').length : -1,
      adoptedSheetCount: shadow ? shadow.adoptedStyleSheets.length : -1,
      editorAriaLabel: content?.getAttribute('aria-label') ?? null,
      editorAriaPlaceholder: content?.getAttribute('aria-placeholder') ?? null,
      activeInsideContent: Boolean(active?.classList.contains('cm-content')),
      activeControlName: active?.getAttribute('name') ?? null,
    };
  });
}

export function encodeUtf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export function encodeUtf8BomBytes(text: string): number[] {
  return [0xef, 0xbb, 0xbf, ...encodeUtf8Bytes(text)];
}

export function encodeUtf16LeBomBytes(text: string): number[] {
  const bytes: number[] = [0xff, 0xfe];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes.push(unit & 0xff, (unit >> 8) & 0xff);
  }
  return bytes;
}

type SetInputFileObject = Extract<Parameters<Locator['setInputFiles']>[0], { readonly name: string }>;

export function buildInputFilePayload(
  name: string,
  bytes: readonly number[],
  mimeType = 'application/xml',
): SetInputFileObject {
  const globalWithBuffer = globalThis as unknown as {
    readonly Buffer?: { from(data: readonly number[]): SetInputFileObject['buffer'] };
  };
  if (!globalWithBuffer.Buffer) {
    throw new Error('Node Buffer global is unavailable in Playwright runner.');
  }
  return {
    name,
    mimeType,
    buffer: globalWithBuffer.Buffer.from(bytes),
  };
}

/**
 * Encodes `<?xml version="1.0" encoding="Shift_JIS"?>\n<root>あい</root>` without relying on a
 * runtime Shift_JIS encoder.
 */
export function buildShiftJisSampleBytes(): number[] {
  const header = encodeUtf8Bytes('<?xml version="1.0" encoding="Shift_JIS"?>\n<root>');
  const footer = encodeUtf8Bytes('</root>');
  // Shift_JIS 'あ' = 0x82 0xA0, 'い' = 0x82 0xA2
  return [...header, 0x82, 0xa0, 0x82, 0xa2, ...footer];
}

export interface SyntheticDragResult {
  readonly dragEnterDefaultPrevented: boolean;
  readonly dragOverDefaultPrevented: boolean;
  readonly dropDefaultPrevented: boolean;
  readonly hadDragOverClassOnDragOver: boolean;
  readonly hasDragOverClassAfterDrop: boolean;
}

export async function dispatchSyntheticFileDrop(
  page: Page,
  targetSelectorInShadow: '.cm-content' | '.cm-gutters',
  fileName: string,
  bytes: readonly number[],
  mimeType = 'application/xml',
): Promise<SyntheticDragResult> {
  return page.evaluate(
    ({ selector, name, rawBytes, type }) => {
      const host = document.getElementById('cm-host');
      const target = host?.shadowRoot?.querySelector(selector);
      if (!host || !target) {
        throw new Error(`Missing target ${selector} inside #cm-host shadowRoot`);
      }

      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(rawBytes)], name, { type }));

      const dragEnter = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
      });
      target.dispatchEvent(dragEnter);

      const dragOver = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
      });
      target.dispatchEvent(dragOver);
      const hadDragOverClassOnDragOver = host.classList.contains('is-drag-over');

      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
      });
      target.dispatchEvent(drop);

      return {
        dragEnterDefaultPrevented: dragEnter.defaultPrevented,
        dragOverDefaultPrevented: dragOver.defaultPrevented,
        dropDefaultPrevented: drop.defaultPrevented,
        hadDragOverClassOnDragOver,
        hasDragOverClassAfterDrop: host.classList.contains('is-drag-over'),
      };
    },
    { selector: targetSelectorInShadow, name: fileName, rawBytes: bytes, type: mimeType },
  );
}

export interface SyntheticTextDragResult {
  readonly dragEnterDefaultPrevented: boolean;
  readonly dragOverDefaultPrevented: boolean;
  readonly hadDragOverClass: boolean;
}

export async function dispatchSyntheticPlainTextDrag(
  page: Page,
  textPayload: string,
): Promise<SyntheticTextDragResult> {
  return page.evaluate((payload) => {
    const host = document.getElementById('cm-host');
    const target = host?.shadowRoot?.querySelector('.cm-content');
    if (!host || !target) {
      throw new Error('Missing .cm-content inside #cm-host shadowRoot');
    }

    const dt = new DataTransfer();
    dt.setData('text/plain', payload);

    const dragEnter = new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dt,
    });
    target.dispatchEvent(dragEnter);

    const dragOver = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dt,
    });
    target.dispatchEvent(dragOver);

    return {
      dragEnterDefaultPrevented: dragEnter.defaultPrevented,
      dragOverDefaultPrevented: dragOver.defaultPrevented,
      hadDragOverClass: host.classList.contains('is-drag-over'),
    };
  }, textPayload);
}
