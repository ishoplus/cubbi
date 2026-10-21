// 節日判斷
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidayOf } from '../web/space/holiday.js';

const D = (s) => new Date(s + 'T12:00:00');
test('萬聖節：10/20～11/1', () => {
  assert.equal(holidayOf(D('2026-10-21')), 'halloween');
  assert.equal(holidayOf(D('2026-11-01')), 'halloween');
  assert.equal(holidayOf(D('2026-11-02')), null);
  assert.equal(holidayOf(D('2026-10-19')), null);
});
test('聖誕節：12/10～12/26', () => {
  assert.equal(holidayOf(D('2026-12-24')), 'christmas');
  assert.equal(holidayOf(D('2026-12-27')), null);
});
test('農曆新年：春節前後一週，跨月也算', () => {
  assert.equal(holidayOf(D('2027-02-06')), 'newyear');
  assert.equal(holidayOf(D('2027-01-31')), 'newyear');   // 前 6 天
  assert.equal(holidayOf(D('2027-02-14')), null);         // 後 8 天
  assert.equal(holidayOf(D('2028-01-20')), 'newyear');
});
test('平常日', () => { assert.equal(holidayOf(D('2026-08-15')), null); });
