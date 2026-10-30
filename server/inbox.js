// ── 等你處理：所有要你出手的事集中成一份清單（辦公室左上角、remote 的收件箱分頁都看這份）──────────
//
// 核心從辦公室裡的人算四種：
//   ask    舉手：等你回答（授權或選答案）
//   deliv  交件：做完的這一輪做出了東西（檔案、網址、圖…，server/deliverable.js 判斷），還沒收下
//   stuck  卡住：工作中卻太久沒新動作（指令看它跑多久，其他看多久沒事件）
//   done   做完了：一輪做完、你還沒看過
// 宿主可以 addProvider 加自己的（remote：分支交件 review、意外結束 ended、任務 task、能直接回答的提問）。
// 同一個 key 以宿主給的為準（比較完整）。每一項只推播一次；「做完了」預設不推（每輪都推太吵）。
//
// 收下、看過、知道了都存在伺服器（file），電腦和手機看到的一樣；舊版存在瀏覽器的可以用 /import 搬過來。
import { Router } from 'express';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, basename } from 'path';

const DAY = 86400000;
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
// decide（外掛開的准／不要）不在預設裡：開它的外掛自己決定怎麼推（例如一場例會只推一則）
const DEFAULT_PUSH_KINDS = ['ask', 'idea', 'deliv', 'review', 'stuck', 'ended', 'task', 'handoff'];

export function createInbox({
  file,                                  // 收下／看過／知道了／推過的存哪；不給就只放記憶體
  list,                                  // async () → 辦公室裡的人（space.stage()）
  deliverableOf,                         // async (sid) → 成品或 null
  stuckMs = parseInt(process.env.INBOX_STUCK_MS || '600000', 10),   // 10 分鐘
  push = null,                           // { url: () => ntfy topic 網址, click: () => 點了打開哪, kinds, detail: 'brief'｜'full' }
  log = console,
  t = (s, vars) => fill(s, vars),        // 推播文字換語言：(中文原文, 變數) → 字串；預設就是中文
} = {}) {
  let db = {};
  if (file) { try { db = JSON.parse(readFileSync(file, 'utf8')); } catch {} }
  db.dismissed ||= []; db.pushed ||= []; db.seen ||= {}; db.accepted ||= {};
  db.since ||= Date.now();   // 第一次跑之前的對話不算「沒看過」，不然一開就是一整排
  let booted = !!db.booted;
  function save() {
    db.dismissed = db.dismissed.slice(-500); db.pushed = db.pushed.slice(-1500);
    for (const m of [db.seen, db.accepted]) { const ks = Object.keys(m); for (const k of ks.slice(0, Math.max(0, ks.length - 2000))) delete m[k]; }
    db.booted = true;
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(db)); renameSync(file + '.tmp', file); }
    catch (e) { log.error?.('[收件箱] 存檔失敗', e.message); }
  }
  if (!booted) save();

  // 成品要讀紀錄檔：同一輪（sid＋updatedAt）只問一次
  const delivCache = new Map();   // sid → { at, d }
  async function delivFor(v) {
    const c = delivCache.get(v.sid);
    if (c && c.at === v.updatedAt) return c.d;
    let d = null;
    try { d = await deliverableOf?.(v.sid); } catch {}
    delivCache.set(v.sid, { at: v.updatedAt, d });
    return d;
  }
  const delivSummary = (d) => {
    const items = d.items || [d];
    const first = items[0] || {};
    return { type: first.type, title: first.title || first.url || (first.path ? basename(first.path) : ''), count: items.length };
  };

  const providers = [];
  const latest = new Map();   // sid → 最近一輪的時間（看過要蓋到這一輪，不管時鐘差多少）
  async function items() {
    const now = Date.now();
    const out = new Map();
    for (const v of await list().catch(() => [])) {
      if (!v.sid) continue;
      latest.set(v.sid, v.updatedAt || 0);
      const who = { id: v.id, sid: v.sid, cwd: v.cwd, name: v.name || '', title: v.title || '', agent: v.agent, live: !!v.live };
      if (v.status === 'asking') {
        const key = `ask:${v.ask?.requestId || v.sid + ':' + v.updatedAt}`;
        out.set(key, { key, kind: 'ask', at: v.updatedAt, ...who, ask: v.ask || null });
        continue;
      }
      if (v.status === 'working') {
        const longRun = v.act?.kind === 'bash';
        const quiet = now - (longRun ? (v.act?.since || v.updatedAt) : v.updatedAt);
        if (quiet > stuckMs) out.set(`stuck:${v.sid}:${v.updatedAt}`, { key: `stuck:${v.sid}:${v.updatedAt}`, kind: 'stuck', at: v.updatedAt, idleMs: quiet, ...who });
        continue;
      }
      if (v.status !== 'idle' && v.status !== 'background') continue;
      if (now - v.updatedAt > DAY) continue;
      const turnKey = `${v.sid}:${v.updatedAt}`;
      if (v.agent !== 'codex' && db.accepted[v.sid] !== turnKey) {
        const d = await delivFor(v);
        if (d) { out.set(`deliv:${turnKey}`, { key: `deliv:${turnKey}`, kind: 'deliv', at: v.updatedAt, turn: turnKey, deliv: delivSummary(d), ...who }); continue; }
      }
      if (v.updatedAt > Math.max(db.seen[v.sid] || 0, db.since)) out.set(`done:${turnKey}`, { key: `done:${turnKey}`, kind: 'done', at: v.updatedAt, ...who });
    }
    // 宿主的：同一個 key 蓋過核心的（例如能直接回答的提問）；supersedes 列的種類（同一段對話）拿掉，
    // 例如分支交件出現了，這段的「做完了」「交件」就不必再列一次
    for (const p of providers) {
      for (const it of await p().catch((e) => { log.error?.('[收件箱] 外加來源失敗', e); return []; })) {
        if (it.supersedes && it.sid) for (const [k, x] of out) if (x.sid === it.sid && it.supersedes.includes(x.kind)) out.delete(k);
        out.set(it.key, it);
      }
    }
    const dis = new Set(db.dismissed);
    return [...out.values()].filter(i => !dis.has(i.key)).sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  // ── 推播（ntfy）──
  function pushText(i) {
    const who = i.name || i.title || (i.cwd ? basename(i.cwd) : '');
    switch (i.kind) {
      case 'ask': {
        const a = i.ask || {};
        return a.requiresUserInteraction || a.questions ? { title: t('❓ {who} 有問題要你選', { who }), message: a.question || a.input?.questions?.[0]?.question || '' }
          : { title: t('🔐 {who} 要授權', { who }), message: t('{tool}：{what}', { tool: a.displayName || a.toolName || a.tool || '', what: String(a.input?.command || a.input?.file_path || a.preview || a.reason || '').slice(0, 200) }) };
      }
      case 'idea': return { title: t('💡 新提案：{title}', { title: i.idea?.title || i.name }), message: t('{hook}（{id}）', { hook: i.idea?.hook || '', id: i.ideaId }) };
      case 'deliv': return { title: t('📦 {who} 交件了', { who }), message: `${i.deliv.title}${i.deliv.count > 1 ? t(' 等 {n} 樣', { n: i.deliv.count }) : ''}` };
      case 'review': {
        const ev = i.evidence?.state === 'pass' ? t(' · 驗收 ✓') : i.evidence?.state === 'fail' ? t(' · 驗收 ✗ {failed}', { failed: i.evidence.failed.join(t('、')) }) : '';
        return { title: t('🌿 {who} 交了分支', { who }), message: `${i.repo} · ${i.branch} · ${t('{n} 個 commit', { n: i.commits })} · +${i.add} −${i.del}${i.dirty ? t(' · {n} 個沒 commit', { n: i.dirty }) : ''}${ev}` };
      }
      case 'stuck': return { title: t('⏳ {who} 卡住了', { who }), message: t('{n} 分鐘沒動靜', { n: Math.round(i.idleMs / 60000) }) };
      case 'done': return { title: t('✅ {who} 做完了', { who }), message: i.title || '' };
      case 'ended': return { title: t('⚠ {who} 意外結束', { who }), message: i.reasonText || i.reason || '' };
      case 'handoff': return { title: t('🙋 等你辦：{title}', { title: i.handoff?.title || i.name }), message: i.handoff?.steps?.[0] || i.handoff?.why || '' };
      case 'decide': return { title: t('🤔 等你決定：{title}', { title: i.decide?.title || i.name }), message: (i.decide?.lines || [])[0] || '' };
      case 'task': { const st = { awaiting_permission: '待授權', awaiting_review: '待驗收', failed: '失敗', interrupted: '中斷了' }[i.status];
        return { title: t('📋 任務「{name}」等你處理', { name: i.name }), message: st ? t(st) : i.status }; }
    }
    return { title: t('收件箱'), message: '' };
  }
  // 推播的內容層級：ntfy 的 topic 是公開的，知道名字的人都看得到。預設 brief 只說誰要什麼，
  // 不帶指令、檔案路徑、提案內容；full 才帶細節（topic 夠難猜、或自架有登入的 ntfy 再開）
  const BRIEF = { ask: '要你決定', idea: '有新提案', deliv: '交件了', review: '交了分支', stuck: '卡住了', done: '做完了', ended: '意外結束', task: '任務等你處理', handoff: '有件事要你本人辦', decide: '有件事等你決定' };
  function briefText(i) {
    const who = ['idea', 'task', 'handoff', 'decide'].includes(i.kind) ? '' : (i.name || '') + ' ';
    return { title: `${{ ask: '🔐', idea: '💡', deliv: '📦', review: '🌿', stuck: '⏳', done: '✅', ended: '⚠', task: '📋', handoff: '🙋', decide: '🤔' }[i.kind] || ''} ${who}${t(BRIEF[i.kind] || '等你處理')}`.trim(), message: t('點開看') };
  }
  async function sendPush(i) {
    const url = push?.url?.();
    if (!url) return;
    const u = new URL(url);
    const { title, message } = push.detail === 'full' ? pushText(i) : briefText(i);
    const click = push.click?.();
    const body = { topic: u.pathname.replace(/^\//, ''), title: title.slice(0, 120), message: message || title, tags: ['inbox_tray'],
      priority: i.kind === 'ask' ? 4 : 3, click: click || undefined };
    const r = await fetch(u.origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  // 有變化就重算；新出現的推一次。第一次只記下來不推（不然一開就連發）
  let timer = null, running = false, again = false, last = [];
  const listeners = new Set();
  function changed() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (running) { again = true; return; }
      running = true;
      try {
        const list = await items();
        last = list;
        const pushed = new Set(db.pushed);
        const fresh = list.filter(i => !pushed.has(i.key));
        for (const i of fresh) db.pushed.push(i.key);
        const kinds = push?.kinds || DEFAULT_PUSH_KINDS;
        if (booted) for (const i of fresh) if (kinds.includes(i.kind)) sendPush(i).catch(e => log.warn?.(`[收件箱] 推播失敗：${e.message}`));
        booted = true;
        if (fresh.length) save();
        for (const fn of listeners) fn(list);
      } catch (e) { log.error?.('[收件箱] 重算失敗', e); }
      running = false;
      if (again) { again = false; changed(); }
    }, 1500);
  }
  setInterval(changed, 60000).unref();   // 卡住是「沒事發生」才成立的，要定期看
  setTimeout(changed, 3000).unref();

  const markSeen = (sid, at = 0) => {
    if (!sid) return;
    db.seen[sid] = Math.max(db.seen[sid] || 0, at, Date.now(), latest.get(sid) || 0);
    save(); changed();
  };

  const router = Router();
  router.get('/', async (req, res) => { const list = await items(); last = list; res.json({ items: list, count: list.length, push: !!push?.url?.() }); });
  router.post('/dismiss', (req, res) => {
    const { key } = req.body || {};
    if (typeof key !== 'string' || !key) return res.status(400).json({ error: '缺 key' });
    for (const fn of dismissHooks) fn(key);
    db.dismissed.push(key); save(); changed();
    res.json({ ok: true });
  });
  router.post('/seen', (req, res) => {
    const sid = String(req.body?.sid || '');
    if (!sid) return res.status(400).json({ error: '缺 sid' });
    markSeen(sid, Number(req.body?.at) || 0);
    res.json({ ok: true });
  });
  // 收下成品：記住是哪一輪（同一段對話下一輪又做出東西，會再出現）
  router.post('/accept', (req, res) => {
    const { sid, turn } = req.body || {};
    if (!sid || !turn) return res.status(400).json({ error: '缺 sid 或 turn' });
    db.accepted[sid] = String(turn);
    db.seen[sid] = Math.max(db.seen[sid] || 0, Number(String(turn).split(':').pop()) || 0);
    save(); changed();
    res.json({ ok: true });
  });
  // 舊版辦公室存在瀏覽器的「看過」「收下」：第一次載入時搬過來，合併後不會整排重新冒出來
  router.post('/import', (req, res) => {
    const { seen = {}, accepted = {} } = req.body || {};
    let n = 0;
    for (const [sid, at] of Object.entries(seen)) if (Number(at) > (db.seen[sid] || 0)) { db.seen[sid] = Number(at); n++; }
    for (const [sid, key] of Object.entries(accepted)) if (typeof key === 'string' && !db.accepted[sid]) { db.accepted[sid] = key; n++; }
    save(); changed();
    res.json({ ok: true, imported: n });
  });

  const dismissHooks = new Set();
  return {
    router, items, changed, markSeen,
    addProvider: (fn) => { providers.push(fn); changed(); },
    onDismiss: (fn) => dismissHooks.add(fn),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    last: () => last,
  };
}
