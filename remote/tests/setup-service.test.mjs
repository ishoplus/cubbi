// 上手精靈與開機服務：.env 只改該改的鍵、服務設定檔（Mac plist／Linux systemd）、npx 暫存區不能裝、手機網址的順序、QR
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = mkdtempSync(join(tmpdir(), 'cw-setup-'));
process.env.CUBBI_HOME = join(root, 'home');
after(() => rmSync(root, { recursive: true, force: true }));
const { setEnvKeys } = await import('../setup/wizard.mjs');
const { serviceFile, isEphemeral } = await import('../setup/service.mjs');
const { connectUrls, qrSvg, lanAddresses } = await import('../connect.js');

test('.env：有的換掉、沒有的加上、null 刪掉，註解和別的鍵原樣留著；權限 600', () => {
  const f = join(root, 'a.env');
  writeFileSync(f, '# 我的註解\nACCESS_TOKEN=abc\nHOST=127.0.0.1\nNGROK_AUTHTOKEN=old\n');
  setEnvKeys(f, { HOST: '0.0.0.0', TUNNEL: 'tailscale', NGROK_AUTHTOKEN: null });
  assert.equal(readFileSync(f, 'utf8'), '# 我的註解\nACCESS_TOKEN=abc\nHOST=0.0.0.0\nTUNNEL=tailscale\n');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(process.env.TUNNEL, 'tailscale');
});

test('Mac：plist 帶 KeepAlive、RunAtLoad、環境變數、紀錄檔；特殊字元有跳脫', () => {
  const f = serviceFile({ platform: 'darwin', label: 'com.cubbi.remote', node: '/usr/bin/node', entry: '/opt/cubbi/bin/cubbi.js', args: ['remote'],
    cwd: '/Users/a/.cubbi', env: { PATH: '/bin:/usr/bin', NOTE: 'a&b' }, logFile: '/Users/a/.cubbi/remote/logs/server.log' });
  assert.match(f.path, /Library\/LaunchAgents\/com\.cubbi\.remote\.plist$/);
  for (const s of ['<key>KeepAlive</key><true/>', '<key>RunAtLoad</key><true/>', '<string>/opt/cubbi/bin/cubbi.js</string>', '<string>remote</string>', '<key>PATH</key><string>/bin:/usr/bin</string>', 'a&amp;b', 'server.log']) assert.ok(f.content.includes(s), s);
});

test('Linux：systemd user unit，Restart=always、引號跳脫', () => {
  const f = serviceFile({ platform: 'linux', label: 'com.cubbi.remote', node: '/usr/bin/node', entry: '/opt/c b/bin/cubbi.js', args: ['remote'],
    cwd: '/home/a/.cubbi', env: { PATH: '/bin', X: 'say "hi"' }, logFile: '/home/a/log' });
  assert.match(f.path, /systemd\/user\/com\.cubbi\.remote\.service$/);
  assert.ok(f.content.includes('ExecStart="/usr/bin/node" "/opt/c b/bin/cubbi.js" "remote"'));
  assert.ok(f.content.includes('Environment="X=say \\"hi\\""'));
  assert.ok(f.content.includes('Restart=always') && f.content.includes('WantedBy=default.target'));
});

test('npx 的暫存區不能當開機啟動的位置', () => {
  assert.equal(isEphemeral('/Users/a/.npm/_npx/05ee/node_modules/cubbi/bin/cubbi.js'), true);
  assert.equal(isEphemeral('/opt/homebrew/lib/node_modules/cubbi/bin/cubbi.js'), false);
});

test('用手機開：通道優先；只聽本機時沒有區網網址', () => {
  const t = connectUrls({ host: '127.0.0.1', port: 17000, publicUrl: 'https://mac.tail1.ts.net/', tunnel: 'tailscale' });
  assert.equal(t.best.kind, 'tunnel'); assert.equal(t.best.url, 'https://mac.tail1.ts.net');
  assert.ok(!t.urls.some(u => u.kind === 'lan'));
  const l = connectUrls({ host: '0.0.0.0', port: 17000 });
  assert.equal(l.lanBound, true);
  assert.ok(l.urls.at(-1).kind === 'local');
  const only = connectUrls({ host: '127.0.0.1', port: 17000 });
  assert.equal(only.best.kind, 'local');
});

test('QR：SVG、白底、有方塊', () => {
  const svg = qrSvg('http://192.168.1.2:17000/?ticket=abc');
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.includes('fill="#fff"') && (svg.match(/h1v1h-1z/g) || []).length > 100);
});

test('區網位址：代理工具的虛擬網卡、沒拿到位址的不列，私有網段排前面', () => {
  const ifaces = { utun3: [{ family: 'IPv4', address: '198.18.0.1', internal: false }], en7: [{ family: 'IPv4', address: '100.80.1.2', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.50.249', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    bridge: [{ family: 'IPv4', address: '169.254.3.3', internal: false }], lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
  assert.deepEqual(lanAddresses(ifaces), ['192.168.50.249', '100.80.1.2']);
});
