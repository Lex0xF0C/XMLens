import type { WellFormednessOptions, WellFormednessResult } from '@xmlens/core';

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

export type WorkerRequest = CheckWellFormednessRequest;

export type WorkerErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_PROTOCOL' | 'INTERNAL_ERROR';

export interface WorkerSuccessResponse {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: true;
  readonly type: 'checkWellFormedness';
  readonly result: WellFormednessResult;
}

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
  return typeof value === 'object' && value !== null;
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value.protocolVersion !== WORKER_PROTOCOL_VERSION || typeof value.id !== 'number') {
    return false;
  }
  if (value.ok === true) {
    return value.type === 'checkWellFormedness' && isRecord(value.result);
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
