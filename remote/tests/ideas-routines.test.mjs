// 提案部（lab）與排程（routines）：存檔格式跟 idea-lab 一樣、判斷／開工、跑一批（假 claude）、白板四欄、收件箱；
// 排程的星期幾、到點跑一次、同一次不重跑、錯過太久不補、排程牆上的每一次
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'cw-ideas-'));
process.env.CLAUDE_PATH = join(here, 'fake-claude-ideas.mjs');
process.env.FAKE_IDEAS_LOG = join(root, 'prompts.log');
process.env.SPACE_NAMES_FILE = join(root, 'names.json');
after(() => rmSync(root, { recursive: true, force: true }));
const { createLab } = await import('../ideas/lab.js');
const { ideasPlugin } = await import('../ideas/plugin.js');
const { createRoutines, daysOf, lastSlot, slotsBetween, validRoutine } = await import('../routines.js');
const quiet = { log() {}, warn() {}, error() {} };

// 一個有 commit 的專案，提案部要看得到它
const proj = join(root, 'projects', 'app');
mkdirSync(proj, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: proj });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', '改了樣式'], { cwd: proj });

test('跑一批：讀得到專案近況與品味、存成 idea-lab 的格式、id 是月日＋字母', async () => {
  process.env.FAKE_IDEAS_DIR = proj;
  const lab = createLab({ stateDir: join(root, 'ideas'), roots: [join(root, 'projects')], values: '要好玩', log: quiet });
  const { proposals } = await lab.run();
  assert.equal(proposals.length, 2);
  assert.match(proposals[0].id, /^\d{4}-a$/);
  const saved = readFileSync(join(root, 'ideas', 'proposals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(saved.map(p => p.title), ['加深色模式', '新東西']);
  const sent = JSON.parse(readFileSync(process.env.FAKE_IDEAS_LOG, 'utf8').trim().split('\n').pop());
  assert.match(sent.prompt, /改了樣式/, '近況裡有 commit');
  assert.match(sent.prompt, /要好玩/, '品味有帶進去');
  assert.ok(sent.args.includes('--allowedTools') && !sent.args.includes('Edit'), '只給唯讀工具');
  assert.ok(!sent.args.includes('WebFetch') && !sent.args.includes('WebSearch'), '預設不給上網（被埋指令時不會把檔案送出去）');
  // 同一天再跑：id 接著往下編
  const again = await lab.run();
  assert.match(again.proposals[0].id, /-c$/);
});

test('判斷與開工：要／不要／改，白板四欄跟著動；沒判要不能開工', async () => {
  const lab = createLab({ stateDir: join(root, 'ideas'), roots: [], log: quiet });
  const [a, b, c] = lab.history();
  lab.verdict(a.id, '要');
  lab.verdict(b.id, '不要');
  lab.verdict(c.id, '改', '做小一點');
  assert.throws(() => lab.stage(b.id, 'doing'), /還沒判「要」/);
  lab.stage(a.id, 'doing', { session: 'sid-1', cwd: proj });
  const plug = ideasPlugin({ lab, routines: () => [], saveRoutines: () => {}, newProjectRoot: root });
  // 白板：用 mount 拿路由太麻煩，直接看 history 推出來的欄位
  const h = Object.fromEntries(lab.history().map(p => [p.id, p]));
  assert.equal(h[a.id].stage, 'doing');
  assert.equal(h[a.id].stageRec.session, 'sid-1');
  assert.equal(h[c.id].verdict.note, '做小一點');
  assert.equal(plug.name, 'ideas');
  // 檔案格式跟 idea-lab 一樣
  const v = readFileSync(join(root, 'ideas', 'verdicts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(Object.keys(v[0]).sort(), ['at', 'id', 'note', 'verdict']);
  assert.throws(() => lab.verdict(a.id, '也許'), /要／不要／改/);
});

test('排程：星期幾的寫法', () => {
  assert.deepEqual(daysOf('daily'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(daysOf('weekdays'), [1, 2, 3, 4, 5]);
  assert.deepEqual(daysOf('mon,wed,fri'), [1, 3, 5]);
  assert.deepEqual(daysOf('Monday, Friday'), [1, 5]);
  assert.equal(validRoutine({ id: 'x', at: '9:00', days: 'daily', action: { type: 'ideas' } }), null);
  assert.match(validRoutine({ id: 'x', at: '9點', action: { type: 'ideas' } }), /09:00/);
  assert.match(validRoutine({ id: 'x', at: '09:00', action: { type: 'prompt' } }), /資料夾/);
  assert.match(validRoutine({ id: 'x y', at: '09:00', action: { type: 'ideas' } }), /id/);
});

test('排程：到點跑一次、同一次不重跑、錯過超過 2 小時不補', async () => {
  const at = new Date(); at.setHours(9, 0, 0, 0);
  let now = at.getTime() + 60000;   // 9:01
  const ran = [];
  const list = [{ id: 'r1', name: '每天', at: '09:00', days: 'daily', action: { type: 'cmd', cmd: 'true' } }];
  const R = createRoutines({ routines: () => list, save: () => {}, stateFile: join(root, 'rs.json'), now: () => now, log: quiet,
    runners: { cmd: async (r) => { ran.push(r.id); return { note: 'ok' }; } } });
  R.tick(); await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(ran, ['r1']);
  R.tick(); await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(ran, ['r1'], '同一次不重跑');
  assert.equal(R.state().r1.status, 'ok');
  // 新的一天、伺服器 3 小時後才開：不補
  const R2 = createRoutines({ routines: () => list, save: () => {}, stateFile: join(root, 'rs2.json'), now: () => at.getTime() + 3 * 3600000, log: quiet,
    runners: { cmd: async (r) => { ran.push('late'); } } });
  R2.tick(); await new Promise(r => setTimeout(r, 50));
  assert.ok(!ran.includes('late'));
  // 排程牆：今天起 7 天每天一次，今天那次已經跑過
  const occ = R.occurrences(at.getTime() - 2 * 86400000 - 9 * 3600000, 9);
  assert.equal(occ.length, 7, '前兩天沒跑過的不列（排程是後來才加的）');
  assert.equal(occ[0].status, 'ok', '今天那次跑過了');
  assert.equal(occ[1].status, 'planned');
  assert.equal(lastSlot({ at: '09:00', days: 'daily' }, at.getTime() - 60000) < at.getTime(), true, '9 點前的最近一次是昨天');
  assert.equal(slotsBetween({ at: '09:00', days: 'mon' }, at.getTime(), 7).length, 1);
});

test('排程跑失敗：記下錯誤', async () => {
  const R = createRoutines({ routines: () => [{ id: 'bad', at: '00:00', days: 'daily', action: { type: 'cmd', cmd: 'x' } }], save: () => {}, stateFile: join(root, 'rs3.json'), log: quiet,
    runners: { cmd: async () => { throw new Error('壞掉了'); } } });
  await R.run({ id: 'bad', name: 'bad', action: { type: 'cmd', cmd: 'x' } });
  assert.equal(R.state().bad.status, 'error');
  assert.match(R.state().bad.error, /壞掉了/);
});
