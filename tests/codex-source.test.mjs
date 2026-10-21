// Codex：自己的對話當員工（exec 的不算）、從 Claude 紀錄掃出外包工作
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCodex } from '../server/codex.js';

const root = mkdtempSync(join(tmpdir(), 'cubbi-codex-'));
const codexHome = join(root, 'codex'), claudeDir = join(root, 'claude');
const d = new Date(), day = join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
mkdirSync(day, { recursive: true });
const line = (o) => JSON.stringify(o) + '\n';
const iso = (dt = 0) => new Date(Date.now() - dt).toISOString();
const TUI = '01a15c26-0000-7000-8000-000000000001', EXEC = '01a15c26-0000-7000-8000-000000000002';
writeFileSync(join(day, `rollout-x-${TUI}.jsonl`),
  line({ timestamp: iso(5000), type: 'session_meta', payload: { id: TUI, cwd: '/work/app', originator: 'codex_tui', source: 'cli' } })
  + line({ timestamp: iso(4000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }, { type: 'input_text', text: '把登入頁改成深色' }] } })
  + line({ timestamp: iso(3000), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.apply_patch("*** Update File: src/login.css\\n")' } })
  + line({ timestamp: iso(2000), type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: '改顏色', status: 'completed' }, { step: '測試', status: 'in_progress' }] }) } }));
writeFileSync(join(day, `rollout-y-${EXEC}.jsonl`), line({ timestamp: iso(1000), type: 'session_meta', payload: { id: EXEC, cwd: '/work/app', originator: 'codex_exec', source: 'exec' } }));

test('Codex 自己的對話是員工、穿 Codex 制服；exec 叫起來的不算', async () => {
  const codex = createCodex({ codexHome, claudeDir, dataDir: join(root, 'data') });
  const src = codex.codexSource();
  const list = [];
  for await (const v of src.list()) list.push(v);
  assert.deepEqual(list.map(v => v.id), [TUI]);
  const v = list[0];
  assert.equal(v.agent, 'codex');
  assert.equal(v.cwd, '/work/app');
  assert.equal(v.title, '把登入頁改成深色');
  assert.equal(v.status, 'external');   // 剛剛還在寫
  assert.equal(v.act.kind, 'plan');
  const p = await src.progress(TUI);
  assert.deepEqual(p.files.map(f => f.path), ['src/login.css']);
  assert.deepEqual(p.todos.map(t => t.status), ['completed', 'in_progress']);
  assert.equal(p.steps[0].kind, 'user');
});

test('從 Claude 紀錄掃出外包工作，工具結果回來就結束', async () => {
  const proj = join(claudeDir, 'projects', '-work-app');
  mkdirSync(proj, { recursive: true });
  const SID = '11111111-2222-3333-4444-555555555555';
  writeFileSync(join(proj, SID + '.jsonl'),
    line({ type: 'assistant', timestamp: iso(60_000), cwd: '/work/app', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'codex exec "用 image generation 工具生成一隻樂高貓" < /dev/null' } }] } })
    + line({ type: 'user', timestamp: iso(10_000), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done' }] } }));
  const codex = createCodex({ codexHome, claudeDir, dataDir: join(root, 'data2') });
  await codex.scanTranscripts();
  const job = codex._jobs.get('tu1');
  assert.equal(job.sid, SID);
  assert.equal(job.kind, 'image');
  assert.equal(job.prompt, '一隻樂高貓');
  assert.ok(job.end && job.ok);
});
