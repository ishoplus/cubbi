// 成品：最後一則回覆提到的網址／新檔優先，沒有才看這輪寫的檔與 localhost；還沒做完、參考舊檔都不算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findDeliverable, canShoot } from '../server/deliverable.js';

const dir = mkdtempSync(join(tmpdir(), 'deliv-'));
const now = Date.now(), ts = (dt) => new Date(now - dt).toISOString();
const png = join(dir, 'cat.png'), page = join(dir, 'index.html'), old = join(dir, 'old.md');
for (const f of [png, page, old]) writeFileSync(f, 'x');
utimesSync(old, new Date(now - 86400_000), new Date(now - 86400_000));   // 很久以前的檔

const user = (t, dt) => ({ type: 'user', cwd: dir, timestamp: ts(dt), message: { content: t } });
const said = (t, dt, end = true) => ({ type: 'assistant', timestamp: ts(dt), message: { stop_reason: end ? 'end_turn' : 'tool_use', content: [{ type: 'text', text: t }] } });
const wrote = (fp, dt) => ({ type: 'assistant', timestamp: ts(dt), message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: fp } }] } });
const out = (t, dt) => ({ type: 'user', timestamp: ts(dt), message: { content: [{ type: 'tool_result', content: t }] } });

test('回覆裡的網址最優先', () => {
  const d = findDeliverable([user('做網站', 9000), wrote(page, 8000), said('已上線 https://cats.xi-za.com/ ，圖在 `cat.png`。', 1000)]);
  assert.equal(d.type, 'url'); assert.equal(d.url, 'https://cats.xi-za.com/'); assert.equal(d.from, 'reply');
  assert.equal(canShoot(d), false);   // 線上網址不截圖
});

test('你給的、它上網查來的網址不算成品', () => {
  const search = { type: 'assistant', timestamp: ts(8000), message: { content: [{ type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'flint' } }] } };
  const found = { type: 'user', timestamp: ts(7000), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'https://techcrunch.com/flint' }] } };
  assert.equal(findDeliverable([user('看這則 https://a.com/x', 9000), search, found, said('來源：https://techcrunch.com/flint（原文）、https://a.com/x', 1000)]), null);
  const push = { type: 'assistant', timestamp: ts(5000), message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git push origin main' } }] } };
  assert.equal(findDeliverable([user('上線', 9000), push, said('上線了：https://cats.xi-za.com（三貓）', 1000)]).url, 'https://cats.xi-za.com');
  assert.equal(findDeliverable([user('Mistral 是什麼', 9000), said('官網是 https://mistral.ai', 1000)]), null);   // 沒動手做：隨口提的網址
});

test('回覆裡的新檔：相對路徑、絕對路徑、行號；舊檔不算', () => {
  assert.equal(findDeliverable([user('畫貓', 9000), said('畫好了：`cat.png`', 1000)]).path, png);
  assert.equal(findDeliverable([user('畫貓', 9000), said(`存在 ${png}。`, 1000)]).path, png);
  assert.equal(findDeliverable([user('看文件', 9000), said(`參考 ${old}:12`, 1000)]), null);
});

test('回覆沒提到：這輪寫的檔、指令輸出的 localhost', () => {
  const d = findDeliverable([user('做頁面', 9000), wrote(page, 8000), said('好了', 1000)]);
  assert.equal(d.path, page); assert.equal(d.from, 'tools'); assert.equal(canShoot(d), true);
  const u = findDeliverable([user('跑起來', 9000), wrote(page, 8000), out('ready on http://localhost:5173/', 7000), said('好了', 1000)]);
  assert.equal(u.url, 'http://localhost:5173/');
});

test('還沒做完、或已經交代新的事：沒有成品', () => {
  assert.equal(findDeliverable([user('畫貓', 9000), said('畫好了 `cat.png`', 2000, false)]), null);
  assert.equal(findDeliverable([user('畫貓', 9000), said('畫好了 `cat.png`', 2000), user('再改', 1000)]), null);
  assert.equal(findDeliverable([user('聊天', 9000), said('你好', 1000)]), null);
});
