// ── AgentHub：網頁伺服器這邊，管所有 shim 的連線 ─────────────────────────────────
//
// 每段對話一個 agent-shim.mjs（detached），持有 claude、寫日誌。這裡只是客戶端：
//   - 開新對話：寫 meta.json、起 shim、連 socket
//   - 開機：掃 data/agents/*/state.json，沒結束的接回去（伺服器重啟不打斷代理人）
//   - 對前端：SSE 每筆帶 id: <seq>，重連帶 ?from= 從日誌補；同一段對話可以好幾個分頁一起聽
//
// sess 物件跟原本記憶體版的欄位一樣（turnActive、pending、bgTasks、act…），
// 放進同一個 sessions／bySid，space.js、ideas、Cubbi 不用分辨是哪一種。
import { spawn } from 'child_process';
import { connect } from 'net';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, openSync, closeSync, statSync, rmSync, renameSync, lstatSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RING = 1000;   // 每段對話在記憶體留最近幾筆，補送大多不用讀檔
const KEEP_DAYS = 14;

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

function readLog(runDir, fromSeq) {
  const out = [];
  let text = '';
  try { text = readFileSync(join(runDir, 'events.jsonl'), 'utf8'); } catch { return out; }
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { const ev = JSON.parse(l); if (ev.seq > fromSeq) out.push(ev); } catch {}
  }
  return out;
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}
function sseSend(res, ev) {
  // 日誌裡的事件帶號碼，前端記著，重連時用 ?from= 要回來
  try { res.write((ev.seq != null ? `id: ${ev.seq}\n` : '') + `data: ${JSON.stringify(ev.data)}\n\n`); return true; } catch { return false; }
}
function sseRaw(res, obj) { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }
function sseDone(res) { try { res.write('data: [DONE]\n\n'); res.end(); } catch {} }

export function createHub({
  sessions, bySid,
  dir,                                   // data/agents
  sockDir,                               // unix socket 放這（路徑長度上限 104，不能放進 data/agents 深處）
  env = () => ({ ...process.env }),      // shim（也就是 claude）的環境變數
  shimPath = join(__dirname, 'agent-shim.mjs'),
  onEvent = () => {},                    // (sess, data)：每個事件（含逐字 delta）
  onState = () => {},                    // (sess)：狀態變了
  log = console,
}) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  // socket 放在共用的 /tmp：要是別人先建了這個資料夾，他就能換掉 socket、偷聽或假冒對話。不是自己的、別人讀寫得到，就不用
  const st = lstatSync(sockDir);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid())) throw new Error(`${sockDir} 不是你的資料夾，不能放對話的 socket（換一個：AGENT_SOCK_DIR）`);
  if (st.mode & 0o077) chmodSync(sockDir, 0o700);

  function makeSess(meta, st) {
    const sess = {
      shim: true,
      driver: meta.driver || 'claude',
      runId: meta.runId, runDir: join(dir, meta.runId), sock: meta.sock,
      cwd: meta.cwd, model: meta.model || '', permMode: st?.permMode ?? meta.permMode ?? '',
      sid: st?.sid || meta.sessionId || meta.newSessionId || null,
      firstPrompt: meta.firstPrompt || '',
      turnActive: !!st?.turnActive, turnStartSeq: st?.turnStartSeq || 0,
      pending: new Map((st?.pending || []).map(a => [a.requestId, a])),
      bgTasks: st?.bgTasks || [],
      lastActivity: st?.lastActivity || Date.now(),
      shimPid: st?.shimPid || null,
      closed: false,
      act: { kind: 'think' },
      lastSeq: 0, ring: [],
      clients: new Set(),
      conn: null, connected: false, queue: [], acks: new Map(), nextAck: 1, retries: 0,
    };
    sessions.set(sess.runId, sess);
    if (sess.sid) bySid.set(sess.sid, sess);
    return sess;
  }

  function applyState(sess, st) {
    if (st.sid && st.sid !== sess.sid) {
      if (sess.sid && bySid.get(sess.sid) === sess) bySid.delete(sess.sid);
      sess.sid = st.sid;
      bySid.set(sess.sid, sess);
    }
    sess.turnActive = !!st.turnActive;
    sess.turnStartSeq = st.turnStartSeq || 0;
    sess.pending = new Map((st.pending || []).map(a => [a.requestId, a]));
    sess.bgTasks = st.bgTasks || [];
    sess.permMode = st.permMode ?? sess.permMode;
    sess.shimPid = st.shimPid || sess.shimPid;
    if (st.lastActivity) sess.lastActivity = Math.max(sess.lastActivity, st.lastActivity);
    sess.slashCommands = st.slashCommands || sess.slashCommands;
    if (st.reason) sess.reason = st.reason;
    onState(sess);
  }

  // ── 跟 shim 的連線 ──────────────────────────────────────────────────────────
  function request(sess, op, args = {}) {
    return new Promise((resolve, reject) => {
      if (sess.closed) return reject(new Error('對話已結束'));
      const id = sess.nextAck++;
      sess.acks.set(id, { resolve, reject });
      const line = JSON.stringify({ op, id, ...args }) + '\n';
      if (sess.connected) sess.conn.write(line);
      else sess.queue.push(line);
    });
  }

  function onMessage(sess, msg) {
    if (msg.ack != null) {
      const a = sess.acks.get(msg.ack);
      sess.acks.delete(msg.ack);
      if (a) msg.ok ? a.resolve(msg) : a.reject(new Error(msg.error || '失敗'));
      return;
    }
    if (msg.op === 'state') { applyState(sess, msg.state); return; }
    if (msg.seq === undefined) return;
    if (msg.seq === null) {   // 逐字 delta：不記號、不補送
      if (msg.data) { onEvent(sess, msg.data); for (const c of sess.clients) sseSend(c.res, msg); }
      return;
    }
    if (msg.seq <= sess.lastSeq) return;   // 重連時重疊的部分
    if (msg.seq > sess.lastSeq + 1) {
      // 不該發生：shim 先寫日誌才廣播。真的跳號就從檔案補
      for (const ev of readLog(sess.runDir, sess.lastSeq)) if (ev.seq < msg.seq) deliver(sess, ev);
    }
    deliver(sess, msg);
  }

  function deliver(sess, ev) {
    sess.lastSeq = ev.seq;
    sess.ring.push(ev);
    if (sess.ring.length > RING) sess.ring.splice(0, sess.ring.length - RING);
    sess.lastActivity = ev.ts || Date.now();
    if (ev.data) onEvent(sess, ev.data);
    for (const c of [...sess.clients]) {
      if (ev.data) sseSend(c.res, ev);
      if (ev.kind === 'turn_end') dropClient(sess, c, true);   // 一輪結束：跟以前一樣 [DONE] 收掉這條
    }
    if (ev.kind === 'exit') {
      // 結束原因：shim 在送 exit 之前已經寫進 state.json（之後的 state 廣播來不及，連線馬上就關）
      const st = readJson(join(sess.runDir, 'state.json'));
      if (st?.reason) sess.reason = st.reason;
      markClosed(sess);
    }
  }

  function connectShim(sess) {
    const conn = connect(sess.sock);
    sess.conn = conn;
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('connect', () => {
      sess.retries = 0;
      // hello 拿狀態、subscribe 從我手上最後一個號碼接著要；這兩個要排在其他指令前面
      conn.write(JSON.stringify({ op: 'hello', id: 0 }) + '\n');
      conn.write(JSON.stringify({ op: 'subscribe', id: -1, fromSeq: sess.lastSeq }) + '\n');
      sess.connected = true;
      for (const l of sess.queue.splice(0)) conn.write(l);
    });
    conn.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l) continue;
        let msg; try { msg = JSON.parse(l); } catch { continue; }
        if (msg.ack === 0 && msg.state) { applyState(sess, msg.state); continue; }
        if (msg.ack === -1) continue;
        onMessage(sess, msg);
      }
    });
    conn.on('error', () => {});
    conn.on('close', () => {
      if (sess.conn !== conn) return;
      sess.connected = false;
      if (sess.closed || sess.detached) return;
      // shim 還活著（剛起還沒 listen，或連線被意外斷）就再接；死了就是 lost
      const st = readJson(join(sess.runDir, 'state.json'));
      if (st?.closed) { catchUp(sess); markClosed(sess); return; }
      const pid = st?.shimPid || sess.shimPid;
      if ((pid && alive(pid)) || (!pid && sess.retries < 50)) {
        sess.retries++;
        setTimeout(() => { if (!sess.closed && !sess.detached) connectShim(sess); }, Math.min(100 * sess.retries, 2000));
        return;
      }
      lost(sess, 'shim 不見了');
    });
  }

  // shim 已經結束、socket 也關了：把日誌剩下的讀進來再收
  function catchUp(sess) { for (const ev of readLog(sess.runDir, sess.lastSeq)) deliver(sess, ev); }

  function lost(sess, why) {
    log.warn?.(`[hub ${sess.runId}] ${why}，標成 lost`);
    const f = join(sess.runDir, 'state.json');
    const st = readJson(f) || {};
    sess.reason = 'lost';
    if (!st.closed) {
      st.closed = true; st.reason = 'lost'; st.turnActive = false; st.pending = [];
      try { writeFileSync(f + '.tmp', JSON.stringify(st)); renameSync(f + '.tmp', f); } catch {}
    }
    for (const c of [...sess.clients]) { sseRaw(c.res, { type: 'error', text: '代理人進程意外結束，可以接著送訊息（會用 --resume 接續）' }); }
    markClosed(sess);
  }

  function markClosed(sess) {
    if (sess.closed) return;
    sess.closed = true;
    sess.turnActive = false;
    sess.pending.clear();
    for (const c of [...sess.clients]) dropClient(sess, c, true);
    for (const a of sess.acks.values()) a.reject(new Error('對話已結束'));
    sess.acks.clear();
    try { sess.conn?.destroy(); } catch {}
    sessions.delete(sess.runId);
    if (sess.sid && bySid.get(sess.sid) === sess) bySid.delete(sess.sid);
    onState(sess);
    log.log?.(`[hub ${sess.runId}] 結束，剩餘 session=${sessions.size}`);
  }

  // ── 對外 ────────────────────────────────────────────────────────────────────
  function start({ content, cwd, model, permMode, sessionId, newSessionId, appendSystemPrompt, driver = 'claude' }) {
    const runId = crypto.randomUUID();
    const runDir = join(dir, runId);
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const firstPrompt = typeof content === 'string' ? content : (content.find?.(b => b.type === 'text')?.text || '');
    const meta = {
      runId, driver, cwd, model: model || '', permMode: permMode || '',
      sessionId: sessionId || null, newSessionId: newSessionId || null, appendSystemPrompt: appendSystemPrompt || null,
      sock: join(sockDir, `${runId}.sock`), createdAt: Date.now(), firstPrompt: firstPrompt.slice(0, 2000),
    };
    writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
    const out = openSync(join(runDir, 'shim.log'), 'a');
    const proc = spawn(process.execPath, [shimPath, runDir], {
      cwd: runDir, env: env(), detached: true, stdio: ['ignore', out, out],
    });
    closeSync(out);
    proc.unref();
    const sess = makeSess(meta, null);
    sess.shimPid = proc.pid;
    sess.turnActive = true;   // send 的 ack 回來前先當成在跑，跟原本一樣
    proc.on('error', (e) => lost(sess, `shim 起不來：${e.message}`));
    connectShim(sess);
    send(sess, content).catch(e => log.error?.(`[hub ${runId}] 第一則訊息送不出去：${e.message}`));
    return sess;
  }

  // 開機：把沒結束的接回來
  function recover() {
    let n = 0;
    for (const id of readdirSync(dir)) {
      const runDir = join(dir, id);
      const meta = readJson(join(runDir, 'meta.json'));
      const st = readJson(join(runDir, 'state.json'));
      if (!meta || !st || st.closed) continue;
      if (!alive(st.shimPid)) {
        st.closed = true; st.reason = 'lost'; st.turnActive = false; st.pending = [];
        try { writeFileSync(join(runDir, 'state.json'), JSON.stringify(st)); } catch {}
        log.warn?.(`[hub ${id}] shim 不在了（可能重開過機），標成 lost`);
        continue;
      }
      const sess = makeSess(meta, st);
      for (const ev of readLog(runDir, 0)) { sess.lastSeq = ev.seq; sess.ring.push(ev); }
      if (sess.ring.length > RING) sess.ring.splice(0, sess.ring.length - RING);
      connectShim(sess);
      n++;
    }
    if (n) log.log?.(`[hub] 接回 ${n} 段還在跑的對話`);
    return n;
  }

  // 前端掛上來聽。mode：'post' 新的一輪、'stream' 一輪中斷線重連、'watch' 回合之間掛著聽
  // from：前端最後收到的號碼；沒帶時 post 從現在開始、stream 從這一輪開頭、watch 只補沒答的提問
  function attach(sess, res, { mode = 'stream', from } = {}) {
    sseHeaders(res);
    sseRaw(res, { type: 'run', runId: sess.runId });
    sseRaw(res, { type: 'state', turnActive: sess.turnActive, bgTasks: sess.bgTasks });
    const fromSeq = from != null && Number.isFinite(+from) ? Math.max(0, +from)
      : mode === 'post' ? sess.lastSeq
      : mode === 'stream' ? sess.turnStartSeq
      : null;
    if (fromSeq == null) {
      for (const ask of sess.pending.values()) sseRaw(res, ask);
    } else if (fromSeq < sess.lastSeq) {
      const backlog = sess.ring.length && sess.ring[0].seq <= fromSeq + 1
        ? sess.ring.filter(ev => ev.seq > fromSeq)
        : readLog(sess.runDir, fromSeq).filter(ev => ev.seq <= sess.lastSeq);
      for (const ev of backlog) {
        if (ev.data) sseSend(res, ev);
        if (ev.kind === 'turn_end') { sseDone(res); return; }   // 補到一輪的結尾就收，前端再用 /watch 接後面的
        if (ev.kind === 'exit') { sseDone(res); return; }
      }
    }
    if (sess.closed || (mode === 'stream' && !sess.turnActive)) { sseDone(res); return; }
    const c = { res, heartbeat: setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000) };
    sess.clients.add(c);
    res.on('close', () => { clearInterval(c.heartbeat); sess.clients.delete(c); });
    onState(sess);
  }

  function dropClient(sess, c, done) {
    clearInterval(c.heartbeat);
    sess.clients.delete(c);
    if (done) sseDone(c.res);
    else try { c.res.destroy(); } catch {}
  }

  function send(sess, content, { midTurn = false } = {}) {
    if (!midTurn) { sess.turnActive = true; sess.act = { kind: 'think' }; }
    sess.lastActivity = Date.now();
    return request(sess, 'send', { content, midTurn });
  }
  const respond = (sess, requestId, response, behavior) => { sess.pending.delete(requestId); return request(sess, 'respond', { requestId, response, behavior }); };
  const interrupt = (sess) => { sess.pending.clear(); return request(sess, 'interrupt'); };
  const setMode = (sess, permMode) => { sess.permMode = permMode; return request(sess, 'set_mode', { permMode }); };
  function kill(sess, reason) {
    if (sess.closed) return;
    if (sess.connected) request(sess, 'kill', { reason }).catch(() => {});
    else if (alive(sess.shimPid)) { try { process.kill(sess.shimPid, 'SIGTERM'); } catch {} }
    else lost(sess, '要收的時候已經不在');
  }

  // 伺服器要關了：只斷線，不動 shim。前端的 SSE 直接斷（不送 [DONE]），它會重連到新版
  function detachAll() {
    for (const sess of sessions.values()) {
      if (!sess.shim) continue;
      sess.detached = true;
      for (const c of [...sess.clients]) dropClient(sess, c, false);
      try { sess.conn?.destroy(); } catch {}
    }
  }

  // 結束超過 14 天的目錄刪掉
  function cleanup(now = Date.now()) {
    let n = 0;
    for (const id of readdirSync(dir)) {
      const f = join(dir, id, 'state.json');
      const st = readJson(f);
      if (!st?.closed) continue;
      try { if (now - statSync(f).mtimeMs < KEEP_DAYS * 86400000) continue; } catch { continue; }
      rmSync(join(dir, id), { recursive: true, force: true });
      n++;
    }
    return n;
  }

  // 這段對話原本是哪一家：接續時要用同一家（兩家的對話紀錄格式不同，不能中途換）。
  // 活著的看 sessions；結束的翻 shim 留下的目錄（最近的那個為準），找不到回 null（例如終端機開的 Claude 對話）
  const sidDriver = new Map();
  function driverOf(sid) {
    if (!sid) return null;
    for (const s of sessions.values()) if (s.sid === sid) return s.driver || 'claude';
    if (sidDriver.has(sid)) return sidDriver.get(sid);
    let best = null;
    for (const id of readdirSync(dir)) {
      const st = readJson(join(dir, id, 'state.json'));
      if (st?.sid !== sid) continue;
      const meta = readJson(join(dir, id, 'meta.json'));
      if (!best || (meta?.createdAt || 0) > best.at) best = { at: meta?.createdAt || 0, driver: meta?.driver || 'claude' };
    }
    if (best) sidDriver.set(sid, best.driver);
    return best?.driver || null;
  }

  return { start, recover, attach, send, respond, interrupt, setMode, kill, detachAll, cleanup, driverOf };
}
