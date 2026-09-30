// Roller coaster meshes: banked twin-rail track with spine, ties, supports and
// a four-car train that follows the simulated arc position.
import * as THREE from 'three';
import { TEAM_COLORS, COASTER } from '../config.js';
import { MB } from './geo.js';
import { MAT, addRim } from './materials.js';

// Tube swept along the design's banked frames.
function sweptTube(d, offR, offU, r, sides = 6, step = 1) {
  const n = Math.floor(d.n / step);
  const pos = new Float32Array(n * sides * 3);
  const nor = new Float32Array(n * sides * 3);
  for (let k = 0; k < n; k++) {
    const i = k * step;
    const cx = d.X[i] + d.RX[i] * offR + d.UX[i] * offU;
    const cy = d.Y[i] + d.RY[i] * offR + d.UY[i] * offU;
    const cz = d.Z[i] + d.RZ[i] * offR + d.UZ[i] * offU;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = d.RX[i] * ca + d.UX[i] * sa, ny = d.RY[i] * ca + d.UY[i] * sa, nz = d.RZ[i] * ca + d.UZ[i] * sa;
      const o = (k * sides + s) * 3;
      pos[o] = cx + nx * r; pos[o + 1] = cy + ny * r; pos[o + 2] = cz + nz * r;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    }
  }
  const idx = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a = k * sides + s, b = k2 * sides + s, c = k2 * sides + s2, e = k * sides + s2;
      idx.push(a, e, b, b, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function carGeo(teamColor, lead) {
  const b = new MB();
  b.box(1.3, 0.55, 2.3, teamColor, 0, 0.35, 0);
  b.box(1.34, 0.12, 2.34, 0xffffff, 0, 0.6, 0);
  for (const z of [0.5, -0.5]) {
    b.box(1.1, 0.5, 0.18, 0x2b2f38, 0, 0.75, z - 0.35);
    b.box(1.1, 0.12, 0.6, 0x2b2f38, 0, 0.45, z);
    b.box(1.05, 0.06, 0.06, 0xf2c14e, 0, 0.95, z + 0.1);
  }
  for (const x of [-0.5, 0.5]) for (const z of [-0.8, 0.8]) b.cyl(0.14, 0.14, 0.12, 0x444444, x, 0.05, z, 8, 0, 0, Math.PI / 2);
  if (lead) {
    b.sphere(0.7, teamColor, 0, 0.45, 1.25, 12, 8, 0.95, 0.55, 0.9);
    b.sphere(0.12, 0xffe066, 0.35, 0.55, 1.85, 6, 5);
    b.sphere(0.12, 0xffe066, -0.35, 0.55, 1.85, 6, 5);
  }
  return b.build();
}

export class CoasterRenderer {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.items = new Map();
    this.railMat = addRim(new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.3, metalness: 0.6 }), 0.8);
    this.previewGroup = null;
    this.f = {};
  }
  add(c) {
    if (this.items.has(c)) return;
    const grp = this.buildTrack(c.d, c.team, false);
    const cars = [];
    const tc = TEAM_COLORS[c.team];
    for (let i = 0; i < COASTER.cars; i++) {
      const m = new THREE.Mesh(carGeo(tc.main, i === 0), MAT.vcShiny);
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      grp.add(m);
      cars.push(m);
    }
    this.scene.add(grp);
    this.items.set(c, { grp, cars });
  }
  remove(c) {
    const it = this.items.get(c);
    if (!it) return;
    this.scene.remove(it.grp);
    it.grp.traverse((o) => o.geometry && o.geometry.dispose());
    this.items.delete(c);
  }
  buildTrack(d, team, preview) {
    const grp = new THREE.Group();
    const tc = TEAM_COLORS[team];
    const spineMat = preview ? new THREE.MeshBasicMaterial({ color: d.valid ? 0x7dffa0 : 0xff6b6b, transparent: true, opacity: 0.55 }) : addRim(new THREE.MeshStandardMaterial({ color: tc.main, roughness: 0.4, metalness: 0.3 }), 0.8);
    const railMat = preview ? spineMat : this.railMat;
    const step = 1;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(sweptTube(d, side * 0.42, 0.16, 0.075, 6, step), railMat);
      m.castShadow = !preview;
      grp.add(m);
    }
    const spine = new THREE.Mesh(sweptTube(d, 0, -0.14, 0.17, 8, step), spineMat);
    spine.castShadow = !preview;
    grp.add(spine);
    if (!preview) {
      // ties
      const tieGeo = new THREE.BoxGeometry(1.0, 0.09, 0.14);
      const nt = Math.floor(d.n / 2);
      const ties = new THREE.InstancedMesh(tieGeo, new THREE.MeshStandardMaterial({ color: 0x5c636e, roughness: 0.5, metalness: 0.4 }), nt);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < nt; k++) {
        const i = k * 2;
        // basis: X = right, Y = up, Z = tangent  (X = U × T... use -R for right-handedness)
        m4.set(
          -d.RX[i], d.UX[i], d.TX[i], d.X[i] + d.UX[i] * 0.05,
          -d.RY[i], d.UY[i], d.TY[i], d.Y[i] + d.UY[i] * 0.05,
          -d.RZ[i], d.UZ[i], d.TZ[i], d.Z[i] + d.UZ[i] * 0.05,
          0, 0, 0, 1
        );
        ties.setMatrixAt(k, m4);
      }
      ties.castShadow = true;
      grp.add(ties);
      // supports
      const sup = new MB();
      for (const s of d.supports) {
        const h = s.y1 - s.y0;
        sup.cyl(0.14, 0.18, h, 0xf4f1ea, s.x, s.y0 + h / 2, s.z, 8);
        sup.cyl(0.4, 0.45, 0.3, 0x9aa3ad, s.x, s.y0 + 0.15, s.z, 8);
        if (h > 6) sup.cyl(0.2, 0.2, 0.35, tc.main, s.x, s.y0 + h * 0.5, s.z, 8);
      }
      if (!sup.empty()) {
        const sm = new THREE.Mesh(sup.build(), MAT.vc);
        sm.castShadow = true;
        sm.receiveShadow = true;
        grp.add(sm);
      }
      // chain-lift teeth (dark strip on the lift)
      const lift = new MB();
      const liftEnd = Math.floor(d.liftEnd / d.ds);
      const sB = Math.floor(d.sB / d.ds);
      for (let i = sB; i < liftEnd; i += 2) {
        lift.box(0.16, 0.05, 0.3, 0x222222, d.X[i] + d.UX[i] * 0.02, d.Y[i] + d.UY[i] * 0.02, d.Z[i] + d.UZ[i] * 0.02, 0, Math.atan2(d.TX[i], d.TZ[i]), 0);
      }
      if (!lift.empty()) grp.add(new THREE.Mesh(lift.build(), MAT.vc));
    } else if (d.hits && d.hits.length) {
      const hm = new MB();
      for (const i of d.hits.slice(0, 60)) hm.sphere(0.5, 0xff3333, d.X[i], d.Y[i], d.Z[i], 6, 4);
      grp.add(new THREE.Mesh(hm.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    }
    return grp;
  }
  setPreview(d, team) {
    this.clearPreview();
    if (!d) return;
    this.previewGroup = this.buildTrack(d, team, true);
    this.scene.add(this.previewGroup);
  }
  clearPreview() {
    if (this.previewGroup) {
      this.scene.remove(this.previewGroup);
      this.previewGroup.traverse((o) => o.geometry && o.geometry.dispose());
      this.previewGroup = null;
    }
  }
  update(alpha) {
    const f = this.f;
    const m4 = new THREE.Matrix4();
    for (const [c, it] of this.items) {
      const T = c.train;
      const s0 = T.prevS + (T.s - T.prevS) * alpha;
      it.cars.forEach((car, i) => {
        c.frameAt(s0 - i * COASTER.carLength, f);
        if (c.building.ruined) {
          // derailed: tumble a little
          car.matrix.makeRotationFromEuler(new THREE.Euler(0.4 + i * 0.3, i, 0.6));
          car.matrix.setPosition(f.x + i * 0.6, this.game.world.heightAt(f.x, f.z) + 0.3, f.z);
        } else {
          car.matrix.set(
            -f.rx, f.ux, f.tx, f.x,
            -f.ry, f.uy, f.ty, f.y,
            -f.rz, f.uz, f.tz, f.z,
            0, 0, 0, 1
          );
        }
        car.matrixWorldNeedsUpdate = true;
      });
    }
  }
}
