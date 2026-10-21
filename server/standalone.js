// ── 單獨跑：npx cubbi ─────────────────────────────────────────────────────────
// 只綁本機（127.0.0.1）、只讀 ~/.claude 的紀錄，不需要登入。資料（歸檔名單）放 ~/.cubbi
import express from 'express';
import { join } from 'path';
import { homedir } from 'os';
import { createSpace } from './space.js';
import { transcriptSource } from './sources/transcript.js';
import { spaceWeb } from './web.js';
import { createCodex } from './codex.js';
import { createGrowth } from './growth.js';

export function startCubbi({ port = 4321, host = '127.0.0.1', dataDir = join(homedir(), '.cubbi'), workRoot = homedir() } = {}) {
  const app = express();
  app.use(express.json());
  // Codex：Claude 叫它做事時來外包畫師／顧問（從紀錄檔掃）、額度、作品牆，Codex 自己的對話也坐進辦公室
  let space = null;
  const codex = createCodex({ dataDir: join(dataDir, 'codex'), onChange: (msg) => space?.broadcast(msg) });
  // 自動成長：照全部紀錄的用量長大（第一次回顧要十幾秒，之後只讀新增的部分）
  const growth = createGrowth({ cacheFile: join(dataDir, 'growth.json'), onChange: (msg) => space?.broadcast(msg) });
  space = createSpace({
    sources: [transcriptSource({ workRoot }), codex.codexSource({ workRoot })],
    workRoot,
    archiveFile: join(dataDir, 'space-archive.json'),
    extend: (r) => { codex.extend(r); growth.extend(r); },
  });
  codex.start({ scan: true, active: space.watching });
  growth.start();
  const web = spaceWeb();
  app.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(await web.html()); });
  app.use(web.router);
  app.use('/api/space', space.router);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/` }));
    server.on('error', reject);
  });
}
