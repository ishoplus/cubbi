// 空間核心：合併各來源、進行中的優先坐、同專案舊紀錄補空位、歸檔
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSpace } from '../server/space.js';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const fake = (name, list, extra = {}) => ({ name, async *list() { yield* list; }, ...extra });

async function serve(space) {
  const app = express(); app.use(express.json()); app.use('/api/space', space.router);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/space`;
  return { base, close: () => server.close() };
}

test('進行中的對話優先，同專案舊紀錄只補剩下的座位，同一段對話後到的來源補標題名字', async () => {
  const live = [{ id: id(1), sid: id(1), live: true, cwd: '/p', title: '', name: '', act: null, updatedAt: 9 }];
  const old = [
    { id: id(1), sid: id(1), live: false, cwd: '/p', title: '標題', name: '短名', act: { kind: 'done' }, updatedAt: 9 },
    ...Array.from({ length: 9 }, (_, i) => ({ id: id(10 + i), sid: id(10 + i), live: false, cwd: '/p', title: 't', name: '', updatedAt: 8 - i })),
    { id: id(30), sid: id(30), live: false, cwd: '/q', title: '雜訊', hidden: true, updatedAt: 1 },
  ];
  const space = createSpace({ sources: [fake('live', live), fake('transcript', old)], workRoot: '/', archiveFile: join(mkdtempSync(join(tmpdir(), 'cubbi-')), 'a.json') });
  const { base, close } = await serve(space);
  try {
    const { sessions, workRoot } = await (await fetch(base + '/sessions')).json();
    assert.equal(workRoot, '/');
    assert.equal(sessions.length, 1 + 6);   // 1 個進行中＋舊紀錄最多 6（座位 8 減 1 還有 7，但每專案舊紀錄上限 6）
    const first = sessions.find(s => s.id === id(1));
    assert.equal(first.live, true);
    assert.equal(first.title, '標題');
    assert.equal(first.name, '短名');
    assert.ok(!sessions.some(s => s.id === id(30)));

    // 歸檔：舊紀錄消失，進行中的不受影響
    await fetch(base + '/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: id(10), archived: true }) });
    await fetch(base + '/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: id(1), archived: true }) });
    const after = (await (await fetch(base + '/sessions')).json()).sessions.map(s => s.id);
    assert.ok(!after.includes(id(10)));
    assert.ok(after.includes(id(1)));
  } finally { close(); }
});

test('進度：第一個認得的來源給內容，宿主可以加欄位；格式不對的編號擋掉', async () => {
  const src = fake('t', [], { progress: async (sid) => sid === id(5) ? { steps: [{ kind: 'user', text: 'hi' }], todos: null, files: [] } : null });
  const space = createSpace({ sources: [src], workRoot: '/', archiveFile: '/nonexistent/a.json', progressExtra: () => ({ extra: 1 }) });
  const { base, close } = await serve(space);
  try {
    const p = await (await fetch(base + '/progress?sessionId=' + id(5))).json();
    assert.equal(p.steps[0].text, 'hi');
    assert.equal(p.extra, 1);
    const none = await (await fetch(base + '/progress?sessionId=' + id(6))).json();
    assert.deepEqual(none.steps, []);
    assert.equal((await fetch(base + '/progress?sessionId=../x')).status, 400);
    assert.equal(await (await fetch(base + '/weather')).json(), null);   // 沒設地點就沒有天氣
  } finally { close(); }
});
