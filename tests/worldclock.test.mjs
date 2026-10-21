// 世界時鐘：本地放進去、時差不重複、由西到東、城市名跟語言、跨日標記
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickClocks, cityName, offsetMin, clockFace } from '../web/space/worldclock.js';

const JAN = new Date('2026-01-15T04:30:00Z');   // 台北 12:30、舊金山前一天 20:30

test('台北：本地加四個時差不同的大城市，由西到東', () => {
  const list = pickClocks({ localTz: 'Asia/Taipei', lang: 'zh', n: 5, date: JAN });
  assert.equal(list.length, 5);
  assert.deepEqual(list.map(c => c.name), ['舊金山', '紐約', '倫敦', '台北', '東京']);
  assert.equal(list.filter(c => c.local).length, 1);
  assert.equal(new Set(list.map(c => c.off)).size, 5);
});

test('本地就在清單裡（舊金山）：不重複，補下一個城市；英文名字', () => {
  const list = pickClocks({ localTz: 'America/Los_Angeles', lang: 'en', n: 5, date: JAN });
  assert.equal(list.filter(c => c.name === 'San Francisco').length, 1);
  assert.ok(list.find(c => c.name === 'San Francisco').local);
  assert.equal(list.length, 5);
});

test('宿主指定城市；清單外的時區用代碼最後一段', () => {
  const list = pickClocks({ localTz: 'Asia/Taipei', lang: 'en', n: 3, date: JAN, extra: ['Europe/Lisbon', 'Asia/Tokyo'] });
  assert.deepEqual(list.map(c => c.name), ['Lisbon', 'Taipei', 'Tokyo']);
  assert.equal(cityName('America/Argentina/Buenos_Aires', 'en'), 'Buenos Aires');
});

test('時差、白天晚上、跟本地差一天', () => {
  assert.equal(offsetMin('Asia/Taipei', JAN), 480);
  assert.equal(offsetMin('America/Los_Angeles', JAN), -480);
  const sf = clockFace('America/Los_Angeles', 'Asia/Taipei', JAN);
  assert.deepEqual(sf, { h: 20, m: 30, day: false, dayDiff: -1 });
  const tpe = clockFace('Asia/Taipei', 'Asia/Taipei', JAN);
  assert.deepEqual(tpe, { h: 12, m: 30, day: true, dayDiff: 0 });
});
