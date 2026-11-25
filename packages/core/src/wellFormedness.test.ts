import { describe, expect, it } from 'vitest';
import { checkWellFormedness } from './index';

describe('checkWellFormedness', () => {
  it('accepts valid namespaced XML with CJK content and counts elements', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0">
  <act name="sample">
    <body>
      <article eId="art_1">
        <num>第1条</num>
      </article>
    </body>
  </act>
</akomaNtoso>`;

    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.rootElement).toBe('akomaNtoso');
    expect(result.elementCount).toBe(5);
    expect(result.xmlDeclaration).toEqual({ version: '1.0', encoding: 'UTF-8' });
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts a leading UTF-8 BOM before the XML declaration', () => {
    const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?><doc><p>ok</p></doc>';
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.rootElement).toBe('doc');
    expect(result.elementCount).toBe(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports XML_EMPTY_DOCUMENT for empty or whitespace-only input without duplicate errors', () => {
    const empty = checkWellFormedness('');
    expect(empty.wellFormed).toBe(false);
    expect(empty.diagnostics).toHaveLength(1);
    expect(empty.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_EMPTY_DOCUMENT',
      messageKey: 'diagnostics.xml.emptyDocument',
      source: 'parser',
      range: { line: 1, column: 1, offset: 0 },
    });

    const whitespace = checkWellFormedness('   \n  ');
    expect(whitespace.wellFormed).toBe(false);
    expect(whitespace.diagnostics).toHaveLength(1);
    expect(whitespace.diagnostics[0]?.code).toBe('XML_EMPTY_DOCUMENT');
    expect(whitespace.diagnostics[0]?.range).toEqual({ line: 2, column: 3, offset: 6 });
  });

  it('maps core syntax and namespace errors to structured Diagnostic objects', () => {
    const dupAttr = checkWellFormedness('<root id="1" id="2"/>');
    expect(dupAttr.wellFormed).toBe(false);
    expect(dupAttr.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_DUPLICATE_ATTRIBUTE',
      messageKey: 'diagnostics.xml.duplicateAttribute',
      params: { attribute: 'id' },
      source: 'parser',
    });

    const unbound = checkWellFormedness('<akn:act/>');
    expect(unbound.wellFormed).toBe(false);
    expect(unbound.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_UNBOUND_NAMESPACE_PREFIX',
      messageKey: 'diagnostics.xml.unboundNamespacePrefix',
      params: { prefix: 'akn' },
    });

    const unclosed = checkWellFormedness('<root><child>');
    expect(unclosed.wellFormed).toBe(false);
    expect(unclosed.diagnostics.map((d) => d.code)).toEqual([
      'XML_UNCLOSED_TAG',
      'XML_UNCLOSED_TAG',
    ]);
    expect(unclosed.diagnostics[0]?.params?.tag).toBe('child');
    expect(unclosed.diagnostics[1]?.params?.tag).toBe('root');

    const mismatched = checkWellFormedness('<root><a></b></root>');
    expect(mismatched.wellFormed).toBe(false);
    expect(mismatched.diagnostics.some((d) => d.code === 'XML_UNMATCHED_CLOSING_TAG')).toBe(true);
    expect(mismatched.diagnostics.some((d) => d.code === 'XML_UNEXPECTED_CLOSE_TAG')).toBe(true);

    const multiRoot = checkWellFormedness('<a/><b/>');
    expect(multiRoot.wellFormed).toBe(false);
    expect(multiRoot.diagnostics[0]?.code).toBe('XML_MULTIPLE_ROOTS');

    const textOutside = checkWellFormedness('<a/>trailing');
    expect(textOutside.wellFormed).toBe(false);
    expect(textOutside.diagnostics[0]?.code).toBe('XML_TEXT_OUTSIDE_ROOT');
    expect(textOutside.diagnostics[0]?.range?.offset).toBe('<a/>trailing'.length);
  });

  it('distinguishes UTF-16 offset from Unicode code-point column on astral-plane characters', () => {
    const xml = '<root>𠮷<bad></root>';
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(false);
    const diag = result.diagnostics[0];
    expect(diag?.range).toEqual({
      line: 1,
      column: 20, // 1-based Unicode code-point column (19 zero-based + 1)
      offset: 20, // 0-based UTF-16 code-unit index at end of </root> (𠮷 counts as 2 UTF-16 units)
    });
    expect(diag?.range?.offset).toBe(xml.length);
  });

  it('reports XML_UNDEFINED_ENTITY when no DTD declares the entity', () => {
    const result = checkWellFormedness('<doc>&missing;</doc>');
    expect(result.wellFormed).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_UNDEFINED_ENTITY',
      messageKey: 'diagnostics.xml.undefinedEntity',
      params: { entity: 'missing' },
    });
  });

  it('keeps DTD entity expansion disabled, emits a warning, and avoids false undefined-entity errors', () => {
    const xml = '<!DOCTYPE doc [<!ENTITY title "XMLens">]><doc>&title;</doc>';
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_DTD_ENTITY_EXPANSION_DISABLED',
      messageKey: 'diagnostics.xml.dtdEntityExpansionDisabled',
      params: { count: 1 },
    });

    const mixed = '<!DOCTYPE doc [<!ENTITY title "XMLens">]><doc>&title;&undeclared;</doc>';
    const mixedResult = checkWellFormedness(mixed);
    expect(mixedResult.wellFormed).toBe(false);
    expect(mixedResult.diagnostics.map((d) => d.code)).toEqual([
      'XML_UNDEFINED_ENTITY',
      'XML_DTD_ENTITY_EXPANSION_DISABLED',
    ]);
    expect(mixedResult.diagnostics[0]?.params?.entity).toBe('undeclared');
  });

  it('neutralizes billion-laughs nested entity expansion rapidly without hanging', () => {
    const bomb = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<lolz>&lol4;</lolz>`;

    const result = checkWellFormedness(bomb);
    expect(result.wellFormed).toBe(true);
    expect(result.rootElement).toBe('lolz');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_DTD_ENTITY_EXPANSION_DISABLED',
      params: { count: 5 },
    });
  });

  it('warns on external DTD references without attempting network fetches', () => {
    const xml = '<!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc/>';
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_EXTERNAL_DTD_IGNORED',
      messageKey: 'diagnostics.xml.externalDtdIgnored',
    });
  });

  it('emits warning (not error) for undeclared entities with external DTD or parameter entities unless standalone="yes"', () => {
    const systemDtd =
      '<!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc>&extEntity;</doc>';
    const systemResult = checkWellFormedness(systemDtd);
    expect(systemResult.wellFormed).toBe(true);
    expect(systemResult.diagnostics.map((d) => d.code)).toEqual([
      'XML_UNDECLARED_EXTERNAL_ENTITY',
      'XML_EXTERNAL_DTD_IGNORED',
    ]);
    expect(systemResult.diagnostics[0]).toMatchObject({
      severity: 'warning',
      messageKey: 'diagnostics.xml.undeclaredExternalEntity',
      params: { entity: 'extEntity' },
    });

    const publicDtd =
      '<?xml version="1.0" standalone="no"?><!DOCTYPE doc PUBLIC "-//XMLens//DTD Test//EN" "https://example.invalid/doc.dtd"><doc>&pubEntity;</doc>';
    const publicResult = checkWellFormedness(publicDtd);
    expect(publicResult.wellFormed).toBe(true);
    expect(publicResult.diagnostics.map((d) => d.code)).toEqual([
      'XML_UNDECLARED_EXTERNAL_ENTITY',
      'XML_EXTERNAL_DTD_IGNORED',
    ]);

    const paramEntity =
      '<!DOCTYPE doc [<!ENTITY % pe SYSTEM "https://example.invalid/pe.ent"> %pe;]><doc>&peDefined;</doc>';
    const paramResult = checkWellFormedness(paramEntity);
    expect(paramResult.wellFormed).toBe(true);
    expect(paramResult.diagnostics).toHaveLength(1);
    expect(paramResult.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_UNDECLARED_EXTERNAL_ENTITY',
      params: { entity: 'peDefined' },
    });

    const standaloneYes =
      '<?xml version="1.0" standalone="yes"?><!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc>&extEntity;</doc>';
    const standaloneResult = checkWellFormedness(standaloneYes);
    expect(standaloneResult.wellFormed).toBe(false);
    expect(standaloneResult.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_UNDEFINED_ENTITY',
      params: { entity: 'extEntity' },
    });
  });

  it('emits an informational diagnostic when XML declaration specifies non-UTF encoding', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><doc/>';
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'info',
      code: 'XML_ENCODING_DECLARATION_NOTE',
      messageKey: 'diagnostics.xml.encodingDeclarationNote',
      params: { declared: 'ISO-8859-1', assumed: 'UTF-8' },
    });
  });

  it('suppresses XML_ENCODING_DECLARATION_NOTE for equivalent encoding aliases (cp932, euc_jp, ISO-8859-1 vs windows-1252)', () => {
    const cp932Result = checkWellFormedness('<?xml version="1.0" encoding="cp932"?><doc/>', {
      assumedEncoding: 'Shift_JIS',
    });
    expect(cp932Result.wellFormed).toBe(true);
    expect(cp932Result.diagnostics).toEqual([]);

    const eucJpResult = checkWellFormedness('<?xml version="1.0" encoding="euc_jp"?><doc/>', {
      assumedEncoding: 'EUC-JP',
    });
    expect(eucJpResult.wellFormed).toBe(true);
    expect(eucJpResult.diagnostics).toEqual([]);

    // WHATWG Encoding Standard maps iso-8859-1 to windows-1252; when decoded with
    // windows-1252 override, ISO-8859-1 should not trigger an encoding mismatch note.
    const latin1Result = checkWellFormedness('<?xml version="1.0" encoding="ISO-8859-1"?><doc/>', {
      assumedEncoding: 'windows-1252',
    });
    expect(latin1Result.wellFormed).toBe(true);
    expect(latin1Result.diagnostics).toEqual([]);
  });

  it('falls back to XML_SYNTAX_ERROR while preserving detail for unmapped errors', () => {
    const result = checkWellFormedness('<doc><!-- bad -- comment --></doc>');
    expect(result.wellFormed).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'XML_SYNTAX_ERROR',
      messageKey: 'diagnostics.xml.syntaxError',
      params: { detail: 'malformed comment.' },
    });
  });

  it('handles deep nesting iteratively and respects maxDiagnostics truncation', () => {
    const depth = 1500;
    const deep = '<a>'.repeat(depth) + 'ok' + '</a>'.repeat(depth);
    const deepResult = checkWellFormedness(deep);
    expect(deepResult.wellFormed).toBe(true);
    expect(deepResult.elementCount).toBe(depth);

    const manyErrors = '<r>' + '<p:a/>'.repeat(10) + '</r>';
    const capped = checkWellFormedness(manyErrors, { maxDiagnostics: 3 });
    expect(capped.wellFormed).toBe(false);
    expect(capped.diagnostics).toHaveLength(3);
    expect(capped.truncatedDiagnostics).toBe(true);
  });

  it('reports wellFormed: false when maxDiagnostics is filled by a warning before a syntax error (Case A)', () => {
    const xml =
      '<!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc>&extEntity;<bad></doc>';
    const result = checkWellFormedness(xml, { maxDiagnostics: 1 });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XML_UNDECLARED_EXTERNAL_ENTITY',
    });
    expect(result.truncatedDiagnostics).toBe(true);
    expect(result.wellFormed).toBe(false);

    const paramEntityXml =
      '<!DOCTYPE doc [<!ENTITY % pe SYSTEM "https://example.invalid/pe.ent"> %pe;]><doc>&peDefined;<unclosed></doc>';
    const paramResult = checkWellFormedness(paramEntityXml, { maxDiagnostics: 1 });
    expect(paramResult.diagnostics).toHaveLength(1);
    expect(paramResult.diagnostics[0]?.code).toBe('XML_UNDECLARED_EXTERNAL_ENTITY');
    expect(paramResult.truncatedDiagnostics).toBe(true);
    expect(paramResult.wellFormed).toBe(false);
  });

  it('keeps wellFormed: true when maxDiagnostics truncates only warnings/info and no errors occur (Case B)', () => {
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-1"?><!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc>&extEntity;</doc>';
    const result = checkWellFormedness(xml, { maxDiagnostics: 1 });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.truncatedDiagnostics).toBe(true);
    expect(result.wellFormed).toBe(true);
  });

  it('preserves both warnings and errors in diagnostics when maxDiagnostics is large enough (Case C)', () => {
    const xml =
      '<!DOCTYPE doc SYSTEM "https://example.invalid/doc.dtd"><doc>&extEntity;<bad></doc>';
    const result = checkWellFormedness(xml, { maxDiagnostics: 100 });

    expect(result.wellFormed).toBe(false);
    expect(result.truncatedDiagnostics).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.severity === 'warning' && d.code === 'XML_UNDECLARED_EXTERNAL_ENTITY',
      ),
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
