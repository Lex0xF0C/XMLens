import { describe, expect, it } from 'vitest';
import { getXPathAtOffset } from './index';
import { tokenizeXmlForFormat } from './xmlTokenizer';

describe('getXPathAtOffset', () => {
  it('enforces exact tag-boundary and prologue/epilogue cursor rules and clamps offsets', () => {
    const xml = '<?xml version="1.0"?>\n<!-- pre -->\n<a><b/>text<c>hi</c></a>\n<!-- post -->';
    const aStart = xml.indexOf('<a>');
    const aEnd = xml.indexOf('</a>') + 4;
    const bStart = xml.indexOf('<b/>');
    const bEnd = bStart + 4;
    const cStart = xml.indexOf('<c>');
    const cCloseStart = xml.indexOf('</c>');
    const cEnd = cCloseStart + 4;

    // Clamping & prologue/epilogue outside root -> empty path
    for (const pos of [-10, Number.NaN, 0, xml.indexOf('pre'), aStart, aEnd, xml.length, 999_999]) {
      const outside = getXPathAtOffset(xml, pos);
      expect(outside).toEqual({ ok: true, segments: [], xpath: '', breadcrumb: '' });
    }
    expect(getXPathAtOffset(xml, Number.POSITIVE_INFINITY)).toEqual({
      ok: true,
      segments: [],
      xpath: '',
      breadcrumb: '',
    });
    expect(getXPathAtOffset(xml, Number.NEGATIVE_INFINITY)).toEqual({
      ok: true,
      segments: [],
      xpath: '',
      breadcrumb: '',
    });

    // Inside <a> start tag (<|a>)
    const inAOpen = getXPathAtOffset(xml, aStart + 1);
    expect(inAOpen).toEqual({
      ok: true,
      segments: [
        {
          qname: 'a',
          localName: 'a',
          namespaceURI: '',
          index: 1,
          siblingCount: 1,
          start: aStart,
          end: aEnd,
        },
      ],
      xpath: '/Q{}a[1]',
      breadcrumb: 'a',
    });

    // Between <a> and <b/> (offset === bStart): belongs to parent <a>
    const beforeB = getXPathAtOffset(xml, bStart);
    expect(beforeB.ok && beforeB.breadcrumb).toBe('a');

    // Inside self-closing <b/> (<|b/> and <b/|>)
    expect(getXPathAtOffset(xml, bStart + 1)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]/Q{}b[1]',
      breadcrumb: 'a › b',
    });
    expect(getXPathAtOffset(xml, bEnd - 1)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]/Q{}b[1]',
      breadcrumb: 'a › b',
    });

    // Immediately after <b/> (offset === bEnd, before "text"): belongs to parent <a>
    expect(getXPathAtOffset(xml, bEnd)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]',
      breadcrumb: 'a',
    });

    // At end of "text", immediately before <c> (offset === cStart): belongs to parent <a>
    expect(getXPathAtOffset(xml, cStart)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]',
      breadcrumb: 'a',
    });

    // Inside <c>, inside "hi", and inside </c>
    for (const pos of [cStart + 1, cStart + 3, cStart + 4, cCloseStart, cEnd - 1]) {
      const inC = getXPathAtOffset(xml, pos);
      expect(inC).toMatchObject({
        ok: true,
        xpath: '/Q{}a[1]/Q{}c[1]',
        breadcrumb: 'a › c',
      });
    }

    // Immediately after </c> (offset === cEnd, before </a>): belongs to parent <a>
    expect(getXPathAtOffset(xml, cEnd)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]',
      breadcrumb: 'a',
    });

    // Empty element interior <a>|</a>
    const emptyElem = '<a></a>';
    expect(getXPathAtOffset(emptyElem, 3)).toMatchObject({
      ok: true,
      xpath: '/Q{}a[1]',
      breadcrumb: 'a',
    });
  });

  it('resolves namespaces, counts siblings by expanded name across prefixes, handles redeclarations, and ignores fake xmlns text in attribute values', () => {
    const xml =
      '<akomaNtoso xmlns="urn:akn" xmlns:a="urn:ext" title=\'xmlns="urn:fake"\'>' +
      '<act>' +
      '<body>' +
      '<article eId="1"><p>first</p></article>' +
      '<a:article xmlns:b="urn:ext" eId="2"><b:item/><item xmlns=""/></a:article>' +
      '<alt:article xmlns:alt="urn:akn" eId="3"><num>3</num></alt:article>' +
      '</body>' +
      '</act>' +
      '</akomaNtoso>';

    // 1st <article> (default ns urn:akn) followed later by <alt:article> (also urn:akn) -> index 1, siblingCount 2 -> article[1]
    const firstP = getXPathAtOffset(xml, xml.indexOf('first'));
    expect(firstP).toMatchObject({
      ok: true,
      xpath:
        '/Q{urn:akn}akomaNtoso[1]/Q{urn:akn}act[1]/Q{urn:akn}body[1]/Q{urn:akn}article[1]/Q{urn:akn}p[1]',
      breadcrumb: 'akomaNtoso › act › body › article[1] › p',
    });

    // 2nd <a:article> has ns urn:ext (only 1 sibling in urn:ext -> no [1] in breadcrumb)
    // Inside it: <b:item/> (urn:ext) and <item xmlns=""/> (no namespace '') -> distinct expanded names!
    const bItem = getXPathAtOffset(xml, xml.indexOf('<b:item/>') + 2);
    expect(bItem).toMatchObject({
      ok: true,
      xpath:
        '/Q{urn:akn}akomaNtoso[1]/Q{urn:akn}act[1]/Q{urn:akn}body[1]/Q{urn:ext}article[1]/Q{urn:ext}item[1]',
      breadcrumb: 'akomaNtoso › act › body › a:article › b:item',
    });

    const unnsItem = getXPathAtOffset(xml, xml.indexOf('<item xmlns=""/>') + 2);
    expect(unnsItem).toMatchObject({
      ok: true,
      xpath:
        '/Q{urn:akn}akomaNtoso[1]/Q{urn:akn}act[1]/Q{urn:akn}body[1]/Q{urn:ext}article[1]/Q{}item[1]',
      breadcrumb: 'akomaNtoso › act › body › a:article › item',
    });

    // <alt:article> shares expanded name (urn:akn, article) with first <article>, so index is 2!
    const altNum = getXPathAtOffset(xml, xml.indexOf('<num>3</num>') + 5);
    expect(altNum).toMatchObject({
      ok: true,
      xpath:
        '/Q{urn:akn}akomaNtoso[1]/Q{urn:akn}act[1]/Q{urn:akn}body[1]/Q{urn:akn}article[2]/Q{urn:akn}num[1]',
      breadcrumb: 'akomaNtoso › act › body › alt:article[2] › num',
    });
  });

  it('handles mixed content, CDATA, comments, PIs, and DOCTYPE internal entities', () => {
    const xml =
      '<!DOCTYPE doc [<!ENTITY title "XMLens &amp; Co">]>' +
      '<doc>' +
      '<!-- inside comment -->' +
      '<?pi target?>' +
      '<p>Hello <b>&title;</b> <![CDATA[<ignored/>]]> world</p>' +
      '</doc>';

    expect(getXPathAtOffset(xml, xml.indexOf('inside comment'))).toMatchObject({
      ok: true,
      xpath: '/Q{}doc[1]',
      breadcrumb: 'doc',
    });
    expect(getXPathAtOffset(xml, xml.indexOf('target'))).toMatchObject({
      ok: true,
      xpath: '/Q{}doc[1]',
      breadcrumb: 'doc',
    });
    expect(getXPathAtOffset(xml, xml.indexOf('&title;') + 2)).toMatchObject({
      ok: true,
      xpath: '/Q{}doc[1]/Q{}p[1]/Q{}b[1]',
      breadcrumb: 'doc › p › b',
    });
    expect(getXPathAtOffset(xml, xml.indexOf('<ignored/>') + 2)).toMatchObject({
      ok: true,
      xpath: '/Q{}doc[1]/Q{}p[1]',
      breadcrumb: 'doc › p',
    });
  });

  it('tracks exact UTF-16 code-unit offsets across BOM, CJK text, and surrogate pairs', () => {
    const xml = '\uFEFF<root><item>日本語𠮷野家</item><item>次</item></root>';
    expect(
      tokenizeXmlForFormat(xml)
        .map((t) => t.raw)
        .join(''),
    ).toBe(xml);

    // Cursor on BOM (offset 0 or 1 before '<root>') -> outside root
    expect(getXPathAtOffset(xml, 0)).toEqual({ ok: true, segments: [], xpath: '', breadcrumb: '' });
    expect(getXPathAtOffset(xml, 1)).toEqual({ ok: true, segments: [], xpath: '', breadcrumb: '' });

    // Cursor after surrogate pair 𠮷 (UTF-16 length 2) inside first <item>
    const afterSurrogate = xml.indexOf('野');
    const firstItemRes = getXPathAtOffset(xml, afterSurrogate);
    expect(firstItemRes.ok).toBe(true);
    if (firstItemRes.ok) {
      expect(firstItemRes.xpath).toBe('/Q{}root[1]/Q{}item[1]');
      expect(firstItemRes.breadcrumb).toBe('root › item[1]');
      const itemSeg = firstItemRes.segments[1];
      expect(itemSeg).toBeDefined();
      if (itemSeg) {
        expect(xml.slice(itemSeg.start, itemSeg.end)).toBe('<item>日本語𠮷野家</item>');
      }
    }

    const secondItemRes = getXPathAtOffset(xml, xml.indexOf('次'));
    expect(secondItemRes).toMatchObject({
      ok: true,
      xpath: '/Q{}root[1]/Q{}item[2]',
      breadcrumb: 'root › item[2]',
    });
  });

  it('returns ok: false without throwing for empty or non-well-formed XML', () => {
    expect(getXPathAtOffset('', 0)).toEqual({ ok: false, reason: 'empty' });
    expect(getXPathAtOffset('   \n\t ', 2)).toEqual({ ok: false, reason: 'empty' });
    expect(getXPathAtOffset('<root><unclosed></root>', 8)).toEqual({
      ok: false,
      reason: 'not-well-formed',
    });
    expect(getXPathAtOffset('<ns:root/>', 3)).toEqual({
      ok: false,
      reason: 'not-well-formed',
    });
  });

  it('handles 5,000-level nesting iteratively without RangeError', () => {
    const depth = 5000;
    const xml = `${'<a>'.repeat(depth)}leaf${'</a>'.repeat(depth)}`;
    const leafOffset = xml.indexOf('leaf') + 2;

    const result = getXPathAtOffset(xml, leafOffset);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.segments).toHaveLength(depth);
      expect(result.segments[0]?.start).toBe(0);
      expect(result.segments[depth - 1]?.localName).toBe('a');
    }
  });

  it('processes a ~1 MiB XML document quickly', () => {
    const item = '<item code="x">Alpha Beta Gamma Delta 0123456789</item>\n';
    const repeatCount = Math.ceil((1024 * 1024) / item.length);
    const xml = `<root>\n${item.repeat(repeatCount)}</root>`;
    expect(xml.length).toBeGreaterThanOrEqual(1024 * 1024);

    const targetOffset = Math.floor(xml.length * 0.75);
    const startedAt = Date.now();
    const result = getXPathAtOffset(xml, targetOffset);
    const elapsedMs = Date.now() - startedAt;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.segments.length).toBeGreaterThanOrEqual(1);
    }
    expect(elapsedMs).toBeLessThan(5000);
  });
});
