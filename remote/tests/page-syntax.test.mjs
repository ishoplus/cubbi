// 對話頁的 <script> 都要能解析：少一個括號整頁就停在「檢查中…」（claude-web 直接讀這份檔，改壞了線上就壞）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import vm from 'vm';

test('index.html 的 script 都能解析', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code), SyntaxError);
});
