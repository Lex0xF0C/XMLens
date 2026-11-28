import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

async function collect(directory, result = []) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) await collect(path, result);
    else if (/\\.(?:js|css)$/.test(name)) {
      const bytes = await readFile(path);
      result.push({ file: path, type: name.endsWith('.js') ? 'js' : 'css', raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
    }
  }
  return result;
}

for (const variant of ['plain', 'preact']) {
  const files = await collect(`dist/${variant}`);
  const total = files.reduce((sum, file) => ({ raw: sum.raw + file.raw, gzip: sum.gzip + file.gzip }), { raw: 0, gzip: 0 });
  const byType = Object.fromEntries(['js', 'css'].map(type => {
    const group = files.filter(file => file.type === type);
    return [type, group.reduce((sum, file) => ({ raw: sum.raw + file.raw, gzip: sum.gzip + file.gzip }), { raw: 0, gzip: 0 })];
  }));
  console.log(JSON.stringify({ variant, files, byType, total }, null, 2));
}
