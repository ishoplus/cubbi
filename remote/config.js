// ── 個人化設定：程式裡不放只屬於某個人的東西 ───────────────────────────────────
//
// 公開版跟我用的是同一份程式，差別全在這個檔（之後搬到 ~/.config/<名稱>/config.json）：
//   CW_CONFIG 指定的檔，沒指定就是 data/config.json；不存在就全部用預設。
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
//     "economy": false,                       // 經營系統：讀整個 ~/.claude/projects 算成果
//     "ideas": "auto", "calendar": "auto"     // 追加功能：找得到 idea-lab／營收部的指令才出現（auto），或 true／false
//   }
// }
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = process.env.CW_CONFIG || join(__dirname, 'data', 'config.json');

const DEFAULTS = {
  space: { transcripts: true, aiNames: false, weather: null, lang: '', projectOutfits: {}, catNames: [] },
  plugins: { economy: false, ideas: 'auto', calendar: 'auto' },
};

function load() {
  let user = {};
  try { user = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error(`[config] ${CONFIG_FILE} 讀不了，全部用預設：${e.message}`); }
  return {
    space: { ...DEFAULTS.space, ...(user.space || {}) },
    plugins: { ...DEFAULTS.plugins, ...(user.plugins || {}) },
  };
}

export const config = load();

// 天氣要有經緯度才算數
export function weatherConfig() {
  const w = config.space.weather;
  return w && Number.isFinite(+w.lat) && Number.isFinite(+w.lon) ? { lat: +w.lat, lon: +w.lon, timezone: w.timezone || 'auto', place: w.place || '' } : null;
}
