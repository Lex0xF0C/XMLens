import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWLISTED_PATHS = new Set([
  'plugins/saxonjs/pinned.json',
  'plugins/saxonjs/APPROVED_LICENSE.sha256',
]);

// Split markers so this guard script does not match its own source code.
const VENDOR_COPYRIGHT_REGEX = new RegExp(
  ['copy', 'right', '[^\\n]*', 'saxo', 'nica'].join(''),
  'i',
);
const VENDOR_LICENSE_REGEX = new RegExp(['saxo', 'nica', '\\s+public\\s+license'].join(''), 'i');

const IGNORED_LOCAL_DIRS = new Set(['.git', 'node_modules', 'dist']);

function isDocsPath(filePath) {
  return filePath === 'docs' || filePath.startsWith('docs/');
}

function isDisallowedTrackedDir(filePath) {
  return (
    filePath === 'node_modules' ||
    filePath.startsWith('node_modules/') ||
    filePath.includes('/node_modules/') ||
    filePath === 'dist' ||
    filePath.startsWith('dist/') ||
    filePath.includes('/dist/')
  );
}

/**
 * Pure violation detector for the repository binary/license guard.
 * @param {{
 *   files: readonly string[],
 *   packageJson?: Record<string, unknown>,
 *   fileContents?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
 * }} input
 * @returns {string[]}
 */
export function findViolations({ files, packageJson = {}, fileContents }) {
  const violations = [];

  for (const rawFile of files) {
    const file = rawFile.replace(/\\/g, '/');
    const lower = file.toLowerCase();

    if (isDisallowedTrackedDir(file)) {
      violations.push(`Disallowed tracked build/dependency path: ${file}`);
      continue;
    }

    if (lower.includes('saxon') && !isDocsPath(lower) && !ALLOWLISTED_PATHS.has(file)) {
      violations.push(`Disallowed Saxon-related file path: ${file}`);
    }

    if (lower.includes('xslt3') && !isDocsPath(lower)) {
      violations.push(`Disallowed xslt3-related file path: ${file}`);
    }

    if (!isDocsPath(lower) && fileContents) {
      const content =
        fileContents instanceof Map
          ? (fileContents.get(rawFile) ?? fileContents.get(file))
          : (fileContents[rawFile] ?? fileContents[file]);
      if (
        typeof content === 'string' &&
        (VENDOR_COPYRIGHT_REGEX.test(content) || VENDOR_LICENSE_REGEX.test(content))
      ) {
        violations.push(`Disallowed vendor copyright/license notice outside docs/: ${file}`);
      }
    }
  }

  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = packageJson[section];
    if (!deps || typeof deps !== 'object') {
      continue;
    }
    for (const depName of Object.keys(deps)) {
      if (depName === 'saxon-js' || depName === 'xslt3') {
        violations.push(`Disallowed dependency "${depName}" in package.json (${section})`);
      }
    }
  }

  return violations;
}

function walkLocalFiles(rootDir, currentDir = rootDir, results = []) {
  for (const entry of readdirSync(currentDir)) {
    const fullPath = join(currentDir, entry);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    const topDir = relPath.split('/')[0];
    if (IGNORED_LOCAL_DIRS.has(topDir)) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkLocalFiles(rootDir, fullPath, results);
    } else {
      results.push(relPath);
    }
  }
  return results;
}

function collectFiles(rootDir) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    return stdout.split('\0').filter((entry) => entry.length > 0);
  }
  return walkLocalFiles(rootDir);
}

function readTextFileContents(rootDir, files) {
  const contents = new Map();
  for (const relPath of files) {
    if (isDocsPath(relPath.toLowerCase()) || isDisallowedTrackedDir(relPath)) {
      continue;
    }
    try {
      const fullPath = join(rootDir, relPath);
      const stat = statSync(fullPath);
      if (stat.size > 1024 * 1024) {
        continue;
      }
      const text = readFileSync(fullPath, 'utf8');
      contents.set(relPath, text);
    } catch {
      // Ignore unreadable or non-regular entries.
    }
  }
  return contents;
}

function main() {
  const root = process.cwd();
  const files = collectFiles(root);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const fileContents = readTextFileContents(root, files);
  const violations = findViolations({ files, packageJson: pkg, fileContents });

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(v);
    }
    process.exit(1);
  }

  console.log('Third-party binary guard passed: no disallowed files or dependencies found.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
