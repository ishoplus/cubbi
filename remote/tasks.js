// ── 任務列表管理 ──────────────────────────────────────────────────────────────
//
// 跟 /api/claude 的聊天 session 最大的差別：任務是「無人看管」的。
//   1. 不綁前端連線 —— 瀏覽器關掉、手機鎖屏，進程照跑，事件寫進 events.jsonl。
//   2. 權限自動決策 —— 讀寫自家目錄直接放行，危險操作（刪除、push、出網）才停下來
//      把任務標成 awaiting_permission 等人在面板上拍板。
//   3. 跑完自動進評審 —— 另開一個唯讀的 Claude session 當驗收人員，拿目標和標準
//      去實際檢查產出，回 pass/fail；fail 或選人工確認時交還給人決定。
//
// 狀態機：
//   idle ─start→ queued ─(有名額)→ running ⇄ awaiting_permission
//                                    │
//                                    ├─(評審=ai)→ reviewing ─pass→ done
//                                    │                      └─fail→ awaiting_review
//                                    ├─(評審=manual)───────────────→ awaiting_review
//                                    └─(評審=none)─────────────────→ done
//   awaiting_review ─approve→ done ／ ─reject(附意見)→ queued（--resume 續修）
//   任何狀態 ─stop→ stopped；伺服器重啟時在跑的 → interrupted（可 resume）

import express from 'express';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream, appendFileSync } from 'fs';
import { readFile, writeFile, mkdir, rm, stat, rename } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  WORK_ROOT, claudePath, claudeEnv, killTree, friendlyClaudeError, isInsideRoot, isInsideDir,
} from './shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(process.env.TASK_DATA_DIR || join(__dirname, 'data'));
const STORE_FILE = join(DATA_DIR, 'tasks.json');
const RUNS_DIR = join(DATA_DIR, 'runs');

const MAX_TASK_CONCURRENT = parseInt(process.env.MAX_TASK_CONCURRENT || '2', 10);
// 評審沒過時自己再修幾輪才叫人。沒有上限的迴圈會無止境燒錢，這是唯一的煞車。
const MAX_AUTO_RETRY = parseInt(process.env.MAX_AUTO_RETRY || '3', 10);
const TASK_IDLE_TIMEOUT_MS = parseInt(process.env.TASK_IDLE_TIMEOUT_MS || '3600000', 10);   // 1h 沒動靜
const TASK_ASK_TIMEOUT_MS = parseInt(process.env.TASK_ASK_TIMEOUT_MS || '86400000', 10);    // 24h 沒人回答
const TASK_EXIT_GRACE_MS = parseInt(process.env.TASK_EXIT_GRACE_MS || '10000', 10);
const REPLAY_TAIL_BYTES = 512 * 1024; // 開啟詳情時回放的日誌長度上限

const ACTIVE = new Set(['queued', 'running', 'awaiting_permission', 'reviewing']);
const TERMINAL = new Set(['done', 'failed', 'stopped']);

// ── 權限政策 ──────────────────────────────────────────────────────────────────

// 只讀 / 純本地記事，放行沒有風險
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'BashOutput', 'ExitPlanMode', 'Task',
]);
// 會改檔案：限制在任務目錄內才自動放行
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Bash 指令的紅線。寧可誤攔（跳出來問一下）也不要漏放。
const DANGEROUS_BASH = [
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/, '遞迴／強制刪除檔案'],
  [/\bsudo\b/, 'sudo 提權'],
  [/\bgit\s+push\b/, 'git push 推送到遠端'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard 丟棄變更'],
  [/\bgit\s+clean\b/, 'git clean 清除未追蹤檔案'],
  [/\b(npm|yarn|pnpm)\s+publish\b/, '發佈套件'],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, '下載內容後直接執行'],
  [/\bmkfs\b|\bdd\s+if=/, '磁碟層級操作'],
  [/\b(shutdown|reboot|halt)\b/, '系統電源操作'],
  [/\b(ssh|scp|rsync)\s/, '連線或傳輸到遠端主機'],
  [/\bchmod\s+(-R\s+)?777\b/, '把權限放到最寬'],
  [/\b(killall|pkill)\b/, '批次終止進程'],
  [/>\s*\/(dev|etc|usr|bin|sbin|System|Library)\//, '寫入系統路徑'],
  [/\b(launchctl|crontab|systemctl)\b/, '修改系統服務／排程'],
  [/\bgh\s+(pr|release|repo)\s+(create|merge|delete|edit)/, '操作 GitHub 遠端資源'],
];

function dangerousBash(cmd) {
  for (const [re, why] of DANGEROUS_BASH) if (re.test(cmd || '')) return why;
  return null;
}

// 回 { action: 'allow' | 'ask' | 'deny', why }
function classify(task, ask, phase) {
  const tool = ask.toolName || '';

  // AskUserQuestion 之類「要你選答案」的，本質上沒有安全的預設值，一律交給人
  if (ask.requiresUserInteraction) return { action: 'ask', why: 'Claude 需要你做選擇' };

  // 評審階段是驗收人員，只准看不准改；違規直接擋掉而不是煩使用者
  if (phase === 'review') {
    if (SAFE_TOOLS.has(tool)) return { action: 'allow' };
    if (tool === 'Bash') {
      const d = dangerousBash(ask.input?.command);
      return d ? { action: 'deny', why: `評審階段禁止：${d}` } : { action: 'allow' };
    }
    return { action: 'deny', why: '評審階段不得修改檔案或存取外部資源' };
  }

  if (task.alwaysAllow?.includes(tool)) return { action: 'allow' };
  if (SAFE_TOOLS.has(tool)) return { action: 'allow' };

  if (WRITE_TOOLS.has(tool)) {
    const p = ask.input?.file_path || ask.input?.notebook_path || ask.input?.path;
    if (p && !isInsideDir(task.cwd, p)) return { action: 'ask', why: `要寫入任務目錄外的檔案：${p}` };
    return { action: 'allow' };
  }

  if (tool === 'Bash') {
    const d = dangerousBash(ask.input?.command);
    return d ? { action: 'ask', why: d } : { action: 'allow' };
  }

  if (tool === 'WebFetch' || tool === 'WebSearch') return { action: 'ask', why: '要存取網路' };

  return { action: 'ask', why: `未知工具 ${tool}，預設交由你判斷` };
}

// ── Store ─────────────────────────────────────────────────────────────────────

const tasks = new Map();     // id -> 任務（可持久化的部分）
const runtimes = new Map();  // id -> { proc, send, phase, ... } 純記憶體
const listeners = new Map(); // id -> Set<res>，詳情頁的 SSE 連線

let writeQueue = Promise.resolve();
let writeTimer = null;

function persist() {
  // 合併短時間內的多次變更：跑一個任務每秒可能改好幾次進度
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeQueue = writeQueue.then(async () => {
      const arr = [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const tmp = STORE_FILE + '.tmp';
      await writeFile(tmp, JSON.stringify(arr, null, 2));
      await rename(tmp, STORE_FILE); // 原子換檔：中途斷電也不會留下半截的 tasks.json
    }).catch(e => console.error('[tasks] 寫入失敗:', e.message));
  }, 300);
}

export async function initTasks() {
  await mkdir(RUNS_DIR, { recursive: true });
  try {
    const raw = await readFile(STORE_FILE, 'utf-8');
    for (const t of JSON.parse(raw)) tasks.set(t.id, t);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[tasks] 讀取 tasks.json 失敗:', e.message);
  }

  // 上次關機時還在跑的，進程早就沒了。標成 interrupted，讓人決定要不要續跑。
  let n = 0;
  for (const t of tasks.values()) {
    if (ACTIVE.has(t.status)) {
      t.status = 'interrupted';
      t.pendingAsk = null;
      t.note = '伺服器重啟時中斷';
      t.updatedAt = new Date().toISOString();
      n++;
    }
  }
  if (n) { console.log(`[tasks] ${n} 個任務因重啟中斷，可在面板續跑`); persist(); }
  console.log(`[tasks] 載入 ${tasks.size} 個任務（同時執行上限 ${MAX_TASK_CONCURRENT}）`);
}

function touch(task, patch = {}) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  persist();
  broadcast(task.id, { type: 'task', task: publicTask(task) });
}

function publicTask(t) {
  return { ...t, active: ACTIVE.has(t.status), running: runtimes.has(t.id) };
}

// ── 事件日誌與廣播 ────────────────────────────────────────────────────────────

function runDir(id) { return join(RUNS_DIR, id); }
function logFile(id) { return join(runDir(id), 'events.jsonl'); }

function broadcast(id, obj) {
  const set = listeners.get(id);
  if (!set) return;
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of set) { try { res.write(line); } catch { set.delete(res); } }
}

// 記錄 + 推播。ts 由這裡補，前端才有統一的時間軸。
function log(task, ev) {
  const rec = { ts: Date.now(), ...ev };
  const line = JSON.stringify(rec) + '\n';
  const rt = runtimes.get(task.id);
  // 排隊、驗收指令、狀態變更都發生在兩個 runtime 之間，那時沒有 logStream。
  // 少了這個 fallback，這些事件只會即時推給畫面，重整就消失。
  if (rt?.logStream) { try { rt.logStream.write(line); } catch {} }
  else { try { appendFileSync(logFile(task.id), line); } catch {} }
  broadcast(task.id, { type: 'event', data: rec });
}

// ── 執行 ──────────────────────────────────────────────────────────────────────

function workPrompt(task, feedback) {
  if (feedback) {
    return [
      '驗收沒有通過，以下是需要修正的地方：',
      '',
      feedback,
      '',
      '請針對上述問題繼續修正，完成後同樣簡短條列回報你做了什麼。',
    ].join('\n');
  }
  return [
    `# 專案任務：${task.name}`,
    `工作目錄：${task.cwd}`,
    '',
    '## 目標',
    task.goal,
    '',
    '## 驗收標準',
    task.reviewCriteria?.trim() || '（未特別指定，請依目標自行判斷合理的完成標準）',
    '',
    '請自主完成上述目標。這是無人看管的背景任務，過程中不要向我提問；',
    '遇到不確定的地方採用合理的預設做法，並在最後說明你做了哪些假設。',
    '完成後用簡短條列回報：做了什麼、改動了哪些檔案、還有什麼沒做完。',
  ].join('\n');
}

function reviewPrompt(task) {
  return [
    '你是獨立的驗收人員，不是這次工作的執行者。請保持懷疑的態度。',
    `工作目錄：${task.cwd}`,
    '',
    '## 原始目標',
    task.goal,
    '',
    '## 驗收標準',
    task.reviewCriteria?.trim() || '（未特別指定，請依目標自行判斷）',
    '',
    ...(task.verifyCmd ? [
      '## 驗收指令的結果',
      `\`${task.verifyCmd}\` 已經跑過，exit 0（通過）。輸出尾段：`,
      task.verifyOut || '（沒有輸出）',
      '指令綠燈只代表沒有明顯錯誤。請特別查有沒有「為了讓指令通過而做的假動作」：',
      '空殼測試、被 skip 掉的測試、寫死的預期值、被註解掉的斷言、只測 happy path。',
      '',
    ] : []),
    '## 執行者的最終回報',
    (task.progress?.lastText || '（沒有回報內容）').slice(0, 4000),
    '',
    '請**實際打開目錄裡的產出來檢查**（讀檔案、必要時執行唯讀指令），',
    '不要只相信上面的回報。你只有唯讀權限，不要嘗試修改任何檔案。',
    '',
    '檢查完，最後一行只輸出一個 JSON，不要用程式碼區塊包起來：',
    '{"verdict":"pass"|"fail","summary":"一兩句總結","issues":["具體問題1","具體問題2"]}',
  ].join('\n');
}

// 把評審結論攤成給執行者看的修正清單
function reviewFeedback(review, extra) {
  const issues = (review?.issues || []).map(s => `- ${s}`).join('\n');
  return [extra?.trim(), review?.summary, issues && `評審列出的問題：\n${issues}`]
    .filter(Boolean).join('\n\n') || '驗收未通過，請重新檢查目標是否真的達成。';
}

function parseVerdict(text) {
  const blocks = [...(text || '').matchAll(/\{[^{}]*"verdict"[\s\S]*?\}/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(blocks[i][0]);
      if (o.verdict === 'pass' || o.verdict === 'fail') {
        return { verdict: o.verdict, summary: String(o.summary || ''), issues: Array.isArray(o.issues) ? o.issues.map(String) : [] };
      }
    } catch { /* 下一個 */ }
  }
  return null;
}

function launch(task, { phase, feedback = null }) {
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-prompt-tool', 'stdio',
  ];
  if (task.model) args.push('--model', task.model);

  // 續修同一個工作 session 才接得上前面的上下文；評審每次都開新的（要中立）
  const resumeId = phase === 'work' && (feedback || task.resumeNext) ? task.sessionId : null;
  if (resumeId) args.push('--resume', resumeId);

  const prompt = phase === 'review' ? reviewPrompt(task) : workPrompt(task, feedback);

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: task.cwd,
      env: claudeEnv(),
      detached: true,
    });
  } catch (e) {
    finish(task, 'failed', { error: `無法啟動 Claude：${e.message}` });
    return;
  }

  const rt = {
    proc, phase, stdoutBuf: '', sawResult: false, lastActivity: Date.now(),
    resultText: '', closed: false, ending: false,
    logStream: createWriteStream(logFile(task.id), { flags: 'a' }),
  };
  rt.logStream.on('error', e => console.error(`[task ${task.id}] 日誌寫入失敗: ${e.message}`));
  runtimes.set(task.id, rt);

  rt.send = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
  rt.send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });
  rt.send({ type: 'user', message: { role: 'user', content: prompt } });

  task.resumeNext = false;
  touch(task, {
    status: phase === 'review' ? 'reviewing' : 'running',
    phase,
    startedAt: task.startedAt || new Date().toISOString(),
    finishedAt: null,
    error: null,
    note: null,
    pendingAsk: null,
  });
  log(task, { kind: 'phase', phase, text: phase === 'review' ? '開始 AI 評審' : (feedback ? `第 ${task.attempts + 1} 輪：依評審意見續修` : '開始執行') });

  rt.watchdog = setInterval(() => {
    const idle = Date.now() - rt.lastActivity;
    const waiting = !!task.pendingAsk;
    if (idle <= (waiting ? TASK_ASK_TIMEOUT_MS : TASK_IDLE_TIMEOUT_MS)) return;
    log(task, { kind: 'error', text: waiting ? '等待授權逾時，已中止' : '長時間沒有輸出，已中止' });
    stopRuntime(task);
    finish(task, 'failed', { error: waiting ? '等待授權逾時' : '執行逾時（長時間沒有輸出）' });
  }, 30000);

  proc.stdout.on('data', chunk => {
    rt.lastActivity = Date.now();
    rt.stdoutBuf += chunk.toString();
    const lines = rt.stdoutBuf.split('\n');
    rt.stdoutBuf = lines.pop();
    for (const line of lines) handleLine(task, rt, line);
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    console.error(`[task ${task.id} stderr] ${text.trim()}`);
    log(task, { kind: 'error', text: friendlyClaudeError(text) || text.trim() });
  });

  proc.on('close', code => {
    if (rt.stdoutBuf.trim()) handleLine(task, rt, rt.stdoutBuf);
    clearInterval(rt.watchdog);
    clearTimeout(rt.exitGuard);
    rt.closed = true;
    if (rt.logStream) rt.logStream.end();
    runtimes.delete(task.id);
    console.log(`[task ${task.id}] ${phase} 結束 code=${code}`);

    if (TERMINAL.has(task.status) || task.status === 'awaiting_review') { pump(); return; }
    if (!rt.sawResult) {
      finish(task, 'failed', { error: `Claude 異常退出（代碼 ${code}）` });
      return;
    }
    pump();
  });

  proc.on('error', e => {
    clearInterval(rt.watchdog);
    rt.closed = true;
    runtimes.delete(task.id);
    const hint = e.code === 'ENOENT' ? `找不到 claude 指令（${claudePath}），請設定 CLAUDE_PATH` : e.message;
    log(task, { kind: 'error', text: hint });
    finish(task, 'failed', { error: hint });
  });
}

function handleLine(task, rt, line) {
  if (!line?.trim()) return;
  let p;
  try { p = JSON.parse(line); } catch { log(task, { kind: 'text', text: line }); return; }

  if (p.session_id) {
    if (rt.phase === 'review') task.reviewSessionId = p.session_id;
    else if (task.sessionId !== p.session_id) task.sessionId = p.session_id;
  }

  // 需要拍板：先跑政策，能自動決定就自動決定，不能才停下來等人
  if (p.type === 'control_request' && p.request?.subtype === 'can_use_tool') {
    const r = p.request;
    const ask = {
      requestId: p.request_id,
      toolName: r.tool_name,
      displayName: r.display_name || r.tool_name,
      input: r.input,
      requiresUserInteraction: !!r.requires_user_interaction,
      suggestions: r.permission_suggestions || [],
      phase: rt.phase,
    };
    const { action, why } = classify(task, ask, rt.phase);

    if (action === 'allow') {
      answer(task, rt, p.request_id, { behavior: 'allow', updatedInput: r.input });
      return;
    }
    if (action === 'deny') {
      log(task, { kind: 'auto-deny', tool: ask.toolName, text: why });
      answer(task, rt, p.request_id, { behavior: 'deny', message: why });
      return;
    }
    ask.why = why;
    log(task, { kind: 'ask', tool: ask.toolName, text: why, input: summarizeInput(ask) });
    touch(task, { status: 'awaiting_permission', pendingAsk: ask });
    return;
  }

  if (p.type === 'control_response' || p.type === 'control_cancel_request') return;

  if (p.type === 'assistant') {
    const blocks = p.message?.content || [];
    let text = '';
    for (const b of blocks) {
      if (b.type === 'text') text += b.text;
      else if (b.type === 'tool_use') {
        bumpProgress(task, { tools: 1, lastTool: b.name });
        log(task, { kind: 'tool', tool: b.name, text: summarizeInput({ toolName: b.name, input: b.input }) });
      }
    }
    if (text.trim()) {
      if (rt.phase === 'review') rt.resultText += text;
      else bumpProgress(task, { lastText: text.trim() });
      log(task, { kind: 'text', phase: rt.phase, text: text.trim() });
    }
    return;
  }

  if (p.type === 'result') {
    rt.sawResult = true;
    const text = typeof p.result === 'string' ? p.result : '';
    if (text) rt.resultText += (rt.resultText ? '\n' : '') + text;
    bumpProgress(task, {
      turns: p.num_turns || task.progress.turns,
      costUsd: (task.progress.costUsd || 0) + (p.total_cost_usd || 0),
      durationMs: (task.progress.durationMs || 0) + (p.duration_ms || 0),
    });
    log(task, { kind: 'result', text, isError: !!p.is_error, costUsd: p.total_cost_usd, turns: p.num_turns });
    endTurn(task, rt);
    onPhaseDone(task, rt, p);
    return;
  }

  if (p.type === 'user') return; // tool_result 回填，日誌裡意義不大
  log(task, { kind: 'raw', text: p.type });
}

function summarizeInput(ask) {
  const i = ask.input || {};
  if (ask.toolName === 'Bash') return String(i.command || '').slice(0, 300);
  const p = i.file_path || i.path || i.notebook_path || i.pattern || i.url || i.query;
  return p ? String(p).slice(0, 300) : '';
}

function bumpProgress(task, patch) {
  const pr = task.progress || (task.progress = { tools: 0, turns: 0, costUsd: 0, durationMs: 0 });
  if (patch.tools) pr.tools = (pr.tools || 0) + patch.tools;
  if (patch.lastTool) pr.lastTool = patch.lastTool;
  if (patch.lastText) pr.lastText = patch.lastText;
  if (patch.turns != null) pr.turns = patch.turns;
  if (patch.costUsd != null) pr.costUsd = patch.costUsd;
  if (patch.durationMs != null) pr.durationMs = patch.durationMs;
  pr.updatedAt = new Date().toISOString();
  touch(task, {});
}

// 關掉 stdin 讓 claude 收工；沒退就補一刀，免得進程佔著名額
function endTurn(task, rt) {
  if (rt.ending || rt.closed) return;
  rt.ending = true;
  try { rt.proc.stdin.end(); } catch {}
  rt.exitGuard = setTimeout(() => {
    if (rt.closed) return;
    console.warn(`[task ${task.id}] result 後沒退出，強制收掉`);
    killTree(rt.proc, 'SIGKILL');
  }, TASK_EXIT_GRACE_MS);
}

// ── 驗收指令：確定性的硬閘門 ──────────────────────────────────────────────────
//
// 自然語言的驗收標準是「軟判定」：模型讀完檔案自己判斷，可能被漂亮的回報說服。
// 驗收指令是「硬判定」：npm test 的 exit code 不會講人情。兩層疊起來——
// 硬閘門擋明確的錯誤，軟判定再去抓「為了讓指令過而做的假動作」。

const VERIFY_TIMEOUT_MS = parseInt(process.env.TASK_VERIFY_TIMEOUT_MS || '600000', 10);
const VERIFY_OUT_LIMIT = 200 * 1024;

function runVerifyCmd(task) {
  return new Promise(ok => {
    let proc;
    try {
      proc = spawn('/bin/sh', ['-c', task.verifyCmd], { cwd: task.cwd, env: { ...process.env }, detached: true });
    } catch (e) { return ok({ code: -1, out: '', note: `無法執行：${e.message}` }); }

    let out = '', settled = false;
    const done = (code, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ok({ code, out, note });
    };
    const timer = setTimeout(() => { killTree(proc, 'SIGKILL'); done(124, '執行逾時'); }, VERIFY_TIMEOUT_MS);
    const grab = c => { if (out.length < VERIFY_OUT_LIMIT) out += c; };

    proc.stdout.on('data', grab);
    proc.stderr.on('data', grab);
    proc.on('error', e => done(-1, e.message));
    proc.on('close', code => done(code ?? -1, null));
  });
}

// 評審階段的入口：有驗收指令就先過硬閘門，過了才輪到 AI（或人）判斷
async function startReview(task) {
  if (!task.verifyCmd) { launch(task, { phase: 'review' }); return; }

  const bad = dangerousBash(task.verifyCmd);
  if (bad) {   // 建任務時就擋掉了，這裡是保險
    finish(task, 'failed', { error: `驗收指令含有危險操作（${bad}），已中止` });
    return;
  }

  touch(task, { status: 'reviewing', phase: 'review' });
  log(task, { kind: 'phase', phase: 'review', text: `執行驗收指令：${task.verifyCmd}` });

  const r = await runVerifyCmd(task);
  if (!tasks.has(task.id) || task.status === 'stopped') return;   // 跑指令的期間被停掉／刪掉

  const tail = r.out.trim().split('\n').slice(-25).join('\n').slice(-3000);
  log(task, { kind: 'verify', ok: r.code === 0, text: `驗收指令 exit ${r.code}${r.note ? `（${r.note}）` : ''}`, out: tail });

  if (r.code !== 0) {
    // 指令自己會說話，不必再花一次 Claude 去判斷
    settleReview(task, {
      verdict: 'fail',
      summary: `驗收指令未通過：\`${task.verifyCmd}\` exit ${r.code}${r.note ? `（${r.note}）` : ''}`,
      issues: [tail || '（指令沒有輸出）'],
      gate: 'command',
    });
    return;
  }

  task.verifyOut = tail;
  if (task.reviewMode === 'ai') { launch(task, { phase: 'review' }); return; }
  finish(task, 'awaiting_review', { note: '驗收指令已通過，等待你驗收' });
}

// 評審有了結論之後怎麼收——硬閘門和 AI 評審共用同一條路
function settleReview(task, parsed) {
  task.review = { ...parsed, at: new Date().toISOString() };
  if (parsed.verdict === 'pass') { finish(task, 'done', { note: parsed.summary }); return; }

  // 沒過就把意見原樣丟回去續修，修到過為止——但只修 MAX_AUTO_RETRY 輪。
  // 人按「打回」會把額度歸零，因為那是人看過之後才決定要再試的。
  const used = task.autoRetries || 0;
  if (used < MAX_AUTO_RETRY) {
    task.autoRetries = used + 1;
    log(task, { kind: 'status', text: `${parsed.gate === 'command' ? '驗收指令' : '評審'}未通過，自動續修（第 ${task.autoRetries}/${MAX_AUTO_RETRY} 輪）` });
    enqueue(task, { feedback: reviewFeedback(parsed), resume: true });
    return;
  }
  finish(task, 'awaiting_review', { note: `自動續修 ${MAX_AUTO_RETRY} 輪仍未通過，請你決定要收下還是再修` });
}

function onPhaseDone(task, rt, result) {
  if (rt.phase === 'review') {
    const parsed = parseVerdict(rt.resultText);
    if (!parsed) {
      // 評審沒吐出可解析的結論：不要假裝通過，交給人看原文決定
      task.review = { verdict: 'unknown', summary: (rt.resultText || '').slice(-1500) || '評審沒有產出結論', issues: [], at: new Date().toISOString() };
      finish(task, 'awaiting_review', { note: 'AI 評審沒有給出可解析的結論，請人工確認' });
      return;
    }
    settleReview(task, parsed);
    return;
  }

  // 工作階段結束
  task.attempts = (task.attempts || 0) + 1;
  if (result?.is_error) {
    finish(task, 'failed', { error: (typeof result.result === 'string' ? result.result : '').slice(0, 500) || 'Claude 回報執行失敗' });
    return;
  }
  // 有驗收指令的話，就算是人工驗收也先讓指令跑一遍——客觀的結果對人也有用
  if (task.reviewMode === 'ai' || (task.verifyCmd && task.reviewMode === 'manual')) {
    // 進程要先退乾淨再開評審，否則兩個 claude 會同時掛在同一個目錄
    rt.nextPhase = 'review';
    scheduleNext(task);
    return;
  }
  if (task.reviewMode === 'manual') { finish(task, 'awaiting_review', { note: '等待你驗收' }); return; }
  finish(task, 'done', { note: '已完成（未設定評審）' });
}

// 等目前的進程真的關掉，再接著跑下一階段
function scheduleNext(task) {
  const rt = runtimes.get(task.id);
  if (!rt || rt.closed) { startReview(task); return; }
  rt.proc.once('close', () => setTimeout(() => {
    if (tasks.has(task.id) && !TERMINAL.has(task.status)) startReview(task);
  }, 100));
}

function finish(task, status, extra = {}) {
  touch(task, {
    status,
    pendingAsk: null,
    finishedAt: TERMINAL.has(status) ? new Date().toISOString() : null,
    ...extra,
  });
  log(task, { kind: 'status', text: status + (extra.note ? ` — ${extra.note}` : '') + (extra.error ? ` — ${extra.error}` : '') });
  pump();
}

function answer(task, rt, requestId, response) {
  rt.lastActivity = Date.now();
  rt.send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
}

function stopRuntime(task) {
  const rt = runtimes.get(task.id);
  if (!rt) return;
  clearInterval(rt.watchdog);
  clearTimeout(rt.exitGuard);
  rt.closed = true;
  if (rt.logStream) rt.logStream.end();
  runtimes.delete(task.id);
  killTree(rt.proc, 'SIGKILL');
}

// ── 排隊 ──────────────────────────────────────────────────────────────────────

// awaiting_permission 也算佔用：進程還在，只是停著等人
function slotsUsed() { return runtimes.size; }

function pump() {
  if (slotsUsed() >= MAX_TASK_CONCURRENT) return;
  const waiting = [...tasks.values()]
    .filter(t => t.status === 'queued' && !runtimes.has(t.id))
    .sort((a, b) => (a.queuedAt || '').localeCompare(b.queuedAt || ''));
  for (const t of waiting) {
    if (slotsUsed() >= MAX_TASK_CONCURRENT) break;
    launch(t, { phase: 'work', feedback: t.pendingFeedback || null });
    t.pendingFeedback = null;
  }
}

function enqueue(task, { feedback = null, resume = false } = {}) {
  task.queuedAt = new Date().toISOString();
  task.pendingFeedback = feedback;
  task.resumeNext = resume;
  touch(task, { status: 'queued', error: null, note: feedback ? '已排隊：依評審意見續修' : '已排隊' });
  log(task, { kind: 'status', text: '已排隊等待執行' });
  pump();
}

// ── 讀取歷史日誌（開詳情頁時回放）────────────────────────────────────────────

async function tailLog(id) {
  try {
    const f = logFile(id);
    const s = await stat(f);
    const start = Math.max(0, s.size - REPLAY_TAIL_BYTES);
    const chunks = [];
    for await (const c of createReadStream(f, { start })) chunks.push(c);
    let text = Buffer.concat(chunks).toString('utf-8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // 丟掉被切半的第一行
    return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const tasksRouter = express.Router();

tasksRouter.get('/', (req, res) => {
  const list = [...tasks.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(publicTask);
  res.json({ tasks: list, maxConcurrent: MAX_TASK_CONCURRENT, maxAutoRetry: MAX_AUTO_RETRY, running: slotsUsed() });
});

tasksRouter.post('/', async (req, res) => {
  const { name, cwd, goal, reviewMode = 'ai', reviewCriteria = '', verifyCmd = '', model = '', autoStart = true } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '請填項目名稱' });
  if (!goal?.trim()) return res.status(400).json({ error: '請填項目目標' });
  if (!['ai', 'manual', 'none'].includes(reviewMode)) return res.status(400).json({ error: '評審方式無效' });

  // 驗收指令是拿來「檢查」的，會改東西或出網的一律不收
  const cmd = String(verifyCmd || '').trim();
  const bad = cmd && dangerousBash(cmd);
  if (bad) return res.status(400).json({ error: `驗收指令不能含有危險操作（${bad}）` });

  const dir = resolve(cwd || WORK_ROOT);
  if (!isInsideRoot(dir)) return res.status(403).json({ error: '目錄不在允許範圍內' });
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return res.status(400).json({ error: '選定的路徑不是目錄' });
  } catch { return res.status(400).json({ error: '目錄不存在' }); }

  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    name: name.trim(), cwd: dir, goal: goal.trim(),
    reviewMode, reviewCriteria: String(reviewCriteria || '').trim(), verifyCmd: cmd, verifyOut: null,
    model: model || '',
    status: 'idle', phase: null,
    createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, queuedAt: null,
    sessionId: null, reviewSessionId: null,
    attempts: 0, autoRetries: 0,
    progress: { tools: 0, turns: 0, costUsd: 0, durationMs: 0, lastText: '', lastTool: null },
    review: null, pendingAsk: null, alwaysAllow: [], pendingFeedback: null, resumeNext: false,
    error: null, note: null,
  };
  tasks.set(task.id, task);
  await mkdir(runDir(task.id), { recursive: true });
  persist();

  if (autoStart) enqueue(task);
  res.json({ task: publicTask(task) });
});

// ── 建任務前的澄清問答 ────────────────────────────────────────────────────────
//
// 使用者只丟一句「補一下測試」，直接照這句開任務，跑出來多半不是他要的東西。
// 所以建任務前先開一個唯讀 session：看過專案，把會改變做法的疑問問清楚，
// 談定後才產出「目標 + 驗收標準」回填表單。每一輪用 --resume 接同一個 session。
//
// 這裡只是幫人擬稿：結果回給表單讓人改，按下建立才真的變成任務。

// 第一輪要把專案掃過一遍，實測可能跑到兩分半，逾時設寬一點
const CLARIFY_TIMEOUT_MS = parseInt(process.env.TASK_CLARIFY_TIMEOUT_MS || '300000', 10);
const MAX_CLARIFY_ROUNDS = parseInt(process.env.MAX_CLARIFY_ROUNDS || '5', 10);
const MAX_CLARIFY_CONCURRENT = parseInt(process.env.MAX_CLARIFY_CONCURRENT || '2', 10);
let clarifyInFlight = 0;

const CLARIFY_FORMAT = [
  '輸出格式：最後一行只輸出一個 JSON，不要用程式碼區塊包起來，也不要在 JSON 後面再補話。',
  '還有疑問要問：',
  '{"type":"questions","questions":[{"q":"問題","why":"為什麼需要知道","options":["選項A","選項B"]}]}',
  '沒有疑問了，可以定稿：',
  '{"type":"final","goal":"完整的任務目標：要做什麼、範圍到哪、有什麼前提","criteria":["驗收標準1","驗收標準2"],"verifyCmd":"一行可以自動判定成敗的檢查指令"}',
  'verifyCmd 會被真的執行，用 exit code 當硬性關卡：0 才算過。',
  '挑這個專案真的跑得起來的指令（例如 npm test、node --check x.js，可以用 && 串），',
  '它必須是唯讀的檢查，不能修改檔案、不能出網、不能推東西到遠端。',
  '找不到合適的就給空字串，不要硬掰一個跑不起來的。',
].join('\n');

function clarifyOpening({ name, seed, cwd }) {
  return [
    '你要幫使用者把一個還很模糊的想法，談成「無人看管的背景任務」可以照著做的規格。',
    `工作目錄：${cwd}`,
    '你只有唯讀權限：不要修改任何檔案，也不要動手去做這件事，你現在的工作只是把需求問清楚。',
    '',
    `## 使用者目前只給了這些${name?.trim() ? `\n任務名稱：${name.trim()}` : ''}`,
    `想做的事：${seed.trim()}`,
    '',
    '請先實際看一下這個專案（README、套件設定、相關原始碼、測試怎麼跑、近期 git 在動什麼），',
    '再判斷還缺哪些資訊。規則：',
    '- 只問「答案會改變做法或驗收標準」的問題；自己讀專案就查得到的，不要拿來問。',
    '- 一輪最多 3 題，每題盡量附 2～4 個具體選項，選項要貼合這個專案的實際情況。',
    '- 問到你有把握寫出明確的目標與驗收標準為止，通常一到三輪。',
    '',
    CLARIFY_FORMAT,
  ].join('\n');
}

function clarifyAnswers(answers, { last }) {
  const lines = (answers || []).map((a, i) => `${i + 1}. ${a.q}\n   → ${a.a || '（沒有特別意見，你決定）'}`);
  return [
    '我的回答：',
    lines.join('\n') || '（沒有回答）',
    '',
    last
      ? '不要再問了，就用目前已知的資訊直接輸出 final JSON。不確定的地方採用合理的預設做法，並在 goal 裡寫明你做了哪些假設。'
      : '如果還有會改變做法的疑問就繼續問（同樣格式），沒有的話就輸出 final JSON。',
    '',
    CLARIFY_FORMAT,
  ].join('\n');
}

// 模型偶爾會在 JSON 前後多寫幾句話，把所有成對的大括號都試著 parse 一遍，取最後一個合用的
function extractJsonBlocks(text) {
  const s = String(text || '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { out.push(JSON.parse(s.slice(i, j + 1))); } catch { /* 不是合法 JSON，跳過 */ }
        i = j;
        break;
      }
    }
  }
  return out;
}

function parseClarify(text) {
  const blocks = extractJsonBlocks(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const o = blocks[i];
    if (o?.type === 'questions' && Array.isArray(o.questions) && o.questions.length) {
      const questions = o.questions.slice(0, 3).map(q => ({
        q: String(q.q || q.question || '').slice(0, 300),
        why: String(q.why || '').slice(0, 200),
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(s => String(s).slice(0, 120)),
      })).filter(q => q.q);
      if (questions.length) return { type: 'questions', questions };
    }
    if (o?.type === 'final' && (o.goal || o.criteria)) {
      const list = Array.isArray(o.criteria) ? o.criteria : String(o.criteria || '').split('\n');
      const criteria = list.map(s => String(s).trim()).filter(Boolean)
        .map(s => (/^\s*([-*•]|\d+[.)、])\s+/.test(s) ? s : `- ${s}`)).slice(0, 12).join('\n');
      // 談出來的指令一樣要過紅線檢查，不能因為是 Claude 提的就放行
      const cmd = String(o.verifyCmd || '').trim().slice(0, 500);
      return {
        type: 'final',
        goal: String(o.goal || '').trim().slice(0, 4000),
        criteria: criteria.slice(0, 2000),
        verifyCmd: cmd && !dangerousBash(cmd) ? cmd : '',
      };
    }
  }
  return null;
}

// 唯讀的一次性 Claude 呼叫：看得到專案，但絕不動手
let readonlyRunning = 0;   // 重啟前的閒置判斷要算進去：有人正等著它的回覆
function runReadonly({ cwd, model, prompt, resumeId }) {
  const args = [
    '--print', '--output-format', 'json',
    '--allowedTools', 'Read,Glob,Grep,LS',
    '--disallowedTools', 'Write,Edit,MultiEdit,NotebookEdit,Bash,WebFetch,WebSearch',
  ];
  if (model) args.push('--model', model);
  if (resumeId) args.push('--resume', resumeId);

  return new Promise((ok, fail) => {
    let proc;
    try {
      proc = spawn(claudePath, args, { cwd, env: { ...process.env }, detached: true });
    } catch (e) { return fail(new Error(`無法啟動 Claude：${e.message}`)); }

    readonlyRunning++;
    let out = '', err = '', settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; readonlyRunning--; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      killTree(proc, 'SIGKILL');
      done(fail, new Error('Claude 太久沒回應，請稍後再試或自己填'));
    }, CLARIFY_TIMEOUT_MS);

    proc.stdout.on('data', c => { out += c; });
    proc.stderr.on('data', c => { err += c; });
    proc.on('error', e => done(fail, new Error(
      e.code === 'ENOENT' ? `找不到 claude 指令（${claudePath}），請設定 CLAUDE_PATH` : e.message)));
    proc.on('close', code => {
      if (code !== 0 || !out.trim()) {
        return done(fail, new Error(friendlyClaudeError(err) || err.trim().slice(0, 200) || `Claude 異常退出（代碼 ${code}）`));
      }
      let parsed;
      try { parsed = JSON.parse(out); } catch { return done(fail, new Error('Claude 回傳的內容無法解析')); }
      if (parsed.is_error) return done(fail, new Error(String(parsed.result || '').slice(0, 200) || 'Claude 執行失敗'));
      done(ok, { text: parsed.result || '', sessionId: parsed.session_id || null, costUsd: parsed.total_cost_usd || 0 });
    });

    // 提示詞走 stdin：不佔命令列長度，也不必處理跳脫
    try { proc.stdin.write(prompt); proc.stdin.end(); }
    catch (e) { killTree(proc, 'SIGKILL'); done(fail, new Error(`寫入提示詞失敗：${e.message}`)); }
  });
}

tasksRouter.post('/clarify', async (req, res) => {
  const { name = '', seed = '', cwd, model = '', sessionId = null, answers = [], round = 0, finalize = false } = req.body || {};

  const dir = resolve(cwd || WORK_ROOT);
  if (!isInsideRoot(dir)) return res.status(403).json({ error: '目錄不在允許範圍內' });
  try {
    if (!(await stat(dir)).isDirectory()) return res.status(400).json({ error: '選定的路徑不是目錄' });
  } catch { return res.status(400).json({ error: '目錄不存在' }); }

  const opening = !sessionId;
  if (opening && !seed.trim()) return res.status(400).json({ error: '請先寫一句你想做什麼，才有得談' });
  if (!opening && !Array.isArray(answers)) return res.status(400).json({ error: '回答格式不正確' });

  const nextRound = (Number(round) || 0) + 1;
  // 最後一輪強制收尾：談不完也要給出東西，不要無限問下去
  const last = !!finalize || nextRound >= MAX_CLARIFY_ROUNDS;

  if (clarifyInFlight >= MAX_CLARIFY_CONCURRENT) {
    return res.status(429).json({ error: '同時在談的任務太多，請稍候再試' });
  }

  clarifyInFlight++;
  try {
    const prompt = opening
      ? clarifyOpening({ name, seed, cwd: dir })
      : clarifyAnswers(answers, { last });
    const r = await runReadonly({ cwd: dir, model, prompt, resumeId: sessionId });
    const parsed = parseClarify(r.text);

    if (!parsed) {
      return res.status(502).json({ error: 'Claude 沒有照格式回答，請再試一次或自己填' });
    }
    if (parsed.type === 'questions' && !last) {
      return res.json({
        sessionId: r.sessionId || sessionId, round: nextRound, done: false,
        questions: parsed.questions, costUsd: r.costUsd, maxRounds: MAX_CLARIFY_ROUNDS,
      });
    }
    if (parsed.type === 'final') {
      return res.json({
        sessionId: r.sessionId || sessionId, round: nextRound, done: true,
        goal: parsed.goal, criteria: parsed.criteria, verifyCmd: parsed.verifyCmd, costUsd: r.costUsd,
      });
    }
    // 叫它收尾了還在問問題：把問題原樣交出去，讓人自己決定要不要再答一輪
    return res.json({
      sessionId: r.sessionId || sessionId, round: nextRound, done: false,
      questions: parsed.questions, costUsd: r.costUsd, maxRounds: MAX_CLARIFY_ROUNDS, overLimit: true,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  } finally {
    clarifyInFlight--;
  }
});

tasksRouter.get('/:id', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  res.json({ task: publicTask(t) });
});

tasksRouter.patch('/:id', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  if (runtimes.has(t.id)) return res.status(409).json({ error: '任務執行中，請先停止再編輯' });
  const { name, goal, reviewMode, reviewCriteria, model } = req.body || {};
  if (name != null) t.name = String(name).trim() || t.name;
  if (goal != null) t.goal = String(goal).trim() || t.goal;
  if (reviewMode && ['ai', 'manual', 'none'].includes(reviewMode)) t.reviewMode = reviewMode;
  if (reviewCriteria != null) t.reviewCriteria = String(reviewCriteria).trim();
  if (model != null) t.model = String(model);
  touch(t, {});
  res.json({ task: publicTask(t) });
});

tasksRouter.delete('/:id', async (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.json({ ok: true });
  stopRuntime(t);
  tasks.delete(t.id);
  listeners.delete(t.id);
  persist();
  await rm(runDir(t.id), { recursive: true, force: true }).catch(() => {});
  pump();
  res.json({ ok: true });
});

// 啟動 / 重跑：從頭來（不帶前一次的 session）
tasksRouter.post('/:id/start', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  if (runtimes.has(t.id) || t.status === 'queued') return res.status(409).json({ error: '任務已在執行或排隊中' });
  t.sessionId = null; t.review = null; t.attempts = 0; t.startedAt = null;
  t.progress = { tools: 0, turns: 0, costUsd: 0, durationMs: 0, lastText: '', lastTool: null };
  enqueue(t);
  res.json({ task: publicTask(t) });
});

// 續跑：接上原本的 session（重啟中斷、或手動停掉後想接回去）
tasksRouter.post('/:id/resume', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  if (runtimes.has(t.id) || t.status === 'queued') return res.status(409).json({ error: '任務已在執行或排隊中' });
  if (!t.sessionId) return res.status(400).json({ error: '沒有可續跑的 session，請改用重跑' });
  enqueue(t, { resume: true, feedback: '請接續剛才被中斷的工作，先確認目前進度再繼續。' });
  res.json({ task: publicTask(t) });
});

tasksRouter.post('/:id/stop', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  stopRuntime(t);
  t.pendingFeedback = null;
  finish(t, 'stopped', { note: '已手動停止' });
  res.json({ task: publicTask(t) });
});

// 回應待授權的操作
tasksRouter.post('/:id/respond', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  const rt = runtimes.get(t.id);
  const ask = t.pendingAsk;
  if (!rt || !ask) return res.status(409).json({ error: '目前沒有待回覆的請求' });

  const { requestId, behavior, updatedInput, message, always } = req.body || {};
  if (requestId && requestId !== ask.requestId) return res.status(409).json({ error: '這個請求已失效' });
  if (behavior !== 'allow' && behavior !== 'deny') return res.status(400).json({ error: 'behavior 必須是 allow 或 deny' });

  if (behavior === 'allow' && always && ask.toolName) {
    t.alwaysAllow = [...new Set([...(t.alwaysAllow || []), ask.toolName])];
  }
  const response = behavior === 'allow'
    ? { behavior: 'allow', updatedInput: updatedInput ?? ask.input }
    : { behavior: 'deny', message: message || '使用者拒絕了這個操作，請換個做法或說明為何必須這樣做。' };

  answer(t, rt, ask.requestId, response);
  log(t, { kind: 'decision', tool: ask.toolName, text: behavior === 'allow' ? '你放行了這個操作' : '你拒絕了這個操作' });
  touch(t, { status: rt.phase === 'review' ? 'reviewing' : 'running', pendingAsk: null });
  res.json({ ok: true });
});

// 人工驗收：收下 / 打回續修
tasksRouter.post('/:id/review', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });
  if (t.status !== 'awaiting_review') return res.status(409).json({ error: '任務目前不在待驗收狀態' });

  const { decision, feedback } = req.body || {};
  if (decision === 'approve') {
    t.review = { ...(t.review || {}), verdict: 'pass', humanApproved: true, at: new Date().toISOString() };
    finish(t, 'done', { note: '你已驗收通過' });
    return res.json({ task: publicTask(t) });
  }
  if (decision === 'reject') {
    t.autoRetries = 0;   // 人親自看過決定再試，額度重新給
    enqueue(t, { feedback: reviewFeedback(t.review, feedback), resume: true });
    return res.json({ task: publicTask(t) });
  }
  res.status(400).json({ error: 'decision 必須是 approve 或 reject' });
});

// 詳情頁：先回放歷史日誌，再掛成即時聽眾。斷線不影響任務本身。
tasksRouter.get('/:id/stream', async (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: '任務不存在' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const write = o => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch {} };
  write({ type: 'task', task: publicTask(t) });
  for (const ev of await tailLog(t.id)) write({ type: 'event', data: ev, replay: true });
  write({ type: 'replay-done' });

  let set = listeners.get(t.id);
  if (!set) listeners.set(t.id, set = new Set());
  set.add(res);

  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  res.on('close', () => { clearInterval(hb); set.delete(res); });
});

// 重啟前的閒置判斷：還有任務在跑、排隊或停著等人的，回傳它們的簡述
// 收件箱用：要人出手的任務
const ATTENTION = new Set(['awaiting_permission', 'awaiting_review', 'failed', 'interrupted']);
export function attentionTasks() {
  return [...tasks.values()].filter(t => ATTENTION.has(t.status)).map(t => ({ id: t.id, name: t.name, status: t.status, cwd: t.cwd, updatedAt: t.updatedAt }));
}

export function busyTasks() {
  const busy = [...tasks.values()].filter(t => ACTIVE.has(t.status) || runtimes.has(t.id));
  const list = busy.map(t => `任務「${t.name || t.id}」${t.status}`);
  if (readonlyRunning) list.push(`任務釐清中 ${readonlyRunning} 個`);
  return list;
}

export function shutdownTasks() {
  for (const t of tasks.values()) stopRuntime(t);
}
