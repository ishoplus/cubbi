// ── Codex：外包（Claude 叫 Codex 做事）、額度、作品牆，以及 Codex 自己的對話 ─────────
//
// 外包：Claude 的 Bash 指令裡有 `codex exec` → 一件外包工作。像要畫圖的是「外包畫師」（畫架），其他是「外包顧問」（外包席）。
//   工作從哪來：宿主有即時事件就餵 trackEvent（claude-web），沒有就從 Claude 的紀錄檔掃（scanTranscripts，單獨跑的 Cubbi）。
//   進度：Codex 每次執行在 <CODEX_HOME>/sessions/年/月/日/rollout-*.jsonl 留紀錄，畫的圖在 generated_images/<對話編號>/。
//   工作開始後出現的新紀錄檔就是它叫起來的 Codex；從紀錄看階段：沒紀錄＝啟動中、有紀錄＝接案、呼叫工具＝工作中、task_complete＝完成。
// 額度：每次執行的紀錄裡有 rate_limits，拿最新一筆。
// 作品牆：Codex 畫的圖（優先是 Claude 叫它畫的），縮圖在 macOS 用內建 sips，其他系統直接給原圖。
// Codex 自己的對話（不是 exec 叫起來的）：codexSource() 讓它們也坐進辦公室，穿 Codex 制服。

import { readdir, stat, open, readFile, writeFile, rename, mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { join, dirname, sep } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { short } from './sources/common.js';
import { fitWidth, guessName } from './sources/naming.js';

const KEEP_DONE_MS = 3 * 60_000;   // 做完後工作還留多久（讓畫師把畫送過去、走出去）
const CODEX_RE = /(^|[\s;&|(`$])codex\s+(exec|e)\b/;
const IMAGE_RE = /image[ _-]?gen|image generation|生圖|生成.{0,8}(圖|插畫|照片)|畫(一|個|張|出)|插畫|illustration|\.png|\.jpg|\.webp|圖片/i;

export function isCodexCommand(cmd) { return CODEX_RE.test(cmd || ''); }
export function isCodexImageCommand(cmd) { return CODEX_RE.test(cmd || '') && IMAGE_RE.test(cmd || ''); }
// 從指令裡抓 Codex 的提示詞（第一段引號內文）當作這件工作的說明
export function promptOf(cmd) {
  const m = /codex\s+(?:exec|e)\b[^'"]*?(['"])([\s\S]*?)\1/.exec(cmd || '');
  return (m ? m[2] : cmd || '').replace(/\s+/g, ' ').trim()
    .replace(/^用\s*image\s*generation\s*工具\s*(生成|畫)?\s*(一張)?\s*(正方形)?\s*(（[^）]*）)?\s*(的)?\s*(圖|圖片)?\s*[：:]?\s*/i, '')   // 生圖固定的開場白不要
    .slice(0, 80);
}

// Codex 紀錄裡的一筆 → 人物動作 { kind, tool, detail }（跟 Claude 那邊同一套種類，前端照樣翻譯）
export function actionOf(e) {
  const p = e?.payload || {};
  if (p.type === 'custom_tool_call' || p.type === 'function_call') {
    const code = String(p.input ?? p.arguments ?? '');
    const tool = /tools\.(\w+)/.exec(code)?.[1] || p.name || '';
    const cmd = /cmd["']?\s*:\s*\\?["']((?:[^"'\\]|\\.)*)/.exec(code)?.[1];
    if (/image/i.test(tool + code.slice(0, 200))) return { kind: 'paint', tool };
    if (tool === 'apply_patch' || /apply_patch/.test(code)) return { kind: 'edit', tool: 'apply_patch', detail: patchFiles(code)[0]?.split(/[\\/]/).pop() || '' };
    if (tool === 'update_plan') return { kind: 'plan', tool };
    if (cmd) return { kind: 'bash', tool: 'exec', detail: short(cmd.replace(/\\(.)/g, '$1'), 60) };
    if (p.name === 'wait') return null;   // 等指令跑完，不算新動作
    return { kind: 'tool', tool };
  }
  if (p.type === 'message' && p.role === 'assistant') return { kind: 'talk', text: short(textOf(p.content), 120) };
  if (p.type === 'reasoning') return { kind: 'think' };
  return null;
}
const textOf = (content) => (content || []).map(c => c.text || '').join('\n');
const patchFiles = (code) => [...String(code).matchAll(/\*\*\* (?:Update|Add) File: ([^\n\\"]+)/g)].map(m => m[1].trim());
// 使用者真正打的字（排掉 <environment_context> 這類系統塞的）
const userTextOf = (p) => p.type === 'message' && p.role === 'user' ? (p.content || []).map(c => c.text || '').find(t => t.trim() && !t.trim().startsWith('<')) || '' : '';

async function readHead(path, n = 4096) {
  const fh = await open(path, 'r');
  try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.subarray(0, bytesRead).toString('utf8'); }
  finally { await fh.close(); }
}
async function readTail(path, size, n) {
  const fh = await open(path, 'r');
  try { const len = Math.min(size, n), b = Buffer.alloc(len); await fh.read(b, 0, len, size - len); return { text: b.toString('utf8'), cut: size > len }; }
  finally { await fh.close(); }
}
function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  const out = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

// codexHome：~/.codex；dataDir：作品牆與縮圖放哪；claudeDir：~/.claude（掃 Claude 紀錄找外包用）
export function createCodex({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), dataDir, galleryFile, thumbDir, claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), onChange = () => {} } = {}) {
  const THUMBS = thumbDir || join(dataDir, 'thumbs');
  const GALLERY_FILE = galleryFile || join(dataDir, 'gallery.json');
  const IMAGES = join(codexHome, 'generated_images');
  const dayDir = (t) => { const d = new Date(t); return join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')); };
  const jobs = new Map();   // 工具呼叫 id -> 工作
  const claimed = new Set();   // 已經對到外包工作的 Codex 對話編號（這些不當員工）
  let gallery = null;

  function addJob({ id, sid, cwd, cmd, bg, start }) {
    if (jobs.has(id)) return null;
    const job = {
      // image：外包畫師（畫架）；code：外包顧問（外包席）
      id, sid, cwd, kind: isCodexImageCommand(cmd) ? 'image' : 'code', prompt: promptOf(cmd), bg: !!bg, doing: null,
      start, end: null, ok: null, taskId: null, codexIds: [], stage: 'starting', images: [],
    };
    jobs.set(id, job);
    changed();
    return job;
  }
  const resultText = (b) => typeof b.content === 'string' ? b.content : (b.content || []).map(x => x.text || '').join('\n');

  // ── 宿主有即時事件（Claude 的 stream-json）就從這裡進來 ──
  function trackEvent(sess, ev) {
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'tool_use' && b.name === 'Bash' && isCodexCommand(b.input?.command)) addJob({ id: b.id, sid: sess.sid, cwd: sess.cwd, cmd: b.input.command, bg: b.input.run_in_background, start: Date.now() });
      }
    } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const b of ev.message.content) {
        const job = b.type === 'tool_result' && jobs.get(b.tool_use_id);
        if (!job || job.end) continue;
        // 背景執行：先拿到任務編號，等任務從背景清單消失才算完
        if (job.bg && !b.is_error) job.taskId = /ID:\s*([\w-]+)/.exec(resultText(b))?.[1] || job.taskId;
        else { job.end = Date.now(); job.ok = !b.is_error; changed(); }
      }
    } else if (ev.type === 'system' && ev.subtype === 'background_tasks_changed') {
      const live = new Set((ev.tasks || []).map(t => t.task_id));
      for (const job of jobs.values()) {
        if (job.sid === sess.sid && job.bg && job.taskId && !job.end && !live.has(job.taskId)) { job.end = Date.now(); job.ok = true; changed(); }
      }
    }
  }

  // ── 沒有即時事件：掃最近有動的 Claude 紀錄檔 ──
  const scanned = new Map();   // 紀錄檔 -> mtime
  async function scanTranscripts() {
    const root = join(claudeDir, 'projects'), since = Date.now() - 15 * 60_000;
    for (const dir of await readdir(root).catch(() => [])) {
      for (const name of await readdir(join(root, dir)).catch(() => [])) {
        if (!name.endsWith('.jsonl')) continue;
        const path = join(root, dir, name);
        const st = await stat(path).catch(() => null);
        if (!st || st.mtimeMs < since || scanned.get(path) === st.mtimeMs) continue;
        scanned.set(path, st.mtimeMs);
        const { text, cut } = await readTail(path, st.size, 512 * 1024).catch(() => ({ text: '' }));
        const sid = name.slice(0, -6);
        for (const e of parseLines(text, cut)) {
          if (e.isSidechain) continue;
          const at = e.timestamp ? Date.parse(e.timestamp) : Date.now();
          if (e.type === 'assistant') {
            for (const b of e.message?.content || []) {
              if (b.type === 'tool_use' && b.name === 'Bash' && isCodexCommand(b.input?.command) && Date.now() - at < KEEP_DONE_MS + 30 * 60_000) {
                addJob({ id: b.id, sid, cwd: e.cwd || '', cmd: b.input.command, bg: b.input.run_in_background, start: at });
              }
            }
          } else if (e.type === 'user') {
            const content = Array.isArray(e.message?.content) ? e.message.content : [{ type: 'text', text: String(e.message?.content || '') }];
            for (const b of content) {
              const job = b.type === 'tool_result' && jobs.get(b.tool_use_id);
              if (job && !job.end) {
                if (job.bg && !b.is_error) job.taskId = /ID:\s*([\w-]+)/.exec(resultText(b))?.[1] || job.taskId;
                else { job.end = at; job.ok = !b.is_error; changed(); }
              }
              // 背景任務做完的通知：<task-notification><task-id>…</task-id>…<status>completed</status>
              const txt = b.type === 'text' ? b.text || '' : '';
              for (const m of txt.matchAll(/<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g)) {
                for (const j of jobs.values()) if (j.taskId === m[1] && !j.end) { j.end = at; j.ok = m[2] === 'completed'; changed(); }
              }
            }
          }
        }
      }
    }
    // 掃描紀錄不能無限長
    if (scanned.size > 500) for (const k of [...scanned.keys()].slice(0, scanned.size - 500)) scanned.delete(k);
  }

  // ── 對到 Codex 的紀錄與圖 ──
  async function findCodexSessions(job) {
    for (const dir of new Set([dayDir(job.start - 60_000), dayDir(Date.now())])) {
      for (const name of await readdir(dir).catch(() => [])) {
        const m = /^rollout-.*-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(name);
        if (!m || claimed.has(m[1])) continue;
        const path = join(dir, name);
        const st = await stat(path).catch(() => null);
        if (!st || st.mtimeMs < job.start - 5000) continue;
        // 第一行含整段系統提示（好幾十 KB），不整行解析：直接從開頭抓時間
        const head = await readHead(path).catch(() => '');
        const at = Date.parse(/"timestamp":"([^"]+)"/.exec(head)?.[1] || 0);
        if (!(at >= job.start - 3000 && (!job.end || at <= job.end))) continue;
        claimed.add(m[1]);
        job.codexIds.push(m[1]);
        job.rollouts = [...(job.rollouts || []), path];
      }
    }
  }
  async function lastAction(path) {
    const st = await stat(path).catch(() => null);
    if (!st) return null;
    const { text } = await readTail(path, st.size, 96 * 1024);
    for (const l of text.split('\n').reverse()) { let e; try { e = JSON.parse(l); } catch { continue; } const a = actionOf(e); if (a) return a; }
    return null;
  }
  async function stageOf(path) {
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text.includes('"task_complete"')) return 'done';
    if (/"(custom_tool_call|function_call)"/.test(text)) return 'drawing';
    return 'started';
  }
  async function imagesOf(codexId) {
    const dir = join(IMAGES, codexId), out = [];
    for (const n of await readdir(dir).catch(() => [])) if (/\.(png|jpe?g|webp)$/i.test(n)) out.push(join(dir, n));
    return out;
  }

  // 額度
  let quota = null, quotaFile = '', quotaMtime = 0;
  async function readQuota() {
    let newest = null;
    for (const dir of new Set([dayDir(Date.now()), dayDir(Date.now() - 86400_000), dayDir(Date.now() - 2 * 86400_000)])) {
      for (const name of await readdir(dir).catch(() => [])) {
        if (!name.endsWith('.jsonl')) continue;
        const st = await stat(join(dir, name)).catch(() => null);
        if (st && (!newest || st.mtimeMs > newest.mtime)) newest = { path: join(dir, name), mtime: st.mtimeMs };
      }
    }
    if (!newest || (newest.path === quotaFile && newest.mtime === quotaMtime)) return quota;
    const text = await readFile(newest.path, 'utf8').catch(() => '');
    const i = text.lastIndexOf('"rate_limits"');
    if (i < 0) return quota;
    const line = text.slice(text.lastIndexOf('\n', i) + 1, text.indexOf('\n', i) === -1 ? undefined : text.indexOf('\n', i));
    try {
      const e = JSON.parse(line), r = e.payload?.rate_limits || e.payload?.info?.rate_limits;
      if (r) quota = { at: Date.parse(e.timestamp), plan: r.plan_type, primary: r.primary, secondary: r.secondary, credits: r.credits, reached: r.rate_limit_reached_type };
      quotaFile = newest.path; quotaMtime = newest.mtime;
    } catch {}
    return quota;
  }

  // 縮圖：512px 寬的 jpg（原圖 2～3MB，直接當貼圖手機吃不消）。只有 macOS 有內建工具，其他系統給原圖
  async function thumbFor(path) {
    if (process.platform !== 'darwin') return path;
    const out = join(THUMBS, createHash('sha1').update(path).digest('hex').slice(0, 16) + '.jpg');
    if (await stat(out).catch(() => null)) return out;
    await mkdir(THUMBS, { recursive: true });
    await new Promise((res, rej) => execFile('/usr/bin/sips', ['-Z', '512', '-s', 'format', 'jpeg', path, '--out', out], (e) => e ? rej(e) : res()));
    return out;
  }
  const isCodexImage = (p) => typeof p === 'string' && p.startsWith(IMAGES + sep) && !p.includes('..') && /\.(png|jpe?g|webp)$/i.test(p);
  const imageUrls = (p) => ({ thumb: '/api/space/thumb?path=' + encodeURIComponent(p), url: '/api/space/image?path=' + encodeURIComponent(p) });

  async function loadGallery() {
    if (gallery) return gallery;
    try { gallery = JSON.parse(await readFile(GALLERY_FILE, 'utf8')); } catch { gallery = []; }
    return gallery;
  }
  async function addToGallery(job, path) {
    await loadGallery();
    if (gallery.some(g => g.path === path)) return;
    gallery.unshift({ path, at: Date.now(), sid: job.sid, prompt: job.prompt });
    gallery = gallery.slice(0, 30);
    await mkdir(dirname(GALLERY_FILE), { recursive: true });
    await writeFile(GALLERY_FILE + '.tmp', JSON.stringify(gallery));
    await rename(GALLERY_FILE + '.tmp', GALLERY_FILE);
  }

  let lastJson = '', polling = false;
  function changed() { setTimeout(() => poll().catch(() => {}), 0); }
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const now = Date.now();
      for (const [id, job] of jobs) {
        if (job.end && now - job.end > KEEP_DONE_MS) { jobs.delete(id); continue; }
        if (!job.end || job.stage !== 'done') await findCodexSessions(job);
        if (job.rollouts?.length) {
          if (!job.end) job.doing = await lastAction(job.rollouts.at(-1));
          const stages = await Promise.all(job.rollouts.map(stageOf));
          job.stage = stages.every(s => s === 'done') ? 'done' : stages.includes('drawing') ? 'drawing' : 'started';
        }
        if (job.end && job.stage !== 'done') job.stage = job.ok === false ? 'failed' : 'done';
        // 很久以前的工作（紀錄檔掃到的舊事）：沒對到 Codex 就當作已經結束
        if (!job.end && now - job.start > 6 * 3600_000) { job.end = now; job.ok = null; }
        const imgs = (await Promise.all(job.codexIds.map(imagesOf))).flat();
        for (const p of imgs) if (!job.images.includes(p)) {
          try { await thumbFor(p); job.images.push(p); await addToGallery(job, p); } catch (e) { console.error('[codex] 縮圖失敗', e.message); }
        }
      }
      const q = await readQuota();
      const json = JSON.stringify([view(), q?.primary?.used_percent, q?.secondary?.used_percent]);
      if (json !== lastJson) { lastJson = json; onChange({ type: 'codex' }); }
    } finally { polling = false; }
  }

  function view() {
    return [...jobs.values()].map(j => ({
      id: j.id, sid: j.sid, kind: j.kind, doing: j.doing, prompt: j.prompt, bg: j.bg, start: j.start, end: j.end, ok: j.ok, stage: j.stage,
      images: j.images.map(p => ({ path: p, ...imageUrls(p) })),
    }));
  }
  async function galleryView() {
    await loadGallery();
    // 作品牆：Claude 叫 Codex 畫的優先；不夠就補這台電腦最近 Codex 畫的其他圖
    const items = gallery.map(g => ({ ...g, fromClaude: true }));
    if (items.length < 8) {
      const extra = [];
      for (const d of await readdir(IMAGES).catch(() => [])) {
        for (const p of await imagesOf(d)) {
          if (items.some(g => g.path === p)) continue;
          const st = await stat(p).catch(() => null);
          if (st) extra.push({ path: p, at: st.mtimeMs, prompt: '', fromClaude: false });
        }
      }
      extra.sort((a, b) => b.at - a.at);
      items.push(...extra.slice(0, 8 - items.length));
    }
    return items.slice(0, 8).map(g => ({ ...g, ...imageUrls(g.path) }));
  }

  // scan：沒有即時事件的宿主（單獨跑）要掃 Claude 紀錄找外包工作
  function start({ scan = false, active = () => true } = {}) {
    setInterval(() => {
      if (!active()) return;
      (scan ? scanTranscripts() : Promise.resolve()).then(() => jobs.size && poll()).catch(() => {});
    }, 3000).unref();
  }

  // 空間的路由：外包工作、作品牆、額度、縮圖與原圖（只給 Codex 畫的圖）
  function extend(r) {
    r.get('/codex', (req, res) => res.json(view()));
    r.get('/gallery', async (req, res) => res.json(await galleryView()));
    r.get('/codex-quota', async (req, res) => res.json(await readQuota()));
    const sendImage = (resize) => async (req, res) => {
      const p = String(req.query.path || '');
      if (!isCodexImage(p)) return res.status(400).json({ error: 'not a Codex image' });
      try {
        const f = resize ? await thumbFor(p) : p;
        res.setHeader('Cache-Control', 'max-age=604800');
        res.type(f.split('.').pop()); createReadStream(f).pipe(res);
      } catch (e) { res.status(404).json({ error: e.message }); }
    };
    r.get('/thumb', sendImage(true));
    r.get('/image', sendImage(false));
  }

  // ── Codex 自己的對話當員工（exec 叫起來的是外包，不算）──
  function codexSource({ recentDays = parseInt(process.env.SPACE_RECENT_DAYS || '3', 10) } = {}) {
    const metaCache = new Map();
    async function metaOf(path, st) {
      const key = `${st.mtimeMs}:${st.size}`, hit = metaCache.get(path);
      if (hit?.key === key) return hit.meta;
      const head = await readHead(path, 64 * 1024).catch(() => '');
      const first = head.split('\n')[0];
      let sm = null; try { sm = JSON.parse(first).payload; } catch { sm = { originator: /"originator":\s*"([^"]+)"/.exec(first)?.[1], source: /"source":\s*"([^"]+)"/.exec(first)?.[1], cwd: /"cwd":\s*"([^"]+)"/.exec(first)?.[1] }; }
      const exec = sm?.source === 'exec' || sm?.originator === 'codex_exec';
      let meta = { exec };
      if (!exec) {
        const events = parseLines(head, false);
        const firstText = events.map(e => userTextOf(e.payload || {})).find(Boolean) || '';
        const { text, cut } = await readTail(path, st.size, 96 * 1024);
        const tail = parseLines(text, cut);
        let act = null, ended = false, lastPrompt = '';
        for (const e of tail) {
          const p = e.payload || {}, at = e.timestamp ? Date.parse(e.timestamp) : undefined;
          const u = userTextOf(p);
          if (u) { lastPrompt = u; act = { kind: 'think', since: at }; ended = false; continue; }
          const a = actionOf(e);
          if (a) act = { ...a, kind: a.kind === 'paint' ? 'tool' : a.kind, since: at };
          if (p.type === 'task_complete') ended = true;
          if (p.type === 'task_started') ended = false;
        }
        meta = { exec, cwd: sm?.cwd || '', firstText, act, ended, lastPrompt: short(lastPrompt, 80) };
      }
      metaCache.set(path, { key, meta });
      return meta;
    }
    async function recent() {
      const files = [];
      for (let i = 0; i < recentDays; i++) {
        const dir = dayDir(Date.now() - i * 86400_000);
        for (const name of await readdir(dir).catch(() => [])) {
          const m = /^rollout-.*-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(name);
          if (!m) continue;
          const st = await stat(join(dir, name)).catch(() => null);
          if (st) files.push({ id: m[1], path: join(dir, name), st });
        }
      }
      return files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    }
    const view = (f, meta) => {
      const age = Date.now() - f.st.mtimeMs;
      return {
        id: f.id, sid: f.id, agent: 'codex', live: false,
        status: meta.ended ? (age < 30 * 60_000 ? 'idle' : 'resting') : age < 90_000 ? 'external' : 'resting',
        act: meta.ended ? { kind: 'done' } : meta.act, ask: null, bgTasks: 0,
        cwd: meta.cwd, model: '', permMode: '',
        title: short(meta.firstText, 60), lastPrompt: meta.lastPrompt,
        name: fitWidth(guessName(meta.firstText)) || 'Codex', updatedAt: f.st.mtimeMs,
        canResume: false,   // Codex 的對話不能從這裡接著聊
      };
    };
    const paths = new Map();
    return {
      name: 'codex',
      async *list() {
        for (const f of await recent()) {
          if (claimed.has(f.id)) continue;
          let meta; try { meta = await metaOf(f.path, f.st); } catch { continue; }
          if (meta.exec || !meta.firstText) continue;
          paths.set(f.id, f.path);
          yield view(f, meta);
        }
      },
      subscribe({ push, watching }) {
        const last = new Map();
        setInterval(async () => {
          if (!watching()) return;
          for (const [id, path] of paths) {
            const st = await stat(path).catch(() => null);
            if (!st) continue;
            const v = view({ id, path, st }, await metaOf(path, st).catch(() => null) || {});
            const json = JSON.stringify(v);
            if (last.get(id) !== json) { if (last.has(id)) push(v); last.set(id, json); }
          }
        }, 3000).unref();
      },
      async progress(sid) {
        const path = paths.get(sid);
        if (!path) return null;
        const st = await stat(path).catch(() => null);
        if (!st) return null;
        const { text, cut } = await readTail(path, st.size, 3 * 1024 * 1024);
        const steps = [], files = new Map();
        let todos = null;
        for (const e of parseLines(text, cut)) {
          const p = e.payload || {}, at = e.timestamp ? Date.parse(e.timestamp) : null;
          const u = userTextOf(p);
          if (u) { steps.push({ at, kind: 'user', text: short(u, 160) }); continue; }
          const a = actionOf(e);
          if (!a || a.kind === 'think') continue;
          if (a.kind === 'talk') { if (a.text) steps.push({ at, kind: 'talk', text: short(a.text, 200) }); continue; }
          steps.push({ at, kind: a.kind === 'paint' ? 'tool' : a.kind, tool: a.tool, text: a.detail || '' });
          if (a.kind === 'edit') for (const fp of patchFiles(p.input ?? p.arguments)) { files.delete(fp); files.set(fp, at); }
          if (a.tool === 'update_plan') {
            try { const plan = JSON.parse(p.arguments || '{}').plan; if (Array.isArray(plan)) todos = plan.map(x => ({ text: x.step || '', status: x.status === 'in_progress' ? 'in_progress' : x.status })); } catch {}
          }
        }
        return { steps: steps.slice(-80), todos, files: [...files.entries()].reverse().slice(0, 40).map(([path, at]) => ({ path, at })), truncated: cut };
      },
    };
  }

  return { trackEvent, scanTranscripts, poll, view, galleryView, readQuota, thumbFor, isCodexImage, extend, start, codexSource, _jobs: jobs };
}
