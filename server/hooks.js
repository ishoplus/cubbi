// ── 選用：Claude Code hooks ─────────────────────────────────────────────────
//
// 裝了之後 Claude Code 每個事件（你送出訊息、開始用工具、跳出權限詢問、這一輪結束…）都會即時轉給 Cubbi，
// 辦公室不用等紀錄檔：舉手、跑指令、做完都馬上反應。
//   installHooks / uninstallHooks：只加／只拿掉 Cubbi 自己那幾條（認 cubbi-hook.mjs），用戶其他設定不動，改之前先備份
//   hookSource：把事件變成人物（Source 介面，見 sources/common.js），排在紀錄檔來源前面
import { readFile, writeFile, copyFile, mkdir, access, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { toolKind, toolDetail, short } from './sources/common.js';
import { spawnSync } from 'child_process';
import { homedir } from 'os';

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const MARK = 'cubbi-hook.mjs', SL_MARK = 'cubbi-statusline.mjs', OPEN_MARK = 'cubbi-open.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'hook-runner.mjs');
// /cubbi 指令檔（~/.claude/commands/cubbi.md）：先跑 open 程式，再請 Claude 只回一句話
// Claude Code 會先檢查這行命令，帶引號的會被拒絕：路徑盡量寫成不用引號的樣子（~/.cubbi/…），資料夾由程式自己讀
const bare = (p) => (/[\s"'`$]/.test(p) ? `"${p}"` : p);
const commandMd = (node, open) => `---\ndescription: Open Cubbi and fly to this session's figure\nallowed-tools: Bash(${node}:*)\nmodel: haiku\n---\n!\`${bare(node)} ${bare(open)}\`\n\nReply with just the line above (it says whether Cubbi opened). Do nothing else.\n<!-- ${OPEN_MARK} -->\n`;
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes(MARK);

async function readSettings(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`讀不懂 ${file}（不是合法的 JSON），沒有改動`); }
}
// settingsFile：Claude Code 的設定檔（預設 ~/.claude/settings.json）；dataDir：~/.cubbi（放 hook 程式與埠號）
// 寫進設定的 node：PATH 上找得到就用 "node"（升級 Node 不會壞；Homebrew 的實際路徑帶版本號），找不到才用絕對路徑
function stableNode() {
  try { if (spawnSync('node', ['--version'], { timeout: 3000 }).status === 0) return 'node'; } catch {}
  return process.execPath;
}
export async function installHooks({ settingsFile, dataDir, node = stableNode() }) {
  const s = await readSettings(settingsFile);
  await mkdir(dataDir, { recursive: true });
  const hook = join(dataDir, MARK);
  await copyFile(RUNNER, hook);
  let backup = settingsFile + '.cubbi-backup';
  try { await access(backup); } catch { try { await copyFile(settingsFile, backup); } catch { backup = null; } }   // 第一次裝才備份（保留最原本的）；原本沒有設定檔就不用備份
  const q = (s) => (s === 'node' ? s : `"${s}"`);
  const command = `${q(node)} "${hook}"`;
  s.hooks ||= {};
  const added = [];
  for (const ev of EVENTS) {
    const list = (s.hooks[ev] ||= []);
    if (list.some(g => (g.hooks || []).some(isOurs))) continue;
    list.push({ ...(TOOL_EVENTS.has(ev) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command, timeout: 5 }] });
    added.push(ev);
  }
  // 狀態列：用戶已經有自己的就不動
  const sl = join(dataDir, SL_MARK);
  await copyFile(join(HERE, 'statusline-runner.mjs'), sl);
  let statusLine = 'kept';
  if (!s.statusLine) { s.statusLine = { type: 'command', command: `${q(node)} "${sl}"` }; statusLine = 'added'; }
  else if (String(s.statusLine.command || '').includes(SL_MARK)) statusLine = 'already';
  // /cubbi 指令：放在設定檔旁邊的 commands/（同名檔案是用戶自己的就不蓋）
  const open = join(dataDir, OPEN_MARK);
  await copyFile(join(HERE, 'open-runner.mjs'), open);
  const cmdFile = join(dirname(settingsFile), 'commands', 'cubbi.md');
  let slash = 'added';
  try { const old = await readFile(cmdFile, 'utf8'); slash = old.includes(OPEN_MARK) ? 'updated' : 'kept'; } catch {}
  const home = homedir(), openForCmd = dataDir === join(home, '.cubbi') ? '~/.cubbi/' + OPEN_MARK : open;
  if (slash !== 'kept') { await mkdir(dirname(cmdFile), { recursive: true }); await writeFile(cmdFile, commandMd(node, openForCmd)); }
  await mkdir(dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, JSON.stringify(s, null, 2) + '\n');
  return { added, hook, backup, statusLine, command: slash, cmdFile };
}
export async function uninstallHooks({ settingsFile }) {
  const s = await readSettings(settingsFile);
  const removed = [];
  for (const [ev, list] of Object.entries(s.hooks || {})) {
    if (!Array.isArray(list)) continue;
    if (list.some(g => (g.hooks || []).some(isOurs))) removed.push(ev);
    const kept = list.map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) })).filter(g => g.hooks.length);
    if (kept.length) s.hooks[ev] = kept; else delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  if (String(s.statusLine?.command || '').includes(SL_MARK)) { delete s.statusLine; removed.push('statusLine'); }
  await writeFile(settingsFile, JSON.stringify(s, null, 2) + '\n');
  const cmdFile = join(dirname(settingsFile), 'commands', 'cubbi.md');
  try { if ((await readFile(cmdFile, 'utf8')).includes(OPEN_MARK)) { await unlink(cmdFile); removed.push('/cubbi'); } } catch {}
  return { removed };
}

// ── 事件 → 人物 ──
// 權限詢問的通知文字（Claude Code 的英文訊息；也認 notification_type）
const ASKING = /permission|approve|approval|allow/i;
export function hookSource({ idleDropMs = 2 * 3600_000 } = {}) {
  const sessions = new Map();   // session_id -> 人物
  let out = null;
  const pending = new Map();
  const push = (s) => {
    if (!out || pending.has(s.id)) return;
    pending.set(s.id, setTimeout(() => { pending.delete(s.id); out.push({ ...s }); }, 120));
  };
  const setAct = (s, act) => {
    const p = s.act, same = p && p.kind === act.kind && p.tool === act.tool && (!p.detail || p.detail === act.detail);
    s.act = { ...act, since: same ? p.since : Date.now() };
  };
  function onEvent(e) {
    const sid = e.session_id;
    if (!/^[0-9a-f-]{36}$/i.test(String(sid || ''))) return;
    const ev = e.hook_event_name;
    if (ev === 'SessionEnd') {
      const s = sessions.get(sid);
      if (s) { sessions.delete(sid); out?.push({ ...s, live: false, status: 'resting' }); }   // 交回紀錄檔來源
      return;
    }
    let s = sessions.get(sid);
    if (!s) {
      s = { id: sid, sid, live: true, status: 'idle', act: null, ask: null, bgTasks: 0, bg: [], cwd: e.cwd || '', model: '', permMode: e.permission_mode || '', title: '', name: '', updatedAt: Date.now(), canResume: true, source: 'hooks' };
      sessions.set(sid, s);
    }
    s.updatedAt = Date.now();
    if (e.cwd) s.cwd = e.cwd;
    if (e.permission_mode) s.permMode = e.permission_mode;
    switch (ev) {
      case 'UserPromptSubmit':
        s.status = 'working'; s.ask = null; setAct(s, { kind: 'think' });
        if (!s.title && e.prompt) s.title = short(e.prompt, 60);
        if (e.prompt) s.prompt = { text: short(e.prompt, 80), at: Date.now() };
        break;
      case 'PreToolUse':
        s.status = 'working'; s.ask = null;
        setAct(s, { kind: toolKind(e.tool_name), tool: e.tool_name, detail: toolDetail(e.tool_name, e.tool_input) });
        break;
      case 'PostToolUse':
        s.status = 'working'; s.ask = null; setAct(s, { kind: 'think' });
        break;
      case 'Notification':
        if (e.notification_type === 'permission_prompt' || ASKING.test(e.message || '')) {
          s.status = 'asking';
          s.ask = { tool: s.act?.tool || '', question: e.message || '', questions: null, preview: s.act?.detail || '', reason: '', suggestions: null };
        } else if (s.status !== 'working') s.status = 'idle';   // 「在等你輸入」之類
        break;
      case 'Stop': {
        const bg = Array.isArray(e.background_tasks) ? e.background_tasks : [];
        s.bg = bg.map((t, i) => ({ id: String(t.id || t.task_id || i), type: /agent/i.test(t.type || t.task_type || '') ? 'agent' : /bash|shell/i.test(t.type || t.task_type || '') ? 'bash' : 'other', desc: short(t.description || t.desc || '', 40) }));
        s.bgTasks = s.bg.length; s.status = s.bg.length ? 'background' : 'idle'; s.ask = null;
        setAct(s, { kind: 'done' });
        break;
      }
      default: break;   // SessionStart：出現在辦公室、閒著
    }
    push(s);
  }
  // 太久沒消息又不在忙的：交回紀錄檔來源
  setInterval(() => {
    for (const [sid, s] of sessions) if (s.status !== 'working' && Date.now() - s.updatedAt > idleDropMs) sessions.delete(sid);
  }, 60_000).unref();

  return {
    name: 'hooks',
    async *list() { yield* [...sessions.values()].map(s => ({ ...s })); },
    has: (sid) => sessions.has(sid),
    liveIds: () => [...sessions.keys()],
    view: (sid) => (sessions.has(sid) ? { ...sessions.get(sid) } : null),
    subscribe(o) { out = o; },
    onEvent,
    extend(r) { r.post('/hook', (req, res) => { try { onEvent(req.body || {}); } catch {} res.json({ ok: true }); }); },
  };
}
