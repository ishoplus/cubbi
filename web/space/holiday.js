// 節日：照日期決定辦公室要掛什麼裝飾。純函式，可以在 Node 測試。

// 農曆除夕前後一週（年份 → 春節日期；之後的年份再補）
const LUNAR_NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23' };

// date：Date；回傳 'halloween'｜'christmas'｜'newyear'｜null
export function holidayOf(date) {
  const m = date.getMonth() + 1, d = date.getDate(), md = m * 100 + d;
  if (md >= 1020 && md <= 1101) return 'halloween';
  if (md >= 1210 && md <= 1226) return 'christmas';
  const cny = LUNAR_NEW_YEAR[date.getFullYear()];
  if (cny) {
    const [cm, cd] = cny.split('-').map(Number);
    const day = new Date(date.getFullYear(), cm - 1, cd);
    const diff = (new Date(date.getFullYear(), m - 1, d) - day) / 86400_000;
    if (diff >= -7 && diff <= 7) return 'newyear';
  }
  return null;
}

export const HOLIDAY_GREETING = { halloween: '萬聖節快樂！辦公室掛上南瓜燈了', christmas: '聖誕快樂！窗邊多了一棵聖誕樹', newyear: '新年快樂！門口貼上春聯了' };
