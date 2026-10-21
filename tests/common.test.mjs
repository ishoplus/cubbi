// 空間後端：工具分類與摘要（決定小人做什麼動作）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolKind, toolDetail } from '../server/sources/common.js';

test('工具分類', () => {
  assert.equal(toolKind('Read'), 'read');
  assert.equal(toolKind('Edit'), 'edit');
  assert.equal(toolKind('Bash'), 'bash');
  assert.equal(toolKind('WebFetch'), 'web');
  assert.equal(toolKind('Agent'), 'agent');
  assert.equal(toolKind('TodoWrite'), 'plan');
  assert.equal(toolKind('mcp__x__y'), 'tool');
});

test('工具摘要：檔名、指令、網址主機', () => {
  assert.equal(toolDetail('Read', { file_path: '/a/b/c.js' }), 'c.js');
  assert.equal(toolDetail('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(toolDetail('WebFetch', { url: 'https://example.com/x' }), 'example.com');
  assert.ok(toolDetail('Bash', { command: 'x'.repeat(200) }).length <= 60);
});
