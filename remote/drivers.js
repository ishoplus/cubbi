// ── 哪些代理人能用 ──────────────────────────────────────────────────────────────
//
// claude 一定有（沒登入會在 /api/info 的 claudeAuth 顯示）。codex 要三件事都成立才出現在選單：
//   設定沒關（drivers.codex 不是 false）、裝了（CODEX_PATH 或 PATH 上的 codex）、登入了（codex login status 成功）
// 每 10 分鐘重看一次：剛裝好、剛登入的不用重啟伺服器。
//
// 開新對話用哪一家：前端選的 → 專案預設（projects 以完整路徑或資料夾名為鍵）→ drivers.default → claude。
// 接續舊對話一律用原本那一家（server.js 查活著的進程或 shim 的紀錄）。
import { execFile } from 'child_process';
import { basename } from 'path';
import { t, SERVER_LANG } from './i18n.js';

export const DRIVERS = ['claude', 'codex'];

export function createDrivers({ config, log = console }) {
  // why 存中文（紀錄好讀），另外記 key＋vars，status(lang) 給前端時再換語言
  const codex = { ok: false, why: '還沒檢查' };
  let whyKey = { key: '還沒檢查' };
  const setWhy = (ok, key = '', vars) => { whyKey = { key, vars }; Object.assign(codex, { ok, why: key ? t('zh', key, vars) : '' }); };
  function check() {
    if (config.drivers?.codex === false) { setWhy(false, '設定檔關掉了（drivers.codex: false）'); return Promise.resolve(); }
    return new Promise((resolve) => execFile(process.env.CODEX_PATH || 'codex', ['login', 'status'], { timeout: 15000 }, (err, stdout, stderr) => {
      const was = codex.ok;
      if (err?.code === 'ENOENT') setWhy(false, '沒有裝 Codex CLI');
      else if (err) setWhy(false, 'Codex 沒登入（{why}）', { why: (stderr || stdout || err.message).trim().split('\n')[0] });
      else setWhy(true);
      const L = (s, v) => t(SERVER_LANG(), s, v);
      if (codex.ok !== was) log.log?.(codex.ok ? L('[代理人] codex 可以用') : L('[代理人] codex 不能用：{why}', { why: L(whyKey.key, whyKey.vars) }));
      resolve();
    }));
  }
  const ready = check();   // 第一次檢查完成（測試、開機訊息用）
  setInterval(check, 600000).unref();

  const has = (d) => d === 'claude' || (d === 'codex' && codex.ok);
  // 專案預設：完整路徑優先，其次資料夾名（cwd 在專案的子資料夾或 worktree 裡也算）
  function projectDriver(cwd = '') {
    const p = config.projects || {};
    for (const [key, v] of Object.entries(p)) {
      if (!v?.driver) continue;
      if (key.startsWith('/') ? (cwd === key || cwd.startsWith(key + '/')) : cwd.split('/').includes(key)) return v.driver;
    }
    return null;
  }
  function pick({ requested, cwd }) {
    const d = requested || projectDriver(cwd) || config.drivers?.default || 'claude';
    return has(d) ? d : 'claude';
  }
  return {
    ready,
    list: () => DRIVERS.filter(has),
    has, pick, projectDriver,
    status: (lang = 'zh') => ({ codex: { ...codex, why: whyKey.key ? t(lang, whyKey.key, whyKey.vars) : '' } }),   // lang：why 用哪種語言
    // 給前端：專案預設（只回能用的），它在開新對話時預先選好
    projectDefaults: () => Object.fromEntries(Object.entries(config.projects || {}).filter(([, v]) => has(v?.driver)).map(([k, v]) => [k.startsWith('/') ? k : basename(k), v.driver])),
  };
}
