// 一次性登入連結：信箱收不到驗證碼時，在這台 Mac 上執行，拿到一個 10 分鐘內有效、只能用一次的登入網址（附 QR code）
//   npx cubbi remote login-link            自己的裝置（記住 30 天）
//   npx cubbi remote login-link --public   別人的電腦（關掉瀏覽器或閒置 2 小時就失效）
import qrcode from 'qrcode-terminal';
import '../paths.js';   // 載入 .env（啟動資料夾的、~/.cubbi/.env）
import { t, CLI_LANG } from '../i18n.js';

const L = (s, v) => t(CLI_LANG(), s, v);

const port = process.env.PORT || 17000;
// 對外網址放 .env 的 CLAUDE_WEB_URL；沒設就只能在這台電腦上開
const base = process.env.CLAUDE_WEB_URL || `http://127.0.0.1:${port}`;
if (!process.env.ACCESS_TOKEN) { console.error(L('.env 裡沒有 ACCESS_TOKEN（萬用密碼），拿不到登入連結')); process.exit(1); }
const r = await fetch(`http://127.0.0.1:${port}/api/auth/ticket`, { method: 'POST', headers: { 'x-access-token': process.env.ACCESS_TOKEN } });
if (!r.ok) { console.error(L('拿不到登入連結：'), r.status, await r.text()); process.exit(1); }
const { ticket, code, ttlMin } = await r.json();
const url = `${base}/?ticket=${ticket}${process.argv.includes('--public') ? '&public=1' : ''}`;
console.log('\n' + L('一次性登入連結（{n} 分鐘內有效，只能用一次）：', { n: ttlMin }) + `\n${url}\n`);
qrcode.generate(url, { small: true });
if (code) console.log('\n' + L('掃不了（例如 iPhone 主畫面上的 App）：在登入畫面輸入配對碼 {code}', { code: code.replace(/(\d{3})/, '$1 ') }) + '\n');
