// ── 單獨跑：npx cubbi ─────────────────────────────────────────────────────────
// 只綁本機（127.0.0.1）、只讀 ~/.claude 的紀錄，不需要登入。資料（歸檔名單）放 ~/.cubbi
import express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createSpace } from './space.js';
import { transcriptSource } from './sources/transcript.js';
import { spaceWeb } from './web.js';
import { createCodex } from './codex.js';
import { createGrowth } from './growth.js';
import { hookSource } from './hooks.js';
import { streamFilter } from './stream.js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

// streamPort：另開一個直播用的埠（內容全部遮掉，見 stream.js），給 OBS 之類的抓畫面
export function startCubbi({ port = 4321, host = '127.0.0.1', dataDir = join(homedir(), '.cubbi'), workRoot = homedir(), streamPort = null } = {}) {
  const app = express();
  app.use(express.json());
  // Codex：Claude 叫它做事時來外包畫師／顧問（從紀錄檔掃）、額度、作品牆，Codex 自己的對話也坐進辦公室
  let space = null;
  const hooks = hookSource();
  const codex = createCodex({ dataDir: join(dataDir, 'codex'), onChange: (msg) => space?.broadcast(msg) });
  // 自動成長：照全部紀錄的用量長大（第一次回顧要十幾秒，之後只讀新增的部分）
  const growth = createGrowth({ cacheFile: join(dataDir, 'growth.json'), onChange: (msg) => space?.broadcast(msg) });
  space = createSpace({
    // hooks（選用，npx cubbi install-hooks）有即時事件，排最前面；紀錄檔來源就不必再盯那幾段
    sources: [hooks, transcriptSource({ workRoot, skip: hooks.has }), codex.codexSource({ workRoot })],
    workRoot,
    archiveFile: join(dataDir, 'space-archive.json'),
    extend: (r) => {
      codex.extend(r); growth.extend(r); hooks.extend(r);
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
    },
  });
  codex.start({ scan: true, active: space.watching });
  growth.start();
  const web = spaceWeb();
  app.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(await web.html()); });
  app.use(web.router);
  app.use('/api/space', space.router);
  // 直播埠：同一份空間，API 過濾後才給；頁面加上 ?stream 讓前端收起按鈕
  let stream = null;
  if (streamPort) {
    const sapp = express();
    sapp.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send((await web.html()).replace('<body>', '<body class="stream">')); });
    sapp.use(web.router);
    sapp.use('/api/space', streamFilter({ file: join(dataDir, 'stream-names.json') }).router, space.router);
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
