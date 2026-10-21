// ── 世界時鐘：牆上一排大城市的時間，本地那個放大 ────────────────────────────────
//
// 本地時區跟瀏覽器（或宿主 host.homeTz），城市名跟介面語言；其他城市從清單裡挑時差不重複的，
// 由西到東排（時差小的在左），像通訊社、交易室的牆。純函式，不碰 three.js，方便測試。

// 候選城市：AI 與科技重鎮優先，挑到夠就停
export const CITIES = [
  { tz: 'America/Los_Angeles', zh: '舊金山', en: 'San Francisco' },
  { tz: 'America/New_York', zh: '紐約', en: 'New York' },
  { tz: 'Europe/London', zh: '倫敦', en: 'London' },
  { tz: 'Asia/Tokyo', zh: '東京', en: 'Tokyo' },
  { tz: 'Europe/Paris', zh: '巴黎', en: 'Paris' },
  { tz: 'Asia/Singapore', zh: '新加坡', en: 'Singapore' },
  { tz: 'Australia/Sydney', zh: '雪梨', en: 'Sydney' },
  { tz: 'Asia/Kolkata', zh: '班加羅爾', en: 'Bengaluru' },
];

// 本地時區常見的名字（清單外的就用時區代碼最後一段）
const LOCAL = {
  'Asia/Taipei': ['台北', 'Taipei'], 'Asia/Shanghai': ['上海', 'Shanghai'], 'Asia/Hong_Kong': ['香港', 'Hong Kong'],
  'Asia/Macau': ['澳門', 'Macau'], 'Asia/Seoul': ['首爾', 'Seoul'], 'Asia/Bangkok': ['曼谷', 'Bangkok'],
  'Asia/Kuala_Lumpur': ['吉隆坡', 'Kuala Lumpur'], 'Asia/Ho_Chi_Minh': ['胡志明市', 'Ho Chi Minh City'], 'Asia/Jakarta': ['雅加達', 'Jakarta'],
  'Asia/Manila': ['馬尼拉', 'Manila'], 'Asia/Dubai': ['杜拜', 'Dubai'], 'Europe/Berlin': ['柏林', 'Berlin'], 'Europe/Amsterdam': ['阿姆斯特丹', 'Amsterdam'],
  'Europe/Madrid': ['馬德里', 'Madrid'], 'Europe/Rome': ['羅馬', 'Rome'], 'Europe/Zurich': ['蘇黎世', 'Zurich'], 'Europe/Stockholm': ['斯德哥爾摩', 'Stockholm'],
  'America/Chicago': ['芝加哥', 'Chicago'], 'America/Denver': ['丹佛', 'Denver'], 'America/Toronto': ['多倫多', 'Toronto'], 'America/Vancouver': ['溫哥華', 'Vancouver'],
  'America/Sao_Paulo': ['聖保羅', 'São Paulo'], 'America/Mexico_City': ['墨西哥城', 'Mexico City'], 'Australia/Melbourne': ['墨爾本', 'Melbourne'], 'Pacific/Auckland': ['奧克蘭', 'Auckland'],
};
for (const c of CITIES) LOCAL[c.tz] ||= [c.zh, c.en];

export function cityName(tz, lang) {
  const n = LOCAL[tz];
  if (n) return lang === 'zh' ? n[0] : n[1];
  return (tz.split('/').pop() || tz).replace(/_/g, ' ');
}

// 某時區此刻的年月日時分（不靠瀏覽器所在地）
export function zonedParts(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(date);
  const get = (type) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, m: get('minute') };
}
// 跟 UTC 差幾分鐘
export function offsetMin(tz, date = new Date()) {
  const p = zonedParts(tz, date);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// 牆上要掛哪些：本地＋其他時差不重複的城市，共 n 個，由西到東
export function pickClocks({ localTz, lang = 'en', n = 5, date = new Date(), extra = null } = {}) {
  const list = [{ tz: localTz, name: cityName(localTz, lang), local: true, off: offsetMin(localTz, date) }];
  for (const c of extra || CITIES) {
    if (list.length >= n) break;
    const tz = typeof c === 'string' ? c : c.tz;
    let off;
    try { off = offsetMin(tz, date); } catch { continue; }   // 瀏覽器不認得的時區
    if (list.some(x => x.off === off)) continue;
    list.push({ tz, name: typeof c === 'string' ? cityName(tz, lang) : (lang === 'zh' ? c.zh : c.en), local: false, off });
  }
  return list.sort((a, b) => a.off - b.off);
}

// 時鐘上要畫的：時、分、白天還是晚上、跟本地差幾天（+1 明天、-1 昨天）
export function clockFace(tz, localTz, date = new Date()) {
  const p = zonedParts(tz, date), l = zonedParts(localTz, date);
  const dayDiff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(l.y, l.mo - 1, l.d)) / 86400_000);
  return { h: p.h, m: p.m, day: p.h >= 6 && p.h < 18, dayDiff };
}
