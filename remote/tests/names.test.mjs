// 名牌：模型輸出清理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName } from '../names.js';

test('取最後一行、去掉開場白', () => {
  assert.equal(cleanName('基於對話內容，我會取一個簡潔的名稱：\n\nCloudflare 連線安全'), 'Cloudflare 連線安全');
});
test('去掉引號、標點與「名稱：」', () => {
  assert.equal(cleanName('「三貓商店上架」'), '三貓商店上架');
  assert.equal(cleanName('名稱：台股回測。'), '台股回測');
});
test('太寬就截斷：中文最多 11 個字', () => {
  assert.equal([...cleanName('一二三四五六七八九十一二三四五六七八')].length, 11);
});
test('英文不從單字中間切', () => {
  assert.equal(cleanName('安全連接私人Claude Code'), '安全連接私人Claude');
  assert.equal(cleanName('Cloudflare 連線安全'), 'Cloudflare 連線安全');
});
test('空的回空字串', () => {
  assert.equal(cleanName('\n  \n'), '');
});
