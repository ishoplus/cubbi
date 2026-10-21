// Cubbi 的小人：方塊頭、圓角身體、圓手的塑膠玩偶。職業制服（帽子、配件、印花）＋個人特徵（膚色、髮型、眼鏡、鬍子）
// 刻意不做成市售積木人偶的樣子（圓柱頭頂凸粒、梯形身體、C 形爪手、黃皮膚），世界照樣是積木拼的
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HAIR_COLORS, SKIN_TONES, at, box, hash, mergeStatic, mesh, plastic, roundBrick } from './bricks.js';
import { faceTex, printTex } from './textures.js';

// ── 小人 ──────────────────────────────────────────────────────────────────────
// 原點在腳底中心、面向 +z。三個關節：髖（坐下）、上半身（前傾後仰）、頭、兩手。
const rbox = (w, h, d, r, dx = 0, dy = 0, dz = 0) => { const g = new RoundedBoxGeometry(w, h, d, 3, r); g.translate(dx, dy, dz); return g; };
export const FG = {
  torso: rbox(13.4, 12.4, 8, 1.6, 0, 6.2, 0),
  leg: rbox(7, 11, 7.6, 1.4, 0, -5.5, 0),
  foot: rbox(7.2, 2.8, 9.6, 1.1, 0, -9.7, 0.8),
  hip: rbox(14, 3, 7.8, 1.2),
  arm: (() => { const g = new THREE.CylinderGeometry(2.5, 2.2, 9.5, 12); g.translate(0, -4.2, 0); return g; })(),
  wrist: (() => { const g = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 10); g.translate(0, -9.6, 0); return g; })(),
  hand: (() => { const g = new THREE.SphereGeometry(2.2, 14, 10); g.translate(0, -12, 0.3); return g; })(),   // 圓手
  neck: new THREE.CylinderGeometry(3, 3, 1.6, 14),
  head: rbox(10.6, 9.4, 9.6, 2.2),   // 方塊頭：Cubbi 的招牌
  face: new THREE.PlaneGeometry(9.4, 8.4),
  print: new THREE.PlaneGeometry(12, 12.4),
  // 頭髮：方塊頭上蓋一片、後腦一片（原點在底部，往上長）
  hairTop: rbox(11.4, 3.6, 10.8, 1.5, 0, 1.8, 0),
  hairBack: rbox(11.2, 6.4, 1.8, 0.8, 0, 0, -4.5),
  brim: new THREE.BoxGeometry(8.5, 0.9, 5.5),
  mug: new THREE.CylinderGeometry(2.2, 2.2, 4.4, 14),
  mugHandle: new THREE.TorusGeometry(1.3, 0.45, 6, 10),
  phone: new THREE.BoxGeometry(2.2, 5, 1),
};

// ── 職業制服 ──────────────────────────────────────────────────────────────────
// 同一個專案＝同一個部門＝同一套制服；常用專案指定職業，其他專案從職業池固定分配一套。
// 每個人另外有自己的髮型、髮色、眼鏡、鬍子、雀斑，同部門也認得出誰是誰。
export const OUTFIT_POOL = ['chef', 'astronaut', 'firefighter', 'doctor', 'wizard', 'pirate', 'builder', 'detective', 'police', 'scientist', 'painter', 'athlete'];

// 頭飾（掛在頭上；頭的原點在脖子，頭頂約 y=9.4）
export const hatPart = {
  fedora(head, c) {
    head.add(at(mesh(new THREE.CylinderGeometry(5.1, 5.6, 5, 20), c), 0, 12.2, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(9, 9, 0.8, 26), c), 0, 9.9, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(5.65, 5.65, 1.3, 20), '#1b1b1b'), 0, 10.9, 0));
  },
  beret(head, c) {
    const b = mesh(new THREE.SphereGeometry(6.8, 22, 12), c); b.scale.set(1, 0.36, 1); b.position.set(0.6, 10.5, 0); b.rotation.z = -0.18; head.add(b);
    head.add(at(mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.6, 8), c), 0.6, 13.1, 0));
  },
  catears(head, c) {
    const top = mesh(FG.hairTop, c); top.position.y = 8.2; top.scale.y = 0.8; head.add(top);
    const back = mesh(FG.hairBack, c); back.position.y = 6.2; head.add(back);
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(2.4, 4, 4), c); ear.position.set(sx * 3.6, 12.4, 0.4); ear.rotation.z = -sx * 0.3; head.add(ear);
      const inner = mesh(new THREE.ConeGeometry(1.2, 2.6, 4), '#e4adc8'); inner.position.set(sx * 3.6, 12.2, 1.6); inner.rotation.z = -sx * 0.3; head.add(inner);
    }
  },
  toque(head) {
    head.add(at(mesh(new THREE.CylinderGeometry(5.2, 5, 6.5, 20), '#f4f4f4'), 0, 12.4, 0));
    const puff = mesh(new THREE.SphereGeometry(6.4, 20, 12), '#f4f4f4'); puff.scale.y = 0.55; puff.position.y = 16; head.add(puff);
  },
  spacehelmet(head) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(8.8, 26, 18, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9), plastic('#f4f4f4'));
    shell.material = plastic('#f4f4f4'); shell.castShadow = true; shell.position.y = 5.6; head.add(shell);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(8.7, 20, 14, Math.PI / 2 - 0.95, 1.9, 0.5, 1.6),
      new THREE.MeshPhysicalMaterial({ color: '#9fd0ff', transparent: true, opacity: 0.25, roughness: 0.02, clearcoat: 1 }));
    visor.position.y = 5.6; head.add(visor);
  },
  firehelmet(head, c) {
    const top = mesh(FG.hairTop, c); top.position.y = 8.4; top.scale.set(1.08, 0.9, 1.08); head.add(top);
    head.add(at(mesh(new THREE.BoxGeometry(11, 0.9, 15), c), 0, 8.6, -2.4));
    head.add(at(mesh(new THREE.BoxGeometry(3.4, 4, 0.8), '#c9a227'), 0, 11.4, 6.1));
  },
  wizardhat(head, c) {
    const cone = mesh(new THREE.ConeGeometry(6.6, 17, 22), c); cone.position.set(0, 18.2, -0.5); cone.rotation.x = -0.12; head.add(cone);
    head.add(at(mesh(new THREE.CylinderGeometry(10.5, 10.5, 0.8, 26), c), 0, 9.8, 0));
  },
  tricorn(head, c) {
    head.add(at(mesh(new THREE.CylinderGeometry(9, 9, 3, 3), c), 0, 10.8, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(5.4, 5.6, 3.2, 18), c), 0, 12, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(9.2, 9.2, 0.6, 3), '#c9a227'), 0, 12.4, 0));
  },
  hardhat(head) {
    const top = mesh(FG.hairTop, '#f2cd37'); top.scale.set(1.12, 0.95, 1.12); top.position.y = 8.6; head.add(top);
    const brim = mesh(FG.brim, '#f2cd37'); brim.scale.set(1.55, 1, 2.4); brim.position.y = 8.8; head.add(brim);
  },
  deerstalker(head, c) {
    const top = mesh(FG.hairTop, c); top.position.y = 8.2; top.scale.set(1.05, 0.78, 1.05); head.add(top);
    head.add(at(mesh(new THREE.BoxGeometry(7, 0.8, 3.4), c), 0, 8.5, 6.2), at(mesh(new THREE.BoxGeometry(7, 0.8, 3.4), c), 0, 8.5, -6.2));
    head.add(at(mesh(new THREE.SphereGeometry(1, 8, 6), c), 0, 12.9, 0));
  },
  policecap(head, c) {
    head.add(at(mesh(new THREE.CylinderGeometry(5.6, 5.4, 2.6, 20), c), 0, 10.5, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(6.9, 6.2, 1.6, 22), c), 0, 12.4, 0));
    head.add(at(mesh(new THREE.BoxGeometry(8, 0.7, 4), '#1b1b1b'), 0, 9.6, 5.4));
    head.add(at(mesh(new THREE.BoxGeometry(2.4, 2.4, 0.6), '#c9a227'), 0, 11.6, 6.6));
  },
  goggles(head) {
    head.add(at(mesh(rbox(11.2, 1.2, 10.2, 0.5), '#1b2a34'), 0, 7.8, 0));   // 繞方塊頭一圈的帶子
    for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.6, 14), new THREE.MeshPhysicalMaterial({ color: '#7cc4ff', roughness: 0.05, clearcoat: 1 }));
      lens.rotation.x = Math.PI / 2; lens.position.set(sx * 2.2, 8, 5.4); head.add(lens);
    }
  },
  headband(head, c) {
    const band = mesh(new THREE.TorusGeometry(5.2, 0.9, 8, 26), c); band.rotation.x = Math.PI / 2; band.position.y = 7.4; head.add(band);
  },
};

// 身上配件（掛在上半身或手上；上半身原點在腰，胸口 z≈4）
export const gearPart = {
  lanyard() {},
  camera(fig) {
    fig.upper.add(at(box(7.5, 5, 3.6, '#1b1b1b'), 0, 4.8, 5.8));
    const lens = mesh(new THREE.CylinderGeometry(1.8, 2, 2.6, 14), '#3a3f44'); lens.rotation.x = Math.PI / 2; lens.position.set(0.8, 4.8, 8.6); fig.upper.add(lens);
    fig.upper.add(at(box(2, 1.2, 1.4, '#a0a5a9'), -2.4, 7.8, 5.8));
  },
  scarf(fig, c) {
    const s = mesh(new THREE.TorusGeometry(4.4, 1.5, 8, 20), c); s.rotation.x = Math.PI / 2; s.position.y = 12.4; fig.upper.add(s);
    const tail = box(3.2, 7, 1.2, c, 2.6, 8.4, 4.6); tail.rotation.z = 0.12; fig.upper.add(tail);
  },
  sword(fig) {
    const g = new THREE.Group();
    g.add(box(2.4, 26, 0.8, '#d7dde2', 0, 14, 0), box(8, 1.4, 1.6, '#5a3210', 0, 0.6, 0), box(1.6, 5, 1.6, '#3a2a1a', 0, -2.6, 0));
    g.position.set(0, 2, -5.4); g.rotation.z = 0.55; fig.upper.add(g);
    for (const sx of [-1, 1]) fig.upper.add(at(box(5.4, 2.2, 8.6, '#7c4a1e'), sx * 7.4, 11.6, 0));
  },
  apron() {},
  backpack(fig) {
    fig.upper.add(at(box(11, 10, 4, '#f4f4f4'), 0, 6, -6));
    fig.upper.add(at(box(3, 3, 1, '#c91a09'), -2.5, 8, -8.2));
  },
  tank(fig) {
    for (const sx of [-1, 1]) fig.upper.add(at(roundBrick(2.4, 10, '#a0a5a9'), sx * 2.8, 6, -6));
  },
  palette(fig) {
    const p = mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.7, 18), '#e4cd9e'); p.position.set(0, -13, 3.4); p.rotation.x = Math.PI / 2; fig.arms[0].add(p);
    for (const [x, y, c] of [[-2, 1.5, '#c91a09'], [1.5, 2, '#0055bf'], [2, -1, '#f2cd37']]) {
      const d = mesh(new THREE.SphereGeometry(0.9, 8, 6), c); d.position.set(x, -13 + y, 3.9); fig.arms[0].add(d);
    }
  },
  magnifier(fig) {
    const ring = mesh(new THREE.TorusGeometry(2.4, 0.5, 8, 18), '#c9a227'); ring.position.set(0, -17.5, 1.6); fig.arms[0].add(ring);
    fig.arms[0].add(at(box(1, 4.4, 1, '#3a2a1a'), 0, -14, 1.6));
  },
  clipboard(fig) {
    fig.arms[0].add(at(box(6, 8, 0.6, '#aa7d55'), 0, -14, 3.4));
    fig.arms[0].add(at(box(5, 6.4, 0.3, '#f4f4f4'), 0, -14.4, 3.8));
  },
};

export const OUTFITS = {
  engineer:   { name: '工程部', torso: '#3a3f44', legs: '#0a3463', print: 'engineer', glasses: 0.6 },
  reporter:   { name: '新聞部', torso: '#b08a5a', legs: '#3a2a1a', print: 'reporter', hat: 'fedora', hatColor: '#6c5a44', gear: 'camera' },
  writer:     { name: '寫稿部', torso: '#720e0f', legs: '#1b2a34', print: 'writer', hat: 'beret', hatColor: '#1b1b1b', gear: 'scarf', gearColor: '#f2cd37', accent: '#0055bf' },
  trader:     { name: '交易部', torso: '#0e1d33', legs: '#0e1d33', arms: '#f4f4f4', print: 'trader', hair: 'slick' },
  catkeeper:  { name: '貓咪部', torso: '#f9ba61', legs: '#6c6e68', print: 'catkeeper', hat: 'catears', hatColor: '#aa7d55' },
  hunter:     { name: '狩獵部', torso: '#6b5a3a', legs: '#3a2a1a', print: 'hunter', gear: 'sword' },
  butler:     { name: '總務部', torso: '#0e1418', legs: '#0e1418', print: 'butler', hair: 'slick', beard: 0.3 },
  chef:       { name: '廚房', torso: '#f4f4f4', legs: '#1b1b1b', print: 'chef', hat: 'toque' },
  astronaut:  { name: '太空部', torso: '#f4f4f4', legs: '#f4f4f4', print: 'astronaut', hat: 'spacehelmet', gear: 'backpack', noHair: true },
  firefighter:{ name: '消防隊', torso: '#2c3238', legs: '#2c3238', print: 'firefighter', hat: 'firehelmet', hatColor: '#c91a09', gear: 'tank' },
  doctor:     { name: '醫務室', torso: '#f4f4f4', legs: '#6fb3e0', print: 'doctor', glasses: 0.4 },
  wizard:     { name: '魔法部', torso: '#4b2e8a', legs: '#4b2e8a', print: 'wizard', hat: 'wizardhat', hatColor: '#4b2e8a', beard: 3 },
  pirate:     { name: '海盜船', torso: '#f4f4f4', legs: '#3a2a1a', print: 'pirate', hat: 'tricorn', hatColor: '#1b1b1b', patch: true, beard: 0.6 },
  builder:    { name: '工務部', torso: '#3a7bd5', legs: '#0a3463', print: 'builder', hat: 'hardhat' },
  detective:  { name: '偵探社', torso: '#b08a5a', legs: '#3a2a1a', print: 'detective', hat: 'deerstalker', hatColor: '#8a6440', gear: 'magnifier' },
  police:     { name: '警察局', torso: '#1f3b66', legs: '#0e1d33', print: 'police', hat: 'policecap', hatColor: '#0e1d33' },
  scientist:  { name: '研究所', torso: '#f4f4f4', legs: '#6c6e68', print: 'scientist', hat: 'goggles', gear: 'clipboard', keepHair: true },
  painter:    { name: '美術部', torso: '#e4cd9e', legs: '#0055bf', print: 'painter', hat: 'beret', hatColor: '#c91a09', gear: 'palette' },
  consultant: { name: '外包顧問', torso: '#22272e', legs: '#22272e', print: 'painter2', keepHair: true, hair: 'slick', glasses: 0.7 },
  codexPainter: { name: '外包畫師', torso: '#22272e', legs: '#22272e', print: 'painter2', hat: 'beret', hatColor: '#10a37f', gear: 'palette' },
  codex:      { name: 'Codex', torso: '#10a37f', legs: '#22272e', print: 'engineer', keepHair: true, hair: 'slick' },
  courier:    { name: '快遞', torso: '#7c4a1e', legs: '#5a3210', print: 'courier', hat: 'policecap', hatColor: '#7c4a1e' },
  athlete:    { name: '體育部', torso: '#c91a09', legs: '#f4f4f4', print: 'athlete', hat: 'headband', hatColor: '#f4f4f4', keepHair: true },
};

// 個人特徵：同一段對話永遠長一樣
export function personalLook(seed, o) {
  const h = hash(seed + ':look');
  const r = (n) => ((h >>> n) & 255) / 255;
  return {
    hairColor: HAIR_COLORS[(h >>> 3) % HAIR_COLORS.length],
    skin: SKIN_TONES[(h >>> 13) % SKIN_TONES.length],
    hairStyle: ['hair', 'bun', 'short', 'hair', 'long', 'none'][(h >>> 7) % 6],
    glasses: r(10) < (o.glasses ?? 0.25) ? 1 + ((h >>> 18) & 1) : 0,
    beard: o.beard === 3 ? 3 : r(19) < (o.beard ?? 0.2) ? 1 + ((h >>> 27) & 1) : 0,
    freckles: r(23) < 0.2,
  };
}

export function addHair(head, style, color) {
  if (style === 'none') return;   // 光頭
  const top = mesh(FG.hairTop, color); top.position.y = 8.2; top.scale.y = style === 'slick' || style === 'short' ? 0.6 : 0.8; head.add(top);
  if (style !== 'short') { const back = mesh(FG.hairBack, color); back.position.y = 6.2; head.add(back); }
  if (style === 'long') { const b = mesh(rbox(11.8, 9, 2.8, 1.2, 0, 0, -4.6), color); b.position.y = 1.5; head.add(b); }
  if (style === 'bun') { const bun = mesh(new THREE.SphereGeometry(2.6, 14, 10), color); bun.position.set(0, 12, -2.4); head.add(bun); }
}

// opts.noHat：背景指令的同事要戴安全帽，不戴部門的帽子
export function buildFigure(seed, outfitKey = 'engineer', opts = {}) {
  const o = OUTFITS[outfitKey] || OUTFITS.engineer;
  const look = personalLook(seed, o);
  const torsoColor = o.torso, legColor = o.legs, armColor = o.arms || o.torso, SKIN = look.skin;
  const accent = o.accent || '#c91a09';

  const root = new THREE.Group();
  // 腿
  const hip = mesh(FG.hip, legColor); hip.position.y = 12.3; root.add(hip);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 3.9, 11, 0);
    leg.add(mesh(FG.leg, legColor), mesh(FG.foot, legColor));
    root.add(leg); legs.push(leg);
  }
  // 上半身（以髖為支點）
  const upper = new THREE.Group(); upper.position.y = 13.6; root.add(upper);
  upper.add(mesh(FG.torso, torsoColor));
  const print = new THREE.Mesh(FG.print, new THREE.MeshStandardMaterial({ map: printTex(o.print, accent), transparent: true, roughness: 0.35 }));
  print.position.set(0, 6.2, 4.02); upper.add(print);
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 7.6, 11, 0);
    arm.rotation.z = sx * 0.08;
    arm.add(mesh(FG.arm, armColor), mesh(FG.wrist, SKIN), mesh(FG.hand, SKIN));
    upper.add(arm); arms.push(arm);
  }
  // 頭
  const head = new THREE.Group(); head.position.y = 13.2; upper.add(head);
  head.add(at(mesh(FG.neck, SKIN), 0, 0, 0));
  head.add(at(mesh(FG.head, SKIN), 0, 5.1, 0));
  const feat = { glasses: look.glasses, beard: look.beard, freckles: look.freckles, patch: !!o.patch, beardColor: look.hairColor };
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex('smile', feat), transparent: true, roughness: 0.35 });
  head.add(at(new THREE.Mesh(FG.face, faceMat), 0, 5.1, 4.82));
  const hat = !opts.noHat && o.hat;
  if (!hat || o.keepHair) addHair(head, o.noHair ? 'none' : o.hair || look.hairStyle, look.hairColor);
  else if (o.hat && !o.noHair && o.hat !== 'spacehelmet' && o.hat !== 'catears' && o.hat !== 'firehelmet') {
    const back = mesh(FG.hairBack, look.hairColor); back.position.y = 6.2; head.add(back);   // 帽子底下露出後腦的頭髮
  }
  if (hat) hatPart[hat](head, o.hatColor || torsoColor);
  // 道具：咖啡杯（閒著）與電話（派助手時）
  // 咖啡杯：原點就是把手，C 形手扣住把手、杯身在手外側（main 的 uprightMug 讓杯口一直朝上）
  const mug = new THREE.Group();
  const cup = mesh(FG.mug, '#f4f4f4'); cup.position.set(-3.6, 0, 0); mug.add(cup);
  mug.add(at(roundBrick(2.05, 0.5, '#5a3210', 14), -3.6, 2.0, 0));   // 杯裡的咖啡
  const handle = mesh(FG.mugHandle, '#f4f4f4'); handle.position.set(-1.1, 0, 0); mug.add(handle);   // 把手環在 XY 面，從杯緣伸出來穿過手心
  mug.position.set(0, -12.2, 0.4); mug.visible = false; arms[1].add(mug);
  const phone = mesh(FG.phone, '#1b2a34'); phone.position.set(0, -13.4, 1.4); phone.visible = false; arms[0].add(phone);
  // 遊戲手把：打電視遊樂器時雙手捧在胸前
  const pad = new THREE.Group(); pad.position.set(0, 4.5, 9.5); pad.rotation.x = -0.5; pad.visible = false;
  pad.add(box(6, 1.3, 2.6, '#2c3238'), box(1.8, 1.4, 2.4, '#2c3238', -3, -0.3, 1), box(1.8, 1.4, 2.4, '#2c3238', 3, -0.3, 1));
  for (const [x, c] of [[1.6, '#c91a09'], [2.4, '#0055bf']]) pad.add(box(0.6, 0.4, 0.6, c, x, 0.8, -0.2));
  pad.add(box(1.4, 0.4, 0.5, '#6c6e68', -1.8, 0.8, -0.2));
  upper.add(pad);
  // 雨傘：下雨天從門口進來時撐著
  const umbrella = new THREE.Group(); umbrella.visible = false;
  const canopy = mesh(new THREE.ConeGeometry(13, 5, 10, 1, true), ['#0055bf', '#c91a09', '#f2cd37', '#237841'][hash(seed + 'u') % 4]);
  canopy.material = canopy.material.clone(); canopy.material.side = THREE.DoubleSide;
  canopy.position.set(0, 22, 0); umbrella.add(canopy, at(roundBrick(0.5, 22, '#1b1b1b', 6), 0, 10, 0));
  umbrella.position.set(0, -13, 1.5); arms[1].add(umbrella);
  const book = box(7, 1, 9, ['#c91a09', '#0055bf', '#237841', '#f2cd37'][hash(seed) % 4]); book.position.set(3.5, -13, 3.5); book.rotation.z = 0.5; book.visible = false; arms[0].add(book);
  const fig = { root, legs, upper, arms, head, faceMat, mug, phone, book, pad, umbrella, torsoColor, expr: 'smile', feat, outfit: outfitKey };
  if (o.gear) gearPart[o.gear](fig, o.gearColor || accent);
  for (const x of [mug, phone, book, pad, umbrella]) x.userData.keep = true;
  for (const leg of legs) mergeStatic(leg);
  for (const arm of arms) mergeStatic(arm);
  mergeStatic(head);
  for (const x of [...arms, head]) x.userData.keep = true;   // 併上半身時不要碰到手和頭（它們會轉）
  mergeStatic(upper);
  for (const x of [...arms, head]) x.userData.keep = false;
  return fig;
}

