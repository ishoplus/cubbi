// Tailscale：找指令、看狀態、通道開之前先檢查、換掉／移除時清轉發；doctor 認得代理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 假的 tailscale：status 回 $FAKE_TS_STATUS 檔案的內容，其他指令記進 $FAKE_TS_LOG
const dir = mkdtempSync(join(tmpdir(), 'cubbi-ts-'));
const bin = join(dir, 'tailscale');
writeFileSync(bin, `#!/bin/sh\necho "$@" >> "$FAKE_TS_LOG"\nif [ "$1" = status ]; then cat "$FAKE_TS_STATUS"; fi\n`);
chmodSync(bin, 0o755);
const statusFile = join(dir, 'status.json'), logFile = join(dir, 'log');
const env = (status) => { writeFileSync(statusFile, JSON.stringify(status)); writeFileSync(logFile, ''); return { TAILSCALE_BIN: bin, FAKE_TS_STATUS: statusFile, FAKE_TS_LOG: logFile, TUNNEL: 'tailscale', PATH: process.env.PATH }; };
// execFile 帶不了自訂 env 給子程序以外的東西：假指令讀的環境變數要放進 process.env
const use = (e) => Object.assign(process.env, { FAKE_TS_STATUS: e.FAKE_TS_STATUS, FAKE_TS_LOG: e.FAKE_TS_LOG });
const READY = { BackendState: 'Running', Self: { DNSName: 'mac.tail1234.ts.net.' }, CurrentTailnet: { Name: 'me@example.com', MagicDNSEnabled: true }, CertDomains: ['mac.tail1234.ts.net'] };

const { tailscaleInfo, serveOff } = await import('../tailscale.js');
const { startTunnel } = await import('../tunnel.js');
const { proxyInfo } = await import('../setup/doctor.mjs');
const quiet = { log() {}, warn() {} };

test('狀態：連上、MagicDNS、HTTPS 都看得出來', () => {
  const e = env(READY); use(e);
  assert.deepEqual(tailscaleInfo(e), { installed: true, bin, running: true, state: 'Running', host: 'mac.tail1234.ts.net', tailnet: 'me@example.com', magicDNS: true, https: true });
  const e2 = env({ ...READY, CertDomains: null }); use(e2);
  assert.equal(tailscaleInfo(e2).https, false);
  assert.equal(tailscaleInfo({ TAILSCALE_BIN: join(dir, 'nope') }).installed, false);
});

test('通道：管理頁沒開 HTTPS、沒登入就不跑 tailscale serve（不會卡住），講清楚去哪裡開', async () => {
  for (const [st, want] of [[{ ...READY, CertDomains: [] }, /admin\/dns/], [{ ...READY, BackendState: 'NeedsLogin' }, /NeedsLogin/]]) {
    const e = env(st); use(e);
    const warns = [];
    const r = await startTunnel({ port: 17099, env: e, log: { log() {}, warn: (m) => warns.push(m) } });
    assert.equal(r.url, '');
    assert.match(warns.join(''), want);
    assert.doesNotMatch(readFileSync(logFile, 'utf8'), /^serve/m, '沒有去跑 serve');
  }
});

test('通道：都好了就設轉發，網址是這台的 ts.net', async () => {
  const e = env(READY); use(e);
  const r = await startTunnel({ port: 17099, env: { ...e, TAILSCALE_HTTPS_PORT: '8443' }, log: quiet });
  assert.equal(r.url, 'https://mac.tail1234.ts.net:8443');
  assert.match(readFileSync(logFile, 'utf8'), /^serve --bg --https=8443 http:\/\/127\.0\.0\.1:17099$/m);
});

test('清轉發：serve --https=<port> off', () => {
  const e = env(READY); use(e);
  assert.equal(serveOff('8443', e), true);
  assert.match(readFileSync(logFile, 'utf8'), /^serve --https=8443 off$/m);
});

test('doctor：認得代理工具的 TUN 假位址、其他通道；Tailscale 自己的 100.x 不算', () => {
  const ifaces = {
    en0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
    utun3: [{ family: 'IPv4', address: '198.18.0.1', internal: false }],
    utun5: [{ family: 'IPv4', address: '100.101.102.103', internal: false }],
    utun7: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
  };
  const p = proxyInfo({ ifaces, platform: 'linux', env: {} });
  assert.equal(p.fakeIp, true);
  assert.deepEqual(p.tunnels, ['utun7 10.8.0.2']);
  assert.equal(p.any, true);
  const none = proxyInfo({ ifaces: { en0: ifaces.en0, utun5: ifaces.utun5 }, platform: 'linux', env: {} });
  assert.equal(none.fakeIp, false); assert.deepEqual(none.tunnels, []);
});
