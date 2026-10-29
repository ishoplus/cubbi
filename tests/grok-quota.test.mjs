// Grok Bot 額度：從桌面版的本機快取讀每週用量，沒裝就沒有
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseUsage, current, createGrokQuota } from '../server/grok-quota.js';

const b32 = (s) => { const A = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, val = 0, out = '';
  for (const b of Buffer.from(s)) { val = (val << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += A[(val >> bits) & 31]; } }
  return bits ? out + A[(val << (5 - bits)) & 31] : out; };
const blob = (pct, resetMs, readAt = 1793195548055) => ({ schemaVersion: 2, value: { kind: 'present', reading: { usage: { percentUsed: pct, nextResetMs: resetMs, grokPlanLabel: 'X Premium+' }, readAtMs: readAt } } });

test('快取內容讀成每週額度', () => {
  const q = parseUsage(blob(10.88914, 1793546855871));
  assert.equal(q.primary, null);
  assert.equal(q.secondary.resets_at, 1793546855);
  assert.equal(Math.round(q.secondary.used_percent), 11);
  assert.equal(q.plan, 'X Premium+');
  assert.equal(parseUsage({ value: { kind: 'absent' } }), null);
});
test('過了重置時間就歸零', () => {
  const q = parseUsage(blob(50, 100_000));
  assert.equal(current(q, 200_000).secondary.used_percent, 0);
});
test('找得到檔就讀、沒裝 Grok Bot 就是 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cubbi-grok-'));
  const msgs = [];
  const g = createGrokQuota({ dir, onChange: (m) => msgs.push(m) });
  assert.equal(g.read(), null);
  writeFileSync(join(dir, b32('sand.client.slice.ui-layout') + '.blob'), '{}');
  writeFileSync(join(dir, b32('sand.client.slice.account.github%7Cuser_X.weekly-usage.cache') + '.blob'), JSON.stringify(blob(25, Date.now() + 86400_000)));
  assert.equal(g.read().secondary.used_percent, 25);
  assert.deepEqual(msgs, [{ type: 'grok-quota' }]);
  assert.equal(createGrokQuota({ dir: join(dir, 'nope') }).read(), null);
});
