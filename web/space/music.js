// 背景音樂＝點歌機。跟音效分開，各自一個開關，預設關。
// 歌單在 music/tracks.json（格式見 music/README.md）：放 mp3、加一行就上架；拿掉那一行就下架。
//   每次打開點歌機都重讀一次，加歌、下架不用重開頁面；下架的歌從待播裡拿掉，正在放的那首放完這輪才換。
//   載不到、解不開的歌標成「放不出來」，輪到它就跳過，不會卡住也不會一直重試。
// 點歌：音樂關著就直接開來放；開著就排進待播，目前這首放完才輪到。「現在放」才會馬上換。
// 換歌一律不突然：使用者換的，等目前這首的下一拍（歌單有寫 bpm 才對得準）淡出、新的隔一下淡入；
//   自動換的（放完、輪到下一首）在一圈的尾巴交叉淡入淡出。新的那首載好之前，舊的照常放，不會有空白。
// 狀態（正在放哪首、待播、播放方式）記在 localStorage，重開頁面接著放同一首；瀏覽器規定要點過頁面才能出聲。
//
// 接縫：循環曲（有 loopSamples）的檔案是「一整圈＋開頭 1 秒」。mp3 解碼時前面會多出一小段靜音（長短看瀏覽器），
// 所以不從 0 循環，而是從 0.5 秒起、循環一整圈長度：不管多出多少（小於 0.5 秒），這段都剛好是完整的一圈，接起來不會斷。
// 沒有 loopSamples 的歌（一般的歌）放到尾巴就換下一首。
// 有人舉手等你或卡住時，音樂壓低，讓提醒聲聽得清楚；沒事了再慢慢回來。

const LIB_URL = new URL('./music/tracks.json', import.meta.url);
const LOOP_AT = 0.5;
const ROUNDS = 3;            // 循環曲放三圈算「放完」，輪到下一首（單曲循環又沒人點歌就一直放）
const QUEUE_MAX = 30;
const VOL = 0.46, VOL_SOFT = 0.32, DUCK = 0.25;   // DUCK：壓低時剩原本的幾成
const AUTO_FADE = 6;                               // 自動換歌：交叉淡入淡出幾秒
const USER_OUT = 2.2, USER_GAP = 0.6, USER_IN = 2.8;   // 使用者換歌：舊的淡出、空一下、新的淡入
const MODES = ['one', 'all', 'shuffle'];           // 單曲循環、照順序、隨機
const COLORS = ['#0055bf', '#c91a09', '#f2cd37', '#237841', '#fe8a18', '#923978', '#4fb4ff'];

let ctx = null, master = null, duckGain = null;
let on = localStorage.getItem('space_music') === '1';
let soft = false, ducked = false;
let lib = [];                 // 歌單（清理過的 tracks.json）
const broken = new Set();     // 這次開頁放不出來的歌
const buffers = new Map();    // id → Promise<AudioBuffer>
let cur = null;               // { id, track, src, g, start }：正在放的（start＝ctx 時間）
let pending = null;           // 換歌中、還在載的那首
let gen = 0, endTimer = null;
const subs = new Set();
const S = loadState();        // { now, queue, mode }

function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('space_jukebox') || '{}') || {}; } catch {}
  return { now: typeof s.now === 'string' ? s.now : null, queue: Array.isArray(s.queue) ? s.queue.filter(x => typeof x === 'string') : [], mode: MODES.includes(s.mode) ? s.mode : 'all' };
}
function save() { localStorage.setItem('space_jukebox', JSON.stringify(S)); }
function emit() { for (const fn of subs) { try { fn(); } catch (e) { console.error('[音樂]', e); } } }
const byId = (id) => lib.find(t => t.id === id) || null;
const playable = (id) => !!byId(id) && !broken.has(id);

// ── 歌單：只收格式對的；id、檔名有問題的那一行略過，不會讓整份歌單壞掉 ──
function clean(list) {
  const out = [], seen = new Set();
  for (const [i, x] of (Array.isArray(list) ? list : []).entries()) {
    if (!x || typeof x.id !== 'string' || !/^[\w-]{1,40}$/.test(x.id) || seen.has(x.id)) continue;
    if (typeof x.file !== 'string' || !/^[\w .-]+\.(mp3|m4a|ogg|wav)$/i.test(x.file) || x.file.startsWith('.')) continue;
    seen.add(x.id);
    const rate = x.rate > 0 ? x.rate : 44100;
    out.push({
      id: x.id, file: x.file,
      title: typeof x.title === 'string' && x.title ? x.title : x.id,
      en: typeof x.en === 'string' && x.en ? x.en : null,
      color: /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : COLORS[i % COLORS.length],
      loop: x.loopSamples > 0 ? x.loopSamples / rate : null,
      bpm: x.bpm > 0 ? x.bpm : null,
      gain: x.gain > 0 && x.gain <= 2 ? x.gain : 1,
    });
  }
  return out;
}

let libLoading = null;
export function refreshLibrary() {
  libLoading = fetch(LIB_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { tracks: [] }))
    .catch(() => ({ tracks: [] }))
    .then(j => {
      const before = new Map(lib.map(t => [t.id, t.file]));
      lib = clean(j.tracks);
      for (const t of lib) if (before.has(t.id) && before.get(t.id) !== t.file) { buffers.delete(t.id); broken.delete(t.id); }   // 換了檔案：重新載
      const q = S.queue.filter(id => byId(id)).slice(0, QUEUE_MAX);
      if (q.length !== S.queue.length) { S.queue = q; save(); }
      if (cur) scheduleEnd();
      emit();
    });
  return libLoading;
}
refreshLibrary();

// ── 給點歌機畫面用 ──
export function musicState() {
  return {
    on, mode: S.mode,
    now: cur ? cur.track : null, pending: pending ? byId(pending) : null,
    queue: S.queue.map(byId).filter(Boolean),
    lib: lib.map(t => ({ ...t, broken: broken.has(t.id) })),
  };
}
export function onMusic(fn) { subs.add(fn); return () => subs.delete(fn); }
// 現在這一拍走到哪（0～1）：點歌機的燈跟著拍子亮；沒在放或不知道 bpm 回 null
export function musicBeat() {
  if (!cur || !ctx || !cur.track.bpm) return null;
  const p = filePos(cur, ctx.currentTime) * cur.track.bpm / 60;
  return p - Math.floor(p);
}

export const musicOn = () => on;
export function setMusicSoft(v) { soft = v; }
export function setMusic(v) {
  if (on === v) return;
  on = v;
  localStorage.setItem('space_music', v ? '1' : '0');
  if (v) start(); else stop();
  emit();
}

// 點歌：關著就開來放這首；開著就排到最後面（已經在排、或就是正在放的，不重複排）
export function enqueue(id) {
  if (!byId(id)) return 'gone';
  if (broken.has(id)) return 'broken';
  if (!on) { S.now = id; save(); setMusic(true); return 'now'; }
  if (cur?.id === id || pending === id) return 'playing';
  if (S.queue.includes(id)) return 'queued';
  if (S.queue.length >= QUEUE_MAX) return 'full';
  S.queue.push(id); save(); scheduleEnd(); emit();
  return 'added';
}
export function unqueue(id) {
  const i = S.queue.indexOf(id); if (i < 0) return;
  S.queue.splice(i, 1); save(); scheduleEnd(); emit();
}
export function playNow(id) {
  if (!playable(id)) return;
  unqueue(id);
  if (!on) { S.now = id; save(); setMusic(true); return; }
  if (cur?.id === id && !pending) return;
  switchTo(id, 'user');
}
export function skip() {
  if (!on) return;
  const id = nextId(true);
  if (id) switchTo(id, 'user');
}
export function setMode(m) {
  if (!MODES.includes(m) || S.mode === m) return;
  S.mode = m; save(); scheduleEnd(); emit();
}
// 直播頁：網址指定一首（?song=id）
export function cueSong(id) { if (typeof id === 'string' && id) { S.now = id; save(); } }

// 下一首：先拿待播，沒有就看播放方式。skipping＝使用者按切歌（單曲循環也要換到別首）
function nextId(skipping) {
  while (S.queue.length) { const id = S.queue.shift(); save(); if (playable(id)) return id; }
  const ok = lib.filter(t => !broken.has(t.id));
  if (!ok.length) return null;
  const now = cur?.id || S.now;
  if (S.mode === 'one' && !skipping && playable(now)) return now;
  if (S.mode === 'shuffle') {
    const others = ok.filter(t => t.id !== now);
    return (others.length ? others : ok)[Math.floor(Math.random() * (others.length || ok.length))].id;
  }
  const i = lib.findIndex(t => t.id === now);
  for (let k = 1; k <= lib.length; k++) { const t = lib[(Math.max(i, -1) + k + lib.length) % lib.length]; if (!broken.has(t.id)) return t.id; }
  return null;
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

function load(id) {
  if (!buffers.has(id)) {
    const t = byId(id);
    if (!t) return Promise.reject(new Error('gone'));
    buffers.set(id, fetch(new URL(`./music/${encodeURIComponent(t.file)}`, import.meta.url))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => ensure().decodeAudioData(b))
      .catch(e => { buffers.delete(id); throw e; }));
  }
  return buffers.get(id);
}

// 慢慢調到目標音量（開關、壓低都走這裡，不會突然大聲或突然斷）
function ramp(param, to, sec, at = ctx.currentTime) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  if (at > t) param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(to, Math.max(at, t) + sec);
}
function fadeAway(p, at, sec) {
  ramp(p.g.gain, 0, sec, at);
  setTimeout(() => { try { p.src.stop(); } catch {} p.src.disconnect(); }, (at - ctx.currentTime + sec) * 1000 + 200);
}

// 目前放到檔案的第幾秒（循環曲繞回去的也算進去）
function filePos(p, t) {
  const x = t - p.start;
  if (!p.track.loop || x < LOOP_AT + p.track.loop) return x;
  return LOOP_AT + ((x - LOOP_AT) % p.track.loop);
}
// 使用者換歌的起點：目前這首的下一拍（太近就再下一拍）；不知道 bpm 就是現在
function nextBeat(p, t) {
  if (!p?.track.bpm) return t;
  const beat = 60 / p.track.bpm, x = filePos(p, t);
  let wait = Math.ceil(x / beat) * beat - x;
  if (wait < 0.08) wait += beat;
  return t + wait;
}

async function switchTo(id, kind) {
  const my = ++gen;
  pending = id; emit();
  let buf;
  try { buf = await load(id); }
  catch {
    if (my !== gen) return;
    broken.add(id); pending = null; emit();
    if (on && (kind !== 'user' || !cur)) { const n = nextId(false); if (n && n !== id) switchTo(n, kind); }   // 自動輪到的放不出來：跳下一首
    return;
  }
  if (my !== gen || !on) return;
  const c = ensure(), t = byId(id) || cur?.track;
  if (!t) { pending = null; emit(); return; }
  let at = c.currentTime + 0.05, fin = 0.01;
  if (cur) {
    if (kind === 'user') { at = nextBeat(cur, at); fadeAway(cur, at, USER_OUT); at += USER_GAP; fin = USER_IN; }
    else { fadeAway(cur, at, AUTO_FADE); fin = AUTO_FADE; }
  }
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf;
  if (t.loop) { src.loop = true; src.loopStart = LOOP_AT; src.loopEnd = LOOP_AT + t.loop; }
  g.gain.value = 0; src.connect(g); g.connect(master);
  src.start(at);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(t.gain, at + fin);
  cur = { id, track: t, src, g, start: at, dur: buf.duration };
  pending = null; S.now = id; save();
  scheduleEnd();
  emit();
}

// 這首什麼時候換：循環曲放滿三圈（已經超過就到這一圈結尾）、一般的歌放到尾巴；單曲循環又沒人點歌就不換
function scheduleEnd() {
  clearTimeout(endTimer); endTimer = null;
  if (!cur || !ctx) return;
  const t = cur.track, now = ctx.currentTime;
  const stay = S.mode === 'one' && !S.queue.length;
  let at;
  if (t.loop) {
    if (stay) return;   // 本身就無縫循環
    const lead = AUTO_FADE / 2;
    const n = Math.max(ROUNDS, Math.ceil((now - cur.start - LOOP_AT + lead + 1) / t.loop));
    at = cur.start + LOOP_AT + t.loop * n - lead;
  } else at = cur.start + cur.dur - AUTO_FADE;
  const p = cur;
  endTimer = setTimeout(() => {
    if (cur !== p || !on) return;
    const id = nextId(false);
    if (id) switchTo(id, 'auto');
  }, Math.max(0, at - now) * 1000);
  const peek = S.queue[0] || (S.mode === 'all' ? lib[(lib.findIndex(x => x.id === cur.id) + 1) % lib.length]?.id : null);
  if (peek && peek !== cur.id) load(peek).catch(() => {});   // 下一首先載好
}

async function start() {
  ensure();
  ramp(master.gain, soft ? VOL_SOFT : VOL, 4);   // 淡入
  if (cur || pending) return;
  await libLoading;
  if (!on || cur || pending) return;
  const id = playable(S.now) ? S.now : nextId(false);   // 上次那首下架了：先輪待播，再照播放方式挑
  if (id) switchTo(id, 'start');
}

function stop() {
  if (!ctx) return;
  gen++; pending = null;
  clearTimeout(endTimer);
  ramp(master.gain, 0, 1.5);   // 淡出後才真的停
  if (cur) { fadeAway(cur, ctx.currentTime, 1.5); cur = null; }
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
