// 畫在 canvas 上的貼圖：小人的臉與個人特徵、職業印花、螢幕畫面
import { canvasTex, hash } from './bricks.js';

// 臉：表情＋個人特徵（眼鏡、鬍子、雀斑、眼罩）。鬍子和雀斑先畫、表情疊上去、眼鏡眼罩最後蓋
// blink：閉眼那一下（眼睛畫成一條弧線，嘴照原本的表情）
export function faceTex(expr, ft = {}, blink = false) {
  const key = `face:${expr}${blink ? ':b' : ''}:${ft.glasses || 0}${ft.beard || 0}${ft.freckles ? 1 : 0}${ft.patch ? 1 : 0}:${ft.beardColor || ''}`;
  return canvasTex(key, 256, 256, (g) => {
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (ft.beard === 1) {   // 鬍渣
      g.fillStyle = 'rgba(60,40,20,.35)';
      for (let i = 0; i < 70; i++) { const a = Math.PI * (0.1 + 0.8 * ((i * 37) % 70) / 70), r = 70 + (i * 13) % 40; g.fillRect(128 + Math.cos(a) * r, 120 + Math.sin(a) * r * 0.9, 3, 3); }
    } else if (ft.beard === 2) {   // 落腮鬍
      g.fillStyle = ft.beardColor || '#4a2c12';
      g.beginPath(); g.moveTo(34, 120); g.quadraticCurveTo(40, 236, 128, 246); g.quadraticCurveTo(216, 236, 222, 120);
      g.quadraticCurveTo(200, 150, 168, 152); g.quadraticCurveTo(128, 136, 88, 152); g.quadraticCurveTo(56, 150, 34, 120); g.fill();
    } else if (ft.beard === 3) {   // 巫師的長白鬍子
      g.fillStyle = '#f4f4f4';
      g.beginPath(); g.moveTo(40, 126); g.quadraticCurveTo(50, 256, 128, 256); g.quadraticCurveTo(206, 256, 216, 126);
      g.quadraticCurveTo(170, 160, 128, 146); g.quadraticCurveTo(86, 160, 40, 126); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 3;
      for (const x of [90, 128, 166]) { g.beginPath(); g.moveTo(x, 190); g.lineTo(x + (x - 128) * 0.2, 246); g.stroke(); }
    }
    if (ft.freckles) {
      g.fillStyle = 'rgba(150,80,20,.55)';
      for (const [x, y] of [[66, 140], [78, 150], [62, 156], [190, 140], [178, 150], [194, 156]]) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = '#1b1b1b'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 9;
    const eye = (x, y) => {
      if (blink) { g.save(); g.lineWidth = 7; g.beginPath(); g.arc(x, y - 4, 12, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); g.restore(); return; }
      g.beginPath(); g.ellipse(x, y, 11, 15, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 3, y - 5, 4, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1b1b1b';
    };
    if (expr === 'sleep') {
      for (const x of [92, 164]) { g.beginPath(); g.arc(x, 112, 14, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      g.beginPath(); g.arc(128, 168, 8, 0, Math.PI * 2); g.lineWidth = 6; g.stroke();
    } else if (expr === 'happy') {
      for (const x of [92, 164]) { g.beginPath(); g.arc(x, 120, 14, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
      g.beginPath(); g.moveTo(74, 86); g.quadraticCurveTo(92, 74, 110, 84); g.moveTo(146, 84); g.quadraticCurveTo(164, 74, 182, 86); g.lineWidth = 7; g.stroke();
      // 張嘴大笑，露出一排白牙
      g.beginPath(); g.moveTo(92, 146); g.quadraticCurveTo(128, 205, 164, 146); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.fillRect(100, 148, 56, 9); g.fillStyle = '#1b1b1b';
    } else {
      eye(92, 112); eye(164, 112);
      g.lineWidth = 7;
      if (expr === 'focus') {
        g.beginPath(); g.moveTo(72, 82); g.lineTo(108, 90); g.moveTo(184, 82); g.lineTo(148, 90); g.stroke();
        g.beginPath(); g.moveTo(108, 168); g.lineTo(148, 166); g.lineWidth = 8; g.stroke();
      } else if (expr === 'open') {
        g.beginPath(); g.arc(92, 78, 16, 1.2 * Math.PI, 1.8 * Math.PI); g.moveTo(180, 72); g.arc(164, 78, 16, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke();
        g.beginPath(); g.ellipse(128, 166, 14, 18, 0, 0, Math.PI * 2); g.fill();
      } else if (expr === 'worry') {
        g.beginPath(); g.moveTo(74, 90); g.lineTo(108, 80); g.moveTo(182, 90); g.lineTo(148, 80); g.stroke();
        g.beginPath(); g.arc(128, 190, 26, 1.2 * Math.PI, 1.8 * Math.PI); g.lineWidth = 8; g.stroke();
      } else {
        g.beginPath(); g.moveTo(74, 84); g.quadraticCurveTo(92, 72, 110, 82); g.moveTo(146, 82); g.quadraticCurveTo(164, 72, 182, 84); g.lineWidth = 7; g.stroke();
        g.beginPath(); g.arc(128, 138, 38, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = 8; g.stroke();
        g.lineWidth = 4; g.beginPath(); g.arc(88, 150, 8, 1.3 * Math.PI, 1.75 * Math.PI); g.moveTo(176, 146); g.arc(168, 150, 8, 1.25 * Math.PI, 1.7 * Math.PI); g.stroke();
      }
    }
    if (ft.glasses) {
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 6;
      for (const x of [92, 164]) {
        g.beginPath();
        if (ft.glasses === 1) g.arc(x, 114, 24, 0, Math.PI * 2); else g.roundRect(x - 26, 94, 52, 40, 8);
        g.stroke();
      }
      g.beginPath(); g.moveTo(116, 110); g.quadraticCurveTo(128, 102, 140, 110); g.moveTo(66, 108); g.lineTo(30, 100); g.moveTo(190, 108); g.lineTo(226, 100); g.stroke();
    }
    if (ft.patch) {
      g.fillStyle = '#1b1b1b'; g.beginPath(); g.ellipse(164, 114, 24, 22, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 5; g.beginPath(); g.moveTo(144, 100); g.lineTo(40, 70); g.moveTo(184, 102); g.lineTo(228, 92); g.stroke();
    }
  });
}

// 胸前印花：每種職業一張
export function printTex(key, accent) {
  return canvasTex(`print:${key}:${accent}`, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const draw = PRINTS[key];
    if (draw) draw(g, accent);
  });
}
export const lapels = (g, color, open = 60) => {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(128 - open, 0); g.lineTo(118, 120); g.lineTo(90, 70); g.lineTo(60, 0); g.fill();
  g.beginPath(); g.moveTo(128 + open, 0); g.lineTo(138, 120); g.lineTo(166, 70); g.lineTo(196, 0); g.fill();
};
export const buttons = (g, xs, color = '#1b1b1b') => { g.fillStyle = color; for (const x of xs) for (const y of [140, 180, 220]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); } };
export const PRINTS = {
  engineer(g) {   // 連帽 T：口袋、帽繩、工作證
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.roundRect(56, 170, 144, 70, 18); g.fill();
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 5; g.beginPath(); g.moveTo(108, 0); g.lineTo(104, 70); g.moveTo(148, 0); g.lineTo(152, 70); g.stroke();
    g.strokeStyle = '#c91a09'; g.lineWidth = 4; g.beginPath(); g.moveTo(90, 0); g.lineTo(128, 110); g.lineTo(166, 0); g.stroke();
    g.fillStyle = '#f4f4f4'; g.fillRect(110, 106, 36, 46); g.fillStyle = '#0055bf'; g.fillRect(116, 112, 24, 12); g.fillStyle = '#9aa6b1'; g.fillRect(116, 130, 24, 4); g.fillRect(116, 138, 18, 4);
  },
  reporter(g) {   // 風衣翻領、腰帶、相機背帶
    lapels(g, 'rgba(0,0,0,.18)'); g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(100, 0); g.lineTo(128, 60); g.lineTo(156, 0); g.fill();
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 196, 256, 20); g.fillStyle = '#c9a227'; g.fillRect(116, 192, 24, 28);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 8; g.beginPath(); g.moveTo(40, 0); g.lineTo(128, 120); g.stroke();
  },
  writer(g, a) {   // 毛衣麻花紋＋襯衫領＋胸口的筆
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(92, 0); g.lineTo(128, 50); g.lineTo(164, 0); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 6;
    for (const x of [70, 128, 186]) { g.beginPath(); for (let y = 60; y < 256; y += 28) { g.moveTo(x - 10, y); g.quadraticCurveTo(x + 14, y + 14, x - 10, y + 28); } g.stroke(); }
    g.fillStyle = a; g.fillRect(180, 60, 8, 50); g.fillStyle = '#c9a227'; g.fillRect(180, 56, 8, 8);
  },
  trader(g) {   // 白襯衫、西裝背心、紅領帶
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(84, 0); g.lineTo(172, 0); g.lineTo(150, 256); g.lineTo(106, 256); g.fill();
    g.fillStyle = '#c91a09'; g.beginPath(); g.moveTo(118, 10); g.lineTo(138, 10); g.lineTo(144, 150); g.lineTo(128, 170); g.lineTo(112, 150); g.fill();
    buttons(g, [96, 160], '#c9a227');
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4; g.strokeRect(60, 120, 40, 4); g.strokeRect(156, 120, 40, 4);
  },
  catkeeper(g) {   // 圍裙＋貓掌印
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.roundRect(54, 90, 148, 166, 20); g.fill();
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 8; g.beginPath(); g.moveTo(70, 0); g.lineTo(80, 96); g.moveTo(186, 0); g.lineTo(176, 96); g.stroke();
    g.fillStyle = '#e4adc8'; g.beginPath(); g.arc(128, 176, 22, 0, Math.PI * 2); g.fill();
    for (const [x, y] of [[100, 140], [120, 128], [144, 128], [164, 140]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  },
  hunter(g) {   // 皮甲：斜背帶、腰帶扣、縫線
    g.fillStyle = '#7c4a1e'; g.beginPath(); g.moveTo(30, 0); g.lineTo(60, 0); g.lineTo(226, 210); g.lineTo(196, 230); g.fill();
    g.fillStyle = '#5a3210'; g.fillRect(0, 196, 256, 26); g.fillStyle = '#c9a227'; g.fillRect(112, 190, 32, 38); g.fillStyle = '#5a3210'; g.fillRect(120, 198, 16, 22);
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.setLineDash([8, 8]); g.lineWidth = 3; g.strokeRect(20, 30, 216, 150); g.setLineDash([]);
  },
  butler(g) {   // 燕尾服：白襯衫、黑翻領、紅領結
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(70, 0); g.lineTo(186, 0); g.lineTo(140, 256); g.lineTo(116, 256); g.fill();
    lapels(g, '#0e1418', 70);
    g.fillStyle = '#c91a09'; g.beginPath(); g.moveTo(128, 30); g.lineTo(96, 14); g.lineTo(96, 46); g.closePath(); g.moveTo(128, 30); g.lineTo(160, 14); g.lineTo(160, 46); g.closePath(); g.fill();
    buttons(g, [128]);
  },
  chef(g) {   // 雙排扣＋立領
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(70, 0, 116, 24);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 4; g.beginPath(); g.moveTo(150, 24); g.lineTo(150, 256); g.stroke();
    buttons(g, [104, 176], '#1b2a34');
    g.fillStyle = '#c91a09'; g.fillRect(40, 60, 30, 6);
  },
  astronaut(g) {   // 胸前控制面板＋任務徽章
    g.fillStyle = '#a0a5a9'; g.beginPath(); g.roundRect(70, 100, 116, 80, 10); g.fill();
    for (const [x, c] of [[90, '#c91a09'], [118, '#f2cd37'], [146, '#237841'], [168, '#0055bf']]) { g.fillStyle = c; g.beginPath(); g.arc(x, 124, 8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#1b2a34'; g.fillRect(84, 146, 88, 20);
    g.fillStyle = '#0055bf'; g.beginPath(); g.arc(70, 46, 22, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(70, 30); g.lineTo(80, 58); g.lineTo(60, 58); g.fill();
  },
  firefighter(g) {   // 反光條
    for (const y of [150, 210]) { g.fillStyle = '#f2cd37'; g.fillRect(0, y, 256, 20); g.fillStyle = '#d7dde2'; g.fillRect(0, y + 7, 256, 6); }
    for (const x of [64, 192]) { g.fillStyle = '#f2cd37'; g.fillRect(x - 10, 0, 20, 150); g.fillStyle = '#d7dde2'; g.fillRect(x - 3, 0, 6, 150); }
  },
  doctor(g) {   // 白袍翻領＋聽診器＋口袋插筆
    lapels(g, 'rgba(0,0,0,.1)'); g.fillStyle = '#6fb3e0'; g.beginPath(); g.moveTo(100, 0); g.lineTo(128, 60); g.lineTo(156, 0); g.fill();
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 6; g.beginPath(); g.moveTo(96, 0); g.quadraticCurveTo(80, 120, 120, 150); g.moveTo(160, 0); g.quadraticCurveTo(176, 110, 140, 150); g.stroke();
    g.fillStyle = '#a0a5a9'; g.beginPath(); g.arc(130, 160, 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 4; g.strokeRect(160, 100, 44, 40); g.fillStyle = '#0055bf'; g.fillRect(170, 86, 5, 24); g.fillStyle = '#c91a09'; g.fillRect(182, 90, 5, 20);
  },
  wizard(g) {   // 星星月亮＋繩腰帶
    g.fillStyle = '#f2cd37';
    const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
    star(70, 70, 22); star(180, 120, 16); star(100, 160, 12);
    g.beginPath(); g.arc(186, 56, 22, 0, Math.PI * 2); g.fill(); g.fillStyle = '#4b2e8a'; g.beginPath(); g.arc(196, 50, 20, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9a227'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 206); g.lineTo(256, 206); g.moveTo(150, 206); g.lineTo(140, 250); g.stroke();
  },
  pirate(g) {   // 條紋衫＋黑背心＋金扣腰帶
    g.fillStyle = '#f4f4f4'; g.fillRect(70, 0, 116, 256);
    g.fillStyle = '#c91a09'; for (let y = 10; y < 256; y += 36) g.fillRect(70, y, 116, 16);
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 76, 256); g.fillRect(180, 0, 76, 256);
    g.fillStyle = '#5a3210'; g.fillRect(0, 200, 256, 24); g.fillStyle = '#c9a227'; g.fillRect(112, 194, 32, 36);
  },
  builder(g) {   // 橘色反光背心
    g.fillStyle = '#fe8a18'; g.fillRect(30, 0, 70, 256); g.fillRect(156, 0, 70, 256); g.fillRect(30, 120, 196, 136);
    g.fillStyle = '#d7dde2'; g.fillRect(30, 150, 196, 14); g.fillRect(30, 200, 196, 14); g.fillRect(50, 0, 14, 150); g.fillRect(192, 0, 14, 150);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4; g.strokeRect(140, 60, 40, 36);
  },
  detective(g) {   // 風衣＋格紋領巾
    lapels(g, 'rgba(0,0,0,.2)', 70);
    g.fillStyle = '#720e0f'; g.beginPath(); g.moveTo(98, 0); g.lineTo(128, 70); g.lineTo(158, 0); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 3; for (const x of [112, 128, 144]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 40); g.stroke(); }
    buttons(g, [90, 166], '#3a2a1a'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 196, 256, 18);
  },
  police(g) {   // 金色警徽、口袋蓋、領帶
    g.fillStyle = '#7fa7cf'; g.beginPath(); g.moveTo(98, 0); g.lineTo(128, 40); g.lineTo(158, 0); g.fill();
    g.fillStyle = '#0e1d33'; g.beginPath(); g.moveTo(120, 20); g.lineTo(136, 20); g.lineTo(140, 140); g.lineTo(128, 156); g.lineTo(116, 140); g.fill();
    g.fillStyle = '#c9a227'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 20; g.lineTo(70 + Math.cos(a) * r, 80 + Math.sin(a) * r); } g.fill();
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 4; g.strokeRect(160, 60, 50, 30);
  },
  scientist(g) {   // 實驗袍：翻領、口袋三支筆
    lapels(g, 'rgba(0,0,0,.1)'); g.fillStyle = '#237841'; g.beginPath(); g.moveTo(100, 0); g.lineTo(128, 60); g.lineTo(156, 0); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 4; g.strokeRect(54, 110, 50, 44);
    for (const [x, c] of [[62, '#c91a09'], [74, '#0055bf'], [86, '#237841']]) { g.fillStyle = c; g.fillRect(x, 92, 6, 28); }
    buttons(g, [150], '#a0a5a9');
  },
  painter(g) {   // 罩衫上的顏料點
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, 256, 30);
    for (const [x, y, r, c] of [[60, 80, 16, '#c91a09'], [180, 60, 12, '#0055bf'], [140, 150, 20, '#f2cd37'], [80, 200, 14, '#237841'], [196, 190, 10, '#923978'], [110, 110, 8, '#fe8a18']]) {
      g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.arc(x + r * 0.8, y + r * 0.5, r * 0.5, 0, Math.PI * 2); g.fill();
    }
  },
  painter2(g) {   // 外包畫師：深色西裝翻領、青綠領帶、別在胸口的訪客證
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(84, 0); g.lineTo(172, 0); g.lineTo(146, 256); g.lineTo(110, 256); g.fill();
    g.fillStyle = '#10a37f'; g.beginPath(); g.moveTo(118, 10); g.lineTo(138, 10); g.lineTo(144, 150); g.lineTo(128, 170); g.lineTo(112, 150); g.fill();
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(60, 0); g.lineTo(112, 120); g.lineTo(84, 70); g.lineTo(40, 0); g.fill();
    g.beginPath(); g.moveTo(196, 0); g.lineTo(144, 120); g.lineTo(172, 70); g.lineTo(216, 0); g.fill();
    g.fillStyle = '#f4f4f4'; g.fillRect(168, 92, 52, 40); g.fillStyle = '#10a37f'; g.fillRect(168, 92, 52, 11);
    g.fillStyle = '#1b2a34'; g.fillRect(176, 110, 36, 5); g.fillRect(176, 120, 26, 5);
  },
  courier(g) {   // 快遞：黃條紋＋紙箱標誌
    g.fillStyle = '#f2cd37'; g.fillRect(0, 100, 256, 20);
    g.fillStyle = '#c49a6c'; g.fillRect(150, 30, 56, 44); g.strokeStyle = '#7c4a1e'; g.lineWidth = 5; g.beginPath(); g.moveTo(150, 46); g.lineTo(206, 46); g.moveTo(178, 30); g.lineTo(178, 46); g.stroke();
  },
  athlete(g) {   // 球衣號碼＋側邊條
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 26, 256); g.fillRect(230, 0, 26, 256);
    g.fillStyle = '#f4f4f4'; g.font = 'bold 130px sans-serif'; g.textAlign = 'center'; g.fillText('7', 128, 190);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.moveTo(90, 0); g.quadraticCurveTo(128, 40, 166, 0); g.fill();
  },
};
// 螢幕：每種工作一個畫面，程式碼/終端機的會往上捲
export const SCREENS = {
  code: ['#16325c', ['#7fb2ff', '#ffd27f', '#9ee6a8', '#ffffff']],
  term: ['#0d1a12', ['#58e07a', '#58e07a', '#b9f5c6']],
  page: ['#f4f6f8', ['#9aa6b1', '#c3cbd3']],
  web: ['#1e88d4', null], agent: ['#4b2e8a', null], plan: ['#f7f1dc', null],
  ask: ['#ff8a1f', null], idle: ['#25313d', null], off: ['#111418', null], think: ['#33475b', null],
  ext: ['#3b2b63', ['#b9a3ff', '#ffffff']], err: ['#5c1414', null], game: ['#5aa6e8', null], arcade: ['#05060f', null],
};
export function screenTex(kind) {
  return canvasTex('screen:' + kind, 128, 128, (g, w, h) => {
    const [bg, lines] = SCREENS[kind];
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (lines) {
      for (let y = 6, i = 0; y < h; y += 10, i++) {
        const ind = (hash(kind + i) % 4) * 8, len = 20 + hash(i + kind) % 70;
        g.fillStyle = lines[i % lines.length]; g.globalAlpha = 0.85;
        g.fillRect(8 + ind, y, Math.min(len, w - 16 - ind), 4);
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round';
    if (kind === 'web') {
      g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.moveTo(30, 64); g.lineTo(98, 64);
      g.moveTo(64, 30); g.bezierCurveTo(40, 50, 40, 78, 64, 98); g.moveTo(64, 30); g.bezierCurveTo(88, 50, 88, 78, 64, 98); g.lineWidth = 4; g.stroke();
    } else if (kind === 'agent') {
      for (const [x, s] of [[40, 1], [88, 1], [64, 1.3]]) { g.beginPath(); g.arc(x, 52, 10 * s, 0, Math.PI * 2); g.fill(); g.fillRect(x - 13 * s, 68, 26 * s, 22 * s); }
    } else if (kind === 'plan') {
      g.strokeStyle = '#c99a18';
      for (let i = 0; i < 4; i++) { g.strokeRect(22, 22 + i * 24, 14, 14); g.fillStyle = '#9aa6b1'; g.fillRect(46, 27 + i * 24, 56, 5); }
      g.beginPath(); g.moveTo(24, 30); g.lineTo(29, 35); g.lineTo(38, 22); g.moveTo(24, 54); g.lineTo(29, 59); g.lineTo(38, 46); g.stroke();
    } else if (kind === 'ask') {
      g.fillRect(56, 22, 16, 56); g.beginPath(); g.arc(64, 98, 9, 0, Math.PI * 2); g.fill();
    } else if (kind === 'idle') {
      g.fillStyle = '#6fd18f'; g.fillRect(20, 92, 22, 6);
    } else if (kind === 'think') {
      g.fillStyle = '#c3d4e6'; for (const x of [40, 64, 88]) { g.beginPath(); g.arc(x, 64, 7, 0, Math.PI * 2); g.fill(); }
    } else if (kind === 'arcade') {   // 大型電玩：太空射擊的展示畫面
      g.fillStyle = '#ffffff'; for (let i = 0; i < 40; i++) g.fillRect((i * 37) % 128, (i * 53) % 128, 1.5, 1.5);
      const alien = ['#ff4fd8', '#4fe0ff', '#9dff4f'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
        const x = 14 + c * 18, y = 14 + r * 14;
        g.fillStyle = alien[r]; g.fillRect(x, y, 10, 7); g.fillRect(x - 2, y + 4, 2, 4); g.fillRect(x + 10, y + 4, 2, 4);
        g.fillStyle = '#05060f'; g.fillRect(x + 2, y + 2, 2, 2); g.fillRect(x + 6, y + 2, 2, 2);
      }
      g.fillStyle = '#ffe14f'; for (const [x, y] of [[62, 80], [62, 64], [40, 60]]) g.fillRect(x, y, 2, 7);
      g.fillStyle = '#4fff7a'; g.beginPath(); g.moveTo(63, 98); g.lineTo(54, 112); g.lineTo(72, 112); g.fill();
      g.fillStyle = '#ff4f4f'; g.fillRect(4, 120, 30, 4); g.fillStyle = '#ffffff'; g.fillRect(94, 120, 30, 4);
    } else if (kind === 'game') {
      g.fillStyle = '#4b9f4a'; g.fillRect(0, 96, w, 32); g.fillStyle = '#7c4a1e'; g.fillRect(0, 112, w, 16);
      g.fillStyle = '#c47a3a'; g.fillRect(70, 60, 36, 10);
      g.fillStyle = '#c91a09'; g.fillRect(30, 76, 14, 20); g.fillStyle = '#f2cd37'; g.fillRect(32, 70, 10, 8);
      g.fillStyle = '#ffd36b'; for (const x of [76, 88, 100]) { g.beginPath(); g.arc(x, 48, 4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#f4f4f4'; g.fillRect(14, 16, 26, 8); g.fillRect(84, 24, 30, 8);
    } else if (kind === 'err') {
      g.lineWidth = 10; g.beginPath(); g.moveTo(40, 40); g.lineTo(88, 88); g.moveTo(88, 40); g.lineTo(40, 88); g.stroke();
    }
  });
}

