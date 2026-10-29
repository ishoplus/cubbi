// ── 等你辦：代理人做不了、要你本人出手的事（送審、付款、登入後台、簽名…）────────────────
//
// 一件一個 JSON 檔，放在 ~/.cubbi/handoff/（CUBBI_HANDOFF_DIR 可改）。誰都可以寫：對話裡的代理人用 cli.mjs，
// 伺服器（收件箱的按鈕）也寫同一份。欄位：
//   id、title（一句話：要你做什麼）、why（為什麼得你來）、steps[]（怎麼做，一步一行，可帶網址或檔案路徑）、
//   links[]（{ label, url } 或 { label, path }）、report（辦完回報什麼）、
//   status：todo 等你做｜waiting 等外面回覆（審核中）｜done｜dropped、waitingFor（在等誰）、
//   watch（{ from, keywords[] }：審核信長什麼樣，給秘書比對）、sid／cwd（從哪段對話來、回報送回哪）、
//   rev（每回到 todo 加一，收件箱靠它再推一次）、log[]（{ at, who: 'you'｜'agent', text }）
import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { CUBBI_HOME } from '../paths.js';

export const STATUSES = ['todo', 'waiting', 'done', 'dropped'];
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function createHandoff({ dir = process.env.CUBBI_HANDOFF_DIR || join(CUBBI_HOME, 'handoff') } = {}) {
  const file = (id) => join(dir, id + '.json');
  const check = (id) => { if (!ID.test(String(id))) throw new Error('id 格式不對：' + id); return id; };

  function list() {
    let names = [];
    try { names = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const f of names) { try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch {} }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function get(id) {
    try { return JSON.parse(readFileSync(file(check(id)), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  function write(h) {
    mkdirSync(dir, { recursive: true });
    const tmp = file(h.id) + '.' + process.pid + '.tmp';
    writeFileSync(tmp, JSON.stringify(h, null, 2) + '\n');
    renameSync(tmp, file(h.id));
    return h;
  }
  const clean = (p) => ({
    ...(p.title != null && { title: String(p.title).trim() }),
    ...(p.why != null && { why: String(p.why) }),
    ...(p.steps != null && { steps: (Array.isArray(p.steps) ? p.steps : String(p.steps).split('\n')).map(s => String(s).trim()).filter(Boolean) }),
    ...(p.links != null && { links: (Array.isArray(p.links) ? p.links : []).filter(l => l && (l.url || l.path)).map(l => ({ label: String(l.label || l.url || l.path), ...(l.url ? { url: String(l.url) } : { path: String(l.path) }) })) }),
    ...(p.report != null && { report: String(p.report) }),
    ...(p.waitingFor != null && { waitingFor: String(p.waitingFor) }),
    ...(p.watch != null && { watch: p.watch }),
    ...(p.sid != null && { sid: String(p.sid) }),
    ...(p.cwd != null && { cwd: String(p.cwd) }),
  });

  function add(p) {
    const base = clean(p);
    if (!base.title) throw new Error('要有 title（一句話：要老闆做什麼）');
    const id = p.id ? check(p.id) : `${new Date().toISOString().slice(5, 10).replace('-', '')}-${randomBytes(2).toString('hex')}`;
    if (get(id)) throw new Error('已經有 ' + id + '，要改用 update');
    const now = new Date().toISOString();
    const status = STATUSES.includes(p.status) ? p.status : 'todo';
    return write({ id, steps: [], links: [], ...base, status, rev: 1, createdAt: now, updatedAt: now, log: [] });
  }
  // patch：欄位直接蓋；status 換了會記一筆；回到 todo 就 rev+1（收件箱再推一次）
  function update(id, patch = {}, { who = 'agent', note = '' } = {}) {
    const h = get(id);
    if (!h) throw new Error('找不到 ' + id);
    Object.assign(h, clean(patch));
    if (patch.status && patch.status !== h.status) {
      if (!STATUSES.includes(patch.status)) throw new Error('status 只能是 ' + STATUSES.join('／'));
      if (patch.status === 'todo') h.rev = (h.rev || 1) + 1;
      h.status = patch.status;
    }
    if (note) (h.log ||= []).push({ at: new Date().toISOString(), who, text: String(note), ...(patch.status ? { status: patch.status } : {}) });
    h.updatedAt = new Date().toISOString();
    return write(h);
  }
  return { dir, list, get, add, update };
}
