// ── 送使用者／代理人產生的檔案：當成「不可信的內容」 ─────────────────────────────────
//
// 工作資料夾裡的 .html、.svg 是誰都能寫的（代理人、被埋指令的文件）。如果照網頁送出、又跟 Cubbi 同一個來源，
// 裡面的程式就讀得到瀏覽器裡的登入資料——等於整台電腦交出去。所以一律加沙箱：
//   CSP sandbox（不給 allow-scripts）：照樣顯示，但程式不能跑，而且是獨立的來源，碰不到 Cubbi 的 localStorage
//   nosniff：不讓瀏覽器自己猜成網頁
// PDF 例外：Chrome 的 PDF 檢視器在沙箱裡開不起來，它本身也讀不到網站的資料。
export function untrustedFile(res, path = '') {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/\.pdf$/i.test(path)) return;
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; font-src 'self' data:");
}
