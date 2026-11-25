import { describe, expect, it } from 'vitest';
import { formatWellFormedXmlUnchecked } from './formatter';
import { checkWellFormedness, formatXml } from './index';

describe('formatXml', () => {
  it('indents nested elements using 2 spaces, 4 spaces, or tabs with LF line endings', () => {
    const compact =
      '<?xml version="1.0" encoding="UTF-8"?><root><a><b id="1">val</b><c/></a></root>';

    const res2 = formatXml(compact, { indentStyle: 'spaces-2' });
    expect(res2.ok).toBe(true);
    if (!res2.ok) {
      throw new Error('Expected formatting to succeed');
    }
    expect(res2.changed).toBe(true);
    expect(res2.formatted).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <a>\n    <b id="1">val</b>\n    <c/>\n  </a>\n</root>',
    );

    const res4 = formatXml(compact, { indentStyle: 'spaces-4' });
    expect(res4.ok).toBe(true);
    if (res4.ok) {
      expect(res4.formatted).toBe(
        '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n    <a>\n        <b id="1">val</b>\n        <c/>\n    </a>\n</root>',
      );
    }

    const resTab = formatXml(compact, { indentStyle: 'tab' });
    expect(resTab.ok).toBe(true);
    if (resTab.ok) {
      expect(resTab.formatted).toBe(
        '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\t<a>\n\t\t<b id="1">val</b>\n\t\t<c/>\n\t</a>\n</root>',
      );
    }
  });

  it('preserves mixed content and leaf whitespace verbatim without inserting indentation', () => {
    const mixed = '<article><p>Hello <b>world</b> and <i>all</i>.</p><empty>   </empty></article>';
    const res = formatXml(mixed);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error('Expected formatting to succeed');
    }
    expect(res.formatted).toBe(
      '<article>\n  <p>Hello <b>world</b> and <i>all</i>.</p>\n  <empty>   </empty>\n</article>',
    );
  });

  it('preserves xml:space="preserve" subtrees and re-enables formatting under xml:space="default"', () => {
    const xml =
      '<doc><pre xml:space="preserve">  <a/><b/>  <inner xml:space="default"><x><y/></x></inner></pre><after><z/></after></doc>';
    const res = formatXml(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error('Expected formatting to succeed');
    }
    expect(res.formatted).toBe(
      '<doc>\n  <pre xml:space="preserve">  <a/><b/>  <inner xml:space="default">\n      <x>\n        <y/>\n      </x>\n    </inner></pre>\n  <after>\n    <z/>\n  </after>\n</doc>',
    );

    // Ensure attribute values containing xml:space="preserve" are not confused with an actual xml:space attr.
    const trickyAttr = '<doc title=\'note xml:space="preserve"\'><a><b/></a></doc>';
    const trickyRes = formatXml(trickyAttr);
    expect(trickyRes.ok).toBe(true);
    if (trickyRes.ok) {
      expect(trickyRes.formatted).toBe(
        '<doc title=\'note xml:space="preserve"\'>\n  <a>\n    <b/>\n  </a>\n</doc>',
      );
    }
  });

  it('preserves BOM, XML declaration, DOCTYPE internal subset, comments, PIs, CDATA, and entity references verbatim', () => {
    const complex =
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>' +
      '<!DOCTYPE doc [<!ENTITY title "XMLens &amp; Co">]>' +
      '<!-- top comment -->' +
      '<?xml-stylesheet type="text/xsl" href="a.xsl"?>' +
      "<doc attr='a&amp;b&#x20;c'>" +
      '<title>&title; &amp; &#x3042;</title>' +
      '<raw><![CDATA[<tag>  &amp;  </tag>]]></raw>' +
      '<!-- inner comment -->' +
      '<?pi body="x"?>' +
      '</doc>';

    const res = formatXml(complex);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error('Expected formatting to succeed');
    }

    const expected = [
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE doc [<!ENTITY title "XMLens &amp; Co">]>',
      '<!-- top comment -->',
      '<?xml-stylesheet type="text/xsl" href="a.xsl"?>',
      "<doc attr='a&amp;b&#x20;c'>",
      '  <title>&title; &amp; &#x3042;</title>',
      '  <raw><![CDATA[<tag>  &amp;  </tag>]]></raw>',
      '  <!-- inner comment -->',
      '  <?pi body="x"?>',
      '</doc>',
    ].join('\n');

    expect(res.formatted).toBe(expected);
    // DTD entity-expansion warning is preserved on the result
    expect(res.diagnostics.some((d) => d.code === 'XML_DTD_ENTITY_EXPANSION_DISABLED')).toBe(true);

    // Well-formedness and element counts remain equivalent before and after formatting
    const beforeWf = checkWellFormedness(complex);
    const afterWf = checkWellFormedness(res.formatted);
    expect(afterWf.wellFormed).toBe(beforeWf.wellFormed);
    expect(afterWf.elementCount).toBe(beforeWf.elementCount);
    expect(afterWf.rootElement).toBe(beforeWf.rootElement);
  });

  it('handles CJK text and astral surrogate pairs (𠮷) and satisfies idempotency', () => {
    const cjk =
      '<?xml version="1.0" encoding="UTF-8"?>\n<法令><条文 eId="art_1"><見出し>第1条 𠮷野家</見出し><項><文>日本語テスト😀</文></項></条文></法令>';
    const first = formatXml(cjk);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('Expected formatting to succeed');
    }
    expect(first.changed).toBe(true);
    expect(first.formatted).toContain('第1条 𠮷野家');
    expect(first.formatted).toContain('日本語テスト😀');

    const second = formatXml(first.formatted);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.changed).toBe(false);
      expect(second.formatted).toBe(first.formatted);
    }
  });

  it('refuses to format not-well-formed XML and returns structured diagnostics without throwing', () => {
    const malformed = '<root><unclosed></root>';
    const res = formatXml(malformed);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }

    const empty = formatXml('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.diagnostics[0]?.code).toBe('XML_EMPTY_DOCUMENT');
    }
  });

  it('handles deep nesting (1,500 and 5,000 levels) without throwing RangeError', () => {
    for (const depth of [1500, 5000]) {
      const deep = `${'<a>'.repeat(depth)}<b/>${'</a>'.repeat(depth)}`;
      expect(deep.length).toBeLessThan(1024 * 1024);

      const res = formatXml(deep);
      expect(res.ok).toBe(true);
      if (!res.ok) {
        throw new Error(`Expected depth ${depth} formatting to succeed`);
      }
      expect(res.elementCount).toBe(depth + 1);
      expect(res.formatted.startsWith('<a>\n  <a>\n')).toBe(true);
      expect(res.formatted.endsWith('\n  </a>\n</a>')).toBe(true);
    }
  });

  it('handles deep nesting containing xml:space="preserve" and xml:space="default"', () => {
    const outerDepth = 5000;
    const innerPreserveDepth = 100;
    const xml =
      '<a>'.repeat(outerDepth) +
      '<pre xml:space="preserve">' +
      '<b>'.repeat(innerPreserveDepth) +
      '  <x><y/></x>  ' +
      '<def xml:space="default"><m><n/></m></def>' +
      '</b>'.repeat(innerPreserveDepth) +
      '</pre>' +
      '</a>'.repeat(outerDepth);
    expect(xml.length).toBeLessThan(1024 * 1024);

    const res = formatXml(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error('Expected deep xml:space formatting to succeed');
    }
    expect(res.formatted).toContain(
      '<pre xml:space="preserve">' + '<b>'.repeat(innerPreserveDepth) + '  <x><y/></x>  ',
    );
    expect(res.formatted).toContain('<def xml:space="default">\n');
  });

  it('handles deep nesting containing mixed-content subtrees verbatim', () => {
    const outerDepth = 5000;
    const mixedDepth = 200;
    const xml =
      '<a>'.repeat(outerDepth) +
      '<p>Lead ' +
      '<span>'.repeat(mixedDepth) +
      'inline <b>text</b>' +
      '</span>'.repeat(mixedDepth) +
      ' tail</p>' +
      '</a>'.repeat(outerDepth);
    expect(xml.length).toBeLessThan(1024 * 1024);

    const res = formatXml(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error('Expected deep mixed-content formatting to succeed');
    }
    expect(res.formatted).toContain(
      '<p>Lead ' +
        '<span>'.repeat(mixedDepth) +
        'inline <b>text</b>' +
        '</span>'.repeat(mixedDepth) +
        ' tail</p>',
    );
  });

  it('handles 100,000-level nesting in the iterative pipeline and converts RangeError into XML_FORMAT_INTERNAL_ERROR without throwing', () => {
    const depth100k = 100_000;
    const preserve100k =
      '<r xml:space="preserve">' +
      '<a>'.repeat(depth100k - 1) +
      '<b/>' +
      '</a>'.repeat(depth100k - 1) +
      '</r>';
    expect(preserve100k.length).toBeLessThan(1024 * 1024);

    // Iterative tokenizer + AST + formatter handles 100,000 levels without call-stack overflow.
    const preserveOut = formatWellFormedXmlUnchecked(preserve100k);
    expect(preserveOut).toBe(preserve100k);

    // Unpreserved 100,000-level indentation (~20 GB, exceeding V8 string limits) fails safely with RangeError, not stack overflow or OOM.
    const container100k = `${'<a>'.repeat(depth100k)}<b/>${'</a>'.repeat(depth100k)}`;
    expect(container100k.length).toBeLessThan(1024 * 1024);
    expect(() => formatWellFormedXmlUnchecked(container100k)).toThrow(RangeError);

    // End-to-end formatXml with explicit namespace bindings (avoiding saxes O(D^2) default-ns scan)
    // succeeds at 59,000 levels under xml:space="preserve" and catches output-size RangeError at 59,000 container levels.
    const depth59k = 59_000;
    const nsPreserve59k =
      '<a xmlns="x" xml:space="preserve">' +
      '<a xmlns="x">'.repeat(depth59k - 1) +
      '<b/>' +
      '</a>'.repeat(depth59k);
    expect(nsPreserve59k.length).toBeLessThan(1024 * 1024);
    const ok59k = formatXml(nsPreserve59k);
    expect(ok59k.ok).toBe(true);
    if (ok59k.ok) {
      expect(ok59k.elementCount).toBe(depth59k + 1);
      expect(ok59k.formatted).toBe(nsPreserve59k);
    }

    const nsContainer59k = `${'<a xmlns="x">'.repeat(depth59k)}<b/>${'</a>'.repeat(depth59k)}`;
    expect(nsContainer59k.length).toBeLessThan(1024 * 1024);
    const capped = formatXml(nsContainer59k);
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.diagnostics).toHaveLength(1);
      expect(capped.diagnostics[0]).toMatchObject({
        severity: 'error',
        code: 'XML_FORMAT_INTERNAL_ERROR',
        messageKey: 'diagnostics.xml.formatInternalError',
        source: 'core',
      });
      expect(typeof capped.diagnostics[0]?.params?.detail).toBe('string');
    }
  });
});
