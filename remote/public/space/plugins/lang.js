// 辦公室外掛的翻譯：中文是原文，英文查 en.js。
// 不能用辦公室的 i18n.js（它 import host.js，host.js 開機時在等外掛，會互等），所以外掛用這個小的。
// 語言：設定檔 space.lang（host-api 拿到的）→ 對話頁存的 cg_lang → 瀏覽器語言
import { cfg } from '../host-api.js';
import { EN_PLUGINS } from './en.js';

export const LANG = (cfg.lang || localStorage.getItem('cg_lang') || navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
export const LOCALE = LANG === 'zh' ? 'zh-TW' : 'en-US';
export function t(s, vars) {
  let r = LANG === 'en' ? (EN_PLUGINS[s] ?? s) : s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return r;
}
