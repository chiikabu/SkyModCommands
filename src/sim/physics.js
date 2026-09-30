// ─────────────────────────────────────────────────────────────────────────────
//  Verlet particle physics for wobbly active ragdolls (TABS-style).
//  Every ragdoll owns a block of NP consecutive particles in flat typed arrays.
// ─────────────────────────────────────────────────────────────────────────────
import { DT, GRAVITY } from '../config.js';

export const HEAD = 0, NECK = 1, LSH = 2, RSH = 3, PELVIS = 4, LHIP = 5, RHIP = 6,
  LELB = 7, LHAND = 8, RELB = 9, RHAND = 10, LKNEE = 11, LFOOT = 12, RKNEE = 13, RFOOT = 14, TIP = 15;
export const NP = 16;

// Rest pose for scale 1 in the body frame: x = right, y = up, z = forward.
export const REST = [
  [0, 1.70, 0.01], // head
  [0, 1.44, 0], // neck
  [-0.21, 1.38, 0], // l shoulder
  [0.21, 1.38, 0], // r shoulder
  [0, 0.95, 0.01], // pelvis
  [-0.11, 0.89, 0], // l hip
  [0.11, 0.89, 0], // r hip
  [-0.26, 1.12, 0], // l elbow
  [-0.28, 0.87, 0.05], // l hand
  [0.26, 1.12, 0], // r elbow
  [0.28, 0.87, 0.05], // r hand
  [-0.12, 0.49, 0.04], // l knee
  [-0.12, 0.08, 0], // l foot
  [0.12, 0.49, 0.04], // r knee
  [0.12, 0.08, 0], // r foot
  [0.28, 0.87, 0.6], // weapon tip
];
// Collision radius per particle (scale 1)
export const RADIUS = [0.19, 0.12, 0.09, 0.09, 0.14, 0.09, 0.09, 0.06, 0.07, 0.06, 0.07, 0.07, 0.08, 0.07, 0.08, 0.05];
const INV_MASS = [0.9, 0.8, 1, 1, 0.6, 1, 1, 1.3, 1.5, 1.3, 1.5, 1.1, 1.0, 1.1, 1.0, 1.6];

// Constraint template: [a, b, type] type 0 = rigid, 1 = min-distance, 2 = soft (stiffness 0.35)
const C_RIGID = 0, C_MIN = 1, C_SOFT = 2;
const TEMPLATE = [
  [HEAD, NECK, C_RIGID], [HEAD, LSH, C_SOFT], [HEAD, RSH, C_SOFT],
  [NECK, LSH, C_RIGID], [NECK, RSH, C_RIGID], [LSH, RSH, C_RIGID],
  [NECK, PELVIS, C_RIGID], [LSH, PELVIS, C_RIGID], [RSH, PELVIS, C_RIGID],
  [PELVIS, LHIP, C_RIGID], [PELVIS, RHIP, C_RIGID], [LHIP, RHIP, C_RIGID],
  [LSH, LHIP, C_RIGID], [RSH, RHIP, C_RIGID], [LSH, RHIP, C_RIGID], [RSH, LHIP, C_RIGID],
  [LSH, LELB, C_RIGID], [LELB, LHAND, C_RIGID], [RSH, RELB, C_RIGID], [RELB, RHAND, C_RIGID],
  [LHIP, LKNEE, C_RIGID], [LKNEE, LFOOT, C_RIGID], [RHIP, RKNEE, C_RIGID], [RKNEE, RFOOT, C_RIGID],
  [RHAND, TIP, C_RIGID],
  [LHIP, LFOOT, C_MIN], [RHIP, RFOOT, C_MIN], [LSH, LHAND, C_MIN], [RSH, RHAND, C_MIN],
  [LFOOT, RFOOT, C_MIN], [LKNEE, RKNEE, C_MIN], [HEAD, PELVIS, C_MIN],
];
const MIN_LEN = new Map([
  [`${LHIP}-${LFOOT}`, 0.42], [`${RHIP}-${RFOOT}`, 0.42], [`${LSH}-${LHAND}`, 0.16], [`${RSH}-${RHAND}`, 0.16],
  [`${LFOOT}-${RFOOT}`, 0.15], [`${LKNEE}-${RKNEE}`, 0.14], [`${HEAD}-${PELVIS}`, 0.55],
]);
export const NC = TEMPLATE.length;
export const CA = new Int32Array(NC), CB = new Int32Array(NC), CT = new Int32Array(NC), CL = new Float64Array(NC);
TEMPLATE.forEach(([a, b, t], i) => {
  CA[i] = a; CB[i] = b; CT[i] = t;
  if (t === C_MIN) CL[i] = MIN_LEN.get(`${a}-${b}`);
  else {
    const dx = REST[a][0] - REST[b][0], dy = REST[a][1] - REST[b][1], dz = REST[a][2] - REST[b][2];
    CL[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
});
const TIP_CONSTRAINT = TEMPLATE.findIndex((c) => c[0] === RHAND && c[1] === TIP);

// Body points used for ragdoll-vs-ragdoll pushing + hit tests.
export const BODY_PTS = [HEAD, NECK, PELVIS];
export const BODY_RAD = [0.2, 0.25, 0.21];

const ITER = 4;
const HASH_CELL = 1.5;
const HASH_SIZE = 4096;

export class Physics {
  constructor(world, maxRagdolls = 520) {
    this.world = world;
    this.maxRagdolls = maxRagdolls;
    const N = maxRagdolls * NP;
    this.x = new Float64Array(N); this.y = new Float64Array(N); this.z = new Float64Array(N);
    this.px = new Float64Array(N); this.py = new Float64Array(N); this.pz = new Float64Array(N);
    this.ax = new Float64Array(N); this.ay = new Float64Array(N); this.az = new Float64Array(N);
    // positions at the start of the latest step (for render interpolation)
    this.rx = new Float32Array(N); this.ry = new Float32Array(N); this.rz = new Float32Array(N);
    this.rad = new Float64Array(N);
    this.im = new Float64Array(N);
    this.grounded = new Uint8Array(N);
    this.slots = new Array(maxRagdolls).fill(null);
    this.free = [];
    for (let i = maxRagdolls - 1; i >= 0; i--) this.free.push(i);
    this.active = []; // list of ragdolls
    // spatial hash for body points
    this.hHead = new Int32Array(HASH_SIZE);
    this.hNext = new Int32Array(maxRagdolls * BODY_PTS.length);
    this.hIdx = new Int32Array(maxRagdolls * BODY_PTS.length); // particle index
    this.hOwner = new Int32Array(maxRagdolls * BODY_PTS.length); // slot
    this.hR = new Float64Array(maxRagdolls * BODY_PTS.length);
    this.hCount = 0;
    this.stepCount = 0;
  }

  // Allocate a ragdoll slot and place it standing at (x, y-ground, z) facing heading.
  alloc(rd, x, z, heading) {
    if (!this.free.length) return false;
    const slot = this.free.pop();
    rd.slot = slot;
    rd.base = slot * NP;
    this.slots[slot] = rd;
    this.active.push(rd);
    this.placeStanding(rd, x, z, heading);
    return true;
  }

  release(rd) {
    if (rd.slot < 0) return;
    this.slots[rd.slot] = null;
    this.free.push(rd.slot);
    const i = this.active.indexOf(rd);
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
    }
    rd.slot = -1;
    rd.base = -1;
  }

  placeStanding(rd, x, z, heading, yOffset = 0) {
    const s = rd.scale;
    const g = this.world.heightAt(x, z) + yOffset;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = -fz, rz = fx;
    const b = rd.base;
    for (let i = 0; i < NP; i++) {
      const r = REST[i];
      const wx = x + (r[0] * rx + r[2] * fx) * s;
      const wy = g + r[1] * s;
      const wz = z + (r[0] * rz + r[2] * fz) * s;
      const k = b + i;
      this.x[k] = this.px[k] = this.rx[k] = wx;
      this.y[k] = this.py[k] = this.ry[k] = wy;
      this.z[k] = this.pz[k] = this.rz[k] = wz;
      this.rad[k] = RADIUS[i] * s;
      this.im[k] = INV_MASS[i] / rd.mass;
      this.grounded[k] = 0;
    }
    if (rd.weaponLen > 0) this.setWeaponLength(rd, rd.weaponLen);
    rd.heading = heading;
    rd.sleeping = false;
    rd.sleepTimer = 0;
  }

  setWeaponLength(rd, len) {
    rd.weaponLen = len;
    const b = rd.base;
    // push tip out along forward so the constraint starts satisfied
    const fx = Math.sin(rd.heading), fz = Math.cos(rd.heading);
    const h = b + RHAND, t = b + TIP;
    this.x[t] = this.px[t] = this.x[h] + fx * len * rd.scale * 0.7;
    this.y[t] = this.py[t] = this.y[h] + len * rd.scale * 0.7;
    this.z[t] = this.pz[t] = this.z[h] + fz * len * rd.scale * 0.7;
  }

  // Translate an entire ragdoll (keeps velocity)
  teleport(rd, dx, dy, dz) {
    const b = rd.base;
    for (let i = 0; i < NP; i++) {
      const k = b + i;
      this.x[k] += dx; this.y[k] += dy; this.z[k] += dz;
      this.px[k] += dx; this.py[k] += dy; this.pz[k] += dz;
      this.rx[k] += dx; this.ry[k] += dy; this.rz[k] += dz;
    }
  }

  // Add a velocity change (m/s) to every particle of a ragdoll, optionally weighted to one particle.
  impulse(rd, vx, vy, vz, focus = -1, focusMul = 2.2) {
    if (rd.base < 0) return;
    const b = rd.base;
    for (let i = 0; i < NP; i++) {
      let m = 1;
      if (focus >= 0) {
        if (i === focus) m = focusMul;
        else m = 0.75;
      }
      const k = b + i;
      this.px[k] -= vx * m * DT;
      this.py[k] -= vy * m * DT;
      this.pz[k] -= vz * m * DT;
    }
    rd.sleeping = false;
    rd.sleepTimer = 0;
  }

  setVelocity(rd, vx, vy, vz) {
    const b = rd.base;
    for (let i = 0; i < NP; i++) {
      const k = b + i;
      this.px[k] = this.x[k] - vx * DT;
      this.py[k] = this.y[k] - vy * DT;
      this.pz[k] = this.z[k] - vz * DT;
    }
    rd.sleeping = false;
  }

  step() {
    this.stepCount++;
    const { x, y, z, px, py, pz, ax, ay, az } = this;
    const act = this.active;
    const dt2 = DT * DT;
    const { rx, ry, rz } = this;
    // ── integrate ──
    for (let r = 0; r < act.length; r++) {
      const rd = act[r];
      const b = rd.base;
      for (let i = 0; i < NP; i++) {
        const k = b + i;
        rx[k] = x[k]; ry[k] = y[k]; rz[k] = z[k];
      }
      if (rd.sleeping) continue;
      const damp = rd.muscle > 0.05 ? 0.985 : 0.992;
      const gy = -GRAVITY * rd.gravityScale;
      for (let i = 0; i < NP; i++) {
        const k = b + i;
        const vx = (x[k] - px[k]) * damp;
        const vy = (y[k] - py[k]) * damp;
        const vz = (z[k] - pz[k]) * damp;
        px[k] = x[k]; py[k] = y[k]; pz[k] = z[k];
        x[k] += vx + ax[k] * dt2;
        y[k] += vy + (ay[k] + gy) * dt2;
        z[k] += vz + az[k] * dt2;
        ax[k] = 0; ay[k] = 0; az[k] = 0;
      }
    }
    // ── constraints ──
    for (let it = 0; it < ITER; it++) {
      for (let r = 0; r < act.length; r++) {
        const rd = act[r];
        if (rd.sleeping) continue;
        this.solveRagdoll(rd, it === ITER - 1);
      }
    }
    // ── ragdoll vs ragdoll ──
    this.collideBodies();
    // ── sleeping ──
    if ((this.stepCount & 7) === 0) {
      for (let r = 0; r < act.length; r++) {
        const rd = act[r];
        if (rd.sleeping || rd.muscle > 0 || rd.pinned || rd.noSleep) continue;
        const b = rd.base;
        let mv = 0;
        for (let i = 0; i < NP; i += 2) {
          const k = b + i;
          const d = Math.abs(x[k] - px[k]) + Math.abs(y[k] - py[k]) + Math.abs(z[k] - pz[k]);
          if (d > mv) mv = d;
        }
        if (mv < 0.004) {
          rd.sleepTimer += 8;
          if (rd.sleepTimer > 50) {
            rd.sleeping = true;
            for (let i = 0; i < NP; i++) {
              const k = b + i;
              px[k] = x[k]; py[k] = y[k]; pz[k] = z[k];
            }
          }
        } else rd.sleepTimer = 0;
      }
    }
  }

  solveRagdoll(rd, final) {
    const { x, y, z, im } = this;
    const b = rd.base;
    const s = rd.scale;
    const noTip = rd.weaponLen <= 0;
    for (let c = 0; c < NC; c++) {
      if (noTip && c === TIP_CONSTRAINT) continue;
      const a = b + CA[c], bb = b + CB[c];
      const dx = x[bb] - x[a], dy = y[bb] - y[a], dz = z[bb] - z[a];
      const d2 = dx * dx + dy * dy + dz * dz;
      let rest = CL[c] * s;
      if (c === TIP_CONSTRAINT) rest = rd.weaponLen * s;
      const t = CT[c];
      if (t === C_MIN) {
        if (d2 >= rest * rest) continue;
      }
      const d = Math.sqrt(d2);
      if (d < 1e-7) continue;
      const wa = im[a], wb = im[bb];
      const w = wa + wb;
      let diff = (d - rest) / (d * w);
      if (t === C_SOFT) diff *= 0.35;
      const cx = dx * diff, cy = dy * diff, cz = dz * diff;
      x[a] += cx * wa; y[a] += cy * wa; z[a] += cz * wa;
      x[bb] -= cx * wb; y[bb] -= cy * wb; z[bb] -= cz * wb;
    }
    // pinned pelvis (seats)
    if (rd.pinned) {
      const p = b + PELVIS;
      x[p] = rd.pinned.x; y[p] = rd.pinned.y; z[p] = rd.pinned.z;
    }
    this.collideEnvironment(rd, final);
  }

  collideEnvironment(rd, final) {
    const { x, y, z, px, py, pz, rad, world } = this;
    const b = rd.base;
    const alive = rd.muscle > 0.05;
    const feetFric = alive ? rd.footFriction : 0.6;
    for (let i = 0; i < NP; i++) {
      const k = b + i;
      const r = rad[k];
      // static colliders
      if (final) {
        const cs = world.collidersAt(x[k], z[k]);
        if (cs) {
          for (let ci = 0; ci < cs.length; ci++) {
            const c = cs[ci];
            if (c.ghost || c.owner === rd.ignoreCollider) continue;
            this.pushOut(k, c, r);
          }
        }
      }
      // ground
      const g = world.heightAt(x[k], z[k]) + r;
      if (y[k] < g) {
        y[k] = g;
        if (final) {
          const fr = i === LFOOT || i === RFOOT ? feetFric : alive ? 0.1 : 0.35;
          const vx = x[k] - px[k], vz = z[k] - pz[k];
          px[k] = x[k] - vx * (1 - fr);
          pz[k] = z[k] - vz * (1 - fr);
          if (py[k] < y[k] - 0.25) py[k] = y[k] - 0.25; // clamp huge downward speeds
          this.grounded[k] = 1;
        }
      } else if (final) this.grounded[k] = 0;
    }
  }

  pushOut(k, c, r) {
    const { x, y, z } = this;
    if (y[k] - r > c.h + (c.y0 || 0)) return;
    if (c.y0 && y[k] + r < c.y0) return;
    if (c.type === 'box') {
      const x0 = c.x0 - r, x1 = c.x1 + r, z0 = c.z0 - r, z1 = c.z1 + r;
      const px_ = x[k], pz_ = z[k];
      if (px_ <= x0 || px_ >= x1 || pz_ <= z0 || pz_ >= z1) return;
      const dl = px_ - x0, dr = x1 - px_, dn = pz_ - z0, df = z1 - pz_;
      const top = c.h + (c.y0 || 0) + r - y[k];
      let m = dl, ax = 0;
      if (dr < m) { m = dr; ax = 1; }
      if (dn < m) { m = dn; ax = 2; }
      if (df < m) { m = df; ax = 3; }
      if (top < m && c.walkable !== false && top < 0.6) {
        y[k] += top;
        return;
      }
      if (ax === 0) x[k] = x0;
      else if (ax === 1) x[k] = x1;
      else if (ax === 2) z[k] = z0;
      else z[k] = z1;
    } else {
      const dx = x[k] - c.x, dz = z[k] - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const d = Math.sqrt(d2) || 1e-6;
      const top = c.h + (c.y0 || 0) + r - y[k];
      if (top < rr - d && top < 0.6 && c.walkable !== false) {
        y[k] += top;
        return;
      }
      const s = rr / d;
      x[k] = c.x + dx * s;
      z[k] = c.z + dz * s;
    }
  }

  collideBodies() {
    const { x, y, z, im, hHead, hNext, hIdx, hOwner, hR } = this;
    hHead.fill(-1);
    let n = 0;
    const act = this.active;
    for (let r = 0; r < act.length; r++) {
      const rd = act[r];
      if (rd.noCollide) continue;
      const b = rd.base;
      for (let j = 0; j < 3; j++) {
        const k = b + BODY_PTS[j];
        const cx = Math.floor(x[k] / HASH_CELL), cz = Math.floor(z[k] / HASH_CELL);
        const h = ((cx * 73856093) ^ (cz * 19349663)) & (HASH_SIZE - 1);
        hIdx[n] = k;
        hOwner[n] = rd.slot;
        hR[n] = BODY_RAD[j] * rd.scale * rd.bodyRadiusMul;
        hNext[n] = hHead[h];
        hHead[h] = n;
        n++;
      }
    }
    this.hCount = n;
    for (let e = 0; e < n; e++) {
      const k = hIdx[e];
      const owner = hOwner[e];
      const re = hR[e];
      const cx = Math.floor(x[k] / HASH_CELL), cz = Math.floor(z[k] / HASH_CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const h = (((cx + ox) * 73856093) ^ ((cz + oz) * 19349663)) & (HASH_SIZE - 1);
          for (let f = hHead[h]; f >= 0; f = hNext[f]) {
            if (f <= e || hOwner[f] === owner) continue;
            const q = hIdx[f];
            const dx = x[q] - x[k], dy = y[q] - y[k], dz = z[q] - z[k];
            const rr = re + hR[f];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr || d2 < 1e-10) continue;
            const d = Math.sqrt(d2);
            const wa = im[k], wb = im[q];
            const w = wa + wb;
            const pen = ((rr - d) / (d * w)) * 0.5;
            x[k] -= dx * pen * wa; y[k] -= dy * pen * wa * 0.3; z[k] -= dz * pen * wa;
            x[q] += dx * pen * wb; y[q] += dy * pen * wb * 0.3; z[q] += dz * pen * wb;
            const sa = this.slots[owner], sb = this.slots[hOwner[f]];
            if (sa.sleeping) sa.sleeping = false;
            if (sb.sleeping) sb.sleeping = false;
          }
        }
      }
    }
  }

  // Query body points within radius of (qx,qy,qz). Calls fn(ragdoll, particleIndex, dist).
  queryBodies(qx, qz, radius, fn) {
    const { x, z, hHead, hNext, hIdx, hOwner } = this;
    const r = Math.ceil(radius / HASH_CELL);
    const cx = Math.floor(qx / HASH_CELL), cz = Math.floor(qz / HASH_CELL);
    const r2 = radius * radius;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let ox = -r; ox <= r; ox++) {
      for (let oz = -r; oz <= r; oz++) {
        const h = (((cx + ox) * 73856093) ^ ((cz + oz) * 19349663)) & (HASH_SIZE - 1);
        for (let f = hHead[h]; f >= 0; f = hNext[f]) {
          const k = hIdx[f];
          const dx = x[k] - qx, dz = z[k] - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const owner = hOwner[f];
          if (seen.has(owner)) continue;
          seen.add(owner);
          fn(this.slots[owner], k, Math.sqrt(d2));
        }
      }
    }
  }
}
