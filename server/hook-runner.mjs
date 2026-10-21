#!/usr/bin/env node
// Cubbi 的 Claude Code hook：把事件轉給本機的 Cubbi。
// 原則：快（只挑需要的欄位、0.5 秒內一定結束）、安靜（不印任何東西）、永遠不擋 Claude（任何錯誤都 exit 0）。
// Cubbi 沒開時讀不到埠號或連不上，直接結束。安裝時被複製到 ~/.cubbi/cubbi-hook.mjs（npx cubbi install-hooks）。
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const bye = () => process.exit(0);
setTimeout(bye, 500).unref();
process.on('uncaughtException', bye);

const KEEP = ['hook_event_name', 'session_id', 'cwd', 'transcript_path', 'permission_mode', 'tool_name', 'tool_use_id', 'prompt', 'message', 'notification_type', 'source', 'reason', 'background_tasks'];
let raw = '';
process.stdin.on('data', (d) => { raw += d; if (raw.length > 4 << 20) bye(); });
process.stdin.on('end', () => {
  let e; try { e = JSON.parse(raw); } catch { return bye(); }
  const out = {};
  for (const k of KEEP) if (e[k] !== undefined) out[k] = e[k];
  if (typeof out.prompt === 'string') out.prompt = out.prompt.slice(0, 400);
  if (typeof out.message === 'string') out.message = out.message.slice(0, 400);
  // 工具參數只留看得懂在做什麼的欄位（指令、檔名、網址…），不送整段檔案內容
  if (e.tool_input && typeof e.tool_input === 'object') {
    const t = {};
    for (const k of ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'subagent_type', 'run_in_background']) {
      if (e.tool_input[k] !== undefined) t[k] = typeof e.tool_input[k] === 'string' ? e.tool_input[k].slice(0, 300) : e.tool_input[k];
    }
    out.tool_input = t;
  }
  let port;
  try { port = Number(readFileSync(join(process.env.CUBBI_HOME || dirname(fileURLToPath(import.meta.url)), 'port'), 'utf8')); } catch { return bye(); }
  const body = JSON.stringify(out);
  const req = http.request({ host: '127.0.0.1', port, path: '/api/space/hook', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 400 }, (res) => { res.resume(); res.on('end', bye); });
  req.on('error', bye); req.on('timeout', () => { req.destroy(); bye(); });
  req.end(body);
});
