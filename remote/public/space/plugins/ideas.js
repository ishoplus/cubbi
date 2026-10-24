// ── 外掛：提案白板（Cubbi remote 內建；伺服器那一半在 remote/ideas/）────────────────────
//
// 提案部交的提案，在辦公室裡是一塊看板：Backlog → Todo → 進行中 → Done，一份提案一張便條紙。
// 點白板（或區域「提案白板」）打開抽屜：Backlog 回要／不要／改，Todo 按開工，進行中按完成。
// 推播連結帶 ?ideas=1：開頁就飛到白板、打開抽屜。
// 資料與寫入在伺服器 ideas.js（/api/space/ideas）。

import { t, LANG } from './lang.js';

let ctx = null, board = null, tab = 'backlog', openId = null;
let tex = null, badge = null;   // 白板畫面、Backlog 有東西時頭上的提示
const COLS = [
  { key: 'backlog', name: 'Backlog', color: '#8a94a6' },
  { key: 'todo', name: 'Todo', color: '#0055bf' },
  { key: 'doing', name: t('進行中'), color: '#e07b00' },
  { key: 'done', name: 'Done', color: '#3a9a4a' },
];
// 便條紙：新功能黃、新項目藍；「改」的貼一角橘色
const NOTE = { feature: '#f6d55c', project: '#9fd3f0' };
const W = 1024, H = 560;   // 白板畫面的畫布大小（對應 120×66 的板面）

// ── 白板畫面：四欄標頭＋便條紙（標題寫在紙上） ──
function drawBoard() {
  if (!tex) return;
  const c = tex.image.getContext('2d');
  c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, W, H);
  const cw = W / 4;
  COLS.forEach((col, i) => {
    const x0 = i * cw;
    if (i) { c.fillStyle = '#d9dcdf'; c.fillRect(x0 - 1.5, 16, 3, H - 32); }
    c.fillStyle = col.color; c.fillRect(x0 + 14, 14, cw - 28, 44);
    c.fillStyle = '#fff'; c.font = 'bold 28px "PingFang TC", "Noto Sans CJK TC", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const n = board?.cols[col.key]?.length || 0;
    c.fillText(n ? `${col.name} ${n}` : col.name, x0 + cw / 2, 37);
    // 便條紙：一欄兩排，最多 8 張，多的只畫一疊
    const cards = board?.cols[col.key] || [];
    const nw = (cw - 42) / 2, nh = 110;
    cards.slice(0, 8).forEach((p, j) => {
      const x = x0 + 14 + (j % 2) * (nw + 14), y = 70 + Math.floor(j / 2) * (nh + 10);
      const tilt = ((p.id.charCodeAt(p.id.length - 1) * 7 + j * 3) % 7 - 3) * 0.012;
      c.save(); c.translate(x + nw / 2, y + nh / 2); c.rotate(tilt);
      c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(-nw / 2 + 3, -nh / 2 + 4, nw, nh);
      c.fillStyle = col.key === 'done' ? '#d6e9cf' : NOTE[p.kind] || NOTE.feature; c.fillRect(-nw / 2, -nh / 2, nw, nh);
      c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(-nw / 2, -nh / 2, nw, 12);   // 背膠那一條
      if (p.verdict === '改') { c.fillStyle = '#ff8a3d'; c.beginPath(); c.moveTo(nw / 2 - 26, -nh / 2); c.lineTo(nw / 2, -nh / 2); c.lineTo(nw / 2, -nh / 2 + 26); c.fill(); }
      c.fillStyle = '#1b2a34'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.font = 'bold 20px "PingFang TC", "Noto Sans CJK TC", sans-serif';
      wrap(c, p.title, -nw / 2 + 9, -nh / 2 + 17, nw - 18, 24, 3);
      c.font = '15px "PingFang TC", "Noto Sans CJK TC", sans-serif'; c.fillStyle = 'rgba(27,42,52,.55)';
      if (p.claim && col.key === 'doing') {
        c.fillStyle = STATUS[p.claim.status]?.[1] || '#8a94a6'; c.beginPath(); c.arc(-nw / 2 + 15, nh / 2 - 12, 6, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(27,42,52,.75)'; c.fillText(p.claim.name || t('新員工'), -nw / 2 + 26, nh / 2 - 19);
      } else c.fillText(t('{n} 天', { n: p.days }), -nw / 2 + 9, nh / 2 - 19);
      if (col.key === 'done') { c.strokeStyle = '#3a9a4a'; c.lineWidth = 5; c.beginPath(); c.moveTo(nw / 2 - 34, nh / 2 - 24); c.lineTo(nw / 2 - 24, nh / 2 - 14); c.lineTo(nw / 2 - 8, nh / 2 - 36); c.stroke(); }
      c.restore();
    });
    if (cards.length > 8) { c.fillStyle = 'rgba(27,42,52,.55)'; c.font = '18px sans-serif'; c.textAlign = 'center'; c.fillText(t('還有 {n} 張', { n: cards.length - 8 }), x0 + cw / 2, H - 22); }
  });
  tex.needsUpdate = true;
  if (badge) badge.visible = !!board?.pending;
}
// 中文逐字換行，超過行數用「…」
function wrap(c, text, x, y, maxW, lh, maxLines) {
  let line = '', n = 0;
  // 英文介面按字詞換行（中文照舊逐字）
  const parts = LANG === 'en' ? String(text || '').match(/\S+\s*|\s+/g) || [] : String(text || '');
  for (const ch of parts) {
    if (line && c.measureText(line + ch).width > maxW) {
      if (++n === maxLines) { c.fillText(line.slice(0, -1) + '…', x, y); return; }
      c.fillText(line, x, y); y += lh; line = ch;
    } else line += ch;
  }
  if (line) c.fillText(line, x, y);
}

// ── 辦公室裡的看板：立架白板，放在前方中間偏左的走道邊，面向辦公室內 ──
function buildBoard(o) {
  const { THREE, hw, hd } = o;
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const part = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const BW = 120, BH = 66, BY = 62;
  part(BW + 4, BH + 4, 2.4, '#a0a5a9', 0, BY, 0);                          // 鋁框
  for (const sx of [-1, 1]) {
    part(2.4, BY + BH / 2, 2.4, '#7d8388', sx * (BW / 2 - 6), (BY + BH / 2) / 2, -1.5);   // 立柱
    part(4, 2, 26, '#5c6166', sx * (BW / 2 - 6), 1, -1.5);                // 腳
  }
  part(BW * 0.6, 2, 5, '#a0a5a9', 0, BY - BH / 2 - 2, 2.4);               // 筆槽
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
  face.position.set(0, BY, 1.3); g.add(face);
  // Backlog 有東西：板子上方浮一顆會跳的黃色驚嘆號（跟員工舉手同一種意思：等你）
  badge = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 14), new THREE.MeshStandardMaterial({ color: '#f2cd37', emissive: '#f2cd37', emissiveIntensity: 0.35 }));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4, 0.8), mat('#1b2a34')); bar.position.set(0, 0.9, 4.3);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 0.8), mat('#1b2a34')); dot.position.set(0, -2.4, 4.3);
  badge.add(ball, bar, dot); badge.position.set(-BW / 2 + 6, BY + BH / 2 + 9, 0); g.add(badge);
  o.npc((time) => { if (badge.visible) badge.position.y = BY + BH / 2 + 9 + Math.abs(Math.sin(time * 2.4)) * 4; });
  // 位置：左牆前段（書櫃和門之間）靠牆立著，面向辦公室裡面；鏡頭從裡面看過去，後面是牆，部門名牌不會疊在板上
  const X = -hw + 16, Z = Math.min(hd * 0.62, hd - 150);
  g.position.set(X, 0, Z); g.rotation.y = Math.PI / 2;
  g.traverse(m => { if (m.isMesh) o.pick(m, openDrawer); });
  o.group.add(g);
  o.obstacle({ x: X + 2, z: Z, w: 28, d: BW + 8 });
  o.place('ideas', t('提案白板'), [X, BY - 4, Z - 42], [215, 30, 0], [[X - 16, Z - BW / 2 - 6, X + 24, Z + BW / 2 + 6]]);
  drawBoard();
}

// ── 抽屜：四欄分頁＋卡片 ──
let drawer;
function mountUi() {
  const css = document.createElement('style');
  css.textContent = `
  #ideas .tab small { opacity: .7; margin-left: 4px; }
  .icard { border-radius: 10px; padding: 12px 14px; margin: 0 0 10px; color: #1b2a34; box-shadow: 0 1px 3px rgba(0,0,0,.18); cursor: pointer; }
  .icard.feature { background: #fbe9a0; } .icard.project { background: #cde9f7; } .icard.done { background: #dcebd5; }
  .icard .it { font-weight: 700; font-size: 16px; line-height: 1.35; }
  .icard .im { font-size: 12px; opacity: .65; margin-top: 2px; }
  .icard .ih { margin-top: 8px; font-size: 14px; line-height: 1.5; }
  .icard .ix { margin-top: 8px; font-size: 13px; line-height: 1.6; display: none; }
  .icard.open .ix { display: block; }
  .icard .ix b { font-weight: 600; }
  .icard .inote { margin-top: 6px; font-size: 13px; color: #b4520a; }
  .icard .iclaim { margin-top: 8px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .icard .iclaim i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .icard .ibtns { display: none; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .icard.open .ibtns { display: flex; }
  .icard .ibtns button { border: 0; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; background: rgba(0,0,0,.08); color: #1b2a34; }
  .icard .ibtns button.yes { background: #0055bf; color: #fff; }
  .icard .ibtns button.go { background: #e07b00; color: #fff; }
  .icard .ibtns button.fin { background: #3a9a4a; color: #fff; }
  .icard .ibtns a { align-self: center; font-size: 13px; color: #0055bf; margin-left: auto; }
  .icard textarea { display: none; width: 100%; box-sizing: border-box; margin-top: 8px; min-height: 64px; border-radius: 8px; border: 1px solid rgba(0,0,0,.2); padding: 8px; font: inherit; font-size: 14px; }
  .icard.editing textarea { display: block; }
  #ideas .ictl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 0 0 12px; font-size: 13px; }
  #ideas .ictl button { border: 0; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; background: rgba(0,0,0,.08); color: inherit; }
  #ideas .ictl button.run { background: #0055bf; color: #fff; }
  #ideas .ictl button:disabled { opacity: .5; cursor: default; }
  #ideas .ictl label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  #ideas .ictl input[type=time] { font: inherit; padding: 2px 4px; }`;
  document.head.appendChild(css);
  drawer = document.createElement('aside');
  drawer.id = 'ideas'; drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div>
  <div class="p-head">
    <div class="p-swatch" style="background:#f6d55c"></div>
    <div style="min-width:0"><div class="p-title">${t('提案白板')}</div><div class="p-sub" id="i-sub"></div></div>
    <button class="p-close" id="i-close" title="${t('關閉')}">✕</button>
  </div>
  <div class="tabs">${COLS.map(c => `<button class="tab" data-itab="${c.key}">${c.name}<small></small></button>`).join('')}</div>
  <div class="p-body"><div class="ictl" id="ictl"></div><div class="pane on" id="ipane"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('#i-close').onclick = () => drawer.classList.remove('open');
  drawer.querySelectorAll('[data-itab]').forEach(b => b.onclick = () => { tab = b.dataset.itab; openId = null; render(); });
}

function openDrawer() {
  ctx.closePanel();
  document.querySelectorAll('.drawer.open').forEach(d => d !== drawer && d.classList.remove('open'));
  // 預設開有東西的第一欄（通常是 Backlog）
  if (board && !board.cols[tab]?.length) tab = COLS.find(c => board.cols[c.key].length)?.key || 'backlog';
  drawer.classList.add('open');
  render();
  load();
}

// 每張卡的按鈕：[樣式, 字, 送什麼]；送 'look' 是飛去看認領的人
const actionsOf = (col, p) => ({
  backlog: [['yes', t('要'), { verdict: '要' }], ['', t('不要'), { verdict: '不要' }], ['', t('改…'), null]],
  todo: [['go', t('開工'), { stage: 'doing' }]],
  doing: p.claim ? [['', t('看他在做什麼'), 'look'], ['fin', t('完成'), { stage: 'done' }]] : [['go', t('派人開工'), { stage: 'doing' }], ['fin', t('完成'), { stage: 'done' }]],
  done: p.claim ? [['', t('看他做了什麼'), 'look']] : [],
})[col];
// 認領的人現在怎樣
const STATUS = { working: [t('在做'), '#3a9a4a'], asking: [t('等你回答'), '#e0a800'], idle: [t('做完一輪，等你驗收'), '#0055bf'], done: [t('做完了'), '#8a94a6'] };
function render() {
  if (!drawer || !board) return;
  const { esc } = ctx;
  drawer.querySelector('#i-sub').textContent = board.running ? t('提案部正在寫…（5–15 分鐘）') : board.pending ? t('{n} 份等你判斷', { n: board.pending }) : t('都判斷過了');
  renderCtl();
  drawer.querySelectorAll('[data-itab]').forEach(b => {
    b.classList.toggle('on', b.dataset.itab === tab);
    b.querySelector('small').textContent = board.cols[b.dataset.itab].length || '';
  });
  const cards = [...board.cols[tab]].reverse();   // 新的在上面
  const pane = drawer.querySelector('#ipane');
  if (!cards.length) {
    const next = board.daily?.on ? t('每天 {at} 會有新的一批', { at: board.daily.at }) : t('按上面「現在提一批」，或打開「每天提案」');
    pane.innerHTML = `<div class="empty">${tab === 'backlog' ? t('沒有待判斷的提案。') + next : t('這一欄是空的')}</div>`;
    return;
  }
  pane.innerHTML = cards.map(p => `
    <div class="icard ${tab === 'done' ? 'done' : p.kind === 'project' ? 'project' : 'feature'} ${p.id === openId ? 'open' : ''}" data-id="${esc(p.id)}">
      <div class="it">${esc(p.title)}</div>
      <div class="im">${esc(p.id)} · ${p.kind === 'project' ? t('新項目') : esc(p.project)} · ${t('約 {n} 天', { n: esc(p.days) })}</div>
      <div class="ih">${esc(p.hook)}</div>
      ${p.verdict === '改' && p.note ? `<div class="inote">${t('你說要改：')}${esc(p.note)}</div>` : ''}
      ${p.claim ? `<div class="iclaim"><i style="background:${STATUS[p.claim.status]?.[1]}"></i>${esc(p.claim.name || t('新員工'))} ${STATUS[p.claim.status]?.[0] || ''}</div>` : tab === 'doing' ? `<div class="iclaim"><i style="background:#c4c8cc"></i>${t('還沒有人認領')}</div>` : ''}
      <div class="ix">
        ${p.see ? `<div><b>${t('做完會看到：')}</b>${esc(p.see)}</div>` : ''}
        <div><b>${t('為什麼現在：')}</b>${esc(p.why_now)}</div>
        <div><b>${t('風險：')}</b>${esc(p.risk)}</div>
      </div>
      <textarea placeholder="${t('想怎麼改？（下一批會照這個重寫）')}"></textarea>
      <div class="ibtns">
        ${actionsOf(tab, p).map(([cls, label], i) => `<button class="${cls}" data-act="${i}">${label}</button>`).join('')}
        ${p.session && board.cwd ? `<a href="/?session=${encodeURIComponent(p.session)}&cwd=${encodeURIComponent(board.cwd)}" target="_blank">${t('跟提案部討論')}</a>` : ''}
      </div>
    </div>`).join('');
  pane.querySelectorAll('.icard').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('button, a, textarea')) return;
      openId = openId === el.dataset.id ? null : el.dataset.id;
      render();
    };
    const p = cards.find(x => x.id === el.dataset.id);
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(el, actionsOf(tab, p)[+b.dataset.act], p));
  });
}

// 控制列：現在提一批（花額度，先確認）、每天提案（寫進排程）
function renderCtl() {
  const el = drawer.querySelector('#ictl');
  const d = board.daily || { on: false, at: '09:00' };
  el.innerHTML = `<button class="run" id="i-run" ${board.running ? 'disabled' : ''}>${board.running ? t('正在提…') : t('現在提一批')}</button>
    <label><input type="checkbox" id="i-daily" ${d.on ? 'checked' : ''}>${t('每天提案')}</label><input type="time" id="i-at" value="${ctx.esc(d.at)}">`;
  el.querySelector('#i-run').onclick = async () => {
    if (!confirm(t('提案部會讀你的專案、寫 3 份提案，大約 5–15 分鐘，會用到一些 Claude 額度。現在跑？'))) return;
    const r = await ctx.post('/api/space/ideas/run', {}); const j = await r.json().catch(() => ({}));
    ctx.toast(j.msg || j.error || ''); if (j.board) { board = j.board; render(); }
  };
  const save = async () => {
    const on = el.querySelector('#i-daily').checked, at = el.querySelector('#i-at').value || '09:00';
    const r = await ctx.post('/api/space/ideas/daily', { on, at }); const j = await r.json().catch(() => ({}));
    ctx.toast(j.msg || j.error || ''); if (j.board) { board = j.board; render(); }
  };
  el.querySelector('#i-daily').onchange = save;
  el.querySelector('#i-at').onchange = () => { if (el.querySelector('#i-daily').checked) save(); };
}

// 飛到認領的人：剛開工的人要等辦公室下一次更新才會出現，多試幾次
function lookAt(sid, tries = 8) {
  if (ctx.focusPerson?.(sid)) return;
  if (tries > 0) setTimeout(() => lookAt(sid, tries - 1), 1500);
  else ctx.toast(t('他還沒進辦公室，等一下再看'));
}

async function act(el, [, label, body], card) {
  const id = el.dataset.id, ta = el.querySelector('textarea');
  if (body === 'look') { drawer.classList.remove('open'); lookAt(card.claim.sid); return; }
  if (!body) {   // 改：第一次按打開輸入框，有字再按一次才送
    if (!el.classList.contains('editing')) { el.classList.add('editing'); ta.focus(); return; }
    if (!ta.value.trim()) { ta.focus(); return; }
    body = { verdict: '改', note: ta.value.trim() };
  }
  const path = body.verdict ? 'verdict' : 'stage';
  const r = await ctx.post(`/api/space/ideas/${encodeURIComponent(id)}/${path}`, body);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { ctx.toast(j.error || t('沒記上')); return; }
  ctx.toast({ 要: t('收到，放進 Todo'), 不要: t('拿掉了'), 改: t('記下了，下一批照這個改'), doing: t('開工了，派了一個人去做'), done: t('完成！') }[body.verdict || body.stage]);
  if (body.verdict === '要' || body.stage) ctx.sfx?.done?.();
  openId = null;
  board = j.board; drawBoard(); render();
  // 開工：關掉抽屜，鏡頭跟著新員工走到他的部門
  if (body.stage === 'doing') { const c = board.cols.doing.find(x => x.id === id); if (c?.claim) { drawer.classList.remove('open'); lookAt(c.claim.sid); } }
}

async function load() {
  try { board = await ctx.api('/api/space/ideas'); } catch { return; }
  drawBoard(); render();
}

export const ideas = {
  name: 'ideas',
  async init(c) {
    ctx = c;
    mountUi();
    await load();
    // 有人在做或提案部在寫：每 20 秒更新；沒有就 5 分鐘一次（排程那批出來後幾分鐘內就會貼上）
    let last = 0;
    setInterval(() => { const busy = board?.running || board?.cols.doing.some(c => c.claim); if (busy || Date.now() - last > 5 * 60_000) { last = Date.now(); load(); } }, 20_000);
    if (new URLSearchParams(location.search).has('ideas')) setTimeout(() => { ctx.flyToPlace?.('ideas'); openDrawer(); }, 1200);
  },
  office: buildBoard,
  // 收件箱裡的新提案：飛到白板、打開抽屜
  openInbox(item) {
    if (item.kind !== 'idea') return false;
    tab = 'backlog'; openId = item.ideaId;
    ctx.flyToPlace?.('ideas'); openDrawer();
    return true;
  },
};
