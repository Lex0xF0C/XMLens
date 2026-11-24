import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LICENSE_FILE_CANDIDATES = [
  'license',
  'license.md',
  'license.txt',
  'licence',
  'licence.md',
  'licence.txt',
  'copying',
  'copying.txt',
];

function normalizeLicenseField(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return null;
  }
  if (typeof pkg.license === 'string' && pkg.license.trim()) {
    return pkg.license.trim();
  }
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type.trim() || null;
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((entry) => (entry && typeof entry.type === 'string' ? entry.type.trim() : ''))
      .filter(Boolean);
    if (types.length > 0) {
      return types.join(' OR ');
    }
  }
  return null;
}

function normalizeAuthorField(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return null;
  }
  if (typeof pkg.author === 'string' && pkg.author.trim()) {
    return pkg.author.trim();
  }
  if (pkg.author && typeof pkg.author === 'object' && typeof pkg.author.name === 'string') {
    const name = pkg.author.name.trim();
    const email = typeof pkg.author.email === 'string' ? pkg.author.email.trim() : '';
    if (name && email) {
      return `${name} <${email}>`;
    }
    return name || null;
  }
  return null;
}

function normalizeRepositoryField(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return null;
  }
  if (typeof pkg.repository === 'string' && pkg.repository.trim()) {
    return pkg.repository.trim();
  }
  if (
    pkg.repository &&
    typeof pkg.repository === 'object' &&
    typeof pkg.repository.url === 'string'
  ) {
    return pkg.repository.url.trim() || null;
  }
  if (typeof pkg.homepage === 'string' && pkg.homepage.trim()) {
    return pkg.homepage.trim();
  }
  return null;
}

export function extractPackageName(pkgPath) {
  const idx = pkgPath.lastIndexOf('node_modules/');
  if (idx === -1) {
    return pkgPath;
  }
  return pkgPath.slice(idx + 'node_modules/'.length);
}

/**
 * Resolves a dependency name from `fromPath` inside a npm v2/v3 lockfile `packages` map.
 */
export function resolveLockPackagePath(lockPackages, fromPath, depName) {
  let cursor = fromPath;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${depName}` : `node_modules/${depName}`;
    if (Object.hasOwn(lockPackages, candidate)) {
      const entry = lockPackages[candidate];
      if (entry && entry.link === true && typeof entry.resolved === 'string') {
        return entry.resolved;
      }
      return candidate;
    }
    if (!cursor) {
      return null;
    }
    const lastModulesIdx = cursor.lastIndexOf('/node_modules/');
    if (lastModulesIdx >= 0) {
      cursor = cursor.slice(0, lastModulesIdx);
    } else if (cursor.startsWith('node_modules/')) {
      cursor = '';
    } else {
      cursor = '';
    }
  }
}

function readPackageMetadataFromDisk(rootDir, pkgPath, lockMeta) {
  const fullDir = join(rootDir, pkgPath);
  const pkgJsonPath = join(fullDir, 'package.json');
  let pkgJson = null;
  if (existsSync(pkgJsonPath)) {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  }

  let licenseFileName = null;
  let licenseText = null;
  if (existsSync(fullDir)) {
    const entries = readdirSync(fullDir);
    const byLower = new Map(entries.map((name) => [name.toLowerCase(), name]));
    for (const candidate of LICENSE_FILE_CANDIDATES) {
      const matched = byLower.get(candidate);
      if (matched) {
        licenseFileName = matched;
        licenseText = readFileSync(join(fullDir, matched), 'utf8').replace(/\r\n/g, '\n').trim();
        break;
      }
    }
  }

  const name =
    (pkgJson && typeof pkgJson.name === 'string' && pkgJson.name) || extractPackageName(pkgPath);
  const version =
    (pkgJson && typeof pkgJson.version === 'string' && pkgJson.version) ||
    (lockMeta && typeof lockMeta.version === 'string' && lockMeta.version) ||
    'unknown';

  return {
    name,
    version,
    license: normalizeLicenseField(pkgJson) ?? normalizeLicenseField(lockMeta) ?? 'UNVERIFIED',
    author: normalizeAuthorField(pkgJson),
    repository: normalizeRepositoryField(pkgJson),
    licenseFileName,
    licenseText,
  };
}

/**
 * Traverses runtime (`dependencies` / `optionalDependencies`) packages reachable from root and workspaces.
 */
export function collectProductionPackages(lock, getMetadata) {
  const lockPackages = lock.packages ?? {};
  const queue = [];
  const visitedPaths = new Set();
  const collectedById = new Map();

  if (Object.hasOwn(lockPackages, '')) {
    queue.push('');
  }
  for (const [pkgPath, meta] of Object.entries(lockPackages)) {
    if (
      pkgPath &&
      pkgPath.startsWith('packages/') &&
      !pkgPath.includes('node_modules/') &&
      meta &&
      meta.link !== true
    ) {
      queue.push(pkgPath);
    }
  }

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (visitedPaths.has(currentPath)) {
      continue;
    }
    visitedPaths.add(currentPath);

    const entry = lockPackages[currentPath];
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    if (currentPath.startsWith('node_modules/') && entry.link !== true) {
      const metadata = getMetadata(currentPath, entry);
      const id = `${metadata.name}@${metadata.version}`;
      if (!collectedById.has(id)) {
        collectedById.set(id, metadata);
      }
    }

    const runtimeDeps = {
      ...(entry.dependencies ?? {}),
      ...(entry.optionalDependencies ?? {}),
    };

    for (const depName of Object.keys(runtimeDeps)) {
      const resolvedPath = resolveLockPackagePath(lockPackages, currentPath, depName);
      if (resolvedPath && !visitedPaths.has(resolvedPath)) {
        queue.push(resolvedPath);
      }
    }
  }

  return Array.from(collectedById.values()).sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    if (a.version !== b.version) {
      return a.version < b.version ? -1 : 1;
    }
    return 0;
  });
}

function formatMarkdownTable(headers, rows) {
  const widths = headers.map((header, colIdx) =>
    Math.max(header.length, ...rows.map((row) => row[colIdx].length)),
  );
  const formatRow = (cells) =>
    `| ${cells.map((cell, idx) => cell.padEnd(widths[idx], ' ')).join(' | ')} |`;
  const separator = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [formatRow(headers), separator, ...rows.map(formatRow)].join('\n');
}

/**
 * Renders deterministic, Prettier-aligned Markdown notices for bundled runtime packages.
 */
export function renderThirdPartyNotices(entries) {
  const lines = [
    '# Third-Party Notices',
    '',
    'This file lists third-party open-source runtime dependencies bundled into XMLens, generated from `package-lock.json` and installed package metadata (`npm run notices:generate`).',
    '',
  ];

  if (entries.length === 0) {
    lines.push('No third-party runtime dependencies are currently bundled.', '');
    return lines.join('\n');
  }

  const tableRows = entries.map((entry) => [
    `\`${entry.name}\``,
    `\`${entry.version}\``,
    `\`${entry.license}\``,
    entry.repository ?? '—',
  ]);
  lines.push(formatMarkdownTable(['Package', 'Version', 'License', 'Source'], tableRows), '');

  for (const entry of entries) {
    lines.push(`## ${entry.name}@${entry.version}`, '');
    lines.push(`- **License:** \`${entry.license}\``);
    if (entry.author) {
      lines.push(`- **Author:** ${entry.author}`);
    }
    if (entry.repository) {
      lines.push(`- **Source:** ${entry.repository}`);
    }
    lines.push('');

    if (entry.licenseText) {
      lines.push(
        `License text (\`${entry.licenseFileName}\`):`,
        '',
        '```text',
        entry.licenseText,
        '```',
        '',
      );
    } else {
      lines.push(
        `No \`LICENSE\` or \`COPYING\` file is distributed inside the \`${entry.name}@${entry.version}\` npm package; license metadata above is taken from its \`package.json\`.`,
        '',
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function generateNoticesContent(rootDir) {
  const lockPath = join(rootDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    throw new Error('package-lock.json not found. Run npm install first.');
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const entries = collectProductionPackages(lock, (pkgPath, meta) =>
    readPackageMetadataFromDisk(rootDir, pkgPath, meta),
  );
  return {
    entries,
    markdown: renderThirdPartyNotices(entries),
  };
}

function main() {
  const rootDir = process.cwd();
  const checkOnly = process.argv.includes('--check');
  const targets = [
    join(rootDir, 'THIRD_PARTY_NOTICES.md'),
    join(rootDir, 'packages', 'app', 'public', 'THIRD_PARTY_NOTICES.md'),
  ];

  const { entries, markdown } = generateNoticesContent(rootDir);

  if (checkOnly) {
    const mismatches = [];
    for (const target of targets) {
      if (!existsSync(target)) {
        mismatches.push(`${target} (missing)`);
        continue;
      }
      const existing = readFileSync(target, 'utf8');
      if (existing !== markdown) {
        mismatches.push(`${target} (out of date)`);
      }
    }

    if (mismatches.length > 0) {
      console.error('Third-party notices check failed. Run `npm run notices:generate`:');
      for (const item of mismatches) {
        console.error(`  - ${item}`);
      }
      process.exit(1);
    }

    console.log(
      `Third-party notices check passed: ${entries.length} runtime package(s) match committed notices.`,
    );
    return;
  }

  for (const target of targets) {
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, markdown, 'utf8');
  }
  console.log(`Generated THIRD_PARTY_NOTICES.md for ${entries.length} runtime package(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
