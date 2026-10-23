// ── 成品歷史：每一輪做出來的東西記一行，以前的成品不用回頭讀紀錄檔 ────────────────
//
// 紀錄檔動輒上百 MB，整份重算太貴；成品本來每輪就會判斷一次，判斷到了順手記一行（jsonl，一行約一兩百字）。
// 只記路徑與網址，不複製原檔：檔案後來被改掉就是看到新的、刪了就只剩名字。
// 縮圖才另外存（圖片縮成小張、本機網頁存當下的截圖），原檔改了還留得住當時的樣子。
//   record(sid, d)           記下這一輪（同一輪再算一次就蓋掉）
//   history(sid)             這段對話的成品，新的在前：[{ turn, at, prompt, items: [{ type, name, url?, thumb }] }]
//   item(sid, turn, i)       記錄裡的第 i 樣（給檔案用：只認記錄過的路徑）
//   thumbOf(sid, turn, i)    縮圖檔的路徑，沒有回 null
//   count(sid)               有幾輪
import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'fs';
import { copyFile } from 'fs/promises';
import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { canShoot, screenshot } from './deliverable.js';

const MAX_PER_SESSION = 200;
const THUMB_PX = 480;

export function delivLog({ file, thumbDir = file && join(dirname(file), 'deliv-thumbs') } = {}) {
  let bySid = null;   // sid -> [entry]（舊到新）
  function load() {
    if (bySid) return bySid;
    bySid = new Map();
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch {}
    for (const line of text.split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e?.sid && e.turn && Array.isArray(e.items)) put(e);
    }
    return bySid;
  }
  function put(e) {
    const list = bySid.get(e.sid) || [];
    const i = list.findIndex(x => x.turn === e.turn);
    if (i >= 0) list.splice(i, 1);
    list.push(e);
    if (list.length > MAX_PER_SESSION) list.shift();
    bySid.set(e.sid, list);
  }

  const thumbBase = (sid, turn, i) => join(thumbDir, createHash('sha1').update(`${sid}:${turn}:${i}`).digest('hex').slice(0, 16));
  function thumbOf(sid, turn, i) {
    if (!thumbDir) return null;
    const base = thumbBase(sid, turn, i);
    for (const ext of ['.jpg', '.png']) if (existsSync(base + ext)) return base + ext;
    return null;
  }
  // 縮圖：macOS 用內建 sips 縮成小張 jpg；其他系統圖片不縮（直接看原檔），截圖原樣留一份
  const sips = (src, out) => new Promise((res, rej) => execFile('/usr/bin/sips', ['-Z', String(THUMB_PX), '-s', 'format', 'jpeg', src, '--out', out], (e) => e ? rej(e) : res()));
  async function makeThumb(e, it, i) {
    const base = thumbBase(e.sid, e.turn, i);
    let src = null;
    if (it.type === 'image') src = it.path;
    else if (canShoot(it)) src = await screenshot({ ...it, at: e.at });
    if (!src) return;
    mkdirSync(thumbDir, { recursive: true });
    if (process.platform === 'darwin') await sips(src, base + '.jpg');
    else if (it.type !== 'image') await copyFile(src, base + '.png');
  }

  function record(sid, d) {
    if (!file || !sid || !d?.turn || !d.items?.length) return;
    load();
    const items = d.items.map(({ type, url, path, name }) => ({ type, ...(url ? { url } : { path }), name }));
    const e = { sid, turn: d.turn, at: d.at, prompt: d.prompt || '', items };
    const had = (bySid.get(sid) || []).find(x => x.turn === e.turn);
    if (had && JSON.stringify(had.items) === JSON.stringify(items)) return;
    put(e);
    try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(e) + '\n'); } catch (err) { console.error('[deliv-log]', err.message); }
    if (thumbDir) (async () => {
      for (const [i, it] of items.entries()) {
        if (thumbOf(sid, e.turn, i)) continue;
        try { await makeThumb(e, it, i); } catch {}
      }
    })();
  }

  const fileOk = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  function history(sid) {
    const list = load().get(sid) || [];
    return [...list].reverse().map(e => ({
      turn: e.turn, at: e.at, prompt: e.prompt,
      items: e.items.map((it, i) => ({ type: it.type, name: it.name, ...(it.url ? { url: it.url } : { gone: !fileOk(it.path) }), thumb: !!thumbOf(sid, e.turn, i) })),
    }));
  }
  const item = (sid, turn, i) => (load().get(sid) || []).find(x => x.turn === turn)?.items[i] || null;
  const count = (sid) => (load().get(sid) || []).length;

  return { record, history, item, thumbOf, count };
}
