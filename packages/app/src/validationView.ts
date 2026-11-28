import type { Diagnostic, WellFormednessResult } from '@xmlens/core';
import type enCatalog from '../../../locales/en.json';
import type { XPathStatusState } from './xpathCursor';

export type ValidationMessageKey = keyof typeof enCatalog;

export type ValidationStatus =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'checked';
      readonly result: WellFormednessResult;
      readonly formatRejected?: boolean;
    }
  | { readonly kind: 'too-large'; readonly limitMb: number }
  | {
      readonly kind: 'decode-error';
      readonly failureReason: 'unsupported' | 'decode-error';
      readonly encoding: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly kind: 'read-error'; readonly detail: string }
  | { readonly kind: 'worker-timeout' }
  | { readonly kind: 'worker-error'; readonly detail: string }
  | {
      readonly kind: 'format-failed';
      readonly reason: 'output-too-large' | 'internal-error';
      readonly detail?: string;
      readonly diagnostics: readonly Diagnostic[];
    };

export type ResultBoxStateClass = 'is-valid' | 'is-invalid' | 'has-warnings';

export interface ValidationViewModel {
  readonly resultClasses: readonly ResultBoxStateClass[];
  readonly resultMessageKey: ValidationMessageKey;
  readonly resultMessageParams?: Readonly<Record<string, string | number>>;
  readonly statusStateKey: ValidationMessageKey;
  readonly statusStateParams?: Readonly<Record<string, string | number>>;
  readonly elementCount: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly truncatedDiagnostics: boolean;
}

/**
 * Maps a `ValidationStatus` into a DOM-free view model for the diagnostics summary box,
 * diagnostic list, and bottom status bar fields.
 */
export function buildValidationViewModel(status: ValidationStatus): ValidationViewModel {
  switch (status.kind) {
    case 'empty':
      return {
        resultClasses: [],
        resultMessageKey: 'preview.empty',
        statusStateKey: 'statusBar.ready',
        elementCount: 0,
        diagnostics: [],
        truncatedDiagnostics: false,
      };
    case 'too-large':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey: 'preview.tooLarge',
        resultMessageParams: { limitMb: status.limitMb },
        statusStateKey: 'statusBar.tooLarge',
        elementCount: 0,
        diagnostics: [],
        truncatedDiagnostics: false,
      };
    case 'decode-error':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey:
          status.failureReason === 'unsupported'
            ? 'preview.unsupportedEncoding'
            : 'preview.decodeError',
        resultMessageParams: { encoding: status.encoding },
        statusStateKey: 'statusBar.decodeError',
        elementCount: 0,
        diagnostics: status.diagnostics,
        truncatedDiagnostics: false,
      };
    case 'read-error':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey: 'preview.readError',
        resultMessageParams: { detail: status.detail },
        statusStateKey: 'statusBar.notWellFormed',
        elementCount: 0,
        diagnostics: [],
        truncatedDiagnostics: false,
      };
    case 'worker-timeout':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey: 'preview.workerTimeout',
        statusStateKey: 'statusBar.notWellFormed',
        elementCount: 0,
        diagnostics: [],
        truncatedDiagnostics: false,
      };
    case 'worker-error':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey: 'preview.workerError',
        resultMessageParams: { detail: status.detail },
        statusStateKey: 'statusBar.notWellFormed',
        elementCount: 0,
        diagnostics: [],
        truncatedDiagnostics: false,
      };
    case 'format-failed':
      return {
        resultClasses: ['is-invalid'],
        resultMessageKey:
          status.reason === 'output-too-large'
            ? 'preview.formatOutputTooLarge'
            : 'preview.formatError',
        resultMessageParams:
          status.reason === 'output-too-large' ? { limitMb: 1 } : { detail: status.detail ?? '' },
        statusStateKey: 'statusBar.formatFailed',
        elementCount: 0,
        diagnostics: status.diagnostics,
        truncatedDiagnostics: false,
      };
    case 'checked': {
      const { result } = status;
      const errorCount = result.diagnostics.filter((d) => d.severity === 'error').length;
      const warningCount = result.diagnostics.filter((d) => d.severity === 'warning').length;

      if (result.wellFormed) {
        if (warningCount > 0) {
          return {
            resultClasses: ['is-valid', 'has-warnings'],
            resultMessageKey: 'preview.validWithWarnings',
            resultMessageParams: {
              count: result.elementCount,
              root: result.rootElement ?? '',
              warnings: warningCount,
            },
            statusStateKey: 'statusBar.warnings',
            statusStateParams: { count: warningCount },
            elementCount: result.elementCount,
            diagnostics: result.diagnostics,
            truncatedDiagnostics: result.truncatedDiagnostics,
          };
        }
        return {
          resultClasses: ['is-valid'],
          resultMessageKey: 'preview.valid',
          resultMessageParams: {
            count: result.elementCount,
            root: result.rootElement ?? '',
          },
          statusStateKey: 'statusBar.wellFormed',
          elementCount: result.elementCount,
          diagnostics: result.diagnostics,
          truncatedDiagnostics: result.truncatedDiagnostics,
        };
      }

      return {
        resultClasses: ['is-invalid'],
        resultMessageKey: status.formatRejected ? 'preview.formatInvalid' : 'preview.invalidCount',
        resultMessageParams: {
          errors: errorCount,
          warnings: warningCount,
        },
        statusStateKey: 'statusBar.notWellFormed',
        elementCount: result.elementCount,
        diagnostics: result.diagnostics,
        truncatedDiagnostics: result.truncatedDiagnostics,
      };
    }
  }
}

/**
 * Suppresses stale or misleading cursor XPath breadcrumbs when the current document status
 * does not represent a well-formed preview.
 */
export function resolveEffectiveXPathStatus(
  validationStatus: ValidationStatus,
  xpathStatus: XPathStatusState,
): XPathStatusState {
  if (
    validationStatus.kind === 'empty' ||
    validationStatus.kind === 'too-large' ||
    validationStatus.kind === 'decode-error' ||
    validationStatus.kind === 'read-error' ||
    (validationStatus.kind === 'checked' && !validationStatus.result.wellFormed)
  ) {
    return { kind: 'none' };
  }
  return xpathStatus;
}

export interface DocumentEditState {
  readonly isModifiedSinceLoad: boolean;
  readonly lastAssumedEncoding?: string;
  readonly lastPreDiagnostics: readonly Diagnostic[];
}

export type DocumentEditEvent =
  | {
      readonly type: 'file-loaded';
      readonly assumedEncoding: string;
      readonly preDiagnostics: readonly Diagnostic[];
    }
  | { readonly type: 'file-decode-cleared' }
  | { readonly type: 'sample-loaded' }
  | { readonly type: 'user-edited' }
  | { readonly type: 'format-succeeded'; readonly changed: boolean };

/**
 * Returns the initial tracking state before any file is opened or edited.
 */
export function createInitialDocumentEditState(): DocumentEditState {
  return {
    isModifiedSinceLoad: false,
    lastPreDiagnostics: [],
  };
}

/**
 * Pure state transition for `isModifiedSinceLoad`, `lastAssumedEncoding`, and
 * `lastPreDiagnostics` across file load, sample load, user edit, and format completion.
 */
export function transitionDocumentEditState(
  state: DocumentEditState,
  event: DocumentEditEvent,
): DocumentEditState {
  switch (event.type) {
    case 'file-loaded':
      return {
        isModifiedSinceLoad: false,
        lastAssumedEncoding: event.assumedEncoding,
        lastPreDiagnostics: event.preDiagnostics,
      };
    case 'file-decode-cleared':
    case 'sample-loaded':
      return {
        isModifiedSinceLoad: false,
        lastPreDiagnostics: [],
      };
    case 'user-edited':
      return {
        isModifiedSinceLoad: true,
        lastPreDiagnostics: [],
      };
    case 'format-succeeded':
      if (!event.changed) {
        return state;
      }
      return {
        isModifiedSinceLoad: true,
        lastPreDiagnostics: [],
      };
  }
}
