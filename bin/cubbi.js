#!/usr/bin/env node
// npx cubbi [--port 4321] [--no-open]
// npx cubbi install-hooks | uninstall-hooks [--settings <Claude Code 設定檔>]
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DATA = join(homedir(), '.cubbi');
const SETTINGS = opt('--settings') || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');

if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage:
  cubbi [--port 4321] [--no-open]     Open your Claude Code office in the browser
  cubbi install-hooks                 Optional: live updates (raised hands, running commands) via Claude Code hooks
  cubbi uninstall-hooks               Remove only the hooks Cubbi added

Cubbi reads your local Claude Code logs and listens on 127.0.0.1 only. Nothing is uploaded.`);
  process.exit(0);
}

if (args[0] === 'install-hooks') {
  const { installHooks } = await import('../server/hooks.js');
  try {
    const r = await installHooks({ settingsFile: SETTINGS, dataDir: DATA });
    console.log(r.added.length ? `Added Cubbi hooks to ${SETTINGS} (${r.added.join(', ')}).` : `Cubbi hooks are already installed in ${SETTINGS}.`);
    if (r.backup) console.log(`Backup of your original settings: ${r.backup}`);
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

const { startCubbi } = await import('../server/standalone.js');
const port = Number(opt('--port') || process.env.PORT || 4321);
try {
  const { url } = await startCubbi({ port, dataDir: DATA });
  console.log(`Cubbi is open at ${url}  (Ctrl+C to stop)`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Try: cubbi --port ${port + 1}` : e.message);
  process.exit(1);
}
