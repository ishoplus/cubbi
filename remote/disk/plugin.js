// ── 內建外掛：交給 CC 清理硬碟 ───────────────────────────────────────────────────
//
// 倉庫貨架（Cubbi 核心 server/disk.js＋前端 web/space/plugins/disk.js）只看不動；remote 能開對話，
// 抽屜裡多一顆「交給 CC 清理」：開一段新對話，請它先盤點、列清單，你點頭的才清。
// 同一時間只開一段：上一段還在做或在等你回答，再按就帶你回那個人。
//   POST /api/space/disk/clean   → { sid, existing? }
import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tr, errText, SERVER_LANG } from '../i18n.js';
import { fmtBytes } from '../../server/disk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function brief(d, lang = 'zh') {
  const free = fmtBytes(d.free), total = fmtBytes(d.total), pct = Math.round(100 - d.usedPct);
  if (lang === 'en') return [
    `# Clean up disk space`, '',
    `This computer's disk has ${free} free of ${total} (${pct}% left). Help me free up space.`, '',
    '## How',
    '1. Survey first: find what takes the most space (du on the home folder, Downloads, Movies, projects, ~/Library/Caches, ~/Library/Developer, Docker, package caches like npm/brew/pip). Read only — delete nothing yet.',
    '2. Give me one list, biggest first: path, size, what it is, and whether it can be regenerated (caches, build output, node_modules, simulators) or is my own data (videos, photos, documents, project sources).',
    '3. Stop and ask which items to clean. Only touch what I explicitly approve.',
    '4. Regenerable stuff: delete, or use the tool\'s own cleanup command (npm cache clean, brew cleanup, docker system prune, xcrun simctl delete unavailable). My own data: never delete — suggest moving it to an external drive or the cloud, and move it only if I say so.',
    '5. When done, report how much space was freed and how much is free now.',
  ].join('\n');
  return [
    '# 清理硬碟空間', '',
    `這台電腦的硬碟剩 ${free}（總共 ${total}，剩 ${pct}%），幫我騰出空間。`, '',
    '## 做法',
    '1. 先盤點：找出最佔空間的地方（家目錄、下載、影片、專案、~/Library/Caches、~/Library/Developer、Docker、npm／brew／pip 這類套件快取）。只看，先不刪任何東西。',
    '2. 整理成一份清單，大的排前面：路徑、大小、是什麼，以及能不能重新產生（快取、建置產物、node_modules、模擬器）還是我自己的資料（影片、照片、文件、專案原始檔）。',
    '3. 停下來問我要清哪幾項，只動我明確點頭的。',
    '4. 能重新產生的：刪掉，或用工具自己的清理指令（npm cache clean、brew cleanup、docker system prune、xcrun simctl delete unavailable）。我自己的資料一律不刪：建議搬到外接硬碟或雲端，我說要搬才搬。',
    '5. 做完回報清出多少、現在剩多少。',
  ].join('\n');
}

// disk：核心的 createDisk（拿最新數字）；cwd：對話開在哪
export function diskPlugin({ disk, cwd }) {
  let last = null;
  return {
    name: 'disk',
    webDir: join(__dirname, '..', 'public', 'space'),   // 前端那一半在 Cubbi 核心的 web/space/plugins/disk.js，這裡只要讓它被載入
    mount({ app, requireAuth, startWork, statusOf }) {
      const r = Router();
      r.post('/clean', async (req, res) => {
        if (last && statusOf(last) !== 'idle') return res.json({ sid: last, existing: true });
        try {
          const d = await disk().check();
          if (!d) return res.status(500).json({ error: tr(req, '讀不到硬碟空間') });
          last = await startWork({ cwd, prompt: brief(d, SERVER_LANG()), worktree: false });
          res.json({ sid: last });
        } catch (e) { res.status(400).json({ error: errText(req, e) }); }
      });
      app.use('/api/space/disk', requireAuth, r);
    },
  };
}
