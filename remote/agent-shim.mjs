#!/usr/bin/env node
// ── 代理人 shim：一段對話一個，持有 claude 的管線 ────────────────────────────────
//
// 設計見 docs/設計-代理人進程與事件日誌.md。網頁伺服器只是客戶端：它重啟時這裡照跑，
// 事件寫進 events.jsonl（每筆帶流水號 seq），伺服器回來後從上次的號碼補齊。
//
//   node agent-shim.mjs <runDir>
//
// runDir/meta.json 由伺服器先寫好（runId、cwd、model、permMode、sessionId／newSessionId、sock）。
// 這裡刻意保持很小、很少改：不碰登入、HTTP、Cubbi，常改的東西都留在伺服器。
import { spawn } from 'child_process';
import { createServer } from 'net';
import { readFileSync, writeFileSync, renameSync, appendFileSync, unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { claudePath, killTree, friendlyClaudeError } from './shared.js';

export const SHIM_VERSION = 2;   // 2：meta.appendSystemPrompt

const runDir = process.argv[2];
if (!runDir) { console.error('用法：node agent-shim.mjs <runDir>'); process.exit(2); }
const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
const LOG = join(runDir, 'events.jsonl');
const STATE = join(runDir, 'state.json');

const num = (k, d) => parseInt(process.env[k] || String(d), 10);
// 四種寬限，跟原本 server.js 的 sess.watchdog 一樣；伺服器不在時這裡照樣會收
const IDLE_MS = num('CLAUDE_TIMEOUT_MS', 1800000);          // 回合中沒動靜
const ANSWER_MS = num('CLAUDE_ANSWER_TIMEOUT_MS', 7200000); // 等人回答
const KEEPALIVE_MS = num('CLAUDE_KEEPALIVE_MS', 1800000);   // 回合結束閒著
const BG_MAX_MS = num('CLAUDE_BG_MAX_MS', 21600000);        // 有背景任務但沒動靜
const WATCHDOG_MS = num('AGENT_WATCHDOG_MS', 15000);
const LOG_CAP = num('AGENT_LOG_CAP_BYTES', 50 * 1024 * 1024);

process.umask(0o077);   // socket、日誌、狀態檔只有自己讀得到
process.on('uncaughtException', (e) => console.error('[shim] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[shim] unhandledRejection:', e));

// 會變的狀態：每次變就原子寫進 state.json，伺服器重啟後光看它就知道這段對話在做什麼
const state = {
  shimVersion: SHIM_VERSION,
  shimPid: process.pid,
  claudePid: null,
  sid: meta.sessionId || meta.newSessionId || null,
  permMode: meta.permMode || '',
  turnActive: false,
  turnStartSeq: 0,      // 這一輪從哪個號碼之後開始：重連沒帶號碼時從這裡補
  pending: [],          // 還沒答的提問（permission_request 原樣）
  bgTasks: [],
  slashCommands: null,
  lastSeq: 0,
  lastActivity: Date.now(),
  closed: false,
  reason: null,
};
let seq = 0, logBytes = 0, logCapped = false;
if (existsSync(LOG)) {   // 不該發生（shim 一個目錄只跑一次），保險起見接著號碼寫
  const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length) seq = JSON.parse(lines[lines.length - 1]).seq;
  logBytes = statSync(LOG).size;
}

function saveState() {
  state.lastSeq = seq;
  const tmp = STATE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, STATE);
}
// lastActivity 變得很頻繁（每個 delta），節流寫；其他欄位變了立刻寫
let saveTimer = null;
function saveSoon() { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveState(); }, 2000); }
function changed() { clearTimeout(saveTimer); saveTimer = null; saveState(); broadcast({ op: 'state', state }); }

// ── 客戶端（網頁伺服器，可以同時好幾個）─────────────────────────────────────────
const clients = new Set();   // { sock, live }
function writeTo(c, obj) { try { c.sock.write(JSON.stringify(obj) + '\n'); } catch {} }
function broadcast(obj) { for (const c of clients) if (c.live) writeTo(c, obj); }

// 記一筆事件：寫日誌（逐字 delta 除外）、廣播。data＝前端照舊渲染的那個物件
function record(kind, data) {
  state.lastActivity = Date.now();
  if (kind === 'delta') { broadcast({ seq: null, ts: state.lastActivity, kind, data }); saveSoon(); return; }
  const ev = { seq: ++seq, ts: state.lastActivity, kind, data };
  let line = JSON.stringify(ev);
  if (logBytes + line.length > LOG_CAP && kind === 'tool_result') {
    // 日誌太大：工具結果只留摘要，對話本身照記
    line = JSON.stringify({ ...ev, data: { type: 'user', message: { role: 'user', content: [] }, truncated: true } });
    if (!logCapped) { logCapped = true; console.warn(`[shim] 日誌超過 ${LOG_CAP} bytes，之後的工具結果只留摘要`); }
  }
  appendFileSync(LOG, line + '\n');
  logBytes += line.length + 1;
  broadcast(ev);
  saveSoon();
  return ev;
}

function readLogSince(fromSeq) {
  if (!existsSync(LOG)) return [];
  const out = [];
  for (const l of readFileSync(LOG, 'utf8').split('\n')) {
    if (!l) continue;
    try { const ev = JSON.parse(l); if (ev.seq > fromSeq) out.push(ev); } catch {}
  }
  return out;
}

// ── claude ───────────────────────────────────────────────────────────────────
const args = [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-prompt-tool', 'stdio',
];
if (meta.model) args.push('--model', meta.model);
if (meta.permMode) args.push('--permission-mode', meta.permMode);
if (meta.appendSystemPrompt) args.push('--append-system-prompt', meta.appendSystemPrompt);
if (meta.sessionId) args.push('--resume', meta.sessionId);
else if (meta.newSessionId) args.push('--session-id', meta.newSessionId);

// 自己的設定不傳給 claude（它底下的工具也看得到環境變數）
const childEnv = { ...process.env };
for (const k of Object.keys(childEnv)) if (k.startsWith('AGENT_')) delete childEnv[k];

const proc = spawn(claudePath, args, { cwd: meta.cwd, env: childEnv, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
state.claudePid = proc.pid || null;
const send = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });

let sawResult = false, abortGuard = null, ended = false;
let stdoutBuf = '';
proc.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  const lines = stdoutBuf.split('\n');
  stdoutBuf = lines.pop();
  for (const line of lines) handleLine(line);
});
proc.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  console.error(`[claude stderr] ${text.trim()}`);
  record('error', { type: 'error', text: friendlyClaudeError(text) || text });
});
proc.on('close', (code) => {
  if (stdoutBuf.trim()) handleLine(stdoutBuf);
  if (code && !sawResult) record('error', { type: 'error', text: `Claude 異常退出（代碼 ${code}）` });
  finish(`exit-${code}`);
});
proc.on('error', (e) => {
  record('error', { type: 'error', text: e.code === 'ENOENT' ? `找不到 claude 指令（${claudePath}），請設定 CLAUDE_PATH` : e.message });
  finish('spawn-error');
});

function kindOf(p) {
  if (p.type === 'user' && Array.isArray(p.message?.content) && p.message.content.some(b => b.type === 'tool_result')) return 'tool_result';
  if (p.type === 'assistant') return 'assistant';
  if (p.type === 'system') return p.subtype === 'background_tasks_changed' ? 'bg_tasks' : 'system';
  return p.type || 'other';
}

function handleLine(line) {
  if (!line || !line.trim()) return;
  let p;
  try { p = JSON.parse(line); }
  catch { record('text', { type: 'text', text: line }); return; }

  if (p.type === 'control_request' && p.request?.subtype === 'can_use_tool') {
    const r = p.request;
    const ask = {
      type: 'permission_request',
      requestId: p.request_id,
      toolName: r.tool_name,
      displayName: r.display_name || r.tool_name,
      input: r.input,
      requiresUserInteraction: !!r.requires_user_interaction,
      suggestions: r.permission_suggestions || [],
      reason: r.decision_reason || '',
    };
    state.pending.push(ask);
    record('ask', ask);
    changed();
    return;
  }
  if (p.type === 'control_response' || p.type === 'control_cancel_request') return;
  if (p.type === 'stream_event') { record('delta', p); return; }

  let dirty = false;
  if (p.type === 'system') {
    if (p.session_id && p.session_id !== state.sid) { state.sid = p.session_id; dirty = true; }
    if (p.subtype === 'background_tasks_changed') { state.bgTasks = p.tasks || []; dirty = true; }
    if (p.subtype === 'init' && Array.isArray(p.slash_commands)) { state.slashCommands = p.slash_commands; dirty = true; }
    // 背景任務做完，claude 會自己開一輪回報
    if ((p.subtype === 'task_notification' || p.subtype === 'init') && !state.turnActive) {
      state.turnActive = true; state.turnStartSeq = seq; dirty = true;
    }
  }
  if (p.type === 'result') {
    sawResult = true;
    state.turnActive = false;
    clearTimeout(abortGuard);
    record('turn_end', p);
    changed();
    if (KEEPALIVE_MS <= 0) endTurn();
    return;
  }
  record(kindOf(p), p);
  if (dirty) changed();
}

function endTurn() {
  if (ended) return;
  try { proc.stdin.end(); } catch {}
  setTimeout(() => finish('no-exit-after-result'), num('CLAUDE_EXIT_GRACE_MS', 10000)).unref();
}

// 收工：整棵進程樹收乾淨、記 exit、通知客戶端，關 socket 後自己退出。目錄留著給歷史和 Cubbi
function finish(reason) {
  if (ended) return;
  ended = true;
  clearInterval(watchdog);
  clearTimeout(abortGuard);
  killTree(proc, 'SIGKILL');
  state.closed = true;
  state.reason = state.reason || reason;
  state.turnActive = false;
  state.pending = [];
  saveState();   // 先落地再廣播：客戶端收到 exit 時去讀 state.json 一定看得到結束原因
  record('exit', null);
  changed();
  console.log(`[shim] 結束（${state.reason}）`);
  setTimeout(() => {
    for (const c of clients) try { c.sock.end(); } catch {}
    server.close();
    try { unlinkSync(meta.sock); } catch {}
    process.exit(0);
  }, 300);
}

function kill(reason) {
  state.reason = reason || 'killed';
  finish(state.reason);
}

const watchdog = setInterval(() => {
  const idle = Date.now() - state.lastActivity;
  const waiting = state.pending.length > 0;
  const [limit, what] = waiting ? [ANSWER_MS, '等回覆']
    : state.turnActive ? [IDLE_MS, 'idle']
    : state.bgTasks.length ? [BG_MAX_MS, '背景任務無動靜']
    : [KEEPALIVE_MS, '閒置'];
  if (idle <= limit) return;
  console.warn(`[shim] ${what} 逾時 ${idle}ms`);
  if (state.turnActive || waiting) record('error', { type: 'error', text: waiting ? '等待回覆逾時，已中止' : '執行逾時，已中止' });
  kill(state.turnActive || waiting ? 'timeout' : 'keepalive-expired');
}, WATCHDOG_MS);

// ── 指令 ─────────────────────────────────────────────────────────────────────
const ops = {
  hello: () => ({ version: SHIM_VERSION, runId: meta.runId, state }),
  subscribe(c, { fromSeq = 0 }) {
    // 先補、再即時：同一個 tick 裡做完，中間不會漏號
    for (const ev of readLogSince(fromSeq)) writeTo(c, ev);
    c.live = true;
    writeTo(c, { op: 'state', state });
    return {};
  },
  send(c, { content, midTurn }) {
    if (ended) throw new Error('對話已結束');
    if (!midTurn) {
      if (state.pending.length) throw new Error('這段對話還有提問沒回答');
      state.turnActive = true; state.turnStartSeq = seq; sawResult = false;
    }
    state.lastActivity = Date.now();
    send({ type: 'user', message: { role: 'user', content } });
    if (!midTurn) changed();
    return {};
  },
  respond(c, { requestId, response, behavior }) {
    const i = state.pending.findIndex(a => a.requestId === requestId);
    if (i < 0) throw new Error('這個提問已經回答過或已失效');
    state.pending.splice(i, 1);
    send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    record('ask_resolved', { type: 'permission_resolved', requestId, behavior });
    changed();
    return {};
  },
  interrupt() {
    // 停這一輪，不是整個進程：沒答的提問先拒掉，不然 claude 卡在等答案收不了
    for (const a of state.pending) {
      send({ type: 'control_response', response: { subtype: 'success', request_id: a.requestId, response: { behavior: 'deny', message: 'User aborted.' } } });
    }
    state.pending = [];
    send({ type: 'control_request', request_id: 'abort-' + Date.now(), request: { subtype: 'interrupt' } });
    clearTimeout(abortGuard);
    abortGuard = setTimeout(() => { if (state.turnActive) kill('user-abort'); }, num('AGENT_ABORT_GRACE_MS', 8000));
    changed();
    return {};
  },
  set_mode(c, { permMode }) {
    send({ type: 'control_request', request_id: 'mode-' + Date.now(), request: { subtype: 'set_permission_mode', mode: permMode || 'manual' } });
    state.permMode = permMode || '';
    changed();
    return {};
  },
  kill(c, { reason }) { setImmediate(() => kill(reason)); return {}; },
};

const server = createServer((sock) => {
  const c = { sock, live: false };
  clients.add(c);
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      let msg;
      try { msg = JSON.parse(l); } catch { continue; }
      const fn = ops[msg.op];
      try {
        if (!fn) throw new Error(`不認得的指令 ${msg.op}`);
        const r = fn(c, msg) || {};
        if (msg.id != null) writeTo(c, { ack: msg.id, ok: true, ...r });
      } catch (e) {
        if (msg.id != null) writeTo(c, { ack: msg.id, ok: false, error: e.message });
      }
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => clients.delete(c));
});
try { unlinkSync(meta.sock); } catch {}
server.listen(meta.sock, () => {
  saveState();
  console.log(`[shim v${SHIM_VERSION}] ${meta.runId} 就緒，claude pid ${proc.pid}`);
});
// 系統要收掉 shim（例如登出）：claude 一起收，不留孤兒
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => kill('signal-' + sig));
