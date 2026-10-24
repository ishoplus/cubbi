#!/usr/bin/env node
// 假的 codex app-server：照劇本演 JSON-RPC，測 Codex Driver 不花額度。用 CODEX_PATH 指過來。
// FAKE_CODEX_LOG=<檔>：收到的請求（method＋params）一行一個記下來，測試拿來檢查核准／沙箱／指示有沒有帶對。
// 訊息內容決定劇本：
//   cmd        → 要跑 ls，先送核准請求；准了才跑
//   edit       → 要改 a.txt，先送改檔核准
//   ask        → 選擇題（item/tool/requestUserInput）
//   slow <ms>  → 分十段慢慢吐（turn/interrupt 會提早收）
//   crash      → exit 3
//   其他       → 逐字回聲
import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';

if (process.argv[2] !== 'app-server') { console.log('fake codex'); process.exit(0); }
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const note = (o) => { if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(o) + '\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let threadId = null, turnId = null, interrupted = false, srvId = 1000;
const waiting = new Map();   // 我送出的請求 id → resolve

function ask(method, params) {
  const id = ++srvId;
  out({ id, method, params: { threadId, turnId, ...params } });
  return new Promise(r => waiting.set(id, r));
}
const n = (method, params) => out({ method, params: { threadId, ...params } });
const item = (kind, it) => n(kind, { turnId, item: it });

async function say(text) {
  const id = 'msg_' + randomUUID().slice(0, 8);
  item('item/started', { type: 'agentMessage', id, text: '', phase: null });
  for (const ch of [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]) n('item/agentMessage/delta', { turnId, itemId: id, delta: ch });
  item('item/completed', { type: 'agentMessage', id, text, phase: null });
}

async function turn(text) {
  turnId = 'turn_' + randomUUID().slice(0, 8);
  interrupted = false;
  n('turn/started', { turn: { id: turnId, status: 'inProgress' } });
  if (text === 'crash') process.exit(3);
  if (text === 'cmd') {
    const it = { type: 'commandExecution', id: 'cmd_1', command: 'ls', cwd: process.cwd(), status: 'inProgress', aggregatedOutput: null, exitCode: null };
    item('item/started', it);
    const r = await ask('item/commandExecution/requestApproval', { itemId: 'cmd_1', command: 'ls', cwd: process.cwd(), reason: '要列出檔案' });
    const ok = r.result?.decision === 'accept' || r.result?.decision === 'acceptForSession';
    item('item/completed', { ...it, status: ok ? 'completed' : 'declined', aggregatedOutput: ok ? 'file-a\nfile-b\n' : '', exitCode: ok ? 0 : null });
    await say('cmd:' + r.result?.decision);
  } else if (text === 'edit') {
    const it = { type: 'fileChange', id: 'fc_1', status: 'inProgress', changes: [{ path: 'a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' }] };
    item('item/started', it);
    const r = await ask('item/fileChange/requestApproval', { itemId: 'fc_1', reason: null });
    item('item/completed', { ...it, status: r.result?.decision === 'decline' ? 'declined' : 'completed' });
    await say('edit:' + r.result?.decision);
  } else if (text === 'ask') {
    const r = await ask('item/tool/requestUserInput', { itemId: 'q_1', questions: [{ id: 'q1', header: '選', question: '選哪個？', isOther: false, options: [{ label: 'A', description: '甲' }, { label: 'B', description: '乙' }] }] });
    await say(r.error ? 'ask:declined' : 'picked:' + r.result.answers.q1.answers[0]);
  } else if (text.startsWith('slow')) {
    const ms = parseInt(text.split(' ')[1] || '1000', 10);
    for (let i = 0; i < 10 && !interrupted; i++) { await say('part' + i); await sleep(ms / 10); }
  } else {
    item('item/completed', { type: 'reasoning', id: 'rs_1', summary: ['想一下'], content: [] });
    await say('echo:' + text);
  }
  n('thread/tokenUsage/updated', { turnId, tokenUsage: { last: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 0 } } });
  n('turn/completed', { turn: { id: turnId, status: interrupted ? 'interrupted' : 'completed' } });
  turnId = null;
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
    if (m.method) note({ method: m.method, params: m.params });
    if (m.id != null && !m.method) { waiting.get(m.id)?.(m); waiting.delete(m.id); continue; }   // 我請求的回覆
    const reply = (result) => out({ id: m.id, result });
    switch (m.method) {
      case 'initialize': reply({ userAgent: 'fake-codex' }); break;
      case 'initialized': break;
      case 'thread/start': threadId = randomUUID(); reply({ thread: { id: threadId, cwd: m.params.cwd }, model: 'fake-model' }); break;
      case 'thread/resume': threadId = m.params.threadId; reply({ thread: { id: threadId, cwd: process.cwd() }, model: 'fake-model' }); break;
      case 'turn/start': {
        const text = m.params.input.filter(x => x.type === 'text').map(x => x.text).join('');
        reply({ turn: { id: 'pending' } });
        chain = chain.then(() => turn(text));
        break;
      }
      case 'turn/steer': reply({}); chain = chain.then(() => say('steered:' + m.params.input.map(x => x.text).join(''))); break;
      case 'turn/interrupt': interrupted = true; reply({}); break;
      default: out({ id: m.id, error: { code: -32601, message: 'fake: ' + m.method } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
