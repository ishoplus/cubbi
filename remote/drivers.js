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

export const DRIVERS = ['claude', 'codex'];

export function createDrivers({ config, log = console }) {
  const codex = { ok: false, why: '還沒檢查' };
  function check() {
    if (config.drivers?.codex === false) { Object.assign(codex, { ok: false, why: '設定檔關掉了（drivers.codex: false）' }); return Promise.resolve(); }
    return new Promise((resolve) => execFile(process.env.CODEX_PATH || 'codex', ['login', 'status'], { timeout: 15000 }, (err, stdout, stderr) => {
      const was = codex.ok;
      if (err?.code === 'ENOENT') Object.assign(codex, { ok: false, why: '沒有裝 Codex CLI' });
      else if (err) Object.assign(codex, { ok: false, why: `Codex 沒登入（${(stderr || stdout || err.message).trim().split('\n')[0]}）` });
      else Object.assign(codex, { ok: true, why: '' });
      if (codex.ok !== was) log.log?.(`[代理人] codex ${codex.ok ? '可以用' : '不能用：' + codex.why}`);
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
    status: () => ({ codex: { ...codex } }),
    // 給前端：專案預設（只回能用的），它在開新對話時預先選好
    projectDefaults: () => Object.fromEntries(Object.entries(config.projects || {}).filter(([, v]) => has(v?.driver)).map(([k, v]) => [k.startsWith('/') ? k : basename(k), v.driver])),
  };
}
