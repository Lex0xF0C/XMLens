import { SaxesParser } from 'saxes';
import { normalizeXmlEncodingLabel } from './encoding';
import type { Diagnostic, SourceRange } from './index';

export interface WellFormednessOptions {
  /** Maximum number of diagnostics to collect (default: 100). */
  readonly maxDiagnostics?: number;
  /** Encoding assumed for the decoded JavaScript string (default: 'UTF-8'). */
  readonly assumedEncoding?: string;
}

export interface XmlDeclarationInfo {
  readonly version?: string;
  readonly encoding?: string;
  readonly standalone?: string;
}

export interface WellFormednessResult {
  /** True when zero error-severity diagnostics were reported. Warnings/info may still be present. */
  readonly wellFormed: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly rootElement?: string;
  readonly elementCount: number;
  readonly xmlDeclaration?: XmlDeclarationInfo;
  readonly truncatedDiagnostics: boolean;
}

const DEFAULT_MAX_DIAGNOSTICS = 100;
const DEFAULT_ASSUMED_ENCODING = 'UTF-8';
const GENERAL_ENTITY_DECL_RE = /<!ENTITY\s+(?!%)([^\s<>'"&%;]+)/g;
const PARAMETER_ENTITY_REF_RE = /%[^\s%;<>'"&]+;/;
const ENTITY_TAIL_RE = /&([^\s&;]+);$/;

function stripLeadingPosition(rawMessage: string, line: number, column: number): string {
  const prefix = `${line}:${column}: `;
  if (rawMessage.startsWith(prefix)) {
    return rawMessage.slice(prefix.length);
  }
  return rawMessage.replace(/^\d+:\d+:\s*/, '');
}

function clampOffset(position: number, inputLength: number): number {
  if (position < 0) {
    return 0;
  }
  if (position > inputLength) {
    return inputLength;
  }
  return position;
}

function normalizeEncodingName(encoding: string): string {
  const normalized = normalizeXmlEncodingLabel(encoding);
  if (normalized === 'UTF-16LE' || normalized === 'UTF-16BE') {
    return 'UTF-16';
  }
  // In the WHATWG Encoding Standard (used by TextDecoder), iso-8859-1 / latin1 map to
  // windows-1252. Treating them as equivalent here avoids a false mismatch note when a
  // user selects "windows-1252" to open an XML document declaring encoding="ISO-8859-1".
  if (normalized === 'ISO-8859-1') {
    return 'windows-1252';
  }
  return normalized;
}

interface MappedParserError {
  readonly severity?: Diagnostic['severity'];
  readonly code: string;
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
}

interface EntityContext {
  readonly declaredGeneralEntities: ReadonlySet<string>;
  readonly mayBeDeclaredExternally: boolean;
}

/**
 * Maps `saxes` error strings to structured diagnostic payloads.
 *
 * W3C XML 1.0 (Fifth Edition) §4.1 — Well-formedness constraint: Entity Declared:
 * When a document has no external DTD subset and no parameter-entity references,
 * or specifies `standalone="yes"`, an undeclared general entity reference is a
 * well-formedness error (`severity: 'error'`). When an external subset (`SYSTEM`/`PUBLIC`)
 * or parameter-entity reference (`%pe;`) is present and `standalone` is not `"yes"`,
 * non-validating processors must not treat unexpanded external entity references as
 * not-well-formed; XMLens emits a `warning` diagnostic instead without fetching external DTDs.
 */
function mapSaxesErrorMessage(
  detail: string,
  xml: string,
  offset: number,
  entityContext: EntityContext,
): MappedParserError | null {
  if (detail === 'document must contain a root element.' || detail === 'unexpected end.') {
    return {
      code: 'XML_EMPTY_DOCUMENT',
      messageKey: 'diagnostics.xml.emptyDocument',
      params: { detail },
    };
  }

  if (detail === 'undefined entity.') {
    const tail = xml.slice(Math.max(0, offset - 256), offset);
    const match = ENTITY_TAIL_RE.exec(tail);
    const entity = match?.[1];
    if (entity !== undefined && entityContext.declaredGeneralEntities.has(entity)) {
      // Declared internal DTD entities are intentionally not expanded; XML_DTD_ENTITY_EXPANSION_DISABLED covers them.
      return null;
    }
    if (entity !== undefined && entityContext.mayBeDeclaredExternally) {
      return {
        severity: 'warning',
        code: 'XML_UNDECLARED_EXTERNAL_ENTITY',
        messageKey: 'diagnostics.xml.undeclaredExternalEntity',
        params: { entity, detail },
      };
    }
    if (entity !== undefined) {
      return {
        code: 'XML_UNDEFINED_ENTITY',
        messageKey: 'diagnostics.xml.undefinedEntity',
        params: { entity, detail },
      };
    }
    return {
      code: 'XML_INVALID_ENTITY',
      messageKey: 'diagnostics.xml.invalidEntity',
      params: { detail },
    };
  }

  if (
    detail === 'disallowed character in entity name.' ||
    detail === 'empty entity name.' ||
    detail === 'malformed character entity.'
  ) {
    return {
      code: 'XML_INVALID_ENTITY',
      messageKey: 'diagnostics.xml.invalidEntity',
      params: { detail },
    };
  }

  const unboundNsMatch = /^unbound namespace prefix: "(.+)"\.$/.exec(detail);
  if (unboundNsMatch?.[1] !== undefined) {
    return {
      code: 'XML_UNBOUND_NAMESPACE_PREFIX',
      messageKey: 'diagnostics.xml.unboundNamespacePrefix',
      params: { prefix: unboundNsMatch[1], detail },
    };
  }

  if (
    detail.startsWith('xml prefix must be bound') ||
    detail.startsWith('xmlns prefix must be bound') ||
    detail.startsWith('the default namespace may not be set') ||
    detail.startsWith('may not assign a prefix') ||
    detail.startsWith('may not assign the xml namespace') ||
    detail === 'tags may not have "xmlns" as prefix.' ||
    detail === 'invalid attempt to undefine prefix in XML 1.0'
  ) {
    return {
      code: 'XML_NAMESPACE_ERROR',
      messageKey: 'diagnostics.xml.namespaceError',
      params: { detail },
    };
  }

  const dupAttrMatch = /^duplicate attribute: (.+)\.$/.exec(detail);
  if (dupAttrMatch?.[1] !== undefined) {
    return {
      code: 'XML_DUPLICATE_ATTRIBUTE',
      messageKey: 'diagnostics.xml.duplicateAttribute',
      params: { attribute: dupAttrMatch[1], detail },
    };
  }

  const unmatchedCloseMatch = /^unmatched closing tag: (.+)\.$/.exec(detail);
  if (unmatchedCloseMatch?.[1] !== undefined) {
    return {
      code: 'XML_UNMATCHED_CLOSING_TAG',
      messageKey: 'diagnostics.xml.unmatchedClosingTag',
      params: { tag: unmatchedCloseMatch[1], detail },
    };
  }

  if (detail === 'unexpected close tag.' || detail === 'weird empty close tag.') {
    return {
      code: 'XML_UNEXPECTED_CLOSE_TAG',
      messageKey: 'diagnostics.xml.unexpectedCloseTag',
      params: { detail },
    };
  }

  const unclosedMatch = /^unclosed tag: (.+)$/.exec(detail);
  if (unclosedMatch?.[1] !== undefined) {
    return {
      code: 'XML_UNCLOSED_TAG',
      messageKey: 'diagnostics.xml.unclosedTag',
      params: { tag: unclosedMatch[1], detail },
    };
  }

  if (detail === 'documents may contain only one root.') {
    return {
      code: 'XML_MULTIPLE_ROOTS',
      messageKey: 'diagnostics.xml.multipleRoots',
      params: { detail },
    };
  }

  if (detail === 'text data outside of root node.') {
    return {
      code: 'XML_TEXT_OUTSIDE_ROOT',
      messageKey: 'diagnostics.xml.textOutsideRoot',
      params: { detail },
    };
  }

  if (
    detail === 'an XML declaration must be at the start of the document.' ||
    detail === 'the XML declaration must appear at the start of the document.' ||
    detail === 'XML declaration is incomplete.' ||
    detail === 'XML declaration must contain a version.' ||
    detail === 'did not expect any more name/value pairs.' ||
    detail === 'The character ? is disallowed anywhere in XML declarations.' ||
    detail.startsWith('expected the name ') ||
    detail.startsWith('expected one of ') ||
    detail.startsWith('version number must match') ||
    detail.startsWith('encoding value must match') ||
    detail.startsWith('standalone value must match')
  ) {
    return {
      code: 'XML_DECLARATION_ERROR',
      messageKey: 'diagnostics.xml.declarationError',
      params: { detail },
    };
  }

  return {
    code: 'XML_SYNTAX_ERROR',
    messageKey: 'diagnostics.xml.syntaxError',
    params: { detail },
  };
}

/**
 * Checks XML well-formedness and namespace rules in pure TypeScript (DOM-free).
 *
 * SourceRange coordinates follow these verified `saxes` semantics:
 * - `line`: 1-based line number (`parser.line`).
 * - `column`: 1-based Unicode code-point column (`parser.column + 1`) for human display.
 * - `offset`: 0-based UTF-16 code-unit index (`parser.position` clamped to `[0, xml.length]`),
 *   authoritative for JavaScript string indexing and editor selection/diagnostics.
 *
 * Security posture: external DTDs/entities are never fetched, and internal `<!ENTITY>`
 * declarations are never expanded (preventing billion-laughs entity-expansion attacks).
 */
export function checkWellFormedness(
  xml: string,
  options?: WellFormednessOptions,
): WellFormednessResult {
  const maxDiagnostics = Math.max(1, options?.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS);
  const assumedEncoding = options?.assumedEncoding ?? DEFAULT_ASSUMED_ENCODING;

  const parser = new SaxesParser({ xmlns: true, position: true });
  const diagnostics: Diagnostic[] = [];
  const seenKeys = new Set<string>();
  const declaredGeneralEntities = new Set<string>();

  let truncatedDiagnostics = false;
  let hasError = false;
  let rootElement: string | undefined;
  let elementCount = 0;
  let xmlDeclaration: XmlDeclarationInfo | undefined;
  let hasExternalDtd = false;
  let hasParameterEntityRef = false;
  let doctypeRange: SourceRange | undefined;
  let declRange: SourceRange | undefined;

  const currentRange = (): SourceRange => ({
    line: parser.line,
    column: parser.column + 1,
    offset: clampOffset(parser.position, xml.length),
  });

  const pushDiagnostic = (diag: Diagnostic): void => {
    if (diag.severity === 'error') {
      hasError = true;
    }
    const dedupKey = `${diag.code}|${diag.range?.offset ?? -1}|${String(diag.params?.detail ?? '')}`;
    if (seenKeys.has(dedupKey)) {
      return;
    }
    if (diagnostics.length >= maxDiagnostics) {
      truncatedDiagnostics = true;
      return;
    }
    seenKeys.add(dedupKey);
    diagnostics.push(diag);
  };

  parser.on('xmldecl', (decl) => {
    declRange = currentRange();
    const info: { version?: string; encoding?: string; standalone?: string } = {};
    if (decl.version !== undefined) {
      info.version = decl.version;
    }
    if (decl.encoding !== undefined) {
      info.encoding = decl.encoding;
    }
    if (decl.standalone !== undefined) {
      info.standalone = decl.standalone;
    }
    xmlDeclaration = info;
  });

  parser.on('doctype', (doctypeContent) => {
    doctypeRange ??= currentRange();

    const bracketIndex = doctypeContent.indexOf('[');
    const header = bracketIndex >= 0 ? doctypeContent.slice(0, bracketIndex) : doctypeContent;
    if (/\b(?:SYSTEM|PUBLIC)\b/.test(header)) {
      hasExternalDtd = true;
    }

    if (bracketIndex >= 0) {
      const internalSubset = doctypeContent.slice(bracketIndex + 1);
      if (PARAMETER_ENTITY_REF_RE.test(internalSubset)) {
        hasParameterEntityRef = true;
      }

      GENERAL_ENTITY_DECL_RE.lastIndex = 0;
      let match = GENERAL_ENTITY_DECL_RE.exec(internalSubset);
      while (match !== null) {
        const entityName = match[1];
        if (entityName) {
          declaredGeneralEntities.add(entityName);
        }
        match = GENERAL_ENTITY_DECL_RE.exec(internalSubset);
      }
    }
  });

  parser.on('opentag', (tag) => {
    elementCount += 1;
    rootElement ??= tag.name;
  });

  parser.on('error', (err) => {
    const range = currentRange();
    const detail = stripLeadingPosition(err.message, parser.line, parser.column);
    if (
      detail === 'unexpected end.' &&
      seenKeys.has(`XML_EMPTY_DOCUMENT|${range.offset}|document must contain a root element.`)
    ) {
      return;
    }
    const mayBeDeclaredExternally =
      (hasExternalDtd || hasParameterEntityRef) && xmlDeclaration?.standalone !== 'yes';
    const mapped = mapSaxesErrorMessage(detail, xml, range.offset, {
      declaredGeneralEntities,
      mayBeDeclaredExternally,
    });
    if (!mapped) {
      return;
    }
    pushDiagnostic({
      severity: mapped.severity ?? 'error',
      code: mapped.code,
      messageKey: mapped.messageKey,
      params: mapped.params,
      range,
      source: 'parser',
    });
  });

  try {
    parser.write(xml).close();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    pushDiagnostic({
      severity: 'error',
      code: 'XML_SYNTAX_ERROR',
      messageKey: 'diagnostics.xml.syntaxError',
      params: { detail },
      range: currentRange(),
      source: 'parser',
    });
  }

  if (declaredGeneralEntities.size > 0) {
    const dtdDiag: Diagnostic = {
      severity: 'warning',
      code: 'XML_DTD_ENTITY_EXPANSION_DISABLED',
      messageKey: 'diagnostics.xml.dtdEntityExpansionDisabled',
      params: {
        count: declaredGeneralEntities.size,
        detail: `Declared ${declaredGeneralEntities.size} DTD entities; expansion disabled for security.`,
      },
      source: 'parser',
      ...(doctypeRange ? { range: doctypeRange } : {}),
    };
    pushDiagnostic(dtdDiag);
  }

  if (hasExternalDtd) {
    const extDiag: Diagnostic = {
      severity: 'warning',
      code: 'XML_EXTERNAL_DTD_IGNORED',
      messageKey: 'diagnostics.xml.externalDtdIgnored',
      params: {
        detail: 'External DTD subset is not fetched.',
      },
      source: 'parser',
      ...(doctypeRange ? { range: doctypeRange } : {}),
    };
    pushDiagnostic(extDiag);
  }

  if (xmlDeclaration?.encoding) {
    const declaredNorm = normalizeEncodingName(xmlDeclaration.encoding);
    const assumedNorm = normalizeEncodingName(assumedEncoding);
    const isCompatibleUnicode =
      options?.assumedEncoding === undefined &&
      (declaredNorm === 'UTF-8' || declaredNorm === 'UTF-16');

    if (!isCompatibleUnicode && declaredNorm !== assumedNorm) {
      const encDiag: Diagnostic = {
        severity: 'info',
        code: 'XML_ENCODING_DECLARATION_NOTE',
        messageKey: 'diagnostics.xml.encodingDeclarationNote',
        params: {
          declared: xmlDeclaration.encoding,
          assumed: assumedEncoding,
          detail: `Declared encoding "${xmlDeclaration.encoding}" vs assumed "${assumedEncoding}".`,
        },
        source: 'parser',
        ...(declRange ? { range: declRange } : {}),
      };
      pushDiagnostic(encDiag);
    }
  }

  const wellFormed = !hasError;

  return {
    wellFormed,
    diagnostics,
    elementCount,
    truncatedDiagnostics,
    ...(rootElement !== undefined ? { rootElement } : {}),
    ...(xmlDeclaration !== undefined ? { xmlDeclaration } : {}),
  };
}
