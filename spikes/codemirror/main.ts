import { redo, undo } from '@codemirror/commands';
import { setDiagnostics } from '@codemirror/lint';
import { openSearchPanel } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  formatMessage,
  type Diagnostic,
  type IndentStyle,
  type LineEnding,
  type LocaleCode,
  type MessageCatalog,
  type WellFormednessResult,
} from '@xmlens/core';
import { createWellFormednessWorkerClient, createXPathWorkerClient } from '@xmlens/workers';
import enCatalog from '../../locales/en.json';
import jaCatalog from '../../locales/ja.json';
import {
  classifyFormatFailure,
  enforceFormattedByteLimit,
  isFileDataTransfer,
  loadAndDecodeXmlFile,
  normalizeDecodedTextForEditor,
  pickFirstDroppedFile,
  resolveFormatWorkerOptions,
  utf8ByteLength,
} from '../../packages/app/src/decodeXml';
import { prepareXmlSaveBytes } from '../../packages/app/src/saveXml';
import {
  XPATH_DEBOUNCE_MS,
  xpathStatusFromWorkerOutcome,
  type XPathStatusState,
} from '../../packages/app/src/xpathCursor';
import {
  createFormatTransactionSpec,
  createXmlEditorExtensions,
  extractXPathLookupInput,
  mapDiagnosticsToLint,
  shouldDiscardSpikeXPathResult,
} from './bridge';
import './styles.css';

type ThemeMode = 'light' | 'dark' | 'high-contrast';
type MessageKey = keyof typeof enCatalog;

const CATALOGS: Readonly<Record<LocaleCode, MessageCatalog>> = {
  en: enCatalog,
  ja: jaCatalog,
};

const MAX_PREVIEW_BYTES = 1024 * 1024;
const INPUT_DEBOUNCE_MS = 300;

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

function mountSpike(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  let locale: LocaleCode = 'en';
  let theme: ThemeMode = 'light';
  const indentStyle: IndentStyle = 'spaces-2';
  let loadedLineEnding: LineEnding = 'LF';
  let hasLoadedFile = false;
  let isModifiedSinceLoad = false;
  let assumedEncoding: string | undefined;
  let lastDiagnostics: readonly Diagnostic[] = [];
  let lastResult: WellFormednessResult | null = null;
  let xpathStatus: XPathStatusState = { kind: 'none' };
  let cspViolationCount = 0;
  let lastCspDirective = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let xpathTimer: ReturnType<typeof setTimeout> | null = null;
  let checkEpoch = 0;
  let xpathEpoch = 0;

  const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
    formatMessage(CATALOGS[locale], CATALOGS.en, key, params);

  const formatLocalizedDiag = (diag: Diagnostic): string =>
    formatMessage(CATALOGS[locale], CATALOGS.en, diag.messageKey, diag.params);

  const spawnWorker = (): Worker =>
    new Worker(new URL('../../packages/workers/src/xmlWorker.ts', import.meta.url), {
      type: 'module',
    });
  const wfClient = createWellFormednessWorkerClient(spawnWorker);
  const xpathClient = createXPathWorkerClient(spawnWorker);

  window.addEventListener('pagehide', () => {
    wfClient.dispose();
    xpathClient.dispose();
  });

  const workbench = createEl('div', { className: 'workbench' });
  const titleBar = createEl('header', { className: 'title-bar' });
  const titleHeading = createEl('h1', {
    className: 'app-title',
    text: `${t('app.name')} — CodeMirror 6 Spike`,
  });
  titleBar.appendChild(titleHeading);
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
      accept: '.xml,.xsd,.xsl,.xslt,.sch,.rng,.svg',
      tabindex: '-1',
      'aria-hidden': 'true',
    },
  });
  const openBtn = createEl('button', {
    className: 'tb-btn',
    text: t('toolbar.openFile'),
    attrs: { type: 'button', id: 'spike-open' },
  });
  const sampleBtn = createEl('button', {
    className: 'tb-btn',
    text: t('toolbar.loadSample'),
    attrs: { type: 'button', id: 'spike-sample' },
  });
  const formatBtn = createEl('button', {
    className: 'tb-btn',
    text: t('toolbar.format'),
    attrs: { type: 'button', id: 'spike-format' },
  });
  const undoBtn = createEl('button', {
    className: 'tb-btn',
    text: 'Undo',
    attrs: { type: 'button', id: 'spike-undo' },
  });
  const redoBtn = createEl('button', {
    className: 'tb-btn',
    text: 'Redo',
    attrs: { type: 'button', id: 'spike-redo' },
  });
  const searchBtn = createEl('button', {
    className: 'tb-btn',
    text: 'Search',
    attrs: { type: 'button', id: 'spike-search' },
  });
  const checkSaveBtn = createEl('button', {
    className: 'tb-btn',
    text: 'Verify Save Round-Trip',
    attrs: { type: 'button', id: 'spike-verify-save' },
  });

  actionsGroup.append(
    fileInput,
    openBtn,
    sampleBtn,
    formatBtn,
    undoBtn,
    redoBtn,
    searchBtn,
    checkSaveBtn,
  );

  const settingsGroup = createEl('div', { className: 'toolbar-settings' });
  const langLabel = createEl('label', {
    className: 'control-label',
    text: t('nav.language'),
    attrs: { for: 'spike-locale' },
  });
  const langSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'spike-locale' },
  });
  for (const code of ['en', 'ja'] as const) {
    langSelect.appendChild(
      createEl('option', {
        text: code === 'en' ? 'English' : '日本語',
        attrs: { value: code },
      }),
    );
  }
  const themeLabel = createEl('label', {
    className: 'control-label',
    text: t('nav.theme'),
    attrs: { for: 'spike-theme' },
  });
  const themeSelect = createEl('select', {
    className: 'tb-select',
    attrs: { id: 'spike-theme' },
  });
  const themeValues: readonly ThemeMode[] = ['light', 'dark', 'high-contrast'];
  for (const mode of themeValues) {
    themeSelect.appendChild(
      createEl('option', {
        text:
          mode === 'light'
            ? t('theme.light')
            : mode === 'dark'
              ? t('theme.dark')
              : t('theme.highContrast'),
        attrs: { value: mode },
      }),
    );
  }
  settingsGroup.append(langLabel, langSelect, themeLabel, themeSelect);
  toolbar.append(actionsGroup, settingsGroup);
  workbench.appendChild(toolbar);

  const workspace = createEl('main', {
    className: 'workspace',
    attrs: { id: 'main-content' },
  });

  const editorPane = createEl('section', {
    className: 'pane',
    attrs: { 'aria-labelledby': 'spike-editor-heading' },
  });
  const editorHeading = createEl('h2', {
    className: 'pane-header',
    text: t('pane.editorHeading'),
    attrs: { id: 'spike-editor-heading' },
  });
  const cmHost = createEl('div', {
    className: 'cm-host',
    attrs: { id: 'cm-host' },
  });
  editorPane.append(editorHeading, cmHost);

  const diagPane = createEl('section', {
    className: 'pane',
    attrs: { 'aria-labelledby': 'spike-diag-heading' },
  });
  const diagHeading = createEl('h2', {
    className: 'pane-header',
    text: t('pane.diagnosticsHeading'),
    attrs: { id: 'spike-diag-heading' },
  });
  const diagBody = createEl('div', { className: 'diagnostics-body' });
  const resultBox = createEl('div', {
    className: 'diag-message',
    attrs: { id: 'spike-diag-summary', role: 'status', 'aria-live': 'polite' },
  });
  const diagList = createEl('ul', {
    className: 'diag-list',
    attrs: { id: 'spike-diag-list', 'aria-label': t('diagnostics.listLabel') },
  });
  diagBody.append(resultBox, diagList);
  diagPane.append(diagHeading, diagBody);

  workspace.append(editorPane, diagPane);
  workbench.appendChild(workspace);

  const statusBar = createEl('footer', {
    className: 'status-bar',
    attrs: { role: 'contentinfo', 'aria-label': t('statusBar.label') },
  });
  const statusFields = createEl('div', { className: 'status-fields' });
  const statusState = createEl('span', {
    className: 'status-field',
    text: t('statusBar.ready'),
    attrs: { id: 'spike-status-state' },
  });
  const statusCount = createEl('span', {
    className: 'status-field',
    text: t('statusBar.elements', { count: 0 }),
    attrs: { id: 'spike-status-elements' },
  });
  const statusXpath = createEl('span', {
    className: 'status-field status-xpath',
    text: t('statusBar.xpath', { value: t('statusBar.xpathNone') }),
    attrs: { id: 'spike-status-xpath' },
  });
  const statusCsp = createEl('span', {
    className: 'status-field status-csp',
    text: 'CSP violations: 0',
    attrs: { id: 'spike-status-csp' },
  });
  const statusSave = createEl('span', {
    className: 'status-field',
    text: 'EOL: LF',
    attrs: { id: 'spike-status-eol' },
  });
  statusFields.append(statusState, statusCount, statusXpath, statusSave, statusCsp);
  statusBar.appendChild(statusFields);
  workbench.appendChild(statusBar);

  root.replaceChildren(workbench);

  const updateCspDisplay = (): void => {
    statusCsp.textContent =
      cspViolationCount === 0
        ? 'CSP violations: 0'
        : `CSP violations: ${cspViolationCount} (${lastCspDirective})`;
    statusCsp.classList.toggle('has-violations', cspViolationCount > 0);
  };

  document.addEventListener('securitypolicyviolation', (event) => {
    cspViolationCount += 1;
    lastCspDirective = event.violatedDirective || event.effectiveDirective || 'unknown';
    updateCspDisplay();
  });

  // Mount CodeMirror 6 inside an open ShadowRoot using adoptedStyleSheets (ADR-0005 Option A).
  const shadowRoot = cmHost.attachShadow({ mode: 'open' });

  const ariaLabelCompartment = new Compartment();

  const renderXPath = (): void => {
    if (xpathStatus.kind === 'path') {
      statusXpath.textContent = t('statusBar.xpath', { value: xpathStatus.breadcrumb });
      statusXpath.title = xpathStatus.breadcrumb;
    } else {
      statusXpath.textContent = t('statusBar.xpath', { value: t('statusBar.xpathNone') });
      statusXpath.removeAttribute('title');
    }
  };

  const renderDiagnostics = (view: EditorView): void => {
    const docLen = view.state.doc.length;
    view.dispatch(
      setDiagnostics(
        view.state,
        mapDiagnosticsToLint(lastDiagnostics, docLen, formatLocalizedDiag),
      ),
    );

    diagList.replaceChildren();
    if (!lastResult) {
      resultBox.className = 'diag-message';
      resultBox.textContent = t('preview.empty');
      statusState.textContent = t('statusBar.ready');
      statusCount.textContent = t('statusBar.elements', { count: 0 });
      return;
    }

    if (lastResult.wellFormed) {
      resultBox.className = 'diag-message is-valid';
      resultBox.textContent = t('preview.valid', {
        count: lastResult.elementCount,
        root: lastResult.rootElement ?? '?',
      });
      statusState.textContent = t('statusBar.wellFormed');
    } else {
      resultBox.className = 'diag-message is-invalid';
      resultBox.textContent = t('preview.invalidCount', {
        errors: lastDiagnostics.filter((d) => d.severity === 'error').length,
        warnings: lastDiagnostics.filter((d) => d.severity !== 'error').length,
      });
      statusState.textContent = t('statusBar.notWellFormed');
    }
    statusCount.textContent = t('statusBar.elements', { count: lastResult.elementCount });

    for (const diag of lastDiagnostics) {
      const li = createEl('li', { className: `diag-item is-${diag.severity}` });
      const btn = createEl('button', {
        className: 'diag-item-btn',
        attrs: { type: 'button' },
      });
      if (diag.range) {
        btn.appendChild(
          createEl('span', {
            className: 'diag-loc',
            text: t('diagnostics.location', {
              line: diag.range.line,
              column: diag.range.column,
            }),
          }),
        );
      }
      btn.appendChild(createEl('span', { text: formatLocalizedDiag(diag) }));
      btn.addEventListener('click', () => {
        const clamped = Math.min(Math.max(0, diag.range?.offset ?? 0), view.state.doc.length);
        view.focus();
        view.dispatch({
          selection: { anchor: clamped },
          scrollIntoView: true,
        });
        void runXPathLookup(view);
      });
      li.appendChild(btn);
      diagList.appendChild(li);
    }
  };

  const runWellFormednessCheck = async (view: EditorView): Promise<void> => {
    const epoch = ++checkEpoch;
    const text = view.state.doc.toString();
    if (!text.trim()) {
      wfClient.cancel();
      lastResult = null;
      lastDiagnostics = [];
      renderDiagnostics(view);
      return;
    }
    if (utf8ByteLength(text) > MAX_PREVIEW_BYTES) {
      wfClient.cancel();
      resultBox.className = 'diag-message is-invalid';
      resultBox.textContent = t('preview.tooLarge', { limitMb: 1 });
      return;
    }

    statusState.textContent = t('statusBar.checking');
    const outcome = await wfClient.check(
      text,
      assumedEncoding !== undefined ? { assumedEncoding } : undefined,
    );
    if (epoch !== checkEpoch || outcome.status !== 'ok') {
      return;
    }
    lastResult = outcome.result;
    lastDiagnostics = outcome.result.diagnostics;
    renderDiagnostics(view);
  };

  const runXPathLookup = async (view: EditorView): Promise<void> => {
    const requestEpoch = ++xpathEpoch;
    const { xml, offset } = extractXPathLookupInput(view.state);
    if (!xml.trim() || utf8ByteLength(xml) > MAX_PREVIEW_BYTES) {
      xpathClient.cancel();
      xpathStatus = { kind: 'none' };
      renderXPath();
      return;
    }
    const outcome = await xpathClient.getXPathAtOffset(xml, offset);
    if (
      outcome.status === 'cancelled' ||
      shouldDiscardSpikeXPathResult({
        requestEpoch,
        currentEpoch: xpathEpoch,
        sentText: xml,
        sentOffset: offset,
        currentDocText: view.state.doc.toString(),
        currentHeadOffset: view.state.selection.main.head,
        isComposing: view.composing,
      })
    ) {
      return;
    }
    xpathStatus = xpathStatusFromWorkerOutcome(outcome);
    renderXPath();
  };

  const scheduleXPath = (view: EditorView): void => {
    if (xpathTimer !== null) {
      clearTimeout(xpathTimer);
    }
    xpathClient.cancel();
    xpathTimer = setTimeout(() => {
      xpathTimer = null;
      void runXPathLookup(view);
    }, XPATH_DEBOUNCE_MS);
  };

  const editorView = new EditorView({
    parent: shadowRoot,
    root: shadowRoot,
    state: EditorState.create({
      doc: '',
      extensions: createXmlEditorExtensions({
        ariaLabel: t('pane.editorHeading'),
        ariaLabelCompartment,
        onUpdate(update) {
          if (update.docChanged) {
            isModifiedSinceLoad = true;
            assumedEncoding = undefined;
            if (debounceTimer !== null) {
              clearTimeout(debounceTimer);
            }
            wfClient.cancel();
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              void runWellFormednessCheck(update.view);
            }, INPUT_DEBOUNCE_MS);
            scheduleXPath(update.view);
          } else if (update.selectionSet) {
            scheduleXPath(update.view);
          }
        },
      }),
    }),
  });

  const applyThemeAndLocale = (): void => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    editorHeading.textContent = t('pane.editorHeading');
    diagHeading.textContent = t('pane.diagnosticsHeading');
    openBtn.textContent = t('toolbar.openFile');
    sampleBtn.textContent = t('toolbar.loadSample');
    formatBtn.textContent = t('toolbar.format');
    editorView.dispatch({
      effects: ariaLabelCompartment.reconfigure(
        EditorView.contentAttributes.of({
          'aria-label': t('pane.editorHeading'),
          spellcheck: 'false',
        }),
      ),
    });
    renderDiagnostics(editorView);
    renderXPath();
  };

  openBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  const handleOpenFile = async (file: File): Promise<void> => {
    const res = await loadAndDecodeXmlFile(file, MAX_PREVIEW_BYTES, 'auto');
    if (res.status !== 'decoded' || !res.decoded.ok) {
      return;
    }
    const normalized = normalizeDecodedTextForEditor(res.decoded.text);
    loadedLineEnding = normalized.lineEnding;
    hasLoadedFile = true;
    isModifiedSinceLoad = false;
    assumedEncoding = res.decoded.assumedEncoding;
    statusSave.textContent = `EOL: ${loadedLineEnding}`;
    editorView.dispatch(createFormatTransactionSpec(editorView.state, normalized.text));
    await runWellFormednessCheck(editorView);
    void runXPathLookup(editorView);
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      void handleOpenFile(file);
    }
  });

  cmHost.addEventListener('dragover', (event) => {
    if (!isFileDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    cmHost.classList.add('is-drag-over');
  });
  cmHost.addEventListener('dragleave', () => cmHost.classList.remove('is-drag-over'));
  cmHost.addEventListener('drop', (event) => {
    cmHost.classList.remove('is-drag-over');
    if (!isFileDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    const dropped = pickFirstDroppedFile(event.dataTransfer);
    if (dropped) {
      void handleOpenFile(dropped);
    }
  });

  sampleBtn.addEventListener('click', () => {
    loadedLineEnding = 'LF';
    hasLoadedFile = false;
    isModifiedSinceLoad = false;
    assumedEncoding = undefined;
    statusSave.textContent = 'EOL: LF';
    editorView.dispatch(createFormatTransactionSpec(editorView.state, t('preview.sampleXml')));
    void runWellFormednessCheck(editorView);
    void runXPathLookup(editorView);
  });

  formatBtn.addEventListener('click', async () => {
    const text = editorView.state.doc.toString();
    const opts = resolveFormatWorkerOptions({
      indentStyle,
      hasLoadedFile,
      isModifiedSinceLoad,
      ...(assumedEncoding !== undefined ? { assumedEncoding } : {}),
    });
    const outcome = await wfClient.format(text, opts);
    if (outcome.status !== 'ok') {
      return;
    }
    const bounded = enforceFormattedByteLimit(outcome.result, MAX_PREVIEW_BYTES);
    if (!bounded.ok) {
      const reason = classifyFormatFailure(bounded.diagnostics);
      resultBox.className = 'diag-message is-invalid';
      resultBox.textContent = `${reason}: ${bounded.diagnostics.map(formatLocalizedDiag).join('; ')}`;
      return;
    }
    editorView.dispatch(createFormatTransactionSpec(editorView.state, bounded.formatted));
    await runWellFormednessCheck(editorView);
    void runXPathLookup(editorView);
  });

  undoBtn.addEventListener('click', () => {
    undo(editorView);
    editorView.focus();
  });

  redoBtn.addEventListener('click', () => {
    redo(editorView);
    editorView.focus();
  });

  searchBtn.addEventListener('click', () => {
    openSearchPanel(editorView);
  });

  checkSaveBtn.addEventListener('click', () => {
    const saveRes = prepareXmlSaveBytes(editorView.state.doc.toString(), {
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: loadedLineEnding,
      updateDeclaration: false,
    });
    statusSave.textContent = saveRes.ok
      ? `Save check OK (${loadedLineEnding}, ${saveRes.bytes.byteLength} B)`
      : `Save check failed: ${saveRes.reason}`;
  });

  langSelect.addEventListener('change', () => {
    locale = langSelect.value === 'ja' ? 'ja' : 'en';
    applyThemeAndLocale();
  });

  themeSelect.addEventListener('change', () => {
    const val = themeSelect.value;
    if (val === 'light' || val === 'dark' || val === 'high-contrast') {
      theme = val;
      applyThemeAndLocale();
    }
  });

  applyThemeAndLocale();
}

mountSpike();
