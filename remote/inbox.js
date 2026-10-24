// ── 「等你處理」收件箱 ＋ 分支交付 ────────────────────────────────────────────────
//
// 所有要人出手的事集中成一個隊列，有新的就推播（ntfy）：
//   ask     對話停下來等授權或等你選答案
//   review  分支有新的 commit／改動（交件），附 diff 統計與驗收結果
//   stuck   回合進行中，但太久沒動靜
//   ended   代理人意外結束（lost、逾時、異常退出）
//   task    任務那邊待授權／待驗收／失敗／中斷
// 每一項有 key；同一個 key 只推一次。按「知道了」記進 dismissed，不再出現。
//
// 分支交付的 API（/api/worktrees/:sid/…）也在這：看改動、合併、打回、丟棄、跑驗收、改完成定義。
import { Router } from 'express';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import {
  getWorktree, listWorktrees, updateWorktree, delivery, hasChanges, diffText, mergeWorktree, discardWorktree,
} from './worktree.js';
import { projectChecks, setProjectChecks, runChecks, evidenceSummary } from './checks.js';
import { nameFor } from './names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.INBOX_FILE || join(__dirname, 'data', 'inbox.json');
const STUCK_MS = parseInt(process.env.INBOX_STUCK_MS || '600000', 10);   // 10 分鐘沒動靜算卡住
const ENDED_KEEP_MS = 24 * 3600000;
const BAD_ENDINGS = /^(lost|timeout|spawn-error|exit-[1-9]|no-exit)/;

// 推播位址：.env 的 PUSH_URL，沒有就沿用 xitto-station 的（~/.xitto/config.json 的 push.url）
function pushUrl() {
  if (process.env.PUSH_URL !== undefined) return process.env.PUSH_URL;
  try { return JSON.parse(readFileSync(join(homedir(), '.xitto', 'config.json'), 'utf8')).push?.url || ''; } catch { return ''; }
}

export function createInbox({ sessions, attentionTasks = () => [], sendToSession, webUrl = process.env.CLAUDE_WEB_URL || '', log = console }) {
  const base = () => (typeof webUrl === 'function' ? webUrl() : webUrl) || '';   // 通道開好才知道網址
  let db;
  try { db = JSON.parse(readFileSync(FILE, 'utf8')); } catch { db = {}; }
  db.dismissed ||= []; db.pushed ||= []; db.ended ||= [];
  let booted = !!db.booted;
  const save = () => {
    db.dismissed = db.dismissed.slice(-500); db.pushed = db.pushed.slice(-1000);
    db.ended = db.ended.filter(e => Date.now() - e.at < ENDED_KEEP_MS);
    db.booted = true;
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(db)); renameSync(FILE + '.tmp', FILE); } catch (e) { log.error?.('[inbox] 存檔失敗', e.message); }
  };

  // 交付狀態要跑 git，存起來；回合結束或有人按了什麼才重算
  const deliveries = new Map();   // sid -> { d, at }
  async function refreshDelivery(sid) {
    const w = getWorktree(sid);
    if (!w || w.status === 'discarded') { deliveries.delete(sid); return null; }
    try {
      const d = await delivery(w);
      deliveries.set(sid, { d, at: Date.now() });
      // 有新東西：狀態回到待審、自動跑驗收（同一個 head 只跑一次）
      if (hasChanges(d) && d.head !== w.mergedHead && !d.dirty.length && w.evidence?.head !== d.head) startChecks(w, d.head);
      if (hasChanges(d) && w.status === 'merged' && d.head !== w.mergedHead) updateWorktree(sid, { status: 'working' });
      return d;
    } catch (e) { log.error?.(`[inbox] ${sid.slice(0, 8)} 交付狀態讀不到：${e.message}`); return null; }
  }
  function startChecks(w, head) {
    if (!projectChecks(w.repo).checks.length) return;
    runChecks(w, { head, onUpdate: (ev) => { updateWorktree(w.sid, { evidence: { ...ev, results: [...ev.results] } }); if (!ev.running) changed(); } });
  }

  const nameOf = (sid, prompt) => (sid && nameFor(sid, prompt)) || '';
  const liveBySid = (sid) => [...sessions.values()].find(s => s.sid === sid && !s.closed);

  async function items() {
    const out = [];
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.closed) continue;
      const who = { sid: s.sid, runId: s.runId, cwd: s.cwd, name: nameOf(s.sid, s.firstPrompt), title: (s.firstPrompt || '').slice(0, 80) };
      for (const ask of s.pending.values()) out.push({ key: `ask:${ask.requestId}`, kind: 'ask', at: s.lastActivity, ...who, ask });
      if (s.turnActive && !s.pending.size && now - s.lastActivity > STUCK_MS) {
        out.push({ key: `stuck:${s.runId}:${s.lastActivity}`, kind: 'stuck', at: s.lastActivity, idleMs: now - s.lastActivity, ...who });
      }
    }
    for (const w of listWorktrees()) {
      if (w.status === 'discarded') continue;
      let c = deliveries.get(w.sid);
      if (!c || now - c.at > 30000) { await refreshDelivery(w.sid); c = deliveries.get(w.sid); }
      const d = c?.d;
      if (!hasChanges(d) || d.head === w.mergedHead) continue;
      const live = liveBySid(w.sid);
      if (live?.turnActive) continue;   // 還在做，等這一輪結束再交
      const ev = getWorktree(w.sid).evidence;
      out.push({
        key: `review:${w.sid}:${d.head}:${d.dirty.length}`, kind: 'review', at: w.updatedAt,
        sid: w.sid, cwd: w.work, name: nameOf(w.sid, w.title), title: w.title.slice(0, 80),
        repo: basename(w.repo), branch: w.branch, base: w.base,
        commits: d.commits.length, dirty: d.dirty.length, files: d.files.length, add: d.add, del: d.del,
        evidence: evidenceSummary(ev && ev.head === d.head ? ev : null), checks: (ev && ev.head === d.head ? ev.results : []).map(r => ({ name: r.name, ok: r.ok })),
        live: !!live,
      });
    }
    for (const e of db.ended) out.push({ ...e, kind: 'ended', key: `ended:${e.runId}` });
    for (const t of attentionTasks()) out.push({ key: `task:${t.id}:${t.status}:${t.updatedAt}`, kind: 'task', at: Date.parse(t.updatedAt) || now, taskId: t.id, name: t.name, status: t.status, cwd: t.cwd });
    const dis = new Set(db.dismissed);
    return out.filter(i => !dis.has(i.key)).sort((a, b) => b.at - a.at);
  }

  // ── 推播 ──────────────────────────────────────────────────────────────────
  function pushText(i) {
    const who = i.name || i.title || (i.cwd ? basename(i.cwd) : '');
    switch (i.kind) {
      case 'ask': return i.ask.requiresUserInteraction
        ? { title: `❓ ${who} 有問題要你選`, message: i.ask.input?.questions?.[0]?.question || '' }
        : { title: `🔐 ${who} 要授權`, message: `${i.ask.displayName || i.ask.toolName}：${String(i.ask.input?.command || i.ask.input?.file_path || i.ask.reason || '').slice(0, 200)}` };
      case 'review': {
        const ev = i.evidence.state === 'pass' ? ' · 驗收 ✓' : i.evidence.state === 'fail' ? ` · 驗收 ✗ ${i.evidence.failed.join('、')}` : '';
        return { title: `📦 ${who} 交件了`, message: `${i.repo} · ${i.branch} · ${i.commits} 個 commit · +${i.add} −${i.del}${i.dirty ? ` · ${i.dirty} 個沒 commit` : ''}${ev}` };
      }
      case 'stuck': return { title: `⏳ ${who} 卡住了`, message: `${Math.round(i.idleMs / 60000)} 分鐘沒動靜` };
      case 'ended': return { title: `⚠ ${who} 意外結束`, message: i.reasonText || i.reason };
      case 'task': return { title: `📋 任務「${i.name}」等你處理`, message: { awaiting_permission: '待授權', awaiting_review: '待驗收', failed: '失敗', interrupted: '中斷了' }[i.status] || i.status };
    }
    return { title: '收件箱', message: '' };
  }
  async function push(i) {
    const url = pushUrl();
    if (!url) return;
    const u = new URL(url);
    const { title, message } = pushText(i);
    const body = { topic: u.pathname.replace(/^\//, ''), title: title.slice(0, 120), message: message || title, tags: ['inbox_tray'],
      priority: i.kind === 'ask' ? 4 : 3, click: base() ? `${base()}/?inbox=1` : undefined };
    const r = await fetch(u.origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  // 有變化就重算；新出現的推一次。開機第一次只記下來不推（不然一重啟就連發）
  let timer = null, running = false, again = false;
  const listeners = new Set();
  function changed() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (running) { again = true; return; }
      running = true;
      try {
        const list = await items();
        const pushed = new Set(db.pushed);
        const fresh = list.filter(i => !pushed.has(i.key));
        for (const i of fresh) db.pushed.push(i.key);
        if (booted) for (const i of fresh) push(i).catch(e => log.warn?.(`[inbox] 推播失敗：${e.message}`));
        booted = true;
        if (fresh.length) save();
        for (const fn of listeners) fn(list);
      } catch (e) { log.error?.('[inbox] 重算失敗', e); }
      running = false;
      if (again) { again = false; changed(); }
    }, 1500);
  }
  // 卡住是「沒事發生」才成立的，事件推不出來，要定期看
  setInterval(changed, 60000).unref();
  setTimeout(changed, 3000).unref();

  // server.js 呼叫：狀態變了／回合結束／對話結束
  function onSession(sess) {
    if (sess.closed && sess.reason && BAD_ENDINGS.test(sess.reason) && !db.ended.some(e => e.runId === sess.runId)) {
      db.ended.push({ runId: sess.runId, sid: sess.sid, cwd: sess.cwd, name: nameOf(sess.sid, sess.firstPrompt), title: (sess.firstPrompt || '').slice(0, 80),
        reason: sess.reason, reasonText: sess.reason === 'lost' ? '代理人進程不見了（可以接著送訊息，會用 --resume 接續）' : sess.reason === 'timeout' ? '太久沒動靜，逾時收掉' : `異常結束（${sess.reason}）`, at: Date.now() });
      save();
    }
    changed();
  }
  function onTurnEnd(sess) {
    if (sess.sid && getWorktree(sess.sid)) refreshDelivery(sess.sid).then(changed);
    else changed();
  }

  // ── 路由 ──────────────────────────────────────────────────────────────────
  const r = Router();
  r.get('/inbox', async (req, res) => { const list = await items(); res.json({ items: list, count: list.length, push: !!pushUrl() }); });
  r.post('/inbox/dismiss', (req, res) => {
    const { key } = req.body || {};
    if (typeof key !== 'string' || !key) return res.status(400).json({ error: '缺 key' });
    if (key.startsWith('ended:')) db.ended = db.ended.filter(e => `ended:${e.runId}` !== key);
    else db.dismissed.push(key);
    save(); changed();
    res.json({ ok: true });
  });

  const wt = (req, res) => {
    const w = getWorktree(req.params.sid);
    if (!w || w.status === 'discarded') { res.status(404).json({ error: '這段對話沒有分支' }); return null; }
    return w;
  };
  r.get('/worktrees/:sid', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const d = await refreshDelivery(w.sid);
    const ev = getWorktree(w.sid).evidence;
    res.json({ worktree: { ...w, evidence: undefined }, delivery: d, evidence: ev, summary: evidenceSummary(ev && d && ev.head === d.head ? ev : null), ...projectChecks(w.repo) });
  });
  r.get('/worktrees/:sid/diff', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    try { res.type('text/plain; charset=utf-8').send(await diffText(w, req.query.file || null)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/worktrees/:sid/merge', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    if (liveBySid(w.sid)?.turnActive) return res.status(409).json({ error: '還在做，等這一輪結束再合併' });
    try { const m = await mergeWorktree(w); await refreshDelivery(w.sid); changed(); res.json({ ok: true, ...m }); }
    catch (e) { res.status(409).json({ error: e.message, conflict: !!e.conflict }); }
  });
  r.post('/worktrees/:sid/discard', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const live = liveBySid(w.sid);
    if (live?.turnActive) return res.status(409).json({ error: '還在做，先停下來再丟棄' });
    try { await discardWorktree(w); deliveries.delete(w.sid); changed(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/worktrees/:sid/reject', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const fb = String(req.body?.feedback || '').trim();
    if (!fb) return res.status(400).json({ error: '寫一下要改什麼' });
    const content = `用戶看了分支 ${w.branch} 的改動，打回來要你再改：\n\n${fb}\n\n改完 commit，再停下來用幾句話回報。`;
    try { await sendToSession({ sid: w.sid, cwd: w.work, content }); updateWorktree(w.sid, { status: 'working', rejectedAt: Date.now() }); changed(); res.json({ ok: true }); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });
  r.post('/worktrees/:sid/checks/run', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const d = await refreshDelivery(w.sid);
    if (!projectChecks(w.repo).checks.length) return res.status(400).json({ error: '這個專案還沒設驗收指令' });
    updateWorktree(w.sid, { evidence: null });
    startChecks(getWorktree(w.sid), d?.head);
    res.json({ ok: true });
  });
  r.put('/worktrees/:sid/checks', (req, res) => {
    const w = wt(req, res); if (!w) return;
    try { res.json({ checks: setProjectChecks(w.repo, req.body?.checks) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  return { router: r, items, onSession, onTurnEnd, changed, refreshDelivery, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
}
