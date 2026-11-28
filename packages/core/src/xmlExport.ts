import { normalizeXmlEncodingLabel } from './encoding';

export type SaveEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE';
export type LineEnding = 'LF' | 'CRLF';

export interface LoneSurrogateLocation {
  /** 0-based UTF-16 code unit index in the string. */
  readonly offset: number;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based character column on the line (surrogate pairs count as 1). */
  readonly column: number;
  /** Unpaired UTF-16 code unit (0xD800..0xDFFF). */
  readonly codeUnit: number;
}

export interface EncodeUtf16Options {
  /** Whether to prepend the 2-byte UTF-16 BOM (`FF FE` or `FE FF`). Default: `true`. */
  readonly includeBom?: boolean;
}

export type EncodeUtf16Result =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly loneSurrogate: LoneSurrogateLocation };

export interface XmlDeclarationSaveCheck {
  readonly hasLeadingDeclaration: boolean;
  readonly declaredEncoding?: string;
  readonly needsUpdate: boolean;
  readonly suggestedEncoding: SaveEncoding;
}

const XML_DECL_VERSION_RE = /([\t\r\n ]version[\t\r\n ]*=[\t\r\n ]*(?:"[^"]*"|'[^']*'))/;
const XML_DECL_ENCODING_MATCH_RE =
  /([\t\r\n ]encoding[\t\r\n ]*=[\t\r\n ]*)(?:(")([^"]*)(")|(')([^']*)('))/;

/**
 * Formats a UTF-16 code unit as `U+XXXX` (4 uppercase hex digits).
 */
export function formatCodeUnitHex(codeUnit: number): string {
  return `U+${codeUnit.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Scans a JavaScript UTF-16 string for the first unpaired (lone) surrogate code unit.
 * Returns `null` when all surrogates form valid UTF-16 surrogate pairs.
 */
export function findLoneSurrogate(text: string): LoneSurrogateLocation | null {
  let line = 1;
  let column = 1;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        column += 1;
        continue;
      }
      return { offset: i, line, column, codeUnit: code };
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return { offset: i, line, column, codeUnit: code };
    }

    if (code === 0x0d) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 0x0a) {
        i += 1;
      }
      line += 1;
      column = 1;
    } else if (code === 0x0a) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return null;
}

/**
 * Detects the dominant line-ending style (`LF` or `CRLF`) in decoded text before editor normalization.
 * Defaults to `'LF'` when no newlines exist or when counts tie.
 */
export function detectLineEnding(text: string): LineEnding {
  let crlfCount = 0;
  let lfCount = 0;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x0d && i + 1 < text.length && text.charCodeAt(i + 1) === 0x0a) {
      crlfCount += 1;
      i += 1;
    } else if (code === 0x0a) {
      lfCount += 1;
    }
  }

  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

/**
 * Normalizes all line breaks (`CRLF` and standalone `CR`) to `\n` first, then converts to `target`.
 */
export function convertLineEndings(text: string, target: LineEnding): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (target === 'CRLF') {
    return normalized.replace(/\n/g, '\r\n');
  }
  return normalized;
}

/**
 * Encodes a JavaScript string to UTF-16LE or UTF-16BE bytes (pure ES2022, DOM-free).
 * Rejects strings containing lone UTF-16 surrogates instead of silently writing invalid code units.
 */
export function encodeUtf16Bytes(
  text: string,
  endianness: 'LE' | 'BE',
  options?: EncodeUtf16Options,
): EncodeUtf16Result {
  const loneSurrogate = findLoneSurrogate(text);
  if (loneSurrogate !== null) {
    return { ok: false, loneSurrogate };
  }

  const includeBom = options?.includeBom ?? true;
  const bomBytes = includeBom ? 2 : 0;
  const bytes = new Uint8Array(bomBytes + text.length * 2);

  if (includeBom) {
    if (endianness === 'LE') {
      bytes[0] = 0xff;
      bytes[1] = 0xfe;
    } else {
      bytes[0] = 0xfe;
      bytes[1] = 0xff;
    }
  }

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const outOffset = bomBytes + i * 2;
    if (endianness === 'LE') {
      bytes[outOffset] = code & 0xff;
      bytes[outOffset + 1] = (code >> 8) & 0xff;
    } else {
      bytes[outOffset] = (code >> 8) & 0xff;
      bytes[outOffset + 1] = code & 0xff;
    }
  }

  return { ok: true, bytes };
}

interface LeadingDeclarationSpan {
  readonly endOffset: number;
  readonly decl: string;
}

function getLeadingXmlDeclarationSpan(text: string): LeadingDeclarationSpan | null {
  if (!text.startsWith('<?xml')) {
    return null;
  }
  const afterPrefix = text.charAt(5);
  if (afterPrefix !== ' ' && afterPrefix !== '\t' && afterPrefix !== '\r' && afterPrefix !== '\n') {
    return null;
  }
  const closeIdx = text.indexOf('?>', 5);
  if (closeIdx < 0) {
    return null;
  }
  const endOffset = closeIdx + 2;
  return {
    endOffset,
    decl: text.slice(0, endOffset),
  };
}

function isDeclaredEncodingCompatibleWithSaveTarget(
  declaredEncoding: string,
  targetEncoding: SaveEncoding,
): boolean {
  const declaredNorm = normalizeXmlEncodingLabel(declaredEncoding);
  if (targetEncoding === 'UTF-8') {
    return declaredNorm === 'UTF-8';
  }
  if (targetEncoding === 'UTF-16LE') {
    return declaredNorm === 'UTF-16LE' || declaredNorm === 'UTF-16';
  }
  return declaredNorm === 'UTF-16BE' || declaredNorm === 'UTF-16';
}

/**
 * Inspects whether the document's leading XML declaration conflicts with `targetEncoding`.
 * Never inspects or alters `<?xml` strings outside index 0.
 */
export function inspectXmlDeclarationForSave(
  text: string,
  targetEncoding: SaveEncoding,
): XmlDeclarationSaveCheck {
  const span = getLeadingXmlDeclarationSpan(text);
  if (span === null) {
    return {
      hasLeadingDeclaration: false,
      needsUpdate: false,
      suggestedEncoding: targetEncoding,
    };
  }

  const encMatch = XML_DECL_ENCODING_MATCH_RE.exec(span.decl);
  const rawDeclared = encMatch?.[3] ?? encMatch?.[6];

  if (rawDeclared !== undefined) {
    const trimmed = rawDeclared.trim();
    const compatible =
      trimmed.length > 0 && isDeclaredEncodingCompatibleWithSaveTarget(trimmed, targetEncoding);
    return {
      hasLeadingDeclaration: true,
      declaredEncoding: rawDeclared,
      needsUpdate: !compatible,
      suggestedEncoding: targetEncoding,
    };
  }

  // XML declaration has no encoding attribute: UTF-8 is XML 1.0's default (no update needed),
  // while UTF-16LE/BE can optionally insert encoding="..." after version="...".
  const canInsertAfterVersion = targetEncoding !== 'UTF-8' && XML_DECL_VERSION_RE.test(span.decl);
  return {
    hasLeadingDeclaration: true,
    needsUpdate: canInsertAfterVersion,
    suggestedEncoding: targetEncoding,
  };
}

/**
 * Updates ONLY the leading XML declaration's `encoding` attribute to `targetEncoding`
 * (or inserts it after `version="..."` when saving as UTF-16 without an existing `encoding` attribute).
 * Leaves documents without a leading XML declaration and any similar `<?xml` text in the body untouched.
 */
export function rewriteLeadingXmlDeclarationEncoding(
  text: string,
  targetEncoding: SaveEncoding,
): string {
  const span = getLeadingXmlDeclarationSpan(text);
  if (span === null) {
    return text;
  }

  const encMatch = XML_DECL_ENCODING_MATCH_RE.exec(span.decl);
  if (encMatch && encMatch.index !== undefined) {
    const prefix = encMatch[1] ?? ' encoding=';
    const quote = encMatch[2] ?? encMatch[5] ?? '"';
    const currentValue = encMatch[3] ?? encMatch[6] ?? '';
    const trimmed = currentValue.trim();
    if (trimmed.length > 0 && isDeclaredEncodingCompatibleWithSaveTarget(trimmed, targetEncoding)) {
      return text;
    }
    const updatedDecl =
      span.decl.slice(0, encMatch.index) +
      `${prefix}${quote}${targetEncoding}${quote}` +
      span.decl.slice(encMatch.index + encMatch[0].length);
    return updatedDecl + text.slice(span.endOffset);
  }

  if (targetEncoding === 'UTF-8') {
    return text;
  }

  const versionMatch = XML_DECL_VERSION_RE.exec(span.decl);
  if (!versionMatch || versionMatch.index === undefined) {
    return text;
  }
  const quote = versionMatch[0].includes("'") && !versionMatch[0].includes('"') ? "'" : '"';
  const insertAt = versionMatch.index + versionMatch[0].length;
  const updatedDecl =
    span.decl.slice(0, insertAt) +
    ` encoding=${quote}${targetEncoding}${quote}` +
    span.decl.slice(insertAt);
  return updatedDecl + text.slice(span.endOffset);
}
