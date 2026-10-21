// 資料來源：紀錄檔來源把 jsonl 整理成人物格式，噪音標 hidden，進度與縮時回放讀得到
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const home = mkdtempSync(join(tmpdir(), 'src-home-'));
process.env.HOME = home;
const { transcriptSource } = await import('../server/sources/transcript.js');

const dir = join(home, '.claude', 'projects', '-p');
mkdirSync(dir, { recursive: true });
const SID = '11111111-1111-1111-1111-111111111111', NOISE = '22222222-2222-2222-2222-222222222222';
const now = Date.now(), ts = (dt) => new Date(now - dt).toISOString();
const line = (o) => JSON.stringify(o) + '\n';
writeFileSync(join(dir, SID + '.jsonl'),
  line({ type: 'user', cwd: '/work/app', timestamp: ts(5000), message: { content: '幫我修登入' } })
  + line({ type: 'assistant', timestamp: ts(4000), message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/work/app/auth.js' } }] } })
  + line({ type: 'assistant', timestamp: ts(3000), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '修好了' }] } }));
writeFileSync(join(dir, NOISE + '.jsonl'), line({ type: 'user', cwd: '/work/app', timestamp: ts(2000), message: { content: 'ok' } }));

test('清單：人物格式，噪音標 hidden', async () => {
  const src = transcriptSource({ workRoot: '/work' });
  const list = [];
  for await (const v of src.list()) list.push(v);
  const s = list.find(v => v.id === SID);
  assert.equal(s.title, '幫我修登入');
  assert.equal(s.cwd, '/work/app');
  assert.equal(s.status, 'idle');           // 剛做完一輪
  assert.deepEqual(s.act, { kind: 'done' });
  assert.equal(s.canResume, true);
  assert.equal(list.find(v => v.id === NOISE).hidden, true);
  assert.equal(transcriptSource({ workRoot: '/else' }).name, 'transcript');
});

test('進度與縮時回放', async () => {
  const src = transcriptSource({ workRoot: '/work' });
  const p = await src.progress(SID);
  assert.deepEqual(p.files.map(f => f.path), ['/work/app/auth.js']);
  assert.deepEqual(p.steps.map(s => s.kind), ['user', 'edit', 'talk']);
  assert.deepEqual((await src.timeline(SID, now - 60_000)).map(x => x[1]), ['think', 'edit', 'talk', 'done']);
  assert.equal(await src.progress('33333333-3333-3333-3333-333333333333'), null);
});
