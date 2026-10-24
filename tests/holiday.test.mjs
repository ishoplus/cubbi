// 節日判斷
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidayOf, fireworksOn, isDayOff, isTwHoliday } from '../web/space/holiday.js';

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

test('跨年：12/28～1/1', () => {
  assert.equal(holidayOf(D('2026-12-31')), 'nye');
  assert.equal(holidayOf(D('2027-01-01')), 'nye');
  assert.equal(holidayOf(D('2027-01-02')), null);
});
test('端午、中秋：只有中文介面掛', () => {
  assert.equal(holidayOf(D('2027-06-09')), 'dragonboat');
  assert.equal(holidayOf(D('2027-06-04')), 'dragonboat');   // 前 5 天
  assert.equal(holidayOf(D('2026-09-25')), 'midautumn');
  assert.equal(holidayOf(D('2026-09-18')), 'midautumn');   // 前 7 天
  assert.equal(holidayOf(D('2026-09-27')), null);
  assert.equal(holidayOf(D('2026-09-25'), { zh: false }), null);
});
test('跨年煙火：12/31 23:55～1/1 00:30', () => {
  assert.equal(fireworksOn(new Date('2026-12-31T23:56:00')), true);
  assert.equal(fireworksOn(new Date('2027-01-01T00:20:00')), true);
  assert.equal(fireworksOn(new Date('2026-12-31T23:00:00')), false);
  assert.equal(fireworksOn(new Date('2027-01-01T00:31:00')), false);
});
test('放假：週末都放，國定假日只有台灣', () => {
  assert.equal(isDayOff(D('2026-10-24')), true);    // 週六
  assert.equal(isDayOff(D('2026-10-23')), false);   // 週五
  assert.equal(isDayOff(D('2026-10-26')), false);
  assert.equal(isDayOff(D('2026-10-26'), { tw: true }), true);   // 光復節 10/25 逢週日，週一補假
  assert.equal(isDayOff(D('2026-10-09'), { tw: true }), true);   // 國慶 10/10 逢週六，週五放
  assert.equal(isDayOff(D('2026-09-25'), { tw: true }), true);   // 中秋
  assert.equal(isDayOff(D('2026-06-19'), { tw: true }), true);   // 端午
  assert.equal(isDayOff(D('2026-04-03'), { tw: true }), true);   // 兒童節 4/4 逢週六提前
  assert.equal(isDayOff(D('2026-04-06'), { tw: true }), true);   // 清明 4/5 逢週日延後
  assert.equal(isDayOff(D('2026-10-27'), { tw: true }), false);
});
test('春節：小年夜到初三，碰到週末接著補', () => {
  // 2026 春節 2/17（週二）：2/15 小年夜（週日）～2/20 初三，週日那天補在 2/23（週一）
  for (const d of ['2026-02-16', '2026-02-17', '2026-02-20', '2026-02-23']) assert.equal(isTwHoliday(D(d)), true, d);
  assert.equal(isTwHoliday(D('2026-02-24')), false);
});
test('元旦逢週六：前一年 12/31 放', () => {
  assert.equal(isTwHoliday(D('2027-12-31')), true);   // 2028-01-01 是週六
});
