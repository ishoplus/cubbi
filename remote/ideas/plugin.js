// ── 內建外掛：提案部（白板＋每天提案＋收件箱）───────────────────────────────────────
//
// 辦公室左牆一塊看板：Backlog（還沒判斷，含「改」）→ Todo（要）→ 進行中 → Done；「不要」的拿掉。
// 開工＝派人：在那個專案開一段新對話，開工細節當第一句話（git 專案開分支做，做完在收件箱交件）。
// 還沒判斷的新提案也進收件箱（kind: idea），在那裡就能回要／不要／改。
// 產提案要跑 Claude 5–15 分鐘、花額度，所以預設不自動跑：白板上按「現在提一批」或打開「每天提案」（寫進排程）。
//   GET  /api/space/ideas                  四欄＋狀態（在跑嗎、每天幾點）
//   POST /api/space/ideas/:id/verdict      { verdict: 要|不要|改, note }
//   POST /api/space/ideas/:id/stage        { stage: doing|done }   doing 會派人
//   POST /api/space/ideas/run              現在提一批（背景跑）
//   POST /api/space/ideas/daily            { on, at }   每天提案（排程 id: ideas）
import { Router } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nameFor } from '../names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DONE_MAX = 6;   // Done 欄只留最近幾張
const INBOX_DAYS = 7;

// 開工時交給員工的第一句話：提案內容＋開工細節＋規矩（只做最小版本、不上線、做完一輪停下來回報）
export function brief(p, cwd, isNew) {
  const plan = p.plan || {};
  const lines = [`提案部的提案 ${p.id} 開工了，交給你做：「${p.title}」`, '', p.hook];
  if (p.see) lines.push(`做完會看到：${p.see}`);
  lines.push(`為什麼現在：${p.why_now}`, '', `## 最小版本（約 ${p.days} 天）`);
  if (Array.isArray(plan.do)) lines.push('做：', ...plan.do.map(x => `- ${x}`));
  if (Array.isArray(plan.not_do) && plan.not_do.length) lines.push('不做：', ...plan.not_do.map(x => `- ${x}`));
  if (plan.first_step) lines.push(`第一步：${plan.first_step}`);
  if (p.mvp) lines.push(p.mvp);
  lines.push('', `風險：${p.risk}`, '', '## 規矩');
  if (isNew) lines.push(`- 這是新項目，${cwd} 是剛建的空資料夾：先 git init，再照上面做。`);
  else lines.push('- 先讀這個專案的 CLAUDE.md／README 和相關原始碼，確認現況；跟提案寫的不一樣就照現況調整，回報時說明。');
  lines.push(
    '- 只做最小版本。不要 push、不要部署、不要發布或對外發文；做到在本機看得到、測得過為止，可以 commit。',
    '- 做完一輪就停下來，用幾句白話回報：做了什麼、怎麼看到成果、還差什麼。用戶會在辦公室的提案白板或收件箱驗收。',
    '- 卡住或要用戶決定的事，直接問。');
  return lines.join('\n');
}

// lab：ideas/lab.js；routines：排程（打開每天提案用）；newProjectRoot：新項目開在哪
export function ideasPlugin({ lab, routines, saveRoutines, newProjectRoot }) {
  // 新項目的資料夾：提案裡寫了 <newProjectRoot>/xxx 就用那個，沒有就 <newProjectRoot>/idea-<id>
  function newProjectDir(p) {
    const esc = newProjectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(esc + '/([A-Za-z0-9._-]+)').exec(JSON.stringify(p));
    return join(newProjectRoot, m ? m[1] : `idea-${p.id}`);
  }
  const daily = () => routines().find(r => r.id === 'ideas' && r.action?.type === 'ideas') || null;

  function board(statusOf = () => 'idle') {
    const cols = { backlog: [], todo: [], doing: [], done: [] };
    for (const p of lab.history()) {
      const v = p.verdict, st = p.stageRec;
      const card = {
        id: p.id, kind: p.kind, project: p.project, dir: p.dir || '', title: p.title, hook: p.hook,
        see: p.see || '', why_now: p.why_now, days: p.days, risk: p.risk, session: p.session || null,
        verdict: v?.verdict || null, note: v?.note || '', since: st?.at || v?.at || p.at,
      };
      if (st?.session) card.claim = { sid: st.session, cwd: st.cwd, name: nameFor(st.session) || '', status: st.stage === 'done' ? 'done' : statusOf(st.session) };
      if (v?.verdict === '不要') continue;
      if (v?.verdict === '要') cols[st?.stage === 'done' ? 'done' : st?.stage === 'doing' ? 'doing' : 'todo'].push(card);
      else cols.backlog.push(card);
    }
    cols.done = cols.done.sort((a, b) => String(a.since).localeCompare(String(b.since))).slice(-DONE_MAX);
    const d = daily();
    return { cols, pending: cols.backlog.length, cwd: lab.stateDir, running: lab.isRunning(), daily: d ? { on: d.enabled !== false, at: d.at } : { on: false, at: '09:00' } };
  }

  // 收件箱：還沒判斷的新提案（最近 7 天）
  function inboxItems() {
    const since = Date.now() - INBOX_DAYS * 86400000;
    return lab.history().filter(p => !p.verdict && Date.parse(p.at) > since).map(p => ({
      key: `idea:${p.id}`, kind: 'idea', at: Date.parse(p.at), ideaId: p.id, name: p.title, title: p.hook,
      idea: { id: p.id, kind: p.kind, project: p.project, title: p.title, hook: p.hook, see: p.see || '', why_now: p.why_now, days: p.days, risk: p.risk },
    }));
  }

  return {
    name: 'ideas',
    webDir: join(__dirname, '..', 'public', 'space'),
    mount({ app, requireAuth, startWork, statusOf, inbox }) {
      inbox?.addProvider(async () => inboxItems());
      const r = Router();
      const ok = (res, msg) => { inbox?.changed(); res.json({ ok: true, msg, board: board(statusOf) }); };
      r.get('/', (req, res) => res.json(board(statusOf)));
      r.post('/:id/verdict', (req, res) => {
        const { id } = req.params, { verdict, note = '' } = req.body || {};
        if (!/^\d{4}-[a-z]+$/.test(id)) return res.status(400).json({ error: '格式不對' });
        try { lab.verdict(id, verdict, note); ok(res); } catch (e) { res.status(400).json({ error: e.message }); }
      });
      r.post('/:id/stage', async (req, res) => {
        const { id } = req.params, { stage } = req.body || {};
        if (!/^\d{4}-[a-z]+$/.test(id) || !['doing', 'done'].includes(stage)) return res.status(400).json({ error: '格式不對' });
        try {
          if (stage === 'done') { lab.stage(id, 'done'); return ok(res); }
          // 開工：先確定是「要」的，再派人，最後記下是誰
          const p = lab.find(id);
          if (!p) return res.status(404).json({ error: '找不到提案 ' + id });
          if (p.verdict?.verdict !== '要') return res.status(400).json({ error: id + ' 還沒判「要」' });
          const isNew = !p.dir;
          const cwd = p.dir || newProjectDir(p);
          if (isNew && !existsSync(cwd)) mkdirSync(cwd, { recursive: true });
          const prompt = brief(p, cwd, isNew);
          const sid = await startWork({ cwd, prompt, isNew });
          nameFor(sid, prompt);   // 先排進取名，名牌和卡片上的名字早點出來
          lab.stage(id, 'doing', { session: sid, cwd });
          ok(res);
        } catch (e) { res.status(409).json({ error: e.message }); }
      });
      r.post('/run', (req, res) => {
        if (lab.isRunning()) return res.status(409).json({ error: '正在提，等它交' });
        lab.run().then(() => inbox?.changed(), () => {});
        res.json({ ok: true, msg: '提案部開工了，5–15 分鐘後交（會進收件箱）', board: board(statusOf) });
      });
      r.post('/daily', (req, res) => {
        const { on, at = '09:00' } = req.body || {};
        if (!/^\d{1,2}:\d{2}$/.test(at)) return res.status(400).json({ error: '時間寫成 09:00 這樣' });
        const rest = routines().filter(x => x.id !== 'ideas');
        saveRoutines(on ? rest.concat([{ id: 'ideas', name: '每天提案', at, days: 'daily', enabled: true, action: { type: 'ideas' } }]) : rest);
        ok(res, on ? `每天 ${at} 提一批` : '不再每天提案');
      });
      app.use('/api/space/ideas', requireAuth, r);
    },
  };
}
