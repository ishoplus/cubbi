// ── 內建外掛：排程牆 ─────────────────────────────────────────────────────────────
//
// 辦公室右牆一張週曆：接下來排定的工作都在上面——Cubbi 自己的排程（routines.js：每天提案、每晚跑測試…），
// 加上其他外掛接上來的來源（例如營收部的發文排程）。能拍板的（腳本、成品待核准）直接在牆上准或不要。
//
// 來源介面（外掛在 mount 時用 ctx.addScheduleSource 接上來）：
//   { name, list: async (days) → [item], decide?: async (id, decision: ok|no, note) → 訊息 }
//   item：{ id, when（ISO）, title, channel?, status, tentative?, text?, file?, url?,
//           color?（色籤顏色）, label?（色籤上的短字）, decide?（能不能在牆上准）, decideOk?（准的按鈕字） }
//   GET  /api/space/schedule?days=14      { today, days: [YYYY-MM-DD], items }（前兩天的也帶，看得到剛做完的）
//   POST /api/space/schedule/decide       { source, id, decision, note }
import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { t, tr, SERVER_LANG } from '../i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localDay = (t) => new Date(t).toLocaleDateString('sv-SE');

// routines：排程（occurrences）；sources：外掛接上來的來源（同一個陣列，server.js 給）
export function schedulePlugin({ routines, sources }) {
  async function load(days = 14) {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const from = today0.getTime() - 2 * 86400000;
    const items = routines.occurrences(from, days + 2).map(i => ({ ...i, label: t(SERVER_LANG(), '排程'), color: '#6b4fbb' }));
    for (const s of sources) {
      try { for (const it of await s.list(days)) items.push({ ...it, sourceName: s.name }); }
      catch (e) { items.push({ id: `${s.name}:error`, sourceName: s.name, when: new Date().toISOString(), title: t(SERVER_LANG(), '{name} 讀不到：{msg}', { name: s.name, msg: e.key ? t(SERVER_LANG(), e.key, e.vars) : t(SERVER_LANG(), e.message) }).slice(0, 120), status: 'failed', label: s.name, color: '#c91a09' }); }
    }
    items.sort((a, b) => String(a.when).localeCompare(String(b.when)));
    const dayList = Array.from({ length: days + 2 }, (_, k) => localDay(from + k * 86400000));
    return { today: localDay(Date.now()), days: dayList, items };
  }

  return {
    name: 'schedule',
    webDir: join(__dirname, '..', 'public', 'space'),
    mount({ app, requireAuth }) {
      const r = Router();
      r.get('/', (req, res) => load(Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 14))).then(c => res.json(c), e => res.status(500).json({ error: e.message })));
      r.post('/decide', async (req, res) => {
        const { source, id, decision, note = '' } = req.body || {};
        if (!['ok', 'no'].includes(decision)) return res.status(400).json({ error: tr(req, '格式不對') });
        const s = sources.find(x => x.name === source);
        if (!s?.decide) return res.status(404).json({ error: tr(req, '這個來源不能在牆上拍板') });
        try {
          const msg = await s.decide(String(id), decision, String(note).slice(0, 500));
          res.json({ ok: true, msg, cal: await load() });
        } catch (e) { res.status(400).json({ error: e.message }); }
      });
      app.use('/api/space/schedule', requireAuth, r);
    },
  };
}
