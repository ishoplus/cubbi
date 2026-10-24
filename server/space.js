// ── 空間後端核心 ──────────────────────────────────────────────────────────────
//
// 空間裡一個人物＝一段對話。人物從「來源」來（sources/*.js，介面見 sources/common.js），例如：
//   transcript  ~/.claude/projects 的紀錄檔：所有 Claude Code 對話，也提供進度與縮時回放
//   （宿主可以再掛自己的來源，例如 claude-web 自己開的對話有即時事件）
// 核心只做：合併各來源的清單（排座位、歸檔）、把變化推給看著空間的人、空間周邊的小 API。

import { Router } from 'express';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { canShoot, screenshot } from './deliverable.js';
import { delivLog } from './deliv-log.js';
import { createInbox } from './inbox.js';
import { untrustedFile } from './files.js';

const MAX_PER_PROJECT = 6;   // 舊紀錄每個專案最多幾段
const SEATS_PER_PROJECT = 8;   // 一張大桌的座位數（前端 SEATS_PER_ISLAND）：進行中的對話優先坐，舊紀錄補空位
const MAX_TOTAL = 40;

// 同一段對話好幾個來源都有：先到的為主，後到的補空欄；名字以後到的為準（紀錄檔有使用者自訂的標題）
function fill(have, v) {
  if (!have.title) have.title = v.title;
  if (v.name) have.name = v.name;
  if (!have.act) have.act = v.act;
  if (v.prompt && (!have.prompt || v.prompt.at > have.prompt.at)) have.prompt = v.prompt;
}

// 各來源的清單交錯合併：進行中的先，其他照最近活動時間（不然排前面的來源會把座位坐滿）
// 每個來源本身已經是新到舊，所以只要比各來源的下一筆
async function* byRecency(sources) {
  const its = sources.map(src => ({ src, it: src.list()[Symbol.asyncIterator](), head: null, done: false }));
  const rank = (v) => (v.live ? Infinity : v.updatedAt || 0);
  for (const x of its) { const r = await x.it.next(); x.done = r.done; x.head = r.value; }
  try {
    for (;;) {
      let best = null;
      for (const x of its) if (!x.done && (!best || rank(x.head) > rank(best.head))) best = x;
      if (!best) return;
      yield [best.head, best.src];
      const r = await best.it.next(); best.done = r.done; best.head = r.value;
    }
  } finally { for (const x of its) if (!x.done) x.it.return?.(); }
}

// sources：依優先順序（即時的放前面）
// workRoot：專案名稱從這層往下算（前端顯示用）
// archiveFile：歸檔名單存哪
// weather：{ lat, lon, timezone }，不給就沒有天氣
// progressExtra(sid)：宿主在進度上加的欄位
// extend(router)：宿主加自己的路由（掛在同一個前綴下）
// delivFile：成品歷史存哪（預設跟歸檔名單放一起；給 null 就不記）
// inbox：{ file, push } 等你處理的清單（server/inbox.js）存哪、推到哪；不給就不存檔、不推播
export function createSpace({ sources, workRoot, archiveFile, delivFile = archiveFile && join(dirname(archiveFile), 'space-deliverables.jsonl'), weather: weatherAt = null, progressExtra = () => ({}), extend, inbox: inboxOpts = {} } = {}) {
  const dlog = delivLog({ file: delivFile });
  const observers = new Set();   // /events 的 SSE 連線
  // 推給所有看著空間的人
  function broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const res of observers) { try { res.write(`data: ${json}\n\n`); } catch {} }
  }

  // ── 歸檔：不想再看到的對話從空間拿掉（之後對話又有新動作就自動回來）──
  let archived = null;   // sid -> 歸檔時間
  async function loadArchive() { if (!archived) { try { archived = JSON.parse(await readFile(archiveFile, 'utf8')); } catch { archived = {}; } } return archived; }
  async function saveArchive() {
    await mkdir(dirname(archiveFile), { recursive: true });
    await writeFile(archiveFile + '.tmp', JSON.stringify(archived));
    await rename(archiveFile + '.tmp', archiveFile);
  }
  const isArchived = (sid, mtime) => archived?.[sid] && mtime <= archived[sid] + 60_000;

  // 合併各來源的清單：進行中的對話優先坐，同專案舊紀錄補剩下的座位
  async function stage() {
    const out = new Map(), from = new Map();   // id -> 人物、id -> 來源
    const perProject = new Map(), liveIn = new Map();
    await loadArchive();
    for await (const [v, src] of byRecency(sources)) {
      const have = out.get(v.id);
      if (!have && !v.live && isArchived(v.id, v.updatedAt)) continue;
      if (out.size >= MAX_TOTAL) break;
      if (have) { fill(have, v); continue; }
      if (v.hidden) continue;
      if (v.live) liveIn.set(v.cwd, (liveIn.get(v.cwd) || 0) + 1);
      else {
        const n = perProject.get(v.cwd) || 0;
        if (n >= Math.min(MAX_PER_PROJECT, SEATS_PER_PROJECT - (liveIn.get(v.cwd) || 0))) continue;
        perProject.set(v.cwd, n + 1);
      }
      out.set(v.id, v); from.set(v.id, src);
    }
    for (const src of sources) src.shown?.([...out.values()].filter(v => from.get(v.id) === src));
    return [...out.values()];
  }

  const weather = { data: null, at: 0 };
  const seen = new Set();   // 上過場的對話（縮時回放用）
  // 一輪做完（變成閒著）就判斷一次成品、記進歷史：沒人看著辦公室也記得到。紀錄檔晚一點才寫完，等幾秒
  const delivAsked = new Map();   // sid -> 上次問的 updatedAt
  function noteDone(v) {
    if (!v?.sid || v.status !== 'idle' || delivAsked.get(v.sid) === v.updatedAt) return;
    delivAsked.set(v.sid, v.updatedAt);
    setTimeout(() => deliverableOf(v.sid).catch(() => {}), 4000).unref?.();
  }
  // 等你處理：從辦公室裡的人算（舉手、交件、卡住、做完了），宿主可以再加（addProvider）
  const inbox = createInbox({ ...inboxOpts, list: () => stage(), deliverableOf: (sid) => deliverableOf(sid) });
  for (const src of sources) src.subscribe?.({ push: (session) => { noteDone(session); inbox.changed(); broadcast({ type: 'update', session }); }, watching: () => observers.size > 0 });

  const r = Router();
  r.use('/inbox', inbox.router);
  // 空間裡該站哪些人
  r.get('/sessions', async (req, res) => {
    const list = await stage();
    for (const v of list) if (v.sid) { seen.add(v.sid); v.delivs = dlog.count(v.sid); }
    res.json({ workRoot, sessions: list });
  });

  // 即時狀態推播：各來源有變化就推；宿主的其他事件也走這裡（broadcast）
  r.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    observers.add(res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    res.on('close', () => { clearInterval(hb); observers.delete(res); });
  });

  r.post('/archive', async (req, res) => {
    const { sid, archived: on } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(sid || ''))) return res.status(400).json({ error: 'sid 格式不對' });
    await loadArchive();
    if (on) archived[sid] = Date.now(); else delete archived[sid];
    await saveArchive();
    res.json({ ok: true });
  });

  // 真實天氣：Open-Meteo 免金鑰，15 分鐘查一次
  r.get('/weather', async (req, res) => {
    if (weatherAt && (!weather.data || Date.now() - weather.at > 15 * 60_000)) {
      try {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${weatherAt.lat}&longitude=${weatherAt.lon}&current=weather_code,cloud_cover,precipitation,temperature_2m&timezone=${encodeURIComponent(weatherAt.timezone || 'auto')}`;
        const j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
        if (j.current) weather.data = { code: j.current.weather_code, cloud: j.current.cloud_cover, rain: j.current.precipitation, temp: j.current.temperature_2m };
        weather.at = Date.now();
      } catch { weather.at = Date.now() - 10 * 60_000; }   // 失敗五分鐘後再試，先用舊的
    }
    res.json(weather.data || null);
  });

  // 縮時回放：上過場的每段對話從 from 起的動作時間軸 [[時間, 種類], …]，第一個認得的來源回答
  r.get('/timeline', async (req, res) => {
    const from = Number(req.query.from) || (Date.now() - 12 * 3600_000);
    const sids = new Set(seen);
    for (const src of sources) for (const sid of src.liveIds?.() || []) sids.add(sid);
    const out = {};
    for (const sid of sids) {
      for (const src of sources) {
        const tl = await src.timeline?.(sid, from);
        if (!tl) continue;
        if (tl.length) out[sid] = tl;
        break;
      }
    }
    res.json({ from, to: Date.now(), sessions: out });
  });

  // 進度：第一個認得的來源給步驟；有即時狀態的來源（view）補現在的狀態
  r.get('/progress', async (req, res) => {
    const sid = String(req.query.sessionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(sid)) return res.status(400).json({ error: 'sessionId 格式不對' });
    let now = null;
    for (const src of sources) if ((now = src.view?.(sid) || null)) break;
    try {
      let p = null;
      for (const src of sources) if ((p = await src.progress?.(sid))) break;
      if (!p) return res.json({ steps: [], todos: null, files: [], live: now });
      res.json({ ...p, live: now, ...progressExtra(sid) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 成品：最新一輪做出來的東西。檔案和截圖只給「這段對話現在的成品」那幾樣（?i= 第幾樣），不能拿來讀任意檔
  async function deliverableOf(sid) {
    for (const src of sources) {
      const d = await src.deliverable?.(sid);
      if (d !== undefined) { if (d) dlog.record(sid, d); return d; }
    }
    return null;
  }
  const itemAt = (d, req) => d?.items?.[Math.max(0, parseInt(req.query.i, 10) || 0)] || (req.query.i ? null : d);
  const sidOf = (req, res) => {
    const sid = String(req.query.sessionId || '');
    if (/^[0-9a-f-]{36}$/i.test(sid)) return sid;
    res.status(400).json({ error: 'sessionId 格式不對' });
  };
  r.get('/deliverable', async (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    try {
      const d = await deliverableOf(sid);
      res.json(d ? { ...d, shot: canShoot(d), items: (d.items || [d]).map(it => ({ ...it, shot: canShoot(it) })) } : null);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.get('/deliverable/file', async (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    const d = await deliverableOf(sid).catch(() => null), it = itemAt(d, req);
    if (!it?.path) return res.status(404).end();
    untrustedFile(res, it.path);
    res.sendFile(it.path, { dotfiles: 'allow' }, (e) => e && !res.headersSent && res.status(404).end());
  });
  r.get('/deliverable/shot', async (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    const d = await deliverableOf(sid).catch(() => null), it = itemAt(d, req);
    const file = it && await screenshot({ ...it, at: d.at });
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file, (e) => e && !res.headersSent && res.status(404).end());
  });

  // 成品歷史：以前每一輪的成品（新的在前）；檔案與縮圖只給記錄過的那幾樣
  r.get('/deliverable/history', (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    res.json(dlog.history(sid));
  });
  const histItem = (req) => [String(req.query.turn || ''), Math.max(0, parseInt(req.query.i, 10) || 0)];
  r.get('/deliverable/history/file', (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    const it = dlog.item(sid, ...histItem(req));
    if (!it?.path) return res.status(404).end();
    untrustedFile(res, it.path);
    res.sendFile(it.path, { dotfiles: 'allow' }, (e) => e && !res.headersSent && res.status(404).end());
  });
  r.get('/deliverable/history/thumb', (req, res) => {
    const sid = sidOf(req, res); if (!sid) return;
    const file = dlog.thumbOf(sid, ...histItem(req));
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(file, (e) => e && !res.headersSent && res.status(404).end());
  });

  extend?.(r);
  return { router: r, broadcast, watching: () => observers.size > 0, stage, inbox };
}
