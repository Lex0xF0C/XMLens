import {
  detectXmlEncoding,
  normalizeXmlEncodingLabel,
  type Diagnostic,
  type EncodingDetectionSource,
} from '@xmlens/core';

export const ENCODING_OVERRIDE_OPTIONS = [
  'auto',
  'UTF-8',
  'UTF-16LE',
  'UTF-16BE',
  'Shift_JIS',
  'EUC-JP',
  'ISO-2022-JP',
  'windows-1252',
] as const;

export type EncodingOverride = (typeof ENCODING_OVERRIDE_OPTIONS)[number];

export type DecodeXmlResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly encoding: string;
      readonly assumedEncoding: string;
      readonly hasBom: boolean;
      readonly source: EncodingDetectionSource | 'override';
      readonly declaredEncoding?: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly failureReason: 'unsupported' | 'decode-error';
      readonly encoding: string;
      readonly hasBom: boolean;
      readonly source: EncodingDetectionSource | 'override';
      readonly declaredEncoding?: string;
      readonly detail: string;
      readonly diagnostics: readonly Diagnostic[];
    };

function createUnknownFallbackDiagnostic(
  requested: string,
  fallback: string,
  detail: string,
): Diagnostic {
  return {
    severity: 'warning',
    code: 'XML_UNKNOWN_ENCODING_FALLBACK',
    messageKey: 'diagnostics.encoding.unknownFallback',
    params: {
      requested,
      fallback,
      detail,
    },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

function createDecodeErrorDiagnostic(encoding: string, detail: string): Diagnostic {
  return {
    severity: 'error',
    code: 'XML_DECODE_ERROR',
    messageKey: 'diagnostics.encoding.decodeError',
    params: {
      encoding,
      detail,
    },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

function hasMatchingBom(
  detectedBomLength: 0 | 2 | 3 | 4,
  detectedEncoding: string,
  activeEncoding: string,
): boolean {
  if (detectedBomLength === 0) {
    return false;
  }
  const activeNorm = normalizeXmlEncodingLabel(activeEncoding);
  if (detectedEncoding === 'UTF-8') {
    return activeNorm === 'UTF-8';
  }
  if (detectedEncoding === 'UTF-16LE') {
    return activeNorm === 'UTF-16LE' || activeNorm === 'UTF-16';
  }
  if (detectedEncoding === 'UTF-16BE') {
    return activeNorm === 'UTF-16BE' || activeNorm === 'UTF-16';
  }
  return detectedEncoding === activeNorm;
}

const sharedUtf8Encoder = new TextEncoder();

/**
 * Returns the exact UTF-8 byte length of a JavaScript string using Web Platform `TextEncoder`.
 */
export function utf8ByteLength(text: string): number {
  return sharedUtf8Encoder.encode(text).byteLength;
}

/**
 * Decodes raw XML file bytes using XML 1.0 Appendix F detection (unless overridden) and
 * `TextDecoder(..., { fatal: true })`. DOM-free so it can be unit-tested in Node.
 */
export function decodeXmlBytes(bytes: Uint8Array, override: string = 'auto'): DecodeXmlResult {
  const detection = detectXmlEncoding(bytes);

  if (override === 'auto') {
    const hasBom = detection.bomLength > 0;
    if (!detection.supported) {
      const isDeclarationMismatch = detection.diagnostics.some(
        (d) => d.code === 'XML_ENCODING_DECLARATION_MISMATCH',
      );
      const firstDiagDetail = detection.diagnostics[0]?.params?.detail;
      const detail =
        typeof firstDiagDetail === 'string'
          ? firstDiagDetail
          : `Unsupported encoding: ${detection.encoding}`;
      return {
        ok: false,
        failureReason: isDeclarationMismatch ? 'decode-error' : 'unsupported',
        encoding: detection.encoding,
        hasBom,
        source: detection.source,
        detail,
        diagnostics: detection.diagnostics,
        ...(detection.declaredEncoding !== undefined
          ? { declaredEncoding: detection.declaredEncoding }
          : {}),
      };
    }

    const diagnostics: Diagnostic[] = [...detection.diagnostics];
    let effectiveEncoding = detection.encoding;
    let assumedEncoding =
      detection.source === 'declaration' && detection.declaredEncoding !== undefined
        ? detection.declaredEncoding
        : detection.encoding;

    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(detection.encoding, { fatal: true });
    } catch (err: unknown) {
      if (err instanceof RangeError) {
        diagnostics.push(createUnknownFallbackDiagnostic(detection.encoding, 'UTF-8', err.message));
        effectiveEncoding = 'UTF-8';
        assumedEncoding = 'UTF-8';
        decoder = new TextDecoder('UTF-8', { fatal: true });
      } else {
        throw err;
      }
    }

    try {
      const text = decoder.decode(bytes);
      return {
        ok: true,
        text,
        encoding: effectiveEncoding,
        assumedEncoding,
        hasBom,
        source: detection.source,
        diagnostics,
        ...(detection.declaredEncoding !== undefined
          ? { declaredEncoding: detection.declaredEncoding }
          : {}),
      };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      diagnostics.push(createDecodeErrorDiagnostic(effectiveEncoding, detail));
      return {
        ok: false,
        failureReason: 'decode-error',
        encoding: effectiveEncoding,
        hasBom,
        source: detection.source,
        detail,
        diagnostics,
        ...(detection.declaredEncoding !== undefined
          ? { declaredEncoding: detection.declaredEncoding }
          : {}),
      };
    }
  }

  const normalizedOverride = normalizeXmlEncodingLabel(override);
  const diagnostics: Diagnostic[] = [];
  let effectiveEncoding = normalizedOverride;
  let decoder: TextDecoder;

  try {
    decoder = new TextDecoder(normalizedOverride, { fatal: true });
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      diagnostics.push(createUnknownFallbackDiagnostic(override, 'UTF-8', err.message));
      effectiveEncoding = 'UTF-8';
      decoder = new TextDecoder('UTF-8', { fatal: true });
    } else {
      throw err;
    }
  }

  const hasBom = hasMatchingBom(detection.bomLength, detection.encoding, effectiveEncoding);

  try {
    const text = decoder.decode(bytes);
    return {
      ok: true,
      text,
      encoding: effectiveEncoding,
      assumedEncoding: effectiveEncoding,
      hasBom,
      source: 'override',
      diagnostics,
      ...(detection.declaredEncoding !== undefined
        ? { declaredEncoding: detection.declaredEncoding }
        : {}),
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    diagnostics.push(createDecodeErrorDiagnostic(effectiveEncoding, detail));
    return {
      ok: false,
      failureReason: 'decode-error',
      encoding: effectiveEncoding,
      hasBom,
      source: 'override',
      detail,
      diagnostics,
      ...(detection.declaredEncoding !== undefined
        ? { declaredEncoding: detection.declaredEncoding }
        : {}),
    };
  }
}

export interface BinaryFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type LoadAndDecodeFileResult =
  | { readonly status: 'too-large' }
  | { readonly status: 'read-error'; readonly detail: string }
  | {
      readonly status: 'decoded';
      readonly bytes: Uint8Array;
      readonly decoded: DecodeXmlResult;
    };

/**
 * Shared file-opening pipeline used by both the file picker and drag-and-drop:
 * enforces a 3x raw-byte safety cap before/after reading to protect memory, decodes bytes,
 * and enforces `maxBytes` against the decoded UTF-8 byte length.
 */
export async function loadAndDecodeXmlFile(
  file: BinaryFileLike,
  maxBytes: number,
  override: string = 'auto',
): Promise<LoadAndDecodeFileResult> {
  const maxRawBytes = maxBytes * 3;
  if (file.size > maxRawBytes) {
    return { status: 'too-large' };
  }

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > maxRawBytes) {
      return { status: 'too-large' };
    }
    const decoded = decodeXmlBytes(bytes, override);
    if (decoded.ok && utf8ByteLength(decoded.text) > maxBytes) {
      return { status: 'too-large' };
    }
    return {
      status: 'decoded',
      bytes,
      decoded,
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: 'read-error', detail };
  }
}

export interface DataTransferLike<TFile extends BinaryFileLike = BinaryFileLike> {
  readonly types?: ArrayLike<string> | Iterable<string> | null;
  readonly files?: ArrayLike<TFile> | null;
}

/**
 * Returns true only when a drag-and-drop DataTransfer payload advertises file items (`'Files'`).
 */
export function isFileDataTransfer(dataTransfer: DataTransferLike | null | undefined): boolean {
  if (!dataTransfer?.types) {
    return false;
  }
  return Array.from(dataTransfer.types).includes('Files');
}

/**
 * Extracts only the first dropped file when `dataTransfer` contains files.
 */
export function pickFirstDroppedFile<TFile extends BinaryFileLike>(
  dataTransfer: DataTransferLike<TFile> | null | undefined,
): TFile | null {
  if (!isFileDataTransfer(dataTransfer)) {
    return null;
  }
  return dataTransfer?.files?.[0] ?? null;
}
