// Procedural model toolkit: merge primitives with per-vertex colours into
// single geometries (one draw call per model part).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export function colorize(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Colour faces by a function of their centroid (for stripes etc.)
export function colorizeFaces(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Vector3();
  for (let f = 0; f < n; f += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.x += pos.getX(f + k), c.y += pos.getY(f + k), c.z += pos.getZ(f + k);
    c.multiplyScalar(1 / 3);
    _c.set(fn(c, f / 3));
    for (let k = 0; k < 3; k++) {
      arr[(f + k) * 3] = _c.r;
      arr[(f + k) * 3 + 1] = _c.g;
      arr[(f + k) * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export class MB {
  constructor() {
    this.parts = [];
  }
  _push(geo, color, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) {
    let g = typeof color === 'function' ? colorizeFaces(geo, color) : colorize(geo, color);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this.parts.push(g);
    return g;
  }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return this._push(geo, color, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  addMatrix(geo, color, matrix) {
    let g = typeof color === 'function' ? colorizeFaces(geo, color) : colorize(geo, color);
    g.applyMatrix4(matrix);
    this.parts.push(g);
    return g;
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this._push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }
  cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 16, rx = 0, ry = 0, rz = 0, open = false) {
    return this._push(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, x, y, z, rx, ry, rz);
  }
  cone(r, h, color, x = 0, y = 0, z = 0, seg = 16, rx = 0, ry = 0, rz = 0) {
    return this._push(new THREE.ConeGeometry(r, h, seg), color, x, y, z, rx, ry, rz);
  }
  sphere(r, color, x = 0, y = 0, z = 0, ws = 14, hs = 10, sx = 1, sy = 1, sz = 1) {
    return this._push(new THREE.SphereGeometry(r, ws, hs), color, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  torus(R, r, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, rs = 8, ts = 32, arc = Math.PI * 2) {
    return this._push(new THREE.TorusGeometry(R, r, rs, ts, arc), color, x, y, z, rx, ry, rz);
  }
  lathe(points, color, x = 0, y = 0, z = 0, seg = 20, rx = 0, ry = 0, rz = 0) {
    const pts = points.map((p) => new THREE.Vector2(p[0], p[1]));
    return this._push(new THREE.LatheGeometry(pts, seg), color, x, y, z, rx, ry, rz);
  }
  // cylinder between two points
  beam(a, b, r, color, seg = 8) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    return this.addMatrix(geo, color, m);
  }
  empty() {
    return this.parts.length === 0;
  }
  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

// Bulb list builder: positions + colours + phases for the chasing-light shader
export class Bulbs {
  constructor() {
    this.pos = [];
    this.col = [];
    this.phase = [];
  }
  add(x, y, z, color, phase = 0) {
    this.pos.push(x, y, z);
    _c.set(color);
    this.col.push(_c.r, _c.g, _c.b);
    this.phase.push(phase);
  }
  ring(cx, cy, cz, R, n, colors, axis = 'y', phaseMul = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let x = cx, y = cy, z = cz;
      if (axis === 'y') { x += Math.cos(a) * R; z += Math.sin(a) * R; }
      else if (axis === 'z') { x += Math.cos(a) * R; y += Math.sin(a) * R; }
      else { y += Math.cos(a) * R; z += Math.sin(a) * R; }
      this.add(x, y, z, colors[i % colors.length], (i / n) * phaseMul);
    }
  }
  line(a, b, n, colors, phase0 = 0) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.add(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, colors[i % colors.length], phase0 + t);
    }
  }
  get count() {
    return this.phase.length;
  }
}
