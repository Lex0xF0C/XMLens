import { describe, expect, it } from 'vitest';
import {
  convertLineEndings,
  detectLineEnding,
  encodeUtf16Bytes,
  findLoneSurrogate,
  formatCodeUnitHex,
  inspectXmlDeclarationForSave,
  rewriteLeadingXmlDeclarationEncoding,
} from './index';

function decodeUtf16ForTest(bytes: Uint8Array, endianness: 'LE' | 'BE', hasBom: boolean): string {
  const start = hasBom ? 2 : 0;
  let out = '';
  for (let i = start; i < bytes.byteLength; i += 2) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const code = endianness === 'LE' ? b0 | (b1 << 8) : (b0 << 8) | b1;
    out += String.fromCharCode(code);
  }
  return out;
}

describe('findLoneSurrogate & encodeUtf16Bytes', () => {
  it('encodes surrogate pairs (e.g. U+20BB7 𠮷 and emoji) cleanly in UTF-16LE and UTF-16BE with/without BOM', () => {
    const sample = '<root>日本語𠮷😀</root>';
    expect(findLoneSurrogate(sample)).toBeNull();

    const leBom = encodeUtf16Bytes(sample, 'LE', { includeBom: true });
    expect(leBom.ok).toBe(true);
    if (!leBom.ok) {
      throw new Error('Expected UTF-16LE encode to succeed');
    }
    expect(Array.from(leBom.bytes.slice(0, 2))).toEqual([0xff, 0xfe]);
    expect(leBom.bytes.byteLength).toBe(2 + sample.length * 2);
    expect(decodeUtf16ForTest(leBom.bytes, 'LE', true)).toBe(sample);

    const beBom = encodeUtf16Bytes(sample, 'BE', { includeBom: true });
    expect(beBom.ok).toBe(true);
    if (!beBom.ok) {
      throw new Error('Expected UTF-16BE encode to succeed');
    }
    expect(Array.from(beBom.bytes.slice(0, 2))).toEqual([0xfe, 0xff]);
    expect(decodeUtf16ForTest(beBom.bytes, 'BE', true)).toBe(sample);

    const leNoBom = encodeUtf16Bytes(sample, 'LE', { includeBom: false });
    expect(leNoBom.ok).toBe(true);
    if (leNoBom.ok) {
      expect(leNoBom.bytes.byteLength).toBe(sample.length * 2);
      expect(decodeUtf16ForTest(leNoBom.bytes, 'LE', false)).toBe(sample);
    }
  });

  it('detects lone high and low surrogates with accurate line, column, and offset and refuses UTF-16 encoding', () => {
    const loneHigh = '<r>\n  a\uD800b</r>';
    const highLoc = findLoneSurrogate(loneHigh);
    expect(highLoc).toEqual({
      offset: 7,
      line: 2,
      column: 4,
      codeUnit: 0xd800,
    });
    expect(formatCodeUnitHex(0xd800)).toBe('U+D800');

    const encFailHigh = encodeUtf16Bytes(loneHigh, 'LE');
    expect(encFailHigh).toEqual({ ok: false, loneSurrogate: highLoc });

    const loneLow = '<r>𠮷\uDC00</r>';
    const lowLoc = findLoneSurrogate(loneLow);
    expect(lowLoc).toEqual({
      offset: 5,
      line: 1,
      column: 5,
      codeUnit: 0xdc00,
    });
    expect(encodeUtf16Bytes(loneLow, 'BE')).toEqual({ ok: false, loneSurrogate: lowLoc });

    const trailingHigh = 'abc\uDBFF';
    expect(findLoneSurrogate(trailingHigh)).toEqual({
      offset: 3,
      line: 1,
      column: 4,
      codeUnit: 0xdbff,
    });
  });
});

describe('detectLineEnding & convertLineEndings', () => {
  it('detects dominant LF vs CRLF and round-trips without double-CR corruption', () => {
    expect(detectLineEnding('<root/>')).toBe('LF');
    expect(detectLineEnding('<a>\n  <b/>\n</a>')).toBe('LF');
    expect(detectLineEnding('<a>\r\n  <b/>\r\n</a>')).toBe('CRLF');
    expect(detectLineEnding('<a>\r\n<b/>\n</a>')).toBe('LF');

    const crlfSource = '<a>\r\n  <b/>\r\n</a>';
    const toLf = convertLineEndings(crlfSource, 'LF');
    expect(toLf).toBe('<a>\n  <b/>\n</a>');

    const backToCrlf = convertLineEndings(toLf, 'CRLF');
    expect(backToCrlf).toBe(crlfSource);

    // Converting text that already contains CRLF to CRLF must not produce \r\r\n
    expect(convertLineEndings(crlfSource, 'CRLF')).toBe(crlfSource);
  });
});

describe('inspectXmlDeclarationForSave & rewriteLeadingXmlDeclarationEncoding', () => {
  it('updates only the leading XML declaration when declared encoding disagrees with save target', () => {
    const sjisDoc = '<?xml version="1.0" encoding="Shift_JIS"?>\n<root/>';
    expect(inspectXmlDeclarationForSave(sjisDoc, 'UTF-8')).toEqual({
      hasLeadingDeclaration: true,
      declaredEncoding: 'Shift_JIS',
      needsUpdate: true,
      suggestedEncoding: 'UTF-8',
    });
    expect(rewriteLeadingXmlDeclarationEncoding(sjisDoc, 'UTF-8')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<root/>',
    );

    const singleQuoteDoc = "<?xml version='1.0' encoding='EUC-JP' standalone='yes'?><root/>";
    expect(rewriteLeadingXmlDeclarationEncoding(singleQuoteDoc, 'UTF-16LE')).toBe(
      "<?xml version='1.0' encoding='UTF-16LE' standalone='yes'?><root/>",
    );
  });

  it('treats compatible UTF-16 declarations and encoding-less UTF-8 declarations as needing no update', () => {
    const utf16Generic = '<?xml version="1.0" encoding="UTF-16"?><root/>';
    expect(inspectXmlDeclarationForSave(utf16Generic, 'UTF-16LE').needsUpdate).toBe(false);
    expect(inspectXmlDeclarationForSave(utf16Generic, 'UTF-16BE').needsUpdate).toBe(false);
    expect(rewriteLeadingXmlDeclarationEncoding(utf16Generic, 'UTF-16LE')).toBe(utf16Generic);
    expect(inspectXmlDeclarationForSave(utf16Generic, 'UTF-8').needsUpdate).toBe(true);

    const noEncodingAttr = '<?xml version="1.0"?><root/>';
    expect(inspectXmlDeclarationForSave(noEncodingAttr, 'UTF-8')).toEqual({
      hasLeadingDeclaration: true,
      needsUpdate: false,
      suggestedEncoding: 'UTF-8',
    });
    expect(rewriteLeadingXmlDeclarationEncoding(noEncodingAttr, 'UTF-8')).toBe(noEncodingAttr);

    // For UTF-16 target when encoding attr is missing, inserts encoding after version before standalone
    const noEncWithStandalone = '<?xml version="1.0" standalone="yes"?><root/>';
    expect(inspectXmlDeclarationForSave(noEncWithStandalone, 'UTF-16BE').needsUpdate).toBe(true);
    expect(rewriteLeadingXmlDeclarationEncoding(noEncWithStandalone, 'UTF-16BE')).toBe(
      '<?xml version="1.0" encoding="UTF-16BE" standalone="yes"?><root/>',
    );
  });

  it('never alters documents without a leading declaration or <?xml-like strings in the body', () => {
    const noDecl = '<root><example><?xml version="1.0" encoding="Shift_JIS"?></example></root>';
    expect(inspectXmlDeclarationForSave(noDecl, 'UTF-8')).toEqual({
      hasLeadingDeclaration: false,
      needsUpdate: false,
      suggestedEncoding: 'UTF-8',
    });
    expect(rewriteLeadingXmlDeclarationEncoding(noDecl, 'UTF-8')).toBe(noDecl);

    const leadingSpace = '  <?xml version="1.0" encoding="Shift_JIS"?><root/>';
    expect(inspectXmlDeclarationForSave(leadingSpace, 'UTF-8').hasLeadingDeclaration).toBe(false);
    expect(rewriteLeadingXmlDeclarationEncoding(leadingSpace, 'UTF-8')).toBe(leadingSpace);

    const withBodyEcho =
      '<?xml version="1.0" encoding="Shift_JIS"?>\n<doc><code>&lt;?xml encoding="Shift_JIS"?&gt;</code><!-- <?xml version="1.0" encoding="Shift_JIS"?> --></doc>';
    expect(rewriteLeadingXmlDeclarationEncoding(withBodyEcho, 'UTF-8')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<doc><code>&lt;?xml encoding="Shift_JIS"?&gt;</code><!-- <?xml version="1.0" encoding="Shift_JIS"?> --></doc>',
    );

    const xmlStylesheetPi = '<?xml-stylesheet type="text/xsl" href="style.xsl"?><root/>';
    expect(inspectXmlDeclarationForSave(xmlStylesheetPi, 'UTF-8').hasLeadingDeclaration).toBe(
      false,
    );
    expect(rewriteLeadingXmlDeclarationEncoding(xmlStylesheetPi, 'UTF-8')).toBe(xmlStylesheetPi);
  });
});
