// ── 外掛：總務部服務鈴（Cubbi remote 內建；伺服器那一半是 remote/frontdesk.js）──────────
//
// 主管室門口右邊一張小服務台，台上一顆服務鈴。點鈴（或區域「總務部」）拉出抽屜，裡面就是總務部那段對話
// （嵌對話頁 /?embed=1&desk=1），不用離開辦公室。
// 總務部有派工卡在等你確認（真的有提問沒答）時，鈴會跳、會亮；沒有就靜靜放著。

import { t } from './lang.js';

let ctx = null, drawer = null, frame = null, pending = false;
let dome = null, glow = null;

// ── 服務台＋服務鈴：主管室門口右側，貼著主管室的前牆（尺寸跟 Cubbi 的 BOSS_ROOM 一樣：寬 120、深 100、門 30）──
function buildBell(o) {
  const { THREE, hw, hd } = o;
  const W = 120, D = 100, DOOR = 30;
  const cx = hw - W / 2 - 4, cz = -hd + D / 2 + 4;
  const X = cx - W / 2 + DOOR + 14, Z = cz + D / 2 + 10;
  const g = new THREE.Group();
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...extra });
  const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
  add(new THREE.BoxGeometry(18, 30, 12), mat('#6b4a2b'), 0, 15, 0);                  // 台身
  add(new THREE.BoxGeometry(14, 22, 0.6), mat('#7d5a37'), 0, 15, 6.2);                // 前面的飾板
  add(new THREE.BoxGeometry(22, 2, 15), mat('#3a2414'), 0, 31, 0);                    // 檯面
  const silver = mat('#d9dde2', { metalness: 0.85, roughness: 0.22 });
  add(new THREE.CylinderGeometry(4.6, 4.8, 1, 24), mat('#2a2a2a', { metalness: 0.4 }), 0, 32.5, 0);   // 鈴座
  dome = add(new THREE.SphereGeometry(4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver, 0, 33, 0); // 鈴罩
  const knob = add(new THREE.SphereGeometry(0.9, 12, 8), silver, 0, 4.2, 0);           // 按鈕（跟著鈴罩動）
  knob.removeFromParent(); dome.add(knob);
  // 有派工卡在等：鈴上方一圈暖光
  glow = add(new THREE.SphereGeometry(6.5, 20, 12), new THREE.MeshBasicMaterial({ color: '#f2cd37', transparent: true, opacity: 0.18, depthWrite: false }), 0, 35, 0);
  glow.visible = false;
  g.position.set(X, 0, Z);
  g.traverse(m => { if (m.isMesh) o.pick(m, openDesk); });
  o.group.add(g);
  o.obstacle({ x: X, z: Z, w: 24, d: 18 });
  o.place('desk', t('總務部'), [X, 30, Z], [-50, 60, 110], [[X - 18, Z - 12, X + 18, Z + 24]]);
  // 等你確認：鈴罩一下一下地彈（叮、叮），光圈呼吸
  o.npc((time) => {
    if (!dome) return;
    const ring = pending ? Math.max(0, Math.sin(time * 9)) * (Math.sin(time * 1.4) > 0 ? 1 : 0) : 0;
    dome.position.y = 33 + ring * 0.8;
    glow.visible = pending;
    if (pending) glow.material.opacity = 0.12 + Math.abs(Math.sin(time * 2)) * 0.14;
  });
}

// ── 抽屜：嵌總務部的對話頁 ──
function mountUi() {
  const css = document.createElement('style');
  css.textContent = `
  #desk-drawer { width: min(560px, 50vw); }
  @media (max-width: 760px) { #desk-drawer { width: auto; height: 82dvh; } }
  #desk-drawer iframe { flex: 1; width: 100%; border: 0; background: transparent; }`;
  document.head.appendChild(css);
  drawer = document.createElement('aside');
  drawer.id = 'desk-drawer'; drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div>
  <div class="p-head">
    <div class="p-swatch" style="background:#d9dde2"></div>
    <div style="min-width:0"><div class="p-title">🛎 ${t('總務部')}</div><div class="p-sub">${t('只派工：每次派之前都先問你')}</div></div>
    <button class="p-close" title="${t('關閉')}">✕</button>
  </div>`;
  drawer.querySelector('.p-close').onclick = () => drawer.classList.remove('open');
  document.body.appendChild(drawer);
}

function openDesk() {
  ctx.closePanel?.();
  if (!frame) {
    frame = document.createElement('iframe');
    frame.src = '/?embed=1&desk=1';
    drawer.appendChild(frame);
  }
  drawer.classList.add('open');
  ctx.sfx?.ping?.();   // 叮
}

async function load() {
  try { pending = !!(await ctx.api('/api/desk')).pending; } catch {}
}

export const desk = {
  name: 'desk',
  async init(c) {
    ctx = c;
    mountUi();
    await load();
    setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    if (new URLSearchParams(location.search).has('desk')) setTimeout(() => { ctx.flyToPlace?.('desk'); openDesk(); }, 1200);
  },
  office: buildBell,
};
