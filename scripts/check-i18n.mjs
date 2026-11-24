import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const enPath = resolve(root, 'locales/en.json');
const jaPath = resolve(root, 'locales/ja.json');

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const ja = JSON.parse(readFileSync(jaPath, 'utf8'));

const enKeys = Object.keys(en).sort();
const jaKeys = Object.keys(ja).sort();

const missingInJa = enKeys.filter((k) => !(k in ja));
const extraInJa = jaKeys.filter((k) => !(k in en));

if (missingInJa.length > 0 || extraInJa.length > 0) {
  if (missingInJa.length > 0) {
    console.error('Missing keys in locales/ja.json:', missingInJa);
  }
  if (extraInJa.length > 0) {
    console.error('Extra keys in locales/ja.json:', extraInJa);
  }
  process.exit(1);
}

console.log(`i18n check passed: ${enKeys.length} keys match between en.json and ja.json.`);
