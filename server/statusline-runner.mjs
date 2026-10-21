#!/usr/bin/env node
// Cubbi 的 Claude Code 狀態列：「🧱 阿方 @ login-page｜辦公室 3 人在忙 · 小工作室」
// 跟 hook 一樣：快、安靜、Cubbi 沒開就什麼都不印（狀態列空著），任何錯誤都 exit 0
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const bye = () => process.exit(0);
setTimeout(bye, 600).unref();
process.on('uncaughtException', bye);
let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let e = {}; try { e = JSON.parse(raw); } catch {}
  let port; try { port = Number(readFileSync(join(process.env.CUBBI_HOME || dirname(fileURLToPath(import.meta.url)), 'port'), 'utf8')); } catch { return bye(); }
  const q = new URLSearchParams({ sid: e.session_id || '', cwd: e.cwd || e.workspace?.current_dir || '' });
  http.get({ host: '127.0.0.1', port, path: '/api/space/statusline?' + q, timeout: 450 }, (res) => {
    let s = ''; res.on('data', (d) => { s += d; });
    res.on('end', () => { try { const t = JSON.parse(s).text; if (t) process.stdout.write(t); } catch {} bye(); });
  }).on('error', bye).on('timeout', bye);
});
