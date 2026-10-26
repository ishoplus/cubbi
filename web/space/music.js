// 背景音樂：三首自己合成的循環曲（music/，原創、跟專案同授權），輪流放。跟音效分開，各自一個開關，預設關。
// 開關記在 localStorage；瀏覽器規定要點過頁面才能出聲，打開開關那一下就是那次點擊。
//
// 接縫：每個檔案是「一整圈＋開頭 1 秒」。mp3 解碼時前面會多出一小段靜音（長短看瀏覽器），
// 所以不從 0 循環，而是從 0.5 秒起、循環一整圈長度：不管多出多少（小於 0.5 秒），這段都剛好是完整的一圈，接起來不會斷。
// 有人舉手等你或卡住時，音樂壓低，讓提醒聲聽得清楚；沒事了再慢慢回來。

const TRACKS = [   // loop：一圈的長度，用原始檔的取樣數算才精確（差幾毫秒接縫就會喀一聲）
  { file: 'bouncy_marimba.mp3', loop: 3024000 / 44100 },
  { file: 'sunny_ukulele.mp3', loop: 2919724 / 44100 },
  { file: 'tropical_breeze.mp3', loop: 3320471 / 44100 },
];
const LOOP_AT = 0.5;
const ROUNDS = 3;          // 每首放三圈（三分多鐘）再換下一首
const VOL = 0.32, VOL_SOFT = 0.22, DUCK = 0.25;   // DUCK：壓低時剩原本的幾成

let ctx = null, master = null, duckGain = null;
let on = localStorage.getItem('space_music') === '1';
let soft = false, ducked = false;
let idx = Math.floor(Math.random() * TRACKS.length);
let cur = null, timer = null;
const buffers = new Map();

export const musicOn = () => on;
export function setMusicSoft(v) { soft = v; }

export function setMusic(v) {
  on = v;
  localStorage.setItem('space_music', v ? '1' : '0');
  if (v) start(); else stop();
}

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    duckGain = ctx.createGain(); duckGain.gain.value = ducked ? DUCK : 1;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(duckGain); duckGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

async function load(i) {
  if (!buffers.has(i)) {
    buffers.set(i, fetch(new URL(`./music/${TRACKS[i].file}`, import.meta.url))
      .then(r => r.arrayBuffer()).then(b => ensure().decodeAudioData(b))
      .catch(e => { buffers.delete(i); throw e; }));
  }
  return buffers.get(i);
}

// 慢慢調到目標音量（換曲、開關、壓低都走這裡，不會突然大聲或突然斷）
function ramp(param, to, sec) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + sec);
}

async function playTrack(i, fade) {
  let buf;
  try { buf = await load(i); } catch { return; }
  if (!on) return;
  const c = ensure();
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf; src.loop = true;
  src.loopStart = LOOP_AT; src.loopEnd = LOOP_AT + TRACKS[i].loop;
  g.gain.value = 0; src.connect(g); g.connect(master);
  src.start();
  ramp(g.gain, 1, fade);
  if (cur) { const old = cur; ramp(old.g.gain, 0, fade); setTimeout(() => { try { old.src.stop(); } catch {} }, fade * 1000 + 100); }
  cur = { src, g };
  clearTimeout(timer);
  timer = setTimeout(() => { idx = (idx + 1) % TRACKS.length; playTrack(idx, 6); }, (LOOP_AT + TRACKS[i].loop * ROUNDS - 3) * 1000);
  load((i + 1) % TRACKS.length).catch(() => {});   // 下一首先載好
}

function start() {
  ensure();
  ramp(master.gain, soft ? VOL_SOFT : VOL, 4);   // 淡入
  if (!cur) playTrack(idx, 0.01);
}

function stop() {
  if (!ctx) return;
  clearTimeout(timer);
  ramp(master.gain, 0, 1.5);   // 淡出後才真的停
  const old = cur; cur = null;
  if (old) { ramp(old.g.gain, 0, 1.5); setTimeout(() => { try { old.src.stop(); } catch {} }, 1600); }
}

// 有沒有人在等你：有就壓低，沒有就回來（回來得比壓下去慢）
export function duckMusic(v) {
  if (v === ducked) return;
  ducked = v;
  if (ctx) ramp(duckGain.gain, v ? DUCK : 1, v ? 0.8 : 3);
}

if (on) {
  // 上次開著：等使用者第一次點頁面再開始（瀏覽器規定）
  const go = () => { removeEventListener('pointerdown', go); if (on) start(); };
  addEventListener('pointerdown', go);
}
