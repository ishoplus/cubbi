// ── cubbi service：開機自動啟動、當掉自動重啟、安全重啟 ─────────────────────────────
//
//   cubbi service install     Mac 產生 ~/Library/LaunchAgents/<label>.plist（launchd 的 KeepAlive 拉起），
//                             Linux 產生 ~/.config/systemd/user/<label>.service（Restart=always）
//   cubbi service restart     安全重啟：語法檢查 → 備用埠試跑 → 等閒置 → 收工讓系統拉起新版 → 確認起來了
//   cubbi service status      有沒有在跑、pid、版本、port、對外網址
//   cubbi service logs [-f]   看紀錄
//   cubbi service uninstall   移除開機啟動
// node 在哪、程式在哪、port 都在 install 當下偵測，寫進 ~/.cubbi/service.json，不寫死任何人的資料。
// 用 npx 跑的時候程式在 npx 的暫存區（隨時會被清掉），開機啟動不能指到那裡：要先 npm i -g cubbi。
import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { CUBBI_HOME, DATA_DIR } from '../paths.js';
import { t, CLI_LANG } from '../i18n.js';

// 全域安裝要裝哪一版：試用版（0.4.0-beta.1 這種）要指名，不然會裝到正式版
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch { return ''; } })();
export const INSTALL_PKG = VERSION.includes('-') ? `cubbi@${VERSION}` : 'cubbi';

const L = (s, v) => t(CLI_LANG(), s, v);

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const META_FILE = join(CUBBI_HOME, 'service.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const isEphemeral = (p) => /[\\/]_npx[\\/]/.test(p);   // npx 的暫存區

// 服務設定檔的內容（Mac：plist；Linux：systemd user unit）
export function serviceFile({ platform = process.platform, label, node, entry, args = [], cwd, env = {}, logFile }) {
  if (platform === 'darwin') {
    return {
      path: join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${[node, entry, ...args].map(a => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`,
    };
  }
  const q = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
  return {
    path: join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', `${label}.service`),
    content: `[Unit]
Description=Cubbi remote（${label}）
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${[node, entry, ...args].map(q).join(' ')}
${Object.entries(env).map(([k, v]) => `Environment=${q(`${k}=${v}`)}`).join('\n')}
Restart=always
RestartSec=5
StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=default.target
`,
  };
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const tryRun = (cmd, args) => { try { return { ok: true, out: run(cmd, args) }; } catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message) }; } };
const uid = () => process.getuid?.() ?? 0;

export function readMeta() { try { return JSON.parse(readFileSync(META_FILE, 'utf8')); } catch { return null; } }

// 預設：這個套件的 bin/cubbi.js remote；宿主（例如 claude-web）用 --entry 指自己的 server.js
export function install({ label = process.env.CUBBI_SERVICE_LABEL || 'com.cubbi.remote', entry, args, cwd, port = process.env.PORT || '17000', extraEnv = {}, log = console } = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error(L('開機啟動目前只支援 Mac（launchd）與 Linux（systemd）'));
  entry = entry ? resolve(entry) : join(PKG, 'bin', 'cubbi.js');
  args = args || (entry.endsWith(join('bin', 'cubbi.js')) ? ['remote'] : []);
  cwd = cwd ? resolve(cwd) : (entry.endsWith(join('bin', 'cubbi.js')) ? CUBBI_HOME : dirname(entry));
  if (isEphemeral(entry)) throw Object.assign(new Error(L('現在是用 npx 暫時跑起來的，開機啟動不能指到 npx 的暫存區（會被清掉）。先執行：npm i -g {pkg}，再執行：cubbi service install', { pkg: INSTALL_PKG })), { code: 'NPX' });
  const node = process.execPath;
  const logDir = join(DATA_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const logFile = join(logDir, 'server.log');
  // 系統服務的環境很乾淨：PATH 要帶（找得到 claude、git），其他只帶 Cubbi 自己的設定
  const env = { PATH: process.env.PATH, HOME: homedir(), PORT: String(port) };
  for (const k of ['CUBBI_HOME', 'CW_DATA_DIR', 'CW_CONFIG', 'CLAUDE_PATH', 'CODEX_PATH', 'LANG', 'CUBBI_LANG']) if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, extraEnv);
  const f = serviceFile({ label, node, entry, args, cwd, env, logFile });
  mkdirSync(dirname(f.path), { recursive: true });
  writeFileSync(f.path, f.content);
  if (process.platform === 'darwin') {
    tryRun('launchctl', ['bootout', `gui/${uid()}/${label}`]);   // 裝過就先卸掉舊的
    run('launchctl', ['bootstrap', `gui/${uid()}`, f.path]);
  } else {
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${label}.service`]);
  }
  const meta = { label, platform: process.platform, node, entry, args, cwd, port: String(port), logFile, file: f.path, env, installedAt: new Date().toISOString() };
  mkdirSync(dirname(META_FILE), { recursive: true });
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  log.log?.(L('已設定開機自動啟動：{path}', { path: f.path }));
  return meta;
}

export function uninstall({ log = console } = {}) {
  const m = readMeta();
  if (!m) throw new Error(L('還沒設定開機啟動（cubbi service install）'));
  if (m.platform === 'darwin') tryRun('launchctl', ['bootout', `gui/${uid()}/${m.label}`]);
  else { tryRun('systemctl', ['--user', 'disable', '--now', `${m.label}.service`]); tryRun('systemctl', ['--user', 'daemon-reload']); }
  rmSync(m.file, { force: true });
  rmSync(META_FILE, { force: true });
  log.log?.(L('已移除開機啟動（{label}）', { label: m.label }));
}

function processState(m) {
  if (m.platform === 'darwin') {
    const r = tryRun('launchctl', ['print', `gui/${uid()}/${m.label}`]);
    if (!r.ok) return { loaded: false, running: false, pid: null };
    const pid = Number(/\bpid = (\d+)/.exec(r.out)?.[1]) || null;
    return { loaded: true, running: /state = running/.test(r.out), pid };
  }
  const r = tryRun('systemctl', ['--user', 'show', `${m.label}.service`, '-p', 'ActiveState', '-p', 'MainPID']);
  const pid = Number(/MainPID=(\d+)/.exec(r.out)?.[1]) || null;
  return { loaded: r.ok, running: /ActiveState=active/.test(r.out), pid: pid || null };
}

// 萬用密碼：以服務實際讀的那份 .env 為準（服務的環境很乾淨，不會吃到終端機裡設的 ACCESS_TOKEN）
export function serviceToken(m = readMeta()) {
  for (const f of [m?.cwd && join(m.cwd, '.env'), join(CUBBI_HOME, '.env')].filter(Boolean)) {
    try { const v = /^ACCESS_TOKEN=(.*)$/m.exec(readFileSync(f, 'utf8'))?.[1]?.trim(); if (v) return v; } catch {}
  }
  return process.env.ACCESS_TOKEN || '';
}
const token = () => serviceToken();
async function api(port, path, { method = 'GET', tok = token(), timeout = 5000 } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-access-token': tok }, signal: AbortSignal.timeout(timeout) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function healthy(port, tok = token(), ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await api(port, '/api/info', { tok }); if (r.status === 200) return r.body; } catch {}
    await sleep(500);
  }
  return null;
}

export async function status() {
  const m = readMeta();
  if (!m) return { installed: false };
  const st = processState(m);
  let info = null;
  try { const r = await api(m.port, '/api/info'); if (r.status === 200) info = r.body; } catch {}
  return { installed: true, label: m.label, ...st, port: m.port, version: info?.version || null, publicUrl: info?.publicUrl || '', reachable: !!info, logFile: m.logFile, file: m.file };
}

export function logs({ lines = 80, follow = false } = {}) {
  const m = readMeta();
  const file = m?.logFile || join(DATA_DIR, 'logs', 'server.log');
  if (!existsSync(file)) throw new Error(L('還沒有紀錄：{file}', { file }));
  if (follow) return spawn('tail', ['-n', String(lines), '-f', file], { stdio: 'inherit' });
  const all = readFileSync(file, 'utf8').split('\n');
  return all.slice(-lines - 1).join('\n');
}

// 語法檢查：這個套件的 remote、server（測試除外）＋宿主的入口
function syntaxCheck(entry) {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'tests' || n === 'node_modules' || n === 'public') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(n)) files.push(p); } };
  walk(join(PKG, 'remote')); walk(join(PKG, 'server'));
  files.push(entry);
  for (const f of files) {
    const r = tryRun(process.execPath, ['--check', f]);
    if (!r.ok) throw new Error(L('語法錯誤：{file}', { file: f }) + `\n${r.err.slice(0, 400)}`);
  }
  return files.length;
}

// 安全重啟。有了 shim，對話不怕重啟；要等的只有任務系統跑到一半的東西（/api/admin/idle）
export async function restart({ force = false, maxWaitMs = 30 * 60000, probePort = Number(process.env.CUBBI_PROBE_PORT || 17097), log = console } = {}) {
  const m = readMeta();
  if (!m) throw new Error(L('還沒設定開機啟動（cubbi service install）；沒有的話直接關掉再開就好'));
  log.log?.(L('1/4 語法檢查：{n} 個檔', { n: syntaxCheck(m.entry) }));
  // 備用埠試跑：資料用暫存的（不碰正式的登入、帳本、對話），不開通道
  const tmp = mkdtempSync(join(tmpdir(), 'cubbi-probe-'));
  const probeTok = 'probe-' + Math.random().toString(36).slice(2);
  const probe = spawn(m.node, [m.entry, ...m.args], { cwd: m.cwd, stdio: 'ignore',
    env: { ...process.env, ...m.env, PORT: String(probePort), CW_DATA_DIR: tmp, AGENT_DIR: join(tmp, 'agents'), TASK_DATA_DIR: tmp, CW_CONFIG: join(tmp, 'config.json'),
      ACCESS_TOKEN: probeTok, TUNNEL: 'none', PUSH_URL: '', AUTH_CHECK: 'status', SETUP_DONE: '1' } });
  const ok = await healthy(probePort, probeTok, 40000);
  probe.kill('SIGTERM'); await sleep(500); try { probe.kill('SIGKILL'); } catch {}
  rmSync(tmp, { recursive: true, force: true });
  if (!ok) throw new Error(L('新版在備用埠 {port} 起不來，正式版沒動。看紀錄：cubbi service logs', { port: probePort }));
  log.log?.(L('2/4 備用埠 {port} 試跑成功（{version}）', { port: probePort, version: ok.version }));
  const before = processState(m);
  if (!before.running) {
    if (m.platform === 'darwin') tryRun('launchctl', ['kickstart', '-k', `gui/${uid()}/${m.label}`]);
    else tryRun('systemctl', ['--user', 'restart', `${m.label}.service`]);
    const up = await healthy(m.port);
    if (!up) throw new Error(L('啟動不起來，看紀錄：cubbi service logs'));
    log.log?.(L('4/4 原本沒在跑，已經啟動（{version}）', { version: up.version }));
    return up;
  }
  // 等閒置：任務系統有東西在跑就等（最多 maxWaitMs）；--force 不等
  const t0 = Date.now();
  for (;;) {
    let r;
    try { r = await api(m.port, '/api/admin/idle'); } catch { r = null; }
    if (r?.status === 401) throw new Error(L('萬用密碼對不上：服務讀的是 {file} 或 ~/.cubbi/.env 的 ACCESS_TOKEN', { file: join(m.cwd, '.env') }));
    const idle = r?.status === 200 ? r.body : null;
    if (!idle) throw new Error(L('問不到正式版閒不閒（{why}）', { why: r ? 'HTTP ' + r.status : L('連不上') }));
    if (idle.idle || force) break;
    if (Date.now() - t0 > maxWaitMs) throw new Error(L('等太久還在忙，先不重啟：{busy}', { busy: idle.busy.join(L('；')) }));
    log.log?.(L('3/4 等閒置：{busy}', { busy: idle.busy.join(L('；')) }));
    await sleep(15000);
  }
  log.log?.(L('3/4 閒置了，收工讓系統拉起新版'));
  const r = await api(m.port, '/api/admin/shutdown', { method: 'POST' }).catch(() => null);
  if (r && r.status !== 200 && !force) throw new Error(L('正式版不肯收工：{body}', { body: JSON.stringify(r.body) }));
  if (force && r?.status !== 200) {
    if (m.platform === 'darwin') tryRun('launchctl', ['kickstart', '-k', `gui/${uid()}/${m.label}`]);
    else tryRun('systemctl', ['--user', 'restart', `${m.label}.service`]);
  }
  // 等舊的退出、新的起來（pid 換了才算）
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    const now = processState(m);
    if (now.running && now.pid && now.pid !== before.pid) {
      const up = await healthy(m.port, token(), 40000);
      if (up) { log.log?.(L('4/4 新版起來了（pid {pid}，{version}）', { pid: now.pid, version: up.version })); return up; }
    }
    await sleep(500);
  }
  throw new Error(L('新版沒起來，看紀錄：cubbi service logs'));
}
