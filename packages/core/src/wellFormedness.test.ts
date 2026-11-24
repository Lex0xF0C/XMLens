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
});
