// Instanced renderer for every wobbly body (units, guests, riders) + their hats,
// weapons, balloons and bumper cars.
import * as THREE from 'three';
import { UNIT_TYPES, TEAM_COLORS } from '../config.js';
import {
  HEAD, NECK, LSH, RSH, PELVIS, LHIP, RHIP, LELB, LHAND, RELB, RHAND, LKNEE, LFOOT, RKNEE, RFOOT, TIP,
} from '../sim/physics.js';
import { MB } from './geo.js';
import { addRim } from './materials.js';

const MAX = 620;
const C = (hex) => new THREE.Color(hex);
const WHITE = C(0xffffff);

function inst(geo, mat, count, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.count = 0;
  return m;
}

function accessoryGeos() {
  const G = {};
  let b;
  // Cap: dome + visor (white → tinted)
  b = new MB();
  b.sphere(1, 0xffffff, 0, 0, 0, 14, 8, 1, 0.55, 1);
  b.cyl(0.62, 0.62, 0.06, 0xffffff, 0, -0.05, 0.75, 16);
  G.cap = b.build();
  b = new MB();
  b.torus(0.95, 0.08, 0xffffff, 0, 0.05, 0, Math.PI / 2, 0, 0, 6, 20);
  b.cyl(0.55, 0.55, 0.05, 0xffffff, 0, 0.0, 0.85, 16);
  G.visor = b.build();
  b = new MB();
  b.cyl(0.62, 0.66, 1.1, 0x1c1c22, 0, 0.62, 0, 16);
  b.cyl(0.64, 0.68, 0.22, 0xffffff, 0, 0.18, 0, 16);
  b.cyl(1.15, 1.15, 0.06, 0x1c1c22, 0, 0.05, 0, 20);
  G.tophat = b.build();
  b = new MB();
  b.cyl(0.7, 0.62, 0.6, 0xffffff, 0, 0.35, 0, 14);
  b.sphere(0.55, 0xffffff, -0.3, 0.85, 0, 10, 8);
  b.sphere(0.6, 0xffffff, 0.25, 0.9, 0.1, 10, 8);
  b.sphere(0.5, 0xffffff, 0.05, 0.95, -0.3, 10, 8);
  G.chef = b.build();
  b = new MB();
  b.sphere(1.05, 0xffffff, 0, 0, 0, 16, 10, 1, 0.8, 1);
  b.box(1.2, 0.12, 0.35, 0x222222, 0, -0.2, 0.9);
  G.helmet = b.build();
  b = new MB();
  b.sphere(1.05, 0xd8dde6, 0, 0, 0, 16, 10, 1, 0.85, 1);
  b.cone(0.25, 0.6, 0xff3b3b, 0, 0.95, 0, 10);
  b.torus(1.0, 0.08, 0xffcc00, 0, -0.05, 0, Math.PI / 2, 0, 0, 6, 24);
  G.cannonhelm = b.build();
  b = new MB();
  const rainbow = [0xff3b3b, 0xffa53b, 0xffe83b, 0x3bff6e, 0x3bb7ff, 0xb03bff];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.sphere(0.42, rainbow[i % 6], Math.cos(a) * 0.9, 0.1 + Math.sin(i * 2.1) * 0.1, Math.sin(a) * 0.6 - 0.2, 10, 8);
  }
  G.clownhair = b.build();
  b = new MB();
  b.sphere(0.35, 0x8a5a33, -0.72, 0.72, -0.05, 10, 8, 1, 1, 0.6);
  b.sphere(0.35, 0x8a5a33, 0.72, 0.72, -0.05, 10, 8, 1, 1, 0.6);
  b.sphere(0.2, 0xf0b890, -0.72, 0.72, 0.05, 8, 6, 1, 1, 0.5);
  b.sphere(0.2, 0xf0b890, 0.72, 0.72, 0.05, 8, 6, 1, 1, 0.5);
  b.sphere(0.42, 0xd9a577, 0, -0.25, 0.8, 12, 8, 1, 0.8, 0.8);
  b.sphere(0.16, 0x221a14, 0, -0.1, 1.12, 8, 6);
  G.bear = b.build();
  b = new MB();
  b.sphere(0.32, 0x1a1a1a, -0.28, -0.32, 0.9, 8, 6, 1.4, 0.55, 0.7);
  b.sphere(0.32, 0x1a1a1a, 0.28, -0.32, 0.9, 8, 6, 1.4, 0.55, 0.7);
  G.mustache = b.build();
  b = new MB();
  b.cyl(1.25, 1.25, 0.05, 0xffffff, 0, -0.05, 0, 20);
  b.sphere(0.8, 0xffffff, 0, 0.1, 0, 12, 8, 1, 0.7, 1);
  b.torus(0.82, 0.1, 0xff5c8a, 0, 0.1, 0, Math.PI / 2, 0, 0, 6, 20);
  G.sunhat = b.build();
  b = new MB();
  b.sphere(1.02, 0xffffff, 0, 0.05, 0, 14, 8, 1, 0.7, 1);
  b.sphere(0.25, 0xffffff, 0, 0.78, 0, 8, 6);
  G.beanie = b.build();
  b = new MB();
  b.cyl(0.62, 0.62, 0.08, 0x111111, -0.62, 0.78, 0, 16, Math.PI / 2, 0, 0);
  b.cyl(0.62, 0.62, 0.08, 0x111111, 0.62, 0.78, 0, 16, Math.PI / 2, 0, 0);
  b.torus(0.95, 0.06, 0x111111, 0, 0.1, 0, 0, 0, 0, 6, 16, Math.PI);
  G.ears = b.build();
  b = new MB();
  b.sphere(1.0, 0xffffff, 0, 0, 0, 12, 8, 1, 0.55, 1);
  b.cyl(0.05, 0.05, 0.5, 0x333333, 0, 0.7, 0, 6);
  b.box(1.4, 0.04, 0.22, 0xffd23f, 0, 0.95, 0);
  G.propeller = b.build();
  // weapons: local +Y = handle direction (hand → tip), length normalised to 1
  b = new MB();
  b.cyl(0.035, 0.035, 1.0, 0xb07a45, 0, 0.5, 0, 6);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.cyl(0.03, 0.05, 0.36, 0xe9e4d4, Math.cos(a) * 0.07, 1.08, Math.sin(a) * 0.07, 5, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  b.cyl(0.1, 0.1, 0.07, 0x8f96a3, 0, 0.97, 0, 10);
  G.mop = b.build();
  b = new MB();
  b.cyl(0.045, 0.045, 1.0, 0x8b5a2b, 0, 0.5, 0, 6);
  b.cyl(0.24, 0.24, 0.62, (c) => (Math.abs(c.x) > 0.2 ? 0xffffff : 0xe23b3b), 0, 1.0, 0, 16, 0, 0, Math.PI / 2);
  b.cyl(0.25, 0.25, 0.05, 0xf2c14e, 0.31, 1.0, 0, 16, 0, 0, Math.PI / 2);
  b.cyl(0.25, 0.25, 0.05, 0xf2c14e, -0.31, 1.0, 0, 16, 0, 0, Math.PI / 2);
  G.mallet = b.build();
  b = new MB();
  b.cyl(0.035, 0.035, 0.28, 0x3b2314, 0, 0.14, 0, 6);
  b.cyl(0.018, 0.008, 0.75, 0x6b3a1e, 0, 0.66, 0, 5);
  G.whip = b.build();
  b = new MB();
  b.cyl(0.14, 0.17, 1.0, (c) => (Math.floor((c.y + 0.5) * 6) % 2 ? 0xff3b3b : 0xffffff), 0, 0.45, 0, 14);
  b.torus(0.16, 0.04, 0xf2c14e, 0, 0.95, 0, Math.PI / 2, 0, 0, 6, 14);
  b.sphere(0.12, 0xfff3c4, 0, 1.0, 0, 8, 6);
  b.sphere(0.1, 0xfff3c4, 0.08, 1.02, 0.05, 6, 5);
  G.popgun = b.build();
  // bumper car (local: +z forward, y up)
  b = new MB();
  b.box(1.35, 0.42, 1.95, 0xffffff, 0, 0.42, 0);
  b.box(1.2, 0.34, 0.7, 0xffffff, 0, 0.75, -0.55);
  b.torus(1.08, 0.17, 0x1b1b1b, 0, 0.26, 0, Math.PI / 2, 0, 0, 8, 28);
  b.cyl(0.03, 0.03, 2.4, 0xc0c6cf, 0, 1.75, -0.85, 6);
  b.sphere(0.07, 0xffe066, 0, 2.95, -0.85, 6, 5);
  b.cyl(0.2, 0.2, 0.04, 0x222222, 0, 0.85, 0.45, 12, 0.9, 0, 0);
  b.cyl(0.03, 0.03, 0.4, 0x444444, 0, 0.7, 0.4, 5, 0.9, 0, 0);
  b.sphere(0.12, 0xffe066, 0.42, 0.52, 0.99, 8, 6);
  b.sphere(0.12, 0xffe066, -0.42, 0.52, 0.99, 8, 6);
  G.car = b.build();
  b = new MB();
  b.sphere(1, 0xffffff, 0, 0, 0, 16, 12, 0.85, 1.0, 0.85);
  b.cone(0.12, 0.18, 0xffffff, 0, -1.02, 0, 8, Math.PI, 0, 0);
  G.balloon = b.build();
  b = new MB();
  b.sphere(1, 0xfffdf5, 0, 0, 0, 10, 8, 1, 0.55, 0.45);
  b.sphere(0.4, 0xff4d6d, 0.1, 0.3, 0.2, 6, 5);
  G.pieface = b.build();
  return G;
}

export class RagdollRenderer {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.group = new THREE.Group();
    scene.add(this.group);
    const skinMat = addRim(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), 1.1);
    const clothMat = addRim(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 }), 1.0);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.2 });
    const vcMat = addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }), 1.0);
    const shinyMat = addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15 }), 1.2);
    this.mats = { skinMat, clothMat, eyeMat, vcMat, shinyMat };
    const torsoGeo = new THREE.CapsuleGeometry(0.5, 1.0, 6, 12);
    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const smallSphere = new THREE.SphereGeometry(1, 10, 8);
    const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 9, 1, true);
    const eyeGeo = new THREE.SphereGeometry(1, 8, 6);
    this.torso = inst(torsoGeo, clothMat, MAX);
    this.head = inst(sphereGeo, skinMat, MAX);
    this.limb = inst(limbGeo, clothMat, MAX * 8);
    this.joint = inst(smallSphere, clothMat, MAX * 8);
    this.eye = inst(eyeGeo, eyeMat, MAX * 2, false);
    this.nose = inst(smallSphere, skinMat, 200, false);
    for (const m of [this.torso, this.head, this.limb, this.joint, this.eye, this.nose]) this.group.add(m);
    const G = accessoryGeos();
    this.acc = {};
    const accCounts = { cap: 250, visor: 120, tophat: 60, chef: 60, helmet: 80, cannonhelm: 60, clownhair: 120, bear: 80, mustache: 60, sunhat: 120, beanie: 120, ears: 120, propeller: 120, mop: 200, mallet: 80, whip: 60, popgun: 80, car: 80, balloon: 200, pieface: 150 };
    for (const [k, n] of Object.entries(accCounts)) {
      const m = inst(G[k], k === 'balloon' || k === 'car' ? shinyMat : vcMat, n);
      this.acc[k] = m;
      this.group.add(m);
    }
    this.string = inst(new THREE.CylinderGeometry(0.006, 0.006, 1, 3, 1, true), new THREE.MeshBasicMaterial({ color: 0xeeeeee }), 200, false);
    this.group.add(this.string);
    this.flash = new Map(); // ragdoll → flash timer
    this._v = {};
    this.tmpA = new THREE.Vector3();
  }

  onHit(unit) {
    if (unit && unit.rd) this.flash.set(unit.rd, performance.now() + 110);
  }

  look(rd) {
    if (rd._look) return rd._look;
    const o = rd.owner;
    const L = {};
    if (rd.kind === 'unit') {
      const def = UNIT_TYPES[o.type];
      const tc = TEAM_COLORS[o.team];
      const team = C(tc.main), teamLight = C(tc.light), teamDark = C(tc.dark);
      const lk = def.look;
      const skins = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
      let skin = C(skins[o.id % skins.length]);
      if (lk.skin === 'pale') skin = C(0xfff0e6);
      if (lk.skin === 'tan') skin = C(0xd9a066);
      L.skin = skin;
      L.shirt = lk.shirt === 'team' ? team : lk.shirt === 'stripes' ? teamLight : lk.shirt === 'fur' ? team : C(lk.shirt);
      L.arms = lk.shirt === 'fur' ? C(lk.fur) : L.shirt;
      L.pants = lk.pants === 'team' ? team : lk.pants === 'team2' ? teamDark : lk.pants === 'fur' ? C(lk.fur) : C(lk.pants);
      L.shoes = C(0x2a2320);
      L.hands = lk.shirt === 'fur' ? C(lk.fur) : skin;
      L.hat = lk.hat;
      L.hatColor = team;
      L.weapon = def.weapon;
      L.headScale = 1;
      if (lk.hat === 'bearhead') {
        L.hat = 'bear';
        L.hatColor = WHITE;
        L.skin = C(lk.fur);
        L.headScale = 1.4;
      }
      if (lk.skin === 'balloon') {
        L.skin = teamLight;
        L.shirt = team;
        L.arms = teamLight;
        L.pants = team;
        L.hands = teamLight;
        L.shoes = teamDark;
        L.headScale = 1.15;
      }
      if (lk.hat === 'clownhair') L.nose = C(0xff2222);
      if (lk.hat === 'mustache') L.hatColor = WHITE;
      if (lk.hat === 'cannonhelm' || lk.hat === 'clownhair') L.hatColor = WHITE;
      if (lk.hat === 'chef') L.hatColor = WHITE;
      if (lk.hat === 'tophat') L.hatColor = team;
      if (lk.hat === 'helmet') L.hatColor = team;
      if (lk.face) L.skin = C(lk.face);
    } else {
      const lk = o.look;
      L.skin = C(lk.skin);
      L.shirt = C(lk.shirt);
      L.arms = L.shirt;
      L.pants = C(lk.pants);
      L.shoes = C(0x3a3330);
      L.hands = L.skin;
      L.hat = lk.hat;
      L.hatColor = C(lk.hatColor);
      L.weapon = 'none';
      L.headScale = lk.kid ? 1.12 : 1;
    }
    rd._look = L;
    return L;
  }

  update(alpha) {
    const g = this.game;
    const P = g.phys;
    const a = alpha;
    const ia = 1 - alpha;
    const X = (k) => P.rx[k] * ia + P.x[k] * a;
    const Y = (k) => P.ry[k] * ia + P.y[k] * a;
    const Z = (k) => P.rz[k] * ia + P.z[k] * a;
    const counters = { torso: 0, head: 0, limb: 0, joint: 0, eye: 0, nose: 0, string: 0 };
    const accN = {};
    for (const k in this.acc) accN[k] = 0;
    const tm = this.torso.instanceMatrix.array, tc = this.torso.instanceColor.array;
    const hm = this.head.instanceMatrix.array, hc = this.head.instanceColor.array;
    const lm = this.limb.instanceMatrix.array, lc = this.limb.instanceColor.array;
    const jm = this.joint.instanceMatrix.array, jc = this.joint.instanceColor.array;
    const em = this.eye.instanceMatrix.array;
    const nm = this.nose.instanceMatrix.array, nc = this.nose.instanceColor.array;
    const hidden = g.hideTeamUnits; // fog of war during prep
    const pos = new Float32Array(16 * 3);
    // flash timers (wall-clock so paused/fast-forwarded frames behave)
    const nowMs = performance.now();
    for (const [rd, t] of this.flash) if (t <= nowMs) this.flash.delete(rd);
    for (const rd of P.active) {
      if (rd.base < 0) continue;
      const o = rd.owner;
      if (!o) continue;
      if (rd.kind === 'unit' && hidden !== undefined && hidden >= 0 && o.team === hidden && o.alive) continue;
      const L = this.look(rd);
      const b = rd.base;
      const s = rd.scale;
      for (let i = 0; i < 16; i++) {
        pos[i * 3] = X(b + i);
        pos[i * 3 + 1] = Y(b + i);
        pos[i * 3 + 2] = Z(b + i);
      }
      const fl = this.flash.get(rd) || 0;
      const flashK = fl > 0 ? 0.7 : 0;
      // ── torso frame ──
      const px = pos[PELVIS * 3], py = pos[PELVIS * 3 + 1], pz = pos[PELVIS * 3 + 2];
      const nx = pos[NECK * 3], ny = pos[NECK * 3 + 1], nz = pos[NECK * 3 + 2];
      let ux = nx - px, uy = ny - py, uz = nz - pz;
      const tl = Math.hypot(ux, uy, uz) || 1;
      ux /= tl; uy /= tl; uz /= tl;
      let rx = pos[RSH * 3] - pos[LSH * 3], ry = pos[RSH * 3 + 1] - pos[LSH * 3 + 1], rz = pos[RSH * 3 + 2] - pos[LSH * 3 + 2];
      let d = rx * ux + ry * uy + rz * uz;
      rx -= d * ux; ry -= d * uy; rz -= d * uz;
      let rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      // forward = up × right  (right = forward × up in the sim convention)
      let fx = uy * rz - uz * ry, fy = uz * rx - ux * rz, fz = ux * ry - uy * rx;
      // torso: capsule scaled
      {
        const i = counters.torso++;
        const cx = (px + nx) / 2, cy = (py + ny) / 2 + 0.02 * s, cz = (pz + nz) / 2;
        const w = 0.58 * s * (rd.kind === 'unit' && o.type === 'mascot' ? 1.2 : 1);
        const h = tl * 0.6 + 0.07 * s;
        const dd = 0.42 * s * (rd.kind === 'unit' && o.type === 'mascot' ? 1.25 : 1);
        writeBasis(tm, i, cx, cy, cz, -rx * w, -ry * w, -rz * w, ux * h, uy * h, uz * h, fx * dd, fy * dd, fz * dd);
        writeColor(tc, i, L.shirt, flashK);
      }
      // head
      const hx = pos[HEAD * 3], hy = pos[HEAD * 3 + 1], hz = pos[HEAD * 3 + 2];
      let hux = hx - nx, huy = hy - ny, huz = hz - nz;
      const hl = Math.hypot(hux, huy, huz) || 1;
      hux /= hl; huy /= hl; huz /= hl;
      // head forward: torso forward orthogonalised to head up
      let hfx = fx, hfy = fy, hfz = fz;
      d = hfx * hux + hfy * huy + hfz * huz;
      hfx -= d * hux; hfy -= d * huy; hfz -= d * huz;
      const hfl = Math.hypot(hfx, hfy, hfz) || 1;
      hfx /= hfl; hfy /= hfl; hfz /= hfl;
      // hl = up × forward = LEFT (model +X)
      const hrx = huy * hfz - huz * hfy, hry = huz * hfx - hux * hfz, hrz = hux * hfy - huy * hfx;
      const hr = 0.225 * s * L.headScale;
      {
        const i = counters.head++;
        writeBasis(hm, i, hx, hy, hz, hrx * hr, hry * hr, hrz * hr, hux * hr * 0.96, huy * hr * 0.96, huz * hr * 0.96, hfx * hr, hfy * hr, hfz * hr);
        writeColor(hc, i, L.skin, flashK);
      }
      // eyes (dead units get X-ish squashed eyes)
      const dead = rd.kind === 'unit' && !o.alive;
      for (const side of [-1, 1]) {
        const i = counters.eye++;
        const er = 0.034 * s * (L.headScale > 1.3 ? 1.3 : 1) * (rd.kind === 'unit' && o.type === 'giant' ? 1.6 : 1);
        const ex = hx + hfx * hr * 0.9 + hrx * side * hr * 0.38 + hux * hr * 0.12;
        const ey = hy + hfy * hr * 0.9 + hry * side * hr * 0.38 + huy * hr * 0.12;
        const ez = hz + hfz * hr * 0.9 + hrz * side * hr * 0.38 + huz * hr * 0.12;
        const sq = dead ? 0.25 : 1;
        writeBasis(em, i, ex, ey, ez, hrx * er, hry * er, hrz * er, hux * er * 1.25 * sq, huy * er * 1.25 * sq, huz * er * 1.25 * sq, hfx * er * 0.5, hfy * er * 0.5, hfz * er * 0.5);
      }
      if (L.nose) {
        const i = counters.nose++;
        const nr = 0.05 * s;
        writeBasis(nm, i, hx + hfx * hr * 1.0, hy + hfy * hr * 1.0 - 0.02 * s, hz + hfz * hr * 1.0, nr, 0, 0, 0, nr, 0, 0, 0, nr);
        writeColor(nc, i, L.nose, 0);
      }
      // limbs
      const limbs = [
        [LSH, LELB, 0.088, L.arms], [LELB, LHAND, 0.075, L.arms], [RSH, RELB, 0.088, L.arms], [RELB, RHAND, 0.075, L.arms],
        [LHIP, LKNEE, 0.11, L.pants], [LKNEE, LFOOT, 0.092, L.pants], [RHIP, RKNEE, 0.11, L.pants], [RKNEE, RFOOT, 0.092, L.pants],
      ];
      for (const [A, B, r, col] of limbs) {
        const i = counters.limb++;
        const ax = pos[A * 3], ay = pos[A * 3 + 1], az = pos[A * 3 + 2];
        const bx = pos[B * 3], by = pos[B * 3 + 1], bz = pos[B * 3 + 2];
        writeCylinder(lm, i, ax, ay, az, bx, by, bz, r * s * (o.type === 'mascot' ? 1.35 : o.type === 'strongman' && A !== LHIP && A !== RHIP && A !== LKNEE && A !== RKNEE ? 1.3 : 1));
        writeColor(lc, i, col, flashK);
      }
      // joints: elbows, knees, hands, feet
      const joints = [
        [LELB, 0.086, L.arms, 1, 1, 1], [RELB, 0.086, L.arms, 1, 1, 1], [LKNEE, 0.104, L.pants, 1, 1, 1], [RKNEE, 0.104, L.pants, 1, 1, 1],
        [LHAND, 0.095, L.hands, 1, 1, 1], [RHAND, 0.095, L.hands, 1, 1, 1],
      ];
      const mk = o.type === 'mascot' ? 1.35 : 1;
      for (const [J, r, col] of joints) {
        const i = counters.joint++;
        const rr = r * s * mk;
        writeBasis(jm, i, pos[J * 3], pos[J * 3 + 1], pos[J * 3 + 2], rr, 0, 0, 0, rr, 0, 0, 0, rr);
        writeColor(jc, i, col, flashK);
      }
      // feet: ellipsoids pointing forward
      for (const F of [LFOOT, RFOOT]) {
        const i = counters.joint++;
        const ffx = fx, ffz = fz;
        const fl2 = Math.hypot(ffx, ffz) || 1;
        const sx = 0.09 * s * mk, sy = 0.07 * s * mk, sz = 0.15 * s * mk;
        writeBasis(jm, i, pos[F * 3] + (ffx / fl2) * 0.04 * s, pos[F * 3 + 1] - 0.02 * s, pos[F * 3 + 2] + (ffz / fl2) * 0.04 * s,
          (ffz / fl2) * sx, 0, (-ffx / fl2) * sx, 0, sy, 0, (ffx / fl2) * sz, 0, (ffz / fl2) * sz);
        writeColor(jc, i, L.shoes, 0);
      }
      // hat
      if (L.hat && this.acc[L.hat]) {
        const m = this.acc[L.hat];
        const i = accN[L.hat]++;
        if (i < m.instanceMatrix.count) {
          const hs = hr;
          let oy = 0.55, sc = 1;
          if (L.hat === 'tophat') oy = 0.8;
          if (L.hat === 'cap' || L.hat === 'visor') oy = 0.45;
          if (L.hat === 'helmet' || L.hat === 'cannonhelm' || L.hat === 'beanie') oy = 0.25;
          if (L.hat === 'bear' || L.hat === 'mustache' || L.hat === 'ears') oy = 0;
          if (L.hat === 'clownhair') { oy = 0.3; sc = 1.05; }
          if (L.hat === 'chef') oy = 0.6;
          if (L.hat === 'sunhat') oy = 0.62;
          if (L.hat === 'propeller') oy = 0.5;
          const k = hs * sc;
          writeBasis(m.instanceMatrix.array, i, hx + hux * hs * oy, hy + huy * hs * oy, hz + huz * hs * oy, hrx * k, hry * k, hrz * k, hux * k, huy * k, huz * k, hfx * k, hfy * k, hfz * k);
          writeColor(m.instanceColor.array, i, L.hatColor, 0);
        }
      }
      // pie in the face
      if (rd.kind === 'unit' && o.pieFace > 0 && o.alive) {
        const m = this.acc.pieface;
        const i = accN.pieface++;
        const k = hr * 0.75;
        writeBasis(m.instanceMatrix.array, i, hx + hfx * hr * 0.75, hy + hfy * hr * 0.75, hz + hfz * hr * 0.75, hrx * k, hry * k, hrz * k, hux * k, huy * k, huz * k, hfx * k, hfy * k, hfz * k);
        writeColor(m.instanceColor.array, i, WHITE, 0);
      }
      // weapon
      if (L.weapon && L.weapon !== 'none' && this.acc[L.weapon] && rd.weaponLen > 0) {
        const m = this.acc[L.weapon];
        const i = accN[L.weapon]++;
        if (i < m.instanceMatrix.count) {
          const hxp = pos[RHAND * 3], hyp = pos[RHAND * 3 + 1], hzp = pos[RHAND * 3 + 2];
          let wx = pos[TIP * 3] - hxp, wy = pos[TIP * 3 + 1] - hyp, wz = pos[TIP * 3 + 2] - hzp;
          const wl = Math.hypot(wx, wy, wz) || 1;
          wx /= wl; wy /= wl; wz /= wl;
          // perpendicular basis
          let px2 = fy * wz - fz * wy, py2 = fz * wx - fx * wz, pz2 = fx * wy - fy * wx;
          let pl = Math.hypot(px2, py2, pz2);
          if (pl < 1e-3) { px2 = rx; py2 = ry; pz2 = rz; pl = 1; }
          px2 /= pl; py2 /= pl; pz2 /= pl;
          const qx = wy * pz2 - wz * py2, qy = wz * px2 - wx * pz2, qz = wx * py2 - wy * px2;
          const len = rd.weaponLen * s;
          const back = L.weapon === 'mop' || L.weapon === 'mallet' ? 0.25 : L.weapon === 'popgun' ? 0.35 : 0.05;
          const k = s * (L.weapon === 'popgun' ? 1.0 : 1);
          writeBasis(m.instanceMatrix.array, i, hxp - wx * len * back, hyp - wy * len * back, hzp - wz * len * back,
            -px2 * k, -py2 * k, -pz2 * k, wx * len * (1 + back), wy * len * (1 + back), wz * len * (1 + back), qx * k, qy * k, qz * k);
          writeColor(m.instanceColor.array, i, WHITE, 0);
        }
      }
      // guest balloon
      if (rd.kind === 'guest' && o.look.balloon) {
        const m = this.acc.balloon;
        const i = accN.balloon++;
        const t = g.time;
        const lhx = pos[LHAND * 3], lhy = pos[LHAND * 3 + 1], lhz = pos[LHAND * 3 + 2];
        const bx = lhx + Math.sin(t * 1.3 + o.id) * 0.25, by = lhy + 1.15, bz = lhz + Math.cos(t * 1.1 + o.id) * 0.25;
        const k = 0.28;
        writeBasis(m.instanceMatrix.array, i, bx, by, bz, k, 0, 0, 0, k * 1.1, 0, 0, 0, k);
        writeColor(m.instanceColor.array, i, C(o.look.balloon), 0);
        const si = counters.string++;
        writeCylinder(this.string.instanceMatrix.array, si, lhx, lhy, lhz, bx, by - 0.3, bz, 1);
      }
    }
    // Bumper cars
    const car = this.acc.car;
    for (let team = 0; team < 2; team++) {
      if (hidden !== undefined && hidden === team) continue;
      for (const u of g.units[team]) {
        if (!u.vehicle || u.removed) continue;
        const v = u.vehicle;
        const i = accN.car++;
        const vx = v.px !== undefined ? v.px * (1 - a) + v.x * a : v.x;
        const vz = v.pz !== undefined ? v.pz * (1 - a) + v.z * a : v.z;
        const h = v.h;
        const gy = g.world.heightAt(vx, vz);
        const c = Math.cos(h), sn = Math.sin(h);
        const wreck = v.wreck;
        const tilt = wreck ? 0.5 : 0;
        writeBasis(car.instanceMatrix.array, i, vx, gy + (wreck ? 0.1 : 0), vz, c, tilt, -sn, 0, wreck ? 0.6 : 1, 0, sn, 0, c);
        const col = wreck ? C(0x333333) : C(TEAM_COLORS[team].main);
        writeColor(car.instanceColor.array, i, col, this.flash.get(u.rd) ? 0.5 : 0);
      }
    }
    this.torso.count = counters.torso;
    this.head.count = counters.head;
    this.limb.count = counters.limb;
    this.joint.count = counters.joint;
    this.eye.count = counters.eye;
    this.nose.count = counters.nose;
    this.string.count = counters.string;
    for (const m of [this.torso, this.head, this.limb, this.joint, this.eye, this.nose, this.string]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (const k in this.acc) {
      const m = this.acc[k];
      m.count = Math.min(accN[k], m.instanceMatrix.count);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }
}

function writeBasis(arr, i, x, y, z, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const o = i * 16;
  arr[o] = ax; arr[o + 1] = ay; arr[o + 2] = az; arr[o + 3] = 0;
  arr[o + 4] = bx; arr[o + 5] = by; arr[o + 6] = bz; arr[o + 7] = 0;
  arr[o + 8] = cx; arr[o + 9] = cy; arr[o + 10] = cz; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}
function writeColor(arr, i, c, flash) {
  const o = i * 3;
  arr[o] = c.r + (1 - c.r) * flash;
  arr[o + 1] = c.g + (1 - c.g) * flash;
  arr[o + 2] = c.b + (1 - c.b) * flash;
}
// unit cylinder (height 1 along Y) stretched from A to B with radius r (right-handed basis)
function writeCylinder(arr, i, ax, ay, az, bx, by, bz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz) || 1e-4;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  // p = a × u with a = up (or x if nearly vertical)
  let px, py, pz;
  if (Math.abs(uy) < 0.9) { px = uz; py = 0; pz = -ux; } // (0,1,0) × u
  else { px = 0; py = -uz; pz = uy; } // (1,0,0) × u
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  // q = p × u  → (p, u, q) is right-handed
  const qx = py * uz - pz * uy, qy = pz * ux - px * uz, qz = px * uy - py * ux;
  writeBasis(arr, i, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, px * r, py * r, pz * r, dx, dy, dz, qx * r, qy * r, qz * r);
}
