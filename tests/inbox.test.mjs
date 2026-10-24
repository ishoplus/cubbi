// 核心收件箱：從辦公室裡的人算舉手／交件／卡住／做完了；看過、收下存伺服器；舊版瀏覽器紀錄搬得過來；
// 宿主加的項目蓋過核心的；推播只推一次、做完了不推、第一次開不連發
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'http';
import express from 'express';
import { createInbox } from '../server/inbox.js';

const dir = mkdtempSync(join(tmpdir(), 'cubbi-inbox-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const quiet = { log() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = Date.now();
const S = (n) => `${n}0000000-0000-4000-8000-000000000000`.slice(0, 36);

function people() {
  return [
    { id: S(1), sid: S(1), status: 'asking', ask: { tool: 'Bash', question: '跑 ls？' }, updatedAt: now - 1000, name: '甲' },
    { id: S(2), sid: S(2), status: 'idle', updatedAt: now - 2000, name: '乙' },                       // 有成品
    { id: S(3), sid: S(3), status: 'idle', updatedAt: now - 3000, name: '丙' },                       // 沒成品 → 做完了
    { id: S(4), sid: S(4), status: 'working', act: { kind: 'edit' }, updatedAt: now - 20 * 60000, name: '丁' },   // 卡住
    { id: S(5), sid: S(5), status: 'working', act: { kind: 'bash', since: now - 1000 }, updatedAt: now - 20 * 60000, name: '戊' },   // 指令剛開始跑，不算卡
    { id: S(6), sid: S(6), status: 'idle', updatedAt: now - 2 * 86400000, name: '己' },              // 太舊
    { id: S(7), sid: S(7), status: 'idle', updatedAt: now - 4000, agent: 'codex', name: '庚' },      // Codex 不判成品
  ];
}
const deliv = async (sid) => sid === S(2) ? { type: 'file', path: '/w/report.pdf' } : null;

test('四種：舉手、交件（附成品摘要）、卡住（指令看跑多久）、做完了；太舊的不算', async () => {
  const ib = createInbox({ file: join(dir, 'a.json'), list: async () => people(), deliverableOf: deliv, log: quiet });
  // since 是建立的時間：之前的「做完了」不算，測試把它往前調
  const items = await ib.items();
  const kinds = Object.fromEntries(items.map(i => [i.name, i.kind]));
  assert.equal(kinds['甲'], 'ask');
  assert.equal(kinds['乙'], 'deliv');
  assert.equal(items.find(i => i.name === '乙').deliv.title, 'report.pdf');
  assert.equal(kinds['丁'], 'stuck');
  assert.equal(kinds['戊'], undefined);
  assert.equal(kinds['己'], undefined);
});

test('做完了：只算收件箱開始之後的；看過就消失（伺服器記，換裝置也一樣）', async () => {
  const file = join(dir, 'b.json');
  const ib = createInbox({ file, list: async () => people(), deliverableOf: deliv, log: quiet });
  assert.ok(!(await ib.items()).some(i => i.kind === 'done'), '第一次開：之前的對話不算沒看過');
  const later = createInbox({ file, list: async () => people().map(p => ({ ...p, updatedAt: p.updatedAt + 60000 })), deliverableOf: deliv, log: quiet });
  let items = await later.items();
  assert.deepEqual(items.filter(i => i.kind === 'done').map(i => i.name).sort(), ['丙', '庚']);
  later.markSeen(S(3));
  items = await later.items();
  assert.deepEqual(items.filter(i => i.kind === 'done').map(i => i.name), ['庚']);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).seen[S(3)], '看過存進檔案');
});

async function api(ib) {
  const app = express(); app.use(express.json()); app.use('/inbox', ib.router);
  const srv = createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/inbox`;
  const call = (p, body) => fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json());
  return { call, close: () => srv.close() };
}

test('收下成品：記住是哪一輪；知道了：那一項不再出現', async () => {
  const ib = createInbox({ file: join(dir, 'c.json'), list: async () => people(), deliverableOf: deliv, log: quiet });
  const { call, close } = await api(ib);
  let { items } = await call('/');
  const d = items.find(i => i.kind === 'deliv');
  await call('/accept', { sid: d.sid, turn: d.turn });
  ({ items } = await call('/'));
  assert.ok(!items.some(i => i.kind === 'deliv'), '收下就不再列');
  const st = items.find(i => i.kind === 'stuck');
  await call('/dismiss', { key: st.key });
  ({ items } = await call('/'));
  assert.ok(!items.some(i => i.key === st.key));
  close();
});

test('舊版瀏覽器的看過／收下搬過來', async () => {
  const ib = createInbox({ file: join(dir, 'd.json'), list: async () => people(), deliverableOf: deliv, log: quiet });
  const { call, close } = await api(ib);
  const r = await call('/import', { accepted: { [S(2)]: `${S(2)}:${now - 2000}` }, seen: { [S(3)]: now } });
  assert.equal(r.imported, 2);
  const { items } = await call('/');
  assert.ok(!items.some(i => i.kind === 'deliv'), '瀏覽器收下過的成品不再出現');
  close();
});

test('宿主加的：同 key 蓋過核心的提問；supersedes 拿掉同一段的做完了／交件', async () => {
  const ib = createInbox({ file: join(dir, 'e.json'), list: async () => people().map(p => p.sid === S(1) ? { ...p, ask: { ...p.ask, requestId: 'r1' } } : p), deliverableOf: deliv, log: quiet });
  ib.addProvider(async () => [
    { key: 'ask:r1', kind: 'ask', sid: S(1), answerable: true, ask: { type: 'permission_request', requestId: 'r1', toolName: 'Bash', input: { command: 'ls' } } },
    { key: `review:${S(2)}:h`, kind: 'review', sid: S(2), supersedes: ['done', 'deliv'], branch: 'cw/x' },
  ]);
  const items = await ib.items();
  const ask = items.filter(i => i.kind === 'ask');
  assert.equal(ask.length, 1); assert.equal(ask[0].answerable, true);
  assert.ok(!items.some(i => i.sid === S(2) && i.kind === 'deliv'), '分支交件蓋過成品交件');
  assert.ok(items.some(i => i.kind === 'review'));
});

test('推播：新出現的各推一次、做完了不推、第一次開只記不推', async () => {
  const got = [];
  const ntfy = createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { got.push(JSON.parse(b)); res.end('{}'); }); });
  await new Promise(r => ntfy.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${ntfy.address().port}/my-topic`;
  let list = people().slice(0, 1);
  const file = join(dir, 'f.json');
  const ib = createInbox({ file, list: async () => list, deliverableOf: deliv, push: { url: () => url, click: () => 'https://me.test/?inbox=1' }, log: quiet });
  ib.changed(); await sleep(1800);
  assert.equal(got.length, 0, '第一次只記不推');
  list = people();
  ib.changed(); await sleep(1800);
  const titles = got.map(g => g.title);
  assert.ok(titles.some(t => /乙 交件了/.test(t)) && titles.some(t => /丁 卡住了/.test(t)), titles.join(' / '));
  assert.ok(!titles.some(t => /做完了/.test(t)), '做完了不推');
  assert.ok(got.every(g => g.topic === 'my-topic' && g.click === 'https://me.test/?inbox=1'));
  const n = got.length;
  ib.changed(); await sleep(1800);
  assert.equal(got.length, n, '同一項不重推');
  ntfy.close();
});
