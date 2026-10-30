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
  '茶水間': 'Pantry', '咖啡吧': 'Coffee bar', '休息區': 'Lounge', '遊戲角': 'Game corner', '健身角': 'Gym corner', '水族箱': 'Aquarium', '樂團角': 'Band corner', '員工餐廳': 'Cafeteria', '午睡艙': 'Nap pods', '高爾夫練習區': 'Golf area', '會議室': 'Meeting room', '等你本人辦': 'Needs you in person', '等你決定：{name}': 'Needs your call: {name}',
  '白板': 'Whiteboard', '統計電視': 'Stats TV', '整面看板': 'Full-wall display',
  '獎盃架': 'Trophies', '共用工作桌': 'Hot desks', '窗邊': 'Windows',
  '在這裡開新對話': 'New session here',
  '公司升級：{name}！': 'Office upgraded: {name}!', '升上{name}，大家來慶祝！': 'We made it to {name} — party time!',
  '週五下班前，休息區開派對！': 'Friday wind-down party in the lounge!',
  '萬聖節快樂！辦公室掛上南瓜燈了': 'Happy Halloween! Pumpkins are up.',
  '聖誕快樂！窗邊多了一棵聖誕樹': 'Merry Christmas! There’s a tree by the window.',
  '新年快樂！門口貼上春聯了': 'Happy Lunar New Year! Couplets are on the door.',
  '跨年快樂！午夜窗外有煙火': 'Happy New Year’s Eve! Fireworks outside at midnight.',
  '端午節快樂！門口掛上艾草了': 'Happy Dragon Boat Festival! Mugwort is up by the door.',
  '中秋節快樂！今晚窗外是滿月': 'Happy Mid-Autumn Festival! Full moon outside tonight.',
  // 鏡頭與區域
  '停止跟拍': 'Stop following', '跟拍：他走到哪鏡頭跟到哪': 'Follow: the camera tracks them',
  '跟拍中：他走到哪鏡頭跟到哪': 'Following — the camera tracks them',
  '跟拍{name}：牠走到哪鏡頭跟到哪': 'Following {name} — the camera tracks the cat', '跟拍中': ' · following', '點一下跟拍': ' · click to follow', '跟拍這隻貓': 'Follow this cat',
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
  '最近的步驟': 'Recent steps', '成品': 'Deliverable',
  '等你處理': 'Your inbox', '叫進主管室報告': 'Call into your office to report', '報告': 'Report', '主管室': 'Your office',
  '報告完了，回座位': 'Done — back to desk', '{name}正在忙，報告先看這裡': '{name} is busy — here’s the report', '他': 'They',
  '主管室站滿了，先讓一位回座位': 'Your office is full — send someone back first',
  '請用三句話向我報告：做了什麼、卡在哪、下一步打算做什麼。': 'In three sentences, report to me: what you did, where you’re stuck, and what you’ll do next.',
  '交代的事': 'Task', '狀態': 'Status', '好像卡住了': 'Looks stuck', '待辦': 'To-dos', '已驗收': 'Accepted', '改過的檔案': 'Files changed',
  '最後說的話': 'Last words', '請他口頭報告': 'Ask for a spoken report', '回座位': 'Back to desk',
  '口頭報告會請他用一輪對話回答，答完會出現在對話裡。': 'A spoken report takes one turn; the answer shows up in the chat.',
  '已請他報告': 'Asked for a report', '交件：{name}': 'Delivered: {name}', '交了分支：{name}': 'Branch ready: {name}', '新提案：{name}': 'New idea: {name}', '意外結束': 'Stopped unexpectedly', '任務等你處理': 'A task needs you', '做完了': 'Done', '沒有要處理的事': 'Nothing needs you',
  '座位表': 'Floor plan', '{n} 人': '{n} people', '還沒有部門': 'No departments yet', '找部門：名字、專案、人…': 'Find a department: name, project, person…', '找不到這個部門': 'No matching department', '等你': 'needs you', '剛去過': 'recent', '忙碌中': 'busy',
  '員工名冊': 'Staff', '找人：名字、專案…': 'Find someone: name, project…', '在主管室': 'In your office', '找不到人': 'No one found',
  '滿意': 'Accept', '再改': 'Revise', '要改哪裡？直接說…': 'What should change? Just say…', '還沒有紀錄': 'Nothing yet', '上一層': 'Up', '空的': 'Empty', '返回': 'Back', '開新分頁': 'Open in new tab', '以前的成品': 'Earlier deliverables', '這個檔案已經不在了': 'This file is gone', '回到這一輪': 'Back to this round',
  '檔案太大，請開新分頁或下載': 'File too large — open in a new tab or download', '二進位檔案，請開新分頁或下載': 'Binary file — open in a new tab or download',
  '最近的專案': 'Recent projects',
  '在終端機接著聊：': 'Continue in your terminal:', '已複製': 'Copied', '複製': 'Copy',
  // 音效、天氣、回放
  '關掉音效': 'Mute', '打開音效': 'Unmute', '關掉音樂': 'Music off', '打開音樂': 'Music on',
  '晴': 'Clear', '多雲': 'Cloudy', '起霧': 'Fog', '下雨': 'Rain', '雷雨': 'Thunderstorm', '下雪': 'Snow',
  '昨天': 'yesterday', '明天': 'tomorrow', '外面': 'Outside', '{place}現在：{w}': '{place} now: {w}',
  '讀不到今天的紀錄': 'Couldn’t load today’s history', '今天還沒有可以回放的紀錄': 'Nothing to replay yet today',
  '回放完畢': 'Replay finished', '回到現在': 'Back to now', '回放 {t}': 'Replay {t}',
  // 歸檔、搜尋、快速回覆
  '他正在忙，等他做完再歸檔': 'Busy right now — archive after they finish', '歸檔失敗': 'Couldn’t archive', '已歸檔：{name}': 'Archived: {name}', '復原': 'Undo',
  '找不到': 'No matches', '他在等你回答，先回答再交代': 'They’re waiting on you — answer first',
  '這段對話正在終端機執行，從這裡送出會另開一個進程接著講，兩邊可能互相干擾。確定要送？': 'This session is running in a terminal. Sending here starts a second process and the two may conflict. Send anyway?',
  '連線失敗': 'Connection failed',
  '先選一個人': 'Pick someone first',
  '離開視角': 'Leave POV', '他的視角：鏡頭戴在他頭上（V）': 'Their POV: strap the camera to their head (V)', '回到平常的鏡頭（Esc）': 'Back to the normal camera (Esc)',
  // Codex 外包
  '{t} 重置': 'resets {t}', 'Codex 額度（{plan}）': 'Codex usage ({plan})', '5 小時：已用 {p}%，{reset}': '5-hour: {p}% used, {reset}',
  '每週：已用 {p}%，{reset}': 'Weekly: {p}% used, {reset}', '（{t} 最後一次執行時的數字）': '(as of the last run at {t})',
  'Codex 5 小時額度已用 {p}%，{reset}': 'Codex 5-hour usage at {p}%, {reset}', '5 小時': '5 hours', '每週': 'Weekly', 'Codex 額度': 'Codex usage',
  'ChatGPT {plan} 方案 · 數字來自 {t} Codex 最後一次執行': 'ChatGPT {plan} plan · numbers from the last Codex run at {t}',
  'Claude 額度': 'Claude usage', '（{t} 最後一次回應時的數字）': '(as of the last reply at {t})', 'Claude 5 小時額度已用 {p}%，{reset}': 'Claude 5-hour usage at {p}%, {reset}',
  '數字來自 {t} Claude Code 最後一次回應': 'Numbers from the last Claude Code reply at {t}',
  'Grok 額度': 'Grok usage', '（{n} 小時前的數字）': ' ({n}h old)', '（{n} 天前的數字，在 Grok Bot 打開用量頁會更新）': ' ({n}d old; open the usage page in Grok Bot to refresh)',
  '{plan} 方案 · 數字來自 {t} Grok Bot 桌面版最後一次更新': '{plan} plan · numbers from the last Grok Bot desktop update at {t}',
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
  '廚房': 'Kitchen', '咖啡師': 'Barista', '太空部': 'Space', '消防隊': 'Fire crew', '醫務室': 'Clinic', '魔法部': 'Magic', '海盜船': 'Pirates', '工務部': 'Builders',
  'Codex': 'Codex', '你': 'You', '偵探社': 'Detectives', '警察局': 'Police', '研究所': 'Lab', '美術部': 'Art', '快遞': 'Courier', '體育部': 'Sports',
  // 自動成長
  '車庫新創': 'Garage startup', '小工作室': 'Small studio', '正式辦公室': 'Real office', '整層樓': 'Whole floor', '總部大樓': 'Headquarters',
  '紙箱和舊電腦，夢想從這裡開始': 'Cardboard boxes and old computers — where it all starts', '咖啡機、牆上的統計電視': 'Coffee machine, stats TV on the wall',
  '會議室、休息區、遊戲角、共用工作桌': 'Meeting room, lounge, game corner, hot desks', '咖啡師、按摩椅、桌球與大型電玩、辦公室貓、窗邊的跑步機、魚缸、吉他': 'Barista, massage chairs, ping-pong & arcade, an office cat, treadmills by the window, a fish tank, a guitar',
  '大廳 logo 牆、整面看板、三隻貓、整面水族牆、飛輪、爵士鼓、員工餐廳、午睡艙、高爾夫練習區': 'Lobby logo wall, big dashboard, three cats, an aquarium wall, spin bikes, a drum kit, a staff cafeteria, nap pods, a golf practice area',
  '第一位同事': 'First helper', '全勤一週': '7-day streak', '高產的一天': '50 turns in a day', '百次提交': '100 commits', '全勤一個月': '30-day streak', '一萬個回合': '10,000 turns', '總部落成': 'HQ opened',
  '回顧紀錄中…': 'Looking back…', '照你真實的工作量長大': 'Grows with the work you actually do', '回顧紀錄中… {n}/{total}': 'Looking back… {n}/{total}',
  '下一級：{name}': 'Next: {name}', '已經是最高級': 'Top level reached', '你的工作量': 'Your work', '完成的回合': 'Turns completed', 'commit': 'commits',
  '上班天數': 'Days worked', '最長連續上班': 'Longest streak (days)', '改過的檔案': 'Files edited', '每一級解鎖什麼': 'What each level unlocks', '獎盃（擺在獎盃架上）': 'Trophies (on the shelf)',
  '分數＝完成的回合＋commit×3。各部門（專案）的螢幕、椅子、桌子、地板看那個專案自己的回合數。只讀你電腦上的紀錄，不上傳。': 'Score = turns + commits×3. Each department’s monitors, chairs, desks and floor grow with that project’s own turns. Reads only local logs; nothing is uploaded.',
  // 新用戶引導
  '找不到 Claude Code 的紀錄': 'No Claude Code history found', 'Cubbi 讀的是 {dir}。先安裝並用過 Claude Code，再回來看看。': 'Cubbi reads {dir}. Install and use Claude Code, then come back.',
  '辦公室還沒有人上班': 'Nobody’s in the office yet', '在任何終端機開一段 Claude Code 對話，他就會從門口走進來：': 'Start a Claude Code session in any terminal and they’ll walk in the door:',
  '最近 3 天的對話都會出現；Cubbi 只讀你電腦上的紀錄，不上傳。': 'Sessions from the last 3 days show up. Cubbi only reads local logs and uploads nothing.',
  // HTML 裡的固定文字
  '搭積木中': 'Building', '找人': 'Find', '縮時回放今天': 'Replay today', '天氣': 'Weather', '看全景': 'Overview', '更多': 'More',
  '歸檔：從空間拿掉（之後有新動作會自動回來）': 'Archive: remove from the office (comes back on new activity)',
  '關閉': 'Close', '直接交代一句…': 'Tell them something…', '對話': 'Chat', '進度': 'Progress', '檔案': 'Files',
  '找人：名牌、內容、專案…': 'Find: name, content, project…', '在哪裡開工？': 'Where to start?', '在這裡開始': 'Start here',
};

// 外掛把自己的英文加進來（remote 的經營系統、提案白板、排程牆）
export function addEN(dict) { Object.assign(EN, dict); }

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
