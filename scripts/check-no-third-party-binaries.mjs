import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const allowlistedPaths = new Set([
  'plugins/saxonjs/pinned.json',
  'plugins/saxonjs/APPROVED_LICENSE.sha256',
]);

const ignoredTopDirs = new Set(['.git', 'node_modules', 'dist']);

function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relPath = relative(root, fullPath).replace(/\\/g, '/');
    const topDir = relPath.split('/')[0];
    if (ignoredTopDirs.has(topDir)) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, results);
    } else {
      results.push(relPath);
    }
  }
  return results;
}

const files = walk(root);
const violations = [];

for (const file of files) {
  const lower = file.toLowerCase();
  if (lower.includes('saxon') && !lower.startsWith('docs/') && !allowlistedPaths.has(file)) {
    violations.push(`Disallowed Saxon-related file path: ${file}`);
  }
  if (lower.includes('xslt3') && !lower.startsWith('docs/')) {
    violations.push(`Disallowed xslt3-related file path: ${file}`);
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const deps = pkg[section] ?? {};
  for (const depName of Object.keys(deps)) {
    if (depName === 'saxon-js' || depName === 'xslt3') {
      violations.push(`Disallowed dependency "${depName}" in package.json (${section})`);
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
}

console.log('Third-party binary guard passed: no disallowed files or dependencies found.');
