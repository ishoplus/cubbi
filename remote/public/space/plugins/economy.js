// ── 外掛：經營系統（claude-web 專屬，不進 Cubbi）─────────────────────────────
//
// 帳本在伺服器（economy.js）：只獎勵成果（回合完成、改檔、commit、背景任務），
// 一半進部門（只能買自己那桌的設備）、一半進公司（累計決定辦公室等級）。
// 這裡把帳本換算成辦公室長相（look）交給空間核心，另外加上：左上角的積木、裝修抽屜（任務、部門、設施、獎盃、用量、帳本、規則）、
// 進度頁的「幫公司賺了幾塊」、牆上統計看板的內容。
// 外掛介面：init(ctx)、onEvent(msg)、progressHtml(p)、drawBoard(g, W, H, big, info)

import { t, LANG, LOCALE } from './lang.js';

let ctx = null, econ = null;
let shopTab = 'quest', shopDept = null;
const fmtB = (n) => (Math.floor(n * 10) / 10).toLocaleString(LOCALE, { maximumFractionDigits: 1 });
const SEP = t('、');
// 伺服器寫進帳本的說明是組好的中文（任務完成：…、買了…、換成…、…升級：…）：英文時拆開來翻
function trLabel(s) {
  if (LANG === 'zh' || !s) return s;
  let m;
  if ((m = s.match(/^任務完成：(.+)$/))) return t('任務完成：{name}', { name: t(m[1]) });
  if ((m = s.match(/^買了(.+)$/))) return t('買了{name}', { name: t(m[1]) });
  if ((m = s.match(/^換成(.+)$/))) return t('換成{name}', { name: t(m[1]) });
  if ((m = s.match(/^(.+?)升級：(.+)$/))) return t('{name}升級：{level}', { name: t(m[1]), level: t(m[2]) });
  return t(s);
}
const BRICK = '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="6" width="14" height="8" rx="1.5" fill="#f2cd37" stroke="#c99a18"/><rect x="3" y="3" width="4" height="3.5" rx="1" fill="#f2cd37" stroke="#c99a18"/><rect x="9" y="3" width="4" height="3.5" rx="1" fill="#f2cd37" stroke="#c99a18"/></svg>';

// 帳本 → 辦公室長相
function lookOf(e) {
  return {
    level: e.level, levelName: e.levelName,
    facilities: e.facilities || {},
    trophies: Object.keys(e.trophies || {}).map(id => ({ id, ...(e.catalog.trophies.find(x => x.id === id) || {}) })),
    depts: Object.fromEntries(Object.entries(e.depts || {}).map(([cw, d]) => [cw, { equip: d.equip, outfit: d.outfit || null }])),
  };
}
function apply(next) {
  const prev = econ; econ = next;
  document.getElementById('econ-bal').textContent = econ.ready ? fmtB(econ.company.balance) : t('開帳中');
  document.getElementById('econ-lv').textContent = t(econ.levelName);
  // 帳本跟畫面不一樣的地方：頁面剛打開就直接換，開著時派送貨員
  ctx.setLook(lookOf(econ), { animate: !!(econ.ready && prev?.ready) });
  if (shop.classList.contains('open')) renderShop();
}
async function load() {
  try { apply(await ctx.api('/api/space/economy')); } catch {}
}

// ── 畫面：左上角的積木、裝修抽屜 ──
let shop;
function mountUi() {
  const chip = document.createElement('div');
  chip.className = 'chip econ'; chip.id = 'econ-chip'; chip.title = t('公司積木（點開裝修）');
  chip.innerHTML = `${BRICK}<b id="econ-bal">…</b><span class="lv" id="econ-lv"></span>`;
  chip.onclick = () => openShop();
  document.getElementById('hud-left').appendChild(chip);
  shop = document.createElement('aside');
  shop.id = 'shop'; shop.className = 'drawer';
  shop.innerHTML = `<div class="grip"></div>
  <div class="p-head">
    <div class="p-swatch" style="background:#f2cd37;display:flex;align-items:center;justify-content:center">${BRICK}</div>
    <div style="min-width:0"><div class="p-title" id="s-title"></div><div class="p-sub" id="s-sub"></div></div>
    <button class="p-close" id="s-close" title="${t('關閉')}">✕</button>
  </div>
  <div class="lvbar" id="s-lv"></div>
  <div class="tabs">
    <button class="tab" data-stab="quest">${t('任務')}</button>
    <button class="tab" data-stab="dept">${t('部門')}</button>
    <button class="tab" data-stab="fac">${t('公共設施')}</button>
    <button class="tab" data-stab="trophy">${t('獎盃')}</button>
    <button class="tab" data-stab="usage">${t('用量')}</button>
    <button class="tab" data-stab="ledger">${t('帳本')}</button>
    <button class="tab" data-stab="rules">${t('規則')}</button>
  </div>
  <div class="p-body"><div class="pane on" id="spane"></div></div>`;
  document.getElementById('toast').before(shop);
  shop.querySelector('#s-close').onclick = () => shop.classList.remove('open');
  shop.querySelectorAll('.tab[data-stab]').forEach(b => b.addEventListener('click', () => { shopTab = b.dataset.stab; renderShop(); }));
}

function openShop(cwd) {
  ctx.closePanel();
  if (cwd) shopDept = cwd;
  shop.classList.add('open');
  renderShop();
}

function renderShop() {
  if (!econ) return;
  const { esc, ICON, ago, OUTFITS, NPC_OUTFITS, projName, toast } = ctx;
  const c = econ.catalog;
  document.getElementById('s-title').textContent = t('{name}（第 {n} 級）', { name: t(econ.levelName), n: econ.level + 1 });
  document.getElementById('s-sub').textContent = t('公司 {balance} 塊 · 累計 {total} 塊 · 連續上班 {streak} 天', { balance: fmtB(econ.company.balance), total: fmtB(econ.total), streak: econ.streak });
  const nx = econ.next;
  document.getElementById('s-lv').innerHTML = nx
    ? `<div class="row"><span>${t('下一級：{name}', { name: esc(t(nx.name)) })}</span><span>${fmtB(econ.total)} / ${nx.at.toLocaleString()}</span></div><div class="bar"><i style="width:${Math.min(100, econ.total / nx.at * 100)}%"></i></div>`
    : `<div class="row"><span>${t('已經是最高級')}</span></div>`;
  shop.querySelectorAll('.tab[data-stab]').forEach(b => b.classList.toggle('on', b.dataset.stab === shopTab));
  const pane = document.getElementById('spane');
  if (!econ.ready) { pane.innerHTML = `<div class="empty">${t('正在回算過去 30 天的成果，稍等一下…')}</div>`; return; }

  if (shopTab === 'dept') {
    const list = ctx.departments();
    if (!shopDept || !list.includes(shopDept)) shopDept = ctx.selectedCwd() || list.slice().sort((a, b) => (econ.depts[b]?.balance || 0) - (econ.depts[a]?.balance || 0))[0];
    const d = econ.depts[shopDept] || { balance: 0, equip: ctx.EQUIP0 };
    const eq = d.equip;
    let h = '<div class="depts">' + list.map(cw => `<span class="dchip ${cw === shopDept ? 'on' : ''}" data-cw="${esc(cw)}">${esc(projName(cw))}<small>${fmtB(econ.depts[cw]?.balance || 0)}</small></span>`).join('') + '</div>';
    h += `<div class="sec"><h4>${t('{dept}（{outfit}）的預算：{n} 塊', { dept: esc(projName(shopDept)), outfit: esc(OUTFITS[ctx.outfitFor(shopDept)]?.name || ''), n: fmtB(d.balance) })}</h4></div>`;
    for (const [k, it] of Object.entries(c.equip)) {
      const lv = eq[k], nl = lv + 1;
      const btn = nl < it.levels.length
        ? `<button class="buy" data-what="equip" data-key="${k}" ${d.balance < it.cost[nl] ? 'disabled' : ''}>${t('升級成{level} · {cost}', { level: esc(t(it.levels[nl])), cost: it.cost[nl] })}</button>`
        : `<button class="buy ghost" disabled>${t('最高級了')}</button>`;
      h += `<div class="srow"><div class="sname">${esc(t(it.name))}<small>${t('目前：{level}', { level: esc(t(it.levels[lv])) })}</small></div>${btn}</div>`;
    }
    h += `<div class="sec"><h4>${t('桌上小物（買過可以隨時擺上或收起）')}</h4></div><div class="opts">` + Object.entries(c.trinkets).map(([k, it]) => {
      const owned = eq.owned?.[k], on = eq.trinkets?.[k];
      return `<span class="opt ${on ? 'on' : ''}" data-what="trinket" data-key="${k}">${esc(t(it.name))}<small>${owned ? (on ? t('擺著') : t('收著')) : it.cost}</small></span>`;
    }).join('') + '</div>';
    const cur = econ.depts[shopDept]?.outfit || null;
    h += `<div class="sec"><h4>${t('部門制服（免費，隨時換）')}</h4></div><div class="opts">`
      + `<span class="opt ${cur ? '' : 'on'}" data-outfit="">${t('自動')}<small>${esc(OUTFITS[ctx.outfitAuto(shopDept)]?.name || '')}</small></span>`
      + Object.entries(OUTFITS).filter(([k]) => !NPC_OUTFITS.has(k)).map(([k, o]) => `<span class="opt ${cur === k ? 'on' : ''}" data-outfit="${k}">${esc(o.name)}</span>`).join('') + '</div>';
    h += `<div class="sec"><h4>${t('部門地板')}</h4></div><div class="opts">` + Object.entries(c.floors).map(([k, it]) => {
      const owned = eq.owned?.[k], on = eq.floor === k;
      return `<span class="opt ${on ? 'on' : ''}" data-what="floor" data-key="${k}">${esc(t(it.name))}<small>${on ? t('使用中') : owned ? t('換上') : it.cost}</small></span>`;
    }).join('') + '</div>';
    pane.innerHTML = h;
    pane.querySelectorAll('.dchip').forEach(el => el.onclick = () => { shopDept = el.dataset.cw; renderShop(); ctx.focusDept(shopDept); });
    pane.querySelectorAll('[data-what]').forEach(el => el.onclick = () => buy(el.dataset.what, el.dataset.key));
    pane.querySelectorAll('[data-outfit]').forEach(el => el.onclick = async () => {
      const r = await ctx.post('/api/space/economy/outfit', { cwd: shopDept, outfit: el.dataset.outfit || null });
      if (!r.ok) { toast(t('換不了')); return; }
      apply(await r.json());
      toast(t('{dept} 換上{outfit}的制服', { dept: projName(shopDept), outfit: OUTFITS[ctx.outfitFor(shopDept)]?.name || '' }));
    });
  } else if (shopTab === 'quest') {
    const qs = econ.quests || [];
    const left = qs.filter(q => !q.done).length;
    pane.innerHTML = `<div class="sec"><h4>${t('今天的任務（每天換一組，做完給公司積木）')}${left ? '' : t(' · 全部完成！')}</h4></div>`
      + qs.map(q => `<div class="quest ${q.done ? 'done' : ''}"><div class="qn">${esc(t(q.name))}<small>${q.done ? t('完成') : `${q.have} / ${q.n}`}</small>`
        + `<div class="qbar"><i style="width:${Math.round(q.have / q.n * 100)}%"></i></div></div><span class="rw">${q.done ? '✓ ' : '+'}${q.reward}</span></div>`).join('')
      + `<div class="sec" style="font-size:12px;color:var(--sub);line-height:1.7">· ${t('跟積木同一套規則：回合、改檔、commit、背景任務都只算成果')}<br>· ${t('「在 N 個專案工作」：今天在幾個不同專案做出成果')}<br>· ${t('「外包給 Codex」：Claude 叫 Codex 做事的次數')}</div>`;
  } else if (shopTab === 'usage') {
    // 用量：Claude 每天在各部門用掉的 token（從對話紀錄算，只看不算積木）
    const days = econ.usage || [];
    const tot = (u) => u.in + u.cw + u.cr + u.out;
    const fmtT = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
    const perDay = days.map(([d, by]) => [d, Object.values(by).reduce((s, u) => s + tot(u), 0)]);
    const mx = Math.max(1, ...perDay.map(x => x[1]));
    const todayKey = days.at(-1)?.[0], today = days.at(-1)?.[1] || {};
    const week = {};
    for (const [, by] of days.slice(-7)) for (const [cw, u] of Object.entries(by)) { const w = (week[cw] ||= { in: 0, cr: 0, cw: 0, out: 0 }); for (const k in u) w[k] += u[k]; }
    const rows = (by) => { const list = Object.entries(by).sort((a, b) => tot(b[1]) - tot(a[1]));
      return list.map(([cw, u]) => `<div class="urow"><span class="nm" title="${esc(cw)}">${esc(projName(cw))}</span><span class="ubar" style="width:${Math.max(4, tot(u) / Math.max(1, ...list.map(x => tot(x[1]))) * 100)}%">`
        + ['cr', 'cw', 'in', 'out'].map(k => `<i style="width:${u[k] / tot(u) * 100}%;background:${{ cr: '#c3d7ec', cw: '#7fb0e0', in: '#0b6fd6', out: '#f08a12' }[k]}"></i>`).join('')
        + `</span><span class="v">${fmtT(tot(u))}</span></div>`).join('') || `<div class="empty">${t('還沒有紀錄')}</div>`; };
    pane.innerHTML = `<div class="sec"><h4>${t('最近 14 天（token）')}</h4></div><div class="udays">` + perDay.map(([d, v]) => `<div><b style="height:${Math.max(2, v / mx * 64)}px" title="${fmtT(v)}"></b>${d.slice(8)}</div>`).join('') + '</div>'
      + `<div class="ulegend"><span><i style="background:#c3d7ec"></i>${t('讀快取')}</span><span><i style="background:#7fb0e0"></i>${t('寫快取')}</span><span><i style="background:#0b6fd6"></i>${t('新輸入')}</span><span><i style="background:#f08a12"></i>${t('輸出')}</span></div>`
      + `<div class="sec"><h4>${t('今天（{d}）各部門', { d: todayKey ? todayKey.slice(5) : '' })}</h4></div>${rows(today)}`
      + `<div class="sec"><h4>${t('最近 7 天各部門')}</h4></div>${rows(week)}`
      + `<div class="sec" style="font-size:12px;color:var(--sub);line-height:1.7">· ${t('從 Claude Code 對話紀錄算出來（終端機開的也算），子 agent 不算')}<br>· ${t('讀快取最便宜，真正花錢的是新輸入、寫快取與輸出')}</div>`;
  } else if (shopTab === 'fac') {
    let h = `<div class="sec"><h4>${t('公司預算：{n} 塊（公共設施大家一起用）', { n: fmtB(econ.company.balance) })}</h4></div>`;
    for (const [k, it] of Object.entries(c.facilities)) {
      const lv = econ.facilities?.[k] || 0, nl = lv + 1;
      const btn = nl < it.levels.length
        ? `<button class="buy" data-what="facility" data-key="${k}" ${econ.company.balance < it.cost[nl] ? 'disabled' : ''}>${t('升級成{level} · {cost}', { level: esc(t(it.levels[nl])), cost: it.cost[nl] })}</button>`
        : `<button class="buy ghost" disabled>${t('最高級了')}</button>`;
      h += `<div class="srow"><div class="sname">${esc(t(it.name))}<small>${t('目前：{level}', { level: esc(t(it.levels[lv])) })}</small></div>${btn}</div>`;
    }
    pane.innerHTML = h;
    pane.querySelectorAll('[data-what]').forEach(el => el.onclick = () => buy(el.dataset.what, el.dataset.key));
  } else if (shopTab === 'trophy') {
    pane.innerHTML = `<div class="sec"><h4>${t('達成就自動擺上獎盃架（左牆書櫃上方）')}</h4></div>` + c.trophies.map(x => {
      const at = econ.trophies?.[x.id];
      return `<div class="srow" style="opacity:${at ? 1 : 0.55}"><span style="font-size:22px;width:28px;text-align:center;color:${at ? '#d4a017' : '#9aa6b1'}">${at ? '★' : '☆'}</span>`
        + `<div class="sname">${esc(t(x.name))}<small>${esc(t(x.desc))}${at ? ' · ' + new Date(at).toLocaleDateString(LOCALE) : ''}</small></div></div>`;
    }).join('');
  } else if (shopTab === 'ledger') {
    pane.innerHTML = econ.ledger.length ? econ.ledger.map(l => {
      const name = trLabel(l.label) || t(econ.ruleNames[l.kind] || l.kind);   // 購買、任務帶自己的說明
      const ic = { turn: ICON.talk, file: ICON.edit, commit: ICON.plan, bg: ICON.agent, todo: ICON.plan, checkin: ICON.user, buy: ICON.tool }[l.kind] || ICON.tool;
      const color = { turn: '#1e9e55', file: '#0b6fd6', commit: '#7a4fd0', bg: '#2aa6a0', todo: '#e0a020', checkin: '#f08a12', buy: '#d63a2f' }[l.kind] || '#607d8b';
      return `<div class="ledger"><span class="ic" style="width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:${color}">${ic.replace('<svg', '<svg width="14" height="14"')}</span>`
        + `<span>${esc(name)}<div class="who">${esc(l.scope === 'company' ? t('公司') : projName(l.cwd))} · ${ago(l.at)}</div></span>`
        + `<span class="amt ${l.amount < 0 ? 'neg' : 'pos'}">${l.amount > 0 ? '+' : ''}${fmtB(l.amount)}</span></div>`;
    }).join('') : `<div class="empty">${t('還沒有紀錄')}</div>`;
  } else {
    const r = econ.rules, n = econ.ruleNames;
    pane.innerHTML = `<div class="sec"><h4>${t('只算成果，不算用量')}</h4></div><table class="rules" style="width:100%;border-collapse:collapse">`
      + Object.keys(r).map(k => `<tr><td>${esc(t(n[k]))}</td><td>+${r[k]}</td></tr>`).join('') + '</table>'
      + `<div class="sec" style="font-size:13px;line-height:1.7;color:var(--sub)">
        · ${t('改檔：同一段對話裡同一個檔案只算一次')}<br>
        · ${t('不到 10 秒就結束的回合不算，出錯的工具不算')}<br>
        · ${t('每個專案每小時最多 30 塊')}<br>
        · ${t('連續上班每天多 10%，最多 1.5 倍（現在 {x} 倍）', { x: Math.min(1.5, 1 + 0.1 * (econ.streak - 1)).toFixed(1) })}<br>
        · ${t('賺到的一半進部門（買自己那桌的設備）、一半進公司')}<br>
        · ${t('公司等級看累計賺了多少，不用花錢：{list}', { list: econ.catalog.levels.map(l => `${t(l.name)} ${l.at.toLocaleString()}`).join(SEP) })}<br>
        · ${t('終端機開的對話也算')}</div>`;
  }
}

async function buy(what, key) {
  try {
    const r = await ctx.post('/api/space/economy/buy', { cwd: shopDept, what, key });
    const j = await r.json();
    if (!r.ok) { ctx.toast(j.error ? t(j.error) : t('買不了')); return; }
    apply(j);
    ctx.toast(t('已下單，送貨員馬上到'));
  } catch { ctx.toast(t('連線失敗')); }
}

export const economy = {
  name: 'economy',
  async init(c) { ctx = c; mountUi(); await load(); },
  onEvent(msg) {
    if (msg.type === 'economy') { load(); return true; }
    if (msg.type === 'trophy') { ctx.sfx.trophy(); ctx.toast(t('拿到獎盃：{name}！', { name: t(msg.name) })); setTimeout(() => ctx.celebrate(t('拿到「{name}」，開慶功宴！', { name: t(msg.name) })), 3000); return true; }
    if (msg.type === 'quest') {
      ctx.sfx.done(); ctx.toast(t('任務完成：{name}，公司 +{n} 積木', { name: t(msg.name), n: msg.reward }));
      load().then(() => { if (econ.quests?.length && econ.quests.every(q => q.done)) setTimeout(() => ctx.celebrate(t('今天的任務全部完成，開慶功宴！')), 3000); });
      return true;
    }
    return false;
  },
  // 進度頁最上面：這段對話幫公司賺了幾塊
  progressHtml(p) {
    if (!p.bricks?.total) return '';
    const by = {};
    for (const r of p.bricks.recent) by[r.kind] = (by[r.kind] || 0) + r.amount;
    return `<div class="bricks-sum">${t('這段對話幫公司賺了 {n} 塊積木', { n: `<b>${fmtB(p.bricks.total)}</b>` })}`
      + `<div style="color:var(--sub);font-size:12px;margin-top:3px">${t('最近：{list}', { list: Object.entries(by).map(([k, v]) => `${t(econ?.ruleNames?.[k] || k)} ${fmtB(v)}`).join(SEP) })}</div></div>`;
  },
  // 牆上統計看板：等級、今日積木、最近 7 天；大看板多部門排行與獎盃
  drawBoard(g, W, H, big, { u, working, helpers }) {
    if (!econ) return false;
    const colW = big ? W / 3 : W;
    g.fillStyle = '#9fc3e9'; g.font = `600 ${18 * u}px sans-serif`; g.fillText(t('{name} · 第 {n} 級', { name: t(econ.levelName), n: econ.level + 1 }), 18 * u, 32 * u);
    const nums = [[t('今日積木'), fmtB(econ.today)], [t('工作中'), working], [t('同事'), helpers]];
    nums.forEach(([k, v], i) => {
      const x = 18 * u + i * (colW - 30 * u) / 3;
      g.fillStyle = '#ffd36b'; g.font = `800 ${40 * u}px sans-serif`; g.fillText(String(v), x, 88 * u);
      g.fillStyle = '#9fc3e9'; g.font = `${15 * u}px sans-serif`; g.fillText(k, x, 110 * u);
    });
    const days = econ.days || [], mx = Math.max(1, ...days.map(d => d[1]));
    const bw = (colW - 50 * u) / 7, by = H - 30 * u, bh = H - 170 * u;
    days.forEach(([d, v], i) => {
      const h = Math.max(2, v / mx * bh);
      g.fillStyle = i === days.length - 1 ? '#ffd36b' : '#4f8fd6';
      g.fillRect(22 * u + i * bw, by - h, bw * 0.7, h);
      g.fillStyle = '#9fc3e9'; g.font = `${12 * u}px sans-serif`; g.fillText(d.slice(8), 22 * u + i * bw, by + 16 * u);
    });
    if (!big) return true;
    const x0 = colW + 20 * u;
    g.fillStyle = '#9fc3e9'; g.font = `600 ${18 * u}px sans-serif`; g.fillText(t('部門排行（累計）'), x0, 32 * u);
    const ds = Object.entries(econ.depts).sort((a, b) => b[1].earned - a[1].earned).slice(0, 6);
    const dm = Math.max(1, ...ds.map(d => d[1].earned));
    ds.forEach(([cw, d], i) => {
      const y = 64 * u + i * 30 * u;
      g.fillStyle = '#f4f4f4'; g.font = `${14 * u}px sans-serif`; g.fillText(ctx.projName(cw).slice(0, 14), x0, y);
      g.fillStyle = '#4fbf7a'; g.fillRect(x0, y + 5 * u, (colW - 40 * u) * d.earned / dm, 8 * u);
    });
    const x1 = colW * 2 + 20 * u, tr = econ.catalog.trophies;
    g.fillStyle = '#9fc3e9'; g.font = `600 ${18 * u}px sans-serif`; g.fillText(t('獎盃 {n} / {total}', { n: Object.keys(econ.trophies).length, total: tr.length }), x1, 32 * u);
    tr.forEach((x, i) => {
      const y = 62 * u + i * 26 * u;
      g.fillStyle = econ.trophies[x.id] ? '#ffd36b' : '#4a5d78'; g.font = `${15 * u}px sans-serif`;
      g.fillText((econ.trophies[x.id] ? '★ ' : '☆ ') + t(x.name), x1, y);
    });
    return true;
  },
};
