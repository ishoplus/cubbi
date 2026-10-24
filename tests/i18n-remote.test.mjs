// remote 的文字：對話頁、辦公室外掛、伺服器與指令列，每段要給人看的中文都要有英文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EN as SERVER } from '../remote/i18n-en.js';
import { EN_PLUGINS } from '../remote/public/space/plugins/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[一-鿿]/;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const noComments = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n');
// 某個函式的第 n 個參數是字串字面值（單引號、雙引號、反引號都收；反引號裡的 ${} 不算）
function calls(src, fn, argIndex = 0) {
  const out = [];
  // 前面的參數可以帶一層括號（例如 t(SERVER_LANG(), '…')、tr(req, '…')）
  const arg = `(?:[^,()]|\\([^()]*\\))+`;
  const re = new RegExp(`\\b${fn}\\(` + (argIndex ? `(?:${arg},\\s*){${argIndex}}` : '') + `(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 'g');
  for (const m of src.matchAll(re)) if (CJK.test(m[2]) && !m[2].includes('${')) out.push(m[2]);
  return out;
}
// 瀏覽器端 window.EN_REMOTE：從 remote/public/i18n.js 原始碼裡把那張表拿出來
function chatDict() {
  const src = read('remote/public/i18n.js');
  const body = src.slice(src.indexOf('const EN = {') + 'const EN = '.length, src.indexOf('};', src.indexOf('const EN = {')) + 1);
  return Function(`return (${body});`)();
}
const missing = (list, ...dicts) => [...new Set(list)].filter(s => !dicts.some(d => s in d));

test('對話頁：T(…) 與 HTML 裡寫死的文字都有英文', () => {
  const EN = chatDict();
  const html = read('remote/public/index.html');
  const script = noComments(html.slice(html.indexOf('<script>')));
  const markup = html.slice(0, html.indexOf('<script>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  const statics = [...markup.matchAll(/>([^<>]*[一-鿿][^<>]*)</g)].map(m => m[1].trim())
    .concat([...markup.matchAll(/(?:title|placeholder|aria-label)="([^"]*[一-鿿][^"]*)"/g)].map(m => m[1]));
  assert.deepEqual(missing([...calls(script, 'T'), ...statics], EN), []);
});

test('辦公室外掛：t(…) 都有英文', () => {
  const dir = 'remote/public/space/plugins';
  const src = readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.js') && !['en.js', 'lang.js'].includes(f)).map(f => noComments(read(join(dir, f)))).join('\n')
    + noComments(read('remote/public/space/host.js'));
  assert.deepEqual(missing(calls(src, 't'), EN_PLUGINS), []);   // 外掛用 plugins/lang.js，只查 en.js
});

test('伺服器與指令列：t(lang, …)、tr(req, …)、TError(…) 都有英文', () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = join(d, n); if (['tests', 'public', 'skills'].includes(n)) continue; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.m?js$/.test(n) && !/i18n/.test(n)) files.push(p); } };
  walk('remote');
  files.push('server/inbox.js');
  const src = files.map(f => noComments(read(f))).join('\n');
  const used = [...calls(src, 't', 1), ...calls(src, 'tr', 1), ...calls(src, 'TError'), ...calls(src, 'say'), ...calls(src, 'L')];
  assert.deepEqual(missing(used, SERVER), []);
});
