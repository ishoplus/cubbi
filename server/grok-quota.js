// ── Grok Bot 額度：每週 ─────────────────────────────────────────────────────
// Grok Bot 桌面版（Mac）自己會把每週用量存在本機快取，這裡只讀那一個檔，不碰登入資料：
//   ~/Library/Application Support/Grok Bot/sand-client-persistence/<base32 key>.blob
//   key 結尾是 .weekly-usage.cache，內容 { value: { reading: { usage: { percentUsed, nextResetMs, grokPlanLabel }, readAtMs } } }
// 存成跟 Codex／Claude 一樣的形狀 { at, plan, primary, secondary }；Grok 只有每週，primary 是 null。
// 沒裝 Grok Bot（或不是 Mac）就讀不到，額度格子不出現。數字是桌面版上次抓的，要開著它才會更新。
import { readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const GROK_DIR = join(homedir(), 'Library', 'Application Support', 'Grok Bot', 'sand-client-persistence');

const b32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = [];
  for (const c of s.toUpperCase()) {
    const i = A.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); }
  }
  return Buffer.from(out).toString('utf8');
};

// 快取檔內容 → 額度
export function parseUsage(json) {
  const r = json?.value?.reading, u = r?.usage;
  const p = Number(u?.percentUsed);
  if (!Number.isFinite(p)) return null;
  const reset = Number(u.nextResetMs);
  return {
    at: Number(r.readAtMs) || Date.now(),
    plan: u.grokPlanLabel || '',
    primary: null,
    secondary: { used_percent: Math.max(0, Math.min(100, p)), resets_at: Number.isFinite(reset) ? Math.floor(reset / 1000) : null },
  };
}

export function createGrokQuota({ dir = GROK_DIR, onChange = () => {}, every = 60_000 } = {}) {
  let quota = null, file = null, mtime = 0;
  function find() {
    try { return readdirSync(dir).filter(f => f.endsWith('.blob')).find(f => b32(f.slice(0, -5)).endsWith('.weekly-usage.cache')) || null; } catch { return null; }
  }
  // 只看修改時間，有變才讀
  function read() {
    file ||= find();
    if (!file) return null;
    let m = 0; try { m = statSync(join(dir, file)).mtimeMs; } catch { file = null; return quota; }
    if (m !== mtime) {
      mtime = m;
      let q = null; try { q = parseUsage(JSON.parse(readFileSync(join(dir, file), 'utf8'))); } catch {}
      const changed = JSON.stringify(q) !== JSON.stringify(quota);
      quota = q;
      if (changed) onChange({ type: 'grok-quota' });
    }
    return current(quota);
  }
  let timer = null;
  return {
    read,
    start() { read(); timer = setInterval(read, every); timer.unref?.(); },
    stop() { clearInterval(timer); },
    extend(r) { r.get('/grok-quota', (req, res) => res.json(read())); },
  };
}

// 過了重置時間：用量歸零（桌面版還沒抓新數字）
export function current(q, now = Date.now()) {
  if (!q?.secondary) return q;
  const s = q.secondary;
  return s.resets_at && s.resets_at * 1000 <= now ? { ...q, secondary: { used_percent: 0, resets_at: null } } : q;
}
