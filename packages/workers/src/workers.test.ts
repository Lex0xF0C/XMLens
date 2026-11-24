import { describe, expect, it } from 'vitest';
import {
  createWellFormednessWorkerClient,
  handleWorkerRequest,
  isWorkerResponse,
  WORKER_PROTOCOL_VERSION,
  type WorkerErrorEventLike,
  type WorkerLike,
  type WorkerMessageEventLike,
} from './index';

class FakeWorker implements WorkerLike {
  readonly postedMessages: unknown[] = [];
  terminated = false;
  private readonly messageListeners = new Set<(event: WorkerMessageEventLike) => void>();
  private readonly errorListeners = new Set<(event: WorkerErrorEventLike) => void>();
  private readonly messageErrorListeners = new Set<() => void>();

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: 'message', listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: 'error', listener: (event: WorkerErrorEventLike) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener:
      | ((event: WorkerMessageEventLike) => void)
      | ((event: WorkerErrorEventLike) => void)
      | (() => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: WorkerMessageEventLike) => void);
    } else if (type === 'error') {
      this.errorListeners.add(listener as (event: WorkerErrorEventLike) => void);
    } else {
      this.messageErrorListeners.add(listener as () => void);
    }
  }

  removeEventListener(type: 'message', listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: 'error', listener: (event: WorkerErrorEventLike) => void): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener:
      | ((event: WorkerMessageEventLike) => void)
      | ((event: WorkerErrorEventLike) => void)
      | (() => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: WorkerMessageEventLike) => void);
    } else if (type === 'error') {
      this.errorListeners.delete(listener as (event: WorkerErrorEventLike) => void);
    } else {
      this.messageErrorListeners.delete(listener as () => void);
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }

  emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message });
    }
  }

  emitMessageError(): void {
    for (const listener of this.messageErrorListeners) {
      listener();
    }
  }
}

describe('worker protocol and handler', () => {
  it('rejects non-object requests and unsupported protocol versions', () => {
    const nonObject = handleWorkerRequest(null);
    expect(nonObject.ok).toBe(false);
    if (!nonObject.ok) {
      expect(nonObject.error.code).toBe('INVALID_REQUEST');
    }

    const badVersion = handleWorkerRequest({
      protocolVersion: 99,
      id: 4,
      type: 'checkWellFormedness',
      payload: { xml: '<a/>' },
    });
    expect(badVersion.ok).toBe(false);
    expect(badVersion.id).toBe(4);
    if (!badVersion.ok) {
      expect(badVersion.error.code).toBe('UNSUPPORTED_PROTOCOL');
    }
  });

  it('rejects invalid ids, unknown types, and non-string payloads', () => {
    const badId = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: -2,
      type: 'checkWellFormedness',
      payload: { xml: '<a/>' },
    });
    expect(badId.ok).toBe(false);
    if (!badId.ok) {
      expect(badId.error.code).toBe('INVALID_REQUEST');
    }

    const badPayload = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 1,
      type: 'checkWellFormedness',
      payload: { xml: 123 },
    });
    expect(badPayload.ok).toBe(false);
    if (!badPayload.ok) {
      expect(badPayload.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('runs checkWellFormedness for valid, malformed, and external-DTD inputs and forwards options', () => {
    const validRes = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 1,
      type: 'checkWellFormedness',
      payload: { xml: '<root><child/></root>' },
    });
    expect(validRes.ok).toBe(true);
    expect(isWorkerResponse(validRes)).toBe(true);
    if (validRes.ok) {
      expect(validRes.result.wellFormed).toBe(true);
      expect(validRes.result.rootElement).toBe('root');
      expect(validRes.result.elementCount).toBe(2);
    }

    const badRes = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 2,
      type: 'checkWellFormedness',
      payload: { xml: '<root><a></b></root>', options: { maxDiagnostics: 1 } },
    });
    expect(badRes.ok).toBe(true);
    if (badRes.ok) {
      expect(badRes.result.wellFormed).toBe(false);
      expect(badRes.result.diagnostics).toHaveLength(1);
      expect(badRes.result.truncatedDiagnostics).toBe(true);
    }

    const extEntityRes = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 3,
      type: 'checkWellFormedness',
      payload: { xml: '<!DOCTYPE doc SYSTEM "example.dtd"><doc>&ext;</doc>' },
    });
    expect(extEntityRes.ok).toBe(true);
    if (extEntityRes.ok) {
      expect(extEntityRes.result.wellFormed).toBe(true);
      expect(extEntityRes.result.diagnostics.map((d) => d.code)).toContain(
        'XML_UNDECLARED_EXTERNAL_ENTITY',
      );
    }
  });

  it('validates response shapes in isWorkerResponse', () => {
    expect(isWorkerResponse(null)).toBe(false);
    expect(isWorkerResponse({ protocolVersion: 999, id: 1, ok: true })).toBe(false);
    expect(
      isWorkerResponse({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 1,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'boom' },
      }),
    ).toBe(true);
  });
});

function requireWorker(workers: readonly FakeWorker[], index: number): FakeWorker {
  const worker = workers[index];
  if (!worker) {
    throw new Error(`Expected worker at index ${index}`);
  }
  return worker;
}

describe('createWellFormednessWorkerClient', () => {
  it('reuses a single worker across sequential checks and ignores stale response ids', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const firstPromise = client.check('<a/>');
    expect(workers).toHaveLength(1);
    const worker = requireWorker(workers, 0);
    expect(worker.postedMessages).toHaveLength(1);

    // Emit a stale response with a mismatched id; active request should wait.
    worker.emitMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 999,
      ok: true,
      type: 'checkWellFormedness',
      result: {
        wellFormed: false,
        diagnostics: [],
        elementCount: 0,
        truncatedDiagnostics: false,
      },
    });

    const firstReq = worker.postedMessages[0];
    worker.emitMessage(handleWorkerRequest(firstReq));
    const firstOutcome = await firstPromise;
    expect(firstOutcome.status).toBe('ok');
    if (firstOutcome.status === 'ok') {
      expect(firstOutcome.result.rootElement).toBe('a');
    }

    const secondPromise = client.check('<b/>');
    expect(workers).toHaveLength(1);
    worker.emitMessage(handleWorkerRequest(worker.postedMessages[1]));
    const secondOutcome = await secondPromise;
    expect(secondOutcome.status).toBe('ok');
    if (secondOutcome.status === 'ok') {
      expect(secondOutcome.result.rootElement).toBe('b');
    }

    client.dispose();
  });

  it('cancels an active request, terminates the worker, and respawns on next check', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const first = client.check('<a/>');
    expect(workers).toHaveLength(1);
    const firstWorker = requireWorker(workers, 0);
    client.cancel();
    expect(firstWorker.terminated).toBe(true);
    expect(await first).toEqual({ status: 'cancelled' });

    const second = client.check('<c/>');
    expect(workers).toHaveLength(2);
    const secondWorker = requireWorker(workers, 1);
    expect(secondWorker.terminated).toBe(false);
    secondWorker.emitMessage(handleWorkerRequest(secondWorker.postedMessages[0]));
    const outcome = await second;
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.result.rootElement).toBe('c');
    }

    client.dispose();
  });

  it('cancels the previous request when a new check supersedes it', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const first = client.check('<first/>');
    const second = client.check('<second/>');

    expect(workers).toHaveLength(2);
    expect(requireWorker(workers, 0).terminated).toBe(true);
    expect(await first).toEqual({ status: 'cancelled' });

    const secondWorker = requireWorker(workers, 1);
    secondWorker.emitMessage(handleWorkerRequest(secondWorker.postedMessages[0]));
    const outcome = await second;
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.result.rootElement).toBe('second');
    }

    client.dispose();
  });

  it('terminates the worker on timeout and respawns a fresh worker for subsequent checks', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(
      () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      { timeoutMs: 25 },
    );

    const timedOut = await client.check('<slow/>');
    expect(timedOut).toEqual({ status: 'timeout' });
    expect(workers).toHaveLength(1);
    expect(requireWorker(workers, 0).terminated).toBe(true);

    const recovered = client.check('<fast/>');
    expect(workers).toHaveLength(2);
    const secondWorker = requireWorker(workers, 1);
    secondWorker.emitMessage(handleWorkerRequest(secondWorker.postedMessages[0]));
    const okOutcome = await recovered;
    expect(okOutcome.status).toBe('ok');

    client.dispose();
  });

  it('handles worker error and messageerror events cleanly', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const errPromise = client.check('<a/>');
    const firstWorker = requireWorker(workers, 0);
    firstWorker.emitError('Simulated worker crash');
    expect(firstWorker.terminated).toBe(true);
    expect(await errPromise).toEqual({
      status: 'error',
      message: 'Simulated worker crash',
    });

    const msgErrPromise = client.check('<b/>');
    expect(workers).toHaveLength(2);
    const secondWorker = requireWorker(workers, 1);
    secondWorker.emitMessageError();
    expect(secondWorker.terminated).toBe(true);
    const msgErrOutcome = await msgErrPromise;
    expect(msgErrOutcome.status).toBe('error');

    client.dispose();
    expect(await client.check('<c/>')).toEqual({ status: 'cancelled' });
  });
});
