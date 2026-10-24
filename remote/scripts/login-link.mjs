// 一次性登入連結：信箱收不到驗證碼時，在這台 Mac 上執行，拿到一個 10 分鐘內有效、只能用一次的登入網址（附 QR code）
//   node scripts/login-link.mjs            自己的裝置（記住 30 天）
//   node scripts/login-link.mjs --public   別人的電腦（關掉瀏覽器或閒置 2 小時就失效）
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode-terminal';

const dir = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(readFileSync(join(dir, '.env'), 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const port = env.PORT || 17000;
// 對外網址放 .env 的 CLAUDE_WEB_URL；沒設就只能在這台電腦上開
const base = process.env.CLAUDE_WEB_URL || env.CLAUDE_WEB_URL || `http://127.0.0.1:${port}`;
const r = await fetch(`http://127.0.0.1:${port}/api/auth/ticket`, { method: 'POST', headers: { 'x-access-token': env.ACCESS_TOKEN } });
if (!r.ok) { console.error('拿不到登入連結：', r.status, await r.text()); process.exit(1); }
const { ticket, ttlMin } = await r.json();
const url = `${base}/?ticket=${ticket}${process.argv.includes('--public') ? '&public=1' : ''}`;
console.log(`\n一次性登入連結（${ttlMin} 分鐘內有效，只能用一次）：\n${url}\n`);
qrcode.generate(url, { small: true });
