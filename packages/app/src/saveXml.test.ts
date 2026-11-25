import { describe, expect, it } from 'vitest';
import {
  getDefaultSavePreferences,
  prepareXmlSaveBytes,
  sanitizeDownloadFilename,
} from './saveXml';

describe('sanitizeDownloadFilename', () => {
  it('strips paths and unsafe characters and falls back to untitled.xml', () => {
    expect(sanitizeDownloadFilename(null)).toBe('untitled.xml');
    expect(sanitizeDownloadFilename('')).toBe('untitled.xml');
    expect(sanitizeDownloadFilename('   ')).toBe('untitled.xml');
    expect(sanitizeDownloadFilename('...')).toBe('untitled.xml');
    expect(sanitizeDownloadFilename('C:\\fakepath\\sample:doc?.xml')).toBe('sampledoc.xml');
    expect(sanitizeDownloadFilename('dir/sub/my<file>\u0000.xml')).toBe('myfile.xml');
    expect(sanitizeDownloadFilename('valid-name_01.akn.xml')).toBe('valid-name_01.akn.xml');
  });
});

describe('getDefaultSavePreferences', () => {
  it('preserves BOM/encoding/line-ending defaults and recommends UTF-8 for legacy inputs', () => {
    expect(getDefaultSavePreferences(null, 'LF')).toEqual({
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: 'LF',
    });

    expect(getDefaultSavePreferences({ encoding: 'UTF-8', hasBom: true }, 'CRLF')).toEqual({
      encoding: 'UTF-8',
      includeBom: true,
      lineEnding: 'CRLF',
    });

    expect(getDefaultSavePreferences({ encoding: 'UTF-16BE', hasBom: false }, 'LF')).toEqual({
      encoding: 'UTF-16BE',
      includeBom: true,
      lineEnding: 'LF',
    });

    expect(getDefaultSavePreferences({ encoding: 'Shift_JIS', hasBom: false }, 'CRLF')).toEqual({
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: 'CRLF',
      legacySourceEncoding: 'Shift_JIS',
    });
  });
});

describe('prepareXmlSaveBytes', () => {
  it('encodes UTF-8 with optional BOM, CRLF conversion, and optional declaration rewrite', () => {
    const input = '<?xml version="1.0" encoding="Shift_JIS"?>\n<root>日本語𠮷</root>';

    const utf8BomRes = prepareXmlSaveBytes(input, {
      encoding: 'UTF-8',
      includeBom: true,
      lineEnding: 'CRLF',
      updateDeclaration: true,
    });
    expect(utf8BomRes.ok).toBe(true);
    if (!utf8BomRes.ok) {
      throw new Error('Expected UTF-8 save preparation to succeed');
    }
    expect(Array.from(utf8BomRes.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(utf8BomRes.finalText).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\r\n<root>日本語𠮷</root>',
    );
    expect(new TextDecoder('utf-8', { fatal: true }).decode(utf8BomRes.bytes)).toBe(
      utf8BomRes.finalText,
    );

    const utf8NoBomUnchangedDecl = prepareXmlSaveBytes(input, {
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: 'LF',
      updateDeclaration: false,
    });
    expect(utf8NoBomUnchangedDecl.ok).toBe(true);
    if (utf8NoBomUnchangedDecl.ok) {
      expect(Array.from(utf8NoBomUnchangedDecl.bytes.slice(0, 5))).toEqual([
        0x3c, 0x3f, 0x78, 0x6d, 0x6c,
      ]);
      expect(utf8NoBomUnchangedDecl.finalText).toBe(input);
    }
  });

  it('encodes UTF-16LE/BE with mandatory BOM and rejects lone surrogates before encoding', () => {
    const valid = '<?xml version="1.0" encoding="UTF-8"?>\n<r>𠮷</r>';
    const utf16BeRes = prepareXmlSaveBytes(valid, {
      encoding: 'UTF-16BE',
      includeBom: false, // UTF-16 always forces BOM
      lineEnding: 'CRLF',
      updateDeclaration: true,
    });
    expect(utf16BeRes.ok).toBe(true);
    if (utf16BeRes.ok) {
      expect(Array.from(utf16BeRes.bytes.slice(0, 2))).toEqual([0xfe, 0xff]);
      expect(utf16BeRes.finalText).toBe('<?xml version="1.0" encoding="UTF-16BE"?>\r\n<r>𠮷</r>');
      expect(new TextDecoder('utf-16be', { fatal: true }).decode(utf16BeRes.bytes)).toBe(
        utf16BeRes.finalText,
      );
    }

    const withLoneSurrogate = '<r>\n  bad\uD83D</r>';
    const failRes = prepareXmlSaveBytes(withLoneSurrogate, {
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: 'LF',
      updateDeclaration: false,
    });
    expect(failRes).toEqual({
      ok: false,
      reason: 'lone-surrogate',
      loneSurrogate: {
        offset: 9,
        line: 2,
        column: 6,
        codeUnit: 0xd83d,
      },
    });
  });
});
