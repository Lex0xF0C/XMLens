import type { FormatXmlResult, WellFormednessOptions, WellFormednessResult } from '@xmlens/core';
import {
  isWorkerResponse,
  WORKER_PROTOCOL_VERSION,
  type CheckWellFormednessRequest,
  type FormatXmlRequest,
  type FormatXmlWorkerOptions,
} from './protocol';

export interface WorkerMessageEventLike {
  readonly data: unknown;
}

export interface WorkerErrorEventLike {
  readonly message?: string;
}

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: 'error', listener: (event: WorkerErrorEventLike) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: 'error', listener: (event: WorkerErrorEventLike) => void): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
}

export type WorkerCallResult =
  | { readonly status: 'ok'; readonly result: WellFormednessResult }
  | { readonly status: 'cancelled' }
  | { readonly status: 'timeout' }
  | { readonly status: 'error'; readonly message: string };

export type WorkerFormatCallResult =
  | { readonly status: 'ok'; readonly result: FormatXmlResult }
  | { readonly status: 'cancelled' }
  | { readonly status: 'timeout' }
  | { readonly status: 'error'; readonly message: string };

export interface WorkerFormatCallOptions {
  readonly timeoutMs?: number;
}

export interface WellFormednessWorkerClientOptions {
  readonly timeoutMs?: number;
}

export interface WellFormednessWorkerClient {
  check(xml: string, options?: WellFormednessOptions): Promise<WorkerCallResult>;
  format(
    text: string,
    options?: FormatXmlWorkerOptions,
    callOptions?: WorkerFormatCallOptions,
  ): Promise<WorkerFormatCallResult>;
  cancel(): void;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_FORMAT_TIMEOUT_MS = 15_000;

/**
 * Creates a main-thread RPC client for well-formedness checks and XML formatting with request-id
 * matching, cancellation (terminating and respawning the worker), and timeout enforcement.
 */
export function createWellFormednessWorkerClient(
  spawnWorker: () => WorkerLike,
  clientOptions?: WellFormednessWorkerClientOptions,
): WellFormednessWorkerClient {
  const timeoutMs = Math.max(1, clientOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let worker: WorkerLike | null = null;
  let nextRequestId = 1;
  let disposed = false;

  type PendingRequest =
    | {
        readonly kind: 'checkWellFormedness';
        readonly id: number;
        readonly timer: ReturnType<typeof setTimeout>;
        readonly resolve: (value: WorkerCallResult) => void;
      }
    | {
        readonly kind: 'formatXml';
        readonly id: number;
        readonly timer: ReturnType<typeof setTimeout>;
        readonly resolve: (value: WorkerFormatCallResult) => void;
      };

  let pending: PendingRequest | null = null;

  const detachAndTerminateWorker = (): void => {
    if (!worker) {
      return;
    }
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
    worker.terminate();
    worker = null;
  };

  const settlePendingFailure = (
    expectedId: number,
    outcome:
      | { readonly status: 'cancelled' }
      | { readonly status: 'timeout' }
      | { readonly status: 'error'; readonly message: string },
  ): void => {
    if (!pending || pending.id !== expectedId) {
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.resolve(outcome);
  };

  const onMessage = (event: WorkerMessageEventLike): void => {
    if (!isWorkerResponse(event.data)) {
      return;
    }
    // Ignore stale responses whose request id does not match the active request.
    if (!pending || event.data.id !== pending.id) {
      return;
    }
    if (!event.data.ok) {
      settlePendingFailure(event.data.id, { status: 'error', message: event.data.error.message });
      return;
    }

    const current = pending;
    if (current.kind === 'checkWellFormedness' && event.data.type === 'checkWellFormedness') {
      pending = null;
      clearTimeout(current.timer);
      current.resolve({ status: 'ok', result: event.data.result });
      return;
    }
    if (current.kind === 'formatXml' && event.data.type === 'formatXml') {
      pending = null;
      clearTimeout(current.timer);
      current.resolve({ status: 'ok', result: event.data.result });
      return;
    }

    settlePendingFailure(event.data.id, {
      status: 'error',
      message: 'Mismatched worker response type.',
    });
  };

  const onError = (event: WorkerErrorEventLike): void => {
    const activeId = pending?.id;
    detachAndTerminateWorker();
    if (activeId !== undefined) {
      settlePendingFailure(activeId, {
        status: 'error',
        message: event.message || 'Worker execution failed.',
      });
    }
  };

  const onMessageError = (): void => {
    const activeId = pending?.id;
    detachAndTerminateWorker();
    if (activeId !== undefined) {
      settlePendingFailure(activeId, {
        status: 'error',
        message: 'Worker returned an unserializable message.',
      });
    }
  };

  const ensureWorker = (): WorkerLike => {
    if (worker) {
      return worker;
    }
    const spawned = spawnWorker();
    spawned.addEventListener('message', onMessage);
    spawned.addEventListener('error', onError);
    spawned.addEventListener('messageerror', onMessageError);
    worker = spawned;
    return spawned;
  };

  const cancelActiveRequest = (): void => {
    if (!pending) {
      return;
    }
    const active = pending;
    pending = null;
    clearTimeout(active.timer);
    // Cancel in-flight work by terminating the worker; the next request respawns a fresh one.
    detachAndTerminateWorker();
    active.resolve({ status: 'cancelled' });
  };

  return {
    check(xml: string, options?: WellFormednessOptions): Promise<WorkerCallResult> {
      if (disposed) {
        return Promise.resolve({ status: 'cancelled' });
      }

      if (pending) {
        cancelActiveRequest();
      }

      const id = nextRequestId++;
      const payload: { readonly xml: string; readonly options?: WellFormednessOptions } =
        options !== undefined ? { xml, options } : { xml };
      const request: CheckWellFormednessRequest = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id,
        type: 'checkWellFormedness',
        payload,
      };

      return new Promise<WorkerCallResult>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending || pending.id !== id) {
            return;
          }
          detachAndTerminateWorker();
          settlePendingFailure(id, { status: 'timeout' });
        }, timeoutMs);

        pending = { kind: 'checkWellFormedness', id, timer, resolve };

        try {
          const activeWorker = ensureWorker();
          activeWorker.postMessage(request);
        } catch (err: unknown) {
          detachAndTerminateWorker();
          settlePendingFailure(id, {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },

    format(
      text: string,
      options?: FormatXmlWorkerOptions,
      callOptions?: WorkerFormatCallOptions,
    ): Promise<WorkerFormatCallResult> {
      if (disposed) {
        return Promise.resolve({ status: 'cancelled' });
      }

      if (pending) {
        cancelActiveRequest();
      }

      const id = nextRequestId++;
      const effectiveTimeoutMs = Math.max(1, callOptions?.timeoutMs ?? DEFAULT_FORMAT_TIMEOUT_MS);
      const payload: { readonly text: string; readonly options?: FormatXmlWorkerOptions } =
        options !== undefined ? { text, options } : { text };
      const request: FormatXmlRequest = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id,
        type: 'formatXml',
        payload,
      };

      return new Promise<WorkerFormatCallResult>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending || pending.id !== id) {
            return;
          }
          detachAndTerminateWorker();
          settlePendingFailure(id, { status: 'timeout' });
        }, effectiveTimeoutMs);

        pending = { kind: 'formatXml', id, timer, resolve };

        try {
          const activeWorker = ensureWorker();
          activeWorker.postMessage(request);
        } catch (err: unknown) {
          detachAndTerminateWorker();
          settlePendingFailure(id, {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },

    cancel(): void {
      cancelActiveRequest();
    },

    dispose(): void {
      disposed = true;
      cancelActiveRequest();
      detachAndTerminateWorker();
    },
  };
}
