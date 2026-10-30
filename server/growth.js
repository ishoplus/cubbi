// ── 自動成長：辦公室照真實用量長大（沒有貨幣、不用買）──────────────────────────
//
// 從 Claude Code 的全部紀錄算累積用量：完成的回合、你上班的天數、改過的檔案、commit、派出去的助手。
// 公司等級看「回合＋commit×3」；各部門（專案）的設備看那個專案自己的回合數；獎盃看里程碑。
// 紀錄可能有好幾 GB：每個檔案記住讀到哪個位元組，之後只讀新增的部分（存在 cacheFile）。
import { createReadStream } from 'fs';
import { readdir, stat, readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ── 規則（純函式，可以測）──
export const LEVELS = [0, 200, 1000, 4000, 12000];   // 公司等級門檻（分數）
// 每一級解鎖的公共設施（跟著等級自動送到）
export const LEVEL_FACILITIES = [
  { coffee: 0, lounge: 0, game: 0, wall: 0, hotdesk: 0, pet: 0, gym: 0, aquarium: 0, band: 0, cafeteria: 0, pods: 0, golf: 0 },
  { coffee: 1, lounge: 0, game: 0, wall: 1, hotdesk: 0, pet: 0, gym: 0, aquarium: 0, band: 0, cafeteria: 0, pods: 0, golf: 0 },
  { coffee: 1, lounge: 1, game: 1, wall: 1, hotdesk: 1, pet: 0, gym: 0, aquarium: 0, band: 0, cafeteria: 0, pods: 0, golf: 0 },
  { coffee: 2, lounge: 2, game: 2, wall: 1, hotdesk: 1, pet: 1, gym: 1, aquarium: 1, band: 1, cafeteria: 0, pods: 0, golf: 0 },
  { coffee: 2, lounge: 2, game: 2, wall: 2, hotdesk: 2, pet: 2, gym: 2, aquarium: 2, band: 2, cafeteria: 2, pods: 2, golf: 2 },
];
// 部門設備：那個專案的回合數到了就升級
const TIERS = { monitor: [0, 50, 300, 1500], chair: [0, 100, 600, 2500], desk: [0, 200, 1000, 4000] };
const TRINKETS = { plant: 30, lamp: 150, figurine: 800 };
const FLOORS = [['grass', 2000], ['wood', 500], ['carpet', 100], ['plate', 0]];
export const TROPHIES = [
  { id: 'first_bg', shape: 'cup', test: (s) => s.bg >= 1 },
  { id: 'streak7', shape: 'star', test: (s) => s.bestStreak >= 7 },
  { id: 'day50', shape: 'plaque', test: (s) => s.bestDay >= 50 },
  { id: 'commit100', shape: 'cup', test: (s) => Object.values(s.projects).some(p => p.commits >= 100) },
  { id: 'streak30', shape: 'bigcup', test: (s) => s.bestStreak >= 30 },
  { id: 'office', shape: 'plaque', test: (s) => levelOf(s) >= 2 },
  { id: 'turns10k', shape: 'star', test: (s) => s.turns >= 10000 },
  { id: 'hq', shape: 'bigcup', test: (s) => levelOf(s) >= 4 },
];

export const scoreOf = (s) => s.turns + s.commits * 3;
export function levelOf(s) { const sc = scoreOf(s); let l = 0; LEVELS.forEach((at, i) => { if (sc >= at) l = i; }); return l; }
const tier = (list, n) => list.reduce((lv, at, i) => (n >= at ? i : lv), 0);

// 用量 → 辦公室長相（前端 setLook 吃的格式）＋下一級還差多少
export function lookOf(s) {
  const level = levelOf(s), score = scoreOf(s);
  const depts = {};
  for (const [cwd, p] of Object.entries(s.projects)) {
    const trinkets = {}, owned = { plate: true };
    for (const [k, at] of Object.entries(TRINKETS)) if (p.turns >= at) { trinkets[k] = true; owned[k] = true; }
    const floor = FLOORS.find(([, at]) => p.turns >= at)[0]; owned[floor] = true;
    depts[cwd] = { equip: { monitor: tier(TIERS.monitor, p.turns), chair: tier(TIERS.chair, p.turns), desk: tier(TIERS.desk, p.turns), trinkets, owned, floor }, outfit: null };
  }
  return {
    level, facilities: LEVEL_FACILITIES[level], depts,
    trophies: TROPHIES.filter(t => t.test(s)).map(t => ({ id: t.id, shape: t.shape })),
    progress: { score, next: LEVELS[level + 1] ?? null, turns: s.turns, commits: s.commits, days: s.days, files: s.files, bestStreak: s.bestStreak },
  };
}

// ── 讀紀錄 ──
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isPrompt = (e) => {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('') : '';
  return !!t.trim() && !t.trim().startsWith('<');
};

// 讀一個檔案從 off 開始的完整行，累加到 f（每個檔案自己的小計）
function scanFile(path, f) {
  return new Promise((resolve) => {
    let buf = '', pos = f.off;
    const s = createReadStream(path, { start: f.off, encoding: 'utf8', highWaterMark: 1 << 20 });
    s.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        pos += Buffer.byteLength(line) + 1;
        eat(line, f);
      }
      if (buf.length > 64 << 20) buf = '';   // 異常長的一行（巨大工具輸出）：放棄這行
    });
    s.on('end', () => { f.off = pos; resolve(); });   // 最後沒換行的半行留到下次讀
    s.on('error', () => resolve());
  });
}
function eat(line, f) {
  const asst = line.includes('"type":"assistant"');
  if (!asst && (!line.includes('"type":"user"') || line.includes('"tool_result"'))) return;   // 工具輸出那種大行直接跳過
  let e; try { e = JSON.parse(line); } catch { return; }
  if (e.isSidechain) return;
  if (!f.cwd && e.cwd) f.cwd = e.cwd;
  const day = e.timestamp ? dayOf(e.timestamp) : null;
  if (isPrompt(e)) { if (day) f.days[day] = f.days[day] || 0; return; }
  if (!asst) return;
  if (e.message?.stop_reason === 'end_turn') { f.turns++; if (day) f.days[day] = (f.days[day] || 0) + 1; }
  for (const b of e.message?.content || []) {
    if (b.type !== 'tool_use') continue;
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path)) {
      const fp = b.input.file_path || b.input.notebook_path;
      if (!f.fileSet.includes(fp)) f.fileSet.push(fp);
    }
    if (b.name === 'Bash' && /\bgit\s+commit\b/.test(b.input?.command || '')) f.commits++;
    if (/^(Task|Agent)$/.test(b.name)) f.bg++;
  }
}

// 各檔案小計 → 總計
export function totals(files, today = dayOf(Date.now())) {
  const s = { turns: 0, commits: 0, bg: 0, files: 0, days: 0, bestDay: 0, bestStreak: 0, projects: {} };
  const days = {};
  for (const f of Object.values(files)) {
    s.turns += f.turns; s.commits += f.commits; s.bg += f.bg; s.files += f.fileSet.length;
    for (const [d, n] of Object.entries(f.days)) days[d] = (days[d] || 0) + n;
    if (f.cwd) { const p = (s.projects[f.cwd] ||= { turns: 0, commits: 0 }); p.turns += f.turns; p.commits += f.commits; }
  }
  const list = Object.keys(days).sort();
  s.days = list.length;
  s.bestDay = Math.max(0, ...Object.values(days));
  let run = 0, prev = null;
  for (const d of list) {
    run = prev && (Date.parse(d) - Date.parse(prev)) === 86400_000 ? run + 1 : 1;
    s.bestStreak = Math.max(s.bestStreak, run); prev = d;
  }
  s.today = days[today] || 0;
  return s;
}

export function createGrowth({ claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), cacheFile, onChange = () => {} } = {}) {
  const root = join(claudeDir, 'projects');
  let cache = null, state = { ready: false, scanned: 0, total: 0 }, look = null, running = false;

  async function load() {
    if (cache) return;
    try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { cache = { v: 1, files: {} }; }
  }
  async function save() {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile + '.tmp', JSON.stringify(cache));
    await rename(cacheFile + '.tmp', cacheFile);
  }
  // 掃一輪：新檔從頭讀、長大的檔只讀新增的部分、縮小的（被重寫）重讀
  async function scan() {
    if (running) return; running = true;
    try {
      await load();
      const list = [];
      for (const dir of await readdir(root).catch(() => [])) {
        for (const name of await readdir(join(root, dir)).catch(() => [])) if (name.endsWith('.jsonl')) list.push(join(root, dir, name));
      }
      state.total = list.length; state.scanned = 0;
      let dirty = false, n = 0;
      for (const path of list) {
        state.scanned++;
        const st = await stat(path).catch(() => null);
        if (!st) continue;
        let f = cache.files[path];
        if (f && st.size < f.off) f = null;
        if (!f) f = cache.files[path] = { off: 0, cwd: '', turns: 0, commits: 0, bg: 0, fileSet: [], days: {} };
        if (st.size > f.off) { await scanFile(path, f); dirty = true; }
        if (dirty && ++n % 200 === 0) { await save(); dirty = false; publish(); }   // 第一次回顧很久：途中也存檔、讓辦公室邊回顧邊長大
      }
      if (dirty) await save();
      state.ready = true;
      publish();
    } finally { running = false; }
  }
  function publish() {
    const next = lookOf(totals(cache.files));
    const changed = JSON.stringify(next) !== JSON.stringify(look);
    look = next;
    if (changed) onChange({ type: 'growth' });
  }

  return {
    start({ every = 60_000 } = {}) { scan().catch(e => console.error('[growth]', e.message)); setInterval(() => scan().catch(() => {}), every).unref(); },
    scan,
    extend(r) { r.get('/growth', (req, res) => res.json({ ...state, look })); },
    level: () => look?.level ?? null,
    _cache: () => cache,
  };
}
