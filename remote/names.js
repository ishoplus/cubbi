// ── 3D 工作室：幫每段對話取一個好讀的短名（掛在桌上的名牌） ──────────────────
//
// 對話的「標題」本來是第一句話，常常是一長串提示詞。這裡用 haiku 取 4～10 字的短名，
// 一次只跑一個、排隊慢慢來；結果存 data/space-names.json，同一段對話只取一次。
// 對話自己有 /rename 的標題就直接用那個，不必問模型。
// 取名用的 claude 關掉所有工具、MCP 與設定檔：它只看文字、不碰任何檔案。

import { spawn } from 'child_process';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { claudePath, claudeEnv } from './shared.js';
import { config } from './config.js';
import { dataFile } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SPACE_NAMES_FILE || dataFile('space-names.json');
const TIMEOUT_MS = 60_000;
const FAIL_BACKOFF_MS = 10 * 60_000;
// AI 取名會花額度，預設關（設定檔 space.aiNames）；關掉時名牌用對話自己的標題，沒有就空著
const AI_NAMES = process.env.SPACE_AI_NAMES ? process.env.SPACE_AI_NAMES === '1' : !!config.space.aiNames;

let names = null;          // sid -> { name, at }
const queue = [];          // [{ sid, text }]
const queued = new Set();
let busy = false, backoffUntil = 0;
let notify = () => {};

async function load() {
  try { names = JSON.parse(await readFile(FILE, 'utf8')); } catch { names = {}; }
}
async function save() {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE + '.tmp', JSON.stringify(names));
  await rename(FILE + '.tmp', FILE);
}

// 名牌的寬度：中日韓文字算 1，英數算 0.55（名牌上英文比中文窄）
const W = (ch) => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
export const MAX_WIDTH = 11;
// 太寬就截斷；不從英文單字中間切
export function fitWidth(s, max = MAX_WIDTH) {
  let w = 0, out = '';
  for (const ch of s) { if (w + W(ch) > max) break; w += W(ch); out += ch; }
  if (out.length < s.length && /[A-Za-z0-9]$/.test(out) && /[A-Za-z0-9]/.test(s[out.length])) {
    const cut = out.search(/[A-Za-z0-9]+$/);
    if (cut > 0) out = out.slice(0, cut);
  }
  return out.trim();
}
// 模型有時會多講一句開場白：取最後一行，去掉引號標點
export function cleanName(out) {
  const line = String(out || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || '';
  const s = line.replace(/^[「『“"'《]+|[」』”"'》]+$/g, '').replace(/^名稱[:：]\s*/, '').replace(/[。．.!！?？,，、;；:：]+$/g, '').trim();
  return fitWidth(s);
}

function ask(text) {
  const prompt = `幫這段工作對話取一個短名稱，掛在辦公室名牌上：中文 4 到 8 個字（英文單字算半個字），越短越好。
規則：中文一律寫成繁體字，原文是簡體也要轉成繁體；產品、套件、專案名保留原文；不要標點、引號或任何解釋。
只輸出名稱本身，一行。

對話開頭：
<<<
${text.slice(0, 600)}
>>>`;
  return new Promise((resolve, reject) => {
    const p = spawn(claudePath, ['--print', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--strict-mcp-config',
      '--setting-sources', '', '--system-prompt', '你只負責幫工作對話取短名稱。', prompt],
      { cwd: tmpdir(), env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('取名逾時')); }, TIMEOUT_MS);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim().slice(0, 200) || `exit ${code}`)); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

async function pump() {
  if (busy || !queue.length || Date.now() < backoffUntil) return;
  busy = true;
  const job = queue.shift();
  try {
    const name = cleanName(await ask(job.text));
    if (name) {
      names[job.sid] = { name, at: Date.now() };
      await save();
      notify({ type: 'names' });
    }
  } catch (e) {
    console.error('[names] 取名失敗，十分鐘後再試：', e.message);
    backoffUntil = Date.now() + FAIL_BACKOFF_MS;
    queue.unshift(job);
  } finally {
    queued.delete(job.sid);
    busy = false;
    setTimeout(pump, 500);
  }
}

// 查名字；沒有就排進佇列（customTitle：對話自己 /rename 過的標題，直接用）
export function nameFor(sid, text, customTitle) {
  if (!names || !sid) return '';
  if (customTitle) return fitWidth(customTitle);
  const hit = names[sid];
  if (hit) return hit.name;
  if (AI_NAMES && text && text.trim() && !queued.has(sid)) {
    queued.add(sid);
    queue.push({ sid, text });
    setTimeout(pump, 0);
  }
  return '';
}

export async function initNames({ onChange } = {}) {
  if (onChange) notify = onChange;
  await load();
  setInterval(pump, 60_000);   // 失敗退避期滿後接著跑
}
