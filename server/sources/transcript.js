// ── 來源：Claude Code 的紀錄檔（~/.claude/projects/*/*.jsonl）────────────────────
//
// 終端機、ai-radar… 別處開的對話只能讀紀錄檔：最近還在寫就當成「在別處跑」，久了就是「休息中」。
// 也替所有對話（包含這台伺服器自己開的）提供進度與縮時回放，因為內容都在紀錄檔裡。
import { open, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { toolKind, toolDetail, short, userText } from './common.js';
import { fitWidth, guessName } from './naming.js';

const PROJECTS_DIR = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
const RECENT_DAYS = parseInt(process.env.SPACE_RECENT_DAYS || '3', 10);
const EXTERNAL_ACTIVE_MS = 90_000;   // jsonl 這麼久內有寫入，就當作別處還在跑
const DONE_SHOWN_MS = 30 * 60_000;   // 這一輪做完後，多久內還算「剛做完」坐在位子上

async function readSlice(path, start, len) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();   // 從中間切進來的第一行是半截
  const out = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

// 一段對話的摘要：標題（第一句話）、目錄、最後在做的事。依 mtime+size 快取
const metaCache = new Map();

async function sessionMeta(path, st) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = metaCache.get(path);
  if (hit?.key === key) return hit.meta;

  // 先看開頭一小段：第一句只是 ok 的（舊版認證檢查留下的）不必整份讀
  const peek = parseLines(await readSlice(path, 0, Math.min(st.size, 24 * 1024)), false);
  const first = peek.map(userText).find(Boolean);
  if (first && /^ok$/i.test(first.trim())) {
    const meta = { cwd: '', title: 'ok', prompts: 1, act: null, lastPrompt: '' };
    metaCache.set(path, { key, meta });
    return meta;
  }
  const head = parseLines(await readSlice(path, 0, Math.min(st.size, 256 * 1024)), false);
  let cwd = '', title = '', prompts = 0, customTitle = '';
  for (const e of head) {
    if (!cwd && e.cwd) cwd = e.cwd;
    if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
    const t = userText(e);
    if (t) { prompts++; if (!title) title = t; }
  }
  const tailStart = Math.max(0, st.size - 96 * 1024);
  const tail = tailStart ? parseLines(await readSlice(path, tailStart, st.size - tailStart), true) : head;
  let act = null, lastPrompt = '', ended = false;
  for (const e of tail) {
    if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
    if (e.isSidechain) continue;
    const at = e.timestamp ? Date.parse(e.timestamp) : undefined;
    const t = userText(e);
    if (t) { lastPrompt = t; act = { kind: 'think', since: at }; ended = false; continue; }
    if (e.type === 'assistant') {
      for (const b of e.message?.content || []) {
        if (b.type === 'tool_use') act = { kind: toolKind(b.name), tool: b.name, detail: toolDetail(b.name, b.input), since: at };
        else if (b.type === 'text' && b.text?.trim()) act = { kind: 'talk', text: short(b.text, 120), since: at };
      }
      ended = e.message?.stop_reason === 'end_turn';
    }
  }
  if (!cwd) for (const e of tail) if (e.cwd) { cwd = e.cwd; break; }
  const meta = { cwd, title: customTitle || title, customTitle, firstText: title, prompts, act, ended, lastPrompt: short(lastPrompt, 80) };
  metaCache.set(path, { key, meta });
  return meta;
}

// 自動產生的對話不放進空間：認證檢查（只講一句 ok）之類
function isNoise(meta) {
  if (!meta.title) return true;
  if (meta.prompts <= 1 && /^ok$/i.test(meta.title.trim())) return true;
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(meta.cwd + '/')) return true;   // 測試用的暫存目錄
  return false;
}

async function recentTranscripts() {
  const since = Date.now() - RECENT_DAYS * 86400_000;
  const files = [];
  for (const dir of await readdir(PROJECTS_DIR).catch(() => [])) {
    const d = join(PROJECTS_DIR, dir);
    for (const name of await readdir(d).catch(() => [])) {
      if (!name.endsWith('.jsonl')) continue;
      const p = join(d, name);
      const st = await stat(p).catch(() => null);
      if (st && st.mtimeMs >= since) files.push({ path: p, sid: name.slice(0, -6), st });
    }
  }
  return files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
}

export async function findTranscript(sid) {
  for (const dir of await readdir(PROJECTS_DIR).catch(() => [])) {
    const p = join(PROJECTS_DIR, dir, sid + '.jsonl');
    const st = await stat(p).catch(() => null);
    if (st) return { path: p, st };
  }
  return null;
}

// 進度：最近的步驟、待辦清單、改過的檔案
async function progressOf(path, st) {
  const start = Math.max(0, st.size - 3 * 1024 * 1024);
  const events = parseLines(await readSlice(path, start, st.size - start), start > 0);
  const steps = [];
  const files = new Map();   // 路徑 -> 最後改的時間
  let todos = null;
  for (const e of events) {
    if (e.isSidechain) continue;
    const at = e.timestamp ? Date.parse(e.timestamp) : null;
    const t = userText(e);
    if (t) { steps.push({ at, kind: 'user', text: short(t, 160) }); continue; }
    if (e.type !== 'assistant') continue;
    for (const b of e.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) steps.push({ at, kind: 'talk', text: short(b.text, 200) });
      if (b.type !== 'tool_use') continue;
      const kind = toolKind(b.name);
      steps.push({ at, kind, tool: b.name, text: toolDetail(b.name, b.input) });
      if (kind === 'edit' && (b.input?.file_path || b.input?.notebook_path)) {
        const fp = b.input.file_path || b.input.notebook_path;
        files.delete(fp); files.set(fp, at);
      }
      if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) todos = b.input.todos.map(x => ({ text: x.content || x.activeForm || '', status: x.status }));
    }
  }
  return {
    steps: steps.slice(-80),
    todos,
    files: [...files.entries()].reverse().slice(0, 40).map(([path, at]) => ({ path, at })),
    truncated: start > 0,
  };
}

// 縮時回放的種類：think（收到問題在想）、工具分類（read/edit/bash…）、talk（回覆）、done（這一輪做完）
async function timelineOf(path, st, from) {
  const start = Math.max(0, st.size - 4 * 1024 * 1024);
  const events = parseLines(await readSlice(path, start, st.size - start), start > 0);
  const tl = [];
  for (const e of events) {
    if (e.isSidechain || !e.timestamp) continue;
    const at = Date.parse(e.timestamp);
    if (at < from) continue;
    if (userText(e)) tl.push([at, 'think']);
    else if (e.type === 'assistant') {
      for (const b of e.message?.content || []) {
        if (b.type === 'tool_use') tl.push([at, toolKind(b.name)]);
        else if (b.type === 'text' && b.text?.trim()) tl.push([at, 'talk']);
      }
      if (e.message?.stop_reason === 'end_turn') tl.push([at, 'done']);
    }
  }
  return tl.slice(-600);
}

// workRoot：只有在這底下的對話能從空間接著聊；skip(sid)：別的來源已經即時掌握的對話，這裡不必盯
// nameFor(sid, 第一句話, 自訂標題)：人物的短名字；預設是自訂標題（/rename），沒有就從第一句話用規則抓（naming.js）
const ruleName = (sid, first, custom) => fitWidth(custom || '') || guessName(first);
export function transcriptSource({ workRoot = '', skip = () => false, nameFor = ruleName } = {}) {
  const view = (f, meta) => {
    const age = Date.now() - f.st.mtimeMs;
    const status = meta.ended ? (age < DONE_SHOWN_MS ? 'idle' : 'resting') : age < EXTERNAL_ACTIVE_MS ? 'external' : 'resting';
    return {
      id: f.sid, sid: f.sid, live: false, status,
      act: meta.ended ? { kind: 'done' } : meta.act, ask: null, bgTasks: 0,
      cwd: meta.cwd, model: '', permMode: '',
      title: short(meta.title, 60), lastPrompt: meta.lastPrompt,
      name: nameFor(f.sid, meta.firstText, meta.customTitle),
      updatedAt: f.st.mtimeMs,
      canResume: !!meta.cwd && (meta.cwd === workRoot || meta.cwd.startsWith(workRoot + '/')),
    };
  };

  // 上了場的對話即時同步：盯著那幾十個紀錄檔，每 3 秒看一次有沒有變，有變就推出去
  const watched = new Map();   // sid -> { path, mtime, last, pushedAt }
  const paths = new Map();     // sid -> path（list 時記下，shown 時用）
  async function poll(push) {
    for (const [sid, w] of watched) {
      if (skip(sid)) continue;
      const st = await stat(w.path).catch(() => null);
      if (!st) { watched.delete(sid); continue; }
      // 有新寫入就重算；沒寫入但狀態可能過期（在別處執行中 → 休息）也重算
      const stale = Date.now() - st.mtimeMs > EXTERNAL_ACTIVE_MS && Date.now() - w.pushedAt < 5000 + EXTERNAL_ACTIVE_MS;
      if (st.mtimeMs === w.mtime && !stale) continue;
      w.mtime = st.mtimeMs;
      let meta; try { meta = await sessionMeta(w.path, st); } catch { continue; }
      const v = view({ sid, path: w.path, st }, meta);
      const json = JSON.stringify(v);
      if (w.last === json) continue;
      w.last = json; w.pushedAt = Date.now();
      push(v);
    }
  }

  return {
    name: 'transcript',
    // 照新到舊。噪音（認證檢查、暫存目錄）標 hidden：不上場，只用來補別的來源同一段對話的標題、名字
    async *list() {
      for (const f of await recentTranscripts()) {
        let meta;
        try { meta = await sessionMeta(f.path, f.st); } catch { continue; }
        paths.set(f.sid, f.path);
        const v = view(f, meta);
        if (isNoise(meta)) v.hidden = true;
        yield v;
      }
    },
    shown(sessions) {
      for (const s of sessions) {
        const path = paths.get(s.sid);
        if (path && !watched.has(s.sid)) watched.set(s.sid, { path, mtime: s.updatedAt });
      }
    },
    subscribe({ push, watching }) {
      setInterval(() => { if (watching()) poll(push).catch(() => {}); }, 3000).unref();
    },
    async progress(sid) {
      const t = await findTranscript(sid);
      return t ? progressOf(t.path, t.st) : null;
    },
    async timeline(sid, from) {
      const t = await findTranscript(sid);
      if (!t || t.st.mtimeMs < from) return null;
      try { return await timelineOf(t.path, t.st, from); } catch { return null; }
    },
  };
}
