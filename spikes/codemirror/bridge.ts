import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { xml } from '@codemirror/lang-xml';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { linter, lintKeymap, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Diagnostic } from '@xmlens/core';

export interface SpikeXPathLookupInput {
  readonly xml: string;
  readonly offset: number;
}

export interface SpikeAsyncXPathDiscardCheck {
  readonly requestEpoch: number;
  readonly currentEpoch: number;
  readonly sentText: string;
  readonly sentOffset: number;
  readonly currentDocText: string;
  readonly currentHeadOffset: number;
  readonly isComposing: boolean;
}

export type LocalizedDiagnosticFormatter = (diag: Diagnostic) => string;

/**
 * Maps an `@xmlens/core` Diagnostic (UTF-16 offset in LF-normalized text) into a
 * `@codemirror/lint` Diagnostic clamped to `[0, docLength]`.
 */
export function diagnosticToLintDiagnostic(
  diag: Diagnostic,
  docLength: number,
  formatLocalizedMessage: LocalizedDiagnosticFormatter,
): LintDiagnostic {
  const rawOffset = diag.range?.offset ?? 0;
  const from = Math.min(Math.max(0, Math.floor(rawOffset)), docLength);
  const to = from < docLength ? Math.min(docLength, from + 1) : from;

  return {
    from,
    to,
    severity: diag.severity,
    message: formatLocalizedMessage(diag),
    source: diag.source,
  };
}

export function mapDiagnosticsToLint(
  diagnostics: readonly Diagnostic[],
  docLength: number,
  formatLocalizedMessage: LocalizedDiagnosticFormatter,
): LintDiagnostic[] {
  return diagnostics.map((diag) =>
    diagnosticToLintDiagnostic(diag, docLength, formatLocalizedMessage),
  );
}

/**
 * Builds an atomic, undoable CodeMirror transaction replacing the full document
 * with formatted XML (resolving `textarea.setRangeText` native-undo inconsistencies).
 */
export function createFormatTransactionSpec(
  state: EditorState,
  formattedText: string,
): TransactionSpec {
  const prevHead = state.selection.main.head;
  const clampedHead = Math.min(prevHead, formattedText.length);
  return {
    changes: {
      from: 0,
      to: state.doc.length,
      insert: formattedText,
    },
    selection: { anchor: clampedHead },
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  };
}

/**
 * Extracts `(xml, offset)` in LF-normalized UTF-16 code units for `xpathWorkerClient`.
 */
export function extractXPathLookupInput(state: EditorState): SpikeXPathLookupInput {
  return {
    xml: state.doc.toString(),
    offset: state.selection.main.head,
  };
}

/**
 * Returns true when an async cursor XPath response is stale or superseded (including while IME
 * composition is active) and must not overwrite the status bar.
 */
export function shouldDiscardSpikeXPathResult(check: SpikeAsyncXPathDiscardCheck): boolean {
  return (
    check.isComposing ||
    check.requestEpoch !== check.currentEpoch ||
    check.sentText !== check.currentDocText ||
    check.sentOffset !== check.currentHeadOffset
  );
}

export const xmlSpikeHighlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--cm-tag)', fontWeight: '600' },
  { tag: tags.angleBracket, color: 'var(--text-secondary)' },
  { tag: tags.attributeName, color: 'var(--cm-attr)' },
  { tag: tags.attributeValue, color: 'var(--cm-string)' },
  { tag: tags.string, color: 'var(--cm-string)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--cm-keyword)' },
  { tag: tags.meta, color: 'var(--cm-keyword)' },
  { tag: tags.invalid, color: 'var(--error-text)', textDecoration: 'underline wavy' },
]);

export const xmlSpikeEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    flex: '1 1 auto',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    lineHeight: '1.45',
  },
  '&.cm-focused': {
    outline: '2px solid var(--focus-ring)',
    outlineOffset: '-2px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--cm-gutter-bg)',
    color: 'var(--cm-gutter-fg)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--cm-active-line)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--cm-match-bg)',
    outline: '1px solid var(--focus-ring)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection-bg)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-pane-header)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-cursor': {
      animation: 'none !important',
    },
  },
});

export interface XmlEditorExtensionOptions {
  readonly ariaLabel: string;
  readonly ariaLabelCompartment: Compartment;
  readonly onUpdate?: (update: ViewUpdate) => void;
}

/**
 * Creates the CodeMirror 6 extension bundle for the Option A ShadowRoot spike.
 * Intentionally excludes `EditorView.cspNonce` and `indentWithTab` (so Tab exits editor focus).
 */
export function createXmlEditorExtensions(options: XmlEditorExtensionOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    bracketMatching(),
    syntaxHighlighting(xmlSpikeHighlightStyle),
    xmlSpikeEditorTheme,
    xml(),
    linter(null),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...lintKeymap]),
    options.ariaLabelCompartment.of(
      EditorView.contentAttributes.of({
        'aria-label': options.ariaLabel,
        spellcheck: 'false',
      }),
    ),
    ...(options.onUpdate ? [EditorView.updateListener.of(options.onUpdate)] : []),
  ];
}
