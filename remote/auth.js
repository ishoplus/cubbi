// ── 登入：信箱驗證碼＋有期限的通行證 ───────────────────────────────────────────
//
// claude-web 會在別人的電腦、手機上用，所以：
//   - 不讓瀏覽器永久保存密碼：登入換到一張「通行證」（session），有期限、可以從別的裝置踢掉
//   - 登入靠寄到固定信箱的 6 位數驗證碼（收件人寫死在伺服器，畫面上沒有欄位，別人改不了）
//   - 「這是別人的電腦」：閒置 2 小時或滿 12 小時就失效（前端也只放 sessionStorage，關掉瀏覽器就沒了）
//   - 自己的裝置：閒置 30 天失效
// 萬用密碼（.env 的 ACCESS_TOKEN）只給本機腳本（重啟腳本、產生一次性登入連結）用，不再印到紀錄裡。
// 通行證在 data/auth-sessions.json 只存雜湊，檔案外洩也拿不到可用的通行證。

import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const SESS_FILE = process.env.AUTH_SESSIONS_FILE || join(DATA, 'auth-sessions.json');
// 收件／寄件信箱放 .env，程式裡不留任何人的信箱；沒設就只能用一次性登入連結（scripts/login-link.mjs）
const EMAIL_TO = process.env.LOGIN_EMAIL || '';
const EMAIL_FROM = process.env.LOGIN_EMAIL_FROM || '';
const CODE_TTL = 10 * 60_000;
const OWN_IDLE = 30 * 86400_000;
const PUBLIC_IDLE = 2 * 3600_000, PUBLIC_MAX = 12 * 3600_000;
const TICKET_TTL = 10 * 60_000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let sessions = {};   // sha(token) -> { id, created, lastUsed, ua, ip, public }
try { sessions = JSON.parse(readFileSync(SESS_FILE, 'utf8')); } catch {}
let dirty = false;
function save() {
  if (!dirty) return;
  dirty = false;
  mkdirSync(dirname(SESS_FILE), { recursive: true });
  writeFileSync(SESS_FILE + '.tmp', JSON.stringify(sessions));
  renameSync(SESS_FILE + '.tmp', SESS_FILE);
}
setInterval(() => { prune(); save(); }, 60_000).unref();

function expired(s, now = Date.now()) {
  return s.public ? (now - s.lastUsed > PUBLIC_IDLE || now - s.created > PUBLIC_MAX) : now - s.lastUsed > OWN_IDLE;
}
function prune() {
  const now = Date.now();
  for (const [k, s] of Object.entries(sessions)) if (expired(s, now)) { delete sessions[k]; dirty = true; }
}

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
export function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '裝置';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '瀏覽器';
  return `${os} · ${br}`;
}

// 驗證：萬用密碼或有效通行證。通行證每次用到就更新最後使用時間（存檔節流）
export function checkToken(token, masterToken) {
  if (!token) return null;
  if (masterToken && token.length === masterToken.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(masterToken))) return { master: true };
  const k = sha(token), s = sessions[k];
  if (!s) return null;
  if (expired(s)) { delete sessions[k]; dirty = true; return null; }
  if (Date.now() - s.lastUsed > 60_000) { s.lastUsed = Date.now(); dirty = true; }
  return { session: s, key: k };
}
function issue(req, isPublic) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomBytes(4).toString('hex');
  sessions[sha(token)] = { id, created: Date.now(), lastUsed: Date.now(), ua: deviceName(req.headers['user-agent']), ip: clientIp(req), public: !!isPublic };
  dirty = true; save();
  return token;
}

// ── 信箱驗證碼 ──
const codes = new Map();   // reqId -> { hash, expires, tries, public }
const sendLog = [];        // 寄信時間（全域限速：一分鐘一封、一小時十封）
let failLog = [];          // 驗證失敗時間（一小時二十次就暫停）
function resendKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  try { return execFileSync('security', ['find-generic-password', '-s', 'claude-web-resend-key', '-w'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}
// 寄信走 Resend 或 SMTP：MAIL_PROVIDER 指定；沒指定時設了 SMTP_HOST 就用 SMTP
//   SMTP_HOST、SMTP_PORT（預設 587，465 自動走 TLS）、SMTP_USER、SMTP_PASS、SMTP_SECURE=1（強制 TLS）
const mailProvider = () => (process.env.MAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'resend')).toLowerCase();
const emailReady = () => !!(EMAIL_TO && EMAIL_FROM && (mailProvider() === 'smtp' ? process.env.SMTP_HOST : resendKey()));
async function sendMail({ subject, text, html }) {
  if (mailProvider() === 'smtp') {
    const { default: nodemailer } = await import('nodemailer');   // 只有選 SMTP 才載入
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE === '1' || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    });
    try { await t.sendMail({ from: EMAIL_FROM, to: EMAIL_TO, subject, text, html }); }
    catch (e) { throw new Error(`寄信失敗（SMTP：${e.code || e.message}）`); }
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${resendKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [EMAIL_TO], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`寄信失敗（${r.status}）`);
}
async function sendCode(code, req) {
  const when = new Date().toLocaleString('zh-TW', { hour12: false });   // 用這台電腦的時區
  const who = `${deviceName(req.headers['user-agent'])}，IP ${clientIp(req) || '未知'}`;
  const text = `claude-web 登入驗證碼：${code}\n\n10 分鐘內有效，只能用一次。\n要求登入的裝置：${who}\n時間：${when}\n\n如果不是你本人要登入，不要輸入這組數字，也不要轉給任何人。`;
  const html = `<div style="font-family:-apple-system,'PingFang TC',sans-serif;max-width:420px;margin:auto;padding:24px;color:#1b2a34">
    <div style="font-size:14px;color:#5b6b78">claude-web 登入驗證碼</div>
    <div style="font-size:40px;font-weight:800;letter-spacing:10px;margin:14px 0">${code}</div>
    <div style="font-size:14px;line-height:1.7">10 分鐘內有效，只能用一次。<br>要求登入的裝置：${who}<br>時間：${when}</div>
    <div style="margin-top:16px;padding:10px 12px;background:#fff4e5;border-radius:8px;font-size:13px">如果不是你本人要登入，不要輸入這組數字，也不要轉給任何人。</div></div>`;
  await sendMail({ subject: `claude-web 登入驗證碼 ${code}`, text, html });
}
const maskEmail = (e) => e.replace(/^(.)(.*)(.@)/, (_, a, b, c) => a + '*'.repeat(Math.max(2, b.length)) + c);

// ── 一次性登入連結（本機用萬用密碼產生，給信箱收不到時用）──
const tickets = new Map();   // sha(ticket) -> expires

export function authRoutes(app, { masterToken }) {
  app.post('/api/auth/email-code', async (req, res) => {
    if (!emailReady()) return res.status(503).json({ error: '信箱登入還沒設定。請在這台電腦執行 node scripts/login-link.mjs 取得登入連結' });
    const now = Date.now();
    while (sendLog.length && now - sendLog[0] > 3600_000) sendLog.shift();
    if (sendLog.length && now - sendLog.at(-1) < 60_000) return res.status(429).json({ error: '剛寄過，一分鐘後才能再寄' });
    if (sendLog.length >= 10) return res.status(429).json({ error: '這一小時寄太多次了，晚點再試' });
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const reqId = crypto.randomBytes(12).toString('hex');
    try { await sendCode(code, req); } catch (e) { console.error('[auth]', e.message); return res.status(502).json({ error: '寄信失敗，請稍後再試' }); }
    sendLog.push(now);
    codes.set(reqId, { hash: sha(code), expires: now + CODE_TTL, tries: 0 });
    if (process.env.AUTH_TEST_CODE_FILE) writeFileSync(process.env.AUTH_TEST_CODE_FILE, code);   // 只給自動化測試用（正式環境沒設）
    console.log(`[auth] 寄出驗證碼（${deviceName(req.headers['user-agent'])}，${clientIp(req)}）`);
    res.json({ reqId, to: maskEmail(EMAIL_TO) });
  });

  app.post('/api/auth/verify', (req, res) => {
    const { reqId, code, public: isPublic } = req.body || {};
    const now = Date.now();
    failLog = failLog.filter(t => now - t < 3600_000);
    if (failLog.length >= 20) return res.status(429).json({ error: '錯太多次了，一小時後再試' });
    const c = codes.get(String(reqId || ''));
    if (!c || c.expires < now) { codes.delete(reqId); return res.status(400).json({ error: '驗證碼過期了，請重新寄一次' }); }
    const ok = /^\d{6}$/.test(String(code || '')) && crypto.timingSafeEqual(Buffer.from(sha(String(code))), Buffer.from(c.hash));
    if (!ok) {
      failLog.push(now);
      if (++c.tries >= 5) { codes.delete(reqId); return res.status(400).json({ error: '錯太多次，這組驗證碼作廢了，請重新寄一次' }); }
      return res.status(400).json({ error: `驗證碼不對，還可以再試 ${5 - c.tries} 次` });
    }
    codes.delete(reqId);
    console.log(`[auth] 登入成功（${deviceName(req.headers['user-agent'])}，${clientIp(req)}${isPublic ? '，別人的電腦' : ''}）`);
    res.json({ token: issue(req, isPublic), public: !!isPublic });
  });

  // 一次性登入連結：本機腳本帶萬用密碼來要一張票，網址 /?ticket=… 換成通行證
  app.post('/api/auth/ticket', (req, res) => {
    const a = checkToken(req.headers['x-access-token'], masterToken);
    if (!a?.master) return res.status(401).json({ error: '未授權' });
    const t = crypto.randomBytes(18).toString('base64url');
    tickets.set(sha(t), Date.now() + TICKET_TTL);
    res.json({ ticket: t, ttlMin: TICKET_TTL / 60000 });
  });
  app.post('/api/auth/ticket-login', (req, res) => {
    const k = sha(String(req.body?.ticket || '')), exp = tickets.get(k);
    tickets.delete(k);
    if (!exp || exp < Date.now()) return res.status(400).json({ error: '登入連結無效或過期了' });
    res.json({ token: issue(req, !!req.body?.public), public: !!req.body?.public });
  });
}

// 已登入的裝置：列出、踢掉一台、全部登出（要登入）
export function sessionRoutes(router) {
  router.get('/sessions', (req, res) => {
    prune();
    res.json(Object.entries(sessions).map(([k, s]) => ({ id: s.id, ua: s.ua, ip: s.ip, created: s.created, lastUsed: s.lastUsed, public: s.public, current: k === req.auth?.key }))
      .sort((a, b) => b.lastUsed - a.lastUsed));
  });
  router.post('/revoke', (req, res) => {
    const { id, all } = req.body || {};
    for (const [k, s] of Object.entries(sessions)) {
      if (all ? k !== req.auth?.key : s.id === id) delete sessions[k];
    }
    dirty = true; save();
    res.json({ ok: true });
  });
  router.post('/logout', (req, res) => {
    if (req.auth?.key) { delete sessions[req.auth.key]; dirty = true; save(); }
    res.json({ ok: true });
  });
}
export const _test = { sendMail, mailProvider, sessions, expired, sha, emailReady };
