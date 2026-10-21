// ── 單獨跑：npx cubbi ─────────────────────────────────────────────────────────
// 只綁本機（127.0.0.1）、只讀 ~/.claude 的紀錄，不需要登入。資料（歸檔名單）放 ~/.cubbi
import express from 'express';
import { join } from 'path';
import { homedir } from 'os';
import { createSpace } from './space.js';
import { transcriptSource } from './sources/transcript.js';
import { spaceWeb } from './web.js';

export function startCubbi({ port = 4321, host = '127.0.0.1', dataDir = join(homedir(), '.cubbi'), workRoot = homedir() } = {}) {
  const app = express();
  app.use(express.json());
  const space = createSpace({
    sources: [transcriptSource({ workRoot })],
    workRoot,
    archiveFile: join(dataDir, 'space-archive.json'),
  });
  const web = spaceWeb();
  app.get('/', async (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(await web.html()); });
  app.use(web.router);
  app.use('/api/space', space.router);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/` }));
    server.on('error', reject);
  });
}
