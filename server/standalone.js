// ── 單獨跑：npx cubbi ─────────────────────────────────────────────────────────
// 只綁本機（127.0.0.1）、只讀 ~/.claude 的紀錄，不需要登入。資料（歸檔名單）放 ~/.cubbi
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createSpace } from './space.js';
import { transcriptSource } from './sources/transcript.js';
import { spaceWeb } from './web.js';
import { createCodex } from './codex.js';
import { createGrowth } from './growth.js';
import { createClaudeQuota } from './claude-quota.js';
import { hookSource } from './hooks.js';
import { streamFilter, streamControl } from './stream.js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { EN } from '../remote/i18n-en.js';   // 只拿英文表（純資料）；remote/i18n.js 會連帶讀 .env 與設定檔，單獨跑不需要

// 推播的語言：CUBBI_LANG → 系統語言（同 remote/i18n.js 的 CLI_LANG）
const pushLang = () => (/^zh/i.test(process.env.CUBBI_LANG || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '') ? 'zh' : 'en');
const pushT = (s, vars) => { const r = pushLang() === 'en' ? (EN[s] ?? s) : s; return vars ? r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : r; };

// streamPort：另開一個直播用的埠（內容全部遮掉，見 stream.js），給 OBS 之類的抓畫面
// streamHostDir：直播頁另外蓋上的前端檔案（同名覆蓋，例如自己的 host.js、外掛、角色），只用在直播埠
export function startCubbi({ port = 4321, host = '127.0.0.1', dataDir = join(homedir(), '.cubbi'), workRoot = homedir(), streamPort = null, streamBadge = true, streamHostDir = null } = {}) {
  const app = express();
  app.use(express.json());
  // Codex：Claude 叫它做事時來外包畫師／顧問（從紀錄檔掃）、額度、作品牆，Codex 自己的對話也坐進辦公室
  let space = null;
  const filter = streamPort ? streamFilter({ file: join(dataDir, 'stream-names.json') }) : null;
  const hooks = hookSource();
  const codex = createCodex({ dataDir: join(dataDir, 'codex'), onChange: (msg) => space?.broadcast(msg) });
  // 自動成長：照全部紀錄的用量長大（第一次回顧要十幾秒，之後只讀新增的部分）
  // Claude 額度：狀態列每次更新順手帶來（只有訂閱方案有）
  const claudeQuota = createClaudeQuota({ file: join(dataDir, 'claude-quota.json'), onChange: (msg) => space?.broadcast(msg) });
  const growth = createGrowth({ cacheFile: join(dataDir, 'growth.json'), onChange: (msg) => space?.broadcast(msg) });
  space = createSpace({
    // hooks（選用，npx cubbi install-hooks）有即時事件，排最前面；紀錄檔來源就不必再盯那幾段
    sources: [hooks, transcriptSource({ workRoot, skip: hooks.has }), codex.codexSource({ workRoot })],
    workRoot,
    archiveFile: join(dataDir, 'space-archive.json'),
    // 等你處理：收下／看過存 ~/.cubbi；要推到手機就設 PUSH_URL（ntfy 的 topic 網址）
    inbox: { file: join(dataDir, 'inbox.json'), push: { url: () => process.env.PUSH_URL || '', click: () => `http://${host}:${port}/`, detail: process.env.PUSH_DETAIL === 'full' ? 'full' : 'brief' }, t: pushT },
    extend: (r) => {
      codex.extend(r); growth.extend(r); hooks.extend(r); claudeQuota.extend(r);
      // 新用戶引導用：哪個系統、找不找得到 Claude Code 的紀錄
      const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
      r.get('/info', (req, res) => res.json({ platform: process.platform, claudeDir, hasClaude: existsSync(join(claudeDir, 'projects')) }));
      // 狀態列與 /cubbi 用：清單每 3 秒算一次就好（狀態列會一直問）
      let cache = { at: 0, list: [] };
      const people = async () => { if (Date.now() - cache.at > 3000) cache = { at: Date.now(), list: await space.stage() }; return cache.list; };
      // 狀態列的語言跟瀏覽器介面一致（頁面打開時回報；沒回報過就看系統）
      const langFile = join(dataDir, 'lang');
      let lang = ''; try { lang = readFileSync(langFile, 'utf8').trim(); } catch {}
      r.post('/lang', (req, res) => { const l = req.body?.lang === 'zh' ? 'zh' : 'en'; if (l !== lang) { lang = l; try { writeFileSync(langFile, l); } catch {} } res.json({ ok: true }); });
      const isZh = () => (lang ? lang === 'zh' : /^zh/i.test(process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || ''));
      const LEVEL_NAMES = { zh: ['車庫新創', '小工作室', '正式辦公室', '整層樓', '總部大樓'], en: ['Garage startup', 'Small studio', 'Real office', 'Whole floor', 'Headquarters'] };
      const base = (p) => (!p || p === workRoot ? '~' : String(p).split(/[\\/]/).filter(Boolean).pop() || '~');
      setTimeout(() => people().catch(() => {}), 500);   // 先算一次：狀態列第一次問就答得出來
      r.get('/statusline', async (req, res) => {
        if (req.query.rl) { try { claudeQuota.fromStatusline(JSON.parse(String(req.query.rl))); } catch {} }
        const list = await people(), sid = String(req.query.sid || '');
        const me = list.find(s => s.sid === sid), busy = list.filter(s => ['working', 'asking', 'external'].includes(s.status)).length;   // 在終端機跑的也算在忙
        const lvl = growth.level(), zh = isZh(), LEVELS = LEVEL_NAMES[zh ? 'zh' : 'en'];
        const who = me?.name ? `${me.name} @ ${base(me.cwd)}` : base(req.query.cwd);
        res.json({ text: zh ? `🧱 ${who}｜辦公室 ${busy} 人在忙${lvl != null ? ' · ' + LEVELS[lvl] : ''}` : `🧱 ${who} | ${busy} busy${lvl != null ? ' · ' + LEVELS[lvl] : ''}` });
      });
      r.get('/find', async (req, res) => {
        const cwd = String(req.query.cwd || ''), list = await people();
        const me = list.filter(s => s.cwd === cwd).sort((a, b) => (b.live - a.live) || b.updatedAt - a.updatedAt)[0];
        res.json(me ? { sid: me.sid, name: me.name || me.title } : {});
      });
      if (filter) streamControl({ filter, broadcast: (m) => space.broadcast(m), people: () => space.stage() })(r);
    },
  });
  codex.start({ scan: true, active: space.watching });
  growth.start();
  const web = spaceWeb();
  app.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(await web.html()); });
  app.use(web.router);
  app.use('/api/space', space.router);
  if (filter) app.get('/stream-control', (req, res) => res.sendFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'stream-control.html')));
  // 直播埠：同一份空間，API 過濾後才給；頁面 body 加上 stream，前端收起按鈕、換成自動導播
  // 導播台在本機埠的 /stream-control（看得到真名，不能在直播埠開）
  let stream = null;
  if (streamPort) {
    const sapp = express();
    // 右下角的小招牌：觀眾看了知道這是什麼、怎麼裝（--no-badge 拿掉）
    const badge = streamBadge ? '<div id="stream-badge"><svg viewBox="0 0 64 34"><rect x="10" y="0" width="14" height="8" rx="2" fill="#f2cd37"/><rect x="40" y="0" width="14" height="8" rx="2" fill="#f2cd37"/><rect x="0" y="6" width="64" height="28" rx="4" fill="#f2cd37"/></svg><b>Cubbi</b><span>npx cubbi</span></div>' : '';
    const sweb = streamHostDir ? spaceWeb({ overrideDir: streamHostDir }) : web;
    sapp.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send((await sweb.html()).replace('<body>', '<body class="stream">' + badge)); });
    sapp.use(sweb.router);
    sapp.use('/api/space', filter.router, space.router);
    stream = new Promise((resolve, reject) => { const s = sapp.listen(streamPort, host, () => resolve(`http://${host === '0.0.0.0' ? 'localhost' : host}:${s.address().port}/`)); s.on('error', reject); });
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      // hook 程式讀這個檔找 Cubbi 在哪個埠
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(join(dataDir, 'port'), String(server.address().port)); } catch {}
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`;
      (stream || Promise.resolve(null)).then(streamUrl => resolve({ server, url, streamUrl }), reject);
    });
    server.on('error', reject);
  });
}
