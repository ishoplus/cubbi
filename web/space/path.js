// 走路的路線：把辦公室切成格子，障礙物（桌椅、家具）外擴半個身寬後標成不能走，
// 8 方向 A* 找路，再用視線檢查把鋸齒拉直。純函式，不依賴 three.js，可以在 Node 測試。

// rects：[{ x, z, w, d }]（中心與寬深）；房間是 [-hw, hw] × [-hd, hd]
export function buildGrid({ hw, hd, rects, cell = 8, pad = 7 }) {
  const nx = Math.ceil(hw * 2 / cell), nz = Math.ceil(hd * 2 / cell);
  const g = new Uint8Array(nx * nz);
  for (const o of rects) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const a = Math.max(0, Math.floor((x0 - pad + hw) / cell)), b = Math.min(nx - 1, Math.floor((x1 + pad + hw) / cell));
    const c = Math.max(0, Math.floor((z0 - pad + hd) / cell)), d = Math.min(nz - 1, Math.floor((z1 + pad + hd) / cell));
    if (a > b || c > d) continue;
    for (let j = c; j <= d; j++) g.fill(1, j * nx + a, j * nx + b + 1);
  }
  return { g, nx, nz, hw, hd, cell };
}

// 回傳路徑上的轉折點 [{ x, z }]（不含起點）；走不到回 null
export function findPath(grid, from, to) {
  const { g, nx, nz, hw, hd, cell } = grid;
  const cellOf = (p) => [Math.min(nx - 1, Math.max(0, Math.floor((p.x + hw) / cell))), Math.min(nz - 1, Math.max(0, Math.floor((p.z + hd) / cell)))];
  // 起點或終點剛好在障礙物裡（例如坐在椅子上）：找最近的空格
  const nearestFree = ([i, j]) => {
    if (!g[j * nx + i]) return [i, j];
    for (let r = 1; r < 10; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < nz && !g[b * nx + a]) return [a, b];
    }
    return [i, j];
  };
  const s = nearestFree(cellOf(from)), e = nearestFree(cellOf(to));
  const si = s[1] * nx + s[0], ei = e[1] * nx + e[0];
  const N = nx * nz, cost = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap = [];
  const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } }
    return top;
  };
  const h = (i) => Math.hypot(i % nx - e[0], ((i / nx) | 0) - e[1]);
  cost[si] = 0; push(h(si), si);
  while (heap.length) {
    const [, cur] = pop();
    if (cur === ei) break;
    if (done[cur]) continue;
    done[cur] = 1;
    const i = cur % nx, j = (cur / nx) | 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || g[b * nx + a]) continue;
      if (di && dj && (g[j * nx + a] || g[b * nx + i])) continue;   // 不切牆角
      const n = b * nx + a, c = cost[cur] + (di && dj ? 1.414 : 1);
      if (c < cost[n]) { cost[n] = c; came[n] = cur; push(c + h(n), n); }
    }
  }
  if (si !== ei && came[ei] < 0) return null;
  const cells = [];
  for (let c = ei; c >= 0; c = c === si ? -1 : came[c]) cells.unshift(c);
  const clear = (a, b) => {
    const ax = a % nx, az = (a / nx) | 0, bx = b % nx, bz = (b / nx) | 0;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    for (let k = 1; k < n; k++) {
      const x = Math.round(ax + (bx - ax) * k / n), z = Math.round(az + (bz - az) * k / n);
      if (g[z * nx + x]) return false;
    }
    return true;
  };
  const out = [];
  for (let k = 0; k < cells.length - 1;) {
    let m = cells.length - 1;
    while (m > k + 1 && !clear(cells[k], cells[m])) m--;
    out.push(cells[m]); k = m;
  }
  return out.map(c => ({ x: (c % nx + 0.5) * cell - hw, z: (((c / nx) | 0) + 0.5) * cell - hd }));
}

// 依權重抽一個：opts = [[值, 權重], …]，rand 給測試換成固定序列
export function pickWeighted(opts, rand = Math.random) {
  let r = rand() * opts.reduce((n, o) => n + o[1], 0);
  for (const [k, w] of opts) if ((r -= w) <= 0) return k;
  return opts[opts.length - 1][0];
}
