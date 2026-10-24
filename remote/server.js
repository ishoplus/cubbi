import express from 'express';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { createReadStream } from 'fs';
import { readFile, stat, readdir, rm, mkdir, rename } from 'fs/promises';
import { join, dirname, resolve, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { dataFile } from './paths.js';
import { createRequire } from 'module';
const CUBBI_VERSION = createRequire(import.meta.url)('../package.json').version;
import multer from 'multer';
import { ZipArchive } from 'archiver';
import {
  WORK_ROOT, claudePath, claudeEnv, RELOGIN_HINT, killTree, friendlyClaudeError, isInsideRoot, safePath,
} from './shared.js';
import { tasksRouter, initTasks, shutdownTasks, busyTasks, attentionTasks } from './tasks.js';
import { spaceRouter, trackEvent, touch as spaceTouch, broadcast as spaceBroadcast, coreInbox } from './space.js';
import { flushEconomy } from './economy.js';
import { loadPlugins } from './plugins.js';
import { createLab } from './ideas/lab.js';
import { ideasPlugin } from './ideas/plugin.js';
import { schedulePlugin } from './schedule/plugin.js';
import { createRoutines, runCmd } from './routines.js';
import { spaceWeb } from '../server/index.js';
import { initNames } from './names.js';
import { checkToken, authRoutes, sessionRoutes, issueTicket } from './auth.js';
import { connectRoutes } from './connect.js';
import { createHub } from './agent-hub.js';
import { createReview } from './review.js';
import { config, CONFIG_FILE, saveConfig, expandHome } from './config.js';
import { startTunnel, publicUrl, tunnelKind } from './tunnel.js';
import { getWorktree, createWorktree, worktreeBrief, repoRoot, rekeyWorktree } from './worktree.js';
import { createDrivers } from './drivers.js';
import { codexHistory } from '../server/codex.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 17000;
// 預設只聽本機：外網一律經 cloudflared 進來，不讓同一個 Wi-Fi 的設備繞過去直連。要開放區網再設 HOST=0.0.0.0
const HOST = process.env.HOST || '127.0.0.1';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || crypto.randomBytes(16).toString('hex');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '4', 10);
// 同時「執行中」的上限；停下來等人回答的不算在內
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || String(MAX_CONCURRENT * 4), 10);
const CLAUDE_IDLE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '1800000', 10); // 30 min，跑到一半沒動靜
const CLAUDE_ANSWER_TIMEOUT_MS = parseInt(process.env.CLAUDE_ANSWER_TIMEOUT_MS || '7200000', 10); // 2h，停下來等人回答
const CLAUDE_ORPHAN_GRACE_MS = parseInt(process.env.CLAUDE_ORPHAN_GRACE_MS || '300000', 10); // 5 min，斷線後保留等重連
const MAX_BUFFERED_EVENTS = parseInt(process.env.MAX_BUFFERED_EVENTS || '2000', 10);
const CLAUDE_EXIT_GRACE_MS = parseInt(process.env.CLAUDE_EXIT_GRACE_MS || '10000', 10); // result 後等它自己退出的寬限
// 回合結束後進程留著：背景任務（run_in_background 的指令、背景 agent）跑在 claude 進程裡，
// 進程一收掉它們就跟著死；留著的話，任務做完 claude 會自己開一輪回報。
// 0 = 關掉這個行為（回到每回合一個進程）。
const CLAUDE_KEEPALIVE_MS = parseInt(process.env.CLAUDE_KEEPALIVE_MS || '1800000', 10); // 30 min，閒著沒背景任務
const CLAUDE_BG_MAX_MS = parseInt(process.env.CLAUDE_BG_MAX_MS || '21600000', 10);      // 6h，有背景任務但一直沒動靜

// 不讓單一例外打死整台伺服器（所有人的 session 會一起死）
process.on('uncaughtException', (e) => console.error('[fatal] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[fatal] unhandledRejection:', e));

const app = express();
// 對話可以夾圖（base64），幾張截圖就破 1mb；前端會先縮圖，這裡給足餘裕
app.use(express.json({ limit: '40mb' }));
// 3D 工作室：頁面與模組來自 Cubbi；public/space 裡的 host.js、plugins/ 蓋過同名檔（claude-web 的宿主接口與經營外掛）
// 外掛（經營系統、設定檔列的）：前端那一半放在各自的 webDir，排在 remote 自己的 host.js 前面
// 提案部（ideas/lab.js）與排程（routines.js）：標準配備。設定檔 ideas、routines
const ideasCfg = config.ideas;
const ideaRoots = (Array.isArray(ideasCfg.roots) && ideasCfg.roots.length ? ideasCfg.roots : [WORK_ROOT]).map(expandHome);
const lab = createLab({
  ...(ideasCfg.stateDir ? { stateDir: expandHome(ideasCfg.stateDir) } : {}),
  roots: ideaRoots, values: ideasCfg.values || '', valuesFiles: (ideasCfg.valuesFiles || []).map(expandHome),
  model: ideasCfg.model || 'opus', lang: config.space.lang === 'en' ? 'en' : 'zh',
});
const scheduleSources = [];   // 外掛接上來的排程來源（排程牆）
const routines = createRoutines({
  routines: () => config.routines,
  save: (list) => saveConfig('routines', list),
  stateFile: dataFile('routines-state.json'),
  runners: {
    ideas: async () => { const r = await lab.run(); coreInbox()?.changed(); return { note: `${r.proposals.length} 份` }; },
    // 開一段對話交代一件事：跟提案開工一樣（git 專案預設開分支，做完在收件箱交件）
    prompt: async (r) => ({ sid: await pluginCtx.startWork({ cwd: expandHome(r.action.cwd), prompt: r.action.prompt, worktree: r.action.worktree !== false, driver: r.action.driver }) }),
    cmd: (r) => runCmd({ cmd: r.action.cmd, cwd: expandHome(r.action.cwd) }),
  },
});
const plugins = await loadPlugins({ config, configFile: CONFIG_FILE, builtins: [
  ideasPlugin({ lab, routines: () => config.routines, saveRoutines: (list) => saveConfig('routines', list), newProjectRoot: ideaRoots[0] }),
  schedulePlugin({ routines, sources: scheduleSources }),
] });
const spaceWebApp = spaceWeb({
  overrideDir: [...new Set([...plugins.map(p => p.webDir).filter(Boolean), join(__dirname, 'public', 'space')])],
  title: process.env.CW_TITLE || 'Cubbi',
});
app.get('/space.html', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(await spaceWebApp.html());
});
app.use(spaceWebApp.router);
app.use(express.static(join(__dirname, 'public')));

// ── Auth ─────────────────────────────────────────────────────────────────────

// 萬用密碼（本機腳本用）或信箱驗證碼換來的通行證（見 auth.js）
function requireAuth(req, res, next) {
  const token = req.headers['x-access-token'] || req.query.token;
  const a = checkToken(token, ACCESS_TOKEN);
  if (!a) return res.status(401).json({ error: '未授權' });
  req.auth = a;
  next();
}
authRoutes(app, { masterToken: ACCESS_TOKEN });
{ const r = express.Router(); sessionRoutes(r); app.use('/api/auth', requireAuth, r); }

// ── MIME ──────────────────────────────────────────────────────────────────────

function getMime(ext) {
  const m = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
  };
  return m[ext] || null;
}

// 路徑安全檢查（isInsideRoot / safePath）與 killTree、friendlyClaudeError
// 都搬到 shared.js，讓任務引擎共用同一套規則。

// ── Task API ──────────────────────────────────────────────────────────────────

app.use('/api/tasks', requireAuth, tasksRouter);

// ── Claude API ────────────────────────────────────────────────────────────────

app.get('/api/info', requireAuth, (req, res) => {
  res.json({
    workRoot: WORK_ROOT,
    allowBypass: ALLOW_BYPASS,
    version: CUBBI_VERSION,
    publicUrl: publicUrl(),
    claudeAuth: authState, // { ok, lastChecked, lastError }
    drivers: drivers.list(),                 // 能用的代理人：['claude', 'codex'?]
    driverStatus: drivers.status(),          // codex 為什麼不能用
    projectDrivers: drivers.projectDefaults(),   // 專案預設：在那裡開新對話時預先選好
  });
});

// 對話紀錄：從外部開好的對話（例如 ai-radar 推播點進來的）接續時，先把前面講過的話顯示出來
// 只取使用者與 AI 的文字，工具呼叫和系統附件略過；依 id 在各專案目錄裡找，不必推算 cwd 的編碼規則
app.get('/api/session-history', requireAuth, async (req, res) => {
  const id = String(req.query.sessionId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'sessionId 格式不對' });
  const root = join(process.env.HOME || '', '.claude', 'projects');
  let raw = null;
  for (const dir of await readdir(root).catch(() => [])) {
    raw = await readFile(join(root, dir, id + '.jsonl'), 'utf8').catch(() => null);
    if (raw) break;
  }
  if (!raw) {
    // 不是 Claude 的：看是不是 Codex 的對話（~/.codex/sessions）
    const messages = await codexHistory(id).catch(() => null);
    if (messages?.length) return res.json({ messages, driver: 'codex' });
    return res.status(404).json({ error: '找不到這個對話' });
  }
  const messages = [];
  for (const line of raw.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    const c = e.message?.content;
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
    if (!text.trim() || text.startsWith('<')) continue;   // 指令回顯、system-reminder 之類
    const last = messages[messages.length - 1];
    // 同一回合 AI 的多段文字（中間夾工具呼叫）併成一則
    if (last && last.role === e.type) last.text += '\n\n' + text;
    else messages.push({ role: e.type, text });
  }
  res.json({ messages });
});

// 啟動時與定期背景檢查 CLI 認證狀態（Pro 訂閱 token 會過期）
const AUTH_CHECK_INTERVAL_MS = parseInt(process.env.AUTH_CHECK_INTERVAL_MS || '300000', 10); // 預設 5 分鐘
let authState = { ok: null, lastChecked: null, lastError: null };

// 預設用 claude auth status（不花額度，只看有沒有登入）；AUTH_CHECK=api 才真的打一次 API（haiku，每 5 分鐘一次會花一點額度）
const AUTH_CHECK = process.env.AUTH_CHECK === 'api' ? 'api' : 'status';
function checkClaudeAuth() {
  return new Promise((resolve) => {
    const args = AUTH_CHECK === 'api' ? ['--print', '--model', 'haiku', '--no-session-persistence', 'ok'] : ['auth', 'status'];
    const p = spawn(claudePath, args, {
      env: claudeEnv(),
    });
    let stdout = '', stderr = '', done = false;
    const finish = (ok, errText) => {
      if (done) return;
      done = true;
      const combined = (stderr || '') + '\n' + (stdout || '');
      const friendly = ok ? null : (friendlyClaudeError(combined) || errText || '未知錯誤');
      authState = { ok, lastChecked: new Date().toISOString(), lastError: friendly };
      console.log(`[auth] ${ok ? '✓ ok' : '✗ fail'} — ${friendly || ''}`);
      resolve(authState);
    };
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(false, '認證檢查逾時'); }, 30000);
    p.on('close', code => {
      clearTimeout(timer);
      // auth status 回 JSON：看 loggedIn；看不懂（舊版 claude）就看結束碼
      if (AUTH_CHECK === 'status' && code === 0) { try { const j = JSON.parse(stdout); if (j.loggedIn === false) return finish(false, '還沒登入：在這台電腦執行 claude auth login'); } catch {} }
      finish(code === 0, stderr + stdout);
    });
    p.on('error', e => { clearTimeout(timer); finish(false, e.message); });
  });
}

// ── Claude session（互動式）─────────────────────────────────────────────────
//
// headless 的 claude 只要用 `--print` + 一發一收就沒辦法問人：需要授權或需要你選
// 答案時，它只能自動 deny。要讓它能問，必須三件事湊齊：
//   1. --input-format stream-json    → stdin 收 JSON，而且全程不能關
//   2. --permission-prompt-tool stdio → 少了它就靜默 auto-deny，不會來問
//   3. 開場先送 initialize 握手
// 之後 claude 需要人介入時，會從 stdout 送 {type:'control_request', subtype:'can_use_tool'}，
// 我們把它轉成 SSE 丟給前端，前端答完再打 /respond 寫回 stdin。
//
// 因為對話中間會停下來等人（可能好幾分鐘），session 不能再綁在單一 HTTP request 上：
// 前端斷線（切 App、鎖屏）時進程要留著，事件先進 buffer，等它用同一個 runId 回來接。

const sessions = new Map(); // runId -> session
const bySid = new Map();    // claude session_id -> 還活著的 session（同一段對話只能有一個進程）

// 路線 A：每段對話一個 shim 進程（agent-shim.mjs）持有代理人（claude 或 codex，見 drivers/），伺服器重啟不打斷它，
// 事件寫進日誌帶流水號，斷線從號碼補。設計見 claude-web 的 docs/設計-代理人進程與事件日誌.md。
// 預設開；AGENT_SHIM=0 退回下面原本那套（記憶體 buffer，只有 claude）。兩種 sess 放在同一個 sessions／bySid，sess.shim 分辨。
const AGENT_SHIM = process.env.AGENT_SHIM !== '0';
// 哪些代理人能用、新對話用哪一家（drivers.js）
const drivers = createDrivers({ config });
let inbox = null;   // 收件箱的 remote 那一半（review.js；本體在 Cubbi 核心）：狀態變化、回合結束都要告訴它
const hub = AGENT_SHIM ? createHub({
  sessions, bySid,
  dir: resolve(process.env.AGENT_DIR || dataFile('agents')),
  sockDir: process.env.AGENT_SOCK_DIR || `/tmp/cw-agents-${process.getuid()}`,
  env: claudeEnv,
  onEvent: (sess, data) => {
    trackEvent(sess, data);
    if (data.type === 'result') inbox?.onTurnEnd(sess);
  },
  onState: (sess) => {
    // Codex 的對話編號開好 thread 才知道：分支紀錄從預先取的編號搬過去
    if (sess.preSid && sess.sid && sess.sid !== sess.preSid) { rekeyWorktree(sess.preSid, sess.sid); sess.preSid = null; }
    if (sess.slashCommands) lastSlashCommands = sess.slashCommands;
    spaceTouch(sess);
    inbox?.onSession(sess);
  },
}) : null;

function sseWrite(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); return true; } catch { return false; }
}

// 有連線就直送，沒連線就先存著等重連（上限防呆：暴衝的輸出不該把記憶體吃光）
function emit(sess, obj) {
  sess.lastActivity = Date.now();
  spaceTouch(sess);
  if (sess.res && sseWrite(sess.res, obj)) return;
  sess.buffer.push(obj);
  if (sess.buffer.length > MAX_BUFFERED_EVENTS) sess.buffer.splice(0, sess.buffer.length - MAX_BUFFERED_EVENTS);
}

function detachClient(sess) {
  if (sess.heartbeat) { clearInterval(sess.heartbeat); sess.heartbeat = null; }
  sess.res = null;
}

// 重連時伺服器手上可能還握著舊連線：iOS 切背景後那條其實已經死了，但 cloudflared 那端
// 還開著，心跳照寫不會出錯，伺服器永遠發現不了。以前這裡回 409，前端就當成對話結束。
// 改成新連線接手、舊的收掉（跟 POST /api/claude 接活著的進程一樣）。
function takeOver(sess) {
  if (!sess.res) return;
  const old = sess.res;
  detachClient(sess);
  try { old.end(); } catch {}
}

function attachClient(sess, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁止反向代理緩衝 SSE
  res.flushHeaders?.();

  if (sess.orphanTimer) { clearTimeout(sess.orphanTimer); sess.orphanTimer = null; }
  sess.res = res;
  spaceTouch(sess);
  sseWrite(res, { type: 'run', runId: sess.runId });
  sseWrite(res, { type: 'state', turnActive: sess.turnActive, bgTasks: sess.bgTasks });
  // 補送斷線期間的事件
  const backlog = sess.buffer.splice(0);
  for (const ev of backlog) sseWrite(res, ev);
  // 還沒回答的提問要重播一次：它可能是在斷線「之前」就送出去的（那時寫進了舊連線，
  // 不在 buffer 裡）。少了這步，重整頁面後畫面是空的，人根本不知道卡在哪。
  for (const ask of sess.pending.values()) {
    if (!backlog.includes(ask)) sseWrite(res, ask);
  }

  // 心跳：claude 思考時可能長時間沒輸出，沒有心跳會被 tunnel（Cloudflare/ngrok）當 idle 砍斷
  sess.heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);

  res.on('close', () => {
    if (sess.res !== res) return; // 已經被新連線接手，不要誤殺
    detachClient(sess);
    if (sess.closed) return;
    if (CLAUDE_KEEPALIVE_MS > 0) {
      // 斷線不等於取消：手機鎖屏、切 App 都會斷，回合照跑、事件進 buffer，
      // 回合結束後進程也照樣留著給背景任務。要停請按停止（/abort）；閒置太久由 watchdog 收。
      return;
    }
    // 還在等人回答就留著，讓使用者切回來還能接上；否則照舊當作取消
    if (sess.pending.size > 0) {
      console.log(`[claude ${sess.runId}] client 斷線但有 ${sess.pending.size} 個待回覆，保留 ${CLAUDE_ORPHAN_GRACE_MS}ms`);
      sess.orphanTimer = setTimeout(() => {
        console.log(`[claude ${sess.runId}] 寬限到期，沒人回來，收掉`);
        endSession(sess, 'orphan-timeout');
      }, CLAUDE_ORPHAN_GRACE_MS);
    } else {
      console.log(`[claude ${sess.runId}] client 主動離開，殺掉 process tree`);
      endSession(sess, 'client-gone');
    }
  });
}

function endSession(sess, reason) {
  if (sess.closed) return;
  // shim 的對話：伺服器關機不動它（新版起來會接回去），其他理由才叫它收
  if (sess.shim) { if (reason !== 'shutdown') hub.kill(sess, reason); return; }
  sess.closed = true;
  sess.reason = reason;
  clearInterval(sess.watchdog);
  clearTimeout(sess.orphanTimer);
  clearTimeout(sess.exitGuard);
  clearTimeout(sess.abortGuard);
  if (sess.res) { try { sess.res.write('data: [DONE]\n\n'); sess.res.end(); } catch {} }
  detachClient(sess);
  sessions.delete(sess.runId);
  if (sess.sid && bySid.get(sess.sid) === sess) bySid.delete(sess.sid);
  killTree(sess.proc, 'SIGKILL');
  spaceTouch(sess);
  console.log(`[claude ${sess.runId}] 結束（${reason}），剩餘 session=${sessions.size}`);
  if (reason !== 'shutdown') inbox?.onSession(sess);
}

// 執行中的才算佔用額度；停在那邊等人回答的、回合已結束留著等背景任務的都不算，
// 否則四個人各問一題就把服務卡死
function runningCount() {
  let n = 0;
  for (const s of sessions.values()) if (s.turnActive && s.pending.size === 0) n++;
  return n;
}

// 對話數滿了：先收掉最久沒動靜、而且沒在做事的（沒回合、沒提問、沒背景任務）
function evictIdle() {
  let oldest = null;
  for (const s of sessions.values()) {
    if (s.turnActive || s.pending.size || s.bgTasks.length) continue;
    if (!oldest || s.lastActivity < oldest.lastActivity) oldest = s;
  }
  if (oldest) endSession(oldest, 'evicted');
  return !!oldest;
}

// 使用者訊息的 content：純文字就送字串（跟以前一樣），有圖才組成 block 陣列
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 10;

function checkImages(images) {
  if (images == null) return null;
  if (!Array.isArray(images)) return 'images 必須是陣列';
  if (images.length > MAX_IMAGES) return `一次最多 ${MAX_IMAGES} 張圖`;
  for (const im of images) {
    if (!im || !IMAGE_TYPES.has(im.media_type)) return '只支援 png / jpeg / gif / webp';
    if (typeof im.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(im.data)) return '圖片資料不是 base64';
  }
  return null;
}

function buildContent(prompt, images) {
  const text = (prompt || '').trim();
  if (!images?.length) return text;
  const blocks = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
  if (text) blocks.push({ type: 'text', text });
  return blocks;
}

// 最近一次 init 報上來的斜線指令（含外掛的 skill），補全清單用；進程重啟前一直有效
let lastSlashCommands = [];

// 權限模式：manual 每個工具都問；auto 由 claude 的分類器判斷，只有風險高的才問；
// acceptEdits 只放行改檔；bypassPermissions 全部放行。空字串＝CLI 預設（manual）
const PERM_MODES = new Set(['', 'manual', 'auto', 'acceptEdits', 'bypassPermissions']);
// 「全部放行」等於把整台電腦交出去，預設關閉，要在 .env 設 ALLOW_BYPASS=1 才收
const ALLOW_BYPASS = process.env.ALLOW_BYPASS === '1';

function startSession({ content, safeCwd, model, sessionId, permMode, newSessionId, appendSystemPrompt }) {
  const runId = crypto.randomUUID();
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages', // 逐字 delta，前端才有 CC 那種即時打字感
    '--permission-prompt-tool', 'stdio', // 沒有這個，權限請求不會轉給我們，會直接被 deny
  ];
  if (model) args.push('--model', model);
  if (permMode) args.push('--permission-mode', permMode);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  if (sessionId) args.push('--resume', sessionId);
  else if (newSessionId) args.push('--session-id', newSessionId);   // 新對話先定好編號：開的人（例如提案白板）馬上知道是哪一段

  const proc = spawn(claudePath, args, {
    cwd: safeCwd,
    env: claudeEnv(),
    detached: true, // 自成 process group，方便整棵殺掉
  });

  const sess = {
    runId, proc,
    res: null, heartbeat: null, orphanTimer: null,
    pending: new Map(),      // control request_id -> 提問內容
    buffer: [],              // 斷線期間的事件
    lastActivity: Date.now(),
    closed: false,
    stdoutBuf: '', sawResult: false,
    cwd: safeCwd, model: model || '', permMode: permMode || '', sid: sessionId || newSessionId || null,
    turnActive: true,        // 有回合在跑（使用者送的，或背景任務做完 claude 自己開的）
    bgTasks: [],             // 目前還在跑的背景任務（claude 的 background_tasks_changed）
    firstPrompt: typeof content === 'string' ? content : (content.find?.(b => b.type === 'text')?.text || ''),
    act: { kind: 'think' },  // 3D 空間裡人物正在做的事（space.js 的 trackEvent 更新）
  };
  if (sess.sid) bySid.set(sess.sid, sess);
  sessions.set(runId, sess);

  const send = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
  send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });
  send({ type: 'user', message: { role: 'user', content } });
  sess.send = send;

  // 逾時保護分兩種：跑到一半沒動靜 vs 停下來等人回答。後者要寬鬆得多，
  // 不然使用者去回個訊息回來，session 已經被砍了。
  sess.watchdog = setInterval(() => {
    const idle = Date.now() - sess.lastActivity;
    const waiting = sess.pending.size > 0;
    // 四種狀態各有寬限：等人回答 > 有背景任務 > 回合中卡住 > 回合結束閒著
    const [limit, what] = waiting ? [CLAUDE_ANSWER_TIMEOUT_MS, '等回覆']
      : sess.turnActive ? [CLAUDE_IDLE_TIMEOUT_MS, 'idle']
      : sess.bgTasks.length ? [CLAUDE_BG_MAX_MS, '背景任務無動靜']
      : [CLAUDE_KEEPALIVE_MS, '閒置'];
    if (idle <= limit) return;
    console.warn(`[claude ${runId}] ${what} 逾時 ${idle}ms`);
    if (sess.turnActive || waiting) emit(sess, { type: 'error', text: waiting ? '等待回覆逾時，已中止' : '執行逾時，已中止' });
    endSession(sess, sess.turnActive || waiting ? 'timeout' : 'keepalive-expired');
  }, 15000);

  proc.stdout.on('data', (chunk) => {
    sess.stdoutBuf += chunk.toString();
    const lines = sess.stdoutBuf.split('\n');
    sess.stdoutBuf = lines.pop(); // 保留不完整的最後一行
    for (const line of lines) handleLine(sess, line);
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    console.error(`[claude ${runId} stderr] ${text.trim()}`);
    const friendly = friendlyClaudeError(text);
    emit(sess, { type: 'error', text: friendly || text });
  });

  proc.on('close', (code) => {
    console.log(`[claude ${runId}] exit code: ${code}`);
    if (sess.stdoutBuf.trim()) handleLine(sess, sess.stdoutBuf);
    // 非零退出又沒有 result：明確告知前端，而不是留一個空泡泡讓使用者猜
    // （auth/quota 等友善說明已由 stderr 即時送出，這裡只補上退出碼這個事實）
    if (code && !sess.sawResult) emit(sess, { type: 'error', text: `Claude 異常退出（代碼 ${code}）` });
    endSession(sess, `exit-${code}`);
  });

  proc.on('error', (e) => {
    console.error(`[claude ${runId}] spawn error: ${e.message}`);
    const hint = e.code === 'ENOENT'
      ? `找不到 claude 指令（${claudePath}），請設定 CLAUDE_PATH`
      : e.message;
    emit(sess, { type: 'error', text: hint });
    endSession(sess, 'spawn-error');
  });

  return sess;
}

// 開新對話：有開 shim 就交給 hub。這段對話有分支的話，一律在 worktree 裡跑、附上分支的規矩
// driver：claude（預設）或 codex；codex 只走 shim
function newSession(opts) {
  const w = getWorktree(opts.sessionId || opts.newSessionId);
  if (w && w.status !== 'discarded') opts = { ...opts, safeCwd: w.work, appendSystemPrompt: worktreeBrief(w) };
  const driver = opts.driver || 'claude';
  if (!hub) {
    if (driver !== 'claude') throw new Error('Codex 要用 shim 模式（不要設 AGENT_SHIM=0）');
    return startSession(opts);
  }
  const sess = hub.start({ ...opts, driver, cwd: opts.safeCwd });
  if (driver !== 'claude' && opts.newSessionId) sess.preSid = opts.newSessionId;
  return sess;
}
// 這段對話原本是哪一家（接續要用同一家）；沒紀錄的（終端機開的）是 claude
const driverOf = (sid) => (sid && (bySid.get(sid)?.driver || hub?.driverOf(sid))) || 'claude';
// 等 Codex 拿到真正的對話編號（開工的人要記住是哪一段）
function waitSid(sess, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (!sess.preSid || sess.sid !== sess.preSid) return resolve(sess.sid);
      if (sess.closed) return reject(new Error('Codex 沒開起來'));
      if (Date.now() - t0 > ms) return reject(new Error('等不到 Codex 的對話編號'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function handleLine(sess, line) {
  if (!line || !line.trim()) return;
  let parsed;
  try { parsed = JSON.parse(line); }
  catch { emit(sess, { type: 'text', text: line }); return; }
  trackEvent(sess, parsed);

  // claude 要人拍板了：可能是要授權跑指令，也可能是 AskUserQuestion 要你選
  if (parsed.type === 'control_request' && parsed.request?.subtype === 'can_use_tool') {
    const r = parsed.request;
    const ask = {
      type: 'permission_request',
      requestId: parsed.request_id,
      toolName: r.tool_name,
      displayName: r.display_name || r.tool_name,
      input: r.input,
      // AskUserQuestion 這類「要你選答案」的，跟單純「准不准跑」要用不同 UI
      requiresUserInteraction: !!r.requires_user_interaction,
      suggestions: r.permission_suggestions || [],
      reason: r.decision_reason || '',
    };
    sess.pending.set(parsed.request_id, ask);
    emit(sess, ask);
    inbox?.changed();
    return;
  }
  // initialize 之類的握手回覆，前端不需要知道
  if (parsed.type === 'control_response' || parsed.type === 'control_cancel_request') return;

  if (parsed.type === 'system') {
    if (parsed.session_id && parsed.session_id !== sess.sid) {
      if (sess.sid && bySid.get(sess.sid) === sess) bySid.delete(sess.sid);
      sess.sid = parsed.session_id;
      bySid.set(sess.sid, sess);
    }
    if (parsed.subtype === 'background_tasks_changed') sess.bgTasks = parsed.tasks || [];
    if (parsed.subtype === 'init' && Array.isArray(parsed.slash_commands)) lastSlashCommands = parsed.slash_commands;
    // 背景任務做完，claude 會自己開一輪回報（task_notification → init → … → result）
    if (parsed.subtype === 'task_notification' || parsed.subtype === 'init') sess.turnActive = true;
  }

  if (parsed.type === 'result') {
    sess.sawResult = true;
    sess.turnActive = false;
    clearTimeout(sess.abortGuard);
    emit(sess, parsed);
    inbox?.onTurnEnd(sess);
    // 一個回合到此為止。--input-format stream-json 下 claude 收到 result 後不會自己退出，
    // 它還在等 stdin 的下一則訊息。
    if (CLAUDE_KEEPALIVE_MS > 0) finishTurn(sess);
    else endTurn(sess);
    return;
  }
  emit(sess, parsed);
}

// 回合結束但進程留著：告訴前端這一輪完了（[DONE] 並收掉這條 SSE），進程與 stdin 都不動。
// 下一則訊息直接寫進 stdin；背景任務做完 claude 自己開的回合，事件先進 buffer，
// 等前端用 /watch 接上來拿。
function finishTurn(sess) {
  const res = sess.res;
  if (!res) return;
  detachClient(sess);
  try { res.write('data: [DONE]\n\n'); res.end(); } catch {}
}

// 關掉 stdin 讓 claude 正常收工；萬一它沒退，補一刀免得進程留著佔資源
function endTurn(sess) {
  if (sess.closed || sess.ending) return;
  sess.ending = true;
  try { sess.proc.stdin.end(); } catch {}
  sess.exitGuard = setTimeout(() => {
    if (sess.closed) return;
    console.warn(`[claude ${sess.runId}] result 後沒退出，強制收掉`);
    endSession(sess, 'no-exit-after-result');
  }, CLAUDE_EXIT_GRACE_MS);
}

// 辦公室前端（public/space/host.js）開機要的個人化設定與開著的外掛
app.get('/api/space/host', requireAuth, (req, res) => {
  const s = config.space;
  res.json({ plugins: plugins.filter(p => p.webDir).map(p => p.name), lang: s.lang || '', projectOutfits: s.projectOutfits || {},
    catNames: s.catNames || [], weatherPlace: s.weather?.place || '' });
});
// 給外掛用：開一段沒有前端接著的新對話（例如提案白板按「開工」，辦公室裡多一個人開始做），狀態從活著的進程看
// 收件箱本體在空間建好之後才有（下面 spaceRouter）：外掛先排隊，建好再接上
const pendingInboxProviders = [];
const pluginCtx = {
  app, requireAuth, broadcast: (m) => spaceBroadcast(m),
  inbox: { addProvider: (fn) => (coreInbox() ? coreInbox().addProvider(fn) : pendingInboxProviders.push(fn)), changed: () => coreInbox()?.changed() },
  addScheduleSource: (src) => scheduleSources.push(src),
  // worktree：git 專案開分支做（預設開）；driver：用哪一家（預設照專案預設）
  async startWork({ cwd, prompt, isNew = false, worktree = true, driver }) {
    if (closing) throw new Error('伺服器更新中，等一下再按');
    if (!isInsideRoot(cwd)) throw new Error('路徑不在允許範圍內');
    if (authState.ok === false) throw new Error('Claude CLI 認證失敗：' + (authState.lastError || '未知'));
    if (runningCount() >= MAX_CONCURRENT) throw new Error(`同時在做的已經 ${MAX_CONCURRENT} 個，等有人做完再開工`);
    if (sessions.size >= MAX_SESSIONS && !evictIdle()) throw new Error('對話數已達上限，先結束幾個等待中的對話');
    const sid = crypto.randomUUID();
    // 既有的 git 專案：開分支做，做完在收件箱看 diff 決定要不要合；新項目是空資料夾，直接做
    if (!isNew && worktree && await repoRoot(cwd)) await createWorktree({ cwd, sid, title: prompt.split('\n')[0] });
    const sess = newSession({ content: prompt, safeCwd: cwd, model: '', permMode: 'auto', newSessionId: sid, driver: drivers.pick({ requested: driver, cwd }) });
    return sess.preSid ? waitSid(sess) : sid;
  },
  // 這段對話現在怎樣：working 在做、asking 等你回答、idle 做完一輪（進程還在或已收掉都算）
  statusOf(sid) {
    const s = bySid.get(sid);
    if (!s || s.closed) return 'idle';
    if (s.pending.size) return 'asking';
    return s.turnActive ? 'working' : 'idle';
  },
};
for (const p of plugins) {
  try { p.mount(pluginCtx); } catch (e) { console.error(`[外掛] ${p.name} 掛不上：${e.message}`); }
}
app.use('/api/space/routines', requireAuth, routines.router);
// 用手機開：連得到的網址＋QR＋一次性登入票
connectRoutes(app, { requireAuth, issueTicket, info: () => ({ host: HOST, port: PORT, publicUrl: publicUrl(), tunnel: tunnelKind() }) });
app.use('/api/space', requireAuth, spaceRouter({ sessions, bySid, workRoot: WORK_ROOT }));
for (const fn of pendingInboxProviders.splice(0)) coreInbox().addProvider(fn);

// 收件箱＋分支交付。打回＝往那段對話送一句話：進程還在就直接寫，不在就 --resume 接起來
async function sendToSession({ sid, cwd, content }) {
  if (closing) throw new Error('伺服器更新中，等一下再按');
  const live = bySid.get(sid);
  if (live && !live.closed) {
    if (live.pending.size) throw new Error('這段對話還有提問沒回答，先回答');
    if (live.turnActive) throw new Error('還在做，等這一輪結束再打回');
    if (live.shim) { await hub.send(live, content); return; }
    live.turnActive = true; live.act = { kind: 'think' }; live.sawResult = false;
    live.send({ type: 'user', message: { role: 'user', content } });
    spaceTouch(live);
    return;
  }
  if (authState.ok === false) throw new Error('Claude CLI 認證失敗：' + (authState.lastError || '未知'));
  if (runningCount() >= MAX_CONCURRENT) throw new Error(`同時在做的已經 ${MAX_CONCURRENT} 個，等一下再打回`);
  if (sessions.size >= MAX_SESSIONS && !evictIdle()) throw new Error('對話數已達上限');
  newSession({ content, safeCwd: cwd, model: '', sessionId: sid, permMode: 'auto', driver: driverOf(sid) });
}
inbox = createReview({ core: coreInbox(), sessions, attentionTasks, sendToSession });
app.use('/api/worktrees', requireAuth, inbox.router);
// 收件箱本體是 /api/space/inbox（辦公室也看這份）；/api/inbox 是給舊版頁面的別名
app.use('/api/inbox', requireAuth, coreInbox().router);
initNames({ onChange: spaceBroadcast });

app.post('/api/claude', requireAuth, async (req, res) => {
  // 重啟收尾中：明確告訴前端「沒收到」，它會等新版起來再自動送（不是 ↻ 重試）
  if (closing) return res.status(503).json({ error: '伺服器更新中', restarting: true });
  const { prompt, images, cwd, sessionId } = req.body;
  let model = req.body.model || '';
  const permMode = req.body.permMode || '';
  if (!PERM_MODES.has(permMode)) return res.status(400).json({ error: `不支援的權限模式：${permMode}` });
  if (permMode === 'bypassPermissions' && !ALLOW_BYPASS) return res.status(403).json({ error: '「全部放行」沒有開啟（.env 設 ALLOW_BYPASS=1）' });
  const badImages = checkImages(images);
  if (badImages) return res.status(400).json({ error: badImages });
  if (!prompt?.trim() && !images?.length) return res.status(400).json({ error: '請提供 prompt' });
  const content = buildContent(prompt, images);

  let safeCwd = cwd ? resolve(cwd) : WORK_ROOT;
  if (!isInsideRoot(safeCwd)) {
    return res.status(403).json({ error: '路徑不在允許範圍內' });
  }
  // 有分支的對話一律在 worktree 裡跑（前端記的可能還是原本的資料夾）
  const wtOf = sessionId ? getWorktree(sessionId) : null;
  if (wtOf && wtOf.status !== 'discarded') safeCwd = wtOf.work;

  // 用哪一家：接續的一律是原本那家；新對話照前端選的／專案預設。選單上的模型是給那家的，換家就不帶模型
  const requested = req.body.driver || '';
  if (requested && !['claude', 'codex'].includes(requested)) return res.status(400).json({ error: `不認得的代理人：${requested}` });
  const driver = sessionId ? driverOf(sessionId) : drivers.pick({ requested, cwd: safeCwd });
  if (!sessionId && requested && driver !== requested) {
    return res.status(400).json({ error: requested === 'codex' ? `Codex 現在不能用：${drivers.status().codex.why}` : `不能用 ${requested}` });
  }
  if (requested && requested !== driver) model = bySid.get(sessionId)?.model || '';

  // 這段對話的進程還活著（回合結束後留著）→ 直接把訊息寫進它的 stdin，不另開進程：
  // 另開一個 --resume 會變成兩個進程寫同一段對話，而且舊進程裡的背景任務就沒人收了
  let live = sessionId ? bySid.get(sessionId) : null;
  if (live && (live.closed || live.cwd !== safeCwd || live.model !== (model || ''))) {
    // 換了目錄或模型只能重開；舊的收掉（它的背景任務會一起結束）
    if (!live.closed) endSession(live, 'replaced');
    live = null;
  }
  if (live && live.pending.size > 0) {
    return res.status(409).json({ error: '這段對話還有提問沒回答，請先回答或按停止' });
  }

  if (runningCount() >= MAX_CONCURRENT && !(live && live.turnActive)) {
    return res.status(429).json({ error: `同時執行數已達上限（${MAX_CONCURRENT}），請稍候再試` });
  }
  if (!live && sessions.size >= MAX_SESSIONS && !evictIdle()) {
    return res.status(429).json({ error: `對話數已達上限（${MAX_SESSIONS}），請先結束幾個等待中的對話` });
  }

  // 認證已知失敗就早返回，不要白白 spawn 一個會 403 的進程
  if (authState.ok === false) {
    return res.status(503).json({
      error: `Claude CLI 認證失敗：${authState.lastError || '未知'}。${RELOGIN_HINT}。`,
    });
  }

  if (live?.shim) {
    // 先掛上（從現在的號碼開始聽）再送，這一輪的事件一筆都不會漏；別的分頁的 /watch 照聽，不踢
    live.act = { kind: 'think' };
    if (live.permMode !== permMode) hub.setMode(live, permMode).catch(() => {});
    hub.attach(live, res, { mode: 'post' });
    hub.send(live, content).catch(e => console.error(`[hub ${live.runId}] 送不出去：${e.message}`));
    return;
  }
  if (live) {
    // 原本接著的（通常是前端的 /watch）讓給這一輪
    if (live.res) { const old = live.res; detachClient(live); try { old.end(); } catch {} }
    live.turnActive = true;
    live.act = { kind: 'think' };
    live.sawResult = false;
    // 權限模式可以直接改在活著的進程上，不必像換模型那樣重開（重開會把背景任務一起殺掉）
    if (live.permMode !== permMode) {
      live.send({ type: 'control_request', request_id: crypto.randomUUID(),
        request: { subtype: 'set_permission_mode', mode: permMode || 'manual' } });
      live.permMode = permMode;
    }
    live.send({ type: 'user', message: { role: 'user', content } });
    attachClient(live, res);
    return;
  }
  // 新對話要開分支：先開好 worktree，session id 先定好（紀錄以它為鍵）
  let newSessionId = null;
  if (req.body.worktree && !sessionId) {
    newSessionId = crypto.randomUUID();
    try { await createWorktree({ cwd: safeCwd, sid: newSessionId, title: prompt || '' }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const sess = newSession({ content, safeCwd, model, sessionId, permMode, newSessionId, driver });
  if (sess.shim) hub.attach(sess, res, { mode: 'post' });
  else attachClient(sess, res);
});

// 回合跑到一半再補一句（CC TUI 裡邊跑邊打字那種）：直接寫進 stdin，claude 會在下一個
// 工具邊界把它併進這一輪，不另開回合，所以前端沿用原本那條 SSE 就好。
// 回合已經結束就回 409，讓前端改走一般送出（不然這句會變成沒人接的新回合）。
app.post('/api/claude/:runId/message', requireAuth, (req, res) => {
  const sess = sessions.get(req.params.runId);
  if (!sess || sess.closed) return res.status(404).json({ error: '對話已結束或不存在' });
  if (!sess.turnActive) return res.status(409).json({ error: '這一輪已經結束' });
  const { prompt, images } = req.body || {};
  const badImages = checkImages(images);
  if (badImages) return res.status(400).json({ error: badImages });
  if (!prompt?.trim() && !images?.length) return res.status(400).json({ error: '請提供 prompt' });
  sess.lastActivity = Date.now();
  if (sess.shim) {
    hub.send(sess, buildContent(prompt, images), { midTurn: true })
      .then(() => res.json({ ok: true }), e => res.status(409).json({ error: e.message }));
    return;
  }
  sess.send({ type: 'user', message: { role: 'user', content: buildContent(prompt, images) } });
  res.json({ ok: true });
});

// 回合之間掛著聽：背景任務做完 claude 自己開的那一輪，從這裡送到前端。
// 對話的進程已經不在就 404，前端就不再掛。
app.get('/api/claude/session/:sid/watch', requireAuth, (req, res) => {
  const sess = bySid.get(req.params.sid);
  if (!sess || sess.closed) return res.status(404).json({ error: '這段對話沒有在跑的進程' });
  // 號碼是每個進程自己數的：前端記的是別的進程（對話重開過）就不算
  if (sess.shim) return hub.attach(sess, res, { mode: 'watch', from: req.query.run === sess.runId ? req.query.from : undefined });
  takeOver(sess);
  attachClient(sess, res);
});

// 斷線重連：拿同一個 runId 接回去，補收斷線期間的事件（含還沒答的提問）
app.get('/api/claude/:runId/stream', requireAuth, (req, res) => {
  const sess = sessions.get(req.params.runId);
  if (!sess || sess.closed) return res.status(404).json({ error: '對話已結束或不存在' });
  if (sess.shim) return hub.attach(sess, res, { mode: 'stream', from: req.query.from ?? req.get('last-event-id') });
  takeOver(sess);
  attachClient(sess, res);
  // 斷線期間這一輪已經跑完：result 和 [DONE] 可能寫進了死連線，這裡補一個 [DONE]
  // 讓前端收尾，不然它會對著一條只有心跳的連線一直轉圈
  if (!sess.turnActive) finishTurn(sess);
});

// 回答 claude 的提問：授權放行／拒絕，或把 AskUserQuestion 的答案送回去
app.post('/api/claude/:runId/respond', requireAuth, (req, res) => {
  const sess = sessions.get(req.params.runId);
  if (!sess) return res.status(404).json({ error: '對話已結束或不存在' });

  const { requestId, behavior, updatedInput, updatedPermissions, message } = req.body || {};
  const ask = sess.pending.get(requestId);
  if (!ask) return res.status(409).json({ error: '這個提問已經回答過或已失效' });
  if (behavior !== 'allow' && behavior !== 'deny') {
    return res.status(400).json({ error: 'behavior 必須是 allow 或 deny' });
  }

  const response = behavior === 'allow'
    // AskUserQuestion 的答案是塞在 updatedInput.answers 裡回去的，不是另外的欄位
    ? { behavior: 'allow', updatedInput: updatedInput ?? ask.input,
        ...(Array.isArray(updatedPermissions) && updatedPermissions.length ? { updatedPermissions } : {}) }
    : { behavior: 'deny', message: message || 'User denied this request.' };

  sess.lastActivity = Date.now();
  if (sess.shim) {
    hub.respond(sess, requestId, response, behavior)
      .then(() => res.json({ ok: true }), e => res.status(409).json({ error: e.message }));
    return;
  }
  sess.pending.delete(requestId);
  sess.send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  emit(sess, { type: 'permission_resolved', requestId, behavior });
  res.json({ ok: true });
});

app.post('/api/claude/:runId/abort', requireAuth, (req, res) => {
  const sess = sessions.get(req.params.runId);
  if (!sess) return res.json({ ok: true }); // 已經沒了就當成功，前端不用特別處理
  if (sess.shim) {
    if (CLAUDE_KEEPALIVE_MS > 0 && sess.turnActive && !(req.body && req.body.kill)) hub.interrupt(sess).catch(() => {});
    else hub.kill(sess, 'user-abort');
    return res.json({ ok: true });
  }
  if (CLAUDE_KEEPALIVE_MS > 0 && sess.turnActive && !(req.body && req.body.kill)) {
    // 停的是這一輪，不是整個進程：送 interrupt 讓 claude 自己收（會回一個 result），
    // 背景任務不受影響。還有沒答的提問先拒掉，不然 claude 卡在等答案收不了。
    for (const id of sess.pending.keys()) {
      sess.send({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'deny', message: 'User aborted.' } } });
    }
    sess.pending.clear();
    sess.send({ type: 'control_request', request_id: 'abort-' + Date.now(), request: { subtype: 'interrupt' } });
    clearTimeout(sess.abortGuard);
    sess.abortGuard = setTimeout(() => { if (sess.turnActive) endSession(sess, 'user-abort'); }, 8000);
    return res.json({ ok: true });
  }
  endSession(sess, 'user-abort');
  res.json({ ok: true });
});

app.get('/api/ls', requireAuth, (req, res) => {
  const { path: p } = req.query;
  const safePath2 = p ? resolve(p) : WORK_ROOT;
  if (!isInsideRoot(safePath2)) {
    return res.status(403).json({ error: '路徑不在允許範圍內' });
  }
  const proc = spawn('ls', ['-la', safePath2]);
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.on('close', () => res.json({ output: out, cwd: safePath2 }));
});

// ── 輸入框補全 ────────────────────────────────────────────────────────────────

// frontmatter 裡的 description；`>` / `|` 的多行寫法把後面縮排的行接起來
function frontmatterDesc(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1];
  if (!fm) return '';
  const m = /^description:[ \t]*(.*)$/m.exec(fm);
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v)) {
    const rest = fm.slice(m.index + m[0].length).split('\n').slice(1);
    const lines = [];
    for (const l of rest) { if (!/^\s+\S/.test(l)) break; lines.push(l.trim()); }
    v = lines.join(' ');
  }
  return v.replace(/^(['"])(.*)\1$/, '$2').slice(0, 160);
}

// 某個 .claude 目錄底下的 skills/<name>/SKILL.md 與 commands/**.md（子目錄用冒號串，照 CC 的命名）
async function scanClaudeDir(base, scope, out) {
  for (const d of await readdir(join(base, 'skills'), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const md = await readFile(join(base, 'skills', d.name, 'SKILL.md'), 'utf8').catch(() => null);
    if (md != null) out.push({ name: d.name, desc: frontmatterDesc(md), scope });
  }
  const walk = async (dir, prefix, depth) => {
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (d.isDirectory() && depth < 3) await walk(join(dir, d.name), prefix + d.name + ':', depth + 1);
      else if (d.name.endsWith('.md')) {
        const md = await readFile(join(dir, d.name), 'utf8').catch(() => '');
        out.push({ name: prefix + d.name.slice(0, -3), desc: frontmatterDesc(md), scope });
      }
    }
  };
  await walk(join(base, 'commands'), '', 0);
}

// 斜線指令清單：專案 > 使用者 > 最近一次 init 報的（外掛 skill、內建指令，沒有描述）
app.get('/api/commands', requireAuth, async (req, res) => {
  const out = [];
  let cwd = null;
  try { cwd = safePath(req.query.cwd); } catch {}
  const home = process.env.HOME || '';
  if (cwd && cwd !== home) await scanClaudeDir(join(cwd, '.claude'), 'project', out);
  await scanClaudeDir(join(home, '.claude'), 'user', out);
  const seen = new Set(out.map(c => c.name));
  for (const name of lastSlashCommands) {
    if (seen.has(name) || name.startsWith('__')) continue;
    seen.add(name);
    out.push({ name, desc: '', scope: 'builtin' });
  }
  res.json({ commands: out });
});

// @ 檔案補全：在 cwd 底下有限度地走一圈（home 當 cwd 時整棵走不完，所以限深度與數量），
// 結果快取一下，打字時每個字都來問也不會一直掃磁碟
const COMPLETE_SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build',
  '.next', 'Library', '.Trash', '.cache', '.npm', 'Pictures', 'Music', 'Movies']);
const completeCache = new Map(); // cwd -> { at, paths }

async function listForComplete(root) {
  const hit = completeCache.get(root);
  if (hit && Date.now() - hit.at < 30000) return hit.paths;
  const paths = [];
  let queue = [['', 0]];
  while (queue.length && paths.length < 8000) {
    const next = [];
    for (const [rel, depth] of queue) {
      const ents = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        if (e.name.startsWith('.') && e.name !== '.claude') continue;
        const p = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) {
          paths.push(p + '/');
          if (!COMPLETE_SKIP.has(e.name) && depth < 6) next.push([p, depth + 1]);
        } else paths.push(p);
        if (paths.length >= 8000) break;
      }
      if (paths.length >= 8000) break;
    }
    queue = next;   // 一層一層往下（BFS），淺的先進清單，截斷時丟的是深處
  }
  completeCache.set(root, { at: Date.now(), paths });
  return paths;
}

app.get('/api/fs/complete', requireAuth, async (req, res) => {
  let root;
  try { root = safePath(req.query.cwd); } catch (e) { return res.status(403).json({ error: e.message }); }
  const q = String(req.query.q || '').toLowerCase();
  const paths = await listForComplete(root);
  // 排序：檔名開頭相符 > 檔名含 > 路徑含；同級短的先
  const scored = [];
  for (const p of paths) {
    const lp = p.toLowerCase();
    const base = lp.replace(/\/$/, '').split('/').pop();
    let s;
    if (!q) s = p.includes('/') && !/^[^/]+\/$/.test(p) ? -1 : 0;   // 空查詢只給第一層
    else if (lp.startsWith(q)) s = 3;
    else if (base.startsWith(q)) s = 2;
    else if (lp.includes(q)) s = 1;
    else s = -1;
    if (s >= 0) scored.push([s, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  res.json({ items: scored.slice(0, 30).map(([, p]) => p) });
});

// ── File System API ───────────────────────────────────────────────────────────

// List directory (structured JSON)
app.get('/api/fs/ls', requireAuth, async (req, res) => {
  try {
    const dir = safePath(req.query.path);
    const s = await stat(dir);
    if (!s.isDirectory()) return res.status(400).json({ error: '不是目錄' });

    const entries = await readdir(dir, { withFileTypes: true });
    const items = await Promise.all(entries.map(async e => {
      try {
        const full = join(dir, e.name);
        const es = await stat(full);
        return { name: e.name, path: full, isDir: e.isDirectory(), size: es.size, mtime: es.mtime };
      } catch {
        return { name: e.name, path: join(dir, e.name), isDir: e.isDirectory(), size: 0, mtime: null };
      }
    }));

    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // parent path (null if at WORK_ROOT)
    const parent = dir === WORK_ROOT ? null : dirname(dir);

    res.json({ path: dir, parent, workRoot: WORK_ROOT, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get text content for preview
app.get('/api/fs/preview', requireAuth, async (req, res) => {
  try {
    const fp = safePath(req.query.path);
    const s = await stat(fp);
    if (s.isDirectory()) return res.status(400).json({ error: '是目錄' });

    const SIZE_LIMIT = 2 * 1024 * 1024; // 2MB
    if (s.size > SIZE_LIMIT) return res.json({ type: 'too-large', size: s.size });

    const buf = await readFile(fp);
    // null-byte heuristic for binary detection
    const sample = buf.slice(0, Math.min(buf.length, 8192));
    if (sample.includes(0)) return res.json({ type: 'binary', size: s.size });

    res.json({ type: 'text', content: buf.toString('utf-8'), ext: extname(fp).toLowerCase() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Serve file inline (for image/video/audio/pdf preview)
app.get('/api/fs/file', requireAuth, async (req, res) => {
  try {
    const fp = safePath(req.query.path);
    const s = await stat(fp);
    if (s.isDirectory()) return res.status(400).json({ error: '是目錄' });

    const mime = getMime(extname(fp).toLowerCase());
    if (mime) res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline');
    // 用 sendFile 而不是自己 pipe：它會回 Content-Length、處理 Range（206）。
    // iPhone／Safari 播 mp4 一定要分段請求，沒有的話影片打不開。
    res.sendFile(fp, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(400).json({ error: err.message });
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Download (forced attachment)
app.get('/api/fs/download', requireAuth, async (req, res) => {
  try {
    const fp = safePath(req.query.path);
    const s = await stat(fp);
    if (s.isDirectory()) return res.status(400).json({ error: '是目錄，請使用 ZIP 下載' });
    const name = basename(fp);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Length', s.size);
    createReadStream(fp).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete file(s) / dir(s)
app.post('/api/fs/delete', requireAuth, async (req, res) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: '請提供路徑' });
    for (const p of paths) {
      const fp = safePath(p);
      await rm(fp, { recursive: true, force: true });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upload files (multipart, streamed to disk — 不把整個檔案讀進記憶體)
//
// 先寫隱藏的 .part 暫存檔，整包收完才改成正式名字。直接用正式檔名的話，連線中斷
// （Cloudflare 524、關掉頁面、網路斷）會在目錄裡留下一個「看起來正常、其實只有半截」
// 的檔案，比乾脆失敗還糟 —— 使用者不會知道它是壞的。
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try { cb(null, safePath(req.query.path)); }
      catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const finalName = basename(file.originalname); // prevent path traversal
      const tmpName = `.${finalName}.part-${crypto.randomBytes(4).toString('hex')}`;
      (req._tmpUploads ||= []).push({ tmpName, finalName });
      cb(null, tmpName);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

function cleanupTempUploads(req) {
  const list = req._tmpUploads;
  if (!list?.length) return;
  req._tmpUploads = [];
  let dir;
  try { dir = safePath(req.query.path); } catch { return; }
  for (const t of list) rm(join(dir, t.tmpName), { force: true }).catch(() => {});
}

app.post('/api/fs/upload', requireAuth,
  (req, res, next) => {
    // 必須掛在 multer 之前：請求被中斷時 multer 不會走到後面的 handler，
    // 清理只能靠這裡。req.complete 為 false 代表 body 沒收完。
    req.on('close', () => { if (!req.complete) cleanupTempUploads(req); });
    next();
  },
  upload.array('files'),
  async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: '沒有檔案' });
    try {
      const dir = safePath(req.query.path);
      for (const t of req._tmpUploads || []) {
        await rename(join(dir, t.tmpName), join(dir, t.finalName));
      }
      req._tmpUploads = [];
      res.json({ ok: true, count: req.files.length });
    } catch (e) {
      cleanupTempUploads(req);
      res.status(500).json({ error: '寫入失敗：' + e.message });
    }
  },
  // multer 自己出錯（超過大小上限、中途斷線）時也要把暫存檔收掉
  (err, req, res, next) => {
    cleanupTempUploads(req);
    const msg = err?.code === 'LIMIT_FILE_SIZE' ? '檔案超過 500MB 上限' : (err?.message || '上傳失敗');
    res.status(400).json({ error: msg });
  });

// Create a new directory
app.post('/api/fs/mkdir', requireAuth, async (req, res) => {
  try {
    const dir = safePath(req.body.path);
    const name = basename(String(req.body.name || '').trim());
    if (!name || name === '.' || name === '..') return res.status(400).json({ error: '名稱無效' });
    await mkdir(join(dir, name)); // 不加 recursive：同名已存在會報錯，符合預期
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.code === 'EEXIST' ? '已存在同名項目' : e.message });
  }
});

// Rename / move within WORK_ROOT
app.post('/api/fs/rename', requireAuth, async (req, res) => {
  try {
    const from = safePath(req.body.from);
    const name = basename(String(req.body.name || '').trim());
    if (!name || name === '.' || name === '..') return res.status(400).json({ error: '名稱無效' });
    const to = safePath(join(dirname(from), name));
    await rename(from, to);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ZIP selected paths and stream to client
app.post('/api/fs/zip', requireAuth, async (req, res) => {
  try {
    const { paths, name = 'archive' } = req.body;
    if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: '請提供路徑' });

    // Validate all paths upfront
    const validated = [];
    for (const p of paths) {
      const fp = safePath(p);
      const s = await stat(fp);
      validated.push({ fp, isDir: s.isDirectory() });
    }

    const safeName = basename(name).replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_') || 'archive';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const arc = new ZipArchive({ zlib: { level: 6 } });
    arc.on('error', err => console.error('[archiver]', err));
    arc.pipe(res);

    for (const { fp, isDir } of validated) {
      if (isDir) arc.directory(fp, basename(fp));
      else arc.file(fp, { name: basename(fp) });
    }

    await arc.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = createServer(app);

// 上一版伺服器開的代理人還在跑：先接回來，前端重連 /stream、/watch 才找得到
if (hub) {
  hub.recover();
  hub.cleanup();
  setInterval(() => hub.cleanup(), 86400000).unref();
}

server.listen(PORT, HOST, async () => {
  console.log('\n╔═══════════════════════════════════╗');
  console.log('║        Cubbi remote 已啟動          ║');
  console.log('╚═══════════════════════════════════╝');
  console.log(`\n本地位址：http://${HOST}:${PORT}`);
  console.log(`工作目錄：${WORK_ROOT}`);
  console.log('登入：一次性登入連結（cubbi remote login-link，或網頁右上角 📱）；有設信箱的話也能用驗證碼');

  await initTasks();

  // 啟動時 + 定期背景檢查 Claude CLI 認證（Pro 訂閱 OAuth token 會過期）
  console.log('\n[auth] 檢查 Claude CLI 認證...');
  const initial = await checkClaudeAuth();
  if (!initial.ok) {
    console.warn('\n⚠️  Claude CLI 認證失敗！');
    console.warn('   ' + RELOGIN_HINT);
    console.warn('   登入完成後重啟 Cubbi remote 或等候下次背景檢查\n');
  }
  setInterval(() => { checkClaudeAuth().catch(() => {}); }, AUTH_CHECK_INTERVAL_MS);

  await startTunnel({ port: PORT });
});

// ── 安全重啟 ────────────────────────────────────────────────────────────────
// data/restart/restart.sh 用：先問閒不閒，閒了才叫 shutdown。shutdown 會在同一個
// 同步區塊裡再確認一次並立刻關門（closing），中間不會有新回合鑽進來。
// 「忙」= 有回合在跑、有提問等回答、有背景任務、任務系統有東西在跑或排隊。
// 回合結束後留著的閒置進程不算：新版起來後同一個 sessionId 會用 --resume 接回。
let closing = false;
function busyList() {
  const busy = [];
  for (const s of sessions.values()) {
    if (s.closed || s.shim) continue;   // shim 的對話不怕伺服器重啟，不用等
    const who = `對話 ${(s.sid || s.runId).slice(0, 8)}（${s.cwd}）`;
    if (s.pending.size) busy.push(`${who} 等你回答`);
    else if (s.turnActive) busy.push(`${who} 回合進行中`);
    if (s.bgTasks?.length) busy.push(`${who} 背景任務 ${s.bgTasks.length} 個`);
  }
  return busy.concat(busyTasks());
}
app.get('/api/admin/idle', requireAuth, (req, res) => {
  const busy = busyList();
  res.json({ idle: busy.length === 0, busy });
});
app.post('/api/admin/shutdown', requireAuth, (req, res) => {
  const busy = busyList();
  if (busy.length) return res.status(409).json({ idle: false, busy });
  closing = true;
  res.json({ ok: true });
  console.log('[restart] 閒置確認，收尾關機');
  setTimeout(shutdown, 200);   // 讓這個回應先送出去
});

// 關機時把背景任務的進程收乾淨，不然 claude 會變成孤兒進程留在系統裡
function shutdown() {
  closing = true;
  try { flushEconomy(); } catch (e) { console.error('[economy] 關機存檔失敗', e); }
  shutdownTasks();
  hub?.detachAll();
  for (const s of [...sessions.values()]) endSession(s, 'shutdown');
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
