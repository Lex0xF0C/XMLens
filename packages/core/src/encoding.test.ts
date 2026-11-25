import { describe, expect, it } from 'vitest';
import { detectXmlEncoding } from './index';

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
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

describe('detectXmlEncoding', () => {
  it('defaults empty input and declaration-less XML to UTF-8', () => {
    expect(detectXmlEncoding(new Uint8Array(0))).toEqual({
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });

    const noDecl = asciiBytes('<root><item>ok</item></root>');
    expect(detectXmlEncoding(noDecl)).toEqual({
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });

    const declWithoutEncoding = asciiBytes('<?xml version="1.0"?><root/>');
    expect(detectXmlEncoding(declWithoutEncoding)).toEqual({
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });
  });

  it('detects UTF-8, UTF-16LE, and UTF-16BE BOMs', () => {
    const utf8Bom = concatBytes(
      new Uint8Array([0xef, 0xbb, 0xbf]),
      asciiBytes('<?xml version="1.0" encoding="utf-8"?><doc/>'),
    );
    expect(detectXmlEncoding(utf8Bom)).toEqual({
      encoding: 'UTF-8',
      source: 'bom',
      bomLength: 3,
      declaredEncoding: 'utf-8',
      supported: true,
      diagnostics: [],
    });

    const utf16LeBom = concatBytes(
      new Uint8Array([0xff, 0xfe]),
      utf16LeBytes('<?xml version="1.0" encoding="UTF-16"?><doc/>'),
    );
    expect(detectXmlEncoding(utf16LeBom)).toEqual({
      encoding: 'UTF-16LE',
      source: 'bom',
      bomLength: 2,
      declaredEncoding: 'UTF-16',
      supported: true,
      diagnostics: [],
    });

    const utf16BeBom = concatBytes(new Uint8Array([0xfe, 0xff]), utf16BeBytes('<doc/>'));
    expect(detectXmlEncoding(utf16BeBom)).toEqual({
      encoding: 'UTF-16BE',
      source: 'bom',
      bomLength: 2,
      supported: true,
      diagnostics: [],
    });
  });

  it('detects BOM-less UTF-16LE and UTF-16BE from Appendix F <?xm patterns', () => {
    const leNoBom = utf16LeBytes('<?xml version="1.0"?><doc/>');
    expect(detectXmlEncoding(leNoBom)).toEqual({
      encoding: 'UTF-16LE',
      source: 'pattern',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });

    const beNoBom = utf16BeBytes('<?xml version="1.0" encoding="UTF-16BE"?><doc/>');
    expect(detectXmlEncoding(beNoBom)).toEqual({
      encoding: 'UTF-16BE',
      source: 'pattern',
      bomLength: 0,
      declaredEncoding: 'UTF-16BE',
      supported: true,
      diagnostics: [],
    });
  });

  it('extracts Shift_JIS and EUC-JP encoding declarations with double or single quotes and case-insensitive normalization', () => {
    const sjisDouble = asciiBytes('<?xml version="1.0" encoding="shift_jis"?><root/>');
    expect(detectXmlEncoding(sjisDouble)).toEqual({
      encoding: 'Shift_JIS',
      source: 'declaration',
      bomLength: 0,
      declaredEncoding: 'shift_jis',
      supported: true,
      diagnostics: [],
    });

    const eucJpSingle = asciiBytes("<?xml version='1.0' encoding='euc-jp'?><root/>");
    expect(detectXmlEncoding(eucJpSingle)).toEqual({
      encoding: 'EUC-JP',
      source: 'declaration',
      bomLength: 0,
      declaredEncoding: 'euc-jp',
      supported: true,
      diagnostics: [],
    });
  });

  it('does not treat a non-leading XML declaration as an encoding declaration', () => {
    const leadingWhitespace = asciiBytes('  <?xml version="1.0" encoding="Shift_JIS"?><root/>');
    expect(detectXmlEncoding(leadingWhitespace)).toEqual({
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });

    const insideElement = asciiBytes('<root><?xml version="1.0" encoding="EUC-JP"?></root>');
    expect(detectXmlEncoding(insideElement)).toEqual({
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    });
  });

  it('reports unsupported UTF-32 BOM/pattern and EBCDIC pattern with error diagnostics', () => {
    const utf32LeBom = concatBytes(
      new Uint8Array([0xff, 0xfe, 0x00, 0x00]),
      new Uint8Array([0x3c, 0x00, 0x00, 0x00]),
    );
    const resLeBom = detectXmlEncoding(utf32LeBom);
    expect(resLeBom.supported).toBe(false);
    expect(resLeBom.encoding).toBe('UTF-32LE');
    expect(resLeBom.bomLength).toBe(4);
    expect(resLeBom.source).toBe('bom');
    expect(resLeBom.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_UNSUPPORTED_ENCODING',
      messageKey: 'diagnostics.encoding.unsupported',
      source: 'core',
      params: { encoding: 'UTF-32LE' },
    });

    const utf32BeBom = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x3c]);
    const resBeBom = detectXmlEncoding(utf32BeBom);
    expect(resBeBom.supported).toBe(false);
    expect(resBeBom.encoding).toBe('UTF-32BE');
    expect(resBeBom.bomLength).toBe(4);

    const utf32BePattern = new Uint8Array([0x00, 0x00, 0x00, 0x3c, 0x00, 0x00, 0x00, 0x3f]);
    expect(detectXmlEncoding(utf32BePattern)).toMatchObject({
      encoding: 'UTF-32BE',
      source: 'pattern',
      bomLength: 0,
      supported: false,
    });

    const utf32LePattern = new Uint8Array([0x3c, 0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x00]);
    expect(detectXmlEncoding(utf32LePattern)).toMatchObject({
      encoding: 'UTF-32LE',
      source: 'pattern',
      bomLength: 0,
      supported: false,
    });

    const ebcdicPattern = new Uint8Array([0x4c, 0x6f, 0xa7, 0x94, 0x40]);
    const resEbcdic = detectXmlEncoding(ebcdicPattern);
    expect(resEbcdic.supported).toBe(false);
    expect(resEbcdic.encoding).toBe('EBCDIC');
    expect(resEbcdic.source).toBe('pattern');
    expect(resEbcdic.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_UNSUPPORTED_ENCODING',
      messageKey: 'diagnostics.encoding.unsupported',
      source: 'core',
      params: { encoding: 'EBCDIC' },
    });
  });

  it('prefers BOM over conflicting XML declaration and emits a core warning Diagnostic', () => {
    const utf16WithUtf8Decl = concatBytes(
      new Uint8Array([0xff, 0xfe]),
      utf16LeBytes('<?xml version="1.0" encoding="UTF-8"?><doc/>'),
    );
    const resUtf16 = detectXmlEncoding(utf16WithUtf8Decl);
    expect(resUtf16.supported).toBe(true);
    expect(resUtf16.encoding).toBe('UTF-16LE');
    expect(resUtf16.source).toBe('bom');
    expect(resUtf16.bomLength).toBe(2);
    expect(resUtf16.declaredEncoding).toBe('UTF-8');
    expect(resUtf16.diagnostics).toHaveLength(1);
    expect(resUtf16.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_ENCODING_BOM_CONFLICT',
      messageKey: 'diagnostics.encoding.bomConflict',
      source: 'core',
      params: { detected: 'UTF-16LE', declared: 'UTF-8' },
    });

    const utf8BomWithSjisDecl = concatBytes(
      new Uint8Array([0xef, 0xbb, 0xbf]),
      asciiBytes('<?xml version="1.0" encoding="Shift_JIS"?><doc/>'),
    );
    const resUtf8 = detectXmlEncoding(utf8BomWithSjisDecl);
    expect(resUtf8.encoding).toBe('UTF-8');
    expect(resUtf8.source).toBe('bom');
    expect(resUtf8.bomLength).toBe(3);
    expect(resUtf8.declaredEncoding).toBe('Shift_JIS');
    expect(resUtf8.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_ENCODING_BOM_CONFLICT',
      source: 'core',
      params: { detected: 'UTF-8', declared: 'Shift_JIS' },
    });
  });
});
