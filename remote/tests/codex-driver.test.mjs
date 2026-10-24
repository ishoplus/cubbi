// Codex Driver：假的 codex app-server 演劇本，走真的 shim＋hub。
// 事件要翻成 Claude 的樣子（前端不用分辨）、核准／選擇題要能答、權限模式要對到核准＋沙箱、伺服器重啟照跑。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createHub } from '../agent-hub.js';
import { policyOf, inputOf } from '../drivers/codex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-codex.mjs');
chmodSync(FAKE, 0o755);
const root = mkdtempSync(join(tmpdir(), 'cw-codex-'));
const sockDir = mkdtempSync('/tmp/cwsk-');
const LOG = join(root, 'rpc.log');
after(() => { rmSync(root, { recursive: true, force: true }); rmSync(sockDir, { recursive: true, force: true }); });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, what = '條件') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(20); }
  throw new Error(`等不到${what}`);
}
function fakeRes() {
  const r = new EventEmitter();
  r.chunks = []; r.ended = false;
  r.setHeader = () => {}; r.flushHeaders = () => {};
  r.write = (s) => { if (r.ended) throw new Error('ended'); r.chunks.push(s); return true; };
  r.end = () => { r.ended = true; r.emit('close'); };
  r.destroy = () => { r.ended = true; r.emit('close'); };
  r.events = () => r.chunks.join('').split('\n\n').filter(Boolean).map(b => {
    const d = /^data: (.*)$/m.exec(b)?.[1];
    return d == null ? null : (d === '[DONE]' ? '[DONE]' : JSON.parse(d));
  }).filter(Boolean);
  r.done = () => r.events().includes('[DONE]');
  r.texts = () => r.events().filter(e => e.type === 'assistant').flatMap(e => e.message.content).filter(b => b.type === 'text').map(b => b.text);
  return r;
}
function makeHub(name) {
  const sessions = new Map(), bySid = new Map();
  const hub = createHub({ sessions, bySid, dir: join(root, name), sockDir,
    env: () => ({ ...process.env, CODEX_PATH: FAKE, FAKE_CODEX_LOG: LOG }), log: { log() {}, warn() {}, error() {} } });
  return { hub, sessions, bySid };
}
const rpcLog = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];

test('權限模式對到 Codex 的核准＋沙箱', () => {
  assert.deepEqual([policyOf('manual', '/w').approvalPolicy, policyOf('manual', '/w').sandbox], ['untrusted', 'workspace-write']);
  assert.deepEqual([policyOf('auto', '/w').approvalPolicy, policyOf('acceptEdits', '/w').approvalPolicy], ['on-request', 'on-request']);
  assert.deepEqual(policyOf('auto', '/w').sandboxPolicy.writableRoots, ['/w']);
  assert.deepEqual([policyOf('bypassPermissions', '/w').approvalPolicy, policyOf('bypassPermissions', '/w').sandbox], ['never', 'danger-full-access']);
});

test('使用者訊息：文字與 base64 圖片', () => {
  assert.deepEqual(inputOf('hi'), [{ type: 'text', text: 'hi' }]);
  assert.deepEqual(inputOf([{ type: 'image', source: { media_type: 'image/png', data: 'AAA=' } }, { type: 'text', text: '看圖' }]),
    [{ type: 'image', url: 'data:image/png;base64,AAA=' }, { type: 'text', text: '看圖' }]);
});

test('一輪：session 是 thread id、逐字＋完整訊息、思考、結尾 result', async () => {
  const { hub, bySid } = makeHub('basic');
  const sess = hub.start({ content: 'hi', cwd: root, driver: 'codex', permMode: 'auto', appendSystemPrompt: '在 worktree 裡做' });
  assert.equal(sess.driver, 'codex');
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'post' });
  await until(() => res.done(), 5000, '回合結束');
  const evs = res.events();
  const init = evs.find(e => e.type === 'system' && e.subtype === 'init');
  assert.ok(init?.session_id, 'system init 帶 thread id');
  assert.equal(init.driver, 'codex');
  await until(() => sess.sid === init.session_id && bySid.get(init.session_id) === sess);
  assert.ok(evs.some(e => e.type === 'stream_event' && e.event.type === 'message_start'), '逐字前先有 message_start');
  assert.ok(res.texts().includes('echo:hi'));
  assert.ok(evs.some(e => e.type === 'assistant' && e.message.content[0].type === 'thinking'), '思考摘要');
  const result = evs.find(e => e.type === 'result');
  assert.equal(result.subtype, 'success'); assert.equal(result.usage.output_tokens, 3);
  const start = rpcLog().find(r => r.method === 'thread/start');
  assert.equal(start.params.approvalPolicy, 'on-request');
  assert.equal(start.params.developerInstructions, '在 worktree 裡做');
  hub.kill(sess, 'test'); await until(() => sess.closed);
});

test('指令要核准：變成 Bash 的權限請求，准了才跑、結果掛回工具', async () => {
  const { hub } = makeHub('cmd');
  const sess = hub.start({ content: 'cmd', cwd: root, driver: 'codex' });
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'post' });
  await until(() => sess.pending.size === 1, 5000, '核准請求');
  const [ask] = sess.pending.values();
  assert.equal(ask.toolName, 'Bash'); assert.equal(ask.input.command, 'ls'); assert.equal(ask.reason, '要列出檔案');
  assert.ok(ask.suggestions.length, '有「總是允許」（這段對話都允許）');
  assert.ok(res.events().some(e => e.type === 'assistant' && e.message.content.some(b => b.type === 'tool_use' && b.name === 'Bash')), '工具先立牌子');
  await hub.respond(sess, ask.requestId, { behavior: 'allow', updatedInput: ask.input }, 'allow');
  await until(() => res.done());
  const tr = res.events().find(e => e.type === 'user')?.message.content[0];
  assert.equal(tr.type, 'tool_result'); assert.match(tr.content, /file-a/); assert.equal(tr.is_error, false);
  assert.ok(res.texts().includes('cmd:accept'));
  hub.kill(sess); await until(() => sess.closed);
});

test('總是允許＝這段對話都允許（acceptForSession）；拒絕＝decline', async () => {
  const { hub } = makeHub('always');
  const sess = hub.start({ content: 'cmd', cwd: root, driver: 'codex' });
  await until(() => sess.pending.size === 1);
  let [ask] = sess.pending.values();
  await hub.respond(sess, ask.requestId, { behavior: 'allow', updatedInput: ask.input, updatedPermissions: ask.suggestions }, 'allow');
  await until(() => !sess.turnActive);
  await hub.send(sess, 'edit');
  await until(() => sess.pending.size === 1);
  [ask] = sess.pending.values();
  assert.equal(ask.toolName, 'Edit'); assert.equal(ask.input.file_path, 'a.txt');
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'watch' });
  await hub.respond(sess, ask.requestId, { behavior: 'deny', message: 'no' }, 'deny');
  await until(() => res.done());
  assert.ok(res.texts().includes('edit:decline'));
  const ev = readFileSync(join(sess.runDir, 'events.jsonl'), 'utf8');
  assert.match(ev, /cmd:acceptForSession/);
  hub.kill(sess); await until(() => sess.closed);
});

test('選擇題：AskUserQuestion 的樣子，答案送回 Codex', async () => {
  const { hub } = makeHub('ask');
  const sess = hub.start({ content: 'ask', cwd: root, driver: 'codex' });
  await until(() => sess.pending.size === 1);
  const [ask] = sess.pending.values();
  assert.equal(ask.requiresUserInteraction, true);
  assert.equal(ask.input.questions[0].question, '選哪個？');
  assert.deepEqual(ask.input.questions[0].options.map(o => o.label), ['A', 'B']);
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'watch' });
  await hub.respond(sess, ask.requestId, { behavior: 'allow', updatedInput: { ...ask.input, answers: { '選哪個？': 'B' } } }, 'allow');
  await until(() => res.done());
  assert.ok(res.texts().includes('picked:B'));
  hub.kill(sess); await until(() => sess.closed);
});

test('中斷：這一輪收掉、進程留著；回合中補話走 turn/steer', async () => {
  const { hub } = makeHub('intr');
  const sess = hub.start({ content: 'slow 3000', cwd: root, driver: 'codex' });
  await until(() => sess.lastSeq >= 4);
  await hub.send(sess, '順便', { midTurn: true });
  await until(() => rpcLog().some(r => r.method === 'turn/steer'));
  await hub.interrupt(sess);
  await until(() => !sess.turnActive, 3000, '這一輪收掉');
  assert.ok(!sess.closed);
  const ev = readFileSync(join(sess.runDir, 'events.jsonl'), 'utf8');
  assert.match(ev, /error_during_execution/);
  hub.kill(sess); await until(() => sess.closed);
});

test('伺服器重啟：Codex 的對話照跑，新 hub 接回來', async () => {
  const one = makeHub('restart');
  const sess = one.hub.start({ content: 'slow 1200', cwd: root, driver: 'codex' });
  await until(() => sess.lastSeq >= 3);
  one.hub.detachAll();
  await sleep(200);
  const two = makeHub('restart');
  assert.equal(two.hub.recover(), 1);
  const s2 = two.sessions.get(sess.runId);
  assert.equal(s2.driver, 'codex');
  const res = fakeRes();
  two.hub.attach(s2, res, { mode: 'stream', from: 3 });
  await until(() => res.done(), 5000);
  assert.ok(res.texts().includes('part9'));
  two.hub.kill(s2); await until(() => s2.closed);
});

test('接續（--resume 的等價）：帶 sessionId 走 thread/resume', async () => {
  const { hub } = makeHub('resume');
  const sess = hub.start({ content: 'hi', cwd: root, driver: 'codex', sessionId: 'thread-old-123' });
  await until(() => !sess.turnActive && sess.lastSeq > 0);
  assert.equal(sess.sid, 'thread-old-123');
  assert.ok(rpcLog().some(r => r.method === 'thread/resume' && r.params.threadId === 'thread-old-123'));
  hub.kill(sess); await until(() => sess.closed);
});

test('codex 當掉：記錯誤、對話結束', async () => {
  const { hub } = makeHub('crash');
  const sess = hub.start({ content: 'crash', cwd: root, driver: 'codex' });
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'post' });
  await until(() => sess.closed);
  assert.ok(res.events().some(e => e.type === 'error' && /Codex 異常退出（代碼 3）/.test(e.text)));
});

test('找不到 codex：講清楚怎麼辦', async () => {
  const sessions = new Map(), bySid = new Map();
  const hub = createHub({ sessions, bySid, dir: join(root, 'missing'), sockDir,
    env: () => ({ ...process.env, CODEX_PATH: join(root, 'no-codex') }), log: { log() {}, warn() {}, error() {} } });
  const sess = hub.start({ content: 'hi', cwd: root, driver: 'codex' });
  const res = fakeRes();
  hub.attach(sess, res, { mode: 'post' });
  await until(() => sess.closed);
  assert.ok(res.events().some(e => e.type === 'error' && /找不到 codex/.test(e.text)));
});
