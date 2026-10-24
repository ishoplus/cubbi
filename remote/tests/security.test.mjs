// 安全：使用者檔案加沙箱、網址上的 token 只給 GET、萬用密碼比對不會丟錯、socket 資料夾要是自己的
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, statSync, chmodSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-sec-')));
const PORT = 17089;
let srv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
before(async () => {
  writeFileSync(join(root, 'evil.html'), '<script>alert(localStorage.cg_token)</script>');
  writeFileSync(join(root, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  writeFileSync(join(root, 'doc.pdf'), '%PDF-1.4');
  srv = spawn(process.execPath, [join(here, '..', '..', 'bin', 'cubbi.js'), 'remote'], { cwd: root, stdio: 'ignore',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CUBBI_HOME: join(root, 'home'), PORT: String(PORT), ACCESS_TOKEN: 'master-t', SETUP_DONE: '1', WORK_ROOT: root,
      CLAUDE_PATH: join(here, 'fake-claude.mjs'), CODEX_PATH: '/nonexistent', AGENT_SOCK_DIR: join(root, 'sk') } });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/info`); return; } catch { await sleep(150); } }
});
after(() => { srv?.kill(); rmSync(root, { recursive: true, force: true }); });
const url = (p) => `http://127.0.0.1:${PORT}${p}`;

test('工作資料夾裡的 .html／.svg：加沙箱（程式不能跑、碰不到登入資料）；PDF 不加', async () => {
  for (const f of ['evil.html', 'pic.svg']) {
    const r = await fetch(url(`/api/fs/file?path=${encodeURIComponent(join(root, f))}`), { headers: { 'x-access-token': 'master-t' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy') || '', /^sandbox;/, f);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  const pdf = await fetch(url(`/api/fs/file?path=${encodeURIComponent(join(root, 'doc.pdf'))}`), { headers: { 'x-access-token': 'master-t' } });
  assert.equal(pdf.headers.get('content-security-policy'), null);
});

test('網址上的 token：GET 收、POST 不收', async () => {
  assert.equal((await fetch(url('/api/info?token=master-t'))).status, 200);
  assert.equal((await fetch(url('/api/space/inbox/dismiss?token=master-t'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"key":"x"}' })).status, 401);
  assert.equal((await fetch(url('/api/space/inbox/dismiss'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-token': 'master-t' }, body: '{"key":"x"}' })).status, 200);
});

test('萬用密碼比對：多位元組字元不會讓伺服器出錯', async () => {
  const r = await fetch(url('/api/info'), { headers: { 'x-access-token': encodeURIComponent('中文中文') } });
  assert.equal(r.status, 401);
  const { checkToken } = await import('../auth.js');
  assert.equal(checkToken('中文中', 'abcdefghi'), null);   // 字元數一樣、位元組數不同
});

test('socket 資料夾：是連結就不用；別人讀寫得到就收緊', async () => {
  const { createHub } = await import('../agent-hub.js');
  const mk = (sockDir) => createHub({ sessions: new Map(), bySid: new Map(), dir: join(root, 'agents-' + Math.random()), sockDir, log: { log() {}, warn() {}, error() {} } });
  const real = join(root, 'real'); mkdirSync(real);
  const link = join(root, 'link'); symlinkSync(real, link);
  assert.throws(() => mk(link), /不是你的資料夾/);
  const open = join(root, 'open'); mkdirSync(open); chmodSync(open, 0o777);
  mk(open);
  assert.equal(statSync(open).mode & 0o777, 0o700);
});
