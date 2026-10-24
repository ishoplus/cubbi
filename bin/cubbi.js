#!/usr/bin/env node
// npx cubbi [--port 4321] [--no-open] [--stream 4322]
// npx cubbi install-hooks | uninstall-hooks [--settings <Claude Code 設定檔>]
// npx cubbi remote [--port 17000] | remote login-link [--public]
// npx cubbi ideas run|verdict|start|done|list|lenses | install-skills
// npx cubbi setup [--yes …] | service install|restart|status|logs|uninstall
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
  cubbi setup                         Step-by-step setup for remote use (runs automatically the first time you run cubbi remote)
  cubbi service install|restart|status|logs|uninstall   Start on boot, restart safely, see status and logs
  cubbi remote [--port 17000]         Operate Claude Code from your phone or another computer: chat, approve,
                                      review branches, inbox with push notifications (needs login; see ~/.cubbi/.env)
  cubbi remote login-link [--public]  One-time login link + QR code for the remote server running on this machine
  cubbi ideas run|list|verdict …      Ideas department: proposals for your projects, answer yes / no / tweak
  cubbi install-skills                Add Cubbi's skills to Claude Code (~/.claude/skills): ideas department

Cubbi reads your local Claude Code logs and listens on 127.0.0.1 only. Nothing is uploaded.`);
  process.exit(0);
}

if (args[0] === 'ideas') {
  await import('../remote/ideas/cli.mjs');
} else if (args[0] === 'install-skills') {
  // 把 Cubbi 的技能放進 Claude Code（~/.claude/skills/<名字>），已經有的同名資料夾整個換新
  const { cpSync, rmSync, readdirSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const src = fileURLToPath(new URL('../remote/skills/', import.meta.url));
  const dest = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills');
  for (const name of readdirSync(src)) {
    rmSync(join(dest, name), { recursive: true, force: true });
    cpSync(join(src, name), join(dest, name), { recursive: true });
    console.log(`Installed skill ${name} → ${join(dest, name)}`);
  }
  process.exit(0);
} else if (['remote', 'setup', 'service'].includes(args[0])) {
  // 遠端操作：要登入、能操作對話。設定 ~/.cubbi/.env、資料 ~/.cubbi/remote（宿主可用 CW_DATA_DIR 換）
  const { CUBBI_HOME } = await import('../remote/paths.js');
  const { join: pjoin } = await import('path');
  const { setEnvKeys, ENV_FILE } = await import('../remote/setup/wizard.mjs');
  // 萬用密碼：~/.cubbi/.env 裡沒有就產生一組寫進去（只有自己讀得到）。看檔案不看環境變數：
  // 開機服務只讀檔案，終端機裡剛好設了別的 ACCESS_TOKEN 也不能讓檔案空著
  const { existsSync: ex, readFileSync: rf } = await import('fs');
  if (!process.env.CW_DATA_DIR && !(ex(ENV_FILE) && /^ACCESS_TOKEN=./m.test(rf(ENV_FILE, 'utf8')))) {
    const { randomBytes } = await import('crypto');
    setEnvKeys(ENV_FILE, { ACCESS_TOKEN: randomBytes(24).toString('hex') }, { keepEnv: true });
  }
  if (opt('--port')) process.env.PORT = opt('--port');
  const svc = await import('../remote/setup/service.mjs');
  const { welcome } = await import('../remote/setup/welcome.mjs');
  const fail = (e) => { console.error('✗ ' + (e.message || e)); process.exit(1); };
  // 起來：有開機服務就交給它；沒有就在這個終端機跑（關掉終端機就停）
  const startUp = async ({ wantService, open = true }) => {
    if (wantService) {
      let m;
      try { m = svc.install({ port: process.env.PORT || 17000 }); } catch (e) { if (e.code === 'NPX') { console.log('\n' + e.message + '\n這次先直接跑起來。'); return startUp({ wantService: false, open }); } throw e; }
      if (await welcome({ open, port: m.port, token: svc.serviceToken(m) })) process.exit(0);
      process.exit(1);
    }
    welcome({ open }).catch(() => {});
    await import('../remote/server.js');
  };
  if (args[0] === 'service') {
    const sub = args[1];
    try {
      if (sub === 'install') { const m = svc.install({ entry: opt('--entry'), cwd: opt('--cwd'), port: process.env.PORT || 17000 }); console.log((await welcome({ open: false, port: m.port, token: svc.serviceToken(m) })) ? '✓ 開機會自動啟動，當掉會自動重啟' : ''); }
      else if (sub === 'restart') await svc.restart({ force: args.includes('--force'), log: console });
      else if (sub === 'status') {
        const st = await svc.status();
        if (!st.installed) console.log('還沒設定開機啟動（cubbi service install）');
        else console.log(`${st.running ? '✓ 在跑' : '✗ 沒在跑'}（${st.label}${st.pid ? `，pid ${st.pid}` : ''}）\n  版本：${st.version || '—'}　port：${st.port}${st.publicUrl ? `　對外：${st.publicUrl}` : ''}\n  紀錄：${st.logFile}`);
      } else if (sub === 'logs') { const r = svc.logs({ follow: args.includes('-f'), lines: Number(opt('-n')) || 80 }); if (typeof r === 'string') console.log(r); else await new Promise(() => {}); }
      else if (sub === 'uninstall') svc.uninstall({ log: console });
      else { console.log('用法：cubbi service install [--entry <server.js> --cwd <資料夾>] | restart [--force] | status | logs [-f] [-n 80] | uninstall'); process.exit(sub ? 1 : 0); }
    } catch (e) { fail(e); }
    process.exit(0);
  } else if (args[0] === 'setup') {
    const { setupWizard } = await import('../remote/setup/wizard.mjs');
    const r = await setupWizard(args.slice(1)).catch(fail);
    if (!r?.ok) process.exit(1);
    await startUp(r);
  } else if (args[1] === 'login-link') await import('../remote/scripts/login-link.mjs');
  else if (!process.env.SETUP_DONE && process.stdin.isTTY && !process.env.CW_DATA_DIR) {
    // 第一次跑：先帶一遍設定
    const { setupWizard } = await import('../remote/setup/wizard.mjs');
    const r = await setupWizard([]).catch(fail);
    if (!r?.ok) process.exit(1);
    await startUp(r);
  } else await startUp({ wantService: false, open: false });
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

// 唯讀的辦公室（預設）；remote、setup、service、ideas 已經在上面處理了
if (!['remote', 'setup', 'service', 'ideas'].includes(args[0])) {
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
