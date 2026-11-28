import { describe, expect, it } from 'vitest';
import {
  createWellFormednessWorkerClient,
  createXPathWorkerClient,
  DEFAULT_FORMAT_TIMEOUT_MS,
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
    if (validRes.ok && validRes.type === 'checkWellFormedness') {
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
    if (badRes.ok && badRes.type === 'checkWellFormedness') {
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
    if (extEntityRes.ok && extEntityRes.type === 'checkWellFormedness') {
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
    expect(
      isWorkerResponse({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 2,
        ok: true,
        type: 'formatXml',
        result: {
          ok: true,
          formatted: '<a>\n  <b/>\n</a>',
          changed: true,
          diagnostics: [],
          elementCount: 2,
          rootElement: 'a',
          truncatedDiagnostics: false,
        },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 3,
        ok: true,
        type: 'formatXml',
        result: { ok: 'yes' },
      }),
    ).toBe(false);
    expect(
      isWorkerResponse({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 4,
        ok: true,
        type: 'unknownType',
        result: {},
      }),
    ).toBe(false);
  });

  it('handles formatXml requests and strictly validates formatXml payloads and options', () => {
    const validFormat = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 10,
      type: 'formatXml',
      payload: {
        text: '<a><b/></a>',
        options: { indentStyle: 'spaces-4' },
      },
    });
    expect(validFormat.ok).toBe(true);
    expect(isWorkerResponse(validFormat)).toBe(true);
    if (validFormat.ok && validFormat.type === 'formatXml') {
      expect(validFormat.result.ok).toBe(true);
      if (validFormat.result.ok) {
        expect(validFormat.result.formatted).toBe('<a>\n    <b/>\n</a>');
        expect(validFormat.result.changed).toBe(true);
      }
    }

    const overflowFormat = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 11,
      type: 'formatXml',
      payload: {
        text: '<a><b/></a>',
        options: { indentStyle: 'spaces-2', maxOutputChars: 8 },
      },
    });
    expect(overflowFormat.ok).toBe(true);
    if (overflowFormat.ok && overflowFormat.type === 'formatXml') {
      expect(overflowFormat.result.ok).toBe(false);
      expect(overflowFormat.result.diagnostics.map((d) => d.code)).toContain(
        'XML_FORMAT_OUTPUT_TOO_LARGE',
      );
    }

    const badPayloads: readonly unknown[] = [
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 12,
        type: 'formatXml',
        payload: { text: 42 },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 13,
        type: 'formatXml',
        payload: { text: '<a/>', options: null },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 14,
        type: 'formatXml',
        payload: { text: '<a/>', options: ['spaces-2'] },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 15,
        type: 'formatXml',
        payload: { text: '<a/>', options: { indentStyle: 'spaces-8' } },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 16,
        type: 'formatXml',
        payload: { text: '<a/>', options: { maxOutputChars: -1 } },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 17,
        type: 'formatXml',
        payload: { text: '<a/>', options: { maxOutputChars: Number.NaN } },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 18,
        type: 'formatXml',
        payload: { text: '<a/>', options: { maxOutputChars: '100' } },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 19,
        type: 'formatXml',
        payload: { text: '<a/>', options: { assumedEncoding: 123 } },
      },
    ];

    for (const rawReq of badPayloads) {
      const res = handleWorkerRequest(rawReq);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_REQUEST');
      }
    }
  });

  it('handles getXPathAtOffset requests and strictly validates payloads', () => {
    const xml = '<root><a><b/></a></root>';
    const validRes = handleWorkerRequest({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 20,
      type: 'getXPathAtOffset',
      payload: { xml, offset: xml.indexOf('<b/>') + 1 },
    });
    expect(validRes.ok).toBe(true);
    expect(isWorkerResponse(validRes)).toBe(true);
    if (validRes.ok && validRes.type === 'getXPathAtOffset') {
      expect(validRes.result).toMatchObject({
        ok: true,
        xpath: '/Q{}root[1]/Q{}a[1]/Q{}b[1]',
        breadcrumb: 'root › a › b',
      });
    }

    const badPayloads: readonly unknown[] = [
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 21,
        type: 'getXPathAtOffset',
        payload: { xml: 123, offset: 0 },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 22,
        type: 'getXPathAtOffset',
        payload: { xml: '<a/>', offset: '0' },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 23,
        type: 'getXPathAtOffset',
        payload: { xml: '<a/>', offset: Number.NaN },
      },
      {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 24,
        type: 'getXPathAtOffset',
        payload: { xml: '<a/>', offset: Number.POSITIVE_INFINITY },
      },
    ];

    for (const rawReq of badPayloads) {
      const res = handleWorkerRequest(rawReq);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_REQUEST');
      }
    }
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
    expect(await client.format('<c/>')).toEqual({ status: 'cancelled' });
  });

  it('runs formatXml over RPC, exports 15s default timeout, and shares cancellation with check', async () => {
    expect(DEFAULT_FORMAT_TIMEOUT_MS).toBe(15_000);

    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const formatPromise = client.format('<a><b/></a>', { indentStyle: 'tab' });
    expect(workers).toHaveLength(1);
    const worker0 = requireWorker(workers, 0);
    worker0.emitMessage(handleWorkerRequest(worker0.postedMessages[0]));
    const formatOutcome = await formatPromise;
    expect(formatOutcome.status).toBe('ok');
    if (formatOutcome.status === 'ok') {
      expect(formatOutcome.result.ok).toBe(true);
      if (formatOutcome.result.ok) {
        expect(formatOutcome.result.formatted).toBe('<a>\n\t<b/>\n</a>');
      }
    }

    // Double-clicking Format cancels the earlier format request.
    const firstFormat = client.format('<a><first/></a>');
    const secondFormat = client.format('<a><second/></a>');
    expect(workers).toHaveLength(2);
    expect(requireWorker(workers, 0).terminated).toBe(true);
    expect(await firstFormat).toEqual({ status: 'cancelled' });

    // A subsequent check() cancels an in-flight format(), and a format() cancels an in-flight check().
    const supersededCheck = client.check('<still-running/>');
    expect(workers).toHaveLength(3);
    expect(requireWorker(workers, 1).terminated).toBe(true);
    expect(await secondFormat).toEqual({ status: 'cancelled' });

    const finalFormat = client.format('<a><final/></a>');
    expect(workers).toHaveLength(4);
    expect(requireWorker(workers, 2).terminated).toBe(true);
    expect(await supersededCheck).toEqual({ status: 'cancelled' });

    const worker3 = requireWorker(workers, 3);
    worker3.emitMessage(handleWorkerRequest(worker3.postedMessages[0]));
    const finalOutcome = await finalFormat;
    expect(finalOutcome.status).toBe('ok');

    client.dispose();
  });

  it('terminates the worker on format timeout and respawns a fresh worker', async () => {
    const workers: FakeWorker[] = [];
    const client = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    const timedOut = await client.format('<slow/>', undefined, { timeoutMs: 25 });
    expect(timedOut).toEqual({ status: 'timeout' });
    expect(workers).toHaveLength(1);
    expect(requireWorker(workers, 0).terminated).toBe(true);

    const recovered = client.format('<a><fast/></a>');
    expect(workers).toHaveLength(2);
    const secondWorker = requireWorker(workers, 1);
    secondWorker.emitMessage(handleWorkerRequest(secondWorker.postedMessages[0]));
    const okOutcome = await recovered;
    expect(okOutcome.status).toBe('ok');

    client.dispose();
  });
});

describe('createXPathWorkerClient', () => {
  it('resolves XPath lookups independently without cancelling in-flight check/format requests', async () => {
    const checkWorkers: FakeWorker[] = [];
    const xpathWorkers: FakeWorker[] = [];

    const wfClient = createWellFormednessWorkerClient(() => {
      const w = new FakeWorker();
      checkWorkers.push(w);
      return w;
    });
    const xpathClient = createXPathWorkerClient(() => {
      const w = new FakeWorker();
      xpathWorkers.push(w);
      return w;
    });

    const xml = '<root><a>hi</a></root>';
    const checkPromise = wfClient.check(xml);
    const firstXPath = xpathClient.getXPathAtOffset(xml, 1);
    const secondXPath = xpathClient.getXPathAtOffset(xml, xml.indexOf('hi'));

    // Superseding XPath terminates only the XPath worker, leaving checkWorker untouched.
    expect(checkWorkers).toHaveLength(1);
    expect(requireWorker(checkWorkers, 0).terminated).toBe(false);
    expect(xpathWorkers).toHaveLength(2);
    expect(requireWorker(xpathWorkers, 0).terminated).toBe(true);
    expect(await firstXPath).toEqual({ status: 'cancelled' });

    const activeXPathWorker = requireWorker(xpathWorkers, 1);
    activeXPathWorker.emitMessage(handleWorkerRequest(activeXPathWorker.postedMessages[0]));
    const xpathOutcome = await secondXPath;
    expect(xpathOutcome.status).toBe('ok');
    if (xpathOutcome.status === 'ok' && xpathOutcome.result.ok) {
      expect(xpathOutcome.result.breadcrumb).toBe('root › a');
    }

    const activeCheckWorker = requireWorker(checkWorkers, 0);
    activeCheckWorker.emitMessage(handleWorkerRequest(activeCheckWorker.postedMessages[0]));
    const checkOutcome = await checkPromise;
    expect(checkOutcome.status).toBe('ok');

    wfClient.dispose();
    xpathClient.dispose();
    expect(await xpathClient.getXPathAtOffset(xml, 1)).toEqual({ status: 'cancelled' });
  });

  it('terminates on XPath timeout and respawns on subsequent requests', async () => {
    const workers: FakeWorker[] = [];
    const client = createXPathWorkerClient(
      () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      { timeoutMs: 25 },
    );

    expect(await client.getXPathAtOffset('<a/>', 1)).toEqual({ status: 'timeout' });
    expect(workers).toHaveLength(1);
    expect(requireWorker(workers, 0).terminated).toBe(true);

    const recovered = client.getXPathAtOffset('<a>hi</a>', 4);
    expect(workers).toHaveLength(2);
    const worker1 = requireWorker(workers, 1);
    worker1.emitMessage(handleWorkerRequest(worker1.postedMessages[0]));
    const outcome = await recovered;
    expect(outcome.status).toBe('ok');

    client.dispose();
  });
});
