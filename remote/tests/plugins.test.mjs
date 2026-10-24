// 外掛載入：設定檔的 pluginModules（相對設定檔的資料夾）、auto 看 available()、明寫的優先、壞掉的不拖垮伺服器
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadPlugins } from '../plugins.js';

const dir = mkdtempSync(join(tmpdir(), 'cw-plug-'));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, 'data'));
mkdirSync(join(dir, 'ext'));
const mod = (name, available) => `export default { name: '${name}', ${available === undefined ? '' : `available: () => ${available},`} mount() {} };\n`;
writeFileSync(join(dir, 'ext', 'yes.js'), mod('yes', true));
writeFileSync(join(dir, 'ext', 'no.js'), mod('no', false));
writeFileSync(join(dir, 'ext', 'plain.js'), mod('plain'));
writeFileSync(join(dir, 'ext', 'forced.js'), mod('forced', false));
writeFileSync(join(dir, 'ext', 'broken.js'), 'export default { nope: 1 };\n');
const quiet = { log() {}, error() {} };
const cfgFile = join(dir, 'data', 'config.json');

test('相對路徑以設定檔的資料夾為準；auto 看 available()；明寫 true 蓋過；沒 available 就是開', async () => {
  const config = { plugins: { economy: false, forced: true }, pluginModules: ['../ext/yes.js', '../ext/no.js', '../ext/plain.js', '../ext/forced.js'] };
  const names = (await loadPlugins({ config, configFile: cfgFile, log: quiet })).map(p => p.name);
  assert.deepEqual(names, ['yes', 'plain', 'forced']);
});

test('經營系統是內建的，設定 true 才開', async () => {
  const on = await loadPlugins({ config: { plugins: { economy: true }, pluginModules: [] }, configFile: cfgFile, log: quiet });
  assert.deepEqual(on.map(p => p.name), ['economy']);
  const off = await loadPlugins({ config: { plugins: { economy: false }, pluginModules: [] }, configFile: cfgFile, log: quiet });
  assert.deepEqual(off, []);
});

test('寫錯或找不到的外掛：記錯誤、其他照常', async () => {
  const errs = [];
  const config = { plugins: { yes: false }, pluginModules: ['../ext/broken.js', '../ext/missing.js', '../ext/yes.js', '../ext/plain.js'] };
  const names = (await loadPlugins({ config, configFile: cfgFile, log: { log() {}, error: (m) => errs.push(m) } })).map(p => p.name);
  assert.deepEqual(names, ['plain'], '明寫 false 的也不開');
  assert.equal(errs.length, 2);
});
