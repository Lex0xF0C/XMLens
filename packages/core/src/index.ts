/**
 * Pure TypeScript core module for XMLens.
 * Intentionally free of DOM and browser globals so it can run in workers, CLI, or extensions.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SourceRange {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly range?: SourceRange;
  readonly xpath?: string;
  readonly source: 'parser' | 'xsd' | 'schematron' | 'core';
}

export type LocaleCode = 'en' | 'ja';
export type MessageCatalog = Readonly<Record<string, string>>;

/**
 * Formats a localized message template by replacing `{key}` placeholders with parameter values.
 * Falls back to the English catalog when a key is missing in the active locale.
 */
export function formatMessage(
  catalog: MessageCatalog,
  fallbackCatalog: MessageCatalog,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = catalog[key] ?? fallbackCatalog[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, paramName: string) => {
    const value = params[paramName];
    return value !== undefined ? String(value) : match;
  });
}

export {
  checkWellFormedness,
  type WellFormednessOptions,
  type WellFormednessResult,
  type XmlDeclarationInfo,
} from './wellFormedness';

export {
  detectXmlEncoding,
  normalizeXmlEncodingLabel,
  type EncodingDetectionSource,
  type XmlEncodingDetectionResult,
} from './encoding';

export {
  convertLineEndings,
  detectLineEnding,
  encodeUtf16Bytes,
  findLoneSurrogate,
  formatCodeUnitHex,
  inspectXmlDeclarationForSave,
  rewriteLeadingXmlDeclarationEncoding,
  type EncodeUtf16Options,
  type EncodeUtf16Result,
  type LineEnding,
  type LoneSurrogateLocation,
  type SaveEncoding,
  type XmlDeclarationSaveCheck,
} from './xmlExport';

export {
  formatXml,
  type FormatXmlOptions,
  type FormatXmlResult,
  type IndentStyle,
} from './formatter';
