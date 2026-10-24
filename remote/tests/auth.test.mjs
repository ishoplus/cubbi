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
