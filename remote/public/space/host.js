// ── 宿主：空間跟「誰在背後跑對話」之間的接口 ─────────────────────────────────
//
// 這是 remote 版（npx cubbi remote／claude-web）：要登入，對話分頁嵌主介面，能插話、開新對話、回答提問、看檔案。
// Cubbi 單獨跑時換一份 host.js：沒有的能力留空（undefined），畫面上對應的分頁和按鈕就會藏起來。
// 空間本身的 API（/api/space/*）不在這裡：哪個宿主都一樣。


import { api, post, authUrl, cfg } from './host-api.js';
import { t } from './plugins/lang.js';
export { api, post, authUrl };   // 給 Cubbi 的 main.js（它從 host.js 拿）；外掛請 import host-api.js
const errorOf = async (r, fallback) => (await r.json().catch(() => ({}))).error || fallback;

// 開著的外掛：前端那一半是 plugins/<名字>.js（外掛自己的 webDir 提供），export 跟名字同名的物件
const loaded = await Promise.all((cfg.plugins || []).map(n => import(`./plugins/${n}.js`)
  .then(m => m[n] || m.default).catch(e => { console.error('[外掛]', n, e); return null; })));

export const host = {
  // 外掛：經營系統（積木、裝修、任務、獎盃、用量）。辦公室長相由它決定，沒有就是一間固定的辦公室
  //       其他外掛（例如提案白板、發片行事曆）由設定檔的 pluginModules 帶進來；哪些開著由伺服器決定
  plugins: loaded.filter(Boolean),
  back: { href: '/', title: t('回對話介面') },
  // 收件箱裡辦公室就地處理不了的（分支交件看 diff、任務、意外結束）：到對話介面的收件箱分頁
  openInbox: () => { location.href = '/?inbox=1'; },
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
      if (r.ok) return { ok: true, msg: t('已插話，這一輪會接著處理') };
      if (r.status !== 409) return { ok: false, msg: await errorOf(r, t('送出失敗')) };
      // 409：這一輪剛好結束了，改走開新一輪
    }
    const r = await post('/api/claude', {
      prompt: text, sessionId: d.sid, cwd: d.cwd, model: d.model || '',
      permMode: d.permMode || localStorage.getItem('cg_chat_perm') || 'auto' });
    if (!r.ok) return { ok: false, msg: await errorOf(r, t('送出失敗')) };
    r.body?.cancel();   // 回覆的串流不在這裡看：狀態會從空間的即時推播更新；斷開不會中止這一輪
    return { ok: true, msg: t('已交代') };
  },

  // 在空間裡回答提問／權限請求（ask 是人物資料裡的 ask）。回 { ok, msg }
  async answer(ask, payload) {
    const r = await post(`/api/claude/${ask.runId}/respond`, { requestId: ask.requestId, ...payload });
    if (r.ok) return { ok: true };
    return { ok: false, msg: r.status === 409 ? t('這個提問已經回答過了') : await errorOf(r, t('回覆失敗')) };
  },

  // 檔案分頁與開新對話時選目錄
  files: {
    ls: (path) => api('/api/fs/ls?path=' + encodeURIComponent(path)),
    preview: (path) => api('/api/fs/preview?path=' + encodeURIComponent(path)),
    url: (path) => authUrl('/api/fs/file?path=' + encodeURIComponent(path)),
  },
};
