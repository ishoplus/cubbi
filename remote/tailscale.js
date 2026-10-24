// ── Tailscale：找得到指令、看狀態、清掉轉發 ──────────────────────────────────────
//
// Mac 從 App Store／官網裝的 Tailscale 預設沒有 `tailscale` 指令（要自己在選單裡裝），
// 但 App 裡的執行檔可以直接當指令用；找不到 PATH 上的就去那裡找。
// TAILSCALE_BIN 可以指定。
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

const CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
];

const tryRun = (bin, args, timeout = 15000) => {
  try { return { ok: true, out: execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message), code: e.code }; }
};

let cached = null;
export function tailscaleBin(env = process.env) {
  if (env.TAILSCALE_BIN) return env.TAILSCALE_BIN;
  if (cached) return cached;
  const r = tryRun('tailscale', ['version'], 5000);
  if (r.ok || r.code !== 'ENOENT') return (cached = 'tailscale');
  return (cached = CANDIDATES.find(p => existsSync(p)) || 'tailscale');
}

// { installed, bin, running, state, host, tailnet, magicDNS, https }
// https：管理頁有沒有打開 HTTPS（有才拿得到憑證，tailscale serve 才不會卡在「請去開啟」）
export function tailscaleInfo(env = process.env) {
  const bin = tailscaleBin(env);
  const r = tryRun(bin, ['status', '--json']);
  if (!r.ok && r.code === 'ENOENT') return { installed: false, bin: null, running: false };
  let j = null;
  try { j = JSON.parse(r.out); } catch {}
  if (!j) return { installed: true, bin, running: false, state: 'unknown', error: (r.err || '').trim().split('\n')[0] };
  return {
    installed: true, bin,
    running: j.BackendState === 'Running',
    state: j.BackendState || 'unknown',
    host: String(j.Self?.DNSName || '').replace(/\.$/, ''),
    tailnet: j.CurrentTailnet?.Name || '',
    magicDNS: !!j.CurrentTailnet?.MagicDNSEnabled,
    https: Array.isArray(j.CertDomains) && j.CertDomains.length > 0,
  };
}

// 把 Cubbi 設的轉發拿掉（換別的連線方式、移除開機啟動時）
export function serveOff(httpsPort = process.env.TAILSCALE_HTTPS_PORT || '443', env = process.env) {
  const r = tryRun(tailscaleBin(env), ['serve', `--https=${httpsPort}`, 'off']);
  return r.ok;
}
