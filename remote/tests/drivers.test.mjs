// 選哪一家：能不能用（設定、裝了、登入）、專案預設、接續用原本那家；Codex 的對話紀錄；分支換鍵
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-drv-')));
process.env.WORKTREES_FILE = join(root, 'worktrees.json');
after(() => rmSync(root, { recursive: true, force: true }));
const { createDrivers } = await import('../drivers.js');
const { codexHistory } = await import('../../server/codex.js');
const W = await import('../worktree.js');

const quiet = { log() {} };
function fakeBin(name, exit) {
  const p = join(root, name);
  writeFileSync(p, `#!/bin/sh\necho "status"\nexit ${exit}\n`);
  chmodSync(p, 0o755);
  return p;
}

test('codex：裝了且登入才能用；設定關掉就不能用；沒裝說得出原因', async () => {
  process.env.CODEX_PATH = fakeBin('codex-ok', 0);
  let d = createDrivers({ config: { drivers: {} }, log: quiet });
  await d.ready;
  assert.deepEqual(d.list(), ['claude', 'codex']);
  process.env.CODEX_PATH = fakeBin('codex-nologin', 1);
  d = createDrivers({ config: { drivers: {} }, log: quiet });
  await d.ready;
  assert.deepEqual(d.list(), ['claude']);
  assert.match(d.status().codex.why, /沒登入/);
  process.env.CODEX_PATH = join(root, 'nope');
  d = createDrivers({ config: { drivers: {} }, log: quiet });
  await d.ready;
  assert.match(d.status().codex.why, /沒有裝/);
  process.env.CODEX_PATH = fakeBin('codex-ok2', 0);
  d = createDrivers({ config: { drivers: { codex: false } }, log: quiet });
  await d.ready;
  assert.deepEqual(d.list(), ['claude'], '設定 false 就算裝了也不出現');
  assert.match(d.status().codex.why, /設定檔關掉/);
});

test('選哪一家：前端選的 → 專案預設 → 全域預設 → claude；不能用的退回 claude', async () => {
  process.env.CODEX_PATH = fakeBin('codex-ok3', 0);
  const d = createDrivers({ config: { drivers: { default: 'claude' }, projects: { 'my-app': { driver: 'codex' }, '/abs/proj': { driver: 'codex' } } }, log: quiet });
  await d.ready;
  assert.equal(d.pick({ requested: 'claude', cwd: '/x/my-app' }), 'claude', '前端選的優先');
  assert.equal(d.pick({ cwd: '/x/my-app/src' }), 'codex', '資料夾名對到（子資料夾也算）');
  assert.equal(d.pick({ cwd: '/x/my-app/.claude/worktrees/20261024-abc' }), 'codex', 'worktree 裡也算');
  assert.equal(d.pick({ cwd: '/abs/proj' }), 'codex', '完整路徑');
  assert.equal(d.pick({ cwd: '/abs/project-two' }), 'claude', '前綴相同但不是同一個資料夾');
  assert.equal(d.pick({ cwd: '/other' }), 'claude');
  assert.deepEqual(d.projectDefaults(), { 'my-app': 'codex', '/abs/proj': 'codex' });
  const off = createDrivers({ config: { drivers: { codex: false }, projects: { 'my-app': { driver: 'codex' } } }, log: quiet });
  await off.ready;
  assert.equal(off.pick({ cwd: '/x/my-app' }), 'claude', 'Codex 關掉時專案預設也退回 claude');
  assert.deepEqual(off.projectDefaults(), {}, '不能用的專案預設不給前端');
});

test('Codex 的對話紀錄：找得到 rollout、只留使用者與 AI 的文字、同一方連續的併起來', async () => {
  const home = join(root, 'codex-home');
  const day = join(home, 'sessions', '2026', '10', '24');
  mkdirSync(day, { recursive: true });
  const id = '01a16907-b905-7a40-ba0b-1165fa9d9e71';
  const lines = [
    { type: 'session_meta', payload: { id } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '系統指示' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '幫我看一下' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '看完了' }] } },
  ];
  writeFileSync(join(day, `rollout-2026-10-24T10-00-00-${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n'));
  assert.deepEqual(await codexHistory(id, home), [{ role: 'user', text: '幫我看一下' }, { role: 'assistant', text: '好\n\n看完了' }]);
  assert.equal(await codexHistory('00000000-0000-0000-0000-000000000000', home), null);
});

test('分支換鍵：先掛在預先取的編號，拿到 Codex 的 thread id 再搬過去', async () => {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  const pre = '11111111-2222-3333-4444-555555555555', real = '01aaaaaa-bbbb-7ccc-dddd-eeeeeeeeeeee';
  await W.createWorktree({ cwd: repo, sid: pre, title: 'codex 做' });
  const w = W.rekeyWorktree(pre, real);
  assert.equal(w.sid, real);
  assert.equal(W.getWorktree(pre), null);
  assert.equal(W.getWorktree(real).title, 'codex 做');
  assert.equal(W.rekeyWorktree('nope', real), null);
});
