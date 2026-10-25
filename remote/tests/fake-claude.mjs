#!/usr/bin/env node
// 假的 claude：照劇本吐 stream-json，測 shim／hub 不花額度。用 CLAUDE_PATH 指過來。
// 訊息內容決定劇本：
//   ask         → 先要權限（can_use_tool），答了才回
//   slow <ms>   → 分十段慢慢吐，總共 <ms> 毫秒（interrupt 會提早收）
//   child       → 起一個 sleep 子進程（測整棵進程樹有沒有收乾淨），pid 寫進回覆
//   crash       → exit 3
//   commit <檔> → 在 cwd 寫這個檔並 git commit（測分支交付）
//   desk <JSON> → 總務部提出派工（mcp__desk__dispatch，輸入是 JSON），答了把回覆原樣吐回來
// FAKE_ARGS_DIR 有設：把收到的參數寫進 <dir>/<sid>.json（測伺服器帶了哪些參數）
//   其他        → 回聲
import { spawn, execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const argv = process.argv.slice(2);
// 伺服器的認證檢查（claude --print ok）
if (!argv.includes('--input-format')) {
  // 提案部（claude -p … --allowedTools 唯讀工具）：交給會吐提案 JSON 的那個
  if (argv.includes('--allowedTools')) { await import('./fake-claude-ideas.mjs'); process.exit(0); }
  process.stdout.write('ok\n'); process.exit(0);
}
const sid = argv[argv.indexOf('--resume') + 1] && argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1]
  : argv.includes('--session-id') ? argv[argv.indexOf('--session-id') + 1] : randomUUID();
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_ARGS_DIR) writeFileSync(`${process.env.FAKE_ARGS_DIR}/${sid}.json`, JSON.stringify(argv));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let interrupted = false, waitAnswer = null, n = 0;

async function turn(text) {
  interrupted = false;
  out({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), slash_commands: ['fake'] });
  const mid = 'msg_' + (++n);
  if (text === 'crash') process.exit(3);
  if (text === 'ask') {
    out({ type: 'control_request', request_id: 'req-' + n, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } });
    const r = await new Promise(res => { waitAnswer = res; });
    out({ type: 'assistant', session_id: sid, message: { id: mid, role: 'assistant', content: [{ type: 'text', text: 'answer:' + r.behavior }] } });
  } else if (text.startsWith('desk ')) {
    out({ type: 'control_request', request_id: 'req-' + n, request: { subtype: 'can_use_tool', tool_name: 'mcp__desk__dispatch', input: JSON.parse(text.slice(5)) } });
    const r = await new Promise(res => { waitAnswer = res; });
    out({ type: 'assistant', session_id: sid, message: { id: mid, role: 'assistant', content: [{ type: 'text', text: 'dispatch:' + JSON.stringify(r) }] } });
  } else if (text.startsWith('slow')) {
    const ms = parseInt(text.split(' ')[1] || '1000', 10);
    for (let i = 0; i < 10 && !interrupted; i++) {
      out({ type: 'stream_event', session_id: sid, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: String(i) } } });
      out({ type: 'assistant', session_id: sid, message: { id: mid + '-' + i, role: 'assistant', content: [{ type: 'text', text: 'part' + i }] } });
      await sleep(ms / 10);
    }
  } else if (text.startsWith('commit ')) {
    const f = text.slice(7).trim();
    writeFileSync(f, `made by fake ${Date.now()}\n`);
    execFileSync('git', ['add', f]); execFileSync('git', ['commit', '-qm', `加 ${f}`]);
    out({ type: 'assistant', session_id: sid, message: { id: mid, role: 'assistant', content: [{ type: 'text', text: `committed ${f} in ${process.cwd()}` }] } });
  } else if (text === 'child') {
    const c = spawn('sleep', ['300'], { stdio: 'ignore' });
    out({ type: 'assistant', session_id: sid, message: { id: mid, role: 'assistant', content: [{ type: 'text', text: 'child:' + c.pid }] } });
  } else {
    out({ type: 'assistant', session_id: sid, message: { id: mid, role: 'assistant', content: [{ type: 'text', text: 'echo:' + text }] } });
  }
  out({ type: 'result', subtype: interrupted ? 'error_during_execution' : 'success', is_error: interrupted, session_id: sid, duration_ms: 5 });
}

let buf = '', chain = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.type === 'control_request' && m.request?.subtype === 'initialize') { out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } }); continue; }
    if (m.type === 'control_request' && m.request?.subtype === 'interrupt') { interrupted = true; continue; }
    if (m.type === 'control_request') continue;
    if (m.type === 'control_response') { waitAnswer?.(m.response.response); waitAnswer = null; continue; }
    if (m.type === 'user') {
      const c = m.message.content;
      const text = typeof c === 'string' ? c : (c.find(b => b.type === 'text')?.text || '');
      chain = chain.then(() => turn(text));
    }
  }
});
process.stdin.on('end', () => chain.then(() => process.exit(0)));
