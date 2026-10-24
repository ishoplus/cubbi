// ── 用手機開：連得到這台的網址、QR code、一次性登入連結 ─────────────────────────────
//
// 網址從好到差：通道（Tailscale／ngrok／自己的網域，出門也連得到）→ 區網（HOST=0.0.0.0 時，同一個 Wi-Fi）→ 只有本機。
// QR 裡放「網址＋一次性登入票」，掃了就登入（10 分鐘內、用一次就失效）；票由已登入的裝置要（或本機指令帶萬用密碼要）。
//   GET  /api/connect          { urls: [{ kind, url, label }], best, host, tunnel }
//   POST /api/connect/ticket   { url?, public? } → { link, svg, ttlMin }
import { Router } from 'express';
import { networkInterfaces } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

// 這台的區網 IPv4（同一個 Wi-Fi 的手機連這個）。家裡、辦公室常見的私有網段排前面；
// 198.18.0.0/15 是代理工具（Surge、ClashX…）的虛擬網卡、169.254 是沒拿到位址，手機都連不到，不列
const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
export function lanAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || /^(169\.254\.|198\.1[89]\.)/.test(a.address)) continue;
      out.push(a.address);
    }
  }
  return out.sort((x, y) => isPrivate(y) - isPrivate(x));
}

// host：伺服器聽的位址；port；publicUrl：通道的網址（沒有就空）
export function connectUrls({ host = '127.0.0.1', port, publicUrl = '', tunnel = 'none' }) {
  const urls = [];
  if (publicUrl) urls.push({ kind: 'tunnel', url: publicUrl.replace(/\/$/, ''), label: tunnel === 'tailscale' ? 'Tailscale（出門也連得到，只有你的裝置）' : tunnel === 'ngrok' ? 'ngrok（出門也連得到）' : '你的網址（出門也連得到）' });
  const lanBound = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (lanBound) for (const ip of lanAddresses()) urls.push({ kind: 'lan', url: `http://${ip}:${port}`, label: '同一個 Wi-Fi' });
  urls.push({ kind: 'local', url: `http://127.0.0.1:${port}`, label: '只有這台電腦' });
  return { urls, best: urls[0], lanBound };
}

// QR → SVG（深色方塊、白底、四格留白），手機鏡頭好認
export function qrSvg(text, { size = 240 } = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 4, total = n + q * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#111"/></svg>`;
}

// issueTicket()：auth.js 給的（發一張一次性登入票）
export function connectRoutes(app, { requireAuth, issueTicket, info }) {
  const r = Router();
  r.get('/', (req, res) => res.json(connectUrls(info())));
  r.post('/ticket', (req, res) => {
    const { urls, best } = connectUrls(info());
    const base = urls.find(u => u.url === req.body?.url)?.url || best.url;
    const { ticket, ttlMin } = issueTicket();
    const link = `${base}/?ticket=${ticket}${req.body?.public ? '&public=1' : ''}`;
    res.json({ link, svg: qrSvg(link), ttlMin, kind: urls.find(u => u.url === base)?.kind });
  });
  app.use('/api/connect', requireAuth, r);
}
