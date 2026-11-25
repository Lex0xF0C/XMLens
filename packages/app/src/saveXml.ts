import {
  convertLineEndings,
  encodeUtf16Bytes,
  findLoneSurrogate,
  rewriteLeadingXmlDeclarationEncoding,
  type LineEnding,
  type LoneSurrogateLocation,
  type SaveEncoding,
} from '@xmlens/core';

export const SAVE_ENCODING_OPTIONS: readonly SaveEncoding[] = ['UTF-8', 'UTF-16LE', 'UTF-16BE'];

export function isSaveEncoding(value: string): value is SaveEncoding {
  return (SAVE_ENCODING_OPTIONS as readonly string[]).includes(value);
}

export function isLineEnding(value: string): value is LineEnding {
  return value === 'LF' || value === 'CRLF';
}

export interface SaveEncodingContext {
  readonly encoding: string;
  readonly hasBom: boolean;
}

export interface DefaultSavePreferences {
  readonly encoding: SaveEncoding;
  readonly includeBom: boolean;
  readonly lineEnding: LineEnding;
  readonly legacySourceEncoding?: string;
}

export interface PrepareSaveOptions {
  readonly encoding: SaveEncoding;
  readonly includeBom: boolean;
  readonly lineEnding: LineEnding;
  readonly updateDeclaration: boolean;
}

export type PrepareSaveResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly finalText: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'lone-surrogate';
      readonly loneSurrogate: LoneSurrogateLocation;
    };

const sharedUtf8Encoder = new TextEncoder();

/**
 * Strips path segments and unsafe filename characters, falling back to `untitled.xml`.
 */
export function sanitizeDownloadFilename(
  rawName: string | null | undefined,
  fallback: string = 'untitled.xml',
): string {
  if (!rawName) {
    return fallback;
  }

  const lastSlash = Math.max(rawName.lastIndexOf('/'), rawName.lastIndexOf('\\'));
  const baseName = lastSlash >= 0 ? rawName.slice(lastSlash + 1) : rawName;

  let cleaned = '';
  for (let i = 0; i < baseName.length; i += 1) {
    const ch = baseName.charAt(i);
    const code = baseName.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    if ('<>:"/\\|?*'.includes(ch)) {
      continue;
    }
    cleaned += ch;
  }

  cleaned = cleaned
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    return fallback;
  }
  return cleaned;
}

/**
 * Computes initial Save dialog selections from the currently loaded document's encoding/BOM/EOL.
 * Legacy encodings default to UTF-8 export with an advisory note.
 */
export function getDefaultSavePreferences(
  loadedEncoding: SaveEncodingContext | null,
  loadedLineEnding: LineEnding,
): DefaultSavePreferences {
  if (loadedEncoding === null) {
    return {
      encoding: 'UTF-8',
      includeBom: false,
      lineEnding: loadedLineEnding,
    };
  }

  if (loadedEncoding.encoding === 'UTF-16LE' || loadedEncoding.encoding === 'UTF-16BE') {
    return {
      encoding: loadedEncoding.encoding,
      includeBom: true,
      lineEnding: loadedLineEnding,
    };
  }

  if (loadedEncoding.encoding === 'UTF-8') {
    return {
      encoding: 'UTF-8',
      includeBom: loadedEncoding.hasBom,
      lineEnding: loadedLineEnding,
    };
  }

  return {
    encoding: 'UTF-8',
    includeBom: loadedEncoding.hasBom,
    lineEnding: loadedLineEnding,
    legacySourceEncoding: loadedEncoding.encoding,
  };
}

/**
 * Validates surrogate pairs, optionally updates the leading XML declaration, normalizes line endings,
 * and encodes bytes as UTF-8 or UTF-16LE/BE (pure in Node & browser).
 */
export function prepareXmlSaveBytes(
  rawText: string,
  options: PrepareSaveOptions,
): PrepareSaveResult {
  const lone = findLoneSurrogate(rawText);
  if (lone !== null) {
    return { ok: false, reason: 'lone-surrogate', loneSurrogate: lone };
  }

  const declUpdated = options.updateDeclaration
    ? rewriteLeadingXmlDeclarationEncoding(rawText, options.encoding)
    : rawText;
  const finalText = convertLineEndings(declUpdated, options.lineEnding);

  if (options.encoding === 'UTF-8') {
    const encoded = sharedUtf8Encoder.encode(finalText);
    if (!options.includeBom) {
      return { ok: true, bytes: encoded, finalText };
    }
    const withBom = new Uint8Array(3 + encoded.byteLength);
    withBom[0] = 0xef;
    withBom[1] = 0xbb;
    withBom[2] = 0xbf;
    withBom.set(encoded, 3);
    return { ok: true, bytes: withBom, finalText };
  }

  const endianness = options.encoding === 'UTF-16LE' ? 'LE' : 'BE';
  // UTF-16 export always includes a BOM so XML processors can unambiguously detect byte order.
  const utf16Res = encodeUtf16Bytes(finalText, endianness, { includeBom: true });
  if (!utf16Res.ok) {
    return { ok: false, reason: 'lone-surrogate', loneSurrogate: utf16Res.loneSurrogate };
  }
  return { ok: true, bytes: utf16Res.bytes, finalText };
}

/**
 * Triggers a client-only `<a download>` + `Blob` download and revokes the object URL afterwards.
 */
export function triggerBlobDownload(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.className = 'hidden-download-link';
  anchor.href = url;
  anchor.download = sanitizeDownloadFilename(filename);
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Defer revocation briefly so browsers finish initiating the download before the URL is freed.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
