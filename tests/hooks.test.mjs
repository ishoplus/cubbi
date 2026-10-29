// hooks：安裝／移除只動 Cubbi 自己那幾條；事件變成人物狀態
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installHooks, uninstallHooks, hookSource, hookInstallState, EVENTS } from '../server/hooks.js';

test('安裝：保留用戶原本的 hooks 與設定、先備份、裝兩次不重複；移除後回到原樣', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cubbi-hk-'));
  const settingsFile = join(dir, 'settings.json');
  const mine = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard.sh' }] }] } };
  writeFileSync(settingsFile, JSON.stringify(mine));
  const r = await installHooks({ settingsFile, dataDir: join(dir, 'data') });
  assert.deepEqual(r.added, EVENTS);
  assert.ok(existsSync(r.hook) && existsSync(r.backup));
  await installHooks({ settingsFile, dataDir: join(dir, 'data') });   // 再裝一次
  const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.PreToolUse.length, 2);   // 用戶的＋Cubbi 的，沒有重複
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'my-guard.sh');
  assert.equal(s.hooks.Stop.length, 1);
  const u = await uninstallHooks({ settingsFile });
  assert.deepEqual(u.removed.sort(), [...EVENTS, 'statusLine', '/cubbi'].sort());
  assert.ok(!existsSync(join(dir, 'commands', 'cubbi.md')));
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), mine);
});

test('用戶自己的狀態列與 /cubbi 指令不蓋掉、移除時也不刪', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cubbi-hk-'));
  const settingsFile = join(dir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'my-line.sh' } }));
  const { mkdirSync } = await import('fs'); mkdirSync(join(dir, 'commands')); writeFileSync(join(dir, 'commands', 'cubbi.md'), 'mine');
  const r = await installHooks({ settingsFile, dataDir: join(dir, 'data') });
  assert.equal(r.statusLine, 'kept'); assert.equal(r.command, 'kept');
  await uninstallHooks({ settingsFile });
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).statusLine.command, 'my-line.sh');
  assert.equal(readFileSync(join(dir, 'commands', 'cubbi.md'), 'utf8'), 'mine');
});

test('原本沒有設定檔：照樣裝，不留備份；壞掉的設定檔不動', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cubbi-hk-'));
  const r = await installHooks({ settingsFile: join(dir, 'new', 'settings.json'), dataDir: join(dir, 'data') });
  assert.equal(r.backup, null);
  const bad = join(dir, 'bad.json'); writeFileSync(bad, '{ not json');
  await assert.rejects(installHooks({ settingsFile: bad, dataDir: join(dir, 'data') }));
  assert.equal(readFileSync(bad, 'utf8'), '{ not json');
});

test('事件 → 人物：開工、用工具、舉手、做完（還有背景任務）、結束交回紀錄檔', async () => {
  const src = hookSource(), pushed = [];
  src.subscribe({ push: (s) => pushed.push(s), watching: () => true });
  const sid = '11111111-2222-4333-8444-555555555555', base = { session_id: sid, cwd: '/w/app' };
  const now = async () => (await (async () => { const l = []; for await (const v of src.list()) l.push(v); return l; })())[0];
  src.onEvent({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '修登入頁' });
  let s = await now();
  assert.equal(s.status, 'working'); assert.equal(s.title, '修登入頁'); assert.equal(s.live, true);
  src.onEvent({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  s = await now(); assert.equal(s.act.kind, 'bash'); assert.equal(s.act.detail, 'npm test');
  src.onEvent({ ...base, hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  s = await now(); assert.equal(s.status, 'asking'); assert.equal(s.ask.tool, 'Bash');
  src.onEvent({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  s = await now(); assert.equal(s.status, 'working'); assert.equal(s.ask, null);
  src.onEvent({ ...base, hook_event_name: 'Stop', background_tasks: [{ id: 't1', type: 'local_agent', description: '跑測試' }] });
  s = await now(); assert.equal(s.status, 'background'); assert.equal(s.bg[0].type, 'agent'); assert.equal(s.act.kind, 'done');
  assert.ok(src.has(sid));
  src.onEvent({ ...base, hook_event_name: 'SessionEnd' });
  assert.ok(!src.has(sid));
  assert.equal(pushed.at(-1).live, false);
  src.onEvent({ session_id: '../../etc', hook_event_name: 'UserPromptSubmit' });   // 格式不對的編號不收
  assert.equal((await (async () => { const l = []; for await (const v of src.list()) l.push(v); return l; })()).length, 0);
});

test('hook 程式：SessionStart 交給 Claude 成品格式（Cubbi 沒開也照給），其他事件不印東西', async () => {
  const { spawnSync } = await import('child_process');
  const runner = new URL('../server/hook-runner.mjs', import.meta.url).pathname;
  const env = { ...process.env, CUBBI_HOME: mkdtempSync(join(tmpdir(), 'cubbi-hook-')) };   // 沒有埠號檔＝Cubbi 沒開
  const run = (ev) => spawnSync(process.execPath, [runner], { input: JSON.stringify({ hook_event_name: ev, session_id: 's1' }), env, encoding: 'utf8' });
  const start = run('SessionStart');
  assert.equal(start.status, 0);
  const out = JSON.parse(start.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /absolute file path or full URL/);
  for (const ev of ['UserPromptSubmit', 'Stop']) { const r = run(ev); assert.equal(r.status, 0); assert.equal(r.stdout, ''); }
});

test('外掛（plugin/）：hooks.json 跟手動裝的事件一樣；hook、open 程式是 server/ 的原樣複本；沒有 package.json（裝外掛才不會跑 npm install）', () => {
  const root = new URL('..', import.meta.url).pathname;
  const { hooks } = JSON.parse(readFileSync(join(root, 'plugin/hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks), EVENTS);
  for (const [ev, [g]] of Object.entries(hooks)) {
    assert.equal(g.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hook-runner.mjs" --plugin');
    assert.equal(g.matcher, ev.endsWith('ToolUse') ? '*' : undefined);
  }
  for (const f of ['hook-runner.mjs', 'open-runner.mjs']) assert.equal(readFileSync(join(root, 'plugin', f), 'utf8'), readFileSync(join(root, 'server', f), 'utf8'), `plugin/${f} 要跟 server/${f} 一樣（改了 server 的要複製過去）`);
  assert.ok(!existsSync(join(root, 'plugin/package.json')));
  assert.match(readFileSync(join(root, 'plugin/commands/cubbi.md'), 'utf8'), /node \$\{CLAUDE_PLUGIN_ROOT\}\/open-runner\.mjs/);
  const mk = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(mk.name, 'ishoplus-cubbi');
  assert.equal(mk.plugins[0].source, './plugin');
  assert.equal(mk.plugins[0].name, JSON.parse(readFileSync(join(root, 'plugin/.claude-plugin/plugin.json'), 'utf8')).name);
});

test('外掛的 hook：送到 ~/.cubbi 的埠號；設定檔裡已經有手動裝的就讓開（不送、不印）', async () => {
  const http = await import('http');
  const { execFile } = await import('child_process');
  const runner = new URL('../server/hook-runner.mjs', import.meta.url).pathname;
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('{}'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const home = mkdtempSync(join(tmpdir(), 'cubbi-home-')), conf = mkdtempSync(join(tmpdir(), 'cubbi-conf-'));
  writeFileSync(join(home, 'port'), String(srv.address().port));
  const run = (ev) => new Promise((ok) => {
    const p = execFile(process.execPath, [runner, '--plugin'], { env: { ...process.env, CUBBI_HOME: home, CLAUDE_CONFIG_DIR: conf }, encoding: 'utf8' }, (err, stdout) => ok(stdout));
    p.stdin.end(JSON.stringify({ hook_event_name: ev, session_id: 's1' }));
  });
  writeFileSync(join(conf, 'settings.json'), JSON.stringify({ enabledPlugins: { 'cubbi@ishoplus-cubbi': true } }));
  assert.match(await run('SessionStart'), /additionalContext/);
  assert.deepEqual(got.map(e => e.hook_event_name), ['SessionStart']);
  writeFileSync(join(conf, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/x/.cubbi/cubbi-hook.mjs"' }] }] } }));
  assert.equal(await run('SessionStart'), '');
  await run('Stop');
  assert.equal(got.length, 1);
  srv.close();
});

test('doctor 認得兩種裝法同時存在', async () => {
  const conf = mkdtempSync(join(tmpdir(), 'cubbi-conf-'));
  assert.deepEqual(hookInstallState({ configDir: conf }), { manual: false, plugin: false, both: false });
  await installHooks({ settingsFile: join(conf, 'settings.json'), dataDir: join(conf, 'data') });
  assert.deepEqual(hookInstallState({ configDir: conf }), { manual: true, plugin: false, both: false });
  const s = JSON.parse(readFileSync(join(conf, 'settings.json'), 'utf8'));
  writeFileSync(join(conf, 'settings.json'), JSON.stringify({ ...s, enabledPlugins: { 'cubbi@ishoplus-cubbi': true } }));
  assert.equal(hookInstallState({ configDir: conf }).both, true);
});
