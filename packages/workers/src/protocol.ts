import type {
  FormatXmlResult,
  IndentStyle,
  WellFormednessOptions,
  WellFormednessResult,
  XPathAtOffsetResult,
} from '@xmlens/core';

export const WORKER_PROTOCOL_VERSION = 1 as const;

export interface CheckWellFormednessRequest {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly type: 'checkWellFormedness';
  readonly payload: {
    readonly xml: string;
    readonly options?: WellFormednessOptions;
  };
}

export interface FormatXmlWorkerOptions {
  readonly indentStyle?: IndentStyle;
  readonly maxOutputChars?: number;
  readonly assumedEncoding?: string;
}

export interface FormatXmlRequest {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly type: 'formatXml';
  readonly payload: {
    readonly text: string;
    readonly options?: FormatXmlWorkerOptions;
  };
}

export interface GetXPathAtOffsetRequest {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly type: 'getXPathAtOffset';
  readonly payload: {
    readonly xml: string;
    readonly offset: number;
  };
}

export type WorkerRequest = CheckWellFormednessRequest | FormatXmlRequest | GetXPathAtOffsetRequest;

export type WorkerErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_PROTOCOL' | 'INTERNAL_ERROR';

export interface CheckWellFormednessSuccessResponse {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: true;
  readonly type: 'checkWellFormedness';
  readonly result: WellFormednessResult;
}

export interface FormatXmlSuccessResponse {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: true;
  readonly type: 'formatXml';
  readonly result: FormatXmlResult;
}

export interface GetXPathAtOffsetSuccessResponse {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: true;
  readonly type: 'getXPathAtOffset';
  readonly result: XPathAtOffsetResult;
}

export type WorkerSuccessResponse =
  CheckWellFormednessSuccessResponse | FormatXmlSuccessResponse | GetXPathAtOffsetSuccessResponse;

export interface WorkerErrorResponse {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: false;
  readonly error: {
    readonly code: WorkerErrorCode;
    readonly message: string;
  };
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value.protocolVersion !== WORKER_PROTOCOL_VERSION || typeof value.id !== 'number') {
    return false;
  }
  if (value.ok === true) {
    if (value.type === 'checkWellFormedness') {
      return isRecord(value.result);
    }
    if (value.type === 'formatXml' || value.type === 'getXPathAtOffset') {
      return isRecord(value.result) && typeof value.result.ok === 'boolean';
    }
    return false;
  }
  if (value.ok === false) {
    return (
      isRecord(value.error) &&
      typeof value.error.code === 'string' &&
      typeof value.error.message === 'string'
    );
  }
  return false;
}
