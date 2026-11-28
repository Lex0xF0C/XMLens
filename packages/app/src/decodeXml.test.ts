import { describe, expect, it } from 'vitest';
import { checkWellFormedness } from '@xmlens/core';
import {
  classifyFormatFailure,
  decodeXmlBytes,
  enforceFormattedByteLimit,
  formatEditorXml,
  isFileDataTransfer,
  loadAndDecodeXmlFile,
  normalizeDecodedTextForEditor,
  pickFirstDroppedFile,
  resolveFormatWorkerOptions,
  shouldDiscardAsyncFormatResult,
  utf8ByteLength,
} from './decodeXml';
import { getDefaultSavePreferences } from './saveXml';

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function utf16LeBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return out;
}

function utf16BeBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[i * 2] = (code >> 8) & 0xff;
    out[i * 2 + 1] = code & 0xff;
  }
  return out;
}

describe('decodeXmlBytes', () => {
  it('decodes Shift_JIS bytes (日本語 = 93 FA 96 7B 8C EA) and passes checkWellFormedness without encoding mismatch note', () => {
    const bytes = concatBytes(
      asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><root>'),
      new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
      asciiBytes('</root>'),
    );

    const decoded = decodeXmlBytes(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected Shift_JIS decoding to succeed');
    }

    expect(decoded.encoding).toBe('Shift_JIS');
    expect(decoded.assumedEncoding).toBe('Shift_JIS');
    expect(decoded.hasBom).toBe(false);
    expect(decoded.text).toBe('<?xml version="1.0" encoding="Shift_JIS"?><root>日本語</root>');
    expect(decoded.diagnostics).toEqual([]);

    const check = checkWellFormedness(decoded.text, { assumedEncoding: decoded.assumedEncoding });
    expect(check.wellFormed).toBe(true);
    expect(check.diagnostics).toEqual([]);
  });

  it('decodes EUC-JP bytes (日本語 = C6 FC CB DC B8 EC) and passes checkWellFormedness without encoding mismatch note', () => {
    const bytes = concatBytes(
      asciiBytes('<?xml version="1.0" encoding="EUC-JP"?><root>'),
      new Uint8Array([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]),
      asciiBytes('</root>'),
    );

    const decoded = decodeXmlBytes(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected EUC-JP decoding to succeed');
    }

    expect(decoded.encoding).toBe('EUC-JP');
    expect(decoded.assumedEncoding).toBe('EUC-JP');
    expect(decoded.hasBom).toBe(false);
    expect(decoded.text).toBe('<?xml version="1.0" encoding="EUC-JP"?><root>日本語</root>');
    expect(decoded.diagnostics).toEqual([]);

    const check = checkWellFormedness(decoded.text, { assumedEncoding: decoded.assumedEncoding });
    expect(check.wellFormed).toBe(true);
    expect(check.diagnostics).toEqual([]);
  });

  it('decodes UTF-16LE and UTF-16BE with and without BOM and tracks hasBom accurately', () => {
    const xml = '<?xml version="1.0" encoding="UTF-16"?><root>日本語</root>';
    const leWithBom = concatBytes(new Uint8Array([0xff, 0xfe]), utf16LeBytes(xml));
    const decLeBom = decodeXmlBytes(leWithBom);
    expect(decLeBom.ok).toBe(true);
    if (decLeBom.ok) {
      expect(decLeBom.encoding).toBe('UTF-16LE');
      expect(decLeBom.hasBom).toBe(true);
      expect(decLeBom.text).toBe(xml);
      expect(decLeBom.diagnostics).toEqual([]);
      const check = checkWellFormedness(decLeBom.text, {
        assumedEncoding: decLeBom.assumedEncoding,
      });
      expect(check.wellFormed).toBe(true);
      expect(check.diagnostics).toEqual([]);
    }

    const beWithoutBom = utf16BeBytes('<?xml version="1.0"?><root>日本語</root>');
    const decBeNoBom = decodeXmlBytes(beWithoutBom);
    expect(decBeNoBom.ok).toBe(true);
    if (decBeNoBom.ok) {
      expect(decBeNoBom.encoding).toBe('UTF-16BE');
      expect(decBeNoBom.hasBom).toBe(false);
      expect(decBeNoBom.text).toBe('<?xml version="1.0"?><root>日本語</root>');
      const check = checkWellFormedness(decBeNoBom.text, {
        assumedEncoding: decBeNoBom.assumedEncoding,
      });
      expect(check.wellFormed).toBe(true);
    }
  });

  it('returns decode-error on invalid UTF-8 sequences instead of inserting replacement characters', () => {
    const invalidUtf8 = new Uint8Array([0x3c, 0x72, 0x2f, 0x3e, 0xff, 0xfe]);
    const decoded = decodeXmlBytes(invalidUtf8);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failureReason).toBe('decode-error');
      expect(decoded.encoding).toBe('UTF-8');
      expect(decoded.diagnostics.some((d) => d.code === 'XML_DECODE_ERROR')).toBe(true);
    }
  });

  it('falls back to UTF-8 with a warning when an unknown encoding label is encountered', () => {
    const bytes = asciiBytes(
      '<?xml version="1.0" encoding="X-NOT-A-REAL-ENCODING"?><root>ok</root>',
    );
    const decoded = decodeXmlBytes(bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.encoding).toBe('UTF-8');
      expect(decoded.assumedEncoding).toBe('UTF-8');
      expect(decoded.text).toBe(
        '<?xml version="1.0" encoding="X-NOT-A-REAL-ENCODING"?><root>ok</root>',
      );
      expect(decoded.diagnostics).toHaveLength(1);
      expect(decoded.diagnostics[0]).toMatchObject({
        severity: 'warning',
        code: 'XML_UNKNOWN_ENCODING_FALLBACK',
        messageKey: 'diagnostics.encoding.unknownFallback',
        source: 'core',
        params: { requested: 'X-NOT-A-REAL-ENCODING', fallback: 'UTF-8' },
      });
    }
  });

  it('applies explicit override over XML declaration or default', () => {
    const declarationlessSjis = concatBytes(
      asciiBytes('<root>'),
      new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
      asciiBytes('</root>'),
    );

    const autoFail = decodeXmlBytes(declarationlessSjis, 'auto');
    expect(autoFail.ok).toBe(false);

    const forcedSjis = decodeXmlBytes(declarationlessSjis, 'Shift_JIS');
    expect(forcedSjis.ok).toBe(true);
    if (forcedSjis.ok) {
      expect(forcedSjis.encoding).toBe('Shift_JIS');
      expect(forcedSjis.assumedEncoding).toBe('Shift_JIS');
      expect(forcedSjis.source).toBe('override');
      expect(forcedSjis.text).toBe('<root>日本語</root>');
      const check = checkWellFormedness(forcedSjis.text, {
        assumedEncoding: forcedSjis.assumedEncoding,
      });
      expect(check.wellFormed).toBe(true);
    }
  });

  it('keeps XML_ENCODING_DECLARATION_NOTE suppressed when declaration encoding alias matches decoded encoding', () => {
    const bytes = concatBytes(
      asciiBytes('<?xml version="1.0" encoding="cp932"?><root>'),
      new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
      asciiBytes('</root>'),
    );
    const decoded = decodeXmlBytes(bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.encoding).toBe('Shift_JIS');
      expect(decoded.assumedEncoding).toBe('cp932');
      const check = checkWellFormedness(decoded.text, {
        assumedEncoding: decoded.assumedEncoding,
      });
      expect(check.wellFormed).toBe(true);
      expect(check.diagnostics).toEqual([]);
    }
  });

  it('rejects ASCII bytes declaring encoding="UTF-16" without BOM/pattern in auto mode and allows UTF-8 override', () => {
    const oddAsciiDeclUtf16 = asciiBytes('<?xml version="1.0" encoding="UTF-16"?><r/>');
    expect(oddAsciiDeclUtf16.byteLength % 2).toBe(1);
    const oddResult = decodeXmlBytes(oddAsciiDeclUtf16, 'auto');
    expect(oddResult.ok).toBe(false);
    if (!oddResult.ok) {
      expect(oddResult.failureReason).toBe('decode-error');
      expect(oddResult.encoding).toBe('UTF-16');
      expect(
        oddResult.diagnostics.some((d) => d.code === 'XML_ENCODING_DECLARATION_MISMATCH'),
      ).toBe(true);
    }

    const evenAsciiDeclUtf16 = asciiBytes('<?xml version="1.0" encoding="UTF-16"?><ro/>');
    expect(evenAsciiDeclUtf16.byteLength % 2).toBe(0);
    const evenResult = decodeXmlBytes(evenAsciiDeclUtf16, 'auto');
    expect(evenResult.ok).toBe(false);
    if (!evenResult.ok) {
      expect(evenResult.failureReason).toBe('decode-error');
      expect(evenResult.encoding).toBe('UTF-16');
      expect(
        evenResult.diagnostics.some((d) => d.code === 'XML_ENCODING_DECLARATION_MISMATCH'),
      ).toBe(true);
    }

    // Manual override bypasses the auto-detection mismatch so users can still open misdeclared UTF-8 files.
    const overrideResult = decodeXmlBytes(evenAsciiDeclUtf16, 'UTF-8');
    expect(overrideResult.ok).toBe(true);
    if (overrideResult.ok) {
      expect(overrideResult.encoding).toBe('UTF-8');
      expect(overrideResult.text).toBe('<?xml version="1.0" encoding="UTF-16"?><ro/>');
    }

    // Genuine UTF-16 with BOM declaring encoding="UTF-16" continues to succeed in auto mode.
    const genuineUtf16Bom = concatBytes(
      new Uint8Array([0xff, 0xfe]),
      utf16LeBytes('<?xml version="1.0" encoding="UTF-16"?><ro/>'),
    );
    const bomResult = decodeXmlBytes(genuineUtf16Bom, 'auto');
    expect(bomResult.ok).toBe(true);
    if (bomResult.ok) {
      expect(bomResult.encoding).toBe('UTF-16LE');
      expect(bomResult.hasBom).toBe(true);
      expect(bomResult.text).toBe('<?xml version="1.0" encoding="UTF-16"?><ro/>');
    }
  });
});

describe('loadAndDecodeXmlFile & drag-drop helpers', () => {
  it('enforces 3x raw safety cap and decoded UTF-8 byte boundaries consistently', async () => {
    let arrayBufferCalled = false;
    const oversizedReported = await loadAndDecodeXmlFile(
      {
        size: 1024 * 3 + 1,
        arrayBuffer: async () => {
          arrayBufferCalled = true;
          return new ArrayBuffer(0);
        },
      },
      1024,
      'auto',
    );
    expect(oversizedReported).toEqual({ status: 'too-large' });
    expect(arrayBufferCalled).toBe(false);

    const oversizedActual = await loadAndDecodeXmlFile(
      {
        size: 10,
        arrayBuffer: async () => new Uint8Array(1024 * 3 + 1).buffer,
      },
      1024,
      'auto',
    );
    expect(oversizedActual).toEqual({ status: 'too-large' });

    // Exact decoded UTF-8 limit (1024 bytes) succeeds
    const exactXml = `<r>${'a'.repeat(1024 - 7)}</r>`;
    expect(utf8ByteLength(exactXml)).toBe(1024);
    const exactBytes = asciiBytes(exactXml);
    const exactRes = await loadAndDecodeXmlFile(
      {
        size: exactBytes.byteLength,
        arrayBuffer: async () => {
          const ab = new ArrayBuffer(exactBytes.byteLength);
          new Uint8Array(ab).set(exactBytes);
          return ab;
        },
      },
      1024,
      'auto',
    );
    expect(exactRes.status).toBe('decoded');

    // Decoded UTF-8 limit + 1 (1025 bytes) fails with too-large
    const overByOneBytes = asciiBytes(`<r>${'a'.repeat(1025 - 7)}</r>`);
    expect(overByOneBytes.byteLength).toBe(1025);
    const overByOneRes = await loadAndDecodeXmlFile(
      {
        size: overByOneBytes.byteLength,
        arrayBuffer: async () => {
          const ab = new ArrayBuffer(overByOneBytes.byteLength);
          new Uint8Array(ab).set(overByOneBytes);
          return ab;
        },
      },
      1024,
      'auto',
    );
    expect(overByOneRes).toEqual({ status: 'too-large' });

    // ~700,007 bytes of Shift_JIS expands past 1 MiB (1,048,576 bytes) in UTF-8 -> too-large
    const sjisHead = asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><r>');
    const sjisTail = asciiBytes('</r>');
    const sjisChars = 350_000;
    const expandedSjis = new Uint8Array(sjisHead.byteLength + sjisChars * 2 + sjisTail.byteLength);
    expandedSjis.set(sjisHead, 0);
    for (let i = 0; i < sjisChars; i += 1) {
      const off = sjisHead.byteLength + i * 2;
      expandedSjis[off] = 0x93;
      expandedSjis[off + 1] = 0xfa;
    }
    expandedSjis.set(sjisTail, sjisHead.byteLength + sjisChars * 2);
    expect(expandedSjis.byteLength).toBeLessThan(1024 * 1024);
    const sjisExpandedRes = await loadAndDecodeXmlFile(
      {
        size: expandedSjis.byteLength,
        arrayBuffer: async () => {
          const ab = new ArrayBuffer(expandedSjis.byteLength);
          new Uint8Array(ab).set(expandedSjis);
          return ab;
        },
      },
      1024 * 1024,
      'auto',
    );
    expect(sjisExpandedRes).toEqual({ status: 'too-large' });

    const sjisPayload = concatBytes(
      asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><root>'),
      new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
      asciiBytes('</root>'),
    );
    const loaded = await loadAndDecodeXmlFile(
      {
        size: sjisPayload.byteLength,
        arrayBuffer: async () => {
          const ab = new ArrayBuffer(sjisPayload.byteLength);
          new Uint8Array(ab).set(sjisPayload);
          return ab;
        },
      },
      1024,
      'auto',
    );
    expect(loaded.status).toBe('decoded');
    if (loaded.status === 'decoded') {
      expect(loaded.decoded.ok).toBe(true);
      if (loaded.decoded.ok) {
        expect(loaded.decoded.text).toBe(
          '<?xml version="1.0" encoding="Shift_JIS"?><root>日本語</root>',
        );
      }
    }
  });

  it('ignores non-file drags and selects only the first dropped file', () => {
    const firstFile = { size: 5, arrayBuffer: async () => new Uint8Array(5).buffer };
    const secondFile = { size: 8, arrayBuffer: async () => new Uint8Array(8).buffer };

    expect(isFileDataTransfer({ types: ['text/plain'], files: [firstFile] })).toBe(false);
    expect(pickFirstDroppedFile({ types: ['text/plain'], files: [firstFile] })).toBeNull();

    expect(isFileDataTransfer({ types: ['Files'], files: [firstFile, secondFile] })).toBe(true);
    expect(pickFirstDroppedFile({ types: ['Files'], files: [firstFile, secondFile] })).toBe(
      firstFile,
    );
  });

  it('normalizes CRLF and standalone CR to LF for consistent diagnostic offsets while preserving CRLF save default', () => {
    const crlfXml = '<root>\r\n  <a>1</a>\r\n  <b>2</b>\r\n  <bad></root>';
    const decoded = decodeXmlBytes(asciiBytes(crlfXml), 'auto');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected CRLF XML decoding to succeed');
    }

    const normalized = normalizeDecodedTextForEditor(decoded.text);
    expect(normalized.lineEnding).toBe('CRLF');
    expect(normalized.text).toBe('<root>\n  <a>1</a>\n  <b>2</b>\n  <bad></root>');

    // Diagnostic offset computed on normalized text must match LF text (as held by <textarea>.value)
    // and remain identical on re-check, without shifting by the 3 preceding CRLF `\r` characters.
    const initialCheck = checkWellFormedness(normalized.text);
    const recheckFromTextareaLf = checkWellFormedness(normalized.text);
    expect(initialCheck.wellFormed).toBe(false);
    expect(initialCheck.diagnostics[0]?.range?.offset).toBe(
      recheckFromTextareaLf.diagnostics[0]?.range?.offset,
    );
    const offset = initialCheck.diagnostics[0]?.range?.offset ?? -1;
    expect(offset).toBe(normalized.text.length);
    expect(offset).toBe(crlfXml.length - 3);

    // Save preferences still default to the detected CRLF line ending.
    const savePrefs = getDefaultSavePreferences(
      { encoding: decoded.encoding, hasBom: decoded.hasBom },
      normalized.lineEnding,
    );
    expect(savePrefs.lineEnding).toBe('CRLF');

    // Standalone CR line breaks are also normalized to LF.
    const crOnly = normalizeDecodedTextForEditor('<a>\r  <b/>\r</a>');
    expect(crOnly.text).toBe('<a>\n  <b/>\n</a>');
    expect(crOnly.lineEnding).toBe('LF');
  });

  it('forwards assumedEncoding during format failure only when loaded file is unmodified', () => {
    const invalidShiftJisBytes = concatBytes(
      asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><root><bad>'),
      new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
      asciiBytes('</root>'),
    );
    const decoded = decodeXmlBytes(invalidShiftJisBytes, 'auto');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected Shift_JIS decode to succeed');
    }

    const unmodifiedResult = formatEditorXml({
      text: decoded.text,
      indentStyle: 'spaces-2',
      hasLoadedFile: true,
      isModifiedSinceLoad: false,
      assumedEncoding: decoded.assumedEncoding,
    });
    expect(unmodifiedResult.ok).toBe(false);
    if (!unmodifiedResult.ok) {
      expect(unmodifiedResult.diagnostics.some((d) => d.severity === 'error')).toBe(true);
      expect(
        unmodifiedResult.diagnostics.some((d) => d.code === 'XML_ENCODING_DECLARATION_NOTE'),
      ).toBe(false);
    }

    const modifiedResult = formatEditorXml({
      text: decoded.text,
      indentStyle: 'spaces-2',
      hasLoadedFile: true,
      isModifiedSinceLoad: true,
      assumedEncoding: decoded.assumedEncoding,
    });
    expect(modifiedResult.ok).toBe(false);
    if (!modifiedResult.ok) {
      expect(modifiedResult.diagnostics.some((d) => d.severity === 'error')).toBe(true);
      expect(
        modifiedResult.diagnostics.some((d) => d.code === 'XML_ENCODING_DECLARATION_NOTE'),
      ).toBe(true);
    }
  });

  it('classifies format failures into invalid, output-too-large, and internal-error', () => {
    expect(
      classifyFormatFailure([
        {
          severity: 'error',
          code: 'XML_SYNTAX_ERROR',
          messageKey: 'diagnostics.xml.syntaxError',
          source: 'parser',
        },
      ]),
    ).toBe('invalid');

    expect(
      classifyFormatFailure([
        {
          severity: 'error',
          code: 'XML_FORMAT_OUTPUT_TOO_LARGE',
          messageKey: 'diagnostics.xml.formatOutputTooLarge',
          params: { limit: 1024 },
          source: 'core',
        },
      ]),
    ).toBe('output-too-large');

    expect(
      classifyFormatFailure([
        {
          severity: 'error',
          code: 'XML_FORMAT_INTERNAL_ERROR',
          messageKey: 'diagnostics.xml.formatInternalError',
          params: { detail: 'unexpected' },
          source: 'core',
        },
      ]),
    ).toBe('internal-error');
  });

  it('enforces both maxOutputChars and maxOutputUtf8Bytes (catching multi-byte UTF-8 expansion)', () => {
    // 20 Japanese hiragana chars = 20 UTF-16 code units (< maxOutputChars=40),
    // but in UTF-8 each char is 3 bytes (<a>\n  あ...\n</a> -> 20*3 + 12 = 72 UTF-8 bytes > 60).
    const multiByteXml = `<a>${'あ'.repeat(20)}<b/></a>`;
    const charPassOnly = formatEditorXml({
      text: multiByteXml,
      indentStyle: 'spaces-2',
      hasLoadedFile: false,
      isModifiedSinceLoad: false,
      maxOutputChars: 100,
    });
    expect(charPassOnly.ok).toBe(true);
    if (!charPassOnly.ok) {
      throw new Error('Expected character-only limit to pass');
    }
    expect(charPassOnly.formatted.length).toBeLessThanOrEqual(100);
    expect(utf8ByteLength(charPassOnly.formatted)).toBeGreaterThan(60);

    const utf8Rejected = formatEditorXml({
      text: multiByteXml,
      indentStyle: 'spaces-2',
      hasLoadedFile: false,
      isModifiedSinceLoad: false,
      maxOutputChars: 100,
      maxOutputUtf8Bytes: 60,
    });
    expect(utf8Rejected.ok).toBe(false);
    if (!utf8Rejected.ok) {
      expect(classifyFormatFailure(utf8Rejected.diagnostics)).toBe('output-too-large');
      expect(utf8Rejected.diagnostics[0]).toMatchObject({
        code: 'XML_FORMAT_OUTPUT_TOO_LARGE',
        messageKey: 'diagnostics.xml.formatOutputTooLargeBytes',
        params: { limit: 60 },
      });
    }

    // Directly verify enforceFormattedByteLimit passes at exact UTF-8 byte boundary and rejects +1.
    const exactBytes = utf8ByteLength(charPassOnly.formatted);
    expect(enforceFormattedByteLimit(charPassOnly, exactBytes).ok).toBe(true);
    const overByOne = enforceFormattedByteLimit(charPassOnly, exactBytes - 1);
    expect(overByOne.ok).toBe(false);
    if (!overByOne.ok) {
      expect(classifyFormatFailure(overByOne.diagnostics)).toBe('output-too-large');
      expect(overByOne.diagnostics[0]).toMatchObject({
        code: 'XML_FORMAT_OUTPUT_TOO_LARGE',
        messageKey: 'diagnostics.xml.formatOutputTooLargeBytes',
        params: { limit: exactBytes - 1 },
      });
    }
  });

  it('builds worker format options cleanly and discards stale async format results', () => {
    expect(
      resolveFormatWorkerOptions({
        indentStyle: 'tab',
        hasLoadedFile: true,
        isModifiedSinceLoad: false,
        assumedEncoding: 'Shift_JIS',
        maxOutputChars: 1048576,
      }),
    ).toEqual({
      indentStyle: 'tab',
      maxOutputChars: 1048576,
      assumedEncoding: 'Shift_JIS',
    });

    expect(
      resolveFormatWorkerOptions({
        indentStyle: 'spaces-2',
        hasLoadedFile: true,
        isModifiedSinceLoad: true,
        assumedEncoding: 'Shift_JIS',
        maxOutputChars: 1048576,
      }),
    ).toEqual({
      indentStyle: 'spaces-2',
      maxOutputChars: 1048576,
    });

    expect(
      shouldDiscardAsyncFormatResult({
        requestEpoch: 3,
        currentEpoch: 3,
        sentText: '<a><b/></a>',
        currentTextareaValue: '<a><b/></a>',
      }),
    ).toBe(false);

    expect(
      shouldDiscardAsyncFormatResult({
        requestEpoch: 3,
        currentEpoch: 4,
        sentText: '<a><b/></a>',
        currentTextareaValue: '<a><b/></a>',
      }),
    ).toBe(true);

    expect(
      shouldDiscardAsyncFormatResult({
        requestEpoch: 3,
        currentEpoch: 3,
        sentText: '<a><b/></a>',
        currentTextareaValue: '<a><b/><c/></a>',
      }),
    ).toBe(true);
  });
});
