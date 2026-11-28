import type { Diagnostic } from './index';
import { checkWellFormedness, type WellFormednessOptions } from './wellFormedness';
import { tokenizeXmlForFormat, type XmlToken } from './xmlTokenizer';

export type IndentStyle = 'spaces-2' | 'spaces-4' | 'tab';

export interface FormatXmlOptions {
  /** Indentation style per nesting level (default: `'spaces-2'`). */
  readonly indentStyle?: IndentStyle;
  /** Maximum formatted output length in UTF-16 code units (default: 256 MiB characters). */
  readonly maxOutputChars?: number;
  /** Optional well-formedness check options forwarded to `checkWellFormedness`. */
  readonly wellFormednessOptions?: WellFormednessOptions;
}

export type FormatXmlResult =
  | {
      readonly ok: true;
      readonly formatted: string;
      readonly changed: boolean;
      readonly diagnostics: readonly Diagnostic[];
      readonly elementCount: number;
      readonly rootElement?: string;
      readonly truncatedDiagnostics: boolean;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
      readonly elementCount: number;
      readonly rootElement?: string;
      readonly truncatedDiagnostics: boolean;
    };

interface ElementNode {
  readonly kind: 'element';
  readonly openTag: string;
  readonly closeTag: string | null;
  readonly xmlSpace?: 'preserve' | 'default';
  readonly children: AstNode[];
}

type AstNode =
  | ElementNode
  | { readonly kind: 'bom'; readonly raw: string }
  | { readonly kind: 'xmldecl'; readonly raw: string }
  | { readonly kind: 'doctype'; readonly raw: string }
  | { readonly kind: 'comment'; readonly raw: string }
  | { readonly kind: 'pi'; readonly raw: string }
  | { readonly kind: 'cdata'; readonly raw: string }
  | { readonly kind: 'text'; readonly raw: string; readonly isWhitespaceOnly: boolean };

function resolveIndentUnit(style: IndentStyle | undefined): string {
  if (style === 'spaces-4') {
    return '    ';
  }
  if (style === 'tab') {
    return '\t';
  }
  return '  ';
}

function buildAst(tokens: readonly XmlToken[]): readonly AstNode[] {
  const rootChildren: AstNode[] = [];
  const stack: ElementNode[] = [];

  const appendNode = (node: AstNode): void => {
    const top = stack[stack.length - 1];
    if (top) {
      top.children.push(node);
    } else {
      rootChildren.push(node);
    }
  };

  for (const token of tokens) {
    if (token.kind === 'openTag') {
      const elem: ElementNode = {
        kind: 'element',
        openTag: token.raw,
        closeTag: null,
        children: [],
        ...(token.xmlSpace !== undefined ? { xmlSpace: token.xmlSpace } : {}),
      };
      appendNode(elem);
      stack.push(elem);
    } else if (token.kind === 'selfClosingTag') {
      appendNode({
        kind: 'element',
        openTag: token.raw,
        closeTag: null,
        children: [],
        ...(token.xmlSpace !== undefined ? { xmlSpace: token.xmlSpace } : {}),
      });
    } else if (token.kind === 'closeTag') {
      const top = stack.pop();
      if (top) {
        (top as { closeTag: string | null }).closeTag = token.raw;
      }
    } else {
      appendNode(token);
    }
  }

  return rootChildren;
}

const MAX_FORMATTED_CHARS = 256 * 1024 * 1024;

/**
 * Thrown internally when formatted XML output exceeds `maxOutputChars`.
 * Extends `RangeError` so callers expecting `RangeError` on size overflow remain compatible.
 */
export class FormatOutputLimitError extends RangeError {
  readonly limit: number;

  constructor(limit: number) {
    super(`Formatted XML output exceeds safe maximum length (${limit} characters).`);
    this.name = 'FormatOutputLimitError';
    this.limit = limit;
  }
}

function resolveMaxOutputChars(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) {
    return MAX_FORMATTED_CHARS;
  }
  return Math.floor(raw);
}

class FormattedOutputBuffer {
  private readonly chunks: string[] = [];
  private totalLength = 0;
  private readonly maxOutputChars: number;

  constructor(maxOutputChars: number = MAX_FORMATTED_CHARS) {
    this.maxOutputChars = maxOutputChars;
  }

  push(chunk: string): void {
    if (chunk.length === 0) {
      return;
    }
    if (this.totalLength + chunk.length > this.maxOutputChars) {
      throw new FormatOutputLimitError(this.maxOutputChars);
    }
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  toString(): string {
    return this.chunks.join('');
  }
}

function createIndentGetter(indentUnit: string): (depth: number) => string {
  const cache: string[] = [''];
  return (depth: number): string => {
    if (depth <= 0) {
      return '';
    }
    const cached = cache[depth];
    if (cached !== undefined) {
      return cached;
    }
    const prev = cache[depth - 1];
    const value = prev !== undefined ? prev + indentUnit : indentUnit.repeat(depth);
    cache[depth] = value;
    return value;
  };
}

function appendVerbatimNode(rootNode: AstNode, out: FormattedOutputBuffer): void {
  const stack: Array<AstNode | string> = [rootNode];

  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) {
      continue;
    }
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item.kind !== 'element') {
      out.push(item.raw);
      continue;
    }
    if (item.closeTag === null) {
      out.push(item.openTag);
      continue;
    }

    out.push(item.openTag);
    stack.push(item.closeTag);
    for (let i = item.children.length - 1; i >= 0; i -= 1) {
      const child = item.children[i];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
}

type FormatStackItem =
  | { readonly kind: 'textChunk'; readonly text: string }
  | {
      readonly kind: 'element';
      readonly node: ElementNode;
      readonly depth: number;
      readonly inheritedPreserve: boolean;
    };

function appendFormattedElement(
  rootNode: ElementNode,
  out: FormattedOutputBuffer,
  getIndent: (depth: number) => string,
): void {
  const stack: FormatStackItem[] = [
    { kind: 'element', node: rootNode, depth: 0, inheritedPreserve: false },
  ];

  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) {
      continue;
    }
    if (item.kind === 'textChunk') {
      out.push(item.text);
      continue;
    }

    const { node, depth, inheritedPreserve } = item;
    if (node.closeTag === null) {
      out.push(node.openTag);
      continue;
    }

    const preserveSpace =
      node.xmlSpace === 'preserve' ? true : node.xmlSpace === 'default' ? false : inheritedPreserve;

    if (preserveSpace) {
      out.push(node.openTag);
      stack.push({ kind: 'textChunk', text: node.closeTag });
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (!child) {
          continue;
        }
        if (child.kind === 'element') {
          stack.push({
            kind: 'element',
            node: child,
            depth: depth + 1,
            inheritedPreserve: true,
          });
        } else {
          stack.push({ kind: 'textChunk', text: child.raw });
        }
      }
      continue;
    }

    let hasTextContent = false;
    let hasStructuralChild = false;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (!child) {
        continue;
      }
      if ((child.kind === 'text' && !child.isWhitespaceOnly) || child.kind === 'cdata') {
        hasTextContent = true;
      }
      if (child.kind === 'element' || child.kind === 'comment' || child.kind === 'pi') {
        hasStructuralChild = true;
      }
      if (hasTextContent && hasStructuralChild) {
        break;
      }
    }

    // Mixed content (non-whitespace text/CDATA alongside child elements/comments/PIs) or leaf/text-only elements:
    // preserve inner whitespace verbatim so character data and inline text spacing are never altered.
    if (hasTextContent || !hasStructuralChild) {
      out.push(node.openTag);
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        if (child) {
          appendVerbatimNode(child, out);
        }
      }
      out.push(node.closeTag);
      continue;
    }

    out.push(node.openTag);
    out.push('\n');
    stack.push({ kind: 'textChunk', text: getIndent(depth) + node.closeTag });

    const childDepth = depth + 1;
    const childIndent = getIndent(childDepth);
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i];
      if (!child || child.kind === 'text') {
        continue;
      }
      stack.push({ kind: 'textChunk', text: '\n' });
      if (child.kind === 'element') {
        stack.push({
          kind: 'element',
          node: child,
          depth: childDepth,
          inheritedPreserve: false,
        });
      } else {
        stack.push({ kind: 'textChunk', text: child.raw });
      }
      stack.push({ kind: 'textChunk', text: childIndent });
    }
  }
}

function formatTopLevelNodes(
  nodes: readonly AstNode[],
  indentUnit: string,
  maxOutputChars: number,
): string {
  const out = new FormattedOutputBuffer(maxOutputChars);
  const getIndent = createIndentGetter(indentUnit);
  let hasEmittedTopItem = false;

  for (const node of nodes) {
    if (node.kind === 'bom') {
      out.push(node.raw);
      continue;
    }
    if (node.kind === 'text' && node.isWhitespaceOnly) {
      continue;
    }
    if (hasEmittedTopItem) {
      out.push('\n');
    }
    hasEmittedTopItem = true;
    if (node.kind === 'element') {
      appendFormattedElement(node, out, getIndent);
    } else {
      out.push(node.raw);
    }
  }

  return out.toString();
}

function createFormatInternalErrorDiagnostic(detail: string): Diagnostic {
  return {
    severity: 'error',
    code: 'XML_FORMAT_INTERNAL_ERROR',
    messageKey: 'diagnostics.xml.formatInternalError',
    params: { detail },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

function createFormatOutputTooLargeDiagnostic(limit: number, detail: string): Diagnostic {
  return {
    severity: 'error',
    code: 'XML_FORMAT_OUTPUT_TOO_LARGE',
    messageKey: 'diagnostics.xml.formatOutputTooLarge',
    params: { limit, detail },
    range: { line: 1, column: 1, offset: 0 },
    source: 'core',
  };
}

/**
 * Internal helper exposed only within `packages/core` for benchmarking and stress-testing the
 * iterative tokenizer/AST/formatter pipeline independently of `saxes` well-formedness checking.
 * Not re-exported from `@xmlens/core`.
 */
export function formatWellFormedXmlUnchecked(
  text: string,
  indentStyle?: IndentStyle,
  maxOutputChars?: number,
): string {
  const indentUnit = resolveIndentUnit(indentStyle);
  const resolvedLimit = resolveMaxOutputChars(maxOutputChars);
  const tokens = tokenizeXmlForFormat(text);
  const ast = buildAst(tokens);
  return formatTopLevelNodes(ast, indentUnit, resolvedLimit);
}

/**
 * Pretty-prints well-formed XML using pure TypeScript (DOM-free).
 *
 * - Gates on `checkWellFormedness` and returns `{ ok: false, diagnostics }` without modifying invalid input.
 * - Uses lossless source slicing so tags, attributes, quotes, unexpanded DTD/character entity references,
 *   comments, CDATA sections, PIs, DOCTYPE subsets, mixed content, and `xml:space="preserve"` subtrees
 *   are preserved verbatim.
 * - Uses explicit-stack iterative traversal and a `try/catch` guard so deep nesting or unexpected
 *   `RangeError`s never throw uncaught exceptions.
 * - Outputs LF (`\n`) line endings; CRLF conversion on export is handled by the Save layer.
 */
export function formatXml(text: string, options?: FormatXmlOptions): FormatXmlResult {
  try {
    const wf = checkWellFormedness(text, options?.wellFormednessOptions);
    if (!wf.wellFormed) {
      return {
        ok: false,
        diagnostics: wf.diagnostics,
        elementCount: wf.elementCount,
        truncatedDiagnostics: wf.truncatedDiagnostics,
        ...(wf.rootElement !== undefined ? { rootElement: wf.rootElement } : {}),
      };
    }

    const formatted = formatWellFormedXmlUnchecked(
      text,
      options?.indentStyle,
      options?.maxOutputChars,
    );

    return {
      ok: true,
      formatted,
      changed: formatted !== text,
      diagnostics: wf.diagnostics,
      elementCount: wf.elementCount,
      truncatedDiagnostics: wf.truncatedDiagnostics,
      ...(wf.rootElement !== undefined ? { rootElement: wf.rootElement } : {}),
    };
  } catch (err: unknown) {
    if (err instanceof FormatOutputLimitError) {
      return {
        ok: false,
        diagnostics: [createFormatOutputTooLargeDiagnostic(err.limit, err.message)],
        elementCount: 0,
        truncatedDiagnostics: false,
      };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [createFormatInternalErrorDiagnostic(detail)],
      elementCount: 0,
      truncatedDiagnostics: false,
    };
  }
}
