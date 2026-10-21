// ── 宿主：空間跟「誰在背後跑對話」之間的接口 ─────────────────────────────────
//
// 這是 Cubbi 單獨跑（npx cubbi）的版本：只在本機、只讀，不需要登入，也不能從這裡操作對話。
// 嵌進別的工具時（例如 claude-web），由宿主換掉這個檔案，提供：
//   chat: { url(session), newUrl(cwd), onNewSession(cb) }  對話分頁與開新對話
//   reply(session, text) → { ok, msg }                     面板上方的快速回覆
//   answer(ask, payload) → { ok, msg }                     在場景裡回答提問／權限請求
//   files: { ls(path), preview(path), url(path) }          檔案分頁
//   back: { href, title }                                  左上角的返回鍵
//   plugins: [ … ]                                         外掛（介面見 main.js 的 pluginCtx）
//   look: { level, facilities, … }                         辦公室長相（沒有外掛時用）
//   projectOutfits: { 專案名: 制服 }、catNames: [ … ]       個人化：專案的預設制服、辦公室貓的名字
// 沒有的能力留空，畫面上對應的分頁和按鈕就會藏起來。

export const api = (p) => fetch(p).then(r => r.json());
export const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const authUrl = (u) => u;

export const host = {};
