// 聊天與任務兩邊共用的設定與小工具。
//
// .env 在 paths.js 載入（要讀環境變數的模組都先 import 它）
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import './paths.js';

// 預設只開放啟動時所在的資料夾，不是整個家目錄；要放大範圍請在 .env 明確設 WORK_ROOT
export const WORK_ROOT = resolve(process.env.WORK_ROOT || process.cwd());
export const claudePath = process.env.CLAUDE_PATH || 'claude';

// 長效 OAuth token（`claude setup-token` 產生，約一年）存在 macOS Keychain，
// 每次 spawn 現讀：換 token 不用重啟服務。沒存就照舊用 CLI 自己的登入狀態。
// 存法：security add-generic-password -U -a "$USER" -s claude-code-oauth-token -w '<token>'
const TOKEN_KEYCHAIN_SERVICE = process.env.CLAUDE_TOKEN_KEYCHAIN_SERVICE || 'claude-code-oauth-token';
export function claudeEnv() {
  const env = { ...process.env };
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      const t = execFileSync('security', ['find-generic-password', '-s', TOKEN_KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      if (t) env.CLAUDE_CODE_OAUTH_TOKEN = t;
    } catch { /* 沒存或 Keychain 鎖住 */ }
  }
  return env;
}
export const RELOGIN_HINT = '請在本機執行 `claude setup-token`，把 token 存進 Keychain（service: claude-code-oauth-token）';

// 進程組整棵殺掉（claude 會 spawn 子進程，單純 proc.kill 殺不乾淨）
export function killTree(proc, signal = 'SIGTERM') {
  if (!proc || proc.killed) return;
  try { process.kill(-proc.pid, signal); } // 負號 = 殺整個 process group
  catch { try { proc.kill(signal); } catch { /* already gone */ } }
}

// 把常見的 claude 錯誤訊息轉成友善中文提示（無對應則回 null）
export function friendlyClaudeError(text) {
  const t = (text || '').toLowerCase();
  if (/not logged in|please run.*login|authenticat|invalid api key|unauthorized|\b401\b/.test(t))
    return 'Claude 未登入或憑證失效，' + RELOGIN_HINT;
  if (/rate limit|\b429\b|overloaded|usage limit|too many requests/.test(t))
    return '已達用量／速率上限，請稍後再試';
  if (/quota|credit|billing|insufficient/.test(t))
    return 'API 額度或帳務問題，請檢查 Claude 帳號';
  return null;
}

// 注意：不能用 startsWith(WORK_ROOT)，否則 /Users/alice-evil 會通過 /Users/alice 的檢查
export function isInsideRoot(resolved) {
  const sep = WORK_ROOT.endsWith('/') ? WORK_ROOT : WORK_ROOT + '/';
  return resolved === WORK_ROOT || resolved.startsWith(sep);
}

export function safePath(p) {
  const resolved = resolve(p || WORK_ROOT);
  if (!isInsideRoot(resolved)) throw new Error('路徑不在允許範圍內');
  return resolved;
}

// 同上的包含判斷，但基準是任意目錄（用來檢查「有沒有寫到任務目錄外面」）
export function isInsideDir(dir, target) {
  const d = resolve(dir), t = resolve(target);
  const sep = d.endsWith('/') ? d : d + '/';
  return t === d || t.startsWith(sep);
}
