import type { WorkerXPathCallResult } from '@xmlens/workers';

export const XPATH_DEBOUNCE_MS = 150;

export type XPathStatusState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'path';
      readonly breadcrumb: string;
      readonly xpath: string;
    };

export interface AsyncXPathDiscardCheck {
  readonly requestEpoch: number;
  readonly currentEpoch: number;
  readonly sentText: string;
  readonly sentOffset: number;
  readonly currentText: string;
  readonly currentOffset: number;
  readonly isComposing: boolean;
}

/**
 * Returns true when an async cursor XPath response is stale (IME composition active, request
 * epoch superseded, editor text changed, or caret moved while the worker call was in flight) and
 * must be discarded.
 */
export function shouldDiscardAsyncXPathResult(state: AsyncXPathDiscardCheck): boolean {
  return (
    state.isComposing ||
    state.requestEpoch !== state.currentEpoch ||
    state.sentText !== state.currentText ||
    state.sentOffset !== state.currentOffset
  );
}

/**
 * Converts a worker XPath lookup outcome into the status bar display state (`'path'` or `'none'`).
 */
export function xpathStatusFromWorkerOutcome(outcome: WorkerXPathCallResult): XPathStatusState {
  if (outcome.status !== 'ok' || !outcome.result.ok || outcome.result.segments.length === 0) {
    return { kind: 'none' };
  }
  return {
    kind: 'path',
    breadcrumb: outcome.result.breadcrumb,
    xpath: outcome.result.xpath,
  };
}
