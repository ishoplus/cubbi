// 分支交付＋驗收＋收件箱：暫存 git repo 裡實際開 worktree、commit、合併、衝突、丟棄
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, realpathSync, lstatSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-wt-')));
process.env.WORKTREES_FILE = join(root, 'worktrees.json');
process.env.PROJECTS_FILE = join(root, 'projects.json');
process.env.INBOX_FILE = join(root, 'inbox.json');
process.env.SPACE_NAMES_FILE = join(root, 'names.json');
process.env.PUSH_URL = '';
after(() => rmSync(root, { recursive: true, force: true }));

const W = await import('../worktree.js');
const C = await import('../checks.js');
const { createInbox } = await import('../inbox.js');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
function makeRepo(name, pkg) {
  const repo = join(root, name);
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@t'); sh(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.env\n');
  if (pkg) writeFileSync(join(repo, 'package.json'), JSON.stringify(pkg));
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', 'init');
  mkdirSync(join(repo, 'node_modules')); writeFileSync(join(repo, '.env'), 'X=1\n');
  return repo;
}
const sid = (n) => `${n}0000000-0000-0000-0000-000000000000`.slice(0, 36);

test('開分支：worktree 在 .claude/worktrees、連回 node_modules／.env、不進版控', async () => {
  const repo = makeRepo('r1');
  const w = await W.createWorktree({ cwd: repo, sid: sid('a'), title: '做 A' });
  assert.ok(w.path.startsWith(join(repo, '.claude', 'worktrees')));
  assert.equal(w.base, 'main');
  assert.ok(lstatSync(join(w.path, 'node_modules')).isSymbolicLink());
  assert.ok(lstatSync(join(w.path, '.env')).isSymbolicLink());
  assert.ok(lstatSync(join(w.path, '.claude', 'settings.local.json')).isSymbolicLink(), '總是允許的規則連回主 repo');
  assert.equal(sh(repo, 'status', '--porcelain').trim(), '', '主 repo 一個未追蹤的檔都沒多');
  const d = await W.delivery(w);
  assert.equal(W.hasChanges(d), false, '剛開沒東西');
  assert.match(W.worktreeBrief(w), /不要 push/);
});

test('交付：commit＋沒 commit 的新檔都算，diff 看得到', async () => {
  const repo = makeRepo('r2');
  const w = await W.createWorktree({ cwd: repo, sid: sid('b') });
  writeFileSync(join(w.path, 'a.txt'), 'one\ntwo\n');
  sh(w.path, 'commit', '-qam', '加一行');
  writeFileSync(join(w.path, 'new.txt'), 'hi\n');
  const d = await W.delivery(w);
  assert.equal(d.commits.length, 1);
  assert.deepEqual(d.dirty, ['new.txt']);
  assert.equal(d.add, 1);
  assert.ok(d.files.some(f => f.file === 'new.txt' && f.untracked));
  const diff = await W.diffText(w);
  assert.match(diff, /\+two/); assert.match(diff, /\+hi/);
  await assert.rejects(W.mergeWorktree(w), /沒 commit/);
});

test('合併：主 repo 拿到 merge commit、基準移到合到的地方；主 repo 髒就不合', async () => {
  const repo = makeRepo('r3');
  const w = await W.createWorktree({ cwd: repo, sid: sid('c'), title: '改 a' });
  writeFileSync(join(w.path, 'a.txt'), 'one\nthree\n');
  sh(w.path, 'commit', '-qam', '改 a');
  writeFileSync(join(repo, 'a.txt'), 'dirty\n');
  await assert.rejects(W.mergeWorktree(w), /沒 commit 的改動/);
  sh(repo, 'checkout', '-q', 'a.txt');
  const m = await W.mergeWorktree(w);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'one\nthree\n');
  assert.match(sh(repo, 'log', '-1', '--format=%s'), /合併 cw\/.*改 a/);
  const w2 = W.getWorktree(sid('c'));
  assert.equal(w2.status, 'merged');
  assert.equal(W.hasChanges(await W.delivery(w2)), false, '合完之後沒有新東西');
  assert.ok(m.sha);
});

test('衝突：自動退回、主 repo 乾淨', async () => {
  const repo = makeRepo('r4');
  const w = await W.createWorktree({ cwd: repo, sid: sid('d') });
  writeFileSync(join(w.path, 'a.txt'), 'branch\n'); sh(w.path, 'commit', '-qam', 'b');
  writeFileSync(join(repo, 'a.txt'), 'main\n'); sh(repo, 'commit', '-qam', 'm');
  await assert.rejects(W.mergeWorktree(w), (e) => e.conflict && /rebase/.test(e.message));
  assert.equal(sh(repo, 'status', '--porcelain', '--untracked-files=no').trim(), '');
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'main\n');
});

test('丟棄：worktree 和分支都不見', async () => {
  const repo = makeRepo('r5');
  const w = await W.createWorktree({ cwd: repo, sid: sid('e') });
  await W.discardWorktree(w);
  assert.ok(!existsSync(w.path));
  assert.equal(sh(repo, 'branch', '--list', w.branch).trim(), '');
  assert.equal(W.getWorktree(sid('e')).status, 'discarded');
});

test('不是 git repo 不能開', async () => {
  const d = join(root, 'plain'); mkdirSync(d);
  await assert.rejects(W.createWorktree({ cwd: d, sid: sid('f') }), /不是 git repo/);
});

test('完成定義：從 package.json 猜、可以改、跑出證據', async () => {
  const repo = makeRepo('r6', { scripts: { test: 'echo ok', lint: 'echo bad >&2; exit 1' } });
  assert.deepEqual(C.projectChecks(repo).checks.map(c => c.cmd), ['npm test', 'npm run lint']);
  C.setProjectChecks(repo, [{ name: 'ok', cmd: 'echo fine' }, { name: 'bad', cmd: 'echo nope; exit 2' }]);
  assert.equal(C.projectChecks(repo).guessed, false);
  const w = await W.createWorktree({ cwd: repo, sid: sid('g') });
  const ev = await C.runChecks(w, { head: 'h' });
  assert.deepEqual(ev.results.map(r => [r.name, r.ok, r.code]), [['ok', true, 0], ['bad', false, 2]]);
  assert.match(ev.results[1].tail, /nope/);
  assert.deepEqual(C.evidenceSummary(ev), { state: 'fail', failed: ['bad'] });
});

test('收件箱：提問、交件（附驗收）、卡住、知道了', async () => {
  const repo = makeRepo('r7');
  C.setProjectChecks(repo, [{ name: 'ok', cmd: 'true' }]);
  const s = sid('h');
  const w = await W.createWorktree({ cwd: repo, sid: s, title: '做 H' });
  writeFileSync(join(w.path, 'h.txt'), 'h\n'); sh(w.path, 'add', '-A'); sh(w.path, 'commit', '-qm', 'h');
  const sessions = new Map();
  const ask = { type: 'permission_request', requestId: 'r1', toolName: 'Bash', input: { command: 'ls' } };
  sessions.set('run1', { runId: 'run1', sid: 'other', cwd: repo, pending: new Map([['r1', ask]]), turnActive: true, lastActivity: Date.now(), closed: false, firstPrompt: 'x' });
  sessions.set('run2', { runId: 'run2', sid: 'stuck', cwd: repo, pending: new Map(), turnActive: true, lastActivity: Date.now() - 3600000, closed: false, firstPrompt: 'y' });
  const inbox = createInbox({ sessions, sendToSession: async () => {}, log: { log() {}, warn() {}, error() {} } });
  await inbox.refreshDelivery(s);
  await new Promise(r => setTimeout(r, 300));   // 驗收在背景跑
  const items = (await inbox.items()).filter(i => i.cwd?.startsWith(repo));   // 別的測試開的分支不算
  const kinds = items.map(i => i.kind).sort();
  assert.deepEqual(kinds, ['ask', 'review', 'stuck']);
  const rv = items.find(i => i.kind === 'review');
  assert.equal(rv.commits, 1); assert.equal(rv.branch, w.branch);
  assert.equal(rv.evidence.state, 'pass');
  // 知道了
  const r = inbox.router;
  const dismiss = (key) => new Promise((resolve) => r.handle({ method: 'POST', url: '/inbox/dismiss', body: { key }, headers: {} },
    { json: resolve, status() { return this; } }, () => resolve(null)));
  await dismiss(rv.key);
  assert.ok(!(await inbox.items()).some(i => i.key === rv.key));
});
