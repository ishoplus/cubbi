// 走路的路線：繞開障礙物、走不到回 null、權重抽籤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, findPath, pickWeighted } from '../web/space/path.js';

const inside = (p, r) => Math.abs(p.x - r.x) < r.w / 2 && Math.abs(p.z - r.z) < r.d / 2;

test('沒有障礙物：直接走到終點附近', () => {
  const grid = buildGrid({ hw: 200, hd: 200, rects: [] });
  const pts = findPath(grid, { x: -150, z: -150 }, { x: 150, z: 150 });
  assert.ok(pts.length >= 1 && pts.length <= 2, '拉直後只剩一兩個轉折');
  const end = pts.at(-1);
  assert.ok(Math.hypot(end.x - 150, end.z - 150) < 10);
});

test('中間一道牆只留一個缺口：路線穿過缺口、不撞牆', () => {
  const wallA = { x: 0, z: -110, w: 20, d: 180 }, wallB = { x: 0, z: 110, w: 20, d: 180 };   // 缺口在 z≈0
  const grid = buildGrid({ hw: 200, hd: 200, rects: [wallA, wallB], pad: 4 });
  const pts = findPath(grid, { x: -150, z: -150 }, { x: 150, z: -150 });
  assert.ok(pts, '找得到路');
  const full = [{ x: -150, z: -150 }, ...pts];
  for (let i = 0; i < full.length - 1; i++) for (let t = 0; t <= 1; t += 0.02) {
    const p = { x: full[i].x + (full[i + 1].x - full[i].x) * t, z: full[i].z + (full[i + 1].z - full[i].z) * t };
    assert.ok(!inside(p, wallA) && !inside(p, wallB), `第 ${i} 段撞牆：${JSON.stringify(p)}`);
  }
  assert.ok(pts.some(p => Math.abs(p.z) < 30), '有經過缺口');
});

test('完全被圍住：回 null', () => {
  const box = [{ x: 0, z: -60, w: 140, d: 10 }, { x: 0, z: 60, w: 140, d: 10 }, { x: -60, z: 0, w: 10, d: 140 }, { x: 60, z: 0, w: 10, d: 140 }];
  const grid = buildGrid({ hw: 200, hd: 200, rects: box, pad: 2 });
  assert.equal(findPath(grid, { x: 0, z: 0 }, { x: 150, z: 150 }), null);
});

test('起點在障礙物裡（坐在椅子上）：從最近的空格出發', () => {
  const grid = buildGrid({ hw: 200, hd: 200, rects: [{ x: 0, z: 0, w: 30, d: 30 }] });
  const pts = findPath(grid, { x: 0, z: 0 }, { x: 150, z: 0 });
  assert.ok(pts && pts.length);
});

test('權重抽籤：依權重落點', () => {
  const opts = [['a', 1], ['b', 3]];
  assert.equal(pickWeighted(opts, () => 0.1), 'a');
  assert.equal(pickWeighted(opts, () => 0.5), 'b');
  assert.equal(pickWeighted(opts, () => 0.9999), 'b');
});
