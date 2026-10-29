// 等你辦：檔案存取、回到 todo 會再推、收件箱只收 todo、問一下／回報送回原對話、沒對話就開新的
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import express from 'express';
import { createHandoff } from '../handoff/store.js';
import { handoffPlugin, message } from '../handoff/plugin.js';

const dir = mkdtempSync(join(tmpdir(), 'cw-handoff-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('新增、更新：status 換了記一筆；回到 todo 時 rev 加一', () => {
  const s = createHandoff({ dir: join(dir, 'a') });
  const h = s.add({ id: 'chrome-ext', title: '上傳 zip', steps: '打開後台\n上傳', sid: 's1', cwd: '/tmp' });
  assert.deepEqual(h.steps, ['打開後台', '上傳']);
  assert.equal(h.status, 'todo');
  assert.throws(() => s.add({ id: 'chrome-ext', title: 'x' }), /已經有/);
  assert.throws(() => s.add({ title: '' }), /title/);
  assert.throws(() => s.get('../etc'), /格式/);
  s.update('chrome-ext', { status: 'waiting', waitingFor: '審核' }, { note: '送出了' });
  const back = s.update('chrome-ext', { status: 'todo' }, { note: '被退' });
  assert.equal(back.rev, 2);
  assert.equal(back.waitingFor, '審核');
  assert.deepEqual(back.log.map(l => l.text), ['送出了', '被退']);
  assert.equal(s.list().length, 1);
});

function server(store) {
  const sent = [], started = [];
  let provider = null;
  const app = express();
  app.use(express.json());
  handoffPlugin({ store }).mount({
    app, requireAuth: (req, res, next) => next(),
    inbox: { addProvider: (fn) => { provider = fn; }, changed() {} },
    sendToSession: async (o) => { sent.push(o); },
    startWork: async (o) => { started.push(o); return 'new-sid'; },
  });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/space/handoff`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  return { sent, started, provider: () => provider(), post, get: () => fetch(base).then(r => r.json()), close: () => srv.close() };
}

test('收件箱只收 todo；問一下、辦好了都送回原對話；辦好了變成等代理人接手', async () => {
  const store = createHandoff({ dir: join(dir, 'b') });
  store.add({ id: 'a', title: '上傳 zip', sid: 's1', cwd: '/tmp/p' });
  store.add({ id: 'b', title: '等審核', status: 'waiting' });
  const s = server(store);
  try {
    const items = await s.provider();
    assert.deepEqual(items.map(i => i.key), ['handoff:a:1']);
    assert.equal(items[0].kind, 'handoff');
    assert.equal((await s.get()).items.length, 2);

    assert.equal((await s.post('/a/ask', { text: '' })).status, 400);
    const asked = await s.post('/a/ask', { text: 'zip 在哪？' });
    assert.equal(asked.sid, 's1');
    assert.match(s.sent[0].content, /等你辦 a/);
    assert.match(s.sent[0].content, /zip 在哪？/);

    assert.equal((await s.post('/a/report', { ok: false })).status, 400, '卡住了要寫理由');
    await s.post('/a/report', { ok: true, note: '送出了' });
    assert.match(s.sent[1].content, /辦好了/);
    assert.equal(store.get('a').status, 'waiting');
    assert.deepEqual((await s.provider()).map(i => i.key), []);

    await s.post('/b/drop', {});
    assert.equal(store.get('b').status, 'dropped');
    assert.equal((await s.post('/nope/ask', { text: 'x' })).status, 404);
  } finally { s.close(); }
});

test('沒記對話但有資料夾：在那裡開新對話，之後都送那裡；兩個都沒有就問不了、辦好了直接結束', async () => {
  const store = createHandoff({ dir: join(dir, 'c') });
  store.add({ id: 'c', title: '簽名', cwd: '/tmp/q' });
  store.add({ id: 'd', title: '付款' });
  const s = server(store);
  try {
    await s.post('/c/ask', { text: '簽哪裡？' });
    assert.equal(s.started[0].cwd, '/tmp/q');
    assert.equal(s.started[0].worktree, false);
    assert.equal(store.get('c').sid, 'new-sid');
    assert.equal((await s.post('/d/ask', { text: '?' })).status, 409);
    await s.post('/d/report', { ok: true });
    assert.equal(store.get('d').status, 'done');
  } finally { s.close(); }
});

test('送給代理人的話帶著改狀態的指令', () => {
  const m = message({ id: 'x', title: 'T' }, 'ok', '');
  assert.match(m, /set x waiting/);
  assert.match(m, /done x/);
  assert.doesNotMatch(m, /老闆說/);
  assert.match(message({ id: 'x', title: 'T' }, 'ask', 'hi', 'en'), /They wrote: hi/);
});

test('指令列：add 帶 JSON、list、set、done', () => {
  const env = { ...process.env, CUBBI_HANDOFF_DIR: join(dir, 'cli') };
  const cli = (...a) => execFileSync(process.execPath, [new URL('../handoff/cli.mjs', import.meta.url).pathname, ...a], { env, cwd: '/', encoding: 'utf8' });
  assert.match(cli('add', JSON.stringify({ id: 'e', title: '到後台上傳', steps: ['一', '二'] })), /e {2}\[todo\] {2}到後台上傳/);
  assert.match(cli('set', 'e', 'waiting', '--for', 'Chrome 審核'), /\[waiting：Chrome 審核\]/);
  assert.match(cli('list'), /e /);
  cli('done', 'e', '--note', '過了');
  assert.match(cli('list'), /沒有等老闆辦的事/);
  assert.match(cli('list', '--all'), /\[done/);
});
