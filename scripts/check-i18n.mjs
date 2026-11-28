import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function extractPlaceholders(value) {
  const placeholders = new Set();
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  for (const match of value.matchAll(regex)) {
    if (match[1]) {
      placeholders.add(match[1]);
    }
  }
  return [...placeholders].sort();
}

const root = process.cwd();
const enPath = resolve(root, 'locales/en.json');
const jaPath = resolve(root, 'locales/ja.json');

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const ja = JSON.parse(readFileSync(jaPath, 'utf8'));

const enKeys = Object.keys(en).sort();
const jaKeys = Object.keys(ja).sort();

const missingInJa = enKeys.filter((k) => !(k in ja));
const extraInJa = jaKeys.filter((k) => !(k in en));

const emptyInEn = enKeys.filter((k) => typeof en[k] !== 'string' || en[k].trim().length === 0);
const emptyInJa = jaKeys.filter((k) => typeof ja[k] !== 'string' || ja[k].trim().length === 0);

const placeholderMismatches = [];
for (const key of enKeys) {
  if (!(key in ja) || typeof en[key] !== 'string' || typeof ja[key] !== 'string') {
    continue;
  }
  const enPh = extractPlaceholders(en[key]);
  const jaPh = extractPlaceholders(ja[key]);
  if (enPh.length !== jaPh.length || enPh.some((p, idx) => p !== jaPh[idx])) {
    placeholderMismatches.push({ key, en: enPh, ja: jaPh });
  }
}

let hasError = false;

if (missingInJa.length > 0) {
  console.error('Missing keys in locales/ja.json:', missingInJa);
  hasError = true;
}
if (extraInJa.length > 0) {
  console.error('Extra keys in locales/ja.json:', extraInJa);
  hasError = true;
}
if (emptyInEn.length > 0) {
  console.error('Empty or non-string values in locales/en.json:', emptyInEn);
  hasError = true;
}
if (emptyInJa.length > 0) {
  console.error('Empty or non-string values in locales/ja.json:', emptyInJa);
  hasError = true;
}
if (placeholderMismatches.length > 0) {
  console.error('Placeholder mismatches between locales/en.json and locales/ja.json:');
  for (const mismatch of placeholderMismatches) {
    console.error(
      `  - ${mismatch.key}: en=[${mismatch.en.join(', ')}], ja=[${mismatch.ja.join(', ')}]`,
    );
  }
  hasError = true;
}

if (hasError) {
  process.exit(1);
}

console.log(
  `i18n check passed: ${enKeys.length} keys match in en.json and ja.json with valid values and placeholders.`,
);
