// 直播模式：內容全部遮掉，只留畫面要的動作與狀態；代號重開後不變
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { streamFilter } from '../server/stream.js';

const SID = '47a00bc5-05b7-4c39-9950-5e92a0cf6613';
const session = {
  id: SID, sid: SID, live: true, status: 'working', cwd: '/Users/me/projects/secret-app', model: 'claude-opus-5-5',
  title: '修 secret-app 的付款', name: '付款修復', lastPrompt: '把金鑰 sk-123 換掉', prompt: { text: '把金鑰換掉', at: 5 },
  act: { kind: 'bash', tool: 'Bash', detail: 'cat ~/.ssh/id_rsa', since: 9 }, ask: { tool: 'mcp__gmail__send', question: '要寄信給老闆嗎？' },
};

test('只留動作與狀態，文字全清掉，路徑和名字換代號', () => {
  const out = streamFilter().clean({ workRoot: '/Users/me', sessions: [session] });
  const s = out.sessions[0];
  assert.equal(out.workRoot, '/office');
  assert.equal(s.status, 'working'); assert.equal(s.act.kind, 'bash'); assert.equal(s.act.tool, 'Bash'); assert.equal(s.act.since, 9);
  assert.equal(s.model, 'claude-opus-5-5');
  assert.match(s.cwd, /^\/office\/\S+部$/);
  assert.equal(s.name, s.title);
  for (const bad of ['secret', 'sk-123', 'id_rsa', '金鑰', 'gmail', '老闆', '/Users']) assert.ok(!JSON.stringify(out).includes(bad), bad);
});

test('物件的鍵是路徑也換成部門代號；縮時回放的種類留著', () => {
  const f = streamFilter();
  const look = f.clean({ depts: { '/Users/me/projects/secret-app': { floor: 'wood' } } });
  assert.deepEqual(Object.values(look.depts), [{ floor: 'wood' }]);
  assert.equal(Object.keys(look.depts)[0], f.clean({ cwd: '/Users/me/projects/secret-app' }).cwd);
  assert.deepEqual(f.clean({ sessions: { [SID]: [[1, 'bash'], [2, 'Some Text']] } }).sessions[SID], [[1, 'bash'], [2, '']]);
});

test('代號存檔：重開後同一段對話同一個名字', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cubbi-stream-')), 'names.json');
  const a = streamFilter({ file }).clean(session);
  await new Promise(r => setTimeout(r, 1200));
  const other = { ...session, id: 'x', sid: 'aaaaaaaa-0000-0000-0000-000000000000', cwd: '/elsewhere' };
  const f2 = streamFilter({ file });
  f2.clean(other);
  const b = f2.clean(session);
  assert.equal(b.name, a.name); assert.equal(b.cwd, a.cwd);
});

test('導播台：切鏡頭會推給直播頁，對照表給真名與代號', async () => {
  const { streamControl } = await import('../server/stream.js');
  const filter = streamFilter(), sent = [], routes = {};
  const r = { get: (p, h) => (routes['GET ' + p] = h), post: (p, h) => (routes['POST ' + p] = h) };
  streamControl({ filter, broadcast: (m) => sent.push(m), people: async () => [session] })(r);
  const call = async (k, body) => { let out, code = 200; await routes[k]({ body }, { json: (x) => (out = x), status: (c) => ({ json: (x) => { code = c; out = x; } }) }); return { out, code }; };
  assert.equal((await call('POST /stream-cam', { mode: 'nope' })).code, 400);
  await call('POST /stream-cam', { mode: 'person', id: SID });
  assert.deepEqual(sent.at(-1), { type: 'stream-cam', cam: { mode: 'person', id: SID } });
  assert.deepEqual(filter.clean(sent.at(-1)), sent.at(-1));   // 經過直播埠的過濾也原樣送到
  assert.deepEqual((await call('GET /stream-cam')).out, { mode: 'person', id: SID });
  const [p] = (await call('GET /stream-names')).out;
  assert.equal(p.title, '付款修復'); assert.equal(p.nick, filter.nameOf(SID)); assert.match(p.dept, /部$/);
});
