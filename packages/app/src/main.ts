import { formatMessage, type LocaleCode, type MessageCatalog } from '@xmlens/core';
import enCatalog from '../../../locales/en.json';
import jaCatalog from '../../../locales/ja.json';
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

interface ValidationStatus {
  kind: 'empty' | 'valid' | 'invalid' | 'too-large' | 'read-error';
  count?: number;
  root?: string;
  detail?: string;
  limitMb?: number;
}

function checkXmlWellFormedness(xmlInput: string): ValidationStatus {
  const trimmed = xmlInput.trim();
  if (!trimmed) {
    return { kind: 'empty' };
  }

  if (new TextEncoder().encode(trimmed).byteLength > MAX_PREVIEW_BYTES) {
    return { kind: 'too-large', limitMb: 1 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'application/xml');
  // M0 temporary check using main-thread DOMParser; M1 will replace this with a Web Worker parser.
  // Known limitation: valid XML that legitimately contains a <parsererror> element can be misclassified as malformed.
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    const detail = (parserError.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { kind: 'invalid', detail };
  }

  const rootName = doc.documentElement ? doc.documentElement.nodeName : '';
  const elementCount = doc.getElementsByTagName('*').length;
  return { kind: 'valid', count: elementCount, root: rootName };
}

function mountApp(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  let locale: LocaleCode = detectInitialLocale();
  let theme: ThemeMode = detectInitialTheme();
  let xmlDraft = '';
  let validationStatus: ValidationStatus = { kind: 'empty' };

  const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
    formatMessage(CATALOGS[locale], CATALOGS.en, key, params);

  const applyDocumentAttributes = (): void => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    document.title = `${t('app.name')} — ${t('app.tagline')}`;
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

    settingsGroup.append(langGroup, themeGroup);
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
    textarea.addEventListener('input', () => {
      xmlDraft = textarea.value;
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
    diagnosticsBody.appendChild(resultBox);
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
    const statusLangField = createEl('span', {
      className: 'status-field',
      text: t('statusBar.language'),
    });
    statusFields.append(statusStateField, statusCountField, statusLangField);

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
    aboutBody.append(
      createEl('p', { text: t('about.version', { version: APP_VERSION }) }),
      createEl('p', { text: t('about.license') }),
      createEl('p', { text: t('about.privacy') }),
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

    const updateStatusViews = (): void => {
      resultBox.classList.remove('is-valid', 'is-invalid');
      if (validationStatus.kind === 'empty') {
        resultBox.textContent = t('preview.empty');
        statusStateField.textContent = t('statusBar.ready');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'too-large') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.tooLarge', {
          limitMb: validationStatus.limitMb ?? 1,
        });
        statusStateField.textContent = t('statusBar.tooLarge');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'read-error') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.readError', {
          detail: validationStatus.detail ?? '',
        });
        statusStateField.textContent = t('statusBar.notWellFormed');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      } else if (validationStatus.kind === 'valid') {
        resultBox.classList.add('is-valid');
        const count = validationStatus.count ?? 0;
        resultBox.textContent = t('preview.valid', {
          count,
          root: validationStatus.root ?? '',
        });
        statusStateField.textContent = t('statusBar.wellFormed');
        statusCountField.textContent = t('statusBar.elements', { count });
      } else {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.invalid', {
          detail: validationStatus.detail ?? '',
        });
        statusStateField.textContent = t('statusBar.notWellFormed');
        statusCountField.textContent = t('statusBar.elements', { count: 0 });
      }
    };
    updateStatusViews();

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      if (file.size > MAX_PREVIEW_BYTES) {
        validationStatus = { kind: 'too-large', limitMb: 1 };
        updateStatusViews();
        return;
      }
      try {
        xmlDraft = await file.text();
        textarea.value = xmlDraft;
        validationStatus = checkXmlWellFormedness(xmlDraft);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        validationStatus = { kind: 'read-error', detail };
      }
      updateStatusViews();
    });

    sampleBtn.addEventListener('click', () => {
      xmlDraft = t('preview.sampleXml');
      textarea.value = xmlDraft;
      validationStatus = checkXmlWellFormedness(xmlDraft);
      updateStatusViews();
    });

    checkBtn.addEventListener('click', () => {
      validationStatus = checkXmlWellFormedness(textarea.value);
      updateStatusViews();
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
