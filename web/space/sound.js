// 音效：全部用 Web Audio 即時合成，不需要音檔。預設關閉，開關記在 localStorage。
// 瀏覽器規定要使用者點過頁面才能出聲：打開開關那一下就是那次點擊。

let ctx = null, master = null;
let on = localStorage.getItem('space_sound') === '1';
// 柔和模式（直播）：整體小聲、太低太高的都削掉、每個音慢一點起，墊在背景音樂下面不刺耳；警示、雷聲、咖啡機的嗡嗡不響
let soft = false;
export function setSoft(v) { soft = v; }

export const soundOn = () => on;
export function setSound(v) {
  on = v;
  localStorage.setItem('space_sound', v ? '1' : '0');
  if (v) ensure();
}
function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = soft ? 0.22 : 0.5;
    if (soft) {   // 柔和模式：150Hz 以下（悶轟）和 2kHz 以上（尖）都削掉
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
      master.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
    }
    else master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 一個音：頻率可以滑動，音量包絡是快起慢收
function tone({ freq, to, type = 'sine', dur = 0.15, vol = 0.2, delay = 0, vibrato = 0 }) {
  const c = ensure(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  if (vibrato) {
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 6; lg.gain.value = vibrato; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (soft ? 0.04 : 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
// 一段雜訊（鍵盤、咖啡機、白煙）
function noise({ dur = 0.05, vol = 0.1, freq = 2000, q = 1, type = 'highpass', delay = 0, wobble = 0 }) {
  const c = ensure(), t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  if (wobble) for (let k = 0; k < dur * 8; k++) g.gain.setValueAtTime(vol * (0.6 + 0.4 * Math.sin(k)), t + k / 8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

const play = (fn) => (...a) => { if (on) try { fn(...a); } catch {} };

export const sfx = {
  // 有人舉手等你：叮咚（最重要的提醒，音量最大）
  // 卡住了：兩聲低沉的提醒
  stuck: play(() => { if (soft) return; tone({ freq: 330, dur: 0.3, vol: 0.25, type: 'triangle' }); tone({ freq: 262, dur: 0.5, vol: 0.25, type: 'triangle', delay: 0.25 }); }),
  // 雷聲：低沉的轟隆
  thunder: play(() => { if (soft) return; noise({ dur: 2.2, vol: 0.18, freq: 160, type: 'lowpass', wobble: 1 }); noise({ dur: 0.4, vol: 0.12, freq: 900, type: 'lowpass' }); }),
  // 慶祝：派對喇叭＋一串歡快的音
  party: play(() => { tone({ freq: 392, to: 784, dur: 0.35, vol: 0.18, type: 'sawtooth' }); [659, 784, 880, 1047].forEach((f, i) => tone({ freq: f, dur: 0.18, vol: 0.14, delay: 0.4 + i * 0.13, type: 'triangle' })); }),
  ask: play(() => { tone({ freq: 880, dur: 0.25, vol: 0.35 }); tone({ freq: 1320, dur: 0.45, vol: 0.3, delay: 0.18 }); }),
  // 做完了：上行三和弦
  done: play(() => [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.3, vol: 0.18, delay: i * 0.08, type: 'triangle' }))),
  // 鍵盤：很短的高頻雜訊
  key: play((vol = 0.05) => noise({ dur: 0.018, vol, freq: 2500 + Math.random() * 1500 })),
  // 咖啡機：低沉的嗡嗡聲
  coffee: play(() => { noise({ dur: 1.4, vol: soft ? 0.03 : 0.06, freq: soft ? 700 : 380, q: 3, type: 'bandpass', wobble: 1 }); if (!soft) tone({ freq: 120, dur: 1.2, vol: 0.03, type: 'sawtooth' }); }),
  // 送貨拆箱：啵
  pop: play(() => { tone({ freq: 300, to: 900, dur: 0.12, vol: 0.2 }); noise({ dur: 0.25, vol: 0.05, freq: 800, type: 'lowpass' }); }),
  // 公司升級：小號式的上行琶音
  levelUp: play(() => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ freq: f, dur: i === 5 ? 0.6 : 0.16, vol: 0.16, delay: i * 0.12, type: 'square' }))),
  // 獎盃：鈴聲
  trophy: play(() => { tone({ freq: 1047, dur: 1.2, vol: 0.2 }); tone({ freq: 1568, dur: 1.0, vol: 0.12, delay: 0.05 }); tone({ freq: 2093, dur: 0.8, vol: 0.08, delay: 0.1 }); }),
  // 桌球：短促的咚
  ping: play((vol = 0.15) => { tone({ freq: 1400, to: 900, dur: 0.05, vol }); noise({ dur: 0.03, vol: vol * 0.4, freq: 3000 }); }),
  // 貓叫：喵～
  // 桌機電話：鈴兩聲
  ring: play(() => [0, 0.32].forEach(d => tone({ freq: 1250, dur: 0.24, vol: 0.12, delay: d, vibrato: 22 }))),
  meow: play((vol = 0.12) => tone({ freq: 700, to: 520, dur: 0.45, vol, type: 'triangle', vibrato: 18 })),
};
