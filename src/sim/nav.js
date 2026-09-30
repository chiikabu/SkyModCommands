// Flow fields over the world obstacle grid so units can march through parks.
import { TILE } from '../config.js';

const INF = 1e9;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export class FlowField {
  constructor(world) {
    this.world = world;
    this.w = world.ow;
    this.d = world.od;
    this.dist = new Float32Array(this.w * this.d);
    this.blocked = new Uint8Array(this.w * this.d);
    this.dirty = true;
  }
  cellOf(x, z) {
    const i = Math.floor((x - this.world.ox0) / TILE);
    const j = Math.floor((z - this.world.oz0) / TILE);
    return [i, j];
  }
  center(i, j) {
    return [this.world.ox0 + (i + 0.5) * TILE, this.world.oz0 + (j + 0.5) * TILE];
  }
  // goals: array of [i, j]; blockedFn(collider) decides which colliders block.
  build(goals, blockFn) {
    const { w, d, dist, blocked, world } = this;
    blocked.fill(0);
    for (let k = 0; k < w * d; k++) {
      const cs = world.ocells[k];
      if (!cs) continue;
      for (const c of cs) {
        if (blockFn(c)) {
          blocked[k] = 1;
          break;
        }
      }
    }
    dist.fill(INF);
    // Dijkstra-lite with a bucketed queue (costs 1 / 1.414)
    const queue = [];
    for (const [i, j] of goals) {
      if (i < 0 || j < 0 || i >= w || j >= d) continue;
      const k = j * w + i;
      if (blocked[k]) continue;
      dist[k] = 0;
      queue.push(k);
    }
    // simple binary heap
    const heap = new MinHeap();
    for (const k of queue) heap.push(k, 0);
    while (heap.size) {
      const [k, dk] = heap.pop();
      if (dk > dist[k]) continue;
      const i = k % w, j = (k / w) | 0;
      for (const [di, dj, c] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
        const nk = nj * w + ni;
        if (blocked[nk]) continue;
        if (di && dj && (blocked[j * w + ni] || blocked[nj * w + i])) continue; // no corner cutting
        const nd = dk + c;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          heap.push(nk, nd);
        }
      }
    }
    this.dirty = false;
  }
  // Direction (unit vector) to move from world point, or null if at goal/unreachable.
  direction(x, z, out) {
    const { w, d, dist } = this;
    let [i, j] = this.cellOf(x, z);
    if (i < 0) i = 0; if (j < 0) j = 0; if (i >= w) i = w - 1; if (j >= d) j = d - 1;
    const k = j * w + i;
    let best = dist[k], bi = -1, bj = -1;
    if (best === 0) return null;
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
      const v = dist[nj * w + ni];
      if (v < best) {
        best = v; bi = ni; bj = nj;
      }
    }
    if (bi < 0) return null;
    const [cx, cz] = this.center(bi, bj);
    let dx = cx - x, dz = cz - z;
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    out[0] = dx / l;
    out[1] = dz / l;
    return out;
  }
  distanceAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    if (i < 0 || j < 0 || i >= this.w || j >= this.d) return INF;
    return this.dist[j * this.w + i];
  }
}

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const { k, v } = this;
    const rk = k[0], rv = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return [rk, rv];
  }
}
