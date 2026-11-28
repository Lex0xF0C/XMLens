export type XmlToken =
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

export function isXmlWhitespaceChar(ch: string): boolean {
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
 * Internal helper shared by `@xmlens/core` modules (not re-exported publicly).
 */
export function tokenizeXmlForFormat(text: string): readonly XmlToken[] {
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
