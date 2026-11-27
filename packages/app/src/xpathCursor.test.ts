import { describe, expect, it } from 'vitest';
import { shouldDiscardAsyncXPathResult, xpathStatusFromWorkerOutcome } from './xpathCursor';

describe('xpathCursor helpers', () => {
  it('discards stale XPath responses when epoch, text, or selectionStart changes', () => {
    const base = {
      requestEpoch: 3,
      currentEpoch: 3,
      sentText: '<a><b/></a>',
      sentOffset: 5,
      currentTextareaValue: '<a><b/></a>',
      currentSelectionStart: 5,
    };

    expect(shouldDiscardAsyncXPathResult(base)).toBe(false);
    expect(shouldDiscardAsyncXPathResult({ ...base, currentEpoch: 4 })).toBe(true);
    expect(shouldDiscardAsyncXPathResult({ ...base, currentTextareaValue: '<a><c/></a>' })).toBe(
      true,
    );
    expect(shouldDiscardAsyncXPathResult({ ...base, currentSelectionStart: 6 })).toBe(true);
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
