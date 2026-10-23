// 成品歷史：每輪記一行、同一輪再算只蓋掉、重開還在、只認記錄過的路徑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { delivLog } from '../server/deliv-log.js';

const dir = mkdtempSync(join(tmpdir(), 'dlog-'));
const file = join(dir, 'log.jsonl'), a = join(dir, 'a.md'), b = join(dir, 'b.md');
for (const f of [a, b]) writeFileSync(f, 'x');
const sid = '00000000-0000-0000-0000-000000000001';
const d = (turn, at, ...paths) => ({ turn, at, prompt: '做 ' + turn, items: paths.map(p => ({ type: 'doc', path: p, name: p.split('/').pop() })) });

test('記下每一輪，新的在前；同一輪再記只留最後一次，一樣的不重寫', () => {
  const log = delivLog({ file, thumbDir: null });
  log.record(sid, d('t1', 1000, a));
  log.record(sid, d('t1', 1000, a));
  log.record(sid, d('t2', 2000, a, b));
  log.record(sid, d('t1', 1500, b));
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 3);
  const h = log.history(sid);
  assert.deepEqual(h.map(x => x.turn), ['t1', 't2']);
  assert.equal(h[0].items[0].name, 'b.md'); assert.equal(h[1].items.length, 2);
  assert.equal(log.count(sid), 2); assert.equal(log.count('nope'), 0);
});

test('重開還讀得回來；檔案刪了標成不在；只給記錄過的那幾樣', () => {
  const log = delivLog({ file, thumbDir: null });
  assert.equal(log.count(sid), 2);
  assert.equal(log.item(sid, 't2', 1).path, b);
  assert.equal(log.item(sid, 't2', 5), null); assert.equal(log.item(sid, 'zz', 0), null);
  unlinkSync(b);
  assert.equal(log.history(sid).find(x => x.turn === 't2').items[1].gone, true);
});

test('沒給檔案或沒有成品：不記', () => {
  const log = delivLog({ file: null });
  log.record(sid, d('t1', 1, a));
  assert.equal(log.count(sid), 0);
  const log2 = delivLog({ file: join(dir, 'x.jsonl'), thumbDir: null });
  log2.record(sid, { turn: 't', items: [] }); log2.record(sid, null);
  assert.equal(log2.count(sid), 0);
});
