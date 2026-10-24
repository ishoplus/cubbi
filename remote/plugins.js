// ── 外掛：辦公室多出來的牆與系統 ────────────────────────────────────────────────
//
// 一個外掛是一個模組，export default：
//   { name, available?() → bool, mount(ctx), webDir? }
//     mount(ctx)：掛自己的 API。ctx = { app, requireAuth, broadcast, startWork, statusOf }
//       startWork({ cwd, prompt, isNew }) → sid：開一段沒有前端接著的新對話（辦公室裡多一個人開始做）
//       statusOf(sid) → working｜asking｜idle
//     webDir：辦公室前端的覆蓋資料夾，裡面的 plugins/<name>.js 是前端那一半（介面見 Cubbi 的 web/space/plugins/）
//
// 內建：經營系統（economy）——標準配備，預設開：做出成果換積木、辦公室跟著長大，是用下去的動力。要關得明寫 false。
// 其他外掛寫在設定檔：
//   "pluginModules": ["/abs/path/ideas.js", "./my-plugin.js"]   相對路徑以設定檔的資料夾為準
//   "plugins": { "economy": true, "ideas": "auto" }              true／false／auto（看 available()）；列了沒寫＝auto
import { dirname, resolve, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { economyRouter, initEconomy } from './economy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const economy = {
  name: 'economy',
  mount({ app, requireAuth, broadcast }) {
    app.use('/api/space/economy', requireAuth, economyRouter());
    initEconomy({ onChange: broadcast });
  },
  webDir: join(__dirname, 'public', 'space'),
};

export async function loadPlugins({ config, configFile, log = console }) {
  const out = [{ mod: economy, enabled: config.plugins.economy !== false }];
  for (const p of config.pluginModules || []) {
    const file = resolve(dirname(configFile), p);
    try {
      const mod = (await import(pathToFileURL(file).href)).default;
      if (!mod?.name || typeof mod.mount !== 'function') throw new Error('要 export default { name, mount }');
      const want = config.plugins[mod.name] ?? 'auto';
      const enabled = want === 'auto' ? (mod.available ? !!mod.available() : true) : !!want;
      out.push({ mod, enabled });
    } catch (e) { log.error?.(`[外掛] ${file} 載不進來：${e.message}`); }
  }
  log.log?.(`[外掛] ${out.map(p => `${p.mod.name} ${p.enabled ? '開' : '關'}`).join('、')}`);
  return out.filter(p => p.enabled).map(p => p.mod);
}
