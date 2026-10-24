// ── 3D 空間（/space.html）：claude-web 這邊的組裝 ─────────────────────────────
//
// 空間本身是 Cubbi（~/projects/cubbi，node_modules/cubbi 連過去）：核心、紀錄檔來源、整個前端都在那裡，
// 辦公室的改動只做在 Cubbi。這裡只接 claude-web 自己才有的東西：
//   live 來源：這台伺服器開的對話，事件即時進來（sources/live.js）
//   台北天氣、進度上的積木數；Codex（外包、額度、作品牆、Codex 員工）用 Cubbi 的，餵它即時事件
//   Claude 額度：串流每回合的 rate_limit_event 交給 Cubbi
// 前端的宿主接口（public/space/host.js）與經營外掛（public/space/plugins/）也在 claude-web。

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSpace, transcriptSource, createCodex, createClaudeQuota } from '../server/index.js';
import { DATA_DIR } from './paths.js';
import { sessionBricks } from './economy.js';
import { nameFor } from './names.js';
import { liveSource } from './sources/live.js';
import { config, weatherConfig } from './config.js';
import { publicUrl } from './tunnel.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';

export { toolKind, toolDetail } from '../server/index.js';

const DATA = DATA_DIR;
let space = null, live = null;

// server.js 用：事件與狀態變化要經過 live 來源；其他推播（經營、名字、外包）走 broadcast
export const trackEvent = (sess, ev) => live?.trackEvent(sess, ev);
export const touch = (sess) => live?.touch(sess);
export const broadcast = (msg) => space?.broadcast(msg);
export const coreInbox = () => space?.inbox;   // 收件箱在 Cubbi 核心（server/inbox.js），remote 用 addProvider 加自己的

// 推播位址：.env 的 PUSH_URL（ntfy topic 網址，設空字串＝關），沒設就沿用 xitto-station 的（~/.xitto/config.json 的 push.url）
function pushUrl() {
  if (process.env.PUSH_URL !== undefined) return process.env.PUSH_URL;
  try { return JSON.parse(readFileSync(join(homedir(), '.xitto', 'config.json'), 'utf8')).push?.url || ''; } catch { return ''; }
}

export function spaceRouter({ sessions, bySid, workRoot }) {
  const codex = createCodex({
    dataDir: DATA,
    galleryFile: process.env.SPACE_GALLERY_FILE || join(DATA, 'space-gallery.json'),
    thumbDir: process.env.SPACE_THUMB_DIR || join(DATA, 'space-thumbs'),
    onChange: (msg) => space?.broadcast(msg),
  });
  const claudeQuota = createClaudeQuota({ file: join(DATA, 'claude-quota.json'), onChange: (msg) => space?.broadcast(msg) });
  live = liveSource({ sessions, bySid, onEvent: (sess, ev) => { claudeQuota.trackEvent(ev); codex.trackEvent(sess, ev); } });
  space = createSpace({
    // 終端機開的對話（讀 ~/.claude/projects）可以關掉，關了辦公室只有這台伺服器開的
    sources: [live, ...(config.space.transcripts ? [transcriptSource({ workRoot, skip: live.has, nameFor })] : []), codex.codexSource({ workRoot, skip: live.has })],
    workRoot,
    archiveFile: process.env.SPACE_ARCHIVE_FILE || join(DATA, 'space-archive.json'),
    weather: weatherConfig(),
    inbox: { file: process.env.INBOX_FILE || join(DATA, 'inbox.json'),
      push: { url: pushUrl, click: () => (publicUrl() ? `${publicUrl()}/?inbox=1` : ''), ...(Array.isArray(config.inbox.push) ? { kinds: config.inbox.push } : {}) } },   // 設定檔的 space.weather；沒設就沒有天氣（不連外）
    progressExtra: (sid) => (config.plugins.economy !== false ? { bricks: sessionBricks(sid) } : {}),
    extend: (r) => { codex.extend(r); claudeQuota.extend(r); },
  });
  // 終端機開的 Claude 叫 Codex 也看得到（掃紀錄檔）；這台開的走即時事件，同一個工具呼叫不會重複
  codex.start({ scan: true, active: space.watching });
  return space.router;
}
