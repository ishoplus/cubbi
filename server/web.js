// ── 前端頁面：空間的 HTML、帶版本號的模組、three.js ────────────────────────────
//
// 模組放在帶版本號的路徑（/space-v/<版本>/），改了就換網址，瀏覽器和 CDN 不會拿到舊快取。
// 宿主可以給 overrideDir：同名檔案以宿主的為準（claude-web 用它換掉 host.js、加上 plugins/）。
import express, { Router } from 'express';
import { readFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const THREE = join(dirname(createRequire(import.meta.url).resolve('three')), '..');   // three/build/three.cjs → three/

// 版本號：所有模組（含子目錄）最後修改時間
async function newest(dir) {
  let v = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    v = Math.max(v, e.isDirectory() ? await newest(p) : (await stat(p)).mtimeMs);
  }
  return v;
}

export function spaceWeb({ overrideDir = null, title = 'Cubbi' } = {}) {
  const dirs = [overrideDir, join(WEB, 'space')].filter(Boolean);
  const version = async () => Math.floor(Math.max(...await Promise.all(dirs.map(newest)))).toString(36);
  async function html() {
    const page = await readFile(join(WEB, 'index.html'), 'utf8');
    return page.replaceAll('__SPACE_VER__', await version()).replaceAll('__TITLE__', title);
  }
  const router = Router();
  router.use('/space-v/:ver', ...dirs.map(d => express.static(d, { maxAge: '7d', immutable: true })));
  router.use('/vendor/three', express.static(THREE));
  return { html, router };
}
