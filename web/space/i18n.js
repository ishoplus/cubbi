// ── 介面文字：中文寫在程式裡，英文查這張表 ───────────────────────────────────
//
// 用法：t('等你回答')、t('{n} 分鐘沒動靜', { n })。中文是原文（維護時好讀），英文缺了就顯示中文；
// tests/i18n.test.mjs 會檢查每個 t('…') 都有英文。
// 語言：宿主指定（host.lang），不然跟瀏覽器；zh 開頭用中文，其他用英文。
// HTML 裡寫死的文字與 title／placeholder：translateDom() 開頁時整頁換一次。
import { host } from './host.js';

export const LANG = (host.lang || globalThis.navigator?.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
export const LOCALE = LANG === 'zh' ? 'zh-TW' : 'en-US';

export const EN = {
  // 狀態與動作
  '工作中': 'Working', '等你回答': 'Needs you', '做完了，等你': 'Done, waiting for you', '做完了，同事還在忙': 'Done, helpers still busy',
  '在別處執行中': 'Running elsewhere', '休息中': 'Resting',
  '在讀': 'Reading', '在改': 'Editing', '跑指令': 'Running a command', '查網路': 'Browsing', '派助手': 'Sending a helper', '排計畫': 'Planning',
  '用工具': 'Using a tool', '思考中': 'Thinking', '回覆中': 'Replying', '完成': 'Done', '出錯': 'Error', '你說': 'You',
  '未知': 'Unknown', '剛剛': 'just now', '{n} 分': '{n}m', '{n} 時': '{n}h', '{n} 天': '{n}d',
  '回覆：{text}': 'Reply: {text}', '{k}：{d}': '{k}: {d}', '{k}（{tool}）': '{k} ({tool})',
  '指令跑了 {n} 分鐘': 'Command running for {n} min', '{n} 分鐘沒動靜': 'No activity for {n} min',
  '助手：{desc}': 'Helper: {desc}', '指令：{desc}': 'Command: {desc}', '背景任務': 'Background task', '子任務': 'Subtask',
  // 辦公室
  '辦公室': 'Office', '在場': 'Present', '同事': 'Helpers',
  '茶水間': 'Pantry', '咖啡吧': 'Coffee bar', '休息區': 'Lounge', '遊戲角': 'Game corner', '會議室': 'Meeting room',
  '獎盃架': 'Trophies', '共用工作桌': 'Hot desks', '窗邊': 'Windows',
  '在這裡開新對話': 'New session here',
  '公司升級：{name}！': 'Office upgraded: {name}!', '升上{name}，大家來慶祝！': 'We made it to {name} — party time!',
  '週五下班前，休息區開派對！': 'Friday wind-down party in the lounge!',
  '萬聖節快樂！辦公室掛上南瓜燈了': 'Happy Halloween! Pumpkins are up.',
  '聖誕快樂！窗邊多了一棵聖誕樹': 'Merry Christmas! There’s a tree by the window.',
  '新年快樂！門口貼上春聯了': 'Happy Lunar New Year! Couplets are on the door.',
  // 鏡頭與區域
  '停止跟拍': 'Stop following', '跟拍：他走到哪鏡頭跟到哪': 'Follow: the camera tracks them',
  '跟拍中：他走到哪鏡頭跟到哪': 'Following — the camera tracks them',
  '收起區域': 'Hide areas', '展開區域': 'Show areas', '區域': 'Areas', '前往：{place}': 'Go to: {place}',
  // 通知與計數
  '有人': 'Someone', '{name}在等你回答': '{name} needs you', '{name}做完了': '{name} is done',
  '{name}的指令跑了 {n} 分鐘': '{name}’s command has run for {n} min', '{name} {n} 分鐘沒動靜': '{name}: no activity for {n} min',
  '{name}好像卡住了': '{name} may be stuck', '指令跑了 {n} 分鐘：{cmd}': 'Command running for {n} min: {cmd}', '{n} 分鐘沒有新動作': 'No new activity for {n} min',
  '({n}) 等你回答 · {title}': '({n}) Needs you · {title}',
  '出去工作的同事（背景任務）': 'Helpers out working (background tasks)', '還沒有人上班': 'Nobody’s in yet',
  // 面板
  '（沒有標題）': '(untitled)', '新對話': 'New session', '它在等你：{q}': 'Waiting on you: {q}', '需要你決定': 'Needs your decision', '直接回答': 'Answer',
  '對話剛開始，等它拿到編號…': 'Session just started, waiting for its ID…',
  '這段對話的目錄不在允許的範圍內，只能看進度。': 'This session’s folder is outside the allowed area — progress only.',
  '這段對話的目錄不在允許的範圍內': 'This session’s folder is outside the allowed area',
  '這段對話正在別處（例如終端機）執行。在這裡送出會另開一個進程接著講，兩邊同時寫可能互相干擾。': 'This session is running elsewhere (e.g. a terminal). Sending here starts a second process; the two may step on each other.',
  '還沒開始': 'Not started yet', '讀取中…': 'Loading…', '待辦 {done}/{n}': 'To-dos {done}/{n}', '改過的檔案 {n}': 'Files changed {n}',
  '最近的步驟': 'Recent steps', '還沒有紀錄': 'Nothing yet', '上一層': 'Up', '空的': 'Empty', '返回': 'Back', '開新分頁': 'Open in new tab',
  '檔案太大，請開新分頁或下載': 'File too large — open in a new tab or download', '二進位檔案，請開新分頁或下載': 'Binary file — open in a new tab or download',
  '最近的專案': 'Recent projects',
  '在終端機接著聊：': 'Continue in your terminal:', '已複製': 'Copied', '複製': 'Copy',
  // 音效、天氣、回放
  '關掉音效': 'Mute', '打開音效': 'Unmute',
  '晴': 'Clear', '多雲': 'Cloudy', '起霧': 'Fog', '下雨': 'Rain', '雷雨': 'Thunderstorm', '下雪': 'Snow',
  '外面': 'Outside', '{place}現在：{w}': '{place} now: {w}',
  '讀不到今天的紀錄': 'Couldn’t load today’s history', '今天還沒有可以回放的紀錄': 'Nothing to replay yet today',
  '回放完畢': 'Replay finished', '回到現在': 'Back to now', '回放 {t}': 'Replay {t}',
  // 歸檔、搜尋、快速回覆
  '他正在忙，等他做完再歸檔': 'Busy right now — archive after they finish', '歸檔失敗': 'Couldn’t archive', '已歸檔：{name}': 'Archived: {name}', '復原': 'Undo',
  '找不到': 'No matches', '他在等你回答，先回答再交代': 'They’re waiting on you — answer first',
  '這段對話正在終端機執行，從這裡送出會另開一個進程接著講，兩邊可能互相干擾。確定要送？': 'This session is running in a terminal. Sending here starts a second process and the two may conflict. Send anyway?',
  '連線失敗': 'Connection failed',
  // Codex 外包
  '{t} 重置': 'resets {t}', 'Codex 額度（{plan}）': 'Codex usage ({plan})', '5 小時：已用 {p}%，{reset}': '5-hour: {p}% used, {reset}',
  '每週：已用 {p}%，{reset}': 'Weekly: {p}% used, {reset}', '（{t} 最後一次執行時的數字）': '(as of the last run at {t})',
  'Codex 5 小時額度已用 {p}%，{reset}': 'Codex 5-hour usage at {p}%, {reset}', '5 小時': '5 hours', '每週': 'Weekly', 'Codex 額度': 'Codex usage',
  'ChatGPT {plan} 方案 · 數字來自 {t} Codex 最後一次執行': 'ChatGPT {plan} plan · numbers from the last Codex run at {t}',
  'Codex 啟動中…': 'Codex starting…', '接案、構思中': 'Taking the job, sketching', '作畫中': 'Painting', '畫好了': 'Finished', '沒畫成': 'Didn’t work out',
  '接案': 'Taking the job', '做完了': 'Done', '沒做成': 'Didn’t work out', '交件': 'Delivering',
  '外包顧問：{text}': 'Contractor: {text}', '外包畫師：{text}': 'Painter: {text}', '外包顧問': 'Contractor', '外包畫師': 'Painter',
  '{n} 分鐘': '{n} min', '現在：{doing}': 'Now: {doing}', '{who} 派的工作': 'Assigned by {who}', '看派工的人': 'Show who assigned it',
  '這是 Codex 的對話，只能看進度。': 'This is a Codex session — progress only.',
  '作品牆': 'Gallery', 'Codex 畫的圖': 'Painted by Codex',
  // 在場景裡回答
  '它已經不在等了': 'It’s no longer waiting', '（可複選）': '(pick any)', '都不是，自己輸入…': 'None of these — type your own…',
  '送出': 'Send', '略過': 'Skip', '想用 {tool}': 'Wants to use {tool}', '允許一次': 'Allow once', '總是允許': 'Always allow',
  '記到這個專案的設定，之後不再問': 'Saved to this project’s settings; won’t ask again', '拒絕': 'Deny', '到對話裡看完整內容': 'See the full request in the chat',
  '先選一個，或自己輸入': 'Pick one or type your own', '已回答': 'Answered', '已略過': 'Skipped', '已允許': 'Allowed', '已允許，之後不再問': 'Allowed — won’t ask again', '已拒絕': 'Denied',
  // 部門（制服）
  '工程部': 'Engineering', '新聞部': 'Newsroom', '寫稿部': 'Writers', '交易部': 'Trading', '貓咪部': 'Cat care', '狩獵部': 'Hunters', '總務部': 'Admin',
  '廚房': 'Kitchen', '太空部': 'Space', '消防隊': 'Fire crew', '醫務室': 'Clinic', '魔法部': 'Magic', '海盜船': 'Pirates', '工務部': 'Builders',
  'Codex': 'Codex', '偵探社': 'Detectives', '警察局': 'Police', '研究所': 'Lab', '美術部': 'Art', '快遞': 'Courier', '體育部': 'Sports',
  // HTML 裡的固定文字
  '搭積木中': 'Building', '找人': 'Find', '縮時回放今天': 'Replay today', '天氣': 'Weather', '看全景': 'Overview', '更多': 'More',
  '歸檔：從空間拿掉（之後有新動作會自動回來）': 'Archive: remove from the office (comes back on new activity)',
  '關閉': 'Close', '直接交代一句…': 'Tell them something…', '對話': 'Chat', '進度': 'Progress', '檔案': 'Files',
  '找人：名牌、內容、專案…': 'Find: name, content, project…', '在哪裡開工？': 'Where to start?', '在這裡開始': 'Start here',
};

export function t(s, vars) {
  let r = LANG === 'en' ? (EN[s] ?? s) : s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return r;
}

// 整頁換一次：文字節點、title、placeholder（只換整段剛好在表上的）
export function translateDom(root = document.body) {
  if (LANG === 'zh') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const k = n.nodeValue.trim();
    if (k && EN[k]) n.nodeValue = n.nodeValue.replace(k, EN[k]);
  }
  for (const el of root.querySelectorAll('[title], [placeholder]')) {
    for (const a of ['title', 'placeholder']) { const v = el.getAttribute(a); if (v && EN[v]) el.setAttribute(a, EN[v]); }
  }
  document.documentElement.lang = 'en';
}
