// ── 點歌機：休息區旁靠牆一台，點了打開抽屜點歌 ──────────────────────────────────
//
// 長相跟著真的在放的音樂：有在放才轉唱片、燈才亮（顏色＝這首歌在歌單上的顏色，歌單有 bpm 就跟著拍子輕輕亮）；
// 音樂關著就是一台暗著的機器。播放、歌單、待播都在 music.js，這裡只畫跟按。
// 用外掛的介面接進場景（main.js 把它排在宿主外掛前面），所以 Cubbi 單獨跑、remote、claude-web 都有。

import * as THREE from 'three';
import { box, roundBrick, plastic } from './bricks.js';
import { t as tr, addEN, LANG } from './i18n.js';
import { musicState, onMusic, musicBeat, setMusic, enqueue, unqueue, playNow, skip, setMode, refreshLibrary } from './music.js';

addEN({
  '點歌機': 'Jukebox', '正在放：{t}': 'Now playing: {t}', '換歌中：{t}': 'Switching to: {t}', '音樂關著': 'Music is off',
  '開音樂': 'Music on', '關音樂': 'Music off', '切歌': 'Skip', '單曲循環': 'Repeat one', '照順序': 'In order', '隨機': 'Shuffle',
  '待播': 'Up next', '歌單': 'Songs', '點歌': 'Queue', '現在放': 'Play now', '拿掉': 'Remove',
  '正在放': 'Playing', '排第 {n}': '#{n} in line', '放不出來': 'Can\'t play',
  '沒人點歌：放完這首重複放': 'Nothing queued: this song repeats', '沒人點歌：照歌單順序放': 'Nothing queued: playing the list in order', '沒人點歌：隨機挑下一首': 'Nothing queued: picking at random',
  '排進去了，這首放完就輪到': 'Queued — plays after this one', '排進去了，排第 {n}': 'Queued — #{n} in line', '已經在排了': 'Already queued', '這首正在放': 'Already playing',
  '待播滿了': 'Queue is full', '這首放不出來': 'This song can\'t be played', '這首下架了': 'This song was removed',
  '歌單是空的': 'No songs yet',
  '加歌：mp3 放進 web/space/music/，在 tracks.json 加一行；拿掉那一行就下架。': 'Add a song: drop the mp3 in web/space/music/ and add a line to tracks.json. Remove the line to take it down.',
});

const W = 26, D = 14, H = 44;   // 寬、深、機身高（上面再一個半圓頂）
let ctx = null, drawer = null, jb = null;
const title = (t) => (LANG === 'en' && t.en ? t.en : t.title);

// ── 機器 ──
function buildJukebox(o) {
  const g = new THREE.Group();
  const wood = '#6b3a1f', dark = '#3a2414';
  g.add(box(W + 2, 2, D + 2, dark, 0, 1, 0));
  g.add(box(W, H - 2, D, wood, 0, 1 + (H - 2) / 2, 0));
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, D - 2, 24, 1, false, -Math.PI / 2, Math.PI), plastic(wood));
  dome.rotation.x = -Math.PI / 2; dome.position.set(0, H, 0); dome.castShadow = true; g.add(dome);
  // 正面（local +z）：上面玻璃窗看得到唱片，中間一排選歌鈕，下面喇叭格柵
  const fz = D / 2;
  g.add(box(18, 13, 0.6, '#1b1b1b', 0, 35, fz + 0.2));
  const rec = new THREE.Group(); rec.position.set(0, 35, fz + 0.7);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.5, 28), plastic('#141414')); disc.rotation.x = Math.PI / 2; rec.add(disc);
  const labelMat = new THREE.MeshStandardMaterial({ color: '#a0a5a9', roughness: 0.5 });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.62, 20), labelMat); label.rotation.x = Math.PI / 2; rec.add(label);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), plastic('#f4f4f4')); notch.position.set(0, 1.1, 0.1); rec.add(notch);   // 看得出在轉
  g.add(rec);
  for (const [i, c] of ['#c91a09', '#f2cd37', '#0055bf', '#237841', '#fe8a18', '#f4f4f4'].entries()) {
    const b = roundBrick(1, 1, c, 12); b.rotation.x = Math.PI / 2; b.position.set(-7.5 + i * 3, 25, fz + 0.4); g.add(b);
  }
  g.add(box(18, 13, 0.6, dark, 0, 12, fz + 0.2));
  for (let i = 0; i < 4; i++) g.add(box(16, 1, 0.8, '#d4a017', 0, 7.5 + i * 3, fz + 0.5));
  // 燈管：兩側直的＋頂上一道弧
  const lampMat = new THREE.MeshStandardMaterial({ color: '#8a8f94', emissive: '#000000', emissiveIntensity: 1, roughness: 0.35 });
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, H - 6, 2.4), lampMat); m.position.set(sx * (W / 2 - 0.4), 3 + (H - 6) / 2, fz - 0.6); g.add(m); }
  const arc = new THREE.Mesh(new THREE.TorusGeometry(W / 2 - 0.4, 1.2, 8, 28, Math.PI), lampMat); arc.position.set(0, H, fz - 1.2); g.add(arc);
  jb = { g, rec, labelMat, lampMat, glow: 0, spin: 0, color: new THREE.Color('#8a8f94'), lastT: 0 };

  // 位置：休息區旁的右牆優先（沙發與共用桌中間），沒位子再沿其他牆找；背靠牆、面向辦公室裡面
  const { hw, hd } = o;
  const free = (x, z, w, d) => !o.obstacles.some(r => Math.abs(r.x - x) * 2 < r.w + w + 6 && Math.abs(r.z - z) * 2 < r.d + d + 6);
  const spots = [];
  for (let z = hd - 62; z > -hd + 110; z -= 8) spots.push({ x: hw - D / 2 - 2, z, ry: -Math.PI / 2, w: D, d: W });
  for (let x = hw - 110; x > -hw + 60; x -= 8) spots.push({ x, z: hd - D / 2 - 2, ry: Math.PI, w: W, d: D });
  for (let z = -hd + 60; z < hd - 90; z += 8) spots.push({ x: -hw + D / 2 + 2, z, ry: Math.PI / 2, w: D, d: W });
  const at = spots.find(s => free(s.x, s.z, s.w, s.d)) || spots[0];
  g.position.set(at.x, 0, at.z); g.rotation.y = at.ry;
  g.userData.keep = true;   // 唱片會轉、燈會變：不要被合併
  g.traverse(m => { if (m.isMesh) o.pick(m, openDrawer); });
  o.group.add(g);
  o.obstacle({ x: at.x, z: at.z, w: at.w + 2, d: at.d + 2 });
  o.place('jukebox', tr('點歌機'), [at.x, 28, at.z], [Math.sin(at.ry) * 210 + 40, 110, Math.cos(at.ry) * 210 + 40]);
  o.npc(tick);
  paintMachine();
}

function paintMachine() {
  if (!jb) return;
  const s = musicState(), t = s.now || s.pending;
  jb.want = s.on && s.now ? 1 : 0;
  jb.color.set(t && s.on ? t.color : '#8a8f94');
  jb.labelMat.color.copy(jb.color);
}

function tick(time) {
  if (!jb) return;
  const dt = jb.lastT ? Math.min(0.1, time - jb.lastT) : 0; jb.lastT = time;
  const k = 1 - Math.pow(0.3, dt);
  jb.spin += ((jb.want || 0) * 3.4 - jb.spin) * k;   // 唱片 33 轉，開始、停下都慢慢來
  jb.rec.rotation.z -= jb.spin * dt;
  // 燈：有拍子就每拍輕輕亮一下（不閃），沒拍子就慢慢呼吸
  const ph = musicBeat();
  const pulse = ph == null ? 0.5 + 0.5 * Math.sin(time * 1.4) : (1 - ph) * (1 - ph);
  const want = jb.want ? 0.45 + 0.3 * pulse : 0;
  jb.glow += (want - jb.glow) * (1 - Math.pow(0.05, dt));
  jb.lampMat.emissive.copy(jb.color).multiplyScalar(jb.glow);
  jb.lampMat.color.copy(jb.color).lerp(new THREE.Color('#8a8f94'), 1 - Math.min(1, jb.glow * 2));
}

// ── 抽屜 ──
function mountUi() {
  drawer = document.createElement('aside');
  drawer.className = 'drawer jukebox';
  drawer.innerHTML = `<div class="grip"></div><div class="p-head">
      <div class="p-swatch"></div>
      <div style="min-width:0"><div class="p-title">${ctx.esc(tr('點歌機'))}</div><div class="p-sub"></div></div>
      <button class="p-close" title="${tr('關閉')}">✕</button></div>
    <div class="p-body"><div class="pane on"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('.p-close').onclick = () => drawer.classList.remove('open');
  drawer.addEventListener('click', onClick);
}
function openDrawer() {
  ctx.closePanel();
  for (const d of document.querySelectorAll('.drawer.open')) if (d !== drawer) d.classList.remove('open');
  drawer.classList.add('open');
  paint();
  refreshLibrary();   // 剛加的歌、剛下架的歌，打開就看得到
}

function paint() {
  paintMachine();
  if (!drawer?.classList.contains('open')) return;
  const esc = ctx.esc, s = musicState(), name = (t) => esc(title(t));
  const top = s.on && (s.pending || s.now);
  drawer.querySelector('.p-swatch').style.background = top ? top.color : '#c9d1d9';
  drawer.querySelector('.p-sub').textContent = !s.on ? tr('音樂關著') : s.pending ? tr('換歌中：{t}', { t: title(s.pending) }) : s.now ? tr('正在放：{t}', { t: title(s.now) }) : '';
  const dot = (c) => `<span style="width:12px;height:12px;border-radius:50%;background:${c};flex:none;box-shadow:inset 0 -2px 0 rgba(0,0,0,.18)"></span>`;
  const modeHint = { one: '沒人點歌：放完這首重複放', all: '沒人點歌：照歌單順序放', shuffle: '沒人點歌：隨機挑下一首' }[s.mode];
  let html = `<div class="sec" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-act="power">${esc(tr(s.on ? '關音樂' : '開音樂'))}</button>
      ${s.on && s.lib.length > 1 ? `<button class="buy ghost" data-act="skip">${esc(tr('切歌'))}</button>` : ''}</div>
    <div class="opts">${['one', 'all', 'shuffle'].map(m => `<button class="opt${s.mode === m ? ' on' : ''}" data-act="mode" data-id="${m}">${esc(tr({ one: '單曲循環', all: '照順序', shuffle: '隨機' }[m]))}</button>`).join('')}</div>`;
  html += `<div class="sec"><h4>${esc(tr('待播'))}${s.queue.length ? `（${s.queue.length}）` : ''}</h4></div>`;
  html += s.queue.length
    ? s.queue.map(t => `<div class="srow">${dot(t.color)}<div class="sname">${name(t)}</div>
        <button class="buy ghost" data-act="now" data-id="${t.id}">${esc(tr('現在放'))}</button>
        <button class="buy ghost" data-act="unq" data-id="${t.id}">${esc(tr('拿掉'))}</button></div>`).join('')
    : `<div style="padding:0 14px 8px;font-size:12px;color:var(--sub)">${esc(tr(modeHint))}</div>`;
  html += `<div class="sec"><h4>${esc(tr('歌單'))}</h4></div>`;
  if (!s.lib.length) html += `<div class="empty">${esc(tr('歌單是空的'))}</div>`;
  for (const t of s.lib) {
    const playing = s.on && s.now?.id === t.id, qi = s.queue.findIndex(x => x.id === t.id);
    const note = t.broken ? tr('放不出來') : playing ? tr('正在放') : qi >= 0 ? tr('排第 {n}', { n: qi + 1 }) : '';
    html += `<div class="srow"${t.broken ? ' style="opacity:.5"' : ''}>${dot(t.color)}<div class="sname">${name(t)}${note ? `<small>${esc(note)}</small>` : ''}</div>
      ${t.broken || playing ? '' : `${s.on ? `<button class="buy ghost" data-act="now" data-id="${t.id}">${esc(tr('現在放'))}</button>` : ''}
      <button class="buy" data-act="q" data-id="${t.id}"${qi >= 0 ? ' disabled' : ''}>${esc(tr('點歌'))}</button>`}</div>`;
  }
  html += `<div class="sec" style="font-size:12px;color:var(--sub);line-height:1.7;padding-bottom:14px">${esc(tr('加歌：mp3 放進 web/space/music/，在 tracks.json 加一行；拿掉那一行就下架。'))}</div>`;
  drawer.querySelector('.pane').innerHTML = html;
}

function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'power': setMusic(!musicState().on); break;
    case 'skip': skip(); break;
    case 'mode': setMode(id); break;
    case 'now': playNow(id); break;
    case 'unq': unqueue(id); break;
    case 'q': {
      const r = enqueue(id), n = musicState().queue.length;
      const msg = { added: n === 1 ? '排進去了，這首放完就輪到' : '排進去了，排第 {n}', queued: '已經在排了', playing: '這首正在放', full: '待播滿了', broken: '這首放不出來', gone: '這首下架了' }[r];
      if (msg) ctx.toast(tr(msg, { n }));
      break;
    }
  }
}

export const jukebox = {
  name: 'jukebox',
  init(c) {
    ctx = c;
    mountUi();
    onMusic(paint);
    if (new URLSearchParams(location.search).has('jukebox')) setTimeout(() => { ctx.flyToPlace?.('jukebox'); openDrawer(); }, 1200);
  },
  office: buildJukebox,
};
