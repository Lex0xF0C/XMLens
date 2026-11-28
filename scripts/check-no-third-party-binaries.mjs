import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const DISALLOWED_DEP_NAMES = new Set(['saxon-js', 'xslt3']);
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const DISALLOWED_LOCK_PATH_REGEX = /(?:^|\/)node_modules\/(saxon-js|xslt3)(?:$|\/)/;
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

function scanPackageManifest(pkgPath, manifest, violations) {
  if (!manifest || typeof manifest !== 'object') {
    return;
  }
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = manifest[section];
    if (!deps || typeof deps !== 'object') {
      continue;
    }
    for (const depName of Object.keys(deps)) {
      if (DISALLOWED_DEP_NAMES.has(depName)) {
        violations.push(`Disallowed dependency "${depName}" in ${pkgPath} (${section})`);
      }
    }
  }
}

function scanLegacyLockDependencies(deps, lockPathLabel, violations) {
  if (!deps || typeof deps !== 'object') {
    return;
  }
  for (const [depName, meta] of Object.entries(deps)) {
    if (DISALLOWED_DEP_NAMES.has(depName)) {
      violations.push(`Disallowed dependency "${depName}" in ${lockPathLabel}`);
    }
    if (meta && typeof meta === 'object') {
      scanLegacyLockDependencies(meta.dependencies, `${lockPathLabel}.${depName}`, violations);
      if (meta.requires && typeof meta.requires === 'object') {
        for (const reqName of Object.keys(meta.requires)) {
          if (DISALLOWED_DEP_NAMES.has(reqName)) {
            violations.push(
              `Disallowed dependency reference "${reqName}" in ${lockPathLabel}.${depName}.requires`,
            );
          }
        }
      }
    }
  }
}

function scanPackageLock(packageLockJson, violations) {
  if (!packageLockJson || typeof packageLockJson !== 'object') {
    return;
  }

  const packages = packageLockJson.packages;
  if (packages && typeof packages === 'object') {
    for (const [entryPath, entryMeta] of Object.entries(packages)) {
      const normalized = entryPath.replace(/\\/g, '/');
      if (DISALLOWED_LOCK_PATH_REGEX.test(normalized)) {
        violations.push(`Disallowed lockfile package entry "${normalized}" in package-lock.json`);
      }
      if (!entryMeta || typeof entryMeta !== 'object') {
        continue;
      }
      if (typeof entryMeta.name === 'string' && DISALLOWED_DEP_NAMES.has(entryMeta.name)) {
        violations.push(
          `Disallowed package name "${entryMeta.name}" at "${normalized || '(root)'}" in package-lock.json`,
        );
      }
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = entryMeta[section];
        if (!deps || typeof deps !== 'object') {
          continue;
        }
        for (const depName of Object.keys(deps)) {
          if (DISALLOWED_DEP_NAMES.has(depName)) {
            violations.push(
              `Disallowed dependency reference "${depName}" at "${normalized || '(root)'}" (${section}) in package-lock.json`,
            );
          }
        }
      }
    }
  }

  scanLegacyLockDependencies(
    packageLockJson.dependencies,
    'package-lock.json (dependencies)',
    violations,
  );
}

/**
 * Pure violation detector for the repository binary/license guard.
 * @param {{
 *   files: readonly string[],
 *   packageJson?: Record<string, unknown>,
 *   workspacePackageJsons?: ReadonlyMap<string, Record<string, unknown>> | Readonly<Record<string, Record<string, unknown>>>,
 *   packageLockJson?: Record<string, unknown>,
 *   fileContents?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
 * }} input
 * @returns {string[]}
 */
export function findViolations({
  files,
  packageJson = {},
  workspacePackageJsons,
  packageLockJson,
  fileContents,
}) {
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

  scanPackageManifest('package.json', packageJson, violations);

  if (workspacePackageJsons) {
    const entries =
      workspacePackageJsons instanceof Map
        ? workspacePackageJsons.entries()
        : Object.entries(workspacePackageJsons);
    for (const [manifestPath, manifest] of entries) {
      scanPackageManifest(manifestPath.replace(/\\/g, '/'), manifest, violations);
    }
  }

  scanPackageLock(packageLockJson, violations);

  return violations;
}

function walkLocalFiles(rootDir, currentDir = rootDir, results = []) {
  for (const entry of readdirSync(currentDir)) {
    if (IGNORED_LOCAL_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(currentDir, entry);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
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

function readWorkspacePackageJsons(rootDir) {
  const manifests = new Map();
  const packagesDir = join(rootDir, 'packages');
  if (!existsSync(packagesDir)) {
    return manifests;
  }
  for (const entry of readdirSync(packagesDir)) {
    const pkgFile = join(packagesDir, entry, 'package.json');
    if (existsSync(pkgFile)) {
      const rel = `packages/${entry}/package.json`;
      manifests.set(rel, JSON.parse(readFileSync(pkgFile, 'utf8')));
    }
  }
  return manifests;
}

function readPackageLockJson(rootDir) {
  const lockPath = join(rootDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(lockPath, 'utf8'));
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
  const workspacePackageJsons = readWorkspacePackageJsons(root);
  const packageLockJson = readPackageLockJson(root);
  const fileContents = readTextFileContents(root, files);
  const violations = findViolations({
    files,
    packageJson: pkg,
    workspacePackageJsons,
    packageLockJson,
    fileContents,
  });

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
