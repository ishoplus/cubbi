// ── 外掛：等你辦（主管室後牆的軟木板；伺服器那一半在 remote/handoff/）──────────────────
//
// 代理人做不了、要你本人出手的事（送審、付款、登入後台…），一件一張便條紙釘在主管室後牆：
// 黃色＝等你做，灰色＝你辦過了、在等外面回覆（審核中）。有黃的，板子上方跳一顆綠色驚嘆號。
// 點板子（或區域「等你辦」）打開抽屜：要做什麼、為什麼要你、怎麼做、連結；
// 辦好了／卡住了／問一下都送回交代這件事的那段對話。收件箱點「等你辦」也飛來這裡。

import { t, LANG } from './lang.js';
import { authUrl } from '../host-api.js';
import { BOSS_ROOM } from '../furniture.js';

let ctx = null, items = [], openId = null;
let tex = null, badge = null;
const W = 1024, H = 580;          // 板面畫布（對應 60×34 的板子）
const BW = 60, BH = 34, BY = 70;  // 板子大小、中心高度
const NOTE = { todo: '#f6d55c', waiting: '#c9d3dc', done: '#d6e9cf' };
const FONT = '"PingFang TC", "Noto Sans CJK TC", sans-serif';

const todo = () => items.filter(h => h.status === 'todo');
const waiting = () => items.filter(h => h.status === 'waiting');

// ── 板面：軟木底、上面一條標頭、便條紙（黃的在前） ──
function drawBoard() {
  if (!tex) return;
  const c = tex.image.getContext('2d');
  c.fillStyle = '#c49a6c'; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {   // 軟木的顆粒（固定種子，不會每次重畫都跳）
    const x = (i * 397) % W, y = (i * 613) % H;
    c.fillStyle = i % 3 ? 'rgba(90,55,25,.18)' : 'rgba(255,235,200,.16)'; c.fillRect(x, y, 3, 3);
  }
  c.fillStyle = '#3a9a4a'; c.fillRect(24, 18, W - 48, 64);
  c.fillStyle = '#fff'; c.font = `bold 38px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const n = todo().length, m = waiting().length;
  c.fillText(n ? t('等你辦 {n}', { n }) : t('等你辦'), W / 2, 51);
  const notes = [...todo(), ...waiting()];
  if (!notes.length) {
    c.fillStyle = 'rgba(40,25,10,.55)'; c.font = `30px ${FONT}`;
    c.fillText(t('沒有要你本人辦的事'), W / 2, H / 2 + 30);
  }
  const nw = (W - 48 - 2 * 24) / 3, nh = 210;
  notes.slice(0, 6).forEach((h, j) => {
    const x = 24 + (j % 3) * (nw + 24), y = 104 + Math.floor(j / 3) * (nh + 24);
    const tilt = ((h.id.charCodeAt(0) * 7 + j * 5) % 7 - 3) * 0.014;
    c.save(); c.translate(x + nw / 2, y + nh / 2); c.rotate(tilt);
    c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(-nw / 2 + 4, -nh / 2 + 6, nw, nh);
    c.fillStyle = NOTE[h.status] || NOTE.todo; c.fillRect(-nw / 2, -nh / 2, nw, nh);
    c.fillStyle = h.status === 'todo' ? '#d0312d' : '#5c6166';   // 圖釘
    c.beginPath(); c.arc(0, -nh / 2 + 14, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1b2a34'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.font = `bold 30px ${FONT}`;
    wrap(c, h.title, -nw / 2 + 14, -nh / 2 + 34, nw - 28, 36, 4);
    if (h.status === 'waiting') {
      c.font = `22px ${FONT}`; c.fillStyle = 'rgba(27,42,52,.65)';
      wrap(c, t('在等：{who}', { who: h.waitingFor || t('外面回覆') }), -nw / 2 + 14, nh / 2 - 34, nw - 28, 26, 1);
    }
    c.restore();
  });
  if (notes.length > 6) { c.fillStyle = 'rgba(40,25,10,.7)'; c.font = `24px ${FONT}`; c.textAlign = 'right'; c.fillText(t('還有 {n} 張', { n: notes.length - 6 }), W - 30, H - 22); }
  tex.needsUpdate = true;
  if (badge) badge.visible = n > 0;
}
function wrap(c, text, x, y, maxW, lh, maxLines) {
  let line = '', n = 0;
  const parts = LANG === 'en' ? String(text || '').match(/\S+\s*|\s+/g) || [] : String(text || '');
  for (const ch of parts) {
    if (line && c.measureText(line + ch).width > maxW) {
      if (++n === maxLines) { c.fillText(line.slice(0, -1) + '…', x, y); return; }
      c.fillText(line, x, y); y += lh; line = ch;
    } else line += ch;
  }
  if (line) c.fillText(line, x, y);
}

// ── 主管室後牆：皮椅後面、書櫃右邊，釘一塊軟木板 ──
function buildBoard(o) {
  const { THREE, hw, hd } = o;
  const cx = hw - BOSS_ROOM.W / 2 - 4;            // 主管室中心（跟 main.js 的 buildBossRoom 同一套算法）
  const X = cx + 16, Z = -hd + 2.5;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 4, BH + 4, 2), new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.7 }));
  frame.position.set(0, BY, 0); frame.castShadow = frame.receiveShadow = true; g.add(frame);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  face.position.set(0, BY, 1.05); g.add(face);
  // 有等你做的：板子左上方跳一顆綠色驚嘆號
  badge = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshStandardMaterial({ color: '#3a9a4a', emissive: '#3a9a4a', emissiveIntensity: 0.4 }));
  const dark = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.6, 0.8), dark); bar.position.set(0, 0.8, 3.8);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.8), dark); dot.position.set(0, -2.2, 3.8);
  badge.add(ball, bar, dot); badge.position.set(-BW / 2 + 4, BY + BH / 2 + 8, 2); g.add(badge);
  o.npc((time) => { if (badge.visible) badge.position.y = BY + BH / 2 + 8 + Math.abs(Math.sin(time * 2.4)) * 3.5; });
  g.position.set(X, 0, Z);
  g.traverse(m => { if (m.isMesh) o.pick(m, () => openDrawer()); });
  o.group.add(g);
  // 鏡頭：站在主管桌前面，略往上看板子
  o.place('handoff', t('等你辦'), [X, BY - 6, Z], [0, 30, 165], [[X - BW / 2 - 4, Z - 6, X + BW / 2 + 4, Z + 10]], 1);
  drawBoard();
}

// ── 抽屜：每件一張卡，要做什麼、怎麼做、按鈕 ──
let drawer;
function mountUi() {
  const css = document.createElement('style');
  css.textContent = `
  .hcard { border-radius: 10px; padding: 12px 14px; margin: 0 0 10px; color: #1b2a34; box-shadow: 0 1px 3px rgba(0,0,0,.18); background: #fbe9a0; }
  .hcard.s-waiting { background: #e3e8ec; } .hcard.s-done, .hcard.s-dropped { background: #dcebd5; opacity: .8; }
  .hcard.flash { outline: 3px solid #3a9a4a; }
  .hcard .ht { font-weight: 700; font-size: 16px; line-height: 1.35; }
  .hcard .hm { font-size: 12px; opacity: .65; margin-top: 2px; }
  .hcard .hw { font-size: 13px; margin-top: 6px; opacity: .8; }
  .hcard ol { margin: 8px 0 0; padding-left: 22px; font-size: 14px; line-height: 1.6; }
  .hcard li { word-break: break-word; }
  .hcard a { color: #0055bf; }
  .hcard .hl { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .hcard .hl a { border: 1px solid rgba(0,85,191,.4); border-radius: 6px; padding: 3px 9px; font-size: 13px; text-decoration: none; background: rgba(255,255,255,.5); word-break: break-all; }
  .hcard .hr { font-size: 13px; margin-top: 8px; }
  .hcard .hg { font-size: 12px; margin-top: 8px; opacity: .7; white-space: pre-line; }
  .hcard .hb { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .hcard .hb button { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer; background: rgba(0,0,0,.08); color: #1b2a34; }
  .hcard .hb button.ok { background: #3a9a4a; color: #fff; }
  .hcard .hb button:disabled { opacity: .5; cursor: default; }
  #handoff .hsec { font-size: 12px; opacity: .7; margin: 14px 2px 6px; }`;
  document.head.appendChild(css);
  drawer = document.createElement('aside');
  drawer.id = 'handoff'; drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div>
  <div class="p-head">
    <div class="p-swatch" style="background:#3a9a4a"></div>
    <div style="min-width:0"><div class="p-title">${t('等你辦')}</div><div class="p-sub" id="h-sub"></div></div>
    <button class="p-close" id="h-close" title="${t('關閉')}">✕</button>
  </div>
  <div class="p-body"><div class="pane on" id="hpane"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('#h-close').onclick = () => drawer.classList.remove('open');
}

function openDrawer(id = null) {
  ctx.closePanel();
  document.querySelectorAll('.drawer.open').forEach(d => d !== drawer && d.classList.remove('open'));
  openId = id;
  drawer.classList.add('open');
  render();
  load();
}

// 網址變成連結（其他字照樣跳脫）
function linkify(s) {
  const { esc } = ctx;
  let out = '', last = 0;
  for (const m of String(s).matchAll(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    out += esc(s.slice(last, m.index)) + `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + esc(String(s).slice(last));
}

function card(h) {
  const { esc, ago } = ctx;
  const waitingNow = h.status === 'waiting', active = h.status === 'todo' || waitingNow;
  const log = (h.log || []).slice(-3).map(l => `${l.who === 'you' ? t('你') : t('代理人')}：${l.text}`).join('\n');
  const btns = !active ? '' : (waitingNow
    ? `<button class="ok" data-a="news">${t('有消息了')}</button>`
    : `<button class="ok" data-a="done">${t('辦好了')}</button><button data-a="stuck">${t('卡住了')}</button>`)
    + `<button data-a="ask">${t('問一下')}</button>${h.sid ? `<button data-a="chat">${t('開對話')}</button>` : ''}<button data-a="drop">${t('不辦了')}</button>`;
  return `<div class="hcard s-${esc(h.status)} ${h.id === openId ? 'flash' : ''}" data-id="${esc(h.id)}">
    <div class="ht">${esc(h.title)}</div>
    <div class="hm">${waitingNow ? esc(t('在等：{who}', { who: h.waitingFor || t('外面回覆') })) + ' · ' : ''}${esc(ago ? ago(Date.parse(h.updatedAt)) : '')}</div>
    ${h.why ? `<div class="hw">${t('為什麼要你：')}${esc(h.why)}</div>` : ''}
    ${active && h.steps?.length ? `<ol>${h.steps.map(s => `<li>${linkify(s)}</li>`).join('')}</ol>` : ''}
    ${active && h.links?.length ? `<div class="hl">${h.links.map(l => `<a target="_blank" rel="noopener" title="${esc(l.url || l.path)}" href="${esc(l.url || authUrl('/api/fs/download?path=' + encodeURIComponent(l.path)))}">${l.url ? '' : '↓ '}${esc(l.label)}</a>`).join('')}</div>` : ''}
    ${active && h.report ? `<div class="hr">${t('辦完跟它說：')}${esc(h.report)}</div>` : ''}
    ${log ? `<div class="hg">${esc(log)}</div>` : ''}
    ${btns ? `<div class="hb">${btns}</div>` : ''}
  </div>`;
}

function render() {
  if (!drawer) return;
  const n = todo().length, m = waiting().length;
  drawer.querySelector('#h-sub').textContent = n ? t('{n} 件等你做', { n }) + (m ? t('、{m} 件在等回覆', { m }) : '') : m ? t('{m} 件在等回覆', { m }) : t('沒有要你本人辦的事');
  const done = items.filter(h => !['todo', 'waiting'].includes(h.status));
  const sec = (title, list) => list.length ? `<div class="hsec">${title}</div>${list.map(card).join('')}` : '';
  const pane = drawer.querySelector('#hpane');
  pane.innerHTML = (n + m + done.length) ? todo().map(card).join('') + sec(t('等外面回覆'), waiting()) + sec(t('最近結束的'), done)
    : `<div class="empty">${t('沒有要你本人辦的事。代理人遇到得你出手的步驟，會釘一張在這裡。')}</div>`;
  pane.querySelectorAll('.hcard').forEach(el => {
    const h = items.find(x => x.id === el.dataset.id);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { b.disabled = true; try { await act(h, b.dataset.a); } finally { b.disabled = false; } });
  });
  if (openId) pane.querySelector(`[data-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// 看交代的那段對話：辦公室裡有這個人就飛過去開他的面板，沒有就開對話頁
function openChat(to) {
  if (!to?.sid) return;
  drawer.classList.remove('open');
  if (!ctx.focusPerson?.(to.sid)) window.open(`/?session=${encodeURIComponent(to.sid)}&cwd=${encodeURIComponent(to.cwd || '')}`, '_blank');
}

async function act(h, a) {
  if (a === 'chat') return openChat(h);
  const call = async (path, body) => {
    const r = await ctx.post(`/api/space/handoff/${encodeURIComponent(h.id)}/${path}`, body);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { ctx.toast(j.error || t('沒送出去')); return null; }
    return j;
  };
  if (a === 'ask') {
    const q = prompt(t('想問什麼？（會送進交代這件事的對話，接著帶你過去看回答）'));
    if (!q?.trim()) return;
    const j = await call('ask', { text: q.trim() });
    if (j) { ctx.toast(t('問了，它在回答')); openChat(j); }
  } else if (a === 'drop') {
    if (!confirm(t('「{title}」不辦了？', { title: h.title }))) return;
    if (await call('drop', {})) ctx.toast(t('拿掉了'));
  } else {
    const ok = a === 'done';
    const note = ok ? prompt(t('辦好了，要補充什麼嗎？（可以空著）'), '') : prompt(a === 'news' ? t('有消息了？貼上審核結果或信的內容') : t('卡在哪？（被退的理由、看不懂哪一步、做不到…）'));
    if (note == null || (!ok && !note.trim())) return;
    if (await call('report', { ok, note: note.trim() })) { ctx.toast(t('交給它了，它會接著做')); if (ok) ctx.sfx?.done?.(); }
  }
  await load();
}

async function load() {
  try { items = (await ctx.api('/api/space/handoff')).items || []; } catch { return; }
  drawBoard(); if (drawer?.classList.contains('open')) render();
}

export const handoff = {
  name: 'handoff',
  async init(c) {
    ctx = c;
    mountUi();
    await load();
    setInterval(load, 30_000);
    if (new URLSearchParams(location.search).has('handoff')) setTimeout(() => { ctx.flyToPlace?.('handoff'); openDrawer(); }, 1200);
  },
  office: buildBoard,
  // 收件箱裡的等你辦：飛到主管室的板子、打開抽屜、那一張框起來
  openInbox(item) {
    if (item.kind !== 'handoff') return false;
    ctx.flyToPlace?.('handoff'); openDrawer(item.handoff?.id || null);
    return true;
  },
};
