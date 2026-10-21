// 把前端實際用到的 three.js 檔案（沿著 import 找）複製到 web/vendor/three/，使用者裝 cubbi 時就不用下載整包 three（22MB → 約 2MB）
// 升級 three 後執行：node scripts/vendor-three.mjs
import { readFileSync, readdirSync, mkdirSync, copyFileSync, rmSync, statSync } from 'fs';
import { join, dirname, normalize } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = join(dirname(createRequire(import.meta.url).resolve('three')), '..');
const OUT = join(ROOT, 'web', 'vendor', 'three');
const SRC = join(ROOT, 'web', 'space');
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);
const src = files(SRC).map(f => readFileSync(f, 'utf8')).join('\n');
const seen = new Set(), q = ['build/three.module.js'];
for (const m of src.matchAll(/from ['"]three\/addons\/([^'"]+)['"]/g)) q.push('examples/jsm/' + m[1]);
while (q.length) {
  const f = q.pop(); if (seen.has(f)) continue; seen.add(f);
  for (const m of readFileSync(join(T, f), 'utf8').matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
    const s = m[1] || m[2];
    if (s.startsWith('.')) q.push(normalize(join(dirname(f), s)).replace(/\\/g, '/'));
    else if (s === 'three') q.push('build/three.module.js');
  }
}
rmSync(OUT, { recursive: true, force: true });
let total = 0;
for (const f of [...seen, 'LICENSE', 'package.json']) {
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  copyFileSync(join(T, f), join(OUT, f)); total += statSync(join(OUT, f)).size;
}
console.log(`three ${JSON.parse(readFileSync(join(T, 'package.json'))).version}：${seen.size} 個檔案，${(total / 1e6).toFixed(2)} MB → web/vendor/three/`);
