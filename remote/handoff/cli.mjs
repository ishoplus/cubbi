#!/usr/bin/env node
// ── 等你辦的指令列：給對話裡的代理人用（也能自己打）────────────────────────────────
//
//   handoff add '<json>'            新增一件（也可以從 stdin 給 JSON）。沒給 sid／cwd 就抓「這個資料夾最近在寫的那段對話」
//   handoff list [--all]            還沒結束的（--all 連 done／dropped）
//   handoff show <id>
//   handoff update <id> '<json>'    改步驟、連結…（欄位見 store.js）
//   handoff set <id> <todo|waiting|done|dropped> [--note 說明] [--for 在等誰]
//   handoff done <id> [--note 說明]
// JSON 範例：{"title":"到 Chrome 開發者後台上傳 zip","why":"要本人登入","steps":["打開 …","上傳 /path/x.zip"],
//            "links":[{"label":"後台","url":"https://…"}],"report":"送出了／被退的理由","watch":{"from":"chromewebstore","keywords":["審核"]}}
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHandoff, STATUSES } from './store.js';

const store = createHandoff();
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest.splice(i, 2)[1] ?? '' : undefined; };
const all = rest.includes('--all');
const die = (msg) => { console.error('ERROR: ' + msg); process.exit(1); };
const json = (s) => { try { return JSON.parse(s); } catch (e) { die('JSON 壞了：' + e.message); } };
const stdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

// Claude Code 把對話存在 ~/.claude/projects/<資料夾，非英數換成 ->/<sid>.jsonl；這個資料夾（或上層）最近十分鐘在寫的那段就是「我」
function currentSession(cwd) {
  const root = join(homedir(), '.claude', 'projects');
  for (let d = cwd; ; d = dirname(d)) {
    const pdir = join(root, d.replace(/[^a-zA-Z0-9]/g, '-'));
    let best = null;
    try {
      for (const f of readdirSync(pdir)) {
        if (!f.endsWith('.jsonl')) continue;
        const m = statSync(join(pdir, f)).mtimeMs;
        if (!best || m > best.m) best = { sid: f.slice(0, -6), m };
      }
    } catch {}
    if (best && Date.now() - best.m < 10 * 60_000) return { sid: best.sid, cwd: d };
    if (d === dirname(d)) return null;
  }
}

const line = (h) => `${h.id}  [${h.status}${h.waitingFor ? '：' + h.waitingFor : ''}]  ${h.title}`;
function show(h) {
  console.log(line(h));
  if (h.why) console.log('為什麼要你：' + h.why);
  h.steps?.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  h.links?.forEach(l => console.log(`  · ${l.label}：${l.url || l.path}`));
  if (h.report) console.log('辦完回報：' + h.report);
  if (h.sid) console.log(`來自對話：${h.sid}（${h.cwd || ''}）`);
  h.log?.slice(-5).forEach(l => console.log(`  ${l.at.slice(5, 16).replace('T', ' ')} ${l.who === 'you' ? '老闆' : '代理人'}：${l.text}`));
}

try {
  if (cmd === 'add') {
    const p = json(rest[0] || stdin());
    if (!p.sid) Object.assign(p, currentSession(p.cwd || process.cwd()) || {});
    const h = store.add(p);
    console.log('已加進「等你辦」：' + line(h) + (h.sid ? '' : '\n（沒找到這段對話，老闆回報時會在 ' + (h.cwd || '原資料夾') + ' 開新對話）'));
  } else if (cmd === 'list') {
    const xs = store.list().filter(h => all || ['todo', 'waiting'].includes(h.status));
    console.log(xs.length ? xs.map(line).join('\n') : '沒有等老闆辦的事');
  } else if (cmd === 'show') {
    const h = store.get(rest[0] || die('要給 id'));
    h ? show(h) : die('找不到 ' + rest[0]);
  } else if (cmd === 'update') {
    const id = rest[0] || die('要給 id');
    show(store.update(id, json(rest[1] || stdin()), { note: flag('note') || '' }));
  } else if (cmd === 'set' || cmd === 'done') {
    const note = flag('note'), waitingFor = flag('for');
    const id = rest[0] || die('要給 id');
    const status = cmd === 'done' ? 'done' : rest[1];
    if (!STATUSES.includes(status)) die('狀態只能是 ' + STATUSES.join('／'));
    console.log(line(store.update(id, { status, ...(waitingFor != null && { waitingFor }) }, { note: note || { todo: '又要你出手了', waiting: '等外面回覆', done: '結束了', dropped: '不辦了' }[status] })));
  } else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
} catch (e) { die(e.message); }
