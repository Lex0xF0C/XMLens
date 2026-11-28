import { describe, expect, it } from 'vitest';
import { mergePaths, parseUri, recomposeUri, removeDotSegments, resolveReference } from './uri';

/**
 * Test vectors verified verbatim against the official RFC 3986 text retrieved from
 * https://www.rfc-editor.org/rfc/rfc3986.txt on 2026-11-28 (§5.2.4, §5.4.1, §5.4.2, Appendix B).
 */
const RFC3986_BASE = 'http://a/b/c/d;p?q';

describe('parseUri (RFC 3986 §3 / Appendix B)', () => {
  it('parses Appendix B example with undefined query and defined fragment', () => {
    expect(parseUri('http://www.ics.uci.edu/pub/ietf/uri/#Related')).toEqual({
      scheme: 'http',
      authority: 'www.ics.uci.edu',
      path: '/pub/ietf/uri/',
      query: undefined,
      fragment: 'Related',
    });
  });

  it('distinguishes undefined components from empty-string components', () => {
    expect(parseUri('')).toEqual({
      scheme: undefined,
      authority: undefined,
      path: '',
      query: undefined,
      fragment: undefined,
    });

    // Delimiters present with empty component values
    expect(parseUri('file:///path/to/doc.xml?#')).toEqual({
      scheme: 'file',
      authority: '',
      path: '/path/to/doc.xml',
      query: '',
      fragment: '',
    });

    // Empty authority ("//") vs absent authority ("/")
    expect(parseUri('//')).toEqual({
      scheme: undefined,
      authority: '',
      path: '',
      query: undefined,
      fragment: undefined,
    });

    expect(parseUri('/')).toEqual({
      scheme: undefined,
      authority: undefined,
      path: '/',
      query: undefined,
      fragment: undefined,
    });

    expect(recomposeUri(parseUri('file:///path/to/doc.xml?#'))).toBe('file:///path/to/doc.xml?#');
  });

  it('parses non-hierarchical schemes such as untitled:1 and urn:...', () => {
    expect(parseUri('untitled:1')).toEqual({
      scheme: 'untitled',
      authority: undefined,
      path: '1',
      query: undefined,
      fragment: undefined,
    });

    expect(parseUri('urn:oasis:names:tc:entity:xmlns:xml:catalog')).toEqual({
      scheme: 'urn',
      authority: undefined,
      path: 'oasis:names:tc:entity:xmlns:xml:catalog',
      query: undefined,
      fragment: undefined,
    });
  });
});

describe('removeDotSegments (RFC 3986 §5.2.4)', () => {
  it('matches the two step-by-step trace examples in §5.2.4', () => {
    expect(removeDotSegments('/a/b/c/./../../g')).toBe('/a/g');
    expect(removeDotSegments('mid/content=5/../6')).toBe('mid/6');
  });

  it('handles standalone dot segments and trailing segments', () => {
    expect(removeDotSegments('.')).toBe('');
    expect(removeDotSegments('..')).toBe('');
    expect(removeDotSegments('/.')).toBe('/');
    expect(removeDotSegments('/..')).toBe('/');
    expect(removeDotSegments('./../..')).toBe('');
  });
});

describe('resolveReference — RFC 3986 §5.4.1 Normal Examples', () => {
  const normalCases: ReadonlyArray<readonly [string, string]> = [
    ['g:h', 'g:h'],
    ['g', 'http://a/b/c/g'],
    ['./g', 'http://a/b/c/g'],
    ['g/', 'http://a/b/c/g/'],
    ['/g', 'http://a/g'],
    ['//g', 'http://g'],
    ['?y', 'http://a/b/c/d;p?y'],
    ['g?y', 'http://a/b/c/g?y'],
    ['#s', 'http://a/b/c/d;p?q#s'],
    ['g#s', 'http://a/b/c/g#s'],
    ['g?y#s', 'http://a/b/c/g?y#s'],
    [';x', 'http://a/b/c/;x'],
    ['g;x', 'http://a/b/c/g;x'],
    ['g;x?y#s', 'http://a/b/c/g;x?y#s'],
    ['', 'http://a/b/c/d;p?q'],
    ['.', 'http://a/b/c/'],
    ['./', 'http://a/b/c/'],
    ['..', 'http://a/b/'],
    ['../', 'http://a/b/'],
    ['../g', 'http://a/b/g'],
    ['../..', 'http://a/'],
    ['../../', 'http://a/'],
    ['../../g', 'http://a/g'],
  ];

  it.each(normalCases)('resolves %j to %j', (ref, expected) => {
    expect(resolveReference(RFC3986_BASE, ref)).toBe(expected);
  });
});

describe('resolveReference — RFC 3986 §5.4.2 Abnormal Examples', () => {
  const abnormalCases: ReadonlyArray<readonly [string, string]> = [
    ['../../../g', 'http://a/g'],
    ['../../../../g', 'http://a/g'],
    ['/./g', 'http://a/g'],
    ['/../g', 'http://a/g'],
    ['g.', 'http://a/b/c/g.'],
    ['.g', 'http://a/b/c/.g'],
    ['g..', 'http://a/b/c/g..'],
    ['..g', 'http://a/b/c/..g'],
    ['./../g', 'http://a/b/g'],
    ['./g/.', 'http://a/b/c/g/'],
    ['g/./h', 'http://a/b/c/g/h'],
    ['g/../h', 'http://a/b/c/h'],
    ['g;x=1/./y', 'http://a/b/c/g;x=1/y'],
    ['g;x=1/../y', 'http://a/b/c/y'],
    ['g?y/./x', 'http://a/b/c/g?y/./x'],
    ['g?y/../x', 'http://a/b/c/g?y/../x'],
    ['g#s/./x', 'http://a/b/c/g#s/./x'],
    ['g#s/../x', 'http://a/b/c/g#s/../x'],
    ['http:g', 'http:g'],
  ];

  it.each(abnormalCases)('resolves %j to %j (strict mode)', (ref, expected) => {
    expect(resolveReference(RFC3986_BASE, ref)).toBe(expected);
  });

  it('supports non-strict backward-compatible mode for same-scheme "http:g" if requested', () => {
    expect(resolveReference(RFC3986_BASE, 'http:g', { strict: false })).toBe('http://a/b/c/g');
  });
});

describe('resolveReference — XMLens domain & edge cases', () => {
  it('handles non-hierarchical untitled:1 base URIs per RFC 3986 §5.2.2/§5.2.3', () => {
    expect(resolveReference('untitled:1', '')).toBe('untitled:1');
    expect(resolveReference('untitled:1', '#article-1')).toBe('untitled:1#article-1');
    expect(resolveReference('untitled:1', '?mode=strict')).toBe('untitled:1?mode=strict');
    // untitled:1 has no "/" in base.path, so mergePaths excludes "1" per §5.2.3
    expect(resolveReference('untitled:1', 'schema.xsd')).toBe('untitled:schema.xsd');
    expect(resolveReference('untitled:1', '../schema.xsd')).toBe('untitled:schema.xsd');
  });

  it('handles empty reference, fragment-only, and base with defined authority + empty path', () => {
    expect(resolveReference('https://example.com', '')).toBe('https://example.com');
    expect(resolveReference('https://example.com', '#sec')).toBe('https://example.com#sec');
    expect(resolveReference('https://example.com', 'schema.xsd')).toBe(
      'https://example.com/schema.xsd',
    );
    expect(mergePaths(parseUri('https://example.com'), 'schema.xsd')).toBe('/schema.xsd');
  });

  it('handles authority-less bases (e.g. file-less path URIs and URN/opaque-like paths)', () => {
    expect(resolveReference('http:/b/c/d', '../../g')).toBe('http:/g');
    expect(resolveReference('http:/b/c/d', '../../../../g')).toBe('http:/g');
    // When base has neither authority nor leading slash (e.g. untitled:a/b/c),
    // deep "../" climbs past "a" and leaves a leading "/" after segment 2C on "/../g".
    expect(resolveReference('untitled:a/b/c', '../../../g')).toBe('untitled:/g');
    // Authority-present base keeps root "/" and drops excess "../"
    expect(resolveReference('file:///a/b/c.xml', '../../../../../d.xsd')).toBe('file:///d.xsd');
  });

  it('handles deep "../" sequences on hierarchical bases cleanly', () => {
    const deepUp = '../'.repeat(25) + 'schemas/common.xsd';
    expect(resolveReference('https://example.org/a/b/c/d/doc.xml', deepUp)).toBe(
      'https://example.org/schemas/common.xsd',
    );
  });

  it('documents current behavior for percent-encoded vs unencoded Japanese (IRI) paths', () => {
    // Percent-encoded UTF-8 (valid RFC 3986 URI): preserved verbatim
    expect(
      resolveReference(
        'http://example.com/%E6%B3%95%E4%BB%A4/%E6%9D%A1%E4%BE%8B.xml',
        '../%E8%A6%8F%E5%89%87/%E5%AE%9A%E7%BE%A9.xsd',
      ),
    ).toBe('http://example.com/%E8%A6%8F%E5%89%87/%E5%AE%9A%E7%BE%A9.xsd');

    // Unencoded non-ASCII IRI: RFC 3986 Appendix B regex does not reject or percent-encode
    // non-ASCII characters, so they pass through unencoded (unlike DOM `new URL()` / RFC 3987).
    expect(resolveReference('http://example.com/法令/条例.xml', '../規則/定義.xsd')).toBe(
      'http://example.com/規則/定義.xsd',
    );
  });
});
