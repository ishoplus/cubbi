// ── 對話頁的介面文字：中文寫在程式裡，英文查 EN ────────────────────────────────────
//
//   T('等你回答')、T('{n} 分鐘沒動靜', { n })   英文缺了就顯示中文（tests/i18n-remote.test.mjs 會抓）
//   translateDom()   HTML 裡寫死的文字與 title／placeholder：開頁時整頁換一次（只換整段剛好在表上的）
// 語言：localStorage cg_lang（設定檔 space.lang 會透過 /api/info 寫進來）→ 瀏覽器語言；zh 開頭用中文，其他用英文。
// 這是一般 script（不是 module），在主程式之前載入；給 window.LANG、window.T、window.translateDom。
(function () {
  const pick = (localStorage.getItem('cg_lang') || navigator.language || 'en').toLowerCase();
  const LANG = pick.startsWith('zh') ? 'zh' : 'en';
  const EN = {
  };
  function T(s, vars) {
    let r = LANG === 'en' ? (EN[s] ?? s) : s;
    if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return r;
  }
  function translateDom(root = document.body) {
    if (LANG === 'zh') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const k = n.nodeValue.trim();
      if (k && EN[k]) n.nodeValue = n.nodeValue.replace(k, EN[k]);
    }
    for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
      for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && EN[v]) el.setAttribute(a, EN[v]); }
    }
    document.documentElement.lang = 'en';
  }
  Object.assign(window, { LANG, T, translateDom, EN_REMOTE: EN });
})();
