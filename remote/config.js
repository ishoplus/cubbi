// ── 個人化設定：程式裡不放只屬於某個人的東西 ───────────────────────────────────
//
// 公開版跟我用的是同一份程式，差別全在這個檔（之後搬到 ~/.config/<名稱>/config.json）：
//   CW_CONFIG 指定的檔，沒指定就是資料夾裡的 config.json（paths.js）；不存在就全部用預設。
// 預設是給第一次用的人的保守值：不連外（天氣、AI 取名都關）、外掛都關、不開通道。
// 祕密（金鑰、密碼）不放這裡，放 .env 或 Keychain。
//
// {
//   "space": {
//     "transcripts": true,                    // 辦公室也顯示終端機開的對話（讀 ~/.claude/projects）
//     "aiNames": false,                       // 用 haiku 幫每段對話取短名（會花一點額度）
//     "weather": { "lat": 25.03, "lon": 121.50, "timezone": "Asia/Taipei", "place": "台北" },  // 窗外天氣（問 Open-Meteo）
//     "lang": "zh",                           // 介面語言，不設就跟瀏覽器
//     "projectOutfits": { "my-app": "engineer" },  // 專案的預設制服
//     "catNames": ["咪咪"]                    // 辦公室貓的名字
//   },
//   "plugins": {
//     "economy": true,                        // 經營系統（標準配備，預設開）：讀本機 ~/.claude/projects 算成果，不上傳
//     "ideas": "auto"                         // 其他外掛：auto（看外掛自己說找不找得到要的東西）、true、false
//   },
//   "pluginModules": ["../ideas.js"],          // 外掛模組，相對路徑以這個檔的資料夾為準（plugins.js）
//   "drivers": { "codex": "auto", "default": "claude" },   // codex：auto（裝了且登入就能選）／false；新對話預設用哪一家
//   "projects": { "my-app": { "driver": "codex" } },       // 專案預設（資料夾名或完整路徑），在那裡開新對話時預先選好
//   "inbox": { "push": ["ask", "idea", "deliv", "review", "stuck", "ended", "task"],   // 收件箱哪幾種推到手機（done＝做完了，預設不推）
//              "pushDetail": "brief" },                                               // brief 只說誰要什麼；full 帶指令、路徑等細節（ntfy topic 是公開的）
//   "ideas": { "stateDir": "~/.cubbi/ideas", "roots": ["~/projects"], "values": "我的品味…", "valuesFiles": [], "model": "opus", "web": false },   // 提案部（ideas/lab.js）；web 給不給它上網查
//   "routines": [ { "id": "ideas", "name": "每天提案", "at": "09:00", "days": "daily", "action": { "type": "ideas" } } ]   // 排程（routines.js）
// }
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dataFile } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = process.env.CW_CONFIG || dataFile('config.json');

const DEFAULTS = {
  space: { transcripts: true, aiNames: false, weather: null, lang: '', projectOutfits: {}, catNames: [] },
  plugins: { economy: true },
};

function readUser() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error(`[config] ${CONFIG_FILE} 讀不了，全部用預設：${e.message}`); return {}; }
}
function load(user = readUser()) {
  return {
    space: { ...DEFAULTS.space, ...(user.space || {}) },
    plugins: { ...DEFAULTS.plugins, ...(user.plugins || {}) },
    pluginModules: Array.isArray(user.pluginModules) ? user.pluginModules : [],   // 外掛模組的路徑（plugins.js）
    drivers: { codex: 'auto', default: 'claude', ...(user.drivers || {}) },
    projects: user.projects && typeof user.projects === 'object' ? user.projects : {},
    inbox: { ...(user.inbox || {}) },
    ideas: { ...(user.ideas || {}) },
    routines: Array.isArray(user.routines) ? user.routines : [],
  };
}

export const config = load();

// 從畫面上改設定（例如打開「每天提案」）：只改那一個鍵，其他照原檔寫回；記憶體裡的 config 跟著更新
export function saveConfig(key, value) {
  const user = readUser();
  if (value === undefined) delete user[key]; else user[key] = value;
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(user, null, 2) + '\n');
  renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE);
  Object.assign(config, load(user));
}

// 天氣要有經緯度才算數
export function weatherConfig() {
  const w = config.space.weather;
  return w && Number.isFinite(+w.lat) && Number.isFinite(+w.lon) ? { lat: +w.lat, lon: +w.lon, timezone: w.timezone || 'auto', place: w.place || '' } : null;
}

// 設定裡的路徑可以寫 ~/
export const expandHome = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? join(homedir(), p.slice(1)) : p);
