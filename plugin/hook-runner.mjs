#!/usr/bin/env node
// Cubbi 的 Claude Code hook：把事件轉給本機的 Cubbi。
// 原則：快（只挑需要的欄位、0.5 秒內一定結束）、安靜（只印下面那段成品格式）、永遠不擋 Claude（任何錯誤都 exit 0）。
// Cubbi 沒開時讀不到埠號或連不上，直接結束。安裝時被複製到 ~/.cubbi/cubbi-hook.mjs（npx cubbi install-hooks）。
// 也是 Claude Code 外掛的 hook（hooks/hooks.json 帶 --plugin）：埠號讀 ~/.cubbi；設定檔裡已經有手動裝的那份就整個讓開，不重複送、不重複印。
// 唯一會印的：SessionStart 時交給 Claude 一段成品格式（deliverable.js 認得的寫法），Cubbi 沒開也照印（之後才開也認得到）。
import { readFileSync, writeSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import http from 'http';

const bye = () => process.exit(0);
setTimeout(bye, 500).unref();
process.on('uncaughtException', bye);

const PLUGIN = process.argv.includes('--plugin');
if (PLUGIN) {
  let s = '';
  try { s = readFileSync(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'), 'utf8'); } catch {}
  if (s.includes('cubbi-hook.mjs')) bye();
}
const HOME = process.env.CUBBI_HOME || (PLUGIN ? join(homedir(), '.cubbi') : dirname(fileURLToPath(import.meta.url)));

// 寫法對應 deliverable.js：回覆裡的絕對路徑／~/ 路徑／完整網址，照出現順序，第一個是主成品
const DELIVERABLE_RULE = 'Cubbi (a local view of your Claude Code sessions) shows the user what each turn produced. '
  + 'When a turn creates or changes something the user should look at (a file, an image or video, a page, a local server, a deployed site), '
  + 'end your final reply with its absolute file path or full URL, e.g. /Users/me/proj/out.png, http://localhost:3000, https://app.example.com. '
  + 'Put the main one first. Skip this for answers that produced nothing.';

const KEEP = ['hook_event_name', 'session_id', 'cwd', 'transcript_path', 'permission_mode', 'tool_name', 'tool_use_id', 'prompt', 'message', 'notification_type', 'source', 'reason', 'background_tasks'];
let raw = '';
process.stdin.on('data', (d) => { raw += d; if (raw.length > 4 << 20) bye(); });
process.stdin.on('end', () => {
  let e; try { e = JSON.parse(raw); } catch { return bye(); }
  if (e.hook_event_name === 'SessionStart') {
    try { writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: DELIVERABLE_RULE } })); } catch {}
  }
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
  try { port = Number(readFileSync(join(HOME, 'port'), 'utf8')); } catch { return bye(); }
  const body = JSON.stringify(out);
  const req = http.request({ host: '127.0.0.1', port, path: '/api/space/hook', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 400 }, (res) => { res.resume(); res.on('end', bye); });
  req.on('error', bye); req.on('timeout', () => { req.destroy(); bye(); });
  req.end(body);
});
