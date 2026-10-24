// ── 資料來源共用的小工具：工具分類、摘要、從紀錄裡挑出使用者打的字 ──────────────
//
// 每個來源（sources/*.js）都把對話整理成同一種「人物」格式（Session），空間核心（space.js）只認這個格式：
//   { id, sid, live, status, act, ask, bgTasks, bg?, cwd, model, permMode, title, lastPrompt?, name, updatedAt, canResume, runId? }
// status：working | asking | background | idle | external | resting
// 來源本身的介面：
//   name                       來源名字
//   list()                     非同步迭代，新的在前；核心依序收，滿了就停。hidden: true 的不上場，只拿來補同一段對話的資料
//   shown?(sessions)           核心告訴來源這次哪些人上了場（來源只盯這些）
//   subscribe({ push, watching })  有變化就 push(session)；watching() 為假時（沒人在看）可以省事不推
//   progress?(sid)             進度：{ steps, todos, files, truncated }，不認得就回 null
//   deliverable?(sid)         成品：{ type, url?, path?, name, at, from, turn, prompt, items }（見 deliverable.js），沒有回 null，不認得回 undefined
//   timeline?(sid, from)       縮時回放：[[時間, 種類], …]，不認得就回 null
import { basename } from 'path';

export function toolKind(name = '') {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(name)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'edit';
  if (/^(Bash|BashOutput|KillShell|KillBash|Monitor)$/.test(name)) return 'bash';
  if (/^(WebFetch|WebSearch)$/.test(name) || /browser|playwright|chrome/i.test(name)) return 'web';
  if (/^(Task|Agent|Workflow|SendMessage)$/.test(name)) return 'agent';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode)$/.test(name)) return 'plan';
  return 'tool';
}

export function short(s, n = 80) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function toolDetail(name, input = {}) {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path || input.notebook_path) return basename(input.file_path || input.notebook_path);
  if (input.command) return short(input.command, 60);
  if (input.pattern) return short(input.pattern, 40);
  if (input.url) { try { return new URL(input.url).host; } catch { return short(input.url, 40); } }
  if (input.query) return short(input.query, 40);
  if (input.description) return short(input.description, 50);
  if (input.prompt) return short(input.prompt, 50);
  return '';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return '';
}

// 使用者真正打的字（排掉指令回顯、system-reminder、工具結果）
export function userText(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return '';
  const t = textOf(e.message?.content).trim();
  if (!t || t.startsWith('<')) return '';
  return t;
}

// 測試用的暫存目錄（含 Windows）：在這裡開的對話不放進辦公室，Claude、Codex 都一樣
export const isTempDir = (cwd = '') => /^\/(private\/)?(tmp|var\/folders)\//.test(cwd + '/') || /[\\/]AppData[\\/]Local[\\/]Temp([\\/]|$)/i.test(cwd);
