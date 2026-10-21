// ── 空間後端核心 ──────────────────────────────────────────────────────────────
//
// 空間裡一個人物＝一段對話。人物從「來源」來（sources/*.js，介面見 sources/common.js），例如：
//   transcript  ~/.claude/projects 的紀錄檔：所有 Claude Code 對話，也提供進度與縮時回放
//   （宿主可以再掛自己的來源，例如 claude-web 自己開的對話有即時事件）
// 核心只做：合併各來源的清單（排座位、歸檔）、把變化推給看著空間的人、空間周邊的小 API。

import { Router } from 'express';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';

const MAX_PER_PROJECT = 6;   // 舊紀錄每個專案最多幾段
const SEATS_PER_PROJECT = 8;   // 一張大桌的座位數（前端 SEATS_PER_ISLAND）：進行中的對話優先坐，舊紀錄補空位
const MAX_TOTAL = 40;

// 同一段對話好幾個來源都有：先到的為主，後到的補空欄；名字以後到的為準（紀錄檔有使用者自訂的標題）
function fill(have, v) {
  if (!have.title) have.title = v.title;
  if (v.name) have.name = v.name;
  if (!have.act) have.act = v.act;
}

// sources：依優先順序（即時的放前面）
// workRoot：專案名稱從這層往下算（前端顯示用）
// archiveFile：歸檔名單存哪
// weather：{ lat, lon, timezone }，不給就沒有天氣
// progressExtra(sid)：宿主在進度上加的欄位
// extend(router)：宿主加自己的路由（掛在同一個前綴下）
export function createSpace({ sources, workRoot, archiveFile, weather: weatherAt = null, progressExtra = () => ({}), extend } = {}) {
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
    for (const src of sources) {
      for await (const v of src.list()) {
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
    }
    for (const src of sources) src.shown?.([...out.values()].filter(v => from.get(v.id) === src));
    return [...out.values()];
  }

  const weather = { data: null, at: 0 };
  const seen = new Set();   // 上過場的對話（縮時回放用）
  for (const src of sources) src.subscribe?.({ push: (session) => broadcast({ type: 'update', session }), watching: () => observers.size > 0 });

  const r = Router();
  // 空間裡該站哪些人
  r.get('/sessions', async (req, res) => {
    const list = await stage();
    for (const v of list) if (v.sid) seen.add(v.sid);
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

  extend?.(r);
  return { router: r, broadcast };
}
