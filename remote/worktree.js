// ── 每個代理人一個 git worktree，交付＝分支 ─────────────────────────────────────
//
// 開對話時選「分支」：在 <repo>/.claude/worktrees/<名字> 開一個 worktree（分支 cw/<名字>），
// claude 在那裡做、在那裡 commit。主 repo 完全不動，做完你看 diff＋驗收結果，一鍵合併或打回。
//
// 只動本機：合併是在主 repo 做 git merge --no-ff，不 push；主 repo 有沒 commit 的改動或不在原分支就不合，
// 有衝突就 merge --abort 退回，請代理人先 rebase。
//
// 紀錄存 data/worktrees.json（以 claude 的 session id 為鍵）。
import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, symlinkSync, lstatSync, appendFileSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dataFile } from './paths.js';
import { t, TError } from './i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.WORKTREES_FILE || dataFile('worktrees.json');
const MAX_DIFF = 400 * 1024;   // 一次最多回這麼多 diff，手機看不完也載不動

export function git(cwd, args, { timeout = 30000, allowFail = false } = {}) {
  return new Promise((res, rej) => execFile('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err && !allowFail) return rej(new Error((stderr || err.message).trim()));
    res(allowFail ? { ok: !err, out: stdout, err: stderr } : stdout);
  }));
}

// ── 紀錄 ─────────────────────────────────────────────────────────────────────
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
export const getWorktree = (sid) => load()[sid] || null;
// 換鍵：Codex 的對話編號要等它開好 thread 才知道，分支先掛在預先取的編號下，拿到真的再搬過去
export function rekeyWorktree(from, to) {
  const s = load();
  if (!s[from] || from === to) return null;
  s[to] = { ...s[from], sid: to, updatedAt: Date.now() };
  delete s[from];
  save();
  return s[to];
}
export const listWorktrees = () => Object.values(load());
export function updateWorktree(sid, patch) {
  const w = load()[sid];
  if (!w) return null;
  Object.assign(w, patch, { updatedAt: Date.now() });
  save();
  return w;
}

export async function repoRoot(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return r.ok ? r.out.trim() : null;
}

// 名字：日期＋session 前 6 碼，分支 cw/<名字>
function slugFor(sid) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${ymd}-${sid.slice(0, 6)}`;
}

// worktree 裡沒有的、但跑測試常要的東西：連回主 repo（不進版控的才連）
const LINKS = ['node_modules', '.env', '.env.local', '.claude/settings.local.json'];

export async function createWorktree({ cwd, sid, title = '' }) {
  const repo = await repoRoot(cwd);
  if (!repo) throw new Error('這個資料夾不是 git repo，不能開分支');
  const base = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (base === 'HEAD') throw new Error('主 repo 現在不在任何分支上（detached HEAD），先切回分支再開');
  const baseSha = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const name = slugFor(sid);
  const branch = `cw/${name}`;
  const path = join(repo, '.claude', 'worktrees', name);
  // .claude/worktrees 不能進版控；settings.local.json 下面可能幫它建一份空的，也不能讓主 repo 多一個未追蹤的檔
  const exclude = join((await git(repo, ['rev-parse', '--git-common-dir'])).trim().replace(/^(?!\/)/, repo + '/'), 'info', 'exclude');
  try {
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    const want = ['.claude/worktrees/', '.claude/settings.local.json'].filter(x => !cur.split('\n').includes(x));
    if (want.length) { mkdirSync(dirname(exclude), { recursive: true }); appendFileSync(exclude, (cur && !cur.endsWith('\n') ? '\n' : '') + want.join('\n') + '\n'); }
  } catch {}
  await git(repo, ['worktree', 'add', '-b', branch, path, baseSha]);
  // 主 repo 的工作目錄跟 cwd 的相對位置，在 worktree 裡也一樣（在子資料夾開的對話照樣在子資料夾做）
  const sub = resolve(cwd).slice(repo.length).replace(/^\//, '');
  const work = sub ? join(path, sub) : path;
  const linked = [];
  for (const rel of LINKS) {
    const src = join(repo, rel), dst = join(path, rel);
    if (rel === '.claude/settings.local.json' && !existsSync(src)) {
      // 「總是允許」記在這：先建空的，worktree 裡記的規則才會留在主 repo
      try { mkdirSync(dirname(src), { recursive: true }); writeFileSync(src, '{}\n'); } catch {}
    }
    if (!existsSync(src)) continue;
    try { lstatSync(dst); continue; } catch {}   // worktree 裡已經有（進了版控）就不動
    const tracked = await git(repo, ['ls-files', '--error-unmatch', rel], { allowFail: true });
    if (tracked.ok) continue;
    try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); linked.push(rel); } catch {}
  }
  const w = { sid, repo, base, baseSha, branch, path, work, title: title.slice(0, 200), linked, status: 'working', createdAt: Date.now(), updatedAt: Date.now() };
  load()[sid] = w;
  save();
  return w;
}

// 給代理人的規矩：附在 system prompt 後面
// lang：'en' 給英文版（伺服器傳 SERVER_LANG()）；不給就中文
export function worktreeBrief(w, lang = 'zh') {
  if (lang === 'en') return [
    `You're working in a git worktree: ${w.path} (branch ${w.branch}, created from ${w.base} at ${w.baseSha.slice(0, 7)}).`,
    `The main repo is at ${w.repo}. Don't modify it, don't switch branches, and don't touch other worktrees.`,
    'Commit each time you finish a chunk of work (with a clear message saying what you did). Don\'t push and don\'t merge: the user will review the diff and decide whether to merge.',
    w.linked.length ? `These are linked back to the main repo (not under version control): ${w.linked.join(', ')}. Don't delete them.` : '',
  ].filter(Boolean).join('\n');
  return [
    `你在一個 git worktree 裡工作：${w.path}（分支 ${w.branch}，從 ${w.base} 的 ${w.baseSha.slice(0, 7)} 開出來）。`,
    `主 repo 在 ${w.repo}，不要去改它，也不要切換分支或動其他 worktree。`,
    '做完一個段落就 git commit（訊息寫清楚做了什麼）；不要 push、不要合併，用戶會看 diff 決定要不要合併。',
    w.linked.length ? `這些是連回主 repo 的（不進版控）：${w.linked.join('、')}，不要刪。` : '',
  ].filter(Boolean).join('\n');
}

// ── 交付：分支上做了什麼 ───────────────────────────────────────────────────────
// commits：base 之後的 commit；dirty：還沒 commit 的檔案；stat：跟 base 比的增刪行數（含沒 commit 的）
export async function delivery(w) {
  if (!existsSync(w.path)) return { missing: true, commits: [], dirty: [], files: [], add: 0, del: 0 };
  const log = await git(w.path, ['log', '--format=%H%x09%s%x09%ct', `${w.baseSha}..HEAD`]);
  const commits = log.trim().split('\n').filter(Boolean).map(l => { const [sha, subject, t] = l.split('\t'); return { sha, subject, at: +t * 1000 }; });
  const dirty = (await git(w.path, ['status', '--porcelain'])).split('\n').filter(Boolean)
    .map(l => l.slice(3)).filter(f => !w.linked.includes(f.replace(/\/$/, '')));
  // 跟 base 比（含工作目錄）；沒追蹤的新檔另算
  const num = await git(w.path, ['diff', '--numstat', w.baseSha]);
  const files = num.trim().split('\n').filter(Boolean).map(l => { const [a, d, f] = l.split('\t'); return { file: f, add: a === '-' ? 0 : +a, del: d === '-' ? 0 : +d, bin: a === '-' }; });
  const untracked = (await git(w.path, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
    .filter(f => !w.linked.includes(f));
  for (const f of untracked) files.push({ file: f, add: 0, del: 0, untracked: true });
  const head = (await git(w.path, ['rev-parse', 'HEAD'])).trim();
  return { head, commits, dirty, files, add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0) };
}

// 有沒有東西可以交：有 commit 或有改動
export const hasChanges = (d) => !!(d && !d.missing && (d.commits.length || d.files.length));

export async function diffText(w, file, lang = 'zh') {
  const args = ['diff', '--no-color', '--find-renames', w.baseSha];
  if (file) args.push('--', file);
  let out = await git(w.path, args);
  // 沒追蹤的新檔：git diff 看不到，補成「新檔」的 diff
  const untracked = (await git(w.path, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
    .filter(f => !w.linked.includes(f) && (!file || f === file));
  for (const f of untracked) {
    const r = await git(w.path, ['diff', '--no-color', '--no-index', '/dev/null', f], { allowFail: true });
    out += r.out;
  }
  if (out.length > MAX_DIFF) out = out.slice(0, MAX_DIFF) + '\n' + t(lang, '… 太長了，只顯示前 {kb} KB；完整的請在電腦上看（分支 {branch}）', { kb: MAX_DIFF / 1024, branch: w.branch }) + '\n';
  return out;
}

// ── 合併／丟棄 ────────────────────────────────────────────────────────────────
export async function mergeWorktree(w, lang = 'zh') {   // lang：合併 commit 的訊息用哪種語言
  if (!existsSync(w.path)) throw new Error('worktree 已經不在了');
  const d = await delivery(w);
  if (d.dirty.length) throw new TError('分支上還有 {n} 個檔案沒 commit，先打回請它 commit', { n: d.dirty.length });
  if (!d.commits.length) throw new Error('分支上沒有新的 commit，沒有東西可以合併');
  const cur = (await git(w.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (cur !== w.base) throw new TError('主 repo 現在在 {cur}，不是 {base}；先切回 {base} 再合併', { cur, base: w.base });
  const st = (await git(w.repo, ['status', '--porcelain', '--untracked-files=no'])).trim();
  if (st) throw new Error('主 repo 有沒 commit 的改動，合併會混在一起；先處理掉再合併');
  const msg = w.title ? t(lang, '合併 {branch}：{title}', { branch: w.branch, title: w.title.split('\n')[0].slice(0, 60) }) : t(lang, '合併 {branch}', { branch: w.branch });
  const r = await git(w.repo, ['merge', '--no-ff', '--no-edit', '-m', msg, w.branch], { allowFail: true });
  if (!r.ok) {
    // 看有沒有沒合好的檔，不看訊息文字（git 的介面語言可能是中文）
    const conflict = !!(await git(w.repo, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).out.trim();
    await git(w.repo, ['merge', '--abort'], { allowFail: true });
    throw conflict ? new TError('跟 {base} 有衝突，已退回沒合；可以打回請它先 rebase {base}', { base: w.base }, { conflict }) : Object.assign(new Error((r.err || r.out).trim()), { conflict });
  }
  const sha = (await git(w.repo, ['rev-parse', 'HEAD'])).trim();
  // 合併完 worktree 留著：對話可以接著做，之後再合一次。基準移到這次合到的地方，下一輪交付只看新做的
  updateWorktree(w.sid, { status: 'merged', mergedSha: sha, mergedHead: d.head, mergedAt: Date.now(), baseSha: d.head, evidence: null });
  return { sha, commits: d.commits.length };
}

export async function discardWorktree(w) {
  if (existsSync(w.path)) await git(w.repo, ['worktree', 'remove', '--force', w.path]);
  await git(w.repo, ['worktree', 'prune'], { allowFail: true });
  await git(w.repo, ['branch', '-D', w.branch], { allowFail: true });
  updateWorktree(w.sid, { status: 'discarded', discardedAt: Date.now() });
}

export const shortRepo = (w) => basename(w.repo);
