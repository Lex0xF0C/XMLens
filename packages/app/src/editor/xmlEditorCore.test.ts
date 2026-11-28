import { isolateHistory, redo, undo } from '@codemirror/commands';
import { foldable, matchBrackets } from '@codemirror/language';
import { setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { checkWellFormedness, formatXml, getXPathAtOffset } from '@xmlens/core';
import { describe, expect, it } from 'vitest';
import {
  clampEditorOffset,
  classifyEditorUpdate,
  createFormatTransactionSpec,
  createXmlEditorAriaAttributes,
  createXmlEditorExtensions,
  diagnosticToLintDiagnostic,
  evaluateFileDragEvent,
  extractXPathLookupInput,
  mapDiagnosticsToLint,
} from './xmlEditorCore';

function createNodeEditorState(
  doc: string,
  options?: {
    ariaLabel?: string;
    placeholderText?: string;
    ariaLabelCompartment?: Compartment;
    placeholderCompartment?: Compartment;
  },
): EditorState {
  return EditorState.create({
    doc,
    extensions: createXmlEditorExtensions({
      ariaLabel: options?.ariaLabel ?? 'XML Input',
      ariaLabelCompartment: options?.ariaLabelCompartment ?? new Compartment(),
      placeholderText: options?.placeholderText ?? 'Open an XML file or enter XML here...',
      placeholderCompartment: options?.placeholderCompartment ?? new Compartment(),
    }),
  });
}

describe('xmlEditorCore (Node / pure EditorState)', () => {
  it('distinguishes user-edited transactions (including Undo/Redo) from annotated Format transactions', () => {
    const compact = '<root><a><b/></a></root>';
    let state = createNodeEditorState(compact);

    const formatted = formatXml(compact, { indentStyle: 'spaces-2' });
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) {
      throw new Error('Expected formatXml to succeed');
    }

    const formatTr = state.update(createFormatTransactionSpec(state, formatted.formatted));
    state = formatTr.state;
    expect(formatTr.docChanged).toBe(true);
    expect(
      classifyEditorUpdate({
        docChanged: formatTr.docChanged,
        selectionSet: formatTr.selection !== undefined,
        transactions: [formatTr],
      }),
    ).toEqual({
      docChanged: true,
      userEdited: false,
      selectionSet: true,
    });

    const userTr = state.update({
      changes: { from: 0, to: 0, insert: '<!-- edit -->\n' },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.type',
    });
    state = userTr.state;
    expect(
      classifyEditorUpdate({
        docChanged: userTr.docChanged,
        selectionSet: userTr.selection !== undefined,
        transactions: [userTr],
      }),
    ).toEqual({
      docChanged: true,
      userEdited: true,
      selectionSet: false,
    });

    // Selection-only or diagnostic-effect transactions must never count as user-edited.
    const selTr = state.update({ selection: { anchor: 3 } });
    state = selTr.state;
    expect(
      classifyEditorUpdate({
        docChanged: selTr.docChanged,
        selectionSet: selTr.selection !== undefined,
        transactions: [selTr],
      }),
    ).toEqual({
      docChanged: false,
      userEdited: false,
      selectionSet: true,
    });

    const lintSpec = setDiagnostics(state, [
      { from: 0, to: 1, severity: 'warning', message: 'warn' },
    ]);
    const lintTr = state.update(lintSpec);
    state = lintTr.state;
    expect(
      classifyEditorUpdate({
        docChanged: lintTr.docChanged,
        selectionSet: lintTr.selection !== undefined,
        transactions: [lintTr],
      }),
    ).toEqual({
      docChanged: false,
      userEdited: false,
      selectionSet: false,
    });

    // Undo and Redo produce non-programmatic docChanged transactions and count as userEdited.
    let current = state;
    const captured: Transaction[] = [];
    const target = {
      get state() {
        return current;
      },
      dispatch(tr: Transaction) {
        captured.push(tr);
        current = tr.state;
      },
    };

    expect(undo(target)).toBe(true);
    const undoTr = captured[0];
    expect(undoTr).toBeDefined();
    if (undoTr) {
      expect(
        classifyEditorUpdate({
          docChanged: undoTr.docChanged,
          selectionSet: undoTr.selection !== undefined,
          transactions: [undoTr],
        }),
      ).toMatchObject({ docChanged: true, userEdited: true });
    }
    expect(current.doc.toString()).toBe('<root>\n  <a>\n    <b/>\n  </a>\n</root>');

    expect(undo(target)).toBe(true);
    expect(current.doc.toString()).toBe(compact);
    expect(redo(target)).toBe(true);
    expect(current.doc.toString()).toBe('<root>\n  <a>\n    <b/>\n  </a>\n</root>');
  });

  it('clamps Format caret selection safely into the formatted length', () => {
    const state = EditorState.create({
      doc: '<root>   <a/>   </root>',
      selection: { anchor: 22 },
      extensions: createXmlEditorExtensions({
        ariaLabel: 'XML Input',
        ariaLabelCompartment: new Compartment(),
        placeholderText: 'Placeholder',
        placeholderCompartment: new Compartment(),
      }),
    });

    const formatted = '<root>\n  <a/>\n</root>';
    const tr = state.update(createFormatTransactionSpec(state, formatted));
    expect(tr.state.selection.main.head).toBe(formatted.length);
  });

  it('evaluates file drag-and-drop interception decisions without blocking internal text drag', () => {
    expect(evaluateFileDragEvent('dragenter', true)).toEqual({
      intercept: true,
      dragOver: true,
      triggerDrop: false,
    });
    expect(evaluateFileDragEvent('dragover', true)).toEqual({
      intercept: true,
      dragOver: true,
      dropEffect: 'copy',
      triggerDrop: false,
    });
    expect(evaluateFileDragEvent('drop', true)).toEqual({
      intercept: true,
      dragOver: false,
      triggerDrop: true,
    });

    for (const evt of ['dragenter', 'dragover', 'drop'] as const) {
      expect(evaluateFileDragEvent(evt, false)).toEqual({
        intercept: false,
        dragOver: false,
        triggerDrop: false,
      });
    }
  });

  it('reconfigures aria-label and placeholder via Compartments while preserving Undo history and leaving cspNonce unset', () => {
    const ariaCompartment = new Compartment();
    const placeholderCompartment = new Compartment();
    let state = createNodeEditorState('<root/>', {
      ariaLabel: 'XML Input',
      placeholderText: 'Enter XML...',
      ariaLabelCompartment: ariaCompartment,
      placeholderCompartment,
    });

    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: '<root><item/></root>' },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.type',
    }).state;

    state = state.update({
      effects: [
        ariaCompartment.reconfigure(
          EditorView.contentAttributes.of(createXmlEditorAriaAttributes('XML 入力')),
        ),
      ],
    }).state;

    expect(state.facet(EditorView.contentAttributes)).toContainEqual({
      'aria-label': 'XML 入力',
      spellcheck: 'false',
    });
    expect(state.facet(EditorView.cspNonce)).toBe('');

    let current = state;
    const target = {
      get state() {
        return current;
      },
      dispatch(tr: Transaction) {
        current = tr.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(current.doc.toString()).toBe('<root/>');
  });

  it('maps @xmlens/core UTF-16 Diagnostics (CJK, surrogate pairs, EOF clamp) into @codemirror/lint Diagnostics', () => {
    const xml = '<root><item>日本語𠮷野</item><broken></root>';
    const wf = checkWellFormedness(xml);
    expect(wf.wellFormed).toBe(false);

    const state = createNodeEditorState(xml);
    const lintDiags = mapDiagnosticsToLint(wf.diagnostics, state.doc.length, (d) => d.messageKey);
    expect(lintDiags.length).toBeGreaterThan(0);

    const first = lintDiags[0];
    expect(first).toBeDefined();
    if (first && wf.diagnostics[0]?.range) {
      expect(first.from).toBe(wf.diagnostics[0].range.offset);
      expect(first.to).toBeGreaterThanOrEqual(first.from);
      expect(first.to).toBeLessThanOrEqual(state.doc.length);
      expect(first.severity).toBe(wf.diagnostics[0].severity);
    }

    const clamped = diagnosticToLintDiagnostic(
      {
        severity: 'error',
        code: 'E',
        messageKey: 'm',
        range: { line: 1, column: 999, offset: 999_999 },
        source: 'parser',
      },
      state.doc.length,
      (d) => d.messageKey,
    );
    expect(clamped.from).toBe(state.doc.length);
    expect(clamped.to).toBe(state.doc.length);
    expect(clampEditorOffset(Number.NaN, 10)).toBe(0);
    expect(clampEditorOffset(-5, 10)).toBe(0);
    expect(clampEditorOffset(4.9, 10)).toBe(4);
  });

  it('supports XML folding, OpenTag/CloseTag bracket matching, and XPath lookup extraction', () => {
    const xml = '<akomaNtoso>\n  <act>\n    <body><p>text</p></body>\n  </act>\n</akomaNtoso>';
    const offset = xml.indexOf('text') + 1;
    const state = EditorState.create({
      doc: xml,
      selection: { anchor: offset },
      extensions: createXmlEditorExtensions({
        ariaLabel: 'XML Input',
        ariaLabelCompartment: new Compartment(),
        placeholderText: 'Placeholder',
        placeholderCompartment: new Compartment(),
      }),
    });

    const openActEnd = xml.indexOf('<act>') + '<act>'.length;
    const foldRange = foldable(state, xml.indexOf('<act>'), openActEnd);
    expect(foldRange).not.toBeNull();
    if (foldRange) {
      expect(xml.slice(foldRange.from, foldRange.to)).toContain('<body>');
    }

    const match = matchBrackets(state, xml.indexOf('<act>') + 1, 1);
    expect(match?.matched).toBe(true);
    if (match?.end) {
      expect(xml.slice(match.end.from, match.end.to)).toBe('act');
    }

    const input = extractXPathLookupInput(state);
    expect(input).toEqual({ xml, offset });
    const xpath = getXPathAtOffset(input.xml, input.offset);
    expect(xpath.ok).toBe(true);
    if (xpath.ok) {
      expect(xpath.breadcrumb).toBe('akomaNtoso › act › body › p');
    }
  });
});
