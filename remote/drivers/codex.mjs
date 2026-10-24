// ── Driver：OpenAI Codex CLI（codex app-server，JSON-RPC 走 stdio） ─────────────
//
//   initialize → initialized → thread/start（或 thread/resume）→ 每一句 turn/start；回合中補話用 turn/steer
//   要人拍板時 Codex 送伺服器請求：item/commandExecution/requestApproval、item/fileChange/requestApproval、
//   item/tool/requestUserInput（選擇題）；答案用同一個 id 回。中斷用 turn/interrupt。
//
// 事件翻成 Claude stream-json 的樣子再交出去（assistant／user tool_result／result／system init），
// 前端、辦公室、收件箱不用分辨是哪一家：
//   agentMessage → assistant 的 text；reasoning → thinking；commandExecution → Bash 工具；
//   fileChange → 每個檔一個 Edit／Write 工具；mcpToolCall → mcp__伺服器__工具；webSearch → WebSearch
// 權限模式對到 Codex 的核准＋沙箱：
//   manual（逐一確認）→ untrusted＋workspace-write；auto、acceptEdits → on-request＋workspace-write；
//   bypassPermissions → never＋danger-full-access
import { spawn } from 'child_process';
import { appendFileSync } from 'fs';
import { killTree } from '../shared.js';
import { t } from '../i18n.js';

const L = (s, v) => t(process.env.CUBBI_LANG && !/^zh/i.test(process.env.CUBBI_LANG) ? 'en' : 'zh', s, v);   // 語言由 agent-hub 傳進來（CUBBI_LANG），沒有就中文

export const DRIVER = 'codex';
const codexPath = () => process.env.CODEX_PATH || 'codex';
const OUTPUT_MAX = 20000;   // 指令輸出太長就截，日誌和畫面都受不了
// 除錯：AGENT_CODEX_TRACE=<檔> 把收發的 JSON-RPC 原文一行一個記下來（shim 自己的環境變數，不傳給 codex）
const TRACE = process.env.AGENT_CODEX_TRACE;
const trace = (dir, line) => { if (TRACE) try { appendFileSync(TRACE, `${dir} ${line}\n`); } catch {} };

export function policyOf(permMode, cwd) {
  if (permMode === 'bypassPermissions') return { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
  return {
    approvalPolicy: permMode === 'manual' ? 'untrusted' : 'on-request',
    sandbox: 'workspace-write',
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
  };
}

// 使用者訊息：字串或 Claude 的 content blocks（文字＋base64 圖片）
export function inputOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (content || []).map(b => b.type === 'image'
    ? { type: 'image', url: `data:${b.source.media_type};base64,${b.source.data}` }
    : { type: 'text', text: b.text || '' });
}

// Codex 跑指令都包一層 shell（/bin/zsh -lc '…'），畫面上只顯示裡面那句
export function bareCommand(cmd) {
  const m = /^\/bin\/(?:ba|z)?sh -l?c (.+)$/s.exec(cmd || '');
  if (!m) return cmd || '';
  const inner = m[1].trim();
  return /^'.*'$/s.test(inner) ? inner.slice(1, -1).replace(/'\\''/g, "'") : inner;
}

const clip = (s) => { s = String(s ?? ''); return s.length > OUTPUT_MAX ? s.slice(0, OUTPUT_MAX) + '\n' + L('…（截掉 {n} 字）', { n: s.length - OUTPUT_MAX }) : s; };

// 一個 item → Claude 樣子的工具呼叫（開始時）與結果（完成時）
function toolsOf(item) {
  switch (item.type) {
    case 'commandExecution':
      return [{ id: item.id, name: 'Bash', input: { command: bareCommand(item.command), ...(item.cwd ? { cwd: item.cwd } : {}) },
        result: () => item.status === 'declined'
          ? { content: L('（被拒絕，沒有執行）'), is_error: true }
          : { content: clip(item.aggregatedOutput || ''), is_error: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0) } }];
    case 'fileChange':
      return (item.changes || []).map((c, i) => ({ id: `${item.id}:${i}`, name: c.kind?.type === 'add' ? 'Write' : 'Edit', input: { file_path: c.path },
        result: () => ({ content: clip(c.diff || ''), is_error: item.status === 'failed' || item.status === 'declined' }) }));
    case 'mcpToolCall':
      return [{ id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {},
        result: () => ({ content: clip(item.result ? JSON.stringify(item.result) : item.error?.message || ''), is_error: item.status === 'failed' }) }];
    case 'webSearch':
      return [{ id: item.id, name: 'WebSearch', input: { query: item.query || '' }, result: () => ({ content: '', is_error: false }) }];
    default: return [];
  }
}

export function createDriver({ meta, env, on }) {
  let proc = null, buf = '', nextId = 1, threadId = meta.sessionId || null, turnId = null;
  let permMode = meta.permMode || '', sawResult = false, usage = {}, turnStartedAt = 0, closed = false;
  const rpcs = new Map();         // 我發出的請求 id → { resolve, reject }
  const started = new Set();      // 已經交出 tool_use 的 item
  const streaming = new Set();    // 正在逐字吐的 agentMessage（前端要先看到 message_start 才認得、最後完整那則才不會重畫）
  const items = new Map();        // itemId → 最新的 item（核准請求要知道改哪些檔）
  const queue = [];               // thread 還沒開好前送來的話
  let ready = false;

  const write = (obj) => { if (closed) return; const l = JSON.stringify(obj); trace('>', l); try { proc.stdin.write(l + '\n'); } catch {} };
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    rpcs.set(id, { resolve, reject, method });
    write({ id, method, params });
  });
  const fail = (text) => on.event('error', { type: 'error', text });
  const assistant = (id, content) => on.event('assistant', { type: 'assistant', session_id: threadId, message: { id, role: 'assistant', content } });

  async function open() {
    try {
      await rpc('initialize', { clientInfo: { name: 'cubbi', version: '1' }, capabilities: { experimentalApi: true } });
      write({ method: 'initialized', params: {} });
      const p = policyOf(permMode, meta.cwd);
      const r = meta.sessionId
        // excludeTurns：不要它把整段歷史送回來（實測會收到「full-history hydration 要淘汰」的通知），歷史另外從紀錄檔讀
        ? await rpc('thread/resume', { threadId: meta.sessionId, excludeTurns: true, ...(meta.model ? { model: meta.model } : {}), approvalPolicy: p.approvalPolicy, sandbox: p.sandbox,
            ...(meta.appendSystemPrompt ? { developerInstructions: meta.appendSystemPrompt } : {}) })
        : await rpc('thread/start', { cwd: meta.cwd, ...(meta.model ? { model: meta.model } : {}), approvalPolicy: p.approvalPolicy, sandbox: p.sandbox,
            ...(meta.appendSystemPrompt ? { developerInstructions: meta.appendSystemPrompt } : {}) });
      threadId = r.thread.id;
      on.sid(threadId);
      on.event('system', { type: 'system', subtype: 'init', session_id: threadId, cwd: r.thread.cwd || meta.cwd, model: r.model || meta.model || '', driver: 'codex' });
      ready = true;
      for (const q of queue.splice(0)) q();
    } catch (e) {
      fail(L('Codex 開不起來：{msg}', { msg: e.message }));
      kill();
      on.exit(-1, false, 'spawn-error');
    }
  }

  function startTurn(content) {
    const p = policyOf(permMode, meta.cwd);
    turnStartedAt = Date.now(); usage = {}; sawResult = false;
    rpc('turn/start', { threadId, input: inputOf(content), approvalPolicy: p.approvalPolicy, sandboxPolicy: p.sandboxPolicy })
      .catch(e => { fail(L('Codex 不接這句：{msg}', { msg: e.message })); endTurn('failed', e.message); });
  }

  function endTurn(status, errText) {
    if (sawResult) return;
    sawResult = true;
    started.clear(); items.clear(); streaming.clear();
    on.turnEnd({ type: 'result', subtype: status === 'completed' ? 'success' : status === 'interrupted' ? 'error_during_execution' : 'error',
      is_error: status === 'failed', session_id: threadId, duration_ms: Date.now() - turnStartedAt,
      usage: { input_tokens: usage.inputTokens || 0, output_tokens: usage.outputTokens || 0, cache_read_input_tokens: usage.cachedInputTokens || 0 },
      ...(errText ? { result: errText } : {}) });
  }

  function itemStarted(item) {
    items.set(item.id, item);
    const tools = toolsOf(item);
    if (!tools.length) return;
    for (const t of tools) started.add(t.id);
    assistant(`${item.id}:use`, tools.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })));
  }

  const streamEv = (event) => on.event('delta', { type: 'stream_event', session_id: threadId, event });
  function delta(itemId, text) {
    if (!streaming.has(itemId)) {
      streaming.add(itemId);
      streamEv({ type: 'message_start', message: { id: itemId } });
      streamEv({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    }
    streamEv({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  }

  function itemCompleted(item) {
    items.set(item.id, item);
    if (item.type === 'agentMessage') {
      if (streaming.delete(item.id)) streamEv({ type: 'content_block_stop', index: 0 });
      if (item.text) assistant(item.id, [{ type: 'text', text: item.text }]);
      return;
    }
    if (item.type === 'reasoning') {
      const t = [...(item.summary || []), ...(item.content || [])].join('\n').trim();
      if (t) assistant(item.id, [{ type: 'thinking', thinking: t }]);
      return;
    }
    if (item.type === 'plan' && item.text) { assistant(item.id, [{ type: 'text', text: item.text }]); return; }
    const tools = toolsOf(item);
    if (!tools.length) return;
    if (tools.some(t => !started.has(t.id))) itemStarted(item);   // 沒看到開始（例如重連）就補一個
    on.event('tool_result', { type: 'user', session_id: threadId, message: { role: 'user',
      content: tools.map(t => ({ type: 'tool_result', tool_use_id: t.id, ...t.result() })) } });
  }

  // Codex 要人拍板：整理成跟 Claude 一樣的 permission_request（requestId 就是 JSON-RPC 的 id）
  function serverRequest(msg) {
    const { id, method, params: p = {} } = msg;
    const base = { type: 'permission_request', requestId: String(id), rpcId: id, method, suggestions: [], reason: p.reason || '' };
    // 「總是允許」：給一個建議，前端才會出現那顆按鈕；按了回 always 這個決定
    const rule = (toolName, ruleContent) => [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName, ruleContent }] }];
    if (method === 'item/commandExecution/requestApproval') {
      // 實測（codex 0.155）：指令核准帶 availableDecisions，「總是允許」是 acceptWithExecpolicyAmendment——
      // 把這類指令（proposedExecpolicyAmendment，例如 ["date"]）記進 Codex 的規則，之後不再問，跟 Claude 的總是允許同一個意思
      const avail = Array.isArray(p.availableDecisions) ? p.availableDecisions : null;
      const amend = Array.isArray(p.proposedExecpolicyAmendment) && p.proposedExecpolicyAmendment.length ? p.proposedExecpolicyAmendment : null;
      const canAmend = amend && (!avail || avail.some(d => d && typeof d === 'object' && d.acceptWithExecpolicyAmendment));
      const canSession = !avail || avail.includes('acceptForSession');
      const always = canAmend ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: amend } } : canSession ? 'acceptForSession' : null;
      on.ask({ ...base, always, toolName: 'Bash', displayName: 'Bash', input: { command: bareCommand(p.command), ...(p.cwd ? { cwd: p.cwd } : {}) },
        requiresUserInteraction: false, suggestions: always ? rule('Bash', canAmend ? amend.join(' ') : L('這段對話都允許')) : [] });
    } else if (method === 'item/fileChange/requestApproval') {
      const changes = items.get(p.itemId)?.changes || [];
      const files = changes.map(c => c.path);
      const name = changes.length && changes.every(c => c.kind?.type === 'add') ? 'Write' : 'Edit';   // 跟工具那行同一個名字
      on.ask({ ...base, always: 'acceptForSession', toolName: name, displayName: L('改檔'), input: { file_path: files.join('\n') || p.grantRoot || L('（Codex 沒說是哪些檔）') },
        requiresUserInteraction: false, suggestions: rule(name, L('這段對話都允許改檔')) });
    } else if (method === 'item/tool/requestUserInput') {
      const qs = (p.questions || []).map(q => ({ id: q.id, question: q.question, header: q.header || '', multiSelect: false,
        options: (q.options || []).map(o => ({ label: o.label, description: o.description || '' })) }));
      on.ask({ ...base, toolName: 'AskUserQuestion', displayName: L('Codex 想問你'), requiresUserInteraction: true,
        input: { questions: qs } });
    } else {
      // 還不支援的請求（MCP 表單、動態工具…）：回錯誤，代理人會自己改走別的路
      write({ id, error: { code: -32601, message: `Cubbi 還不支援 ${method}` } });
      fail(L('Codex 要求的互動還不支援：{method}', { method }));
    }
  }

  function receive(msg) {
    if (msg.id != null && !msg.method) {   // 我發的請求的回覆
      const r = rpcs.get(msg.id);
      if (!r) return;
      rpcs.delete(msg.id);
      msg.error ? r.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : r.resolve(msg.result);
      return;
    }
    if (msg.id != null && msg.method) { serverRequest(msg); return; }
    const { method, params: p = {} } = msg;
    if (p.threadId && threadId && p.threadId !== threadId) return;   // 子代理人之類的別條 thread
    switch (method) {
      case 'turn/started': turnId = p.turn?.id || null; on.turnStart(); break;
      case 'item/started': if (p.item?.type !== 'userMessage') itemStarted(p.item); break;
      case 'item/completed': if (p.item?.type !== 'userMessage') itemCompleted(p.item); break;
      case 'item/agentMessage/delta': if (p.itemId && p.delta) delta(p.itemId, p.delta); break;
      case 'serverRequest/resolved': on.askGone?.(String(p.requestId)); break;
      case 'thread/tokenUsage/updated': usage = p.tokenUsage?.last || usage; break;
      case 'error': fail(p.error?.message || L('Codex 發生錯誤')); break;
      case 'turn/completed': endTurn(p.turn?.status || 'completed', p.turn?.error?.message); turnId = null; break;
    }
  }

  function kill() { closed = true; killTree(proc, 'SIGKILL'); }

  return {
    start() {
      proc = spawn(codexPath(), ['app-server', '--listen', 'stdio://'], { cwd: meta.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) { if (!l.trim()) continue; trace('<', l); try { receive(JSON.parse(l)); } catch (e) { console.error('[codex] 看不懂的一行', e.message); } }
      });
      proc.stderr.on('data', (d) => console.error(`[codex stderr] ${d.toString().trim()}`));   // 診斷訊息可能有敏感資料，不給前端
      proc.on('close', (code) => { closed = true; on.exit(code, sawResult); });
      proc.on('error', (e) => {
        fail(e.code === 'ENOENT' ? L('找不到 codex 指令（{path}），請安裝 Codex CLI 或設定 CODEX_PATH', { path: codexPath() }) : e.message);
        on.exit(-1, false, 'spawn-error');
      });
      open();
      return proc.pid;
    },
    send(content, { midTurn } = {}) {
      const go = () => {
        if (midTurn && turnId) {
          rpc('turn/steer', { threadId, expectedTurnId: turnId, input: inputOf(content) }).catch(e => fail(L('補話沒送進去：{msg}', { msg: e.message })));
        } else startTurn(content);
      };
      ready ? go() : queue.push(go);
    },
    respond(ask, response) {
      if (ask.method === 'item/tool/requestUserInput') {
        if (response.behavior !== 'allow') { write({ id: ask.rpcId, error: { code: -32000, message: 'User declined.' } }); return; }
        const picked = response.updatedInput?.answers || {};
        const answers = {};
        for (const q of ask.input.questions) answers[q.id] = { answers: [String(picked[q.question] ?? '')] };
        write({ id: ask.rpcId, result: { answers } });
        return;
      }
      // 拒絕用 decline（拒絕這一個、這一輪繼續）：實測就算 availableDecisions 沒列它，Codex 也照收；cancel 會把整輪停掉
      const decision = response.behavior !== 'allow' ? 'decline' : (response.updatedPermissions?.length && ask.always) ? ask.always : 'accept';
      write({ id: ask.rpcId, result: { decision } });
    },
    interrupt() { if (threadId && turnId) rpc('turn/interrupt', { threadId, turnId }).catch(() => {}); },
    setMode(mode) { permMode = mode || ''; },   // 下一輪的 turn/start 帶新的核准與沙箱
    kill,
  };
}
