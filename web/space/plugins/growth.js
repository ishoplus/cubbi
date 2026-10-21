// ── 外掛：自動成長（Cubbi 單獨跑時內建）──────────────────────────────────────
//
// 伺服器（server/growth.js）照真實用量算出辦公室長相；這裡把它交給空間核心（setLook），
// 有變化就派送貨員、升級下積木雨。左上角一顆等級晶片，點開看離下一級還差多少、每一級解鎖什麼、拿到哪些獎盃。
// 第一次打開時伺服器還在回顧紀錄：辦公室會邊回顧邊長大（從車庫一路升上去）。
import { t as tr } from '../i18n.js';

const LEVEL_NAMES = ['車庫新創', '小工作室', '正式辦公室', '整層樓', '總部大樓'];
const UNLOCKS = ['紙箱和舊電腦，夢想從這裡開始', '咖啡機、牆上的統計電視', '會議室、休息區、遊戲角、共用工作桌', '咖啡師、按摩椅、桌球與大型電玩、辦公室貓', '大廳 logo 牆、整面看板、三隻貓'];
const TROPHY_NAMES = { first_bg: '第一位同事', streak7: '全勤一週', day50: '高產的一天', commit100: '百次提交', streak30: '全勤一個月', office: '正式辦公室', turns10k: '一萬個回合', hq: '總部落成' };
const BRICK = '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="6" width="14" height="8" rx="1.5" fill="#f2cd37" stroke="#c99a18"/><rect x="3" y="3" width="4" height="3.5" rx="1" fill="#f2cd37" stroke="#c99a18"/><rect x="9" y="3" width="4" height="3.5" rx="1" fill="#f2cd37" stroke="#c99a18"/></svg>';

let ctx = null, data = null, shown = false, chip, drawer;
const fmt = (n) => Number(n || 0).toLocaleString();

function toLook(L) { return { ...L, levelName: tr(LEVEL_NAMES[L.level]) }; }

async function load() {
  try { data = await ctx.api('/api/space/growth'); } catch { return; }
  if (!data?.look) { chip.querySelector('b').textContent = tr('回顧紀錄中…'); return; }
  // 第一次拿到：直接套上（頁面剛開）；之後的變化：派送貨員、升級放積木雨
  ctx.setLook(toLook(data.look), { animate: shown });
  shown = true;
  paint();
}

function paint() {
  const L = data.look, p = L.progress;
  chip.querySelector('b').textContent = tr(LEVEL_NAMES[L.level]);
  chip.querySelector('i').style.width = (p.next ? Math.min(100, p.score / p.next * 100) : 100) + '%';
  chip.title = data.ready ? '' : tr('回顧紀錄中…');
  if (!drawer.classList.contains('open')) return;
  const esc = ctx.esc;
  drawer.querySelector('.p-title').textContent = tr(LEVEL_NAMES[L.level]);
  drawer.querySelector('.p-sub').textContent = data.ready ? tr('照你真實的工作量長大') : tr('回顧紀錄中… {n}/{total}', { n: data.scanned, total: data.total });
  drawer.querySelector('.lvbar').innerHTML = p.next
    ? `<div class="row"><span>${esc(tr('下一級：{name}', { name: tr(LEVEL_NAMES[L.level + 1]) }))}</span><span>${fmt(p.score)} / ${fmt(p.next)}</span></div><div class="bar"><i style="width:${Math.min(100, p.score / p.next * 100)}%"></i></div>`
    : `<div class="row"><span>${esc(tr('已經是最高級'))}</span></div>`;
  const stat = (k, v) => `<div class="srow"><div class="sname">${esc(tr(k))}</div><b>${fmt(v)}</b></div>`;
  drawer.querySelector('.pane').innerHTML =
    `<div class="sec"><h4>${esc(tr('你的工作量'))}</h4></div>` + stat('完成的回合', p.turns) + stat('commit', p.commits) + stat('上班天數', p.days) + stat('最長連續上班', p.bestStreak) + stat('改過的檔案', p.files)
    + `<div class="sec"><h4>${esc(tr('每一級解鎖什麼'))}</h4></div>`
    + LEVEL_NAMES.map((n, i) => `<div class="srow" style="opacity:${i <= L.level ? 1 : 0.55}"><div class="sname">${i <= L.level ? '★' : '☆'} ${esc(tr(n))}<small>${esc(tr(UNLOCKS[i]))}</small></div><small>${fmt([0, 200, 1000, 4000, 12000][i])}</small></div>`).join('')
    + `<div class="sec"><h4>${esc(tr('獎盃（擺在獎盃架上）'))}</h4></div><div class="opts">`
    + Object.entries(TROPHY_NAMES).map(([id, n]) => `<span class="opt ${L.trophies.some(t => t.id === id) ? 'on' : ''}">${esc(tr(n))}</span>`).join('') + '</div>'
    + `<div class="sec" style="font-size:12px;color:var(--sub);line-height:1.7">${esc(tr('分數＝完成的回合＋commit×3。各部門（專案）的螢幕、椅子、桌子、地板看那個專案自己的回合數。只讀你電腦上的紀錄，不上傳。'))}</div>`;
}

function mount() {
  chip = document.createElement('div');
  chip.className = 'chip econ'; chip.id = 'growth-chip';
  chip.innerHTML = `${BRICK}<b>…</b><span class="qbar" style="width:46px"><i style="width:0%"></i></span>`;
  chip.onclick = () => { ctx.closePanel(); drawer.classList.add('open'); paint(); };
  document.getElementById('hud-left').appendChild(chip);
  drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.innerHTML = `<div class="grip"></div><div class="p-head">
      <div class="p-swatch" style="background:#f2cd37;display:flex;align-items:center;justify-content:center">${BRICK}</div>
      <div style="min-width:0"><div class="p-title"></div><div class="p-sub"></div></div>
      <button class="p-close" title="${tr('關閉')}">✕</button></div>
    <div class="lvbar"></div><div class="p-body"><div class="pane on"></div></div>`;
  document.getElementById('toast').before(drawer);
  drawer.querySelector('.p-close').onclick = () => drawer.classList.remove('open');
}

export const growth = {
  name: 'growth',
  async init(c) { ctx = c; mount(); await load(); },
  onEvent(msg) { if (msg.type === 'growth') { load(); return true; } return false; },
};
