import { describe, expect, it } from 'vitest';
import { shouldDiscardAsyncXPathResult, xpathStatusFromWorkerOutcome } from './xpathCursor';

describe('xpathCursor helpers', () => {
  it('discards stale or composing XPath responses when epoch, text, offset, or isComposing changes', () => {
    const base = {
      requestEpoch: 3,
      currentEpoch: 3,
      sentText: '<a><b/></a>',
      sentOffset: 5,
      currentText: '<a><b/></a>',
      currentOffset: 5,
      isComposing: false,
    };

    expect(shouldDiscardAsyncXPathResult(base)).toBe(false);
    expect(shouldDiscardAsyncXPathResult({ ...base, isComposing: true })).toBe(true);
    expect(shouldDiscardAsyncXPathResult({ ...base, currentEpoch: 4 })).toBe(true);
    expect(shouldDiscardAsyncXPathResult({ ...base, currentText: '<a><c/></a>' })).toBe(true);
    expect(shouldDiscardAsyncXPathResult({ ...base, currentOffset: 6 })).toBe(true);
  });

  it('maps worker XPath outcomes to path or none status state', () => {
    expect(xpathStatusFromWorkerOutcome({ status: 'cancelled' })).toEqual({ kind: 'none' });
    expect(xpathStatusFromWorkerOutcome({ status: 'timeout' })).toEqual({ kind: 'none' });
    expect(xpathStatusFromWorkerOutcome({ status: 'error', message: 'boom' })).toEqual({
      kind: 'none',
    });
    expect(
      xpathStatusFromWorkerOutcome({
        status: 'ok',
        result: { ok: false, reason: 'not-well-formed' },
      }),
    ).toEqual({ kind: 'none' });
    expect(
      xpathStatusFromWorkerOutcome({
        status: 'ok',
        result: { ok: true, segments: [], xpath: '', breadcrumb: '' },
      }),
    ).toEqual({ kind: 'none' });
    expect(
      xpathStatusFromWorkerOutcome({
        status: 'ok',
        result: {
          ok: true,
          segments: [
            {
              qname: 'root',
              localName: 'root',
              namespaceURI: '',
              index: 1,
              siblingCount: 1,
              start: 0,
              end: 13,
            },
          ],
          xpath: '/Q{}root[1]',
          breadcrumb: 'root',
        },
      }),
    ).toEqual({ kind: 'path', breadcrumb: 'root', xpath: '/Q{}root[1]' });
  });
});
