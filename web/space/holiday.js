// 節日：照日期決定辦公室要掛什麼裝飾、今天是不是放假。純函式，可以在 Node 測試。

// 農曆節日的國曆日期（年份 → 月-日；之後的年份再補）
const LUNAR_NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23' };
const DRAGON_BOAT = { 2026: '06-19', 2027: '06-09', 2028: '05-28', 2029: '06-16', 2030: '06-05', 2031: '06-24' };
const MID_AUTUMN = { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12', 2031: '10-01' };
const QINGMING = { 2026: '04-05', 2027: '04-05', 2028: '04-04', 2029: '04-04', 2030: '04-05', 2031: '04-05' };

const DAY = 86400_000;
const dayOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lunar = (table, y) => { const s = table[y]; if (!s) return null; const [m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// 離那個農曆節日幾天（負的是還沒到）；沒有那年的資料回傳 null
const daysTo = (table, date) => { const day = lunar(table, date.getFullYear()); return day ? Math.round((dayOf(date) - day) / DAY) : null; };
const within = (v, from, to) => v != null && v >= from && v <= to;

// date：Date；zh：中文介面才掛端午、中秋（英文介面的使用者大多不過這兩個節）
// 回傳 'halloween'｜'christmas'｜'nye'｜'newyear'｜'dragonboat'｜'midautumn'｜null
export function holidayOf(date, { zh = true } = {}) {
  const m = date.getMonth() + 1, d = date.getDate(), md = m * 100 + d;
  if (md >= 1020 && md <= 1101) return 'halloween';
  if (md >= 1210 && md <= 1226) return 'christmas';
  if (md >= 1228 || md === 101) return 'nye';
  if (within(daysTo(LUNAR_NEW_YEAR, date), -7, 7)) return 'newyear';
  if (zh && within(daysTo(DRAGON_BOAT, date), -5, 1)) return 'dragonboat';
  if (zh && within(daysTo(MID_AUTUMN, date), -7, 1)) return 'midautumn';
  return null;
}

// 跨年夜放煙火：12/31 23:55 到 1/1 00:30
export function fireworksOn(date) {
  const m = date.getMonth() + 1, d = date.getDate(), h = date.getHours() + date.getMinutes() / 60;
  return (m === 12 && d === 31 && h >= 23 + 55 / 60) || (m === 1 && d === 1 && h < 0.5);
}

// 台灣國定放假日（含補假）：依《紀念日及節日實施條例》2025 年修正後的放假日。
// 補假：紀念日、節日逢週六提前到週五、逢週日延到週一；春節（小年夜到初三）碰到週末的天數接在後面補。
// 沒做：人事行政總處每年另外公告的調整放假（彈性放假＋週六補班）。
function twHolidaySet(y) {
  const out = new Set();
  const observe = (day) => { const w = day.getDay(); out.add(ymd(w === 6 ? addDays(day, -1) : w === 0 ? addDays(day, 1) : day)); };
  for (const md of ['01-01', '02-28', '05-01', '09-28', '10-10', '10-25', '12-25']) observe(new Date(`${y}-${md}T00:00:00`));
  const qm = lunar(QINGMING, y), kids = new Date(y, 3, 4);
  if (qm) observe(qm);
  observe(qm && ymd(qm) === ymd(kids) ? addDays(kids, -1) : kids);   // 兒童節跟清明同一天：兒童節提前一天
  for (const t of [DRAGON_BOAT, MID_AUTUMN]) { const day = lunar(t, y); if (day) observe(day); }
  const cny = lunar(LUNAR_NEW_YEAR, y);
  if (cny) {
    let owe = 0;
    for (let i = -2; i <= 3; i++) { const day = addDays(cny, i); out.add(ymd(day)); if (day.getDay() % 6 === 0) owe++; }
    for (let day = addDays(cny, 4); owe > 0; day = addDays(day, 1)) if (day.getDay() % 6 !== 0) { out.add(ymd(day)); owe--; }
  }
  return out;
}
const twCache = new Map();
export function isTwHoliday(date) {
  const y = date.getFullYear(), key = ymd(date);
  // 1/1 逢週六會補在前一年的 12/31，所以隔年也要看
  for (const yy of [y, y + 1]) { if (!twCache.has(yy)) twCache.set(yy, twHolidaySet(yy)); if (twCache.get(yy).has(key)) return true; }
  return false;
}

// 今天辦公室放不放假：週末一定放；tw（使用者在台灣）再加國定假日
export function isDayOff(date, { tw = false } = {}) {
  return date.getDay() % 6 === 0 || (tw && isTwHoliday(date));
}

export const HOLIDAY_GREETING = {
  halloween: '萬聖節快樂！辦公室掛上南瓜燈了', christmas: '聖誕快樂！窗邊多了一棵聖誕樹', newyear: '新年快樂！門口貼上春聯了',
  nye: '跨年快樂！午夜窗外有煙火', dragonboat: '端午節快樂！門口掛上艾草了', midautumn: '中秋節快樂！今晚窗外是滿月',
};
