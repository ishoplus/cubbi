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
