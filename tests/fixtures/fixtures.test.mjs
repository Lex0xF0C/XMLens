import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWellFormedness } from '../../packages/core/src/index';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

function loadFixture(filename) {
  return readFileSync(resolve(FIXTURES_DIR, filename), 'utf8');
}

describe('XML fixture suite', () => {
  it('passes well-formedness on valid-akn-cjk.xml', () => {
    const result = checkWellFormedness(loadFixture('valid-akn-cjk.xml'));
    expect(result.wellFormed).toBe(true);
    expect(result.rootElement).toBe('akomaNtoso');
    expect(result.diagnostics).toEqual([]);
  });

  it('passes well-formedness on valid-utf8-bom.xml', () => {
    const xml = loadFixture('valid-utf8-bom.xml');
    expect(xml.charCodeAt(0)).toBe(0xfeff);
    const result = checkWellFormedness(xml);
    expect(result.wellFormed).toBe(true);
    expect(result.rootElement).toBe('document');
    expect(result.diagnostics).toEqual([]);
  });

  it('warns without failing on dtd-internal-entity.xml', () => {
    const result = checkWellFormedness(loadFixture('dtd-internal-entity.xml'));
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('XML_DTD_ENTITY_EXPANSION_DISABLED');
  });

  it('warns without failing on dtd-external-entity.xml per XML 1.0 §4.1', () => {
    const result = checkWellFormedness(loadFixture('dtd-external-entity.xml'));
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'XML_UNDECLARED_EXTERNAL_ENTITY',
      'XML_EXTERNAL_DTD_IGNORED',
    ]);
    expect(result.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('stays fast and safe on security-billion-laughs.xml', () => {
    const t0 = performance.now();
    const result = checkWellFormedness(loadFixture('security-billion-laughs.xml'));
    const elapsedMs = performance.now() - t0;
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics[0]?.code).toBe('XML_DTD_ENTITY_EXPANSION_DISABLED');
    expect(elapsedMs).toBeLessThan(200);
  });

  it('notes encoding declaration mismatch on encoding-iso8859-1.xml', () => {
    const result = checkWellFormedness(loadFixture('encoding-iso8859-1.xml'));
    expect(result.wellFormed).toBe(true);
    expect(result.diagnostics[0]?.code).toBe('XML_ENCODING_DECLARATION_NOTE');
  });

  it('reports structured errors for all malformed fixtures', () => {
    const cases = [
      ['invalid-duplicate-attr.xml', 'XML_DUPLICATE_ATTRIBUTE'],
      ['invalid-mismatched-tag.xml', 'XML_UNMATCHED_CLOSING_TAG'],
      ['invalid-unclosed-tag.xml', 'XML_UNCLOSED_TAG'],
      ['invalid-unbound-namespace.xml', 'XML_UNBOUND_NAMESPACE_PREFIX'],
      ['invalid-multiple-roots.xml', 'XML_MULTIPLE_ROOTS'],
      ['invalid-undefined-entity.xml', 'XML_UNDEFINED_ENTITY'],
      ['invalid-astral-position.xml', 'XML_UNEXPECTED_CLOSE_TAG'],
    ];

    for (const [file, expectedCode] of cases) {
      const result = checkWellFormedness(loadFixture(file));
      expect(result.wellFormed, file).toBe(false);
      expect(
        result.diagnostics.some((diag) => diag.code === expectedCode),
        `${file} should emit ${expectedCode}`,
      ).toBe(true);
    }
  });
});
