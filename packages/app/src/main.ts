import {
  formatCodeUnitHex,
  formatMessage,
  inspectXmlDeclarationForSave,
  type Diagnostic,
  type IndentStyle,
  type LineEnding,
  type LocaleCode,
  type LoneSurrogateLocation,
  type MessageCatalog,
  type SaveEncoding,
  type WellFormednessResult,
  type XmlDeclarationSaveCheck,
} from '@xmlens/core';
import { createWellFormednessWorkerClient, createXPathWorkerClient } from '@xmlens/workers';
import enCatalog from '../../../locales/en.json';
import jaCatalog from '../../../locales/ja.json';
import {
  classifyFormatFailure,
  decodeXmlBytes,
  ENCODING_OVERRIDE_OPTIONS,
  enforceFormattedByteLimit,
  loadAndDecodeXmlFile,
  normalizeDecodedTextForEditor,
  resolveFormatWorkerOptions,
  shouldDiscardAsyncFormatResult,
  utf8ByteLength,
  type DecodeXmlResult,
  type EncodingOverride,
} from './decodeXml';
import {
  getDefaultSavePreferences,
  isLineEnding,
  isSaveEncoding,
  prepareXmlSaveBytes,
  sanitizeDownloadFilename,
  SAVE_ENCODING_OPTIONS,
  triggerBlobDownload,
} from './saveXml';
import {
  buildValidationViewModel,
  createInitialDocumentEditState,
  resolveEffectiveXPathStatus,
  resolveStatusBarState,
  transitionDocumentEditState,
  type DocumentEditState,
  type ValidationMessageKey,
  type ValidationStatus,
} from './validationView';
import {
  shouldDiscardAsyncXPathResult,
  XPATH_DEBOUNCE_MS,
  xpathStatusFromWorkerOutcome,
  type XPathStatusState,
} from './xpathCursor';
import { mountXmlEditor, type XmlEditor } from './editor/xmlEditor';
import './styles.css';

type ThemeMode = 'light' | 'dark' | 'high-contrast';

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

interface LoadedEncodingInfo {
  readonly encoding: string;
  readonly hasBom: boolean;
}

function isEncodingOverride(value: string): value is EncodingOverride {
  return (ENCODING_OVERRIDE_OPTIONS as readonly string[]).includes(value);
}

function isIndentStyle(value: string): value is IndentStyle {
  return value === 'spaces-2' || value === 'spaces-4' || value === 'tab';
}

function mountApp(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  let locale: LocaleCode = detectInitialLocale();
  let theme: ThemeMode = detectInitialTheme();
  let encodingOverride: EncodingOverride = 'auto';
  let indentStyle: IndentStyle = 'spaces-2';
  let loadedFileBytes: Uint8Array | null = null;
  let loadedFileName: string | null = null;
  let loadedLineEnding: LineEnding = 'LF';
  let loadedEncodingInfo: LoadedEncodingInfo | null = null;
  let documentEditState: DocumentEditState = createInitialDocumentEditState();
  let xmlDraft = '';
  let validationStatus: ValidationStatus = { kind: 'empty' };
  let xpathStatus: XPathStatusState = { kind: 'none' };
  let isProcessing = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let xpathDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let checkEpoch = 0;
  let xpathEpoch = 0;

  let activeSaveLegacyEncoding: string | undefined;
  let activeSaveDeclCheck: XmlDeclarationSaveCheck | null = null;
  let activeSaveSelectedEncoding: SaveEncoding = 'UTF-8';
  let activeSaveLoneSurrogate: LoneSurrogateLocation | null = null;

  const spawnXmlWorker = (): Worker =>
    new Worker(new URL('../../workers/src/xmlWorker.ts', import.meta.url), { type: 'module' });
  const workerClient = createWellFormednessWorkerClient(spawnXmlWorker);
  const xpathWorkerClient = createXPathWorkerClient(spawnXmlWorker);
  let editor: XmlEditor | null = null;
  window.addEventListener('pagehide', () => {
    editor?.dispose();
    workerClient.dispose();
    xpathWorkerClient.dispose();
  });

  const t = (
    key: ValidationMessageKey,
    params?: Readonly<Record<string, string | number>>,
  ): string => formatMessage(CATALOGS[locale], CATALOGS.en, key, params);

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

  // Build workbench DOM once so locale switches update text/attributes in-place without
  // destroying editor state, Undo history, focus, or active dialogs.
  const workbench = createEl('div', { className: 'workbench' });

  const skipLink = createEl('a', {
    className: 'skip-link',
    attrs: { href: '#main-content' },
  });
  workbench.appendChild(skipLink);

  const titleBar = createEl('header', { className: 'title-bar' });
  const appTitle = createEl('h1', { className: 'app-title' });
  titleBar.appendChild(appTitle);
  workbench.appendChild(titleBar);

  const toolbar = createEl('div', {
    className: 'toolbar',
    attrs: { role: 'toolbar' },
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
    attrs: { type: 'button' },
  });
  const saveBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { id: 'save-button', type: 'button' },
  });
  const sampleBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { type: 'button' },
  });
  const formatBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { id: 'format-button', type: 'button' },
  });
  const searchBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { id: 'search-button', type: 'button' },
  });
  const checkBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { type: 'button' },
  });
  const aboutBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { id: 'about-button', type: 'button' },
  });

  actionsGroup.append(
    fileInput,
    openBtn,
    saveBtn,
    sampleBtn,
    formatBtn,
    searchBtn,
    checkBtn,
    createEl('span', { className: 'toolbar-sep', attrs: { 'aria-hidden': 'true' } }),
    aboutBtn,
  );

  const settingsGroup = createEl('div', {
    className: 'toolbar-settings',
    attrs: { role: 'group' },
  });

  const langGroup = createEl('div', { className: 'control-group' });
  const langLabel = createEl('label', {
    className: 'control-label',
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
  langGroup.append(langLabel, langSelect);

  const themeGroup = createEl('div', { className: 'control-group' });
  const themeLabel = createEl('label', {
    className: 'control-label',
    attrs: { for: 'theme-select' },
  });
  const themeSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'theme-select' },
  });
  const themeOptionElements = new Map<ThemeMode, HTMLOptionElement>();
  const themeModes: readonly ThemeMode[] = ['light', 'dark', 'high-contrast'];
  for (const mode of themeModes) {
    const opt = createEl('option', { attrs: { value: mode } });
    opt.selected = theme === mode;
    themeOptionElements.set(mode, opt);
    themeSelect.appendChild(opt);
  }
  themeGroup.append(themeLabel, themeSelect);

  const encodingGroup = createEl('div', { className: 'control-group' });
  const encodingLabel = createEl('label', {
    className: 'control-label',
    attrs: { for: 'encoding-select' },
  });
  const encodingSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'encoding-select' },
  });
  let encodingAutoOption: HTMLOptionElement | null = null;
  for (const optionValue of ENCODING_OVERRIDE_OPTIONS) {
    const opt = createEl('option', {
      ...(optionValue === 'auto' ? {} : { text: optionValue }),
      attrs: { value: optionValue },
    });
    opt.selected = encodingOverride === optionValue;
    if (optionValue === 'auto') {
      encodingAutoOption = opt;
    }
    encodingSelect.appendChild(opt);
  }
  encodingGroup.append(encodingLabel, encodingSelect);

  const indentGroup = createEl('div', { className: 'control-group' });
  const indentLabel = createEl('label', {
    className: 'control-label',
    attrs: { for: 'indent-select' },
  });
  const indentSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'indent-select' },
  });
  const indentOptionElements = new Map<IndentStyle, HTMLOptionElement>();
  const indentStyles: readonly IndentStyle[] = ['spaces-2', 'spaces-4', 'tab'];
  for (const styleValue of indentStyles) {
    const opt = createEl('option', { attrs: { value: styleValue } });
    opt.selected = indentStyle === styleValue;
    indentOptionElements.set(styleValue, opt);
    indentSelect.appendChild(opt);
  }
  indentGroup.append(indentLabel, indentSelect);

  settingsGroup.append(encodingGroup, indentGroup, langGroup, themeGroup);
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
  const editorHeading = createEl('h2', {
    className: 'pane-header',
    attrs: { id: 'editor-pane-heading' },
  });
  editorPane.appendChild(editorHeading);

  const cmHost = createEl('div', {
    className: 'cm-host',
    attrs: { id: 'cm-host' },
  });
  editorPane.appendChild(cmHost);

  const diagnosticsPane = createEl('section', {
    className: 'pane',
    attrs: { 'aria-labelledby': 'diagnostics-pane-heading' },
  });
  const diagHeading = createEl('h2', {
    className: 'pane-header',
    attrs: { id: 'diagnostics-pane-heading' },
  });
  diagnosticsPane.appendChild(diagHeading);

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
    attrs: { role: 'contentinfo' },
  });
  const statusFields = createEl('div', { className: 'status-fields' });
  const statusStateField = createEl('span', { className: 'status-field' });
  const statusCountField = createEl('span', { className: 'status-field' });
  const statusEncodingField = createEl('span', { className: 'status-field' });
  const statusXpathField = createEl('span', {
    className: 'status-field status-xpath',
    attrs: { id: 'status-xpath' },
  });
  const statusLangField = createEl('span', { className: 'status-field' });
  statusFields.append(
    statusStateField,
    statusCountField,
    statusEncodingField,
    statusXpathField,
    statusLangField,
  );

  const statusPrivacyField = createEl('span', { className: 'status-field' });
  statusBar.append(statusFields, statusPrivacyField);
  workbench.appendChild(statusBar);

  const aboutDialog = createEl('dialog', {
    className: 'about-dialog',
    attrs: { 'aria-labelledby': 'about-dialog-title' },
  });
  const aboutHeader = createEl('div', { className: 'about-header' });
  const aboutTitle = createEl('h2', {
    className: 'about-title',
    attrs: { id: 'about-dialog-title' },
  });
  aboutHeader.appendChild(aboutTitle);
  const aboutBody = createEl('div', { className: 'about-body' });
  const aboutVersionP = createEl('p');
  const aboutLicenseP = createEl('p');
  const aboutPrivacyP = createEl('p');
  const aboutNoticesTextNode = document.createTextNode('');
  const aboutNoticesLink = createEl('a', {
    className: 'about-link',
    attrs: {
      href: './THIRD_PARTY_NOTICES.md',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  });
  const noticesParagraph = createEl('p');
  noticesParagraph.append(aboutNoticesTextNode, aboutNoticesLink);
  aboutBody.append(aboutVersionP, aboutLicenseP, aboutPrivacyP, noticesParagraph);
  const aboutFooter = createEl('div', { className: 'about-footer' });
  const aboutCloseBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { type: 'button' },
  });
  aboutFooter.appendChild(aboutCloseBtn);
  aboutDialog.append(aboutHeader, aboutBody, aboutFooter);
  workbench.appendChild(aboutDialog);

  const saveDialog = createEl('dialog', {
    className: 'about-dialog save-dialog',
    attrs: { 'aria-labelledby': 'save-dialog-title' },
  });
  const saveForm = createEl('form');
  const saveHeader = createEl('div', { className: 'about-header' });
  const saveTitle = createEl('h2', {
    className: 'about-title',
    attrs: { id: 'save-dialog-title' },
  });
  saveHeader.appendChild(saveTitle);

  const saveBody = createEl('div', { className: 'save-dialog-body' });

  const saveLegacyNotice = createEl('p', {
    className: 'save-notice',
    attrs: { role: 'note' },
  });
  saveLegacyNotice.hidden = true;

  const saveFilenameField = createEl('div', { className: 'save-field' });
  const saveFilenameLabel = createEl('label', {
    className: 'save-field-label',
    attrs: { for: 'save-filename-input' },
  });
  const saveFilenameInput = createEl('input', {
    className: 'save-input',
    attrs: { id: 'save-filename-input', type: 'text', required: 'true' },
  });
  saveFilenameField.append(saveFilenameLabel, saveFilenameInput);

  const saveEncodingField = createEl('div', { className: 'save-field' });
  const saveEncodingLabel = createEl('label', {
    className: 'save-field-label',
    attrs: { for: 'save-encoding-select' },
  });
  const saveEncodingSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'save-encoding-select' },
  });
  for (const encOption of SAVE_ENCODING_OPTIONS) {
    saveEncodingSelect.appendChild(
      createEl('option', { text: encOption, attrs: { value: encOption } }),
    );
  }
  saveEncodingField.append(saveEncodingLabel, saveEncodingSelect);

  const saveBomGroup = createEl('div', { className: 'save-field' });
  const saveBomRow = createEl('div', { className: 'save-checkbox-row' });
  const saveBomCheckbox = createEl('input', {
    attrs: { id: 'save-bom-checkbox', type: 'checkbox' },
  });
  const saveBomLabel = createEl('label', {
    attrs: { for: 'save-bom-checkbox' },
  });
  saveBomRow.append(saveBomCheckbox, saveBomLabel);
  const saveBomHint = createEl('p', { className: 'save-hint' });
  saveBomHint.hidden = true;
  saveBomGroup.append(saveBomRow, saveBomHint);

  const saveEolField = createEl('div', { className: 'save-field' });
  const saveEolLabel = createEl('label', {
    className: 'save-field-label',
    attrs: { for: 'save-eol-select' },
  });
  const saveEolSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'save-eol-select' },
  });
  const saveEolLfOption = createEl('option', { attrs: { value: 'LF' } });
  const saveEolCrLfOption = createEl('option', { attrs: { value: 'CRLF' } });
  saveEolSelect.append(saveEolLfOption, saveEolCrLfOption);
  saveEolField.append(saveEolLabel, saveEolSelect);

  const saveDeclBox = createEl('div', { className: 'save-decl-box' });
  saveDeclBox.hidden = true;
  const saveDeclRow = createEl('div', { className: 'save-checkbox-row' });
  const saveDeclCheckbox = createEl('input', {
    attrs: { id: 'save-update-decl-checkbox', type: 'checkbox' },
  });
  const saveDeclLabel = createEl('label', {
    attrs: { for: 'save-update-decl-checkbox' },
  });
  saveDeclRow.append(saveDeclCheckbox, saveDeclLabel);
  const saveDeclDetail = createEl('p', { className: 'save-hint' });
  saveDeclBox.append(saveDeclRow, saveDeclDetail);

  const saveErrorBox = createEl('p', {
    className: 'save-error',
    attrs: { role: 'alert' },
  });
  saveErrorBox.hidden = true;

  saveBody.append(
    saveLegacyNotice,
    saveFilenameField,
    saveEncodingField,
    saveBomGroup,
    saveEolField,
    saveDeclBox,
    saveErrorBox,
  );

  const saveFooter = createEl('div', { className: 'about-footer save-footer' });
  const saveCancelBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { type: 'button' },
  });
  const saveConfirmBtn = createEl('button', {
    className: 'tb-btn',
    attrs: { type: 'submit' },
  });
  saveFooter.append(saveCancelBtn, saveConfirmBtn);

  saveForm.append(saveHeader, saveBody, saveFooter);
  saveDialog.appendChild(saveForm);
  workbench.appendChild(saveDialog);

  root.replaceChildren(workbench);

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const clearXPathDebounce = (): void => {
    if (xpathDebounceTimer !== null) {
      clearTimeout(xpathDebounceTimer);
      xpathDebounceTimer = null;
    }
  };

  const updateXPathStatusView = (): void => {
    const effectiveStatus = resolveEffectiveXPathStatus(validationStatus, xpathStatus);
    if (effectiveStatus.kind === 'path') {
      statusXpathField.textContent = t('statusBar.xpath', {
        value: effectiveStatus.breadcrumb,
      });
      statusXpathField.title = effectiveStatus.breadcrumb;
    } else {
      statusXpathField.textContent = t('statusBar.xpath', {
        value: t('statusBar.xpathNone'),
      });
      statusXpathField.removeAttribute('title');
    }
  };

  const clearXPathStatus = (): void => {
    ++xpathEpoch;
    clearXPathDebounce();
    xpathWorkerClient.cancel();
    xpathStatus = { kind: 'none' };
    updateXPathStatusView();
  };

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
        editor?.setSelection(diag.range?.offset ?? 0, {
          focus: true,
          scrollIntoView: true,
        });
        scheduleXPathLookup(0);
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

  const formatDiagnosticMessage = (diag: Diagnostic): string =>
    formatMessage(CATALOGS[locale], CATALOGS.en, diag.messageKey, diag.params);

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

    const viewModel = buildValidationViewModel(validationStatus);
    for (const cls of viewModel.resultClasses) {
      resultBox.classList.add(cls);
    }
    const resultParams =
      viewModel.resultDetailKey !== undefined
        ? { ...viewModel.resultMessageParams, detail: t(viewModel.resultDetailKey) }
        : viewModel.resultMessageParams;
    resultBox.textContent = t(viewModel.resultMessageKey, resultParams);
    const statusStateDisplay = resolveStatusBarState(isProcessing, viewModel);
    statusStateField.textContent = t(statusStateDisplay.key, statusStateDisplay.params);
    statusCountField.textContent = t('statusBar.elements', { count: viewModel.elementCount });
    renderDiagnosticsList(viewModel.diagnostics, viewModel.truncatedDiagnostics);
    editor?.setDiagnostics(viewModel.diagnostics, formatDiagnosticMessage);
    updateXPathStatusView();
  };

  const setCheckingState = (): void => {
    isProcessing = true;
    statusStateField.textContent = t('statusBar.checking');
  };

  const updateSaveDeclarationLocaleText = (): void => {
    if (activeSaveDeclCheck === null || !activeSaveDeclCheck.needsUpdate) {
      return;
    }
    saveDeclLabel.textContent = t('save.updateDecl', { encoding: activeSaveSelectedEncoding });
    saveDeclDetail.textContent =
      activeSaveDeclCheck.declaredEncoding !== undefined
        ? t('save.updateDeclDetail', { declared: activeSaveDeclCheck.declaredEncoding })
        : t('save.addDeclEncodingDetail');
  };

  const updateSaveDynamicLocaleText = (): void => {
    if (activeSaveLegacyEncoding !== undefined) {
      saveLegacyNotice.textContent = t('save.legacyNotice', {
        encoding: activeSaveLegacyEncoding,
      });
    }
    updateSaveDeclarationLocaleText();
    if (activeSaveLoneSurrogate !== null) {
      saveErrorBox.textContent = t('save.loneSurrogateError', {
        codeUnit: formatCodeUnitHex(activeSaveLoneSurrogate.codeUnit),
        line: activeSaveLoneSurrogate.line,
        column: activeSaveLoneSurrogate.column,
        offset: activeSaveLoneSurrogate.offset,
      });
    }
  };

  const applyLocale = (): void => {
    applyDocumentAttributes();

    skipLink.textContent = t('app.skipToMain');
    appTitle.textContent = t('app.name');

    toolbar.setAttribute('aria-label', t('toolbar.label'));
    openBtn.textContent = t('toolbar.openFile');
    saveBtn.textContent = t('toolbar.saveAs');
    sampleBtn.textContent = t('toolbar.loadSample');
    formatBtn.textContent = t('toolbar.format');
    searchBtn.textContent = t('toolbar.search');
    checkBtn.textContent = t('toolbar.checkWellFormedness');
    aboutBtn.textContent = t('toolbar.about');

    settingsGroup.setAttribute('aria-label', t('nav.settingsLabel'));
    encodingLabel.textContent = t('nav.fileEncoding');
    if (encodingAutoOption !== null) {
      encodingAutoOption.textContent = t('encoding.auto');
    }
    indentLabel.textContent = t('nav.indentStyle');
    const spaces2Option = indentOptionElements.get('spaces-2');
    if (spaces2Option) {
      spaces2Option.textContent = t('indent.spaces2');
    }
    const spaces4Option = indentOptionElements.get('spaces-4');
    if (spaces4Option) {
      spaces4Option.textContent = t('indent.spaces4');
    }
    const tabOption = indentOptionElements.get('tab');
    if (tabOption) {
      tabOption.textContent = t('indent.tab');
    }

    langLabel.textContent = t('nav.language');
    themeLabel.textContent = t('nav.theme');
    const lightOption = themeOptionElements.get('light');
    if (lightOption) {
      lightOption.textContent = t('theme.light');
    }
    const darkOption = themeOptionElements.get('dark');
    if (darkOption) {
      darkOption.textContent = t('theme.dark');
    }
    const highContrastOption = themeOptionElements.get('high-contrast');
    if (highContrastOption) {
      highContrastOption.textContent = t('theme.highContrast');
    }

    editorHeading.textContent = t('pane.editorHeading');
    editor?.setAriaLabel(t('pane.editorHeading'));
    editor?.setPlaceholder(t('preview.placeholder'));
    diagHeading.textContent = t('pane.diagnosticsHeading');

    statusBar.setAttribute('aria-label', t('statusBar.label'));
    statusLangField.textContent = t('statusBar.language');
    statusPrivacyField.textContent = t('statusBar.localOnly');

    aboutTitle.textContent = t('about.title');
    aboutVersionP.textContent = t('about.version', { version: APP_VERSION });
    aboutLicenseP.textContent = t('about.license');
    aboutPrivacyP.textContent = t('about.privacy');
    aboutNoticesTextNode.data = t('about.noticesLabel');
    aboutNoticesLink.textContent = t('about.noticesLink');
    aboutCloseBtn.textContent = t('about.close');

    saveTitle.textContent = t('save.title');
    saveFilenameLabel.textContent = t('save.filename');
    saveEncodingLabel.textContent = t('save.encoding');
    saveBomLabel.textContent = t('save.bomLabel');
    saveBomHint.textContent = t('save.bomRequiredHint');
    saveEolLabel.textContent = t('save.lineEnding');
    saveEolLfOption.textContent = t('save.lineEndingLf');
    saveEolCrLfOption.textContent = t('save.lineEndingCrLf');
    saveCancelBtn.textContent = t('save.cancel');
    saveConfirmBtn.textContent = t('save.confirm');
    updateSaveDynamicLocaleText();

    updateStatusViews();
  };

  const runXPathLookup = async (xmlText: string, cursorOffset: number): Promise<void> => {
    const requestEpoch = ++xpathEpoch;
    if (
      editor?.isComposing() ||
      xmlText.trim().length === 0 ||
      utf8ByteLength(xmlText) > MAX_PREVIEW_BYTES ||
      validationStatus.kind === 'decode-error' ||
      validationStatus.kind === 'too-large' ||
      validationStatus.kind === 'read-error'
    ) {
      xpathWorkerClient.cancel();
      if (!editor?.isComposing()) {
        xpathStatus = { kind: 'none' };
        updateXPathStatusView();
      }
      return;
    }

    const outcome = await xpathWorkerClient.getXPathAtOffset(xmlText, cursorOffset);
    if (
      outcome.status === 'cancelled' ||
      shouldDiscardAsyncXPathResult({
        requestEpoch,
        currentEpoch: xpathEpoch,
        sentText: xmlText,
        sentOffset: cursorOffset,
        currentText: editor?.getText() ?? '',
        currentOffset: editor?.headOffset() ?? 0,
        isComposing: editor?.isComposing() ?? false,
      })
    ) {
      return;
    }

    xpathStatus = xpathStatusFromWorkerOutcome(outcome);
    updateXPathStatusView();
  };

  const scheduleXPathLookup = (delayMs: number = XPATH_DEBOUNCE_MS): void => {
    clearXPathDebounce();
    xpathWorkerClient.cancel();
    if (editor?.isComposing()) {
      return;
    }
    const currentText = editor?.getText() ?? '';
    const currentOffset = editor?.headOffset() ?? 0;
    if (delayMs <= 0) {
      void runXPathLookup(currentText, currentOffset);
      return;
    }
    xpathDebounceTimer = setTimeout(() => {
      xpathDebounceTimer = null;
      if (editor?.isComposing()) {
        return;
      }
      void runXPathLookup(editor?.getText() ?? '', editor?.headOffset() ?? 0);
    }, delayMs);
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
      isProcessing = false;
      validationStatus = { kind: 'empty' };
      updateStatusViews();
      return;
    }

    if (utf8ByteLength(xmlText) > MAX_PREVIEW_BYTES) {
      workerClient.cancel();
      isProcessing = false;
      validationStatus = { kind: 'too-large', limitMb: 1 };
      updateStatusViews();
      return;
    }

    setCheckingState();
    const workerOptions =
      checkOptions?.assumedEncoding !== undefined
        ? { assumedEncoding: checkOptions.assumedEncoding }
        : undefined;
    const outcome = await workerClient.check(xmlText, workerOptions);
    if (epoch !== checkEpoch || outcome.status === 'cancelled') {
      return;
    }

    isProcessing = false;
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
    updateStatusViews();
  };

  const applyDecodedBytesResult = async (decoded: DecodeXmlResult): Promise<void> => {
    if (editor?.isComposing()) {
      return;
    }
    if (!decoded.ok) {
      ++checkEpoch;
      workerClient.cancel();
      isProcessing = false;
      xmlDraft = '';
      editor?.setDocument('');
      loadedEncodingInfo = { encoding: decoded.encoding, hasBom: decoded.hasBom };
      loadedLineEnding = 'LF';
      documentEditState = transitionDocumentEditState(documentEditState, {
        type: 'file-decode-cleared',
      });
      validationStatus = {
        kind: 'decode-error',
        failureReason: decoded.failureReason,
        encoding: decoded.encoding,
        diagnostics: decoded.diagnostics,
      };
      clearXPathStatus();
      updateStatusViews();
      return;
    }

    // Detect dominant line ending before normalizing CRLF/CR to LF so xmlDraft, size checks,
    // worker diagnostic offsets, and CodeMirror doc share identical LF coordinates.
    const normalizedEditor = normalizeDecodedTextForEditor(decoded.text);
    if (utf8ByteLength(normalizedEditor.text) > MAX_PREVIEW_BYTES) {
      ++checkEpoch;
      workerClient.cancel();
      isProcessing = false;
      xmlDraft = '';
      editor?.setDocument('');
      loadedEncodingInfo = null;
      loadedLineEnding = 'LF';
      documentEditState = transitionDocumentEditState(documentEditState, {
        type: 'file-decode-cleared',
      });
      validationStatus = { kind: 'too-large', limitMb: 1 };
      clearXPathStatus();
      updateStatusViews();
      return;
    }

    loadedLineEnding = normalizedEditor.lineEnding;
    xmlDraft = normalizedEditor.text;
    editor?.setDocument(xmlDraft);
    loadedEncodingInfo = { encoding: decoded.encoding, hasBom: decoded.hasBom };
    documentEditState = transitionDocumentEditState(documentEditState, {
      type: 'file-loaded',
      assumedEncoding: decoded.assumedEncoding,
      preDiagnostics: decoded.diagnostics,
    });
    clearXPathStatus();
    await runWorkerCheck(xmlDraft, {
      assumedEncoding: decoded.assumedEncoding,
      preDiagnostics: decoded.diagnostics,
    });
  };

  const decodeAndCheckLoadedBytes = async (bytes: Uint8Array): Promise<void> => {
    if (editor?.isComposing()) {
      return;
    }
    clearDebounce();
    const decoded = decodeXmlBytes(bytes, encodingOverride);
    await applyDecodedBytesResult(decoded);
  };

  const resetLoadedFileState = (): void => {
    loadedFileBytes = null;
    loadedFileName = null;
    loadedLineEnding = 'LF';
    loadedEncodingInfo = null;
    documentEditState = transitionDocumentEditState(documentEditState, {
      type: 'sample-loaded',
    });
  };

  const openXmlFile = async (file: File): Promise<void> => {
    clearDebounce();
    const fileEpoch = ++checkEpoch;
    const outcome = await loadAndDecodeXmlFile(file, MAX_PREVIEW_BYTES, encodingOverride);
    if (fileEpoch !== checkEpoch || editor?.isComposing()) {
      return;
    }

    if (outcome.status === 'too-large') {
      workerClient.cancel();
      isProcessing = false;
      resetLoadedFileState();
      validationStatus = { kind: 'too-large', limitMb: 1 };
      clearXPathStatus();
      updateStatusViews();
      return;
    }

    if (outcome.status === 'read-error') {
      workerClient.cancel();
      isProcessing = false;
      resetLoadedFileState();
      validationStatus = { kind: 'read-error', detail: outcome.detail };
      clearXPathStatus();
      updateStatusViews();
      return;
    }

    loadedFileBytes = outcome.bytes;
    loadedFileName = file.name;
    await applyDecodedBytesResult(outcome.decoded);
  };

  editor = mountXmlEditor({
    host: cmHost,
    initialText: xmlDraft,
    ariaLabel: t('pane.editorHeading'),
    placeholderText: t('preview.placeholder'),
    onUpdate(classification) {
      if (classification.docChanged) {
        xmlDraft = editor?.getText() ?? '';
        if (classification.userEdited) {
          documentEditState = transitionDocumentEditState(documentEditState, {
            type: 'user-edited',
          });
          clearDebounce();
          workerClient.cancel();
          isProcessing = false;
          const scheduledText = xmlDraft;
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void runWorkerCheck(scheduledText);
          }, INPUT_DEBOUNCE_MS);
        }
        scheduleXPathLookup();
      } else if (classification.selectionSet) {
        scheduleXPathLookup();
      }
    },
    onCompositionEnd() {
      scheduleXPathLookup();
    },
    onFileDrop(droppedFile) {
      if (droppedFile) {
        void openXmlFile(droppedFile);
      }
    },
  });

  openBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  langSelect.addEventListener('change', () => {
    const next = langSelect.value === 'ja' ? 'ja' : 'en';
    locale = next;
    try {
      window.localStorage.setItem(STORAGE_LANG_KEY, next);
    } catch {
      // Ignore storage access restrictions.
    }
    applyLocale();
  });

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

  encodingSelect.addEventListener('change', () => {
    if (isEncodingOverride(encodingSelect.value)) {
      encodingOverride = encodingSelect.value;
      if (loadedFileBytes !== null && !documentEditState.isModifiedSinceLoad) {
        void decodeAndCheckLoadedBytes(loadedFileBytes);
      }
    }
  });

  indentSelect.addEventListener('change', () => {
    if (isIndentStyle(indentSelect.value)) {
      indentStyle = indentSelect.value;
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    await openXmlFile(file);
  });

  sampleBtn.addEventListener('click', () => {
    if (editor?.isComposing()) {
      return;
    }
    clearDebounce();
    resetLoadedFileState();
    xmlDraft = t('preview.sampleXml');
    editor?.setDocument(xmlDraft);
    clearXPathStatus();
    void runWorkerCheck(xmlDraft, { assumedEncoding: 'UTF-8' });
  });

  searchBtn.addEventListener('click', () => {
    editor?.openSearchPanel();
  });

  formatBtn.addEventListener('click', async () => {
    if (editor?.isComposing()) {
      return;
    }
    clearDebounce();
    const sentText = editor?.getText() ?? '';
    xmlDraft = sentText;

    if (utf8ByteLength(sentText) > MAX_PREVIEW_BYTES) {
      ++checkEpoch;
      workerClient.cancel();
      isProcessing = false;
      validationStatus = { kind: 'too-large', limitMb: 1 };
      clearXPathStatus();
      updateStatusViews();
      return;
    }

    const formatEpoch = ++checkEpoch;
    const formatWasUnmodifiedFile =
      loadedFileBytes !== null && !documentEditState.isModifiedSinceLoad;
    const formatAssumedEncoding = documentEditState.lastAssumedEncoding;
    const formatPreDiagnostics = documentEditState.lastPreDiagnostics;
    setCheckingState();

    const formatOptions = resolveFormatWorkerOptions({
      indentStyle,
      hasLoadedFile: loadedFileBytes !== null,
      isModifiedSinceLoad: documentEditState.isModifiedSinceLoad,
      maxOutputChars: MAX_PREVIEW_BYTES,
      ...(formatAssumedEncoding !== undefined ? { assumedEncoding: formatAssumedEncoding } : {}),
    });

    let outcome;
    try {
      outcome = await workerClient.format(sentText, formatOptions);
    } catch (err: unknown) {
      if (
        shouldDiscardAsyncFormatResult({
          requestEpoch: formatEpoch,
          currentEpoch: checkEpoch,
          sentText,
          currentText: editor?.getText() ?? '',
          isComposing: editor?.isComposing() ?? false,
        })
      ) {
        return;
      }
      isProcessing = false;
      const detail = err instanceof Error ? err.message : String(err);
      validationStatus = {
        kind: 'format-failed',
        reason: 'internal-error',
        detail,
        diagnostics: [],
      };
      updateStatusViews();
      return;
    }

    if (
      outcome.status === 'cancelled' ||
      shouldDiscardAsyncFormatResult({
        requestEpoch: formatEpoch,
        currentEpoch: checkEpoch,
        sentText,
        currentText: editor?.getText() ?? '',
        isComposing: editor?.isComposing() ?? false,
      })
    ) {
      return;
    }

    if (outcome.status === 'timeout') {
      isProcessing = false;
      validationStatus = {
        kind: 'format-failed',
        reason: 'internal-error',
        detailKey: 'preview.workerTimeout',
        diagnostics: [],
      };
      updateStatusViews();
      return;
    }

    if (outcome.status === 'error') {
      isProcessing = false;
      validationStatus = {
        kind: 'format-failed',
        reason: 'internal-error',
        detail: outcome.message,
        diagnostics: [],
      };
      updateStatusViews();
      return;
    }

    const formattedResult = enforceFormattedByteLimit(outcome.result, MAX_PREVIEW_BYTES);
    if (!formattedResult.ok) {
      isProcessing = false;
      const failureReason = classifyFormatFailure(formattedResult.diagnostics);
      if (failureReason === 'invalid') {
        validationStatus = {
          kind: 'checked',
          formatRejected: true,
          result: {
            wellFormed: false,
            diagnostics: formattedResult.diagnostics,
            elementCount: formattedResult.elementCount,
            truncatedDiagnostics: formattedResult.truncatedDiagnostics,
            ...(formattedResult.rootElement !== undefined
              ? { rootElement: formattedResult.rootElement }
              : {}),
          },
        };
      } else {
        const rawDetail = formattedResult.diagnostics[0]?.params?.detail;
        const detail =
          typeof rawDetail === 'string' && rawDetail.length > 0 ? rawDetail : undefined;
        validationStatus = {
          kind: 'format-failed',
          reason: failureReason,
          ...(detail !== undefined ? { detail } : {}),
          diagnostics: formattedResult.diagnostics,
        };
      }
      updateStatusViews();
      return;
    }

    if (formattedResult.changed) {
      editor?.replaceUndoable(formattedResult.formatted);
      xmlDraft = editor?.getText() ?? formattedResult.formatted;
      documentEditState = transitionDocumentEditState(documentEditState, {
        type: 'format-succeeded',
        changed: true,
      });
      scheduleXPathLookup(0);
      void runWorkerCheck(xmlDraft);
    } else if (formatWasUnmodifiedFile) {
      void runWorkerCheck(xmlDraft, {
        ...(formatAssumedEncoding !== undefined ? { assumedEncoding: formatAssumedEncoding } : {}),
        preDiagnostics: formatPreDiagnostics,
      });
    } else {
      void runWorkerCheck(xmlDraft);
    }
  });

  checkBtn.addEventListener('click', () => {
    clearDebounce();
    xmlDraft = editor?.getText() ?? '';
    if (loadedFileBytes !== null && !documentEditState.isModifiedSinceLoad) {
      void runWorkerCheck(xmlDraft, {
        ...(documentEditState.lastAssumedEncoding !== undefined
          ? { assumedEncoding: documentEditState.lastAssumedEncoding }
          : {}),
        preDiagnostics: documentEditState.lastPreDiagnostics,
      });
    } else {
      void runWorkerCheck(xmlDraft);
    }
  });

  let utf8BomChoice = false;

  const syncSaveBomControl = (): void => {
    const selectedEnc = isSaveEncoding(saveEncodingSelect.value)
      ? saveEncodingSelect.value
      : 'UTF-8';
    if (selectedEnc === 'UTF-8') {
      saveBomCheckbox.disabled = false;
      saveBomCheckbox.checked = utf8BomChoice;
      saveBomHint.hidden = true;
    } else {
      saveBomCheckbox.disabled = true;
      saveBomCheckbox.checked = true;
      saveBomHint.hidden = false;
    }
  };

  const syncSaveDeclarationPrompt = (): void => {
    const selectedEnc = isSaveEncoding(saveEncodingSelect.value)
      ? saveEncodingSelect.value
      : 'UTF-8';
    const currentText = editor?.getText() ?? '';
    const declCheck = inspectXmlDeclarationForSave(currentText, selectedEnc);
    activeSaveSelectedEncoding = selectedEnc;
    activeSaveDeclCheck = declCheck;
    if (declCheck.needsUpdate) {
      saveDeclBox.hidden = false;
      saveDeclCheckbox.checked = true;
      updateSaveDeclarationLocaleText();
    } else {
      saveDeclBox.hidden = true;
      saveDeclCheckbox.checked = false;
    }
  };

  saveBomCheckbox.addEventListener('change', () => {
    if (saveEncodingSelect.value === 'UTF-8') {
      utf8BomChoice = saveBomCheckbox.checked;
    }
  });

  saveEncodingSelect.addEventListener('change', () => {
    syncSaveBomControl();
    syncSaveDeclarationPrompt();
  });

  saveBtn.addEventListener('click', () => {
    xmlDraft = editor?.getText() ?? '';
    const prefs = getDefaultSavePreferences(loadedEncodingInfo, loadedLineEnding);
    saveFilenameInput.value = sanitizeDownloadFilename(loadedFileName);
    saveEncodingSelect.value = prefs.encoding;
    utf8BomChoice = prefs.encoding === 'UTF-8' ? prefs.includeBom : false;
    saveEolSelect.value = prefs.lineEnding;

    activeSaveLegacyEncoding = prefs.legacySourceEncoding;
    if (activeSaveLegacyEncoding !== undefined) {
      saveLegacyNotice.hidden = false;
      saveLegacyNotice.textContent = t('save.legacyNotice', {
        encoding: activeSaveLegacyEncoding,
      });
    } else {
      saveLegacyNotice.hidden = true;
      saveLegacyNotice.textContent = '';
    }

    activeSaveLoneSurrogate = null;
    saveErrorBox.hidden = true;
    saveErrorBox.textContent = '';
    syncSaveBomControl();
    syncSaveDeclarationPrompt();

    if (!saveDialog.open) {
      saveDialog.showModal();
      saveFilenameInput.focus();
      saveFilenameInput.select();
    }
  });

  saveCancelBtn.addEventListener('click', () => {
    saveDialog.close();
  });

  saveDialog.addEventListener('close', () => {
    activeSaveLegacyEncoding = undefined;
    activeSaveDeclCheck = null;
    activeSaveLoneSurrogate = null;
    saveBtn.focus();
  });

  saveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    activeSaveLoneSurrogate = null;
    saveErrorBox.hidden = true;
    saveErrorBox.textContent = '';

    const currentText = editor?.getText() ?? '';
    const chosenEncoding = isSaveEncoding(saveEncodingSelect.value)
      ? saveEncodingSelect.value
      : 'UTF-8';
    const chosenEol = isLineEnding(saveEolSelect.value) ? saveEolSelect.value : 'LF';
    const includeBom = chosenEncoding === 'UTF-8' ? saveBomCheckbox.checked : true;
    const updateDeclaration = !saveDeclBox.hidden && saveDeclCheckbox.checked;
    const filename = sanitizeDownloadFilename(saveFilenameInput.value);

    const prepared = prepareXmlSaveBytes(currentText, {
      encoding: chosenEncoding,
      includeBom,
      lineEnding: chosenEol,
      updateDeclaration,
    });

    if (!prepared.ok) {
      activeSaveLoneSurrogate = prepared.loneSurrogate;
      saveErrorBox.hidden = false;
      saveErrorBox.textContent = t('save.loneSurrogateError', {
        codeUnit: formatCodeUnitHex(prepared.loneSurrogate.codeUnit),
        line: prepared.loneSurrogate.line,
        column: prepared.loneSurrogate.column,
        offset: prepared.loneSurrogate.offset,
      });
      return;
    }

    triggerBlobDownload(prepared.bytes, filename);
    saveDialog.close();
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
    aboutBtn.focus();
  });

  applyLocale();
}

mountApp();
