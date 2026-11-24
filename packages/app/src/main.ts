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
  kind: 'empty' | 'valid' | 'invalid' | 'too-large';
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

    const shell = createEl('div', { className: 'shell' });

    const skipLink = createEl('a', {
      className: 'skip-link',
      text: t('app.skipToMain'),
      attrs: { href: '#main-content' },
    });
    shell.appendChild(skipLink);

    const header = createEl('header', { className: 'site-header' });
    const brandGroup = createEl('div', { className: 'brand-group' });
    brandGroup.appendChild(createEl('h1', { className: 'brand-title', text: t('app.name') }));
    brandGroup.appendChild(createEl('span', { className: 'badge', text: t('status.badge') }));
    header.appendChild(brandGroup);

    const settingsGroup = createEl('div', {
      className: 'controls',
      attrs: { role: 'group', 'aria-label': t('nav.settingsLabel') },
    });

    const langGroup = createEl('div', { className: 'control-group' });
    const langLabel = createEl('label', {
      className: 'control-label',
      text: t('nav.language'),
      attrs: { for: 'locale-select' },
    });
    const langSelect = createEl('select', {
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
    header.appendChild(settingsGroup);
    shell.appendChild(header);

    const main = createEl('main', {
      className: 'main-content',
      attrs: { id: 'main-content', tabindex: '-1' },
    });

    const heroCard = createEl('section', { className: 'card' });
    heroCard.appendChild(createEl('h2', { text: t('hero.heading') }));
    heroCard.appendChild(createEl('p', { className: 'muted', text: t('hero.description') }));
    heroCard.appendChild(createEl('p', { className: 'local-notice', text: t('status.localOnly') }));
    main.appendChild(heroCard);

    const statusCard = createEl('section', { className: 'card' });
    statusCard.appendChild(createEl('h2', { text: t('status.contractHeading') }));
    statusCard.appendChild(createEl('p', { className: 'muted', text: t('status.contractIntro') }));
    const list = createEl('ul', { className: 'contract-list' });
    const contractKeys: ReadonlyArray<MessageKey> = [
      'status.contractItem1',
      'status.contractItem2',
      'status.contractItem3',
    ];
    for (const key of contractKeys) {
      list.appendChild(createEl('li', { text: t(key) }));
    }
    statusCard.appendChild(list);
    main.appendChild(statusCard);

    const previewCard = createEl('section', { className: 'card' });
    previewCard.appendChild(
      createEl('h2', {
        text: t('preview.heading'),
        attrs: { id: 'xml-preview-heading' },
      }),
    );

    const textarea = createEl('textarea', {
      className: 'xml-textarea',
      attrs: {
        id: 'xml-preview-input',
        'aria-labelledby': 'xml-preview-heading',
        placeholder: t('preview.placeholder'),
        spellcheck: 'false',
      },
    });
    textarea.value = xmlDraft;
    textarea.addEventListener('input', () => {
      xmlDraft = textarea.value;
    });
    previewCard.appendChild(textarea);

    const resultBox = createEl('div', {
      className: 'result-box',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const updateResultBox = (): void => {
      resultBox.classList.remove('is-valid', 'is-invalid');
      if (validationStatus.kind === 'empty') {
        resultBox.textContent = t('preview.empty');
      } else if (validationStatus.kind === 'too-large') {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.tooLarge', {
          limitMb: validationStatus.limitMb ?? 1,
        });
      } else if (validationStatus.kind === 'valid') {
        resultBox.classList.add('is-valid');
        resultBox.textContent = t('preview.valid', {
          count: validationStatus.count ?? 0,
          root: validationStatus.root ?? '',
        });
      } else {
        resultBox.classList.add('is-invalid');
        resultBox.textContent = t('preview.invalid', {
          detail: validationStatus.detail ?? '',
        });
      }
    };
    updateResultBox();

    const buttonRow = createEl('div', { className: 'button-row' });
    const sampleBtn = createEl('button', {
      className: 'btn',
      text: t('preview.sampleButton'),
      attrs: { type: 'button' },
    });
    sampleBtn.addEventListener('click', () => {
      xmlDraft = t('preview.sampleXml');
      textarea.value = xmlDraft;
      validationStatus = checkXmlWellFormedness(xmlDraft);
      updateResultBox();
    });

    const checkBtn = createEl('button', {
      className: 'btn btn-primary',
      text: t('preview.checkButton'),
      attrs: { type: 'button' },
    });
    checkBtn.addEventListener('click', () => {
      validationStatus = checkXmlWellFormedness(textarea.value);
      updateResultBox();
    });

    buttonRow.append(sampleBtn, checkBtn);
    previewCard.append(buttonRow, resultBox);
    main.appendChild(previewCard);

    shell.appendChild(main);

    const footer = createEl('footer', { className: 'site-footer' });
    footer.appendChild(createEl('span', { text: t('footer.license') }));
    shell.appendChild(footer);

    root.appendChild(shell);
  };

  render();
}

mountApp();
