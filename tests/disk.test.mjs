// 硬碟空間：statfs 照實讀、快滿了只推一次（回到門檻＋3% 以上才重來）；remote 的「交給 CC 清理」同時只開一段
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import { createDisk, fmtBytes } from '../server/disk.js';
import { diskPlugin, brief } from '../remote/disk/plugin.js';

const dir = mkdtempSync(join(tmpdir(), 'cubbi-disk-'));

test('讀得到這台電腦的硬碟', async () => {
  const d = await createDisk({ path: dir }).check();
  assert.ok(d.total > 0 && d.free > 0 && d.free <= d.total);
  assert.equal(d.used, d.total - d.free);
  assert.ok(d.usedPct > 0 && d.usedPct < 100);
  assert.equal(d.canClean, false);
});

test('快滿了推一次，重開也不重推；空間回來才重新算', async () => {
  const sent = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { sent.push(JSON.parse(opt.body)); return { ok: true }; };
  try {
    const file = join(dir, 'disk.json'), push = { url: () => 'https://ntfy.sh/test-topic', click: () => 'http://x/?disk=1' };
    const changes = [];
    const a = createDisk({ path: dir, file, lowPct: 100, push, onChange: (m) => changes.push(m) });   // 門檻 100％：一定算快滿
    assert.equal((await a.check()).low, true);
    await a.check();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].topic, 'test-topic');
    assert.match(sent[0].title, /硬碟只剩/);
    assert.deepEqual(changes, [{ type: 'disk' }]);   // 數字沒變就不再通知前端
    await new Promise(r => setTimeout(r, 50));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).warned, true);
    await createDisk({ path: dir, file, lowPct: 100, push }).check();   // 重開
    assert.equal(sent.length, 1);
    await createDisk({ path: dir, file, lowPct: 0, push }).check();      // 空間回來了：解除
    await new Promise(r => setTimeout(r, 50));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).warned, false);
    await createDisk({ path: dir, file, lowPct: 100, push, lang: () => 'en' }).check();
    assert.equal(sent.length, 2);
    assert.match(sent[1].title, /disk left/);
  } finally { globalThis.fetch = realFetch; }
});

test('fmtBytes', () => {
  assert.equal(fmtBytes(29.4 * 1024 ** 3), '29G');
  assert.equal(fmtBytes(512 * 1024 ** 2), '512M');
  assert.equal(fmtBytes(1.5 * 1024 ** 4), '1.5T');
});

test('清理的交代：先盤點、等點頭、自己的資料不刪', () => {
  const d = { total: 460 * 1024 ** 3, free: 29 * 1024 ** 3, usedPct: 93.7 };
  const zh = brief(d, 'zh'), en = brief(d, 'en');
  assert.match(zh, /剩 29G（總共 460G，剩 6%）/);
  assert.match(zh, /先不刪/); assert.match(zh, /一律不刪/);
  assert.match(en, /29G free of 460G/); assert.match(en, /never delete/);
});

test('交給 CC 清理：開一段新對話；還在做就帶回同一段', async () => {
  const started = [];
  let status = 'working';
  const disk = createDisk({ path: dir, canClean: true });
  const plugin = diskPlugin({ disk: () => disk, cwd: dir });
  const app = express(); app.use(express.json());
  plugin.mount({ app, requireAuth: (req, res, next) => next(), statusOf: () => status,
    startWork: async (o) => { started.push(o); return 'sid-' + started.length; } });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/space/disk/clean`;
  const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
  try {
    assert.deepEqual(await post(), { sid: 'sid-1' });
    assert.equal(started[0].cwd, dir);
    assert.equal(started[0].worktree, false);
    assert.match(started[0].prompt, /清理硬碟空間|Clean up disk space/);
    assert.deepEqual(await post(), { sid: 'sid-1', existing: true });
    status = 'idle';
    assert.deepEqual(await post(), { sid: 'sid-2' });
  } finally { server.close(); }
});
