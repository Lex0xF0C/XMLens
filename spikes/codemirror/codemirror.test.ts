import { isolateHistory, redo, undo } from '@codemirror/commands';
import { foldable, matchBrackets } from '@codemirror/language';
import { Compartment, EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { checkWellFormedness, formatXml, getXPathAtOffset } from '@xmlens/core';
import { describe, expect, it } from 'vitest';
import { decodeXmlBytes, normalizeDecodedTextForEditor } from '../../packages/app/src/decodeXml';
import { prepareXmlSaveBytes } from '../../packages/app/src/saveXml';
import {
  createFormatTransactionSpec,
  createXmlEditorExtensions,
  diagnosticToLintDiagnostic,
  extractXPathLookupInput,
  mapDiagnosticsToLint,
  shouldDiscardSpikeXPathResult,
} from './bridge';

function createNodeSpikeState(doc: string, ariaLabel: string = 'XML Input'): EditorState {
  return EditorState.create({
    doc,
    extensions: createXmlEditorExtensions({
      ariaLabel,
      ariaLabelCompartment: new Compartment(),
    }),
  });
}

describe('CodeMirror 6 spike integration (Node / pure EditorState)', () => {
  it('supports multi-step XML editing and Undo/Redo history', () => {
    let state = createNodeSpikeState('<root/>');

    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: '<root><a/></root>' },
    }).state;
    // Isolate history explicitly because synchronous test edits share the same timestamp
    const insertPos = state.doc.toString().indexOf('</root>');
    state = state.update({
      changes: { from: insertPos, to: insertPos, insert: '<b/>' },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.type',
    }).state;
    expect(state.doc.toString()).toBe('<root><a/><b/></root>');

    let dispatched: EditorState = state;
    const fakeTarget = {
      get state() {
        return dispatched;
      },
      dispatch(tr: Transaction) {
        dispatched = tr.state;
      },
    };

    expect(undo(fakeTarget)).toBe(true);
    expect(dispatched.doc.toString()).toBe('<root><a/></root>');

    expect(undo(fakeTarget)).toBe(true);
    expect(dispatched.doc.toString()).toBe('<root/>');

    expect(redo(fakeTarget)).toBe(true);
    expect(dispatched.doc.toString()).toBe('<root><a/></root>');
  });

  it('provides XML folding ranges and OpenTag/CloseTag bracket matching via @codemirror/lang-xml', () => {
    const xml = '<akomaNtoso>\n  <act>\n    <body/>\n  </act>\n</akomaNtoso>';
    const state = createNodeSpikeState(xml);

    const openActEnd = xml.indexOf('<act>') + '<act>'.length;
    const foldRange = foldable(state, xml.indexOf('<act>'), openActEnd);
    expect(foldRange).not.toBeNull();
    if (foldRange) {
      expect(xml.slice(foldRange.from, foldRange.to)).toContain('<body/>');
    }

    const match = matchBrackets(state, xml.indexOf('<act>') + 1, 1);
    expect(match).not.toBeNull();
    expect(match?.matched).toBe(true);
    if (match?.end) {
      expect(xml.slice(match.end.from, match.end.to)).toBe('act');
    }
  });

  it('converts @xmlens/core UTF-16 Diagnostics (including CJK and astral pairs) into @codemirror/lint Diagnostics', () => {
    const xml = '<root><item>日本語𠮷野</item><broken></root>';
    const wf = checkWellFormedness(xml);
    expect(wf.wellFormed).toBe(false);

    const state = createNodeSpikeState(xml);
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

    // Clamps out-of-bounds offsets safely at EOF
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
  });

  it('applies formatXml output as an undoable CodeMirror transaction (resolving ADR-0012 setRangeText limit)', () => {
    const compact = '<root><a><b/></a></root>';
    let state = createNodeSpikeState(compact);
    const formatted = formatXml(compact, { indentStyle: 'spaces-2' });
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) {
      throw new Error('Expected formatXml to succeed');
    }

    state = state.update(createFormatTransactionSpec(state, formatted.formatted)).state;
    expect(state.doc.toString()).toBe('<root>\n  <a>\n    <b/>\n  </a>\n</root>');

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
    expect(current.doc.toString()).toBe(compact);
    expect(redo(target)).toBe(true);
    expect(current.doc.toString()).toBe('<root>\n  <a>\n    <b/>\n  </a>\n</root>');
  });

  it('connects CodeMirror selection head to getXPathAtOffset and discards stale/composing responses', () => {
    const xml =
      '<akomaNtoso><act><body><article/><article><p>text</p></article></body></act></akomaNtoso>';
    const offset = xml.indexOf('text') + 1;
    const state = EditorState.create({
      doc: xml,
      selection: { anchor: offset },
    });

    const input = extractXPathLookupInput(state);
    expect(input).toEqual({ xml, offset });

    const xpathRes = getXPathAtOffset(input.xml, input.offset);
    expect(xpathRes.ok).toBe(true);
    if (xpathRes.ok) {
      expect(xpathRes.breadcrumb).toBe('akomaNtoso › act › body › article[2] › p');
    }

    expect(
      shouldDiscardSpikeXPathResult({
        requestEpoch: 1,
        currentEpoch: 1,
        sentText: xml,
        sentOffset: offset,
        currentDocText: xml,
        currentHeadOffset: offset,
        isComposing: false,
      }),
    ).toBe(false);

    expect(
      shouldDiscardSpikeXPathResult({
        requestEpoch: 1,
        currentEpoch: 1,
        sentText: xml,
        sentOffset: offset,
        currentDocText: xml,
        currentHeadOffset: offset,
        isComposing: true,
      }),
    ).toBe(true);

    expect(
      shouldDiscardSpikeXPathResult({
        requestEpoch: 1,
        currentEpoch: 2,
        sentText: xml,
        sentOffset: offset,
        currentDocText: xml,
        currentHeadOffset: offset,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it('preserves decodeXml LF-normalization and saveXml CRLF/BOM round-trip semantics', () => {
    const raw = '\uFEFF<root>\r\n  <item>日本語𠮷</item>\r\n</root>';
    const bytes = new TextEncoder().encode(raw);
    const decoded = decodeXmlBytes(bytes, 'auto');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected decode to succeed');
    }

    expect(decoded.hasBom).toBe(true);
    const normalized = normalizeDecodedTextForEditor(decoded.text);
    expect(normalized.lineEnding).toBe('CRLF');
    expect(normalized.text).not.toContain('\r');

    const state = createNodeSpikeState(normalized.text);
    const docText = state.doc.toString();
    expect(docText).toBe('<root>\n  <item>日本語𠮷</item>\n</root>');

    const wf = checkWellFormedness(docText);
    expect(wf.wellFormed).toBe(true);

    const saved = prepareXmlSaveBytes(docText, {
      encoding: 'UTF-8',
      includeBom: decoded.hasBom,
      lineEnding: normalized.lineEnding,
      updateDeclaration: false,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(Array.from(saved.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(saved.finalText).toContain('\r\n');
    }
  });

  it('configures internal aria-label facet and leaves EditorView.cspNonce unset', () => {
    const state = createNodeSpikeState('<root/>', 'XML 入力');
    const contentAttrs = state.facet(EditorView.contentAttributes);
    expect(contentAttrs).toContainEqual({ 'aria-label': 'XML 入力', spellcheck: 'false' });
    expect(state.facet(EditorView.cspNonce)).toBe('');
  });
});
