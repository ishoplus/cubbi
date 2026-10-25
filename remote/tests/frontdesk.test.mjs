// 總務部：只有一段對話、沒有內建工具；派工要老闆按確認才由伺服器派，工具只認伺服器簽過名的結果
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, realpathSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-desk-')));
const PORT = 17087;
const projects = join(root, 'projects');
const argsDir = join(root, 'args');
let srv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const url = (p) => `http://127.0.0.1:${PORT}${p}`;
const H = { 'x-access-token': 'master-t', 'Content-Type': 'application/json' };

before(async () => {
  mkdirSync(join(projects, 'alpha'), { recursive: true });
  mkdirSync(argsDir);
  mkdirSync(join(root, 'home', 'remote'), { recursive: true });
  writeFileSync(join(root, 'home', 'remote', 'config.json'), JSON.stringify({ frontDesk: { roots: [projects] }, space: { transcripts: false, lang: 'zh' } }));
  srv = spawn(process.execPath, [join(here, '..', '..', 'bin', 'cubbi.js'), 'remote'], { cwd: root, stdio: 'ignore',
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), CUBBI_HOME: join(root, 'home'), PORT: String(PORT), ACCESS_TOKEN: 'master-t', SETUP_DONE: '1', WORK_ROOT: root,
      CLAUDE_PATH: join(here, 'fake-claude.mjs'), CODEX_PATH: '/nonexistent', AGENT_SOCK_DIR: join(root, 'sk'), FAKE_ARGS_DIR: argsDir } });
  for (let i = 0; i < 80; i++) { try { await fetch(url('/api/info')); return; } catch { await sleep(150); } }
});
after(() => { srv?.kill(); rmSync(root, { recursive: true, force: true }); });

// 讀 SSE 直到 pred 成立，回那一筆
async function until(res, pred, ms = 8000) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const ev = JSON.parse(line.slice(6));
      if (pred(ev)) { reader.cancel().catch(() => {}); return ev; }
    }
  }
  reader.cancel().catch(() => {});
  throw new Error('等不到事件');
}
const say = (prompt, extra = {}) => fetch(url('/api/claude'), { method: 'POST', headers: H, body: JSON.stringify({ prompt, desk: true, permMode: 'acceptEdits', cwd: projects, ...extra }) });
const respond = (runId, body) => fetch(url(`/api/claude/${runId}/respond`), { method: 'POST', headers: H, body: JSON.stringify(body) });
const watch = (sid) => fetch(url(`/api/claude/session/${sid}/watch`), { headers: H });

function mcp(env) {
  const p = spawn(process.execPath, [join(here, '..', 'desk-mcp.mjs')], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const waits = new Map();
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waits.get(m.id)?.(m); } });
  let n = 0;
  const call = (method, params) => new Promise(r => { const id = ++n; waits.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { call, close: () => p.kill() };
}

let deskSid, runId, signedInput;

test('總務部：開在工作根目錄、權限 manual、沒有內建工具、只載自己的 MCP', async () => {
  const proposal = { target: 'department', department: join(projects, 'alpha'), message: '幫 alpha 加 README', reason: 'alpha 的事' };
  const res = await say('desk ' + JSON.stringify(proposal));
  assert.equal(res.status, 200);
  const ask = await until(res, (e) => { if (e.type === 'run') runId = e.runId; return e.type === 'permission_request'; });
  assert.equal(ask.toolName, 'mcp__desk__dispatch');
  const info = await (await fetch(url('/api/info'), { headers: H })).json();
  deskSid = info.desk.sid;
  assert.ok(deskSid);
  const argv = JSON.parse(readFileSync(join(argsDir, deskSid + '.json'), 'utf8'));
  const at = (k) => argv[argv.indexOf(k) + 1];
  assert.equal(at('--tools'), '');
  assert.equal(at('--permission-mode'), 'manual');   // 前端送 acceptEdits 也不算
  assert.equal(at('--allowedTools'), 'mcp__desk__roster');
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.match(at('--mcp-config'), /desk-mcp\.mjs/);
  assert.match(at('--append-system-prompt'), /總務部/);
});

test('名冊：鑰匙或登入才拿得到；雜務部排第一', async () => {
  assert.equal((await fetch(url('/api/desk/roster'))).status, 401);
  assert.equal((await fetch(url('/api/desk/roster'), { headers: { 'x-desk-key': 'nope' } })).status, 401);
  const key = readFileSync(join(root, 'home', 'remote', 'desk-key'), 'utf8').trim();
  const r = await (await fetch(url('/api/desk/roster'), { headers: { 'x-desk-key': key } })).json();
  assert.equal(r.departments[0].errands, true);
  assert.equal(r.departments[0].cwd, join(projects, 'errands'));
  assert.ok(r.departments.some(d => d.cwd === join(projects, 'alpha')));
  assert.ok(!r.conversations.some(c => c.sid === deskSid), '總務部自己不在名冊上');
});

test('派不出去的：不回答，卡片留著', async () => {
  let r = await respond(runId, { requestId: 'req-1', behavior: 'allow', dispatch: { kind: 'department', cwd: '/etc', message: 'x' } });
  assert.equal(r.status, 400);
  r = await respond(runId, { requestId: 'req-1', behavior: 'allow', dispatch: { kind: 'new', name: '../evil', message: 'x' } });
  assert.equal(r.status, 400);
  assert.ok(!existsSync(join(root, 'evil')));
  r = await respond(runId, { requestId: 'req-1', behavior: 'allow', dispatch: { kind: 'conversation', sid: '00000000-0000-0000-0000-000000000000', message: 'x' } });
  assert.equal(r.status, 400);
});

test('老闆改派到雜務部、改了交代：伺服器真的開工，回給總務部的是簽過名的結果', async () => {
  const w = await watch(deskSid);
  const r = await respond(runId, { requestId: 'req-1', behavior: 'allow', dispatch: { kind: 'department', cwd: join(projects, 'errands'), message: '查一下天氣' } });
  assert.equal(r.status, 200);
  const ev = await until(w, (e) => e.type === 'assistant' && /dispatch:/.test(JSON.stringify(e)));
  const reply = JSON.parse(ev.message.content[0].text.slice('dispatch:'.length));
  assert.equal(reply.behavior, 'allow');
  signedInput = reply.updatedInput;
  assert.equal(signedInput.message, '查一下天氣');
  assert.ok(signedInput._receipt && signedInput._sig);
  assert.ok(existsSync(join(projects, 'errands')), '雜務部的資料夾開好了');
  // 派工單：做完一輪就記成做好了
  let d;
  for (let i = 0; i < 40; i++) {
    d = (await (await fetch(url('/api/desk'), { headers: H })).json()).dispatches[0];
    if (d?.state === 'done') break;
    await sleep(150);
  }
  assert.equal(d.dept, '雜務部');
  assert.equal(d.state, 'done');
  assert.match(d.lastText, /總務部轉交/);
  const workerArgs = JSON.parse(readFileSync(join(argsDir, d.sid + '.json'), 'utf8'));
  assert.ok(!workerArgs.includes('--strict-mcp-config'), '派出去的對話是一般的對話');
});

test('工具：只認伺服器簽過名的結果；沒簽、亂簽都說沒派', async () => {
  const key = readFileSync(join(root, 'home', 'remote', 'desk-key'), 'utf8').trim();
  const m = mcp({ CUBBI_DESK_URL: url(''), CUBBI_DESK_KEY: key, CUBBI_LANG: 'zh' });
  try {
    await m.call('initialize', { protocolVersion: '2025-06-18' });
    const tools = (await m.call('tools/list')).result.tools.map(t => t.name);
    assert.deepEqual(tools.sort(), ['dispatch', 'roster']);
    const ok = (await m.call('tools/call', { name: 'dispatch', arguments: signedInput })).result;
    assert.ok(!ok.isError);
    assert.match(ok.content[0].text, /已派出/);
    assert.match(ok.content[0].text, /老闆改過交代/);
    const forged = (await m.call('tools/call', { name: 'dispatch', arguments: { ...signedInput, _receipt: signedInput._receipt.replace('雜務部', 'alpha') } })).result;
    assert.ok(forged.isError);
    const bare = (await m.call('tools/call', { name: 'dispatch', arguments: { target: 'department', message: 'x', reason: 'y' } })).result;
    assert.ok(bare.isError);
    const roster = (await m.call('tools/call', { name: 'roster', arguments: {} })).result;
    assert.match(roster.content[0].text, /雜務部/);
    assert.match(roster.content[0].text, /派工單/);
  } finally { m.close(); }
});

test('只有一段：再開總務部（不帶 session）也接回同一段', async () => {
  const res = await say('hello again');
  assert.equal(res.status, 200);
  const ev = await until(res, (e) => e.type === 'assistant');
  assert.match(JSON.stringify(ev), /echo:hello again/);
  const info = await (await fetch(url('/api/info'), { headers: H })).json();
  assert.equal(info.desk.sid, deskSid);
});

test('不要派：回給總務部的是拒絕，什麼都沒開', async () => {
  const before = (await (await fetch(url('/api/desk'), { headers: H })).json()).dispatches.length;
  const res = await say('desk ' + JSON.stringify({ target: 'new_department', new_name: 'beta', message: 'x', reason: 'y' }));
  const ask = await until(res, (e) => { if (e.type === 'run') runId = e.runId; return e.type === 'permission_request'; });
  const w = await watch(deskSid);
  assert.equal((await respond(runId, { requestId: ask.requestId, behavior: 'deny', message: 'no' })).status, 200);
  const ev = await until(w, (e) => e.type === 'assistant' && /dispatch:/.test(JSON.stringify(e)));
  assert.match(ev.message.content[0].text, /"behavior":"deny"/);
  assert.ok(!existsSync(join(projects, 'beta')));
  assert.equal((await (await fetch(url('/api/desk'), { headers: H })).json()).dispatches.length, before);
});
