// 介面文字：程式裡每段要顯示的中文都要有英文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { EN, t } from '../web/space/i18n.js';
import { HOLIDAY_GREETING } from '../web/space/holiday.js';

const CJK = /[一-鿿]/;
const KEEP_ZH = new Set(['平安如意', '萬事亨通', '[外掛]', '測試：辦公室活動']);   // 春聯本來就是中文；除錯用的不翻

// main.js 裡單引號的中文字串（註解除外）
function zhStrings(file) {
  const out = [];
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    if (line.trim().startsWith('//')) continue;
    const code = line.replace(/\s\/\/\s.*$/, '');
    for (const m of code.matchAll(/'((?:[^'\\]|\\.)*)'/g)) if (CJK.test(m[1])) out.push(m[1]);
  }
  return out;
}

test('main.js 與內建外掛的中文都有英文', () => {
  const missing = ['../web/space/main.js', '../web/space/plugins/growth.js'].flatMap(zhStrings).filter(s => !KEEP_ZH.has(s) && !(s in EN));
  assert.deepEqual(missing, []);
});

test('部門名稱與節日問候都有英文', () => {
  // figure.js 要在瀏覽器裡才能載入（three、matchMedia），直接從原始碼抓 name: '…'
  const names = [...readFileSync(new URL('../web/space/figure.js', import.meta.url), 'utf8').matchAll(/name: '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...names, ...Object.values(HOLIDAY_GREETING)].filter(s => !(s in EN)), []);
});

test('index.html 的固定文字都有英文', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const texts = [...html.matchAll(/>([^<>]*[一-鿿][^<>]*)</g)].map(m => m[1].trim())
    .concat([...html.matchAll(/(?:title|placeholder)="([^"]*[一-鿿][^"]*)"/g)].map(m => m[1]));
  assert.deepEqual(texts.filter(s => !(s in EN)), []);
});

test('代入變數；英文缺字時退回中文', () => {
  assert.equal(t('{n} 分鐘沒動靜', { n: 3 }), 'No activity for 3 min');   // Node 的 navigator.language 是 en-US
  assert.equal(t('沒有這句'), '沒有這句');
});
