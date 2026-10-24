// ── Driver：Claude Code（claude -p，stream-json 雙向） ─────────────────────────
//
// headless 的 claude 要能停下來問人，三件事要湊齊：
//   1. --input-format stream-json    → stdin 收 JSON，而且全程不能關
//   2. --permission-prompt-tool stdio → 少了它就靜默 auto-deny，不會來問
//   3. 開場先送 initialize 握手
// 之後 claude 要人拍板時從 stdout 送 control_request(can_use_tool)，答案用 control_response 寫回 stdin。
//
// 事件原樣交出去（前端、辦公室都看得懂 Claude 的 stream-json），只把提問整理成 permission_request。
import { spawn } from 'child_process';
import { claudePath, killTree, friendlyClaudeError } from '../shared.js';

export const DRIVER = 'claude';

function kindOf(p) {
  if (p.type === 'user' && Array.isArray(p.message?.content) && p.message.content.some(b => b.type === 'tool_result')) return 'tool_result';
  if (p.type === 'assistant') return 'assistant';
  if (p.type === 'system') return p.subtype === 'background_tasks_changed' ? 'bg_tasks' : 'system';
  return p.type || 'other';
}

// on：{ event(kind, data), ask(ask), sid(id), turnStart(), turnEnd(result), bgTasks(list), slashCommands(list), exit(code, sawResult) }
export function createDriver({ meta, env, on }) {
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool', 'stdio',
  ];
  if (meta.model) args.push('--model', meta.model);
  if (meta.permMode) args.push('--permission-mode', meta.permMode);
  if (meta.appendSystemPrompt) args.push('--append-system-prompt', meta.appendSystemPrompt);
  if (meta.sessionId) args.push('--resume', meta.sessionId);
  else if (meta.newSessionId) args.push('--session-id', meta.newSessionId);

  let proc = null, sawResult = false, buf = '';
  const write = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };

  function handleLine(line) {
    if (!line || !line.trim()) return;
    let p;
    try { p = JSON.parse(line); }
    catch { on.event('text', { type: 'text', text: line }); return; }

    if (p.type === 'control_request' && p.request?.subtype === 'can_use_tool') {
      const r = p.request;
      on.ask({
        type: 'permission_request',
        requestId: p.request_id,
        toolName: r.tool_name,
        displayName: r.display_name || r.tool_name,
        input: r.input,
        requiresUserInteraction: !!r.requires_user_interaction,   // AskUserQuestion 這類「要你選答案」的
        suggestions: r.permission_suggestions || [],
        reason: r.decision_reason || '',
      });
      return;
    }
    if (p.type === 'control_response' || p.type === 'control_cancel_request') return;
    if (p.type === 'stream_event') { on.event('delta', p); return; }

    if (p.type === 'system') {
      if (p.session_id) on.sid(p.session_id);
      if (p.subtype === 'background_tasks_changed') on.bgTasks(p.tasks || []);
      if (p.subtype === 'init' && Array.isArray(p.slash_commands)) on.slashCommands(p.slash_commands);
      // 背景任務做完，claude 會自己開一輪回報
      if (p.subtype === 'task_notification' || p.subtype === 'init') on.turnStart();
    }
    if (p.type === 'result') { sawResult = true; on.turnEnd(p); return; }
    on.event(kindOf(p), p);
  }

  return {
    start() {
      proc = spawn(claudePath, args, { cwd: meta.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) handleLine(l);
      });
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        console.error(`[claude stderr] ${text.trim()}`);
        on.event('error', { type: 'error', text: friendlyClaudeError(text) || text });
      });
      proc.on('close', (code) => {
        if (buf.trim()) handleLine(buf);
        on.exit(code, sawResult);
      });
      proc.on('error', (e) => {
        on.event('error', { type: 'error', text: e.code === 'ENOENT' ? `找不到 claude 指令（${claudePath}），請設定 CLAUDE_PATH` : e.message });
        on.exit(-1, false, 'spawn-error');
      });
      write({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });
      return proc.pid;
    },
    send(content) { sawResult = false; write({ type: 'user', message: { role: 'user', content } }); },
    // response：{ behavior: 'allow', updatedInput, updatedPermissions? } 或 { behavior: 'deny', message }
    respond(ask, response) { write({ type: 'control_response', response: { subtype: 'success', request_id: ask.requestId, response } }); },
    interrupt() { write({ type: 'control_request', request_id: 'abort-' + Date.now(), request: { subtype: 'interrupt' } }); },
    setMode(permMode) { write({ type: 'control_request', request_id: 'mode-' + Date.now(), request: { subtype: 'set_permission_mode', mode: permMode || 'manual' } }); },
    // 回合結束就收（CLAUDE_KEEPALIVE_MS=0 時）：關 stdin 讓它自己退出
    endInput() { try { proc.stdin.end(); } catch {} },
    kill() { killTree(proc, 'SIGKILL'); },
  };
}
