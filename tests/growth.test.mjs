// 自動成長：用量 → 等級、設備、獎盃；紀錄只讀新增的部分
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createGrowth, totals, lookOf, levelOf } from '../server/growth.js';

const line = (o) => JSON.stringify(o) + '\n';
const prompt = (ts, text = '修一下登入') => line({ type: 'user', timestamp: ts, cwd: '/w/app', message: { content: text } });
const turn = (ts, tools = []) => line({ type: 'assistant', timestamp: ts, message: { stop_reason: 'end_turn', content: tools } });

test('規則：分數→等級、專案回合→設備、里程碑→獎盃', () => {
  const s = { turns: 1200, commits: 10, bg: 1, files: 3, days: 8, bestDay: 60, bestStreak: 8, projects: { '/w/app': { turns: 600, commits: 10 }, '/w/new': { turns: 5, commits: 0 } } };
  assert.equal(levelOf(s), 2);   // 1200 + 30 ≥ 1000
  const L = lookOf(s);
  assert.equal(L.facilities.game, 1);
  assert.deepEqual(L.depts['/w/app'].equip, { monitor: 2, chair: 2, desk: 1, trinkets: { plant: true, lamp: true }, owned: { plate: true, plant: true, lamp: true, wood: true }, floor: 'wood' });
  assert.equal(L.depts['/w/new'].equip.monitor, 0);
  assert.deepEqual(L.trophies.map(t => t.id), ['first_bg', 'streak7', 'day50', 'office']);
  assert.equal(L.progress.next, 4000);
});

test('連續上班天數、最多的一天', () => {
  const s = totals({ a: { turns: 3, commits: 0, bg: 0, fileSet: [], cwd: '/w', days: { '2026-01-01': 1, '2026-01-02': 5, '2026-01-04': 2 } } });
  assert.equal(s.days, 3); assert.equal(s.bestStreak, 2); assert.equal(s.bestDay, 5);
});

test('讀紀錄：只算你的訊息與完成的回合；檔案長大只讀新的，被重寫就重讀', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'growth-')), proj = join(dir, 'projects', '-w-app');
  mkdirSync(proj, { recursive: true });
  const f = join(proj, 's1.jsonl');
  writeFileSync(f, prompt('2026-01-01T02:00:00Z') + turn('2026-01-01T02:01:00Z', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/w/app/a.js' } }])
    + line({ type: 'user', timestamp: '2026-01-01T02:02:00Z', message: { content: [{ type: 'tool_result', content: 'x'.repeat(1000) }] } })
    + turn('2026-01-01T03:00:00Z', [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x' } }, { type: 'tool_use', name: 'Agent', input: {} }]));
  const g = createGrowth({ claudeDir: dir, cacheFile: join(dir, 'cache.json') });
  await g.scan();
  let s = totals(g._cache().files);
  assert.deepEqual([s.turns, s.commits, s.bg, s.files, s.days], [2, 1, 1, 1, 1]);
  assert.ok(s.projects['/w/app']);
  appendFileSync(f, prompt('2026-01-02T02:00:00Z') + turn('2026-01-02T02:05:00Z') + '{"type":"assistant","半行');   // 最後半行還在寫
  await g.scan();
  s = totals(g._cache().files);
  assert.deepEqual([s.turns, s.days], [3, 2]);
  writeFileSync(f, prompt('2026-02-01T02:00:00Z') + turn('2026-02-01T02:05:00Z'));   // 檔案被重寫（變小）
  await g.scan();
  assert.equal(totals(g._cache().files).turns, 1);
});
