// shim＋hub：用假的 claude 測補送不漏號、多客戶端、伺服器重啟代理人照跑、提問、逾時、整棵收乾淨、異常死掉
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createHub } from '../agent-hub.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-claude.mjs');
chmodSync(FAKE, 0o755);
const root = mkdtempSync(join(tmpdir(), 'cw-hub-'));
const sockDir = mkdtempSync('/tmp/cwsk-');
after(() => { rmSync(root, { recursive: true, force: true }); rmSync(sockDir, { recursive: true, force: true }); });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, what = '條件') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(20); }
  throw new Error(`等不到${what}`);
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// 假的 express res：收集 SSE
function fakeRes() {
  const r = new EventEmitter();
  r.chunks = []; r.ended = false;
  r.setHeader = () => {}; r.flushHeaders = () => {};
  r.write = (s) => { if (r.ended) throw new Error('ended'); r.chunks.push(s); return true; };
  r.end = () => { r.ended = true; r.emit('close'); };
  r.destroy = () => { r.ended = true; r.emit('close'); };
  r.events = () => r.chunks.join('').split('\n\n').filter(Boolean).map(b => {
    const id = /^id: (\d+)$/m.exec(b)?.[1];
    const d = /^data: (.*)$/m.exec(b)?.[1];
    if (d == null) return null;
    return { id: id ? +id : null, data: d === '[DONE]' ? '[DONE]' : JSON.parse(d) };
  }).filter(Boolean);
  r.done = () => r.events().some(e => e.data === '[DONE]');
  return r;
}

function makeHub(name, extraEnv = {}) {
  const sessions = new Map(), bySid = new Map();
  const seen = [];
  const hub = createHub({
    sessions, bySid, dir: join(root, name), sockDir,
    env: () => ({ ...process.env, CLAUDE_PATH: FAKE, ...extraEnv }),
    onEvent: (s, d) => seen.push(d),
    log: { log() {}, warn() {}, error() {} },
  });
  return { hub, sessions, bySid, seen };
}

test('一輪：事件有連續號碼、結尾 [DONE]、狀態對', async () => {
  const { hub, bySid } = makeHub('basic');
  const sess = hub.start({ content: 'hi', cwd: root, newSessionId: '11111111-1111-1111-1111-111111111111' });
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'post' });
  await until(() => res.done(), 5000, '回合結束');
  const evs = res.events();
  assert.equal(evs[0].data.type, 'run');
  assert.ok(evs.some(e => e.data.type === 'assistant' && e.data.message.content[0].text === 'echo:hi'));
  const ids = evs.map(e => e.id).filter(x => x != null);
  assert.deepEqual(ids, ids.map((_, i) => ids[0] + i), '號碼不跳');
  await until(() => !sess.turnActive);
  assert.equal(bySid.get('11111111-1111-1111-1111-111111111111'), sess);
  hub.kill(sess, 'test');
  await until(() => sess.closed);
});

test('補送：從任一號碼接回來都不漏、不重複', async () => {
  const { hub } = makeHub('replay');
  const sess = hub.start({ content: 'slow 300', cwd: root });
  const a = fakeRes();
  hub.attach(sess, a, { mode: 'post' });
  await until(() => a.done());
  const all = a.events().filter(e => e.id != null);
  const cut = all[3].id;
  const b = fakeRes();
  hub.attach(sess, b, { mode: 'stream', from: cut });
  const got = b.events().filter(e => e.id != null).map(e => e.id);
  assert.deepEqual(got, all.filter(e => e.id > cut).map(e => e.id));
  assert.ok(b.done());
  hub.kill(sess); await until(() => sess.closed);
});

test('多個客戶端同時聽，誰都不會被踢掉', async () => {
  const { hub } = makeHub('multi');
  const sess = hub.start({ content: 'hi', cwd: root });
  await until(() => !sess.turnActive && sess.lastSeq > 0);
  const w1 = fakeRes(), w2 = fakeRes();
  hub.attach(sess, w1, { mode: 'watch' });
  hub.attach(sess, w2, { mode: 'watch' });
  await hub.send(sess, 'again');
  await until(() => w1.done() && w2.done());
  for (const w of [w1, w2]) assert.ok(w.events().some(e => e.data.message?.content?.[0]?.text === 'echo:again'));
  hub.kill(sess); await until(() => sess.closed);
});

test('伺服器重啟：代理人照跑，新 hub 接回來、號碼接得上', async () => {
  const one = makeHub('restart');
  const sess = one.hub.start({ content: 'slow 1500', cwd: root });
  const a = fakeRes();
  one.hub.attach(sess, a, { mode: 'post' });
  await until(() => a.events().filter(e => e.id != null).length >= 4);
  const pid = sess.shimPid;
  one.hub.detachAll();            // 舊伺服器關掉（不送 [DONE]，前端會重連）
  assert.ok(!a.done());
  const lastSeen = Math.max(...a.events().map(e => e.id || 0));
  await sleep(300);               // 斷線期間代理人繼續吐
  const two = makeHub('restart');
  assert.equal(two.hub.recover(), 1);
  const s2 = two.sessions.get(sess.runId);
  assert.ok(s2 && s2.turnActive);
  assert.ok(alive(pid), 'shim 沒被打斷');
  const b = fakeRes();
  two.hub.attach(s2, b, { mode: 'stream', from: lastSeen });
  await until(() => b.done(), 5000, '新 hub 收到結尾');
  const ids = b.events().filter(e => e.id != null).map(e => e.id);
  assert.equal(ids[0], lastSeen + 1, '從斷的地方接上');
  assert.deepEqual(ids, ids.map((_, i) => ids[0] + i));
  assert.ok(b.events().some(e => e.data.type === 'result'));
  two.hub.kill(s2); await until(() => s2.closed);
});

test('提問：待回答會進狀態，hub 重啟後還在，答了才往下', async () => {
  const one = makeHub('ask');
  const sess = one.hub.start({ content: 'ask', cwd: root });
  await until(() => sess.pending.size === 1, 5000, '提問');
  one.hub.detachAll();
  const two = makeHub('ask');
  two.hub.recover();
  const s2 = two.sessions.get(sess.runId);
  await until(() => s2.pending.size === 1);
  const w = fakeRes();
  two.hub.attach(s2, w, { mode: 'watch' });
  assert.ok(w.events().some(e => e.data.type === 'permission_request'), '沒帶號碼也補送沒答的提问');
  const [rid] = s2.pending.keys();
  await two.hub.respond(s2, rid, { behavior: 'allow', updatedInput: {} }, 'allow');
  await until(() => w.done());
  assert.ok(w.events().some(e => e.data.type === 'permission_resolved'));
  assert.ok(w.events().some(e => e.data.message?.content?.[0]?.text === 'answer:allow'));
  two.hub.kill(s2); await until(() => s2.closed);
});

test('interrupt 停這一輪、進程留著', async () => {
  const { hub } = makeHub('intr');
  const sess = hub.start({ content: 'slow 3000', cwd: root });
  await until(() => sess.lastSeq >= 3);
  await hub.interrupt(sess);
  await until(() => !sess.turnActive, 3000, '這一輪收掉');
  assert.ok(!sess.closed);
  hub.kill(sess); await until(() => sess.closed);
});

test('閒置逾時：shim 自己收（伺服器不在也一樣）', async () => {
  const { hub } = makeHub('timeout', { CLAUDE_KEEPALIVE_MS: '300', AGENT_WATCHDOG_MS: '100' });
  const sess = hub.start({ content: 'hi', cwd: root });
  await until(() => sess.closed, 5000, '逾時收掉');
  const st = JSON.parse(readFileSync(join(sess.runDir, 'state.json'), 'utf8'));
  assert.equal(st.reason, 'keepalive-expired');
});

test('kill 把整棵進程樹收乾淨', async () => {
  const { hub } = makeHub('tree');
  const sess = hub.start({ content: 'child', cwd: root });
  const w = fakeRes();
  hub.attach(sess, w, { mode: 'post' });
  await until(() => w.done());
  const child = +/child:(\d+)/.exec(JSON.stringify(w.events()))[1];
  const shim = sess.shimPid;
  assert.ok(alive(child));
  hub.kill(sess, 'test');
  await until(() => sess.closed);
  await until(() => !alive(child) && !alive(shim), 3000, '子進程與 shim 都不在');
});

test('claude 異常退出：記錯誤、對話結束', async () => {
  const { hub } = makeHub('crash');
  const sess = hub.start({ content: 'crash', cwd: root });
  const w = fakeRes();
  hub.attach(sess, w, { mode: 'post' });
  await until(() => sess.closed);
  assert.ok(w.events().some(e => e.data.type === 'error' && /代碼 3/.test(e.data.text)));
  assert.ok(w.done());
});

test('shim 被硬殺：hub 標成 lost', async () => {
  const { hub } = makeHub('lost');
  const sess = hub.start({ content: 'hi', cwd: root });
  await until(() => !sess.turnActive && sess.lastSeq > 0);
  process.kill(sess.shimPid, 'SIGKILL');
  await until(() => sess.closed, 5000, 'lost');
  const st = JSON.parse(readFileSync(join(sess.runDir, 'state.json'), 'utf8'));
  assert.equal(st.reason, 'lost');
});

test('cleanup 只刪結束超過 14 天的', async () => {
  const { hub } = makeHub('lost');
  assert.equal(hub.cleanup(), 0);
  assert.equal(hub.cleanup(Date.now() + 15 * 86400000), 1);
});
