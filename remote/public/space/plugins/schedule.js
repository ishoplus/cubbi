// ── 外掛：排程牆（Cubbi remote 內建；伺服器那一半在 remote/schedule/）─────────────────────
//
// 接下來排定的工作，在辦公室裡是右牆上的一張週曆：今天起七天，一格一天，一件一張色籤。
// 來源：Cubbi 自己的排程（每天提案、每晚跑測試…，紫色）＋其他外掛接上來的（例如營收部的發文排程，顏色由來源決定）。
// 已排定實心、還沒確定的淡色虛框、做完打勾變灰。
// 點週曆（或區域「排程牆」）打開抽屜：按日期列，點開看細節；能拍板的直接准或不要，排程可以「現在跑」。
// 推播連結帶 ?schedule=1（舊的 ?calendar=1 也行）：開頁就飛到排程牆、打開抽屜。

import { authUrl } from '../host-api.js';   // 不能 import host.js（它開機時在等外掛，會互等）

let ctx = null, cal = null, openId = null;
let tex = null, badge = null;
const W = 1024, H = 560;   // 畫布大小（對應 110×60 的板面）
// 狀態：排程的（planned／running／ok／error／missed）＋常見的發文狀態；來源也可以自己帶 statusLabel
const STATUS = {
  planned: ['已排程', '#6b4fbb'], running: ['執行中', '#e07b00'], ok: ['做完了', '#8a94a6'], error: ['失敗', '#c91a09'], missed: ['錯過了', '#8a94a6'],
  posted: ['已發', '#8a94a6'], failed: ['失敗', '#c91a09'], scheduled: ['已排定', '#3a9a4a'],
  review: ['待你看片', '#e0a800'], shooting: ['拍片中', '#e07b00'], script: ['腳本待核准', '#e0a800'], brief: ['指定題材', '#8a94a6'],
};
const DONE = new Set(['posted', 'ok', 'missed']);
const PALETTE = ['#0055bf', '#237841', '#e07b00', '#c91a09', '#6b4fbb', '#00838f'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const color = (i) => i.color || PALETTE[Math.abs(hash(i.channel || i.sourceName || i.source || '')) % PALETTE.length];
const short = (i) => i.label || i.channel || i.sourceName || '';
const dayOf = (iso) => new Date(iso).toLocaleDateString('sv-SE');   // 這台電腦的時區
const hm = (iso) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const wd = (d) => '日一二三四五六'[new Date(d + 'T12:00:00').getDay()];
const waiting = () => (cal?.items || []).filter(i => i.decide).length;

// ── 牆上的週曆 ──
function drawBoard() {
  if (!tex) return;
  const c = tex.image.getContext('2d');
  const F = (w, s) => `${w} ${s}px "PingFang TC", "Noto Sans CJK TC", sans-serif`;
  c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, W, H);
  // 頂部：紅色月曆頭
  c.fillStyle = '#c91a09'; c.fillRect(0, 0, W, 54);
  c.fillStyle = '#fff'; c.font = F('bold', 28); c.textAlign = 'left'; c.textBaseline = 'middle';
  const today = cal?.today || dayOf(new Date().toISOString());
  c.fillText(`${Number(today.slice(5, 7))} 月 排程`, 18, 28);
  // 圖例：白底色塊＋名稱，從右邊往左排（這兩週出現過的色籤）
  c.font = F('', 18); c.textAlign = 'right';
  let lx = W - 18;
  const legend = [...new Map((cal?.items || []).filter(i => short(i)).map(i => [short(i), color(i)])).entries()].slice(0, 5).reverse();
  for (const [t, col] of legend) {
    c.fillStyle = '#fff'; c.fillText(t, lx, 28); lx -= c.measureText(t).width + 22;
    c.fillRect(lx, 19, 18, 18); c.fillStyle = col; c.fillRect(lx + 2, 21, 14, 14); lx -= 18;
  }
  const days = Array.from({ length: 7 }, (_, k) => (cal?.days || []).filter(d => d >= today)[k]).filter(Boolean);
  const cw = W / 7, top = 62;
  days.forEach((d, k) => {
    const x0 = k * cw;
    if (k) { c.fillStyle = '#e1e3e6'; c.fillRect(x0 - 1, top, 2, H - top - 8); }
    if (d === today) { c.fillStyle = 'rgba(242,205,55,.18)'; c.fillRect(x0 + 1, top, cw - 2, H - top - 8); }
    c.textAlign = 'center'; c.fillStyle = d === today ? '#c91a09' : '#1b2a34';
    c.font = F('bold', 34); c.fillText(String(Number(d.slice(8))), x0 + cw / 2, top + 26);
    c.font = F('', 17); c.fillStyle = 'rgba(27,42,52,.6)'; c.fillText(d === today ? '今天' : '週' + wd(d), x0 + cw / 2, top + 54);
    const list = (cal?.items || []).filter(i => dayOf(i.when) === d && i.status !== 'failed');
    const ch = 66, max = 6;
    list.slice(0, max).forEach((i, j) => {
      const x = x0 + 7, y = top + 72 + j * (ch + 6), w = cw - 14;
      const col = color(i), done = DONE.has(i.status);
      c.save();
      if (i.tentative) { c.globalAlpha = .55; c.setLineDash([6, 4]); c.strokeStyle = col; c.lineWidth = 2.5; c.strokeRect(x + 1, y + 1, w - 2, ch - 2); c.fillStyle = col; c.globalAlpha = .14; c.fillRect(x, y, w, ch); c.globalAlpha = 1; }
      else { c.fillStyle = done ? '#e4e6e8' : col; c.fillRect(x, y, w, ch); }
      const ink = i.tentative ? '#1b2a34' : done ? '#6b7680' : '#fff';
      c.fillStyle = done ? col : 'transparent'; if (done) c.fillRect(x, y, 6, ch);
      c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'top';
      c.font = F('bold', 16); c.fillText(`${hm(i.when)}${i.tentative ? '?' : ''} ${short(i)}`, x + 10, y + 6);
      c.font = F('', 16); wrap(c, i.title, x + 10, y + 27, w - 18, 19, 2);
      if (done) { c.strokeStyle = '#3a9a4a'; c.lineWidth = 4; c.beginPath(); c.moveTo(x + w - 26, y + 14); c.lineTo(x + w - 18, y + 22); c.lineTo(x + w - 6, y + 6); c.stroke(); }
      c.restore();
    });
    if (list.length > max) { c.fillStyle = 'rgba(27,42,52,.55)'; c.font = F('', 15); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(`還有 ${list.length - max} 則`, x0 + cw / 2, H - 20); }
  });
  tex.needsUpdate = true;
  if (badge) badge.visible = waiting() > 0;
}
function wrap(c, text, x, y, maxW, lh, maxLines) {
  let line = '', n = 0;
  for (const ch of String(text || '')) {
    if (c.measureText(line + ch).width > maxW) {
      if (++n === maxLines) { c.fillText(line.slice(0, -1) + '…', x, y); return; }
      c.fillText(line, x, y); y += lh; line = ch;
    } else line += ch;
  }
  if (line) c.fillText(line, x, y);
}

// ── 掛在右牆前段（共用工作桌上方），面向辦公室；總部的 logo 牆在右牆正中，避開它 ──
function buildBoard(o) {
  const { THREE, hw, hd } = o;
  const g = new THREE.Group();
  const mat = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 });
  const BW = 110, BH = 60, BY = 94;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 4, BH + 4, 2), mat('#5a3a22')); frame.position.set(0, BY, 0); g.add(frame);
  // 頂上兩個掛環
  for (const sx of [-1, 1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.6, 8, 16), mat('#a0a5a9')); ring.position.set(sx * BW / 4, BY + BH / 2 + 3.5, 1); g.add(ring); }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  face.position.set(0, BY, 1.1); g.add(face);
  // 有腳本或成品等你決定：左上角浮一顆會跳的黃色驚嘆號（跟提案白板同一種意思）
  badge = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 14), new THREE.MeshStandardMaterial({ color: '#f2cd37', emissive: '#f2cd37', emissiveIntensity: 0.35 }));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4, 0.8), mat('#1b2a34')); bar.position.set(0, 0.9, 4.3);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 0.8), mat('#1b2a34')); dot.position.set(0, -2.4, 4.3);
  badge.add(ball, bar, dot); badge.position.set(-BW / 2 - 2, BY + BH / 2 + 6, 3); g.add(badge);
  o.npc((t) => { if (badge.visible) badge.position.y = BY + BH / 2 + 6 + Math.abs(Math.sin(t * 2.4)) * 4; });
  const X = hw - 1, Z = Math.max(110, Math.min(hd * 0.5, hd - 170));
  g.position.set(X, 0, Z); g.rotation.y = -Math.PI / 2;
  g.traverse(m => { if (m.isMesh) o.pick(m, openDrawer); });
  o.group.add(g);
  o.place('schedule', '排程牆', [X, BY - 4, Z], [-190, 20, 0], [[X - 40, Z - BW / 2 - 6, X + 8, Z + BW / 2 + 6]]);
  drawBoard();
}

// ── 抽屜：按日期列 ──
let drawer;
function mountUi() {
  const css = document.createElement('style');
  css.textContent = `
  #cpane { padding: 4px 12px 16px; }
  #schedule .cday { font-weight: 700; font-size: 14px; margin: 14px 2px 6px; color: #1b2a34; display: flex; gap: 8px; align-items: baseline; }
  #schedule .cday:first-child { margin-top: 0; }
  #schedule .cday.today { color: #c91a09; }
  #schedule .cday small { font-weight: 400; opacity: .6; }
  .ccard { border-radius: 10px; padding: 10px 12px 10px 14px; margin: 0 0 8px; background: #fff; color: #1b2a34; box-shadow: 0 1px 3px rgba(0,0,0,.18); cursor: pointer; border-left: 6px solid var(--c); }
  .ccard.tent { border-left-style: dashed; background: #fafafa; }
  .ccard.posted { opacity: .62; }
  .ccard .ct { font-weight: 700; font-size: 15px; line-height: 1.35; }
  .ccard .cm { font-size: 12px; margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; opacity: .85; }
  .ccard .cm b { color: #fff; border-radius: 6px; padding: 1px 7px; font-weight: 600; }
  .ccard .cx { display: none; margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 320px; overflow: auto; background: rgba(0,0,0,.04); border-radius: 8px; padding: 8px; }
  .ccard.open .cx { display: block; }
  .ccard .cbtns { display: none; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .ccard.open .cbtns { display: flex; }
  .ccard .cbtns button { border: 0; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; background: rgba(0,0,0,.08); color: #1b2a34; }
  .ccard .cbtns button.yes { background: #0055bf; color: #fff; }
  .ccard .cbtns a { font-size: 13px; color: #0055bf; }
  .ccard textarea { display: none; width: 100%; box-sizing: border-box; margin-top: 8px; min-height: 56px; border-radius: 8px; border: 1px solid rgba(0,0,0,.2); padding: 8px; font: inherit; font-size: 14px; }
  .ccard.editing textarea { display: block; }`;
  document.head.appendChild(css);
  drawer = document.createElement('aside');
  drawer.id = 'schedule'; drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div>
  <div class="p-head">
    <div class="p-swatch" style="background:#c91a09"></div>
    <div style="min-width:0"><div class="p-title">排程牆</div><div class="p-sub" id="c-sub"></div></div>
    <button class="p-close" id="c-close" title="關閉">✕</button>
  </div>
  <div class="p-body"><div class="pane on" id="cpane"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('#c-close').onclick = () => drawer.classList.remove('open');
}

function openDrawer() {
  ctx.closePanel();
  document.querySelectorAll('.drawer.open').forEach(d => d !== drawer && d.classList.remove('open'));
  drawer.classList.add('open');
  render(); toToday();
  load().then(toToday);
}
// 打開時捲到今天：前兩天已發的留在上面，往上滑才看得到
const toToday = () => drawer.querySelector('.cday.today')?.scrollIntoView({ block: 'start' });

function render() {
  if (!drawer || !cal) return;
  const { esc } = ctx;
  const n = waiting(), next = cal.items.filter(i => ['scheduled', 'planned'].includes(i.status) && Date.parse(i.when) > Date.now()).length;
  drawer.querySelector('#c-sub').textContent = [`${next} 件已排定`, n ? `${n} 件等你決定` : ''].filter(Boolean).join('・');
  const pane = drawer.querySelector('#cpane');
  const days = cal.days.filter(d => cal.items.some(i => dayOf(i.when) === d));
  if (!days.length) { pane.innerHTML = '<div class="empty">接下來兩週沒有排定的工作。提案白板可以打開「每天提案」</div>'; return; }
  pane.innerHTML = days.map(d => `
    <div class="cday ${d === cal.today ? 'today' : ''}">${Number(d.slice(5, 7))}/${Number(d.slice(8))} 週${wd(d)}${d === cal.today ? ' <small>今天</small>' : ''}</div>
    ${cal.items.filter(i => dayOf(i.when) === d).map(i => {
      const [st, sc] = STATUS[i.status] || [i.statusLabel || i.status, '#8a94a6'];
      const routine = i.source === 'routine';
      return `<div class="ccard ${i.tentative ? 'tent' : ''} ${DONE.has(i.status) ? 'posted' : ''} ${i.id === openId ? 'open' : ''}" style="--c:${color(i)}" data-id="${esc(i.id)}">
        <div class="ct">${esc(i.title)}</div>
        <div class="cm"><span>${hm(i.when)}${i.tentative ? '（預計）' : ''}</span><b style="background:${sc}">${esc(st)}</b><span>${esc(i.channel || i.sourceName || '')}</span></div>
        <div class="cx">${esc(String(i.text || i.error || '').slice(0, 3000))}</div>
        <textarea placeholder="不要的原因（會照這個改）"></textarea>
        <div class="cbtns">
          ${i.decide ? `<button class="yes" data-d="ok">${esc(i.decideOk || '准')}</button><button data-d="no">不要…</button>` : ''}
          ${routine && i.status !== 'running' ? `<button data-run="${esc(i.routineId)}">現在跑</button>` : ''}
          ${i.sid ? `<button data-look="${esc(i.sid)}">看他做了什麼</button>` : ''}
          ${i.file ? `<a href="${authUrl('/api/fs/file?path=' + encodeURIComponent(i.file))}" target="_blank">看片</a>` : ''}
          ${i.url ? `<a href="${esc(i.url)}" target="_blank">看貼文</a>` : ''}
          <span style="margin-left:auto;font-size:12px;opacity:.5">${esc(i.id)}</span>
        </div>
      </div>`;
    }).join('')}`).join('');
  pane.querySelectorAll('.ccard').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('button, a, textarea')) return;
      openId = openId === el.dataset.id ? null : el.dataset.id;
      render();
    };
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => decide(el, b.dataset.d));
    el.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      const r = await ctx.post(`/api/space/routines/${encodeURIComponent(b.dataset.run)}/run`, {});
      const j = await r.json().catch(() => ({}));
      ctx.toast(r.ok ? '開始跑了' : (j.error || '跑不起來')); setTimeout(load, 1500);
    });
    el.querySelectorAll('[data-look]').forEach(b => b.onclick = () => { drawer.classList.remove('open'); if (!ctx.focusPerson?.(b.dataset.look)) ctx.toast('他不在辦公室裡了'); });
  });
}

async function decide(el, decision) {
  const ta = el.querySelector('textarea');
  let note = '';
  if (decision === 'no') {   // 不要：第一次按打開輸入框，有字再按一次才送
    if (!el.classList.contains('editing')) { el.classList.add('editing'); ta.focus(); return; }
    if (!ta.value.trim()) { ta.focus(); return; }
    note = ta.value.trim();
  }
  const item = cal.items.find(x => x.id === el.dataset.id);
  const r = await ctx.post('/api/space/schedule/decide', { source: item?.sourceName, id: el.dataset.id, decision, note });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { ctx.toast(j.error || '沒記上'); return; }
  ctx.toast(j.msg || (decision === 'ok' ? '准了' : '記下了'));
  if (decision === 'ok') ctx.sfx?.done?.();
  openId = null;
  cal = j.cal; drawBoard(); render();
}

async function load() {
  try { cal = await ctx.api('/api/space/schedule'); } catch { return; }
  if (cal?.error) { cal = null; return; }
  drawBoard(); render();
}

export const schedule = {
  name: 'schedule',
  async init(c) {
    ctx = c;
    mountUi();
    await load();
    setInterval(load, 5 * 60_000);
    const q = new URLSearchParams(location.search);
    if (q.has('schedule') || q.has('calendar')) setTimeout(() => { ctx.flyToPlace?.('schedule'); openDrawer(); }, 1200);
  },
  office: buildBoard,
};
