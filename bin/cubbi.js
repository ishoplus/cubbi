#!/usr/bin/env node
// npx cubbi [--port 4321] [--no-open] [--stream 4322]
// npx cubbi install-hooks | uninstall-hooks [--settings <Claude Code 設定檔>]
// npx cubbi remote [--port 17000] | remote login-link [--public]
import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DATA = join(homedir(), '.cubbi');
const SETTINGS = opt('--settings') || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');

if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage:
  cubbi [--port 4321] [--no-open]     Open your Claude Code office in the browser
  cubbi --stream 4322                 Also serve a redacted copy for live streaming (OBS browser source):
                                      titles, prompts, paths and files are replaced or hidden
                                      (--no-badge hides the small "Cubbi" badge in the corner)
                                      (--stream-host <dir>: the stream page loads front-end files from <dir> first,
                                       e.g. your own host.js with plugins that add rooms to the office)
  cubbi install-hooks                 Optional: live updates (raised hands, running commands) via Claude Code hooks
  cubbi uninstall-hooks               Remove only the hooks Cubbi added
  cubbi remote [--port 17000]         Operate Claude Code from your phone or another computer: chat, approve,
                                      review branches, inbox with push notifications (needs login; see ~/.cubbi/.env)
  cubbi remote login-link [--public]  One-time login link + QR code for the remote server running on this machine

Cubbi reads your local Claude Code logs and listens on 127.0.0.1 only. Nothing is uploaded.`);
  process.exit(0);
}

if (args[0] === 'remote') {
  // 遠端操作：要登入、能操作對話。設定 ~/.cubbi/.env、資料 ~/.cubbi/remote（宿主可用 CW_DATA_DIR 換）
  const { CUBBI_HOME } = await import('../remote/paths.js');
  if (!process.env.ACCESS_TOKEN) {
    // 萬用密碼：第一次跑時產生、寫進 ~/.cubbi/.env（只有自己讀得到），登入連結要用它跟伺服器拿
    const { randomBytes } = await import('crypto');
    const { mkdirSync, appendFileSync, chmodSync } = await import('fs');
    const token = randomBytes(24).toString('hex');
    mkdirSync(CUBBI_HOME, { recursive: true, mode: 0o700 });
    appendFileSync(join(CUBBI_HOME, '.env'), `\n# 萬用密碼：只給本機的指令用（登入連結），不要給別人\nACCESS_TOKEN=${token}\n`);
    chmodSync(join(CUBBI_HOME, '.env'), 0o600);
    process.env.ACCESS_TOKEN = token;
  }
  if (opt('--port')) process.env.PORT = opt('--port');
  if (args[1] === 'login-link') await import('../remote/scripts/login-link.mjs');
  else await import('../remote/server.js');
} else if (args[0] === 'install-hooks') {
  const { installHooks } = await import('../server/hooks.js');
  try {
    const r = await installHooks({ settingsFile: SETTINGS, dataDir: DATA });
    console.log(r.added.length ? `Added Cubbi hooks to ${SETTINGS} (${r.added.join(', ')}).` : `Cubbi hooks are already installed in ${SETTINGS}.`);
    if (r.backup) console.log(`Backup of your original settings: ${r.backup}`);
    console.log(r.statusLine === 'kept' ? 'You already have a status line, so Cubbi left it alone.' : 'Status line: shows your figure and the office at the bottom of Claude Code.');
    console.log(r.command === 'kept' ? `You already have a /cubbi command (${r.cmdFile}); left it alone.` : 'Command: type /cubbi in Claude Code to jump to this session in the office.');
    console.log('New Claude Code sessions will report to Cubbi live. Remove with: npx cubbi uninstall-hooks');
  } catch (e) { console.error(e.message); process.exit(1); }
  process.exit(0);
}
if (args[0] === 'uninstall-hooks') {
  const { uninstallHooks } = await import('../server/hooks.js');
  try {
    const r = await uninstallHooks({ settingsFile: SETTINGS });
    console.log(r.removed.length ? `Removed Cubbi hooks from ${SETTINGS} (${r.removed.join(', ')}). Your other settings were left as they were.` : 'No Cubbi hooks found.');
  } catch (e) { console.error(e.message); process.exit(1); }
  process.exit(0);
}

// 唯讀的辦公室（預設）；remote 已經在上面起好了
if (args[0] !== 'remote') {
  const { startCubbi } = await import('../server/standalone.js');
  const port = Number(opt('--port') || process.env.PORT || 4321);
  try {
    const streamPort = args.includes('--stream') ? Number(/^\d+$/.test(opt('--stream') || '') ? opt('--stream') : port + 1) : null;
    const streamHostDir = opt('--stream-host') ? resolve(opt('--stream-host')) : null;
    const { url, streamUrl } = await startCubbi({ port, dataDir: DATA, streamPort, streamBadge: !args.includes('--no-badge'), streamHostDir });
    console.log(`Cubbi is open at ${url}  (Ctrl+C to stop)`);
    if (streamUrl) console.log(`Stream view (redacted) at ${streamUrl}`);
    if (!args.includes('--no-open')) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Try: cubbi --port ${port + 1}` : e.message);
    process.exit(1);
  }
}
