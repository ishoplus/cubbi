// ── 對外連線：讓手機從外面連進來 ─────────────────────────────────────────────
//
// 伺服器只聽 127.0.0.1，外面一律經通道進來。.env 的 TUNNEL 選一種：
//   none       只有這台電腦（預設；同一個 Wi-Fi 要用就設 HOST=0.0.0.0）
//   tailscale  推薦：tailscale serve 自帶 HTTPS、只有你的 tailnet 進得來、不用網域
//   ngrok      NGROK_AUTHTOKEN；免費帳號有一個固定子網域
//   external   通道在外面自己管（cloudflared 命名隧道之類），網址寫在 CLAUDE_WEB_URL
// 沒設 TUNNEL 時：有 NGROK_AUTHTOKEN 就 ngrok、有 CLAUDE_WEB_URL 就 external，不然 none。
// 不支援 trycloudflare 臨時隧道：它不支援 SSE，對話串流會斷。
import { execFile } from 'child_process';
import { t, TError, SERVER_LANG } from './i18n.js';

const run = (bin, args, timeout = 20000) => new Promise((resolve, reject) =>
  execFile(bin, args, { timeout }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));

export function tunnelKind(env = process.env) {
  const t = (env.TUNNEL || '').trim().toLowerCase();
  if (t) return t;
  if (env.NGROK_AUTHTOKEN) return 'ngrok';
  if (env.CLAUDE_WEB_URL) return 'external';
  return 'none';
}

let current = { kind: 'none', url: '' };
export const publicUrl = () => current.url || process.env.CLAUDE_WEB_URL || '';

export async function startTunnel({ port, env = process.env, log = console }) {
  const kind = tunnelKind(env);
  try {
    if (kind === 'none') {
      log.log?.('\n' + t(SERVER_LANG(), '[通道] 沒開：只有這台電腦連得到（設定 .env 的 TUNNEL，推薦 tailscale）') + '\n');
    } else if (kind === 'external') {
      if (!env.CLAUDE_WEB_URL) throw new Error('TUNNEL=external 要在 CLAUDE_WEB_URL 寫上對外網址');
      current = { kind, url: env.CLAUDE_WEB_URL.replace(/\/$/, '') };
    } else if (kind === 'ngrok') {
      if (!env.NGROK_AUTHTOKEN) throw new Error('TUNNEL=ngrok 要設 NGROK_AUTHTOKEN');
      const { default: ngrok } = await import('@ngrok/ngrok');
      const listener = await ngrok.forward({ addr: port, authtoken: env.NGROK_AUTHTOKEN, ...(env.NGROK_DOMAIN ? { domain: env.NGROK_DOMAIN } : {}) });
      current = { kind, url: listener.url() };
    } else if (kind === 'tailscale') {
      const bin = env.TAILSCALE_BIN || 'tailscale';
      const https = env.TAILSCALE_HTTPS_PORT || '443';
      // --bg：設定留在 tailscaled 裡，伺服器重啟不用重設；同一個埠再設一次是覆寫，不會疊加
      await run(bin, ['serve', '--bg', `--https=${https}`, `http://127.0.0.1:${port}`]);
      const st = JSON.parse(await run(bin, ['status', '--json']));
      const host = String(st?.Self?.DNSName || '').replace(/\.$/, '');
      if (!host) throw new Error('tailscale 沒回報這台的網域，先執行 tailscale up 並在管理頁打開 MagicDNS／HTTPS');
      current = { kind, url: `https://${host}${https === '443' ? '' : ':' + https}` };
    } else {
      throw new TError('不認得 TUNNEL={kind}（可用 none／tailscale／ngrok／external）', { kind });
    }
    if (current.url) log.log?.('\n' + t(SERVER_LANG(), '[通道] {kind}：{url}', { kind, url: current.url }) + '\n');
  } catch (e) {
    log.warn?.('\n' + t(SERVER_LANG(), '[通道] {kind} 開不起來：{msg}', { kind, msg: e.key ? t(SERVER_LANG(), e.key, e.vars) : t(SERVER_LANG(), e.message) }) + '\n');
    current = { kind: 'none', url: '' };
  }
  return current;
}
