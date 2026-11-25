import type { Diagnostic } from './index';
import { checkWellFormedness, type WellFormednessOptions } from './wellFormedness';

export type IndentStyle = 'spaces-2' | 'spaces-4' | 'tab';

export interface FormatXmlOptions {
  /** Indentation style per nesting level (default: `'spaces-2'`). */
  readonly indentStyle?: IndentStyle;
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

type XmlToken =
  | { readonly kind: 'bom'; readonly raw: string }
  | { readonly kind: 'xmldecl'; readonly raw: string }
  | { readonly kind: 'doctype'; readonly raw: string }
  | { readonly kind: 'comment'; readonly raw: string }
  | { readonly kind: 'pi'; readonly raw: string }
  | { readonly kind: 'cdata'; readonly raw: string }
  | {
      readonly kind: 'openTag';
      readonly raw: string;
      readonly xmlSpace?: 'preserve' | 'default';
    }
  | {
      readonly kind: 'selfClosingTag';
      readonly raw: string;
      readonly xmlSpace?: 'preserve' | 'default';
    }
  | { readonly kind: 'closeTag'; readonly raw: string }
  | { readonly kind: 'text'; readonly raw: string; readonly isWhitespaceOnly: boolean };

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

function isXmlWhitespaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isXmlWhitespaceOnly(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
  }
  return true;
}

function resolveIndentUnit(style: IndentStyle | undefined): string {
  if (style === 'spaces-4') {
    return '    ';
  }
  if (style === 'tab') {
    return '\t';
  }
  return '  ';
}

/**
 * Extracts an actual `xml:space` attribute value (`"preserve"` or `"default"`) from a raw start tag
 * without being fooled by attribute values that happen to contain `"xml:space=..."`.
 */
function extractXmlSpaceFromRawTag(rawTag: string): 'preserve' | 'default' | undefined {
  let i = 1; // skip '<'
  const limit = rawTag.endsWith('/>') ? rawTag.length - 2 : rawTag.length - 1;

  // Skip tag name
  while (i < limit && !isXmlWhitespaceChar(rawTag.charAt(i))) {
    i += 1;
  }

  while (i < limit) {
    while (i < limit && isXmlWhitespaceChar(rawTag.charAt(i))) {
      i += 1;
    }
    if (i >= limit) {
      break;
    }

    const nameStart = i;
    while (i < limit && !isXmlWhitespaceChar(rawTag.charAt(i)) && rawTag.charAt(i) !== '=') {
      i += 1;
    }
    const attrName = rawTag.slice(nameStart, i);

    while (i < limit && isXmlWhitespaceChar(rawTag.charAt(i))) {
      i += 1;
    }
    if (rawTag.charAt(i) !== '=') {
      continue;
    }
    i += 1;
    while (i < limit && isXmlWhitespaceChar(rawTag.charAt(i))) {
      i += 1;
    }

    const quote = rawTag.charAt(i);
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    i += 1;
    const valStart = i;
    while (i < limit && rawTag.charAt(i) !== quote) {
      i += 1;
    }
    const attrValue = rawTag.slice(valStart, i);
    if (rawTag.charAt(i) === quote) {
      i += 1;
    }

    if (attrName === 'xml:space' && (attrValue === 'preserve' || attrValue === 'default')) {
      return attrValue;
    }
  }

  return undefined;
}

function scanDoctypeEnd(text: string, start: number): number {
  let j = start + 9; // after '<!DOCTYPE'
  let inQuote: '"' | "'" | null = null;
  let bracketDepth = 0;

  while (j < text.length) {
    const ch = text.charAt(j);
    if (inQuote !== null) {
      if (ch === inQuote) {
        inQuote = null;
      }
      j += 1;
      continue;
    }

    if (bracketDepth > 0 && text.startsWith('<!--', j)) {
      const commentEnd = text.indexOf('-->', j + 4);
      j = commentEnd >= 0 ? commentEnd + 3 : text.length;
      continue;
    }

    if (bracketDepth > 0 && text.startsWith('<?', j)) {
      const piEnd = text.indexOf('?>', j + 2);
      j = piEnd >= 0 ? piEnd + 2 : text.length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      j += 1;
    } else if (ch === '[') {
      bracketDepth += 1;
      j += 1;
    } else if (ch === ']') {
      if (bracketDepth > 0) {
        bracketDepth -= 1;
      }
      j += 1;
    } else if (ch === '>' && bracketDepth === 0) {
      return j + 1;
    } else {
      j += 1;
    }
  }

  return text.length;
}

function scanStartTagEnd(text: string, start: number): number {
  let j = start + 1;
  let inQuote: '"' | "'" | null = null;

  while (j < text.length) {
    const ch = text.charAt(j);
    if (inQuote !== null) {
      if (ch === inQuote) {
        inQuote = null;
      }
      j += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      j += 1;
    } else if (ch === '>') {
      return j + 1;
    } else {
      j += 1;
    }
  }

  return text.length;
}

/**
 * Losslessly partitions well-formed XML source text into contiguous `[start, end)` token slices.
 */
function tokenizeXmlForFormat(text: string): readonly XmlToken[] {
  const tokens: XmlToken[] = [];
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) {
    tokens.push({ kind: 'bom', raw: '\uFEFF' });
    i = 1;
  }

  while (i < text.length) {
    if (text.charAt(i) !== '<') {
      const nextLt = text.indexOf('<', i);
      const end = nextLt >= 0 ? nextLt : text.length;
      const raw = text.slice(i, end);
      tokens.push({ kind: 'text', raw, isWhitespaceOnly: isXmlWhitespaceOnly(raw) });
      i = end;
      continue;
    }

    if (text.startsWith('<!--', i)) {
      const endIdx = text.indexOf('-->', i + 4);
      const end = endIdx >= 0 ? endIdx + 3 : text.length;
      tokens.push({ kind: 'comment', raw: text.slice(i, end) });
      i = end;
      continue;
    }

    if (text.startsWith('<![CDATA[', i)) {
      const endIdx = text.indexOf(']]>', i + 9);
      const end = endIdx >= 0 ? endIdx + 3 : text.length;
      tokens.push({ kind: 'cdata', raw: text.slice(i, end) });
      i = end;
      continue;
    }

    if (text.startsWith('<!DOCTYPE', i)) {
      const end = scanDoctypeEnd(text, i);
      tokens.push({ kind: 'doctype', raw: text.slice(i, end) });
      i = end;
      continue;
    }

    if (text.startsWith('<?', i)) {
      const endIdx = text.indexOf('?>', i + 2);
      const end = endIdx >= 0 ? endIdx + 2 : text.length;
      const raw = text.slice(i, end);
      const isXmlDecl =
        raw.startsWith('<?xml') && raw.length > 5 && isXmlWhitespaceChar(raw.charAt(5));
      tokens.push({ kind: isXmlDecl ? 'xmldecl' : 'pi', raw });
      i = end;
      continue;
    }

    if (text.startsWith('</', i)) {
      const endIdx = text.indexOf('>', i + 2);
      const end = endIdx >= 0 ? endIdx + 1 : text.length;
      tokens.push({ kind: 'closeTag', raw: text.slice(i, end) });
      i = end;
      continue;
    }

    const end = scanStartTagEnd(text, i);
    const raw = text.slice(i, end);
    const xmlSpace = extractXmlSpaceFromRawTag(raw);
    if (raw.endsWith('/>')) {
      tokens.push({
        kind: 'selfClosingTag',
        raw,
        ...(xmlSpace !== undefined ? { xmlSpace } : {}),
      });
    } else {
      tokens.push({
        kind: 'openTag',
        raw,
        ...(xmlSpace !== undefined ? { xmlSpace } : {}),
      });
    }
    i = end;
  }

  return tokens;
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

class FormattedOutputBuffer {
  private readonly chunks: string[] = [];
  private totalLength = 0;

  push(chunk: string): void {
    if (chunk.length === 0) {
      return;
    }
    if (this.totalLength + chunk.length > MAX_FORMATTED_CHARS) {
      throw new RangeError(
        `Formatted XML output exceeds safe maximum length (${MAX_FORMATTED_CHARS} characters).`,
      );
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

function formatTopLevelNodes(nodes: readonly AstNode[], indentUnit: string): string {
  const out = new FormattedOutputBuffer();
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

/**
 * Internal helper exposed only within `packages/core` for benchmarking and stress-testing the
 * iterative tokenizer/AST/formatter pipeline independently of `saxes` well-formedness checking.
 * Not re-exported from `@xmlens/core`.
 */
export function formatWellFormedXmlUnchecked(text: string, indentStyle?: IndentStyle): string {
  const indentUnit = resolveIndentUnit(indentStyle);
  const tokens = tokenizeXmlForFormat(text);
  const ast = buildAst(tokens);
  return formatTopLevelNodes(ast, indentUnit);
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

    const formatted = formatWellFormedXmlUnchecked(text, options?.indentStyle);

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
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [createFormatInternalErrorDiagnostic(detail)],
      elementCount: 0,
      truncatedDiagnostics: false,
    };
  }
}
