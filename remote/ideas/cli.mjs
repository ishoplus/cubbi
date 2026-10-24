// npx cubbi ideas …：提案部的指令（跟辦公室的白板、收件箱是同一份紀錄）
//   run [--dry] [--lens 名稱]    現在提一批（5–15 分鐘，會用到 Claude 額度）；--dry 只印不存
//   verdict <id> <要|不要|改> [備註]
//   start <id> | done <id>       記下開工／做完（從白板按開工會順便派人，這裡只記）
//   list [--pending]             列出歷來提案
//   lenses                       視角，▶ 是今天輪到的
import '../paths.js';
import { config, expandHome } from '../config.js';
import { WORK_ROOT } from '../shared.js';
import { createLab } from './lab.js';

const c = config.ideas;
const lab = createLab({
  ...(c.stateDir ? { stateDir: expandHome(c.stateDir) } : {}),
  roots: (Array.isArray(c.roots) && c.roots.length ? c.roots : [WORK_ROOT]).map(expandHome),
  values: c.values || '', valuesFiles: (c.valuesFiles || []).map(expandHome),
  model: c.model || 'opus', lang: config.space.lang === 'en' ? 'en' : 'zh',
});
const [cmd, ...rest] = process.argv.slice(3);
const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const status = (p) => p.stage === 'done' ? '完成' : p.stage === 'doing' ? '進行中' : p.verdict ? p.verdict.verdict : '—';
try {
  if (cmd === 'run') {
    const { proposals, skipped } = await lab.run({ dry: rest.includes('--dry'), lensName: opt('--lens') });
    for (const p of proposals) console.log(`${p.id}\t［${lab.label(p)}］${p.title}｜${p.hook}`);
    if (skipped) console.log(`少交：${skipped}`);
    console.log(`資料夾：${lab.stateDir}`);
  } else if (cmd === 'verdict') {
    console.log(`已記下：${rest[0]} → ${lab.verdict(rest[0], rest[1], rest.slice(2).join(' '))}`);
  } else if (cmd === 'start' || cmd === 'done') {
    lab.stage(rest[0], cmd === 'start' ? 'doing' : 'done');
    console.log(`${cmd === 'start' ? '已開工' : '已完成'}：${rest[0]}`);
  } else if (cmd === 'list') {
    const ps = lab.history().filter(p => !rest.includes('--pending') || !p.verdict);
    if (!ps.length) console.log('還沒有提案。');
    for (const p of ps) console.log(`${p.id}\t${status(p)}\t［${lab.label(p)}］${p.title}｜${p.hook}`);
  } else if (cmd === 'lenses') {
    const cur = lab.lensOfDay();
    for (const l of lab.lenses) console.log(`${l === cur ? '▶' : ' '} ${l.name}\t${l.hint}`);
  } else {
    console.log('用法：cubbi ideas run [--dry] [--lens 名稱] | verdict <id> <要|不要|改> [備註] | start <id> | done <id> | list [--pending] | lenses');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) { console.error(e.message); process.exit(1); }
process.exit(0);
