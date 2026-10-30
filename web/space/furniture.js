// 家具與建材：工位（四級設備）、牆、地板、辦公室各種擺設、窗外城市、辦公室貓
import * as THREE from 'three';
import { at, box, canvasTexture, hash, mergeStatic, mesh, plastic, plate, roundBrick, shade, texBox } from './bricks.js';
import { screenTex } from './textures.js';
import { clockFace } from './worldclock.js';

// ── 工位：桌子、椅子、螢幕、鍵盤（以小人的位置為原點、面向 +z） ─────────────
export const SEAT_TOP = 12;
export const DESK_TOP = 25;
// 工位：椅子、桌子、螢幕各有四級（部門用積木升級），桌上小物買了就擺
// equip = { monitor, chair, desk, trinkets: { plant, lamp, figurine } }
export const EQUIP_BASE = { monitor: 1, chair: 1, desk: 1, trinkets: {} };   // 共用工作桌用的標準配備
// ── 桌上小物的款式 ──
function deskPlant(kind, x, z, flowerColor) {
  const g = new THREE.Group(); g.position.set(x, DESK_TOP, z);
  if (kind === 'succulent') {   // 多肉：矮盆＋一圈小尖葉
    g.add(at(roundBrick(2.8, 2.2, '#c49a6c'), 0, 1.1, 0));
    for (let i = 0; i < 8; i++) { const l = mesh(new THREE.ConeGeometry(0.9, 2.6, 6), '#7fb069'); const a = i / 8 * Math.PI * 2; l.position.set(Math.sin(a) * 1.3, 3, Math.cos(a) * 1.3); l.rotation.set(Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8); g.add(l); }
    g.add(at(mesh(new THREE.ConeGeometry(0.8, 2.4, 6), '#a3c97c'), 0, 3.4, 0));
    return g;
  }
  g.add(at(roundBrick(2.6, 4, kind === 'cactus' ? '#c49a6c' : '#a95500'), 0, 2, 0));
  if (kind === 'cactus') {   // 仙人掌：一根柱子兩隻手，頭上一朵小花
    g.add(at(roundBrick(1.3, 7, '#4b9f4a', 10), 0, 7.5, 0));
    for (const sx of [-1, 1]) { g.add(box(2, 1.1, 1.1, '#4b9f4a', sx * 1.6, 6.5 + sx * 0.8, 0), at(roundBrick(0.55, 2.4, '#4b9f4a', 8), sx * 2.5, 7.6 + sx * 0.8, 0)); }
    g.add(at(mesh(new THREE.SphereGeometry(0.9, 8, 6), flowerColor), 0, 11.3, 0));
  } else if (kind === 'flower') {   // 開花：一根莖、五片花瓣
    g.add(at(roundBrick(0.35, 7, '#237841', 6), 0, 7.5, 0));
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.add(at(mesh(new THREE.SphereGeometry(1.1, 8, 6), flowerColor), Math.sin(a) * 1.4, 11.2, Math.cos(a) * 1.4)); }
    g.add(at(mesh(new THREE.SphereGeometry(0.9, 8, 6), '#f2cd37'), 0, 11.4, 0));
    const leaf = box(2.6, 0.5, 1.2, '#4b9f4a', 1.3, 6.5, 0); leaf.rotation.z = 0.5; g.add(leaf);
  } else {   // 闊葉
    for (let i = 0; i < 5; i++) { const l = box(1.6, 0.8, 6, '#4b9f4a'); l.position.set(Math.sin(i * 1.3) * 1.5, 5 + i * 0.8, Math.cos(i * 1.3) * 1.5); l.rotation.set(-0.6, i * 1.3, 0, 'YXZ'); g.add(l); }
  }
  return g;
}
function deskLamp(style, color, x, z) {
  const g = new THREE.Group(); g.position.set(x, DESK_TOP, z);
  const lean = -Math.sign(x);   // 燈頭朝桌子中間彎
  g.add(at(roundBrick(3, 1, color), 0, 0.5, 0));
  const arm = box(1, 12, 1, color, lean * 1.6, 6, -1); arm.rotation.set(-0.35, 0, -lean * 0.25); g.add(arm);
  const glow = new THREE.MeshStandardMaterial({ color, emissive: '#ffd890', emissiveIntensity: 0.9, side: THREE.DoubleSide });
  const head = new THREE.Mesh(style ? new THREE.SphereGeometry(3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.ConeGeometry(3, 3.5, 14, 1, true), glow);
  head.position.set(lean * 3.4, 11, -3); head.rotation.x = style ? Math.PI - 0.5 : 0.5; head.castShadow = true; g.add(head);
  return g;
}
function deskFigurine(kind, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, DESK_TOP, z); g.rotation.y = ry;
  if (kind === 'robot') {
    g.add(box(3, 3.4, 2.2, '#a0a5a9', 0, 2.6, 0), box(2.4, 2.2, 2, '#c3c8cc', 0, 5.4, 0), box(0.4, 1.4, 0.4, '#6c6e68', 0, 7.2, 0));
    for (const sx of [-0.6, 0.6]) g.add(box(0.5, 0.5, 0.3, '#2aa6e0', sx, 5.6, 1.05));
    for (const sx of [-1, 1]) g.add(box(0.9, 0.9, 0.9, '#6c6e68', sx * 0.8, 0.45, 0), box(0.7, 2.4, 0.7, '#a0a5a9', sx * 1.9, 2.8, 0));
    g.add(at(mesh(new THREE.SphereGeometry(0.4, 8, 6), '#c91a09'), 0, 7.9, 0));
  } else if (kind === 'duck') {
    g.add(box(3.4, 2.6, 4.2, '#f2cd37', 0, 1.3, 0), box(2.2, 2.2, 2.2, '#f2cd37', 0, 3.6, 1.2), box(1.4, 0.6, 1.2, '#fe8a18', 0, 3.3, 2.7));
    for (const sx of [-0.6, 0.6]) g.add(box(0.35, 0.35, 0.2, '#1b1b1b', sx, 4, 2.3));
    g.add(box(1, 0.8, 1, '#f2cd37', 0, 2.2, -2.4));
  } else if (kind === 'cat') {
    g.add(box(2.6, 2.4, 4, '#9a7350', 0, 1.2, 0), box(2.4, 2.2, 2.2, '#9a7350', 0, 3.2, 1.6));
    for (const sx of [-0.7, 0.7]) g.add(at(mesh(new THREE.ConeGeometry(0.55, 1.1, 4), '#9a7350'), sx, 4.8, 1.6));
    const tail = box(0.6, 3, 0.6, '#9a7350', 0, 2.4, -2.2); tail.rotation.x = -0.4; g.add(tail);
  } else if (kind === 'astro') {
    g.add(box(2.6, 3, 2, '#f4f4f4', 0, 2.5, 0), box(2.4, 1, 1.2, '#f4f4f4', 0, 0.5, 0), box(1.6, 1.6, 0.8, '#a0a5a9', 0, 2.5, -1.3));
    g.add(at(mesh(new THREE.SphereGeometry(1.5, 12, 10), '#f4f4f4'), 0, 5.2, 0), at(mesh(new THREE.SphereGeometry(1.05, 10, 8), '#1b2a34'), 0, 5.2, 0.7));
  } else {   // 小恐龍
    g.add(box(3, 2.4, 5, '#4b9f4a', 0, 2.2, 0), box(2.4, 2.4, 2.6, '#4b9f4a', 0, 4.4, 2.4), box(1, 1.2, 3, '#4b9f4a', 0, 1.6, -3.4));
    for (const xx of [-1, 1]) g.add(box(0.9, 1.6, 0.9, '#237841', xx, 0.8, 0.8));
  }
  return g;
}

export function buildDesk(tint, equip = EQUIP_BASE, seed = '') {
  const g = new THREE.Group();
  const eq = { ...EQUIP_BASE, ...equip };
  // ── 椅子 ──
  if (eq.chair === 0) {   // 圓板凳
    g.add(at(roundBrick(7, 3, '#aa7d55'), 0, SEAT_TOP - 1.5, 2));
    g.add(at(roundBrick(1.4, SEAT_TOP - 3, '#6c6e68'), 0, (SEAT_TOP - 3) / 2, 2));
    g.add(at(roundBrick(6, 1.2, '#6c6e68'), 0, 0.6, 2));
  } else {
    const seatColor = eq.chair === 3 ? '#1b1b1b' : '#6c6e68';
    const seat = plate(2, 2, 3.2, seatColor, false); seat.position.set(0, SEAT_TOP - 3.2, 2); g.add(seat);
    g.add(box(4, SEAT_TOP - 3.2, 4, '#3a3f44', 0, (SEAT_TOP - 3.2) / 2, 2));
    g.add(box(14, 2.4, 14, '#3a3f44', 0, 1.2, 2));
    if (eq.chair === 1) g.add(box(16, 14, 3.2, '#6c6e68', 0, SEAT_TOP + 7, -7.6));
    if (eq.chair === 2) {   // 人體工學椅：高椅背＋頭枕＋扶手
      g.add(box(16, 22, 2.4, '#2c3238', 0, SEAT_TOP + 11, -7.6));
      g.add(box(12, 5, 3, '#2c3238', 0, SEAT_TOP + 25, -7.2));
      for (const x of [-9, 9]) g.add(box(2.4, 2, 11, '#3a3f44', x, SEAT_TOP + 6, 0), box(1.6, 6, 1.6, '#3a3f44', x, SEAT_TOP + 2.5, -4));
    }
    if (eq.chair === 3) {   // 電競椅：賽車座椅、兩側翼、紅色條紋
      g.add(box(17, 28, 3.2, '#1b1b1b', 0, SEAT_TOP + 14, -7.6));
      for (const x of [-8, 8]) g.add(box(3, 20, 5, '#c91a09', x, SEAT_TOP + 12, -6.4));
      g.add(box(4, 26, 0.6, '#c91a09', 0, SEAT_TOP + 14, -5.9));
      g.add(box(10, 5, 3, '#c91a09', 0, SEAT_TOP + 23, -5.6));
      for (const x of [-9.5, 9.5]) g.add(box(2.4, 2, 11, '#1b1b1b', x, SEAT_TOP + 6, 0));
    }
  }
  // ── 桌子（桌面頂端在 DESK_TOP，z 10～26）──
  if (eq.desk === 0) {   // 折疊桌：薄桌面、細鐵腳
    g.add(box(32, 1.6, 16, '#c8c2b6', 0, DESK_TOP - 0.8, 18));
    for (const x of [-14, 14]) for (const z of [11.5, 24.5]) g.add(at(roundBrick(0.8, DESK_TOP - 1.6, '#6c6e68', 8), x, (DESK_TOP - 1.6) / 2, z));
  } else if (eq.desk === 1) {
    const top = plate(4, 2, 3.2, tint, false); top.position.set(0, DESK_TOP - 3.2, 18); g.add(top);
    for (const x of [-13, 13]) g.add(box(6, DESK_TOP - 3.2, 4, shade(tint, 0.8), x, (DESK_TOP - 3.2) / 2, 23));
  } else if (eq.desk === 2) {   // 升降桌：深色木面、T 型鐵腳、控制鈕
    g.add(box(32, 2.4, 16, '#5a3a22', 0, DESK_TOP - 1.2, 18));
    for (const x of [-12, 12]) g.add(box(3, DESK_TOP - 2.4, 3, '#a0a5a9', x, (DESK_TOP - 2.4) / 2, 19), box(3, 1.6, 16, '#a0a5a9', x, 0.8, 18));
    g.add(box(4, 1.2, 2, '#1b1b1b', 12, DESK_TOP - 2.6, 10.6));
  } else {   // 主管桌：厚木面、前擋板、抽屜櫃、皮革桌墊、名牌
    g.add(box(34, 3.2, 17, '#3a2414', 0, DESK_TOP - 1.6, 18));
    g.add(box(32, DESK_TOP - 3.2, 2, '#4a2e1a', 0, (DESK_TOP - 3.2) / 2, 25.5));
    g.add(box(10, DESK_TOP - 3.2, 14, '#4a2e1a', 11, (DESK_TOP - 3.2) / 2, 18));
    for (const y of [6, 13]) g.add(box(4, 1, 0.6, '#c9a227', 11, y, 10.8));
    g.add(box(16, 0.4, 9, '#2f5a3a', 0, DESK_TOP + 0.2, 14));
    g.add(box(7, 2, 1.2, '#c9a227', -11, DESK_TOP + 1, 11.5));
  }
  // 鍵盤
  g.add(box(14, 1.2, 4.5, '#2c3238', 0, DESK_TOP + 0.6, 12.5));
  // ── 螢幕（同一個材質，畫面動畫一起動）──
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex('off').clone(), toneMapped: false });
  const screenAt = (w, h, x, y, z, ry = 0) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
    s.position.set(x, y, z); s.rotation.y = Math.PI + ry; g.add(s);
  };
  if (eq.monitor === 0) {   // 老 CRT：米色大屁股
    g.add(box(17, 14, 15, '#d8cfb8', 0, DESK_TOP + 8, 21));
    g.add(box(12, 4, 8, '#cfc5ab', 0, DESK_TOP + 8, 28.5));
    screenAt(12.5, 9.5, 0, DESK_TOP + 8.5, 13.45);
  } else if (eq.monitor === 1) {
    g.add(box(4, 3.4, 3, '#2c3238', 0, DESK_TOP + 1.7, 22.5));
    g.add(box(2, 6, 1.6, '#2c3238', 0, DESK_TOP + 5, 22.5));
    g.add(box(20, 14, 1.8, '#2c3238', 0, DESK_TOP + 13, 21.4));
    screenAt(18, 12, 0, DESK_TOP + 13, 20.45);
  } else if (eq.monitor === 2) {   // 雙螢幕：兩台微微內折
    for (const sx of [-1, 1]) {
      const m = new THREE.Group(); m.position.set(sx * 8.6, 0, 20.6); m.rotation.y = sx * 0.3;   // 外緣朝人內折
      m.add(box(16, 11.5, 1.6, '#2c3238', 0, DESK_TOP + 12, 0), box(1.8, 6, 1.4, '#2c3238', 0, DESK_TOP + 4, 1));
      const s = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 10), screenMat); s.position.set(0, DESK_TOP + 12, -0.85); s.rotation.y = Math.PI; m.add(s);
      g.add(m);
    }
    g.add(box(10, 1.2, 4, '#2c3238', 0, DESK_TOP + 0.6, 22.5));
  } else {   // 曲面寬螢幕：三段拼成弧形
    for (const [x, ry, w] of [[-10.4, -0.4, 8], [0, 0, 13.4], [10.4, 0.4, 8]]) {   // 兩側往人彎
      const m = new THREE.Group(); m.position.set(x, 0, 21.4 - Math.abs(ry) * 3.9); m.rotation.y = ry;   // 兩側往前收，跟中間那段接上
      m.add(box(w + 0.4, 12, 1.6, '#1b1b1b', 0, DESK_TOP + 13, 0));
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 10.6), screenMat); s.position.set(0, DESK_TOP + 13, -0.85); s.rotation.y = Math.PI; m.add(s);
      g.add(m);
    }
    g.add(box(4, 3, 3, '#1b1b1b', 0, DESK_TOP + 1.5, 23), box(2, 6, 1.6, '#1b1b1b', 0, DESK_TOP + 5, 23));
  }
  // ── 桌上小物 ──
  // 部門買的是「種類」，每個人擺自己的款式與位置（依人物編號固定，重新整理也不會變）
  const tr = eq.trinkets || {};
  if (tr.plant || tr.lamp || tr.figurine) {
    let h = hash(seed + ':desk');
    const pick = (n) => { const v = h % n; h = Math.floor(h / n) + 7919; return v; };
    const side = pick(2) ? 1 : -1;                    // 檯燈放哪一邊，盆栽放另一邊
    // 螢幕窄（CRT、單螢幕）時檯燈盆栽放後方兩角；雙螢幕、曲面螢幕幾乎占滿桌寬，放後面會被擋住，改放前方兩側
    const wide = eq.monitor >= 2;
    const spot = (s) => wide ? [14.5 * s, 16] : [13 * s, 23.5];
    if (tr.plant) {
      const kind = ['leafy', 'cactus', 'flower', 'succulent'][pick(4)];
      g.add(deskPlant(kind, ...spot(-side), ['#e4adc8', '#c91a09', '#f2cd37', '#f4f4f4', '#923978'][pick(5)]));
    }
    if (tr.lamp) g.add(deskLamp(pick(2), ['#1b2a34', '#f4f4f4', '#f2cd37', '#c91a09', '#0055bf'][pick(5)], ...spot(side)));
    if (tr.figurine) {
      // 公仔坐在螢幕頂上：不佔桌面、哪個角度都看得到
      const fs = pick(2) ? 1 : -1;
      const top = [[fs * 4, 15, 20], [fs * 5, 20, 21.4], [fs * 8.6, 17.75, 20.6], [fs * 10.4, 19, 19.9]][eq.monitor];
      const f = deskFigurine(['dino', 'robot', 'duck', 'cat', 'astro'][pick(5)], top[0], top[2], Math.PI + (pick(7) - 3) * 0.25);
      f.position.y = DESK_TOP + top[1];
      f.scale.setScalar(0.85);
      g.add(f);
    }
  }
  // 點選用的隱形範圍（手機上小人很小，點不準）
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 48, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 24, 8);
  hit.userData.keep = true;
  g.add(hit);
  mergeStatic(g);
  return { group: g, screenMat, hit, screenKind: 'off' };
}


// 地板：木地板，一條條 2×12 的長板交錯鋪
export function floorMat(w, d, woods = ['#8a6440', '#946c45', '#7f5b3a', '#9a7350', '#866040']) {
  const map = canvasTexture(256, 256, (g) => {
    for (let col = 0; col < 8; col++) {
      const off = (col % 3) * 64;
      for (let y = -off, k = 0; y < 256; y += 192, k++) {
        g.fillStyle = woods[(col * 3 + k) % woods.length]; g.fillRect(col * 32, y, 32, 192);
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(col * 32 + 2, y + 2, 28, 4);
        g.strokeStyle = 'rgba(30,18,8,.35)'; g.lineWidth = 2; g.strokeRect(col * 32 + 1, y + 1, 30, 190);
      }
    }
  }, w / 128, d / 128);
  return new THREE.MeshPhysicalMaterial({ map, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.25 });
}
// 磚牆：1×4 長磚交錯堆疊
export function brickMat(len, h, color) {
  const map = canvasTexture(256, 154, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, 256, 154);
    g.strokeStyle = 'rgba(0,0,0,.13)'; g.lineWidth = 2;
    for (let r = 0; r < 4; r++) {
      const y = r * 38.5;
      g.beginPath(); g.moveTo(0, y + 1); g.lineTo(256, y + 1); g.stroke();
      for (let x = (r % 2) * 64; x < 256; x += 128) { g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + 1, y + 38.5); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y + 3, 256, 3);
    }
  }, len / 64, h / 38.4);
  return new THREE.MeshPhysicalMaterial({ map, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.2 });
}
export const WALL_H = 128, SILL = 34, LINTEL = 100;
export const glassMat = new THREE.MeshPhysicalMaterial({ color: '#cfe9ff', transparent: true, opacity: 0.16, roughness: 0.05, clearcoat: 1, depthWrite: false });
// 一面牆：沿 x 軸、內側朝 +z；有窗的話下段實牆、上段橫樑，中間是窗與柱子
export function wall(len, windows, color) {
  const g = new THREE.Group();
  if (!windows) { g.add(texBox(len, WALL_H, 8, brickMat(len, WALL_H, color), 0, WALL_H / 2, 0)); return g; }
  g.add(texBox(len, SILL, 8, brickMat(len, SILL, color), 0, SILL / 2, 0));
  g.add(texBox(len, WALL_H - LINTEL, 8, brickMat(len, WALL_H - LINTEL, color), 0, (WALL_H + LINTEL) / 2, 0));
  const winW = 56, pillar = 24, n = Math.max(1, Math.floor((len - pillar) / (winW + pillar)));
  const span = n * winW + (n + 1) * pillar, x0 = -len / 2;
  const edge = (len - span) / 2 + pillar;
  const ph = LINTEL - SILL, py = (SILL + LINTEL) / 2;
  g.add(texBox(edge, ph, 8, brickMat(edge, ph, color), x0 + edge / 2, py, 0));
  g.add(texBox(edge, ph, 8, brickMat(edge, ph, color), -x0 - edge / 2, py, 0));
  for (let i = 0; i < n; i++) {
    const cx = x0 + edge + i * (winW + pillar) + winW / 2;
    if (i < n - 1) g.add(texBox(pillar, ph, 8, brickMat(pillar, ph, color), cx + winW / 2 + pillar / 2, py, 0));
    // 窗框＋玻璃
    g.add(box(winW, 2.4, 10, '#f4f4f4', cx, SILL + 1.2, 0), box(winW, 2.4, 10, '#f4f4f4', cx, LINTEL - 1.2, 0));
    g.add(box(2, ph, 6, '#f4f4f4', cx, py, 0));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW, ph), glassMat);
    pane.position.set(cx, py, 0); g.add(pane);
  }
  return g;
}
// 牆上的白板：畫幾條折線圖和便利貼
export function whiteboard() {
  const g = new THREE.Group();
  g.add(box(72, 44, 2, '#a0a5a9', 0, 0, 0));
  const map = canvasTexture(288, 168, (c) => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, 288, 168);
    c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = '#0055bf'; c.beginPath(); c.moveTo(20, 130); c.lineTo(70, 100); c.lineTo(110, 112); c.lineTo(160, 60); c.lineTo(200, 40); c.stroke();
    c.strokeStyle = '#c91a09'; c.beginPath(); c.moveTo(20, 140); c.lineTo(80, 128); c.lineTo(140, 132); c.lineTo(200, 96); c.stroke();
    c.strokeStyle = '#1b2a34'; c.lineWidth = 3; c.beginPath(); c.moveTo(16, 20); c.lineTo(16, 148); c.lineTo(214, 148); c.stroke();
    for (const [x, y, col] of [[230, 24, '#f2cd37'], [252, 60, '#a5ca18'], [228, 100, '#e4adc8']]) {
      c.fillStyle = col; c.fillRect(x, y, 34, 30); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x + 5, y + 9, 22, 3); c.fillRect(x + 5, y + 17, 16, 3);
    }
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(68, 40), new THREE.MeshStandardMaterial({ map, roughness: 0.25 }));
  face.position.z = 1.05; g.add(face);
  g.add(box(30, 2, 4, '#a0a5a9', 0, -23, 2));
  return g;
}
// 牆上的時鐘：指針跟著現在的時間走
// 世界時鐘：一排圓鐘，本地那個大一號、黃框；底下各掛一塊名牌。白天白鐘面、晚上深藍鐘面
// specs：[{ tz, name, local }]（worldclock.js 的 pickClocks），由西到東；dayLabel(差幾天) → 「昨天」「明天」
let clocks = [], dayLabelOf = (d) => (d > 0 ? '+' : '−') + Math.abs(d);
export function worldClocks(specs, localTz, dayLabel) {
  if (dayLabel) dayLabelOf = dayLabel;
  const g = new THREE.Group();
  clocks = [];
  const sizes = specs.map(s => (s.local ? 13 : 9.5));
  const total = sizes.reduce((a, r) => a + r * 2 + 8, -8);
  let x = -total / 2;
  specs.forEach((spec, i) => {
    const r = sizes[i];
    x += r;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 3, 32), plastic(spec.local ? '#f2cd37' : '#1b2a34'));
    rim.rotation.x = Math.PI / 2; rim.position.x = x; g.add(rim);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
    face.position.set(x, 0, 1.6); g.add(face);
    // 名牌：本地黃底黑字，其他深底白字
    const pc = document.createElement('canvas'); pc.width = 256; pc.height = 64;
    const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
    const pw = Math.max(20, r * 2 + 4);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw / 4), new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.5 }));
    plaque.position.set(x, -r - 2 - pw / 8, 1); g.add(plaque);
    clocks.push({ spec, localTz, tex, ptex, key: '', pkey: '' });
    x += r + 8;
  });
  drawClock();
  return g;
}
export function drawClock() {
  for (const c of clocks) {
    const f = clockFace(c.spec.tz, c.localTz);
    const key = `${f.h}:${f.m}`;
    if (key !== c.key) {
      c.key = key;
      const g = c.tex.image.getContext('2d');
      const ink = f.day ? '#1b2a34' : '#f4f4f4';
      g.fillStyle = f.day ? '#f4f4f4' : '#1b2a4a'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = ink; g.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 ? 3 : 6;
        g.beginPath(); g.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); g.lineTo(64 + Math.sin(a) * 58, 64 - Math.cos(a) * 58); g.stroke();
      }
      const m = f.h * 60 + f.m;
      const hand = (a, len, w) => { g.strokeStyle = ink; g.lineWidth = w; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len); g.stroke(); };
      hand(((m / 60) % 12) / 12 * Math.PI * 2, 30, 7);
      hand((m % 60) / 60 * Math.PI * 2, 44, 4);
      g.fillStyle = '#c91a09'; g.beginPath(); g.arc(64, 64, 5, 0, Math.PI * 2); g.fill();
      c.tex.needsUpdate = true;
    }
    // 名牌：跟本地不同天時註明（昨天／明天）
    const label = c.spec.name + (f.dayDiff ? ' ' + dayLabelOf(f.dayDiff) : '');
    if (label !== c.pkey) {
      c.pkey = label;
      const g = c.ptex.image.getContext('2d');
      g.fillStyle = c.spec.local ? '#f2cd37' : '#1b2a34'; g.fillRect(0, 0, 256, 64);
      g.fillStyle = c.spec.local ? '#1b2a34' : '#f4f4f4';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 40; g.font = `700 ${size}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
      while (g.measureText(label).width > 236 && size > 18) { size -= 2; g.font = `700 ${size}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`; }
      g.fillText(label, 128, 34);
      c.ptex.needsUpdate = true;
    }
  }
}
// ── 家具（原點在地上、正面朝 +z）──
export function plant(big) {
  const g = new THREE.Group();
  const s = big ? 1.4 : 1;
  g.add(at(roundBrick(8 * s, 14 * s, '#a95500'), 0, 7 * s, 0));
  g.add(at(roundBrick(8.6 * s, 2.4, '#7c3c06'), 0, 14 * s, 0));
  const greens = ['#237841', '#4b9f4a', '#a5ca18'];
  for (let i = 0; i < (big ? 9 : 6); i++) {
    const a = i / (big ? 9 : 6) * Math.PI * 2;
    const leaf = box(4.5 * s, 2.2, 16 * s, greens[i % 3]);
    leaf.position.set(Math.sin(a) * 5 * s, (18 + (i % 3) * 7) * s, Math.cos(a) * 5 * s);
    leaf.rotation.set(-0.7 + (i % 2) * 0.25, a, 0, 'YXZ');
    g.add(leaf);
  }
  g.add(at(roundBrick(1.6, 24 * s, '#237841'), 0, 22 * s, 0));
  return g;
}
export function bookshelf() {
  const g = new THREE.Group();
  const wood = '#958a73', books = ['#c91a09', '#0055bf', '#f2cd37', '#237841', '#f4f4f4', '#1b2a34', '#fe8a18', '#923978'];
  g.add(box(40, 3.2, 14, wood, 0, 1.6, 0));
  for (const x of [-18.4, 18.4]) g.add(box(3.2, 76, 14, wood, x, 38, 0));
  g.add(box(40, 2.4, 2, wood, 0, 38, -6));
  let k = 0;
  for (const y of [3.2, 27.2, 51.2]) {
    g.add(box(34, 2.4, 13, wood, 0, y + 1.2, 0));
    let x = -15;
    while (x < 13) {
      const w = 2.4 + (k * 7 % 3), h = 14 + (k * 5 % 6);
      g.add(box(w, h, 10, books[k++ % books.length], x + w / 2, y + 2.4 + h / 2, 0.5));
      x += w + 0.3;
    }
  }
  g.add(box(40, 3.2, 14, wood, 0, 77.6, 0));
  return g;
}
export function cooler() {
  const g = new THREE.Group();
  g.add(box(16, 34, 16, '#f4f4f4', 0, 17, 0));
  g.add(box(3, 3, 2, '#c91a09', -3, 26, 8.4), box(3, 3, 2, '#0055bf', 3, 26, 8.4));
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 18, 20), new THREE.MeshPhysicalMaterial({ color: '#7cc4ff', transparent: true, opacity: 0.55, roughness: 0.05, clearcoat: 1 }));
  bottle.position.y = 44; g.add(bottle);
  return g;
}
// 飲料冰箱（咖啡吧最高級時取代飲水機）：黑色機身、玻璃門、裡面亮燈，一層層瓶裝水和罐裝飲料
export function drinkFridge() {
  const g = new THREE.Group();
  // 中空櫃體：背板、兩側、頂、底，裡面才看得到
  g.add(box(18, 1.6, 16, '#1b1b1b', 0, 57.2, 0), box(18, 5, 16, '#1b1b1b', 0, 2.5, 0));
  for (const x of [-8.2, 8.2]) g.add(box(1.6, 58, 16, '#1b1b1b', x, 29, 0));
  g.add(box(18, 58, 1.2, '#1b1b1b', 0, 29, -7.4));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 51), new THREE.MeshBasicMaterial({ color: '#eaf4ff' }));   // 背面燈箱
  glow.position.set(0, 30.5, -6.7); g.add(glow);
  const shelves = [[14, ['#7cc4ff', '#7cc4ff', '#7cc4ff', '#7cc4ff']], [26, ['#c91a09', '#f2cd37', '#237841', '#c91a09']], [38, ['#3a1f10', '#e4cd9e', '#3a1f10', '#e4cd9e']], [50, ['#f2a8c4', '#a3d48c', '#f9ba61', '#0055bf']]];
  for (const [y, cs] of shelves) {
    g.add(box(14.8, 0.6, 13, '#c3c8cc', 0, y - 1, 0));
    cs.forEach((c, i) => {
      const x = -5.4 + i * 3.6, tall = y === 14;
      g.add(at(roundBrick(1.3, tall ? 7 : 4.6, c, 12), x, y + (tall ? 3.2 : 2), 1));
      if (tall) g.add(at(roundBrick(0.6, 1.4, '#f4f4f4', 8), x, y + 7.4, 1));
    });
  }
  const glass = new THREE.Mesh(new THREE.BoxGeometry(16, 52, 0.5), new THREE.MeshPhysicalMaterial({ color: '#dfeef5', transparent: true, opacity: 0.22, roughness: 0.03, clearcoat: 1 }));
  glass.position.set(0, 30.5, 7.6); g.add(glass);
  g.add(box(0.9, 18, 1.4, '#c9a227', 6.6, 32, 9));   // 黃銅把手
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.4), new THREE.MeshBasicMaterial({ color: '#ffd36b' }));
  sign.position.set(0, 56.6, 8.1); g.add(sign);
  return g;
}
// 零食櫃（咖啡吧最高級時放在飲料冰箱旁）：胡桃木開放層架，餅乾罐、糖果罐、洋芋片、水果籃
export function snackShelf() {
  const g = new THREE.Group();
  const wood = '#5a3210', dark = '#3a1f10';
  g.add(box(40, 2, 14, dark, 0, 1, 0), box(40, 2, 14, dark, 0, 55, 0));
  for (const x of [-19.5, 19.5]) g.add(box(1.6, 54, 14, wood, x, 28, 0));
  g.add(box(40, 54, 1, dark, 0, 28, -6.6));
  for (const y of [14, 28, 42]) g.add(box(38, 1.4, 13, wood, 0, y, 0));
  // 最上層：三個玻璃糖果罐（彩色糖果＋木蓋）
  const jar = new THREE.MeshPhysicalMaterial({ color: '#e9f3f7', transparent: true, opacity: 0.3, roughness: 0.03, clearcoat: 1 });
  [['#c91a09', '#f2cd37'], ['#f2a8c4', '#a3d48c'], ['#0055bf', '#f9ba61']].forEach(([a, b], i) => {
    const x = -12 + i * 12;
    const j = mesh(new THREE.CylinderGeometry(4, 4, 9, 16), null, jar); j.position.set(x, 47.2, 1); g.add(j);
    for (let k = 0; k < 16; k++) { const c = mesh(new THREE.SphereGeometry(1.15, 8, 6), k % 2 ? a : b); const r = k < 8 ? 2.6 : 1.4; c.position.set(x + Math.cos(k * 1.7) * r, 43.6 + Math.floor(k / 4) * 1.5, 1 + Math.sin(k * 1.7) * r); g.add(c); }
    g.add(at(roundBrick(4.3, 1.4, '#aa7d55', 16), x, 52.4, 1));
  });
  // 第三層：餅乾罐兩個＋一排巧克力
  for (const x of [-11, 1]) { g.add(at(roundBrick(4.2, 8, '#e4cd9e', 16), x, 33, 1)); g.add(at(roundBrick(4.4, 1.4, '#c91a09', 16), x, 37.6, 1)); g.add(at(roundBrick(1.8, 0.5, '#8a5530', 10), x, 38.5, 1)); }
  for (let i = 0; i < 4; i++) { const b = box(3, 6, 1.2, ['#720e0f', '#3a1f10', '#0a3463', '#237841'][i], 10 + i * 2.6, 32, 2 + (i % 2)); b.rotation.x = -0.2; g.add(b); }
  // 第二層：洋芋片（鼓鼓的袋子）
  ['#f2cd37', '#c91a09', '#0055bf', '#237841', '#f9ba61'].forEach((c, i) => {
    const bag = box(5.6, 9, 2.6, c, -14 + i * 7, 19.8, 1.5); bag.rotation.z = (i % 2 ? 1 : -1) * 0.1; bag.rotation.x = -0.15; g.add(bag);
    g.add(box(2.6, 2.6, 0.3, '#f4f4f4', -14 + i * 7, 20.4, 3));   // 袋子上的標籤
    g.add(box(4.8, 1, 1.4, shade(c, 0.8), -14 + i * 7, 25.4, 1.5));
  });
  // 最下層：藤編水果籃（蘋果、橘子、香蕉）
  for (const x of [-9, 9]) {
    g.add(at(roundBrick(7, 4, '#c79a5b', 18), x, 4.8, 1));
    const fruit = x < 0 ? [['#c91a09', -2, 0], ['#c91a09', 2.4, 1], ['#a3d48c', 0, -2]] : [['#f08a24', -2, 0], ['#f08a24', 2.4, 1], ['#f08a24', 0, -2]];
    for (const [c, dx, dz] of fruit) { const f = mesh(new THREE.SphereGeometry(2.2, 12, 10), c); f.position.set(x + dx, 8.6, 1 + dz); g.add(f); }
  }
  const banana = mesh(new THREE.TorusGeometry(3.4, 0.9, 6, 12, Math.PI * 0.8), '#f2cd37'); banana.position.set(9, 11.6, 3); banana.rotation.z = Math.PI * 1.1; g.add(banana);
  return g;
}
// 咖啡吧：0 手沖壺＋濾杯、1 義式咖啡機、2 精品吧台（咖啡師另外放）
const marbleMat = new THREE.MeshPhysicalMaterial({
  map: canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#f2efe9'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `rgba(120,110,100,${0.12 + (i % 3) * 0.08})`; g.lineWidth = 1 + (i % 2);
      g.beginPath(); let x = (i * 37) % w, y = 0; g.moveTo(x, y);
      while (y < h) { x += Math.sin(i * 3 + y * 0.08) * 9 + 4; y += 10; g.lineTo(x, y); }
      g.stroke();
    }
  }),
  roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05,
});
const chromeMat = new THREE.MeshPhysicalMaterial({ color: '#d7dde2', metalness: 0.9, roughness: 0.18 });
const brassMat = new THREE.MeshPhysicalMaterial({ color: '#c9a227', metalness: 0.85, roughness: 0.28, clearcoat: 0.5 });
const metal = (geo, mat, x, y, z) => { const m = mesh(geo, null, mat); m.position.set(x, y, z); return m; };
function premiumBar(g) {
  // 檯身：深胡桃木直條紋＋黃銅腳踏桿，上面一整塊大理石
  g.add(box(58, 26, 18, '#3a1f10', 0, 13, 0));
  for (let x = -24; x <= 24; x += 6) g.add(box(2.2, 22, 0.6, '#5a3210', x, 14, 9.1));
  g.add(metal(new THREE.BoxGeometry(60, 1.2, 1.2), brassMat, 0, 26, 9.4));
  const rail = metal(new THREE.CylinderGeometry(0.8, 0.8, 58, 10), brassMat, 0, 5, 11.5); rail.rotation.z = Math.PI / 2; g.add(rail);
  g.add(texBox(62, 2.6, 21, marbleMat, 0, 27.3, 0));
  // 雙孔義式咖啡機：鉻殼、黃銅頂、兩支把手、蒸汽管
  g.add(metal(new THREE.BoxGeometry(22, 14, 12), chromeMat, -14, 35.6, -2));
  g.add(metal(new THREE.BoxGeometry(22.4, 1.2, 12.4), brassMat, -14, 43.2, -2));
  g.add(box(18, 3, 0.4, '#1b1b1b', -14, 39, 4.1));
  for (const x of [-19, -9]) {
    g.add(metal(new THREE.CylinderGeometry(1.6, 1.6, 2, 12), chromeMat, x, 32.8, 5));
    const h = box(1, 1, 5, '#1b1b1b', x, 32, 8); h.rotation.x = 0.15; g.add(h);
    g.add(at(roundBrick(1.3, 2, '#f4f4f4', 12), x, 29.6, 5.5));
  }
  const wand = metal(new THREE.CylinderGeometry(0.4, 0.4, 8, 8), chromeMat, -2.4, 33, 4); wand.rotation.z = 0.25; g.add(wand);
  for (let i = 0; i < 3; i++) g.add(at(roundBrick(1.4, 1.6, '#f4f4f4', 12), -16 + i * 3.4, 45.6, -4));   // 機頂暖杯
  // 磨豆機：黑機身＋透明豆倉
  g.add(box(6, 12, 7, '#1b1b1b', 4, 34.6, -3));
  g.add(metal(new THREE.CylinderGeometry(3, 1.8, 6, 14), new THREE.MeshPhysicalMaterial({ color: '#7a4a24', transparent: true, opacity: 0.7, roughness: 0.05, clearcoat: 1 }), 4, 43.6, -3));
  // 金邊杯盤、手沖壺
  for (const x of [12, 18]) { g.add(at(roundBrick(2.6, 0.5, '#f4f4f4', 16), x, 28.9, 4)); g.add(at(roundBrick(1.6, 2.4, '#f4f4f4', 12), x, 30.4, 4)); g.add(metal(new THREE.TorusGeometry(1.6, 0.15, 6, 16), brassMat, x, 31.6, 4).rotateX(Math.PI / 2)); }
  g.add(metal(new THREE.CylinderGeometry(2.4, 3, 5, 14), brassMat, 24, 31, -3));
  const sp = metal(new THREE.CylinderGeometry(0.3, 0.5, 6, 6), brassMat, 27, 33.5, -3); sp.rotation.z = -0.8; g.add(sp);
  // 牆上：黑板菜單＋金框，下面一層胡桃木架擺豆罐
  g.add(box(32, 22, 1.6, '#1b1b1b', 10, 62, -8.5));
  for (const [w, y] of [[33.4, 73], [33.4, 51]]) g.add(metal(new THREE.BoxGeometry(w, 1, 2), brassMat, 10, y, -8.5));
  for (const x of [-6.2, 26.2]) g.add(metal(new THREE.BoxGeometry(1, 22, 2), brassMat, x, 62, -8.5));
  for (let i = 0; i < 4; i++) g.add(box(18 - (i % 2) * 6, 1.4, 0.4, i ? '#f4f4f4' : '#d4a017', 6 - (i % 2) * 3, 68 - i * 4, -7.6));
  g.add(box(QUOTA_SHELF.w, 1.6, 7, '#3a1f10', QUOTA_SHELF.x, QUOTA_SHELF.y - 0.8, QUOTA_SHELF.z));   // 豆罐層架（罐子是額度，main 另外放）
}
export function coffeeBar(lv = 1) {
  const g = new THREE.Group();
  if (lv >= 2) { premiumBar(g); return g; }
  g.add(box(56, 26, 18, '#582a12', 0, 13, 0));
  g.add(box(58, 3.2, 20, '#e4cd9e', 0, 27.6, 0));
  if (lv === 0) {
    g.add(at(roundBrick(3.4, 7, '#a0a5a9'), -16, 32.7, 0));
    const spout = box(1, 1, 6, '#a0a5a9', -16, 34, 4); spout.rotation.x = -0.6; g.add(spout);
    g.add(at(mesh(new THREE.ConeGeometry(3.4, 4, 16, 1, true), '#f4f4f4'), -6, 36, 0), at(roundBrick(2.4, 4, '#f4f4f4'), -6, 31.4, 0));
  } else {
    g.add(box(14, 18, 12, '#1b2a34', -14, 38.2, -1));
    g.add(box(10, 2, 4, '#6c6e68', -14, 33, 5));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4030' }));
    led.position.set(-10, 44, 5.2); g.add(led);
  }
  for (const [x, c] of [[4, '#f4f4f4'], [10, '#c91a09'], [16, '#f4f4f4']]) g.add(at(roundBrick(2.2, 4.4, c), x, 31.4, 2));
  // 牆上的豆罐層架：木板＋兩支托架
  g.add(box(QUOTA_SHELF.w, 1.6, 7, '#582a12', QUOTA_SHELF.x, QUOTA_SHELF.y - 0.8, QUOTA_SHELF.z));
  for (const dx of [-13, 13]) g.add(box(1.2, 4, 1.2, '#1b2a34', QUOTA_SHELF.x + dx, QUOTA_SHELF.y - 3.6, QUOTA_SHELF.z - 2));
  return g;
}

// ── 額度豆罐：咖啡吧牆上層架的一組罐子，Claude（橘蓋）、Codex（綠蓋）、Grok（黑蓋）各一組 ──────────
// 高瘦的是豆槽＝5 小時額度，矮胖的是存貨罐＝每週額度；豆子剩多少就是額度還剩多少。只有每週額度的（Grok）只擺存貨罐。
// 原點在層架上、罐子中間；userData.set(5 小時剩幾成, 每週剩幾成) 設定目標，tick(dt) 讓豆子慢慢升降
export const QUOTA_SHELF = { x: -24.5, y: 52.8, z: -6, w: 36 };
let beanMat = null;
export function quotaJars(color, { weeklyOnly = false } = {}) {
  beanMat ||= new THREE.MeshStandardMaterial({ roughness: 0.55, map: canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#2e1709'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = (i * 23) % w, y = (i * 37 + (i % 3) * 7) % h;
      g.fillStyle = ['#7a3f16', '#4a230c', '#93531f'][i % 3];
      g.beginPath(); g.ellipse(x, y, 5, 3.2, i, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(20,10,4,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 3 * Math.cos(i), y - 3 * Math.sin(i)); g.lineTo(x + 3 * Math.cos(i), y + 3 * Math.sin(i)); g.stroke();
    }
  }, 1, 2) });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e6eef2', transparent: true, opacity: 0.16, roughness: 0.03, clearcoat: 1, depthWrite: false });
  const g = new THREE.Group();
  const jar = (r, h, x) => {
    const shell = mesh(new THREE.CylinderGeometry(r, r, h, 20, 1, true), null, glass); shell.position.set(x, h / 2, 0); shell.castShadow = false;
    const bottom = at(roundBrick(r, 0.6, '#c3c8cc', 20), x, 0.3, 0);
    const lid = at(roundBrick(r + 0.35, 1.4, color, 20), x, h + 0.7, 0);
    const knob = at(roundBrick(r * 0.35, 1, color, 12), x, h + 1.9, 0);
    const geo = new THREE.CylinderGeometry(r - 0.35, r - 0.35, 1, 20); geo.translate(0, 0.5, 0);
    const beans = mesh(geo, null, beanMat); beans.position.set(x, 0.6, 0);
    g.add(bottom, beans, shell, lid, knob);
    return { beans, full: h - 0.8, cur: 1, want: 1 };
  };
  const jars = weeklyOnly ? [jar(3, 7.5, 0)] : [jar(2.3, 13, -3.2), jar(3, 7.5, 3.4)];
  g.userData.width = weeklyOnly ? 7 : 12.4;
  const show = (j) => { j.beans.scale.y = Math.max(0.001, j.full * j.cur); j.beans.visible = j.cur > 0.004; };
  jars.forEach(show);
  g.userData.set = (hopper, stock) => { if (weeklyOnly) jars[0].want = stock; else { jars[0].want = hopper; jars[1].want = stock; } };
  g.userData.snap = () => { for (const j of jars) { j.cur = j.want; show(j); } };
  g.userData.tick = (dt) => {
    for (const j of jars) {
      if (Math.abs(j.want - j.cur) < 0.002) continue;
      j.cur += (j.want - j.cur) * (1 - Math.pow(0.3, dt));   // 慢慢倒進去、慢慢少下去，不跳
      show(j);
    }
  };
  g.traverse(o => { o.userData.keep = true; });
  return g;
}
export function sofa(color) {
  const g = new THREE.Group();
  g.add(box(56, 9.6, 20, color, 0, 7, 0));
  g.add(box(56, 18, 6, color, 0, 16, -8));
  for (const x of [-26, 26]) g.add(box(6, 14, 20, color, x, 9, 0));
  g.add(box(52, 3, 16, shade(color, 1.15), 0, 13, 1));
  for (const x of [-22, 22]) g.add(box(4, 2.4, 4, '#1b2a34', x, 1.2, 6));
  return g;
}
export function beanbag(color) {
  const g = new THREE.Group();
  const b = mesh(new THREE.SphereGeometry(10, 20, 14), color); b.scale.set(1, 0.55, 1); b.position.y = 5; g.add(b);
  const back = mesh(new THREE.SphereGeometry(7, 16, 12), color); back.scale.set(1.1, 0.9, 0.6); back.position.set(0, 9, -6); g.add(back);
  return g;
}
export function massageChair() {
  const g = new THREE.Group();
  g.add(box(18, 10, 18, '#1b1b1b', 0, 5, 0), box(16, 3, 16, '#3a3f44', 0, 11.5, 0));
  g.add(box(18, 30, 5, '#1b1b1b', 0, 25, -9), box(14, 5, 4, '#3a3f44', 0, 37, -7));
  for (const x of [-9.5, 9.5]) g.add(box(3, 10, 18, '#c9a227', x, 15, 0));
  const leg = box(14, 3, 14, '#1b1b1b', 0, 6, 14); leg.rotation.x = 0.5; g.add(leg);
  return g;
}

// 獎盃：金屬質感
export const goldMat = new THREE.MeshPhysicalMaterial({ color: '#d4a017', metalness: 0.85, roughness: 0.25, clearcoat: 0.6 });
export function trophyMesh(shape) {
  const g = new THREE.Group();
  const gm = (geo, x, y, z) => { const m = new THREE.Mesh(geo, goldMat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  g.add(box(5, 2, 5, '#3a2414', 0, 1, 0));
  if (shape === 'cup' || shape === 'bigcup') {
    gm(new THREE.CylinderGeometry(0.8, 1.4, 3, 10), 0, 3.5, 0);
    gm(new THREE.CylinderGeometry(3, 1.4, 4.5, 16), 0, 7.2, 0);
    for (const sx of [-1, 1]) { const h = gm(new THREE.TorusGeometry(1.4, 0.4, 6, 12, Math.PI), sx * 3, 7.4, 0); h.rotation.z = sx * Math.PI / 2; }
  } else if (shape === 'star') {
    const st = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.6 : 3.8; i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    gm(new THREE.CylinderGeometry(0.6, 0.6, 3, 8), 0, 3.5, 0);
    gm(new THREE.ExtrudeGeometry(st, { depth: 1.2, bevelEnabled: false }), 0, 8.4, -0.6);
  } else {
    g.add(box(7, 9, 1.2, '#5a3a22', 0, 6.5, -1));
    gm(new THREE.BoxGeometry(5, 3, 0.4), 0, 7, -0.2);
  }
  if (shape === 'bigcup') g.scale.setScalar(1.4);
  return g;
}
export function lowCabinet(w) {
  const g = new THREE.Group();
  g.add(box(w, 26, 14, '#a0a5a9', 0, 13, 0));
  for (let x = -w / 2 + 12; x < w / 2; x += 24) g.add(box(18, 9, 1, '#c3c8cc', x, 15, 7.2), box(6, 1.4, 1.6, '#6c6e68', x, 17, 7.8));
  return g;
}
export function printer() {
  const g = new THREE.Group();
  g.add(box(18, 9, 14, '#e8e8e8', 0, 4.5, 0));
  g.add(box(14, 1, 6, '#f4f4f4', 0, 9.5, 5));
  g.add(box(4, 1.2, 3, '#1b2a34', 6, 9.4, -3));
  return g;
}
export function door() {
  const g = new THREE.Group();
  g.add(box(34, 74, 3, '#aa7d55', 0, 37, 0));
  g.add(box(38, 3, 4, '#f4f4f4', 0, 75.5, 0));
  g.add(at(roundBrick(1.6, 4, '#f2cd37'), 12, 36, 2.5));
  return g;
}
// 窗外的積木城市（我們在高樓層）
export const facades = ['#9fc3e9', '#a0a5a9', '#e4cd9e', '#6074a1', '#f4f4f4', '#c7d2dd'];
export function cityTex(color, lit) {
  return canvasTexture(64, 128, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 14) for (let x = 6; x < 64; x += 14) {
      g.fillStyle = (x * 7 + y * 3 + lit) % 5 === 0 ? '#ffe7a3' : 'rgba(40,70,110,.55)';
      g.fillRect(x, y, 8, 9);
    }
  });
}
// 晚上亮燈的窗：只有亮的那幾格是黃的，其他全黑（當發光貼圖用）
function cityLightTex(lit) {
  return canvasTexture(64, 128, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 14) for (let x = 6; x < 64; x += 14) {
      if ((x * 7 + y * 3 + lit) % 3 === 0) { g.fillStyle = '#ffe7a3'; g.fillRect(x, y, 8, 9); }
    }
  });
}
export const cityMats = [];   // 日夜循環調它們的發光強度
export function city(hw, hd, drop = 0) {   // drop：樓層越高，對面的樓看起來越矮
  cityMats.length = 0;
  const g = new THREE.Group();
  let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const place = (x, z, w, d) => {
    const h = 300 + r() * 520, color = facades[Math.floor(r() * facades.length)];
    const lit = Math.floor(r() * 5);
    const t = cityTex(color, lit); t.repeat.set(w / 64, h / 128);
    const lt = cityLightTex(lit).clone(); lt.repeat.set(w / 64, h / 128); lt.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: '#ffd890', emissiveMap: lt, emissiveIntensity: 0 });
    cityMats.push(mat);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, -460 - drop + h / 2, z);
    g.add(m);
  };
  for (let i = 0; i < 9; i++) place(-hw * 1.4 + i * hw * 0.42 + r() * 40, -hd - 260 - r() * 260, 90 + r() * 80, 90);
  for (let i = 0; i < 6; i++) place(-hw - 260 - r() * 240, -hd + i * hd * 0.45 + r() * 40, 90, 90 + r() * 70);
  return g;
}

export function concreteMat(w, d) {
  const map = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#9a9890'; g.fillRect(0, 0, 128, 128);
    let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.07})`; g.fillRect(r() * 128, r() * 128, 2 + r() * 3, 2 + r() * 3); }
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  }, w / 128, d / 128);
  return new THREE.MeshPhysicalMaterial({ map, roughness: 0.85 });
}
export function rollupDoor() {
  const g = new THREE.Group();
  for (let y = 2; y < 74; y += 4) g.add(box(44, 3.6, 2, y % 8 ? '#a0a5a9' : '#8a9096', 0, y, 0));
  g.add(box(48, 6, 4, '#6c6e68', 0, 77, 0));
  return g;
}
export function cardboard() {
  const g = new THREE.Group();
  g.add(box(22, 14, 16, '#c49a6c', 0, 7, 0), box(18, 12, 14, '#b88d5f', 2, 20, 1), box(22, 0.4, 3, '#e0c49a', 0, 14.2, 0));
  return g;
}
export function meetingRoom() {
  const g = new THREE.Group();
  const W = 140, D = 80;
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d8f0ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, depthWrite: false });
  const pane = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 70), glass); m.position.set(x, 35, z); m.rotation.y = ry; g.add(m); };
  pane(W, 0, D / 2, 0); pane(D, -W / 2, 0, Math.PI / 2); pane(D, W / 2, 0, Math.PI / 2);
  for (const [x, z] of [[-W / 2, D / 2], [W / 2, D / 2], [-W / 2, -D / 2], [W / 2, -D / 2], [-20, D / 2], [20, D / 2]]) g.add(box(2.4, 72, 2.4, '#3a3f44', x, 36, z));
  g.add(box(W, 2.4, 2.4, '#3a3f44', 0, 71, D / 2), box(2.4, 2.4, D, '#3a3f44', -W / 2, 71, 0), box(2.4, 2.4, D, '#3a3f44', W / 2, 71, 0));
  g.add(box(70, 3, 30, '#f4f4f4', 0, 22, -4), box(6, 20, 6, '#a0a5a9', -22, 10, -4), box(6, 20, 6, '#a0a5a9', 22, 10, -4));
  for (const x of [-24, 0, 24]) for (const sz of [-1, 1]) {
    g.add(box(12, 2.4, 12, '#0055bf', x, 12, -4 + sz * 24), box(12, 12, 2, '#0055bf', x, 19, -4 + sz * 30));
  }
  g.add(box(40, 26, 1.6, '#1b1b1b', 0, 44, -D / 2 + 1.5));   // 牆上的大電視
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(37, 23), new THREE.MeshBasicMaterial({ map: screenTex('plan'), toneMapped: false }));
  tv.position.set(0, 44, -D / 2 + 2.4); g.add(tv);
  return g;
}
// 主管室：辦公室右後角。主管桌朝前（+z），桌前站報告的人；車庫沒有玻璃隔間，只有一張桌子和地毯
// 本地座標：房間中心在原點，寬 W（x）、深 D（z）；後牆、右牆借用辦公室的牆，門開在前面靠左
export const BOSS_ROOM = { W: 120, D: 100, door: 30 };
export function bossOffice(glassy) {
  const g = new THREE.Group();
  const { W, D, door } = BOSS_ROOM;
  const rug = plate(9, 6, 1.6, glassy ? '#8a1b1b' : '#8a7a66', false); rug.position.set(10, 0, 2); g.add(rug);
  // 主管桌：厚木桌面、前擋板、桌上螢幕與金色名牌
  g.add(box(46, 3.2, 20, '#3a2414', 10, DESK_TOP - 1.6, -18));
  g.add(box(44, DESK_TOP - 3.2, 2, '#4a2e1a', 10, (DESK_TOP - 3.2) / 2, -8.5));
  for (const x of [-11, 31]) g.add(box(4, DESK_TOP - 3.2, 18, '#4a2e1a', x, (DESK_TOP - 3.2) / 2, -18));
  g.add(box(16, 10, 1.2, '#1b1b1b', 18, DESK_TOP + 7, -25), box(2, 4, 1.2, '#1b1b1b', 18, DESK_TOP + 2, -25));
  g.add(box(9, 2, 1.2, '#c9a227', 0, DESK_TOP + 1, -9.5));
  g.add(box(14, 0.4, 9, '#2f5a3a', 2, DESK_TOP + 0.2, -16));
  // 桌機電話：機座留在桌上，話筒拿起來打的時候藏起來（main 換成主管手上的電話）
  const phone = new THREE.Group(); phone.position.set(-5, DESK_TOP, -20); phone.rotation.y = 0.35;
  phone.add(box(7, 2.4, 6, '#1b1b1b', 0, 1.2, 0), box(5, 0.4, 2.6, '#3a3f44', 0, 2.5, 1.2));
  for (const [x, z] of [[-1.6, 1.7], [0, 1.7], [1.6, 1.7], [-1.6, 0.7], [0, 0.7], [1.6, 0.7]]) phone.add(box(1, 0.3, 0.7, '#a0a5a9', x, 2.75, z - 0.2));
  const handset = new THREE.Group();
  handset.add(box(7.4, 1.4, 1.8, '#1b1b1b', 0, 3.1, -1.6), box(1.8, 1.6, 2.2, '#1b1b1b', -3.2, 3.4, -1.6), box(1.8, 1.6, 2.2, '#1b1b1b', 3.2, 3.4, -1.6));
  phone.add(handset);
  phone.userData.keep = true;   // 別被合併成靜態網格：話筒要能藏
  g.add(phone);
  g.userData.handset = handset;
  // 高背皮椅
  g.add(box(14, 3, 14, '#1b1b1b', 10, SEAT_TOP - 1.5, -34), box(14, 26, 3, '#1b1b1b', 10, SEAT_TOP + 13, -41));
  g.add(box(4, SEAT_TOP - 3, 4, '#3a3f44', 10, (SEAT_TOP - 3) / 2, -34), box(14, 1.2, 14, '#3a3f44', 10, 0.6, -34));
  g.add(at(plant(true), W / 2 - 14, 0, -D / 2 + 14));
  if (glassy) {
    g.add(at(bookshelf(), -W / 2 + 26, 0, -D / 2 + 8));
    const glass = new THREE.MeshPhysicalMaterial({ color: '#d8f0ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, depthWrite: false });
    const pane = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 70), glass); m.position.set(x, 35, z); m.rotation.y = ry; g.add(m); };
    pane(D, -W / 2, 0, Math.PI / 2);                              // 左面
    pane(W - door, door / 2, D / 2, 0);                           // 前面（留門）
    for (const [x, z] of [[-W / 2, -D / 2], [-W / 2, D / 2], [-W / 2 + door, D / 2], [W / 2, D / 2]]) g.add(box(2.4, 72, 2.4, '#3a3f44', x, 36, z));
    g.add(box(2.4, 2.4, D, '#3a3f44', -W / 2, 71, 0), box(W, 2.4, 2.4, '#3a3f44', 0, 71, D / 2));
  }
  return g;
}
export function pingpongTable() {
  const g = new THREE.Group();
  g.add(box(60, 3, 34, '#237841', 0, 22, 0));
  g.add(box(60, 0.6, 1, '#f4f4f4', 0, 23.6, 0), box(1, 5, 34, '#f4f4f4', 0, 25.5, 0));
  for (const x of [-24, 24]) g.add(box(4, 20.5, 4, '#1b1b1b', x, 10.3, 0));
  return g;
}
export function arcadeCab() {
  const g = new THREE.Group();
  g.add(box(20, 54, 18, '#923978', 0, 27, 0), box(18, 4, 8, '#1b1b1b', 0, 30, 9));
  const tex = screenTex('arcade').clone(); tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;   // 展示畫面一直開著、星空往下捲
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(15, 12), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); scr.position.set(0, 42, 9.1); g.add(scr);
  for (const [x, c] of [[-4, '#c91a09'], [0, '#f2cd37'], [4, '#0055bf']]) g.add(at(roundBrick(1, 1.2, c, 10), x, 32.6, 10));
  g.userData.screenTex = tex;
  return g;
}
export function consoleCorner() {   // 電視遊樂器：矮櫃＋電視＋主機＋兩個地墊
  const g = new THREE.Group();
  g.add(box(36, 10, 10, '#3a2414', 0, 5, 0), box(36, 22, 2, '#1b1b1b', 0, 22, -1));
  // 主機：黑色機身、白色腰線、藍色指示燈；旁邊收著一支備用手把
  g.add(box(13, 3.4, 8, '#1b1b1b', 9, 11.7, 1), box(13.2, 0.5, 8.2, '#f4f4f4', 9, 12.4, 1), box(5, 0.4, 0.4, '#3a3f44', 7, 11.2, 5.1));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: '#4fb4ff' })); led.position.set(14, 11.6, 5.1); g.add(led);
  g.add(box(4.4, 1, 2.2, '#2c3238', -8, 10.5, 2), box(1.4, 1.2, 1.6, '#2c3238', -10.6, 10.4, 2.8), box(1.4, 1.2, 1.6, '#2c3238', -5.4, 10.4, 2.8));
  // 電視：有人玩才開（main 依休閒點有沒有人在玩切換貼圖、捲動畫面）
  const game = screenTex('game').clone(); game.wrapS = THREE.RepeatWrapping; game.needsUpdate = true;
  const off = screenTex('off');
  const mat = new THREE.MeshBasicMaterial({ map: off, toneMapped: false });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(33, 19), mat); scr.position.set(0, 22, 0.1); g.add(scr);
  g.userData.screen = { mat, game, off };
  for (const x of [-12, 12]) g.add(at(roundBrick(8, 3, x < 0 ? '#c91a09' : '#0055bf'), x, 1.5, 30));
  return g;
}
export function kitchen() {   // 茶水間中島：流理台、微波爐、零食、冰箱
  const g = new THREE.Group();
  g.add(box(20, 26, 46, '#f4f4f4', 0, 13, 0), box(22, 2.4, 48, '#3a3f44', 0, 27.2, 0));
  g.add(box(10, 7, 8, '#1b1b1b', 0, 32, -12), box(7, 4, 0.4, '#3a4b5c', 0, 32, -7.8));
  for (const [z, c] of [[6, '#c91a09'], [10, '#f2cd37'], [14, '#0055bf']]) g.add(box(4, 6, 3, c, 2, 31.4, z));
  g.add(box(18, 52, 16, '#c3c8cc', 0, 26, 34), box(1, 10, 1, '#6c6e68', -9.4, 34, 30));
  return g;
}

export function logoWall() {
  const g = new THREE.Group();
  g.add(box(70, 46, 3, '#1b2a34', 0, 60, 0));
  const colors = ['#c91a09', '#f2cd37', '#0055bf', '#237841'];
  colors.forEach((c, i) => { const b = plate(4, 2, 9.6, c); b.rotation.x = Math.PI / 2; b.position.set(-14 + (i % 2) * 12 + i * 3, 44 + i * 9, 3); g.add(b); });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(66, 42), new THREE.MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.08 }));
  glow.position.set(0, 60, 1.6); g.add(glow);
  return g;
}
export function reception() {
  const g = new THREE.Group();
  g.add(box(60, 26, 14, '#f4f4f4', 0, 13, 0), box(64, 2.4, 18, '#3a2414', 0, 27, 0), box(60, 4, 1, '#c9a227', 0, 18, 7.2));
  g.add(at(plant(false), 36, 0, 0));
  return g;
}
export function planter(n) {
  const g = new THREE.Group();
  g.add(box(n * 30, 10, 20, '#6c6e68', 0, 5, 0), box(n * 30 - 4, 1.4, 16, '#4b9f4a', 0, 10.2, 0));
  for (let i = 0; i < n; i++) g.add(at(plant(true), -n * 15 + 15 + i * 30, 9, 0));
  return g;
}

// ── 辦公室貓：照真貓的花色 ──
//   妹妹：淡三花，臉上半部一邊灰褐一邊橘黃、中間白鼻樑，背上前橘後灰，尾巴灰褐
//   達達：近白的英短，背上淡淡銀色
//   摸摸：美短銀虎斑，銀灰底黑條紋、額頭 M 字紋、眼角往兩頰的紋，嘴邊下巴胸口白、白襪
// 到處走、在窗邊曬太陽、跳上休息中的人的桌子睡覺
export const CATS = [
  { name: 'calico', base: '#f4f4f4', halves: ['#857a70', '#d9a066'] },
  { name: 'silver', base: '#e6e8ea', stripes: '#c2c7cc', round: true },
  { name: 'tabby', base: '#a7acb1', stripes: '#1b1b1b', rings: true, socks: '#f4f4f4', mask: true },
];
export function buildCat(def) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  body.add(box(6, 5.5, 11, def.base, 0, 6, 0));
  const head = new THREE.Group(); head.position.set(0, 9, 6.5); body.add(head);
  head.add(box(def.round ? 7 : 6, 5.5, 5, def.base, 0, 0, 0));
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(1.4, 2.6, 4), def.base); ear.position.set(sx * 1.9, 3.6, -0.5); ear.rotation.y = Math.PI / 4; head.add(ear);
    head.add(box(1, 1.2, 0.4, '#1b1b1b', sx * 1.5, 0.6, 2.6));
  }
  head.add(box(1, 0.8, 0.4, '#e4adc8', 0, -0.6, 2.6));
  if (def.halves) {   // 三花：臉的上半部左右兩色、中間留白鼻樑；背上前後兩色往兩側垂
    const [grey, tan] = def.halves;
    head.add(box(2.5, 3.0, 0.2, grey, -1.75, 1.25, 2.55), box(2.5, 3.0, 0.2, tan, 1.75, 1.25, 2.55));
    head.add(box(0.2, 3.0, 4.6, grey, -3.05, 1.25, 0), box(0.2, 3.0, 4.6, tan, 3.05, 1.25, 0));
    head.add(box(2.6, 0.6, 2.4, tan, -1.4, 2.9, 0), box(2, 0.6, 2, grey, 1.6, 2.9, -0.6));
    body.add(box(6.3, 0.5, 4.5, tan, 0, 8.85, 2.4), box(6.3, 0.5, 5.5, grey, 0, 8.9, -2.6));
    for (const sx of [-1, 1]) body.add(box(0.3, 2.4, 4.5, tan, sx * 3.05, 7.6, 2.4), box(0.3, 3.0, 5.5, grey, sx * 3.05, 7.3, -2.6));
  }
  if (def.stripes) for (const z of [-3.5, -0.5, 2.5]) body.add(box(6.2, 0.6, 1.2, def.stripes, 0, 8.9, z));
  if (def.rings) {   // 虎斑：條紋繞到身體兩側、額頭的 M 字紋
    for (const z of [-3.5, -0.5, 2.5]) body.add(box(6.2, 3.6, 0.9, def.stripes, 0, 6.8, z));
    for (const x of [-1.2, 0, 1.2]) head.add(box(0.5, 0.4, 2.2, def.stripes, x, 2.8, 0.4));
  }
  if (def.mask) {   // 虎斑的臉：M 字紋往下到眉心、眼角往兩頰的紋；嘴邊下巴、胸口白
    for (const x of [-1.1, 0, 1.1]) head.add(box(0.45, x ? 1.3 : 1.7, 0.2, def.stripes, x, x ? 2.0 : 1.85, 2.55));
    for (const sx of [-1, 1]) head.add(box(0.8, 0.3, 0.2, def.stripes, sx * 2.6, 0.1, 2.55), box(0.2, 0.35, 2.4, def.stripes, sx * 3.05, 0.1, 0.8));
    head.add(box(3.2, 1.9, 0.2, def.socks, 0, -1.75, 2.55));
    body.add(box(4.2, 3.4, 0.3, def.socks, 0, 6.2, 5.6));
  }
  const legs = [];
  for (const [x, z] of [[-1.9, 3.6], [1.9, 3.6], [-1.9, -3.6], [1.9, -3.6]]) {
    const l = new THREE.Group(); l.position.set(x, 4, z);
    l.add(box(1.8, 4.5, 1.8, def.base, 0, -2.2, 0)); if (def.socks) l.add(box(1.9, 1.6, 1.9, def.socks, 0, -3.7, 0)); body.add(l); legs.push(l);
  }
  const tail = new THREE.Group(); tail.position.set(0, 7.5, -5.5); body.add(tail);
  const tl = mesh(new THREE.CylinderGeometry(0.7, 0.9, 9, 8), def.rings ? def.base : def.halves?.[0] || def.stripes || def.base); tl.position.y = 4.5; tail.add(tl);
  if (def.rings) for (const y of [2.5, 5, 7.5]) { const r = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1, 8), def.stripes); r.position.y = y; tail.add(r); }
  tail.rotation.x = -0.7;
  return { root, body, head, legs, tail };
}

// ── 節日裝飾 ──
// 南瓜燈：橘色南瓜、刻出來的臉會發光（晚上更明顯）
const pumpkinFace = canvasTexture(128, 128, (g) => {
  g.fillStyle = '#e8701a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.moveTo(30, 52); g.lineTo(50, 52); g.lineTo(40, 34); g.fill();
  g.beginPath(); g.moveTo(78, 52); g.lineTo(98, 52); g.lineTo(88, 34); g.fill();
  g.beginPath(); g.moveTo(26, 74); for (let i = 0; i <= 6; i++) g.lineTo(26 + i * 12.7, i % 2 ? 96 : 80); g.lineTo(102, 74); g.quadraticCurveTo(64, 90, 26, 74); g.fill();
});
export function pumpkin(size = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(6, 18, 12), new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.5, emissive: '#ff9a20', emissiveIntensity: 0.25, emissiveMap: pumpkinFace, map: pumpkinFace }));
  body.scale.set(1.15, 0.85, 1.15); body.position.y = 5; body.rotation.y = -Math.PI / 2; body.castShadow = true; g.add(body);
  g.add(at(roundBrick(0.8, 2.6, '#4a7a2a', 8), 0, 10.2, 0));
  g.scale.setScalar(size * 1.5);   // 全景下也要看得出是南瓜
  return g;
}
// 蜘蛛網：貼在牆角的一片網
const webTex = canvasTexture(128, 128, (g) => {
  g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) { const a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); g.stroke(); }
  for (let r = 20; r < 128; r += 20) { g.beginPath(); for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2, rr = r - (i % 2) * 4; i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); }
});
export function cobweb(size = 30) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: webTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.geometry.translate(size / 2, -size / 2, 0);   // 原點在網的角落
  return m;
}
// 蝙蝠剪影（貼在窗上）
const batTex = canvasTexture(128, 64, (g) => {
  g.clearRect(0, 0, 128, 64); g.fillStyle = '#1b1b1b';
  g.beginPath(); g.moveTo(64, 22); g.quadraticCurveTo(40, 4, 6, 14); g.quadraticCurveTo(22, 26, 18, 40); g.quadraticCurveTo(32, 30, 40, 42); g.quadraticCurveTo(50, 32, 64, 46);
  g.quadraticCurveTo(78, 32, 88, 42); g.quadraticCurveTo(96, 30, 110, 40); g.quadraticCurveTo(106, 26, 122, 14); g.quadraticCurveTo(88, 4, 64, 22); g.fill();
  g.beginPath(); g.arc(64, 26, 8, 0, Math.PI * 2); g.fill();
});
export function bat(size = 14) {
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), new THREE.MeshBasicMaterial({ map: batTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
}
// 燈串：一串發光的小燈泡（顏色輪流）
export function stringLights(len, colors) {
  const g = new THREE.Group();
  const wire = box(len, 0.4, 0.4, '#1b1b1b'); g.add(wire);
  for (let x = -len / 2 + 6, i = 0; x < len / 2; x += 12, i++) {
    const c = colors[i % colors.length];
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6 }));
    bulb.position.set(x, -2 - Math.sin(i * 1.7) * 1.2, 0.8); g.add(bulb);
  }
  return g;
}
// 聖誕樹：三層綠色錐、彩球、燈、頂上金星；樹下禮物
export function xmasTree() {
  const g = new THREE.Group();
  g.add(at(roundBrick(3, 10, '#582a12'), 0, 5, 0));
  [[18, 24, 20], [14, 20, 36], [9, 16, 50]].forEach(([r, h, y]) => { const c = mesh(new THREE.ConeGeometry(r, h, 16), '#237841'); c.position.y = y; g.add(c); });
  const cols = ['#c91a09', '#f2cd37', '#0055bf', '#f4f4f4', '#923978'];
  for (let i = 0; i < 26; i++) {
    const y = 14 + (i * 37 % 44), r = Math.max(2, 17 - (y - 10) * 0.33), a = i * 2.4;
    const c = cols[i % cols.length], glow = i % 3 === 0;
    const b = new THREE.Mesh(new THREE.SphereGeometry(glow ? 1 : 1.6, 8, 6), glow ? new THREE.MeshStandardMaterial({ color: '#fff2b0', emissive: '#ffe080', emissiveIntensity: 2 }) : plastic(c));
    b.position.set(Math.sin(a) * r, y, Math.cos(a) * r); g.add(b);
  }
  const st = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2 : 4.6; i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 1.2, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#f2cd37', emissive: '#ffd24a', emissiveIntensity: 1.4 }));
  star.position.set(0, 60, -0.6); g.add(star);
  [[12, 4, '#c91a09'], [-10, 8, '#0055bf'], [4, -12, '#237841'], [-6, -10, '#f2cd37']].forEach(([x, z, c], i) => {
    const s = 6 + (i % 2) * 3; g.add(box(s, s, s, c, x, s / 2, z), box(s + 0.2, s + 0.2, 1.2, '#f4f4f4', x, s / 2, z), box(1.2, s + 0.3, s + 0.2, '#f4f4f4', x, s / 2, z));
  });
  return g;
}
// 燈籠（預設紅色；中秋用黃的）
export function lantern(color = '#d61c1c', glow = '#ff3a2a') {
  const g = new THREE.Group();
  g.add(box(0.5, 14, 0.5, '#1b1b1b', 0, 7, 0));
  const body = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 0.6, roughness: 0.6 }));
  body.scale.y = 0.8; g.add(body);
  g.add(at(roundBrick(3, 1.4, '#c9a227'), 0, 4.2, 0), at(roundBrick(3, 1.4, '#c9a227'), 0, -4.2, 0));
  for (let i = 0; i < 5; i++) g.add(box(0.4, 5, 0.4, '#c9a227', (i - 2) * 0.8, -7.4, 0));
  g.position.y = -14;   // 原點在吊繩頂端
  const holder = new THREE.Group(); holder.add(g);
  return holder;
}
// 春聯：紅紙直條，金色大字
export function couplet(text) {
  const tex = canvasTexture(64, 256, (g) => {
    g.fillStyle = '#c91a09'; g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#f2cd37'; g.font = 'bold 52px "PingFang TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...text].forEach((ch, i) => g.fillText(ch, 32, 34 + i * 62));
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(9, 36), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
}

// 月餅禮盒：紅盒子掀開蓋，裡面一排金黃月餅；旁邊一顆文旦
export function mooncakes() {
  const g = new THREE.Group();
  g.add(box(14, 3, 10, '#b8141a', 0, 1.5, 0), box(14, 0.6, 10, '#c9a227', 0, 3.1, 0));
  for (let i = 0; i < 3; i++) g.add(at(roundBrick(2, 1.6, '#d9a24a', 14), -4.5 + i * 4.5, 4, 0));
  const lid = box(14, 1, 10, '#b8141a'); lid.rotation.x = -1.2; lid.position.set(0, 6.5, -5.5); g.add(lid);
  const p = new THREE.Mesh(new THREE.SphereGeometry(3.5, 14, 10), plastic('#c7d65a'));
  p.scale.y = 1.15; p.position.set(-11, 4, 0); p.castShadow = true; g.add(p);
  g.add(at(roundBrick(0.5, 1.6, '#4a7a2a', 6), -11, 8.4, 0));
  g.scale.setScalar(1.2);
  return g;
}
// 粽子：四面體綠葉包、綁紅繩；一盤三顆
function zongzi() {
  const z = new THREE.Mesh(new THREE.TetrahedronGeometry(3.6), plastic('#3f7d32'));
  z.rotation.set(0.6, 0.4, 0.2); z.castShadow = true;
  const g = new THREE.Group(); g.add(z);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 6, 16), plastic('#c91a09')); rope.rotation.x = Math.PI / 2; g.add(rope);
  return g;
}
export function zongziPlate() {
  const g = new THREE.Group();
  g.add(at(roundBrick(10, 1, '#f4f4f4', 20), 0, 0.5, 0));
  for (const [x, z] of [[-4, 2], [4, 2], [0, -4]]) g.add(at(zongzi(), x, 3.6, z));
  g.scale.setScalar(1.3);
  return g;
}
// 門口的艾草、菖蒲：一束綠色長葉，用紅紙綁著
export function mugwort() {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const leaf = box(1, 30 - (i % 3) * 4, 0.6, i % 2 ? '#4f8a3a' : '#6aa84f');
    leaf.position.set((i - 3) * 0.9, -14, 0); leaf.rotation.z = (i - 3) * 0.06; g.add(leaf);
  }
  g.add(box(6, 3, 1.4, '#c91a09', 0, -4, 0));
  return g;
}
// 滿月：從後面的窗戶看出去（只有晚上亮）；用 Sprite 永遠正對鏡頭，外圈一層淡淡的光暈
const moonTex = canvasTexture(128, 128, (g) => {
  g.clearRect(0, 0, 128, 128);
  const halo = g.createRadialGradient(64, 64, 26, 64, 64, 64);
  halo.addColorStop(0, 'rgba(255,236,170,.45)'); halo.addColorStop(1, 'rgba(255,236,170,0)');
  g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(64, 64, 28, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(214,196,140,.5)';
  for (const [x, y, r] of [[54, 56, 6], [72, 70, 5], [68, 50, 3.5], [52, 74, 3]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
});
export function fullMoon() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, depthWrite: false }));
  s.scale.set(150, 150, 1);
  return s;
}
// 一串氣球：金銀兩色，細線綁在地上
export function balloons() {
  const g = new THREE.Group();
  [['#e8c25a', 0, 40, 0], ['#d9dde2', 7, 46, 3], ['#e8c25a', -6, 50, -2], ['#d9dde2', 2, 55, -5], ['#c9a227', -3, 43, 6]].forEach(([c, x, y, z]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 12), new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.25 }));
    b.scale.y = 1.15; b.position.set(x, y, z); b.castShadow = true; g.add(b);
    const len = y - 5.5, s = box(0.25, len, 0.25, '#f4f4f4'); s.position.set(x / 2, len / 2, z / 2); s.rotation.set(-Math.atan2(z / 2, len) , 0, Math.atan2(x / 2, len)); g.add(s);
  });
  g.add(at(roundBrick(2.5, 2, '#c9a227'), 0, 1, 0));
  return g;
}

// ── 外包畫師的畫架：三腳架＋畫布（畫布貼圖由 main 換：作畫中是草稿、畫好是真的圖）＋小凳子
export function easel() {
  const g = new THREE.Group();
  for (const [x, z, rz, rx] of [[-7, 2, 0.12, -0.12], [7, 2, -0.12, -0.12], [0, -6, 0, 0.22]]) {
    const leg = box(1.4, 52, 1.4, '#8a6440', x, 25, z); leg.rotation.set(rx, 0, rz); g.add(leg);
  }
  g.add(box(22, 1.6, 4, '#8a6440', 0, 24, 3.5));   // 放畫的橫木
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
  const canvasMesh = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 1.2), [plastic('#f4efe4'), plastic('#f4efe4'), plastic('#f4efe4'), plastic('#f4efe4'), mat, plastic('#e8e2d4')]);
  canvasMesh.position.set(0, 37, 3.4); canvasMesh.rotation.x = -0.12; canvasMesh.castShadow = true; g.add(canvasMesh);
  g.add(at(roundBrick(4.5, 1.6, '#582a12'), 0, 11, -20), at(roundBrick(1, 10, '#3a2a1a', 6), 0, 5, -20));   // 凳子
  g.userData.canvas = { mesh: canvasMesh, mat };
  return g;
}
// 作品牆上的畫框（image 是貼圖）
export function pictureFrame(tex, size = 30) {
  const g = new THREE.Group();
  g.add(box(size + 4, size + 4, 1.6, '#3a2414', 0, 0, 0));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  pic.position.z = 0.85; g.add(pic);
  g.userData.pic = pic;
  return g;
}

// ── 整層樓才有的公共設施：窗邊那一條（健身角、水族箱、樂團角）──
// 健身器材的使用者面向 -z（窗戶），原點在器材正中央的地上
export function treadmill() {
  const g = new THREE.Group();
  g.add(box(14, 4, 34, '#2c3238', 0, 2, 0), box(11, 0.6, 30, '#1b1b1b', 0, 4.3, 2));
  for (const x of [-6.2, 6.2]) g.add(box(1.6, 30, 1.6, '#a0a5a9', x, 17, -15), box(1.2, 1.2, 12, '#a0a5a9', x, 26, -9));
  const panel = box(14, 6, 3, '#3a3f44', 0, 33, -15); panel.rotation.x = -0.5; g.add(panel);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), new THREE.MeshBasicMaterial({ color: '#4fb4ff', toneMapped: false }));
  scr.position.set(0, 33.9, -13.3); scr.rotation.x = -0.5; g.add(scr);
  return g;
}
export function spinBike() {
  const g = new THREE.Group();
  g.add(box(16, 2, 4, '#1b1b1b', 0, 1, -10), box(16, 2, 4, '#1b1b1b', 0, 1, 10));
  const post = box(3, 20, 3, '#c91a09', 0, 10, 4); post.rotation.x = 0.25; g.add(post);
  const front = box(3, 26, 3, '#c91a09', 0, 13, -8); front.rotation.x = -0.2; g.add(front);
  g.add(box(9, 2, 6, '#1b1b1b', 0, 21, 6));                                       // 坐墊
  g.add(box(14, 1.6, 1.6, '#3a3f44', 0, 26, -11), box(1.6, 1.6, 5, '#3a3f44', -6.4, 26, -9), box(1.6, 1.6, 5, '#3a3f44', 6.4, 26, -9));
  const wheel = mesh(new THREE.CylinderGeometry(6, 6, 2.4, 20), '#6c6e68'); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 8, -8); g.add(wheel);
  return g;
}
export function weightRack() {
  const g = new THREE.Group();
  for (const x of [-14, 14]) g.add(box(2.4, 40, 2.4, '#3a3f44', x, 20, -6), box(2.4, 2, 14, '#3a3f44', x, 1, 0));
  g.add(box(36, 1.2, 1.2, '#d7dde2', 0, 30, -4.6));                                // 槓鈴
  for (const x of [-11, 11]) g.add(at(roundBrick(6, 2.4, '#1b1b1b', 18), x, 30, -4.6, 0)).children.at(-1).rotation.z = Math.PI / 2;
  // 啞鈴架
  g.add(box(30, 8, 8, '#6c6e68', 0, 4, 10));
  for (const x of [-10, 0, 10]) for (const dx of [-3, 3]) { const d = roundBrick(1.8, 1.6, ['#c91a09', '#0055bf', '#f2cd37'][(x + 10) / 10], 12); d.rotation.z = Math.PI / 2; d.position.set(x + dx, 9.6, 10); g.add(d); }
  return g;
}

// 水族箱：1 小魚缸（矮櫃上）、2 整面水族牆；魚在 userData.fish，main 每格讓牠們來回游
const FISH_COLORS = ['#fe8a18', '#f2cd37', '#c91a09', '#4fb4ff', '#f4f4f4', '#e4adc8'];
function fish(color) {
  const f = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(1.4, 10, 8), color); body.scale.set(1.6, 1, 0.6); f.add(body);
  const tail = mesh(new THREE.ConeGeometry(1.1, 1.8, 4), color); tail.rotation.z = Math.PI / 2; tail.position.x = -2.6; f.add(tail);
  return f;
}
export function aquarium(lv) {
  const g = new THREE.Group();
  const big = lv >= 2;
  const W = big ? 110 : 30, H = big ? 36 : 18, D = 12, base = big ? 12 : 22;
  g.add(box(W + 4, base, D + 4, big ? '#3a2414' : '#f4f4f4', 0, base / 2, 0));
  const water = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.9, D), new THREE.MeshPhysicalMaterial({ color: '#59a9e0', transparent: true, opacity: 0.32, roughness: 0.05, clearcoat: 1, depthWrite: false }));
  water.position.set(0, base + H * 0.45, 0); g.add(water);
  g.add(box(W, 2, D, '#e4cd9e', 0, base + 1, 0));                                 // 底沙
  for (const [x, y] of [[-W / 2, base + H / 2], [W / 2, base + H / 2]]) for (const z of [-D / 2, D / 2]) g.add(box(1, H, 1, '#1b1b1b', x, y, z));
  g.add(box(W + 2, 2, D + 2, '#1b1b1b', 0, base + H + 1, 0));                       // 上蓋
  const weeds = big ? 9 : 3;
  for (let i = 0; i < weeds; i++) {
    const x = -W / 2 + 4 + (i + 0.5) * (W - 8) / weeds, h = 6 + (i * 7 % 5) * 2;
    g.add(box(1.4, h, 1.4, i % 3 ? '#4b9f4a' : '#237841', x, base + 2 + h / 2, (i % 2 ? 2 : -2)));
  }
  if (big) g.add(at(roundBrick(4, 5, '#a0a5a9', 12), W / 4, base + 4.5, 1), at(roundBrick(2.6, 3, '#6c6e68', 10), -W / 3, base + 3.5, -2));
  const list = [];
  const n = big ? 9 : 3;
  for (let i = 0; i < n; i++) {
    const f = fish(FISH_COLORS[i % FISH_COLORS.length]);
    const y = base + 5 + ((i * 5) % Math.max(4, H - 12)), z = ((i % 3) - 1) * 3;
    f.position.set(0, y, z); f.userData.keep = true; g.add(f);
    list.push({ f, range: W / 2 - 5, speed: 0.12 + (i % 4) * 0.05, phase: i * 1.7, y });
  }
  g.userData.fish = list;
  return g;
}

// 樂團角：音箱、吉他（架上一把；有人彈時小人手上也有一把）、爵士鼓、鍵盤；朝 +z（對著辦公室演）
export function guitar(color = '#c91a09') {
  const g = new THREE.Group();
  const b1 = mesh(new THREE.CylinderGeometry(4.2, 4.2, 1.8, 18), color); b1.rotation.x = Math.PI / 2; g.add(b1);
  const b2 = mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.8, 18), color); b2.rotation.x = Math.PI / 2; b2.position.x = 5; g.add(b2);
  const hole = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 12), '#1b1b1b'); hole.rotation.x = Math.PI / 2; hole.position.set(3, 0, 1); g.add(hole);
  g.add(box(14, 1.2, 0.8, '#3a2414', 13, 0, 0.6), box(3, 1.8, 0.8, '#1b1b1b', 21, 0, 0.6));
  return g;
}
export function guitarAmp() {
  const g = new THREE.Group();
  g.add(box(18, 20, 10, '#1b1b1b', 0, 10, 0), box(15, 12, 0.4, '#3a3f44', 0, 9, 5.1), box(16, 2.4, 0.6, '#c9a227', 0, 17, 5.1));
  for (const x of [-5, -1, 3]) g.add(at(roundBrick(0.8, 0.8, '#f4f4f4', 8), x, 17.5, 5.4)).children.at(-1).rotation.x = Math.PI / 2;
  return g;
}
export function guitarStand(color) {
  const g = new THREE.Group();
  g.add(box(8, 1, 8, '#1b1b1b', 0, 0.5, 0), box(1.2, 10, 1.2, '#1b1b1b', 0, 5, -2));
  const gt = guitar(color); gt.rotation.z = Math.PI / 2 - 0.15; gt.position.set(0, 7, 0); g.add(gt);
  return g;
}
export function drumKit() {
  const g = new THREE.Group();
  const drum = (r, h, x, y, z, tilt = 0, color = '#c91a09') => {
    const d = new THREE.Group();
    d.add(mesh(new THREE.CylinderGeometry(r, r, h, 20), color), at(mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.3, 20), '#f4f4f4'), 0, h / 2, 0));
    d.position.set(x, y, z); d.rotation.x = tilt; g.add(d); return d;
  };
  drum(8, 7, 0, 8, 6, Math.PI / 2);                                               // 大鼓（鼓面朝前）
  drum(4.4, 4, -9, 16, -2, -0.3);                                                  // 小鼓
  drum(3.6, 4, -3, 21, 3, -0.4); drum(3.6, 4, 4, 21, 3, -0.4);                     // 中鼓
  drum(5, 7, 11, 11, -2, 0);                                                       // 落地鼓
  for (const [x, y, z] of [[-14, 26, 2], [14, 30, 4]]) {
    g.add(box(0.8, y, 0.8, '#a0a5a9', x, y / 2, z));
    g.add(at(roundBrick(6, 0.4, '#d4a017', 20), x, y, z));                          // 銅鈸
  }
  g.add(at(roundBrick(4, 1.6, '#1b1b1b', 14), 0, 12, -14), box(1.4, 11, 1.4, '#a0a5a9', 0, 5.5, -14));   // 鼓椅
  return g;
}
export function keyboardStand() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) { const leg = box(1.4, 24, 1.4, '#3a3f44', 0, 11, 0); leg.rotation.x = s * 0.5; leg.position.x = -10; g.add(leg); const l2 = leg.clone(); l2.position.x = 10; g.add(l2); }
  g.add(box(32, 2.4, 9, '#1b1b1b', 0, 22, 0), box(28, 0.6, 4, '#f4f4f4', 0, 23.4, -1.6));
  for (let i = 0; i < 9; i++) g.add(box(1.2, 0.5, 2.2, '#1b1b1b', -12 + i * 3, 23.8, -2.6));
  return g;
}

// ── 總部大樓才有的公共設施：左右兩側各加寬一塊（員工餐廳、午睡艙、高爾夫練習區）──
// 自助餐台：長邊沿 x，取餐的一面朝 +z
export function buffetCounter() {
  const g = new THREE.Group();
  g.add(box(64, 22, 16, '#c3c8cc', 0, 11, 0), box(66, 2, 18, '#6c6e68', 0, 23, 0));
  const foods = ['#fe8a18', '#4b9f4a', '#f2cd37', '#c91a09', '#e4cd9e', '#a5ca18'];
  for (let i = 0; i < 6; i++) {
    const x = -26 + i * 10.4;
    g.add(box(9, 1.4, 11, '#d7dde2', x, 24.6, 0), box(7.4, 1, 9, foods[i], x, 25.6, 0));
  }
  const guard = new THREE.Mesh(new THREE.BoxGeometry(64, 0.6, 12), glassMat); guard.position.set(0, 36, 1); guard.rotation.x = 0.25; g.add(guard);
  for (const x of [-31, 31]) g.add(box(1.2, 12, 1.2, '#a0a5a9', x, 30, -4));
  g.add(at(roundBrick(5, 8, '#3a3f44', 16), 26, 4, -14));   // 湯鍋旁的保溫桶
  return g;
}
// 長桌：長邊沿 z，兩側各兩張圓凳；坐的人在 x = ±14、z = ±10
export function diningTable() {
  const g = new THREE.Group();
  g.add(box(18, 2.4, 44, '#e4cd9e', 0, 21, 0));
  for (const [x, z] of [[-6, -18], [6, -18], [-6, 18], [6, 18]]) g.add(box(2.4, 20, 2.4, '#3a2414', x, 10, z));
  for (const sx of [-1, 1]) for (const z of [-10, 10]) {
    g.add(at(roundBrick(4, 1.6, '#0055bf', 14), sx * 14, 11.2, z), box(1.6, 10.4, 1.6, '#6c6e68', sx * 14, 5.2, z));
    g.add(at(roundBrick(3, 0.6, '#f4f4f4', 14), sx * 5, 22.5, z), at(roundBrick(1.8, 1.2, ['#fe8a18', '#4b9f4a'][(z > 0) ^ (sx > 0) ? 1 : 0], 10), sx * 5, 23.2, z));   // 餐盤
  }
  return g;
}
// 午睡艙：開口朝 -x，裡面一張床墊、一條小夜燈
export function napPod() {
  const g = new THREE.Group();
  const W = 30, H = 52, D = 28;   // W：x 方向的深度，D：z 方向的寬（夠高：坐著戴帽子也不會穿出去）
  g.add(box(W, 8, D, '#f4f4f4', 0, 4, 0), box(W - 4, 2, D - 4, '#6074a1', -1, 9, 0));            // 底座、床墊
  g.add(box(2, H, D, '#f4f4f4', W / 2 - 1, H / 2, 0), box(W, 2, D, '#f4f4f4', 0, H - 1, 0));    // 後牆、頂
  for (const z of [-D / 2 + 1, D / 2 - 1]) g.add(box(W, H, 2, '#f4f4f4', 0, H / 2, z));
  g.add(box(W - 4, 1, 4, '#c3d7ec', -1, H - 2.6, 0));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(D - 6, 1.6), new THREE.MeshBasicMaterial({ color: '#9fc3e9', toneMapped: false }));
  glow.position.set(W / 2 - 2.1, H - 6, 0); glow.rotation.y = -Math.PI / 2; g.add(glow);
  g.add(box(6, 3, 10, '#f4f4f4', W / 2 - 6, 11.5, 0));   // 枕頭
  return g;
}
// 推桿果嶺：橢圓草皮，洞在 +x 那頭；球從 -x 那頭推過去（main 依有沒有人在推讓球滾）
export function puttingGreen() {
  const g = new THREE.Group();
  const green = mesh(new THREE.CylinderGeometry(1, 1, 1.2, 40), '#5fb84a'); green.scale.set(56, 1, 34); green.position.y = 0.6; g.add(green);
  const fringe = mesh(new THREE.CylinderGeometry(1, 1, 0.8, 40), '#3f8f3a'); fringe.scale.set(60, 1, 38); fringe.position.y = 0.4; g.add(fringe);
  g.add(at(roundBrick(2, 0.4, '#1b1b1b', 14), 38, 1.1, 0));
  g.add(box(0.6, 26, 0.6, '#f4f4f4', 38, 13, 0));
  const flag = box(7, 5, 0.4, '#c91a09', 41.6, 23, 0); flag.userData.keep = true; g.add(flag);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), plastic('#f4f4f4')); ball.position.set(-30, 2.2, 0); ball.userData.keep = true; g.add(ball);
  g.userData = { ball, from: -30, hole: 38, flag };
  return g;
}
// 揮桿模擬器：大螢幕（藍天綠地）朝 +z、前面一塊打擊墊
const simTex = canvasTexture(256, 160, (c) => {
  const sky = c.createLinearGradient(0, 0, 0, 90); sky.addColorStop(0, '#5aa0e0'); sky.addColorStop(1, '#cfe9ff');
  c.fillStyle = sky; c.fillRect(0, 0, 256, 90);
  c.fillStyle = '#3f8f3a'; c.fillRect(0, 90, 256, 70);
  c.fillStyle = '#5fb84a'; c.beginPath(); c.moveTo(100, 160); c.lineTo(122, 90); c.lineTo(134, 90); c.lineTo(156, 160); c.fill();
  c.fillStyle = '#2f6f2a'; for (const x of [20, 60, 200, 236]) { c.beginPath(); c.arc(x, 88, 14, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#f4f4f4'; c.fillRect(127, 80, 1.5, 10); c.fillStyle = '#c91a09'; c.fillRect(128.5, 80, 6, 4);
});
export function golfSim() {
  const g = new THREE.Group();
  g.add(box(66, 46, 3, '#1b1b1b', 0, 26, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(62, 40), new THREE.MeshBasicMaterial({ map: simTex, toneMapped: false })); scr.position.set(0, 27, 1.6); g.add(scr);
  g.add(box(34, 1, 30, '#3f8f3a', 0, 0.5, 30), box(10, 1.2, 10, '#5fb84a', 0, 1.1, 30));
  g.add(at(roundBrick(0.4, 1.6, '#f4f4f4', 6), 4, 2, 26), at(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), plastic('#f4f4f4')), 4, 3.6, 26));
  return g;
}
// 球桿：小人推桿／揮桿時拿在右手（原點是握把，桿身往下）
export function golfClub() {
  const g = new THREE.Group();
  g.add(box(0.7, 22, 0.7, '#a0a5a9', 0, -11, 0), box(1.1, 4, 1.1, '#1b1b1b', 0, -1, 0), box(4, 1.4, 1.4, '#3a3f44', 1.4, -22.4, 0));
  return g;
}
