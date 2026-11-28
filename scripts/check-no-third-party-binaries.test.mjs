import { describe, expect, it } from 'vitest';
import { findViolations } from './check-no-third-party-binaries.mjs';

describe('findViolations', () => {
  it('passes on a clean repository', () => {
    const violations = findViolations({
      files: ['package.json', 'packages/core/src/index.ts', 'locales/en.json'],
      packageJson: {
        dependencies: {},
        devDependencies: { vite: '^7.3.8' },
      },
      workspacePackageJsons: {
        'packages/core/package.json': {
          dependencies: { saxes: '6.0.0' },
        },
      },
      packageLockJson: {
        packages: {
          '': { name: 'xmlens', dependencies: {} },
          'node_modules/saxes': { version: '6.0.0' },
        },
      },
      fileContents: {
        'packages/core/src/index.ts': 'export const ok = true;',
      },
    });
    expect(violations).toEqual([]);
  });

  it('flags Saxon-related file paths outside docs and allowlist', () => {
    const violations = findViolations({
      files: ['public/saxon-test.js', 'packages/app/SaxonJS2.rt.js'],
    });
    expect(violations).toHaveLength(2);
  });

  it('allows allowlisted plugin metadata paths and docs/', () => {
    const vendorNotice = ['Copyright (c) 2020 ', 'Saxo', 'nica Limited'].join('');
    const violations = findViolations({
      files: [
        'plugins/saxonjs/pinned.json',
        'plugins/saxonjs/APPROVED_LICENSE.sha256',
        'docs/adr/0002-optional-saxonjs-plugin.md',
      ],
      fileContents: {
        'docs/adr/0002-optional-saxonjs-plugin.md': vendorNotice,
      },
    });
    expect(violations).toEqual([]);
  });

  it('flags xslt3 file paths outside docs/', () => {
    const violations = findViolations({
      files: ['scripts/xslt3-runner.js', 'docs/xslt3-notes.md'],
    });
    expect(violations).toEqual(['Disallowed xslt3-related file path: scripts/xslt3-runner.js']);
  });

  it('flags saxon-js and xslt3 across all dependency sections of root and workspace package.json', () => {
    const violations = findViolations({
      files: ['package.json', 'packages/core/package.json', 'packages/app/package.json'],
      packageJson: {
        dependencies: { 'saxon-js': '2.6.0' },
        peerDependencies: { xslt3: '2.6.0' },
      },
      workspacePackageJsons: {
        'packages/core/package.json': {
          devDependencies: { 'saxon-js': '2.6.0' },
        },
        'packages/app/package.json': {
          optionalDependencies: { xslt3: '2.6.0' },
          peerDependencies: { 'saxon-js': '2.6.0' },
        },
      },
    });
    expect(violations).toHaveLength(5);
    expect(violations.some((v) => v.includes('packages/core/package.json (devDependencies)'))).toBe(
      true,
    );
    expect(violations.some((v) => v.includes('packages/app/package.json (peerDependencies)'))).toBe(
      true,
    );
  });

  it('flags top-level, nested, and dependency-referenced saxon-js/xslt3 entries in package-lock.json', () => {
    const violations = findViolations({
      files: ['package-lock.json'],
      packageLockJson: {
        packages: {
          '': {
            dependencies: { 'saxon-js': '^2.6.0' },
          },
          'node_modules/saxon-js': {
            version: '2.6.0',
          },
          'node_modules/some-wrapper/node_modules/xslt3': {
            version: '2.6.0',
          },
          'node_modules/other': {
            peerDependencies: { xslt3: '^2.6.0' },
          },
        },
      },
    });
    expect(violations).toHaveLength(4);
    expect(violations.some((v) => v.includes('node_modules/saxon-js'))).toBe(true);
    expect(violations.some((v) => v.includes('node_modules/some-wrapper/node_modules/xslt3'))).toBe(
      true,
    );
  });

  it('flags tracked node_modules/ and dist/ paths', () => {
    const violations = findViolations({
      files: ['node_modules/foo/index.js', 'dist/assets/main.js'],
    });
    expect(violations).toHaveLength(2);
  });

  it('flags vendor copyright or license text in non-doc files', () => {
    const vendorCopyright = ['Copyright (c) 2020 ', 'Saxo', 'nica Limited'].join('');
    const violations = findViolations({
      files: ['packages/app/src/notice.txt'],
      fileContents: {
        'packages/app/src/notice.txt': vendorCopyright,
      },
    });
    expect(violations).toHaveLength(1);
  });
});
