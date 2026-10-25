#!/usr/bin/env node
// ── 總務部的兩個工具（MCP stdio）：roster 看名冊、dispatch 提出派工 ─────────────────
//
// 只給總務部那段對話用（frontdesk.js 的 launchOpts 用 --mcp-config 帶進來）。
// 這裡自己不派工：dispatch 被老闆確認時，伺服器已經派好，結果簽名後塞進輸入（_receipt、_sig），
// 這裡驗過簽名就照講；沒簽名＝沒經過老闆，什麼都不做。
//   CUBBI_DESK_URL  伺服器（http://127.0.0.1:<port>）
//   CUBBI_DESK_KEY  名冊的鑰匙兼簽名金鑰
import crypto from 'crypto';
import { createInterface } from 'readline';

const URL_ = process.env.CUBBI_DESK_URL || '';
const KEY = process.env.CUBBI_DESK_KEY || '';
const EN = !!process.env.CUBBI_LANG && !/^zh/i.test(process.env.CUBBI_LANG);
const bi = (zh, en) => (EN ? en : zh);

const TOOLS = [
  {
    name: 'roster',
    description: bi('看名冊：有哪些部門（專案資料夾，含雜務部）、最近的對話（誰在做什麼、狀態）、派工單（派出去的事做到哪了）。派工前先看。',
      'Look at the roster: departments (project folders, including errands), recent conversations (who is doing what, and their status) and dispatch slips (how dispatched work is going). Check it before dispatching.'),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dispatch',
    description: bi('提出派工。老闆一定會先確認（可能改派、改內容或不要派），回傳的是實際結果。',
      'Propose handing a job to someone. The boss always confirms first (and may redirect, edit or decline); the result tells you what actually happened.'),
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['conversation', 'department', 'new_department'],
          description: bi('conversation＝接著一段已有對話；department＝在已有部門開新對話；new_department＝開新部門（新資料夾）',
            'conversation = continue an existing conversation; department = start a new conversation in an existing department; new_department = create a new department (a new folder)') },
        sid: { type: 'string', description: bi('target 是 conversation 時：roster 裡那段對話的 sid', 'For conversation: the sid from roster') },
        department: { type: 'string', description: bi('target 是 department 時：roster 裡部門的 cwd', 'For department: the department cwd from roster') },
        new_name: { type: 'string', description: bi('target 是 new_department 時：新部門的資料夾名', 'For new_department: the folder name') },
        branch: { type: 'boolean', description: bi('在已有部門開分支做（git 專案、會改程式時建議開）', 'Work on its own branch in an existing department (recommended for code changes in a git project)') },
        message: { type: 'string', description: bi('給對方的完整交代：背景、要做什麼、做到哪算完成', 'The full brief for the other side: background, what to do, when it counts as done') },
        reason: { type: 'string', description: bi('一句話：為什麼派給它', 'One sentence: why this target') },
      },
      required: ['target', 'message', 'reason'],
      additionalProperties: false,
    },
  },
];

const text = (s, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) });

async function roster() {
  try {
    const r = await fetch(`${URL_}/api/desk/roster`, { headers: { 'x-desk-key': KEY } });
    if (!r.ok) return text(bi(`名冊拿不到（HTTP ${r.status}）`, `Could not get the roster (HTTP ${r.status})`), true);
    const j = await r.json();
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return !t ? '' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
    const lines = [];
    lines.push(bi('## 部門', '## Departments'));
    for (const d of j.departments || []) lines.push(`- ${d.name}${d.errands ? bi('（雜務）', ' (errands)') : ''}  cwd=${d.cwd}${d.recent ? `  ${bi('最近', 'last')} ${ago(d.recent)}` : ''}`);
    lines.push('', bi('## 對話（新到舊）', '## Conversations (newest first)'));
    for (const c of j.conversations || []) lines.push(`- sid=${c.sid}  [${c.status}]  ${c.dept}  ${c.name ? c.name + ' · ' : ''}${c.title}  (${ago(c.updatedAt)})`);
    lines.push('', bi('## 派工單（新到舊）', '## Dispatch slips (newest first)'));
    if (!(j.dispatches || []).length) lines.push(bi('（還沒有）', '(none yet)'));
    for (const d of j.dispatches || []) lines.push(`- #${d.id} [${d.state}] → ${d.label} (${ago(d.at)}): ${String(d.message).split('\n')[0].slice(0, 80)}${d.lastText ? `\n  ${bi('最後一句', 'last words')}: ${d.lastText.replace(/\s+/g, ' ').slice(-200)}` : ''}`);
    return text(lines.join('\n'));
  } catch (e) {
    return text(bi(`名冊拿不到：${e.message}`, `Could not get the roster: ${e.message}`), true);
  }
}

function dispatch(args) {
  const receipt = typeof args?._receipt === 'string' ? args._receipt : '';
  const sig = typeof args?._sig === 'string' ? args._sig : '';
  const good = receipt && sig.length === 64 && KEY
    && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(crypto.createHmac('sha256', KEY).update(receipt).digest('hex')));
  if (!good) return text(bi('沒有經過老闆確認，沒有派出。', 'Not confirmed by the boss; nothing was dispatched.'), true);
  const r = JSON.parse(receipt);
  const where = r.kind === 'conversation' ? bi(`接著「${r.label}」那段對話`, `continuing the conversation "${r.label}"`)
    : r.kind === 'new' ? bi(`新部門「${r.dept}」`, `the new department "${r.dept}"`)
    : bi(`${r.dept}（新對話）`, `${r.dept} (new conversation)`);
  return text(bi(
    `已派出（派工單 #${r.id}）：交給${where}。${r.edited ? `老闆改過交代，實際送出的是：\n${r.message}` : ''}\n做完會記在派工單上，不用一直追。`,
    `Dispatched (slip #${r.id}) to ${where}.${r.edited ? ` The boss edited the brief; what was actually sent:\n${r.message}` : ''}\nProgress is tracked on the dispatch slip; no need to chase it.`));
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;   // 通知（notifications/initialized 之類）不用回
  try {
    if (method === 'initialize') {
      out({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cubbi-desk', version: '1.0.0' } } });
    } else if (method === 'tools/list') {
      out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const name = params?.name;
      const result = name === 'roster' ? await roster() : name === 'dispatch' ? dispatch(params?.arguments || {}) : text(`unknown tool ${name}`, true);
      out({ jsonrpc: '2.0', id, result });
    } else if (method === 'ping') {
      out({ jsonrpc: '2.0', id, result: {} });
    } else {
      out({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    out({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
});
