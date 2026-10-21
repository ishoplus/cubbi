// 實際啟動 npx cubbi（bin/cubbi.js）：假的 Claude Code 紀錄 → 人物出現、頁面與 three.js 拿得到、/info 回報正確
// 三個系統（Windows／Linux／macOS）都跑：GitHub Actions 的 test.yml
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const BIN = fileURLToPath(new URL('../bin/cubbi.js', import.meta.url));
const SID = '99999999-1111-4111-8111-111111111111';

test('啟動、讀到紀錄、頁面和資源都拿得到', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'cubbi-smoke-'));
  const claude = join(home, '.claude'), proj = join(claude, 'projects', 'demo');
  mkdirSync(proj, { recursive: true });
  const cwd = process.platform === 'win32' ? 'C:\\work\\demo-app' : '/work/demo-app';   // 不能放暫存目錄：Cubbi 會把那裡的對話當測試雜訊略過
  const now = new Date().toISOString();
  writeFileSync(join(proj, SID + '.jsonl'),
    JSON.stringify({ type: 'user', cwd, timestamp: now, message: { content: 'fix the login page' } }) + '\n'
    + JSON.stringify({ type: 'assistant', timestamp: now, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }) + '\n');
  const port = 4600 + Math.floor(Math.random() * 300);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, HOME: home, USERPROFILE: home };
  const p = spawn(process.execPath, [BIN, '--port', String(port), '--no-open'], { env });
  t.after(() => p.kill());
  let out = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('沒啟動：' + out)), 15000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('open at')) { clearTimeout(timer); res(); } });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => rej(new Error('提早結束 ' + c + '：' + out)));
  });
  const base = `http://127.0.0.1:${port}`;
  const s = await (await fetch(base + '/api/space/sessions')).json();
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].cwd, cwd);
  assert.equal(s.sessions[0].name, 'fix the login page');
  const info = await (await fetch(base + '/api/space/info')).json();
  assert.equal(info.hasClaude, true);
  assert.equal(info.platform, process.platform);
  const html = await (await fetch(base + '/')).text();
  const ver = /space-v\/([a-z0-9]+)\//.exec(html)[1];
  for (const f of ['main.js', 'host.js', 'figure.js', 'style.css']) assert.equal((await fetch(`${base}/space-v/${ver}/${f}`)).status, 200, f);
  assert.equal((await fetch(base + '/vendor/three/build/three.module.js')).status, 200);
  const g = await (await fetch(base + '/api/space/growth')).json();
  assert.ok('ready' in g);
});
