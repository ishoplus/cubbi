// Claude 額度：狀態列與串流兩種來源讀成同一個形狀，過了重置時間歸零
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fromStatusline, fromEvent, current, createClaudeQuota } from '../server/claude-quota.js';

test('狀態列的 rate_limits', () => {
  assert.deepEqual(fromStatusline({ five_hour: { used_percentage: 42.5, resets_at: 1792801200 }, seven_day: { used_percentage: 6, resets_at: 1793340000 } }),
    { primary: { used_percent: 42.5, resets_at: 1792801200 }, secondary: { used_percent: 6, resets_at: 1793340000 } });
  assert.equal(fromStatusline(null), null);
  assert.equal(fromStatusline({}), null);
});
test('串流的 rate_limit_event（utilization 是 0～1）', () => {
  const ev = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.02, resetsAt: 1792801200 }, seven_day: { utilization: 0.06, resetsAt: 1793340000 } } } };
  const q = fromEvent(ev);
  assert.equal(Math.round(q.primary.used_percent), 2);
  assert.equal(Math.round(q.secondary.used_percent), 6);
  assert.equal(q.primary.resets_at, 1792801200);
  assert.equal(fromEvent({ type: 'assistant' }), null);
  assert.equal(fromEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), null);
});
test('過了重置時間就歸零', () => {
  const q = { at: 0, primary: { used_percent: 90, resets_at: 100 }, secondary: { used_percent: 30, resets_at: 999 } };
  const c = current(q, 200_000);
  assert.equal(c.primary.used_percent, 0);
  assert.equal(c.secondary.used_percent, 30);
});
test('有變化才通知、存檔重開還在、只來一個窗口時另一個沿用', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cubbi-q-')), 'q.json');
  const msgs = [];
  const later = Date.now() / 1000 + 3600;
  const a = createClaudeQuota({ file, onChange: (m) => msgs.push(m) });
  a.fromStatusline({ five_hour: { used_percentage: 10, resets_at: later }, seven_day: { used_percentage: 5, resets_at: later } });
  a.fromStatusline({ five_hour: { used_percentage: 10.2, resets_at: later }, seven_day: { used_percentage: 5, resets_at: later } });
  assert.equal(msgs.length, 1);
  a.trackEvent({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: later } } } });
  assert.equal(msgs.length, 2);
  assert.equal(a.read().primary.used_percent, 20);
  assert.equal(a.read().secondary.used_percent, 5);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).primary.used_percent, 20);
  assert.equal(createClaudeQuota({ file }).read().primary.used_percent, 20);
});
