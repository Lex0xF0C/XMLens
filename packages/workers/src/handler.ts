import {
  checkWellFormedness,
  formatXml,
  getXPathAtOffset,
  type FormatXmlOptions,
  type IndentStyle,
  type WellFormednessOptions,
} from '@xmlens/core';
import { isRecord, WORKER_PROTOCOL_VERSION, type WorkerResponse } from './protocol';

function parseWellFormednessOptions(raw: unknown): WellFormednessOptions | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const result: { maxDiagnostics?: number; assumedEncoding?: string } = {};
  if (typeof raw.maxDiagnostics === 'number' && Number.isFinite(raw.maxDiagnostics)) {
    result.maxDiagnostics = raw.maxDiagnostics;
  }
  if (typeof raw.assumedEncoding === 'string') {
    result.assumedEncoding = raw.assumedEncoding;
  }
  return result;
}

function isValidIndentStyle(value: unknown): value is IndentStyle {
  return value === 'spaces-2' || value === 'spaces-4' || value === 'tab';
}

type ParsedFormatOptions =
  | { readonly ok: true; readonly options?: FormatXmlOptions }
  | { readonly ok: false; readonly message: string };

function parseFormatXmlOptionsStrict(raw: unknown): ParsedFormatOptions {
  if (raw === undefined) {
    return { ok: true };
  }
  if (!isRecord(raw)) {
    return { ok: false, message: 'Payload "options" must be an object when provided.' };
  }

  let indentStyle: IndentStyle | undefined;
  if (raw.indentStyle !== undefined) {
    if (!isValidIndentStyle(raw.indentStyle)) {
      return {
        ok: false,
        message: 'Option "indentStyle" must be one of "spaces-2", "spaces-4", or "tab".',
      };
    }
    indentStyle = raw.indentStyle;
  }

  let maxOutputChars: number | undefined;
  if (raw.maxOutputChars !== undefined) {
    if (
      typeof raw.maxOutputChars !== 'number' ||
      !Number.isFinite(raw.maxOutputChars) ||
      raw.maxOutputChars < 0
    ) {
      return {
        ok: false,
        message: 'Option "maxOutputChars" must be a finite non-negative number.',
      };
    }
    maxOutputChars = Math.floor(raw.maxOutputChars);
  }

  let assumedEncoding: string | undefined;
  if (raw.assumedEncoding !== undefined) {
    if (typeof raw.assumedEncoding !== 'string') {
      return {
        ok: false,
        message: 'Option "assumedEncoding" must be a string.',
      };
    }
    assumedEncoding = raw.assumedEncoding;
  }

  const options: FormatXmlOptions = {
    ...(indentStyle !== undefined ? { indentStyle } : {}),
    ...(maxOutputChars !== undefined ? { maxOutputChars } : {}),
    ...(assumedEncoding !== undefined ? { wellFormednessOptions: { assumedEncoding } } : {}),
  };
  return { ok: true, options };
}

function invalidRequestResponse(id: number, message: string): WorkerResponse {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    id,
    ok: false,
    error: {
      code: 'INVALID_REQUEST',
      message,
    },
  };
}

/**
 * Pure, Node-testable worker request dispatcher.
 * Validates the versioned RPC envelope and runs `@xmlens/core` checks/formatting without DOM dependencies.
 */
export function handleWorkerRequest(rawRequest: unknown): WorkerResponse {
  if (!isRecord(rawRequest)) {
    return invalidRequestResponse(-1, 'Worker request must be a non-null object.');
  }

  const requestId = typeof rawRequest.id === 'number' ? rawRequest.id : -1;

  if (rawRequest.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    return {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: requestId,
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROTOCOL',
        message: `Unsupported worker protocol version: ${String(rawRequest.protocolVersion)}`,
      },
    };
  }

  if (typeof rawRequest.id !== 'number' || !Number.isInteger(rawRequest.id) || rawRequest.id < 0) {
    return invalidRequestResponse(requestId, 'Worker request id must be a non-negative integer.');
  }

  if (!isRecord(rawRequest.payload)) {
    return invalidRequestResponse(
      rawRequest.id,
      'Unsupported worker request type or missing payload.',
    );
  }

  if (rawRequest.type === 'checkWellFormedness') {
    if (typeof rawRequest.payload.xml !== 'string') {
      return invalidRequestResponse(rawRequest.id, 'Payload "xml" must be a string.');
    }

    try {
      const options = parseWellFormednessOptions(rawRequest.payload.options);
      const result = checkWellFormedness(rawRequest.payload.xml, options);
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: true,
        type: 'checkWellFormedness',
        result,
      };
    } catch (err: unknown) {
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  if (rawRequest.type === 'formatXml') {
    if (typeof rawRequest.payload.text !== 'string') {
      return invalidRequestResponse(rawRequest.id, 'Payload "text" must be a string.');
    }

    const parsedOptions = parseFormatXmlOptionsStrict(rawRequest.payload.options);
    if (!parsedOptions.ok) {
      return invalidRequestResponse(rawRequest.id, parsedOptions.message);
    }

    try {
      const result = formatXml(rawRequest.payload.text, parsedOptions.options);
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: true,
        type: 'formatXml',
        result,
      };
    } catch (err: unknown) {
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  if (rawRequest.type === 'getXPathAtOffset') {
    if (typeof rawRequest.payload.xml !== 'string') {
      return invalidRequestResponse(rawRequest.id, 'Payload "xml" must be a string.');
    }
    if (
      typeof rawRequest.payload.offset !== 'number' ||
      !Number.isFinite(rawRequest.payload.offset)
    ) {
      return invalidRequestResponse(rawRequest.id, 'Payload "offset" must be a finite number.');
    }

    try {
      const result = getXPathAtOffset(rawRequest.payload.xml, rawRequest.payload.offset);
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: true,
        type: 'getXPathAtOffset',
        result,
      };
    } catch (err: unknown) {
      return {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: rawRequest.id,
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  return invalidRequestResponse(
    rawRequest.id,
    'Unsupported worker request type or missing payload.',
  );
}
