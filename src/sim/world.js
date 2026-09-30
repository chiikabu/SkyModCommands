// Terrain heightfield + static obstacle grid shared by all simulation systems.
import { fbm2 } from '../util/noise.js';
import { smoothstep, clamp } from '../util/math.js';
import { HALF_W, MID, PARK_LZ1, WATER_LEVEL, TILE } from '../config.js';

export const MAP_X = 170; // heightmap half-extent in x
export const MAP_Z = 210; // heightmap half-extent in z
const RES = 1; // metres per heightmap sample

export class World {
  constructor() {
    this.nx = Math.round((MAP_X * 2) / RES) + 1;
    this.nz = Math.round((MAP_Z * 2) / RES) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.generate();
    // Obstacle grid: 2m cells covering the playable rectangle + margins.
    this.ox0 = -HALF_W - 8;
    this.oz0 = -PARK_LZ1 - 14;
    this.ow = Math.ceil((HALF_W * 2 + 16) / TILE);
    this.od = Math.ceil((PARK_LZ1 * 2 + 28) / TILE);
    this.ocells = new Array(this.ow * this.od);
    for (let i = 0; i < this.ocells.length; i++) this.ocells[i] = null;
    this.colliders = new Set();
  }

  static baseHeight(x, z) {
    const ax = Math.abs(x),
      az = Math.abs(z);
    let h = 0;
    // Gentle bumps in no-man's land (fade to flat at the deployment yards).
    if (az < MID && ax < HALF_W + 4) {
      const f = 1 - smoothstep(MID - 6, MID, az);
      const fx = 1 - smoothstep(HALF_W - 4, HALF_W + 4, ax);
      h += (fbm2(x * 0.07 + 11.3, z * 0.07 - 4.1, 3) * 1.1 + 0.15) * f * fx;
    }
    // Hills along the sides of the valley.
    const dx = Math.max(0, ax - (HALF_W + 7));
    const dz = Math.max(0, az - (PARK_LZ1 + 16));
    const n = fbm2(x * 0.018 + 3.7, z * 0.018 - 8.2, 5);
    const hill = smoothstep(0, 26, dx) * (7 + 16 * (n + 0.45)) + smoothstep(18, 60, dx) * 10 * (0.5 + n);
    h += hill * (1 - smoothstep(10, 50, dz));
    // Back of the parks: gentle meadow sloping down to the beach.
    h -= smoothstep(0, 40, dz) * 1.5;
    // Island coastline (rounded rectangle with noisy edge).
    const ex = ax / (HALF_W + 105);
    const ez = az / (PARK_LZ1 + 72);
    const e = Math.pow(Math.pow(ex, 4) + Math.pow(ez, 4), 0.25) + fbm2(x * 0.01 - 5, z * 0.01 + 7, 4) * 0.22;
    const coast = smoothstep(0.86, 1.0, e);
    h = h * (1 - coast) + (WATER_LEVEL - 4.5) * coast;
    // Beach shelf
    return h;
  }

  generate() {
    const { nx, nz, h } = this;
    for (let j = 0; j < nz; j++) {
      const z = -MAP_Z + j * RES;
      for (let i = 0; i < nx; i++) {
        const x = -MAP_X + i * RES;
        h[j * nx + i] = World.baseHeight(x, z);
      }
    }
  }

  heightAt(x, z) {
    let fx = (x + MAP_X) / RES;
    let fz = (z + MAP_Z) / RES;
    if (fx < 0) fx = 0;
    else if (fx > this.nx - 1.001) fx = this.nx - 1.001;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1.001) fz = this.nz - 1.001;
    const i = fx | 0,
      j = fz | 0;
    const tx = fx - i,
      tz = fz - j;
    const h = this.h,
      nx = this.nx;
    const a = h[j * nx + i],
      b = h[j * nx + i + 1],
      c = h[(j + 1) * nx + i],
      d = h[(j + 1) * nx + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  // ── Static colliders ───────────────────────────────────────────────────────
  // shape: {type:'box', x0,x1,z0,z1, h} or {type:'cyl', x,z,r,h}; owner is any object.
  addCollider(c) {
    let x0, x1, z0, z1;
    if (c.type === 'box') {
      x0 = c.x0; x1 = c.x1; z0 = c.z0; z1 = c.z1;
    } else {
      x0 = c.x - c.r; x1 = c.x + c.r; z0 = c.z - c.r; z1 = c.z + c.r;
    }
    const i0 = clamp(Math.floor((x0 - this.ox0) / TILE), 0, this.ow - 1);
    const i1 = clamp(Math.floor((x1 - this.ox0) / TILE), 0, this.ow - 1);
    const j0 = clamp(Math.floor((z0 - this.oz0) / TILE), 0, this.od - 1);
    const j1 = clamp(Math.floor((z1 - this.oz0) / TILE), 0, this.od - 1);
    c._cells = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.ow + i;
        if (!this.ocells[k]) this.ocells[k] = [];
        this.ocells[k].push(c);
        c._cells.push(k);
      }
    this.colliders.add(c);
    return c;
  }
  removeCollider(c) {
    if (!c || !c._cells) return;
    for (const k of c._cells) {
      const arr = this.ocells[k];
      if (!arr) continue;
      const idx = arr.indexOf(c);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) this.ocells[k] = null;
    }
    c._cells = null;
    this.colliders.delete(c);
  }
  collidersAt(x, z) {
    const i = Math.floor((x - this.ox0) / TILE);
    const j = Math.floor((z - this.oz0) / TILE);
    if (i < 0 || j < 0 || i >= this.ow || j >= this.od) return null;
    return this.ocells[j * this.ow + i];
  }
  // Is the straight segment blocked by a collider taller than minH?
  segmentBlocked(ax, az, bx, bz, minH = 1.2, ignore = null) {
    const dx = bx - ax,
      dz = bz - az;
    const L = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(L / 1.0));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + dx * t,
        z = az + dz * t;
      const cs = this.collidersAt(x, z);
      if (!cs) continue;
      for (const c of cs) {
        if (c === ignore || c.owner === ignore || c.h < minH) continue;
        if (pointInCollider(c, x, z, 0.3)) return c;
      }
    }
    return null;
  }
}

export function pointInCollider(c, x, z, pad = 0) {
  if (c.type === 'box') return x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad;
  const dx = x - c.x,
    dz = z - c.z;
  const r = c.r + pad;
  return dx * dx + dz * dz < r * r;
}

// Closest point on a collider footprint to (x,z) + distance.
export function colliderDistance(c, x, z) {
  if (c.type === 'box') {
    const cx = clamp(x, c.x0, c.x1),
      cz = clamp(z, c.z0, c.z1);
    const dx = x - cx,
      dz = z - cz;
    return { x: cx, z: cz, d: Math.sqrt(dx * dx + dz * dz) };
  }
  const dx = x - c.x,
    dz = z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  const k = c.r / d;
  return { x: c.x + dx * k, z: c.z + dz * k, d: Math.max(0, d - c.r) };
}
