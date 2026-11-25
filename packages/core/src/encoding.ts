import type { Diagnostic } from './index';

export type EncodingDetectionSource = 'bom' | 'pattern' | 'declaration' | 'default';

export interface XmlEncodingDetectionResult {
  /** Normalized canonical encoding label (e.g. 'UTF-8', 'UTF-16LE', 'Shift_JIS'). */
  readonly encoding: string;
  /** How the encoding was determined per W3C XML 1.0 Appendix F. */
  readonly source: EncodingDetectionSource;
  /** Length in bytes of any leading Byte Order Mark (0, 2, 3, or 4). */
  readonly bomLength: 0 | 2 | 3 | 4;
  /** Exact encoding string declared in the leading XML declaration, if present. */
  readonly declaredEncoding?: string;
  /** False when the encoding (e.g. UTF-32 / UCS-4 / EBCDIC) is unsupported by browser decoders. */
  readonly supported: boolean;
  /** Structured diagnostics emitted during encoding detection. */
  readonly diagnostics: readonly Diagnostic[];
}

const MAX_DECL_SCAN_UNITS = 256;
const XML_DECL_ENCODING_RE = /[\t\r\n ]encoding[\t\r\n ]*=[\t\r\n ]*(?:"([^"]*)"|'([^']*)')/;

function toAsciiLower(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCharCode(code + 0x20);
    } else {
      out += value.charAt(i);
    }
  }
  return out;
}

function toAsciiUpper(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCharCode(code - 0x20);
    } else {
      out += value.charAt(i);
    }
  }
  return out;
}

/**
 * Normalizes an XML encoding label using ASCII case-insensitive matching.
 */
export function normalizeXmlEncodingLabel(label: string): string {
  const trimmed = label.trim();
  const lower = toAsciiLower(trimmed);

  switch (lower) {
    case 'utf-8':
    case 'utf8':
      return 'UTF-8';
    case 'utf-16le':
      return 'UTF-16LE';
    case 'utf-16be':
      return 'UTF-16BE';
    case 'utf-16':
      return 'UTF-16';
    case 'shift_jis':
    case 'shift-jis':
    case 'sjis':
    case 'x-sjis':
    case 'ms_kanji':
    case 'windows-31j':
    case 'cp932':
      return 'Shift_JIS';
    case 'euc-jp':
    case 'euc_jp':
    case 'x-euc-jp':
      return 'EUC-JP';
    case 'iso-2022-jp':
    case 'csiso2022jp':
      return 'ISO-2022-JP';
    case 'windows-1252':
    case 'cp1252':
    case 'x-cp1252':
      return 'windows-1252';
    case 'iso-8859-1':
    case 'iso_8859-1':
    case 'latin1':
      return 'ISO-8859-1';
    case 'utf-32':
    case 'utf32':
      return 'UTF-32';
    case 'utf-32le':
      return 'UTF-32LE';
    case 'utf-32be':
      return 'UTF-32BE';
    case 'ucs-4':
    case 'ucs4':
      return 'UCS-4';
    case 'ebcdic':
    case 'ibm037':
    case 'cp037':
      return 'EBCDIC';
    default:
      if (lower.startsWith('ebcdic-') || lower.startsWith('ebcdic_')) {
        return 'EBCDIC';
      }
      return toAsciiUpper(trimmed);
  }
}

function isUnsupportedNormalizedEncoding(normalized: string): boolean {
  return (
    normalized === 'UTF-32' ||
    normalized === 'UTF-32LE' ||
    normalized === 'UTF-32BE' ||
    normalized === 'UCS-4' ||
    normalized === 'EBCDIC'
  );
}

function isAsciiXmlHeaderByte(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

function extractLeadingAsciiHeader(
  bytes: Uint8Array,
  startOffset: number,
  mode: 'ascii' | 'utf16le' | 'utf16be',
): string {
  let out = '';
  if (mode === 'ascii') {
    const limit = Math.min(bytes.length, startOffset + MAX_DECL_SCAN_UNITS);
    for (let i = startOffset; i < limit; i += 1) {
      const b = bytes[i];
      if (b === undefined || !isAsciiXmlHeaderByte(b)) {
        break;
      }
      out += String.fromCharCode(b);
    }
    return out;
  }

  const maxOffset = Math.min(bytes.length - 1, startOffset + MAX_DECL_SCAN_UNITS * 2 - 1);
  for (let i = startOffset; i < maxOffset; i += 2) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    if (b0 === undefined || b1 === undefined) {
      break;
    }
    const hi = mode === 'utf16le' ? b1 : b0;
    const lo = mode === 'utf16le' ? b0 : b1;
    if (hi !== 0 || !isAsciiXmlHeaderByte(lo)) {
      break;
    }
    out += String.fromCharCode(lo);
  }
  return out;
}

function extractDeclaredEncodingFromHeader(header: string): string | undefined {
  // XML 1.0 §2.8: XMLDecl must begin at index 0 (after any BOM) with '<?xml' + whitespace.
  if (!header.startsWith('<?xml')) {
    return undefined;
  }
  const afterPrefix = header.charAt(5);
  if (afterPrefix !== ' ' && afterPrefix !== '\t' && afterPrefix !== '\r' && afterPrefix !== '\n') {
    return undefined;
  }

  const endIndex = header.indexOf('?>', 5);
  const decl = endIndex >= 0 ? header.slice(0, endIndex + 2) : header;
  const match = XML_DECL_ENCODING_RE.exec(decl);
  const rawValue = match?.[1] ?? match?.[2];
  if (rawValue === undefined) {
    return undefined;
  }
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function areDetectedAndDeclaredCompatible(
  detectedNormalized: string,
  declaredNormalized: string,
): boolean {
  if (detectedNormalized === 'UTF-8') {
    return declaredNormalized === 'UTF-8';
  }
  if (detectedNormalized === 'UTF-16LE') {
    return declaredNormalized === 'UTF-16LE' || declaredNormalized === 'UTF-16';
  }
  if (detectedNormalized === 'UTF-16BE') {
    return declaredNormalized === 'UTF-16BE' || declaredNormalized === 'UTF-16';
  }
  return detectedNormalized === declaredNormalized;
}

function createUnsupportedDiagnostic(encoding: string): Diagnostic {
  return {
    severity: 'error',
    code: 'XML_UNSUPPORTED_ENCODING',
    messageKey: 'diagnostics.encoding.unsupported',
    params: {
      encoding,
      detail: `Character encoding "${encoding}" is not supported by in-browser decoding.`,
    },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

function createBomConflictDiagnostic(detected: string, declared: string): Diagnostic {
  return {
    severity: 'warning',
    code: 'XML_ENCODING_BOM_CONFLICT',
    messageKey: 'diagnostics.encoding.bomConflict',
    params: {
      detected,
      declared,
      detail: `Byte-order signature (${detected}) overrides conflicting XML declaration encoding "${declared}".`,
    },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

function bytesMatch4(bytes: Uint8Array, b0: number, b1: number, b2: number, b3: number): boolean {
  return (
    bytes.length >= 4 && bytes[0] === b0 && bytes[1] === b1 && bytes[2] === b2 && bytes[3] === b3
  );
}

/**
 * Autodetects an XML document's character encoding from raw bytes according to
 * W3C XML 1.0 (Fifth Edition) Appendix F §F.1 ("Detection Without External Encoding Information").
 *
 * Pure TypeScript and DOM-free (does not call `TextDecoder`).
 */
export function detectXmlEncoding(bytes: Uint8Array): XmlEncodingDetectionResult {
  if (bytes.length === 0) {
    return {
      encoding: 'UTF-8',
      source: 'default',
      bomLength: 0,
      supported: true,
      diagnostics: [],
    };
  }

  // 1. 4-byte UCS-4 / UTF-32 BOM checks MUST precede 2-byte UTF-16 BOM checks.
  if (bytesMatch4(bytes, 0x00, 0x00, 0xfe, 0xff)) {
    return {
      encoding: 'UTF-32BE',
      source: 'bom',
      bomLength: 4,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UTF-32BE')],
    };
  }
  if (bytesMatch4(bytes, 0xff, 0xfe, 0x00, 0x00)) {
    return {
      encoding: 'UTF-32LE',
      source: 'bom',
      bomLength: 4,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UTF-32LE')],
    };
  }
  if (bytesMatch4(bytes, 0x00, 0x00, 0xff, 0xfe) || bytesMatch4(bytes, 0xfe, 0xff, 0x00, 0x00)) {
    return {
      encoding: 'UCS-4',
      source: 'bom',
      bomLength: 4,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UCS-4')],
    };
  }

  // 2. 2-byte and 3-byte BOM checks.
  let bomEncoding: 'UTF-8' | 'UTF-16BE' | 'UTF-16LE' | undefined;
  let bomLength: 0 | 2 | 3 = 0;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bomEncoding = 'UTF-8';
    bomLength = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    bomEncoding = 'UTF-16BE';
    bomLength = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    bomEncoding = 'UTF-16LE';
    bomLength = 2;
  }

  if (bomEncoding !== undefined) {
    const headerMode =
      bomEncoding === 'UTF-16BE' ? 'utf16be' : bomEncoding === 'UTF-16LE' ? 'utf16le' : 'ascii';
    const header = extractLeadingAsciiHeader(bytes, bomLength, headerMode);
    const declaredEncoding = extractDeclaredEncodingFromHeader(header);
    const diagnostics: Diagnostic[] = [];

    if (declaredEncoding !== undefined) {
      const declaredNorm = normalizeXmlEncodingLabel(declaredEncoding);
      if (!areDetectedAndDeclaredCompatible(bomEncoding, declaredNorm)) {
        diagnostics.push(createBomConflictDiagnostic(bomEncoding, declaredEncoding));
      }
    }

    return {
      encoding: bomEncoding,
      source: 'bom',
      bomLength,
      supported: true,
      diagnostics,
      ...(declaredEncoding !== undefined ? { declaredEncoding } : {}),
    };
  }

  // 3. BOM-less 4-byte initial patterns per XML 1.0 Appendix F.1.
  if (bytesMatch4(bytes, 0x00, 0x00, 0x00, 0x3c)) {
    return {
      encoding: 'UTF-32BE',
      source: 'pattern',
      bomLength: 0,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UTF-32BE')],
    };
  }
  if (bytesMatch4(bytes, 0x3c, 0x00, 0x00, 0x00)) {
    return {
      encoding: 'UTF-32LE',
      source: 'pattern',
      bomLength: 0,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UTF-32LE')],
    };
  }
  if (bytesMatch4(bytes, 0x00, 0x00, 0x3c, 0x00) || bytesMatch4(bytes, 0x00, 0x3c, 0x00, 0x00)) {
    return {
      encoding: 'UCS-4',
      source: 'pattern',
      bomLength: 0,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('UCS-4')],
    };
  }
  if (bytesMatch4(bytes, 0x4c, 0x6f, 0xa7, 0x94)) {
    return {
      encoding: 'EBCDIC',
      source: 'pattern',
      bomLength: 0,
      supported: false,
      diagnostics: [createUnsupportedDiagnostic('EBCDIC')],
    };
  }

  if (bytesMatch4(bytes, 0x00, 0x3c, 0x00, 0x3f)) {
    const header = extractLeadingAsciiHeader(bytes, 0, 'utf16be');
    const declaredEncoding = extractDeclaredEncodingFromHeader(header);
    const diagnostics: Diagnostic[] = [];
    if (
      declaredEncoding !== undefined &&
      !areDetectedAndDeclaredCompatible('UTF-16BE', normalizeXmlEncodingLabel(declaredEncoding))
    ) {
      diagnostics.push(createBomConflictDiagnostic('UTF-16BE', declaredEncoding));
    }
    return {
      encoding: 'UTF-16BE',
      source: 'pattern',
      bomLength: 0,
      supported: true,
      diagnostics,
      ...(declaredEncoding !== undefined ? { declaredEncoding } : {}),
    };
  }

  if (bytesMatch4(bytes, 0x3c, 0x00, 0x3f, 0x00)) {
    const header = extractLeadingAsciiHeader(bytes, 0, 'utf16le');
    const declaredEncoding = extractDeclaredEncodingFromHeader(header);
    const diagnostics: Diagnostic[] = [];
    if (
      declaredEncoding !== undefined &&
      !areDetectedAndDeclaredCompatible('UTF-16LE', normalizeXmlEncodingLabel(declaredEncoding))
    ) {
      diagnostics.push(createBomConflictDiagnostic('UTF-16LE', declaredEncoding));
    }
    return {
      encoding: 'UTF-16LE',
      source: 'pattern',
      bomLength: 0,
      supported: true,
      diagnostics,
      ...(declaredEncoding !== undefined ? { declaredEncoding } : {}),
    };
  }

  // 4. ASCII-compatible prefix starting with `<?xm` (3C 3F 78 6D).
  if (bytesMatch4(bytes, 0x3c, 0x3f, 0x78, 0x6d)) {
    const header = extractLeadingAsciiHeader(bytes, 0, 'ascii');
    const declaredEncoding = extractDeclaredEncodingFromHeader(header);
    if (declaredEncoding !== undefined) {
      const normalized = normalizeXmlEncodingLabel(declaredEncoding);
      if (isUnsupportedNormalizedEncoding(normalized)) {
        return {
          encoding: normalized,
          source: 'declaration',
          bomLength: 0,
          declaredEncoding,
          supported: false,
          diagnostics: [createUnsupportedDiagnostic(normalized)],
        };
      }
      return {
        encoding: normalized,
        source: 'declaration',
        bomLength: 0,
        declaredEncoding,
        supported: true,
        diagnostics: [],
      };
    }
  }

  // 5. XML 1.0 default without BOM, UTF-16/32/EBCDIC pattern, or encoding declaration: UTF-8.
  return {
    encoding: 'UTF-8',
    source: 'default',
    bomLength: 0,
    supported: true,
    diagnostics: [],
  };
}
