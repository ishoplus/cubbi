#!/usr/bin/env node
// /cubbi 指令：打開 Cubbi，鏡頭飛到這段對話的小人（認目前資料夾裡最近在動的那段）
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const say = (s) => { console.log(s); process.exit(0); };
// 埠號：複製到 ~/.cubbi 的那份就在旁邊；從外掛（repo 的 server/）跑的時候旁邊沒有，去 ~/.cubbi 找
const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.CUBBI_HOME || (existsSync(join(here, 'port')) ? here : join(homedir(), '.cubbi'));
let port;
try { port = Number(readFileSync(join(home, 'port'), 'utf8')); } catch { say('Cubbi is not running. Start it with: npx cubbi'); }
const cwd = process.argv[2] || process.cwd();
http.get({ host: '127.0.0.1', port, path: '/api/space/find?cwd=' + encodeURIComponent(cwd), timeout: 1500 }, (res) => {
  let s = ''; res.on('data', (d) => { s += d; });
  res.on('end', () => {
    let r = {}; try { r = JSON.parse(s); } catch {}
    const url = `http://127.0.0.1:${port}/` + (r.sid ? `?s=${r.sid}` : '');
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    if (!process.env.CUBBI_NO_OPEN) spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();   // 測試時不真的開瀏覽器
    say(r.name ? `Opened Cubbi: ${r.name} (${url})` : `Opened Cubbi (${url})`);
  });
}).on('error', () => say('Cubbi is not running. Start it with: npx cubbi')).on('timeout', () => say('Cubbi did not answer.'));
