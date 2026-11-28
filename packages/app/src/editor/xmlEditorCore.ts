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
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Diagnostic } from '@xmlens/core';

export type ProgrammaticDocChangeSource = 'format';

/**
 * Marks document-changing transactions originated by XMLens actions (e.g. Format) so the
 * `updateListener` distinguishes them from user edits/Undo/Redo without relying on `setState`.
 */
export const PROGRAMMATIC_DOC_CHANGE_ANNOTATION = Annotation.define<ProgrammaticDocChangeSource>();

export type LocalizedDiagnosticFormatter = (diag: Diagnostic) => string;

export interface EditorUpdateClassification {
  readonly docChanged: boolean;
  readonly userEdited: boolean;
  readonly selectionSet: boolean;
}

export type FileDragEventType = 'dragenter' | 'dragover' | 'drop';

export interface FileDragDecision {
  readonly intercept: boolean;
  readonly dragOver: boolean;
  readonly dropEffect?: 'copy';
  readonly triggerDrop: boolean;
}

/**
 * Clamps a UTF-16 editor offset safely into `[0, docLength]`.
 */
export function clampEditorOffset(offset: number, docLength: number): number {
  const safeMax = Number.isFinite(docLength) ? Math.max(0, Math.floor(docLength)) : 0;
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(offset)), safeMax);
}

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
  const from = clampEditorOffset(rawOffset, docLength);
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
 * Builds an atomic, undoable CodeMirror transaction replacing the full document with formatted XML
 * and tagging it with `PROGRAMMATIC_DOC_CHANGE_ANNOTATION` so `documentEditState` transitions are
 * driven explicitly on worker completion rather than implicitly in `updateListener`.
 */
export function createFormatTransactionSpec(
  state: EditorState,
  formattedText: string,
): TransactionSpec {
  const clampedHead = clampEditorOffset(state.selection.main.head, formattedText.length);
  return {
    changes: {
      from: 0,
      to: state.doc.length,
      insert: formattedText,
    },
    selection: { anchor: clampedHead },
    annotations: [isolateHistory.of('full'), PROGRAMMATIC_DOC_CHANGE_ANNOTATION.of('format')],
    scrollIntoView: true,
  };
}

/**
 * Classifies a CodeMirror `ViewUpdate`-compatible snapshot to determine whether any transaction
 * represents a non-programmatic user edit (including Undo/Redo).
 */
export function classifyEditorUpdate(update: {
  readonly docChanged: boolean;
  readonly selectionSet: boolean;
  readonly transactions: readonly Transaction[];
}): EditorUpdateClassification {
  const userEdited = update.transactions.some(
    (tr) => tr.docChanged && tr.annotation(PROGRAMMATIC_DOC_CHANGE_ANNOTATION) === undefined,
  );
  return {
    docChanged: update.docChanged,
    userEdited,
    selectionSet: update.selectionSet,
  };
}

/**
 * Determines whether a drag-and-drop event on the editor must be intercepted before CodeMirror's
 * built-in `handlers.drop` (which otherwise reads dropped files via `FileReader` and inserts text).
 */
export function evaluateFileDragEvent(
  eventType: FileDragEventType,
  hasFiles: boolean,
): FileDragDecision {
  if (!hasFiles) {
    return {
      intercept: false,
      dragOver: false,
      triggerDrop: false,
    };
  }

  switch (eventType) {
    case 'dragenter':
      return {
        intercept: true,
        dragOver: true,
        triggerDrop: false,
      };
    case 'dragover':
      return {
        intercept: true,
        dragOver: true,
        dropEffect: 'copy',
        triggerDrop: false,
      };
    case 'drop':
      return {
        intercept: true,
        dragOver: false,
        triggerDrop: true,
      };
  }
}

/**
 * Extracts `(xml, offset)` in LF-normalized UTF-16 code units from an `EditorState`.
 */
export function extractXPathLookupInput(state: EditorState): {
  readonly xml: string;
  readonly offset: number;
} {
  return {
    xml: state.doc.toString(),
    offset: state.selection.main.head,
  };
}

export function createXmlEditorAriaAttributes(ariaLabel: string): Record<string, string> {
  return {
    'aria-label': ariaLabel,
    spellcheck: 'false',
  };
}

export const xmlEditorHighlightStyle = HighlightStyle.define([
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

export const xmlEditorTheme = EditorView.theme({
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
  '.cm-content': {
    padding: '6px 0',
  },
  '.cm-placeholder': {
    color: 'var(--text-secondary)',
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
  readonly placeholderText: string;
  readonly placeholderCompartment: Compartment;
  readonly extraExtensions?: readonly Extension[];
}

/**
 * Creates the production CodeMirror 6 extension bundle for Option A (`ShadowRoot` +
 * `adoptedStyleSheets`). Intentionally omits `EditorView.cspNonce` and `indentWithTab` (so `Tab`
 * / `Shift+Tab` move keyboard focus out of the editor cleanly).
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
    syntaxHighlighting(xmlEditorHighlightStyle),
    xmlEditorTheme,
    xml(),
    linter(null),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...lintKeymap]),
    options.ariaLabelCompartment.of(
      EditorView.contentAttributes.of(createXmlEditorAriaAttributes(options.ariaLabel)),
    ),
    options.placeholderCompartment.of(placeholder(options.placeholderText)),
    ...(options.extraExtensions ?? []),
  ];
}
