// 寄信走 SMTP：假的 SMTP 伺服器收信，確認寄件人、收件人、主旨、內容都對；伺服器不在時錯誤訊息講得出原因
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'net';

const got = [];
const smtp = createServer((sock) => {
  let data = false, buf = '', msg = { rcpt: [], body: '' };
  const say = (l) => sock.write(l + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; got.push(msg); msg = { rcpt: [], body: '' }; say('250 ok queued'); }
        else msg.body += line + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') { sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n'); }
      else if (cmd === 'AUTH') { msg.auth = line; say('235 ok'); }
      else if (cmd === 'MAIL') { msg.from = line; say('250 ok'); }
      else if (cmd === 'RCPT') { msg.rcpt.push(line); say('250 ok'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 ok');
    }
  });
});
await new Promise(r => smtp.listen(0, '127.0.0.1', r));
after(() => smtp.close());

process.env.AUTH_SESSIONS_FILE = '/tmp/claude-web-auth-smtp-test.json';
process.env.LOGIN_EMAIL = 'me@example.test';
process.env.LOGIN_EMAIL_FROM = 'bot@example.test';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtp.address().port);
process.env.SMTP_USER = 'u'; process.env.SMTP_PASS = 'p';
delete process.env.MAIL_PROVIDER; delete process.env.RESEND_API_KEY;
const { _test } = await import('../auth.js');

test('設了 SMTP_HOST 就走 SMTP，信箱登入算設定好了', () => {
  assert.equal(_test.mailProvider(), 'smtp');
  assert.equal(_test.emailReady(), true);
});

test('SMTP 寄出：寄件人、收件人、主旨、內容', async () => {
  await _test.sendMail({ subject: '驗證碼 123456', text: '你的碼 123456', html: '<b>123456</b>' });
  assert.equal(got.length, 1);
  assert.match(got[0].from, /bot@example\.test/);
  assert.match(got[0].rcpt[0], /me@example\.test/);
  assert.ok(got[0].auth, '有登入');
  assert.match(got[0].body, /Subject: =\?UTF-8\?/);   // 中文主旨有編碼
  assert.match(got[0].body, /123456/);
});

test('SMTP 伺服器不在：錯誤講得出原因', async () => {
  process.env.SMTP_PORT = '1';
  await assert.rejects(_test.sendMail({ subject: 's', text: 't', html: 'h' }), /SMTP：/);
});
