// ── 硬碟空間：辦公室倉庫的貨架堆多滿，就是這台電腦的硬碟用了多少 ─────────────────────
// 數字是 statfs 照實讀的（對話資料夾所在的那顆磁碟），不估、不掃資料夾；每 5 分鐘看一次，變了才通知前端。
// 剩下的空間低於 lowPct％：倉庫亮紅燈，推播一次（設了 ntfy 才推）；回到 lowPct＋3％ 以上才會再推下一次。
// 清理不在這裡做：remote 版另外掛「交給 CC 清理」（remote/disk.js），Cubbi 單獨跑只看不動。
import { statfs, readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { homedir } from 'os';

const EN = {
  '🗄 硬碟只剩 {free}（{pct}%）': '🗄 Only {free} of disk left ({pct}%)',
  '點開請 Claude Code 幫忙清理': 'Open it to have Claude Code help clean up',
  '點開看': 'Open to see',
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export const fmtBytes = (n) => (n >= 1024 ** 4 ? (n / 1024 ** 4).toFixed(1) + 'T' : n >= 1024 ** 3 ? Math.round(n / 1024 ** 3) + 'G' : Math.round(n / 1024 ** 2) + 'M');

const readStat = (path) => new Promise((resolve, reject) => statfs(path, (e, s) => (e ? reject(e) : resolve(s))));

// path：量哪顆磁碟（那顆上的任何路徑）；file：記住推過了沒（重開不重推）
// push：{ url: () => ntfy topic 網址, click: () => 點了打開哪 }；lang：() => 'zh'｜'en'
// canClean：前端要不要出「交給 CC 清理」（remote 版才有）
export function createDisk({ path = homedir(), file = null, lowPct = 10, push = null, lang = () => 'zh', canClean = false, onChange = () => {}, log = console } = {}) {
  let disk = null, timer = null;
  let db = { warned: false };
  try { if (file) db = { ...db, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  const t = (s, vars = {}) => fill(lang() === 'en' ? (EN[s] ?? s) : s, vars);
  const save = () => { if (file) mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, JSON.stringify(db))).catch(() => {}); };

  async function sendPush(d) {
    const url = push?.url?.();
    if (!url) return;
    const u = new URL(url), click = push.click?.();
    const body = { topic: u.pathname.replace(/^\//, ''), title: t('🗄 硬碟只剩 {free}（{pct}%）', { free: fmtBytes(d.free), pct: Math.round(100 - d.usedPct) }),
      message: t(canClean ? '點開請 Claude Code 幫忙清理' : '點開看'), tags: ['card_file_box'], priority: 4, click: click || undefined };
    const r = await fetch(u.origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  async function check() {
    let s;
    try { s = await readStat(path); } catch (e) { log.warn?.(`[硬碟] 讀不到：${e.message}`); return disk; }
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;   // bavail：一般使用者真的能用的（扣掉系統保留）
    const usedPct = total ? (1 - free / total) * 100 : 0;
    const low = 100 - usedPct < lowPct;
    const prev = disk;
    disk = { at: Date.now(), total, free, used: total - free, usedPct, low, lowPct, canClean };
    if (low && !db.warned) { db.warned = true; save(); sendPush(disk).catch(e => log.warn?.(`[硬碟] 推播失敗：${e.message}`)); }
    else if (!low && db.warned && 100 - usedPct >= lowPct + 3) { db.warned = false; save(); }
    if (!prev || Math.round(prev.usedPct) !== Math.round(usedPct) || prev.low !== low) onChange({ type: 'disk' });
    return disk;
  }

  return {
    read: () => disk,
    check,
    start() { check(); timer = setInterval(check, 5 * 60_000); timer.unref?.(); },
    stop() { clearInterval(timer); },
    // 前端打開抽屜時要最新的：超過 1 分鐘就重讀
    extend(r) { r.get('/disk', async (req, res) => res.json(disk && Date.now() - disk.at < 60_000 ? disk : await check())); },
  };
}
