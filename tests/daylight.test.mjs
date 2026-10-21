// 日夜：關鍵時刻、內插、下班時段
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayParams, isOffHours, arriveHour } from '../web/space/daylight.js';

test('中午是白天：陽光最強、沒有夜色', () => {
  const p = dayParams(12);
  assert.equal(p.sun, 2.6); assert.equal(p.night, 0);
  assert.equal(p.sky[0], '#5aa6e8');
});
test('半夜：沒有太陽、室內燈全開', () => {
  const p = dayParams(2);
  assert.equal(p.sun, 0); assert.equal(p.ceiling, 1); assert.equal(p.night, 1);
});
test('黃昏介於白天與夜晚之間', () => {
  const p = dayParams(18.25);
  assert.ok(p.night > 0.35 && p.night < 0.9);
  assert.ok(p.sun > 0.1 && p.sun < 1.6);
});
test('太陽早上在左、傍晚在右', () => {
  assert.ok(dayParams(8).sunPos.x < 0);
  assert.ok(dayParams(16).sunPos.x > 0);
});
test('超過 24 或負數也能算', () => {
  assert.deepEqual(dayParams(26), dayParams(2));
  assert.deepEqual(dayParams(-1), dayParams(23));
});
test('下班時段 23:00～7:00', () => {
  assert.ok(isOffHours(23.5)); assert.ok(isOffHours(3)); assert.ok(!isOffHours(7)); assert.ok(!isOffHours(22.9));
});
test('回來上班的時間在 7:00～8:30', () => {
  for (const v of [0, 45, 89, 12345]) { const h = arriveHour(v); assert.ok(h >= 7 && h < 8.5); }
});
