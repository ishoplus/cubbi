// ── 宿主：空間跟「誰在背後跑對話」之間的接口 ─────────────────────────────────
//
// 這是 claude-web 版：帳號用 claude-web 的通行證，對話分頁嵌主介面，能插話、開新對話、回答提問、看檔案。
// Cubbi 單獨跑時換一份 host.js：沒有的能力留空（undefined），畫面上對應的分頁和按鈕就會藏起來。
// 空間本身的 API（/api/space/*）不在這裡：哪個宿主都一樣。

import { economy } from './plugins/economy.js';
import { ideas } from './plugins/ideas.js';
import { calendar } from './plugins/calendar.js';

const TOKEN = sessionStorage.getItem('cg_token') || localStorage.getItem('cg_token') || '';   // 別人的電腦只放 sessionStorage
if (!TOKEN) location.href = '/';

export const api = (p) => fetch(p, { headers: { 'x-access-token': TOKEN } }).then(r => {
  if (r.status === 401) { location.href = '/'; throw new Error('未授權'); }
  return r.json();
});
export const post = (p, body) => fetch(p, { method: 'POST', headers: { 'x-access-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
// 圖片、檔案、SSE 這類不能帶標頭的網址
export const authUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
const errorOf = async (r, fallback) => (await r.json().catch(() => ({}))).error || fallback;

// 個人化（外掛、語言、專案制服、貓的名字、天氣地名）都在伺服器的設定檔，這裡只拿來用（config.js）
const cfg = await api('/api/space/host').catch(() => ({}));
const ALL_PLUGINS = { economy, ideas, calendar };

export const host = {
  // 外掛：經營系統（積木、裝修、任務、獎盃、用量）。辦公室長相由它決定，沒有就是一間固定的辦公室
  //       提案白板（提案部的看板，ideas.js）、發片行事曆（營收部排定要發的文案與影片，calendar.js）
  //       哪些開著由伺服器的設定檔決定
  plugins: (cfg.plugins || []).map(k => ALL_PLUGINS[k]).filter(Boolean),
  back: { href: '/', title: '回對話介面' },
  projectOutfits: cfg.projectOutfits || {},
  catNames: cfg.catNames?.length ? cfg.catNames : undefined,
  lang: cfg.lang || undefined,
  weatherPlace: cfg.weatherPlace || undefined,

  // 對話分頁：嵌主介面，送訊息、授權、回答提問都是同一套
  chat: {
    url: (d) => `/?embed=1&session=${encodeURIComponent(d.sid)}&cwd=${encodeURIComponent(d.cwd || '')}`,
    newUrl: (cwd) => `/?embed=1&cwd=${encodeURIComponent(cwd)}`,
    // 新對話在嵌入的主介面裡拿到編號
    onNewSession(cb) {
      addEventListener('message', (e) => {
        if (e.origin !== location.origin || e.data?.type !== 'cw-session') return;
        cb(e.data.sessionId);
      });
    },
  },

  // 快速回覆：工作中插進這一輪；閒著或休息開新的一輪。回 { ok, msg }
  async reply(d, text) {
    if (d.live && d.status === 'working' && d.runId) {
      const r = await post(`/api/claude/${d.runId}/message`, { prompt: text });
      if (r.ok) return { ok: true, msg: '已插話，這一輪會接著處理' };
      if (r.status !== 409) return { ok: false, msg: await errorOf(r, '送出失敗') };
      // 409：這一輪剛好結束了，改走開新一輪
    }
    const r = await post('/api/claude', {
      prompt: text, sessionId: d.sid, cwd: d.cwd, model: d.model || '',
      permMode: d.permMode || localStorage.getItem('cg_chat_perm') || 'auto' });
    if (!r.ok) return { ok: false, msg: await errorOf(r, '送出失敗') };
    r.body?.cancel();   // 回覆的串流不在這裡看：狀態會從空間的即時推播更新；斷開不會中止這一輪
    return { ok: true, msg: '已交代' };
  },

  // 在空間裡回答提問／權限請求（ask 是人物資料裡的 ask）。回 { ok, msg }
  async answer(ask, payload) {
    const r = await post(`/api/claude/${ask.runId}/respond`, { requestId: ask.requestId, ...payload });
    if (r.ok) return { ok: true };
    return { ok: false, msg: r.status === 409 ? '這個提問已經回答過了' : await errorOf(r, '回覆失敗') };
  },

  // 檔案分頁與開新對話時選目錄
  files: {
    ls: (path) => api('/api/fs/ls?path=' + encodeURIComponent(path)),
    preview: (path) => api('/api/fs/preview?path=' + encodeURIComponent(path)),
    url: (path) => authUrl('/api/fs/file?path=' + encodeURIComponent(path)),
  },
};
