// ── 成品：這一輪做出了什麼（做完那一刻螢幕轉給你看的東西）────────────────────
//
// Claude Code 沒有「成品」這個概念，這裡照兩層判斷：
//   1. 它最後一則回覆裡特地提到的網址、檔案路徑——它自己認定的成品
//   2. 回覆沒提到，就看這一輪寫出來的檔、指令輸出裡的 localhost 網址
// 只看最新一輪：你又交代新的事（或還沒做完）就沒有成品，螢幕回到工作畫面。不存檔，每次現算。
//
// 網頁截圖只截本機（localhost、本機 html 檔）：Cubbi 伺服器本身不連外，線上網址交給瀏覽器自己開。
import { statSync, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { join, isAbsolute, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { createHash } from 'crypto';
import { userText, toolKind } from './sources/common.js';

const TYPE_OF = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  video: ['mp4', 'webm', 'mov'],
  pdf: ['pdf'],
  doc: ['pptx', 'docx', 'xlsx', 'key', 'csv', 'md'],
  html: ['html', 'htm'],
};
const RANK = { url: 0, image: 1, video: 1, pdf: 2, doc: 3, html: 4 };   // 小的優先
const extType = (p) => { const e = extname(p).slice(1).toLowerCase(); return Object.keys(TYPE_OF).find(k => TYPE_OF[k].includes(e)) || null; };
export const isLocalUrl = (u) => { try { return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(new URL(u).hostname); } catch { return false; } };

const URL_RE = /https?:\/\/[^\s)<>\]"'`\u0080-\uffff]+/g;   // 中文標點（全形括號、逗號）一律當結尾
// 回覆裡的路徑：絕對路徑、~/ 開頭、或反引號包住的相對路徑；結尾的 :行號 拿掉
const PATH_RE = /(?:^|[\s(（「`'"])((?:~\/|\/)[^\s`'"()（）「」，。、]+)/g;
const TICK_RE = /`([^`\s]+\.[a-z0-9]{2,5})(?::\d+)?`/gi;

const DEPLOY_RE = /\b(git\s+push|deploy|publish|railway|vercel|netlify|wrangler|gh-pages|firebase|fly\s|surge|gh\s+(pr|release|repo)\s+create)/i;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');
const normUrl = (u) => trimUrl(u).replace(/#.*$/, '').replace(/\/+$/, '');
const trimPath = (p) => p.replace(/[.,;:!?]+$/, '').replace(/:\d+(:\d+)?$/, '');
function resolvePath(p, cwd) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (isAbsolute(p)) return p;
  return cwd ? join(cwd, p) : null;
}
// 這一輪才寫出來（或改過）的檔：回覆裡順手提到的參考檔不算成品
function freshFile(p, since) {
  try { const st = statSync(p); return st.isFile() && st.mtimeMs >= since - 60_000 ? st : null; } catch { return null; }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => b.type === 'text' ? b.text : b.type === 'tool_result' ? textOf(b.content) : '').join('\n');
  return '';
}

// events：紀錄檔的事件（照時間順序）。回傳 { type, url?, path?, name, at, from } 或 null
export function findDeliverable(events, cwd = '') {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) if (userText(events[i])) { start = i; break; }
  if (start < 0) return null;
  const turn = events.slice(start).filter(e => !e.isSidechain);
  const last = [...turn].reverse().find(e => e.type === 'assistant');
  if (last?.message?.stop_reason !== 'end_turn') return null;   // 還沒做完
  const since = Date.parse(turn[0].timestamp || '') || 0;
  const at = Date.parse(last.timestamp || '') || Date.now();
  cwd = cwd || turn.find(e => e.cwd)?.cwd || '';

  // 1. 最後一則回覆（這輪最後一段連續的 assistant 文字）
  let reply = '';
  for (let i = turn.length - 1; i >= 0; i--) {
    const e = turn[i];
    if (e.type === 'user') { if (reply) break; else continue; }
    if (e.type !== 'assistant') continue;
    const t = (e.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (t.trim()) reply = t + '\n' + reply;
    if ((e.message?.content || []).some(b => b.type === 'tool_use')) break;
  }
  // 回覆裡的網址，排掉你給它的、它上網查來的（研究型的回覆會附來源，那不是它做的東西）
  const looked = new Set(), webIds = new Set();
  const note = (t) => { for (const m of String(t).matchAll(URL_RE)) looked.add(normUrl(m[0])); };
  note(userText(turn[0]));
  for (const e of turn) for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
    if (b.type === 'tool_use' && (toolKind(b.name) === 'web' || /search|fetch/i.test(b.name))) { webIds.add(b.id); note(JSON.stringify(b.input || {})); }
    if (b.type === 'tool_result' && webIds.has(b.tool_use_id)) note(textOf(b.content));
  }
  // 線上網址還要這輪真的動手做過（寫檔、部署、推送）；純問答隨口提到的官網不算
  const made = turn.some(e => e.type === 'assistant' && (e.message?.content || []).some(b => b.type === 'tool_use'
    && (toolKind(b.name) === 'edit' || (b.name === 'Bash' && DEPLOY_RE.test(b.input?.command || '')))));
  const cands = [];
  for (const m of reply.matchAll(URL_RE)) {
    const u = trimUrl(m[0]);
    if (!looked.has(normUrl(u)) && (made || isLocalUrl(u))) cands.push({ type: 'url', url: u });
  }
  const seen = new Set();
  for (const raw of [...[...reply.matchAll(PATH_RE)].map(m => m[1]), ...[...reply.matchAll(TICK_RE)].map(m => m[1])]) {
    const p = resolvePath(trimPath(raw), cwd);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const type = extType(p);
    if (type && freshFile(p, since)) cands.push({ type, path: p });
  }
  let pick = best(cands), from = 'reply';

  // 2. 回覆沒提到：這輪寫出來的檔、指令輸出裡的 localhost 網址
  if (!pick) {
    from = 'tools';
    const tc = [];
    for (const e of turn) {
      if (e.type === 'assistant') for (const b of e.message?.content || []) {
        const fp = b.type === 'tool_use' && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path);
        const type = fp && extType(fp);
        if (type && freshFile(fp, since)) tc.push({ type, path: fp });
      }
      if (e.type === 'user') for (const m of textOf(e.message?.content).matchAll(URL_RE)) if (isLocalUrl(m[0])) tc.push({ type: 'url', url: trimUrl(m[0]) });
    }
    pick = best(tc.reverse());   // 同等級取最後出現的
  }
  if (!pick) return null;
  return { ...pick, name: pick.url ? hostOf(pick.url) : basename(pick.path), at, from };
}

function best(cands) {
  let b = null;
  for (const c of cands) if (!b || RANK[c.type] < RANK[b.type]) b = c;
  return b;
}
function hostOf(u) { try { const x = new URL(u); return x.host + (x.pathname === '/' ? '' : x.pathname); } catch { return u; } }

// ── 截圖：本機 Chrome 無頭模式，放暫存（同一個網址＋同一輪只截一次）──────────────
const SHOT_DIR = join(tmpdir(), 'cubbi-shots');
const CHROMES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`],
};
const chromePath = () => process.env.CUBBI_CHROME || (CHROMES[process.platform] || []).find(p => p && existsSync(p)) || null;

// 能截的：本機網址、本機 html 檔
export const canShoot = (d) => !!d && ((d.type === 'url' && isLocalUrl(d.url)) || d.type === 'html');

const pending = new Map();
export function screenshot(d) {
  if (!canShoot(d)) return Promise.resolve(null);
  const target = d.type === 'url' ? d.url : 'file://' + d.path;
  const file = join(SHOT_DIR, createHash('sha1').update(target + ':' + d.at).digest('hex').slice(0, 16) + '.png');
  if (existsSync(file)) return Promise.resolve(file);
  if (pending.has(file)) return pending.get(file);
  const chrome = chromePath();
  if (!chrome) return Promise.resolve(null);
  mkdirSync(SHOT_DIR, { recursive: true });
  const job = new Promise((resolve) => {
    const p = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(SHOT_DIR, 'profile')}`, '--window-size=1280,800', '--virtual-time-budget=4000', `--screenshot=${file}`, target], { stdio: 'ignore' });
    const kill = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.on('error', () => { clearTimeout(kill); resolve(null); });
    p.on('exit', () => { clearTimeout(kill); resolve(existsSync(file) ? file : null); });
  }).finally(() => pending.delete(file));
  pending.set(file, job);
  return job;
}
