// ── 伺服器與指令列的文字：中文寫在程式裡（維護時好讀），英文查 i18n-en.js ─────────────────
//
//   t(lang, '對話已結束')、t(lang, '同時在做的已經 {n} 個', { n })    英文缺了就顯示中文（測試會抓）
//   tr(req, '…')        API 回給前端的訊息：照這個請求的語言（x-lang 標頭 → Accept-Language → 伺服器語言）
//   errText(req, e)     丟出來的錯誤轉成這個請求的語言：用 TError 丟的帶 key＋vars，其他的拿訊息本身去查表
//   SERVER_LANG()       沒有請求的地方（推播、給代理人的指示、開機訊息）：設定檔 space.lang → CUBBI_LANG → 系統語言
//   CLI_LANG()          指令列（精靈、service）：CUBBI_LANG → 系統語言
import { execFileSync } from 'child_process';
import { EN } from './i18n-en.js';
import { config } from './config.js';

const norm = (s) => (String(s || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
// Mac：Node 的 Intl 不看系統偏好的語言（中文的 Mac 也回 en-US），終端機也常常沒設 LANG，
// 所以先問系統設定（AppleLanguages 的第一個），問一次就記住
let macLang;
const appleLang = () => {
  if (macLang !== undefined) return macLang;
  macLang = null;
  if (process.platform !== 'darwin') return macLang;
  try { macLang = /"?([A-Za-z-]+)"?/.exec(execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[1] || '')?.[1] || null; } catch {}
  return macLang;
};
const systemLang = () => {
  const env = process.env.CUBBI_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (env && !/^(c|posix)(\.|$)/i.test(env)) return norm(env);
  if (appleLang()) return norm(appleLang());
  try { return norm(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return 'en'; }
};
export const CLI_LANG = () => (process.env.CUBBI_LANG ? norm(process.env.CUBBI_LANG) : systemLang());
export const SERVER_LANG = () => (config.space?.lang ? norm(config.space.lang) : CLI_LANG());

export function langOf(req) {
  if (config.space?.lang) return norm(config.space.lang);   // 設定檔指定了就照設定
  const x = req?.headers?.['x-lang'];
  if (x) return norm(x);
  const al = String(req?.headers?.['accept-language'] || '').split(',')[0];
  return al ? norm(al) : SERVER_LANG();
}

export function t(lang, s, vars) {
  let r = lang === 'en' ? (EN[s] ?? s) : s;
  if (vars) {
    r = r.replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, (m, k, one, many) => (k in vars ? `${vars[k]} ${Number(vars[k]) === 1 ? one : many}` : m));   // 英文單複數：{n|commit|commits}
    r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  return r;
}
export const tr = (req, s, vars) => t(langOf(req), s, vars);

// 帶變數的錯誤：throw new TError('同時在做的已經 {n} 個', { n })；訊息本身是中文（log 好讀），回給前端時再換語言
export class TError extends Error {
  constructor(key, vars, extra) { super(t('zh', key, vars)); this.key = key; this.vars = vars; if (extra) Object.assign(this, extra); }
}
export const errText = (req, e) => (e?.key ? tr(req, e.key, e.vars) : tr(req, String(e?.message || e)));
