// ── 來源：這台伺服器自己開的對話（server.js 的 sessions）─────────────────────────
//
// claude 的事件即時進來（trackEvent），比讀紀錄檔多知道：正在等回答的提問、背景任務、回合是否進行中。
// 這是 claude-web 專屬的來源（Cubbi 的 Source 介面，見 node_modules/cubbi/server/sources/common.js）。
import { noteConcurrent } from '../economy.js';
import { nameFor } from '../names.js';
import { toolKind, toolDetail, short } from '../../server/index.js';

function liveStatus(sess) {
  if (sess.closed) return 'resting';
  if (sess.pending.size) return 'asking';
  if (sess.turnActive) return 'working';
  if (sess.bgTasks?.length) return 'background';
  return 'idle';
}

// 在空間裡直接回答要的東西：選擇題的題目與選項，或權限請求的指令預覽與建議規則
function askPreview(ask) {
  const i = ask.input || {};
  const v = i.command || i.file_path || i.notebook_path || i.url || i.pattern || i.query || i.prompt || i.description;
  return String(v ?? JSON.stringify(i)).slice(0, 600);
}
function askView(sess, ask) {
  const questions = Array.isArray(ask.input?.questions) ? ask.input.questions : null;
  return {
    runId: sess.runId, requestId: ask.requestId, tool: ask.toolName,
    question: questions?.[0]?.question || toolDetail(ask.toolName, ask.input),
    questions, preview: questions ? '' : askPreview(ask),
    reason: ask.reason || '', suggestions: ask.suggestions?.length ? ask.suggestions : null,
  };
}

export function liveView(sess) {
  const ask = [...sess.pending.values()][0];
  return {
    id: sess.sid || sess.runId,
    sid: sess.sid || null,
    runId: sess.runId,   // 快速回覆：回合進行中插話要用
    live: !sess.closed,
    status: liveStatus(sess),
    act: sess.act || null,
    ask: ask ? askView(sess, ask) : null,
    bgTasks: sess.bgTasks?.length || 0,
    // 背景任務：空間裡每個任務是一個出去工作的同事
    bg: (sess.bgTasks || []).map(t => ({ id: t.task_id, type: t.task_type === 'local_agent' ? 'agent' : t.task_type === 'local_bash' ? 'bash' : 'other',
      desc: short(t.description || t.subagent_type || '', 40) })),
    cwd: sess.cwd,
    model: sess.model,
    permMode: sess.permMode,
    title: sess.firstPrompt ? short(sess.firstPrompt, 60) : '',
    name: sess.sid ? nameFor(sess.sid, sess.firstPrompt) : '',
    updatedAt: sess.lastActivity,
    canResume: true,
  };
}

function trackAct(sess, ev) {
  if (ev.type === 'stream_event') {
    const e = ev.event || {};
    if (e.type === 'content_block_start') {
      const b = e.content_block || {};
      if (b.type === 'thinking') sess.act = { kind: 'think' };
      else if (b.type === 'text') sess.act = { kind: 'talk', text: '' };
      else if (b.type === 'tool_use') sess.act = { kind: toolKind(b.name), tool: b.name, detail: '' };
    } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && sess.act?.kind === 'talk') {
      sess.act.text = short((sess.act.text || '') + e.delta.text, 400).slice(-120);
    } else return;
  } else if (ev.type === 'assistant') {
    const blocks = ev.message?.content || [];
    const tool = [...blocks].reverse().find(b => b.type === 'tool_use');
    if (tool) sess.act = { kind: toolKind(tool.name), tool: tool.name, detail: toolDetail(tool.name, tool.input) };
  } else if (ev.type === 'user' && Array.isArray(ev.message?.content) && ev.message.content.some(b => b.type === 'tool_result')) {
    sess.act = { kind: 'think' };
  } else if (ev.type === 'result') {
    sess.act = { kind: ev.is_error ? 'error' : 'done', at: Date.now() };
  }
}

// server.js 建一個，事件與狀態變化都經過它
// onEvent(sess, ev)：每個事件也轉給別人看（Codex 外包追蹤）
export function liveSource({ sessions, bySid, onEvent = () => {} }) {
  let out = null;   // subscribe 之後才有：{ push, watching }
  const lastSent = new Map();    // id -> 上次推出去的 JSON，沒變就不推
  const pendingPush = new Map(); // id -> timer（節流）

  // 狀態可能變了（有新事件、回答了提問、結束…）：節流後推出去
  function touch(sess) {
    if (sess.turnActive) {
      let n = 0; for (const x of sessions.values()) if (!x.closed && x.turnActive) n++;
      noteConcurrent(n);
    }
    const id = sess.sid || sess.runId;
    if (!out || pendingPush.has(id) || !out.watching()) return;
    pendingPush.set(id, setTimeout(() => {
      pendingPush.delete(id);
      const v = liveView(sess);
      const json = JSON.stringify(v);
      if (lastSent.get(id) === json) return;
      lastSent.set(id, json);
      if (sess.closed) lastSent.delete(id);
      out.push(v);
    }, 250));
  }

  // claude 的每個事件都過一次：記下現在在幹嘛
  function trackEvent(sess, ev) {
    try { onEvent(sess, ev); } catch (e) { console.error('[codex] 追蹤失敗', e); }
    const prevAct = sess.act;
    trackAct(sess, ev);
    // 記下這個動作從什麼時候開始（同一個工具、同一個指令延續下來的不重算）：
    // 前端用它判斷「指令跑了幾分鐘」，晚打開頁面也算得對
    const a = sess.act;
    if (a && a !== prevAct) {
      const same = prevAct && prevAct.kind === a.kind && prevAct.tool === a.tool && (!prevAct.detail || prevAct.detail === a.detail);
      a.since = same ? (prevAct.since || Date.now()) : Date.now();
    }
    touch(sess);
  }

  const has = (sid) => [...sessions.values()].some(s => s.sid === sid && !s.closed);
  return {
    name: 'live',
    async *list() { for (const s of sessions.values()) if (!s.closed) yield liveView(s); },
    has,
    liveIds: () => [...sessions.values()].filter(s => s.sid && !s.closed).map(s => s.sid),
    subscribe(o) { out = o; },
    // 本機開的對話也要有內容才算進度：這裡只補「現在的狀態」，步驟交給紀錄檔來源
    view: (sid) => { const s = bySid.get(sid); return s ? liveView(s) : null; },
    touch, trackEvent,
  };
}
