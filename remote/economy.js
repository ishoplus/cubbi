// ── 3D 工作室的經營系統：積木帳本 ────────────────────────────────────────────
//
// 只獎勵做出來的成果，不獎勵用量（不然等於鼓勵多燒 token）：
//   回合順利完成 1、待辦勾掉一項 2、改了一個檔案 1（同對話同檔只算一次）、
//   背景任務做完 2、git commit 成功 5、當天第一次上班 3；連續上班每天 +10%，最多 ×1.5。
//   防灌水：每個專案每小時最多 30 塊；不到 10 秒就結束的回合不算。
// 資料來源是 ~/.claude/projects 的對話紀錄（終端機開的也算），每分鐘增量掃一次；
// 第一次啟動回算過去 30 天當開張家底。賺到的一半進部門（專案）、一半進公司。

import { Router } from 'express';
import { open, readdir, stat, readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dataFile } from './paths.js';
import { tr, errText } from './i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(process.env.HOME || '', '.claude', 'projects');
const STATE_FILE = process.env.SPACE_ECON_FILE || dataFile('space-economy.json');
const RETRO_DAYS = 30;
const SCAN_EVERY_MS = 60_000;
const HOURLY_CAP = 30;
const MIN_TURN_MS = 10_000;

export const RULES = { turn: 1, todo: 2, file: 1, bg: 2, commit: 5, checkin: 3 };
export const RULE_NAMES = { turn: '回合完成', todo: 'Claude 完成待辦步驟', file: '改檔', bg: '背景任務完成', commit: 'git commit', checkin: '當天第一次上班' };

export const CATALOG = {
  levels: [
    // 門檻照實際步調訂（2026-10 約每天 110 塊）：回算 30 天落在第 2 級，第 5 級要大半年
    { name: '車庫新創', at: 0 }, { name: '小工作室', at: 1000 }, { name: '正式辦公室', at: 4000 },
    { name: '整層樓', at: 12000 }, { name: '總部大樓', at: 30000 },
  ],
  equip: {
    monitor: { name: '螢幕', levels: ['老 CRT', '單螢幕', '雙螢幕', '曲面寬螢幕'], cost: [0, 80, 240, 600] },
    chair: { name: '椅子', levels: ['圓板凳', '辦公椅', '人體工學椅', '電競椅'], cost: [0, 60, 180, 480] },
    desk: { name: '桌子', levels: ['折疊桌', '木桌', '升降桌', '主管桌'], cost: [0, 100, 300, 720] },
  },
  trinkets: { plant: { name: '盆栽', cost: 30 }, lamp: { name: '檯燈', cost: 40 }, figurine: { name: '公仔', cost: 60 } },
  floors: { plate: { name: '積木底板', cost: 0 }, carpet: { name: '地毯', cost: 80 }, wood: { name: '木地板', cost: 120 }, grass: { name: '草皮', cost: 160 } },
  // 公共設施：花公司積木
  facilities: {
    coffee: { name: '咖啡吧', levels: ['手沖', '義式咖啡機', '吧台加咖啡師'], cost: [0, 150, 500] },
    lounge: { name: '休息區', levels: ['一張沙發', '加懶骨頭', '加按摩椅'], cost: [0, 200, 600] },
    hotdesk: { name: '共用工作桌', levels: ['4 張', '8 張', '12 張'], cost: [0, 150, 400] },
    wall: { name: '牆面', levels: ['白板', '即時統計電視', '整面看板'], cost: [0, 250, 700] },
    pet: { name: '辦公室貓', levels: ['還沒有', '一隻貓', '三隻貓'], cost: [0, 300, 800] },
    game: { name: '遊戲角', levels: ['還沒有', '電視遊樂器', '加桌球與大型電玩'], cost: [0, 250, 600] },
    // 整層樓才解鎖（unlock＝公司等級）：多出來的窗邊那一條
    gym: { name: '健身角', levels: ['還沒有', '兩台跑步機', '加飛輪和重訓架'], cost: [0, 600, 1500], unlock: 3 },
    aquarium: { name: '水族箱', levels: ['還沒有', '小魚缸', '整面水族牆'], cost: [0, 500, 1200], unlock: 3 },
    band: { name: '樂團角', levels: ['還沒有', '吉他和音箱', '加爵士鼓和鍵盤'], cost: [0, 600, 1400], unlock: 3 },
  },
  // 成就獎盃：達成就自動擺上獎盃架
  trophies: [
    { id: 'first_bg', name: '第一位同事', desc: '第一次有背景任務做完回報', shape: 'cup' },
    { id: 'streak7', name: '全勤一週', desc: '連續 7 天上班', shape: 'star' },
    { id: 'streak30', name: '全勤一個月', desc: '連續 30 天上班', shape: 'bigcup' },
    { id: 'day50', name: '高產的一天', desc: '單日完成 50 個回合', shape: 'plaque' },
    { id: 'commit100', name: '百次提交', desc: '一個專案累積 100 次 commit', shape: 'cup' },
    { id: 'five', name: '全員上工', desc: '同時有 5 個人在工作', shape: 'star' },
    { id: 'office', name: '正式辦公室', desc: '公司升到第 3 級', shape: 'plaque' },
    { id: 'hq', name: '總部落成', desc: '公司升到第 5 級', shape: 'bigcup' },
    { id: 'bricks10k', name: '萬塊積木', desc: '累計賺到 10,000 塊', shape: 'star' },
  ],
};
// 第 3 版：多了每日用量（token）與每日任務的統計，升版時重新回算一次
const VERSION = 3;

// 每日任務：每天從這裡依日期固定抽三個，做完就給公司積木
export const QUESTS = [
  { id: 'turn10', name: '完成 10 個回合', kind: 'turn', n: 10, reward: 20 },
  { id: 'turn25', name: '完成 25 個回合', kind: 'turn', n: 25, reward: 40 },
  { id: 'commit2', name: 'git commit 2 次', kind: 'commit', n: 2, reward: 25 },
  { id: 'commit5', name: 'git commit 5 次', kind: 'commit', n: 5, reward: 50 },
  { id: 'file5', name: '改 5 個檔案', kind: 'file', n: 5, reward: 20 },
  { id: 'file15', name: '改 15 個檔案', kind: 'file', n: 15, reward: 40 },
  { id: 'bg2', name: '背景任務做完 2 次', kind: 'bg', n: 2, reward: 30 },
  // 原本是「Claude 完成 3 個待辦步驟」：Claude Code 2.1 起沒有待辦清單工具，永遠做不到（2026-10-21 換掉，位置不變，其他天抽到的任務不受影響）
  { id: 'turn50', name: '完成 50 個回合', kind: 'turn', n: 50, reward: 60 },
  { id: 'proj2', name: '在 2 個專案工作', kind: 'project', n: 2, reward: 25 },
  { id: 'proj3', name: '在 3 個專案工作', kind: 'project', n: 3, reward: 40 },
  { id: 'codex1', name: '外包給 Codex 1 次', kind: 'codex', n: 1, reward: 30 },
];
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// 某天的三個任務：不同種類，依日期固定
export function questsOf(day) {
  const out = [], kinds = new Set();
  for (let i = 0; out.length < 3 && i < 40; i++) {
    const q = QUESTS[hashStr(day + ':' + i) % QUESTS.length];
    if (kinds.has(q.kind)) continue;
    kinds.add(q.kind); out.push(q);
  }
  return out;
}

// ── 狀態 ─────────────────────────────────────────────────────────────────────

let state = null;
let dirty = false;
let notify = () => {};

function fresh() {
  return {
    version: VERSION, createdAt: Date.now(), retroDone: false,
    facilities: { coffee: 0, lounge: 0, hotdesk: 0, wall: 0, pet: 0, game: 0, gym: 0, aquarium: 0, band: 0 },
    trophies: {},       // id -> 拿到的時間
    stats: { dayTurns: {}, bgDone: 0, dayBricks: {}, dayKinds: {}, dayProjects: {} },
    usage: {},          // 日期 -> cwd -> { in, cr, cw, out }（token：輸入、讀快取、寫快取、輸出）
    quests: {},         // 日期 -> [完成的任務 id]
    spent: { company: 0, depts: {} },   // 累計花費（帳本只留最近 600 筆，升版重算時靠這個扣，不靠帳本）
    total: 0,
    company: { earned: 0, balance: 0 },
    depts: {},          // cwd -> { earned, balance, equip }
    files: {},          // 紀錄檔路徑 -> { offset, skip }
    sess: {},           // sid -> 解析中途的狀態與這段對話賺了多少
    daily: { lastDay: '', streak: 0 },
    hourly: {},         // `${cwd}|${YYYY-MM-DDTHH}` -> 已發幾塊
    ledger: [],         // 最近的入帳與支出
  };
}

function defaultEquip() {
  return { monitor: 0, chair: 0, desk: 0, trinkets: {}, owned: { plate: true }, floor: 'plate' };
}
function dept(cwd) {
  if (!state.depts[cwd]) state.depts[cwd] = { earned: 0, balance: 0, equip: defaultEquip() };
  return state.depts[cwd];
}

let carry = null;   // 版本升級時要保留的東西（買過的設備、花掉的積木），等重新回算完再套回去
async function load() {
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch { state = fresh(); }
  if (state.version !== VERSION) {
    // 舊版沒記成就要的統計：重新回算一次，買過的東西照留
    const old = state;
    // 花費：有累計就用累計；舊帳本沒有（第 2 版以前）就從帳本裡的購買紀錄加總
    const buys = (old.ledger || []).filter(l => l.kind === 'buy');
    const spent = old.spent || { company: -buys.filter(l => l.scope === 'company').reduce((n, l) => n + l.amount, 0),
      depts: buys.filter(l => l.scope !== 'company').reduce((m, l) => (m[l.cwd] = (m[l.cwd] || 0) - l.amount, m), {}) };
    carry = { spent, depts: old.depts || {}, outfits: Object.fromEntries(Object.entries(old.depts || {}).filter(([, d]) => d.outfit).map(([c, d]) => [c, d.outfit])), buys: (old.ledger || []).filter(l => l.kind === 'buy'), facilities: old.facilities, company: old.company, trophies: old.trophies || {} };
    state = fresh();
    console.log(`[economy] 帳本從第 ${old.version} 版升到第 ${VERSION} 版，重新回算`);
  }
}
function applyCarry() {
  if (!carry) return;
  for (const [cwd, d] of Object.entries(carry.depts)) dept(cwd).equip = d.equip || defaultEquip();
  for (const [cwd, o] of Object.entries(carry.outfits || {})) dept(cwd).outfit = o;
  if (carry.facilities) state.facilities = { ...state.facilities, ...carry.facilities };
  state.spent = carry.spent;
  state.company.balance -= carry.spent.company;
  for (const [cwd, n] of Object.entries(carry.spent.depts)) dept(cwd).balance -= n;
  for (const b of carry.buys) state.ledger.push(b);   // 購買紀錄放回帳本給人看
  Object.assign(state.trophies, carry.trophies);
  carry = null; dirty = true;
}
async function save() {
  if (!dirty) return;
  dirty = false;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, STATE_FILE);
}

export function levelOf(total) {
  let lv = 0;
  CATALOG.levels.forEach((l, i) => { if (total >= l.at) lv = i; });
  return lv;
}

// ── 從紀錄裡認出「成果」 ─────────────────────────────────────────────────────

const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hourKey = (ms) => { const d = new Date(ms); return `${localDay(ms)}T${String(d.getHours()).padStart(2, '0')}`; };
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b.type === 'text' ? b.text : '')).join('\n') : '';

function realPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  return !!t && !t.startsWith('<');
}

// 一行紀錄 → 0 個以上的入帳事件。s 是這段對話跨批次保留的狀態
function eventsOf(s, e) {
  const out = [];
  const at = e.timestamp ? Date.parse(e.timestamp) : null;
  if (!at) return out;
  if (e.cwd && !s.cwd) s.cwd = e.cwd;
  if (e.isSidechain) return out;

  if (e.type === 'queue-operation' && typeof e.content === 'string' && e.content.includes('<task-notification>')) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(e.content)?.[1];
    if (id && /<status>completed<\/status>/.test(e.content) && !s.bg.includes(id)) { s.bg.push(id); out.push({ at, kind: 'bg' }); }
    return out;
  }
  if (realPrompt(e)) { s.promptAt = at; return out; }

  if (e.type === 'assistant' && !e.isApiErrorMessage) {
    // 用量：同一則回覆會拆成好幾行（每個內容區塊一行），用訊息編號去重
    const u = e.message?.usage, mid = e.message?.id;
    if (u && mid && !(s.mids ||= []).includes(mid)) {
      s.mids.push(mid); if (s.mids.length > 60) s.mids.shift();
      out.push({ at, kind: 'usage', usage: { in: u.input_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0, out: u.output_tokens || 0 } });
    }
    for (const b of e.message?.content || []) {
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {};
      if (b.name === 'Bash' && /(^|[\s;&|(`$])codex\s+(exec|e)\b/.test(inp.command || '')) out.push({ at, kind: 'codex' });
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && (inp.file_path || inp.notebook_path)) s.pending[b.id] = { kind: 'file', path: inp.file_path || inp.notebook_path };
      else if (b.name === 'Bash' && /\bgit\s+(-C\s+\S+\s+)?commit\b/.test(inp.command || '') && !/--dry-run/.test(inp.command)) s.pending[b.id] = { kind: 'commit', quiet: /\bcommit\b[^\n;&|]*\s(-q|--quiet|-[a-zA-Z]*q[a-zA-Z]*)\b/.test(inp.command) };
      else if (b.name === 'TodoWrite' && Array.isArray(inp.todos)) {
        for (const t of inp.todos) {
          const k = (t.content || '').slice(0, 80);
          if (t.status === 'completed' && k && !s.todos.includes(k)) { s.todos.push(k); out.push({ at, kind: 'todo' }); }
        }
      } else if (b.name === 'TaskUpdate' && inp.status === 'completed' && inp.taskId && !s.todos.includes('task:' + inp.taskId)) {
        s.todos.push('task:' + inp.taskId); out.push({ at, kind: 'todo' });
      }
    }
    if (e.message?.stop_reason === 'end_turn' && s.promptAt) {
      if (at - s.promptAt >= MIN_TURN_MS) out.push({ at, kind: 'turn' });
      s.promptAt = null;
    }
    return out;
  }

  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    for (const b of e.message.content) {
      if (b.type !== 'tool_result') continue;
      const p = s.pending[b.tool_use_id];
      if (!p) continue;
      delete s.pending[b.tool_use_id];
      if (b.is_error) continue;
      if (p.kind === 'file' && !s.files.includes(p.path)) { s.files.push(p.path); out.push({ at, kind: 'file' }); }
      // 成功時 git 會印「[main abc1234] 訊息」；加了 -q 就什麼都不印，只能看有沒有失敗字樣
      if (p.kind === 'commit') {
        const t = textOf(b.content);
        if (/\[[^\]\n]+ [0-9a-f]{7,40}\]/.test(t) || (p.quiet && !/nothing (added )?to commit|no changes added|fatal:|error:/i.test(t))) out.push({ at, kind: 'commit' });
      }
    }
  }
  return out;
}

// 入帳：每天第一筆加簽到、連續天數加成、每小時上限，一半部門一半公司
function credit(ev) {
  const cwd = ev.cwd;
  const day = localDay(ev.at);
  if (ev.kind === 'usage') {
    const u = ((state.usage[day] ||= {})[cwd] ||= { in: 0, cr: 0, cw: 0, out: 0 });
    for (const k of ['in', 'cr', 'cw', 'out']) u[k] += ev.usage[k];
    dirty = true;
    return;
  }
  // 每日任務用的統計：各種成果的次數、在哪些專案做過事
  const st = state.stats;
  ((st.dayKinds ||= {})[day] ||= {})[ev.kind] = ((st.dayKinds[day][ev.kind]) || 0) + 1;
  const projs = ((st.dayProjects ||= {})[day] ||= []);
  if (cwd && cwd !== '?' && ev.kind !== 'codex' && !projs.includes(cwd)) projs.push(cwd);
  checkQuests(day, ev.at);
  if (!RULES[ev.kind]) { dirty = true; return; }   // Codex 呼叫只記統計
  const d = state.daily;
  if (day > d.lastDay) {
    const prev = new Date(ev.at); prev.setDate(prev.getDate() - 1);
    d.streak = d.lastDay === localDay(prev.getTime()) ? d.streak + 1 : 1;
    d.lastDay = day;
    put(cwd, ev.sid, ev.at, 'checkin', RULES.checkin);
  }
  const mult = Math.min(1.5, 1 + 0.1 * (d.streak - 1));
  const hk = `${cwd}|${hourKey(ev.at)}`;
  const used = state.hourly[hk] || 0;
  const amount = Math.min(RULES[ev.kind] * mult, HOURLY_CAP - used);
  if (amount <= 0) return;
  state.hourly[hk] = used + amount;
  put(cwd, ev.sid, ev.at, ev.kind, amount);
}
// 任務做完：給公司積木（也算進累計），一天一次；只發今天的（回算過去不補發）
function questProgress(day, q) {
  const st = state.stats;
  return q.kind === 'project' ? (st.dayProjects?.[day]?.length || 0) : (st.dayKinds?.[day]?.[q.kind] || 0);
}
function checkQuests(day, at) {
  if (day !== localDay(Date.now())) return;
  const done = (state.quests[day] ||= []);
  for (const q of questsOf(day)) {
    if (done.includes(q.id) || questProgress(day, q) < q.n) continue;
    done.push(q.id);
    state.total += q.reward; state.company.earned += q.reward; state.company.balance += q.reward;
    state.ledger.push({ at, cwd: '', scope: 'company', kind: 'quest', label: `任務完成：${q.name}`, amount: q.reward });
    if (state.retroDone) awardQueue.push({ type: 'quest', name: q.name, reward: q.reward });
    dirty = true;
  }
}
let awardQueue = [];
function award(id, at) {
  if (state.trophies[id]) return;
  state.trophies[id] = at || Date.now();
  const t = CATALOG.trophies.find(x => x.id === id);
  if (state.retroDone) awardQueue.push({ type: 'trophy', id, name: t?.name || id });
  dirty = true;
}
function checkTrophies(at, cwd) {
  const st = state.stats, day = localDay(at);
  if (st.bgDone >= 1) award('first_bg', at);
  if (state.daily.streak >= 7) award('streak7', at);
  if (state.daily.streak >= 30) award('streak30', at);
  if ((st.dayTurns[day] || 0) >= 50) award('day50', at);
  if (cwd && (state.depts[cwd]?.commits || 0) >= 100) award('commit100', at);
  const lv = levelOf(state.total);
  if (lv >= 2) award('office', at);
  if (lv >= 4) award('hq', at);
  if (state.total >= 10000) award('bricks10k', at);
}
// 同時在工作的人數（space.js 在狀態變動時回報）
export function noteConcurrent(n) {
  if (state && n >= 5 && !state.trophies.five) { award('five'); flushAwards(); save(); }
}
function flushAwards() {
  const q = awardQueue; awardQueue = [];
  for (const m of q) notify(m);
  if (q.length) notify({ type: 'economy' });
}

function put(cwd, sid, at, kind, amount) {
  amount = Math.round(amount * 10) / 10;
  const st = state.stats, day = localDay(at);
  st.dayBricks[day] = (st.dayBricks[day] || 0) + amount;
  if (kind === 'turn') st.dayTurns[day] = (st.dayTurns[day] || 0) + 1;
  if (kind === 'bg') st.bgDone++;
  if (kind === 'commit') dept(cwd).commits = (dept(cwd).commits || 0) + 1;
  state.total += amount;
  state.company.earned += amount / 2; state.company.balance += amount / 2;
  const dp = dept(cwd);
  dp.earned += amount / 2; dp.balance += amount / 2;
  const s = state.sess[sid];
  if (s) { s.earned = (s.earned || 0) + amount; s.recent = [...(s.recent || []), { at, kind, amount }].slice(-30); }
  state.ledger.push({ at, cwd, sid, kind, amount });
  if (state.ledger.length > 600) state.ledger.splice(0, state.ledger.length - 600);
  dirty = true;
  checkTrophies(at, cwd);
}

// ── 掃描 ─────────────────────────────────────────────────────────────────────

const skipDir = (name) => name.startsWith('-private-') || name.startsWith('-tmp') || name.includes('-var-folders-');
// 先用字串篩一輪，只 JSON.parse 可能有用的行（紀錄裡大半是附件與系統提示）
const INTERESTING = /"end_turn"|"tool_use"|"tool_result"|<task-notification>|"type":"user"|"usage"/;
const yieldNow = () => new Promise(r => setImmediate(r));

async function scanFile(path, sid, size, since) {
  const rec = state.files[path] || (state.files[path] = { offset: 0 });
  if (rec.skip || rec.offset >= size) return [];
  const fh = await open(path, 'r');
  const events = [];
  try {
    // 舊版認證檢查留下的「ok」對話：看開頭就略過，不整份讀
    if (rec.offset === 0) {
      const head = Buffer.alloc(Math.min(size, 24 * 1024));
      await fh.read(head, 0, head.length, 0);
      const m = /"type":"user","message":\{"role":"user","content":"([^"]*)"/.exec(head.toString('utf8'));
      if (m && /^ok$/i.test(m[1].trim())) { rec.skip = true; rec.offset = size; dirty = true; return []; }
    }
    const s = state.sess[sid] || (state.sess[sid] = { cwd: '', promptAt: null, pending: {}, files: [], todos: [], bg: [], earned: 0 });
    const pk = Object.keys(s.pending); if (pk.length > 200) for (const k of pk.slice(0, pk.length - 200)) delete s.pending[k];
    const CHUNK = 4 * 1024 * 1024;
    let pos = rec.offset, carry = '';
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const text = carry + buf.subarray(0, bytesRead).toString('utf8');
      const cut = text.lastIndexOf('\n');
      if (cut < 0) { carry = text; continue; }
      carry = text.slice(cut + 1);
      for (const line of text.slice(0, cut).split('\n')) {
        if (!INTERESTING.test(line) && !(line.includes('"cwd"') && !s.cwd)) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        for (const ev of eventsOf(s, e)) if (ev.at >= since) events.push({ ...ev, sid, cwd: s.cwd || '?' });
      }
      await yieldNow();
    }
    // 最後沒有換行的半行留到下次
    rec.offset = pos - Buffer.byteLength(carry);
    dirty = true;
  } finally { await fh.close(); }
  return events;
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const now = Date.now();
    const retro = !state.retroDone;
    const since = retro ? now - RETRO_DAYS * 86400_000 : 0;
    const events = [];
    for (const dir of await readdir(PROJECTS_DIR).catch(() => [])) {
      if (skipDir(dir)) continue;
      const d = join(PROJECTS_DIR, dir);
      for (const name of await readdir(d).catch(() => [])) {
        if (!name.endsWith('.jsonl')) continue;
        const p = join(d, name);
        const st = await stat(p).catch(() => null);
        if (!st) continue;
        if (retro && st.mtimeMs < since) { state.files[p] = { offset: st.size }; continue; }   // 太舊的不回算，之後也不再看
        if (st.size <= (state.files[p]?.offset || 0)) continue;
        try { events.push(...await scanFile(p, name.slice(0, -6), st.size, since)); }
        catch (e) { console.error('[economy] 讀不了', p, e.message); }
      }
    }
    events.sort((a, b) => a.at - b.at);
    const before = state.total;
    for (const ev of events) credit(ev);
    if (retro) { state.retroDone = true; applyCarry(); dirty = true; console.log(`[economy] 回算 ${RETRO_DAYS} 天：${events.length} 筆，共 ${state.total.toFixed(1)} 塊`); }
    // 統計只留最近 14 天
    const keep = localDay(now - 14 * 86400_000);
    for (const m of [state.stats.dayTurns, state.stats.dayBricks, state.stats.dayKinds || {}, state.stats.dayProjects || {}, state.usage, state.quests]) for (const k of Object.keys(m)) if (k < keep) delete m[k];
    // 舊的每小時計數用不到了
    const cutoff = hourKey(now - 2 * 86400_000);
    for (const k of Object.keys(state.hourly)) if (k.split('|')[1] < cutoff) delete state.hourly[k];
    await save();
    if (awardQueue.length) flushAwards();
    else if (state.total !== before) notify({ type: 'economy' });
  } catch (e) {
    console.error('[economy] 掃描失敗', e);
  } finally { scanning = false; }
}

// ── 對外 ─────────────────────────────────────────────────────────────────────

function view() {
  const lv = levelOf(state.total);
  const next = CATALOG.levels[lv + 1];
  return {
    ready: state.retroDone,
    total: state.total, level: lv, levelName: CATALOG.levels[lv].name,
    next: next ? { name: next.name, at: next.at } : null,
    company: state.company, streak: state.daily.streak,
    facilities: state.facilities, trophies: state.trophies,
    days: Object.entries(state.stats.dayBricks).sort().slice(-7),   // 最近 7 天每天賺多少
    today: state.stats.dayBricks[localDay(Date.now())] || 0,
    quests: (() => { const day = localDay(Date.now()); return questsOf(day).map(q => ({ ...q, have: Math.min(q.n, questProgress(day, q)), done: (state.quests[day] || []).includes(q.id) })); })(),
    usage: Object.entries(state.usage).sort().slice(-14),   // [[日期, { cwd: { in, cr, cw, out } }], …]
    depts: Object.fromEntries(Object.entries(state.depts).map(([cwd, d]) => [cwd, { earned: d.earned, balance: d.balance, equip: d.equip, outfit: d.outfit || null }])),
    ledger: state.ledger.slice(-40).reverse(),
    catalog: CATALOG, rules: RULES, ruleNames: RULE_NAMES,
  };
}

export function sessionBricks(sid) {
  const s = state?.sess[sid];
  return s ? { total: Math.round((s.earned || 0) * 10) / 10, recent: (s.recent || []).slice().reverse() } : { total: 0, recent: [] };
}

// 購買：部門設備一級一級升、小物與地板買一次就能隨時換
function buy(cwd, what, key) {
  const d = dept(cwd);
  const eq = d.equip;
  let cost, label;
  if (what === 'equip') {
    const item = CATALOG.equip[key];
    if (!item) throw new Error('沒有這項設備');
    const lv = eq[key] + 1;
    if (lv >= item.levels.length) throw new Error('已經是最高級');
    cost = item.cost[lv]; label = `${item.name}升級：${item.levels[lv]}`;
    if (d.balance < cost) throw new Error('部門積木不夠');
    eq[key] = lv;
  } else if (what === 'trinket') {
    const item = CATALOG.trinkets[key];
    if (!item) throw new Error('沒有這個小物');
    if (eq.owned[key]) { eq.trinkets[key] = !eq.trinkets[key]; dirty = true; return; }   // 買過了：擺上／收起
    cost = item.cost; label = `買了${item.name}`;
    if (d.balance < cost) throw new Error('部門積木不夠');
    eq.owned[key] = true; eq.trinkets[key] = true;
  } else if (what === 'floor') {
    const item = CATALOG.floors[key];
    if (!item) throw new Error('沒有這種地板');
    if (eq.owned[key]) { eq.floor = key; dirty = true; return; }
    cost = item.cost; label = `換成${item.name}`;
    if (d.balance < cost) throw new Error('部門積木不夠');
    eq.owned[key] = true; eq.floor = key;
  } else throw new Error('不知道要買什麼');
  d.balance -= cost;
  (state.spent ||= { company: 0, depts: {} }).depts[cwd] = (state.spent.depts[cwd] || 0) + cost;
  state.ledger.push({ at: Date.now(), cwd, kind: 'buy', label, amount: -cost });
  dirty = true;
}
function buyFacility(key) {
  const item = CATALOG.facilities[key];
  if (!item) throw new Error('沒有這項設施');
  const lv = (state.facilities[key] || 0) + 1;
  if (lv >= item.levels.length) throw new Error('已經是最高級');
  if (levelOf(state.total) < (item.unlock || 0)) throw new Error('公司等級還不夠');
  const cost = item.cost[lv];
  if (state.company.balance < cost) throw new Error('公司積木不夠');
  state.facilities[key] = lv;
  state.company.balance -= cost;
  (state.spent ||= { company: 0, depts: {} }).company += cost;
  state.ledger.push({ at: Date.now(), cwd: '', scope: 'company', kind: 'buy', label: `${item.name}升級：${item.levels[lv]}`, amount: -cost });
  dirty = true;
}

export async function initEconomy({ onChange } = {}) {
  if (onChange) notify = onChange;
  await load();
  setTimeout(scan, 3000);               // 開機先讓伺服器起來，再慢慢回算
  setInterval(scan, SCAN_EVERY_MS);
}
// 關機時用：process.exit 前來不及等非同步寫檔
export function flushEconomy() {
  if (!dirty || !state) return;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state));
  renameSync(STATE_FILE + '.tmp', STATE_FILE);
  dirty = false;
}

export function economyRouter() {
  const r = Router();
  r.get('/', (req, res) => res.json(view()));
  // 部門制服（免費）：outfit 給 null 就回到預設（依專案自動分配）
  r.post('/outfit', async (req, res) => {
    const { cwd, outfit } = req.body || {};
    if (!cwd || typeof cwd !== 'string') return res.status(400).json({ error: tr(req, '要指定部門') });
    if (outfit != null && !/^[a-z]{2,20}$/.test(outfit)) return res.status(400).json({ error: tr(req, '沒有這種制服') });
    dept(cwd).outfit = outfit || null;
    dirty = true;
    await save();
    notify({ type: 'economy' });
    res.json(view());
  });

  r.post('/buy', async (req, res) => {
    const { cwd, what, key } = req.body || {};
    try {
      if (what === 'facility') buyFacility(key);
      else if (!cwd || typeof cwd !== 'string') throw new Error('要指定部門');
      else buy(cwd, what, key);
    } catch (e) { return res.status(400).json({ error: errText(req, e) }); }
    await save();
    notify({ type: 'economy' });
    res.json(view());
  });
  return r;
}

// 測試用：在乾淨的帳本上跑解析與入帳，不碰檔案
export const _test = {
  eventsOf,
  credit,
  newSess: () => ({ cwd: '', promptAt: null, pending: {}, files: [], todos: [], bg: [], earned: 0 }),
  reset() { state = fresh(); state.retroDone = true; awardQueue = []; },
  buyFacility,
  get state() { return state; },
};
