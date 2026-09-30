// ─────────────────────────────────────────────────────────────────────────────
//  Active ragdoll controller: balance, facing, procedural gait, arm poses and
//  keyframed attack animations — all expressed as spring forces so everything
//  wobbles like it should.
// ─────────────────────────────────────────────────────────────────────────────
import { DT, GRAVITY } from '../config.js';
import {
  HEAD, NECK, LSH, RSH, PELVIS, LHIP, RHIP, LELB, LHAND, RELB, RHAND, LKNEE, LFOOT, RKNEE, RFOOT, TIP,
} from './physics.js';

const TAU = Math.PI * 2;

export class Ragdoll {
  constructor(opts = {}) {
    this.slot = -1;
    this.base = -1;
    this.scale = opts.scale || 1;
    this.mass = opts.mass || Math.pow(this.scale, 2.3);
    this.muscle = 1;
    this.targetMuscle = 1;
    this.strength = opts.strength || 1; // multiplier on controller gains
    this.heading = 0;
    this.targetHeading = 0;
    this.turnRate = opts.turnRate || 7;
    this.vx = 0; // desired velocity
    this.vz = 0;
    this.phase = Math.random() * TAU;
    this.gaitAmp = 0;
    this.gravityScale = 1;
    this.footFriction = 0.75;
    this.weaponLen = opts.weaponLen || 0;
    this.pose = opts.pose || 'idle';
    this.anim = null; // {name, t, dur, flip}
    this.pinned = null; // {x,y,z, fx,fy,fz, ux,uy,uz, pose}
    this.sleeping = false;
    this.sleepTimer = 0;
    this.noCollide = false;
    this.noSleep = false;
    this.bodyRadiusMul = opts.bodyRadiusMul || 1;
    this.stun = 0;
    this.crouch = 0;
    this.lean = 0;
    this.owner = null;
    this.ignoreCollider = null;
    this.wobble = opts.wobble ?? 1;
    this.footOverride = null; // {foot: RFOOT, x,y,z} local offsets
    this.t = Math.random() * 100;
    this.flail = 0;
  }
  get alive() {
    return this.muscle > 0;
  }
}

// ── Pose library ─────────────────────────────────────────────────────────────
// Hand targets are relative to the neck in body frame (x right, y up, z fwd).
// tip = weapon direction (normalized later). k = gain multiplier.
const P = (lh, rh, tip, k = 1, extra = null) => ({ lh, rh, tip, k, ...extra });

export const POSES = {
  idle: P([-0.3, -0.55, 0.06], [0.3, -0.55, 0.06], [0.05, 0.6, 0.8], 0.6),
  guard: P([-0.05, -0.38, 0.36], [0.2, -0.36, 0.32], [-0.15, 0.85, 0.5], 1),
  fists: P([-0.18, -0.2, 0.3], [0.18, -0.2, 0.3], [0, 0, 1], 1),
  ready: P([-0.25, -0.45, 0.2], [0.25, -0.35, 0.25], [0, 0.4, 1], 0.9),
  aim: P([-0.02, -0.12, 0.5], [0.16, -0.08, 0.22], [0, 0.42, 1], 1.4),
  whipReady: P([-0.28, -0.5, 0.1], [0.28, -0.3, 0.3], [0.2, -0.3, 1], 0.9),
  sit: P([-0.2, -0.33, 0.33], [0.2, -0.33, 0.33], [0, 0.3, 1], 0.8),
  drive: P([-0.14, -0.36, 0.42], [0.14, -0.36, 0.42], [0, 0.3, 1], 1),
  wheee: P([-0.34, 0.42, 0.08], [0.34, 0.42, 0.08], [0, 1, 0.3], 0.7),
  cheer: P([-0.32, 0.45, 0.1], [0.32, 0.45, 0.1], [0, 1, 0.2], 1),
  panic: P([-0.35, 0.3, 0.12], [0.35, 0.3, 0.12], [0, 1, 0], 0.8),
  balloon: P([-0.24, -0.1, 0.12], [0.3, -0.55, 0.06], [0, 1, 0], 0.7),
  carry: P([-0.18, -0.35, 0.34], [0.18, -0.35, 0.34], [0, 0.5, 1], 1),
};

// Keyframed attack animations. t in [0,1]. strike = moment damage resolves.
const K = (t, lh, rh, tip, k = 1.6) => ({ t, lh, rh, tip, k });
export const ANIMS = {
  swing: {
    strike: 0.55,
    keys: [
      K(0, [-0.05, -0.38, 0.36], [0.2, -0.36, 0.32], [-0.15, 0.85, 0.5], 1),
      K(0.35, [0.05, -0.05, 0.1], [0.32, 0.12, -0.05], [0.3, 1, -0.5], 1.4),
      K(0.55, [-0.1, -0.3, 0.45], [0.05, -0.25, 0.55], [-0.2, -0.45, 1], 2.4),
      K(0.78, [-0.25, -0.45, 0.3], [-0.12, -0.42, 0.38], [-0.7, -0.5, 0.6], 1.6),
      K(1, [-0.05, -0.38, 0.36], [0.2, -0.36, 0.32], [-0.15, 0.85, 0.5], 1),
    ],
  },
  slam: {
    strike: 0.62,
    keys: [
      K(0, [-0.05, -0.38, 0.36], [0.2, -0.36, 0.32], [-0.15, 0.85, 0.5], 1),
      K(0.42, [-0.08, 0.38, -0.08], [0.08, 0.4, -0.08], [0, 0.45, -1], 1.5),
      K(0.62, [-0.06, -0.36, 0.55], [0.06, -0.36, 0.55], [0, -1, 0.35], 2.8),
      K(0.85, [-0.06, -0.42, 0.5], [0.06, -0.42, 0.5], [0, -1, 0.5], 1.5),
      K(1, [-0.05, -0.38, 0.36], [0.2, -0.36, 0.32], [-0.15, 0.85, 0.5], 1),
    ],
  },
  punch: {
    strike: 0.45,
    keys: [
      K(0, [-0.18, -0.2, 0.3], [0.18, -0.2, 0.3], [0, 0, 1], 1),
      K(0.25, [-0.18, -0.18, 0.32], [0.26, -0.15, -0.05], [0, 0, 1], 1.3),
      K(0.45, [-0.18, -0.22, 0.25], [0.06, -0.02, 0.68], [0, 0, 1], 3),
      K(0.7, [-0.18, -0.2, 0.3], [0.14, -0.12, 0.42], [0, 0, 1], 1.5),
      K(1, [-0.18, -0.2, 0.3], [0.18, -0.2, 0.3], [0, 0, 1], 1),
    ],
  },
  throw: {
    strike: 0.55,
    keys: [
      K(0, [-0.25, -0.45, 0.2], [0.25, -0.35, 0.25], [0, 0.4, 1], 1),
      K(0.38, [-0.2, -0.1, 0.4], [0.32, 0.28, -0.28], [0, 1, -0.4], 1.5),
      K(0.55, [-0.28, -0.4, 0.05], [0.12, 0.12, 0.6], [0, 0.3, 1], 2.6),
      K(0.8, [-0.28, -0.45, 0.1], [0.0, -0.3, 0.45], [0, -0.3, 1], 1.4),
      K(1, [-0.25, -0.45, 0.2], [0.25, -0.35, 0.25], [0, 0.4, 1], 1),
    ],
  },
  whip: {
    strike: 0.58,
    keys: [
      K(0, [-0.28, -0.5, 0.1], [0.28, -0.3, 0.3], [0.2, -0.3, 1], 1),
      K(0.4, [-0.28, -0.4, 0.1], [0.3, 0.32, -0.15], [0.3, 1, -0.8], 1.5),
      K(0.58, [-0.28, -0.45, 0.1], [0.12, -0.08, 0.62], [0, -0.1, 1], 2.8),
      K(1, [-0.28, -0.5, 0.1], [0.28, -0.3, 0.3], [0.2, -0.3, 1], 1),
    ],
  },
  fire: {
    strike: 0.2,
    keys: [
      K(0, [-0.02, -0.12, 0.5], [0.16, -0.08, 0.22], [0, 0.42, 1], 1.4),
      K(0.2, [-0.02, -0.1, 0.46], [0.16, -0.06, 0.2], [0, 0.5, 1], 1.4),
      K(0.35, [-0.02, -0.0, 0.3], [0.16, 0.02, 0.1], [0, 0.9, 0.6], 1.2),
      K(1, [-0.02, -0.12, 0.5], [0.16, -0.08, 0.22], [0, 0.42, 1], 1.4),
    ],
  },
  stomp: {
    strike: 0.6,
    foot: true,
    keys: [
      K(0, [-0.3, -0.4, 0.15], [0.3, -0.4, 0.15], [0, 1, 0], 1),
      K(0.4, [-0.4, 0.3, 0.1], [0.4, 0.3, 0.1], [0, 1, 0], 1.2),
      K(0.6, [-0.3, -0.2, 0.3], [0.3, -0.2, 0.3], [0, 1, 0], 2),
      K(1, [-0.3, -0.4, 0.15], [0.3, -0.4, 0.15], [0, 1, 0], 1),
    ],
  },
  cheer: {
    strike: 2,
    keys: [
      K(0, [-0.3, -0.5, 0.1], [0.3, -0.5, 0.1], [0, 1, 0], 1),
      K(0.3, [-0.34, 0.45, 0.05], [0.34, 0.45, 0.05], [0, 1, 0], 1.3),
      K(0.6, [-0.3, 0.2, 0.15], [0.3, 0.2, 0.15], [0, 1, 0], 1.3),
      K(1, [-0.34, 0.45, 0.05], [0.34, 0.45, 0.05], [0, 1, 0], 1.3),
    ],
  },
};

function smooth(t) {
  return t * t * (3 - 2 * t);
}

const _lh = [0, 0, 0], _rh = [0, 0, 0], _tip = [0, 0, 0];
function sampleAnim(anim, t, flip) {
  const keys = anim.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1))));
  for (let c = 0; c < 3; c++) {
    _lh[c] = a.lh[c] + (b.lh[c] - a.lh[c]) * u;
    _rh[c] = a.rh[c] + (b.rh[c] - a.rh[c]) * u;
    _tip[c] = a.tip[c] + (b.tip[c] - a.tip[c]) * u;
  }
  if (flip) {
    // mirror: swap hands and negate x
    const t0 = _lh[0], t1 = _lh[1], t2 = _lh[2];
    _lh[0] = -_rh[0]; _lh[1] = _rh[1]; _lh[2] = _rh[2];
    _rh[0] = -t0; _rh[1] = t1; _rh[2] = t2;
    _tip[0] = -_tip[0];
  }
  return a.k + (b.k - a.k) * u;
}

// Start an attack/emote animation.
export function playAnim(rd, name, dur, flip = false) {
  rd.anim = { name, t: 0, dur, flip, struck: false };
}

// ── Controller ───────────────────────────────────────────────────────────────
export function driveRagdoll(phys, rd) {
  const { x, y, z, px, py, pz, ax, ay, az, world } = phys;
  const b = rd.base;
  rd.t += DT;

  // Muscle ramp (knockdowns / death)
  if (rd.stun > 0) {
    rd.stun -= DT;
    rd.muscle = Math.max(0, rd.muscle - DT * 6);
  } else if (rd.targetMuscle > rd.muscle) {
    rd.muscle = Math.min(rd.targetMuscle, rd.muscle + DT * 1.6);
  } else if (rd.targetMuscle < rd.muscle) {
    rd.muscle = Math.max(rd.targetMuscle, rd.muscle - DT * 4);
  }
  const m = rd.muscle * rd.strength;
  if (m <= 0.01 && !rd.pinned) return;
  if (rd.sleeping) {
    rd.sleeping = false;
    rd.sleepTimer = 0;
  }

  const s = rd.scale;
  const invDT = 1 / DT;
  // heading → frame
  let dh = rd.targetHeading - rd.heading;
  while (dh > Math.PI) dh -= TAU;
  while (dh < -Math.PI) dh += TAU;
  const maxTurn = rd.turnRate * DT;
  rd.heading += Math.max(-maxTurn, Math.min(maxTurn, dh));
  let fx = Math.sin(rd.heading), fz = Math.cos(rd.heading), fy = 0;
  let ux = 0, uy = 1, uz = 0;
  if (rd.pinned && rd.pinned.fx !== undefined) {
    fx = rd.pinned.fx; fy = rd.pinned.fy; fz = rd.pinned.fz;
    ux = rd.pinned.ux; uy = rd.pinned.uy; uz = rd.pinned.uz;
  }
  // right = f × u
  const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;

  const P = b + PELVIS, N = b + NECK, H = b + HEAD;
  const wob = rd.wobble;
  const gc = GRAVITY * rd.gravityScale; // gravity compensation

  // Reference velocity (pelvis) so damping is relative to the body, not the world.
  const P0 = b + PELVIS;
  let rvx = (x[P0] - px[P0]) * invDT, rvy = (y[P0] - py[P0]) * invDT, rvz = (z[P0] - pz[P0]) * invDT;
  // spring helper (3D)
  const spring = (k, tx, ty, tz, kp, kd, comp = 0) => {
    const vx = (x[k] - px[k]) * invDT - rvx, vy = (y[k] - py[k]) * invDT - rvy, vz = (z[k] - pz[k]) * invDT - rvz;
    ax[k] += m * (kp * (tx - x[k]) - kd * vx);
    ay[k] += m * (kp * (ty - y[k]) - kd * vy + comp);
    az[k] += m * (kp * (tz - z[k]) - kd * vz);
  };

  if (rd.pinned) {
    const pn = rd.pinned;
    // Upper body upright relative to seat
    spring(N, x[P] + ux * 0.49 * s + fx * 0.04 * s, y[P] + uy * 0.49 * s + fy * 0.04 * s, z[P] + uz * 0.49 * s + fz * 0.04 * s, 260, 16, gc);
    spring(H, x[N] + ux * 0.26 * s, y[N] + uy * 0.26 * s, z[N] + uz * 0.26 * s, 160, 12, gc);
    const shT = (k, side) => spring(k, x[N] + rx * side * 0.21 * s - ux * 0.06 * s, y[N] + ry * side * 0.21 * s - uy * 0.06 * s, z[N] + rz * side * 0.21 * s - uz * 0.06 * s, 140, 10, gc);
    shT(b + LSH, -1); shT(b + RSH, 1);
    const hipT = (k, side) => spring(k, x[P] + rx * side * 0.11 * s - ux * 0.06 * s, y[P] + ry * side * 0.11 * s - uy * 0.06 * s, z[P] + rz * side * 0.11 * s - uz * 0.06 * s, 200, 14, gc);
    hipT(b + LHIP, -1); hipT(b + RHIP, 1);
    // legs: knees forward, feet down/forward
    if (!pn.legsFree) {
      for (const [kn, ft, side] of [[b + LKNEE, b + LFOOT, -1], [b + RKNEE, b + RFOOT, 1]]) {
        spring(kn, x[P] + rx * side * 0.12 * s + fx * 0.42 * s - ux * 0.02 * s, y[P] + ry * side * 0.12 * s + fy * 0.42 * s, z[P] + rz * side * 0.12 * s + fz * 0.42 * s, 110, 10, gc);
        spring(ft, x[P] + rx * side * 0.12 * s + fx * 0.5 * s - ux * 0.4 * s, y[P] + ry * side * 0.12 * s + fy * 0.5 * s - uy * 0.4 * s, z[P] + rz * side * 0.12 * s + fz * 0.5 * s - uz * 0.4 * s, 90, 9, 0);
      }
    }
    armTargets(phys, rd, m, pn.pose || 'sit', fx, fy, fz, ux, uy, uz, rx, ry, rz, spring);
    return;
  }

  // ── Standing balance ──
  const gP = world.heightAt(x[P], z[P]);
  const vPx = (x[P] - px[P]) * invDT, vPz = (z[P] - pz[P]) * invDT;
  const dvx = rd.vx, dvz = rd.vz;
  const desSpd = Math.sqrt(dvx * dvx + dvz * dvz);
  const actSpd = Math.sqrt(vPx * vPx + vPz * vPz);
  // gait
  const gaitSpd = Math.max(desSpd, actSpd * 0.85);
  let gdx = 0, gdz = 0;
  if (gaitSpd > 0.2) {
    if (actSpd > desSpd && actSpd > 0.3) {
      gdx = vPx / actSpd; gdz = vPz / actSpd;
    } else if (desSpd > 0) {
      gdx = dvx / desSpd; gdz = dvz / desSpd;
    }
  }
  const freq = 1.05 + (0.2 * gaitSpd) / Math.sqrt(s);
  const targetAmp = gaitSpd > 0.2 ? Math.min(0.46 * s, gaitSpd / (TAU * freq) * 1.15) : 0;
  rd.gaitAmp += (targetAmp - rd.gaitAmp) * Math.min(1, DT * 8);
  if (rd.gaitAmp > 0.01 || gaitSpd > 0.2) rd.phase += TAU * freq * DT;
  if (!(gdx || gdz)) {
    gdx = fx; gdz = fz;
  }
  const bob = Math.abs(Math.cos(rd.phase)) * 0.04 * s * Math.min(1, rd.gaitAmp / (0.2 * s));
  const hipHeight = (0.93 - rd.crouch) * s;
  // Pelvis: height + horizontal velocity
  {
    const vy = (y[P] - py[P]) * invDT;
    ay[P] += m * (260 * (gP + hipHeight - bob - y[P]) - 22 * vy + gc);
    ax[P] += m * 11 * (dvx - vPx);
    az[P] += m * 11 * (dvz - vPz);
  }
  // Neck upright with lean
  const lean = rd.lean + Math.min(0.12, gaitSpd * 0.025) * s;
  {
    const tx = x[P] + fx * lean, ty = y[P] + 0.49 * s, tz = z[P] + fz * lean;
    spring(N, tx, ty, tz, 230 * wob, 17, gc);
    const vNx = (x[N] - px[N]) * invDT, vNz = (z[N] - pz[N]) * invDT;
    ax[N] += m * 8 * (dvx - vNx);
    az[N] += m * 8 * (dvz - vNz);
    // extra help when lying down to get back up
    if (y[N] - y[P] < 0.25 * s) ay[N] += m * 60;
  }
  // Head (look direction optional)
  spring(H, x[N] + fx * 0.02 * s, y[N] + 0.26 * s, z[N] + fz * 0.02 * s, 150, 11, gc);
  // Facing: shoulders + hips
  const side = (k, anchor, off, dy, kp) => spring(k, x[anchor] + rx * off * s, y[anchor] + dy * s, z[anchor] + rz * off * s, kp, 10, gc);
  side(b + LSH, N, -0.21, -0.06, 150);
  side(b + RSH, N, 0.21, -0.06, 150);
  side(b + LHIP, P, -0.11, -0.06, 150);
  side(b + RHIP, P, 0.11, -0.06, 150);

  // Feet (gait or foot override for stomps)
  const lift = 0.17 * s * Math.min(1, 0.4 + gaitSpd * 0.25);
  const feet = [[b + LFOOT, b + LKNEE, b + LHIP, -1, rd.phase], [b + RFOOT, b + RKNEE, b + RHIP, 1, rd.phase + Math.PI]];
  for (let fi = 0; fi < 2; fi++) {
    const [F, Kn, Hp, sd, ph] = feet[fi];
    const baseX = x[P] + rx * sd * 0.13 * s, baseZ = z[P] + rz * sd * 0.13 * s;
    const off = Math.sin(ph) * rd.gaitAmp;
    const up = Math.max(0, Math.cos(ph)) * lift * (rd.gaitAmp > 0.02 * s ? 1 : 0);
    let tx = baseX + gdx * off, tz = baseZ + gdz * off;
    let ty = world.heightAt(tx, tz) + 0.08 * s + up;
    let kp = 380, kd = 26;
    if (rd.footOverride && rd.footOverride.foot === fi) {
      const o = rd.footOverride;
      tx = x[P] + rx * o.x * s + fx * o.z * s;
      tz = z[P] + rz * o.x * s + fz * o.z * s;
      ty = world.heightAt(tx, tz) + 0.08 * s + o.y * s;
      kp = o.k || 500; kd = 30;
    }
    // damp relative to the moving foot target (stance feet stay planted in world space)
    const wv = Math.cos(ph) * rd.gaitAmp * TAU * freq;
    const svx = rvx, svy = rvy, svz = rvz;
    rvx = vPx + gdx * wv; rvy = 0; rvz = vPz + gdz * wv;
    spring(F, tx, ty, tz, kp, kd, 0);
    rvx = svx; rvy = svy; rvz = svz;
    // knee forward
    spring(Kn, (x[Hp] + x[F]) * 0.5 + fx * 0.11 * s, (y[Hp] + y[F]) * 0.5 + 0.02 * s, (z[Hp] + z[F]) * 0.5 + fz * 0.11 * s, 55, 6, 0);
  }

  armTargets(phys, rd, m, rd.pose, fx, fy, fz, ux, uy, uz, rx, ry, rz, spring);
}

function armTargets(phys, rd, m, poseName, fx, fy, fz, ux, uy, uz, rx, ry, rz, spring) {
  const { x, y, z } = phys;
  const b = rd.base;
  const s = rd.scale;
  const N = b + NECK;
  let lh, rh, tip, k;
  if (rd.anim) {
    const A = ANIMS[rd.anim.name];
    k = sampleAnim(A, Math.min(1, rd.anim.t), rd.anim.flip);
    lh = _lh; rh = _rh; tip = _tip;
  } else {
    const pz = POSES[poseName] || POSES.idle;
    lh = pz.lh; rh = pz.rh; tip = pz.tip; k = pz.k;
    // walk arm swing / flail
    if (poseName === 'idle' || poseName === 'balloon') {
      const sw = Math.sin(rd.phase) * Math.min(0.22, rd.gaitAmp * 0.7) / s;
      _lh[0] = lh[0]; _lh[1] = lh[1]; _lh[2] = lh[2] + (poseName === 'balloon' ? 0 : sw);
      _rh[0] = rh[0]; _rh[1] = rh[1]; _rh[2] = rh[2] - sw;
      lh = _lh; rh = _rh;
    } else if (poseName === 'panic' || poseName === 'wheee') {
      const w = Math.sin(rd.t * 17) * 0.12;
      _lh[0] = lh[0]; _lh[1] = lh[1] + w; _lh[2] = lh[2];
      _rh[0] = rh[0]; _rh[1] = rh[1] - w; _rh[2] = rh[2];
      lh = _lh; rh = _rh;
    }
  }
  const kp = 170 * k, kd = 12 + 2 * k;
  const nx = x[N], ny = y[N], nz = z[N];
  const W = (v) => [
    nx + (rx * v[0] + ux * v[1] + fx * v[2]) * s,
    ny + (ry * v[0] + uy * v[1] + fy * v[2]) * s,
    nz + (rz * v[0] + uz * v[1] + fz * v[2]) * s,
  ];
  const L = W(lh), R = W(rh);
  spring(b + LHAND, L[0], L[1], L[2], kp, kd, GRAVITY * 0.6);
  spring(b + RHAND, R[0], R[1], R[2], kp, kd, GRAVITY * 0.6);
  // elbows: out and slightly back
  const le = b + LELB, re = b + RELB, ls = b + LSH, rs = b + RSH;
  spring(le, (x[ls] + L[0]) * 0.5 - rx * 0.07 * s - fx * 0.05 * s, (y[ls] + L[1]) * 0.5, (z[ls] + L[2]) * 0.5 - rz * 0.07 * s - fz * 0.05 * s, 45, 5, GRAVITY * 0.5);
  spring(re, (x[rs] + R[0]) * 0.5 + rx * 0.07 * s - fx * 0.05 * s, (y[rs] + R[1]) * 0.5, (z[rs] + R[2]) * 0.5 + rz * 0.07 * s - fz * 0.05 * s, 45, 5, GRAVITY * 0.5);
  // weapon tip
  if (rd.weaponLen > 0) {
    let tdx = rx * tip[0] + ux * tip[1] + fx * tip[2];
    let tdy = ry * tip[0] + uy * tip[1] + fy * tip[2];
    let tdz = rz * tip[0] + uz * tip[1] + fz * tip[2];
    const l = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz) || 1;
    const wl = rd.weaponLen * s / l;
    const h = b + RHAND;
    spring(b + TIP, x[h] + tdx * wl, y[h] + tdy * wl, z[h] + tdz * wl, 240 * Math.min(k, 2), 16, GRAVITY);
  }
}

// Advance attack animation; returns true on the frame the strike happens.
export function tickAnim(rd, dt) {
  const a = rd.anim;
  if (!a) return false;
  const A = ANIMS[a.name];
  a.t += dt / a.dur;
  let struck = false;
  if (!a.struck && a.t >= A.strike) {
    a.struck = true;
    struck = true;
  }
  if (A.foot) {
    // stomp: raise right foot then slam
    if (a.t < 0.45) rd.footOverride = { foot: 1, x: 0.14, y: 0.55 * Math.min(1, a.t / 0.35), z: 0.35, k: 420 };
    else if (a.t < 0.75) rd.footOverride = { foot: 1, x: 0.14, y: 0, z: 0.5, k: 900 };
    else rd.footOverride = null;
  }
  if (a.t >= 1) {
    rd.anim = null;
    rd.footOverride = null;
  }
  return struck;
}

// Knock a ragdoll around: velocity change + optional knockdown.
export function knock(phys, rd, dx, dy, dz, power, focus = -1) {
  if (rd.base < 0) return;
  const inv = 1 / Math.max(0.5, rd.mass);
  phys.impulse(rd, dx * power * inv, dy * power * inv, dz * power * inv, focus);
  const eff = power * inv;
  if (rd.muscle > 0 && rd.targetMuscle > 0 && eff > 7.5) {
    rd.stun = Math.max(rd.stun, Math.min(1.8, 0.25 + (eff - 7.5) * 0.12));
  }
}
