// ── 提案部：每天看你手上的專案，交一批提案，你只回要／不要／改 ─────────────────────
//
// 從 idea-lab（xitto-station 外掛）通用化來的，存檔格式完全一樣，兩邊可以共用同一個資料夾：
//   proposals.jsonl  每份提案一行（id 像 1024-a）
//   verdicts.jsonl   你的判斷（要／不要／改＋備註），同一個 id 以最後一次為準
//   stages.jsonl     判「要」之後的進度：doing（記下派了哪段對話）／done
//   batches/         每批一份 markdown，給人看
// 收集近況、存檔是確定性的；只有「提什麼」交給 claude -p（唯讀工具，不改任何檔）。
// 推播不在這裡：新提案會出現在收件箱（kind: idea），由收件箱推。
//
// 設定檔 ideas：
//   stateDir   存哪（預設 ~/.cubbi/ideas；跟 idea-lab 共用就填 ~/.xitto/idea-lab）
//   roots      看哪些資料夾底下的專案（預設 WORK_ROOT）
//   values     你的品味與價值觀（一段文字），寫進提案標準
//   valuesFiles  也可以指定幾個檔，內容一併給它看（例如記憶檔）
//   model      預設 opus；lang 跟介面一樣（zh／en）
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn, execFileSync } from 'child_process';
import { CUBBI_HOME } from '../paths.js';
import { claudePath, claudeEnv } from '../shared.js';

const ACTIVE_DAYS = 14;     // 這段時間內有 commit 才算「進行中」
const HISTORY_MAX = 150;    // 給模型看的歷來提案上限（去重用）

export const LENSES = {
  zh: [
    { name: '用戶', hint: '站在真實用戶的位置：第一次打開會卡在哪、第三天為什麼不回來、什麼會讓他想分享' },
    { name: '變現', hint: '誰會付錢、為什麼現在付：算得出第一筆收入的才提' },
    { name: '技術槓桿', hint: '近期新模型、新 API、新工具讓什麼「上個月還做不到」的事變便宜了' },
    { name: '跨專案組合', hint: '把一個專案已經做好的零件搬到另一個專案，或拼成新東西' },
    { name: '冷宮復活', hint: '看停工最久但當初有亮點的專案：缺哪一塊就能上線或重新被用' },
    { name: '減法', hint: '砍掉、合併、簡化：哪個功能沒人用、哪兩個專案其實是同一件事、哪個流程可以少一步' },
  ],
  en: [
    { name: 'User', hint: 'Stand in a real user\'s shoes: where do they get stuck on day one, why don\'t they come back on day three, what makes them share' },
    { name: 'Revenue', hint: 'Who would pay and why now: only propose things where the first payment is plausible' },
    { name: 'Leverage', hint: 'What did a recent model, API or tool make cheap that wasn\'t possible last month' },
    { name: 'Combine', hint: 'Reuse a part already built in one project for another, or combine parts into something new' },
    { name: 'Revive', hint: 'Look at the longest-idle project that once had a spark: what single piece would get it shipped or used again' },
    { name: 'Subtract', hint: 'Cut, merge, simplify: unused features, two projects that are really one, a step that can go' },
  ],
};

export function createLab({ stateDir = join(CUBBI_HOME, 'ideas'), roots = [], values = '', valuesFiles = [], model = 'opus', lang = 'zh', log = console } = {}) {
  const F = {
    proposals: join(stateDir, 'proposals.jsonl'), verdicts: join(stateDir, 'verdicts.jsonl'),
    stages: join(stateDir, 'stages.jsonl'), batches: join(stateDir, 'batches'),
  };
  const zh = lang !== 'en';
  const lenses = LENSES[zh ? 'zh' : 'en'];
  const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  const readJsonl = (f) => readText(f).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const append = (f, obj) => { mkdirSync(stateDir, { recursive: true }); appendFileSync(f, JSON.stringify(obj) + '\n'); };
  const localDay = (d = new Date()) => d.toLocaleDateString('sv-SE');   // 這台電腦的日期 YYYY-MM-DD
  const lensOfDay = (d = new Date()) => lenses[Math.floor(Date.parse(localDay(d)) / 864e5) % lenses.length];

  const proposals = () => readJsonl(F.proposals);
  function history() {
    const verdicts = new Map(readJsonl(F.verdicts).map(v => [v.id, v]));
    const stages = new Map(readJsonl(F.stages).map(s => [s.id, s]));
    return proposals().map(p => ({ ...p, verdict: verdicts.get(p.id) || null, stageRec: stages.get(p.id) || null, stage: stages.get(p.id)?.stage || null }));
  }
  const find = (id) => history().find(p => p.id === id);

  const VERDICTS = { '要': '要', yes: '要', '不要': '不要', no: '不要', '改': '改', tweak: '改' };
  function verdict(id, v, note = '') {
    const value = VERDICTS[v];
    if (!value) throw new Error(zh ? '判斷只能是 要／不要／改' : 'Verdict must be yes / no / tweak');
    if (!find(id)) throw new Error((zh ? '找不到提案 ' : 'No proposal ') + id);
    append(F.verdicts, { id, verdict: value, note: String(note).slice(0, 500), at: new Date().toISOString() });
    return value;
  }
  function stage(id, value, { session, cwd } = {}) {
    const p = find(id);
    if (!p) throw new Error((zh ? '找不到提案 ' : 'No proposal ') + id);
    if (p.verdict?.verdict !== '要') throw new Error(zh ? `${id} 還沒判「要」` : `${id} isn't a yes yet`);
    const rec = { id, stage: value, at: new Date().toISOString() };
    if (session) Object.assign(rec, { session, cwd: cwd || p.dir || '' });
    append(F.stages, rec);
  }

  // ── 收集近況：roots 底下的 git 專案，近期有 commit 的列 commit，停工的列最後一次 ──
  function gitActivity() {
    const active = [], idle = [];
    const dirs = [];
    for (const root of roots) {
      if (existsSync(join(root, '.git'))) dirs.push(root);
      let names = []; try { names = readdirSync(root); } catch { continue; }
      for (const n of names) if (!n.startsWith('.') && existsSync(join(root, n, '.git'))) dirs.push(join(root, n));
    }
    for (const dir of dirs.slice(0, 80)) {
      const git = (args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
      const recent = git(['log', `--since=${ACTIVE_DAYS}.days`, '--format=%ad %s', '--date=short', '-n', '12']);
      if (recent) active.push(`### ${dir}\n${recent}`);
      else { const last = git(['log', '-1', '--format=%ad %s', '--date=short']); if (last) idle.push(`- ${dir}（${zh ? '最後' : 'last'}：${last}）`); }
    }
    return { active: active.join('\n\n'), idle: idle.join('\n') };
  }
  const label = (p) => p.kind === 'project' ? (zh ? '新項目' : 'New project') : `${zh ? '功能' : 'Feature'}·${p.project}`;

  function prompt({ lens, today }) {
    const act = gitActivity();
    const hist = history().slice(-HISTORY_MAX).map(p =>
      `- ${p.id}［${label(p)}］${p.title}：${p.hook}｜${p.verdict ? p.verdict.verdict + (p.verdict.note ? '（' + p.verdict.note + '）' : '') : (zh ? '未回' : 'no answer')}${p.stage === 'done' ? (zh ? '，已做完' : ', done') : p.stage === 'doing' ? (zh ? '，進行中' : ', in progress') : ''}`).join('\n');
    const taste = [values, ...valuesFiles.map(f => readText(f).replace(/^---[\s\S]*?\n---\n/, '').trim()).filter(Boolean)].filter(Boolean).join('\n\n');
    const lines = zh ? [
      '你是用戶的「提案部」。用戶同時在做好幾個軟體專案，你的工作：交一批提案，讓他只需要回「要／不要／改」。',
      '', '這一批固定 3 份：2 份「新功能」給現有專案（優先挑進行中的，也可以是停工的）、1 份「新項目」（目前沒有的東西，可以拼裝現有零件）。',
      `今天的視角：「${lens.name}」—— ${lens.hint}。至少 2 份要明顯從這個視角出發。`,
      '', '標準（寧缺勿濫，達不到就少交，但要在 skipped 說明為什麼）：',
      '- 具體到能直接開工：說得出第一天要改哪個檔案或建什麼', '- 最小可做版本在 1–5 天內', '- 有「為什麼是現在」：最近的 commit、新出的工具、已經做好的零件',
      '- 不重複歷來提案；被「不要」的方向別換個名字再提；被「改」的照備註改了再交',
      '', '開工前先讀：對你挑中的專案，用 Read／Glob／Grep 看它的 CLAUDE.md、README、主要原始碼，確認你提的東西還沒做、做得出來。需要查外部資料可以用 WebSearch／WebFetch。不要修改任何檔案。',
      '', `今天：${today}`, '', '## 品味與價值觀', taste || '（沒寫，照一般好產品的標準）',
      '', `## 近 ${ACTIVE_DAYS} 天有動的專案（commit）`, act.active || '（無）', '', '## 停工中的專案', act.idle || '（無）',
      '', '## 歷來提案與判斷', hist || '（還沒有，這是第一批）',
      '', '寫法（他在手機上看，一份提案要 10 秒看懂）：前面幾個欄位白話、短句、講結果，不放檔名、路徑、函式名；技術細節只放在 plan 裡，那是開工時給代理人看的。',
      '', '最後只輸出一個 JSON 物件，不要任何其他文字（繁體中文）：',
      '{"proposals":[{"kind":"feature 或 project","project":"專案名（新項目填一個暫名）","dir":"專案路徑（新項目留空）","title":"15 字以內","hook":"30 字以內：做完之後誰得到什麼","see":"40 字以內：做完打開會看到什麼","why_now":"40 字以內","days":1到5的數字,"risk":"30 字以內","plan":{"do":["要做的事"],"not_do":["不做的事"],"first_step":"第一步改哪個檔案"}}],"skipped":"60 字以內，少交的原因（交滿就留空）"}',
    ] : [
      'You are the user\'s "ideas department". The user works on several software projects at once. Your job: hand in a batch of proposals so all they have to answer is yes / no / tweak.',
      '', 'Exactly 3 per batch: 2 "features" for existing projects (prefer active ones, idle ones are fine), 1 "new project" (something that doesn\'t exist yet; reusing existing parts is fine).',
      `Today's lens: "${lens.name}" — ${lens.hint}. At least 2 proposals should clearly come from this lens.`,
      '', 'Bar (fewer is better than weak; explain in skipped if you hand in fewer):', '- Concrete enough to start: name the first file to change or thing to create', '- Smallest useful version fits in 1–5 days',
      '- Has a "why now": a recent commit, a new tool, a part that already exists', '- No repeats; don\'t rename a rejected idea; tweak requests should be redone per the note',
      '', 'Before proposing, read the project: use Read / Glob / Grep on its CLAUDE.md, README and main source to confirm it isn\'t done yet and is feasible. You may use WebSearch / WebFetch. Do not modify any file.',
      '', `Today: ${today}`, '', '## Taste and values', taste || '(none given; use the bar of a good product)',
      '', `## Projects with commits in the last ${ACTIVE_DAYS} days`, act.active || '(none)', '', '## Idle projects', act.idle || '(none)',
      '', '## Past proposals and verdicts', hist || '(none yet; this is the first batch)',
      '', 'Style (read on a phone, 10 seconds per proposal): plain short sentences about outcomes in the first fields, no file names or code; technical detail goes only in plan, which is for the agent who starts the work.',
      '', 'Output only one JSON object, nothing else:',
      '{"proposals":[{"kind":"feature or project","project":"project name (a working name for new projects)","dir":"project path (empty for new)","title":"≤ 8 words","hook":"≤ 15 words: who gets what when it\'s done","see":"≤ 20 words: what you\'ll see when you open it","why_now":"≤ 20 words","days":1-5,"risk":"≤ 15 words","plan":{"do":["steps"],"not_do":["out of scope"],"first_step":"first file to change"}}],"skipped":"≤ 30 words, why fewer (empty if 3)"}',
    ];
    return lines.join('\n');
  }

  function generate(text) {
    return new Promise((resolve, reject) => {
      mkdirSync(stateDir, { recursive: true });
      const args = ['-p', text, '--output-format', 'json', '--model', model,
        '--allowedTools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', ...(roots.length ? ['--add-dir', ...roots] : [])];
      const child = spawn(claudePath, args, { cwd: stateDir, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(zh ? '超過 25 分鐘沒有回應' : 'No answer after 25 minutes')); }, 25 * 60000);
      child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
      child.on('error', e => { clearTimeout(timer); reject(new Error((zh ? '找不到 claude 指令：' : 'claude not found: ') + e.message)); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`claude -p exit ${code}: ${(err || out).slice(-400)}`));
        let body = out, session = null;
        try { const j = JSON.parse(out); if (j.is_error) return reject(new Error(String(j.result).slice(0, 300))); body = j.result || ''; session = j.session_id || null; } catch {}
        const m = /\{[\s\S]*\}/.exec(body);
        try { const r = JSON.parse(m ? m[0] : body); resolve({ proposals: Array.isArray(r.proposals) ? r.proposals : [], skipped: r.skipped || '', session }); }
        catch { reject(new Error((zh ? '回答不是 JSON：' : 'Answer is not JSON: ') + String(body).slice(0, 300))); }
      });
    });
  }

  function batchMarkdown(today, lens, ps, skipped) {
    const lines = [`# ${zh ? '提案' : 'Proposals'} ${today}（${lens.name}）`, ''];
    for (const p of ps) lines.push(`- **${p.id}**［${label(p)}］${p.title}｜${p.days} ${zh ? '天' : 'd'}`);
    for (const p of ps) {
      lines.push('', '---', '', `## ${p.id}　${p.title}`, '', `**${p.hook}**`, '');
      if (p.see) lines.push(`- ${zh ? '做完會看到' : 'You\'ll see'}：${p.see}`);
      lines.push(`- ${zh ? '為什麼現在' : 'Why now'}：${p.why_now}`, `- ${zh ? '風險' : 'Risk'}：${p.risk}`);
      const plan = p.plan || {};
      if (p.dir) lines.push('', `\`${p.dir}\``);
      if (Array.isArray(plan.do)) lines.push(...plan.do.map(x => `- ${x}`));
      if (plan.first_step) lines.push(`${zh ? '第一步' : 'First step'}：${plan.first_step}`);
    }
    if (skipped) lines.push('', '---', '', `${zh ? '少交' : 'Fewer because'}：${skipped}`);
    return lines.join('\n') + '\n';
  }

  // 跑一批：回 { proposals, skipped }。running 期間再叫就回同一個 promise（不重複花額度）
  let running = null;
  function run({ lensName, dry = false } = {}) {
    if (running) return running;
    running = (async () => {
      const lens = lensName ? lenses.find(l => l.name === lensName) : lensOfDay();
      if (!lens) throw new Error((zh ? '沒有這個視角：' : 'No such lens: ') + lensName);
      const now = new Date(), today = localDay(now);
      log.log?.(`[提案部] ${lens.name}：交給 Claude（${model}）…`);
      const { proposals: got, skipped } = await generate(prompt({ lens, today }));
      const prefix = today.slice(5).replace('-', '');
      const used = new Set(proposals().map(p => p.id));
      let k = 0;
      const nextId = () => { let id; do { id = `${prefix}-${String.fromCharCode(97 + k++)}`; } while (used.has(id)); return id; };
      const ps = got.filter(p => p && p.title).map(p => ({ id: nextId(), at: now.toISOString(), lens: lens.name, ...p }));
      if (!dry) {
        for (const p of ps) append(F.proposals, p);
        mkdirSync(F.batches, { recursive: true });
        writeFileSync(join(F.batches, `${today}${ps[0] ? '-' + ps[0].id.split('-')[1] : ''}.md`), batchMarkdown(today, lens, ps, skipped));
      }
      log.log?.(`[提案部] 這批 ${ps.length} 份${skipped ? `；少交：${skipped}` : ''}`);
      return { proposals: ps, skipped };
    })().finally(() => { running = null; });
    return running;
  }

  return { stateDir, history, find, verdict, stage, run, isRunning: () => !!running, lenses, lensOfDay, prompt, label };
}
