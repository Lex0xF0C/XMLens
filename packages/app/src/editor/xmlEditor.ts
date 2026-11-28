import { setDiagnostics } from '@codemirror/lint';
import { openSearchPanel } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import type { Diagnostic } from '@xmlens/core';
import { isFileDataTransfer, pickFirstDroppedFile } from '../decodeXml';
import {
  clampEditorOffset,
  classifyEditorUpdate,
  createFormatTransactionSpec,
  createXmlEditorAriaAttributes,
  createXmlEditorExtensions,
  evaluateFileDragEvent,
  mapDiagnosticsToLint,
  type EditorUpdateClassification,
  type LocalizedDiagnosticFormatter,
} from './xmlEditorCore';

export interface XmlEditorSelectionOptions {
  readonly focus?: boolean;
  readonly scrollIntoView?: boolean;
}

/**
 * Thin editor abstraction keeping `packages/app/src/main.ts` decoupled from CodeMirror internals
 * and legacy `<textarea>` DOM APIs.
 */
export interface XmlEditor {
  getText(): string;
  setDocument(text: string): void;
  replaceUndoable(formattedText: string): void;
  headOffset(): number;
  setSelection(offset: number, options?: XmlEditorSelectionOptions): void;
  focus(): void;
  isComposing(): boolean;
  setAriaLabel(label: string): void;
  setPlaceholder(text: string): void;
  setDiagnostics(
    diagnostics: readonly Diagnostic[],
    formatMessageFn: LocalizedDiagnosticFormatter,
  ): void;
  openSearchPanel(): void;
  dispose(): void;
}

export interface MountXmlEditorOptions {
  readonly host: HTMLElement;
  readonly initialText?: string;
  readonly ariaLabel: string;
  readonly placeholderText: string;
  readonly onUpdate: (classification: EditorUpdateClassification) => void;
  readonly onCompositionEnd: () => void;
  readonly onFileDrop: (file: File | null) => void;
}

/**
 * Mounts CodeMirror 6 inside an open `ShadowRoot` attached to `options.host` (`ADR-0005` Option A)
 * with Constructable Stylesheets (`adoptedStyleSheets`) and file drag-and-drop interception before
 * CodeMirror's built-in file-insertion drop handler.
 */
export function mountXmlEditor(options: MountXmlEditorOptions): XmlEditor {
  const { host } = options;
  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const ariaLabelCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

  let currentAriaLabel = options.ariaLabel;
  let currentPlaceholderText = options.placeholderText;

  const setDragOverClass = (active: boolean): void => {
    host.classList.toggle('is-drag-over', active);
  };

  const domHandlersExtension = EditorView.domEventHandlers({
    dragenter(event) {
      const decision = evaluateFileDragEvent('dragenter', isFileDataTransfer(event.dataTransfer));
      if (!decision.intercept) {
        return false;
      }
      event.stopPropagation();
      setDragOverClass(decision.dragOver);
      return true;
    },
    dragover(event) {
      const decision = evaluateFileDragEvent('dragover', isFileDataTransfer(event.dataTransfer));
      if (!decision.intercept) {
        return false;
      }
      event.stopPropagation();
      if (event.dataTransfer && decision.dropEffect) {
        event.dataTransfer.dropEffect = decision.dropEffect;
      }
      setDragOverClass(decision.dragOver);
      return true;
    },
    drop(event) {
      const decision = evaluateFileDragEvent('drop', isFileDataTransfer(event.dataTransfer));
      if (!decision.intercept) {
        return false;
      }
      event.stopPropagation();
      setDragOverClass(decision.dragOver);
      options.onFileDrop(pickFirstDroppedFile(event.dataTransfer));
      return true;
    },
    compositionend() {
      options.onCompositionEnd();
      return false;
    },
  });

  const updateListenerExtension = EditorView.updateListener.of((update) => {
    const classification = classifyEditorUpdate(update);
    if (classification.docChanged || classification.selectionSet) {
      options.onUpdate(classification);
    }
  });

  const buildState = (doc: string): EditorState => {
    const extraExtensions: Extension[] = [domHandlersExtension, updateListenerExtension];
    return EditorState.create({
      doc,
      extensions: createXmlEditorExtensions({
        ariaLabel: currentAriaLabel,
        ariaLabelCompartment,
        placeholderText: currentPlaceholderText,
        placeholderCompartment,
        extraExtensions,
      }),
    });
  };

  const view = new EditorView({
    parent: shadowRoot,
    root: shadowRoot,
    state: buildState(options.initialText ?? ''),
  });

  // Fallback listeners on `.cm-host` handle drags over gutters/scroller outside `.cm-content`
  // while skipping events already intercepted by `EditorView.domEventHandlers`.
  const handleHostDragEnter = (event: DragEvent): void => {
    if (event.defaultPrevented) {
      return;
    }
    const decision = evaluateFileDragEvent('dragenter', isFileDataTransfer(event.dataTransfer));
    if (!decision.intercept) {
      return;
    }
    event.preventDefault();
    setDragOverClass(decision.dragOver);
  };

  const handleHostDragOver = (event: DragEvent): void => {
    if (event.defaultPrevented) {
      return;
    }
    const decision = evaluateFileDragEvent('dragover', isFileDataTransfer(event.dataTransfer));
    if (!decision.intercept) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer && decision.dropEffect) {
      event.dataTransfer.dropEffect = decision.dropEffect;
    }
    setDragOverClass(decision.dragOver);
  };

  const handleHostDragLeave = (event: DragEvent): void => {
    const related = event.relatedTarget as Node | null;
    if (related && (related === host || host.contains(related) || shadowRoot.contains(related))) {
      return;
    }
    setDragOverClass(false);
  };

  const handleHostDrop = (event: DragEvent): void => {
    if (event.defaultPrevented) {
      return;
    }
    setDragOverClass(false);
    const decision = evaluateFileDragEvent('drop', isFileDataTransfer(event.dataTransfer));
    if (!decision.intercept) {
      return;
    }
    event.preventDefault();
    options.onFileDrop(pickFirstDroppedFile(event.dataTransfer));
  };

  host.addEventListener('dragenter', handleHostDragEnter);
  host.addEventListener('dragover', handleHostDragOver);
  host.addEventListener('dragleave', handleHostDragLeave);
  host.addEventListener('drop', handleHostDrop);

  return {
    getText(): string {
      return view.state.doc.toString();
    },

    setDocument(text: string): void {
      view.setState(buildState(text));
    },

    replaceUndoable(formattedText: string): void {
      view.dispatch(createFormatTransactionSpec(view.state, formattedText));
    },

    headOffset(): number {
      return view.state.selection.main.head;
    },

    setSelection(offset: number, selectionOptions?: XmlEditorSelectionOptions): void {
      const clamped = clampEditorOffset(offset, view.state.doc.length);
      if (selectionOptions?.focus) {
        view.focus();
      }
      view.dispatch({
        selection: { anchor: clamped },
        scrollIntoView: selectionOptions?.scrollIntoView ?? true,
      });
    },

    focus(): void {
      view.focus();
    },

    isComposing(): boolean {
      return view.composing;
    },

    setAriaLabel(label: string): void {
      currentAriaLabel = label;
      view.dispatch({
        effects: ariaLabelCompartment.reconfigure(
          EditorView.contentAttributes.of(createXmlEditorAriaAttributes(label)),
        ),
      });
    },

    setPlaceholder(text: string): void {
      currentPlaceholderText = text;
      view.dispatch({
        effects: placeholderCompartment.reconfigure(placeholder(text)),
      });
    },

    setDiagnostics(
      diagnostics: readonly Diagnostic[],
      formatMessageFn: LocalizedDiagnosticFormatter,
    ): void {
      const lintDiagnostics = mapDiagnosticsToLint(
        diagnostics,
        view.state.doc.length,
        formatMessageFn,
      );
      view.dispatch(setDiagnostics(view.state, lintDiagnostics));
    },

    openSearchPanel(): void {
      openSearchPanel(view);
    },

    dispose(): void {
      host.removeEventListener('dragenter', handleHostDragEnter);
      host.removeEventListener('dragover', handleHostDragOver);
      host.removeEventListener('dragleave', handleHostDragLeave);
      host.removeEventListener('drop', handleHostDrop);
      view.destroy();
    },
  };
}
