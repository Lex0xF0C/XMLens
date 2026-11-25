import { describe, expect, it } from 'vitest';
import { checkWellFormedness } from '@xmlens/core';
import {
  decodeXmlBytes,
  isFileDataTransfer,
  loadAndDecodeXmlFile,
  pickFirstDroppedFile,
} from './decodeXml';

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

  it('pins current auto behavior for ASCII bytes declaring encoding="UTF-16" without BOM/pattern (pending maintainer decision)', () => {
    // Odd byte length (43 bytes) triggers fatal TextDecoder('utf-16le') failure -> decode-error.
    const oddAsciiDeclUtf16 = asciiBytes('<?xml version="1.0" encoding="UTF-16"?><r/>');
    expect(oddAsciiDeclUtf16.byteLength % 2).toBe(1);
    const oddResult = decodeXmlBytes(oddAsciiDeclUtf16, 'auto');
    expect(oddResult.ok).toBe(false);
    if (!oddResult.ok) {
      expect(oddResult.failureReason).toBe('decode-error');
      expect(oddResult.encoding).toBe('UTF-16');
      expect(oddResult.diagnostics.some((d) => d.code === 'XML_DECODE_ERROR')).toBe(true);
    }

    // Even byte length (44 bytes): WHATWG TextDecoder('UTF-16') maps to 'utf-16le' and decodes
    // ASCII byte pairs as UTF-16LE code units unless an unpaired surrogate happens to appear.
    const evenAsciiDeclUtf16 = asciiBytes('<?xml version="1.0" encoding="UTF-16"?><ro/>');
    expect(evenAsciiDeclUtf16.byteLength % 2).toBe(0);
    const evenResult = decodeXmlBytes(evenAsciiDeclUtf16, 'auto');
    expect(evenResult.ok).toBe(true);
    if (evenResult.ok) {
      expect(evenResult.encoding).toBe('UTF-16');
      expect(evenResult.text).not.toContain('<?xml');
    }
  });
});

describe('loadAndDecodeXmlFile & drag-drop helpers', () => {
  it('enforces size limits before reading and decodes valid files through the shared pipeline', async () => {
    let arrayBufferCalled = false;
    const oversizedReported = await loadAndDecodeXmlFile(
      {
        size: 1025,
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
        arrayBuffer: async () => new Uint8Array(1025).buffer,
      },
      1024,
      'auto',
    );
    expect(oversizedActual).toEqual({ status: 'too-large' });

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
});
