import { checkWellFormedness, type WellFormednessOptions } from '@xmlens/core';
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

/**
 * Pure, Node-testable worker request dispatcher.
 * Validates the versioned RPC envelope and runs `@xmlens/core` checks without DOM dependencies.
 */
export function handleWorkerRequest(rawRequest: unknown): WorkerResponse {
  if (!isRecord(rawRequest)) {
    return {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: -1,
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Worker request must be a non-null object.',
      },
    };
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
    return {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: requestId,
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Worker request id must be a non-negative integer.',
      },
    };
  }

  if (rawRequest.type !== 'checkWellFormedness' || !isRecord(rawRequest.payload)) {
    return {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: rawRequest.id,
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unsupported worker request type or missing payload.',
      },
    };
  }

  if (typeof rawRequest.payload.xml !== 'string') {
    return {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: rawRequest.id,
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Payload "xml" must be a string.',
      },
    };
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
