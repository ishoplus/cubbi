// ── 排程（Routine）：到點自動開工 ──────────────────────────────────────────────
//
// 設定檔 routines，一項一個：
//   { id, name, at: "09:00", days: "daily" | "weekdays" | "mon,wed,fri", enabled: true,
//     action: { type: "ideas" }                                    提案部跑一批
//           | { type: "prompt", cwd, prompt, driver?, worktree? }  開一段對話交代一件事（辦公室裡多一個人在做；git 專案預設開分支）
//           | { type: "cmd", cmd, cwd? } }                          跑一個指令（例如自己寫的腳本）
// 時間照這台電腦的時區。伺服器沒開著錯過的，2 小時內開起來會補跑一次；更早的就算了（不補一堆）。
// 跑過的紀錄存 routines-state.json（上次跑的時間、結果、開的對話）。排程牆從這裡拿「接下來要跑的」。
import { Router } from 'express';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { exec } from 'child_process';
import { t as tx, tr, langOf, SERVER_LANG } from './i18n.js';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CATCH_UP_MS = 2 * 3600000;

export function daysOf(days = 'daily') {
  const d = String(days).toLowerCase().trim();
  if (d === 'daily' || d === '' || d === '*') return [0, 1, 2, 3, 4, 5, 6];
  if (d === 'weekdays') return [1, 2, 3, 4, 5];
  if (d === 'weekends') return [0, 6];
  return d.split(/[,\s]+/).map(x => DAY_NAMES.indexOf(x.slice(0, 3))).filter(i => i >= 0);
}
// 某天那一次的時間（本機時區）
function slotOn(day, at) {
  const [h, m] = String(at || '09:00').split(':').map(Number);
  const t = new Date(day); t.setHours(h || 0, m || 0, 0, 0);
  return t.getTime();
}
// now 之前（含）最近的一次；沒有就 null（一週都沒排）
export function lastSlot(r, now = Date.now()) {
  const ds = daysOf(r.days);
  for (let back = 0; back < 8; back++) {
    const day = new Date(now - back * 86400000);
    if (!ds.includes(day.getDay())) continue;
    const t = slotOn(day, r.at);
    if (t <= now) return t;
  }
  return null;
}
// from 起往後 days 天內的每一次
export function slotsBetween(r, from, days) {
  const ds = daysOf(r.days), out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(from + i * 86400000);
    if (ds.includes(day.getDay())) out.push(slotOn(day, r.at));
  }
  return out;
}

// lang：錯誤說明用哪種語言（路由給請求的語言）；不給就中文
export function validRoutine(r, lang = 'zh') {
  const L = (s, v) => tx(lang, s, v);
  if (!r || typeof r !== 'object') return L('格式不對');
  if (!/^[a-z0-9_-]{1,40}$/i.test(r.id || '')) return L('id 只能是英數、- 或 _');
  if (!/^\d{1,2}:\d{2}$/.test(r.at || '')) return L('時間寫成 09:00 這樣');
  if (!daysOf(r.days).length) return L('星期幾寫成 daily、weekdays 或 mon,wed,fri');
  const t = r.action?.type;
  if (t === 'prompt' && !(r.action.cwd && r.action.prompt)) return L('要給資料夾和要交代的話');
  if (t === 'cmd' && !r.action.cmd) return L('要給指令');
  if (!['ideas', 'prompt', 'cmd'].includes(t)) return L('不認得的動作：{type}', { type: t });
  return null;
}

// runners：{ ideas(r), prompt(r) → sid, cmd(r) }；routines()：目前設定檔裡的清單；save(list)：寫回設定檔
export function createRoutines({ routines, save, stateFile, runners, log = console, now = () => Date.now() }) {
  let state = {};
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
  const saveState = () => {
    try { mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2)); renameSync(stateFile + '.tmp', stateFile); }
    catch (e) { log.error?.('[排程] 存檔失敗', e.message); }
  };
  const running = new Set();

  async function run(r, slot = now()) {
    if (running.has(r.id)) return state[r.id];
    running.add(r.id);
    const rec = state[r.id] = { ...(state[r.id] || {}), lastRun: slot, startedAt: now(), status: 'running', error: null };
    saveState();
    log.log?.(tx(SERVER_LANG(), '[排程] {name} 開始', { name: r.name || r.id }));
    try {
      const out = await runners[r.action.type](r);
      Object.assign(rec, { status: 'ok', endedAt: now(), ...(typeof out === 'string' ? { sid: out } : {}), ...(out?.sid ? { sid: out.sid } : {}), ...(out?.note ? { note: out.note } : {}) });
    } catch (e) {
      Object.assign(rec, { status: 'error', endedAt: now(), error: String(e.message || e).slice(0, 300) });
      log.warn?.(tx(SERVER_LANG(), '[排程] {name} 失敗：{error}', { name: r.name || r.id, error: rec.error }));
    } finally { running.delete(r.id); saveState(); }
    return rec;
  }

  // 每 30 秒看一次：到點、還沒跑過這一次、沒錯過太久 → 跑
  function tick() {
    const t = now();
    for (const r of routines()) {
      if (r.enabled === false || validRoutine(r)) continue;
      const slot = lastSlot(r, t);
      if (slot == null || t - slot > CATCH_UP_MS) continue;
      if ((state[r.id]?.lastRun || 0) >= slot) continue;
      run(r, slot);
    }
  }
  const timer = setInterval(tick, 30000); timer.unref?.();
  setTimeout(tick, 5000).unref?.();

  // 排程牆用：從 from 起 days 天內每一次（已經跑過的帶結果）
  function occurrences(from, days) {
    const out = [];
    for (const r of routines()) {
      if (r.enabled === false || validRoutine(r)) continue;
      for (const at of slotsBetween(r, from, days)) {
        const rec = state[r.id];
        const ran = rec?.lastRun === at;
        if (!ran && at < now()) continue;   // 過去的只列真的跑過的（排程是後來才加的，前幾天不算錯過）
        out.push({ id: `${r.id}@${at}`, routineId: r.id, source: 'routine', channel: tx(SERVER_LANG(), '排程'), title: r.name || r.id, when: new Date(at).toISOString(),
          status: ran ? rec.status : 'planned', action: r.action.type, ...(ran && rec.sid ? { sid: rec.sid } : {}), ...(ran && rec.error ? { error: rec.error } : {}) });
      }
    }
    return out;
  }

  const router = Router();
  router.get('/', (req, res) => res.json({ routines: routines().map(r => ({ ...r, state: state[r.id] || null, invalid: validRoutine(r, langOf(req)) })) }));
  router.post('/', (req, res) => {
    const r = req.body || {};
    const bad = validRoutine(r, langOf(req));
    if (bad) return res.status(400).json({ error: bad });
    const list = routines().filter(x => x.id !== r.id).concat([{ id: r.id, name: String(r.name || r.id).slice(0, 60), at: r.at, days: r.days || 'daily', enabled: r.enabled !== false, action: r.action }]);
    save(list);
    res.json({ ok: true });
  });
  router.delete('/:id', (req, res) => { save(routines().filter(x => x.id !== req.params.id)); res.json({ ok: true }); });
  router.post('/:id/run', async (req, res) => {
    const r = routines().find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: tr(req, '沒有這個排程') });
    if (running.has(r.id)) return res.status(409).json({ error: tr(req, '正在跑') });
    run(r);   // 不等它跑完（提案要好幾分鐘）
    res.json({ ok: true });
  });

  return { router, occurrences, run, tick, state: () => state, isRunning: (id) => running.has(id) };
}

// cmd 型：跑一個指令，輸出最後一段記下來
export function runCmd({ cmd, cwd }, { timeoutMs = 30 * 60000 } = {}) {
  return new Promise((resolve, reject) => exec(cmd, { cwd: cwd || process.cwd(), timeout: timeoutMs, maxBuffer: 4 << 20 },
    (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim().slice(-300))) : resolve({ note: String(stdout).trim().slice(-300) })));
}
