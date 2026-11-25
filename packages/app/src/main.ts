import {
  formatMessage,
  type Diagnostic,
  type LocaleCode,
  type MessageCatalog,
  type WellFormednessResult,
} from '@xmlens/core';
import { createWellFormednessWorkerClient } from '@xmlens/workers';
import enCatalog from '../../../locales/en.json';
import jaCatalog from '../../../locales/ja.json';
import { decodeXmlBytes, ENCODING_OVERRIDE_OPTIONS, type EncodingOverride } from './decodeXml';
import './styles.css';

type ThemeMode = 'light' | 'dark' | 'high-contrast';
type MessageKey = keyof typeof enCatalog;

const CATALOGS: Readonly<Record<LocaleCode, MessageCatalog>> = {
  en: enCatalog,
  ja: jaCatalog,
};

const APP_VERSION = '0.1.0';
const STORAGE_LANG_KEY = 'xmlens.locale';
const STORAGE_THEME_KEY = 'xmlens.theme';
const MAX_PREVIEW_BYTES = 1024 * 1024;
const INPUT_DEBOUNCE_MS = 300;

function detectInitialLocale(): LocaleCode {
  const params = new URLSearchParams(window.location.search);
  const queryLang = params.get('lang');
  if (queryLang === 'en' || queryLang === 'ja') {
    return queryLang;
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_LANG_KEY);
    if (saved === 'en' || saved === 'ja') {
      return saved;
    }
  } catch {
    // Ignore storage access restrictions.
  }

  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function detectInitialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'high-contrast') {
      return saved;
    }
  } catch {
    // Ignore storage access restrictions.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    text?: string;
    attrs?: Readonly<Record<string, string>>;
  },
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.className) {
    el.className = options.className;
  }
  if (options?.text !== undefined) {
    el.textContent = options.text;
  }
  if (options?.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      el.setAttribute(k, v);
    }
  }
  return el;
}

type ValidationStatus =
  | { readonly kind: 'empty' }
  | { readonly kind: 'checked'; readonly result: WellFormednessResult }
  | { readonly kind: 'too-large'; readonly limitMb: number }
  | {
      readonly kind: 'decode-error';
      readonly failureReason: 'unsupported' | 'decode-error';
      readonly encoding: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly kind: 'read-error'; readonly detail: string }
  | { readonly kind: 'worker-timeout' }
  | { readonly kind: 'worker-error'; readonly detail: string };

interface LoadedEncodingInfo {
  readonly encoding: string;
  readonly hasBom: boolean;
}

function isEncodingOverride(value: string): value is EncodingOverride {
  return (ENCODING_OVERRIDE_OPTIONS as readonly string[]).includes(value);
}

function mountApp(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  let locale: LocaleCode = detectInitialLocale();
  let theme: ThemeMode = detectInitialTheme();
  let encodingOverride: EncodingOverride = 'auto';
  let loadedFileBytes: Uint8Array | null = null;
  let isModifiedSinceLoad = false;
  let loadedEncodingInfo: LoadedEncodingInfo | null = null;
  let lastAssumedEncoding: string | undefined;
  let lastPreDiagnostics: readonly Diagnostic[] = [];
  let xmlDraft = '';
  let validationStatus: ValidationStatus = { kind: 'empty' };
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let checkEpoch = 0;

  const workerClient = createWellFormednessWorkerClient(
    () =>
      new Worker(new URL('../../workers/src/xmlWorker.ts', import.meta.url), { type: 'module' }),
  );
  window.addEventListener('pagehide', () => {
    workerClient.dispose();
  });

  const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
    formatMessage(CATALOGS[locale], CATALOGS.en, key, params);

  const severityLabel = (severity: Diagnostic['severity']): string => {
    if (severity === 'error') {
      return t('severity.error');
    }
    if (severity === 'warning') {
      return t('severity.warning');
    }
    return t('severity.info');
  };

  const applyDocumentAttributes = (): void => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    document.title = `${t('app.name')} — ${t('app.tagline')}`;
  };

  let activeTextarea: HTMLTextAreaElement | null = null;
  let updateViewsFn: (() => void) | null = null;
  let setCheckingStateFn: (() => void) | null = null;

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runWorkerCheck = async (
    xmlText: string,
    checkOptions?: {
      readonly assumedEncoding?: string;
      readonly preDiagnostics?: readonly Diagnostic[];
    },
  ): Promise<void> => {
    const epoch = ++checkEpoch;
    const trimmed = xmlText.trim();
    if (!trimmed) {
      workerClient.cancel();
      validationStatus = { kind: 'empty' };
      updateViewsFn?.();
      return;
    }

    if (new TextEncoder().encode(xmlText).byteLength > MAX_PREVIEW_BYTES) {
      workerClient.cancel();
      validationStatus = { kind: 'too-large', limitMb: 1 };
      updateViewsFn?.();
      return;
    }

    setCheckingStateFn?.();
    const workerOptions =
      checkOptions?.assumedEncoding !== undefined
        ? { assumedEncoding: checkOptions.assumedEncoding }
        : undefined;
    const outcome = await workerClient.check(xmlText, workerOptions);
    if (epoch !== checkEpoch || outcome.status === 'cancelled') {
      return;
    }

    if (outcome.status === 'ok') {
      const preDiags = checkOptions?.preDiagnostics ?? [];
      const result: WellFormednessResult =
        preDiags.length > 0
          ? {
              ...outcome.result,
              diagnostics: [...preDiags, ...outcome.result.diagnostics],
            }
          : outcome.result;
      validationStatus = { kind: 'checked', result };
    } else if (outcome.status === 'timeout') {
      validationStatus = { kind: 'worker-timeout' };
    } else {
      validationStatus = { kind: 'worker-error', detail: outcome.message };
    }
    updateViewsFn?.();
  };

  const decodeAndCheckLoadedBytes = async (bytes: Uint8Array): Promise<void> => {
    clearDebounce();
    const decoded = decodeXmlBytes(bytes, encodingOverride);
    if (!decoded.ok) {
      ++checkEpoch;
      workerClient.cancel();
      xmlDraft = '';
      if (activeTextarea) {
        activeTextarea.value = '';
      }
      loadedEncodingInfo = { encoding: decoded.encoding, hasBom: decoded.hasBom };
      lastAssumedEncoding = undefined;
      lastPreDiagnostics = [];
      validationStatus = {
        kind: 'decode-error',
        failureReason: decoded.failureReason,
        encoding: decoded.encoding,
        diagnostics: decoded.diagnostics,
      };
      updateViewsFn?.();
      return;
    }

    xmlDraft = decoded.text;
    if (activeTextarea) {
      activeTextarea.value = xmlDraft;
    }
    loadedEncodingInfo = { encoding: decoded.encoding, hasBom: decoded.hasBom };
    lastAssumedEncoding = decoded.assumedEncoding;
    lastPreDiagnostics = decoded.diagnostics;
    await runWorkerCheck(xmlDraft, {
      assumedEncoding: decoded.assumedEncoding,
      preDiagnostics: decoded.diagnostics,
    });
  };

  const render = (): void => {
    applyDocumentAttributes();
    root.replaceChildren();

    const workbench = createEl('div', { className: 'workbench' });

    const skipLink = createEl('a', {
      className: 'skip-link',
      text: t('app.skipToMain'),
      attrs: { href: '#main-content' },
    });
    workbench.appendChild(skipLink);

    const titleBar = createEl('header', { className: 'title-bar' });
    titleBar.appendChild(createEl('h1', { className: 'app-title', text: t('app.name') }));
    workbench.appendChild(titleBar);

    const toolbar = createEl('div', {
      className: 'toolbar',
      attrs: { role: 'toolbar', 'aria-label': t('toolbar.label') },
    });

    const actionsGroup = createEl('div', { className: 'toolbar-actions' });
    const fileInput = createEl('input', {
      className: 'hidden-file-input',
      attrs: {
        type: 'file',
        accept: '.xml,.xsd,.xsl,.xslt,.sch,.rng,.svg,application/xml,text/xml',
        tabindex: '-1',
        'aria-hidden': 'true',
      },
    });

    const openBtn = createEl('button', {
      className: 'tb-btn',
      text: t('toolbar.openFile'),
      attrs: { type: 'button' },
    });
    openBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    const sampleBtn = createEl('button', {
      className: 'tb-btn',
      text: t('toolbar.loadSample'),
      attrs: { type: 'button' },
    });

    const checkBtn = createEl('button', {
      className: 'tb-btn',
      text: t('toolbar.checkWellFormedness'),
      attrs: { type: 'button' },
    });

    const aboutBtn = createEl('button', {
      className: 'tb-btn',
      text: t('toolbar.about'),
      attrs: { id: 'about-button', type: 'button' },
    });

    actionsGroup.append(
      fileInput,
      openBtn,
      sampleBtn,
      checkBtn,
      createEl('span', { className: 'toolbar-sep', attrs: { 'aria-hidden': 'true' } }),
      aboutBtn,
    );

    const settingsGroup = createEl('div', {
      className: 'toolbar-settings',
      attrs: { role: 'group', 'aria-label': t('nav.settingsLabel') },
    });

    const langGroup = createEl('div', { className: 'control-group' });
    const langLabel = createEl('label', {
      className: 'control-label',
      text: t('nav.language'),
      attrs: { for: 'locale-select' },
    });
    const langSelect = createEl('select', {
      className: 'tb-select',
      attrs: { id: 'locale-select' },
    });
    for (const code of ['en', 'ja'] as const) {
      const opt = createEl('option', {
        text: code === 'en' ? 'English' : '日本語',
        attrs: { value: code },
      });
      opt.selected = locale === code;
      langSelect.appendChild(opt);
    }
    langSelect.addEventListener('change', () => {
      const next = langSelect.value === 'ja' ? 'ja' : 'en';
      locale = next;
      try {
        window.localStorage.setItem(STORAGE_LANG_KEY, next);
      } catch {
        // Ignore storage access restrictions.
      }
      render();
      document.getElementById('locale-select')?.focus();
    });
    langGroup.append(langLabel, langSelect);

    const themeGroup = createEl('div', { className: 'control-group' });
    const themeLabel = createEl('label', {
      className: 'control-label',
      text: t('nav.theme'),
      attrs: { for: 'theme-select' },
    });
    const themeSelect = createEl('select', {
      className: 'tb-select',
      attrs: { id: 'theme-select' },
    });
    const themes: ReadonlyArray<readonly [ThemeMode, string]> = [
      ['light', t('theme.light')],
      ['dark', t('theme.dark')],
      ['high-contrast', t('theme.highContrast')],
    ];
    for (const [mode, label] of themes) {
      const opt = createEl('option', {
        text: label,
        attrs: { value: mode },
      });
      opt.selected = theme === mode;
      themeSelect.appendChild(opt);
    }
    themeSelect.addEventListener('change', () => {
      const val = themeSelect.value;
      if (val === 'light' || val === 'dark' || val === 'high-contrast') {
        theme = val;
        try {
          window.localStorage.setItem(STORAGE_THEME_KEY, val);
        } catch {
          // Ignore storage access restrictions.
        }
        applyDocumentAttributes();
      }
    });
    themeGroup.append(themeLabel, themeSelect);

    const encodingGroup = createEl('div', { className: 'control-group' });
    const encodingLabel = createEl('label', {
      className: 'control-label',
      text: t('nav.fileEncoding'),
      attrs: { for: 'encoding-select' },
    });
    const encodingSelect = createEl('select', {
      className: 'tb-select',
      attrs: { id: 'encoding-select' },
    });
    for (const optionValue of ENCODING_OVERRIDE_OPTIONS) {
      const opt = createEl('option', {
        text: optionValue === 'auto' ? t('encoding.auto') : optionValue,
        attrs: { value: optionValue },
      });
      opt.selected = encodingOverride === optionValue;
      encodingSelect.appendChild(opt);
    }
    encodingSelect.addEventListener('change', () => {
      if (isEncodingOverride(encodingSelect.value)) {
        encodingOverride = encodingSelect.value;
        if (loadedFileBytes !== null && !isModifiedSinceLoad) {
          void decodeAndCheckLoadedBytes(loadedFileBytes);
        }
      }
    });
    encodingGroup.append(encodingLabel, encodingSelect);

    settingsGroup.append(encodingGroup, langGroup, themeGroup);
    toolbar.append(actionsGroup, settingsGroup);
    workbench.appendChild(toolbar);

    const workspace = createEl('main', {
      className: 'workspace',
      attrs: { id: 'main-content', tabindex: '-1' },
    });

    const editorPane = createEl('section', {
      className: 'pane',
      attrs: { 'aria-labelledby': 'editor-pane-heading' },
    });
    editorPane.appendChild(
      createEl('h2', {
        className: 'pane-header',
        text: t('pane.editorHeading'),
        attrs: { id: 'editor-pane-heading' },
      }),
    );

    const textarea = createEl('textarea', {
      className: 'xml-textarea',
      attrs: {
        id: 'xml-preview-input',
        'aria-labelledby': 'editor-pane-heading',
        placeholder: t('preview.placeholder'),
        spellcheck: 'false',
      },
    });
    textarea.value = xmlDraft;
    activeTextarea = textarea;

    textarea.addEventListener('input', () => {
      xmlDraft = textarea.value;
      isModifiedSinceLoad = true;
      lastAssumedEncoding = undefined;
      lastPreDiagnostics = [];
      clearDebounce();
      workerClient.cancel();
      const scheduledText = xmlDraft;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runWorkerCheck(scheduledText);
      }, INPUT_DEBOUNCE_MS);
    });
    editorPane.appendChild(textarea);

    const diagnosticsPane = createEl('section', {
      className: 'pane',
      attrs: { 'aria-labelledby': 'diagnostics-pane-heading' },
    });
    diagnosticsPane.appendChild(
      createEl('h2', {
        className: 'pane-header',
        text: t('pane.diagnosticsHeading'),
        attrs: { id: 'diagnostics-pane-heading' },
      }),
    );

    const diagnosticsBody = createEl('div', { className: 'diagnostics-body' });
    const resultBox = createEl('div', {
      className: 'diag-message',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const diagListContainer = createEl('div', { className: 'diag-list-container' });
    diagnosticsBody.append(resultBox, diagListContainer);
    diagnosticsPane.appendChild(diagnosticsBody);

    workspace.append(editorPane, diagnosticsPane);
    workbench.appendChild(workspace);

    const statusBar = createEl('footer', {
      className: 'status-bar',
      attrs: { role: 'contentinfo', 'aria-label': t('statusBar.label') },
    });
    const statusFields = createEl('div', { className: 'status-fields' });
    const statusStateField = createEl('span', { className: 'status-field' });
    const statusCountField = createEl('span', { className: 'status-field' });
    const statusEncodingField = createEl('span', { className: 'status-field' });
    const statusLangField = createEl('span', {
      className: 'status-field',
      text: t('statusBar.language'),
    });
    statusFields.append(statusStateField, statusCountField, statusEncodingField, statusLangField);

    const statusPrivacyField = createEl('span', {
      className: 'status-field',
      text: t('statusBar.localOnly'),
    });
    statusBar.append(statusFields, statusPrivacyField);
    workbench.appendChild(statusBar);

    const aboutDialog = createEl('dialog', {
      className: 'about-dialog',
      attrs: { 'aria-labelledby': 'about-dialog-title' },
    });
    const aboutHeader = createEl('div', { className: 'about-header' });
    aboutHeader.appendChild(
      createEl('h2', {
        className: 'about-title',
        text: t('about.title'),
        attrs: { id: 'about-dialog-title' },
      }),
    );
    const aboutBody = createEl('div', { className: 'about-body' });
    const noticesParagraph = createEl('p', { text: t('about.noticesLabel') });
    noticesParagraph.appendChild(
      createEl('a', {
        className: 'about-link',
        text: t('about.noticesLink'),
        attrs: {
          href: './THIRD_PARTY_NOTICES.md',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    );
    aboutBody.append(
      createEl('p', { text: t('about.version', { version: APP_VERSION }) }),
      createEl('p', { text: t('about.license') }),
      createEl('p', { text: t('about.privacy') }),
      noticesParagraph,
    );
    const aboutFooter = createEl('div', { className: 'about-footer' });
    const aboutCloseBtn = createEl('button', {
      className: 'tb-btn',
      text: t('about.close'),
      attrs: { type: 'button' },
    });
    aboutFooter.appendChild(aboutCloseBtn);
    aboutDialog.append(aboutHeader, aboutBody, aboutFooter);
    workbench.appendChild(aboutDialog);

    const renderDiagnosticsList = (
      diagnostics: readonly Diagnostic[],
      truncatedDiagnostics: boolean,
    ): void => {
      diagListContainer.replaceChildren();
      if (diagnostics.length === 0) {
        return;
      }

      const list = createEl('ul', {
        className: 'diag-list',
        attrs: { 'aria-label': t('diagnostics.listLabel') },
      });

      for (const diag of diagnostics) {
        const item = createEl('li', { className: `diag-item is-${diag.severity}` });
        const jumpBtn = createEl('button', {
          className: 'diag-item-btn',
          attrs: { type: 'button' },
        });

        jumpBtn.appendChild(
          createEl('span', {
            className: `diag-severity is-${diag.severity}`,
            text: severityLabel(diag.severity),
          }),
        );

        if (diag.range) {
          jumpBtn.appendChild(
            createEl('span', {
              className: 'diag-loc',
              text: t('diagnostics.location', {
                line: diag.range.line,
                column: diag.range.column,
              }),
            }),
          );
        }

        const localizedMsg = formatMessage(
          CATALOGS[locale],
          CATALOGS.en,
          diag.messageKey,
          diag.params,
        );
        jumpBtn.appendChild(createEl('span', { className: 'diag-text', text: localizedMsg }));

        jumpBtn.addEventListener('click', () => {
          const target = activeTextarea;
          if (!target) {
            return;
          }
          const rawOffset = diag.range?.offset ?? 0;
          const clampedOffset = Math.min(Math.max(0, rawOffset), target.value.length);
          target.focus();
          target.setSelectionRange(clampedOffset, clampedOffset);
        });

        item.appendChild(jumpBtn);

        const rawDetail = diag.params?.detail;
        if (typeof rawDetail === 'string' && rawDetail.length > 0) {
          const details = createEl('details', { className: 'diag-raw-details' });
          details.append(
            createEl('summary', {
              className: 'diag-raw-summary',
              text: t('diagnostics.rawDetail'),
            }),
            createEl('code', { className: 'diag-raw-code', text: rawDetail }),
          );
          item.appendChild(details);
        }

        list.appendChild(item);
      }

      diagListContainer.appendChild(list);

      if (truncatedDiagnostics) {
        diagListContainer.appendChild(
          createEl('p', {
            className: 'diag-truncated',
            text: t('diagnostics.truncated', { shown: diagnostics.length }),
          }),
        );
      }
    };

    const updateStatusViews = (): void => {
      resultBox.classList.remove('is-valid', 'is-invalid', 'has-warnings');
      diagListContainer.replaceChildren();

      const encodingValue =
        loadedEncodingInfo === null
          ? t('statusBar.encodingNone')
          : loadedEncodingInfo.hasBom
            ? t('statusBar.encodingWithBom', { encoding: loadedEncodingInfo.encoding })
            : loadedEncodingInfo.encoding;
      statusEncodingField.textContent = t('statusBar.encoding', { value: encodingValue });

      if (validationStatus.kind === 'empty') {
        resultBox.textContent = t('preview.empty');
        statusStateField.textContent = t('statusBar.ready');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'too-large') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.tooLarge', {
          limitMb: validationStatus.limitMb,
        });
        statusStateField.textContent = t('statusBar.tooLarge');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'decode-error') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent =
          validationStatus.failureReason === 'unsupported'
            ? t('preview.unsupportedEncoding', { encoding: validationStatus.encoding })
            : t('preview.decodeError', { encoding: validationStatus.encoding });
        statusStateField.textContent = t('statusBar.decodeError');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
        renderDiagnosticsList(validationStatus.diagnostics, false);
      } else if (validationStatus.kind === 'read-error') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.readError', {
          detail: validationStatus.detail,
        });
        statusStateField.textContent = t('statusBar.notWellFormed');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'worker-timeout') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.workerTimeout');
        statusStateField.textContent = t('statusBar.notWellFormed');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'worker-error') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.workerError', {
          detail: validationStatus.detail,
        });
        statusStateField.textContent = t('statusBar.notWellFormed');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else {
        const { result } = validationStatus;
        const errorCount = result.diagnostics.filter((d) => d.severity === 'error').length;
        const warningCount = result.diagnostics.filter((d) => d.severity === 'warning').length;

        if (result.wellFormed) {
          resultBox.classList.add('is-valid');
          if (warningCount > 0) {
            resultBox.classList.add('has-warnings');
            resultBox.textContent = t('preview.validWithWarnings', {
              count: result.elementCount,
              root: result.rootElement ?? '',
              warnings: warningCount,
            });
            statusStateField.textContent = t('statusBar.warnings', { count: warningCount });
          } else {
            resultBox.textContent = t('preview.valid', {
              count: result.elementCount,
              root: result.rootElement ?? '',
            });
            statusStateField.textContent = t('statusBar.wellFormed');
          }
        } else {
          resultBox.classList.add('is-invalid');
          resultBox.textContent = t('preview.invalidCount', {
            errors: errorCount,
            warnings: warningCount,
          });
          statusStateField.textContent = t('statusBar.notWellFormed');
        }
        statusCountField.textContent = t('statusBar.elements', { count: result.elementCount });
        renderDiagnosticsList(result.diagnostics, result.truncatedDiagnostics);
      }
    };

    updateViewsFn = updateStatusViews;
    setCheckingStateFn = () => {
      statusStateField.textContent = t('statusBar.checking');
    };
    updateStatusViews();

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      clearDebounce();
      if (file.size > MAX_PREVIEW_BYTES) {
        ++checkEpoch;
        workerClient.cancel();
        loadedFileBytes = null;
        isModifiedSinceLoad = false;
        loadedEncodingInfo = null;
        lastAssumedEncoding = undefined;
        lastPreDiagnostics = [];
        validationStatus = { kind: 'too-large', limitMb: 1 };
        updateStatusViews();
        return;
      }
      const fileEpoch = ++checkEpoch;
      try {
        const buffer = await file.arrayBuffer();
        if (fileEpoch !== checkEpoch) {
          return;
        }
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength > MAX_PREVIEW_BYTES) {
          workerClient.cancel();
          loadedFileBytes = null;
          isModifiedSinceLoad = false;
          loadedEncodingInfo = null;
          lastAssumedEncoding = undefined;
          lastPreDiagnostics = [];
          validationStatus = { kind: 'too-large', limitMb: 1 };
          updateStatusViews();
          return;
        }
        loadedFileBytes = bytes;
        isModifiedSinceLoad = false;
        await decodeAndCheckLoadedBytes(bytes);
      } catch (err: unknown) {
        if (fileEpoch !== checkEpoch) {
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        loadedFileBytes = null;
        isModifiedSinceLoad = false;
        loadedEncodingInfo = null;
        lastAssumedEncoding = undefined;
        lastPreDiagnostics = [];
        validationStatus = { kind: 'read-error', detail };
        updateStatusViews();
      }
    });

    sampleBtn.addEventListener('click', () => {
      clearDebounce();
      loadedFileBytes = null;
      isModifiedSinceLoad = false;
      loadedEncodingInfo = null;
      lastAssumedEncoding = undefined;
      lastPreDiagnostics = [];
      xmlDraft = t('preview.sampleXml');
      textarea.value = xmlDraft;
      void runWorkerCheck(xmlDraft, { assumedEncoding: 'UTF-8' });
    });

    checkBtn.addEventListener('click', () => {
      clearDebounce();
      xmlDraft = textarea.value;
      if (loadedFileBytes !== null && !isModifiedSinceLoad) {
        void runWorkerCheck(xmlDraft, {
          ...(lastAssumedEncoding !== undefined ? { assumedEncoding: lastAssumedEncoding } : {}),
          preDiagnostics: lastPreDiagnostics,
        });
      } else {
        void runWorkerCheck(xmlDraft);
      }
    });

    aboutBtn.addEventListener('click', () => {
      if (!aboutDialog.open) {
        aboutDialog.showModal();
      }
    });

    aboutCloseBtn.addEventListener('click', () => {
      aboutDialog.close();
    });

    aboutDialog.addEventListener('close', () => {
      document.getElementById('about-button')?.focus();
    });

    root.appendChild(workbench);
  };

  render();
}

mountApp();
