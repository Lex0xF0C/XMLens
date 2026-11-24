import type { WellFormednessOptions, WellFormednessResult } from '@xmlens/core';
import {
  isWorkerResponse,
  WORKER_PROTOCOL_VERSION,
  type CheckWellFormednessRequest,
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

export interface WellFormednessWorkerClientOptions {
  readonly timeoutMs?: number;
}

export interface WellFormednessWorkerClient {
  check(xml: string, options?: WellFormednessOptions): Promise<WorkerCallResult>;
  cancel(): void;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Creates a main-thread RPC client for well-formedness checks with request-id matching,
 * cancellation (terminating and respawning the worker), and timeout enforcement.
 */
export function createWellFormednessWorkerClient(
  spawnWorker: () => WorkerLike,
  clientOptions?: WellFormednessWorkerClientOptions,
): WellFormednessWorkerClient {
  const timeoutMs = Math.max(1, clientOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let worker: WorkerLike | null = null;
  let nextRequestId = 1;
  let disposed = false;

  interface PendingRequest {
    readonly id: number;
    readonly timer: ReturnType<typeof setTimeout>;
    readonly resolve: (value: WorkerCallResult) => void;
  }

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

  const settlePending = (expectedId: number, outcome: WorkerCallResult): void => {
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
    if (event.data.ok) {
      settlePending(event.data.id, { status: 'ok', result: event.data.result });
    } else {
      settlePending(event.data.id, { status: 'error', message: event.data.error.message });
    }
  };

  const onError = (event: WorkerErrorEventLike): void => {
    const activeId = pending?.id;
    detachAndTerminateWorker();
    if (activeId !== undefined) {
      settlePending(activeId, {
        status: 'error',
        message: event.message || 'Worker execution failed.',
      });
    }
  };

  const onMessageError = (): void => {
    const activeId = pending?.id;
    detachAndTerminateWorker();
    if (activeId !== undefined) {
      settlePending(activeId, {
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
          settlePending(id, { status: 'timeout' });
        }, timeoutMs);

        pending = { id, timer, resolve };

        try {
          const activeWorker = ensureWorker();
          activeWorker.postMessage(request);
        } catch (err: unknown) {
          detachAndTerminateWorker();
          settlePending(id, {
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
