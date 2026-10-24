// ── 起來之後：這台開瀏覽器（自動登入）、印手機用的 QR ─────────────────────────────────
// 登入連結是一次性的（10 分鐘、用一次就失效），用萬用密碼跟剛起來的伺服器要。
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { connectUrls } from '../connect.js';
import { t, CLI_LANG } from '../i18n.js';

const L = (s, v) => t(CLI_LANG(), s, v);

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function waitUp(port, token, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/info`, { headers: { 'x-access-token': token } }); if (r.ok) return await r.json(); } catch {}
    await sleep(400);
  }
  return null;
}
async function ticket(port, token) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/ticket`, { method: 'POST', headers: { 'x-access-token': token } });
  if (!r.ok) throw new Error(L('拿不到登入連結（{status}）', { status: r.status }));
  return await r.json();
}

export async function welcome({ port = process.env.PORT || 17000, token = process.env.ACCESS_TOKEN, open = true, out = console } = {}) {
  const info = await waitUp(port, token);
  if (!info) { out.log(L('✗ 伺服器沒起來，看紀錄：cubbi service logs')); return false; }
  const local = `http://127.0.0.1:${port}/?ticket=${(await ticket(port, token)).ticket}`;
  out.log('\n' + L('✓ Cubbi 起來了（{version}）', { version: info.version }));
  out.log(L('  這台電腦：{url}{opened}', { url: local.replace(/ticket=.*/, 'ticket=…'), opened: open ? L('（已經幫你打開瀏覽器）') : '' }));
  if (open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    spawn(cmd, process.platform === 'win32' ? ['/c', 'start', '', local] : [local], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
  const { urls } = connectUrls({ host: process.env.HOST || '127.0.0.1', port, publicUrl: info.publicUrl || '', tunnel: process.env.TUNNEL || 'none' });
  const remote = urls.find(u => u.kind !== 'local');
  if (remote) {
    const tk = await ticket(port, token);
    const link = `${remote.url}/?ticket=${tk.ticket}`;
    out.log('\n' + L('  手機（{label}）：用相機掃這個 QR，掃了就登入（10 分鐘內、用一次就失效）', { label: remote.label }));
    qrcode.generate(link, { small: true }, (q) => out.log(q));
    if (tk.code) out.log(L('  掃不了（例如 iPhone 主畫面上的 App）：開 {url}，在登入畫面輸入配對碼 {code}', { url: remote.url, code: tk.code.replace(/(\d{3})/, '$1 ') }));
    out.log(L('  之後要再給別的裝置登入：在網頁右上角按 📱，或執行 cubbi remote login-link'));
  } else {
    out.log('\n' + L('  現在只有這台電腦連得到。要從手機用：npx cubbi setup，選「同一個 Wi-Fi」或 Tailscale'));
  }
  out.log('\n' + L('第一次對話：在網頁上打一句話給 Claude，辦公室（右上角 ⬢）裡會走出一個員工開始做事。') + '\n');
  return true;
}
