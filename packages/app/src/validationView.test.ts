import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@xmlens/core';
import {
  buildValidationViewModel,
  createInitialDocumentEditState,
  resolveEffectiveXPathStatus,
  resolveStatusBarState,
  transitionDocumentEditState,
} from './validationView';

const sampleErrorDiag: Diagnostic = {
  severity: 'error',
  code: 'XML_SYNTAX_ERROR',
  messageKey: 'diagnostics.xml.syntaxError',
  params: { detail: 'unclosed tag' },
  range: { line: 2, column: 5, offset: 12 },
  source: 'parser',
};

const sampleWarningDiag: Diagnostic = {
  severity: 'warning',
  code: 'XML_ENCODING_DECLARATION_NOTE',
  messageKey: 'diagnostics.xml.encodingDeclarationNote',
  params: { declared: 'Shift_JIS', assumed: 'UTF-8' },
  range: { line: 1, column: 1, offset: 0 },
  source: 'core',
};

const sampleInfoDiag: Diagnostic = {
  severity: 'info',
  code: 'XML_DTD_ENTITY_EXPANSION_DISABLED',
  messageKey: 'diagnostics.xml.dtdEntityExpansionDisabled',
  params: { count: 1 },
  range: { line: 1, column: 1, offset: 0 },
  source: 'core',
};

describe('buildValidationViewModel', () => {
  it('maps empty status', () => {
    expect(buildValidationViewModel({ kind: 'empty' })).toEqual({
      resultClasses: [],
      resultMessageKey: 'preview.empty',
      statusStateKey: 'statusBar.ready',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });
  });

  it('maps checked valid status without warnings', () => {
    expect(
      buildValidationViewModel({
        kind: 'checked',
        result: {
          wellFormed: true,
          diagnostics: [sampleInfoDiag],
          elementCount: 4,
          rootElement: 'akomaNtoso',
          truncatedDiagnostics: false,
        },
      }),
    ).toEqual({
      resultClasses: ['is-valid'],
      resultMessageKey: 'preview.valid',
      resultMessageParams: { count: 4, root: 'akomaNtoso' },
      statusStateKey: 'statusBar.wellFormed',
      elementCount: 4,
      diagnostics: [sampleInfoDiag],
      truncatedDiagnostics: false,
    });
  });

  it('maps checked valid status with warnings and missing rootElement fallback', () => {
    expect(
      buildValidationViewModel({
        kind: 'checked',
        result: {
          wellFormed: true,
          diagnostics: [sampleWarningDiag, sampleWarningDiag],
          elementCount: 2,
          truncatedDiagnostics: true,
        },
      }),
    ).toEqual({
      resultClasses: ['is-valid', 'has-warnings'],
      resultMessageKey: 'preview.validWithWarnings',
      resultMessageParams: { count: 2, root: '', warnings: 2 },
      statusStateKey: 'statusBar.warnings',
      statusStateParams: { count: 2 },
      elementCount: 2,
      diagnostics: [sampleWarningDiag, sampleWarningDiag],
      truncatedDiagnostics: true,
    });
  });

  it('maps checked invalid and formatRejected statuses', () => {
    expect(
      buildValidationViewModel({
        kind: 'checked',
        result: {
          wellFormed: false,
          diagnostics: [sampleErrorDiag, sampleWarningDiag, sampleInfoDiag],
          elementCount: 3,
          rootElement: 'root',
          truncatedDiagnostics: false,
        },
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.invalidCount',
      resultMessageParams: { errors: 1, warnings: 1 },
      statusStateKey: 'statusBar.notWellFormed',
      elementCount: 3,
      diagnostics: [sampleErrorDiag, sampleWarningDiag, sampleInfoDiag],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'checked',
        formatRejected: true,
        result: {
          wellFormed: false,
          diagnostics: [sampleErrorDiag],
          elementCount: 1,
          truncatedDiagnostics: true,
        },
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.formatInvalid',
      resultMessageParams: { errors: 1, warnings: 0 },
      statusStateKey: 'statusBar.notWellFormed',
      elementCount: 1,
      diagnostics: [sampleErrorDiag],
      truncatedDiagnostics: true,
    });
  });

  it('maps too-large, decode-error (unsupported and decode-error), and read-error statuses', () => {
    expect(buildValidationViewModel({ kind: 'too-large', limitMb: 1 })).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.tooLarge',
      resultMessageParams: { limitMb: 1 },
      statusStateKey: 'statusBar.tooLarge',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'decode-error',
        failureReason: 'unsupported',
        encoding: 'ISO-8859-7',
        diagnostics: [sampleErrorDiag],
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.unsupportedEncoding',
      resultMessageParams: { encoding: 'ISO-8859-7' },
      statusStateKey: 'statusBar.decodeError',
      elementCount: 0,
      diagnostics: [sampleErrorDiag],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'decode-error',
        failureReason: 'decode-error',
        encoding: 'UTF-8',
        diagnostics: [sampleErrorDiag],
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.decodeError',
      resultMessageParams: { encoding: 'UTF-8' },
      statusStateKey: 'statusBar.decodeError',
      elementCount: 0,
      diagnostics: [sampleErrorDiag],
      truncatedDiagnostics: false,
    });

    expect(buildValidationViewModel({ kind: 'read-error', detail: 'permission denied' })).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.readError',
      resultMessageParams: { detail: 'permission denied' },
      statusStateKey: 'statusBar.notWellFormed',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });
  });

  it('maps worker-timeout, worker-error, and format-failed (output-too-large and internal-error) statuses', () => {
    expect(buildValidationViewModel({ kind: 'worker-timeout' })).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.workerTimeout',
      statusStateKey: 'statusBar.notWellFormed',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });

    expect(buildValidationViewModel({ kind: 'worker-error', detail: 'crashed' })).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.workerError',
      resultMessageParams: { detail: 'crashed' },
      statusStateKey: 'statusBar.notWellFormed',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'format-failed',
        reason: 'output-too-large',
        diagnostics: [sampleWarningDiag],
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.formatOutputTooLarge',
      resultMessageParams: { limitMb: 1 },
      statusStateKey: 'statusBar.formatFailed',
      elementCount: 0,
      diagnostics: [sampleWarningDiag],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'format-failed',
        reason: 'internal-error',
        diagnostics: [],
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.formatError',
      resultMessageParams: { detail: '' },
      statusStateKey: 'statusBar.formatFailed',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });

    expect(
      buildValidationViewModel({
        kind: 'format-failed',
        reason: 'internal-error',
        detail: 'output overflow',
        diagnostics: [sampleErrorDiag],
      }),
    ).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.formatError',
      resultMessageParams: { detail: 'output overflow' },
      statusStateKey: 'statusBar.formatFailed',
      elementCount: 0,
      diagnostics: [sampleErrorDiag],
      truncatedDiagnostics: false,
    });

    const timeoutVm = buildValidationViewModel({
      kind: 'format-failed',
      reason: 'internal-error',
      detailKey: 'preview.workerTimeout',
      diagnostics: [],
    });
    expect(timeoutVm).toEqual({
      resultClasses: ['is-invalid'],
      resultMessageKey: 'preview.formatError',
      resultMessageParams: { detail: '' },
      resultDetailKey: 'preview.workerTimeout',
      statusStateKey: 'statusBar.formatFailed',
      elementCount: 0,
      diagnostics: [],
      truncatedDiagnostics: false,
    });

    expect(resolveStatusBarState(true, timeoutVm)).toEqual({ key: 'statusBar.checking' });
    expect(resolveStatusBarState(false, timeoutVm)).toEqual({ key: 'statusBar.formatFailed' });

    const warningVm = buildValidationViewModel({
      kind: 'checked',
      result: {
        wellFormed: true,
        diagnostics: [sampleWarningDiag],
        elementCount: 1,
        truncatedDiagnostics: false,
      },
    });
    expect(resolveStatusBarState(false, warningVm)).toEqual({
      key: 'statusBar.warnings',
      params: { count: 1 },
    });
  });
});

describe('resolveEffectiveXPathStatus', () => {
  const pathStatus = {
    kind: 'path',
    breadcrumb: 'root › item',
    xpath: '/Q{}root[1]/Q{}item[1]',
  } as const;

  it('clears XPath breadcrumb on non-validating or invalid states and preserves it otherwise', () => {
    expect(resolveEffectiveXPathStatus({ kind: 'empty' }, pathStatus)).toEqual({ kind: 'none' });
    expect(resolveEffectiveXPathStatus({ kind: 'too-large', limitMb: 1 }, pathStatus)).toEqual({
      kind: 'none',
    });
    expect(
      resolveEffectiveXPathStatus(
        { kind: 'decode-error', failureReason: 'decode-error', encoding: 'UTF-8', diagnostics: [] },
        pathStatus,
      ),
    ).toEqual({ kind: 'none' });
    expect(resolveEffectiveXPathStatus({ kind: 'read-error', detail: 'io' }, pathStatus)).toEqual({
      kind: 'none',
    });
    expect(
      resolveEffectiveXPathStatus(
        {
          kind: 'checked',
          result: {
            wellFormed: false,
            diagnostics: [],
            elementCount: 0,
            truncatedDiagnostics: false,
          },
        },
        pathStatus,
      ),
    ).toEqual({ kind: 'none' });

    expect(
      resolveEffectiveXPathStatus(
        {
          kind: 'checked',
          result: {
            wellFormed: true,
            diagnostics: [],
            elementCount: 1,
            truncatedDiagnostics: false,
          },
        },
        pathStatus,
      ),
    ).toEqual(pathStatus);
    expect(resolveEffectiveXPathStatus({ kind: 'worker-timeout' }, pathStatus)).toEqual(pathStatus);
    expect(
      resolveEffectiveXPathStatus(
        { kind: 'format-failed', reason: 'internal-error', diagnostics: [] },
        pathStatus,
      ),
    ).toEqual(pathStatus);
  });
});

describe('transitionDocumentEditState', () => {
  it('follows exact main.ts state transitions across file load, decode failure, sample load, user edit, and format', () => {
    const initial = createInitialDocumentEditState();
    expect(initial).toEqual({
      isModifiedSinceLoad: false,
      lastPreDiagnostics: [],
    });
    expect(initial.lastAssumedEncoding).toBeUndefined();

    // Opening a decoded file resets modification flag and records assumedEncoding + preDiagnostics.
    const loaded = transitionDocumentEditState(initial, {
      type: 'file-loaded',
      assumedEncoding: 'Shift_JIS',
      preDiagnostics: [sampleWarningDiag],
    });
    expect(loaded).toEqual({
      isModifiedSinceLoad: false,
      lastAssumedEncoding: 'Shift_JIS',
      lastPreDiagnostics: [sampleWarningDiag],
    });

    // No-op format (changed: false) preserves unmodified state and encoding metadata.
    const formatNoChange = transitionDocumentEditState(loaded, {
      type: 'format-succeeded',
      changed: false,
    });
    expect(formatNoChange).toEqual(loaded);

    // Format that changed document text marks buffer modified and clears encoding metadata.
    const formatChanged = transitionDocumentEditState(loaded, {
      type: 'format-succeeded',
      changed: true,
    });
    expect(formatChanged).toEqual({
      isModifiedSinceLoad: true,
      lastPreDiagnostics: [],
    });
    expect(formatChanged.lastAssumedEncoding).toBeUndefined();

    // Re-opening a file resets isModifiedSinceLoad back to false.
    const reloaded = transitionDocumentEditState(formatChanged, {
      type: 'file-loaded',
      assumedEncoding: 'UTF-16LE',
      preDiagnostics: [],
    });
    expect(reloaded).toEqual({
      isModifiedSinceLoad: false,
      lastAssumedEncoding: 'UTF-16LE',
      lastPreDiagnostics: [],
    });

    // User editing marks buffer modified and clears assumedEncoding / preDiagnostics.
    const edited = transitionDocumentEditState(reloaded, { type: 'user-edited' });
    expect(edited).toEqual({
      isModifiedSinceLoad: true,
      lastPreDiagnostics: [],
    });
    expect(edited.lastAssumedEncoding).toBeUndefined();

    // Loading sample resets all tracking fields.
    const sampled = transitionDocumentEditState(loaded, { type: 'sample-loaded' });
    expect(sampled).toEqual({
      isModifiedSinceLoad: false,
      lastPreDiagnostics: [],
    });
    expect(sampled.lastAssumedEncoding).toBeUndefined();

    // Failed decode / normalized-too-large clears encoding metadata while staying unmodified.
    const cleared = transitionDocumentEditState(edited, { type: 'file-decode-cleared' });
    expect(cleared).toEqual({
      isModifiedSinceLoad: false,
      lastPreDiagnostics: [],
    });
    expect(cleared.lastAssumedEncoding).toBeUndefined();
  });
});
