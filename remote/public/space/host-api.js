// ── remote 版前端的小工具：帶通行證打 API ─────────────────────────────────────
// 外掛要用就從這裡 import，不要 import host.js：host.js 開機時要等外掛載完（top-level await），
// 外掛反過來 import host.js 會互等，整頁卡住。
export const TOKEN = sessionStorage.getItem('cg_token') || localStorage.getItem('cg_token') || '';   // 別人的電腦只放 sessionStorage
if (!TOKEN) location.href = '/';

export const api = (p) => fetch(p, { headers: { 'x-access-token': TOKEN } }).then(r => {
  if (r.status === 401) { location.href = '/'; throw new Error('未授權'); }
  return r.json();
});
export const post = (p, body) => fetch(p, { method: 'POST', headers: { 'x-access-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
// 圖片、檔案、SSE 這類不能帶標頭的網址
export const authUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
