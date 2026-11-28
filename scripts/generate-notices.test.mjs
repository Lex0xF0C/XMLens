import { describe, expect, it } from 'vitest';
import {
  collectProductionPackages,
  renderThirdPartyNotices,
  resolveLockPackagePath,
} from './generate-notices.mjs';

describe('generate-notices', () => {
  it('collects only runtime dependencies reachable from workspaces and excludes devDependencies', () => {
    const lock = {
      packages: {
        '': {
          devDependencies: {
            eslint: '^10.0.0',
          },
        },
        'packages/core': {
          dependencies: {
            saxes: '^6.0.0',
          },
        },
        'packages/app': {
          dependencies: {
            '@xmlens/core': '*',
          },
        },
        'node_modules/@xmlens/core': {
          resolved: 'packages/core',
          link: true,
        },
        'node_modules/saxes': {
          version: '6.0.0',
          license: 'ISC',
          dependencies: {
            xmlchars: '^2.2.0',
          },
        },
        'node_modules/xmlchars': {
          version: '2.2.0',
          license: 'MIT',
        },
        'node_modules/eslint': {
          version: '10.0.0',
          license: 'MIT',
          dev: true,
        },
      },
    };

    const metaMap = {
      'node_modules/saxes': {
        name: 'saxes',
        version: '6.0.0',
        license: 'ISC',
        author: 'Louis-Dominique Dubeau',
        repository: 'https://github.com/lddubeau/saxes.git',
        licenseFileName: null,
        licenseText: null,
      },
      'node_modules/xmlchars': {
        name: 'xmlchars',
        version: '2.2.0',
        license: 'MIT',
        author: 'Louis-Dominique Dubeau',
        repository: 'https://github.com/lddubeau/xmlchars.git',
        licenseFileName: 'LICENSE',
        licenseText: 'Copyright xmlchars',
      },
    };

    const collected = collectProductionPackages(lock, (pkgPath) => metaMap[pkgPath]);
    expect(collected.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
      'saxes@6.0.0',
      'xmlchars@2.2.0',
    ]);
  });

  it('resolves nested node_modules dependencies upward correctly', () => {
    const lockPackages = {
      'node_modules/parent': { version: '1.0.0' },
      'node_modules/parent/node_modules/nested': { version: '2.0.0' },
      'node_modules/shared': { version: '3.0.0' },
    };

    expect(resolveLockPackagePath(lockPackages, 'node_modules/parent', 'nested')).toBe(
      'node_modules/parent/node_modules/nested',
    );
    expect(resolveLockPackagePath(lockPackages, 'node_modules/parent', 'shared')).toBe(
      'node_modules/shared',
    );
    expect(resolveLockPackagePath(lockPackages, 'node_modules/parent', 'missing')).toBeNull();
  });

  it('renders factual license text or explicit missing-LICENSE note without inventing text', () => {
    const markdown = renderThirdPartyNotices([
      {
        name: 'saxes',
        version: '6.0.0',
        license: 'ISC',
        author: 'Louis-Dominique Dubeau <ldd@lddubeau.com>',
        repository: 'https://github.com/lddubeau/saxes.git',
        licenseFileName: null,
        licenseText: null,
      },
      {
        name: 'xmlchars',
        version: '2.2.0',
        license: 'MIT',
        author: 'Louis-Dominique Dubeau <ldd@lddubeau.com>',
        repository: 'https://github.com/lddubeau/xmlchars.git',
        licenseFileName: 'LICENSE',
        licenseText: 'MIT License Text',
      },
    ]);

    expect(markdown).toContain('# Third-Party Notices');
    expect(markdown).toContain('## saxes@6.0.0');
    expect(markdown).toContain('No `LICENSE` or `COPYING` file is distributed inside');
    expect(markdown).toContain('## xmlchars@2.2.0');
    expect(markdown).toContain('```text\nMIT License Text\n```');
  });
});
