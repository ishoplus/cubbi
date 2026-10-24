// 登入：通行證期限、裝置名稱
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.AUTH_SESSIONS_FILE = '/tmp/claude-web-auth-test.json';
delete process.env.LOGIN_EMAIL; delete process.env.LOGIN_EMAIL_FROM;
const { _test, deviceName, checkToken } = await import('../auth.js');

test('自己的裝置閒置 30 天才過期；別人的電腦閒置 2 小時或滿 12 小時就過期', () => {
  const now = Date.now(), H = 3600_000;
  assert.equal(_test.expired({ public: false, created: now - 40 * 24 * H, lastUsed: now - 29 * 24 * H }, now), false);
  assert.equal(_test.expired({ public: false, created: now, lastUsed: now - 31 * 24 * H }, now), true);
  assert.equal(_test.expired({ public: true, created: now - H, lastUsed: now - 3 * H }, now), true);
  assert.equal(_test.expired({ public: true, created: now - 13 * H, lastUsed: now - 60_000 }, now), true);
  assert.equal(_test.expired({ public: true, created: now - H, lastUsed: now - 60_000 }, now), false);
});
test('萬用密碼要完全相符；亂猜的通行證不行', () => {
  assert.ok(checkToken('a'.repeat(40), 'a'.repeat(40))?.master);
  assert.equal(checkToken('a'.repeat(39), 'a'.repeat(40)), null);
  assert.equal(checkToken('random-guess', 'a'.repeat(40)), null);
  assert.equal(checkToken('', 'a'.repeat(40)), null);
});
test('裝置名稱', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1'), 'iPhone · Safari');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36'), 'Windows · Chrome');
});
test('沒設收件／寄件信箱就不寄驗證碼（程式裡不留任何人的信箱）', () => {
  assert.equal(_test.emailReady(), false);
});

test('配對碼：等於一張一次性登入票，用了或票被用掉都失效；錯太多次就暫停', async () => {
  const { issueTicket, authRoutes } = await import('../auth.js');
  const { default: express } = await import('express');
  const app = express(); app.use(express.json());
  authRoutes(app, { masterToken: 'x'.repeat(32) });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  try {
    _test.resetPairFails();
    assert.deepEqual((await (await fetch(base + '/api/auth/methods')).json()), { email: false, pair: true });
    const a = issueTicket();
    assert.match(a.code, /^\d{6}$/);
    const ok = await post('/api/auth/pair', { code: a.code.slice(0, 3) + ' ' + a.code.slice(3) });
    assert.equal(ok.status, 200); assert.ok(checkToken(ok.j.token, 'x'.repeat(32)));
    assert.equal((await post('/api/auth/pair', { code: a.code })).status, 400, '配對碼只能用一次');
    assert.equal((await post('/api/auth/ticket-login', { ticket: a.ticket })).status, 400, '配對碼用了，連結也失效');
    const b = issueTicket();
    assert.equal((await post('/api/auth/ticket-login', { ticket: b.ticket })).status, 200);
    assert.equal((await post('/api/auth/pair', { code: b.code })).status, 400, '連結用了，配對碼也失效');
    assert.ok(!_test.pairCodes.has(b.code));
    const c = issueTicket();
    for (let i = 0; i < 20; i++) await post('/api/auth/pair', { code: c.code === '000000' ? '000001' : '000000' });
    assert.equal((await post('/api/auth/pair', { code: c.code })).status, 429, '一小時錯二十次就暫停');
  } finally { srv.close(); _test.resetPairFails(); }
});
