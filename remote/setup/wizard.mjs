// ── npx cubbi setup：一步步帶新用戶用起來 ────────────────────────────────────────────
//
//   1. Claude Code 裝了嗎、登入了嗎（claude auth status，不花額度）；沒登入可以當場登入
//   2. Claude 可以在哪個資料夾做事（WORK_ROOT）
//   3. 手機怎麼連：只在這台／同一個 Wi-Fi／Tailscale（推薦，出門也能用）／ngrok／自己的網址
//   4. 說清楚辦公室會讀什麼（經營系統讀本機的 Claude Code 紀錄，不上傳）
//   5. 要不要開機自動啟動（cubbi service install）
//   6. 起來、在這台開瀏覽器（自動登入）、印手機用的 QR
// 每一步都能用參數答（給自己的 Claude Code 代裝用）：
//   --yes  全部照預設；--work-root <資料夾>；--connect local|lan|tailscale|ngrok|url；--ngrok-token <token>；
//   --url <你的網址>；--service／--no-service；--no-open；--port <port>
// 設定寫進 ~/.cubbi/.env（只改這幾個鍵，其他照留），寫完記 SETUP_DONE=1，之後 cubbi remote 不再問。
import { createInterface } from 'readline';
import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { CUBBI_HOME } from '../paths.js';
import { claudePath } from '../shared.js';
import { t, CLI_LANG } from '../i18n.js';

const L = (s, v) => t(CLI_LANG(), s, v);

export const ENV_FILE = join(CUBBI_HOME, '.env');

// .env 改幾個鍵：有就換掉、沒有就加在最後、null 就刪掉；其他行（註解、別的鍵）原樣留著
export function setEnvKeys(file, patch, { keepEnv = false } = {}) {
  let lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const done = new Set();
  lines = lines.flatMap(l => {
    const m = /^([A-Z0-9_]+)=/.exec(l);
    if (!m || !(m[1] in patch)) return [l];
    done.add(m[1]);
    return patch[m[1]] == null ? [] : [`${m[1]}=${patch[m[1]]}`];
  });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();   // 結尾的空行先拿掉，新的鍵接在最後一行後面
  for (const [k, v] of Object.entries(patch)) if (!done.has(k) && v != null) lines.push(`${k}=${v}`);
  mkdirSync(CUBBI_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
  chmodSync(file, 0o600);
  // 這個程式也跟著用新值；keepEnv：環境裡已經明確設了的不蓋（只寫檔）
  for (const [k, v] of Object.entries(patch)) { if (keepEnv && process.env[k]) continue; if (v == null) delete process.env[k]; else process.env[k] = String(v); }
}

const tryRun = (cmd, args) => { try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }) }; } catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message), code: e.code }; } };

export function claudeStatus() {
  const v = tryRun(claudePath, ['--version']);
  if (!v.ok) return { installed: false };
  const a = tryRun(claudePath, ['auth', 'status']);
  let loggedIn = a.ok;
  try { loggedIn = JSON.parse(a.out).loggedIn !== false; } catch {}
  return { installed: true, version: v.out.trim(), loggedIn };
}
export function tailscaleStatus() {
  const r = tryRun(process.env.TAILSCALE_BIN || 'tailscale', ['status', '--json']);
  if (!r.ok) return { installed: r.code !== 'ENOENT', running: false };
  try { const j = JSON.parse(r.out); return { installed: true, running: j.BackendState === 'Running', host: String(j.Self?.DNSName || '').replace(/\.$/, '') }; }
  catch { return { installed: true, running: false }; }
}

export async function setupWizard(argv = process.argv.slice(3), { out = console, input = process.stdin, startServer, service } = {}) {
  const has = (f) => argv.includes(f);
  const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const yes = has('--yes');
  // 一行一行照順序讀：答案一次全部餵進來（自己的 Claude Code 代答、管線）也不會掉行；讀完了就用預設
  const rl = yes ? null : createInterface({ input, terminal: false });
  const lines = rl?.[Symbol.asyncIterator]();
  const ask = async (q, def = '') => {
    if (yes) return def;
    process.stdout.write(`${q}${def ? L('（直接按 Enter＝{def}）', { def }) : ''}${L('：')}`);
    const { value, done } = await lines.next();
    if (done) process.stdout.write('\n');
    return (done ? '' : String(value).trim()) || def;
  };
  const say = (s = '') => out.log(s);
  const close = () => rl?.close();

  say('\n' + L('🧱 Cubbi：用手機操作你電腦上的 Claude Code') + '\n');

  // 1. Claude Code
  let cs = claudeStatus();
  if (!cs.installed) {
    say(L('✗ 這台電腦還沒裝 Claude Code。先裝好再回來：') + '\n    npm install -g @anthropic-ai/claude-code\n' + L('  （說明：https://docs.anthropic.com/claude-code）'));
    close(); return { ok: false, step: 'claude' };
  }
  say(`✓ Claude Code ${cs.version}`);
  if (!cs.loggedIn) {
    const go = await ask(L('✗ Claude Code 還沒登入。現在登入嗎？（y/n）'), 'y');
    if (go.toLowerCase().startsWith('y') && !yes) {
      close();
      await new Promise(r => spawn(claudePath, ['auth', 'login'], { stdio: 'inherit' }).on('close', r));
      return setupWizard(argv, { out, input, startServer, service });
    }
    say(L('  登入好再跑一次：claude auth login，然後 npx cubbi setup'));
    close(); return { ok: false, step: 'login' };
  }
  say(L('✓ 已經登入'));

  // 2. 工作資料夾
  say('\n' + L('Claude 可以在哪個資料夾裡做事？（它只能動這底下的檔案；通常是放所有專案的那一層）'));
  let root = resolve(opt('--work-root') || await ask(L('資料夾'), process.env.WORK_ROOT || process.cwd()));
  if (root.startsWith('~')) root = join(homedir(), root.slice(1));
  if (!existsSync(root)) {
    // 還沒有就幫他建（--yes 直接建）；說不要才停
    const make = /^y/i.test(await ask(L('還沒有這個資料夾，要建立嗎？(y/n)'), 'y'));
    if (make) { try { mkdirSync(root, { recursive: true }); say(L('✓ 建好了')); } catch (e) { say(L('✗ 建不起來：{msg}', { msg: e.message })); } }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) { say(L('✗ 找不到資料夾：{root}', { root })); close(); return { ok: false, step: 'root' }; }
  say(`✓ ${root}`);

  // 3. 手機怎麼連
  const ts = tailscaleStatus();
  say('\n' + L('手機怎麼連到這台？'));
  say(L('  1. 只在這台電腦用（最安全，之後可以再改）'));
  say(L('  2. 同一個 Wi-Fi 的手機（只在自己家裡、辦公室這種信任的網路）'));
  say(L('  3. Tailscale：出門也能用，只有你自己的裝置連得到（推薦）{note}', { note: ts.running ? L('　← 偵測到已經在跑') : ts.installed ? L('　← 有裝，但還沒登入（tailscale up）') : '' }));
  say(L('  4. ngrok：出門也能用，要一個免費帳號的 authtoken'));
  say(L('  5. 我自己有網址（cloudflared 命名隧道之類，自己架好的）'));
  const pickMap = { local: '1', lan: '2', tailscale: '3', ngrok: '4', url: '5' };
  const pick = pickMap[opt('--connect')] || await ask(L('選一個'), ts.running ? '3' : '2');
  const env = { WORK_ROOT: root, HOST: '127.0.0.1', TUNNEL: 'none', NGROK_AUTHTOKEN: null, CLAUDE_WEB_URL: null };
  if (pick === '2') { env.HOST = '0.0.0.0'; say(L('✓ 同一個 Wi-Fi：手機掃 QR 就能用。只在自己家裡、辦公室這種信任的網路用——走的是沒加密的 http，咖啡廳的 Wi-Fi 上別人截得到；出門請用 Tailscale')); }
  else if (pick === '3') {
    if (!ts.running) say(L('  先在這台和手機都裝好 Tailscale、登入同一個帳號，並在管理頁打開 MagicDNS 與 HTTPS：https://tailscale.com/download'));
    env.TUNNEL = 'tailscale'; say('✓ Tailscale');
  } else if (pick === '4') {
    const t = opt('--ngrok-token') || await ask(L('貼上 ngrok 的 authtoken（https://dashboard.ngrok.com/get-started/your-authtoken）'));
    if (!t) { say(L('✗ 沒有 authtoken')); close(); return { ok: false, step: 'ngrok' }; }
    env.TUNNEL = 'ngrok'; env.NGROK_AUTHTOKEN = t; say('✓ ngrok');
  } else if (pick === '5') {
    const u = opt('--url') || await ask(L('你的網址（https://…）'));
    if (!/^https:\/\//.test(u || '')) { say(L('✗ 要是 https:// 開頭的網址（不支援 trycloudflare 臨時隧道）')); close(); return { ok: false, step: 'url' }; }
    env.TUNNEL = 'external'; env.CLAUDE_WEB_URL = u.replace(/\/$/, ''); say(L('✓ {url}（通道你自己管，指到 http://127.0.0.1:{port}）', { url: env.CLAUDE_WEB_URL, port: process.env.PORT || 17000 }));
  } else say(L('✓ 只在這台電腦'));
  if (opt('--port')) env.PORT = opt('--port');

  // 4. 會讀什麼
  say('\n' + L('辦公室會讀這台電腦上的 Claude Code 紀錄（~/.claude/projects），把每段對話畫成一個員工、算成果換積木。'));
  say(L('只在本機讀、不上傳；要關掉在 ~/.cubbi/remote/config.json 寫 { "plugins": { "economy": false } }。'));

  // 5. 開機自動啟動
  const viaNpx = /[\\/]_npx[\\/]/.test(import.meta.url);
  let wantService = has('--service') ? true : has('--no-service') ? false : null;
  if (wantService == null) wantService = (await ask('\n' + L('要開機自動啟動、當掉自動重啟嗎？（y/n）'), 'y')).toLowerCase().startsWith('y');

  setEnvKeys(ENV_FILE, { ...env, SETUP_DONE: '1' });
  say('\n' + L('設定存在 {file}', { file: ENV_FILE }));
  close();

  if (wantService && viaNpx) {
    say('\n' + L('開機啟動要一個固定的安裝位置（npx 的暫存區會被清掉）。請執行：') + '\n    npm i -g cubbi && cubbi service install\n' + L('這次先直接跑起來。'));
    wantService = false;
  }
  return { ok: true, env, wantService, open: !has('--no-open') };
}
