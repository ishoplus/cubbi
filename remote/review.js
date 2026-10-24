// ── remote 在收件箱上加的東西 ＋ 分支交付的 API ────────────────────────────────────
//
// 收件箱本身在 Cubbi 核心（server/inbox.js：舉手、交件、卡住、做完了、推播、收下／看過）。
// remote 用 addProvider 加它才有的：
//   ask     能直接回答的提問（帶完整的權限請求，卡片上就能允許／拒絕／選答案）
//   review  分支有新的 commit／改動（交件），附 diff 統計與驗收結果
//   ended   代理人意外結束（lost、逾時、異常退出），留 24 小時
//   task    任務那邊待授權／待驗收／失敗／中斷
// 分支交付的 API（/api/worktrees/:sid/…）也在這：看改動、合併、打回、丟棄、跑驗收、改完成定義。
import { Router } from 'express';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, basename } from 'path';
import {
  getWorktree, listWorktrees, updateWorktree, delivery, hasChanges, diffText, mergeWorktree, discardWorktree,
} from './worktree.js';
import { projectChecks, setProjectChecks, runChecks, evidenceSummary } from './checks.js';
import { nameFor } from './names.js';
import { dataFile } from './paths.js';
import { t, tr, errText, langOf, SERVER_LANG } from './i18n.js';

const ENDED_FILE = process.env.INBOX_ENDED_FILE || dataFile('inbox-ended.json');
const ENDED_KEEP_MS = 24 * 3600000;
const BAD_ENDINGS = /^(lost|timeout|spawn-error|exit-[1-9]|no-exit)/;

export function createReview({ core, sessions, attentionTasks = () => [], sendToSession, log = console }) {
  let ended = [];
  try { ended = JSON.parse(readFileSync(ENDED_FILE, 'utf8')); } catch {}
  const saveEnded = () => {
    ended = ended.filter(e => Date.now() - e.at < ENDED_KEEP_MS);
    try { mkdirSync(dirname(ENDED_FILE), { recursive: true }); writeFileSync(ENDED_FILE + '.tmp', JSON.stringify(ended)); renameSync(ENDED_FILE + '.tmp', ENDED_FILE); } catch (e) { log.error?.('[收件箱] 存檔失敗', e.message); }
  };

  // 交付狀態要跑 git，存起來；回合結束或有人按了什麼才重算
  const deliveries = new Map();   // sid -> { d, at }
  async function refreshDelivery(sid) {
    const w = getWorktree(sid);
    if (!w || w.status === 'discarded') { deliveries.delete(sid); return null; }
    try {
      const d = await delivery(w);
      deliveries.set(sid, { d, at: Date.now() });
      // 有新東西：狀態回到待審、自動跑驗收（同一個 head 只跑一次）。
      // Codex 在沙箱裡做（不能出網、只能寫工作目錄），驗收卻是直接在本機跑它寫的測試，
      // 自動跑等於幫它開了沙箱的後門，所以它的分支要你按「跑驗收」才跑
      if (hasChanges(d) && d.head !== w.mergedHead && !d.dirty.length && w.evidence?.head !== d.head && w.agent !== 'codex') startChecks(w, d.head);
      if (hasChanges(d) && w.status === 'merged' && d.head !== w.mergedHead) updateWorktree(sid, { status: 'working' });
      return d;
    } catch (e) { log.error?.(`[收件箱] ${sid.slice(0, 8)} 交付狀態讀不到：${e.message}`); return null; }
  }
  function startChecks(w, head) {
    if (!projectChecks(w.repo).checks.length) return;
    runChecks(w, { head, onUpdate: (ev) => { updateWorktree(w.sid, { evidence: { ...ev, results: [...ev.results] } }); if (!ev.running) core.changed(); } });
  }

  const nameOf = (sid, prompt) => (sid && nameFor(sid, prompt)) || '';
  const liveBySid = (sid) => [...sessions.values()].find(s => s.sid === sid && !s.closed);

  async function items() {
    const out = [];
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.closed) continue;
      const who = { id: s.sid || s.runId, sid: s.sid, runId: s.runId, cwd: s.cwd, name: nameOf(s.sid, s.firstPrompt), title: (s.firstPrompt || '').slice(0, 80), agent: s.driver === 'codex' ? 'codex' : undefined, live: true };
      for (const ask of s.pending.values()) out.push({ key: `ask:${ask.requestId}`, kind: 'ask', at: s.lastActivity, ...who, ask, answerable: true });
    }
    for (const w of listWorktrees()) {
      if (w.status === 'discarded') continue;
      let c = deliveries.get(w.sid);
      if (!c || now - c.at > 30000) { await refreshDelivery(w.sid); c = deliveries.get(w.sid); }
      const d = c?.d;
      if (!hasChanges(d) || d.head === w.mergedHead) continue;
      const live = liveBySid(w.sid);
      if (live?.turnActive) continue;   // 還在做，等這一輪結束再交
      const ev = getWorktree(w.sid).evidence;
      out.push({
        key: `review:${w.sid}:${d.head}:${d.dirty.length}`, kind: 'review', at: w.updatedAt, supersedes: ['done', 'deliv'],
        id: w.sid, sid: w.sid, cwd: w.work, name: nameOf(w.sid, w.title), title: w.title.slice(0, 80),
        repo: basename(w.repo), branch: w.branch, base: w.base,
        commits: d.commits.length, dirty: d.dirty.length, files: d.files.length, add: d.add, del: d.del,
        evidence: evidenceSummary(ev && ev.head === d.head ? ev : null), checks: (ev && ev.head === d.head ? ev.results : []).map(r => ({ name: r.name, ok: r.ok })),
        live: !!live,
      });
    }
    for (const e of ended) if (now - e.at < ENDED_KEEP_MS) out.push({ ...e, id: e.sid, kind: 'ended', key: `ended:${e.runId}`, supersedes: ['done'] });
    for (const t of attentionTasks()) out.push({ key: `task:${t.id}:${t.status}:${t.updatedAt}`, kind: 'task', at: Date.parse(t.updatedAt) || now, taskId: t.id, name: t.name, status: t.status, cwd: t.cwd });
    return out;
  }
  core.addProvider(items);

  // server.js 呼叫：狀態變了／回合結束／對話結束
  function onSession(sess) {
    if (sess.closed && sess.reason && BAD_ENDINGS.test(sess.reason) && !ended.some(e => e.runId === sess.runId)) {
      ended.push({ runId: sess.runId, sid: sess.sid, cwd: sess.cwd, name: nameOf(sess.sid, sess.firstPrompt), title: (sess.firstPrompt || '').slice(0, 80),
        reason: sess.reason, reasonText: sess.reason === 'lost' ? t(SERVER_LANG(), '代理人進程不見了（可以接著送訊息，會接續同一段）') : sess.reason === 'timeout' ? t(SERVER_LANG(), '太久沒動靜，逾時收掉') : t(SERVER_LANG(), '異常結束（{reason}）', { reason: sess.reason }), at: Date.now() });
      saveEnded();
    }
    core.changed();
  }
  function onTurnEnd(sess) {
    if (sess.sid && getWorktree(sess.sid)) refreshDelivery(sess.sid).then(() => core.changed());
    else core.changed();
  }

  // ── 分支交付的路由（/api/worktrees）──
  const r = Router();
  const wt = (req, res) => {
    const w = getWorktree(req.params.sid);
    if (!w || w.status === 'discarded') { res.status(404).json({ error: tr(req, '這段對話沒有分支') }); return null; }
    return w;
  };
  r.get('/:sid', async (req, res) => {
    // 沒開分支的對話很常見（每次打開對話都會問）：回 200＋worktree:null，不讓瀏覽器 console 一直出現 404
    const g = getWorktree(req.params.sid);
    if (!g || g.status === 'discarded') return res.json({ worktree: null });
    const w = wt(req, res); if (!w) return;
    const d = await refreshDelivery(w.sid);
    const ev = getWorktree(w.sid).evidence;
    res.json({ worktree: { ...w, evidence: undefined }, delivery: d, evidence: ev, summary: evidenceSummary(ev && d && ev.head === d.head ? ev : null), ...projectChecks(w.repo) });
  });
  r.get('/:sid/diff', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    try { res.type('text/plain; charset=utf-8').send(await diffText(w, req.query.file || null, langOf(req))); }
    catch (e) { res.status(500).json({ error: errText(req, e) }); }
  });
  r.post('/:sid/merge', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    if (liveBySid(w.sid)?.turnActive) return res.status(409).json({ error: tr(req, '還在做，等這一輪結束再合併') });
    try { const m = await mergeWorktree(w, SERVER_LANG()); await refreshDelivery(w.sid); core.changed(); res.json({ ok: true, ...m }); }
    catch (e) { res.status(409).json({ error: errText(req, e), conflict: !!e.conflict }); }
  });
  r.post('/:sid/discard', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    if (liveBySid(w.sid)?.turnActive) return res.status(409).json({ error: tr(req, '還在做，先停下來再丟棄') });
    try { await discardWorktree(w); deliveries.delete(w.sid); core.changed(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: errText(req, e) }); }
  });
  r.post('/:sid/reject', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const fb = String(req.body?.feedback || '').trim();
    if (!fb) return res.status(400).json({ error: tr(req, '寫一下要改什麼') });
    const content = SERVER_LANG() === 'en'
      ? `The user reviewed the changes on branch ${w.branch} and sent them back for more work:\n\n${fb}\n\nWhen you're done, commit, then stop and report back in a few sentences.`
      : `用戶看了分支 ${w.branch} 的改動，打回來要你再改：\n\n${fb}\n\n改完 commit，再停下來用幾句話回報。`;
    try { await sendToSession({ sid: w.sid, cwd: w.work, content }); updateWorktree(w.sid, { status: 'working', rejectedAt: Date.now() }); core.changed(); res.json({ ok: true }); }
    catch (e) { res.status(409).json({ error: errText(req, e) }); }
  });
  r.post('/:sid/checks/run', async (req, res) => {
    const w = wt(req, res); if (!w) return;
    const d = await refreshDelivery(w.sid);
    if (!projectChecks(w.repo).checks.length) return res.status(400).json({ error: tr(req, '這個專案還沒設驗收指令') });
    updateWorktree(w.sid, { evidence: null });
    startChecks(getWorktree(w.sid), d?.head);
    res.json({ ok: true });
  });
  r.put('/:sid/checks', (req, res) => {
    const w = wt(req, res); if (!w) return;
    try { res.json({ checks: setProjectChecks(w.repo, req.body?.checks) }); }
    catch (e) { res.status(400).json({ error: errText(req, e) }); }
  });

  return { router: r, items, onSession, onTurnEnd, changed: () => core.changed(), refreshDelivery };
}
