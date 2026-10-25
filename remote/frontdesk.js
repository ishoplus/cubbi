// ── 總務部（總機）：對話頁的唯一入口，只派工、不做事 ─────────────────────────────
//
// 總務部是一段固定的對話（WORK_ROOT，記在 frontdesk.json 的 sid），不管從哪裡打開都接回同一段。
// 它的 claude 沒有內建工具（--tools ""），只有 desk-mcp.mjs 給的兩個：
//   roster   看有哪些部門、對話、派工單（唯讀，免問）
//   dispatch 提出派工（一律要老闆確認）
// 真正的派工只在老闆按「確認派出」時由伺服器做（confirm）：開新對話或傳話給已有對話。
// 結果簽好名塞回工具的輸入（_receipt＋_sig），工具只把它講回去——總務部自己沒有派工的能力，
// 就算設定檔把 dispatch 設成免問，沒有老闆按過的簽名它也派不出去。
// 派出去的對話做完、卡住，記在派工單上（onEvent），對話頁上方那條直接看，不叫醒總務部。
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, readdirSync, realpathSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { dataFile } from './paths.js';
import { expandHome } from './config.js';
import { isInsideRoot } from './shared.js';
import { t, TError } from './i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DESK_MCP = join(__dirname, 'desk-mcp.mjs');
export const DISPATCH_TOOL = 'mcp__desk__dispatch';
export const ROSTER_TOOL = 'mcp__desk__roster';
const MAX_DISPATCHES = 50;
// 新部門的名字：一層資料夾，不能有斜線、不能是 . 開頭
const NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,59}$/u;

export function deskPrompt(lang) {
  if (lang === 'en') {
    return [
      'You are the front desk of Cubbi: the one conversation the boss talks to. You only hand out work; you never do it yourself.',
      'You have no tools to read or edit files, run commands or browse the web, and you must not pretend to have done any of that.',
      'For every request:',
      '1. Call roster to see the departments, conversations and dispatch slips.',
      '2. Decide who gets it: an existing conversation (when it continues the same piece of work), an existing department (a new conversation there), or a new department (a brand-new project).',
      '   Anything that belongs to no project (looking something up, a quick question, tidying files) goes to the errands department.',
      '3. Call dispatch. Write message as a complete brief: the other side cannot see this conversation, so include the background, what to do and when it counts as done. reason is one sentence on why you chose that target.',
      '4. The boss always confirms a dispatch first and may redirect it, edit it or turn it down. Report the tool result in one short sentence.',
      'If the request is unclear, ask the boss before dispatching. One dispatch per separate job. When asked how dispatched work is going, answer from the dispatch slips in roster. Keep replies short.',
    ].join('\n');
  }
  return [
    '你是 Cubbi 的總務部：老闆唯一的對話入口。你只負責派工，自己不做事。',
    '你沒有讀檔、改檔、跑指令、上網的工具，也不要假裝做了這些事。',
    '每件事這樣處理：',
    '1. 先用 roster 看有哪些部門、對話和派工單。',
    '2. 判斷交給誰：已有對話（同一件事的延續）、已有部門（在那裡開新對話）、或新部門（全新的專案）。',
    '   不屬於任何專案的雜事（查資料、問問題、整理檔案）交給雜務部。',
    '3. 用 dispatch 提出派工。message 要寫成完整的交代：對方看不到你們的對話，背景、要做什麼、做到哪算完成都要寫進去。reason 用一句話說為什麼選它。',
    '4. 派工一定會先給老闆確認，老闆可能改派、改內容或不要派。照工具回傳的結果講一句就好。',
    '需求不清楚就先問老闆，問清楚再派。不同的事分開派。老闆問派出去的事做得怎樣，看 roster 的派工單回答。回答要短。',
  ].join('\n');
}

export function createFrontDesk({ config, workRoot, roots: rootsOf = () => [workRoot], url, stage, startWork, sendToSession, statusOf, lang = () => 'zh', log = console, file = dataFile('frontdesk.json'), keyFile = dataFile('desk-key') }) {
  const L = (s, v) => t(lang(), s, v);
  let state = { sid: null, dispatches: [] };
  try { state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  function save() {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  // 給 desk-mcp 的鑰匙：只能看名冊、驗簽名。存檔是因為總務部的進程比伺服器活得久（伺服器重啟它照跑）
  let key = '';
  try { key = readFileSync(keyFile, 'utf8').trim(); } catch {}
  if (!/^[0-9a-f]{64}$/.test(key)) {
    key = crypto.randomBytes(32).toString('hex');
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, key, { mode: 0o600 });
  }
  const sign = (s) => crypto.createHmac('sha256', key).update(s).digest('hex');

  const cfg = () => config.frontDesk || {};
  const enabled = () => cfg().enabled !== false;
  const roots = () => {
    const list = (Array.isArray(cfg().roots) && cfg().roots.length ? cfg().roots.map(expandHome) : rootsOf()).map(p => resolve(p));
    return list.filter(p => isInsideRoot(p));
  };
  const newRoot = () => resolve(expandHome(cfg().newRoot) || roots()[0] || workRoot);
  const errandsDir = () => resolve(expandHome(cfg().errands) || join(newRoot(), 'errands'));
  const isDesk = (sid) => !!sid && sid === state.sid;

  // 開總務部的進程要帶的東西（新開、--resume 接回都一樣）
  function launchOpts() {
    const mcp = { mcpServers: { desk: { command: process.execPath, args: [DESK_MCP], env: { CUBBI_DESK_URL: url(), CUBBI_DESK_KEY: key, CUBBI_LANG: lang() } } } };
    return {
      safeCwd: workRoot, permMode: 'manual', driver: 'claude', model: cfg().model || '',
      appendSystemPrompt: deskPrompt(lang()),
      // 權限固定 manual（不跟使用者的 defaultMode）；沒有內建工具；只載自己的 MCP（使用者其他的 MCP 不帶進來）；名冊免問，派工一律問
      extraArgs: ['--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp), '--allowedTools', ROSTER_TOOL],
    };
  }
  function claim(sid) { state.sid = sid; save(); }

  // ── 名冊 ──────────────────────────────────────────────────────────────────
  function departments(sessions) {
    const out = new Map();
    const add = (cwd, extra = {}) => {
      const p = resolve(cwd);
      if (!isInsideRoot(p) || p === workRoot || out.has(p)) return;
      out.set(p, { name: extra.errands ? L('雜務部') : basename(p), cwd: p, ...extra, recent: 0 });
    };
    add(errandsDir(), { errands: true });
    // 有對話的資料夾（分支的 worktree 算回原專案）；最近有動的排前面
    for (const s of [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
      const cwd = (s.cwd || '').replace(/\/\.claude\/worktrees\/[^/]+$/, '');
      if (cwd && existsSync(cwd)) add(cwd);
      const d = out.get(resolve(cwd || '/'));
      if (d) d.recent = Math.max(d.recent, s.updatedAt || 0);
    }
    for (const root of roots()) {
      let names = [];
      try { names = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name); } catch {}
      for (const n of names.sort()) add(join(root, n));
    }
    return [...out.values()].slice(0, 120);
  }

  async function roster() {
    const sessions = (await stage()).filter(s => s.sid && !isDesk(s.sid) && s.cwd && isInsideRoot(resolve(s.cwd)));   // 工作資料夾外的（例如別處開的 Codex）派不過去
    const conversations = sessions
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 40)
      .map(s => ({ sid: s.sid, name: s.name || '', title: s.title || '', cwd: s.cwd || '', dept: basename(s.cwd || ''), status: statusOf(s.sid) === 'idle' ? (s.status || 'idle') : statusOf(s.sid), updatedAt: s.updatedAt || 0 }));
    return { departments: departments(sessions), conversations, dispatches: dispatches(10), errands: errandsDir() };
  }

  // ── 派工單 ────────────────────────────────────────────────────────────────
  function dispatches(n = 20) {
    for (const d of state.dispatches) {
      if (d.state !== 'working' && d.state !== 'asking') continue;
      const st = statusOf(d.sid);
      if (st === 'asking') d.state = 'asking';
      else if (st === 'working') d.state = 'working';
      // 沒在跑、也沒收到回合結束：進程沒了（被停掉、當掉）
      else if (Date.now() - d.at > 15000) d.state = d.gotResult ? 'done' : 'ended';
    }
    return state.dispatches.slice(-n).reverse();
  }

  // 老闆按「確認派出」：照老闆最後選的做。choice 沒帶就照總務部的提議
  async function confirm(ask, choice) {
    const p = ask.input || {};
    const c = choice && typeof choice === 'object' ? choice : {
      kind: p.target === 'new_department' ? 'new' : p.target === 'conversation' ? 'conversation' : 'department',
      sid: p.sid, cwd: p.department, name: p.new_name, branch: !!p.branch, message: p.message,
    };
    const message = String(c.message ?? p.message ?? '').trim();
    if (!message) throw new TError('要交代的話是空的');
    const content = `${L('（總務部轉交）')}\n${message}`;
    const r = await roster();
    let rec;
    if (c.kind === 'conversation') {
      const conv = r.conversations.find(x => x.sid === c.sid);
      if (!conv) throw new TError('找不到這段對話，換一個或改派到部門');
      await sendToSession({ sid: conv.sid, cwd: conv.cwd, content });
      rec = { kind: 'conversation', sid: conv.sid, cwd: conv.cwd, dept: conv.dept, label: conv.name || conv.title || conv.dept };
    } else if (c.kind === 'department') {
      const want = c.cwd ? resolve(String(c.cwd)) : '';
      const dept = r.departments.find(d => d.cwd === want);
      if (!dept) throw new TError('找不到這個部門，從清單裡選一個');
      if (dept.errands) mkdirSync(dept.cwd, { recursive: true });
      const sid = await startWork({ cwd: dept.cwd, prompt: content, isNew: !!dept.errands, worktree: !!c.branch });
      rec = { kind: 'department', sid, cwd: dept.cwd, dept: dept.name, label: dept.name, branch: !!c.branch };
    } else if (c.kind === 'new') {
      const name = String(c.name || '').trim();
      if (!NAME_RE.test(name)) throw new TError('部門名稱只能是一層資料夾的名字（不能有斜線、不能 . 開頭）');
      const cwd = join(newRoot(), name);
      if (!isInsideRoot(cwd)) throw new TError('路徑不在允許範圍內');
      if (existsSync(cwd)) throw new TError('已經有「{name}」了，改選已有部門', { name });
      mkdirSync(cwd, { recursive: true });
      const sid = await startWork({ cwd: realpathSync(cwd), prompt: content, isNew: true, worktree: false });
      rec = { kind: 'new', sid, cwd, dept: name, label: name };
    } else throw new TError('不認得的派工方式');

    const d = { id: crypto.randomUUID().slice(0, 8), at: Date.now(), ...rec, message: message.slice(0, 500), state: 'working', lastText: '', gotResult: false };
    state.dispatches.push(d);
    if (state.dispatches.length > MAX_DISPATCHES) state.dispatches.splice(0, state.dispatches.length - MAX_DISPATCHES);
    save();
    const receipt = JSON.stringify({ id: d.id, kind: d.kind, sid: d.sid, dept: d.dept, label: d.label, message, edited: message !== String(p.message || '').trim(), at: d.at });
    return { ...p, message, _receipt: receipt, _sig: sign(receipt) };
  }

  // 派出去的對話有事件：記最後一句話、回合結束就算做完一輪
  function onEvent(sess, data) {
    if (!sess?.sid || !state.dispatches.length) return;
    const d = state.dispatches.findLast?.(x => x.sid === sess.sid) || [...state.dispatches].reverse().find(x => x.sid === sess.sid);
    if (!d) return;
    if (data.type === 'assistant') {
      const text = (data.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (text) d.lastText = text.slice(-400);
    } else if (data.type === 'result') {
      d.gotResult = true;
      d.state = data.is_error ? 'ended' : 'done';
      d.doneAt = Date.now();
      save();
    }
  }

  return {
    enabled, isDesk, sid: () => state.sid, claim, launchOpts, roster, dispatches, confirm, onEvent,
    checkKey: (k) => typeof k === 'string' && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key)),
    isDispatchAsk: (sess, ask) => isDesk(sess?.sid) && ask?.toolName === DISPATCH_TOOL,
  };
}
