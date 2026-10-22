// ── 直播模式：把辦公室公開播出去，但不洩漏任何內容 ─────────────────────────────
//
// npx cubbi --stream 4322：同一個 Cubbi 多開一個埠給 OBS 抓畫面。這個埠上的 API 全部過濾：
//   - 字串一律清空，只留畫面要靠它判斷動作的欄位（狀態、動作種類、工具名…）
//   - 專案路徑換成「部門代號」、名牌和標題換成員工代號（同一段對話一直是同一個名字）
//   - 成品、圖片、作品牆整個關掉；不能從這個埠歸檔或改設定
// 採白名單：以後來源多了新欄位，預設就是被清掉，不會不小心播出去。

import { Router } from 'express';
import { readFileSync, writeFileSync } from 'fs';

const ROOT = '/office';
const DEPTS = ['企劃部', '設計部', '研發部', '美術部', '音效部', '測試部', '客服部', '行銷部', '財務部', '法務部', '採購部', '物流部', '公關部', '資訊部', '品管部',
  '人資部', '總務部', '業務部', '數據部', '營運部', '製作部', '編輯部', '攝影部', '動畫部', '策略部', '創新部', '工程部', '國際部', '教育部', '研究部'];
const NAMES = ['小米', '阿豆', '布丁', '麻吉', '小波', '阿福', '湯圓', '嘟嘟', '小丸', '阿Q', '芋圓', '可可', '小虎', '阿寶', '奶茶', '小樂',
  '豆花', '球球', '阿土', '小捲', '米粒', '阿凱', '小葵', '肉包', '小蜜', '阿星', '飯糰', '小橘', '阿吉', '果凍', '小鹿', '阿彬'];

// 照原樣留的字串欄位（值也要長得像代號，不像就清掉）
const KEEP = new Set(['id', 'sid', 'status', 'kind', 'type', 'model', 'permMode', 'agent', 'outfit', 'runId', 'platform', 'lang', 'event', 'floor']);
const TOKEN = /^[\w.:\-[\]]{1,64}$/;

// file：代號對照表存哪（只在本機）。重開之後同一個人、同一個部門還是同一個名字，觀眾才認得
export function streamFilter({ file = null } = {}) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const depts = new Map(Object.entries(saved.depts || {})), names = new Map(Object.entries(saved.names || {}));
  let dirty = null;
  const save = () => { if (file && !dirty) dirty = setTimeout(() => { dirty = null; try { writeFileSync(file, JSON.stringify({ depts: Object.fromEntries(depts), names: Object.fromEntries(names) })); } catch {} }, 1000); };
  const pick = (map, key, pool) => {
    if (!map.has(key)) { const n = map.size; map.set(key, pool[n % pool.length] + (n >= pool.length ? Math.floor(n / pool.length) + 1 : '')); save(); }
    return map.get(key);
  };
  const deptOf = (cwd) => `${ROOT}/${pick(depts, cwd, DEPTS)}`;
  const nameOf = (sid) => pick(names, sid, NAMES);
  const isPath = (s) => typeof s === 'string' && /^(\/|~|[A-Za-z]:\\)/.test(s);

  function clean(v, key, owner) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    // 陣列裡的短小寫字是種類代號（縮時回放的 [時間, 種類]），其他字串照樣清掉
    if (Array.isArray(v)) return v.map(x => (typeof x === 'string' && /^[a-z]{1,12}$/.test(x) ? x : clean(x, key, owner)));
    if (typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[isPath(k) ? deptOf(k) : k] = clean(x, k, v);
      return out;
    }
    const s = String(v);
    if (key === 'cwd') return deptOf(s);
    if (key === 'workRoot') return ROOT;
    if (key === 'name' || key === 'title') { const sid = owner?.sid || owner?.id; return sid ? nameOf(sid) : ''; }
    if (key === 'tool') return /^[A-Za-z]+$/.test(s) ? s : 'tool';   // MCP 工具名會帶服務名（mcp__gmail__…），一律叫 tool
    if (KEEP.has(key) && TOKEN.test(s) && !isPath(s)) return s;
    return '';
  }

  // 掛在 /api/space 前面：擋掉會吐出檔案或寫入的路由，JSON 與 SSE 都過 clean
  const r = Router();
  const BLOCK = /^\/(deliverable\/file|deliverable\/shot|thumb|image)$/;
  r.use((req, res, next) => {
    if (BLOCK.test(req.path)) return res.status(404).end();
    if (req.method !== 'GET') return res.json({ ok: true });   // 歸檔、語言、hook 都不從直播埠進來
    if (req.path === '/gallery') return res.json([]);
    if (req.path === '/deliverable') return res.json(null);
    if (req.path === '/progress') return res.json({ steps: [], todos: null, files: [], live: null });
    const json = res.json.bind(res);
    res.json = (body) => json(clean(body));
    if (req.path === '/events') {
      const write = res.write.bind(res);
      res.write = (chunk, ...rest) => {
        const s = String(chunk);
        if (!s.startsWith('data: ')) return write(chunk, ...rest);
        try { return write(`data: ${JSON.stringify(clean(JSON.parse(s.slice(6))))}\n\n`, ...rest); } catch { return true; }
      };
    }
    next();
  });
  return { router: r, clean };
}
