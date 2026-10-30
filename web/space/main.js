// 3D 工作室的主程式：場景、人物＝對話、走動與休閒、經營系統、面板與裝修抽屜
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MOBILE, PLATE_COLORS, at, box, canvasTexture, hash, mergeStatic, mesh, plastic, plate, roundBrick, shade, texBox } from './bricks.js';
import { LATTE_KEYS, faceTex, latteTex, screenTex } from './textures.js';
import { OUTFITS, OUTFIT_POOL, buildFigure, hatPart } from './figure.js';
import { buildCast, buildMascot, buildCatFigure } from './cast.js';
import { BOSS_ROOM, bossOffice, easel, pictureFrame, bat, cobweb, couplet, lantern, pumpkin, mooncakes, zongziPlate, mugwort, fullMoon, balloons, stringLights, xmasTree, cityMats, CATS, DESK_TOP, SEAT_TOP, arcadeCab, beanbag, bookshelf, buildCat, buildDesk, cardboard, city, coffeeBar, concreteMat, consoleCorner, cooler, door, drawClock, drinkFridge, snackShelf, quotaJars, QUOTA_SHELF, floorMat, kitchen, logoWall, lowCabinet, massageChair, meetingRoom, pingpongTable, treadmill, spinBike, weightRack, aquarium, guitarAmp, guitarStand, drumKit, keyboardStand, buffetCounter, diningTable, napPod, puttingGreen, golfSim, plant, planter, printer, reception, rollupDoor, sofa, trophyMesh, wall, worldClocks, whiteboard } from './furniture.js';
import { buildGrid, findPath as findPathOnGrid, pickWeighted } from './path.js';
import { dayParams, isOffHours, arriveHour } from './daylight.js';
import { holidayOf, isDayOff, fireworksOn, HOLIDAY_GREETING } from './holiday.js';
import { sfx, soundOn, setSound, setSoft } from './sound.js';
import { musicOn, setMusic, setMusicSoft, duckMusic, onMusic, cueSong } from './music.js';
import { jukebox } from './jukebox.js';
import { t as tr, LANG, LOCALE, translateDom } from './i18n.js';
import { pickClocks } from './worldclock.js';
import { host, api, post, authUrl } from './host.js';

// 帳號、對話、檔案這些跟宿主有關的都在 host.js
translateDom();   // HTML 裡寫死的中文（英文介面時）
const fileUrl = (p) => host.files.url(p);
const canNew = !!(host.chat?.newUrl && host.files);   // 能不能從空間開新對話（要選目錄）
const plugins = [jukebox, ...(host.plugins || [])];   // 宿主帶來的外掛（介面見 plugins/economy.js 開頭）；點歌機是內建的，也走外掛的介面
// 辦公室長相（等級、設施、獎盃、各部門設備與制服）：沒有外掛時是一間固定的辦公室，宿主可以用 host.look 改
const EQUIP0 = { monitor: 0, chair: 0, desk: 0, trinkets: {}, owned: { plate: true }, floor: 'plate' };
const LOOK0 = { level: 3, levelName: tr('辦公室'), facilities: { coffee: 1, lounge: 1, game: 1, wall: 1, hotdesk: 0, pet: 0 }, trophies: [], depts: {} };
let look = { ...LOOK0, ...host.look };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── 文字對照 ──────────────────────────────────────────────────────────────────
const STATUS = {
  working: tr('工作中'), asking: tr('等你回答'), idle: tr('做完了，等你'), background: tr('做完了，同事還在忙'),
  external: tr('在別處執行中'), resting: tr('休息中'),
};
const KIND = {
  read: tr('在讀'), edit: tr('在改'), bash: tr('跑指令'), web: tr('查網路'), agent: tr('派助手'), plan: tr('排計畫'),
  tool: tr('用工具'), think: tr('思考中'), talk: tr('回覆中'), done: tr('完成'), error: tr('出錯'), user: tr('你說'),
};
const ORDER = ['asking', 'working', 'external', 'idle', 'resting'];

// 給 shell 用的路徑：有空白或特殊字元就加單引號
const shq = (s) => /^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
// 路徑最後一段（Windows 的 \ 也認）
const tail = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
function projName(cwd, root) {
  if (!cwd) return tr('未知');
  if (cwd === root) return '~';
  return tail(cwd);
}
function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return tr('剛剛');
  if (s < 3600) return tr('{n} 分', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('{n} 時', { n: Math.floor(s / 3600) });
  return tr('{n} 天', { n: Math.floor(s / 86400) });
}
function actText(a) {
  if (!a) return '';
  const k = KIND[a.kind] || a.kind;
  if (a.kind === 'talk') return a.text ? tr('回覆：{text}', { text: a.text }) : k;
  return a.detail ? tr('{k}：{d}', { k, d: a.detail }) : (a.tool && a.tool !== a.kind ? tr('{k}（{tool}）', { k, tool: a.tool }) : k);
}

// ── 小圖示（不用 emoji，自己畫） ─────────────────────────────────────────────
const ICON = {
  ask: '<svg viewBox="0 0 20 20"><rect x="8.4" y="3" width="3.2" height="9" rx="1.6" fill="#fff"/><circle cx="10" cy="15.8" r="1.9" fill="#fff"/></svg>',
  done: '<svg viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  err: '<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
  zz: '<svg viewBox="0 0 20 20"><path d="M3 9h6l-6 7h6M11 3h5l-5 5h5" fill="none" stroke="#5b6b78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  soundOn: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  soundOff: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  musicOn: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 12V3.5l7-1.5v8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="4.3" cy="12" r="1.9" fill="currentColor"/><circle cx="11.3" cy="10.5" r="1.9" fill="currentColor"/></svg>',
  musicOff: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 12V3.5l7-1.5v8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity=".45"/><circle cx="4.3" cy="12" r="1.9" fill="currentColor" opacity=".45"/><circle cx="11.3" cy="10.5" r="1.9" fill="currentColor" opacity=".45"/><path d="M2 2l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  stuck: '<svg viewBox="0 0 20 20"><path d="M7 7a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.5" fill="none" stroke="#f08a12" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="15.2" r="1.2" fill="#f08a12"/><path d="M16 3c1 1.6 1.5 2.6 1.5 3.4a1.5 1.5 0 0 1-3 0c0-.8.5-1.8 1.5-3.4z" fill="#5aa6e8"/></svg>',
  laptop: '<svg viewBox="0 0 20 20"><rect x="4" y="4.5" width="12" height="8" rx="1.2" fill="none" stroke="#10a37f" stroke-width="1.8"/><path d="M2 15.5h16" stroke="#10a37f" stroke-width="2" stroke-linecap="round"/><path d="M7.5 7.5 6 8.6l1.5 1.1M10.5 10h2.5" fill="none" stroke="#10a37f" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  paint: '<svg viewBox="0 0 20 20"><path d="M10 2.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.9 1.2-1.8-.5-1 .1-2.2 1.3-2.2h1.8a3.2 3.2 0 0 0 3.2-3.2C17.5 5.6 14.1 2.5 10 2.5z" fill="none" stroke="#10a37f" stroke-width="1.6"/><circle cx="6.5" cy="9" r="1.3" fill="#c91a09"/><circle cx="9" cy="5.8" r="1.3" fill="#f2cd37"/><circle cx="12.8" cy="6.6" r="1.3" fill="#0055bf"/></svg>',
  chat: '<svg viewBox="0 0 20 20"><path d="M3 4h14v9H9l-4 3v-3H3z" fill="none" stroke="#0b6fd6" stroke-width="2" stroke-linejoin="round"/><circle cx="7" cy="8.5" r="1.1" fill="#0b6fd6"/><circle cx="10" cy="8.5" r="1.1" fill="#0b6fd6"/><circle cx="13" cy="8.5" r="1.1" fill="#0b6fd6"/></svg>',
  game: '<svg viewBox="0 0 20 20"><path d="M5 6h10a3.5 3.5 0 0 1 3.4 4.4l-1 3.6a2 2 0 0 1-3.4.8L12 13H8l-2 1.8a2 2 0 0 1-3.4-.8l-1-3.6A3.5 3.5 0 0 1 5 6z" fill="none" stroke="#7a4fd0" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 8.5v3M4.5 10h3" stroke="#7a4fd0" stroke-width="1.6" stroke-linecap="round"/><circle cx="13.5" cy="9" r="1" fill="#7a4fd0"/><circle cx="15" cy="11" r="1" fill="#7a4fd0"/></svg>',
  phone: '<svg viewBox="0 0 20 20"><rect x="6" y="2.5" width="8" height="15" rx="2" fill="none" stroke="#f08a12" stroke-width="2"/><path d="M9 14.5h2" stroke="#f08a12" stroke-width="1.8" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.2" fill="none" stroke="#2aa6a0" stroke-width="2.4"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1" stroke="#2aa6a0" stroke-width="2.2" stroke-linecap="round"/></svg>',
  read: '<svg viewBox="0 0 16 16"><path d="M2 3.5C4 2.5 6 2.5 8 4c2-1.5 4-1.5 6-.5V13c-2-1-4-1-6 .5C6 12 4 12 2 13z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16"><path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  bash: '<svg viewBox="0 0 16 16"><path d="M3 4l4 4-4 4M8.5 12.5H13" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  web: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M2.5 8h11M8 2.4c-2.6 3-2.6 8.2 0 11.2M8 2.4c2.6 3 2.6 8.2 0 11.2" fill="none" stroke="#fff" stroke-width="1.3"/></svg>',
  agent: '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="5.5" r="2.2" fill="#fff"/><circle cx="11" cy="6.5" r="1.8" fill="#fff"/><path d="M1.8 13c.4-2.6 2-3.8 3.7-3.8s3.3 1.2 3.7 3.8M9.3 13c.3-2 1.2-3 2.3-3s2.2 1 2.6 3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plan: '<svg viewBox="0 0 16 16"><path d="M3 4.5l1.3 1.3L6.6 3.5M3 10l1.3 1.3L6.6 9M8.5 5h5M8.5 10.5h5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tool: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5a3 3 0 0 0-3.4 4L2.5 11l2.5 2.5 4.5-4.6a3 3 0 0 0 4-3.4l-1.8 1.8-2-.6-.6-2z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  talk: '<svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  user: '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.6" fill="#fff"/><path d="M3 14c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" fill="#fff"/></svg>',
  dir: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5V12.5h13V5.5H8L6.5 3.5h-5z" fill="#f2b632"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z" fill="#e8edf2" stroke="#9aa6b1"/></svg>',
};
const KIND_COLOR = {
  read: '#5b8def', edit: '#0b6fd6', bash: '#1b2a34', web: '#2aa6e0', agent: '#7a4fd0', plan: '#e0a020',
  tool: '#607d8b', talk: '#1e9e55', user: '#f08a12', think: '#9aa6b1',
};

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
// 省電：Retina 上 1.5 倍跟 2 倍幾乎看不出差別（還有景深、調色蓋著），要畫的像素少將近一半；字是 DOM 不受影響
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
// 小人一秒動 12 格，陰影跟著那 12 格更新就好（主迴圈裡換格時才重畫），省掉大半的陰影繪製
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
stage.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

const scene = new THREE.Scene();
// 天空：上藍下暖，地平線的顏色跟霧一致
const HORIZON = '#f3dcc0';
// 天空由日夜循環畫（見 applyDaylight）
scene.fog = new THREE.Fog(HORIZON, 1300, 3400);
// 塑膠的反光要有東西可以反：用內建的攝影棚環境
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(36, 1, 5, 5000);
camera.position.set(260, 300, 340);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.15;   // 主迴圈最多 30fps（見 loop），0.15 每幀 ≈ 原本 60fps 時的 0.08，滑動手感不變
controls.maxPolarAngle = 1.3;
controls.minDistance = 70;
controls.maxDistance = 1600;
controls.screenSpacePanning = false;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.zoomToCursor = true;   // 縮放朝手指／游標所在的位置，不是一律朝畫面中央（跟地圖 App 一樣）

const hemi = new THREE.HemisphereLight('#fff1dc', '#5a4a3a', 0.85);
scene.add(hemi);
const ceiling = new THREE.DirectionalLight('#fff8ee', 0.45);   // 天花板燈：正上方的柔光，不投影
ceiling.position.set(40, 500, 60);
scene.add(ceiling);
const sun = new THREE.DirectionalLight('#ffd9a8', 2.6);   // 午後陽光從後窗斜射進來
sun.position.set(-180, 300, -420);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);


const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 400, aperture: MOBILE ? 0.000035 : 0.00005, maxblur: MOBILE ? 0.006 : 0.009 });
composer.addPass(bokeh);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.14, 0.35, 1.05));
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= mix(1.0, 0.72, smoothstep(0.35, 0.85, length(d * vec2(1.0, 0.85))));
      c.rgb += (rnd(vUv * 731.0) - 0.5) * 0.025;
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);
// 綁頭鏡頭用的魚眼：畫面中間放大、邊緣往內收，像運動相機（平常關著）
const fisheye = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, k: { value: 0.35 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float k; uniform float aspect; varying vec2 vUv;
    void main(){
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      float rmax2 = 0.25 * (aspect * aspect + 1.0);
      vec2 s = d * (1.0 + k * dot(d, d)) / (1.0 + k * rmax2);
      gl_FragColor = texture2D(tDiffuse, s / vec2(aspect, 1.0) + 0.5);
    }`,
});
fisheye.enabled = false;
composer.addPass(fisheye);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const NPC_OUTFITS = new Set(['courier', 'codexPainter', 'consultant', 'codex', 'you']);   // 快遞、外包畫師／顧問、Codex 員工的制服不能當部門制服
function outfitFor(cwd) {
  const custom = look.depts?.[cwd]?.outfit;
  if (custom && OUTFITS[custom] && !NPC_OUTFITS.has(custom)) return custom;   // 部門自己選的制服
  return outfitFor.auto(cwd);
}
// 沒自己選時的預設：宿主可以指定專案的職業（host.projectOutfits：專案名 → 制服），其他從職業池固定分配
outfitFor.auto = (cwd) => host.projectOutfits?.[projName(cwd, workRoot)] || OUTFIT_POOL[hash(cwd || '?') % OUTFIT_POOL.length];

// ── 人物＝對話 ────────────────────────────────────────────────────────────────
const figs = new Map();       // id -> { data, fig, desk, holder, tag, ... }
const islands = new Map();    // cwd -> { cwd, group, seats: [id|null], label }
let workRoot = '';
let selectedId = null;
const seen = (() => { try { return JSON.parse(localStorage.getItem('space_seen') || '{}'); } catch { return {}; } })();
const saveSeen = () => localStorage.setItem('space_seen', JSON.stringify(seen));
const pickables = [];

const SEATS_PER_ISLAND = 8;
const COL_W = 34, ROW_Z = 40;

function seatPos(i, cols) {
  const row = i % 2, col = Math.floor(i / 2);
  const x = (col - (cols - 1) / 2) * COL_W;
  return row === 0 ? { x, z: -ROW_Z, ry: 0 } : { x, z: ROW_Z, ry: Math.PI };
}

function makeIsland(cwd) {
  const h = hash(cwd);
  const isl = { cwd, group: new THREE.Group(), seats: new Array(SEATS_PER_ISLAND).fill(null), tint: PLATE_COLORS[h % PLATE_COLORS.length], cols: 0, floor: equipFor(cwd).floor };
  scene.add(isl.group);
  const div = document.createElement('div');
  div.className = 'island-label';
  div.innerHTML = `<span class="nm"></span><span class="n"></span>` + (canNew ? `<button title="${tr('在這裡開新對話')}">+</button>` : '');
  div.querySelector('button')?.addEventListener('click', (e) => { e.stopPropagation(); openNew(cwd); });
  div.addEventListener('click', () => { setFollow(null); focusIsland(isl); });   // 整個標籤都能點（＋號另外處理、會擋掉冒泡）
  isl.label = new CSS2DObject(div);
  isl.labelDiv = div;
  isl.group.add(isl.label);
  islands.set(cwd, isl);
  return isl;
}

// 板子大小跟著人數變（最少兩欄）
// 部門地板：積木底板／地毯／淺色木地板／草皮（用部門積木買）
let carpetMap = null;
function islandBase(wS, dS, isl) {
  const fl = isl.floor || 'plate';
  if (fl === 'grass') return plate(wS, dS, 3.2, '#4b9f4a');
  if (fl !== 'carpet' && fl !== 'wood') return plate(wS, dS, 3.2, isl.tint);
  const w = wS * 8, d = dS * 8, g = new THREE.Group();
  let mat;
  if (fl === 'carpet') {
    carpetMap = carpetMap || canvasTexture(64, 64, (c) => {
      c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 1.5); }
    }, 8, 8);
    mat = new THREE.MeshStandardMaterial({ color: shade(isl.tint, 0.8), roughness: 1, map: carpetMap });
  } else mat = floorMat(w, d, ['#c8a272', '#d2ad7c', '#bf9866', '#cba676', '#c39d6c']);
  g.add(texBox(w, 3.2, d, mat, 0, 1.6, 0));
  return g;
}

function sizeIsland(isl, force) {
  const used = isl.seats.reduce((n, s, i) => s ? Math.max(n, i + 1) : n, 0);
  const cols = Math.max(2, Math.ceil(used / 2));
  if (cols === isl.cols && !force) return;
  isl.cols = cols;
  if (isl.base) isl.group.remove(isl.base);
  const wS = Math.ceil((cols * COL_W + 14) / 8), dS = Math.ceil((ROW_Z * 2 + 30) / 8);
  isl.base = islandBase(wS, dS, isl);
  isl.group.add(isl.base);
  isl.w = wS * 8; isl.d = dS * 8;
  isl.label.position.set(0, 4, isl.d / 2 + 4);
  for (const id of isl.seats) if (id) placeFig(figs.get(id));
}

function placeFig(f) {
  const isl = islands.get(f.cwdKey);
  const p = seatPos(f.seat, isl.cols);
  f.holder.position.set(p.x, 3.2 + 1.8 * 0, p.z);
  f.holder.rotation.y = p.ry;
}

function addFig(data) {
  const cwdKey = data.cwd || '?';
  const isl = islands.get(cwdKey) || makeIsland(cwdKey);
  let seat = isl.seats.indexOf(null);
  if (seat < 0) {
    // 這桌坐滿了：有事在做的新人優先，請最久沒動、正在休息的舊紀錄讓位
    if (!data.live && data.status === 'resting') return null;
    const out = isl.seats.map(id => figs.get(id)).filter(f => f && !f.data.live && f.data.status === 'resting' && f.id !== selectedId)
      .sort((a, b) => a.data.updatedAt - b.data.updatedAt)[0];
    if (!out) return null;
    removeFig(out.id); byId.delete(out.id);
    seat = isl.seats.indexOf(null);
  }
  isl.seats[seat] = data.id;
  // data.cast：宿主的 cast.js 有角色時，可以指定這段對話由誰坐；一般對話照專案分部門制服
  const fig = (data.cast && buildCast(data.cast)) || buildFigure(data.id, data.agent === 'codex' ? 'codex' : outfitFor(data.cwd));
  const desk = buildDesk(isl.tint, equipFor(cwdKey), data.id);
  const holder = new THREE.Group();
  holder.add(desk.group, fig.root);
  fig.root.position.set(0, SEAT_TOP - 7, 2);
  isl.group.add(holder);

  // 泡泡掛在人身上（人會離開座位）
  const tagDiv = document.createElement('div');
  tagDiv.className = 'fig-tag';
  // 點頭上的驚嘆號：原地跳出回答小卡
  tagDiv.addEventListener('click', (e) => { if (e.target.closest('.bubble.ask')) { e.stopPropagation(); openQuick(data.id); } });
  const tag = new CSS2DObject(tagDiv);
  tag.position.set(0, 55, 0);
  fig.root.add(tag);
  // 人走開時也要點得到
  const figHit = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 46, 8), desk.hit.material);
  figHit.position.y = 23;
  fig.root.add(figHit);

  const f = { id: data.id, data, fig, desk, holder, tag, tagDiv, cwdKey, seat, figHit, equipKey: equipKeyOf(cwdKey), phase: (hash(data.id) % 1000) / 160, pose: {},
    nav: { place: 'seat' } };
  desk.hit.userData.figId = data.id;
  pickables.push(desk.hit, figHit);
  // 頁面開著時才出現的新對話：從門口走進來（等排版完再出發，見 flushEnters）
  if (navReady) { f.enter = true; fig.root.visible = false; }
  holder.traverse(o => { if (o.isMesh) o.userData.figId = data.id; });
  figs.set(data.id, f);
  sizeIsland(isl);
  placeFig(f);
  applyState(f);
  updatePlate(f);
  return f;
}

// 桌上的名牌：雙面立牌，放在桌子左前角；名字取好了（或改了）才重畫
const plateSide = plastic('#1b2a34');
function updatePlate(f) {
  const name = f.data.name || '';
  if (f.plateName === name) return;
  f.plateName = name;
  if (f.plate) { f.holder.remove(f.plate); f.plate.material[4].map.dispose(); }
  f.plate = null;
  if (!name) return;
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2a34'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#d4a017'; g.lineWidth = 10; g.strokeRect(8, 8, 496, 144);
  let size = 78; g.font = `700 ${size}px -apple-system, "PingFang TC", sans-serif`;
  while (g.measureText(name).width > 460 && size > 30) { size -= 4; g.font = `700 ${size}px -apple-system, "PingFang TC", sans-serif`; }
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 256, 84);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  // 插在螢幕正上方的雙面立牌：坐的人和螢幕都擋不住，兩側都看得到
  const m = new THREE.Group();
  const sign = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 0.7), [plateSide, plateSide, plateSide, plateSide, face, face]);
  sign.position.y = DESK_TOP + 26; sign.castShadow = true; m.add(sign);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 25, 6), plateSide); pole.position.y = DESK_TOP + 11.5; m.add(pole);
  m.position.set(0, 0, 24.5);
  m.traverse(o => { o.userData.figId = f.id; });
  f.holder.add(m);
  f.plate = m;
  m.material = sign.material;   // updatePlate 換名字時要釋放貼圖
}

function removeFig(id) {
  const f = figs.get(id);
  if (!f) return;
  const isl = islands.get(f.cwdKey);
  isl.seats[f.seat] = null;
  isl.group.remove(f.holder);
  f.fig.root.removeFromParent();
  freeSlot(f);
  for (const h of [...(f.helpers?.values() || [])]) dropHelper(h);
  f.tag.element.remove();
  for (const h of [f.desk.hit, f.figHit]) { const i = pickables.indexOf(h); if (i >= 0) pickables.splice(i, 1); }
  figs.delete(id);
  if (isl.seats.every(s => !s)) { scene.remove(isl.group); isl.labelDiv.remove(); islands.delete(f.cwdKey); }
  else sizeIsland(isl);
}

function isUnseen(d) { return (d.status === 'idle' || d.status === 'background') && d.updatedAt > (seen[d.id] || 0) && d.id !== selectedId; }

// 換臉：表情＋有沒有正在眨眼
function setFace(fig) {
  // 角色（cast.js）在一般狀態用自己的專屬表情，其他狀態沿用通用表情
  fig.faceMat.map = fig.faceFor?.(fig.expr) || faceTex(fig.expr, fig.feat, !!fig.blinking && BLINKS.has(fig.expr));
  fig.faceMat.needsUpdate = true;
}
// 會眨眼的表情（大笑、睡著的眼睛本來就是閉的）；每 2.5～6 秒眨一次，閉眼約 0.12 秒
const BLINKS = new Set(['smile', 'focus', 'open', 'worry']);
function blinkTick(fig, now) {
  if (!BLINKS.has(fig.expr)) return;
  if (fig.blinking && now > fig.blinkEnd) { fig.blinking = false; setFace(fig); }
  if (!fig.blinking && now > (fig.blinkAt ??= now + 1000 + Math.random() * 4000)) {
    fig.blinking = true; fig.blinkEnd = now + 120; fig.blinkAt = now + 2500 + Math.random() * 3500; setFace(fig);
  }
}

// ── 成品：做完的那一輪做出了什麼（server/deliverable.js 判斷），只跟著這一輪，不收藏 ──
const delivUrl = (sid, what = '') => `/api/space/deliverable${what ? '/' + what : ''}?sessionId=${sid}`;
// 對話換了一輪（updatedAt 變了）才重問；舊的成品先撤掉
function wantDeliv(f) {
  const d = f.data;
  if (!d.sid || d.agent === 'codex') return;
  const key = d.sid + ':' + d.updatedAt;
  if (f.delivKey === key) return;
  f.delivKey = key;
  dropDeliv(f);
  api(delivUrl(d.sid)).then((x) => {
    if (f.delivKey !== key || !x?.type) return;
    delivTex(d.sid, x, (tex) => {
      if (f.delivKey !== key) return tex.dispose();
      f.deliv = { key, info: x, tex };
      if (!f.data.delivs) f.data.delivs = 1;
      applyState(f);
      if (f.id === selectedId) delivTabSync();
    });
  }).catch(() => {});
}
// 螢幕畫面：圖片放圖本身、本機網頁放截圖，其他（線上網址、影片、文件）畫一個圖示
function delivTex(sid, x, cb) {
  const fallback = () => cb(delivIcon(x.type));
  const src = x.type === 'image' ? delivUrl(sid, 'file') : x.shot ? delivUrl(sid, 'shot') : null;
  if (!src) return fallback();
  texLoader.load(authUrl(src), (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cb(t); }, undefined, fallback);
}
function delivIcon(type) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#0055bf'; g.fillRect(0, 0, 128, 16);   // 視窗標題列
  for (const [i, col] of ['#c91a09', '#f2cd37', '#237841'].entries()) { g.fillStyle = col; g.beginPath(); g.arc(10 + i * 10, 8, 3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = g.strokeStyle = '#1b2a34'; g.lineWidth = 5; g.lineJoin = g.lineCap = 'round';
  if (type === 'video') { g.beginPath(); g.moveTo(50, 44); g.lineTo(88, 72); g.lineTo(50, 100); g.closePath(); g.fill(); }
  else if (type === 'url' || type === 'html') {
    g.fillStyle = '#c3d4e6'; g.fillRect(16, 30, 96, 26);
    g.fillStyle = '#9aa6b1'; for (const [y, w] of [[66, 80], [78, 60], [90, 72]]) g.fillRect(16, y, w, 5);
    g.fillStyle = '#237841'; g.fillRect(16, 102, 34, 12);
  } else {   // 文件、pdf：一張折角的紙
    g.strokeRect(38, 30, 52, 76); g.beginPath(); g.moveTo(74, 30); g.lineTo(90, 46); g.stroke();
    g.fillStyle = '#9aa6b1'; for (const y of [56, 68, 80, 92]) g.fillRect(46, y, 36, 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function dropDeliv(f) {
  if (!f.deliv) return;
  f.deliv.tex.dispose(); f.deliv = null;
  if (f.id === selectedId) delivTabSync();
}
// 成品分頁：這輪有成品、或以前有記下成品才出現；都沒有就切回進度
const hasDeliv = (f) => !!(f?.deliv || f?.data?.delivs);
function delivTabSync() {
  const f = figs.get(selectedId), has = hasDeliv(f);
  document.querySelector('.tab[data-tab="deliv"]').style.display = has ? '' : 'none';
  if (!has && curTab === 'deliv') showTab('progress');
  else if (has && curTab === 'deliv') loadDeliv();
}
// 點了顯示成品的螢幕：直接打開成品分頁
// 擋在螢幕前的只算看得見的人（點選用的隱形圓柱比人胖，從肩膀後面看會整片擋住螢幕）
function delivScreenHit() {
  const screens = [], bodies = [];
  for (const f of figs.values()) {
    bodies.push(f.fig.root);
    if (f.deliv && f.desk.screenKind?.startsWith('deliv:')) f.desk.group.traverse(o => { if (o.isMesh && o.material === f.desk.screenMat) { o.userData.delivFig = f; screens.push(o); } });
  }
  if (!screens.length) return null;
  const h = ray.intersectObjects([...screens, ...bodies], true).find(h => h.object.visible && !(h.object.material?.transparent && h.object.material.opacity === 0));
  return h?.object.userData.delivFig || null;
}
// 成品分頁：上面是這一輪（好幾樣就一排小標籤切換），下面是以前每一輪的成品，點了在上面看
// 圖、影片、pdf、網頁直接看；文件放文字。以前的只記路徑：檔案改了看到的是現在的、刪了只剩名字
const histUrl = (sid, what, turn, i) => `/api/space/deliverable/history/${what}?sessionId=${sid}&turn=${encodeURIComponent(turn)}&i=${i}`;
const delivSel = { sid: null, turn: null, i: 0 };   // 正在看哪一樣（turn 為 null＝這一輪）
function previewHtml(x, file, shot) {
  const open = x.url || file;
  if (x.type === 'image') return `<a href="${file}" target="_blank"><img src="${file}"></a>`;
  if (x.type === 'video') return `<video controls src="${file}"></video>`;
  if (x.type === 'pdf') return `<iframe src="${file}"></iframe>`;
  if (x.shot) return `<a href="${esc(open)}" target="_blank"><img src="${shot}" onerror="this.remove()"></a>`;
  if (x.type === 'url') return `<iframe src="${esc(x.url)}" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe>`;   // 線上網址：你的瀏覽器自己開（有的網站不給嵌）
  if (/\.(md|csv)$/i.test(x.name || '')) return `<pre>${tr('讀取中…')}</pre>`;
  return '';
}
async function loadDeliv() {
  const pane = document.getElementById('pane-deliv');
  const f = figs.get(selectedId), sid = f?.data.sid;
  if (!hasDeliv(f) || !sid) { pane.innerHTML = ''; pane.dataset.key = ''; return; }
  const key = (f.deliv?.key || '') + '|' + (f.data.delivs || 0);
  if (pane.dataset.key === key) return;   // 同一個成品不重載（影片、網頁不會從頭來）
  pane.dataset.key = key;
  if (delivSel.sid !== sid) Object.assign(delivSel, { sid, turn: null, i: 0 });
  let hist = [];
  try { hist = await api(`/api/space/deliverable/history?sessionId=${sid}`) || []; } catch {}
  if (pane.dataset.key !== key) return;
  const cur = f.deliv?.info;
  if (cur) hist = hist.filter(h => h.turn !== cur.turn);
  if (!cur && delivSel.turn === null) delivSel.turn = hist[0]?.turn ?? null;
  if (delivSel.turn !== null && !hist.some(h => h.turn === delivSel.turn)) Object.assign(delivSel, { turn: cur ? null : hist[0]?.turn ?? null, i: 0 });
  pane.innerHTML = '<div class="preview deliv"><div data-view></div>'
    + (hist.length ? `<div class="sec dh"><h4>${esc(tr('以前的成品'))}</h4>${hist.map(h => `<div class="dh-turn">`
      + `<div class="dh-head"><span class="dh-when">${esc(ago(h.at))}</span><span class="dh-prompt" title="${esc(h.prompt)}">${esc(h.prompt)}</span></div>`
      + `<div class="dh-items">${h.items.map((it, i) => `<button class="dh-item${it.gone ? ' gone' : ''}" data-turn="${esc(h.turn)}" data-i="${i}" title="${esc(it.url || it.name)}">`
        + (it.thumb ? `<img src="${authUrl(histUrl(sid, 'thumb', h.turn, i))}" loading="lazy">`
          : it.type === 'image' && !it.gone ? `<img src="${authUrl(histUrl(sid, 'file', h.turn, i))}" loading="lazy">`   // 沒縮圖的圖（非 macOS）：直接用原圖
          : `<span class="dh-ic t-${it.type}"></span>`)
        + `<span>${esc(it.name)}</span></button>`).join('')}</div></div>`).join('')}</div>` : '')
    + '</div>';
  pane.querySelectorAll('.dh-item').forEach(b => b.onclick = () => {
    Object.assign(delivSel, { turn: b.dataset.turn, i: +b.dataset.i });
    showDelivItem(f, cur, hist);
    pane.querySelector('[data-view]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  showDelivItem(f, cur, hist);
}
// 上面那一格：這一輪的（有驗收按鈕），或點了的某一輪舊成品
function showDelivItem(f, cur, hist) {
  const pane = document.getElementById('pane-deliv'), view = pane.querySelector('[data-view]'), sid = f.data.sid;
  const old = delivSel.turn !== null ? hist.find(h => h.turn === delivSel.turn) : null;
  const items = old ? old.items : cur?.items || (cur ? [cur] : []);
  const i = Math.min(delivSel.i, items.length - 1), x = items[i];
  if (!x) { view.innerHTML = ''; return; }
  pane.querySelectorAll('.dh-item').forEach(b => b.classList.toggle('on', !!old && b.dataset.turn === old.turn && +b.dataset.i === i));
  const file = authUrl(old ? histUrl(sid, 'file', old.turn, i) : delivUrl(sid, 'file') + '&i=' + i);
  const shot = authUrl(old ? histUrl(sid, 'thumb', old.turn, i) : delivUrl(sid, 'shot') + '&i=' + i);
  const body = old && x.gone ? `<div class="note">${esc(tr('這個檔案已經不在了'))}</div>`
    : previewHtml(old ? { ...x, shot: x.thumb && !['image', 'video', 'pdf'].includes(x.type) } : x, file, shot);
  view.innerHTML = `<div class="bar"><span class="nm" title="${esc(x.url || x.path || x.name)}">${esc(x.name)}</span>`
    + (old ? `<span class="dh-when">${esc(ago(old.at))}</span>` : '')
    + `<a href="${esc(x.url || file)}" target="_blank" style="margin-left:auto;font-size:12px;font-weight:400">${tr('開新分頁')}</a></div>`
    + (items.length > 1 ? `<div class="files-chips dv-tabs">${items.map((it, k) => `<button class="fchip${k === i ? ' on' : ''}" data-k="${k}">${esc(it.name)}</button>`).join('')}</div>` : '')
    + (old ? (cur ? `<div class="deliv-act"><button class="btn ghost" data-now>${esc(tr('回到這一輪'))}</button></div>` : '')
      : `<div class="deliv-act"><button class="btn" data-ok></button>${host.reply ? `<button class="btn ghost" data-redo>${esc(tr('再改'))}</button>` : ''}</div>`)
    + body;
  view.querySelectorAll('.dv-tabs .fchip').forEach(b => b.onclick = () => { delivSel.i = +b.dataset.k; showDelivItem(f, cur, hist); });
  view.querySelector('[data-now]')?.addEventListener('click', () => { Object.assign(delivSel, { turn: null, i: 0 }); showDelivItem(f, cur, hist); });
  // 驗收：滿意就收下（清單裡拿掉、他舉手歡呼）；再改就直接交代要改哪裡
  const ok = view.querySelector('[data-ok]');
  if (ok) {
    const syncOk = () => { const done = isAccepted(f); ok.textContent = done ? tr('已驗收') : tr('滿意'); ok.disabled = done; };
    syncOk();
    ok.onclick = () => { acceptDeliv(f); syncOk(); };
  }
  view.querySelector('[data-redo]')?.addEventListener('click', () => {
    const inp = document.getElementById('p-reply-in');
    inp.placeholder = tr('要改哪裡？直接說…'); inp.focus();
  });
  const pre = view.querySelector('pre'), want = view;
  if (pre) fetch(file).then(r => r.text()).then(t => { if (pane.querySelector('[data-view]') === want) pre.textContent = t; }).catch(() => {});
}

// ── 叫進來報告：閒著或休息的人走進主管室，捧著成品站到桌前；忙的人不叫，報告直接看面板 ──
// stay：從主管室打電話叫的，鏡頭留在主管室看他走進來
function summon(f, { stay = false } = {}) {
  f.reportView = true;
  const d = f.data;
  const busy = ACTIVE.has(d.status);
  if (busy || !navReady || !spots.boss || f.nav.place === 'home' || !f.fig.root.visible) {
    if (busy) toast(tr('{name}正在忙，報告先看這裡', { name: d.name || tr('他') }));
    return showTab('report');
  }
  const slot = spots.boss.slots.find(x => !x.taken || x.taken === f.id);
  if (!slot) { toast(tr('主管室站滿了，先讓一位回座位')); return showTab('report'); }
  slot.taken = f.id;
  f.report = { slot };
  f.deskMode = null; f.event = false;
  if (f.deliv) {   // 捧著這輪的成品進來
    f.reportHeld = pictureFrame(f.deliv.tex, 12); f.reportHeld.position.set(0, 9, 8); f.reportHeld.rotation.x = -0.25; f.fig.upper.add(f.reportHeld);
  }
  goTo(f, { name: 'report', pos: slot.pos, approach: slot.approach, ry: slot.ry, slot }, { then: () => applyState(f) });
  f.nav.paper = !f.reportHeld;
  applyState(f);
  showTab('report');
  if (!stay) setFollow(f.id);
}

// ── 員工名冊：在主管室點桌上電話打開；等你處理的排最前面，其他照專案分組 ──
const roster = document.getElementById('roster'), rosterIn = document.getElementById('roster-in'), rosterList = document.getElementById('roster-list');
function openRoster() {
  rosterIn.value = '';
  roster.classList.add('open');
  renderRoster();
  if (!MOBILE) rosterIn.focus();
}
const closeRoster = () => roster.classList.remove('open');
document.getElementById('roster-close').onclick = closeRoster;
roster.addEventListener('click', (e) => { if (e.target === roster) closeRoster(); });
rosterIn.addEventListener('input', () => renderRoster());
function rosterSub(f) {
  const d = f.data;
  if (f.report) return tr('在主管室');
  if (d.status === 'asking') return d.ask?.question || tr('等你回答');
  if (ACTIVE.has(d.status)) return actText(d.act) || STATUS[d.status];
  if (f.deliv) return tr('交件：{name}', { name: f.deliv.info.name });
  return STATUS[d.status] || '';
}
function renderRoster() {
  const q = rosterIn.value.trim().toLowerCase();
  const hit = (f) => !q || [f.data.name, f.data.title, projName(f.data.cwd, workRoot)].some(x => String(x || '').toLowerCase().includes(q));
  const row = (f) => `<div class="sr-item" data-id="${esc(f.id)}"><span class="dot s-${f.data.status}"></span><div><b>${esc(f.data.name || f.data.title || '')}</b>`
    + `<small>${esc(rosterSub(f))}</small></div>${f.report ? `<span class="ro-tag">${esc(tr('在主管室'))}</span>` : ''}</div>`;
  const urgent = [...new Set(inboxItems().map(i => i.f).filter(f => f && hit(f)))];   // 辦公室裡沒這個人的（任務之類）不列
  let html = urgent.length ? `<div class="ro-sec">${esc(tr('等你處理'))}</div>` + urgent.map(row).join('') : '';
  for (const cwd of islandOrder) {
    const isl = islands.get(cwd); if (!isl) continue;
    const list = isl.seats.filter(Boolean).map(id => figs.get(id)).filter(f => f && hit(f) && !urgent.includes(f));
    if (!list.length) continue;
    list.sort((a, b) => ORDER.indexOf(a.data.status) - ORDER.indexOf(b.data.status) || (b.data.updatedAt || 0) - (a.data.updatedAt || 0));
    html += `<div class="ro-sec">${esc(projName(cwd, workRoot))}</div>` + list.map(row).join('');
  }
  rosterList.innerHTML = html || `<div class="ib-empty">${esc(tr('找不到人'))}</div>`;
}
rosterList.addEventListener('click', (e) => {
  const it = e.target.closest('.sr-item'); if (!it) return;
  const f = figs.get(it.dataset.id); if (!f) return;
  closeRoster();
  callIn(f);
});
// 打電話叫人：主管拿起話筒、對方桌上電話響、他接起來講兩句，再起身走進主管室；忙的人只看報告
function callIn(f) {
  if (f.report) { select(f.id, 'report', { stay: true }); return; }
  f.reportView = true;
  select(f.id, 'report', { stay: true });
  const busy = ACTIVE.has(f.data.status);
  if (busy) return summon(f, { stay: true });
  bossCallUntil = performance.now() + 1600;
  sfx.ring();
  if (f.nav.place === 'seat') f.phoneUntil = performance.now() + 1500;
  setTimeout(() => { if (selectedId === f.id && !f.report) { summon(f, { stay: true }); syncSummonBtn(); } }, 1400);
}
// walk：走回座位（有事要跑回去時由 onStatus 處理，這裡不走）
function endReport(f, walk = true) {
  if (!f.report) return;
  if (f.report.slot.taken === f.id) f.report.slot.taken = null;
  f.report = null;
  if (f.reportHeld) { f.reportHeld.removeFromParent(); f.reportHeld = null; }
  if (f.fig.paper) f.fig.paper.visible = false;
  if (walk && ['report', 'walk'].includes(f.nav.place)) goTo(f, seatTarget(f), { then: () => { f.leisureUntil = performance.now() + 20000; } });
  if (f.id === selectedId) { syncSummonBtn(); if (curTab === 'report') loadReport(); }
}
const summonBtn = document.getElementById('p-summon');
summonBtn.onclick = () => {
  const f = figs.get(selectedId); if (!f) return;
  if (f.report) endReport(f); else summon(f);
  syncSummonBtn();
  restoreReplyHint();
};
function syncSummonBtn() {
  const f = figs.get(selectedId);
  summonBtn.classList.toggle('on', !!f?.report);
  summonBtn.title = f?.report ? tr('報告完了，回座位') : tr('叫進主管室報告');
  document.querySelector('.tab[data-tab="report"]').style.display = f?.reportView ? '' : 'none';
}
// 報告：交代的事、做到哪、成品、最後說了什麼；能交代事情的宿主可以請他自己口頭報告（會開一輪新的）
const REPORT_ASK = '請用三句話向我報告：做了什麼、卡在哪、下一步打算做什麼。';
async function loadReport() {
  const pane = document.getElementById('pane-report');
  const f = figs.get(selectedId), d = f?.data;
  if (!d?.sid) { pane.innerHTML = ''; return; }
  let p = null;
  try { p = await api('/api/space/progress?sessionId=' + d.sid); } catch {}
  if (selectedId !== d.id || curTab !== 'report') return;
  const todos = p?.todos || [], done = todos.filter(t => t.status === 'completed').length;
  const lastTalk = [...(p?.steps || [])].reverse().find(s => s.kind === 'talk');
  const row = (k, v) => v ? `<div class="rp-row"><div class="rp-k">${esc(k)}</div><div class="rp-v">${v}</div></div>` : '';
  let html = '<div class="report">'
    + row(tr('交代的事'), esc(d.prompt?.text || d.lastPrompt || d.title || ''))
    + row(tr('狀態'), `<span class="dot s-${d.status}"></span>${esc(STATUS[d.status] || '')} · ${esc(ago(d.updatedAt))}${f.stuck ? ' · ' + esc(tr('好像卡住了')) : ''}`)
    + (todos.length ? row(tr('待辦'), `<div class="rp-bar"><i style="width:${Math.round(done / todos.length * 100)}%"></i></div>${done}/${todos.length}`
      + (todos.find(t => t.status === 'in_progress') ? ` · ${esc(todos.find(t => t.status === 'in_progress').text)}` : '')) : '')
    + (f.deliv ? row(tr('成品'), `<a href="#" data-deliv>${esc(f.deliv.info.name)}</a>${isAccepted(f) ? ' · ' + esc(tr('已驗收')) : ''}`) : '')
    + (p?.files?.length ? row(tr('改過的檔案'), String(p.files.length)) : '')
    + (lastTalk ? row(tr('最後說的話'), esc(lastTalk.text)) : '')
    + '<div class="rp-act">'
    + (host.reply && !ACTIVE.has(d.status) ? `<button class="btn" data-ask>${esc(tr('請他口頭報告'))}</button>` : '')
    + (f.report ? `<button class="btn ghost" data-back>${esc(tr('回座位'))}</button>` : '')
    + '</div>'
    + (host.reply && !ACTIVE.has(d.status) ? `<div class="rp-note">${esc(tr('口頭報告會請他用一輪對話回答，答完會出現在對話裡。'))}</div>` : '')
    + '</div>';
  pane.innerHTML = html;
  pane.querySelector('[data-deliv]')?.addEventListener('click', (e) => { e.preventDefault(); showTab('deliv'); });
  pane.querySelector('[data-back]')?.addEventListener('click', () => { endReport(f); syncSummonBtn(); });
  pane.querySelector('[data-ask]')?.addEventListener('click', async () => {
    try { const r = await host.reply(d, tr(REPORT_ASK)); toast(r.msg || tr('已請他報告')); } catch { toast(tr('連線失敗')); }
  });
}

// ── 等你處理：伺服器算的那份清單（server/inbox.js；remote 的收件箱分頁看的也是它）──────────
// 舉手、交件（成品／分支）、卡住、意外結束、任務、做完你還沒看的，照急的排。收下、看過都記在伺服器，換裝置也一樣
const ACCEPT_KEY = 'cubbi_accepted';
const accepted = (() => { try { return JSON.parse(localStorage.getItem(ACCEPT_KEY)) || {}; } catch { return {}; } })();   // 畫面先反應用；真正的紀錄在伺服器
const isAccepted = (f) => !!f.deliv && accepted[f.data.sid] === f.deliv.key;
function acceptDeliv(f) {
  if (!f?.deliv) return;
  accepted[f.data.sid] = f.deliv.key;
  post('/api/space/inbox/accept', { sid: f.data.sid, turn: f.deliv.key }).then(() => loadInbox()).catch(() => {});
  f.cheerUntil = performance.now() + 1800;
  updateInbox();
}
// 舊版把「看過」「收下」存在瀏覽器：第一次載入搬到伺服器，合併後不會整排重新冒出來
if (!localStorage.getItem('cubbi_inbox_imported')) {
  post('/api/space/inbox/import', { seen, accepted }).then(r => { if (r.ok) localStorage.setItem('cubbi_inbox_imported', '1'); }).catch(() => {});
}
let serverInbox = [];
async function loadInbox() {
  try { const r = await api('/api/space/inbox'); serverInbox = r.items || []; } catch {}
  updateInbox();
}
const RANK = { ask: 0, handoff: 1, decide: 1, review: 1, deliv: 1, idea: 2, stuck: 2, ended: 2, task: 2, done: 3 };
function inboxText(i) {
  switch (i.kind) {
    case 'ask': return i.ask?.question || i.ask?.input?.questions?.[0]?.question || i.ask?.displayName || i.ask?.tool || tr('需要你決定');
    case 'deliv': return tr('交件：{name}', { name: i.deliv?.title || '' });
    case 'review': return tr('交了分支：{name}', { name: i.branch || '' });
    case 'idea': return tr('新提案：{name}', { name: i.idea?.title || i.name || '' });
    case 'stuck': return tr('好像卡住了');
    case 'ended': return tr('意外結束');
    case 'task': return tr('任務等你處理');
    case 'handoff': return tr('等你本人辦');
    case 'decide': return tr('等你決定：{name}', { name: i.decide?.title || i.name || '' });
    default: return tr('做完了');
  }
}
function inboxItems() {
  return serverInbox
    .map(i => ({ item: i, f: figs.get(i.id) || figs.get(i.sid) || null, kind: i.kind, rank: RANK[i.kind] ?? 3, text: inboxText(i) }))
    .filter(x => !(x.f && x.kind === 'deliv' && isAccepted(x.f)))   // 剛按了收下，伺服器還沒回來前先藏
    .sort((a, b) => a.rank - b.rank || (b.item.at || 0) - (a.item.at || 0));
}
const inboxEl = document.getElementById('inbox'), inboxList = document.getElementById('inbox-list');
const INBOX_ICON = '<svg viewBox="0 0 16 16"><path d="M2 9.5 4 3.5h8l2 6V13H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
function updateInbox() {
  const items = inboxItems();
  inboxEl.innerHTML = INBOX_ICON + `<span>${items.length}</span>`;
  inboxEl.classList.toggle('hot', items.some(i => i.rank === 0));
  inboxEl.classList.toggle('zero', !items.length);
  if (!inboxList.classList.contains('open')) return;
  inboxList.innerHTML = items.length ? items.map((i, n) => `<div class="ib-item" data-n="${n}" data-kind="${i.kind}"><span class="ib-dot k-${i.kind}"></span>`
    + `<span class="ib-name">${esc(i.f?.data.name || i.item.name || i.f?.data.title || i.item.title || '')}</span><span class="ib-text">${esc(i.text)}</span></div>`).join('')
    : `<div class="ib-empty">${esc(tr('沒有要處理的事'))}</div>`;
  inboxList._items = items;
}
inboxEl.onclick = (e) => { e.stopPropagation(); inboxList.classList.toggle('open'); loadInbox(); };
inboxList.onclick = (e) => {
  const it = e.target.closest('.ib-item'); if (!it) return;
  inboxList.classList.remove('open');
  const x = inboxList._items?.[+it.dataset.n]; if (!x) return;
  // 辦公室裡處理得了的（舉手、成品交件、卡住、做完了）就地處理；其他（分支、任務、辦公室裡沒這個人）交給宿主
  if (x.f && ['ask', 'deliv', 'stuck', 'done'].includes(x.kind)) {
    select(x.f.id, x.kind === 'deliv' ? 'deliv' : undefined);
    if (x.kind === 'ask') openQuick(x.f.id);
    return;
  }
  // 外掛自己的（例如新提案→飛到提案白板）
  for (const pl of plugins) { try { if (pl.openInbox?.(x.item)) return; } catch {} }
  if (host.openInbox) host.openInbox(x.item);
  else if (x.f) select(x.f.id);
};
addEventListener('pointerdown', (e) => { if (!e.target.closest('#inbox, #inbox-list')) inboxList.classList.remove('open'); });
setInterval(loadInbox, 5000);
setTimeout(loadInbox, 800);

// 狀態 → 表情、螢幕、頭上的泡泡
function applyState(f) {
  const d = f.data, a = d.act || {};
  if (['working', 'asking', 'external'].includes(d.status) && f.deliv) { f.delivKey = null; dropDeliv(f); }   // 開始新的一輪：成品撤掉
  let expr = 'smile', screen = 'idle', bubble = '', act = '';
  switch (d.status) {
    case 'asking': expr = 'open'; screen = 'ask'; bubble = 'ask'; act = d.ask?.question || d.ask?.tool || tr('等你回答'); break;
    case 'working':
    case 'external': {
      expr = a.kind === 'think' ? 'smile' : 'focus';
      screen = d.status === 'external' && !['read', 'web', 'agent', 'plan'].includes(a.kind) ? 'ext'
        : { read: 'page', edit: 'code', bash: 'term', web: 'web', agent: 'agent', plan: 'plan', tool: 'code', think: 'think', talk: 'code' }[a.kind] || 'think';
      if (a.kind === 'think') bubble = 'dots';
      act = actText(a);
      if (f.stuck) {   // 卡住：抓頭冒汗，小字寫卡多久
        expr = 'worry'; bubble = 'stuck';
        const since = a.kind === 'bash' ? (a.since || f.actSince || d.updatedAt) : d.updatedAt;
      const m = Math.floor((Date.now() - since) / 60000);
      act = a.kind === 'bash' ? tr('指令跑了 {n} 分鐘', { n: m }) : tr('{n} 分鐘沒動靜', { n: m });
      }
      break;
    }
    case 'idle':
    case 'background':
      expr = a.kind === 'error' ? 'worry' : 'happy'; screen = a.kind === 'error' ? 'err' : 'idle';
      bubble = a.kind === 'error' ? 'err' : isUnseen(d) ? 'done' : '';
      if (d.status === 'idle' && a.kind !== 'error') { wantDeliv(f); if (f.deliv) screen = 'deliv'; }   // 做完了：螢幕轉成這輪的成品
      break;
    default: {
      // 休息中：看在做什麼（補眠、聊天、打電動、滑手機…）
      const lk = leisureKind(f);
      screen = 'off';
      if (lk === 'nap' || lk === 'sleep') { expr = 'sleep'; bubble = 'zz'; }
      else { expr = lk === 'walk' ? 'smile' : lk === 'deskgame' ? 'focus' : 'happy'; bubble = { pantry: 'chat', console: 'game', arcade: 'game', pingpong: 'game', deskgame: 'game', slack: 'phone' }[lk] || ''; }
      if (lk === 'deskgame') screen = 'game';
      if (screen === 'off' && a.kind !== 'error') { wantDeliv(f); if (f.deliv) screen = 'deliv'; }   // 人走開了，螢幕還留著上一輪的成品
    }
  }
  if (f.fig.expr !== expr) { f.fig.expr = expr; setFace(f.fig); }
  if (screen === 'deliv') {
    if (f.desk.screenKind !== 'deliv:' + f.deliv.key) { f.desk.screenMat.map = f.deliv.tex; f.desk.screenMat.needsUpdate = true; f.desk.screenKind = 'deliv:' + f.deliv.key; }
  } else if (f.desk.screenKind !== screen) {
    const t = screenTex(screen).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    f.desk.screenMat.map = t; f.desk.screenMat.needsUpdate = true; f.desk.screenKind = screen;
  }
  const showAct = act && (['working', 'asking', 'external'].includes(d.status) || d.id === selectedId);
  const html = (bubble === 'dots' ? '<div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>'
    : bubble ? `<div class="bubble ${bubble}">${ICON[bubble]}</div>` : '')
    + (showAct ? `<div class="act">${esc(act)}</div>` : '');
  if (f.tagHtml !== html) { f.tagDiv.innerHTML = html; f.tagHtml = html; }
}

// ── 動作 ──────────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
// 杯子保持杯口朝上（不管手臂轉到哪），sip 0～1：喝的時候往臉的方向傾
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _e = new THREE.Euler();
function uprightMug(fig, sip) {
  fig.root.updateMatrixWorld(true);
  fig.arms[1].getWorldQuaternion(_qa);            // 手臂現在的朝向
  fig.root.getWorldQuaternion(_qb);               // 人面向的方向
  _qb.multiply(new THREE.Quaternion().setFromEuler(_e.set(-0.9 * sip, Math.PI / 2, 0)));   // 杯身在手的前方（把手朝人）；喝的時候杯口往臉傾
  fig.mug.quaternion.copy(_qa.invert().multiply(_qb));
}
function walkPose(fig, nav) {
  const run = nav.speed > WALK, sw = Math.sin(nav.stride * (run ? 0.16 : 0.22));
  const amp = run ? 0.9 : 0.6;
  fig.legs[0].rotation.x = sw * amp; fig.legs[1].rotation.x = -sw * amp;
  fig.arms[0].rotation.x = -sw * amp * 0.9; fig.arms[1].rotation.x = nav.mug ? -1.2 : nav.paper ? -1.4 : sw * amp * 0.9;
  fig.arms[0].rotation.z = -0.1; fig.arms[1].rotation.z = 0.1;
  fig.upper.rotation.x = run ? 0.14 : 0.03;
  fig.head.rotation.set(run ? -0.1 : 0, 0, 0);
  fig.root.position.y += Math.abs(sw) * (run ? 1.6 : 0.8) * fig.root.scale.y;
  fig.mug.visible = !!nav.mug; fig.phone.visible = false;
  if (fig.guitar) fig.guitar.visible = false;
  if (fig.club) fig.club.visible = false;
  if (nav.mug) uprightMug(fig, 0);
  if (fig.paper) fig.paper.visible = !!nav.paper;
  if (fig.umbrella) {   // 下雨天從門口進來、或下班走出去：撐傘（右手舉著）
    const u = !!nav.umbrella && isRaining();
    fig.umbrella.visible = u;
    if (u) { fig.arms[1].rotation.x = -2.2; fig.arms[1].rotation.z = 0.2; }
  }
}
function animateFig(f, t, dt) {
  const { fig, data } = f;
  blinkTick(fig, performance.now());
  const a = data.act || {};
  const s = data.status;
  const k = t + f.phase;
  // 目標姿勢
  let upX = 0, headX = 0, headY = 0, headZ = 0, lX = -1.3, rX = -1.3, lZ = 0, rZ = 0, rise = 0, mug = false, phone = false;
  const typing = (speed, amp) => { lX = -1.28 + Math.sin(k * speed) * amp; rX = -1.28 + Math.sin(k * speed + Math.PI) * amp; headX = 0.12 + Math.sin(k * 2) * 0.03; };

  if (performance.now() < (f.cheerUntil || 0)) {
    // 成品驗收過關：雙手舉高歡呼
    const hop = Math.max(0, Math.sin(k * 9));
    lX = rX = -2.9; lZ = 0.35 + hop * 0.2; rZ = -0.35 - hop * 0.2; headX = -0.25; upX = -0.05; rise = hop * 2;
  } else if (f.nav.place === 'seat' && performance.now() < (f.phoneUntil || 0)) {
    // 剛派工出去：拿起電話交代事情
    lX = -2.55; lZ = 0.55; rX = -1.1; headZ = -0.18; headY = 0.2 + Math.sin(k * 3) * 0.06; phone = true;
  } else if (s === 'asking') {
    rX = -Math.PI + 0.15; rZ = -0.25 + Math.sin(k * 7) * 0.35; lX = -0.9; headX = -0.2; upX = -0.06; rise = Math.abs(Math.sin(k * 3.5)) * 1.2;
  } else if (s === 'working' && f.codexWait) {
    // 等外包交件：雙手抱胸，偶爾抬左手看錶
    const peek = Math.max(0, Math.sin(k * 0.6)) ** 6;
    lX = lerp(-1.55, -2.0, peek); lZ = lerp(-0.85, 0.2, peek); rX = -1.55; rZ = 0.85; upX = -0.08; headX = lerp(0, 0.35, peek); headY = lerp(0, 0.35, peek);
  } else if ((s === 'working' || s === 'external') && f.stuck) {
    // 卡住：右手抓頭、頭歪一邊
    rX = -2.75; rZ = -0.55 + Math.sin(k * 9) * 0.12; lX = -1.2; headZ = 0.18; headX = 0.05; upX = -0.04;
  } else if (s === 'working' || s === 'external') {
    switch (a.kind) {
      case 'bash': typing(26, 0.16); break;
      case 'edit': case 'tool': case 'talk': typing(16, 0.12); break;
      case 'read': lX = -1.15; rX = -1.2 + Math.sin(k * 1.4) * 0.08; headX = 0.18 + Math.sin(k * 0.9) * 0.08; headY = Math.sin(k * 0.6) * 0.18; break;
      case 'web': typing(9, 0.1); headY = Math.sin(k * 1.1) * 0.25; break;
      case 'agent': lX = -2.55; lZ = 0.55; rX = -1.2; headZ = -0.18; headY = 0.2 + Math.sin(k * 3) * 0.06; phone = true; break;
      case 'plan': lX = -1.0; rX = -1.45 + Math.sin(k * 5) * 0.1; headX = 0.25; break;
      default: // 思考：手托下巴，頭慢慢晃
        rX = -2.5; rZ = -0.45; lX = -1.1; headY = Math.sin(k * 0.8) * 0.3; headZ = -0.1; upX = -0.04;
    }
  } else if (s === 'idle' || s === 'background') {
    // 往後靠、喝咖啡
    upX = -0.14; lX = -0.45; lZ = 0.1;
    const sip = Math.max(0, Math.sin(k * 0.7));
    rX = lerp(-0.8, -2.15, sip * sip); rZ = -0.2; headX = lerp(0, -0.22, sip * sip); mug = true;
    if (a.kind === 'error') { lX = rX = -2.9; lZ = 0.6; rZ = -0.6; mug = false; headX = 0.2; upX = 0.1; }
  } else if (f.deskMode === 'deskgame') {
    // 摸魚：用工位電腦打電動，身體前傾、左手猛按鍵盤、右手甩滑鼠
    upX = 0.16 + Math.sin(k * 2.1) * 0.03; lX = -1.25 + Math.sin(k * 29) * 0.07; lZ = -0.1; rX = -1.3 + Math.sin(k * 7) * 0.12; rZ = 0.15 + Math.sin(k * 5) * 0.12; headX = 0.08; headZ = Math.sin(k * 2.1) * 0.06;
  } else if (f.deskMode === 'slack') {
    // 摸魚：往後靠、拿手機滑
    upX = -0.18; lX = -1.95 + Math.sin(k * 6) * 0.04; lZ = 0.25; phone = true; rX = -0.5; rZ = -0.1; headX = 0.3; headY = 0.1;
  } else {
    // 休息：趴在桌上
    upX = 0.62 + Math.sin(k * 0.9) * 0.015; lX = rX = -1.75; lZ = -0.25; rZ = 0.25; headX = 0.35; headZ = 0.25;
  }

  const r = 1 - Math.pow(0.0015, dt);   // 姿勢平滑過渡
  const P = (o, prop, v) => { o[prop] = lerp(o[prop], v, r); };
  const place = f.nav.place;
  let legX = -Math.PI / 2, legSwing = 0;   // legSwing：兩腿反向擺（跑步、踩飛輪）
  if (place === 'walk') {
    // 走路：雙腿前後擺、手臂反向擺；拿著咖啡的那隻手不擺
    stepWalk(f, dt);
    if (f.nav.place === 'walk') { walkPose(fig, f.nav); return; }
  }
  if (place === 'coffee') {
    // 站在咖啡吧前喝一口；時間到就走回座位
    legX = 0; upX = 0; lX = -0.25; lZ = 0.05;
    const sip = Math.max(0, Math.sin(k * 1.6));
    rX = lerp(-0.9, -2.2, sip * sip); rZ = -0.2; headX = lerp(0.05, -0.25, sip * sip); headY = 0; headZ = 0; mug = true; phone = false;
    const wait = (f.nav.servedAt || 0) - performance.now();
    if (wait > 0) {   // 等咖啡師：看他拉花，最後伸手接
      mug = false; headX = 0.15; headY = baristaRig ? -0.5 : 0; rX = wait < HAND_MS ? -1.3 : -0.1; rZ = 0;
    }
    if (performance.now() > (f.nav.until || 0)) goTo(f, seatTarget(f), { mug: true });
  } else if (place === 'visit') {
    // 外掛叫他去別處做事（例如錄音室的混音台）：站著，雙手在檯面上推，頭跟著點
    legX = 0; upX = 0.06; mug = false; phone = false; headY = 0; headZ = 0;
    lX = -0.95 + Math.sin(k * 5) * 0.22; rX = -0.95 + Math.sin(k * 5 + 1.7) * 0.22; lZ = 0.15; rZ = -0.15;
    headX = 0.12 + Math.max(0, Math.sin(k * 4.2)) * 0.12;
  } else if (place === 'report') {
    // 在主管桌前報告：站好，雙手捧著成品（沒有成品就拿一張紙），偶爾點頭
    legX = 0; upX = 0; headY = 0; headZ = 0; mug = false; phone = false;
    lX = rX = -1.45; lZ = 0.25; rZ = -0.25; headX = 0.05 + Math.max(0, Math.sin(k * 1.3)) * 0.12;
    if (fig.paper) fig.paper.visible = !f.reportHeld;
  } else if (place === 'sofa') {
    // 靠在沙發上睡
    upX = -0.32 + Math.sin(k * 0.9) * 0.015; headX = -0.18; headY = 0; headZ = 0.32; lX = rX = -0.45; lZ = 0.2; rZ = -0.2; mug = false; phone = false;
  } else if (place === 'event') {
    // 辦公室活動：慶功宴歡呼跳、派對跳舞
    legX = 0; headY = 0; headZ = 0; mug = false; phone = false; lZ = 0; rZ = 0;
    if (officeEvent?.kind === 'party') {
      const b = Math.sin(k * 6);
      upX = 0.05; lX = -2.6 + Math.sin(k * 6) * 0.5; rX = -2.6 - Math.sin(k * 6) * 0.5; lZ = 0.3; rZ = -0.3; headZ = b * 0.15; headX = -0.1;
      fig.root.rotation.z = b * 0.08;
    } else {
      const hop = Math.max(0, Math.sin(k * 5));
      lX = rX = -2.9; lZ = 0.35 + hop * 0.2; rZ = -0.35 - hop * 0.2; headX = -0.25; upX = -0.05;
      fig.root.position.y = groundAt(fig.root.position) + hop * 3;
    }
  } else if (place === 'leisure') {
    legX = 0; upX = 0; headX = 0; headY = 0; headZ = 0; lZ = 0; rZ = 0; mug = false; phone = false;
    const kd = f.nav.kind, sip = Math.max(0, Math.sin(k * 0.9));
    if (kd === 'pantry') {   // 茶水間聊天：喝一口、轉頭、比手畫腳
      rX = lerp(-0.9, -2.1, sip * sip); mug = true; headY = Math.sin(k * 0.5) * 0.4; lX = -0.5 + Math.max(0, Math.sin(k * 2.3)) * 0.6; lZ = 0.15;
    } else if (kd === 'window') {   // 窗邊發呆：拿著咖啡看外面
      rX = lerp(-0.9, -2.0, sip * sip * sip); mug = true; lX = 0.25; headX = -0.18; headY = Math.sin(k * 0.3) * 0.25;
    } else if (kd === 'book') {   // 書櫃前翻書
      lX = rX = -1.15; lZ = 0.25; rZ = -0.25; headX = 0.35 + Math.sin(k * 0.4) * 0.05;
    } else if (kd === 'console') {   // 坐地墊打電動：手指狂按、身體跟著晃
      legX = -Math.PI / 2; upX = 0.12 + Math.sin(k * 1.7) * 0.05; lX = -1.15 + Math.sin(k * 31) * 0.05; rX = -1.15 + Math.sin(k * 27) * 0.05; lZ = -0.25; rZ = 0.25; headX = 0.05; headZ = Math.sin(k * 1.7) * 0.1;
    } else if (kd === 'arcade') {   // 大型電玩：搖桿＋按鈕
      upX = 0.1; lX = -1.35 + Math.sin(k * 19) * 0.15; rX = -1.3 + Math.sin(k * 23) * 0.2; headX = 0.05;
    } else if (kd === 'pingpong') {   // 打桌球：揮拍跟著球
      upX = 0.12; rX = -0.7 - Math.max(0, Math.sin(k * 3.2 + (f.nav.side || 0) * Math.PI)) * 1.1; rZ = -0.35; lX = -0.4; headX = 0.1;
    } else if (kd === 'run') {   // 跑步機：原地跑，手臂前後擺
      const sw = Math.sin(k * 9); legSwing = sw * 0.8; upX = 0.12; lX = -0.5 - sw * 0.7; rX = -0.5 + sw * 0.7; lZ = 0.1; rZ = -0.1; headX = -0.05;
      if (f.nav.slot) fig.root.position.y = f.nav.slot.pos.y + Math.abs(sw) * 1.2;
    } else if (kd === 'bike') {   // 飛輪：坐著踩、身體前傾握把手
      legX = -1.25; legSwing = Math.sin(k * 7) * 0.45; upX = 0.4; lX = rX = -1.35; lZ = 0.12; rZ = -0.12; headX = -0.25;
    } else if (kd === 'lift') {   // 重訓架前：二頭彎舉
      const c = Math.max(0, Math.sin(k * 2.4)); lX = rX = -0.3 - c * 1.9; lZ = 0.12; rZ = -0.12; headX = -0.05 + c * 0.05;
    } else if (kd === 'fish') {   // 水族箱前：手背在後面，頭跟著魚慢慢轉
      lX = rX = 0.45; lZ = 0.2; rZ = -0.2; headX = 0.12; headY = Math.sin(k * 0.45) * 0.45; upX = 0.06;
    } else if (kd === 'guitar') {   // 彈吉他：左手按弦、右手刷，頭跟著點
      lX = -1.2; lZ = 0.55; rX = -0.75 + Math.sin(k * 8) * 0.18; rZ = -0.45; headX = 0.12 + Math.max(0, Math.sin(k * 4)) * 0.12; headZ = Math.sin(k * 2) * 0.08;
    } else if (kd === 'drums') {   // 打鼓：坐著，兩手輪流敲
      legX = -Math.PI / 2; upX = 0.08; lX = -1.0 + Math.sin(k * 10) * 0.4; rX = -1.0 + Math.sin(k * 10 + Math.PI) * 0.4; lZ = 0.25; rZ = -0.25; headX = Math.max(0, Math.sin(k * 5)) * 0.15;
    } else if (kd === 'eat') {   // 員工餐廳：坐著，筷子夾一口送到嘴邊，跟對面聊
      legX = -Math.PI / 2; const bite = Math.max(0, Math.sin(k * 1.6)) ** 3; rX = lerp(-1.1, -2.2, bite); rZ = -0.2; lX = -1.0; lZ = 0.15; headX = 0.12 - bite * 0.1; headY = Math.sin(k * 0.4) * 0.25;
    } else if (kd === 'putt') {   // 推桿：彎腰低頭，雙手一起左右擺
      const sw = Math.sin(k * 1.9); upX = 0.35; lX = rX = -0.45; lZ = 0.25 + sw * 0.3; rZ = -0.25 + sw * 0.3; headX = 0.45;
    } else if (kd === 'swing') {   // 模擬器：慢慢上桿、快速下桿揮過去
      const p = (k * 0.35) % 1, a = p < 0.6 ? -(p / 0.6) * 1.6 : -1.6 + ((p - 0.6) / 0.15) * 3.2;
      const sw = Math.max(-1.6, Math.min(1.6, a)); upX = 0.15; lX = rX = -0.6 - Math.abs(sw) * 0.4; lZ = 0.25 + sw; rZ = -0.25 + sw; headX = 0.25;
    } else if (kd === 'keys') {   // 彈鍵盤
      upX = 0.08; lX = -1.15 + Math.sin(k * 6) * 0.08; rX = -1.15 + Math.sin(k * 7 + 1) * 0.08; lZ = 0.3; rZ = -0.3; headX = 0.25; headY = Math.sin(k * 0.8) * 0.15;
    }
    if (fig.book) fig.book.visible = kd === 'book';
    if (fig.pad) fig.pad.visible = kd === 'console';
    if (fig.guitar) fig.guitar.visible = kd === 'guitar';
    if (fig.club) fig.club.visible = kd === 'putt' || kd === 'swing';
  }
  if (place !== 'leisure' && fig.book) fig.book.visible = false;
  if (place !== 'leisure' && fig.pad) fig.pad.visible = false;
  if (place !== 'leisure' && fig.guitar) fig.guitar.visible = false;
  if (place !== 'leisure' && fig.club) fig.club.visible = false;
  if (legSwing) { P(fig.legs[0].rotation, 'x', legX + legSwing); P(fig.legs[1].rotation, 'x', legX - legSwing); }
  else for (const leg of fig.legs) P(leg.rotation, 'x', legX);
  P(fig.upper.rotation, 'x', upX);
  P(fig.head.rotation, 'x', headX); P(fig.head.rotation, 'y', headY); P(fig.head.rotation, 'z', headZ);
  P(fig.arms[0].rotation, 'x', lX); P(fig.arms[1].rotation, 'x', rX);
  P(fig.arms[0].rotation, 'z', -0.08 + lZ); P(fig.arms[1].rotation, 'z', 0.08 + rZ);
  if (place === 'seat') P(fig.root.position, 'y', SEAT_TOP - 7 + rise);
  fig.mug.visible = mug; fig.phone.visible = phone;
  // 杯子別跟著手臂翻過來：手舉越高（越接近嘴邊）杯口越往臉傾
  if (mug) uprightMug(fig, Math.min(1, Math.max(0, (-fig.arms[1].rotation.x - 1.2) / 1.0)));
  if (fig.umbrella) fig.umbrella.visible = false;

  // 螢幕捲動
  const sk = f.desk.screenKind;
  if (sk === 'code' || sk === 'term' || sk === 'page' || sk === 'ext') f.desk.screenMat.map.offset.y += dt * (sk === 'term' ? 0.5 : sk === 'page' ? 0.05 : 0.18);
  if (sk === 'game') f.desk.screenMat.map.offset.x += dt * 0.25;   // 橫向捲軸遊戲
  if (sk === 'ask') f.desk.screenMat.color.setScalar(0.75 + Math.sin(t * 6) * 0.25);
  else f.desk.screenMat.color.setScalar(1);
}

// ── 走動 ──────────────────────────────────────────────────────────────────────
// 小人會離開座位：做完了去咖啡吧拿飲料、休息時去沙發睡、新對話從門口走進來、有事就跑回座位。
// 路線用格子 A* 繞開桌椅和家具，走到「入座點」（椅子後方的走道）再滑進座位坐下。
let navReady = false;   // 第一次載入完才開始走；剛打開頁面時大家直接在定位
const spots = { hw: 0, hd: 0, door: null, coffee: [], sofa: [], obstacles: [] };
const WALK = 70, RUN = 135;   // 公釐／秒
const CELL = 8, PAD = 7;      // 格子大小、障礙物外擴（小人的半個身寬）
const ACTIVE = new Set(['working', 'asking', 'external']);
const isDone = (st) => st === 'idle' || st === 'background';

function seatTarget(f) {
  f.holder.updateWorldMatrix(true, false);
  return {
    name: 'seat', ry: f.holder.rotation.y,
    pos: f.holder.localToWorld(new THREE.Vector3(0, SEAT_TOP - 7, 2)),
    approach: f.holder.localToWorld(new THREE.Vector3(0, 0, -30)),
  };
}
function groundAt(p) {
  for (const isl of islands.values()) {
    const g = isl.group.position;
    if (Math.abs(p.x - g.x) < isl.w / 2 && Math.abs(p.z - g.z) < isl.d / 2) return 3.2;
  }
  return 0;
}

// 障礙物：辦公室家具＋每個人的桌子與椅子（世界座標矩形），交給 path.js 找路
function obstacleGrid() {
  const rects = [...spots.obstacles];
  const v = new THREE.Vector3();
  for (const f of figs.values()) {
    f.holder.updateWorldMatrix(true, false);
    const p1 = f.holder.localToWorld(v.set(-17, 0, -12)).clone(), p2 = f.holder.localToWorld(v.set(17, 0, 28));
    rects.push({ x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2, w: Math.abs(p2.x - p1.x), d: Math.abs(p2.z - p1.z) });
  }
  return buildGrid({ hw: spots.hw, hd: spots.hd, rects, cell: CELL, pad: PAD });
}
function findPath(from, to) {
  const pts = findPathOnGrid(obstacleGrid(), from, to);
  return pts && pts.map(p => new THREE.Vector3(p.x, 0, p.z));
}

function freeSlot(f, keep) {
  const slot = f.nav.slot || f.nav.target?.slot;
  if (slot && slot !== keep && slot.taken === f.id) slot.taken = null;
}

// 從現在的位置出發，走到 target（{ name, pos, approach, ry, slot? }）
function goTo(f, target, { run = false, mug = false, umbrella = false, then } = {}) {
  const root = f.fig.root, nav = f.nav;
  const pts = [];
  if (nav.place === 'seat') pts.push(seatTarget(f).approach);       // 先從椅子後方起身
  else if (nav.place === 'sofa' && nav.slot) pts.push(nav.slot.approach.clone());
  freeSlot(f, target.slot);
  if (root.parent !== scene) scene.attach(root);
  root.rotation.x = root.rotation.z = 0;
  const from = pts[0] || root.position;
  pts.push(...(findPath(from, target.approach) || []), target.approach.clone(), target.pos.clone());
  f.nav = { place: 'walk', pts, target, then, mug, umbrella, speed: run ? RUN : WALK, stride: nav.stride || 0 };
}

function stepWalk(f, dt) {
  const nav = f.nav, root = f.fig.root;
  let dist = nav.speed * dt;
  while (dist > 0 && nav.pts.length) {
    const p = nav.pts[0];
    const dx = p.x - root.position.x, dz = p.z - root.position.z, d = Math.hypot(dx, dz);
    if (d > 0.5) {
      let da = Math.atan2(dx, dz) - root.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      root.rotation.y += da * 0.6;
    }
    if (d <= dist) { root.position.x = p.x; root.position.z = p.z; dist -= d; nav.pts.shift(); }
    else { root.position.x += dx / d * dist; root.position.z += dz / d * dist; dist = 0; }
  }
  nav.stride += nav.speed * dt;
  root.position.y = groundAt(root.position);
  if (!nav.pts.length) arrive(f);
}

function arrive(f) {
  const tg = f.nav.target, root = f.fig.root, then = f.nav.then;
  if (tg.name === 'seat') {
    f.holder.attach(root);
    root.position.set(0, SEAT_TOP - 7, 2); root.rotation.set(0, 0, 0);
  } else {
    root.position.copy(tg.pos); root.rotation.set(0, tg.ry, 0);
  }
  const mug = f.nav.mug;
  if (tg.name === 'coffee' && near(root.position)) sfx.coffee();
  f.nav = { place: tg.name, slot: tg.slot, stride: f.nav.stride, kind: tg.slot?.kind, side: tg.slot?.side };
  if (then) then();
  if (f.data) applyState(f);
  // 走回座位的路上狀態變了（例如還沒坐下就做完了）：坐下後補做該做的事
  if (tg.name === 'seat') {
    if (isDone(f.data.status) && !mug) onStatus(f, 'working', 'idle');
    else if (f.data.status === 'resting') f.leisureUntil = performance.now() + 3000;
  }
}

// 直接放到定位（不走路）：剛打開頁面、辦公室重蓋時用
function placeAt(f, target) {
  const root = f.fig.root;
  freeSlot(f, target.slot);
  if (target.name === 'seat') { f.holder.attach(root); root.position.set(0, SEAT_TOP - 7, 2); root.rotation.set(0, 0, 0); }
  else { scene.attach(root); root.position.copy(target.pos); root.rotation.set(0, target.ry, 0); }
  if (target.slot) target.slot.taken = f.id;
  f.nav = { place: target.name, slot: target.slot };
  for (const leg of f.fig.legs) leg.rotation.x = -Math.PI / 2;
}

function sofaTarget(slot) { return { name: 'sofa', pos: slot.pos, approach: slot.approach, ry: slot.ry, slot }; }

// 狀態變了 → 決定要不要走
function onStatus(f, prev, cur) {
  if (!navReady || !spots.door || f.enter) return;
  if (f.report && ACTIVE.has(cur)) endReport(f, false);   // 報告到一半有事：跑回座位（下面照常處理）
  const place = f.nav.place, heading = f.nav.target?.name;
  if (f.nav.place === 'home') { if (cur !== 'resting') comeBack(f, true); return; }
  if (f.event && ACTIVE.has(cur)) { f.event = false; f.fig.root.rotation.z = 0; }   // 有事：離開活動（下面照常跑回座位）
  if (ACTIVE.has(cur)) {
    // 有事了：不在座位就跑回去（外掛叫他去別處做事時，去那裡）
    if (f.visit) { if (place !== 'visit' && heading !== 'visit') goTo(f, f.visit, { run: true }); }
    else if (place !== 'seat' && heading !== 'seat') goTo(f, seatTarget(f), { run: true });
    else if (place === 'walk') f.nav.speed = RUN;
  } else if (isDone(cur) && ACTIVE.has(prev) && place === 'seat') {
    // 做完了：去咖啡吧或飲水機拿一杯
    goCoffee(f, spots.coffee[hash(f.id + Date.now()) % spots.coffee.length]);
  } else if (cur === 'resting') {
    // 休息了：幾秒內挑一件事做（見 leisureTick）
    f.leisureUntil = performance.now() + 2000 + Math.random() * 8000;
  }
  if (cur !== 'resting' && f.deskMode) { f.deskMode = null; applyState(f); }
}
function goCoffee(f, c) {
  const j = (Math.random() - 0.5) * 12;
  const tg = { name: 'coffee', ry: c.ry, bar: c.bar, pos: c.pos.clone().add(new THREE.Vector3(0, 0, j)), approach: c.pos.clone().add(new THREE.Vector3(0, 0, j)) };
  goTo(f, tg, { then: () => {
    // 咖啡師在：排隊等他做好遞過來，拿到才喝
    if (tg.bar && baristaRig) f.nav.servedAt = baristaRig.serve(f.fig.root.position);
    f.nav.until = (f.nav.servedAt || performance.now()) + 3500;
  } });
}

// ── 休息時找事做 ─────────────────────────────────────────────────────────────
// 休息中的人每隔一兩分鐘換一件事：補眠、茶水間聊天、打電動、摸魚滑手機、窗邊發呆、翻書、趴桌睡。
// 能去哪些地方看辦公室有什麼（設施等級、公司等級）；同時在外面晃的人有上限，不然整間空掉。
const MAX_ROAM = 10;
const LEISURE_WEIGHT = { nap: 3, pantry: 2, console: 3, arcade: 2, pingpong: 3, window: 1, book: 1, run: 2, bike: 2, lift: 1, fish: 2, guitar: 2, drums: 2, keys: 1, eat: 3, putt: 2, swing: 2 };
function leisureKind(f) {
  const p = f.nav.place;
  if (f.event) return 'event';
  if (f.report) return 'report';
  if (p === 'walk') return 'walk';
  if (p === 'leisure') return f.nav.kind;
  if (p === 'sofa') return 'nap';
  return f.deskMode || 'sleep';
}
function leisureTarget(slot) {
  return slot.kind === 'nap' ? sofaTarget(slot) : { name: 'leisure', pos: slot.pos, approach: slot.approach || slot.pos, ry: slot.ry, slot };
}
function leisureTick() {
  if (!navReady || !spots.door) return;
  const now = performance.now();
  let roaming = 0;
  for (const f of figs.values()) if (['leisure', 'sofa'].includes(f.nav.place) || ['leisure', 'sofa'].includes(f.nav.target?.name)) roaming++;
  for (const f of figs.values()) {
    if (f.data.status !== 'resting' || f.enter || f.event || f.report || f.nav.place === 'walk' || f.nav.place === 'home' || f.nav.target?.name === 'home') continue;
    if (offNow()) continue;
    if (!f.leisureUntil) { f.leisureUntil = now + Math.random() * 45000; continue; }   // 剛打開頁面：錯開出發
    if (now < f.leisureUntil) continue;
    f.leisureUntil = now + 40000 + Math.random() * 80000;
    const out = ['leisure', 'sofa'].includes(f.nav.place);
    pickLeisure(f, out || roaming < MAX_ROAM);
    if (!out && ['leisure', 'sofa'].includes(f.nav.target?.name)) roaming++;
  }
}
function pickLeisure(f, canRoam) {
  const opts = [['slack', 2], ['deskgame', 2], ['sleep', 2]];
  const free = {};
  if (canRoam) for (const sl of [...spots.sofa, ...spots.leisure]) {
    if (sl.taken && sl.taken !== f.id) continue;
    (free[sl.kind] = free[sl.kind] || []).push(sl);
  }
  for (const k of Object.keys(free)) opts.push([k, LEISURE_WEIGHT[k] || 1]);
  const pick = pickWeighted(opts);
  if (free[pick]) {
    // 桌球優先湊對：有人在等就站到對面
    const list = free[pick];
    const sl = pick === 'pingpong' ? (list.find(x => spots.leisure.some(o => o.kind === 'pingpong' && o !== x && o.taken)) || list[0]) : list[Math.floor(Math.random() * list.length)];
    if (sl.taken === f.id) return;
    f.deskMode = null;
    sl.taken = f.id;
    goTo(f, leisureTarget(sl));
    applyState(f);
    return;
  }
  // 摸魚（滑手機、打電動）或趴睡都在自己座位
  const mode = pick === 'sleep' ? null : pick;
  if (f.nav.place === 'seat') { f.deskMode = mode; applyState(f); }
  else { goTo(f, seatTarget(f), { then: () => { f.deskMode = mode; applyState(f); } }); applyState(f); }
}

// 新來的人：從門口出現，走到自己的位子
function flushEnters() {
  for (const f of figs.values()) {
    if (!f.enter) continue;
    f.enter = false;
    const root = f.fig.root;
    root.visible = true;
    if (!spots.door) continue;
    scene.attach(root);
    root.position.copy(spots.door); root.rotation.set(0, Math.PI / 2, 0);
    f.nav = { place: 'door' };
    goTo(f, seatTarget(f), { umbrella: true });
  }
}

// 第一次載入：最近休息的幾個人直接躺在沙發上，其他人在座位
function initNav() {
  navReady = true;
  if (offNow()) for (const f of figs.values()) {
    if (f.data.status !== 'resting') continue;
    scene.attach(f.fig.root); f.fig.root.visible = false; f.nav = { place: 'home' };
  }
  const resting = [...figs.values()].filter(f => f.data.status === 'resting' && f.nav.place !== 'home').sort((a, b) => b.data.updatedAt - a.data.updatedAt);
  for (const slot of spots.sofa) { const f = resting.shift(); if (f) placeAt(f, sofaTarget(slot)); }
}

// ── 同事＝背景任務 ────────────────────────────────────────────────────────────
// 主角派出一個背景任務，門口就走進一個同事：小一號、跟主角同一身打扮（看得出誰派的），
// 背景 agent 戴耳機、背景指令戴安全帽。先到主角桌邊點頭接工作，再去右牆的共用工作桌做事；
// 做完走回主角桌邊遞一張紙（回報），再從門口離開。點同事＝打開主角那段對話。
const HELPER_SCALE = 0.8;

function buildHelper(owner, task) {
  // 跟主角同一套制服；背景指令的同事改戴安全帽
  const fig = buildFigure(owner.id, owner.fig.outfit, { noHat: task.type === 'bash' });
  fig.root.scale.setScalar(HELPER_SCALE);
  if (task.type === 'agent') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.9, 8, 20, Math.PI), plastic('#1b2a34'));
    band.position.y = 6; band.castShadow = true; fig.head.add(band);
    for (const sx of [-1, 1]) { const cup = roundBrick(2.6, 2.4, '#c91a09'); cup.rotation.z = Math.PI / 2; cup.position.set(sx * 6, 5, 0); fig.head.add(cup); }
  } else {
    hatPart.hardhat(fig.head);
  }
  // 回報用的紙
  const paper = box(7, 0.6, 9, '#f4f4f4'); paper.position.set(0, -13, 4); paper.visible = false;
  fig.arms[1].add(paper); fig.paper = paper;
  const tagDiv = document.createElement('div');
  tagDiv.className = 'fig-tag';
  tagDiv.innerHTML = `<div class="act">${esc(tr(task.type === 'agent' ? '助手：{desc}' : '指令：{desc}', { desc: task.desc || tr('背景任務') }))}</div>`;
  const tag = new CSS2DObject(tagDiv); tag.position.set(0, 52, 0); fig.root.add(tag);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 46, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = 23; hit.userData.figId = owner.id; fig.root.add(hit);
  pickables.push(hit);
  scene.add(fig.root);
  const h = { id: owner.id + ':' + task.id, owner, task, fig, tag, hit, nav: { place: 'door' }, phase: (hash(task.id) % 1000) / 160 };
  return h;
}

// ── 「你」：送出訊息時，代表你的小人從門口快步走到那個人桌邊，遞上寫著那句話的便利貼，再走開 ──
// 只演新鮮的（30 秒內送出的）；同時最多 3 個；頁面在背景或剛打開時不演
const bosses = new Set();
function maybeBoss(f) {
  const p = f.data.prompt;
  if (!p?.at || p.at === f.promptAt) return;
  const first = f.promptAt === undefined;
  f.promptAt = p.at;
  if (Date.now() - p.at > 30_000 || (first && !navReady)) return;
  spawnBoss(f, p.text || '');
}
function spawnBoss(f, text) {
  if (!navReady || !spots.door || bosses.size >= 3 || document.hidden || replay) return;
  const fig = buildCast('boss') || buildFigure('you', 'you');
  const note = box(7, 0.6, 7, '#ffe066'); note.position.set(0, -13, 4); fig.arms[1].add(note);
  const tagDiv = document.createElement('div');
  tagDiv.className = 'fig-tag';
  tagDiv.innerHTML = `<div class="note-bubble"><small>${esc(tr('你'))}</small>${esc([...text].slice(0, 40).join('') + ([...text].length > 40 ? '…' : ''))}</div>`;
  const tag = new CSS2DObject(tagDiv); tag.position.set(0, 52, 0); fig.root.add(tag);
  scene.add(fig.root);
  fig.root.position.copy(spots.boss?.door || spots.door); fig.root.rotation.y = Math.PI / 2;   // 從主管室出門
  const b = { id: 'you:' + f.id, owner: f, fig, tag, nav: { place: 'door' }, phase: 0 };
  bosses.add(b);
  goTo(b, ownerSpot(f), { run: true, then: () => { b.nav.until = performance.now() + 2600; } });
}
function animateBoss(b, t, dt) {
  const fig = b.fig;
  if (b.nav.place === 'walk') {
    stepWalk(b, dt);
    if (b.nav.place === 'walk') { walkPose(fig, b.nav); fig.arms[1].rotation.x = -0.9; return; }
  }
  if (b.nav.place === 'owner') {   // 把便利貼遞出去，時間到就走
    fig.arms[1].rotation.x = lerp(fig.arms[1].rotation.x, -1.5, 0.3);
    if (performance.now() > b.nav.until) goTo(b, spots.boss ? { name: 'door', pos: spots.boss.door, approach: spots.boss.door, ry: 0 } : doorTarget(), { then: () => dropBoss(b) });
  }
}
function dropBoss(b) { b.fig.root.removeFromParent(); b.tag.element.remove(); bosses.delete(b); }

function dropHelper(h) {
  h.fig.root.removeFromParent();
  h.tag.element.remove();
  const i = pickables.indexOf(h.hit); if (i >= 0) pickables.splice(i, 1);
  if (h.slot) { h.slot.taken = null; setHotScreen(h.slot, 'off'); }
  h.owner.helpers?.delete(h.task.id);
}

// 主角桌子後方的走道：同事站這裡交接
function ownerSpot(owner) {
  const st = seatTarget(owner);
  return { name: 'owner', pos: st.approach, approach: st.approach, ry: st.ry };
}
function hotTarget(slot) { return { name: 'hot', pos: slot.pos, approach: slot.approach, ry: slot.ry, slot }; }
function doorTarget() { return { name: 'door', pos: spots.door, approach: spots.door, ry: -Math.PI / 2 }; }
function setHotScreen(slot, kind) {
  if (slot.screenKind === kind) return;
  const t = screenTex(kind).clone(); t.wrapT = THREE.RepeatWrapping;
  slot.screenMat.map = t; slot.screenMat.needsUpdate = true; slot.screenKind = kind;
}

function sendToHotDesk(h) {
  const slot = spots.hot.find(x => !x.taken);
  if (!slot) { goTo(h, ownerSpot(h.owner)); return; }   // 沒位子就站在主角旁邊
  slot.taken = h.id; h.slot = slot;
  goTo(h, hotTarget(slot), { then: () => setHotScreen(slot, h.task.type === 'agent' ? 'agent' : 'term') });
}

// 對照背景任務清單：新的派人進來，做完的走回來回報再離開
function syncHelpers(f) {
  const bg = [...(f.data.bg || [])];
  // 前景的子 agent（Claude 派出去、等它回來）也算一個同事：主角換做別的事就收工回報
  const a = f.data.act;
  if (f.data.status === 'working' && a?.kind === 'agent' && /^(Agent|Task)$/.test(a.tool || '')) {
    bg.push({ id: 'fg:' + (a.since || a.detail || ''), type: 'agent', desc: a.detail || tr('子任務') });
  }
  f.helpers = f.helpers || new Map();
  const ids = new Set(bg.map(t => t.id));
  for (const task of bg) {
    if (f.helpers.has(task.id)) continue;
    const h = buildHelper(f, task);
    f.helpers.set(task.id, h);
    if (!navReady || !spots.door) {
      // 剛打開頁面：已經在共用桌上做事了
      const slot = spots.hot?.find(x => !x.taken);
      if (slot) { slot.taken = h.id; h.slot = slot; placeHelper(h, hotTarget(slot)); setHotScreen(slot, task.type === 'agent' ? 'agent' : 'term'); }
      else placeHelper(h, ownerSpot(f));
      continue;
    }
    f.phoneUntil = performance.now() + 2600;
    h.fig.root.position.copy(spots.door); h.fig.root.rotation.y = Math.PI / 2;
    goTo(h, ownerSpot(f), { then: () => { h.nav.until = performance.now() + 1300; h.nav.nod = true; } });
  }
  for (const [tid, h] of f.helpers) {
    if (ids.has(tid) || h.leaving) continue;
    h.leaving = true;
    if (!navReady || !spots.door) { dropHelper(h); continue; }
    if (h.slot) { h.slot.taken = null; setHotScreen(h.slot, 'off'); h.slot = null; }
    goTo(h, ownerSpot(f), { then: () => { h.nav.until = performance.now() + 1600; h.nav.hand = true; } });
  }
}
function placeHelper(h, tg) {
  h.fig.root.position.copy(tg.pos); h.fig.root.rotation.set(0, tg.ry, 0);
  h.nav = { place: tg.name, slot: tg.slot };
}

function animateHelper(h, t, dt) {
  const fig = h.fig, nav = h.nav, k = t + h.phase;
  if (nav.place === 'walk') { stepWalk(h, dt); if (h.nav.place === 'walk') { walkPose(fig, h.nav); return; } }
  const now = performance.now();
  // 交接：點頭接工作／遞紙回報，時間到就走下一步
  if (h.nav.place === 'owner' && h.nav.until && now > h.nav.until) {
    if (h.nav.hand) goTo(h, doorTarget(), { then: () => dropHelper(h) });
    else sendToHotDesk(h);
    return;
  }
  const seated = h.nav.place === 'hot';
  let legX = 0, upX = 0, headX = 0, headY = 0, lX = -0.15, rX = -0.15, paper = false;
  if (seated) {
    legX = -Math.PI / 2;
    const fast = h.task.type === 'agent' ? 14 : 22;
    lX = -1.28 + Math.sin(k * fast) * 0.13; rX = -1.28 + Math.sin(k * fast + Math.PI) * 0.13; headX = 0.12;
    if (h.task.type === 'agent') headY = Math.sin(k * 0.7) * 0.15;   // 戴著耳機跟著搖
    const sm = h.slot?.screenMat.map; if (sm) sm.offset.y += dt * 0.4;
  } else if (h.nav.place === 'owner') {
    if (h.nav.hand) { rX = -1.45; paper = true; headX = 0.1; }
    else if (h.nav.nod) headX = Math.max(0, Math.sin(k * 7)) * 0.35;
  }
  const r = 1 - Math.pow(0.0015, dt);
  const P = (o, prop, v) => { o[prop] = lerp(o[prop], v, r); };
  for (const leg of fig.legs) P(leg.rotation, 'x', legX);
  P(fig.upper.rotation, 'x', upX);
  P(fig.head.rotation, 'x', headX); P(fig.head.rotation, 'y', headY); fig.head.rotation.z = 0;
  P(fig.arms[0].rotation, 'x', lX); P(fig.arms[1].rotation, 'x', rX);
  fig.paper.visible = paper; fig.mug.visible = false; fig.phone.visible = false;
}

function helperCount() { let n = 0; for (const f of figs.values()) n += f.helpers ? [...f.helpers.values()].filter(h => !h.leaving).length : 0; return n; }

// 選中的人腳下的光圈
const ring = new THREE.Mesh(new THREE.TorusGeometry(17, 1.3, 8, 40), new THREE.MeshBasicMaterial({ color: '#0b6fd6', toneMapped: false }));
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
scene.add(ring);

// ── 辦公室：大樓裡的一層，全部用積木拼 ───────────────────────────────────────
// 四面磚牆、窗外是積木城市；擋住鏡頭的那面牆自動藏起來（像模擬市民）
const office = new THREE.Group();
scene.add(office);
let officeKey = '';
const walls = [];          // { group, n: 內側法向, p: 牆上一點 }
function trophyShelf(list) {
  const g = new THREE.Group();
  const n = Math.max(3, list.length);
  g.add(box(n * 11 + 6, 2, 10, '#5a3a22', 0, 0, 0));
  for (const x of [-(n * 11) / 2, (n * 11) / 2]) g.add(box(2, 6, 8, '#5a3a22', x, -4, -1));
  list.forEach((t, i) => {
    g.add(at(trophyMesh(t.shape || 'cup'), -(n * 11) / 2 + 8 + i * 11, 1, 0));
  });
  return g;
}

// 牆面統計：電視（1 級）或整面看板（2 級），每幾秒重畫
let statsBoard = null;
function statsPanel(big) {
  const g = new THREE.Group();
  const W = big ? 130 : 80, H = big ? 70 : 46;
  g.add(box(W + 4, H + 4, 2.4, '#1b1b1b', 0, 0, 0));
  const c = document.createElement('canvas'); c.width = big ? 1024 : 512; c.height = big ? 552 : 294;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  scr.position.z = 1.25; g.add(scr);
  if (big) for (const x of [-W / 6, W / 6]) g.add(box(0.6, H, 0.4, '#1b1b1b', x, 0, 1.4));
  statsBoard = { tex, big };
  drawStats();
  return g;
}
function drawStats() {
  if (!statsBoard) return;
  const c = statsBoard.tex.image, g = c.getContext('2d'), W = c.width, H = c.height, big = statsBoard.big;
  const u = W / 512;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0e2240'); gr.addColorStop(1, '#16335c');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const info = { u, working: [...figs.values()].filter(f => ['working', 'asking'].includes(f.data.status)).length, helpers: helperCount() };
  // 外掛（claude-web 的經營系統）有自己的看板內容就用它的
  if (!plugins.some(p => p.drawBoard?.(g, W, H, big, info))) {
    g.fillStyle = '#9fc3e9'; g.font = `600 ${18 * u}px sans-serif`; g.fillText(look.levelName || '', 18 * u, 32 * u);
    const nums = [[tr('工作中'), info.working], [tr('同事'), info.helpers], [tr('在場'), figs.size]];
    nums.forEach(([k, v], i) => {
      const x = 18 * u + i * ((big ? W / 3 : W) - 30 * u) / 3;
      g.fillStyle = '#ffd36b'; g.font = `800 ${40 * u}px sans-serif`; g.fillText(String(v), x, 88 * u);
      g.fillStyle = '#9fc3e9'; g.font = `${15 * u}px sans-serif`; g.fillText(k, x, 110 * u);
    });
  }
  statsBoard.tex.needsUpdate = true;
}

// 咖啡師（咖啡吧 2 級）：閒著擦杯子；有人來吧台就轉過去拉花，做好一杯拿鐵遞給他
let npcs = [], baristaRig = null, baristaHit = null;
// 額度豆罐（咖啡吧牆上的層架）：Claude、Codex、Grok 各一組，沒有數字的那家不擺、有的那幾組在層架上置中排開；點了看額度小卡
const QUOTA_COLOR = { codex: '#10a37f', claude: '#d97757', grok: '#55606b' };
const QUOTA_WHO = ['claude', 'codex', 'grok'];
let quotaSets = {}, quotaHits = [];
function placeQuotaJars(hw, hd) {
  const g = at(new THREE.Group(), -hw + 14, 0, -hd * 0.45 + 50, Math.PI / 2);   // 跟咖啡吧同一個座標
  g.userData.keep = true;
  quotaSets = {};
  for (const who of QUOTA_WHO) {
    const set = at(quotaJars(QUOTA_COLOR[who], { weeklyOnly: who === 'grok' }), QUOTA_SHELF.x, QUOTA_SHELF.y, QUOTA_SHELF.z);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(set.userData.width + 1, 18, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 7; hit.userData.keep = true; hit.userData.onPick = () => ({ claude: openClaudeQuota, codex: openCodexQuota, grok: openGrokQuota })[who]();
    set.add(hit); set.userData.hit = hit;
    g.add(set); quotaSets[who] = set;
  }
  office.add(g);
  applyQuotaJars(true);
}
function applyQuotaJars(snap = false) {
  for (const o of quotaHits.splice(0)) { const i = extraPicks.indexOf(o); if (i >= 0) extraPicks.splice(i, 1); }
  const shown = [];
  for (const [who, q] of [['claude', claudeQuota], ['codex', codexQuota], ['grok', grokQuota]]) {
    const set = quotaSets[who];
    if (!set) continue;
    set.visible = !!(q?.primary || q?.secondary);
    if (!set.visible) continue;
    shown.push(set);
    const left = (x) => (x ? 1 - Math.min(100, x.used_percent) / 100 : 1);
    set.userData.set(left(q.primary), left(q.secondary));
    if (snap) set.userData.snap();
    extraPicks.push(set.userData.hit); quotaHits.push(set.userData.hit);
  }
  // 有數字的那幾組在層架上置中排開，中間留一點空
  const GAP = 2, total = shown.reduce((n, s) => n + s.userData.width, 0) + GAP * Math.max(0, shown.length - 1);
  let x = QUOTA_SHELF.x - total / 2;
  for (const s of shown) { s.position.x = x + s.userData.width / 2; x += s.userData.width + GAP; }
}
const snackAt = (hd, fac) => fac.coffee >= 2 && -hd * 0.45 - 71 > -hd + 36 ? -hd * 0.45 - 48 : null;
const coolerAt = (hd, fac) => -hd * 0.45 - (fac.coffee >= 2 ? 14 : 0);
const POUR_MS = 3800, HAND_MS = 1200;
const LATTE_TEST = LATTE_KEYS.find(k => k === new URLSearchParams(location.search).get('latte'));   // 測試：?latte=momo 每杯都做這款
const latteMats = {};   // 一款拉花一個材質（textures.js 的 LATTE_ARTS）
const latteMat = (key) => latteMats[key] ||= new THREE.MeshStandardMaterial({ roughness: 0.4, map: latteTex(key) });
function barista() {
  const f = buildCast('barista') || buildFigure('barista', 'barista');
  f.root.userData.keep = true;
  for (const leg of f.legs) leg.rotation.x = 0;
  // 道具：左手奶缸、右手拿鐵杯（杯面拉花跟著倒奶慢慢長出來）
  const pitcher = new THREE.Group();
  pitcher.add(mesh(new THREE.CylinderGeometry(1.7, 2.1, 4, 14), null, new THREE.MeshPhysicalMaterial({ color: '#d7dde2', metalness: 0.9, roughness: 0.18 })));
  const lip = box(1, 0.6, 1.6, '#d7dde2', 0, 2, 1.8); pitcher.add(lip);
  pitcher.position.set(0, -13.6, 2); pitcher.visible = false; f.arms[0].add(pitcher);
  const latte = new THREE.Group();
  latte.add(mesh(new THREE.CylinderGeometry(3.1, 2.2, 3.6, 18, 1, true), '#f4f4f4'), at(roundBrick(2.2, 0.3, '#f4f4f4', 16), 0, -1.65, 0), at(roundBrick(3.8, 0.5, '#f4f4f4', 18), 0, -2, 0));
  latte.children[0].material = latte.children[0].material.clone(); latte.children[0].material.side = THREE.DoubleSide;   // 開口杯：從上面看得到裡面的咖啡
  const art = new THREE.Mesh(new THREE.CircleGeometry(2.95, 24), latteMat('heart')); art.rotation.x = -Math.PI / 2; art.position.y = 1.5; latte.add(art);
  latte.position.set(0, -14, 2.6); latte.visible = false; f.arms[1].add(latte);
  for (const x of [pitcher, latte]) x.traverse(o => { o.userData.keep = true; });
  // 點他：鏡頭飛到正前方偏上拍特寫（看得到杯裡的拉花）
  baristaHit = new THREE.Mesh(new THREE.BoxGeometry(20, 40, 18), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  baristaHit.position.y = 20; baristaHit.userData.keep = true; f.root.add(baristaHit); extraPicks.push(baristaHit);
  baristaHit.userData.onPick = () => {
    setFollow(null);
    const p = f.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(4, 20, 4));
    flyTo(p, new THREE.Vector3(0.5, 1.35, 0.35).normalize().multiplyScalar(controls.minDistance + 2));
  };
  const rig = baristaRig = { root: f.root, ry0: Math.PI / 2, jobs: [], busyUntil: 0, target: null };
  // 有人在吧台等：排進去，回傳拿到咖啡的時間
  rig.serve = (pos) => {
    const start = Math.max(performance.now(), rig.busyUntil);
    rig.busyUntil = start + POUR_MS + HAND_MS;
    rig.jobs.push({ start, pos: pos.clone(), art: LATTE_TEST || LATTE_KEYS[Math.floor(Math.random() * LATTE_KEYS.length)] });
    return rig.busyUntil;
  };
  const lerpAng = (a, b, k) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
  npcs.push((t) => {
    const now = performance.now();
    while (rig.jobs.length && now > rig.jobs[0].start + POUR_MS + HAND_MS) rig.jobs.shift();
    const job = rig.jobs[0] && now >= rig.jobs[0].start ? rig.jobs[0] : null;
    const face = job ? Math.atan2(job.pos.x - f.root.position.x, job.pos.z - f.root.position.z) : rig.ry0;
    f.root.rotation.y = lerpAng(f.root.rotation.y, face, 0.08);
    pitcher.visible = latte.visible = !!job;
    if (!job) {   // 閒著：擦杯子、東張西望
      f.arms[1].rotation.x = -1.2 + Math.sin(t * 5) * 0.25; f.arms[1].rotation.z = 0.3 + Math.sin(t * 5) * 0.2; f.arms[0].rotation.x = -1.0; f.arms[0].rotation.z = 0;
      f.head.rotation.set(0, Math.sin(t * 0.7) * 0.3, 0);
      return;
    }
    const e = now - job.start;
    art.material = latteMat(job.art);
    if (e < POUR_MS) {   // 拉花：右手杯子斜放、左手奶缸傾倒並左右晃，拉花慢慢變大
      const k = e / POUR_MS;
      f.arms[1].rotation.set(-1.25, 0, -0.35);
      f.arms[0].rotation.set(-1.45 - Math.min(1, k * 3) * 0.25, 0, 0.45 + Math.sin(e * 0.018) * 0.06 * (k > 0.3 ? 1 : 0));
      pitcher.rotation.set(0, 0, 0); pitcher.rotation.z = -Math.min(1, k * 2.5) * 1.1;
      art.scale.setScalar(Math.max(0.05, Math.min(1, (k - 0.15) / 0.75)));
      f.head.rotation.set(0.35, 0, 0);
    } else {   // 遞出去：右手伸直，奶缸收回
      pitcher.visible = false; art.scale.setScalar(1);
      f.arms[1].rotation.set(-1.5, 0, 0); f.arms[0].rotation.set(-0.1, 0, 0);
      f.head.rotation.set(0, 0, 0);
    }
    latte.rotation.set(-f.arms[1].rotation.x, 0, -f.arms[1].rotation.z, 'ZYX');   // 杯口一直朝上（arm 的反轉）
  });
  return f.root;
}

// ── 主管室：右後角，主管（代表你）坐在大桌後面；叫員工進來報告時站到桌前 ──
const HOT_Z = BOSS_ROOM.D + 30;   // 共用工作桌從主管室前面開始排
let bossCallUntil = 0, bossHit = null;   // 主管在講電話到什麼時候；點主管桌叫出名冊的隱形範圍
function buildBossRoom(hw, hd, glassy, extra) {
  const { W, D, door } = BOSS_ROOM, cx = hw - W / 2 - 4, cz = -hd + D / 2 + 4;
  const room = bossOffice(glassy);
  office.add(at(room, cx, 0, cz));
  // 點桌上電話（整張主管桌都算）：打開員工名冊
  if (bossHit) { const i = extraPicks.indexOf(bossHit); if (i >= 0) extraPicks.splice(i, 1); }
  bossHit = new THREE.Mesh(new THREE.BoxGeometry(52, 44, 40), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  bossHit.position.set(cx + 10, 22, cz - 24); bossHit.userData.keep = true; bossHit.userData.onPick = () => openRoster();
  office.add(bossHit); extraPicks.push(bossHit);
  extra.push({ x: cx + 10, z: cz - 18, w: 48, d: 22 }, { x: cx + 10, z: cz - 37, w: 16, d: 12 });   // 主管桌、皮椅
  if (glassy) extra.push({ x: cx - W / 2, z: cz, w: 4, d: D }, { x: cx + door / 2, z: cz + D / 2, w: W - door, d: 4 }, { x: cx - W / 2 + 26, z: cz - D / 2 + 8, w: 34, d: 12 });
  // 主管本人：坐在皮椅上，面向門口
  const fig = buildCast('boss') || buildFigure('you', 'you');
  fig.root.position.set(cx + 10, SEAT_TOP - 7, cz - 34); fig.root.rotation.y = 0;
  for (const leg of fig.legs) leg.rotation.x = -Math.PI / 2;
  fig.arms[0].rotation.x = fig.arms[1].rotation.x = -1.3;
  fig.root.userData.keep = true;   // 會動（點頭、拿電話），不能合併成靜態網格
  office.add(fig.root);
  spots.boss = {
    fig, center: new THREE.Vector3(cx, 0, cz),
    door: new THREE.Vector3(cx - W / 2 + door / 2, 0, cz + D / 2 + 14),   // 門外：「你」出門交代事情從這裡走
    slots: [-12, 10, 32].map(dx => ({ pos: new THREE.Vector3(cx + dx, 0, cz + 6), approach: new THREE.Vector3(cx + dx, 0, cz + 14), ry: Math.PI, taken: null })),
  };
  // 有人來報告就看著他點頭；「你」出去遞便利貼時位子是空的
  npcs.push((t) => {
    fig.root.visible = bosses.size === 0;
    const listening = spots.boss.slots.some(sl => sl.taken && figs.get(sl.taken)?.nav.place === 'report');
    fig.head.rotation.x = listening ? Math.max(0, Math.sin(t * 3)) * 0.18 : Math.sin(t * 0.7) * 0.04;
    fig.head.rotation.y = listening ? 0 : Math.sin(t * 0.3) * 0.25;
    // 打電話叫人：拿起話筒貼著耳朵
    const calling = performance.now() < bossCallUntil;
    room.userData.handset.visible = !calling; if (fig.phone) fig.phone.visible = calling;
    fig.arms[0].rotation.x = calling ? -2.55 : -1.3; fig.arms[0].rotation.z = calling ? 0.55 : 0;
    if (calling) { fig.head.rotation.z = -0.18; fig.head.rotation.y = 0.2; } else fig.head.rotation.z = 0;
  });
}

// ── 公司等級決定辦公室長相 ──
// 0 車庫：水泥地、灰牆、鐵捲門、紙箱；1 小工作室（磚牆、窗外城市）；2 正式辦公室：玻璃會議室；
// 3 整層樓：遊戲角、樓層更高；4 總部：大廳 logo 牆、接待櫃台、窗邊空中花園
let officeLevel = look.level;
const STRIP = 110;   // 整層樓多出來的窗邊那一條有多深
const SIDE = 160;    // 總部大樓左右兩側各加寬多少（左邊高爾夫、右邊餐廳和午睡艙）
let pingBall = null;   // 桌球：兩邊都有人才會來回飛
let moon = null;       // 中秋的滿月
let fireworks = null;  // 跨年午夜窗外的煙火
function buildOffice(halfW, halfD) {
  const lv = officeLevel;
  // 整層樓：窗邊多一條（STRIP）給健身角、水族箱、樂團角，也比較寬
  const hw = Math.max(Math.ceil((halfW + 130 + (lv >= 4 ? SIDE : 0)) / 8) * 8, lv >= 4 ? 480 : lv >= 3 ? 320 : lv >= 2 ? 224 : 0), hd = Math.ceil((halfD + 130 + (lv >= 2 ? 80 : 0) + (lv >= 3 ? STRIP : 0)) / 8) * 8;
  const fac = shown.fac || {};
  const holiday = holidayNow();
  const key = hw + ':' + hd + ':' + lv + ':' + JSON.stringify(fac) + ':' + look.trophies.map(t => t.id).join(',') + ':' + holiday;
  if (key === officeKey) return;
  officeKey = key;
  office.clear(); walls.length = 0; npcs = []; baristaRig = null; statsBoard = null; moon = null;
  if (fireworks) { scene.remove(fireworks.group); fireworks = null; }
  if (baristaHit) { const i = extraPicks.indexOf(baristaHit); if (i >= 0) extraPicks.splice(i, 1); baristaHit = null; }
  for (const o of quotaHits.splice(0)) { const i = extraPicks.indexOf(o); if (i >= 0) extraPicks.splice(i, 1); }
  quotaSets = {};
  const extra = [];   // 等級帶來的家具，走動時要繞開
  // 地板（大樓的一層樓板）
  office.add(texBox(hw * 2 + 16, 9.6, hd * 2 + 16, lv === 0 ? concreteMat(hw * 2 + 16, hd * 2 + 16) : floorMat(hw * 2 + 16, hd * 2 + 16), 0, -4.8, 0));
  // 四面牆：後、左有窗與白板；前、右也蓋，只是鏡頭在外面時會藏
  const mk = (len, win, color, x, z, ry, nx, nz) => {
    const g = wall(len, win, color);
    g.position.set(x, 0, z); g.rotation.y = ry;
    office.add(g);
    walls.push({ group: g, n: new THREE.Vector3(nx, 0, nz), p: new THREE.Vector3(x, 0, z) });
    return g;
  };
  const garage = lv === 0;
  const wallA = garage ? '#8a8f94' : '#e6e2d8', wallB = garage ? '#7b8086' : '#7fa7cf';
  mk(hw * 2 + 8, !garage, wallA, 0, -hd - 4, 0, 0, 1);
  const left = mk(hd * 2 + 8, false, wallB, -hw - 4, 0, Math.PI / 2, 1, 0);
  mk(hw * 2 + 8, !garage, wallA, 0, hd + 4, Math.PI, 0, -1);
  const right = mk(hd * 2 + 8, false, wallB, hw + 4, 0, -Math.PI / 2, -1, 0);
  // 左牆：門（車庫是鐵捲門）、白板、時鐘；總部多一面 logo 牆
  left.add(at(garage ? rollupDoor() : door(), -hd + 60, 0, garage ? 5 : 4.5));
  // 牆面：白板 → 即時統計電視 → 整面看板
  left.add(at(fac.wall >= 2 ? statsPanel(true) : fac.wall === 1 ? statsPanel(false) : whiteboard(), 0, fac.wall >= 2 ? 78 : 70, 5));
  // 獎盃架：掛在書櫃上方
  if (look.trophies.length) left.add(at(trophyShelf(look.trophies), -(hd * 0.35 + 21), 96, 7));
  // 時鐘：車庫和小工作室只有一個本地鐘，公司長大才掛成一排世界時鐘（正式辦公室 3 個、整層樓 4 個、總部 5 個）
  const homeTz = host.homeTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  left.add(at(worldClocks(pickClocks({ localTz: homeTz, lang: LANG, n: host.clockCount || [1, 1, 3, 4, 5][lv] || 5, extra: host.worldClocks }), homeTz, (d) => tr(d < 0 ? '昨天' : '明天')), hd * 0.55, 98, 5.5));
  if (lv >= 4) right.add(at(logoWall(), 0, 32, 5));   // 右牆高處，共用工作桌上方
  // 靠牆的家具
  if (garage) {
    office.add(at(cardboard(), -hw + 18, 0, hd * 0.35, 0.2), at(cardboard(), -hw + 18, 0, hd * 0.35 + 30, -0.3));
  } else {
    office.add(at(bookshelf(), -hw + 10, 0, hd * 0.35, Math.PI / 2));
    office.add(at(bookshelf(), -hw + 10, 0, hd * 0.35 + 42, Math.PI / 2));
  }
  // 有咖啡師時飲水機換成飲料冰箱、往牆角挪，讓他站在冰箱跟吧台中間
  const coolerZ = coolerAt(hd, fac);
  office.add(at(fac.coffee >= 2 ? drinkFridge() : cooler(), -hw + 14, 0, coolerZ, Math.PI / 2));
  office.add(at(coffeeBar(fac.coffee || 0), -hw + 14, 0, -hd * 0.45 + 50, Math.PI / 2));
  placeQuotaJars(hw, hd);
  // 零食櫃：冰箱再過去靠牆（辦公室太短、會撞到牆角盆栽就不放）
  const snackZ = snackAt(hd, fac);
  if (snackZ != null) { office.add(at(snackShelf(), -hw + 8, 0, snackZ, Math.PI / 2)); extra.push({ x: -hw + 8, z: snackZ, w: 16, d: 42 }); }
  if (fac.coffee >= 2) { office.add(at(barista(), -hw + 16, 0, -hd * 0.45 + 6, Math.PI / 2)); extra.push({ x: -hw + 16, z: -hd * 0.45 + 6, w: 16, d: 16 }); }
  if (!garage) {
    office.add(at(holiday === 'christmas' ? xmasTree() : plant(true), -hw + 22 + (holiday === 'christmas' ? 8 : 0), 0, -hd + 22 + (holiday === 'christmas' ? 8 : 0)));
    office.add(at(plant(true), hw - 22, 0, -hd + 22));
    office.add(at(plant(false), -hw + 18, 0, hd - 18));
  }
  const cabinetXs = [];   // 節日小點心擺在矮櫃上
  for (let x = -hw + 80, i = 0; x < hw - 80; x += 120, i++) {
    if (lv >= 2 && Math.abs(x) < 100) continue;   // 會議室的位置
    if (x > hw - BOSS_ROOM.W - 20) continue;       // 主管室的位置
    if (garage) { office.add(at(cardboard(), x, 0, -hd + 14, i * 0.4)); continue; }
    office.add(at(lowCabinet(56), x, 0, -hd + 11)); cabinetXs.push(x);
    office.add(at(i % 2 ? printer() : plant(false), x + (i % 2 ? 6 : 14), 26, -hd + 11));
  }
  if (lv >= 2) { office.add(at(meetingRoom(), 0, 0, -hd + 44)); extra.push({ x: 0, z: -hd + 44, w: 144, d: 84 }); }
  buildBossRoom(hw, hd, !garage, extra);
  // 整層樓：茶水間中島（咖啡吧旁邊）
  const czK = -hd * 0.45 + 50;
  const leisure = [];
  const L = (kind, x, z, ry, extraProps = {}) => leisure.push({ kind, pos: new THREE.Vector3(x, extraProps.y || 0, z), approach: extraProps.approach, ry, taken: null, ...extraProps });
  if (lv >= 3) {
    office.add(at(kitchen(), -hw + 70, 0, czK)); extra.push({ x: -hw + 70, z: czK + 8, w: 24, d: 66 });
    L('pantry', -hw + 96, czK - 12, -Math.PI / 2); L('pantry', -hw + 96, czK + 10, -Math.PI / 2);
  }
  // 遊戲角（公共設施）：電視遊樂器 → 加桌球與大型電玩
  pingBall = null;
  if (fac.game >= 1) {
    const cc = consoleCorner();
    office.add(at(cc, -hw + 110, 0, hd - 92)); extra.push({ x: -hw + 110, z: hd - 92, w: 40, d: 14 });
    // 有人坐在地墊上玩才開電視，畫面橫向捲動
    const sc = cc.userData.screen;
    npcs.push((t) => {
      const playing = spots.leisure.some(x => x.kind === 'console' && x.taken && figs.get(x.taken)?.nav.place === 'leisure');
      const want = playing ? sc.game : sc.off;
      if (sc.mat.map !== want) { sc.mat.map = want; sc.mat.needsUpdate = true; }
      if (playing) sc.game.offset.x = (t * 0.25) % 1;
    });
    L('console', -hw + 98, hd - 62, Math.PI, { y: -3.5, approach: new THREE.Vector3(-hw + 98, 0, hd - 44) });
    L('console', -hw + 122, hd - 62, Math.PI, { y: -3.5, approach: new THREE.Vector3(-hw + 122, 0, hd - 44) });
  }
  if (fac.game >= 2) {
    const ac = arcadeCab();
    office.add(at(ac, -hw + 170, 0, hd - 82)); extra.push({ x: -hw + 170, z: hd - 82, w: 22, d: 20 });
    npcs.push((t) => { ac.userData.screenTex.offset.y = (t * 0.2) % 1; });
    L('arcade', -hw + 170, hd - 58, Math.PI);
    office.add(at(pingpongTable(), 20, 0, hd - 62)); extra.push({ x: 20, z: hd - 62, w: 62, d: 36 });
    L('pingpong', -22, hd - 62, Math.PI / 2, { side: 0 }); L('pingpong', 62, hd - 62, -Math.PI / 2, { side: 1 });
    pingBall = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), plastic('#f4f4f4'));
    pingBall.position.set(20, 24.6, hd - 62); office.add(pingBall);
  }
  // 整層樓的窗邊那一條：會議室左邊健身角（對著窗戶跑）、正前方水族箱、右邊樂團角（對著辦公室演）
  const SZ = -hd + 128, V0 = (x, z) => new THREE.Vector3(x, 0, z);
  spots.facAt = { gym: V0(-150, SZ + 40), aquarium: V0(0, SZ + 62), band: V0(130, SZ + 40) };
  if (fac.gym >= 1) {
    const ms = [[treadmill, 'run', -104, 4.6], [treadmill, 'run', -130, 4.6], ...(fac.gym >= 2 ? [[spinBike, 'bike', -156, 15], [spinBike, 'bike', -180, 15]] : [])];
    for (const [make, kind, x, y] of ms) {
      office.add(at(make(), x, 0, SZ)); extra.push({ x, z: SZ, w: 16, d: 36 });
      L(kind, x, SZ + (kind === 'bike' ? 7 : 3), Math.PI, { y, approach: new THREE.Vector3(x, 0, SZ + 30) });
    }
    if (fac.gym >= 2) {
      office.add(at(weightRack(), -216, 0, SZ - 4)); extra.push({ x: -216, z: SZ, w: 34, d: 26 });
      L('lift', -216, SZ + 18, 0);
    }
  }
  if (fac.aquarium >= 1) {
    const aq = aquarium(fac.aquarium), big = fac.aquarium >= 2;
    office.add(at(aq, 0, 0, SZ + 22)); extra.push({ x: 0, z: SZ + 22, w: big ? 116 : 36, d: 18 });
    npcs.push((t) => { for (const f of aq.userData.fish) { const s = Math.sin(t * f.speed + f.phase); f.f.position.x = s * f.range; f.f.position.y = f.y + Math.sin(t * 1.3 + f.phase) * 0.6; f.f.rotation.y = Math.cos(t * f.speed + f.phase) > 0 ? 0 : Math.PI; } });
    for (const x of big ? [-36, 0, 36] : [-24, 24]) L('fish', x, SZ + 42, big ? Math.PI : Math.PI + Math.sign(x) * 0.5);   // 小魚缸：站兩側斜看，不擋住缸
  }
  if (fac.band >= 1) {
    const rug = fac.band >= 2 ? plate(13, 7, 1.6, '#3a3f44', false) : plate(7, 6, 1.6, '#3a3f44', false); rug.position.set(fac.band >= 2 ? 136 : 114, 0, fac.band >= 2 ? SZ - 6 : SZ - 12); office.add(rug);
    office.add(at(guitarAmp(), 120, 0, SZ - 26)); extra.push({ x: 120, z: SZ - 26, w: 20, d: 12 });
    office.add(at(guitarStand('#0055bf'), 100, 0, SZ - 24)); extra.push({ x: 100, z: SZ - 24, w: 10, d: 10 });
    L('guitar', 124, SZ - 6, 0);
    if (fac.band >= 2) {
      office.add(at(drumKit(), 164, 0, SZ - 10)); extra.push({ x: 164, z: SZ - 10, w: 34, d: 34 });
      L('drums', 164, SZ - 24, 0, { y: 5.8 });
      office.add(at(keyboardStand(), 94, 0, SZ + 4)); extra.push({ x: 94, z: SZ + 4, w: 34, d: 12 });
      L('keys', 94, SZ - 8, 0);
    }
  }
  // 總部大樓：右邊員工餐廳（後段）和午睡艙（前段），左邊高爾夫練習區
  const CX = hw - 200, PX = hw - 190, GX = -hw + 190, pods = [];
  Object.assign(spots.facAt, { cafeteria: V0(CX, -60), pods: V0(PX - 40, 60), golf: V0(GX, 50) });
  if (fac.cafeteria >= 1) {
    office.add(at(buffetCounter(), hw - 112, 0, -118, -Math.PI / 2)); extra.push({ x: hw - 112, z: -118, w: 18, d: 66 });
    const tables = fac.cafeteria >= 2 ? [-150, -96, -42] : [-140, -80];
    for (const z of tables) {
      office.add(at(diningTable(), CX, 0, z)); extra.push({ x: CX, z, w: 20, d: 46 });
      for (const sx of [-1, 1]) for (const dz of [-10, 10]) L('eat', CX + sx * 14, z + dz, -sx * Math.PI / 2, { y: SEAT_TOP - 7, approach: new THREE.Vector3(CX + sx * 30, 0, z + dz) });
    }
    if (fac.cafeteria >= 2) {
      const chef = buildCast('chef') || buildFigure('hq-chef', 'chef');
      chef.root.userData.keep = true;
      for (const leg of chef.legs) leg.rotation.x = 0;
      office.add(at(chef.root, hw - 96, 0, -118, -Math.PI / 2)); extra.push({ x: hw - 96, z: -118, w: 14, d: 14 });
      npcs.push((t) => {   // 主廚：右手翻鍋、左手撒料，頭跟著看
        chef.arms[1].rotation.x = -1.2 + Math.sin(t * 3.2) * 0.35; chef.arms[0].rotation.x = -0.9 + Math.max(0, Math.sin(t * 1.3)) * 0.5;
        chef.head.rotation.y = Math.sin(t * 0.7) * 0.3;
      });
    }
  }
  if (fac.pods >= 1) {
    for (let i = 0; i < (fac.pods >= 2 ? 5 : 2); i++) {
      const z = 20 + i * 32;
      office.add(at(napPod(), PX, 0, z)); extra.push({ x: PX, z, w: 30, d: 28 });
      pods.push({ pos: new THREE.Vector3(PX - 3, 3, z), approach: V0(PX - 34, z), ry: -Math.PI / 2, taken: null });
    }
  }
  if (fac.golf >= 1) {
    const gr = puttingGreen();
    office.add(at(gr, GX, 0, 50)); extra.push({ x: GX - 30, z: 50, w: 8, d: 8 }, { x: GX + 38, z: 50, w: 6, d: 6 });
    L('putt', GX - 30, 42, 0);
    const { ball, from, hole, flag } = gr.userData;
    npcs.push((t) => {   // 有人在推桿：球一顆一顆滾進洞（滾慢下來），沒人就停在起點
      flag.rotation.y = Math.sin(t * 1.7) * 0.15;
      const on = spots.leisure.some(x => x.kind === 'putt' && x.taken && figs.get(x.taken)?.nav.place === 'leisure');
      const p = on ? (t * 0.3) % 1 : 0, roll = Math.min(1, Math.max(0, (p - 0.3) / 0.5));
      ball.position.x = from + (hole - from) * (1 - (1 - roll) ** 2);
      ball.visible = p < 0.85;
    });
    if (fac.golf >= 2) {
      office.add(at(golfSim(), GX, 0, -60)); extra.push({ x: GX, z: -60, w: 66, d: 6 });
      L('swing', GX - 4, -32, Math.PI);
    }
  }
  // 茶水間聊天（咖啡吧前面對面站）、窗邊、書櫃前
  L('pantry', -hw + 46, czK - 10, 0); L('pantry', -hw + 46, czK + 20, Math.PI);
  if (!garage) {
    for (const x of [-hw * 0.8, -hw * 0.55, hw * 0.55, hw * 0.8]) if (x < hw - BOSS_ROOM.W - 20) L('window', x, -hd + 36, Math.PI);   // 主管室裡不算窗邊
    L('book', -hw + 34, hd * 0.35, -Math.PI / 2); L('book', -hw + 34, hd * 0.35 + 42, -Math.PI / 2);
  }
  if (lv >= 4) {
    office.add(at(reception(), -hw + 70, 0, hd - 150, Math.PI / 2)); extra.push({ x: -hw + 70, z: hd - 150, w: 20, d: 90 });
    for (const x of [-hw + 140, hw - 200]) { office.add(at(planter(3), x, 0, -hd + 16)); extra.push({ x, z: -hd + 16, w: 94, d: 24 }); }
  }
  // 休息區：右前角的沙發、地毯、小茶几
  const rug = plate(10, 8, 1.6, garage ? '#8a7a66' : '#c7a5d8', false); rug.position.set(hw - 62, 0, hd - 52); office.add(rug);
  office.add(at(sofa(garage ? '#7c4a1e' : '#0055bf'), hw - 62, 0, hd - 20, Math.PI));
  const BEANBAGS = [[hw - 132, hd - 34], [hw - 160, hd - 52], [hw - 138, hd - 78]], MASSAGE = [[hw - 200, hd - 28], [hw - 228, hd - 28]];
  if (fac.lounge >= 1) BEANBAGS.forEach(([x, z], i) => { office.add(at(beanbag(['#fe8a18', '#a5ca18', '#e4adc8'][i]), x, 0, z)); extra.push({ x, z, w: 20, d: 20 }); });
  if (fac.lounge >= 2) MASSAGE.forEach(([x, z]) => { office.add(at(massageChair(), x, 0, z, Math.PI)); extra.push({ x, z: z - 2, w: 20, d: 30 }); });
  office.add(at(box(28, 12, 16, '#e4cd9e'), hw - 62, 6, hd - 66));
  office.add(at(roundBrick(2.2, 4.4, '#f4f4f4'), hw - 56, 14.2, hd - 66));
  if (!garage) office.add(at(plant(false), hw - 18, 0, hd - 18));
  if (!garage) office.add(city(hw, hd, lv >= 3 ? 260 : 0));

  // 走動用：障礙物（世界座標的矩形）與幾個去處
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const cz = -hd * 0.45 + 50;
  spots.hw = hw; spots.hd = hd;
  spots.obstacles = [
    { x: -hw + 10, z: hd * 0.35 + 21, w: 16, d: 84 },        // 兩座書櫃
    { x: -hw + 14, z: coolerAt(hd, fac), w: 18, d: 18 },     // 飲水機
    { x: -hw + 14, z: cz, w: 22, d: 60 },                    // 咖啡吧
    { x: -hw + 22, z: -hd + 22, w: 24, d: 24 }, { x: hw - 22, z: -hd + 22, w: 24, d: 24 },
    { x: -hw + 18, z: hd - 18, w: 18, d: 18 }, { x: hw - 18, z: hd - 18, w: 18, d: 18 },
    { x: hw - 62, z: hd - 20, w: 62, d: 22 },                // 沙發
    { x: hw - 62, z: hd - 66, w: 30, d: 18 },                // 茶几
    ...extra,
  ];
  for (let x = -hw + 80; x < hw - 80; x += 120) spots.obstacles.push({ x, z: -hd + 11, w: 58, d: 16 });
  spots.door = V(-hw + 14, hd - 60);
  // 外包席：左牆白板下方兩張面牆的桌子（外包顧問坐這裡）；人坐在 x=-hw+42、面向牆
  spots.guest = [];
  for (const z of [-6, 34]) {
    const d = buildDesk('#c3c8cc', { monitor: 1, chair: 1, desk: 1, trinkets: {} });
    d.group.position.set(-hw + 42, 0, z); d.group.rotation.y = -Math.PI / 2; d.group.remove(d.hit);
    office.add(d.group);
    spots.guest.push({ screenMat: d.screenMat, screenKind: 'off', pos: V(-hw + 42, 0, z), approach: V(-hw + 72, 0, z), taken: null });
    spots.obstacles.push({ x: -hw + 30, z, w: 34, d: 36 });
  }
  // 共用工作桌：沿右牆一排，面向牆；同事來這裡做背景任務
  const oldHot = spots.hot || [];
  spots.hot = [];
  const HOT_N = [4, 8, 12][fac.hotdesk || 0];
  for (let z = -hd + HOT_Z, n = 0; z < hd - 110 && n < HOT_N; z += 36, n++) {
    const d = buildDesk('#a0a5a9');
    d.group.position.set(hw - 30, 0, z); d.group.rotation.y = Math.PI / 2;
    d.group.remove(d.hit);
    office.add(d.group);
    d.group.updateWorldMatrix(true, true);
    spots.hot.push({ screenMat: d.screenMat, screenKind: 'off', ry: Math.PI / 2, taken: null,
      pos: d.group.localToWorld(new THREE.Vector3(0, SEAT_TOP - 5.6, 2)), approach: d.group.localToWorld(new THREE.Vector3(0, 0, -30)) });
    spots.obstacles.push({ x: hw - 21, z, w: 42, d: 34 });
  }
  // 版面變大重蓋時，坐在共用桌的同事換到新桌子
  for (const f of figs.values()) for (const h of f.helpers?.values() || []) {
    if (!oldHot.includes(h.slot)) continue;
    const sl = spots.hot.find(x => !x.taken);
    h.slot = sl || null;
    if (sl) { sl.taken = h.id; placeHelper(h, hotTarget(sl)); setHotScreen(sl, h.task.type === 'agent' ? 'agent' : 'term'); }
    else placeHelper(h, ownerSpot(f));
  }
  // 吧台前（有咖啡師就站到他旁邊的杯盤那頭等他做）、飲水機前
  spots.coffee = [{ pos: V(-hw + 38, fac.coffee >= 2 ? cz - 22 : cz + 14), ry: -Math.PI / 2, bar: fac.coffee >= 2 }, { pos: V(-hw + 38, coolerAt(hd, fac)), ry: -Math.PI / 2 }];
  const oldSlots = spots.sofa;
  spots.sofa = [-17, 0, 17].map(lx => ({ pos: new THREE.Vector3(hw - 62 - lx, 7.5, hd - 22), approach: V(hw - 62 - lx, hd - 48), ry: Math.PI, taken: null }));
  // 休息區升級：懶骨頭（躺得比較低）、按摩椅，能睡的人變多
  if (fac.lounge >= 1) for (const [x, z] of BEANBAGS) spots.sofa.push({ pos: new THREE.Vector3(x, 1.5, z + 2), approach: V(x, z - 22), ry: Math.PI, taken: null });
  if (fac.lounge >= 2) for (const [x, z] of MASSAGE) spots.sofa.push({ pos: new THREE.Vector3(x, 6.5, z - 1), approach: V(x, z - 30), ry: Math.PI, taken: null });
  spots.sofa.push(...pods);   // 午睡艙也算補眠的地方
  spots.lounge = V(hw - 62, hd - 80);
  // 鏡頭的區域快捷鍵：只列辦公室現在有的地方（target：看哪裡，off：鏡頭在 target 的哪個方向）
  // area：場景裡點這些範圍（世界座標 [x0, z0, x1, z1]）也會飛過去
  const P = (key, name, t, off, area = []) => ({ key, name, target: new THREE.Vector3(...t), off: new THREE.Vector3(...off), area });
  const czP = -hd * 0.45 + 50;
  spots.places = [
    P('pantry', tr(lv >= 3 ? '茶水間' : '咖啡吧'), [-hw + 55, 18, czP], [170, 120, 70], [[-hw - 8, czP - 70, -hw + (lv >= 3 ? 110 : 60), czP + 45]]),
    P('lounge', tr('休息區'), [hw - 110, 10, hd - 55], [-70, 140, 170], [[hw - (fac.lounge >= 2 ? 250 : fac.lounge >= 1 ? 180 : 110), hd - 100, hw + 8, hd + 8]]),
    ...(fac.game >= 1 ? [P('game', tr('遊戲角'), [-hw + 135, 15, hd - 78], [60, 110, 150], [[-hw + 80, hd - 110, -hw + (fac.game >= 2 ? 195 : 145), hd - 40], ...(fac.game >= 2 ? [[-30, hd - 85, 70, hd - 40]] : [])])] : []),
    ...(lv >= 2 ? [P('meeting', tr('會議室'), [0, 20, -hd + 44], [0, 140, 170], [[-75, -hd - 8, 75, -hd + 90]])] : []),
    // 左牆正中間的牆面（白板／統計電視／整面看板），鏡頭從房間裡正對著看
    P('board', tr(fac.wall >= 2 ? '整面看板' : fac.wall === 1 ? '統計電視' : '白板'), [-hw, fac.wall >= 2 ? 78 : 70, 0], [fac.wall >= 2 ? 190 : 140, 15, 0],
      [[-hw - 10, -(fac.wall >= 2 ? 67 : 42), -hw + 20, fac.wall >= 2 ? 67 : 42]]),
    ...(look.trophies.length ? [P('trophy', tr('獎盃架'), [-hw, 95, hd * 0.35 + 21], [170, 25, 25], [[-hw - 10, hd * 0.35 - 40, -hw + 20, hd * 0.35 + 80]])] : []),
    P('hot', tr('共用工作桌'), [hw - 40, 20, -hd + HOT_Z + Math.min(HOT_N, 6) * 18], [-170, 130, 50], [[hw - 60, -hd + HOT_Z - 20, hw + 8, -hd + HOT_Z + HOT_N * 36]]),
    P('boss', tr('主管室'), [hw - 60, 20, -hd + 54], [-60, 120, 160], [[hw - BOSS_ROOM.W - 4, -hd - 8, hw + 8, -hd + BOSS_ROOM.D + 4]]),
    P('window', tr('窗邊'), [0, 40, -hd], [40, 90, 210], [[-hw - 8, -hd - 12, hw + 8, -hd + 22]]),
    ...(fac.gym >= 1 ? [P('gym', tr('健身角'), [-150, 18, SZ], [40, 110, 160], [[fac.gym >= 2 ? -236 : -142, SZ - 20, -92, SZ + 22]])] : []),
    ...(fac.aquarium >= 1 ? [P('aquarium', tr('水族箱'), [0, 24, SZ + 22], [0, 50, 130], [[fac.aquarium >= 2 ? -60 : -20, SZ + 12, fac.aquarium >= 2 ? 60 : 20, SZ + 32]])] : []),
    ...(fac.cafeteria >= 1 ? [P('cafeteria', tr('員工餐廳'), [CX + 30, 18, -96], [-150, 130, 110], [[CX - 30, -178, hw - 96, -10]])] : []),
    ...(fac.pods >= 1 ? [P('pods', tr('午睡艙'), [PX, 18, fac.pods >= 2 ? 84 : 36], [-150, 90, 90], [[PX - 18, 4, PX + 18, fac.pods >= 2 ? 164 : 68]])] : []),
    ...(fac.golf >= 1 ? [P('golf', tr('高爾夫練習區'), [GX, 15, fac.golf >= 2 ? 0 : 50], [40, 130, 170], [[GX - 60, fac.golf >= 2 ? -66 : 28, GX + 60, 72]])] : []),
    ...(fac.band >= 1 ? [P('band', tr('樂團角'), [fac.band >= 2 ? 136 : 114, 18, SZ - 8], [-20, 100, 150], [[84, SZ - 34, fac.band >= 2 ? 188 : 142, SZ + 22]])] : []),
  ];
  // 外掛蓋自己的區域（office(ctx)）：拿到場景群組與大小，登記障礙物、鏡頭區域、每格動畫；辦公室重蓋時會再叫一次
  //   place(...) 多一個 featured：直播導播自動挑鏡頭的權重（不給就不會被自動挑到）
  const officeCtx = {
    THREE, group: office, hw, hd, level: lv, fac, stream: STREAM,
    obstacles: spots.obstacles, places: spots.places,   // 唯讀：找空位蓋自己的區域用（{x, z, w, d}；place 的 areas 是 [x0, z0, x1, z1]）
    obstacle: (r) => spots.obstacles.push(r),
    place: (key, name, t, off, area = [], featured = 0) => { const pl = P(key, name, t, off, area); pl.featured = featured; spots.places.push(pl); return pl; },
    npc: (fn) => npcs.push(fn),
    pick: (obj, onPick) => { obj.userData.onPick = onPick; pluginPicks.push(obj); extraPicks.push(obj); },   // 點得到：點了叫 onPick()
  };
  for (const o of pluginPicks.splice(0)) { const i = extraPicks.indexOf(o); if (i >= 0) extraPicks.splice(i, 1); }   // 上一次蓋的點擊區收掉
  for (const pl of plugins) { try { pl.office?.(officeCtx); } catch (e) { console.error('[外掛]', pl.name, e); } }
  renderPlaces();
  for (const sl of spots.sofa) sl.kind = 'nap';
  const oldLeisure = spots.leisure || [];
  spots.leisure = leisure;
  // 辦公室重蓋（版面變大）：不在座位的人直接回座，沙發重新分配
  if (navReady) for (const f of figs.values()) {
    if (f.nav.place === 'seat') continue;
    if (f.visit) { placeAt(f, f.visit); continue; }
    if (f.nav.place === 'leisure' || f.nav.target?.name === 'leisure' || oldLeisure.includes(f.nav.slot)) { f.nav = { place: 'seat' }; placeAt(f, seatTarget(f)); f.leisureUntil = performance.now() + 5000; continue; }
    const wasSofa = oldSlots.includes(f.nav.slot) || f.nav.target?.name === 'sofa';
    f.nav = { place: 'seat' };
    placeAt(f, seatTarget(f));
    if (wasSofa) { const sl = spots.sofa.find(x => !x.taken); if (sl) placeAt(f, sofaTarget(sl)); }
  }

  // 節日裝飾
  if (holiday === 'halloween') {
    for (const [x, z, sz] of [[-hw + 40, hd - 25, 1.3], [hw - 30, -hd + 48, 1], [-hw + 30, hd - 95, 0.8], [hw - 140, hd - 18, 1.1], [-hw + 60, -hd + 30, 0.9], [hw - 30, hd - 90, 0.8]]) office.add(at(pumpkin(sz), x, 0, z, Math.atan2(-x, -z)));
    for (let x = -hw + 80; x < hw - 80; x += 120) office.add(at(pumpkin(0.6), x - 16, 26, -hd + 11));   // 矮櫃上
    const wb = cobweb(36); wb.position.set(-hw + 0.5, WALL_TOP - 1, -hd + 0.5); wb.rotation.y = Math.PI / 4; office.add(wb);
    const wb2 = cobweb(30); wb2.position.set(hw - 0.5, WALL_TOP - 1, -hd + 0.5); wb2.rotation.y = -Math.PI / 4; wb2.scale.x = -1; office.add(wb2);
    if (!garage) for (let i = 0; i < 7; i++) { const b = bat(10 + (i % 3) * 3); b.position.set(-hw * 0.8 + i * hw * 0.27, 62 + (i * 13 % 26), -hd + 0.6); b.rotation.z = (i % 2 ? 0.2 : -0.15); office.add(b); }
    const sl = stringLights(hw * 2 - 20, ['#ff8a1f', '#9b4dff']); sl.position.set(0, WALL_TOP - 4, -hd + 1); office.add(sl);
  } else if (holiday === 'christmas') {
    const sl = stringLights(hw * 2 - 20, ['#e8241c', '#2fbf4a', '#ffd24a']); sl.position.set(0, WALL_TOP - 4, -hd + 1); office.add(sl);
    const sl2 = stringLights(hd * 2 - 20, ['#e8241c', '#2fbf4a', '#ffd24a']); sl2.position.set(-hw + 1, WALL_TOP - 4, 0); sl2.rotation.y = Math.PI / 2; office.add(sl2);
  } else if (holiday === 'newyear') {
    for (let x = -hw * 0.85; x <= hw * 0.85; x += hw * 0.34) office.add(at(lantern(), x, WALL_TOP - 2, -hd + 14));
    // 春聯貼在門的兩旁（左牆，門在 z = hd - 60）
    for (const [dz, txt] of [[-24, '平安如意'], [24, '萬事亨通']]) { const c = couplet(txt); c.position.set(-hw + 0.6, 42, hd - 60 + dz); c.rotation.y = Math.PI / 2; office.add(c); }   // 春聯本來就是中文
  } else if (holiday === 'dragonboat') {
    for (const dz of [-24, 24]) office.add(at(mugwort(), -hw + 2, 66, hd - 60 + dz, Math.PI / 2));   // 門兩旁掛艾草
    if (!garage) for (const x of cabinetXs) office.add(at(zongziPlate(), x - 16, 26, -hd + 11));
  } else if (holiday === 'midautumn') {
    for (let x = -hw * 0.85; x <= hw * 0.85; x += hw * 0.34) office.add(at(lantern('#f2b51c', '#ffcf3a'), x, WALL_TOP - 2, -hd + 14));
    if (!garage) for (const x of cabinetXs) office.add(at(mooncakes(), x - 13, 26, -hd + 11));
    moon = fullMoon(); moon.position.set(hw * 0.3, 10, -hd - 200); moon.userData.keep = true; office.add(moon);
  } else if (holiday === 'nye') {
    for (const [len, x, z, ry] of [[hw * 2 - 20, 0, -hd + 1, 0], [hd * 2 - 20, -hw + 1, 0, Math.PI / 2]]) {
      const sl = stringLights(len, ['#f2cd37', '#e8eef4', '#c9a227']); sl.position.set(x, WALL_TOP - 4, z); sl.rotation.y = ry; office.add(sl);
    }
    for (const [x, z] of [[-hw + 40, hd - 30], [hw - 30, -hd + 50], [hw - 40, hd - 30]]) office.add(at(balloons(), x, 0, z));
    if (!garage) fireworks = makeFireworks(hw, hd);
  }

  // 不會動的家具全部依材質合併；牆各自併（要能整面藏起來），會動的（桌球、咖啡師）留著
  for (const w of walls) { mergeStatic(w.group); w.group.userData.keep = true; }
  if (pingBall) pingBall.userData.keep = true;
  mergeStatic(office);
  applyDaylight();   // 新蓋的城市要馬上套上現在的夜燈
  placeGallery();   // 牆重蓋了，作品牆掛回去

  bounds = Math.max(hw, hd);
  const ext = bounds + 120;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -ext;
  sun.shadow.camera.right = sun.shadow.camera.top = ext;
  sun.shadow.camera.far = 2400;
  sun.shadow.camera.updateProjectionMatrix();
}

// 鏡頭在哪面牆外，那面牆就先藏起來
function updateWalls() {
  const v = new THREE.Vector3();
  for (const w of walls) w.group.visible = v.subVectors(camera.position, w.p).dot(w.n) > 0;
}

// ── 綁頭鏡頭（POV）：鏡頭綁在某個人或某隻貓的頭上，像戴著運動相機 ──────────────
// setPov('cat:妹妹' | 貓的序號 | 人物 id, { fov, fisheye, smooth, tilt })；setPov(null) 回到平常的鏡頭
// 人：鏡頭在眼睛的位置，頭藏起來，低頭看得到自己的手。貓：鏡頭在兩耳後面，畫面上緣露出耳朵尖
let pov = null;
function povTarget(who) {
  if (typeof who === 'number') return cats[who] && { kind: 'cat', o: cats[who] };
  const c = cats.find(x => x.id === who || x.def.name === who);
  if (c) return { kind: 'cat', o: c };
  const f = figs.get(who);
  return f && { kind: 'fig', o: f };
}
// 眼睛的位置。小人的方塊頭都一樣大；貓有好幾種做法、大小不同，量頭上最大的那塊（頭本身）：前緣、比中線高一點
function povEye(kind, head) {
  if (kind === 'fig') return new THREE.Vector3(0, 6.5, -3);   // 眼睛往後放到頭的中後段：坐在螢幕前也看得到整個螢幕和自己的手
  let best = null, bestV = 0;
  for (const m of head.children) {
    if (!m.isMesh) continue;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrix), v = b.getSize(new THREE.Vector3());
    if (v.x * v.y * v.z > bestV) { bestV = v.x * v.y * v.z; best = b; }
  }
  if (!best) return new THREE.Vector3(0, 1, 2.5);
  const size = best.getSize(new THREE.Vector3());
  return new THREE.Vector3(0, best.min.y + size.y * 0.62, best.max.z - size.z * 0.45);
}
// 戴上去之前先看看：眼睛正前方多遠會撞到東西（自己的身體不算）。導播用它避開臉貼著牆、沙發的貓
const povRay = new THREE.Raycaster();
function povClearance(who) {
  const tg = povTarget(who);
  if (!tg) return 0;
  const head = tg.o.fig.head;
  head.updateWorldMatrix(true, false);
  const from = povEye(tg.kind, head).applyMatrix4(head.matrixWorld);
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) return 0;
  povRay.set(from, dir.normalize());
  povRay.far = 400;
  const own = tg.o.fig.root;
  for (const h of povRay.intersectObjects(scene.children, true)) {
    if (!h.object.isMesh || !h.object.visible) continue;
    let o = h.object, mine = false;
    while (o) { if (o === own) { mine = true; break; } o = o.parent; }
    if (!mine) return h.distance;
  }
  return Infinity;
}
function setPov(who, opts = {}) {
  if (pov) {   // 先把上一位的頭放回來
    for (const m of pov.hidden) m.visible = true;
    camera.fov = pov.saved.fov; camera.near = pov.saved.near; camera.updateProjectionMatrix();
    controls.enabled = true; bokeh.enabled = true; fisheye.enabled = false;
    camera.position.copy(pov.saved.pos); controls.target.copy(pov.saved.target); controls.update();
    pov = null;
    document.body.classList.remove('pov');
  }
  if (who == null) return true;
  const tg = povTarget(who);
  if (!tg) return false;
  const head = tg.o.fig.head;
  // 整顆頭（含頭髮、帽子、耳朵）藏起來；低頭看得到自己的手或前腳
  const hidden = [head];
  head.visible = false;
  if (tg.kind === 'fig' && tg.o.tag) { tg.o.tag.visible = false; hidden.push(tg.o.tag); }   // 自己頭上的泡泡會擋在畫面正上方
  pov = {
    ...tg, head, hidden,
    eye: opts.eye ? new THREE.Vector3(...opts.eye) : povEye(tg.kind, head),
    tilt: opts.tilt ?? (tg.kind === 'cat' ? 0.05 : 0.3),   // 人微微低頭：螢幕和手都在畫面裡；貓平視
    hfov: opts.fov ?? (tg.kind === 'cat' ? 100 : 90),   // 水平視角：直式、橫式畫面都一樣廣
    smooth: opts.smooth ?? 0.002,
    first: true,
    saved: { fov: camera.fov, near: camera.near, pos: camera.position.clone(), target: controls.target.clone() },
  };
  setFollow(null); fly = null;
  camera.near = 0.3;
  controls.enabled = false;
  bokeh.enabled = false;   // 運動相機是全景深
  fisheye.enabled = opts.fisheye !== false;
  fisheye.uniforms.k.value = opts.fisheye ?? 0.2;   // 輕輕的魚眼就夠：太重近物會彎得看不出是什麼
  document.body.classList.add('pov');
  return true;
}
const povQ = new THREE.Quaternion(), povP = new THREE.Vector3(), povHq = new THREE.Quaternion(), povF = new THREE.Vector3(), povE = new THREE.Euler(0, 0, 0, 'YXZ');
// 鏡頭方向只跟頭的「朝向」與一半的點頭，不跟翻滾，而且有俯仰上限：
// 打字時頭會往下點、身體也前傾，整個疊上去會變成直直看自己的肚子；貓低頭聞地板也一樣
const POV_PITCH = { fig: [-0.5, 0.25], cat: [-0.3, 0.2] };
function stepPov(dt) {
  if (!povTarget(pov.o.id)) return setPov(null);   // 人下班了、貓被收走了
  if (pov.o.fig.head !== pov.head) { const { o, tilt, hfov, smooth } = pov; setPov(null); setPov(o.id, { tilt, fov: hfov, smooth }); return; }   // 換了制服，頭是新的
  pov.head.updateWorldMatrix(true, false);
  povP.copy(pov.eye).applyMatrix4(pov.head.matrixWorld);
  pov.head.getWorldQuaternion(povHq);
  povF.set(0, 0, 1).applyQuaternion(povHq);
  const [lo, hi] = POV_PITCH[pov.kind];
  const pitch = Math.min(hi, Math.max(lo, Math.asin(Math.max(-1, Math.min(1, povF.y))) * 0.5 - pov.tilt));
  povQ.setFromEuler(povE.set(pitch, Math.atan2(povF.x, povF.z) + Math.PI, 0));
  // 小人是一秒 12 格的定格動作，鏡頭直接黏上去會一頓一頓：位置跟轉向都稍微追一下
  const k = pov.first ? 1 : 1 - Math.pow(pov.smooth, dt);
  pov.first = false;
  camera.position.lerp(povP, k);
  camera.quaternion.slerp(povQ, k);
  const aspect = innerWidth / innerHeight;
  fisheye.uniforms.aspect.value = aspect;
  const vfov = Math.min(118, 2 * Math.atan(Math.tan(pov.hfov * Math.PI / 360) / aspect) * 180 / Math.PI);
  if (Math.abs(camera.fov - vfov) > 0.01) { camera.fov = vfov; camera.updateProjectionMatrix(); }
}

// ── 排版：每個專案一張大板子，排成格子 ───────────────────────────────────────
let islandOrder = [];
function layoutIslands() {
  for (const cwd of islands.keys()) if (!islandOrder.includes(cwd)) islandOrder.push(cwd);
  islandOrder = islandOrder.filter(c => islands.has(c));
  const list = islandOrder.map(c => islands.get(c));
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.3)));
  const gap = 40;
  let x = 0, z = 0, rowD = 0, maxX = 0;
  const rows = [];
  let row = [];
  list.forEach((isl, i) => {
    if (i % cols === 0 && row.length) { rows.push(row); row = []; }
    row.push(isl);
  });
  if (row.length) rows.push(row);
  const placed = [];
  for (const r of rows) {
    const rowW = r.reduce((s, isl) => s + isl.w, 0) + gap * (r.length - 1);
    x = -rowW / 2; rowD = Math.max(...r.map(isl => isl.d));
    for (const isl of r) { isl.target = new THREE.Vector3(x + isl.w / 2, 0, z + rowD / 2); x += isl.w + gap; placed.push(isl); maxX = Math.max(maxX, rowW / 2); }
    z += rowD + gap + 10;
  }
  const offZ = z / 2;
  for (const isl of placed) {
    isl.target.z -= offZ;
    if (!isl.placed) { isl.group.position.copy(isl.target); isl.placed = true; }
  }
  buildOffice(maxX, z / 2);
}
let bounds = 200;

// ── 鏡頭：看全景、區域快捷鍵、跟拍 ──
let followId = null;
let followCat = null;   // 跟拍貓（貓不在 figs 裡，另外記）：直播導播、或使用者點了貓
const CAM_ICON = {
  map: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 7.5h5V2.5M9.5 13.5V10H14" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  pin: '<svg viewBox="0 0 16 16"><path d="M8 14.5s-4.5-4.3-4.5-7.8a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.8-4.5 7.8z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6.6" r="1.6" fill="currentColor"/></svg>',
  home: '<svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pov: '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
  follow: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.6" fill="currentColor"/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  pantry: '<svg viewBox="0 0 16 16"><path d="M3 5h8v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 6.5h1.2a1.6 1.6 0 0 1 0 3.2H11" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  lounge: '<svg viewBox="0 0 16 16"><path d="M2 11V8a1.5 1.5 0 0 1 3 0v1h6V8a1.5 1.5 0 0 1 3 0v3zM4 7V5.5A1.5 1.5 0 0 1 5.5 4h5A1.5 1.5 0 0 1 12 5.5V7M3 11v2M13 11v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  game: '<svg viewBox="0 0 16 16"><path d="M4 5h8a3 3 0 0 1 2.9 3.6l-.7 2.6a1.5 1.5 0 0 1-2.6.6L10 10H6l-1.6 1.8a1.5 1.5 0 0 1-2.6-.6l-.7-2.6A3 3 0 0 1 4 5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 7v2.4M3.8 8.2h2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  meeting: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 13h6M8 10v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  board: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 9V7.5M7 9V5.5M10 9V6.5M6 14.5h4M8 11.5v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  trophy: '<svg viewBox="0 0 16 16"><path d="M5 2h6v3.5a3 3 0 0 1-6 0zM5 3.5H3a2 2 0 0 0 2 3M11 3.5h2a2 2 0 0 1-2 3M8 8.5v3M5.5 14h5M6.5 11.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  hot: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1 13h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  window: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.3"/></svg>',
  cat: '<svg viewBox="0 0 16 16"><path d="M3 13.5V5L5.5 7h5L13 5v8.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6.2" cy="10" r=".9" fill="currentColor"/><circle cx="9.8" cy="10" r=".9" fill="currentColor"/></svg>',
  boss: '<svg viewBox="0 0 16 16"><path d="M2 9h12v1.6H2zM3.5 10.6V14M12.5 10.6V14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="4" r="2" fill="currentColor"/><path d="M5 9c0-2 1.3-3 3-3s3 1 3 3" fill="currentColor"/></svg>',
};
document.getElementById('btn-home').innerHTML = CAM_ICON.home;
document.getElementById('btn-home').onclick = () => { setFollow(null); fitAll(); };
// 手機的 ⋯ 選單：點了展開次要按鈕，點其中一顆或點別處就收起來
// 桌機右上按鈕排不下（面板打開往左讓、或視窗窄）就收進 ⋯，不壓到左上角
// 收起來時量不到原本的寬度，用上次排開時量到的
let hudFullW = 0;
const HUD_LEFT_STEPS = ['hud-left-1', 'hud-left-2'];
function fitHud() {
  const body = document.body, right = document.getElementById('hud-right'), left = document.getElementById('hud-left');
  body.classList.remove(...HUD_LEFT_STEPS);   // 先用左邊完整的寬度判斷右邊要不要收
  if (innerWidth <= 760) body.classList.remove('hud-compact');
  else {
    if (!body.classList.contains('hud-compact')) hudFullW = right.offsetWidth;
    const drawer = body.classList.contains('drawer-open') ? Math.min(520, innerWidth * 0.46) + 10 : 0;
    const room = innerWidth - 10 - drawer - (left.offsetLeft + left.offsetWidth) - 12;
    body.classList.toggle('hud-compact', hudFullW > room);
  }
  // 右邊收完左邊還是會碰到（手機、開著側欄的平板）：左邊也一級一級收，先收等級名稱、再收進度條
  const leftEnd = () => Math.max(0, ...[...left.children].filter(c => c.offsetWidth).map(c => c.getBoundingClientRect().right));
  for (const step of HUD_LEFT_STEPS) {
    if (leftEnd() + 8 <= right.getBoundingClientRect().left) break;
    body.classList.add(step);
  }
}
addEventListener('resize', fitHud);
// 展開時記下那幾排按鈕的底邊，提示訊息改出現在它下面，不會蓋住按鈕
document.getElementById('btn-more').onclick = (e) => {
  e.stopPropagation();
  document.body.classList.toggle('more-open');
  document.body.style.setProperty('--more-bottom', document.getElementById('hud-more').getBoundingClientRect().bottom + 'px');
};
document.getElementById('hud-more').addEventListener('click', (e) => { if (e.target.closest('.chip') && e.target.closest('.chip').id !== 'weather-chip') document.body.classList.remove('more-open'); });
addEventListener('pointerdown', (e) => { if (!e.target.closest('#hud-right')) document.body.classList.remove('more-open'); });
document.getElementById('btn-replay').innerHTML = '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5.5V8l2 1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
document.getElementById('btn-replay').onclick = () => replay ? stopReplay() : startReplay();
const followBtn = document.getElementById('p-follow');
followBtn.innerHTML = CAM_ICON.follow;
summonBtn.innerHTML = CAM_ICON.boss;
followBtn.onclick = () => setFollow(followId ? null : selectedId);
function setFollow(id) {
  followCat = null;
  followId = id && figs.has(id) ? id : null;
  followBtn.classList.toggle('on', !!followId);
  followBtn.title = followId ? tr('停止跟拍') : tr('跟拍：他走到哪鏡頭跟到哪');
  if (followId) { fly = null; toast(tr('跟拍中：他走到哪鏡頭跟到哪')); }
}
// 左下角只留「座位表」：部門和各區域都在座位表裡，點了飛過去
function renderPlaces() {
  const el = document.getElementById('places');
  el.innerHTML = `<div class="chip" id="places-map" title="${tr('座位表')}">${CAM_ICON.map}${tr('座位表')}</div>`;
  el.querySelector('#places-map').onclick = openSeatmap;
}
function goPlace(key) {
  const p = (spots.places || []).find(x => x.key === key);
  if (!p) return false;
  setFollow(null);
  flyTo(p.target.clone(), p.off.clone().multiplyScalar(innerWidth <= 760 ? 1.3 : 1));
  if (p.key === 'boss') setTimeout(openRoster, 700);   // 到了主管室，名冊順便打開
  return true;
}

function fitAll(instant) {
  const d = Math.max(260, bounds * 1.75) * Math.max(1, 1.25 / camera.aspect);
  const dir = new THREE.Vector3(0.62, 0.78, 0.9).normalize();
  flyTo(new THREE.Vector3(0, 0, 0), dir.multiplyScalar(d), instant);
}

// 鏡頭平滑移動
let fly = null;
let hardCut = false;   // 直播導播換目標時設成 true：直接切過去，不飛
function flyTo(target, offset, instant) {
  const to = target.clone().add(offset);
  if (instant || hardCut) { fly = null; controls.target.copy(target); camera.position.copy(to); controls.update(); return; }
  fly = { t: 0, fromT: controls.target.clone(), toT: target.clone(), fromP: camera.position.clone(), toP: to };
}
function figWorldPos(f) { const v = new THREE.Vector3(); f.fig.root.getWorldPosition(v); return v; }
function focusFig(f, dist) {
  const p = figWorldPos(f);
  const q = new THREE.Quaternion(); f.holder.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const off = fwd.multiplyScalar(-0.5).add(side.multiplyScalar(0.55)).add(new THREE.Vector3(0, 0.8, 0))
    .setLength(dist || (innerWidth <= 760 ? 260 : 220));
  flyTo(p.clone().add(new THREE.Vector3(0, 22, 0)), off);
}
// 最近去過的部門（座位表的捷徑用）：只記人自己點過去的，最多記 8 個
const recentDepts = (() => { try { return JSON.parse(localStorage.getItem('cubbi_recent_depts')) || []; } catch { return []; } })();
function noteDept(isl) {
  const cwd = [...islands].find(([, v]) => v === isl)?.[0];
  if (!cwd) return;
  recentDepts.splice(0, recentDepts.length, cwd, ...recentDepts.filter(c => c !== cwd).slice(0, 7));
  localStorage.setItem('cubbi_recent_depts', JSON.stringify(recentDepts));
}
function focusIsland(isl) {
  if (!STREAM) noteDept(isl);
  const off = camera.position.clone().sub(controls.target).setLength(Math.max(isl.w, isl.d) * 2.6);
  flyTo(isl.group.position.clone(), off);
}

// ── 直播導播（--stream 的頁面才有）：自動挑人近拍跟拍、有人舉手或做完就切過去；導播台（/stream-control）可以手動指定 ──
// cam：{ mode: 'auto' | 'overview' | 'person' | 'dept' | 'place' | 'pov' | 'cat', id?（人；dept 用那個部門裡任一人）, place?, cat?（pov 戴到貓身上／cat 跟著哪隻貓：序號，-1 隨便一隻） }
const STREAM = document.body.classList.contains('stream');
const director = (() => {
  let cam = { mode: 'auto' }, until = 0, cutAt = 0, last = null, shots = 0;
  const SHOT = 30000;
  const visible = (f) => f && f.fig.root.visible && f.nav.place !== 'home';
  const overview = () => {   // 直播的全景比平常近一點：看得到人在做什麼
    setPov(null); followCat = null;
    const d = Math.max(220, bounds * 1.25) * Math.max(1, 1.25 / camera.aspect);
    flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.62, 0.72, 0.9).normalize().multiplyScalar(d));
  };
  // 取景：拍正面和側面，不拍背影；鏡頭一定在辦公室裡面，人越靠邊角越從中間往外拍
  // 候選角度從臉的方向左右展開；坐著的人正前方被螢幕擋，偏好斜前 45° 到側面
  const inRoom = (v, pad = 12) => Math.abs(v.x) < (spots.hw || 300) - pad && Math.abs(v.z) < (spots.hd || 300) - pad;
  const facing = (f) => { const q = new THREE.Quaternion(); f.fig.root.getWorldQuaternion(q); const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q); v.y = 0; return v.lengthSq() ? v.normalize() : new THREE.Vector3(0, 0, 1); };
  function shotOf(f, dist = 190) { frameAt(figWorldPos(f), facing(f), { seated: f.nav.place === 'seat', dist }); }
  // 貓：比人小，鏡頭近一點、低一點
  // 跳上桌子的：前面是椅背，鏡頭拉高越過去
  // 跳上桌子的貓臉朝著坐著的人：正面會被人頭擋住，改從側面、高一點拍
  function catShot(c) { const desk = c.mode === 'desk' || c.hop?.mode === 'desk'; frameAt(c.fig.root.getWorldPosition(new THREE.Vector3()), facing(c), { dist: desk ? 120 : 120, elev: desk ? 1.05 : 0.5, lift: 8, prefer: desk ? 90 : null }); }
  function frameAt(p, fwd, { seated = false, dist = 190, elev: e, lift = 22, prefer = null } = {}) {
    const edge = Math.min(1, Math.max(Math.abs(p.x) / (spots.hw || 300), Math.abs(p.z) / (spots.hd || 300)));
    const toCenter = new THREE.Vector3(-p.x, 0, -p.z); if (toCenter.lengthSq()) toCenter.normalize();
    const elev = e ?? (seated ? 0.78 : 0.6);   // 坐著的從螢幕上方一點看下去
    let best = null;
    for (const deg of [0, 25, -25, 50, -50, 75, -75, 95, -95]) {
      const h = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
      for (const d of [dist, dist * 0.75, dist * 0.55]) {
        const off = h.clone().multiplyScalar(Math.cos(elev) * d).setY(Math.sin(elev) * d);
        const cam = p.clone().add(off);
        if (!inRoom(cam)) continue;
        const a = Math.abs(deg);
        const want = prefer ?? (seated ? 50 : null);   // 想要的角度（離臉的方向幾度）；沒有就越正面越好
        const score = (want != null ? 1 - Math.abs(a - want) / 60 : Math.cos(a * Math.PI / 180)) * 0.6
          + h.dot(toCenter) * edge * 1.2 + (d === dist ? 0.2 : d === dist * 0.75 ? 0.1 : 0);
        if (!best || score > best.score) best = { score, off };
        break;   // 這個角度最遠放得下的就用它
      }
    }
    // 真的都放不下（角落最裡面）：從房間中心那一側拍
    const off = best ? best.off : toCenter.clone().multiplyScalar(Math.cos(elev) * dist * 0.6).setY(Math.sin(elev) * dist * 0.6);
    flyTo(p.clone().add(new THREE.Vector3(0, lift, 0)), off);
  }
  // 區域、部門：鏡頭位置跑到牆外的那一軸翻回室內
  const inward = (target, off) => {
    const o = off.clone(), hw = (spots.hw || 300) - 12, hd = (spots.hd || 300) - 12;
    if (Math.abs(target.x + o.x) > hw) o.x = -o.x;
    if (Math.abs(target.z + o.z) > hd) o.z = -o.z;
    return o;
  };
  let reframeAt = 0;
  // 換目標：直接切（電影剪接那樣）；同一個人轉身時的補位（reframe）才用慢慢滑
  const hard = (fn) => { hardCut = true; try { fn(); } finally { hardCut = false; } };
  // 每一鏡開拍前先把綁頭鏡頭拿下來（不然 fly 不會動）
  const person = (f) => { setPov(null); followId = null; followCat = null; shotOf(f); followId = f.id; reframeAt = Date.now(); };
  // 跟著貓走：指定序號，-1 挑一隻（在走路的優先，比較有戲）
  const catPick = (i) => cats[i] || cats.find(c => c.mode === 'walk' || c.mode === 'hop') || cats[Math.floor(Math.random() * cats.length)];
  const catFollow = (c) => { if (!c) return false; setPov(null); followId = null; followCat = null; catShot(c); followCat = c; reframeAt = Date.now(); return true; };
  const povOf = (who) => { followId = null; followCat = null; setPov(null); return setPov(who); };
  // 指定的那隻；-1 是隨便一隻，挑前面最空曠的（臉貼著牆的不選）
  const catIdx = (i) => {
    if (i >= 0 && i < cats.length) return i;
    const room = cats.map((c, j) => [j, povClearance(j)]).sort((a, b) => b[1] - a[1]);
    return room[0][1] > 40 ? room[0][0] : room[Math.floor(Math.random() * room.length)][0];
  };   // 飛到之後跟拍（render 迴圈在 fly 結束才接手）
  const dept = (f) => {
    setPov(null); followId = null; followCat = null;
    const isl = islands.get(f.cwdKey); if (!isl) return;
    const c = isl.group.position, len = Math.max(isl.w, isl.d) * 1.9;
    // 靠邊的部門從房間中間那一側拍；在正中間的照舊斜前方
    const h = new THREE.Vector3(-c.x, 0, -c.z);
    const dir = h.length() > 60 ? h.normalize().multiplyScalar(0.75).setY(0.75) : new THREE.Vector3(0.5, 0.75, 0.9);
    flyTo(c.clone(), inward(c, dir.setLength(len)));
  };
  // 遊戲角的機台和玩的人都面向外牆：翻到室內只拍得到背面，改從人和牆之間的高處往下拍臉
  const SIDE = { game: new THREE.Vector3(35, 135, 58) };
  const place = (key) => { const p = spots.places?.find(x => x.key === key); if (p) { setPov(null); followId = null; followCat = null; flyTo(p.target.clone(), SIDE[key] ? SIDE[key].clone() : inward(p.target, p.off.clone().multiplyScalar(0.8))); } };
  function pick() {
    const all = [...figs.values()].filter(visible);
    const busy = all.filter(f => ACTIVE.has(f.data.status)), roam = all.filter(f => ['leisure', 'sofa', 'report', 'walk'].includes(f.nav.place));
    // 宿主可以調各種鏡頭的比重（host.director：{ person, dept, pov, catPov, cat, place } 乘上去的倍數，例如貓當主角就把 cat 調大）
    const W = (k, v) => v * (host.director?.[k] ?? 1);
    const opts = [];
    for (const f of busy) opts.push([W('person', 3), () => person(f), f.id]);
    for (const f of roam) opts.push([W('person', 2), () => person(f), f.id]);
    for (const f of busy) opts.push([W('dept', 0.6), () => dept(f), 'd:' + f.cwdKey]);
    // 偶爾戴上綁頭鏡頭：忙的人的視角、貓的視角
    for (const f of busy) opts.push([W('pov', 0.5), () => povOf(f.id), 'p:' + f.id]);
    if (cats.some((c, j) => povClearance(j) > 40)) opts.push([W('catPov', 0.8), () => povOf(catIdx(-1)), 'cat']);
    for (const c of cats) opts.push([W('cat', c.mode === 'walk' || c.mode === 'hop' ? 1.4 : 0.6), () => catFollow(c), c.id]);
    for (const pl of spots.places || []) if (pl.featured) opts.push([W('place', pl.featured), () => place(pl.key), 'pl:' + pl.key]);
    if (!busy.length && !roam.length) { const idle = all.slice().sort(() => Math.random() - 0.5).slice(0, 4); for (const f of idle) opts.push([W('person', 1), () => person(f), f.id]); }   // 沒人在忙：隨便挑幾個（不然幾十個人會把其他鏡頭擠掉）
    if (shots % 5 === 4 || !opts.length) opts.push([opts.length ? 99 : 1, overview, 'all']);
    const pool = opts.filter(o => o[2] !== last);
    const list = pool.length ? pool : opts;
    let r = Math.random() * list.reduce((t, o) => t + o[0], 0);
    const o = list.find(x => (r -= x[0]) <= 0) || list[0];
    last = o[2]; shots++; o[1]();
  }
  function apply() {
    const f = cam.id && figs.get(cam.id);
    if (cam.mode === 'overview') { followId = null; overview(); }
    else if (cam.mode === 'person' && f) person(f);
    else if (cam.mode === 'dept' && f) dept(f);
    else if (cam.mode === 'place') place(cam.place);
    else if (cam.mode === 'cat' && cats.length && catFollow(catPick(cam.cat ?? -1))) {}
    else if (cam.mode === 'pov' && (f || cats.length) && povOf(f ? f.id : catIdx(cam.cat ?? -1))) {}
    else { cam = { mode: 'auto' }; until = 0; }
  }
  if (STREAM) setInterval(() => {
    if (cam.mode === 'auto' && navReady && Date.now() > until && !document.hidden) { until = Date.now() + SHOT; cutAt = Date.now(); hard(pick); return; }
    // 跟拍中的人轉身背對鏡頭了：慢慢繞回前面（至少隔 6 秒，不要一直轉）
    const f = followId && figs.get(followId), c = followCat;
    if ((f || c) && !fly && Date.now() - reframeAt > 6000) {
      const at = f ? figWorldPos(f) : c.fig.root.getWorldPosition(new THREE.Vector3());
      const look = camera.position.clone().sub(at).setY(0).normalize();
      if (look.dot(facing(f || c)) < -0.1) { f ? person(f) : catFollow(c); }
    }
  }, 1000);
  return {
    set(c) { if (!STREAM) return; cam = c || { mode: 'auto' }; until = Date.now() + (cam.mode === 'auto' ? 1500 : SHOT); cutAt = Date.now(); hard(apply); },
    // 有人舉手、做完：自動模式下切過去（剛切的鏡頭至少留 12 秒）
    cut(f) { if (!STREAM || cam.mode !== 'auto' || !visible(f) || Date.now() - cutAt < 12000) return; until = Date.now() + SHOT; cutAt = Date.now(); last = f.id; hard(() => person(f)); },
  };
})();

// ── 資料 ──────────────────────────────────────────────────────────────────────
const byId = new Map();
function upsert(d) {
  const prev = byId.get(d.id);
  byId.set(d.id, { ...(prev || {}), ...d, title: d.title || prev?.title || '', name: d.name || prev?.name || '' });
  const cur = byId.get(d.id);
  const f = figs.get(d.id);
  if (f && f.cwdKey !== (cur.cwd || '?')) removeFig(d.id);
  if (!figs.get(d.id)) { const nf = addFig(cur); if (nf && navReady) syncHelpers(nf); if (nf) maybeBoss(nf); }
  else {
    const f = figs.get(d.id);
    const before = f.data.status;
    // 動作換了（不同工具或不同指令）就重新計時；卡住狀態也跟著解除
    const actKey = (a) => a ? `${a.kind}|${a.tool || ''}|${a.detail || ''}` : '';
    if (actKey(cur.act) !== actKey(f.data.act) || !ACTIVE.has(cur.status)) { f.actSince = Date.now(); f.stuck = false; }
    else if (f.stuck && cur.act?.kind !== 'bash' && cur.updatedAt !== f.data.updatedAt) f.stuck = false;
    f.data = cur; applyState(f); updatePlate(f);
    if (before !== cur.status) {
      onStatus(f, before, cur.status);
      if (cur.status === 'asking' || (isDone(cur.status) && ACTIVE.has(before))) director.cut(f);
      if (cur.status === 'asking') { sfx.ask(); notifyUser(cur, tr('{name}在等你回答', { name: cur.name || tr('有人') }), cur.ask?.question || cur.ask?.tool || ''); }
      else if (isDone(cur.status) && ACTIVE.has(before)) { sfx.done(); notifyUser(cur, tr('{name}做完了', { name: cur.name || tr('有人') }), actText(cur.act) || ''); }
    }
    syncHelpers(f);
    maybeBoss(f);
  }
  syncDuck();
}

async function refresh() {
  if (replay) return;
  let data;
  try { data = await api('/api/space/sessions'); } catch { return; }
  workRoot = data.workRoot;
  const ids = new Set(data.sessions.filter(s => s.sid).map(s => s.id));
  for (const id of [...figs.keys()]) if (!ids.has(id) && id !== selectedId && !figs.get(id).archiving) { removeFig(id); byId.delete(id); }
  // 舊的先坐，新的人才不會把熟面孔擠到別的位子
  for (const s of data.sessions.sort((a, b) => a.updatedAt - b.updatedAt)) if (s.sid) upsert(s);
  layoutIslands();
  if (!navReady) { for (const f of figs.values()) syncHelpers(f); initNav(); syncCats(); } else flushEnters();
  updateIslandLabels();
  updateCounts();
  if (selectedId) updatePanelHead();
  const ld = document.getElementById('loading');
  if (ld && !ld.classList.contains('done')) { ld.classList.add('done'); setTimeout(() => ld.remove(), 700); }   // 淡出後拿掉
  if (!refresh.fitted) { refresh.fitted = true; fitAll(true); if (STREAM) api('/api/space/stream-cam').then(c => director.set(c)).catch(() => {}); }
  // 網址帶 ?s=<對話編號>（Claude Code 裡打 /cubbi）：打開就選中那個人、鏡頭飛過去
  const want = new URLSearchParams(location.search).get('s');
  if (want && !refresh.focused && figs.has(want)) { refresh.focused = true; select(want, 'progress'); }
}

function updateIslandLabels() {
  for (const isl of islands.values()) {
    isl.labelDiv.querySelector('.nm').textContent = projName(isl.cwd, workRoot);
    isl.labelDiv.querySelector('.n').textContent = isl.seats.filter(Boolean).length;
    isl.labelDiv.title = isl.cwd;
  }
}

// ── 卡住偵測：工作中卻超過 5 分鐘沒有新動作 ──────────────────────────────────
// 網址帶 ?stuck=20 可以把門檻縮成 20 秒（測試用）
const STUCK_MS = (parseFloat(new URLSearchParams(location.search).get("stuck")) || 300) * 1000;
function stuckTick() {
  if (replay) return;
  for (const f of figs.values()) {
    const d = f.data;
    if (d.status !== 'working') { if (f.stuck) { f.stuck = false; applyState(f); } continue; }   // 終端機的對話看不到細節，不判斷
    // 指令看「這個指令跑多久」（執行中 claude 會定期送事件，不能只看最後一次事件）；其他看多久沒有任何事件
    const longRun = d.act?.kind === 'bash';
    const quiet = Date.now() - (longRun ? (d.act?.since || f.actSince || d.updatedAt || Date.now()) : (d.updatedAt || Date.now()));
    if (quiet < STUCK_MS) continue;
    const first = !f.stuck;
    f.stuck = true;
    applyState(f);   // 小字的分鐘數跟著更新
    if (first) {
      f.stuckSince = Date.now();
      const min = Math.floor(quiet / 60000);
      sfx.stuck();
      const who = d.name || tr('有人');
      toast(tr(d.act?.kind === 'bash' ? '{name}的指令跑了 {n} 分鐘' : '{name} {n} 分鐘沒動靜', { name: who, n: min }));
      notifyUser(d, tr('{name}好像卡住了', { name: who }), d.act?.kind === 'bash' ? tr('指令跑了 {n} 分鐘：{cmd}', { n: min, cmd: d.act.detail || '' }) : tr('{n} 分鐘沒有新動作', { n: min }));
    }
  }
}

// ── 新用戶：辦公室還沒人時，告訴他怎麼讓人走進來 ──
// 伺服器有 /info（單獨跑的 Cubbi）就看找不找得到 Claude Code 的紀錄；沒有就只給一般說明
let envInfo = null, emptyCard = null;
post('/api/space/lang', { lang: LANG }).catch(() => {});   // 讓 Claude Code 狀態列跟介面同一種語言
api('/api/space/info').then(i => { envInfo = i; if (emptyCard?.style.display === 'block') showEmpty(true); }).catch(() => {});
function showEmpty(on) {
  if (!emptyCard) { emptyCard = document.createElement('div'); emptyCard.id = 'empty-card'; document.body.appendChild(emptyCard); }
  emptyCard.style.display = on ? 'block' : 'none';
  if (!on) return;
  emptyCard.innerHTML = envInfo && !envInfo.hasClaude
    ? `<b>${esc(tr('找不到 Claude Code 的紀錄'))}</b><p>${esc(tr('Cubbi 讀的是 {dir}。先安裝並用過 Claude Code，再回來看看。', { dir: envInfo.claudeDir + (envInfo.platform === 'win32' ? '\\projects' : '/projects') }))}</p>`
    : `<b>${esc(tr('辦公室還沒有人上班'))}</b><p>${esc(tr('在任何終端機開一段 Claude Code 對話，他就會從門口走進來：'))}</p><code>claude</code><p class="sub">${esc(tr('最近 3 天的對話都會出現；Cubbi 只讀你電腦上的紀錄，不上傳。'))}</p>`;
}

// ── 通知：分頁標題＋系統通知 ──────────────────────────────────────────────────
// 標題一直反映「幾個人在等你」；切到別的分頁或 App 時（頁面還開著）跳系統通知，點了回到那個人
const BASE_TITLE = document.title;
function updateTitle(n) { document.title = n ? tr('({n}) 等你回答 · {title}', { n, title: BASE_TITLE }) : BASE_TITLE; }
function notifyUser(d, title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body: body.slice(0, 120), tag: 'space-' + d.id, icon: '/icon-192.png' });
    n.onclick = () => { window.focus(); select(d.id, d.status === 'asking' ? 'chat' : 'progress'); n.close(); };
  } catch {}
}
// 第一次點畫面時順便請求通知權限（瀏覽器規定要使用者操作才能問）
addEventListener('pointerdown', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }, { once: true });

function updateCounts() {
  const n = Object.fromEntries(ORDER.map(k => [k, 0]));
  for (const d of byId.values()) if (figs.has(d.id)) { const st = d.status === 'background' ? 'idle' : d.status; n[st] = (n[st] || 0) + 1; }
  updateTitle(n.asking || 0);
  const el = document.getElementById('counts');
  el.innerHTML = ORDER.map(k => `<span class="count" data-k="${k}" data-n="${n[k]}" title="${STATUS[k]}"><span class="dot s-${k}"></span>${n[k]}</span>`).join('')
    || '';
  const hc = helperCount();
  if (hc) el.innerHTML += `<span class="count" data-k="helpers" data-n="${hc}" title="${tr('出去工作的同事（背景任務）')}"><span class="dot s-background"></span>${hc}</span>`;
  if (!byId.size) el.innerHTML = `<span style="color:var(--sub)">${tr('還沒有人上班')}</span>`;
  showEmpty(!byId.size);
}
// 點計數：輪流跳到那個狀態的人
const cycle = {};
document.getElementById('counts').addEventListener('click', (e) => {
  const c = e.target.closest('.count'); if (!c) return;
  const k = c.dataset.k;
  const list = [...figs.values()].filter(f => k === 'helpers' ? f.helpers?.size : k === 'idle' ? isDone(f.data.status) : f.data.status === k);
  if (!list.length) return;
  cycle[k] = ((cycle[k] ?? -1) + 1) % list.length;
  select(list[cycle[k]].id);
  if (k === 'asking') openQuick(list[cycle[k]].id);
});

function connectEvents() {
  const es = new EventSource(authUrl('/api/space/events'));
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'names') { refresh(); return; }
    if (msg.type === 'stream-cam') { director.set(msg.cam); return; }
    if (msg.type === 'codex') { loadCodex(); return; }
    if (msg.type === 'claude-quota') { loadClaudeQuota(); return; }
    if (msg.type === 'grok-quota') { loadGrokQuota(); return; }
    if (msg.type !== 'update') { for (const pl of plugins) if (pl.onEvent?.(msg)) return; return; }
    if (msg.type !== 'update') return;
    if (replay) return;   // 回放中不接即時更新，回放結束會整個重抓
    const s = msg.session;
    if (!s.sid) return;   // 還沒拿到正式編號（id 之後會換），等拿到再放人
    if (!s.live && !byId.has(s.id)) return;
    // 終端機的對話（伺服器盯著紀錄檔推的）：直接更新；這台開的對話進程收掉了：狀態以紀錄為準，重抓清單
    if (!s.live && byId.get(s.id)?.live) { refresh(); return; }
    const isNew = !byId.has(s.id);
    upsert(s);
    if (isNew) { layoutIslands(); flushEnters(); updateIslandLabels(); }
    updateCounts();
    if (s.id === selectedId) { updatePanelHead(); if (curTab === 'progress') loadProgress(true); }
  };
  es.onerror = () => { es.close(); setTimeout(connectEvents, 4000); };
}

// ── 點選 ──────────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit ? figs.get(hit.object.userData.figId) : null;
}
// 點到哪隻貓（貓沒登記在 pickables，整隻打射線；貓很小，隻數也少）
function pickCat() {
  const roots = cats.map(c => c.fig.root);
  const hit = ray.intersectObjects(roots, true)[0];
  if (!hit) return null;
  for (let o = hit.object; o; o = o.parent) { const c = cats.find(x => x.fig.root === o); if (c) return c; }
  return null;
}
// 點了貓：鏡頭拉近、之後牠走到哪跟到哪（使用者照樣可以旋轉縮放；點空地、按全景就停）
function followCatNow(c) {
  setFollow(null);
  const off = camera.position.clone().sub(controls.target);
  off.y = Math.max(off.y, 30);
  flyTo(c.fig.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 8, 0)), off.setLength(Math.min(off.length(), 140)));
  followCat = c;
  toast(tr('跟拍{name}：牠走到哪鏡頭跟到哪', { name: c.def.name }));
}
// 手勢：這次觸碰過程中只要出現過兩根以上手指（縮放、平移），放開時都不算點擊；
// 按住超過半秒也不算（那是慢慢拖曳），免得縮放完手指離開時鏡頭突然飛走
const touching = new Set();
let multiTouch = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  touching.add(e.pointerId);
  if (touching.size > 1) multiTouch = true;
  downAt = touching.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
  fly = null;
});
const endTouch = (e) => { touching.delete(e.pointerId); if (!touching.size) setTimeout(() => { if (!touching.size) multiTouch = false; }, 0); };
renderer.domElement.addEventListener('pointercancel', (e) => { endTouch(e); downAt = null; });
renderer.domElement.addEventListener('pointerup', (e) => {
  const wasMulti = multiTouch;
  endTouch(e);
  if (!downAt || wasMulti || downAt.id !== e.pointerId) { downAt = null; lastTap = null; return; }
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), held = performance.now() - downAt.t;
  downAt = null;
  if (moved > 8 || held > 500) { lastTap = null; return; }
  { const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const df = delivScreenHit();
    if (df) { select(df.id, 'deliv'); return; } }
  const f = pick(e);
  if (f) { select(f.id); return; }
  // 外包畫師、作品牆的畫、貓
  { const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const c = pickCat();
    if (c) { if (selectedId) closePanel(); followCatNow(c); return; }
    const h = ray.intersectObjects(extraPicks, false)[0];
    if (h) { h.object.userData.onPick(); return; } }
  const hit = pickWorld(e);
  // 點兩下：往那一點拉近
  const now = performance.now();
  if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 14 && hit) {
    lastTap = null;
    setFollow(null);
    const off = camera.position.clone().sub(controls.target);
    flyTo(hit.point.clone(), off.setLength(Math.max(120, off.length() * 0.5)));
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  if (selectedId) { closePanel(); return; }   // 面板開著：點空地先關面板
  const where = hit && whereIs(hit.point);
  if (where?.place) { setFollow(null); flyTo(where.place.target.clone(), where.place.off.clone().multiplyScalar(innerWidth <= 760 ? 1.3 : 1)); }
  else if (where?.island) { setFollow(null); focusIsland(where.island); }
});
let lastTap = null;
// 射線打到辦公室或部門底板上的哪一點（藏起來的牆不算）
function pickWorld(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [office, ...[...islands.values()].map(i => i.group)];
  const shown = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  return ray.intersectObjects(targets, true).find(h => shown(h.object) && !h.object.material?.transparent) || null;
}
// 這一點屬於哪個區域、或哪個部門的底板
function whereIs(p) {
  for (const pl of spots.places || []) for (const [x0, z0, x1, z1] of pl.area) if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return { place: pl };
  for (const isl of islands.values()) {
    const g = isl.group.position;
    if (Math.abs(p.x - g.x) < isl.w / 2 && Math.abs(p.z - g.z) < isl.d / 2) return { island: isl };
  }
  return null;
}
const tip = document.getElementById('tip');
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const f = pick(e);
  const c = !f && pickCat();
  if (c) {
    renderer.domElement.style.cursor = 'pointer';
    tip.innerHTML = `<b>${esc(c.def.name)}</b>${esc(tr(followCat === c ? '跟拍中' : '點一下跟拍'))}`;
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
    return;
  }
  if (!f) {
    // 對整間辦公室打射線比較貴：滑鼠移動時每 0.1 秒最多一次
    const now = performance.now();
    if (now - (pickWorld.lastMove || 0) < 100) return;
    pickWorld.lastMove = now;
    const hit = pickWorld(e), where = hit && whereIs(hit.point);
    renderer.domElement.style.cursor = where ? 'pointer' : '';
    if (!where) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<b>${esc(tr('前往：{place}', { place: where.place ? where.place.name : projName(where.island.cwd, workRoot) }))}</b>`;
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
    return;
  }
  renderer.domElement.style.cursor = 'pointer';
  const d = f.data;
  tip.innerHTML = `<b>${esc(d.name || d.title || tr('（沒有標題）'))}</b>${d.name && d.title ? `<span style="opacity:.75">${esc(d.title)}</span><br>` : ''}${esc(tr('{k}（{tool}）', { k: projName(d.cwd, workRoot), tool: tr(OUTFITS[f.fig.outfit]?.name || '') }))} · ${esc(STATUS[d.status])} · ${ago(d.updatedAt)}${actText(d.act) ? '<br>' + esc(actText(d.act)) : ''}`;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
  tip.style.top = (e.clientY + 14) + 'px';
});
renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

// ── 面板 ──────────────────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
let curTab = 'chat';
let chatFor = null;      // iframe 現在接的是哪一段（id 或 'new:<cwd>'）
let newCwd = null;       // 新對話還沒拿到 id 時用

// 宿主沒提供的能力：對應的分頁和按鈕藏起來
const hideEl = (el) => { if (el) el.style.display = 'none'; };
const restoreReplyHint = () => { const i = document.getElementById('p-reply-in'); if (i) i.placeholder = tr('直接交代一句…'); };
if (!host.chat) hideEl(document.querySelector('.tab[data-tab="chat"]'));
if (!host.files) hideEl(document.querySelector('.tab[data-tab="files"]'));
if (!host.reply) hideEl(document.getElementById('p-reply'));
if (!canNew) hideEl(document.getElementById('btn-new'));
if (host.back) {
  const a = document.createElement('a');
  a.className = 'chip'; a.href = host.back.href; a.title = host.back.title || '';
  a.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.getElementById('hud-left').prepend(a);
}

function select(id, tab, { stay = false } = {}) {
  closeDrawers();
  const prev = selectedId;
  if (prev && prev !== id) leaveReport(prev);
  if (prev !== id) setFollow(null);
  selectedId = id;
  newCwd = null;
  const f = figs.get(id);
  const d = byId.get(id);
  if (d) { seen[id] = Math.max(d.updatedAt || 0, Date.now()); saveSeen(); if (d.sid) post('/api/space/inbox/seen', { sid: d.sid, at: d.updatedAt }).catch(() => {}); }
  if (prev && figs.get(prev)) applyState(figs.get(prev));
  if (f) { applyState(f); if (!stay) focusFig(f); }
  panel.classList.add('open');
  fileState.path = null;
  updatePanelHead();
  document.getElementById('pane-deliv').dataset.key = '';
  document.querySelector('.tab[data-tab="deliv"]').style.display = hasDeliv(f) ? '' : 'none';
  syncSummonBtn();
  // 有成品：先看成品（等你回答的除外）
  showTab(tab || (d?.status === 'asking' ? 'chat' : f?.deliv && prev !== id ? 'deliv' : d?.status === 'idle' ? 'chat' : prev === id ? curTab : 'progress'));
}

// 外掛的抽屜（aside.drawer）：跟對話面板同一個位置，一次只開一個
const closeDrawers = () => document.querySelectorAll('.drawer.open').forEach(d => d.classList.remove('open'));

// 換看別人或關面板：報告結束，回座位
function leaveReport(id) {
  const f = figs.get(id); if (!f) return;
  f.reportView = false;
  endReport(f);
}
function closePanel() {
  if (selectedId) leaveReport(selectedId);
  panel.classList.remove('open');
  setFollow(null);
  const prev = selectedId;
  selectedId = null; newCwd = null;
  if (prev && figs.get(prev)) applyState(figs.get(prev));
  clearInterval(progressTimer);
}
document.getElementById('p-close').onclick = closePanel;
// 點面板頂端的把手：全螢幕／半高切換
panel.querySelector('.grip').addEventListener('click', () => panel.classList.toggle('full'));

function updatePanelHead() {
  const d = byId.get(selectedId);
  const f = figs.get(selectedId);
  const sw = document.getElementById('p-swatch');
  const ask = document.getElementById('p-ask');
  if (!d) {
    document.getElementById('p-title').textContent = tr('新對話');
    document.getElementById('p-sub').innerHTML = esc(newCwd || '');
    sw.style.background = '#c9d1d9';
    ask.style.display = 'none';
    return;
  }
  sw.style.background = f ? f.fig.torsoColor : '#c9d1d9';
  document.getElementById('p-title').textContent = d.name || d.title || tr('（沒有標題）');
  document.getElementById('p-title').title = d.title || '';
  document.getElementById('p-sub').innerHTML = `<span class="dot s-${d.status}"></span>${esc(STATUS[d.status])}`
    + ` · <span title="${esc(d.cwd)}">${esc(projName(d.cwd, workRoot))}</span> · ${ago(d.updatedAt)}`
    + (actText(d.act) && d.status !== 'resting' ? ` · ${esc(actText(d.act))}` : '');
  if (d.status === 'asking') {
    ask.innerHTML = `<span>${esc(tr('它在等你：{q}', { q: d.ask?.question || d.ask?.tool || tr('需要你決定') }))}</span>` + (host.answer ? `<button>${tr('直接回答')}</button>` : '');
    ask.querySelector('button')?.addEventListener('click', () => openQuick(d.id));
    ask.style.display = 'flex';
  } else ask.style.display = 'none';
}

document.querySelectorAll('.tab[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(tab) {
  if ((tab === 'chat' && !host.chat) || (tab === 'files' && !host.files) || (tab === 'deliv' && !figs.get(selectedId)?.deliv) || (tab === 'report' && !figs.get(selectedId)?.reportView)) tab = 'progress';
  curTab = tab;
  // 手機：對話分頁全螢幕（輸入要空間），進度、檔案半高（還看得到場景裡的人）
  panel.classList.toggle('full', tab === 'chat');
  panel.classList.toggle('chatting', tab === 'chat');   // 對話分頁有自己的輸入框，快速回覆收起來
  document.querySelectorAll('.tab[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  // 只切對話面板自己的分頁（裝修抽屜的內容區也是 .pane，不能一起藏掉）
  panel.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + tab));
  clearInterval(progressTimer);
  if (tab === 'chat') loadChat();
  if (tab === 'progress') { loadProgress(); progressTimer = setInterval(() => loadProgress(true), 6000); }
  if (tab === 'files') loadFiles();
  if (tab === 'deliv') loadDeliv();
  if (tab === 'report') loadReport();
}

// 對話：嵌宿主給的頁面（claude-web 是主介面本身）
function loadChat() {
  const pane = document.getElementById('pane-chat');
  const d = byId.get(selectedId);
  const key = d ? d.id : 'new:' + newCwd;
  if (chatFor === key && pane.querySelector('iframe')) return;
  chatFor = key;
  let note = '';
  let src;
  if (d) {
    if (!d.sid) { pane.innerHTML = `<div class="empty">${tr('對話剛開始，等它拿到編號…')}</div>`; chatFor = null; return; }
    // 從紀錄檔讀來的 Codex 對話只能看；宿主自己開的（live，例如 remote 的 Codex Driver）可以聊
    if (d.agent === 'codex' && !d.live) { pane.innerHTML = `<div class="empty">${tr('這是 Codex 的對話，只能看進度。')}</div>`; return; }
    if (d.canResume === false) { pane.innerHTML = `<div class="empty">${tr('這段對話的目錄不在允許的範圍內，只能看進度。')}</div>`; return; }
    if (d.status === 'external') note = tr('這段對話正在別處（例如終端機）執行。在這裡送出會另開一個進程接著講，兩邊同時寫可能互相干擾。');
    src = host.chat.url(d);
  } else {
    src = host.chat.newUrl(newCwd || workRoot);
  }
  pane.innerHTML = (note ? `<div class="note">${esc(note)}</div>` : '') + `<iframe src="${src}"></iframe>`;
}

// 新對話拿到編號：人物馬上入座，面板改成接這個人
host.chat?.onNewSession?.(async (sid) => {
  if (!newCwd) return;
  newCwd = null;
  selectedId = sid;
  chatFor = sid;
  await refresh();
  const f = figs.get(sid);
  if (f) { applyState(f); focusFig(f); }
  updatePanelHead();
});

// 進度：待辦、改過的檔案、最近的步驟
let progressTimer = null;
async function loadProgress(quiet) {
  const pane = document.getElementById('pane-progress');
  const d = byId.get(selectedId);
  if (!d?.sid) { pane.innerHTML = `<div class="empty">${tr('還沒開始')}</div>`; return; }
  if (!quiet) pane.innerHTML = `<div class="empty">${tr('讀取中…')}</div>`;
  let p;
  try { p = await api('/api/space/progress?sessionId=' + d.sid); } catch { return; }
  if (selectedId !== d.id || curTab !== 'progress') return;
  let html = '';
  // 不能在這裡聊（單獨跑的 Cubbi）：給一行指令，到終端機接著聊
  // Windows 預設是 PowerShell（不認 &&）：用 ; 接，路徑加雙引號
  const resumeTool = d.agent === 'codex' ? 'codex resume' : 'claude --resume';
  const resumeCmd = !((!host.chat || (d.agent === 'codex' && !d.live)) && d.cwd) ? '' : envInfo?.platform === 'win32' ? `cd "${d.cwd}"; ${resumeTool} ${d.sid}` : `cd ${shq(d.cwd)} && ${resumeTool} ${d.sid}`;
  if (resumeCmd) html += `<div class="resume"><div>${tr('在終端機接著聊：')}</div><code>${esc(resumeCmd)}</code><button class="buy ghost" data-copy>${tr('複製')}</button></div>`;
  for (const pl of plugins) html += pl.progressHtml?.(p) || '';
  if (p.todos?.length) {
    const done = p.todos.filter(t => t.status === 'completed').length;
    html += `<div class="sec"><h4>${tr('待辦 {done}/{n}', { done, n: p.todos.length })}</h4>` + p.todos.map(t =>
      `<div class="todo ${esc(t.status)}"><span class="box"></span><span>${esc(t.text)}</span></div>`).join('') + '</div>';
  }
  if (p.files?.length) {
    html += `<div class="sec"><h4>${tr('改過的檔案 {n}', { n: p.files.length })}</h4><div class="files-chips">` + p.files.map(f =>
      `<span class="fchip" data-path="${esc(f.path)}" title="${esc(f.path)}">${esc(tail(f.path))}</span>`).join('') + '</div></div>';
  }
  const steps = (p.steps || []).slice().reverse();
  html += `<div class="sec"><h4>${tr('最近的步驟')}</h4>` + (steps.length ? steps.map(s => {
    const ic = ICON[s.kind] || ICON.tool;
    return `<div class="step ${s.kind}"><span class="ic" style="background:${KIND_COLOR[s.kind] || '#607d8b'}">${ic}</span>`
      + `<span class="tx">${s.tool ? `<span class="tool">${esc(s.tool)}</span>` : ''}${esc(s.text || '')}</span><span class="tm">${ago(s.at)}</span></div>`;
  }).join('') : `<div class="empty">${tr('還沒有紀錄')}</div>`) + '</div>';
  const keep = pane.scrollTop;
  pane.innerHTML = html;
  pane.scrollTop = keep;
  pane.querySelectorAll('.fchip').forEach(c => c.onclick = () => { fileState.open = c.dataset.path; showTab('files'); });
  pane.querySelector('[data-copy]')?.addEventListener('click', () => navigator.clipboard?.writeText(resumeCmd).then(() => toast(tr('已複製')), () => {}));
}

// 檔案：從對話的目錄開始逛，點檔案就預覽（HTML 會在沙盒裡跑出來）
const fileState = { path: null, open: null };
async function loadFiles(path) {
  const pane = document.getElementById('pane-files');
  const d = byId.get(selectedId);
  const root = d?.cwd || newCwd || workRoot;
  if (fileState.open) { const fp = fileState.open; fileState.open = null; fileState.path = fp.slice(0, fp.lastIndexOf('/')) || '/'; return previewFile(fp); }
  path = path || fileState.path || root;
  fileState.path = path;
  pane.innerHTML = `<div class="empty">${tr('讀取中…')}</div>`;
  let r;
  try { r = await host.files.ls(path); } catch { return; }
  if (r.error) { pane.innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
  const items = r.items.filter(i => !i.name.startsWith('.') || i.name === '.claude');
  pane.innerHTML = `<div class="crumbs">${r.parent ? `<button data-up>${tr('上一層')}</button>` : ''}<span>${esc(r.path)}</span></div>`
    + items.map((i, n) => `<div class="fitem" data-i="${n}">${i.isDir ? ICON.dir : ICON.file}<span class="nm">${esc(i.name)}</span>`
      + `<span class="sz">${i.isDir ? '' : size(i.size)}</span></div>`).join('')
    + (items.length ? '' : `<div class="empty">${tr('空的')}</div>`);
  pane.scrollTop = 0;
  pane.querySelector('[data-up]')?.addEventListener('click', () => loadFiles(r.parent));
  pane.querySelectorAll('.fitem').forEach(el => el.onclick = () => {
    const it = items[+el.dataset.i];
    if (it.isDir) loadFiles(it.path); else previewFile(it.path);
  });
}
function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

async function previewFile(fp) {
  const pane = document.getElementById('pane-files');
  const name = tail(fp);
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const bar = `<div class="bar"><button data-back>${tr('返回')}</button><span class="nm" title="${esc(fp)}">${esc(name)}</span>`
    + `<a href="${fileUrl(fp)}" target="_blank" style="margin-left:auto;font-size:12px;font-weight:400">${tr('開新分頁')}</a></div>`;
  const wrap = (body) => {
    pane.innerHTML = `<div class="preview">${bar}${body}</div>`;
    pane.scrollTop = 0;
    pane.querySelector('[data-back]').onclick = () => loadFiles();
  };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return wrap(`<img src="${fileUrl(fp)}">`);
  if (['mp4', 'webm', 'mov'].includes(ext)) return wrap(`<video controls src="${fileUrl(fp)}"></video>`);
  if (ext === 'pdf') return wrap(`<div style="padding:10px 14px"><iframe src="${fileUrl(fp)}"></iframe></div>`);
  wrap(`<div class="empty">${tr('讀取中…')}</div>`);
  let r;
  try { r = await host.files.preview(fp); } catch { return; }
  if (r.type !== 'text') return wrap(`<div class="empty">${tr(r.type === 'too-large' ? '檔案太大，請開新分頁或下載' : '二進位檔案，請開新分頁或下載')}</div>`);
  if (ext === 'html' || ext === 'htm') {
    wrap(`<div style="padding:10px 14px"><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div>`);
    pane.querySelector('iframe').srcdoc = r.content;
    return;
  }
  wrap(`<pre>${esc(r.content)}</pre>`);
}

// ── 新對話 ────────────────────────────────────────────────────────────────────
const picker = document.getElementById('picker');
let pickPath = null;
document.getElementById('btn-new').onclick = () => openPicker();
document.getElementById('pk-close').onclick = () => picker.classList.remove('open');
picker.addEventListener('click', (e) => { if (e.target === picker) picker.classList.remove('open'); });
document.getElementById('pk-go').onclick = () => { picker.classList.remove('open'); openNew(pickPath); };

async function openPicker(path) {
  picker.classList.add('open');
  pickPath = path || pickPath || workRoot;
  document.getElementById('pk-cur').textContent = pickPath;
  const list = document.getElementById('pk-list');
  const recent = islandOrder.filter(c => c !== '?');
  let html = '';
  if (!path && recent.length) {
    html += `<h5>${tr('最近的專案')}</h5>` + recent.map(c => `<div class="fitem" data-go="${esc(c)}">${ICON.dir}<span class="nm">${esc(projName(c, workRoot))}</span><span class="sz">${esc(c.replace(workRoot, '~'))}</span></div>`).join('');
  }
  let r;
  try { r = await host.files.ls(pickPath); } catch { return; }
  html += `<h5>${esc(pickPath.replace(workRoot, '~') || '~')}</h5>`
    + (r.parent ? `<div class="fitem" data-nav="${esc(r.parent)}">${ICON.dir}<span class="nm">..</span></div>` : '')
    + r.items.filter(i => i.isDir && !i.name.startsWith('.')).map(i => `<div class="fitem" data-nav="${esc(i.path)}">${ICON.dir}<span class="nm">${esc(i.name)}</span></div>`).join('');
  list.innerHTML = html;
  list.scrollTop = 0;
  list.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => openPicker(el.dataset.nav));
  list.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { picker.classList.remove('open'); openNew(el.dataset.go); });
}

function openNew(cwd) {
  closeDrawers();
  const prev = selectedId;
  selectedId = null;
  if (prev && figs.get(prev)) applyState(figs.get(prev));
  newCwd = cwd || workRoot;
  chatFor = null;
  fileState.path = null;
  panel.classList.add('open');
  updatePanelHead();
  showTab('chat');
  const isl = islands.get(newCwd);
  if (isl) focusIsland(isl);
}


// ── 辦公室長相：等級、公共設施、獎盃、各部門的設備／地板／制服 ─────────────────
// 沒有外掛時是一間固定的辦公室；claude-web 的經營系統（plugins/economy.js）讓它隨成果長大。
// （look、LOOK0、EQUIP0 在檔案開頭）畫面上看到的（shown）跟 look 分開：look 變了要等送貨員送到才換上
const shown = { equip: {}, fac: null };
const equipFor = (cwd) => shown.equip[cwd] || look.depts[cwd]?.equip || EQUIP0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const deliveries = new Map();   // 'dept:<cwd>' / 'fac:<key>' -> 送貨員
const equipKeyOf = (cwd) => { const e = equipFor(cwd); return JSON.stringify([e.monitor, e.chair, e.desk, e.trinkets]); };

// animate：頁面開著時的變化（派送貨員、升級放積木雨）；剛打開頁面就直接換
function setLook(next, { animate = true } = {}) {
  look = { ...LOOK0, ...next };
  const live = animate && navReady && spots.door;
  for (const [cwd, d] of Object.entries(look.depts)) {
    if (!d.equip || JSON.stringify(shown.equip[cwd]) === JSON.stringify(d.equip)) continue;
    if (!live || !shown.equip[cwd] || !islands.has(cwd)) shown.equip[cwd] = clone(d.equip);
    else deliver('dept:' + cwd);
  }
  const fac = look.facilities;
  if (!shown.fac || !live) shown.fac = clone(fac);
  else for (const k of Object.keys(fac)) if (fac[k] !== shown.fac[k]) deliver('fac:' + k);
  if (navReady && statsBoard) drawStats();
  // 部門設備與地板、制服
  for (const f of figs.values()) { refreshDesk(f); redress(f); }
  for (const isl of islands.values()) {
    const fl = equipFor(isl.cwd).floor;
    if (fl !== isl.floor) { isl.floor = fl; if (isl.cols) sizeIsland(isl, true); }
  }
  // 升級：灑積木雨，雨下到一半整間辦公室換成新的
  if (look.level !== officeLevel && look.level !== levelPending) {
    if (live && look.level > officeLevel) {
      const lv = levelPending = look.level;
      brickRain(); sfx.levelUp(); toast(tr('公司升級：{name}！', { name: look.levelName }));
      setTimeout(spawnMascot, 1800);   // 積木雨停了，吉祥物（有的話）跳出來
      setTimeout(() => startEvent('celebrate', tr('升上{name}，大家來慶祝！', { name: look.levelName })), 4000);
      setTimeout(() => { officeLevel = lv; levelPending = null; layoutIslands(); }, 1500);
    } else officeLevel = look.level;
  }
  // 設施或獎盃變了：辦公室重蓋（buildOffice 的 key 會不一樣，沒變就不動）
  if (navReady) layoutIslands();
}

// ── 送貨員：扛著紙箱從門口進來，放下、拆箱、換裝，再走出去 ──
let courierN = 0;
function deliveryTarget(key) {
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  if (key.startsWith('dept:')) {
    const isl = islands.get(key.slice(5));
    if (!isl) return null;
    const p = isl.target || isl.group.position;
    return V(p.x, p.z + isl.d / 2 + 14);
  }
  const k = key.slice(4), { hw, hd } = spots;
  if (k === 'coffee') return spots.coffee[0].pos.clone().add(V(8, 0));
  if (k === 'lounge') return spots.lounge.clone();
  if (k === 'hotdesk') return spots.hot[0]?.approach.clone() || V(hw - 60, 0);
  if (k === 'wall') return V(-hw + 40, 0);
  if (spots.facAt?.[k]) return spots.facAt[k].clone();
  return V(0, hd - 40);
}
function deliver(key) {
  if (deliveries.has(key)) return;   // 已經在送了：送到時會套用最新的帳本
  const to = deliveryTarget(key);
  if (!to) { applyDelivery(key); return; }
  courierN++;
  const fig = buildCast('courier') || buildFigure('courier' + courierN, 'courier');
  const crate = box(11, 9, 9, '#c49a6c'); crate.add(box(11.2, 1.4, 9.2, '#e0c49a', 0, 3, 0));
  crate.position.set(0, 7, 9); fig.upper.add(crate);
  scene.add(fig.root);
  fig.root.position.copy(spots.door); fig.root.rotation.y = Math.PI / 2;
  const c = { id: 'courier' + courierN, key, fig, crate, nav: { place: 'door' }, phase: 0, stage: 'in' };
  deliveries.set(key, c);
  goTo(c, { name: 'drop', pos: to, approach: to, ry: 0 }, { then: () => { c.stage = 'unbox'; c.until = performance.now() + 1400; } });
}
function applyDelivery(key) {
  if (key.startsWith('dept:')) {
    const cwd = key.slice(5);
    shown.equip[cwd] = clone(look.depts[cwd]?.equip || EQUIP0);
    for (const f of figs.values()) if (f.cwdKey === cwd) refreshDesk(f);
    const isl = islands.get(cwd);
    if (isl && isl.floor !== shown.equip[cwd].floor) { isl.floor = shown.equip[cwd].floor; sizeIsland(isl, true); }
  } else {
    shown.fac = { ...shown.fac, [key.slice(4)]: look.facilities[key.slice(4)] };
    layoutIslands();
    syncCats();
  }
}
function animateCourier(c, t, dt) {
  const fig = c.fig;
  if (c.nav.place === 'walk') {
    stepWalk(c, dt);
    if (c.nav.place === 'walk') {
      walkPose(fig, c.nav);
      if (c.stage === 'in') { fig.arms[0].rotation.x = fig.arms[1].rotation.x = -1.45; }
      return;
    }
  }
  if (c.stage === 'unbox') {
    // 蹲下拆箱：箱子抖一抖、縮小，時間到就換上新東西
    const k = Math.max(0, (c.until - performance.now()) / 1400);
    fig.upper.rotation.x = 0.35; fig.arms[0].rotation.x = fig.arms[1].rotation.x = -1.0 + Math.sin(t * 20) * 0.2;
    c.crate.position.set(0, -6 + k * 2, 12); c.crate.scale.setScalar(0.3 + k * 0.7); c.crate.rotation.z = Math.sin(t * 30) * 0.1 * k;
    if (k <= 0) {
      c.crate.visible = false; fig.upper.rotation.x = 0;
      applyDelivery(c.key);
      puff(figWorldPos(c).add(new THREE.Vector3(0, 6, 0)));
      c.stage = 'out';
      goTo(c, { name: 'gone', pos: spots.door, approach: spots.door, ry: 0 }, { then: () => { c.fig.root.removeFromParent(); deliveries.delete(c.key); } });
    }
  }
}
// 換裝那一下的白煙
const puffs = [];
function puff(at) {
  sfx.pop();
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    m.position.copy(at); scene.add(m);
    puffs.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 40, 20 + Math.random() * 30, (Math.random() - 0.5) * 40), life: 0 });
  }
}
function stepPuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]; p.life += dt;
    p.m.position.addScaledVector(p.v, dt); p.m.scale.setScalar(1 + p.life * 3); p.m.material.opacity = Math.max(0, 0.8 - p.life * 1.2);
    if (p.life > 0.7) { scene.remove(p.m); puffs.splice(i, 1); }
  }
}

// ── 跨年煙火：午夜時窗外對面的樓頂上一朵一朵炸開（網址帶 ?fireworks=1 隨時看） ──
const FW_TEST = !!new URLSearchParams(location.search).get('fireworks');
const FW_COLORS = ['#ffd24a', '#ff5a5a', '#6ad1ff', '#b98cff', '#7dff9a', '#ffffff'];
function makeFireworks(hw, hd) {
  const group = new THREE.Group(); scene.add(group);
  return { group, bursts: [], next: 0, hw, hd };
}
function stepFireworks(dt) {
  const fw = fireworks, on = FW_TEST || fireworksOn(dateNow());
  fw.group.visible = on || fw.bursts.length > 0;
  if (on && (fw.next -= dt) <= 0) {
    fw.next = 0.3 + Math.random() * 0.6;
    const n = 110, pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 55 + Math.random() * 15;
      vel.push(r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp * 0.4);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)], size: 14, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.position.set((Math.random() - 0.5) * fw.hw * 1.8, -10 + Math.random() * 60, -fw.hd - 160 - Math.random() * 80);   // 從後面的窗戶看得到的高度
    fw.group.add(pts); fw.bursts.push({ pts, vel, life: 0 });
  }
  for (let i = fw.bursts.length - 1; i >= 0; i--) {
    const b = fw.bursts[i], p = b.pts.geometry.attributes.position.array;
    b.life += dt;
    for (let k = 0; k < p.length; k += 3) { b.vel[k + 1] -= 22 * dt; p[k] += b.vel[k] * dt; p[k + 1] += b.vel[k + 1] * dt; p[k + 2] += b.vel[k + 2] * dt; }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.life / 1.8);
    if (b.life > 1.8) { fw.group.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); fw.bursts.splice(i, 1); }
  }
}

const cats = [];
function syncCats() {
  const want = [0, 1, 3][shown.fac?.pet || 0];
  while (cats.length > want) cats.pop().fig.root.removeFromParent();
  while (cats.length < want && spots.door) {
    const def = { ...CATS[cats.length], name: host.catNames?.[cats.length] || CATS[cats.length].name };
    const fig = buildCatFigure(def, cats.length) || buildCat(def);
    scene.add(fig.root);
    const c = { id: 'cat:' + def.name, def, fig, nav: { place: 'cat' }, mode: 'sit', until: performance.now() + 2000 + cats.length * 1500, phase: cats.length * 1.7 };
    fig.root.position.set((Math.random() - 0.5) * spots.hw, 0, spots.hd - 60);
    cats.push(c);
  }
}
function catNext(c) {
  const r = Math.random(), V = (x, z) => new THREE.Vector3(x, 0, z), { hw, hd } = spots;
  const nappers = [...figs.values()].filter(f => f.nav.place === 'seat' && (f.data.status === 'resting' || isDone(f.data.status)) && !cats.some(o => o.deskOf === f));
  let to, then;
  if (r < 0.45 && nappers.length) {
    const f = nappers[Math.floor(Math.random() * nappers.length)];
    to = seatTarget(f).approach;
    then = () => { c.deskOf = f; f.holder.updateWorldMatrix(true, false); startHop(c, f.holder.localToWorld(new THREE.Vector3(10, DESK_TOP, 14)), f.holder.rotation.y + Math.PI, 'desk'); };
  } else if (r < 0.7) {
    to = V(hw - 62 + (Math.random() - 0.5) * 50, hd - 52 + (Math.random() - 0.5) * 30);
    then = () => { c.mode = Math.random() < 0.6 ? 'sleep' : 'sit'; c.until = performance.now() + 12000 + Math.random() * 15000; };
  } else if (r < 0.85) {
    to = V((Math.random() - 0.5) * hw * 1.4, -hd + 34);   // 窗邊曬太陽
    then = () => { c.mode = 'sleep'; c.until = performance.now() + 15000 + Math.random() * 15000; };
  } else {
    to = V((Math.random() - 0.5) * hw * 1.6, (Math.random() - 0.5) * hd * 1.6);
    then = () => { c.mode = 'sit'; c.until = performance.now() + 5000 + Math.random() * 6000; };
  }
  c.mode = 'walk';
  if (Math.random() < 0.25 && near(c.fig.root.position)) sfx.meow();
  goTo(c, { name: 'cat', pos: to, approach: to, ry: Math.random() * 6 }, { then });
  c.nav.speed = 55;
}
function startHop(c, to, ry, mode) {
  c.hop = { from: c.fig.root.position.clone(), to: to.clone(), t: 0, ry, mode };
  c.mode = 'hop';
}
function animateCat(c, t, dt) {
  const f = c.fig, k = t + c.phase;
  f.tail.rotation.z = Math.sin(k * 2.2) * 0.35;
  if (c.mode === 'walk' && c.nav.place === 'walk') {
    stepWalk(c, dt);
    const sw = Math.sin(c.nav.stride * 0.5);
    f.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw) * 0.6; });
    f.body.position.y = 0; f.body.rotation.x = 0; f.head.rotation.x = 0;
    return;
  }
  if (c.mode === 'hop') {
    const h = c.hop; h.t = Math.min(1, h.t + dt * 1.6);
    f.root.position.lerpVectors(h.from, h.to, h.t);
    f.root.position.y += Math.sin(h.t * Math.PI) * 18;
    f.root.rotation.y = h.ry;
    f.legs.forEach(l => { l.rotation.x = h.t < 0.5 ? -0.8 : 0.6; });
    if (h.t >= 1) {
      c.mode = h.mode;
      c.until = performance.now() + (h.mode === 'desk' ? 18000 + Math.random() * 20000 : 800);
    }
    return;
  }
  // 坐著／睡著
  const sleeping = c.mode === 'sleep' || c.mode === 'desk';
  f.legs.forEach((l, i) => { l.rotation.x = sleeping ? (i < 2 ? -1.4 : 1.4) : (i < 2 ? 0 : 1.2); });
  f.body.position.y = sleeping ? -3.2 : -1.5;
  f.body.rotation.x = sleeping ? 0 : -0.45;
  f.head.rotation.x = sleeping ? 0.5 + Math.sin(k * 0.8) * 0.04 : -0.3;
  if (performance.now() > c.until) {
    if (c.mode === 'desk') {   // 睡飽了，跳下桌子
      const f2 = c.deskOf; c.deskOf = null;
      const down = f2 ? seatTarget(f2).approach : f.root.position.clone().setY(0);
      startHop(c, down, f.root.rotation.y, 'sit');
    } else catNext(c);
  }
}

// 換制服：小人原地重做一套（位置、動作、泡泡都留著），冒一陣白煙
function redress(f) {
  if (f.fig.cast) return;   // 角色不換制服
  const want = f.data.agent === 'codex' ? 'codex' : outfitFor(f.cwdKey);
  if (f.fig.outfit === want) return;
  const old = f.fig, nf = buildFigure(f.id, want);
  const parent = old.root.parent;
  nf.root.position.copy(old.root.position); nf.root.rotation.copy(old.root.rotation); nf.root.visible = old.root.visible;
  nf.root.add(f.tag, f.figHit);   // 泡泡與點選範圍搬到新的身上
  parent.add(nf.root); parent.remove(old.root);
  nf.root.traverse(o => { if (o.isMesh) o.userData.figId = f.id; });
  f.fig = nf;
  applyState(f);
  if (nf.root.visible && navReady) puff(figWorldPos(f).add(new THREE.Vector3(0, 20, 0)));
}

// 設備換了：整張桌子重蓋（人坐著不動）
function refreshDesk(f) {
  const key = equipKeyOf(f.cwdKey);
  if (f.equipKey === key) return;
  f.equipKey = key;
  const isl = islands.get(f.cwdKey);
  f.holder.remove(f.desk.group);
  const i = pickables.indexOf(f.desk.hit); if (i >= 0) pickables.splice(i, 1);
  f.desk = buildDesk(isl.tint, equipFor(f.cwdKey), f.id);
  f.desk.group.traverse(o => { if (o.isMesh) o.userData.figId = f.id; });
  f.holder.add(f.desk.group);
  pickables.push(f.desk.hit);
  applyState(f);
}

let levelPending = null;   // 升級的積木雨下到一半才換辦公室
let toastTimer = null;
// action：{ label, fn } → 提示上多一顆按鈕（例如「復原」），提示也停久一點
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('act', !!action);
  if (action) {
    const b = document.createElement('button'); b.textContent = action.label;
    b.onclick = () => { el.classList.remove('on'); action.fn(); };
    el.appendChild(b);
  }
  el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), action ? 6000 : 3200);
}

// 積木雨：一堆小磚從天而降，彈兩下就消失
let rain = null;
// ── 吉祥物（宿主的 cast.js 有提供才會出現）：升級時從地上冒出來，跳跳揮手幾秒再縮回去 ──
let mascot = null;
function spawnMascot() {
  if (mascot || !navReady) return;
  const g = buildMascot(); if (!g) return;
  g.scale.setScalar(0.01);
  g.position.copy(spots.lounge || new THREE.Vector3(0, 0, 0));
  scene.add(g); mascot = { g, t: 0 };
}
function stepMascot(dt) {
  const m = mascot; m.t += dt;
  const life = 6, t = m.t, pop = t < 0.4 ? t / 0.4 : t > life - 0.4 ? Math.max(0, (life - t) / 0.4) : 1;
  m.g.scale.setScalar(1.3 * pop);
  m.g.position.y = Math.abs(Math.sin(t * 6)) * 8 * pop;
  m.g.rotation.y = Math.atan2(camera.position.x - m.g.position.x, camera.position.z - m.g.position.z);
  const { hands } = m.g.userData; hands[0].position.y = 15 + Math.max(0, Math.sin(t * 10)) * 6; hands[1].position.y = 15 + Math.max(0, Math.sin(t * 10 + Math.PI)) * 6;
  if (t > life) { scene.remove(m.g); mascot = null; }
}

function brickRain() {
  const group = new THREE.Group(); scene.add(group);
  const cols = ['#c91a09', '#f2cd37', '#0055bf', '#237841', '#fe8a18', '#f4f4f4', '#923978'];
  const items = [];
  for (let i = 0; i < (MOBILE ? 60 : 140); i++) {
    const m = box(8, 4, 4, cols[i % cols.length]);
    m.position.set((Math.random() - 0.5) * bounds * 1.6, 200 + Math.random() * 320, (Math.random() - 0.5) * bounds * 1.6);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    group.add(m);
    items.push({ m, vy: 0, spin: (Math.random() - 0.5) * 8 });
  }
  rain = { group, items, t: 0 };
}
function stepRain(dt) {
  rain.t += dt;
  for (const it of rain.items) {
    it.vy -= 700 * dt;
    it.m.position.y += it.vy * dt;
    if (it.m.position.y < 2) { it.m.position.y = 2; it.vy = -it.vy * 0.35; it.spin *= 0.6; }
    it.m.rotation.x += it.spin * dt; it.m.rotation.z += it.spin * 0.5 * dt;
  }
  if (rain.t > 4.5) { scene.remove(rain.group); rain = null; }
}

const soundBtn = document.getElementById('btn-sound');
const paintSound = () => { soundBtn.innerHTML = soundOn() ? ICON.soundOn : ICON.soundOff; soundBtn.title = soundOn() ? tr('關掉音效') : tr('打開音效'); };
soundBtn.onclick = () => { setSound(!soundOn()); paintSound(); if (soundOn()) sfx.done(); };
if (STREAM) { setSoft(true); setSound(true); }   // 直播頁沒人點按鈕：音效直接開、用柔和模式（OBS 的瀏覽器來源不需要先點過才能出聲）
paintSound();

const musicBtn = document.getElementById('btn-music');
const paintMusic = () => { musicBtn.innerHTML = musicOn() ? ICON.musicOn : ICON.musicOff; musicBtn.title = musicOn() ? tr('關掉音樂') : tr('打開音樂'); };
musicBtn.onclick = () => { setMusic(!musicOn()); paintMusic(); };
// 直播頁的音樂通常在 OBS 另外放，要 Cubbi 自己放就在網址加 ?music=1
// 指定放哪首：?song=歌單裡的 id
if (new URLSearchParams(location.search).get('song')) cueSong(new URLSearchParams(location.search).get('song'));
if (STREAM) { setMusicSoft(true); if (new URLSearchParams(location.search).get('music') === '1') setMusic(true); }
paintMusic();
onMusic(paintMusic);   // 點歌機那邊開關音樂，這顆鈕也跟著變
// 有人舉手等你：音樂壓低到你回答為止；剛發現卡住只壓 30 秒（指令可能本來就會跑很久，不能一直壓著）
function syncDuck() {
  let v = false;
  for (const f of figs.values()) if (f.data.status === 'asking' || (f.stuck && Date.now() - (f.stuckSince || 0) < 30000)) { v = true; break; }
  duckMusic(v);
}

// 環境音只在鏡頭附近才出聲（看著整間辦公室時不會一片嘈雜）
function near(p, dist = 420) { return controls.target.distanceTo(p) < dist && camera.position.distanceTo(p) < dist * 2.2; }

// ── 真實天氣（台北，伺服器每 15 分鐘查一次 Open-Meteo）──
// 網址帶 ?weather=rain｜storm｜snow｜fog｜cloudy｜clear 可以預覽
let weatherData = null;
const WEATHER_OVERRIDE = new URLSearchParams(location.search).get('weather');
function weatherNow() {
  if (WEATHER_OVERRIDE) return { kind: WEATHER_OVERRIDE, cloud: 0.9, temp: weatherData?.temp };
  const d = weatherData;
  if (!d) return { kind: 'clear', cloud: 0 };
  const c = d.code;
  const kind = c >= 95 ? 'storm' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? 'rain'
    : c === 45 || c === 48 ? 'fog' : c >= 2 ? 'cloudy' : 'clear';
  return { kind, cloud: (d.cloud ?? 0) / 100, temp: d.temp };
}
const isRaining = () => ['rain', 'storm'].includes(weatherNow().kind);
async function loadWeather() {
  try { weatherData = await api('/api/space/weather'); } catch {}
  applyDaylight(); updateWeatherChip();
}
const WEATHER_ICON = {
  clear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="#f2b632"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="#f2b632" stroke-width="1.4" stroke-linecap="round"/></svg>',
  cloudy: '<svg viewBox="0 0 16 16"><path d="M4.5 12.5h7.5a2.8 2.8 0 0 0 0-5.6 4 4 0 0 0-7.6.9A2.4 2.4 0 0 0 4.5 12.5z" fill="#9aa6b1"/></svg>',
  fog: '<svg viewBox="0 0 16 16"><path d="M2 6h12M3 9h10M2 12h12" stroke="#9aa6b1" stroke-width="1.6" stroke-linecap="round"/></svg>',
  rain: '<svg viewBox="0 0 16 16"><path d="M4.5 9.5h7.5a2.8 2.8 0 0 0 0-5.6 4 4 0 0 0-7.6.9A2.4 2.4 0 0 0 4.5 9.5z" fill="#7f8b96"/><path d="M5 11.5l-1 2.5M8.5 11.5l-1 2.5M12 11.5l-1 2.5" stroke="#3a8ee8" stroke-width="1.4" stroke-linecap="round"/></svg>',
  storm: '<svg viewBox="0 0 16 16"><path d="M4.5 9h7.5a2.8 2.8 0 0 0 0-5.6 4 4 0 0 0-7.6.9A2.4 2.4 0 0 0 4.5 9z" fill="#5b6b78"/><path d="M8.5 9.5 6.5 12.5h2.5L7.5 15.5" fill="none" stroke="#f2b632" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  snow: '<svg viewBox="0 0 16 16"><path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" stroke="#7fb4e6" stroke-width="1.4" stroke-linecap="round"/></svg>',
};
const WEATHER_NAME = { clear: tr('晴'), cloudy: tr('多雲'), fog: tr('起霧'), rain: tr('下雨'), storm: tr('雷雨'), snow: tr('下雪') };
function updateWeatherChip() {
  const w = weatherNow(), el = document.getElementById('weather-chip');
  if (!el) return;
  el.innerHTML = WEATHER_ICON[w.kind] + (w.temp != null ? `<b>${Math.round(w.temp)}°</b>` : '');
  el.title = tr('{place}現在：{w}', { place: host.weatherPlace || tr('外面'), w: WEATHER_NAME[w.kind] + (w.temp != null ? ' ' + w.temp + '°C' : '') });
}
// 窗外的雨（雪）：一大片細線往下落，只在下雨／下雪時出現
let precip = null;
function stepWeather(dt) {
  const w = weatherNow(), on = ['rain', 'storm', 'snow'].includes(w.kind);
  if (!on) { if (precip) { scene.remove(precip.mesh); precip = null; } return; }
  const snow = w.kind === 'snow';
  if (!precip || precip.snow !== snow) {
    if (precip) scene.remove(precip.mesh);
    const n = MOBILE ? 900 : 2200, pos = new Float32Array(n * 6), { hw = 300, hd = 300 } = spots;
    for (let i = 0; i < n; i++) {
      // 只下在房子外面（後方與左方），不會穿過屋頂掉進辦公室
      const side = i % 3 === 0;
      const x = side ? -hw - 40 - Math.random() * 600 : (Math.random() - 0.5) * hw * 3.4;
      const z = side ? (Math.random() - 0.5) * hd * 2.4 : -hd - 40 - Math.random() * 600;
      const y = -300 + Math.random() * 800;
      pos.set([x, y, z, x + (snow ? 0.8 : 1.5), y - (snow ? 1.6 : 14), z], i * 6);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: snow ? '#ffffff' : '#a9c4dc', transparent: true, opacity: snow ? 0.9 : 0.75 }));
    scene.add(mesh);
    precip = { mesh, snow, flash: 0 };
  }
  const a = precip.mesh.geometry.attributes.position, speed = snow ? 40 : 520;
  for (let i = 0; i < a.count; i += 2) {
    let y = a.getY(i) - speed * dt;
    if (y < -300) y += 800;
    a.setY(i, y); a.setY(i + 1, y - (snow ? 1.6 : 14));
  }
  a.needsUpdate = true;
  // 雷雨：偶爾閃電（天空與室內一瞬間變亮）＋雷聲
  if (w.kind === 'storm') {
    precip.flash -= dt;
    if (precip.flash < -8 - Math.random() * 12) { precip.flash = 0.18; sfx.thunder(); }
    hemi.intensity = precip.flash > 0 ? 2.4 : hemiBase;
  }
}
let hemiBase = 0.85;

// ── 縮時回放：用大約一分鐘把今天的辦公室快轉一遍 ─────────────────────────────
// 依對話紀錄的動作時間軸重演：在做事就是工作中、剛做完是「做完了」、久沒動靜是休息；天色也跟著走
let replay = null;
const REPLAY_SECONDS = 60;
async function startReplay() {
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const from = Math.max(day0.getTime(), Date.now() - 16 * 3600_000);
  let tl;
  try { tl = await api('/api/space/timeline?from=' + from); } catch { toast(tr('讀不到今天的紀錄')); return; }
  const ids = Object.keys(tl.sessions).filter(id => figs.has(id));
  if (!ids.length) { toast(tr('今天還沒有可以回放的紀錄')); return; }
  closePanel(); setFollow(null); closeDrawers();
  replay = { from: tl.from, to: tl.to, cur: tl.from, playing: true, tl: tl.sessions, real: new Map() };
  for (const f of figs.values()) replay.real.set(f.id, f.data);
  document.body.classList.add('replaying');
  for (const f of figs.values()) setReplayState(f, 'resting', null, tl.from);
  applyDaylight();
  renderReplayBar();
}
// 某人在回放時間 T 的狀態
function replayStateAt(id, T) {
  const ev = replay.tl[id];
  if (!ev) return { status: 'resting', act: null, at: replay.from };
  let last = null;
  for (const e of ev) { if (e[0] > T) break; last = e; }
  if (!last) return { status: 'resting', act: null, at: replay.from };
  const age = T - last[0];
  if (last[1] === 'done') return age < 20 * 60_000 ? { status: 'idle', act: { kind: 'done' }, at: last[0] } : { status: 'resting', act: null, at: last[0] };
  if (age < 4 * 60_000) return { status: 'working', act: { kind: last[1], since: last[0] }, at: last[0] };
  return { status: 'resting', act: null, at: last[0] };
}
function setReplayState(f, status, act, at) {
  const before = f.data.status;
  if (before === status && f.data.act?.kind === act?.kind) return;
  f.data = { ...f.data, status, act, updatedAt: at, bg: [], live: false };
  applyState(f);
  if (before !== status) { onStatus(f, before, status); updateCounts(); }
  syncHelpers(f);
}
function stepReplay(dt) {
  if (!replay.playing) return;
  replay.cur = Math.min(replay.to, replay.cur + (replay.to - replay.from) / REPLAY_SECONDS * dt);
  for (const f of figs.values()) { const s = replayStateAt(f.id, replay.cur); setReplayState(f, s.status, s.act, s.at); }
  if (Math.floor(replay.cur / 600_000) !== replay.lastSky) { replay.lastSky = Math.floor(replay.cur / 600_000); applyDaylight(); }   // 每 10 分鐘（回放時間）換一次天色
  updateReplayBar();
  if (replay.cur >= replay.to) { replay.playing = false; updateReplayBar(); toast(tr('回放完畢'), { label: tr('回到現在'), fn: stopReplay }); }
}
function stopReplay() {
  if (!replay) return;
  for (const f of figs.values()) {
    const real = replay.real.get(f.id);
    if (real) setReplayState(f, real.status, real.act, real.updatedAt);
    if (real) { f.data = real; applyState(f); syncHelpers(f); }
  }
  replay = null;
  document.body.classList.remove('replaying');
  document.getElementById('replay-bar').innerHTML = '';
  applyDaylight();
  refresh();
}
const fmtClock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function renderReplayBar() {
  const el = document.getElementById('replay-bar');
  el.innerHTML = `<button class="rp-btn" data-play></button><div class="rp-time" id="rp-time"></div>`
    + `<input type="range" id="rp-range" min="0" max="1000" value="0"><span class="rp-end">${fmtClock(replay.to)}</span><button class="rp-btn" data-stop title="${tr('回到現在')}">✕</button>`;
  el.querySelector('[data-play]').onclick = () => { if (replay.cur >= replay.to) replay.cur = replay.from; replay.playing = !replay.playing; updateReplayBar(); };
  el.querySelector('[data-stop]').onclick = stopReplay;
  const range = el.querySelector('#rp-range');
  range.oninput = () => { replay.cur = replay.from + (replay.to - replay.from) * range.value / 1000; replay.lastSky = null; updateReplayBar(); };
  updateReplayBar();
}
function updateReplayBar() {
  if (!replay) return;
  const el = document.getElementById('replay-bar');
  el.querySelector('[data-play]').innerHTML = replay.playing
    ? '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z" fill="currentColor"/></svg>';
  document.getElementById('rp-time').textContent = tr('回放 {t}', { t: fmtClock(replay.cur) });
  const range = document.getElementById('rp-range');
  if (document.activeElement !== range) range.value = Math.round((replay.cur - replay.from) / (replay.to - replay.from) * 1000);
}

// ── 節日 ──（網址帶 ?date=12-24 或 ?date=2027-02-06 可以預覽）
const WALL_TOP = 128;
const DATE_OVERRIDE = (() => {
  const q = new URLSearchParams(location.search).get('date');
  if (!q) return null;
  const d = new Date((/^\d{4}-/.test(q) ? q : `${new Date().getFullYear()}-${q}`) + 'T12:00:00');
  return isNaN(d) ? null : d;
})();
// 現在是哪一天、幾點（回放時是回放的時間；網址帶 ?date= ?hour= 預覽）
function dateNow() {
  if (replay) return new Date(replay.cur);
  const d = DATE_OVERRIDE ? new Date(DATE_OVERRIDE) : new Date();
  if (HOUR_OVERRIDE != null) d.setHours(Math.floor(HOUR_OVERRIDE), (HOUR_OVERRIDE % 1) * 60, 0, 0);
  else if (DATE_OVERRIDE) { const n = new Date(); d.setHours(n.getHours(), n.getMinutes()); }
  return d;
}
function holidayNow() { return holidayOf(DATE_OVERRIDE || new Date(), { zh: LANG === 'zh' }); }
// 台灣的使用者才算國定假日（看電腦時區；網址帶 ?cal=tw 可以強制）
const TW_CAL = new URLSearchParams(location.search).get('cal') === 'tw' || Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Taipei';
// 週末、國定假日：整天跟深夜一樣，沒事的人在家，有任務在跑的人照樣進公司（加班）
const offDayNow = () => isDayOff(dateNow(), { tw: TW_CAL });
const offNow = () => isOffHours(hourNow()) || offDayNow();
// 節日第一次打開時打聲招呼（一天一次）
setTimeout(() => {
  const h = holidayNow(), k = 'space_greet_' + new Date().toDateString();
  if (h && !localStorage.getItem(k)) { localStorage.setItem(k, '1'); toast(tr(HOLIDAY_GREETING[h])); }
}, 9000);

// ── 日夜循環 ──────────────────────────────────────────────────────────────────
// 照真實時間：天空、陽光（早上從左、傍晚從右）、月光、室內燈、窗外城市的燈；網址帶 ?hour=21 可以看指定時間
const HOUR_OVERRIDE = (() => { const v = parseFloat(new URLSearchParams(location.search).get('hour')); return isNaN(v) ? null : v; })();
function hourNow() {
  if (replay) { const d = new Date(replay.cur); return d.getHours() + d.getMinutes() / 60; }
  if (HOUR_OVERRIDE != null) return HOUR_OVERRIDE;
  const d = new Date(); return d.getHours() + d.getMinutes() / 60;
}
const skyCanvas = document.createElement('canvas'); skyCanvas.width = 512; skyCanvas.height = 256;
const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
let nightLevel = 0;
function applyDaylight() {
  const p = dayParams(hourNow());
  nightLevel = p.night;
  const w = weatherNow(), gray = { clear: 0, cloudy: 0.45, fog: 0.55, rain: 0.65, storm: 0.8, snow: 0.6 }[w.kind] * Math.min(1, 0.4 + w.cloud);
  if (gray) {
    const mixC = (c, to) => '#' + new THREE.Color(c).lerp(new THREE.Color(to), gray).getHexString();
    p.sky = p.sky.map((c, i) => mixC(c, p.night > 0.5 ? ['#1a1e26', '#262b33', '#30353d'][i] : ['#8a929c', '#a4abb3', '#bcc1c6'][i]));
    p.sun *= 1 - gray * 0.75;
  }
  scene.fog.near = w.kind === 'fog' ? 350 : 1300; scene.fog.far = w.kind === 'fog' ? 1200 : 3400;
  const g = skyCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, p.sky[0]); gr.addColorStop(0.55, p.sky[1]); gr.addColorStop(1, p.sky[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  if (p.night > 0.3) {   // 星星
    let seed = 5; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${(p.night - 0.3) * (0.4 + r() * 0.6)})`; g.fillRect(r() * 512, r() * 150, 1.5, 1.5); }
  }
  skyTex.needsUpdate = true;
  scene.fog.color.set(p.sky[2]);
  sun.color.set(p.sunColor); sun.intensity = p.sun + p.night * 0.3;   // 晚上是月光
  sun.position.set(p.sunPos.x, p.sunPos.y, p.sunPos.z);
  hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = hemiBase = p.hemi;
  ceiling.intensity = p.ceiling * (offDayNow() ? 0.55 : 1); ceiling.color.set(p.night > 0.5 ? '#ffe2b0' : '#fff8ee');   // 入夜室內燈偏暖
  for (const m of cityMats) m.emissiveIntensity = p.night * 1.6;
  if (moon) moon.visible = p.night > 0.4;   // 中秋滿月：天黑才出來
  renderer.shadowMap.needsUpdate = true;
}
applyDaylight();

// 深夜下班：休息中的人陸續從門口離開；早上 7:00～8:30 各自回來（有事就馬上跑回來）
function goHome(f) {
  freeSlot(f); f.deskMode = null;
  goTo(f, { name: 'home', pos: spots.door, approach: spots.door, ry: -Math.PI / 2 }, { umbrella: true, then: () => { f.fig.root.visible = false; } });
}
function comeBack(f, run) {
  const root = f.fig.root;
  if (root.parent !== scene) scene.attach(root);
  root.visible = true;
  root.position.copy(spots.door); root.rotation.set(0, Math.PI / 2, 0);
  f.nav = { place: 'door' };
  goTo(f, seatTarget(f), { run, umbrella: true });
}
function shiftTick() {
  const h = hourNow(), off = offNow();
  let leaving = 0;
  for (const f of figs.values()) {
    if (f.enter) continue;
    if (f.nav.place === 'home') {
      if (f.data.status !== 'resting' || (!off && h >= arriveHour(hash(f.id)))) comeBack(f, f.data.status !== 'resting');
      continue;
    }
    // 一次放一兩個人走，不會整間同時清空
    if (off && f.data.status === 'resting' && !f.event && f.nav.place !== 'walk' && leaving < 2) { goHome(f); leaving++; }
  }
}

// ── 整理人物：歸檔（抱紙箱從門口離開）與搜尋 ─────────────────────────────────
const archiveBtn = document.getElementById('p-archive');
archiveBtn.innerHTML = '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 8.5h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
async function setArchived(sid, on) {
  const r = await post('/api/space/archive', { sid, archived: on });
  return r.ok;
}
archiveBtn.onclick = async () => {
  const d = byId.get(selectedId), f = figs.get(selectedId);
  if (!d?.sid) return;
  if (d.live && ACTIVE.has(d.status)) { toast(tr('他正在忙，等他做完再歸檔')); return; }
  if (!await setArchived(d.sid, true)) { toast(tr('歸檔失敗')); return; }
  closePanel();
  // 抱著紙箱從門口離開，走出去才從名單拿掉
  const leave = () => { removeFig(d.id); byId.delete(d.id); updateIslandLabels(); updateCounts(); };
  if (f && navReady && spots.door && f.fig.root.visible) {
    f.archiving = true;
    const crate = box(10, 8, 8, '#c49a6c'); crate.position.set(0, 7, 9); f.fig.upper.add(crate);
    freeSlot(f);
    goTo(f, { name: 'gone', pos: spots.door, approach: spots.door, ry: 0 }, { then: leave });
    f.nav.paper = false;
  } else leave();
  toast(tr('已歸檔：{name}', { name: d.name || d.title || '' }), { label: tr('復原'), fn: async () => { await setArchived(d.sid, false); refresh(); } });
};

const searchEl = document.getElementById('search'), searchIn = document.getElementById('search-in');
document.getElementById('btn-search').innerHTML = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
document.getElementById('btn-search').onclick = () => { searchEl.classList.add('open'); searchIn.value = ''; renderSearch(); setTimeout(() => searchIn.focus(), 50); };
searchEl.addEventListener('click', (e) => { if (e.target === searchEl) searchEl.classList.remove('open'); });
searchIn.addEventListener('input', renderSearch);
searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') searchEl.classList.remove('open'); if (e.key === 'Enter') searchEl.querySelector('.sr-item')?.click(); });
// ── 座位表：一個部門一格（名字、每個人的狀態點），照辦公室裡的排法排，點了鏡頭飛過去；其他區域在底下 ──
const seatmap = document.getElementById('seatmap'), seatmapIn = document.getElementById('seatmap-in');
function openSeatmap() {
  seatmapIn.value = ''; seatmap.classList.add('open'); renderSeatmap(); if (!MOBILE) seatmapIn.focus();
  const fw = seatmap.querySelector('.sm-floorwrap');   // 平面圖比畫面寬（手機）：先停在中間
  if (fw) fw.scrollLeft = (fw.scrollWidth - fw.clientWidth) / 2;
}
// 找部門：打字就把對不上的變淡（排法不動，還認得出位置），Enter 飛到第一個對上的
seatmapIn.addEventListener('input', () => { renderSeatmap(); seatmap.querySelector('.sm-floor .best')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
seatmapIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') seatmap.querySelector('.sm-isl.best, .sm-places .chip.hit')?.click(); });
const closeSeatmap = () => seatmap.classList.remove('open');
document.getElementById('seatmap-close').onclick = closeSeatmap;
seatmap.addEventListener('click', (e) => { if (e.target === seatmap) closeSeatmap(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSeatmap(); });
const dotRank = (f) => ORDER.indexOf(f.data.status === 'background' ? 'idle' : f.data.status);
function seatmapDepts() {
  return islandOrder.filter(c => islands.has(c)).map(c => {
    const isl = islands.get(c);
    const people = isl.seats.filter(Boolean).map(id => figs.get(id)).filter(Boolean).sort((a, b) => dotRank(a) - dotRank(b));
    return { isl, cwd: c, name: isl.labelDiv.querySelector('.nm').textContent || projName(c, workRoot), people, asking: people.filter(f => f.data.status === 'asking').length };
  });
}
// 平面圖（底下只剩貓，區域都畫在圖上）：照辦公室裡真正的位置畫（上面是窗邊、左牆有門）。部門是一塊塊板子（大小照實際的板子），
// 其他區域（茶水間、休息區、主管室…）是底下淡色的範圍，只是一個點的（點歌機這種）畫成小圖釘；都點得到、點了飛過去。
// 窄螢幕（手機直拿）而辦公室是橫的：整張逆時針轉 90 度，窗邊在左，才不會縮成一條。
function floorPlan(plan, depts, deptCls, where, placeCls) {
  const hw = spots.hw || 200, hd = spots.hd || 200;
  const W = Math.max(240, plan.clientWidth - 28);
  const rot = W < 560 && hw > hd * 1.1;
  // 比例：塞得下就整張放進來；塞不下（手機、部門很多）就讓最窄的板子至少 52px 寬（名字分兩行還認得出來），改成可以捲
  const minW = Math.min(...depts.map(d => (rot ? d.isl.d : d.isl.w) || 80));
  const s = Math.max(W / (rot ? 2 * hd : 2 * hw), 52 / minW);
  const FW = (rot ? 2 * hd : 2 * hw) * s, H = (rot ? 2 * hw : 2 * hd) * s;
  const pt = (x, z) => (rot ? [(z + hd) * s, (hw - x) * s] : [(x + hw) * s, (z + hd) * s]);
  const rect = (x0, z0, x1, z1) => {
    x0 = Math.max(-hw, x0); x1 = Math.min(hw, x1); z0 = Math.max(-hd, z0); z1 = Math.min(hd, z1);
    const [a, b] = pt(x0, z0), [c, d] = pt(x1, z1);
    return `left:${Math.min(a, c).toFixed(1)}px;top:${Math.min(b, d).toFixed(1)}px;width:${Math.abs(c - a).toFixed(1)}px;height:${Math.abs(d - b).toFixed(1)}px`;
  };
  let html = `<div class="sm-floorwrap"><div class="sm-floor${rot ? ' rot' : ''}" style="width:${FW.toFixed(0)}px;height:${H.toFixed(0)}px">`;
  // 區域：大的先畫（在下面），窗邊畫成牆上的一條
  const zones = (spots.places || []).filter(p => p.key !== 'window' && p.area?.length)
    .map(p => ({ p, a: p.area.reduce((m, a) => ((a[2] - a[0]) * (a[3] - a[1]) > (m[2] - m[0]) * (m[3] - m[1]) ? a : m)) }))
    .sort((u, v) => (v.a[2] - v.a[0]) * (v.a[3] - v.a[1]) - (u.a[2] - u.a[0]) * (u.a[3] - u.a[1]));
  for (const { p, a } of zones) {
    for (const b of p.area) if (b !== a) html += `<div class="sm-zone${placeCls(p)}" data-place="${esc(p.key)}" style="${rect(...b)}"></div>`;
    html += `<div class="sm-zone${placeCls(p)}" data-place="${esc(p.key)}" style="${rect(...a)}"><span>${CAM_ICON[p.key] || ''}${esc(p.name)}</span></div>`;
  }
  // 部門板子：太小就只留名字
  for (const d of depts) {
    const c = d.isl.target || d.isl.group.position, w = d.isl.w || 80, dd = d.isl.d || 80;
    const px = (rot ? dd : w) * s, py = (rot ? w : dd) * s;
    const tiny = px < 66 || py < 46;
    html += `<div class="sm-isl${deptCls(d)}${tiny ? ' tiny' : ''}${d.asking ? ' ask' : ''}" data-i="${depts.indexOf(d)}" style="--t:${d.isl.tint};${rect(c.x - w / 2, c.z - dd / 2, c.x + w / 2, c.z + dd / 2)}" title="${esc(d.name)}">`
      + (where(d) && !tiny ? `<small class="sm-where">${esc(where(d))}</small>` : '') + `<b>${esc(d.name)}</b>`
      + (tiny ? '' : `<span class="sm-dots">${d.people.slice(0, 12).map(f => `<span class="dot s-${f.data.status}"></span>`).join('')}</span>`)
      + `</div>`;
  }
  // 只是一個點的地方（點歌機這種）：小圖釘
  for (const p of spots.places || []) if (p.key !== 'window' && !p.area?.length) {
    const [x, y] = pt(p.target.x, p.target.z);
    html += `<div class="sm-pin${placeCls(p)}" data-place="${esc(p.key)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${CAM_ICON[p.key] || CAM_ICON.pin}<span>${esc(p.name)}</span></div>`;
  }
  // 門
  if (spots.door) { const [x, y] = pt(-hw, spots.door.z); html += `<div class="sm-door" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px"></div>`; }
  return html + `<div class="sm-wintag" data-place="window">${tr('窗邊')}</div></div></div>`;
}
function renderSeatmap() {
  const depts = seatmapDepts();
  const q = seatmapIn.value.trim().toLowerCase();
  const has = (...xs) => xs.some(x => String(x || '').toLowerCase().includes(q));
  const hit = (d) => has(d.name, projName(d.cwd, workRoot), ...d.people.flatMap(f => [f.data.name, f.data.title]));
  const cls = (ok) => !q ? '' : ok ? ' hit' : ' dim';
  // Enter 去最像的那個：名字開頭對上 > 名字裡有 > 資料夾 > 只有裡面的人對上；同分先去有人在等你的、再來是正在忙的
  const busy = (d) => d.people.filter(f => ACTIVE.has(f.data.status)).length;
  const score = (d) => !q ? 0 : d.name.toLowerCase().startsWith(q) ? 4 : d.name.toLowerCase().includes(q) ? 3 : has(projName(d.cwd, workRoot)) ? 2 : hit(d) ? 1 : 0;
  const best = q ? [...depts].sort((a, b) => score(b) - score(a) || b.asking - a.asking || busy(b) - busy(a))[0] : null;
  // 同名的部門（例如 ~/projects/idea-lab 和 ~/.xitto/idea-lab）在格子上多標一行上層資料夾
  const dupe = new Set(depts.map(d => d.name).filter((n, i, a) => a.indexOf(n) !== i));
  const where = (d) => dupe.has(d.name) ? tail(d.cwd.slice(0, d.cwd.lastIndexOf('/'))) + '/' : '';
  const goIsland = (isl) => { closeSeatmap(); setFollow(null); focusIsland(isl); };
  const plan = document.getElementById('seatmap-plan');
  // 捷徑：打開就先推你可能要去的——有人在等你的、你剛去過的、正在忙的，最多 6 個
  const byCwd = new Map(depts.map(d => [d.cwd, d]));
  const picks = [...new Set([
    ...depts.filter(d => d.asking).map(d => d.cwd),
    ...recentDepts.filter(c => byCwd.has(c)).slice(0, 4),
    ...depts.filter(d => d.people.some(f => ACTIVE.has(f.data.status))).map(d => d.cwd),
  ])].slice(0, 6).map(c => byCwd.get(c));
  const why = (d) => d.asking ? tr('等你') : recentDepts.includes(d.cwd) ? tr('剛去過') : tr('忙碌中');
  const quick = !q && picks.length ? `<div class="sm-quick">${picks.map(d => `<div class="chip" data-i="${depts.indexOf(d)}">`
    + `<span class="dot s-${d.people[0]?.data.status || 'idle'}"></span>${esc(d.name)}<small>${why(d)}</small></div>`).join('')}</div>` : '';
  const keepX = plan.querySelector('.sm-floorwrap')?.scrollLeft;
  plan.innerHTML = quick + (depts.length ? floorPlan(plan, depts, (d) => cls(hit(d)) + (d === best && score(d) ? ' best' : ''), where, (p) => cls(has(p.name))) : `<div class="empty">${tr('還沒有部門')}</div>`)
    + (q && !depts.some(hit) ? `<div class="empty">${tr('找不到這個部門')}</div>` : '')
    + `<div class="sm-places">` + cats.map((c, i) => `<div class="chip${followCat === c ? ' on' : ''}${cls(has(c.def.name))}" data-cat="${i}" title="${esc(tr('跟拍這隻貓'))}">${CAM_ICON.cat}${esc(c.def.name)}</div>`).join('') + `</div>`;
  if (keepX) plan.querySelector('.sm-floorwrap').scrollLeft = keepX;
  plan.querySelectorAll('.sm-isl, .sm-quick .chip').forEach(x => x.onclick = () => goIsland(depts[+x.dataset.i].isl));
  plan.querySelectorAll('[data-place]').forEach(x => x.onclick = () => { closeSeatmap(); goPlace(x.dataset.place); });
  plan.querySelectorAll('[data-cat]').forEach(x => x.onclick = () => { const c = cats[+x.dataset.cat]; closeSeatmap(); if (c) followCatNow(c); });
}
setInterval(() => { if (seatmap.classList.contains('open')) renderSeatmap(); }, 5000);

function renderSearch() {
  const q = searchIn.value.trim().toLowerCase();
  const rank = (d) => ORDER.indexOf(d.status === 'background' ? 'idle' : d.status);
  const list = [...figs.values()].map(f => f.data).filter(d => {
    if (!q) return true;
    const dept = tr(OUTFITS[figs.get(d.id)?.fig.outfit]?.name || '');
    return [d.name, d.title, d.lastPrompt, projName(d.cwd, workRoot), dept].some(x => (x || '').toLowerCase().includes(q));
  }).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt).slice(0, 30);
  const el = document.getElementById('search-list');
  el.innerHTML = list.length ? list.map(d => `<div class="sr-item" data-id="${esc(d.id)}"><span class="dot s-${d.status}"></span><div><b>${esc(d.name || d.title || tr('（沒有標題）'))}</b>`
    + `<small>${esc(projName(d.cwd, workRoot))} · ${esc(STATUS[d.status])} · ${ago(d.updatedAt)}${d.name && d.title ? ' · ' + esc(d.title) : ''}</small></div></div>`).join('')
    : `<div class="empty">${tr('找不到')}</div>`;
  el.querySelectorAll('.sr-item').forEach(x => x.onclick = () => { searchEl.classList.remove('open'); select(x.dataset.id); });
}

// ── 快速回覆：面板上方直接交代一句 ───────────────────────────────────────────
// 工作中：插進這一輪（跟主介面邊跑邊補話一樣）；閒著或休息：開新的一輪；等你回答：先回答
document.getElementById('p-reply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('p-reply-in');
  const text = input.value.trim();
  const d = byId.get(selectedId);
  if (!text || !d?.sid) return;
  if (d.status === 'asking') { toast(tr('他在等你回答，先回答再交代')); openQuick(d.id); return; }
  if (d.agent === 'codex' && !d.live) { toast(tr('這是 Codex 的對話，只能看進度。')); return; }
  if (d.canResume === false) { toast(tr('這段對話的目錄不在允許的範圍內')); return; }
  if (d.status === 'external' && !confirm(tr('這段對話正在終端機執行，從這裡送出會另開一個進程接著講，兩邊可能互相干擾。確定要送？'))) return;
  try {
    const r = await host.reply(d, text);
    if (r.ok) input.value = '';
    toast(r.msg);
  } catch { toast(tr('連線失敗')); }
});

// ── 外包畫師：Claude 叫 Codex 生圖時，辦公室來一位外包畫師 ─────────────────────
// 啟動中：在門口邊看錶邊等（Codex 常要一兩分鐘才起來）；接案：走到後窗邊的畫架；作畫中：揮筆、畫布慢慢出現草稿；
// 畫好：畫布換成真的那張圖，捧著畫走去主角桌邊交件，再從門口離開；那張畫掛上右牆的作品牆。
const extraPicks = [];   // 不是員工、但點得到的東西（畫師、牆上的畫）：userData.onPick
const pluginPicks = [];  // 其中外掛 office(ctx).pick() 登記的，辦公室重蓋時換掉
const painters = new Map();   // 工作 id -> 畫師
const EASEL_X = [-0.68, -0.42, 0.42];
let codexJobs = [];
// 額度（5 小時與每週）：右上角選單 Codex、Claude 各一格，Codex 的外包人員小卡上也有；5 小時額度用到 80% 提醒一次
let codexQuota = null, claudeQuota = null, grokQuota = null;
const fmtReset = (sec) => { if (!sec) return ''; const d = new Date(sec * 1000), diff = sec * 1000 - Date.now();
  return tr('{t} 重置', { t: diff < 86400_000 ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}` }); };
const hhmm = (at) => new Date(at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
function drawQuotaChip(el, label, q, color) {
  const x = q?.primary || q?.secondary;
  if (!x) { el.innerHTML = ''; return null; }
  const p = Math.round(x.used_percent);
  el.className = 'chip qchip' + (p >= 95 ? ' full' : p >= 80 ? ' warn' : '');
  el.style.setProperty('--qc', color);
  el.innerHTML = `<b>${label}</b><span class="qbar"><i style="width:${p}%"></i></span>${p}%`;
  return q.primary ? p : null;
}
async function loadQuota() {
  try { codexQuota = await api('/api/space/codex-quota'); } catch { return; }
  applyQuotaJars();
  const q = codexQuota, el = document.getElementById('quota-chip');
  const p = drawQuotaChip(el, 'Codex', q, QUOTA_COLOR.codex);
  if (p == null) return;
  const w = Math.round(q.secondary?.used_percent ?? 0);
  el.title = [tr('Codex 額度（{plan}）', { plan: q.plan || '' }), tr('5 小時：已用 {p}%，{reset}', { p, reset: fmtReset(q.primary.resets_at) }),
    tr('每週：已用 {p}%，{reset}', { p: w, reset: fmtReset(q.secondary?.resets_at) }), tr('（{t} 最後一次執行時的數字）', { t: hhmm(q.at) })].join('\n');
  if (p >= 80 && loadQuota.warned !== q.primary.resets_at) { loadQuota.warned = q.primary.resets_at; toast(tr('Codex 5 小時額度已用 {p}%，{reset}', { p, reset: fmtReset(q.primary.resets_at) })); }
}
// Claude 的數字來自終端機的狀態列（npx cubbi install-hooks）或宿主的串流；用 API key 的人沒有額度，格子不出現
async function loadClaudeQuota() {
  try { claudeQuota = await api('/api/space/claude-quota'); } catch { return; }
  applyQuotaJars();
  const q = claudeQuota, el = document.getElementById('claude-quota-chip');
  const p = drawQuotaChip(el, 'Claude', q, QUOTA_COLOR.claude);
  if (!q) return;
  const row = (name, x) => x ? tr(name, { p: Math.round(x.used_percent), reset: fmtReset(x.resets_at) }) : '';
  el.title = [tr('Claude 額度'), row('5 小時：已用 {p}%，{reset}', q.primary), row('每週：已用 {p}%，{reset}', q.secondary), tr('（{t} 最後一次回應時的數字）', { t: hhmm(q.at) })].filter(Boolean).join('\n');
  if (p != null && p >= 80 && loadClaudeQuota.warned !== q.primary.resets_at) { loadClaudeQuota.warned = q.primary.resets_at; toast(tr('Claude 5 小時額度已用 {p}%，{reset}', { p, reset: fmtReset(q.primary.resets_at) })); }
}
function quotaHtml(q = codexQuota, color = QUOTA_COLOR.codex) {
  if (!q?.primary && !q?.secondary) return '';
  const row = (name, x) => x ? `<div class="qrow"><span style="width:62px">${name}</span><span class="qbar"><i style="width:${x.used_percent}%;background:${x.used_percent >= 80 ? 'var(--orange)' : color}"></i></span><span>${Math.round(x.used_percent)}%</span><small style="color:var(--sub)">${fmtReset(x.resets_at)}</small></div>` : '';
  return `<div style="margin:6px 0 2px">${row(tr('5 小時'), q.primary)}${row(tr('每週'), q.secondary)}</div>`;
}
function openQuota(title, html, reason) {
  quick.innerHTML = `<div class="qk"><div class="qk-head"><b>${title}</b><button class="p-close" data-close>✕</button></div>${html}<div class="qk-reason">${esc(reason)}</div></div>`;
  quick.classList.add('open'); quick.querySelector('[data-close]').onclick = closeQuick;
}
const openCodexQuota = () => openQuota(tr('Codex 額度'), quotaHtml(),
  tr('ChatGPT {plan} 方案 · 數字來自 {t} Codex 最後一次執行', { plan: codexQuota?.plan || '', t: codexQuota ? new Date(codexQuota.at).toLocaleString(LOCALE) : '' }));
const openClaudeQuota = () => openQuota(tr('Claude 額度'), quotaHtml(claudeQuota, QUOTA_COLOR.claude),
  tr('數字來自 {t} Claude Code 最後一次回應', { t: claudeQuota ? new Date(claudeQuota.at).toLocaleString(LOCALE) : '' }));
// Grok Bot：桌面版存在本機的每週用量（沒裝就沒有）；數字是桌面版上次抓的。只擺豆罐，右上角不加格子（選單已經夠長）
async function loadGrokQuota() {
  try { grokQuota = await api('/api/space/grok-quota'); } catch { return; }
  applyQuotaJars();
}
// 桌面版不會一直重抓（大概只在打開用量頁時），數字放久了要講清楚是多久以前的
function grokAge(at) {
  const h = (Date.now() - at) / 3600_000;
  if (h < 1) return '';
  return h < 24 ? tr('（{n} 小時前的數字）', { n: Math.floor(h) }) : tr('（{n} 天前的數字，在 Grok Bot 打開用量頁會更新）', { n: Math.floor(h / 24) });
}
const openGrokQuota = () => openQuota(tr('Grok 額度'), quotaHtml(grokQuota, QUOTA_COLOR.grok),
  tr('{plan} 方案 · 數字來自 {t} Grok Bot 桌面版最後一次更新', { plan: grokQuota?.plan || '', t: grokQuota ? new Date(grokQuota.at).toLocaleString(LOCALE) : '' }) + (grokQuota ? grokAge(grokQuota.at) : ''));
document.getElementById('quota-chip').onclick = openCodexQuota;
document.getElementById('claude-quota-chip').onclick = openClaudeQuota;

async function loadCodex() {
  loadQuota();
  try { codexJobs = await api('/api/space/codex'); } catch { return; }
  syncPainters();
  for (const f of figs.values()) f.codexWait = codexJobs.some(j => j.sid === f.id && !j.bg && !j.end);
}
const texLoader = new THREE.TextureLoader();
function loadTex(url, cb) { texLoader.load(authUrl(url), (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cb(t); }); }

// 作畫中的草稿：每秒多幾筆，畫布慢慢填滿
function sketchCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#f4efe4'; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const cols = ['#c91a09', '#f2cd37', '#0055bf', '#237841', '#fe8a18', '#923978', '#1b2a34'];
  let n = 0;
  return { tex, stroke() {
    n++;
    g.globalAlpha = 0.55; g.strokeStyle = cols[n % cols.length]; g.lineWidth = 6 + (n % 4) * 3; g.lineCap = 'round';
    const x = 40 + Math.random() * 176, y = 40 + Math.random() * 176;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120, x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90); g.stroke();
    tex.needsUpdate = true;
  } };
}

function easelSlot() {
  const used = new Set([...painters.values()].map(p => p.slot));
  const i = EASEL_X.findIndex((_, k) => !used.has(k));
  return i < 0 ? 0 : i;
}
function syncPainters() {
  if (!navReady || !spots.door) return;
  const ids = new Set(codexJobs.map(j => j.id));
  for (const job of codexJobs) {
    const owner = figs.get(job.sid);
    let p = painters.get(job.id);
    if (!p) {
      if (job.end && Date.now() - job.end > 60_000) continue;   // 打開頁面時早就畫完的，不重演
      p = makePainter(job, owner);
      painters.set(job.id, p);
    }
    p.job = job; p.owner = owner;
    updatePainter(p);
  }
  for (const [id, p] of painters) if (!ids.has(id) && p.phase !== 'leaving') leavePainter(p);
}
function makePainter(job, owner) {
  const fig = (job.kind === 'code' && buildCast('consultant')) || buildFigure('painter:' + job.id, job.kind === 'code' ? 'consultant' : 'codexPainter');
  scene.add(fig.root);
  fig.root.position.copy(spots.door); fig.root.rotation.y = Math.PI / 2;
  const tagDiv = document.createElement('div'); tagDiv.className = 'fig-tag';
  const tag = new CSS2DObject(tagDiv); tag.position.set(0, 55, 0); fig.root.add(tag);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 46, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = 23; fig.root.add(hit);
  const p = { id: 'painter:' + job.id, job, owner, fig, tag, tagDiv, hit, nav: { place: 'door' }, phase: 'waiting', slot: job.kind === 'code' ? -1 : easelSlot(), sketch: null, easel: null, held: null };
  hit.userData.onPick = () => openPainterCard(p);
  extraPicks.push(hit);
  // 走進門一點點，站著等 Codex 起來
  const wait = spots.door.clone().add(new THREE.Vector3(26, 0, -10));
  goTo(p, { name: 'wait', pos: wait, approach: wait, ry: Math.PI / 2 });
  if (owner) owner.phoneUntil = performance.now() + 3500;   // 主角打電話叫外包
  return p;
}
function easelPos(slot) { return new THREE.Vector3(spots.hw * EASEL_X[slot], 0, -spots.hd + 58); }
function updatePainter(p) {
  const j = p.job;
  if (j.kind === 'code') { updateConsultant(p); return; }
  // 開工：Codex 起來了，走去畫架
  if (p.phase === 'waiting' && j.stage !== 'starting') {
    p.phase = 'toEasel';
    const ep = easelPos(p.slot);
    if (!p.easel) {
      p.easel = easel(); p.easel.position.copy(ep); scene.add(p.easel);
      p.sketch = sketchCanvas();
      const c = p.easel.userData.canvas; c.mat.map = p.sketch.tex; c.mat.needsUpdate = true;
    }
    const stand = ep.clone().add(new THREE.Vector3(0, 0, -16));
    goTo(p, { name: 'easel', pos: stand, approach: stand, ry: 0 }, { then: () => { if (p.phase === 'toEasel') p.phase = 'painting'; } });
  }
  // 畫好了：畫布換成真的圖
  if (j.images.length && p.shown !== j.images.at(-1).thumb && p.easel) {
    p.shown = j.images.at(-1).thumb;
    loadTex(p.shown, (t) => { if (!p.easel) return; const c = p.easel.userData.canvas; c.mat.map = t; c.mat.needsUpdate = true; p.picTex = t; });
  }
  // 收工：交件（或失敗攤手）
  if (j.end && !['handing', 'leaving'].includes(p.phase) && !(p.phase === 'toEasel' && !j.images.length && j.stage !== 'failed')) {
    if (j.stage === 'failed' || !j.images.length) { p.phase = 'shrug'; p.until = performance.now() + 1800; }
    else deliverPicture(p);
  }
  renderPainterTag(p);
}
function deliverPicture(p) {
  p.phase = 'handing';
  // 從畫架拿下畫，捧著走去主角桌邊
  if (p.easel && p.picTex) {
    p.easel.userData.canvas.mesh.visible = false;
    p.held = pictureFrame(p.picTex, 18); p.held.position.set(0, 10, 9); p.fig.upper.add(p.held);
  }
  const owner = p.owner && figs.get(p.owner.id);
  const to = owner && owner.fig.root.visible ? seatTarget(owner).approach : spots.door.clone().add(new THREE.Vector3(40, 0, 0));
  goTo(p, { name: 'hand', pos: to, approach: to, ry: 0 }, { then: () => { p.until = performance.now() + 1800; p.phase = 'handed'; } });
}
function leavePainter(p) {
  p.phase = 'leaving';
  if (p.held) { p.held.removeFromParent(); p.held = null; }
  goTo(p, { name: 'gone', pos: spots.door, approach: spots.door, ry: 0 }, { then: () => {
    p.fig.root.removeFromParent(); p.tag.element.remove();
    const i = extraPicks.indexOf(p.hit); if (i >= 0) extraPicks.splice(i, 1);
    if (p.easel) { scene.remove(p.easel); p.easel = null; }
    if (p.guest) { setGuestScreen(p.guest, 'off'); p.guest.taken = null; p.guest = null; }
    painters.delete(p.job.id);
    loadGallery();   // 畫掛上作品牆
  } });
}
// Codex 現在在做什麼（伺服器給 { kind, detail }，跟員工的動作同一套說法）
const doingText = (a) => !a ? '' : typeof a === 'string' ? a : a.kind === 'paint' ? tr('作畫中') : actText(a);
const STAGE_TEXT = { starting: tr('Codex 啟動中…'), started: tr('接案、構思中'), drawing: tr('作畫中'), done: tr('畫好了'), failed: tr('沒畫成') };
// ── 外包顧問（Codex 做生圖以外的事）：坐外包席用筆電工作，頭上顯示 Codex 正在做什麼；做完帶著資料夾去交件
const CODE_STAGE = { starting: tr('Codex 啟動中…'), started: tr('接案'), drawing: tr('工作中'), done: tr('做完了'), failed: tr('沒做成') };
function guestSeat(p) {
  if (p.guest) return p.guest;
  const g = spots.guest.find(x => !x.taken);
  if (g) { g.taken = p.id; p.guest = g; }
  return g;
}
function setGuestScreen(g, kind) {
  if (!g || g.screenKind === kind) return;
  const t = screenTex(kind).clone(); t.wrapT = THREE.RepeatWrapping;
  g.screenMat.map = t; g.screenMat.needsUpdate = true; g.screenKind = kind;
}
function updateConsultant(p) {
  const j = p.job;
  if (p.phase === 'waiting' && j.stage !== 'starting') {
    const g = guestSeat(p);
    p.phase = 'toDesk';
    if (g) goTo(p, { name: 'guestseat', pos: g.pos.clone().setY(SEAT_TOP - 7), approach: g.approach, ry: -Math.PI / 2 }, { then: () => { if (p.phase === 'toDesk') { p.phase = 'working'; setGuestScreen(g, 'term'); } } });
    else p.phase = 'working';   // 外包席坐滿：站在門口做
  }
  if (j.end && !['handing', 'handed', 'leaving', 'shrug'].includes(p.phase)) {
    setGuestScreen(p.guest, 'off');
    if (p.guest) { p.guest.taken = null; p.guest = null; }
    if (j.stage === 'failed' || j.ok === false) { p.phase = 'shrug'; p.until = performance.now() + 1800; }
    else {
      p.phase = 'handing';
      p.held = box(9, 11, 1.6, '#10a37f'); p.held.add(box(7, 9, 1.8, '#f4f4f4', 0.6, 0, 0)); p.held.position.set(0, 9, 9); p.fig.upper.add(p.held);   // 資料夾
      const owner = p.owner && figs.get(p.owner.id);
      const to = owner && owner.fig.root.visible ? seatTarget(owner).approach : spots.door.clone().add(new THREE.Vector3(40, 0, 0));
      goTo(p, { name: 'hand', pos: to, approach: to, ry: 0 }, { then: () => { p.until = performance.now() + 1800; p.phase = 'handed'; } });
    }
  }
  const text = p.phase === 'handing' || p.phase === 'handed' ? tr('交件') : p.phase === 'shrug' ? tr('沒做成') : (j.stage === 'drawing' || j.stage === 'started') && j.doing ? doingText(j.doing) : CODE_STAGE[j.stage] || '';
  const html = (p.phase === 'working' ? `<div class="bubble">${ICON.laptop}</div>` : '') + `<div class="act">${esc(tr('外包顧問：{text}', { text }))}</div>`;
  if (p.tagHtml !== html) { p.tagDiv.innerHTML = html; p.tagHtml = html; }
}
function renderPainterTag(p) {
  const j = p.job;
  const text = p.phase === 'handing' || p.phase === 'handed' ? tr('交件') : p.phase === 'shrug' ? tr('沒畫成') : STAGE_TEXT[j.stage] || '';
  const bubble = p.phase === 'painting' || j.stage === 'drawing' ? `<div class="bubble">${ICON.paint}</div>` : '';
  const html = bubble + `<div class="act">${esc(tr('外包畫師：{text}', { text }))}</div>`;
  if (p.tagHtml !== html) { p.tagDiv.innerHTML = html; p.tagHtml = html; }
}
function animatePainter(p, t, dt) {
  const fig = p.fig, k = t * 1.3;
  if (p.nav.place === 'walk') {
    stepWalk(p, dt);
    if (p.nav.place === 'walk') { walkPose(fig, p.nav); if (p.held) { fig.arms[0].rotation.x = fig.arms[1].rotation.x = -1.4; } return; }
  }
  const now = performance.now();
  for (const leg of fig.legs) leg.rotation.x = 0;
  fig.upper.rotation.x = 0; fig.head.rotation.set(0, 0, 0);
  fig.arms[0].rotation.set(-0.3, 0, -0.08); fig.arms[1].rotation.set(-0.3, 0, 0.08);
  if (p.phase === 'waiting') {   // 看錶、滑手機
    const peek = Math.max(0, Math.sin(k * 0.8)) ** 4;
    fig.arms[0].rotation.x = lerp(-0.3, -1.9, peek); fig.arms[0].rotation.z = lerp(-0.08, 0.5, peek); fig.head.rotation.x = 0.3 * peek;
  } else if (p.phase === 'painting') {   // 右手拿筆在畫布上揮，左手捧調色盤
    fig.arms[1].rotation.x = -1.9 + Math.sin(k * 5) * 0.25; fig.arms[1].rotation.z = 0.15 + Math.sin(k * 3.3) * 0.2;
    fig.arms[0].rotation.x = -1.1; fig.head.rotation.y = Math.sin(k * 0.7) * 0.15;
    if (p.sketch && !p.picTex && now - (p.lastStroke || 0) > 700) { p.lastStroke = now; p.sketch.stroke(); }
  } else if (p.phase === 'working' && p.nav.place === 'guestseat') {   // 外包顧問坐在外包席打字
    for (const leg of fig.legs) leg.rotation.x = -Math.PI / 2;
    fig.arms[0].rotation.x = -1.28 + Math.sin(k * 20) * 0.13; fig.arms[1].rotation.x = -1.28 + Math.sin(k * 20 + Math.PI) * 0.13; fig.head.rotation.x = 0.12;
    const sm = p.guest?.screenMat.map; if (sm) sm.offset.y += dt * 0.5;
  } else if (p.phase === 'handed') {   // 把畫遞出去
    fig.arms[0].rotation.x = fig.arms[1].rotation.x = -1.6; fig.upper.rotation.x = 0.12;
    if (now > p.until) leavePainter(p);
  } else if (p.phase === 'shrug') {   // 攤手
    fig.arms[0].rotation.set(-0.9, 0, -0.9); fig.arms[1].rotation.set(-0.9, 0, 0.9); fig.head.rotation.z = Math.sin(k * 4) * 0.15;
    if (now > p.until) leavePainter(p);
  }
}
function openPainterCard(p) {
  const j = p.job, owner = byId.get(j.sid);
  const min = Math.max(0, Math.round(((j.end || Date.now()) - j.start) / 60000));
  const code = j.kind === 'code';
  quick.innerHTML = `<div class="qk"><div class="qk-head"><b>${tr(code ? '外包顧問' : '外包畫師')} (Codex)</b><button class="p-close" data-close>✕</button></div>`
    + `<div class="qk-q">${esc((code ? CODE_STAGE : STAGE_TEXT)[j.stage] || '')} · ${tr('{n} 分鐘', { n: min })}</div>`
    + (code && j.doing && !j.end ? `<div class="qk-reason">${esc(tr('現在：{doing}', { doing: doingText(j.doing) }))}</div>` : '')
    + quotaHtml()
    + `<div class="qk-reason">${esc(tr('{who} 派的工作', { who: owner?.name || owner?.title || '' }))}</div>`
    + `<pre class="qk-cmd">${esc(j.prompt)}</pre>`
    + (j.images.length ? `<a href="${authUrl(j.images.at(-1).url)}" target="_blank"><img src="${authUrl(j.images.at(-1).thumb)}" style="width:100%;border-radius:10px;margin-top:8px"></a>` : '')
    + (owner ? `<div class="qk-foot"><a href="#" data-owner>${tr('看派工的人')}</a></div>` : '') + `</div>`;
  quick.classList.add('open');
  quick.querySelector('[data-close]').onclick = closeQuick;
  quick.querySelector('[data-owner]')?.addEventListener('click', (e) => { e.preventDefault(); closeQuick(); select(j.sid); });
}

// 作品牆：右牆上一排畫框（Claude 叫 Codex 畫的優先）；點一下看大圖
let galleryGroup = null, galleryItems = [];
async function loadGallery() {
  try { galleryItems = await api('/api/space/gallery'); } catch { return; }
  placeGallery();
}
function placeGallery() {
  if (galleryGroup) { galleryGroup.traverse(o => { const i = extraPicks.indexOf(o); if (i >= 0) extraPicks.splice(i, 1); }); galleryGroup.removeFromParent(); galleryGroup = null; }
  const wallG = walls.find(w => w.n.x < 0)?.group;   // 右牆（內側朝 -x）
  if (!wallG || !galleryItems.length) return;
  galleryGroup = new THREE.Group();
  const n = galleryItems.length, gap = 40, skip = officeLevel >= 4 ? 50 : 0;   // 總部時中間有 logo 牆
  galleryItems.forEach((g, i) => {
    let x = (i - (n - 1) / 2) * gap;
    if (skip) x += x >= 0 ? skip : -skip;
    const frame = pictureFrame(new THREE.Texture(), 30);
    frame.position.set(x, 92, 5.2);
    loadTex(g.thumb, (t) => { const m = frame.userData.pic.material; m.map = t; m.needsUpdate = true; });
    frame.userData.pic.userData.onPick = () => openPicture(g);
    extraPicks.push(frame.userData.pic);
    galleryGroup.add(frame);
  });
  wallG.add(galleryGroup);
}
function openPicture(g) {
  quick.innerHTML = `<div class="qk"><div class="qk-head"><b>${tr('作品牆')}</b><button class="p-close" data-close>✕</button></div>`
    + `<a href="${authUrl(g.url)}" target="_blank"><img src="${authUrl(g.thumb)}" style="width:100%;border-radius:10px"></a>`
    + `<div class="qk-reason" style="margin-top:8px">${esc(g.prompt || tr('Codex 畫的圖'))} · ${new Date(g.at).toLocaleString(LOCALE)}</div></div>`;
  quick.classList.add('open');
  quick.querySelector('[data-close]').onclick = closeQuick;
}

// ── 辦公室活動：慶功宴（獎盃、升級、任務全清）、週五下班派對 ──────────────────
// 休息中與「做完了等你」的人聚到一塊空地，圍著蛋糕歡呼（或跳舞）；45 秒後各自回座。工作中、等回答的人不參加。
let officeEvent = null;
function eventSpot() {
  // 候選幾個位置，選障礙物（家具、桌子）最少的那一塊
  const { hw, hd } = spots, grid = obstacleGrid();
  const cands = [[hw - 120, hd - 60], [0, hd - 45], [-hw * 0.35, -hd + 115], [hw * 0.4, -hd + 115], [0, 0], [-hw * 0.5, 0], [hw * 0.5, 0]];
  let best = null, bestFree = -1;
  for (const [x, z] of cands) {
    let free = 0;
    for (let dx = -48; dx <= 48; dx += 8) for (let dz = -48; dz <= 48; dz += 8) {
      if (dx * dx + dz * dz > 48 * 48) continue;
      const i = Math.floor((x + dx + grid.hw) / grid.cell), j = Math.floor((z + dz + grid.hd) / grid.cell);
      if (i >= 0 && j >= 0 && i < grid.nx && j < grid.nz && !grid.g[j * grid.nx + i]) free++;
    }
    if (free > bestFree) { bestFree = free; best = new THREE.Vector3(x, 0, z); }
  }
  return best;
}
function cakeTable() {
  const g = new THREE.Group();
  g.add(at(roundBrick(9, 1.6, '#f4f4f4'), 0, 16.8, 0), at(roundBrick(1.6, 16, '#a0a5a9'), 0, 8, 0), at(roundBrick(5, 1, '#a0a5a9'), 0, 0.5, 0));
  g.add(at(roundBrick(6, 4, '#f9e0c0'), 0, 19.6, 0), at(roundBrick(6.2, 1, '#e4adc8'), 0, 21.6, 0), at(roundBrick(4, 3, '#f9e0c0'), 0, 23.6, 0), at(roundBrick(4.2, 0.8, '#c91a09'), 0, 25.2, 0));
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    g.add(at(roundBrick(0.35, 2.4, ['#0055bf', '#f2cd37', '#237841', '#c91a09', '#923978'][i], 6), Math.sin(a) * 2.6, 26.8, Math.cos(a) * 2.6));
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffcc55' })); fl.scale.y = 1.6; fl.position.set(Math.sin(a) * 2.6, 28.5, Math.cos(a) * 2.6); g.add(fl);
  }
  return g;
}
function startEvent(kind, title) {
  if (officeEvent || replay || !navReady || !spots.door) return;
  const who = [...figs.values()].filter(f => (f.data.status === 'resting' || isDone(f.data.status)) && !f.enter && f.fig.root.visible
    && !['home', 'walk'].includes(f.nav.place) && f.nav.target?.name !== 'home').slice(0, 12);
  if (who.length < 2) return;
  const c = eventSpot();
  const props = new THREE.Group(); props.position.copy(c); scene.add(props);
  if (kind !== 'party') props.add(cakeTable());
  officeEvent = { kind, center: c, until: performance.now() + 45000, members: who, props, confetti: confetti(c) };
  sfx.party();
  toast(title);
  who.forEach((f, i) => {
    const a = i / who.length * Math.PI * 2, r = (kind === 'party' ? 36 : 30) + (i % 2) * 14;
    const pos = c.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
    freeSlot(f); f.deskMode = null; f.event = true; applyState(f);
    goTo(f, { name: 'event', pos, approach: pos, ry: Math.atan2(c.x - pos.x, c.z - pos.z) }, { run: true });
  });
}
function confetti(c) {
  const group = new THREE.Group(), items = [], cols = ['#c91a09', '#f2cd37', '#0055bf', '#237841', '#fe8a18', '#e4adc8', '#ffffff'];
  for (let i = 0; i < (MOBILE ? 70 : 160); i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
    m.position.set(c.x + (Math.random() - 0.5) * 120, 90 + Math.random() * 70, c.z + (Math.random() - 0.5) * 120);
    group.add(m); items.push({ m, vy: -12 - Math.random() * 14, spin: (Math.random() - 0.5) * 10, sway: Math.random() * 6 });
  }
  scene.add(group);
  return { group, items };
}
function stepEvent(dt) {
  const ev = officeEvent;
  if (ev.confetti) {
    for (const it of ev.confetti.items) {
      it.m.position.y = Math.max(0.5, it.m.position.y + it.vy * dt);
      if (it.m.position.y > 0.5) { it.m.position.x += Math.sin(it.sway + it.m.position.y * 0.1) * dt * 8; it.m.rotation.x += it.spin * dt; it.m.rotation.y += it.spin * 0.7 * dt; }
      else it.m.rotation.set(-Math.PI / 2, 0, it.sway);   // 落地躺平
    }
  }
  if (performance.now() < ev.until) return;
  for (const f of ev.members) {
    if (!f.event) continue;
    f.event = false; f.fig.root.rotation.z = 0; applyState(f);
    if (figs.has(f.id) && ['event', 'walk'].includes(f.nav.place)) goTo(f, seatTarget(f));
  }
  scene.remove(ev.props);
  if (ev.confetti) scene.remove(ev.confetti.group);
  officeEvent = null;
}
// 週五 17:00～18:30 下班派對：一天一次（網址帶 ?party=1 馬上開一場看看）
function checkFriday() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60, key = 'space_party_' + d.toDateString();
  if (d.getDay() === 5 && h >= 17 && h < 18.5 && !localStorage.getItem(key) && !offNow()) {
    localStorage.setItem(key, '1');
    startEvent('party', tr('週五下班前，休息區開派對！'));
  }
}
// 測試：?barista=1 鏡頭看咖啡吧，每 15 秒叫一個在座位上的人去吧台讓咖啡師做一杯
if (new URLSearchParams(location.search).get('barista')) setTimeout(() => {
  goPlace('pantry');
  const send = () => { const f = [...figs.values()].find(x => x.nav.place === 'seat'); if (f && spots.coffee[0]?.bar) goCoffee(f, spots.coffee[0]); };
  send(); setInterval(send, 15000);
}, 6000);
if (new URLSearchParams(location.search).get('party')) setTimeout(() => startEvent(new URLSearchParams(location.search).get('party') === 'cake' ? 'celebrate' : 'party', '測試：辦公室活動'), 12000);

// ── 在場景裡直接回答 ──────────────────────────────────────────────────────────
// 點頭上的驚嘆號（或面板、計數）跳出小卡：選擇題就選、權限就准或拒，送到同一支 /respond
const quick = document.getElementById('quick');
let quickFor = null;
function closeQuick() { quick.classList.remove('open'); quickFor = null; }
quick.addEventListener('click', (e) => { if (e.target === quick) closeQuick(); });
function openQuick(id) {
  if (!host.answer) return;
  const d = byId.get(id);
  const a = d?.ask;
  if (!a?.requestId) { toast(tr('它已經不在等了')); return; }
  quickFor = id;
  const f = figs.get(id);
  const who = esc(d.name || d.title || '');
  let h = `<div class="qk"><div class="qk-head"><span class="p-swatch" style="background:${f?.fig.torsoColor || '#c9d1d9'};width:22px;height:22px"></span>`
    + `<b>${who}</b><button class="p-close" data-close>✕</button></div>`;
  if (a.questions) {
    a.questions.forEach((q, qi) => {
      h += `<div class="qk-q">${esc(q.question)}${q.multiSelect ? tr('（可複選）') : ''}</div>`;
      (q.options || []).forEach((o, oi) => {
        h += `<button class="qk-opt" data-q="${qi}" data-o="${oi}"><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`;
      });
      h += `<input class="qk-other" data-q="${qi}" placeholder="${tr('都不是，自己輸入…')}">`;
    });
    h += `<div class="qk-act"><button class="btn" data-send>${tr('送出')}</button><button class="buy ghost" data-skip>${tr('略過')}</button></div>`;
  } else {
    h += `<div class="qk-q">${tr('想用 {tool}', { tool: `<b>${esc(a.tool)}</b>` })}</div>`;
    if (a.reason) h += `<div class="qk-reason">${esc(a.reason)}</div>`;
    h += `<pre class="qk-cmd">${esc(a.preview)}</pre>`;
    h += `<div class="qk-act"><button class="btn" data-allow>${tr('允許一次')}</button>`
      + (a.suggestions ? `<button class="buy ghost" data-always title="${tr('記到這個專案的設定，之後不再問')}">${tr('總是允許')}</button>` : '')
      + `<button class="buy" style="background:var(--red)" data-deny>${tr('拒絕')}</button></div>`;
  }
  h += `<div class="qk-foot"><a href="#" data-chat>${tr('到對話裡看完整內容')}</a></div></div>`;
  quick.innerHTML = h;
  quick.classList.add('open');
  const picks = (a.questions || []).map(() => new Set());
  quick.querySelector('[data-close]').onclick = closeQuick;
  quick.querySelector('[data-chat]').onclick = (e) => { e.preventDefault(); closeQuick(); select(id, 'chat'); };
  quick.querySelectorAll('.qk-opt').forEach(b => b.onclick = () => {
    const qi = +b.dataset.q, q = a.questions[qi], label = q.options[+b.dataset.o].label;
    if (q.multiSelect) { picks[qi].has(label) ? picks[qi].delete(label) : picks[qi].add(label); b.classList.toggle('on'); }
    else { picks[qi].clear(); picks[qi].add(label); quick.querySelectorAll(`.qk-opt[data-q="${qi}"]`).forEach(x => x.classList.toggle('on', x === b)); }
  });
  const send = (payload, done) => respond(id, a, payload, done);
  quick.querySelector('[data-send]')?.addEventListener('click', () => {
    const answers = {};
    a.questions.forEach((q, qi) => {
      const typed = quick.querySelector(`.qk-other[data-q="${qi}"]`).value.trim();
      const val = typed || [...picks[qi]].join('、');
      if (val) answers[q.question] = val;
    });
    if (!Object.keys(answers).length) { toast(tr('先選一個，或自己輸入')); return; }
    send({ behavior: 'allow', updatedInput: { questions: a.questions, answers } }, tr('已回答'));
  });
  quick.querySelector('[data-skip]')?.addEventListener('click', () => send({ behavior: 'deny', message: 'User dismissed the question.' }, tr('已略過')));
  quick.querySelector('[data-allow]')?.addEventListener('click', () => send({ behavior: 'allow' }, tr('已允許')));
  quick.querySelector('[data-always]')?.addEventListener('click', () => send({ behavior: 'allow', updatedPermissions: a.suggestions.map(sg => ({ ...sg, destination: 'localSettings' })) }, tr('已允許，之後不再問')));
  quick.querySelector('[data-deny]')?.addEventListener('click', () => send({ behavior: 'deny', message: 'User denied this request.' }, tr('已拒絕')));
}
async function respond(id, a, payload, done) {
  try {
    const r = await host.answer(a, payload);
    toast(r.ok ? done : r.msg);
    closeQuick();
  } catch { toast(tr('連線失敗')); }
}

// ── 主迴圈 ────────────────────────────────────────────────────────────────────
let lastT = performance.now(), t = 0;
// 省電：不用跟著螢幕每秒畫 60／120 次。有人在操作、鏡頭在滑、有特效時 30fps；
// 閒著時 12fps——小人本來就一秒動 12 格，畫多了也是同一張
let pokedAt = 0;
const poke = () => { pokedAt = performance.now(); };
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(ev, poke, { passive: true });
controls.addEventListener('change', poke);   // 拖完的慣性、跟拍時鏡頭在動
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const lively = STREAM || fly || pov || rain || fireworks || puffs.length || officeEvent || replay || mascot || now - pokedAt < 2000;
  if (now - lastT < (lively ? 1000 / 30 : 1000 / 12) - 2) return;   // 減 2ms：rAF 時間有抖動，不然會多等一幀
  const dt = Math.min((now - lastT) / 1000, 0.1);
  const realDt = Math.min((now - lastT) / 1000, 1);   // 回放用真實時間推進（dt 每幀最多 0.1 秒，幀數低時會變慢）
  lastT = now;
  if (document.hidden) return;
  t += dt;
  for (const isl of islands.values()) if (isl.target) isl.group.position.lerp(isl.target, 1 - Math.pow(0.001, dt));
  // 小人用一秒 12 格的節奏動（定格動畫感），鏡頭照常滑順
  const step = Math.floor(t * 12);
  if (step !== loop.step) {
    renderer.shadowMap.needsUpdate = true;
    const sdt = loop.step == null ? dt : (step - loop.step) / 12;
    loop.step = step;
    for (const f of figs.values()) {
      animateFig(f, step / 12, Math.min(sdt, 0.25));
      for (const h of f.helpers?.values() || []) animateHelper(h, step / 12, Math.min(sdt, 0.25));
    }
    for (const c of deliveries.values()) animateCourier(c, step / 12, Math.min(sdt, 0.25));
    for (const b of bosses) animateBoss(b, step / 12, Math.min(sdt, 0.25));
    for (const c of cats) animateCat(c, step / 12, Math.min(sdt, 0.25));
    for (const p of painters.values()) animatePainter(p, step / 12, Math.min(sdt, 0.25));
  }
  updateWalls();
  // 定期工作用實際經過的秒數排（不靠格數取餘數：幀數低時格數會一次跳好幾格，容易漏掉）
  // 用真實時間（t 是動畫時鐘，每幀最多走 0.1 秒，幀數低時會比真實時間慢很多）
  const every = (key, sec, fn) => { const w = now / 1000; if (w - (loop[key] ?? -1e9) >= sec) { loop[key] = w; fn(); } };
  every('clockAt', 10, drawClock);
  if (rain) stepRain(dt);
  for (const set of Object.values(quotaSets)) if (set.visible) set.userData.tick(dt);
  if (mascot) stepMascot(dt);
  every('leisureAt', 1, leisureTick);
  every('shiftAt', 2, shiftTick);
  every('stuckAt', 5, () => { stuckTick(); syncDuck(); });
  every('fridayAt', 60, checkFriday);
  if (officeEvent) stepEvent(dt);
  every('dayAt', 30, applyDaylight);
  every('weatherAt', 600, loadWeather);
  stepWeather(dt);
  if (replay) stepReplay(realDt);
  if (soundOn() && step !== loop.keyStep) {   // 鏡頭附近有人在打字：一格一下鍵盤聲
    loop.keyStep = step;
    const typers = [...figs.values()].filter(f => f.nav.place === 'seat' && (['edit', 'bash', 'tool', 'talk', 'web'].includes(f.data.act?.kind) && ['working', 'external'].includes(f.data.status) || f.deskMode === 'deskgame') && near(figWorldPos(f), 320));
    if (typers.length && Math.random() < Math.min(0.9, 0.35 + typers.length * 0.12)) sfx.key(0.03 + Math.min(typers.length, 4) * 0.01);
  }
  if (pingBall) {
    const pp = spots.leisure.filter(x => x.kind === 'pingpong');
    const rally = pp.length === 2 && pp.every(x => x.taken && figs.get(x.taken)?.nav.place === 'leisure');
    const q = (t * 3.2 / Math.PI) % 2, s = q < 1 ? q : 2 - q;   // 0→1→0 來回
    const side = q < 1 ? 0 : 1;
    if (rally && side !== loop.pingSide && near(pingBall.getWorldPosition(new THREE.Vector3()))) sfx.ping();
    loop.pingSide = side;
    pingBall.position.x = rally ? lerp(-12, 52, s) : 20;
    pingBall.position.y = rally ? 24.6 + Math.sin(s * Math.PI) * 9 : 24.6;
  }
  if (puffs.length) stepPuffs(dt);
  if (fireworks) stepFireworks(dt);
  for (const n of npcs) n(t);
  if (statsBoard) every('statsAt', 3, drawStats);
  const sel = selectedId && figs.get(selectedId);
  ring.visible = !!sel;
  if (sel) {
    const p = figWorldPos(sel);
    ring.position.set(p.x, 3.6, p.z);
    ring.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
  }
  if (pov) stepPov(dt);
  else if (followCat && !fly) {
    if (cats.includes(followCat)) {
      const want = followCat.fig.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 8, 0));
      const d = want.sub(controls.target).multiplyScalar(1 - Math.pow(0.02, dt));
      controls.target.add(d); camera.position.add(d);
    } else followCat = null;
  }
  else if (followId && !fly) {
    // 跟拍：鏡頭跟目標一起平移，相對角度不變，使用者照樣可以旋轉縮放
    const f = figs.get(followId);
    if (f) {
      const want = figWorldPos(f).add(new THREE.Vector3(0, 22, 0));
      const d = want.sub(controls.target).multiplyScalar(1 - Math.pow(0.02, dt));
      controls.target.add(d); camera.position.add(d);
    } else setFollow(null);
  }
  if (fly && !pov) {
    // 直播：慢慢滑過去（約 3 秒，頭尾都緩），不要一下子甩鏡頭
    fly.t = Math.min(1, fly.t + dt * (STREAM ? 0.33 : 1.6));
    const e = STREAM ? 0.5 - 0.5 * Math.cos(Math.PI * fly.t) : 1 - Math.pow(1 - fly.t, 3);
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    camera.position.lerpVectors(fly.fromP, fly.toP, e);
    if (fly.t >= 1) fly = null;
  }
  if (!pov) controls.update();
  // 面板打開時，畫面中心往沒被蓋住的地方移
  const open = panel.classList.contains('open');
  const drawerOpen = open || !!document.querySelector('.drawer.open');
  if (drawerOpen !== document.body.classList.contains('drawer-open') || (step % 12 === 0 && step !== loop.hudStep)) {   // 額度等按鈕內容會變：每秒量一次
    loop.hudStep = step;
    document.body.classList.toggle('drawer-open', drawerOpen);
    fitHud();
  }
  const mobile = innerWidth <= 760;
  const pw = open && !mobile ? panel.offsetWidth : 0;
  const ph = open && mobile ? panel.offsetHeight : 0;
  if (pw || ph) camera.setViewOffset(innerWidth, innerHeight, pw / 2, ph / 2, innerWidth, innerHeight);
  else camera.clearViewOffset();
  // 對焦在畫面中心看的那一點：選人時是那個人，平常是整個場地
  const fd = camera.position.distanceTo(controls.target);
  bokeh.uniforms.focus.value = fd;
  bokeh.uniforms.aperture.value = (MOBILE ? 0.000035 : 0.00005) * Math.min(1, fd / 600);
  grade.uniforms.time.value = step % 97;
  composer.render();
  labelRenderer.render(scene, camera);
}

window.__figs = figs; window.__select = (id, tab) => select(id, tab); window.__painters = painters; window.__codex = (jobs) => { codexJobs = jobs; syncPainters(); }; window.__spawnMascot = spawnMascot; window.__dbg = { goTo, goPlace, startHop,  bosses, startEvent, brickRain, setLook, drawClock, applyDaylight, fitAll, lights: { ceiling, hemi, sun }, deliveries, cats, spots, flyTo, controls, camera, THREE, renderer, scene, pov: setPov, povClear: povClearance,
  // 測試用：把某人直接放到某種休閒點（不等排程）
  pick: (x, y) => { const h = pickWorld({ clientX: x, clientY: y }); return h && { name: h.object.name, type: h.object.type, point: h.point.toArray().map(Math.round), where: (w => w && (w.place?.name || w.island?.cwd))(whereIs(h.point)) }; },
  leisure(id, kind) { const f = figs.get(id), sl = spots.leisure.find(x => x.kind === kind && !x.taken); if (!f || !sl) return false; freeSlot(f); sl.taken = f.id; placeAt(f, leisureTarget(sl)); f.nav.kind = kind; applyState(f); return true; } };   // 除錯用
// V：戴上綁頭鏡頭（選了人就是那個人，沒選就輪流戴到每隻貓身上），再按一次換下一隻，最後回到平常的鏡頭
addEventListener('keydown', (e) => {
  if (e.key !== 'v' || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
  if (!pov) { if (!setPov(selectedId || 0)) toast(tr('先選一個人')); return; }
  const i = pov.kind === 'cat' ? cats.indexOf(pov.o) + 1 : 0;
  if (!setPov(i < cats.length ? i : null)) setPov(null);
});
// 手機沒有 V 鍵：面板上的「他的視角」、戴上之後畫面上方的「離開視角」
const povBtn = document.getElementById('p-pov');
povBtn.innerHTML = CAM_ICON.pov;
povBtn.onclick = () => { const id = selectedId; if (id && setPov(id)) closePanel(); };
const povExit = document.getElementById('pov-exit');
povExit.innerHTML = CAM_ICON.pov + `<span>${tr('離開視角')}</span>`;
povExit.onclick = () => setPov(null);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && pov && !e.target.closest?.('input, textarea, [contenteditable]')) setPov(null); });
// 外掛：宿主帶來的額外功能（claude-web 的經營系統）。核心給它們一組受控的接口
const pluginCtx = {
  api, post, esc, ago, ICON, sfx, toast, OUTFITS, NPC_OUTFITS, EQUIP0,
  projName: (cwd) => projName(cwd, workRoot),
  outfitFor, outfitAuto: (cwd) => outfitFor.auto(cwd),
  setLook, celebrate: (title) => startEvent('celebrate', title),
  departments: () => islandOrder.filter(c => c !== '?'),
  selectedCwd: () => (selectedId && figs.get(selectedId)?.cwdKey) || null,
  focusDept: (cwd) => { const isl = islands.get(cwd); if (isl) focusIsland(isl); },
  // 選某個人（id＝對話編號）：鏡頭跟過去、打開他的面板；辦公室裡沒有這個人回 false
  focusPerson: (id) => { if (!figs.has(id)) return false; select(id); return true; },
  // 飛到某個區域（office(ctx).place 登記的也算）；找不到回 false
  flyToPlace: goPlace,
  // 叫某人（id＝對話編號）去別處做事：{ pos: [x, y, z], approach: [x, z], ry }，有事（working）時就待在那，不回座位。
  // 只該對應真的在發生的事（例如他正在跑的渲染）；事情結束要 leave(id)。辦公室裡沒有這個人回 false
  visit: (id, { pos, approach, ry = 0 }) => {
    const f = figs.get(id); if (!f) return false;
    const tg = { name: 'visit', pos: new THREE.Vector3(...pos), approach: new THREE.Vector3(approach[0], 0, approach[1]), ry };
    const there = f.visit && f.visit.pos.distanceTo(tg.pos) < 1 && (f.nav.place === 'visit' || f.nav.target?.name === 'visit');
    f.visit = tg;
    if (navReady && !there && ACTIVE.has(f.data.status) && !f.enter && f.nav.place !== 'home') { endReport(f, false); goTo(f, tg); }
    return true;
  },
  leave: (id) => {
    const f = figs.get(id); if (!f?.visit) return;
    f.visit = null;
    if (f.nav.place === 'visit' || f.nav.target?.name === 'visit') goTo(f, seatTarget(f));
  },
  closePanel: () => { if (panel.classList.contains('open')) closePanel(); },
};
Promise.all(plugins.map(pl => pl.init?.(pluginCtx)?.catch?.(e => console.error('[外掛]', pl.name, e))))
  .then(() => { if (!shown.fac) setLook(look, { animate: false }); })   // 沒有外掛設定長相：用預設的辦公室
  .then(refresh).then(() => { connectEvents(); loop(); loadGallery(); loadCodex(); loadClaudeQuota(); loadGrokQuota(); });
setInterval(refresh, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
