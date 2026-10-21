#!/usr/bin/env node
// npx cubbi [--port 4321] [--no-open]
import { spawn } from 'child_process';
import { startCubbi } from '../server/standalone.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: cubbi [--port 4321] [--no-open]\n\nShows your Claude Code sessions as brick figures in a 3D office.');
  process.exit(0);
}

const port = Number(opt('--port') || process.env.PORT || 4321);
try {
  const { url } = await startCubbi({ port });
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
