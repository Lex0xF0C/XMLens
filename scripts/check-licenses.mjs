import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
]);

// Licenses that are unconditionally disallowed unless explicitly handled otherwise.
const HARD_DISALLOWED_TOKENS = ['GPL', 'AGPL', 'LGPL', 'SSPL'];

function normalizeLicenseField(pkg) {
  if (typeof pkg.license === 'string') {
    return pkg.license.trim();
  }
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type.trim();
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

function stripOuterParens(expr) {
  let s = expr.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') depth -= 1;
      if (depth === 0 && i < s.length - 1) {
        wrapsWhole = false;
        break;
      }
    }
    if (!wrapsWhole) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function splitTopLevel(expr, operator) {
  const parts = [];
  let depth = 0;
  let lastIdx = 0;
  const token = ` ${operator} `;
  for (let i = 0; i < expr.length; i += 1) {
    if (expr[i] === '(') depth += 1;
    else if (expr[i] === ')') depth -= 1;
    else if (depth === 0 && expr.slice(i, i + token.length) === token) {
      parts.push(expr.slice(lastIdx, i).trim());
      lastIdx = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(expr.slice(lastIdx).trim());
  return parts;
}

/**
 * Classifies an SPDX license expression into 'allowed', 'disallowed', or 'unverified'.
 * MPL-2.0 is rejected ('disallowed') by default unless granted a reviewed maintainer exception.
 */
export function classifyLicense(rawExpr) {
  if (!rawExpr || typeof rawExpr !== 'string') {
    return 'unverified';
  }
  const expr = stripOuterParens(rawExpr);
  if (!expr) {
    return 'unverified';
  }

  const orParts = splitTopLevel(expr, 'OR');
  if (orParts.length > 1) {
    const results = orParts.map((part) => classifyLicense(part));
    if (results.includes('allowed')) return 'allowed';
    if (results.includes('unverified')) return 'unverified';
    return 'disallowed';
  }

  const andParts = splitTopLevel(expr, 'AND');
  if (andParts.length > 1) {
    const results = andParts.map((part) => classifyLicense(part));
    if (results.includes('disallowed')) return 'disallowed';
    if (results.includes('unverified')) return 'unverified';
    return 'allowed';
  }

  if (ALLOWED_LICENSES.has(expr)) {
    return 'allowed';
  }

  const upper = expr.toUpperCase();
  if (upper === 'MPL-2.0') {
    return 'disallowed';
  }

  for (const token of HARD_DISALLOWED_TOKENS) {
    if (upper === token || upper.startsWith(`${token}-`) || upper.includes(token)) {
      return 'disallowed';
    }
  }

  return 'unverified';
}

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Checks whether a concrete package version matches an exception version range.
 * Supports '*', exact versions, '^x.y.z', '~x.y.z', and simple comparator ranges (>=, <=, >, <).
 */
export function matchesVersionRange(version, range) {
  if (!range || typeof range !== 'string') return false;
  const trimmed = range.trim();
  if (trimmed === '*') return true;
  if (trimmed === version) return true;

  const v = parseSemver(version);
  if (!v) return false;

  if (trimmed.startsWith('^')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    if (compareSemver(v, base) < 0) return false;
    if (base[0] > 0) return v[0] === base[0];
    if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
    return v[0] === 0 && v[1] === 0 && v[2] === base[2];
  }

  if (trimmed.startsWith('~')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    return compareSemver(v, base) >= 0 && v[0] === base[0] && v[1] === base[1];
  }

  const clauses = trimmed.split(/\s+/);
  for (const clause of clauses) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(clause);
    if (!m) return false;
    const op = m[1] ?? '=';
    const target = parseSemver(m[2]);
    if (!target) return false;
    const cmp = compareSemver(v, target);
    if (op === '=' && cmp !== 0) return false;
    if (op === '>=' && cmp < 0) return false;
    if (op === '<=' && cmp > 0) return false;
    if (op === '>' && cmp <= 0) return false;
    if (op === '<' && cmp >= 0) return false;
  }
  return true;
}

function extractPackageName(pkgPath) {
  const idx = pkgPath.lastIndexOf('node_modules/');
  if (idx === -1) return pkgPath;
  return pkgPath.slice(idx + 'node_modules/'.length);
}

function isHardDisallowed(licenseExpr) {
  if (!licenseExpr) return false;
  const upper = licenseExpr.toUpperCase();
  return HARD_DISALLOWED_TOKENS.some(
    (token) => upper === token || upper.startsWith(`${token}-`) || upper.includes(token),
  );
}

function findMatchingException(pkgName, version, licenseExpr, exceptions) {
  if (!Array.isArray(exceptions) || isHardDisallowed(licenseExpr)) {
    return null;
  }
  for (const entry of exceptions) {
    if (!entry || typeof entry !== 'object') continue;
    const reviewedBy = entry['reviewed-by'] ?? entry.reviewedBy;
    const versionRange = entry.versionRange ?? entry.version;
    if (
      entry.name === pkgName &&
      entry.license === licenseExpr &&
      typeof entry.reason === 'string' &&
      entry.reason.trim().length > 0 &&
      typeof reviewedBy === 'string' &&
      reviewedBy.trim().length > 0 &&
      matchesVersionRange(version, versionRange)
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * Evaluates a list of installed packages against the license policy and reviewed exceptions.
 */
export function evaluatePackages(packages, exceptions = []) {
  const disallowed = [];
  const unverified = [];
  const excepted = [];

  for (const pkg of packages) {
    const status = classifyLicense(pkg.license);
    const label = `${pkg.path} (${pkg.version}): ${pkg.license ?? 'MISSING'}`;
    if (status === 'allowed') {
      continue;
    }

    const exception = findMatchingException(pkg.name, pkg.version, pkg.license, exceptions);
    if (exception) {
      excepted.push(label);
      continue;
    }

    if (status === 'disallowed') {
      disallowed.push(label);
    } else {
      unverified.push(label);
    }
  }

  return { disallowed, unverified, excepted };
}

export function loadLicenseExceptions(rootDir) {
  const exceptionsPath = join(rootDir, 'scripts', 'license-exceptions.json');
  if (!existsSync(exceptionsPath)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(exceptionsPath, 'utf8'));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.exceptions)) {
    return parsed.exceptions;
  }
  throw new Error(
    'scripts/license-exceptions.json must contain a JSON array or { exceptions: [] }.',
  );
}

function main() {
  const root = process.cwd();
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    console.error('package-lock.json not found. Run npm install first.');
    process.exit(1);
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const lockPackages = lock.packages ?? {};
  const exceptions = loadLicenseExceptions(root);
  const packagesToCheck = [];

  for (const [pkgPath, lockMeta] of Object.entries(lockPackages)) {
    if (!pkgPath || !pkgPath.startsWith('node_modules/') || lockMeta.link) {
      continue;
    }

    let licenseExpr = normalizeLicenseField(lockMeta);
    const pkgJsonPath = join(root, pkgPath, 'package.json');
    if (!licenseExpr && existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        licenseExpr = normalizeLicenseField(pkgJson);
      } catch {
        // Keep null if package.json cannot be parsed.
      }
    }

    packagesToCheck.push({
      path: pkgPath,
      name: extractPackageName(pkgPath),
      version: lockMeta.version ?? 'unknown',
      license: licenseExpr,
    });
  }

  const { disallowed, unverified, excepted } = evaluatePackages(packagesToCheck, exceptions);

  console.log(`License check inspected ${packagesToCheck.length} installed packages.`);
  if (excepted.length > 0) {
    console.log(`Approved exceptions applied: ${excepted.length}`);
  }

  if (unverified.length > 0) {
    console.error('Unverified license entries found (maintainer review or exception required):');
    for (const item of unverified) {
      console.error(`  - [unverified] ${item}`);
    }
  }

  if (disallowed.length > 0) {
    console.error('Disallowed licenses found:');
    for (const item of disallowed) {
      console.error(`  - ${item}`);
    }
  }

  if (disallowed.length > 0 || unverified.length > 0) {
    process.exit(1);
  }

  console.log('License check passed: all packages use allowed or approved-exception licenses.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
