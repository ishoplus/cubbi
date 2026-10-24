// ── 完成定義：每個專案要過哪些檢查，交付卡上附證據 ──────────────────────────────
//
// 設定存 data/projects.json，以 repo 根目錄為鍵：{ checks: [{ name, cmd }] }。
// 沒設過就從專案猜（package.json 的 test／lint／build、Makefile 的 test），按一下可以改。
// 跑在 worktree 裡、一次只跑一個（不搶代理人的 CPU），結果記在 worktree 紀錄的 evidence：
//   { head, at, running, results: [{ name, cmd, ok, code, ms, tail }] }
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { killTree } from './shared.js';
import { dataFile } from './paths.js';
import { t, SERVER_LANG } from './i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.PROJECTS_FILE || dataFile('projects.json');
const CHECK_TIMEOUT_MS = parseInt(process.env.CHECK_TIMEOUT_MS || '600000', 10);   // 10 分鐘
const TAIL = 4000;

let store = null;
function load() {
  if (store) return store;
  try { store = JSON.parse(readFileSync(FILE, 'utf8')); } catch { store = {}; }
  return store;
}
function save() {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE + '.tmp', JSON.stringify(store, null, 2));
  renameSync(FILE + '.tmp', FILE);
}

export function guessChecks(dir) {
  const out = [];
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    // npm init 預設的 test 只會 exit 1，不算
    if (s.test && !/no test specified/.test(s.test)) out.push({ name: 'test', cmd: 'npm test' });
    if (s.lint) out.push({ name: 'lint', cmd: 'npm run lint' });
    if (s.typecheck) out.push({ name: 'typecheck', cmd: 'npm run typecheck' });
    if (s.build) out.push({ name: 'build', cmd: 'npm run build' });
  } catch {}
  if (!out.length) {
    try { if (/^test:/m.test(readFileSync(join(dir, 'Makefile'), 'utf8'))) out.push({ name: 'test', cmd: 'make test' }); } catch {}
  }
  return out;
}

// 設定過的優先（空陣列＝刻意不跑），沒設過用猜的
export function projectChecks(repo) {
  const p = load()[repo];
  if (p && Array.isArray(p.checks)) return { checks: p.checks, guessed: false };
  return { checks: guessChecks(repo), guessed: true };
}

export function setProjectChecks(repo, checks) {
  if (!Array.isArray(checks)) throw new Error('checks 要是陣列');
  const clean = checks.map(c => ({ name: String(c.name || '').trim().slice(0, 40), cmd: String(c.cmd || '').trim().slice(0, 500) }))
    .filter(c => c.cmd).map(c => ({ ...c, name: c.name || c.cmd.split(/\s+/).slice(-1)[0] }));
  load()[repo] = { ...(load()[repo] || {}), checks: clean, updatedAt: Date.now() };
  save();
  return clean;
}

function runOne(cwd, cmd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tail = '';
    const proc = spawn('/bin/sh', ['-c', cmd], { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, detached: true });
    const add = (b) => { tail = (tail + b.toString()).slice(-TAIL); };
    proc.stdout.on('data', add);
    proc.stderr.on('data', add);
    const timer = setTimeout(() => { tail += '\n' + t(SERVER_LANG(), '⏱ 超過 {n} 分鐘，已中止', { n: CHECK_TIMEOUT_MS / 60000 }); killTree(proc, 'SIGKILL'); }, CHECK_TIMEOUT_MS);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, ms: Date.now() - t0, tail }); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, ms: Date.now() - t0, tail: e.message }); });
  });
}

// 排隊：一次一個 worktree
let chain = Promise.resolve();
const queued = new Set();
export function runChecks(w, { onUpdate = () => {}, head } = {}) {
  if (queued.has(w.sid)) return chain;
  queued.add(w.sid);
  const job = async () => {
    try {
      const { checks } = projectChecks(w.repo);
      const ev = { head, at: Date.now(), running: true, results: [] };
      onUpdate(ev);
      if (!existsSync(w.path)) { ev.running = false; ev.error = t(SERVER_LANG(), 'worktree 不在了'); onUpdate(ev); return ev; }
      for (const c of checks) {
        const r = await runOne(w.path, c.cmd);
        ev.results.push({ name: c.name, cmd: c.cmd, ...r });
        onUpdate(ev);
      }
      ev.running = false;
      ev.at = Date.now();
      onUpdate(ev);
      return ev;
    } finally { queued.delete(w.sid); }
  };
  chain = chain.then(job, job);
  return chain;
}

// 一句話總結：全部過、哪幾個沒過、還在跑、沒設檢查
export function evidenceSummary(ev) {
  if (!ev) return { state: 'none' };
  if (ev.running) return { state: 'running', done: ev.results.length };
  if (ev.error) return { state: 'error', text: ev.error };
  if (!ev.results.length) return { state: 'nochecks' };
  const failed = ev.results.filter(r => !r.ok).map(r => r.name);
  return failed.length ? { state: 'fail', failed } : { state: 'pass', n: ev.results.length };
}
