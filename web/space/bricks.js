// 積木的材質與基本零件：亮面塑膠（指紋刮痕）、導角磚、顆粒板、canvas 貼圖快取
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// ── 場景 ──────────────────────────────────────────────────────────────────────
// 單位是公釐，照實體積木的比例：顆粒間距 8、小人高 40。
// 美術方向是「樂高大電影」：亮面塑膠＋導角、整個世界都是積木、微距淺景深、暖色打光、一秒 12 格的定格動作。
export const MOBILE = matchMedia('(max-width: 760px)').matches || /iPhone|Android/.test(navigator.userAgent);
// ── 積木材質與零件 ────────────────────────────────────────────────────────────
// 指紋、細刮痕：粗糙度貼圖上的淡斑和細線，近看時反光才不會像 CG 一樣完美
export const smudge = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, 256, 256);
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 18; i++) {   // 指紋：一圈圈淡淡的同心弧
    const x = r() * 256, y = r() * 256, rad = 10 + r() * 14;
    g.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.05})`; g.lineWidth = 1.2;
    for (let k = 3; k < rad; k += 2.2) { g.beginPath(); g.ellipse(x, y, k, k * 1.25, r(), 0, Math.PI * 1.7); g.stroke(); }
  }
  for (let i = 0; i < 40; i++) {   // 刮痕
    const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 6 + r() * 30;
    g.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
export const matCache = new Map();
export function plastic(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshPhysicalMaterial({
    color, roughness: 0.42, roughnessMap: smudge, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.14, specularIntensity: 0.5,
  }));
  return matCache.get(color);
}
export const SKIN = '#f6cf2c';
export const HAIR_COLORS = ['#352100', '#1b2a34', '#aa7d55', '#e4cd9e', '#720e0f', '#f2cd37'];
export const PLATE_COLORS = ['#a0a5a9', '#e4cd9e', '#9fc3e9', '#a3d48c', '#f9ba61', '#c7a5d8', '#f2a8c4'];

export function shade(hex, f) { return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString(); }

// 顆粒：邊緣圓一點，光打上去才有一圈亮邊
export const G = {
  stud: new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(2.4, 0), new THREE.Vector2(2.4, 1.45),
    new THREE.Vector2(2.3, 1.72), new THREE.Vector2(2.1, 1.8), new THREE.Vector2(0, 1.8)], MOBILE ? 12 : 18),
};
export const boxCache = new Map();
export function bevelBox(w, h, d) {
  const k = `${w}:${h}:${d}`;
  if (!boxCache.has(k)) boxCache.set(k, new RoundedBoxGeometry(w, h, d, 2, Math.min(0.5, w / 4, h / 4, d / 4)));
  return boxCache.get(k);
}
export function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(bevelBox(w, h, d), plastic(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
// 一塊板子＋上面的顆粒（顆粒用 instancing，數量多也不吃力）
export function plate(wStuds, dStuds, h, color, studs = true) {
  const g = new THREE.Group();
  const w = wStuds * 8, d = dStuds * 8;
  g.add(box(w, h, d, color, 0, h / 2, 0));
  if (studs) {
    const inst = new THREE.InstancedMesh(G.stud, plastic(color), wStuds * dStuds);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let a = 0; a < wStuds; a++) for (let b = 0; b < dStuds; b++) {
      m.makeTranslation(-w / 2 + 4 + a * 8, h + 0.9, -d / 2 + 4 + b * 8);
      inst.setMatrixAt(i++, m);
    }
    inst.castShadow = wStuds * dStuds < 40;
    inst.receiveShadow = true;
    g.add(inst);
  }
  return g;
}

// ── 臉、衣服印花、螢幕畫面（畫在 canvas 上當貼圖） ──────────────────────────
export const texCache = new Map();
export function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
export function mesh(geo, color, mat) {
  const m = new THREE.Mesh(geo, mat || plastic(color));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function canvasTexture(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
export function texBox(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(bevelBox(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}
export function roundBrick(r, h, color, seg = 18) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), plastic(color));
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function at(o, x, y, z, ry = 0) { o.position.set(x, y, z); o.rotation.y = ry; return o; }

// 合併不會動的零件：一個群組裡同材質的 mesh 併成一個，繪製呼叫從幾十次降到幾次。
// 標了 userData.keep 的子樹不碰（會動、會換顯示、要點選的東西）；有子物件的 mesh 也不併（避免連帶拿掉）。
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const victims = [];
  const m = new THREE.Matrix4();
  const walk = (o) => {
    for (const c of o.children) {
      if (c.userData.keep) continue;
      if (c.isMesh && !c.isInstancedMesh && !c.children.length && c.visible && !Array.isArray(c.material)) {
        let g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.morphAttributes = {};
        g.applyMatrix4(m.multiplyMatrices(inv, c.matrixWorld));
        const key = c.material;
        if (!byMat.has(key)) byMat.set(key, { geos: [], cast: false, receive: false });
        const e = byMat.get(key);
        e.geos.push(g); e.cast ||= c.castShadow; e.receive ||= c.receiveShadow;
        victims.push(c);
      } else if (c.children.length) walk(c);
    }
  };
  walk(root);
  if (victims.length < 2) return root;
  for (const v of victims) v.removeFromParent();
  for (const [mat, e] of byMat) {
    const merged = new THREE.Mesh(e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos), mat);
    merged.castShadow = e.cast; merged.receiveShadow = e.receive;
    merged.userData.merged = true;
    root.add(merged);
  }
  return root;
}
