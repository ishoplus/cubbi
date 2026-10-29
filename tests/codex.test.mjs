// 外包生圖：判斷指令是不是叫 Codex 畫圖、抓提示詞
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCodexImageCommand, promptOf } from '../server/codex.js';

test('叫 Codex 生圖的指令', () => {
  assert.ok(isCodexImageCommand(`codex exec --skip-git-repo-check "用 image generation 工具生成一隻貓並複製到 /tmp/a.png" < /dev/null`));
  assert.ok(isCodexImageCommand(`cd ~/x && codex exec "畫一張夜市插畫" -i ref.png < /dev/null &`));
});
test('不是生圖的 Codex 指令、或不是 Codex', () => {
  assert.ok(!isCodexImageCommand(`codex exec "幫我重構 server.js"`));
  assert.ok(!isCodexImageCommand(`echo "用 image generation 畫圖"`));
  assert.ok(!isCodexImageCommand(`grep -r codex-cli .`));
});
test('提示詞取第一段引號', () => {
  assert.equal(promptOf(`codex exec --skip-git-repo-check '畫一隻積木貓' < /dev/null`), '畫一隻積木貓');
  assert.equal(promptOf(`codex exec "生成 三貓 插畫" -i a.png`), '生成 三貓 插畫');
});

import { isCodexCommand, actionOf } from '../server/codex.js';
test('一般 Codex 指令也認得', () => {
  assert.ok(isCodexCommand(`codex exec "幫我重構 server.js"`));
  assert.ok(!isCodexCommand(`npm run codex-lint`));
});
test('從 Codex 紀錄讀出現在在做什麼', () => {
  assert.deepEqual(actionOf({ payload: { type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd:"npm test",max_output_tokens:1}))' } }), { kind: 'bash', tool: 'exec', detail: 'npm test' });
  assert.deepEqual(actionOf({ payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.apply_patch("*** Begin Patch\\n*** Update File: src/a.js\\n")' } }), { kind: 'edit', tool: 'apply_patch', detail: 'a.js' });
  assert.equal(actionOf({ payload: { type: 'message', role: 'assistant', content: [{ text: '好了' }] } }).kind, 'talk');
  assert.equal(actionOf({ payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.image_gen({prompt:"cat"})' } }).kind, 'paint');
  assert.equal(actionOf({ payload: { type: 'token_count' } }), null);
});
test('提示詞略過生圖的開場白', () => {
  assert.equal(promptOf(`codex exec "用 image generation 工具生成一張正方形（1:1）的圖：台北 101 日落。生成後複製到 a.png"`), '台北 101 日落。生成後複製到 a.png');
});

import { createCodex } from '../server/codex.js';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
test('額度：跳過額度用完後那些沒有數字的紀錄，看到用完的錯誤就當 100%', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-q-')), d = new Date();
  const dir = join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now() - 60_000, reset = Math.floor(Date.now() / 1000) + 3600;
  const rl = (at, primary, secondary, id = 'codex') => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: id, primary, secondary, plan_type: 'plus' } } });
  writeFileSync(join(dir, 'rollout-a.jsonl'), rl(t0, { used_percent: 99, window_minutes: 300, resets_at: reset }, { used_percent: 15, window_minutes: 10080, resets_at: reset + 86400 }) + '\n');
  utimesSync(join(dir, 'rollout-a.jsonl'), new Date(t0), new Date(t0));
  const c = createCodex({ codexHome: home, dataDir: home });
  let q = await c.readQuota();
  assert.equal(q.primary.used_percent, 99);
  // 之後又跑了一次：額度用完，rate_limits 全是 null，還有一行錯誤
  writeFileSync(join(dir, 'rollout-b.jsonl'), rl(t0 + 30_000, null, null, 'premium') + '\n' +
    JSON.stringify({ timestamp: new Date(t0 + 31_000).toISOString(), type: 'event_msg', payload: { type: 'error', message: "You've hit your usage limit. Try again later." } }) + '\n');
  q = await c.readQuota();
  assert.equal(q.primary.used_percent, 100);
  assert.equal(q.secondary.used_percent, 15);
});
