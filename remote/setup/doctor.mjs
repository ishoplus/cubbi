// ── cubbi doctor：選手機連線方式之前，先把這台的狀況查清楚 ─────────────────────────
//
// 給用戶看，也給幫忙安裝的代理人看（--json）：代理人自己查不準的事在這裡一次查好，
// 它照這份結果講話，不用自己猜、不會編出不存在的開關。
//   Node／Claude Code／Codex、Tailscale（含 Mac App 裡的指令、MagicDNS／HTTPS）、
//   這台有沒有開代理或 VPN、連不連得到 Tailscale／ngrok 的伺服器、現在的設定。
import { execFileSync } from 'child_process';
import { networkInterfaces } from 'os';
import { connect as tlsConnect } from 'tls';
import '../paths.js';   // 載入 ~/.cubbi/.env（看現在的設定）
import { claudeStatus } from './wizard.mjs';
import { tailscaleInfo } from '../tailscale.js';
import { lanAddresses } from '../connect.js';
import { t, CLI_LANG } from '../i18n.js';

const L = (s, v) => t(CLI_LANG(), s, v);
const tryRun = (cmd, args, timeout = 8000) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ''), code: e.code }; }
};

// 代理、VPN：會跟 Tailscale 搶網路的那些
const VPN_APPS = /shadowrocket|clash|mihomo|surge|v2ray|xray|quantumult|stash|sing-box|loon|openvpn|wireguard|nordvpn|expressvpn|protonvpn|surfshark|globalprotect|anyconnect|forticlient|zscaler|astrill|letsvpn|快连/i;
export function proxyInfo({ ifaces = networkInterfaces(), platform = process.platform, env = process.env } = {}) {
  const found = { apps: [], systemProxy: null, envProxy: null, fakeIp: false, tunnels: [] };
  const ps = tryRun('ps', ['-axo', 'comm']);
  if (ps.ok) found.apps = [...new Set(ps.out.split('\n').map(l => l.trim().split('/').pop()).filter(n => n && VPN_APPS.test(n) && !/helper|daemon|agent$/i.test(n)))];   // 常駐的小幫手不算有開
  if (platform === 'darwin') {
    const r = tryRun('scutil', ['--proxy']);
    const on = (k) => new RegExp(`\\b${k}Enable : 1`).test(r.out);
    const val = (k) => new RegExp(`\\b${k} : (\\S+)`).exec(r.out)?.[1];
    for (const k of ['HTTPS', 'HTTP', 'SOCKS']) if (r.ok && on(k)) { found.systemProxy = `${k.toLowerCase()} ${val(k + 'Proxy')}:${val(k + 'Port')}`; break; }
  }
  found.envProxy = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy || null;
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      // 198.18.0.0/15：代理工具 TUN／增強模式的假位址
      if (/^198\.1[89]\./.test(a.address)) found.fakeIp = true;
      // 其他通道介面（Tailscale 自己的 100.64.0.0/10 不算）
      else if (/^(utun|tun|tap|wg|ppp|ipsec)/.test(name) && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) found.tunnels.push(`${name} ${a.address}`);
    }
  }
  found.any = !!(found.apps.length || found.systemProxy || found.envProxy || found.fakeIp || found.tunnels.length);
  return found;
}

// 直接連（TLS 握手）看看：通、要多久。Node 不走系統代理，比較接近手機不開 VPN 時的情況（TUN 模式例外）
function reach(host, timeout = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const done = (ok, err) => { try { s.destroy(); } catch {} resolve({ host, ok, ms: ok ? Date.now() - t0 : null, ...(err ? { error: err } : {}) }); };
    // 只看連不連得到：ngrok 的伺服器用自己的憑證，驗證會失敗但握手成功就算通
    const s = tlsConnect({ host, port: 443, servername: host, timeout, rejectUnauthorized: false }, () => done(true));
    s.on('timeout', () => done(false, 'timeout'));
    s.on('error', (e) => done(false, e.code || e.message));
  });
}

export async function doctor({ env = process.env } = {}) {
  const cs = claudeStatus();
  const codex = tryRun(env.CODEX_PATH || 'codex', ['--version'], 5000);
  const ts = tailscaleInfo(env);
  const proxy = proxyInfo({ env });
  const [tsControl, ngrokEdge] = await Promise.all([reach('controlplane.tailscale.com'), reach('connect.ngrok-agent.com')]);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = {
    node: { version: process.version, ok: Number(process.versions.node.split('.')[0]) >= 20 },
    claude: { installed: cs.installed, version: cs.version || null, loggedIn: !!cs.loggedIn },
    codex: { installed: codex.ok, version: codex.ok ? codex.out.trim().split('\n').pop() : null },
    tailscale: ts,
    proxy,
    reach: { tailscale: tsControl, ngrok: ngrokEdge },
    lan: lanAddresses(),
    timezone: tz,
    current: { tunnel: env.TUNNEL || 'none', host: env.HOST || '127.0.0.1', port: env.PORT || '17000', url: env.CLAUDE_WEB_URL || '' },
  };
  r.notes = notes(r);
  return r;
}

// 事實整理成幾句話：給人看、也給代理人當判斷依據（選哪個由用戶的回答決定，這裡不替他選）
function notes(r) {
  const n = [];
  if (!r.node.ok) n.push(L('Node 版本太舊（{v}），要 20 以上', { v: r.node.version }));
  if (!r.claude.installed) n.push(L('還沒裝 Claude Code'));
  else if (!r.claude.loggedIn) n.push(L('Claude Code 還沒登入：請用戶自己執行 claude auth login'));
  if (r.proxy.any) n.push(L('這台開著代理或 VPN（{what}）。手機如果也要開 VPN 才能上網，要知道手機一次只能開一個 VPN：用 Tailscale 時得先切過去', { what: [...r.proxy.apps, r.proxy.systemProxy, r.proxy.fakeIp && 'TUN', ...r.proxy.tunnels].filter(Boolean).join('、') }));
  if (r.proxy.fakeIp) n.push(L('代理工具開著 TUN／增強模式：要讓 100.64.0.0/10 和 *.ts.net 直連，Tailscale 才收得到手機連進來的流量；下面的連線測試也可能是走代理測到的'));
  if (!r.reach.tailscale.ok) n.push(L('連不到 Tailscale 的伺服器（{err}）：在這個網路 Tailscale 可能用不了', { err: r.reach.tailscale.error }));
  else if (r.reach.tailscale.ms > 1500) n.push(L('連 Tailscale 的伺服器很慢（{ms} ms），可能不穩', { ms: r.reach.tailscale.ms }));
  if (!r.reach.ngrok.ok) n.push(L('連不到 ngrok 的伺服器（{err}）：在這個網路 ngrok 可能用不了', { err: r.reach.ngrok.error }));
  if (r.tailscale.installed && !r.tailscale.running) n.push(L('Tailscale 有裝但沒連上（{state}）：打開它登入', { state: r.tailscale.state }));
  if (r.tailscale.running && !(r.tailscale.magicDNS && r.tailscale.https)) n.push(L('Tailscale 管理頁還沒打開 MagicDNS 和 HTTPS：https://login.tailscale.com/admin/dns'));
  if (/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi)$/.test(r.timezone)) n.push(L('時區是中國大陸：Tailscale、ngrok 在大陸常常不穩，要問用戶平常人在哪'));
  if (!r.lan.length) n.push(L('找不到區網位址：「同一個 Wi-Fi」用不了'));
  return n;
}

export function printDoctor(r, out = console) {
  const ok = (b) => (b ? '✓' : '✗');
  out.log('\n' + L('🩺 Cubbi 檢查') + '\n');
  out.log(`${ok(r.node.ok)} Node ${r.node.version}`);
  out.log(`${ok(r.claude.installed && r.claude.loggedIn)} Claude Code ${r.claude.version || ''}${r.claude.installed && !r.claude.loggedIn ? L('（還沒登入）') : ''}`);
  out.log(`${r.codex.installed ? '✓' : '·'} Codex ${r.codex.version || L('（沒裝，可以不用）')}`);
  const ts = r.tailscale;
  out.log(`${ts.running && ts.https && ts.magicDNS ? '✓' : ts.installed ? '△' : '·'} Tailscale ${!ts.installed ? L('（沒裝）') : !ts.running ? L('（沒連上：{state}）', { state: ts.state }) : `${ts.host}${ts.https && ts.magicDNS ? '' : L('（MagicDNS／HTTPS 沒開）')}`}`);
  const rc = (x) => (x.ok ? `${x.ms} ms` : L('連不到（{err}）', { err: x.error }));
  out.log(L('  連線測試：Tailscale {a}、ngrok {b}', { a: rc(r.reach.tailscale), b: rc(r.reach.ngrok) }));
  out.log(L('  區網位址：{ips}', { ips: r.lan.join('、') || '—' }));
  out.log(L('  代理／VPN：{what}', { what: r.proxy.any ? [...r.proxy.apps, r.proxy.systemProxy, r.proxy.fakeIp && 'TUN', ...r.proxy.tunnels].filter(Boolean).join('、') : L('沒有') }));
  out.log(L('  現在的設定：連線 {tunnel}、聽 {host}:{port}', r.current));
  if (r.notes.length) { out.log('\n' + L('要注意：')); for (const s of r.notes) out.log('  • ' + s); }
  out.log('');
}
