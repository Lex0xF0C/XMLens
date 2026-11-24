import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// Known non-OSI / copyleft licenses that are explicitly disallowed per AGENTS.md §4.1.3.
const EXPLICITLY_DISALLOWED_TOKENS = ['GPL', 'AGPL', 'LGPL', 'SSPL', 'MPL-2.0'];

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
  for (const token of EXPLICITLY_DISALLOWED_TOKENS) {
    if (upper === token || upper.startsWith(`${token}-`) || upper.includes(token)) {
      return 'disallowed';
    }
  }

  return 'unverified';
}

function main() {
  const root = process.cwd();
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    console.error('package-lock.json not found. Run npm install first.');
    process.exit(1);
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = lock.packages ?? {};

  const disallowed = [];
  const unverified = [];
  let checkedCount = 0;

  for (const [pkgPath, lockMeta] of Object.entries(packages)) {
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

    checkedCount += 1;
    const status = classifyLicense(licenseExpr);
    const label = `${pkgPath} (${lockMeta.version ?? 'unknown'}): ${licenseExpr ?? 'MISSING'}`;
    if (status === 'disallowed') {
      disallowed.push(label);
    } else if (status === 'unverified') {
      unverified.push(label);
    }
  }

  console.log(`License check inspected ${checkedCount} installed packages.`);

  if (unverified.length > 0) {
    console.warn('Unverified license entries (review required):');
    for (const item of unverified) {
      console.warn(`  - [unverified] ${item}`);
    }
  }

  if (disallowed.length > 0) {
    console.error('Disallowed licenses found:');
    for (const item of disallowed) {
      console.error(`  - ${item}`);
    }
    process.exit(1);
  }

  if (unverified.length > 0) {
    console.log(
      `License check completed with ${unverified.length} unverified package(s) and 0 disallowed packages.`,
    );
  } else {
    console.log('License check passed: all packages use allowed licenses.');
  }
}

main();
