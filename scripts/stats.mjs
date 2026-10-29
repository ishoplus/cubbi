// 曝光數字：npm 上週下載數＋GitHub 近 14 天瀏覽／複製（gh api，要有 repo 的 push 權限才看得到流量）
// 給營收部例會跑（~/.xitto/revenue-dept/metrics.json 的唯讀查詢）：node scripts/stats.mjs
// 每週記一筆到 ~/.cubbi/stats.jsonl（同一週跑幾次都只記第一次），印的時候跟上一週比
import { execFileSync } from 'child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const LOG = process.env.CUBBI_STATS_LOG || join(homedir(), '.cubbi', 'stats.jsonl');
const REPO = 'ishoplus/cubbi', PKG = 'cubbi';

// ISO 週：2026-W44
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const w = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
const gh = (path) => { try { return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };

const npm = await fetch(`https://api.npmjs.org/downloads/point/last-week/${PKG}`).then(r => r.json()).catch(() => null);
const views = gh(`repos/${REPO}/traffic/views`), clones = gh(`repos/${REPO}/traffic/clones`), repo = gh(`repos/${REPO}`);
const now = {
  week: isoWeek(), at: new Date().toISOString(),
  npmWeek: npm?.downloads ?? null,
  views14: views?.count ?? null, viewers14: views?.uniques ?? null,
  clones14: clones?.count ?? null, cloners14: clones?.uniques ?? null,
  stars: repo?.stargazers_count ?? null,
};

let rows = [];
try { rows = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
if (!rows.some(r => r.week === now.week)) { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, JSON.stringify(now) + '\n'); rows.push(now); }
const prev = rows.filter(r => r.week < now.week).pop();
const diff = (k) => (prev && prev[k] != null && now[k] != null ? `（上週 ${prev[k]}）` : '');
const v = (x) => (x == null ? '查不到' : x);

console.log(`npm 上週下載：${v(now.npmWeek)}${diff('npmWeek')}${npm?.start ? `　${npm.start}～${npm.end}` : ''}`);
console.log(`GitHub 近 14 天瀏覽：${v(now.views14)} 次／${v(now.viewers14)} 人${diff('views14')}`);
console.log(`GitHub 近 14 天複製：${v(now.clones14)} 次／${v(now.cloners14)} 人${diff('clones14')}`);
console.log(`GitHub 星星：${v(now.stars)}${diff('stars')}`);
