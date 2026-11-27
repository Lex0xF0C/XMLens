import { checkWellFormedness } from './wellFormedness';
import { isXmlWhitespaceChar, tokenizeXmlForFormat } from './xmlTokenizer';

export interface XPathSegment {
  /** Qualified name as written in the start tag (e.g. `akn:article` or `body`). */
  readonly qname: string;
  /** Local name without namespace prefix. */
  readonly localName: string;
  /** Resolved XML namespace URI, or `''` when no namespace applies. */
  readonly namespaceURI: string;
  /** 1-based position among siblings sharing the same expanded `(namespaceURI, localName)` name. */
  readonly index: number;
  /** Total sibling count sharing the same expanded `(namespaceURI, localName)` name. */
  readonly siblingCount: number;
  /** Inclusive UTF-16 start offset of the element in the XML source (`<` of start/empty tag). */
  readonly start: number;
  /** Exclusive UTF-16 end offset of the element in the XML source (after `>` of end/empty tag). */
  readonly end: number;
}

export type XPathFailureReason = 'empty' | 'not-well-formed' | 'internal-error';

export type XPathAtOffsetResult =
  | {
      readonly ok: true;
      readonly segments: readonly XPathSegment[];
      readonly xpath: string;
      readonly breadcrumb: string;
    }
  | {
      readonly ok: false;
      readonly reason: XPathFailureReason;
    };

const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace';
const EMPTY_NAMESPACES: ReadonlyMap<string, string> = new Map();
const EMPTY_CHILD_COUNTS = new Map<string, number>();

interface ElementFrame {
  readonly qname: string;
  readonly localName: string;
  readonly namespaceURI: string;
  readonly index: number;
  readonly start: number;
  readonly namespaces: ReadonlyMap<string, string>;
  readonly expandedKey: string;
  readonly childCounts: Map<string, number>;
  readonly parentChildCounts: Map<string, number>;
  end: number;
}

function clampOffset(offset: number, length: number): number {
  if (Number.isNaN(offset) || offset <= 0) {
    return 0;
  }
  if (!Number.isFinite(offset) || offset >= length) {
    return length;
  }
  return Math.floor(offset);
}

function decodeBasicXmlAttrValue(raw: string): string {
  if (!raw.includes('&')) {
    return raw;
  }
  return raw.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (match, ref: string): string => {
      if (ref === 'amp') {
        return '&';
      }
      if (ref === 'lt') {
        return '<';
      }
      if (ref === 'gt') {
        return '>';
      }
      if (ref === 'quot') {
        return '"';
      }
      if (ref === 'apos') {
        return "'";
      }
      if (ref.startsWith('#x')) {
        const cp = Number.parseInt(ref.slice(2), 16);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
      }
      if (ref.startsWith('#')) {
        const cp = Number.parseInt(ref.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
      }
      return match;
    },
  );
}

interface ParsedTagInfo {
  readonly qname: string;
  readonly localName: string;
  readonly namespaceURI: string;
  readonly namespaces: ReadonlyMap<string, string>;
}

/**
 * Extracts the start tag's qualified name and namespace declarations (`xmlns` / `xmlns:*`)
 * using quote-aware attribute scanning so strings inside ordinary attribute values are never
 * mistaken for namespace declarations.
 */
function parseStartTagNamespaces(
  rawTag: string,
  parentNamespaces: ReadonlyMap<string, string>,
): ParsedTagInfo {
  let i = 1; // skip '<'
  const limit = rawTag.endsWith('/>') ? rawTag.length - 2 : rawTag.length - 1;

  const qnameStart = i;
  while (i < limit && !isXmlWhitespaceChar(rawTag.charAt(i))) {
    i += 1;
  }
  const qname = rawTag.slice(qnameStart, i);

  let ownNamespaces: Map<string, string> | null = null;

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
    const rawAttrValue = rawTag.slice(valStart, i);
    if (rawTag.charAt(i) === quote) {
      i += 1;
    }

    if (attrName === 'xmlns') {
      ownNamespaces ??= new Map(parentNamespaces);
      ownNamespaces.set('', decodeBasicXmlAttrValue(rawAttrValue));
    } else if (attrName.startsWith('xmlns:')) {
      const prefix = attrName.slice(6);
      if (prefix.length > 0) {
        ownNamespaces ??= new Map(parentNamespaces);
        ownNamespaces.set(prefix, decodeBasicXmlAttrValue(rawAttrValue));
      }
    }
  }

  const effectiveNamespaces: ReadonlyMap<string, string> = ownNamespaces ?? parentNamespaces;
  const colonIdx = qname.indexOf(':');
  if (colonIdx < 0) {
    return {
      qname,
      localName: qname,
      namespaceURI: effectiveNamespaces.get('') ?? '',
      namespaces: effectiveNamespaces,
    };
  }

  const prefix = qname.slice(0, colonIdx);
  const localName = qname.slice(colonIdx + 1);
  const namespaceURI =
    prefix === 'xml' ? XML_NAMESPACE_URI : (effectiveNamespaces.get(prefix) ?? '');

  return {
    qname,
    localName,
    namespaceURI,
    namespaces: effectiveNamespaces,
  };
}

/**
 * Resolves the element ancestor path, namespace-agnostic XPath 3.1 `Q{uri}local[n]` path,
 * and display breadcrumb at a given UTF-16 code-unit `offset` in `xml`.
 *
 * Boundary rule: an element spanning `[start, end)` contains `offset` strictly inside
 * `(start, end)` (`start < offset && offset < end`). Thus a cursor positioned immediately before
 * `<tag` (`offset === start`) or immediately after `>` of `</tag>` / `<tag/>` (`offset === end`)
 * belongs to the parent element (or outside root if at document boundaries), whereas cursors inside
 * `<tag>`, `<tag/>`, `</tag>`, and between `>` and `<` (including `<a>|</a>`) resolve to that element.
 *
 * Pure TypeScript (DOM-free), iterative explicit stack (safe at 5,000+ levels), and never throws.
 */
export function getXPathAtOffset(xml: string, offset: number): XPathAtOffsetResult {
  try {
    if (xml.trim().length === 0) {
      return { ok: false, reason: 'empty' };
    }

    const wf = checkWellFormedness(xml);
    if (!wf.wellFormed) {
      return { ok: false, reason: 'not-well-formed' };
    }

    const clampedOffset = clampOffset(offset, xml.length);
    const tokens = tokenizeXmlForFormat(xml);

    const rootChildCounts = new Map<string, number>();
    const stack: ElementFrame[] = [];
    let matchedFrames: ElementFrame[] | null = null;
    let runningOffset = 0;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) {
        continue;
      }
      const tokenStart = runningOffset;
      const tokenEnd = tokenStart + token.raw.length;
      runningOffset = tokenEnd;

      if (token.kind === 'openTag') {
        const parent = stack[stack.length - 1];
        const parentChildCounts = parent ? parent.childCounts : rootChildCounts;
        const parentNamespaces = parent ? parent.namespaces : EMPTY_NAMESPACES;
        const parsed = parseStartTagNamespaces(token.raw, parentNamespaces);
        const expandedKey = `${parsed.namespaceURI}\0${parsed.localName}`;
        const index = (parentChildCounts.get(expandedKey) ?? 0) + 1;
        parentChildCounts.set(expandedKey, index);

        stack.push({
          qname: parsed.qname,
          localName: parsed.localName,
          namespaceURI: parsed.namespaceURI,
          index,
          start: tokenStart,
          namespaces: parsed.namespaces,
          expandedKey,
          childCounts: new Map(),
          parentChildCounts,
          end: -1,
        });
      } else if (token.kind === 'selfClosingTag') {
        const parent = stack[stack.length - 1];
        const parentChildCounts = parent ? parent.childCounts : rootChildCounts;
        const parentNamespaces = parent ? parent.namespaces : EMPTY_NAMESPACES;
        const parsed = parseStartTagNamespaces(token.raw, parentNamespaces);
        const expandedKey = `${parsed.namespaceURI}\0${parsed.localName}`;
        const index = (parentChildCounts.get(expandedKey) ?? 0) + 1;
        parentChildCounts.set(expandedKey, index);

        if (matchedFrames === null && tokenStart < clampedOffset && clampedOffset < tokenEnd) {
          const selfFrame: ElementFrame = {
            qname: parsed.qname,
            localName: parsed.localName,
            namespaceURI: parsed.namespaceURI,
            index,
            start: tokenStart,
            namespaces: parsed.namespaces,
            expandedKey,
            childCounts: EMPTY_CHILD_COUNTS,
            parentChildCounts,
            end: tokenEnd,
          };
          matchedFrames = [...stack, selfFrame];
        }
      } else if (token.kind === 'closeTag') {
        const popped = stack.pop();
        if (popped) {
          popped.end = tokenEnd;
          if (
            matchedFrames === null &&
            popped.start < clampedOffset &&
            clampedOffset < popped.end
          ) {
            matchedFrames = [...stack, popped];
          }
        }
      }
    }

    if (matchedFrames === null || matchedFrames.length === 0) {
      return {
        ok: true,
        segments: [],
        xpath: '',
        breadcrumb: '',
      };
    }

    const segments: XPathSegment[] = matchedFrames.map((frame) => ({
      qname: frame.qname,
      localName: frame.localName,
      namespaceURI: frame.namespaceURI,
      index: frame.index,
      siblingCount: frame.parentChildCounts.get(frame.expandedKey) ?? frame.index,
      start: frame.start,
      end: frame.end,
    }));

    const xpath = segments
      .map((seg) => `/Q{${seg.namespaceURI}}${seg.localName}[${seg.index}]`)
      .join('');

    const breadcrumb = segments
      .map((seg) => (seg.siblingCount > 1 ? `${seg.qname}[${seg.index}]` : seg.qname))
      .join(' › ');

    return {
      ok: true,
      segments,
      xpath,
      breadcrumb,
    };
  } catch {
    return { ok: false, reason: 'internal-error' };
  }
}
