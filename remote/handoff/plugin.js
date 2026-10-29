// ── 內建外掛：等你辦（收件箱裡要你本人出手的事）─────────────────────────────────────
//
// 資料是 store.js 那一份（代理人用 cli.mjs 寫進來）。status＝todo 的進收件箱（kind: handoff），
// 辦公室主管室後牆有一塊軟木板（前端 public/space/plugins/handoff.js）。卡片上看得到要做什麼、怎麼做；問問題、回報都是往原本那段對話送一句話（不在了就 --resume 接起來，
// 連對話都沒有就在原資料夾開一段新的），代理人看了再決定下一步（改成等審核、結束、或再交代一件）。
//   GET  /api/space/handoff              還沒結束的＋最近 7 天結束的
//   POST /api/space/handoff/:id/ask      { text }               問一下：送進那段對話
//   POST /api/space/handoff/:id/report   { ok: true|false, note } 辦好了／卡住了（被退、看不懂、做不到）
//   POST /api/space/handoff/:id/drop     不辦了
import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHandoff } from './store.js';
import { tr, errText, SERVER_LANG } from '../i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECENT_DAYS = 7;
const CLI = new URL('./cli.mjs', import.meta.url).pathname;

// 送進對話的那句話：講清楚是哪一件、老闆說了什麼、代理人接著該怎麼更新狀態
export function message(h, kind, text, lang = 'zh') {
  const cli = `node ${CLI}`;
  if (lang === 'en') {
    const head = { ask: 'has a question about', ok: 'says this is done:', problem: 'got stuck on' }[kind];
    return [`[Handoff ${h.id}] The user ${head} "${h.title}"`, text ? `They wrote: ${text}` : '', '',
      kind === 'ask' ? `Answer in plain words. If the steps need fixing, update them: ${cli} update ${h.id} '{"steps":[...]}'`
        : `Pick up from here. Waiting on an outside review → ${cli} set ${h.id} waiting --for "who"; all finished → ${cli} done ${h.id}; the user needs to do something else → ${cli} update ${h.id} '{...}' then ${cli} set ${h.id} todo.`,
    ].filter((l, i) => l || i === 2).join('\n');
  }
  const head = { ask: '問了一個問題', ok: '回報辦好了', problem: '回報卡住了' }[kind];
  return [`【等你辦 ${h.id}】老闆對「${h.title}」${head}`, text ? `老闆說：${text}` : '', '',
    kind === 'ask' ? `用白話回答。步驟要修就順手改：${cli} update ${h.id} '{"steps":[...]}'`
      : `請接著做。要等外面審核 → ${cli} set ${h.id} waiting --for "在等誰"；全部結束 → ${cli} done ${h.id}；還要老闆再做別的 → 先 ${cli} update ${h.id} '{...}' 改步驟，再 ${cli} set ${h.id} todo。`,
  ].filter((l, i) => l || i === 2).join('\n');
}

export function handoffPlugin({ store = createHandoff() } = {}) {
  const visible = () => {
    const since = Date.now() - RECENT_DAYS * 86400000;
    return store.list().filter(h => ['todo', 'waiting'].includes(h.status) || Date.parse(h.updatedAt) > since);
  };
  const inboxItems = () => store.list().filter(h => h.status === 'todo').map(h => ({
    key: `handoff:${h.id}:${h.rev || 1}`, kind: 'handoff', at: Date.parse(h.updatedAt) || Date.now(),
    name: h.title, title: h.title, sid: h.sid || null, cwd: h.cwd || '', handoff: h,
  }));

  return {
    name: 'handoff',
    webDir: join(__dirname, '..', 'public', 'space'),   // 辦公室裡那塊板子：public/space/plugins/handoff.js
    mount({ app, requireAuth, inbox, sendToSession, startWork }) {
      inbox?.addProvider(async () => inboxItems());
      // 交給那段對話；沒有對話就在原資料夾開新的，記下 sid 之後都送那裡
      async function tell(h, kind, text) {
        const content = message(h, kind, text, SERVER_LANG());
        if (h.sid && h.cwd) { await sendToSession({ sid: h.sid, cwd: h.cwd, content }); return { sid: h.sid, cwd: h.cwd }; }
        if (!h.cwd) return null;
        const sid = await startWork({ cwd: h.cwd, prompt: content, worktree: false });
        store.update(h.id, { sid });
        return { sid, cwd: h.cwd };
      }
      const find = (req, res) => {
        try { const h = store.get(req.params.id); if (h) return h; res.status(404).json({ error: tr(req, '找不到 {id}', { id: req.params.id }) }); }
        catch (e) { res.status(400).json({ error: errText(req, e) }); }
        return null;
      };
      const r = Router();
      r.get('/', (req, res) => res.json({ items: visible() }));
      r.post('/:id/ask', async (req, res) => {
        const h = find(req, res); if (!h) return;
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: tr(req, '要寫你想問什麼') });
        try {
          const to = await tell(h, 'ask', text);
          if (!to) return res.status(409).json({ error: tr(req, '這件沒有記是哪段對話交代的，問不了') });
          store.update(h.id, {}, { who: 'you', note: text });
          res.json({ ok: true, ...to });
        } catch (e) { res.status(409).json({ error: errText(req, e) }); }
      });
      r.post('/:id/report', async (req, res) => {
        const h = find(req, res); if (!h) return;
        const ok = req.body?.ok !== false, note = String(req.body?.note || '').trim();
        if (!ok && !note) return res.status(400).json({ error: tr(req, '寫一下卡在哪（被退的理由、看不懂哪一步）') });
        try {
          const to = await tell(h, ok ? 'ok' : 'problem', note);
          // 辦好了：先換成「等代理人接手」，它看完會改成等審核或結束；沒有對話可交就直接結束
          const patch = ok ? (to ? { status: 'waiting', waitingFor: SERVER_LANG() === 'en' ? 'agent picking up' : '代理人接手中' } : { status: 'done' }) : {};
          store.update(h.id, patch, { who: 'you', note: note || (ok ? '辦好了' : '') });
          inbox?.changed();
          res.json({ ok: true, ...(to || {}) });
        } catch (e) { res.status(409).json({ error: errText(req, e) }); }
      });
      r.post('/:id/drop', (req, res) => {
        const h = find(req, res); if (!h) return;
        store.update(h.id, { status: 'dropped' }, { who: 'you', note: String(req.body?.note || '不辦了') });
        inbox?.changed();
        res.json({ ok: true });
      });
      app.use('/api/space/handoff', requireAuth, r);
      // 代理人用指令列改了檔案，收件箱要知道：每 20 秒看一眼有沒有變
      let prev = '';
      setInterval(() => {
        const key = store.list().map(h => h.id + h.updatedAt).join();
        if (key !== prev) { if (prev) inbox?.changed(); prev = key; }
      }, 20000).unref();
    },
  };
}
