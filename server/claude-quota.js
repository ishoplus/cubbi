// ── Claude 額度：5 小時與每週 ─────────────────────────────────────────────────
// 兩個來源都是 Claude Code 自己給的，不碰登入金鑰：
//   終端機：狀態列的輸入 JSON 有 rate_limits（used_percentage 0～100、resets_at 秒），Cubbi 的狀態列腳本順手帶過來
//   宿主用串流跑（例如 claude-web）：每回合的 rate_limit_event，unifiedWindows 裡 utilization 是 0～1
// 存成跟 Codex 額度一樣的形狀 { at, primary: { used_percent, resets_at }, secondary }，前端共用畫法。
// 只有訂閱方案（Pro／Max）才有；用 API key 的人兩邊都不會送，額度格子就不出現。
import { readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const win = (used, resets) => (Number.isFinite(used) ? { used_percent: Math.max(0, Math.min(100, used)), resets_at: Number.isFinite(resets) ? resets : null } : null);

// 狀態列輸入的 rate_limits
export function fromStatusline(rl) {
  if (!rl) return null;
  const primary = win(Number(rl.five_hour?.used_percentage), Number(rl.five_hour?.resets_at));
  const secondary = win(Number(rl.seven_day?.used_percentage), Number(rl.seven_day?.resets_at));
  return primary || secondary ? { primary, secondary } : null;
}

// 串流的 rate_limit_event
export function fromEvent(ev) {
  const w = ev?.type === 'rate_limit_event' && ev.rate_limit_info?.unifiedWindows;
  if (!w) return null;
  const pct = (x) => (x && Number.isFinite(x.utilization) ? win(x.utilization * 100, x.resetsAt) : null);
  const primary = pct(w.five_hour), secondary = pct(w.seven_day);
  return primary || secondary ? { primary, secondary } : null;
}

// 已經過了重置時間的窗口：用量歸零（最後一次數字是重置前的）
export function current(q, now = Date.now()) {
  if (!q) return null;
  const fix = (x) => (x && x.resets_at && x.resets_at * 1000 <= now ? { used_percent: 0, resets_at: null } : x);
  return { ...q, primary: fix(q.primary), secondary: fix(q.secondary) };
}

export function createClaudeQuota({ file, onChange = () => {} } = {}) {
  let quota = null;
  try { if (file) quota = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const keyOf = (q) => JSON.stringify([q?.primary && Math.round(q.primary.used_percent), q?.primary?.resets_at, q?.secondary && Math.round(q.secondary.used_percent), q?.secondary?.resets_at]);
  let lastKey = keyOf(quota);

  function update(q) {
    if (!q) return;
    // 只送了一個窗口時，另一個沿用上次的
    quota = { at: Date.now(), primary: q.primary || quota?.primary || null, secondary: q.secondary || quota?.secondary || null };
    const key = keyOf(quota);
    if (key === lastKey) return;
    lastKey = key;
    if (file) mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, JSON.stringify(quota))).catch(() => {});
    onChange({ type: 'claude-quota' });
  }

  return {
    read: () => current(quota),
    fromStatusline: (rl) => update(fromStatusline(rl)),
    trackEvent: (ev) => update(fromEvent(ev)),
    extend(r) { r.get('/claude-quota', (req, res) => res.json(current(quota))); },
  };
}
