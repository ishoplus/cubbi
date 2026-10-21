// 日夜：照真實時間算天空、陽光、室內燈、窗外城市的燈。純函式，不依賴 three.js，可以在 Node 測試。

// 一天裡的幾個關鍵時刻，中間線性內插（顏色逐色版內插）
const KEYS = [
  { h: 0,    sky: ['#0b1530', '#1c2b4f', '#2a3550'], sun: 0,   sunColor: '#9fb8ff', hemi: 0.35, hemiSky: '#8aa0d0', hemiGround: '#2a2a35', ceiling: 1.0,  night: 1 },
  { h: 5.5,  sky: ['#0b1530', '#1c2b4f', '#2a3550'], sun: 0,   sunColor: '#9fb8ff', hemi: 0.35, hemiSky: '#8aa0d0', hemiGround: '#2a2a35', ceiling: 1.0,  night: 1 },
  { h: 6.5,  sky: ['#3a5a9a', '#f0a070', '#ffd2a0'], sun: 1.3, sunColor: '#ffb070', hemi: 0.7,  hemiSky: '#ffe2c8', hemiGround: '#5a4a3a', ceiling: 0.7,  night: 0.4 },
  { h: 8,    sky: ['#5aa6e8', '#a9d2f2', '#f3dcc0'], sun: 2.6, sunColor: '#ffd9a8', hemi: 0.85, hemiSky: '#fff1dc', hemiGround: '#5a4a3a', ceiling: 0.45, night: 0 },
  { h: 16,   sky: ['#5aa6e8', '#a9d2f2', '#f3dcc0'], sun: 2.6, sunColor: '#ffd9a8', hemi: 0.85, hemiSky: '#fff1dc', hemiGround: '#5a4a3a', ceiling: 0.45, night: 0 },
  { h: 17.5, sky: ['#4a5aa0', '#f08a5a', '#ffc080'], sun: 1.6, sunColor: '#ff9a50', hemi: 0.6,  hemiSky: '#ffd0b0', hemiGround: '#4a3a3a', ceiling: 0.8,  night: 0.35 },
  { h: 19,   sky: ['#101c3c', '#24305a', '#3a3858'], sun: 0.1, sunColor: '#9fb8ff', hemi: 0.4,  hemiSky: '#8aa0d0', hemiGround: '#2a2a35', ceiling: 1.0,  night: 0.9 },
  { h: 24,   sky: ['#0b1530', '#1c2b4f', '#2a3550'], sun: 0,   sunColor: '#9fb8ff', hemi: 0.35, hemiSky: '#8aa0d0', hemiGround: '#2a2a35', ceiling: 1.0,  night: 1 },
];

const hex = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mixColor = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const mix = (a, b, t) => a + (b - a) * t;

// h：0～24 的小時（可帶小數）
export function dayParams(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = (h - a.h) / (b.h - a.h || 1);
  // 太陽從左邊（早上）繞到右邊（傍晚），中午最高；晚上換成月光，固定在高處
  const day = Math.min(1, Math.max(0, (h - 6) / 12));
  const sunPos = a.sun + (b.sun - a.sun) * t > 0.2
    ? { x: mix(-420, 420, day), y: 140 + Math.sin(day * Math.PI) * 260, z: -420 }
    : { x: -120, y: 380, z: -300 };
  return {
    sky: a.sky.map((c, k) => mixColor(c, b.sky[k], t)),
    sun: mix(a.sun, b.sun, t), sunColor: mixColor(a.sunColor, b.sunColor, t), sunPos,
    hemi: mix(a.hemi, b.hemi, t), hemiSky: mixColor(a.hemiSky, b.hemiSky, t), hemiGround: mixColor(a.hemiGround, b.hemiGround, t),
    ceiling: mix(a.ceiling, b.ceiling, t), night: mix(a.night, b.night, t),
  };
}

// 深夜下班時段：23 點到隔天 7 點
export const isOffHours = (h) => h >= 23 || h < 7;

// 早上回來上班的時間：7:00～8:30 之間，每個人固定一個（依編號雜湊），不會一起湧進來
export function arriveHour(hashValue) { return 7 + (hashValue % 90) / 60; }
