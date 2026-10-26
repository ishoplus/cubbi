// ── 外掛：倉庫貨架＝這台電腦的硬碟（Cubbi 單獨跑與 remote 都內建）──────────────────────
//
// 靠牆一座四層鐵架，一層 5 格、一格 5%：硬碟用了幾成，就堆幾格紙箱（照實升降，數字來自 server/disk.js 的 statfs）。
// 剩下的空間低於 lowPct％：架頂的警示燈亮紅、慢慢明暗。點貨架打開抽屜看數字；
// remote 版（能開對話）多一顆「交給 CC 清理」：開一段新對話，先盤點、列清單，你點頭的才清。
// 推播連結帶 ?disk=1：開頁就飛到貨架、打開抽屜。
// i18n.js 不在模組頂層 import：remote 的 host.js 開機時 await 外掛載完，i18n.js 又 import host.js，會互等整頁卡住。
// init 時 host.js 已經好了，再動態拿；在那之前（辦公室先蓋好的話）先用中文
let tr = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s), LOCALE = 'zh-TW';

// 英文：init 時才加進 i18n.js 的表
const EN_TEXT = {
  '硬碟': 'Disk', '倉庫貨架': 'Storage rack', '已用 {used} / {total}': '{used} used of {total}', '剩 {free}（{pct}%）': '{free} free ({pct}%)',
  '空間快不夠了': 'Running out of space', '空間還夠': 'Plenty of space',
  '一格紙箱是 5%。數字照實讀自這台電腦的硬碟（對話資料夾所在的那顆），每 5 分鐘更新，只看不動。': 'Each box is 5%. Read straight from this computer\'s disk (the one your projects are on), refreshed every 5 minutes. Read-only.',
  '剩下不到 {n}% 時架上的燈會亮紅，設了推播會通知你一次。': 'Below {n}% free the lamp turns red, and you get one push if notifications are set up.',
  '交給 CC 清理': 'Hand cleanup to CC', '會開一段新對話：先盤點最佔空間的地方、列成清單，你點頭的才清；你自己的檔案只建議搬，不會刪。': 'Opens a new chat: it surveys what takes the most space and lists it, cleans only what you approve, and never deletes your own files (it only suggests moving them).',
  '開工了，盤點完會舉手等你點頭': 'Started — it will raise its hand when the list is ready', '上一段清理還在進行，帶你過去': 'A cleanup is already running — taking you there',
  '他還沒進辦公室，等一下再看': 'Not in the office yet — check again shortly', '讀不到硬碟空間': 'Can\'t read disk space', '開不了：{msg}': 'Couldn\'t start: {msg}',
  '數字時間 {t}': 'As of {t}',
};

const SHELVES = 4, PER = 5, SLOTS = SHELVES * PER;   // 20 格，一格 5%
const RW = 46, RD = 15, LH = 15, RH = SHELVES * LH + 6;   // 架子寬、深、層高、總高
const BOX_COLORS = ['#c49a6c', '#b88d5f', '#d1a877', '#bf9264'];
const fmtBytes = (n) => (n >= 1024 ** 4 ? (n / 1024 ** 4).toFixed(1) + 'T' : n >= 1024 ** 3 ? Math.round(n / 1024 ** 3) + 'G' : Math.round(n / 1024 ** 2) + 'M');

let ctx = null, stat = null, drawer = null, rack = null;   // stat：/api/space/disk 的最新數字

async function load() {
  try { stat = await ctx.api('/api/space/disk'); } catch { return; }
  applyRack(); paint();
}

// ── 貨架：每格一個紙箱，用了幾格就顯示幾格；新增的從上面輕輕放下 ──
function buildRack(o) {
  const { THREE, hw, hd } = o;
  const g = new THREE.Group();
  // 方塊用場景給的 THREE 自己建（不 import bricks.js：它一載入就要瀏覽器，host.js 在 Node 測試裡也會被載入）
  const mats = new Map();
  const box = (w, h, d, c, x, y, z) => {
    if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.get(c)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m;
  };
  const steel = '#7d8388';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1.6, RH, 1.6, steel, sx * (RW / 2 - 0.8), RH / 2, sz * (RD / 2 - 0.8)));
  for (let i = 0; i < SHELVES; i++) g.add(box(RW, 1.2, RD, '#a0a5a9', 0, 1.5 + i * LH, 0));
  g.add(box(RW, 1.2, RD, '#5c6166', 0, RH - 0.6, 0));   // 頂板深一點：天花板燈直照會發白
  const cw = (RW - 3) / PER;
  const boxes = [];
  for (let s = 0; s < SHELVES; s++) for (let i = 0; i < PER; i++) {
    const k = s * PER + i, h = 9 + ((k * 7) % 3);
    const b = box(cw - 1.2, h, RD - 3, BOX_COLORS[k % BOX_COLORS.length], -RW / 2 + 1.5 + cw * (i + 0.5), 2.1 + s * LH + h / 2, 0.5);
    b.userData.y0 = b.position.y; b.userData.cur = 0; b.userData.want = 0; b.visible = false;
    g.add(b); boxes.push(b);
  }
  // 警示燈：架頂中間，平常暗灰，空間快不夠時亮紅
  const lampMat = new THREE.MeshStandardMaterial({ color: '#5c6166', emissive: '#c91a09', emissiveIntensity: 0, roughness: 0.4 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), lampMat);
  lamp.position.set(0, RH, 0); g.add(lamp, box(4, 1, 4, '#3a3f44', 0, RH + 0.1, 0));
  rack = { g, boxes, lampMat, glow: 0 };

  // 位置：沿牆找一段空著的（後牆優先，再來左右牆），背靠牆、面向辦公室裡面
  const free = (x, z, w, d) => !o.obstacles.some(r => Math.abs(r.x - x) * 2 < r.w + w + 6 && Math.abs(r.z - z) * 2 < r.d + d + 6)
    && !o.places.some(p => (p.area || []).some(a => x + w / 2 > a[0] && x - w / 2 < a[2] && z + d / 2 > a[1] && z - d / 2 < a[3]));
  const spots = [];
  for (let x = hw - 70; x > -hw + 70; x -= 8) spots.push({ x, z: hd - RD / 2 - 2, ry: Math.PI, w: RW, d: RD });
  for (let z = hd - 60; z > -hd + 90; z -= 8) spots.push({ x: hw - RD / 2 - 2, z, ry: -Math.PI / 2, w: RD, d: RW }, { x: -hw + RD / 2 + 2, z, ry: Math.PI / 2, w: RD, d: RW });
  const at = spots.find(s => free(s.x, s.z, s.w, s.d)) || spots[0];
  g.position.set(at.x, 0, at.z); g.rotation.y = at.ry;
  g.traverse(m => { if (m.isMesh) o.pick(m, openDrawer); });
  o.group.add(g);
  o.obstacle({ x: at.x, z: at.z, w: at.w, d: at.d });
  // 鏡頭從貨架正前方、稍高一點看（架子的正面朝 local +z）
  o.place('disk', tr('倉庫貨架'), [at.x, RH / 2, at.z], [Math.sin(at.ry) * 190, 95, Math.cos(at.ry) * 190], [[at.x - at.w / 2 - 6, at.z - at.d / 2 - 6, at.x + at.w / 2 + 6, at.z + at.d / 2 + 6]]);
  o.npc(tick);
  applyRack(true);
}

function applyRack(snap = false) {
  if (!rack) return;
  const n = stat ? Math.max(0, Math.min(SLOTS, Math.round(stat.usedPct / (100 / SLOTS)))) : 0;
  rack.boxes.forEach((b, k) => { b.userData.want = k < n ? 1 : 0; if (snap) { b.userData.cur = b.userData.want; showBox(b); } });
}
function showBox(b) {
  const c = b.userData.cur;
  b.visible = c > 0.01;
  b.position.y = b.userData.y0 + (1 - c) * 8;   // 從上面放下來
  b.scale.setScalar(0.6 + 0.4 * c);
}
let lastT = 0;
function tick(time) {
  if (!rack) return;
  const dt = lastT ? Math.min(0.1, time - lastT) : 0; lastT = time;
  for (const b of rack.boxes) {
    const u = b.userData;
    if (Math.abs(u.want - u.cur) < 0.005) { if (u.cur !== u.want) { u.cur = u.want; showBox(b); } continue; }
    u.cur += (u.want - u.cur) * (1 - Math.pow(0.15, dt)); showBox(b);
  }
  // 紅燈慢慢明暗（不閃），空間夠了慢慢熄
  const want = stat?.low ? 0.55 + 0.35 * Math.sin(time * 1.2) : 0;
  rack.glow += (want - rack.glow) * (1 - Math.pow(0.2, dt));
  rack.lampMat.emissiveIntensity = Math.max(0, rack.glow);
  rack.lampMat.color.set(rack.glow > 0.05 ? '#e8442e' : '#5c6166');
}

// ── 抽屜：數字＋（remote）交給 CC 清理 ──
function mountUi() {
  drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div><div class="p-head">
      <div class="p-swatch" style="background:#c49a6c"></div>
      <div style="min-width:0"><div class="p-title">${ctx.esc(tr('硬碟'))}</div><div class="p-sub"></div></div>
      <button class="p-close" title="${tr('關閉')}">✕</button></div>
    <div class="lvbar"></div><div class="p-body"><div class="pane on"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('.p-close').onclick = () => drawer.classList.remove('open');
}
function openDrawer() { ctx.closePanel(); drawer.classList.add('open'); paint(); load(); }

function paint() {
  if (!drawer?.classList.contains('open')) return;
  const esc = ctx.esc, sub = drawer.querySelector('.p-sub'), bar = drawer.querySelector('.lvbar'), pane = drawer.querySelector('.pane');
  if (!stat) { sub.textContent = tr('讀不到硬碟空間'); bar.innerHTML = pane.innerHTML = ''; return; }
  const pct = Math.round(100 - stat.usedPct), color = stat.low ? '#c91a09' : '#0055bf';
  sub.textContent = stat.low ? tr('空間快不夠了') : tr('空間還夠');
  bar.innerHTML = `<div class="row"><span>${esc(tr('已用 {used} / {total}', { used: fmtBytes(stat.used), total: fmtBytes(stat.total) }))}</span><span style="color:${color};font-weight:700">${esc(tr('剩 {free}（{pct}%）', { free: fmtBytes(stat.free), pct }))}</span></div>
    <div class="bar"><i style="width:${stat.usedPct.toFixed(1)}%;background:${color}"></i></div>`;
  const stream = document.body.classList.contains('stream');
  pane.innerHTML = (stat.canClean && !stream
    ? `<div class="sec"><button class="btn" id="disk-clean">${esc(tr('交給 CC 清理'))}</button>
       <div style="font-size:12px;color:var(--sub);line-height:1.7;margin-top:8px">${esc(tr('會開一段新對話：先盤點最佔空間的地方、列成清單，你點頭的才清；你自己的檔案只建議搬，不會刪。'))}</div></div>` : '')
    + `<div class="sec" style="font-size:12px;color:var(--sub);line-height:1.7">${esc(tr('一格紙箱是 5%。數字照實讀自這台電腦的硬碟（對話資料夾所在的那顆），每 5 分鐘更新，只看不動。'))}<br>${esc(tr('剩下不到 {n}% 時架上的燈會亮紅，設了推播會通知你一次。', { n: stat.lowPct }))}<br>${esc(tr('數字時間 {t}', { t: new Date(stat.at).toLocaleString(LOCALE) }))}</div>`;
  const btn = pane.querySelector('#disk-clean');
  if (btn) btn.onclick = clean;
}

async function clean(e) {
  const btn = e.currentTarget; btn.disabled = true;
  try {
    const r = await ctx.post('/api/space/disk/clean', {}); const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.sid) { ctx.toast(tr('開不了：{msg}', { msg: j.error || r.status })); return; }
    ctx.toast(tr(j.existing ? '上一段清理還在進行，帶你過去' : '開工了，盤點完會舉手等你點頭'));
    drawer.classList.remove('open');
    lookAt(j.sid);
  } finally { btn.disabled = false; }
}
// 剛開的對話要等辦公室下一次更新才會出現，多試幾次
function lookAt(sid, tries = 8) {
  if (ctx.focusPerson?.(sid)) return;
  if (tries > 0) setTimeout(() => lookAt(sid, tries - 1), 1500);
  else ctx.toast(tr('他還沒進辦公室，等一下再看'));
}

export const diskPlugin = {
  name: 'disk',
  async init(c) {
    ctx = c;
    const i18n = await import('../i18n.js');
    tr = i18n.t; LOCALE = i18n.LOCALE; i18n.addEN(EN_TEXT);
    mountUi(); await load();
    setInterval(load, 5 * 60_000);
    if (new URLSearchParams(location.search).has('disk')) setTimeout(() => { ctx.flyToPlace?.('disk'); openDrawer(); }, 1200);
  },
  office: buildRack,
  onEvent(msg) { if (msg.type === 'disk') { load(); return true; } return false; },
};
export { diskPlugin as disk };
export default diskPlugin;
