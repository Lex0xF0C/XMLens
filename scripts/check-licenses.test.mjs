import { describe, expect, it } from 'vitest';
import { classifyLicense, evaluatePackages, matchesVersionRange } from './check-licenses.mjs';

describe('classifyLicense', () => {
  it('allows single permissive licenses from the policy allowlist', () => {
    for (const lic of [
      'MIT',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      'Apache-2.0',
      '0BSD',
      'CC0-1.0',
      'Unlicense',
    ]) {
      expect(classifyLicense(lic)).toBe('allowed');
    }
  });

  it('handles OR and AND expressions with parentheses', () => {
    expect(classifyLicense('(MIT OR Apache-2.0)')).toBe('allowed');
    expect(classifyLicense('((ISC AND MIT))')).toBe('allowed');
    expect(classifyLicense('MIT OR GPL-3.0-only')).toBe('allowed');
    expect(classifyLicense('MIT AND GPL-3.0-only')).toBe('disallowed');
    expect(classifyLicense('(MIT AND BlueOak-1.0.0)')).toBe('unverified');
  });

  it('rejects GPL, AGPL, LGPL, SSPL, and MPL-2.0 by default', () => {
    expect(classifyLicense('GPL-3.0')).toBe('disallowed');
    expect(classifyLicense('AGPL-3.0-only')).toBe('disallowed');
    expect(classifyLicense('LGPL-2.1')).toBe('disallowed');
    expect(classifyLicense('SSPL-1.0')).toBe('disallowed');
    expect(classifyLicense('MPL-2.0')).toBe('disallowed');
  });

  it('marks missing or unknown licenses as unverified', () => {
    expect(classifyLicense(null)).toBe('unverified');
    expect(classifyLicense('')).toBe('unverified');
    expect(classifyLicense('BlueOak-1.0.0')).toBe('unverified');
    expect(classifyLicense('SEE LICENSE IN LICENSE.md')).toBe('unverified');
  });
});

describe('matchesVersionRange', () => {
  it('supports exact, wildcard, caret, tilde, and comparator ranges', () => {
    expect(matchesVersionRange('1.1.0', '1.1.0')).toBe(true);
    expect(matchesVersionRange('1.1.0', '*')).toBe(true);
    expect(matchesVersionRange('1.2.3', '^1.1.0')).toBe(true);
    expect(matchesVersionRange('2.0.0', '^1.1.0')).toBe(false);
    expect(matchesVersionRange('1.1.9', '~1.1.0')).toBe(true);
    expect(matchesVersionRange('1.2.0', '~1.1.0')).toBe(false);
    expect(matchesVersionRange('11.0.9', '>=11.0.0 <12.0.0')).toBe(true);
  });
});

describe('evaluatePackages', () => {
  it('fails unverified and MPL-2.0 packages unless listed in reviewed exceptions', () => {
    const pkgs = [
      { path: 'node_modules/a', name: 'a', version: '1.0.0', license: 'MIT' },
      { path: 'node_modules/b', name: 'b', version: '1.1.0', license: 'BlueOak-1.0.0' },
      { path: 'node_modules/c', name: 'c', version: '2.0.0', license: 'MPL-2.0' },
      { path: 'node_modules/d', name: 'd', version: '3.0.0', license: null },
    ];

    const withoutExceptions = evaluatePackages(pkgs, []);
    expect(withoutExceptions.disallowed).toHaveLength(1);
    expect(withoutExceptions.unverified).toHaveLength(2);

    const exceptions = [
      {
        name: 'b',
        versionRange: '^1.0.0',
        license: 'BlueOak-1.0.0',
        reason: 'Reviewed permissive transitive dev dependency',
        'reviewed-by': 'maintainer',
      },
      {
        name: 'c',
        versionRange: '2.0.0',
        license: 'MPL-2.0',
        reason: 'Approved file-level copyleft build tool',
        'reviewed-by': 'maintainer',
      },
    ];

    const withExceptions = evaluatePackages(pkgs, exceptions);
    expect(withExceptions.disallowed).toEqual([]);
    expect(withExceptions.unverified).toHaveLength(1);
    expect(withExceptions.excepted).toHaveLength(2);
  });

  it('never permits GPL-family licenses even if an exception entry exists', () => {
    const result = evaluatePackages(
      [{ path: 'node_modules/g', name: 'g', version: '1.0.0', license: 'GPL-3.0-only' }],
      [
        {
          name: 'g',
          versionRange: '*',
          license: 'GPL-3.0-only',
          reason: 'Should not bypass hard disallow',
          'reviewed-by': 'maintainer',
        },
      ],
    );
    expect(result.disallowed).toHaveLength(1);
  });
});
