// 設定檔與通道：沒設定檔就是保守預設；通道種類的判斷；tailscale 用假的指令測
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'cw-cfg-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('沒有設定檔：不連外、外掛全關', async () => {
  process.env.CW_CONFIG = join(dir, 'none.json');
  const { config, weatherConfig } = await import('../config.js?a');
  assert.equal(config.space.aiNames, false);
  assert.equal(config.space.transcripts, true);
  assert.equal(weatherConfig(), null);
  assert.deepEqual(config.plugins, { economy: false });
  assert.deepEqual(config.pluginModules, []);
});

test('設定檔蓋過預設，沒寫到的照預設', async () => {
  process.env.CW_CONFIG = join(dir, 'me.json');
  writeFileSync(process.env.CW_CONFIG, JSON.stringify({ space: { aiNames: true, weather: { lat: 25.03, lon: 121.5, timezone: 'Asia/Taipei', place: '台北' }, catNames: ['妹妹'] }, plugins: { economy: true } }));
  const { config, weatherConfig } = await import('../config.js?b');
  assert.equal(config.space.aiNames, true);
  assert.equal(config.space.transcripts, true);
  assert.deepEqual(weatherConfig(), { lat: 25.03, lon: 121.5, timezone: 'Asia/Taipei', place: '台北' });
  assert.equal(config.plugins.economy, true);
});

const { tunnelKind, startTunnel, publicUrl } = await import('../tunnel.js');
const quiet = { log() {}, warn() {} };

test('通道種類：明寫的優先；沒寫時 ngrok token → ngrok、有網址 → external、都沒有 → none', () => {
  assert.equal(tunnelKind({}), 'none');
  assert.equal(tunnelKind({ CLAUDE_WEB_URL: 'https://x' }), 'external');
  assert.equal(tunnelKind({ NGROK_AUTHTOKEN: 't', CLAUDE_WEB_URL: 'https://x' }), 'ngrok');
  assert.equal(tunnelKind({ TUNNEL: 'Tailscale', NGROK_AUTHTOKEN: 't' }), 'tailscale');
});

test('external：網址就是 CLAUDE_WEB_URL；沒寫網址就當沒開', async () => {
  assert.equal((await startTunnel({ port: 1, env: { TUNNEL: 'external', CLAUDE_WEB_URL: 'https://me.example/' }, log: quiet })).url, 'https://me.example');
  assert.equal((await startTunnel({ port: 1, env: { TUNNEL: 'external' }, log: quiet })).kind, 'none');
});

test('tailscale：serve 指到本機的埠，網址從 status 的 DNSName 來', async () => {
  const bin = join(dir, 'tailscale'), argsLog = join(dir, 'args.log');
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${argsLog}\nif [ "$1" = status ]; then echo '{"Self":{"DNSName":"mymac.tail1234.ts.net."}}'; fi\n`);
  chmodSync(bin, 0o755);
  const t = await startTunnel({ port: 17000, env: { TUNNEL: 'tailscale', TAILSCALE_BIN: bin }, log: quiet });
  assert.deepEqual(t, { kind: 'tailscale', url: 'https://mymac.tail1234.ts.net' });
  assert.equal(publicUrl(), 'https://mymac.tail1234.ts.net');
  assert.match(readFileSync(argsLog, 'utf8'), /^serve --bg --https=443 http:\/\/127\.0\.0\.1:17000$/m);
});

test('tailscale 沒裝：當沒開、伺服器照跑', async () => {
  const t = await startTunnel({ port: 17000, env: { TUNNEL: 'tailscale', TAILSCALE_BIN: join(dir, 'nope') }, log: quiet });
  assert.equal(t.kind, 'none');
});

test('不認得的種類：當沒開', async () => {
  assert.equal((await startTunnel({ port: 1, env: { TUNNEL: 'trycloudflare' }, log: quiet })).kind, 'none');
});
