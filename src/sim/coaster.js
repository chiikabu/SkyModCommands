// ─────────────────────────────────────────────────────────────────────────────
//  Roller coasters: centripetal Catmull-Rom track, energy-based train physics,
//  auto-banking, Planet Coaster–style ratings, seats and invader-flattening.
// ─────────────────────────────────────────────────────────────────────────────
import { COASTER, DT, GRAVITY, GRID_W, TERR_ROWS, HALF_W, MID, PARK_LZ1, TILE, BUILDINGS } from '../config.js';
import { sgn, tileCenterLX, tileCenterLZ, tileOfLX, tileOfLZ, inGrid } from './team.js';
import { rotatedSize } from './park.js';
import { knock } from './ragdoll.js';
import { NECK } from './physics.js';

const DS = 0.5; // sample spacing (m)
const STATION_H = 1.0;

// Station geometry in local coords for a footprint.
export function stationEnds(gx, gz, rot) {
  const [W, D] = rotatedSize(BUILDINGS.station, rot);
  const cx = -HALF_W + (gx + W / 2) * TILE;
  const cz = MID + (gz + D / 2) * TILE;
  const half = (Math.max(W, D) * TILE) / 2 - 0.6;
  // travel direction by rotation
  const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]][rot];
  return {
    A: [cx - dir[0] * half, cz - dir[1] * half],
    B: [cx + dir[0] * half, cz + dir[1] * half],
    dir,
    W, D,
  };
}
export function stationEntranceTile(gx, gz, rot) {
  const [W, D] = rotatedSize(BUILDINGS.station, rot);
  if (rot % 2 === 0) return [gx + W, gz + (D >> 1)];
  return [gx + (W >> 1), gz + D];
}

function catmull(p0, p1, p2, p3, t, out) {
  // centripetal parameterisation
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + 1e-4, 0.5);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  for (let c = 0; c < 3; c++) {
    const A1 = ((t1 - tt) / (t1 - t0)) * p0[c] + ((tt - t0) / (t1 - t0)) * p1[c];
    const A2 = ((t2 - tt) / (t2 - t1)) * p1[c] + ((tt - t1) / (t2 - t1)) * p2[c];
    const A3 = ((t3 - tt) / (t3 - t2)) * p2[c] + ((tt - t2) / (t3 - t2)) * p3[c];
    const B1 = ((t2 - tt) / (t2 - t0)) * A1 + ((tt - t0) / (t2 - t0)) * A2;
    const B2 = ((t3 - tt) / (t3 - t1)) * A2 + ((tt - t1) / (t3 - t1)) * A3;
    out[c] = ((t2 - tt) / (t2 - t1)) * B1 + ((tt - t1) / (t2 - t1)) * B2;
  }
  return out;
}

// Build a track design. nodes: [{lx, lz, h}] (h = height above ground). Returns design object.
export function designTrack(game, team, station, nodes, opts = {}) {
  const s = sgn(team);
  const world = game.world;
  const st = stationEnds(station.gx, station.gz, station.rot);
  const gyAt = (lx, lz) => world.heightAt(lx * s, lz * s);
  const P = (lx, lz, h) => [lx * s, gyAt(lx, lz) + h, lz * s];
  const A = P(st.A[0], st.A[1], STATION_H), B = P(st.B[0], st.B[1], STATION_H);
  const Bx = P(st.B[0] + st.dir[0] * 4, st.B[1] + st.dir[1] * 4, STATION_H + 0.2);
  const Ax = P(st.A[0] - st.dir[0] * 4, st.A[1] - st.dir[1] * 4, STATION_H + 0.2);
  const ctrl = [A, B, Bx];
  for (const n of nodes) ctrl.push(P(n.lx, n.lz, Math.max(0.8, n.h)));
  ctrl.push(Ax);
  const n = ctrl.length;
  // dense sampling
  const dense = [];
  const tmp = [0, 0, 0];
  const SUB = 28;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < SUB; k++) {
      catmull(p0, p1, p2, p3, k / SUB, tmp);
      dense.push([tmp[0], tmp[1], tmp[2]]);
    }
  }
  // arc length
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const L = cum[cum.length - 1];
  const count = Math.max(8, Math.floor(L / DS));
  const ds = L / count;
  const X = new Float32Array(count), Y = new Float32Array(count), Z = new Float32Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * ds;
    while (j < dense.length - 1 && cum[j + 1] < target) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (target - cum[j]) / seg;
    X[i] = a[0] + (b[0] - a[0]) * t;
    Y[i] = a[1] + (b[1] - a[1]) * t;
    Z[i] = a[2] + (b[2] - a[2]) * t;
  }
  const d = { team, station, nodes, X, Y, Z, n: count, ds, L, ctrl };
  // tangents + curvature
  const TX = new Float32Array(count), TY = new Float32Array(count), TZ = new Float32Array(count);
  const KX = new Float32Array(count), KY = new Float32Array(count), KZ = new Float32Array(count);
  const h = 3; // samples for curvature (1.5 m)
  let maxK = 0, maxKAt = -1;
  for (let i = 0; i < count; i++) {
    const a = (i - 1 + count) % count, b = (i + 1) % count;
    let tx = X[b] - X[a], ty = Y[b] - Y[a], tz = Z[b] - Z[a];
    const l = Math.hypot(tx, ty, tz) || 1;
    TX[i] = tx / l; TY[i] = ty / l; TZ[i] = tz / l;
    const aa = (i - h + count) % count, bb = (i + h) % count;
    const hh = h * ds;
    KX[i] = (X[bb] - 2 * X[i] + X[aa]) / (hh * hh);
    KY[i] = (Y[bb] - 2 * Y[i] + Y[aa]) / (hh * hh);
    KZ[i] = (Z[bb] - 2 * Z[i] + Z[aa]) / (hh * hh);
    const km = Math.hypot(KX[i], KY[i], KZ[i]);
    if (km > maxK) { maxK = km; maxKAt = i; }
  }
  Object.assign(d, { TX, TY, TZ, KX, KY, KZ, maxK });
  // station indices: A at 0, B at arc of dense index SUB
  d.sB = cum[SUB];
  d.sA = 0;
  d.stationLen = d.sB;
  // highest point → lift end
  let top = 0, topI = 0;
  for (let i = 0; i < count; i++) if (Y[i] > top) { top = Y[i]; topI = i; }
  d.liftEnd = topI * ds;
  d.maxHeight = top;
  // validation
  d.valid = true;
  d.reason = '';
  d.hits = [];
  const park = game.parks[team];
  for (let i = 0; i < count; i++) {
    const lx = X[i] * s, lz = Z[i] * s;
    if (Math.abs(lx) > HALF_W - 0.8 || lz < MID + 0.8 || lz > PARK_LZ1 - 0.8) {
      d.valid = false; d.reason = 'Track leaves your land'; d.hits.push(i);
      continue;
    }
    const gy = world.heightAt(X[i], Z[i]);
    const above = Y[i] - gy;
    if (above < 0.3) { d.valid = false; d.reason = 'Track goes underground'; d.hits.push(i); continue; }
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    if (inGrid(gx, gz)) {
      const tv = park.tiles[gz * GRID_W + gx];
      if (tv > 0) {
        const b = park.byId.get(tv);
        if (b && b !== station.building && b.def.cat !== 'scenery' && above < (b.def.height || 4) + 1.5) {
          d.valid = false; d.reason = 'Track hits ' + b.def.name; d.hits.push(i);
        }
      }
    }
  }
  if (maxK > 1 / 2.4) {
    d.valid = false;
    d.reason = d.reason || 'Turn too tight';
    d.hits.push(maxKAt);
  }
  // supports
  d.supports = [];
  for (let i = 0; i < count; i += 8) {
    const gy = world.heightAt(X[i], Z[i]);
    const above = Y[i] - gy;
    if (above < 1.6) continue;
    const lx = X[i] * s, lz = Z[i] * s;
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    if (inGrid(gx, gz) && park.tiles[gz * GRID_W + gx] > 0) {
      const b = park.byId.get(park.tiles[gz * GRID_W + gx]);
      if (b && b.def.cat !== 'scenery') continue;
    }
    d.supports.push({ x: X[i], z: Z[i], y0: gy, y1: Y[i] - 0.35, i });
  }
  d.cost = Math.round(COASTER.stationCost * (opts.noStationCost ? 0 : 1) + L * COASTER.costPerMeter + d.supports.length * COASTER.supportCost);
  simulateStats(d);
  return d;
}

// Physics step for a train along a design. Returns new speed.
function trainAccel(d, s, v, inStationRun) {
  const i = Math.floor(s / d.ds) % d.n;
  const ty = d.TY[i < 0 ? i + d.n : i];
  let a = -GRAVITY * ty - 0.09 - 0.0022 * v * v;
  return a;
}

export function simulateStats(d) {
  // Simulate a lap from dispatch at the station exit.
  const dt = 1 / 30;
  let s = d.sB, v = 3.2;
  const vAt = new Float32Array(d.n);
  let t = 0;
  let maxV = 0;
  const lapEnd = d.L; // back at A (s wraps to L)
  let guard = 0;
  let boosted = 0;
  while (s < lapEnd && guard++ < 20000) {
    const a = trainAccel(d, s, v);
    v += a * dt;
    if (s < d.liftEnd && v < 3.6) v = 3.6; // chain lift
    if (v < 1.6) { v = 1.6; boosted += dt; }
    if (s > lapEnd - 14) v = Math.min(v, Math.max(2.5, v - 9 * dt));
    s += v * dt;
    t += dt;
    const i = Math.floor(s / d.ds) % d.n;
    vAt[i] = v;
    if (v > maxV) maxV = v;
  }
  // fill gaps
  let last = 3;
  for (let i = 0; i < d.n; i++) {
    if (vAt[i] > 0) last = vAt[i];
    else vAt[i] = last;
  }
  // station section speed
  const sbI = Math.floor(d.sB / d.ds);
  for (let i = 0; i <= sbI; i++) vAt[i] = 2;
  d.vAt = vAt;
  // banking + g-forces
  const n = d.n;
  const bank = new Float32Array(n);
  const UX = new Float32Array(n), UY = new Float32Array(n), UZ = new Float32Array(n);
  const RX = new Float32Array(n), RY = new Float32Array(n), RZ = new Float32Array(n);
  const vertG = new Float32Array(n), latG = new Float32Array(n);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v2 = vAt[i] * vAt[i];
    const tx = d.TX[i], ty = d.TY[i], tz = d.TZ[i];
    let fx = v2 * d.KX[i], fy = v2 * d.KY[i] + GRAVITY, fz = v2 * d.KZ[i];
    const ft = fx * tx + fy * ty + fz * tz;
    fx -= ft * tx; fy -= ft * ty; fz -= ft * tz;
    // unbanked up
    let ux = -ty * tx, uy = 1 - ty * ty, uz = -ty * tz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // right = t × u
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    const lat = fx * rx + fy * ry + fz * rz;
    const ver = fx * ux + fy * uy + fz * uz;
    raw[i] = Math.max(-1.25, Math.min(1.25, Math.atan2(lat, Math.max(0.5, ver))));
  }
  // smooth bank
  const W = 10;
  for (let i = 0; i < n; i++) {
    let acc = 0, wsum = 0;
    for (let k = -W; k <= W; k++) {
      const w = W + 1 - Math.abs(k);
      acc += raw[(i + k + n) % n] * w;
      wsum += w;
    }
    bank[i] = acc / wsum;
  }
  let maxVG = 0, minVG = 9, maxLG = 0, air = 0, turn = 0;
  for (let i = 0; i < n; i++) {
    const tx = d.TX[i], ty = d.TY[i], tz = d.TZ[i];
    let ux = -ty * tx, uy = 1 - ty * ty, uz = -ty * tz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    const cb = Math.cos(bank[i]), sb = Math.sin(bank[i]);
    // rotate up/right around tangent by bank
    const nux = ux * cb + rx * sb, nuy = uy * cb + ry * sb, nuz = uz * cb + rz * sb;
    const nrx = rx * cb - ux * sb, nry = ry * cb - uy * sb, nrz = rz * cb - uz * sb;
    UX[i] = nux; UY[i] = nuy; UZ[i] = nuz;
    RX[i] = nrx; RY[i] = nry; RZ[i] = nrz;
    const v2 = vAt[i] * vAt[i];
    let fx = v2 * d.KX[i], fy = v2 * d.KY[i] + GRAVITY, fz = v2 * d.KZ[i];
    const vg = (fx * nux + fy * nuy + fz * nuz) / GRAVITY;
    const lg = Math.abs(fx * nrx + fy * nry + fz * nrz) / GRAVITY;
    vertG[i] = vg;
    latG[i] = lg;
    if (i > Math.floor(d.sB / d.ds)) {
      if (vg > maxVG) maxVG = vg;
      if (vg < minVG) minVG = vg;
      if (lg > maxLG) maxLG = lg;
      if (vg < 0.25) air += d.ds / Math.max(1, vAt[i]);
      // horizontal turning
      const j = (i + 1) % n;
      const a1 = Math.atan2(d.TX[i], d.TZ[i]), a2 = Math.atan2(d.TX[j], d.TZ[j]);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      turn += Math.abs(da);
    }
  }
  Object.assign(d, { bank, UX, UY, UZ, RX, RY, RZ, vertG, latG });
  // drops
  let drops = 0, maxDrop = 0, run = 0;
  for (let i = 1; i < n; i++) {
    const dy = d.Y[i] - d.Y[i - 1];
    if (dy < -0.01) run -= dy;
    else if (dy > 0.03) {
      if (run > 3) { drops++; if (run > maxDrop) maxDrop = run; }
      run = 0;
    }
  }
  if (run > 3) { drops++; if (run > maxDrop) maxDrop = run; }
  const kmh = maxV * 3.6;
  const st = {
    maxSpeed: maxV, kmh, length: d.L, duration: t, maxVertG: maxVG, minVertG: minVG, maxLatG: maxLG, airtime: air,
    drops, maxDrop, height: d.maxHeight, turns: turn, boosted,
  };
  let I = 0.5 + Math.max(0, maxVG - 1.5) * 1.1 + Math.max(0, 0.5 - minVG) * 2 + maxLG * 1.8 + kmh / 40;
  let N = 0.4 + maxLG * 2.3 + turn / 16 + air * 0.35 + Math.max(0, maxVG - 3.5) * 0.6;
  let E = 1.1 + Math.min(4.2, kmh / 21) + Math.min(1.3, d.L / 220) + Math.min(6, drops) * 0.2 + Math.min(1.5, maxDrop / 15) +
    Math.min(1.4, air * 0.8) + Math.min(0.6, Math.max(0, maxVG - 2) * 0.3) + Math.min(0.6, turn / 30);
  if (I > 8.6) E -= (I - 8.6) * 0.9;
  if (N > 7) E -= (N - 7) * 0.5;
  if (boosted > 3) E -= Math.min(2, boosted * 0.2);
  if (d.L < 120) E -= (120 - d.L) / 50;
  st.excitement = Math.max(0.5, Math.min(10, E));
  st.intensity = Math.max(0.3, Math.min(10, I));
  st.nausea = Math.max(0.2, Math.min(10, N));
  d.stats = st;
  d.price = Math.round(7 + st.excitement * 2.5);
  return st;
}

// ── Live coaster ─────────────────────────────────────────────────────────────
export class Coaster {
  constructor(game, team, building, design) {
    this.game = game;
    this.team = team;
    this.building = building;
    this.d = design;
    this.stats = design.stats;
    this.price = design.price;
    this.open = true;
    building.coaster = this;
    building.ride = { phase: 'loading', timer: 4, riders: [], queue: [], cycles: 0 };
    this.train = { s: design.sB - 0.6, v: 0, state: 'loading', timer: 4, prevS: design.sB - 0.6, hitCd: new Map() };
    this.supportColliders = [];
    for (const sp of design.supports) {
      const c = game.world.addCollider({ type: 'cyl', x: sp.x, z: sp.z, r: 0.28, h: sp.y1 - sp.y0, owner: building });
      this.supportColliders.push(c);
    }
    this.seatOut = {};
    this.id = building.id;
  }
  destroy() {
    for (const c of this.supportColliders) this.game.world.removeCollider(c);
    this.supportColliders = [];
    const R = this.building.ride;
    for (const g of R.riders) this.game.guests.unseat(g, true);
    R.riders.length = 0;
  }
  // position/frame at arc s (wraps)
  frameAt(s, out) {
    const d = this.d;
    let f = s / d.ds;
    f = ((f % d.n) + d.n) % d.n;
    const i = Math.floor(f), j = (i + 1) % d.n, t = f - i;
    const L = (A) => A[i] + (A[j] - A[i]) * t;
    out.x = L(d.X); out.y = L(d.Y); out.z = L(d.Z);
    out.tx = L(d.TX); out.ty = L(d.TY); out.tz = L(d.TZ);
    out.ux = L(d.UX); out.uy = L(d.UY); out.uz = L(d.UZ);
    out.rx = L(d.RX); out.ry = L(d.RY); out.rz = L(d.RZ);
    return out;
  }
  carS(c) {
    return this.train.s - c * COASTER.carLength;
  }
  seatTransform(i, out) {
    const car = Math.floor(i / COASTER.seatsPerCar);
    const k = i % COASTER.seatsPerCar;
    const along = (k < 2 ? 0.5 : -0.5);
    const lat = k % 2 ? 0.36 : -0.36;
    const f = this.frameAt(this.carS(car) + along, this.seatOut);
    out.x = f.x + f.ux * 0.45 + f.rx * lat;
    out.y = f.y + f.uy * 0.45 + f.ry * lat;
    out.z = f.z + f.uz * 0.45 + f.rz * lat;
    out.fx = f.tx; out.fy = f.ty; out.fz = f.tz;
    out.ux = f.ux; out.uy = f.uy; out.uz = f.uz;
    return out;
  }

  update() {
    const g = this.game;
    const b = this.building;
    const d = this.d;
    const T = this.train;
    const R = b.ride;
    T.prevS = T.s;
    if (b.ruined) {
      T.v *= 0.95;
      T.state = 'broken';
      return;
    }
    const battle = g.phase === 'battle' && g.battleStarted;
    switch (T.state) {
      case 'loading': {
        T.v = 0;
        // board
        const cap = COASTER.cars * COASTER.seatsPerCar;
        while (R.riders.length < cap && R.queue.length && R.queue[0].atEntrance) {
          const gst = R.queue.shift();
          R.riders.push(gst);
          g.guests.seat(gst, b, R.riders.length - 1);
          const price = Math.round(g.parks[this.team].ticketPrice(b));
          g.earn(this.team, price, 'rides', b);
          b.income += price;
          b.customers++;
        }
        T.timer -= DT;
        const danger = battle && g.parks[this.team].enemiesNear(b.x, b.z, 18);
        if (danger && R.riders.length) {
          for (const gst of R.riders) g.guests.unseat(gst, true);
          R.riders.length = 0;
        }
        // In battle the coaster keeps running (empty) as a weapon.
        if ((T.timer <= 0 && (R.riders.length > 0 || battle)) || R.riders.length >= cap) {
          T.state = 'running';
          T.v = 3.5;
          R.cycles++;
          g.emit('coasterDispatch', { b });
        } else if (T.timer <= 0) T.timer = 1.5;
        break;
      }
      case 'running': {
        let a = trainAccel(d, T.s, T.v);
        T.v += a * DT;
        const sm = T.s % d.L;
        if (sm >= d.sB && sm < d.liftEnd && T.v < 3.6) T.v = 3.6;
        if (T.v < 1.6) T.v = 1.6;
        const toEnd = d.L - sm;
        if (toEnd < 16 && sm > d.sB) T.v = Math.max(2, T.v - 10 * DT);
        T.s += T.v * DT;
        if (T.s >= d.L + d.sB - 0.6) {
          T.s = d.sB - 0.6;
          T.v = 0;
          T.state = 'unloading';
          T.timer = 1.6;
        }
        if (battle) this.hitInvaders();
        break;
      }
      case 'unloading':
        T.v = 0;
        T.timer -= DT;
        if (T.timer <= 0) {
          for (const gst of R.riders) g.guests.finishRide(gst, b);
          R.riders.length = 0;
          T.state = 'loading';
          T.timer = battle ? 0.5 : 4;
        }
        break;
    }
  }

  hitInvaders() {
    const g = this.game;
    const T = this.train;
    if (T.v < 4) return;
    const f = {};
    const C = COASTER.combat;
    for (let c = 0; c < COASTER.cars; c++) {
      this.frameAt(this.carS(c), f);
      const gy = g.world.heightAt(f.x, f.z);
      if (f.y - gy > 2.6) continue;
      for (const e of g.units[1 - this.team]) {
        if (!e.alive) continue;
        const dx = e.x - f.x, dz = e.z - f.z;
        const r = C.radius + e.radius;
        if (dx * dx + dz * dz > r * r) continue;
        if (Math.abs(e.y - f.y) > 2.2 * e.def.scale) continue;
        const cd = T.hitCd.get(e.id) || 0;
        if (g.time < cd) continue;
        T.hitCd.set(e.id, g.time + 0.8);
        const dmg = Math.min(C.maxDamage, T.v * T.v * C.damageScale);
        g.damageUnit(e, dmg, this.building, f.tx, 0.45 + Math.max(0, f.ty), f.tz, T.v * 1.25 * C.knock, NECK);
        g.emit('coasterHit', { x: e.x, y: e.y, z: e.z, v: T.v });
        T.v *= 0.94;
      }
    }
  }
}
