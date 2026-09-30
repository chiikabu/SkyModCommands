// ─────────────────────────────────────────────────────────────────────────────
//  Procedural models for every attraction. Each factory returns a THREE.Group
//  facing +Z (entrance side) centred on its footprint, plus named animated parts.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { MB, Bulbs } from './geo.js';
import { MAT, bulbMesh } from './materials.js';

const TAU = Math.PI * 2;
const GOLD = 0xf2c14e;
const WHITE = 0xfaf6ef;
const PASTELS = [0xff8fab, 0x8ecae6, 0xffd166, 0xb8f2a6, 0xcdb4db, 0xffb4a2];
const BULB_COLS = [0xffe8a3, 0xfff4d6, 0xffb347];

const _tints = new Map();
function tintMat(color) {
  if (!_tints.has(color)) {
    const m = MAT.vc.clone();
    m.color = new THREE.Color(color);
    m.onBeforeCompile = MAT.vc.onBeforeCompile;
    m.customProgramCacheKey = MAT.vc.customProgramCacheKey;
    _tints.set(color, m);
  }
  return _tints.get(color);
}

function mesh(geo, mat = MAT.vc, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// striped colour function around the Y axis
const stripes = (a, b, n) => (c) => (Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / TAU) * n) % 2 ? a : b);

export function textSign(text, w = 512, h = 128, bg = '#b3122e', fg = '#ffe9a8') {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  const grd = c.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, bg);
  grd.addColorStop(1, shade(bg, -30));
  c.fillStyle = grd;
  roundRect(c, 4, 4, w - 8, h - 8, 26);
  c.fill();
  c.lineWidth = 8;
  c.strokeStyle = '#f2c14e';
  c.stroke();
  c.fillStyle = fg;
  c.font = `bold ${Math.floor(h * 0.5)}px "Lilita One", "Arial Black", Impact, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowBlur = 6;
  c.shadowOffsetY = 4;
  let size = Math.floor(h * 0.5);
  while (c.measureText(text).width > w - 50 && size > 10) {
    size -= 2;
    c.font = `bold ${size}px "Lilita One", "Arial Black", Impact, sans-serif`;
  }
  c.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ── Castle ──────────────────────────────────────────────────────────────────
export function makeCastle(teamColor, teamLight) {
  const g = new THREE.Group();
  const b = new MB();
  const stone = 0xf3ead8, stone2 = 0xe2d5bd, roof = teamColor;
  // plinth + keep
  b.box(12, 1, 12, 0xcfc2a8, 0, 0.5, 0);
  b.box(8.5, 9, 8.5, stone, 0, 5.5, 0);
  // crenellations on keep
  for (let i = -4; i <= 4; i += 1.6) {
    for (const [x, z] of [[i, 4.25], [i, -4.25], [4.25, i], [-4.25, i]]) b.box(0.8, 0.8, 0.8, stone2, x, 10.4, z);
  }
  // corner towers
  for (const [x, z] of [[5, 5], [-5, 5], [5, -5], [-5, -5]]) {
    b.cyl(1.55, 1.7, 12, stone, x, 6.5, z, 18);
    b.cyl(1.9, 1.9, 0.6, stone2, x, 12.6, z, 18);
    b.cone(2.1, 4.6, roof, x, 15.2, z, 18);
    b.sphere(0.25, GOLD, x, 17.6, z, 8, 6);
    b.cyl(0.05, 0.05, 1.6, 0x666666, x, 18.3, z, 5);
  }
  // central tower
  b.cyl(2.3, 2.5, 8, stone, 0, 14, 0, 20);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    b.box(0.6, 0.7, 0.6, stone2, Math.cos(a) * 2.35, 18.3, Math.sin(a) * 2.35, 0, -a, 0);
  }
  b.cone(2.7, 7, roof, 0, 21.8, 0, 20);
  b.sphere(0.35, GOLD, 0, 25.5, 0, 10, 8);
  b.cyl(0.06, 0.06, 2.4, 0x666666, 0, 26.6, 0, 5);
  // gate arch
  b.box(3.4, 4.8, 0.6, 0x5a3d2b, 0, 3.4, 4.3);
  b.cyl(1.7, 1.7, 0.62, 0x5a3d2b, 0, 5.8, 4.3, 16, Math.PI / 2, 0, 0);
  b.box(4.4, 0.5, 0.8, GOLD, 0, 7.6, 4.35);
  // side battlements
  b.box(12.5, 3, 1, stone2, 0, 2, 6.1);
  // balcony
  b.box(4, 0.3, 1.2, stone2, 0, 9, 4.8);
  g.add(mesh(b.build()));
  // windows (glow)
  const w = new MB();
  for (const [x, y, z, ry] of [[-2, 6.5, 4.26, 0], [2, 6.5, 4.26, 0], [-2, 6.5, -4.26, 0], [2, 6.5, -4.26, 0], [4.26, 6.5, 0, Math.PI / 2], [-4.26, 6.5, 0, Math.PI / 2], [0, 15, 2.51, 0], [0, 15, -2.51, 0]]) {
    w.box(0.8, 1.3, 0.12, 0xffd27a, x, y, z, 0, ry, 0);
  }
  for (const [x, z] of [[5, 5], [-5, 5], [5, -5], [-5, -5]]) w.box(0.5, 0.9, 0.12, 0xffd27a, x + Math.sign(x) * 0.1, 9, z + Math.sign(z) * 1.62, 0, 0, 0);
  const win = new THREE.Mesh(w.build(), MAT.window);
  g.add(win);
  g.userData.windows = win;
  // flags
  const fg = new MB();
  for (const [x, y, z] of [[5, 18.8, 5], [-5, 18.8, 5], [5, 18.8, -5], [-5, 18.8, -5], [0, 27.3, 0]]) {
    const f = new THREE.PlaneGeometry(1.8, 1.0, 6, 2);
    f.translate(0.9, 0, 0);
    fg.add(f, teamLight, x, y, z);
  }
  const flags = new THREE.Mesh(fg.build(), MAT.flag);
  flags.castShadow = true;
  g.add(flags);
  // bulbs
  const bl = new Bulbs();
  bl.line([-4.3, 10.9, 4.3], [4.3, 10.9, 4.3], 14, BULB_COLS);
  bl.line([4.3, 10.9, -4.3], [-4.3, 10.9, -4.3], 14, BULB_COLS);
  bl.line([4.3, 10.9, 4.3], [4.3, 10.9, -4.3], 14, BULB_COLS);
  bl.line([-4.3, 10.9, -4.3], [-4.3, 10.9, 4.3], 14, BULB_COLS);
  for (const [x, z] of [[5, 5], [-5, 5], [5, -5], [-5, -5]]) bl.ring(x, 12.95, z, 1.95, 14, BULB_COLS);
  bl.ring(0, 18.75, 0, 2.5, 18, BULB_COLS);
  g.add(bulbMesh(bl, 0.12));
  return { group: g };
}

// ── Park gate ───────────────────────────────────────────────────────────────
export function makeGate(parkName, teamColor, teamCss) {
  const g = new THREE.Group();
  const b = new MB();
  for (const side of [-1, 1]) {
    b.cyl(0.8, 0.95, 7.5, 0xf3ead8, side * 3.2, 3.75, 0, 16);
    b.cyl(1.0, 1.0, 0.5, GOLD, side * 3.2, 7.6, 0, 16);
    b.cone(1.1, 2.2, teamColor, side * 3.2, 8.9, 0, 16);
    b.sphere(0.25, GOLD, side * 3.2, 10.1, 0, 8, 6);
    // ticket booths
    b.box(1.6, 2.4, 1.6, 0xfff1d6, side * 5.8, 1.2, 0.8);
    b.box(2.0, 0.3, 2.0, teamColor, side * 5.8, 2.55, 0.8);
    b.cone(1.4, 1.2, 0xffffff, side * 5.8, 3.3, 0.8, 4, 0, Math.PI / 4, 0);
  }
  b.box(7.6, 0.5, 0.6, GOLD, 0, 6.9, 0);
  b.torus(3.2, 0.22, GOLD, 0, 6.2, 0, 0, 0, 0, 8, 24, Math.PI);
  g.add(mesh(b.build()));
  const tex = textSign(parkName.toUpperCase(), 1024, 200, teamCss, '#fff4c2');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  sign.position.set(0, 8.2, 0.35);
  g.add(sign);
  const bl = new Bulbs();
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI;
    bl.add(Math.cos(a) * 3.2, 6.2 + Math.sin(a) * 3.2, 0.25, BULB_COLS[i % 3], i / 20);
  }
  for (const side of [-1, 1]) bl.line([side * 3.2 + 0.85, 0.8, 0], [side * 3.2 + 0.85, 7.2, 0], 8, BULB_COLS);
  g.add(bulbMesh(bl, 0.11));
  return { group: g };
}

// ── Carousel ────────────────────────────────────────────────────────────────
export function makeCarousel(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.cyl(4.9, 5.1, 0.6, 0x9b6b43, 0, 0.3, 0, 32);
  b.torus(4.95, 0.12, GOLD, 0, 0.6, 0, Math.PI / 2, 0, 0, 6, 40);
  // steps at the entrance
  b.box(2.2, 0.3, 0.8, 0x9b6b43, 0, 0.15, 5.2);
  g.add(mesh(b.build()));
  const rotor = new THREE.Group();
  const r = new MB();
  r.cyl(4.6, 4.6, 0.18, 0xf7e7ce, 0, 0.7, 0, 32);
  r.cyl(0.75, 0.75, 5, (c) => (Math.floor(c.y * 1.4) % 2 ? GOLD : 0xffffff), 0, 3.2, 0, 16);
  r.cyl(1.2, 1.2, 0.5, teamColor, 0, 5.4, 0, 16);
  // mirrored centre panels
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    r.box(0.9, 1.6, 0.08, 0xbfe6ff, Math.cos(a) * 0.78, 3.4, Math.sin(a) * 0.78, 0, -a + Math.PI / 2, 0);
  }
  // canopy
  r.cone(5.4, 2.4, stripes(teamColor, 0xffffff, 24), 0, 6.8, 0, 24);
  r.cyl(5.4, 5.4, 0.5, stripes(GOLD, teamColor, 48), 0, 5.4, 0, 48, 0, 0, 0, true);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    r.sphere(0.32, i % 2 ? teamColor : 0xffffff, Math.cos(a) * 5.35, 5.05, Math.sin(a) * 5.35, 8, 6, 1, 0.7, 0.4);
  }
  r.sphere(0.45, GOLD, 0, 8.2, 0, 10, 8);
  // poles
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const R = i % 2 ? 3.2 : 4.1;
    r.cyl(0.05, 0.05, 4.5, GOLD, Math.cos(a) * R, 3.0, Math.sin(a) * R, 6);
  }
  const rotMesh = mesh(r.build());
  rotor.add(rotMesh);
  // horses (animated bob)
  const horses = [];
  const hg = new MB();
  hg.sphere(0.55, 0xffffff, 0, 0, 0, 12, 8, 0.6, 0.55, 1.2);
  hg.cyl(0.16, 0.2, 0.7, 0xffffff, 0, 0.35, 0.55, 8, -0.6, 0, 0);
  hg.box(0.28, 0.32, 0.55, 0xffffff, 0, 0.7, 0.8, -0.3, 0, 0);
  hg.box(0.08, 0.35, 0.3, 0x5a3d2b, 0, 0.72, 0.5, -0.4, 0, 0);
  for (const [x, z, rx] of [[0.2, 0.45, 0.5], [-0.2, 0.45, 0.8], [0.2, -0.5, -0.5], [-0.2, -0.5, -0.2]]) hg.cyl(0.07, 0.06, 0.8, 0xffffff, x, -0.45, z, 6, rx, 0, 0);
  hg.box(0.5, 0.12, 0.6, 0xe63946, 0, 0.3, 0);
  hg.cone(0.14, 0.5, 0x5a3d2b, 0, 0.1, -0.65, 6, -2.2, 0, 0);
  const horseGeo = hg.build();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const R = i % 2 ? 3.2 : 4.1;
    const h = mesh(horseGeo, tintMat(PASTELS[i % PASTELS.length]));
    h.position.set(Math.cos(a) * R, 1.3, Math.sin(a) * R);
    h.rotation.y = -a; // face tangentially
    rotor.add(h);
    horses.push(h);
  }
  const bl = new Bulbs();
  bl.ring(0, 5.12, 0, 5.62, 48, BULB_COLS, 'y', 2);
  bl.ring(0, 5.7, 0, 5.62, 48, [0xff6b6b, 0xfff4d6], 'y', 2);
  rotor.add(bulbMesh(bl, 0.1));
  g.add(rotor);
  return { group: g, rotor, horses };
}

// ── Teacups ─────────────────────────────────────────────────────────────────
export function makeTeacups(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.cyl(4.9, 5.0, 0.35, 0xf1e3c8, 0, 0.18, 0, 32);
  b.torus(4.95, 0.12, teamColor, 0, 0.35, 0, Math.PI / 2, 0, 0, 6, 40);
  g.add(mesh(b.build()));
  const plate = new THREE.Group();
  const p = new MB();
  p.cyl(4.5, 4.5, 0.15, stripes(0xfff8ee, 0xffd8e4, 16), 0, 0.42, 0, 32);
  // teapot centerpiece
  p.lathe([[0, 0], [1.1, 0.1], [1.35, 0.8], [1.2, 1.5], [0.6, 1.9], [0.25, 2.1], [0.35, 2.3], [0, 2.4]], 0xffffff, 0, 0.5, 0, 20);
  p.torus(0.5, 0.12, 0xffffff, -1.35, 1.55, 0, 0, 0, 0, 6, 14);
  p.cyl(0.12, 0.28, 1.2, 0xffffff, 1.5, 1.6, 0, 8, 0, 0, -0.9);
  p.sphere(0.18, teamColor, 0, 3.0, 0, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    p.sphere(0.12, teamColor, Math.cos(a) * 1.3, 1.2, Math.sin(a) * 1.3, 6, 5);
  }
  plate.add(mesh(p.build()));
  const cups = [];
  const cupGeoFor = (col) => {
    const c = new MB();
    c.cyl(1.35, 1.35, 0.1, 0xffffff, 0, 0.05, 0, 20);
    c.lathe([[0, 0], [0.8, 0.05], [1.15, 0.45], [1.25, 1.0], [1.18, 1.02], [1.08, 0.5], [0.7, 0.15], [0, 0.12]], col, 0, 0.1, 0, 22);
    c.torus(0.32, 0.08, col, 1.3, 0.6, 0, 0, 0, 0, 6, 12);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      c.sphere(0.1, 0xffffff, Math.cos(a) * 1.18, 0.7, Math.sin(a) * 1.18, 6, 5);
    }
    c.cyl(0.08, 0.08, 0.7, GOLD, 0, 0.45, 0, 6);
    c.cyl(0.4, 0.4, 0.12, GOLD, 0, 0.75, 0, 12);
    return c.build();
  };
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const cup = mesh(cupGeoFor(PASTELS[i]));
    cup.position.set(Math.cos(a) * 3.2, 0.5, Math.sin(a) * 3.2);
    plate.add(cup);
    cups.push(cup);
  }
  g.add(plate);
  const bl = new Bulbs();
  bl.ring(0, 0.45, 0, 4.95, 44, BULB_COLS, 'y', 3);
  g.add(bulbMesh(bl, 0.09));
  return { group: g, plate, cups };
}

// ── Pirate ship ─────────────────────────────────────────────────────────────
export function makePirate(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  // A-frames at both sides (x = ±3.3), pivot at y = 8
  for (const side of [-1, 1]) {
    b.beam([side * 3.3, 0, -3.2], [side * 3.3, 8.2, 0], 0.22, 0x6d7b8c);
    b.beam([side * 3.3, 0, 3.2], [side * 3.3, 8.2, 0], 0.22, 0x6d7b8c);
    b.box(0.6, 0.3, 7.2, 0x55606e, side * 3.3, 0.15, 0);
  }
  b.cyl(0.22, 0.22, 7.0, GOLD, 0, 8, 0, 10, 0, 0, Math.PI / 2);
  b.box(6.4, 0.2, 2.2, 0x9b6b43, 0, 0.1, 6.5);
  g.add(mesh(b.build()));
  const swing = new THREE.Group();
  swing.position.y = 8;
  const s = new MB();
  // arms
  for (const side of [-1, 1]) {
    s.beam([side * 1.6, 0, 0], [side * 1.2, -5.2, -1.6], 0.12, 0x6d7b8c);
    s.beam([side * 1.6, 0, 0], [side * 1.2, -5.2, 1.6], 0.12, 0x6d7b8c);
  }
  // hull: planked tapered shape
  const hull = new THREE.CylinderGeometry(1.6, 0.9, 9.6, 10, 4, false, Math.PI, Math.PI);
  hull.rotateX(Math.PI / 2);
  hull.rotateZ(Math.PI);
  s.add(hull, (c) => (Math.floor((c.y + 10) * 2.2) % 2 ? 0x7a4a2a : 0x8f5a33), 0, -5.6, 0);
  s.box(3.0, 0.2, 9.0, 0xb07a45, 0, -5.4, 0);
  // bow + stern
  s.cone(1.2, 2.4, 0x7a4a2a, 0, -5.4, 5.6, 8, Math.PI / 2, 0, 0);
  s.cone(1.2, 2.4, 0x7a4a2a, 0, -5.4, -5.6, 8, -Math.PI / 2, 0, 0);
  s.box(3.3, 0.25, 9.8, GOLD, 0, -5.15, 0);
  // benches
  for (let k = 0; k < 8; k++) s.box(2.6, 0.35, 0.35, 0x5a3d2b, 0, -5.1, (k - 3.5) * 1.1);
  // mast & sail
  s.cyl(0.12, 0.14, 4.8, 0x5a3d2b, 0, -2.9, 0.2, 8);
  const sail = new THREE.CylinderGeometry(2.2, 2.2, 2.4, 10, 1, true, -0.5, 1.0);
  s.add(sail, 0xfdf6e3, 0, -2.4, -1.9);
  s.box(0.9, 0.55, 0.05, 0x111111, 0, -0.3, 0.2);
  s.sphere(0.12, 0xffffff, 0, -0.25, 0.25, 6, 4);
  // cannons
  for (const side of [-1, 1]) for (const z of [-2, 0, 2]) s.cyl(0.12, 0.14, 0.7, 0x222222, side * 1.65, -5.0, z, 8, 0, 0, Math.PI / 2);
  // stripe in team colour
  s.box(3.25, 0.3, 9.4, teamColor, 0, -5.6, 0);
  const swingMesh = mesh(s.build());
  swing.add(swingMesh);
  const bl = new Bulbs();
  bl.line([-1.62, -5.05, -4.5], [-1.62, -5.05, 4.5], 12, BULB_COLS);
  bl.line([1.62, -5.05, -4.5], [1.62, -5.05, 4.5], 12, BULB_COLS);
  swing.add(bulbMesh(bl, 0.1));
  g.add(swing);
  return { group: g, swing };
}

// ── Ferris wheel ────────────────────────────────────────────────────────────
export function makeFerris(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  for (const z of [-1.3, 1.3]) {
    b.beam([-4.2, 0, z * 1.5], [0, 9, z], 0.25, 0xe8e8ee);
    b.beam([4.2, 0, z * 1.5], [0, 9, z], 0.25, 0xe8e8ee);
  }
  b.cyl(0.35, 0.35, 3.2, 0x999fa8, 0, 9, 0, 12, Math.PI / 2, 0, 0);
  b.box(7, 0.3, 3.6, 0xf1e3c8, 0, 0.15, 0);
  b.box(2.2, 2.2, 1.2, 0xfff1d6, 5.8, 1.1, 1.6);
  b.box(2.6, 0.3, 1.6, teamColor, 5.8, 2.35, 1.6);
  g.add(mesh(b.build()));
  const wheel = new THREE.Group();
  wheel.position.y = 9;
  const w = new MB();
  for (const z of [-0.7, 0.7]) {
    w.torus(7.4, 0.14, 0xffffff, 0, 0, z, 0, 0, 0, 6, 64);
    w.torus(5.2, 0.09, teamColor, 0, 0, z, 0, 0, 0, 6, 48);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      w.beam([0, 0, z], [Math.cos(a) * 7.4, Math.sin(a) * 7.4, z], 0.05, 0xdadde3, 5);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    w.beam([Math.cos(a) * 7.4, Math.sin(a) * 7.4, -0.7], [Math.cos(a) * 7.4, Math.sin(a) * 7.4, 0.7], 0.06, 0xffffff, 5);
  }
  w.cyl(0.8, 0.8, 1.8, GOLD, 0, 0, 0, 16, Math.PI / 2, 0, 0);
  wheel.add(mesh(w.build()));
  const bl = new Bulbs();
  bl.ring(0, 0, 0.78, 7.4, 64, [0xff5e7e, 0xffe066, 0x66e0ff, 0x9dff66], 'z', 4);
  bl.ring(0, 0, -0.78, 7.4, 64, [0xff5e7e, 0xffe066, 0x66e0ff, 0x9dff66], 'z', 4);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    bl.line([Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.8], [Math.cos(a) * 7.0, Math.sin(a) * 7.0, 0.8], 7, BULB_COLS, i / 16);
  }
  wheel.add(bulbMesh(bl, 0.1));
  g.add(wheel);
  // gondolas (kept upright)
  const gondolas = [];
  for (let i = 0; i < 8; i++) {
    const c = new MB();
    const col = PASTELS[i % PASTELS.length];
    c.box(1.6, 0.9, 1.5, col, 0, -0.9, 0);
    c.box(1.7, 0.12, 1.6, 0xffffff, 0, -0.42, 0);
    c.cone(1.15, 0.6, col, 0, 0.35, 0, 4, 0, Math.PI / 4, 0);
    c.cyl(0.04, 0.04, 0.9, 0xcccccc, 0, 0.1, 0, 5);
    c.box(1.62, 0.08, 1.52, GOLD, 0, -0.45, 0);
    const m = mesh(c.build());
    g.add(m);
    gondolas.push(m);
  }
  return { group: g, wheel, gondolas };
}

// ── Drop tower ──────────────────────────────────────────────────────────────
export function makeDropTower(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.cyl(2.9, 3.0, 0.4, 0xf1e3c8, 0, 0.2, 0, 24);
  b.cyl(0.85, 1.0, 26, (c) => (Math.floor(c.y / 2.5) % 2 ? 0xffffff : teamColor), 0, 13, 0, 16);
  b.cyl(1.6, 1.1, 1.6, 0x333a44, 0, 26.6, 0, 16);
  b.cone(1.5, 2.6, teamColor, 0, 28.7, 0, 16);
  b.sphere(0.3, 0xff3b3b, 0, 30.2, 0, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    b.box(0.25, 1.0, 0.25, 0xcfd3d9, Math.cos(a) * 2.85, 0.9, Math.sin(a) * 2.85);
  }
  g.add(mesh(b.build()));
  const bl = new Bulbs();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    bl.line([Math.cos(a) * 1.02, 1, Math.sin(a) * 1.02], [Math.cos(a) * 0.88, 25.5, Math.sin(a) * 0.88], 26, [0xff5e7e, 0xffe066, 0x66e0ff], k * 0.25);
  }
  bl.ring(0, 27.4, 0, 1.62, 16, BULB_COLS);
  g.add(bulbMesh(bl, 0.1));
  const car = new THREE.Group();
  const c = new MB();
  c.torus(1.7, 0.35, 0x2b2f38, 0, 0, 0, Math.PI / 2, 0, 0, 10, 32);
  c.cyl(1.25, 1.25, 1.2, 0x333a44, 0, 0.3, 0, 16, 0, 0, 0, true);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    c.box(0.55, 0.9, 0.5, i % 2 ? teamColor : 0xffd166, Math.cos(a) * 1.75, 0.2, Math.sin(a) * 1.75, 0, -a, 0);
  }
  car.add(mesh(c.build()));
  g.add(car);
  return { group: g, car };
}

// ── Human cannon show ───────────────────────────────────────────────────────
export function makeCannonShow(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.box(6, 0.35, 10, stripes(0xfff1d6, 0xffe0a8, 12), 0, 0.17, 0);
  // net at the back
  b.torus(1.9, 0.12, 0xffffff, 0, 1.4, -3.5, Math.PI / 2, 0, 0, 6, 24);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    b.beam([Math.cos(a) * 1.9, 0.3, -3.5 + Math.sin(a) * 1.9], [Math.cos(a) * 1.9, 1.4, -3.5 + Math.sin(a) * 1.9], 0.07, 0xcccccc);
  }
  for (let k = -3; k <= 3; k++) {
    b.box(3.6, 0.03, 0.03, 0xffffff, 0, 1.3, -3.5 + k * 0.5);
    b.box(0.03, 0.03, 3.6, 0xffffff, k * 0.5, 1.3, -3.5);
  }
  // stars
  for (let i = 0; i < 6; i++) b.cone(0.4, 0.2, 0xffd166, -2.4 + (i % 2) * 4.8, 0.45, -4 + Math.floor(i / 2) * 3.5, 5);
  // booth
  b.box(1.4, 2.2, 1.4, teamColor, 2.1, 1.1, 3.8);
  b.cone(1.1, 1.0, 0xffffff, 2.1, 2.7, 3.8, 4, 0, Math.PI / 4, 0);
  g.add(mesh(b.build()));
  // cannon (yaw group → pitch group)
  const yaw = new THREE.Group();
  yaw.position.set(0, 0.4, 2.4);
  const base = new MB();
  base.box(1.8, 0.8, 2.2, 0x6d4a2c, 0, 0.4, 0);
  for (const side of [-1, 1]) {
    base.cyl(0.65, 0.65, 0.2, 0x5a3d2b, side * 1.0, 0.6, 0.3, 16, 0, 0, Math.PI / 2);
    base.torus(0.6, 0.08, GOLD, side * 1.1, 0.6, 0.3, 0, Math.PI / 2, 0, 6, 16);
  }
  yaw.add(mesh(base.build()));
  const pitch = new THREE.Group();
  pitch.position.set(0, 1.2, 0);
  const bar = new MB();
  bar.cyl(0.55, 0.7, 3.6, (c) => (Math.floor((c.y + 2) * 2.2) % 2 ? teamColor : 0xffffff), 0, 1.4, 0, 18);
  bar.torus(0.58, 0.1, GOLD, 0, 3.2, 0, Math.PI / 2, 0, 0, 6, 18);
  bar.sphere(0.7, 0x333333, 0, 0, 0, 12, 8);
  pitch.add(mesh(bar.build()));
  pitch.rotation.x = -0.75; // tilt barrel (group local +Y) toward -z
  yaw.add(pitch);
  yaw.rotation.y = Math.PI; // aim at the net by default
  g.add(yaw);
  const bl = new Bulbs();
  bl.line([-2.9, 0.4, 4.9], [2.9, 0.4, 4.9], 12, BULB_COLS);
  bl.line([-2.9, 0.4, -4.9], [2.9, 0.4, -4.9], 12, BULB_COLS);
  bl.line([-2.9, 0.4, -4.9], [-2.9, 0.4, 4.9], 18, BULB_COLS);
  bl.line([2.9, 0.4, -4.9], [2.9, 0.4, 4.9], 18, BULB_COLS);
  g.add(bulbMesh(bl, 0.09));
  return { group: g, yaw, pitch };
}

// ── Food stalls ─────────────────────────────────────────────────────────────
function kiosk(b, teamColor, awning = 0xff5e5e) {
  b.box(3.2, 2.2, 2.6, 0xfff1d6, 0, 1.1, -0.2);
  b.box(3.4, 0.2, 0.7, 0xb07a45, 0, 1.2, 1.25);
  const aw = new THREE.CylinderGeometry(0.75, 0.75, 3.4, 12, 1, false, 0, Math.PI);
  aw.rotateZ(Math.PI / 2);
  b.add(aw, (c) => (Math.floor((c.x + 2) * 2.2) % 2 ? awning : 0xffffff), 0, 2.45, 1.0);
  b.box(3.4, 0.35, 2.8, teamColor, 0, 2.4, -0.2);
}
export function makeBurger(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  kiosk(b, teamColor, 0xff5e5e);
  b.sphere(1.1, 0xe0a14a, 0, 3.65, -0.2, 16, 8, 1, 0.45, 1);
  b.cyl(1.2, 1.2, 0.3, 0x6b3a1e, 0, 3.2, -0.2, 16);
  b.cyl(1.25, 1.25, 0.12, 0x6bd65a, 0, 3.05, -0.2, 16);
  b.box(1.9, 0.08, 1.9, 0xffd23f, 0, 3.38, -0.2, 0, 0.4, 0);
  b.cyl(1.1, 1.05, 0.35, 0xe0a14a, 0, 2.85, -0.2, 16);
  for (let i = 0; i < 7; i++) b.sphere(0.06, 0xfff3c4, Math.cos(i) * 0.6, 4.0, -0.2 + Math.sin(i * 1.7) * 0.6, 5, 4, 1, 0.5, 1.4);
  g.add(mesh(b.build()));
  return { group: g };
}
export function makeSoda(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  kiosk(b, teamColor, 0x3bb7ff);
  b.cyl(0.9, 0.6, 1.9, (c) => (Math.floor((c.y + 3) * 2) % 2 ? 0xff3b3b : 0xffffff), 0, 3.55, -0.2, 16);
  b.cyl(0.95, 0.95, 0.15, 0xffffff, 0, 4.55, -0.2, 16);
  b.cyl(0.07, 0.07, 1.4, 0x3bff8f, 0.3, 5.1, -0.2, 6, 0, 0, -0.3);
  g.add(mesh(b.build()));
  return { group: g };
}
export function makeBalloonCart(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.box(2.2, 1.0, 1.4, 0xfff1d6, 0, 0.9, 0);
  b.box(2.3, 0.15, 1.5, teamColor, 0, 1.45, 0);
  for (const x of [-0.8, 0.8]) b.torus(0.4, 0.08, 0x5a3d2b, x, 0.45, 0.75, 0, 0, 0, 6, 16);
  b.cyl(0.04, 0.04, 2.4, 0xcccccc, 0, 2.6, 0, 5);
  g.add(mesh(b.build()));
  const balloons = new THREE.Group();
  const bb = new MB();
  const cols = [0xff4d6d, 0xffd60a, 0x4cc9f0, 0x80ed99, 0xc77dff, 0xff9f1c];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const x = Math.cos(a) * 0.7, z = Math.sin(a) * 0.7, y = 4.2 + Math.sin(i * 2.3) * 0.4;
    bb.sphere(0.42, cols[i % cols.length], x, y, z, 12, 10, 0.85, 1, 0.85);
    bb.beam([0, 3.7, 0], [x, y - 0.4, z], 0.01, 0xffffff, 3);
  }
  const bm = new THREE.Mesh(bb.build(), MAT.vcShiny);
  bm.castShadow = true;
  balloons.add(bm);
  g.add(balloons);
  return { group: g, balloons };
}

// ── Defenses ────────────────────────────────────────────────────────────────
export function makeTurret(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.box(3.4, 1.4, 3.0, (c) => (Math.floor((c.x + 3) * 1.6) % 2 ? 0xff3b3b : 0xffffff), 0, 0.9, 0);
  b.box(3.6, 0.25, 3.2, teamColor, 0, 1.7, 0);
  for (const [x, z] of [[1.5, 1.3], [-1.5, 1.3], [1.5, -1.3], [-1.5, -1.3]]) b.torus(0.35, 0.09, 0x333333, x, 0.35, z, 0, Math.PI / 2, 0, 6, 14);
  b.cyl(0.9, 1.1, 0.5, 0x444c56, 0, 2.05, 0, 16);
  g.add(mesh(b.build()));
  const yaw = new THREE.Group();
  yaw.position.y = 2.3;
  const t = new MB();
  t.cyl(1.05, 0.75, 1.6, (c) => (Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / TAU) * 12) % 2 ? 0xff3b3b : 0xffffff), 0, 0.8, 0, 16);
  for (let i = 0; i < 14; i++) t.sphere(0.2, i % 3 ? 0xfff3c4 : 0xffe28a, Math.cos(i * 2.4) * 0.6, 1.65 + (i % 3) * 0.12, Math.sin(i * 2.4) * 0.6, 6, 5);
  t.cyl(0.32, 0.38, 2.0, 0x2b2f38, 0, 1.0, 0.9, 12, Math.PI / 2 - 0.5, 0, 0);
  t.torus(0.34, 0.07, GOLD, 0, 1.45, 1.8, Math.PI / 2 - 0.5 + Math.PI / 2, 0, 0, 6, 12);
  yaw.add(mesh(t.build()));
  g.add(yaw);
  const bl = new Bulbs();
  bl.line([-1.7, 1.85, 1.6], [1.7, 1.85, 1.6], 8, BULB_COLS);
  bl.line([-1.7, 1.85, -1.6], [1.7, 1.85, -1.6], 8, BULB_COLS);
  g.add(bulbMesh(bl, 0.08));
  return { group: g, yaw };
}
export function makeFountain(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.cyl(2.9, 3.0, 0.7, 0xd8d2c4, 0, 0.35, 0, 28);
  b.cyl(2.6, 2.6, 0.72, 0xbfb6a3, 0, 0.36, 0, 28, 0, 0, 0, true);
  b.cyl(0.45, 0.6, 2.2, 0xe8e2d4, 0, 1.4, 0, 14);
  b.lathe([[0, 0], [1.3, 0.05], [1.45, 0.45], [1.3, 0.5], [0.3, 0.3]], 0xe8e2d4, 0, 2.4, 0, 20);
  b.cyl(0.25, 0.3, 1.0, 0xe8e2d4, 0, 3.1, 0, 10);
  b.sphere(0.35, teamColor, 0, 3.8, 0, 12, 8);
  g.add(mesh(b.build()));
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.55, 32), new THREE.MeshStandardMaterial({ color: 0x55c9ea, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.62;
  g.add(water);
  const w2 = water.clone();
  w2.scale.setScalar(0.5);
  w2.position.y = 2.8;
  g.add(w2);
  const jets = new THREE.Group();
  const jm = new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.6, 6, 1, true), jm);
    j.position.set(Math.cos(a) * 1.9, 1.3, Math.sin(a) * 1.9);
    j.rotation.z = Math.cos(a) * -0.4;
    j.rotation.x = Math.sin(a) * 0.4;
    jets.add(j);
  }
  g.add(jets);
  const bl = new Bulbs();
  bl.ring(0, 0.75, 0, 2.95, 28, [0x66e0ff, 0xffffff, 0x9d7bff]);
  g.add(bulbMesh(bl, 0.08));
  return { group: g, jets, water };
}

// ── Coaster station ─────────────────────────────────────────────────────────
export function makeStation(teamColor) {
  const g = new THREE.Group();
  const b = new MB();
  b.box(4, 0.7, 18, 0xe6dccb, 0, 0.35, 0);
  b.box(1.3, 0.72, 18, 0x9aa3ad, -1.2, 0.36, 0);
  for (const z of [-8, -4, 0, 4, 8]) for (const x of [-1.9, 1.9]) b.cyl(0.12, 0.12, 3.4, 0xffffff, x, 2.05, z, 8);
  const roof = new THREE.CylinderGeometry(2.6, 2.6, 18.6, 12, 1, false, 0, Math.PI);
  roof.rotateX(Math.PI / 2);
  roof.rotateZ(Math.PI / 2);
  roof.scale(1, 0.45, 1);
  b.add(roof, (c) => (Math.floor((c.z + 10) / 1.5) % 2 ? teamColor : 0xffffff), 0, 3.7, 0);
  b.box(0.1, 0.9, 16, 0xf2c14e, 1.95, 1.15, 0);
  g.add(mesh(b.build()));
  const bl = new Bulbs();
  bl.line([-2.3, 3.75, -9.2], [-2.3, 3.75, 9.2], 22, BULB_COLS);
  bl.line([2.3, 3.75, -9.2], [2.3, 3.75, 9.2], 22, BULB_COLS);
  g.add(bulbMesh(bl, 0.09));
  return { group: g };
}

// ── Rubble ──────────────────────────────────────────────────────────────────
export function makeRubble(w, d, seed = 1) {
  const g = new THREE.Group();
  const b = new MB();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < Math.max(6, (w * d) / 2); i++) {
    const x = (rnd() - 0.5) * w * 1.6, z = (rnd() - 0.5) * d * 1.6;
    const sz = 0.3 + rnd() * 0.9;
    const cols = [0x6b6258, 0x857a6d, 0x4a423a, 0x9b6b43, 0x3a3530];
    b.box(sz, sz * 0.6, sz * 1.2, cols[Math.floor(rnd() * cols.length)], x, sz * 0.25, z, rnd() * 2, rnd() * 3, rnd() * 2);
  }
  b.cyl(w * 0.8, w * 0.9, 0.12, 0x2e2a26, 0, 0.06, 0, 16);
  g.add(mesh(b.build()));
  return { group: g };
}

// ── Scenery (geometries for instancing) ─────────────────────────────────────
export function sceneryGeos() {
  const G = {};
  let b = new MB();
  b.cyl(0.14, 0.2, 2.2, 0x7a5232, 0, 1.1, 0, 7);
  b.sphere(1.05, 0x3f8f3a, 0, 2.7, 0, 10, 8);
  b.sphere(0.8, 0x4fa644, 0.55, 2.35, 0.3, 9, 7);
  b.sphere(0.75, 0x5bb54e, -0.5, 2.5, -0.25, 9, 7);
  b.sphere(0.7, 0x4a9e40, 0.1, 3.35, -0.2, 9, 7);
  G.tree = b.build();
  b = new MB();
  b.cyl(0.12, 0.18, 1.2, 0x6b4428, 0, 0.6, 0, 6);
  b.cone(1.2, 1.8, 0x2f6e3b, 0, 1.9, 0, 9);
  b.cone(0.95, 1.6, 0x357d43, 0, 2.9, 0, 9);
  b.cone(0.65, 1.4, 0x3c8a4a, 0, 3.8, 0, 9);
  G.pine = b.build();
  b = new MB();
  let px = 0, py = 0;
  for (let i = 0; i < 6; i++) {
    const nx = px + 0.08 * i, ny = py + 0.75;
    b.beam([px, py, 0], [nx, ny, 0], 0.12 - i * 0.01, i % 2 ? 0x9b7650 : 0x8a6644, 6);
    px = nx; py = ny;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const leaf = new THREE.ConeGeometry(0.28, 1.9, 4);
    leaf.rotateZ(-Math.PI / 2 - 0.35);
    leaf.translate(0.95, -0.2, 0);
    leaf.rotateY(a);
    b.add(leaf, i % 2 ? 0x3aa14a : 0x4dbb5a, px, py, 0);
  }
  b.sphere(0.2, 0x6b4428, px, py - 0.05, 0, 6, 5);
  G.palm = b.build();
  b = new MB();
  b.box(1.7, 0.25, 1.7, 0x8f6b4a, 0, 0.12, 0);
  b.box(1.5, 0.12, 1.5, 0x4a3223, 0, 0.26, 0);
  const fcols = [0xff5d8f, 0xffd23f, 0xff8c42, 0xc77dff, 0xffffff];
  for (let i = 0; i < 16; i++) {
    const x = ((i % 4) - 1.5) * 0.36, z = (Math.floor(i / 4) - 1.5) * 0.36;
    b.cyl(0.02, 0.02, 0.3, 0x3f8f3a, x, 0.42, z, 4);
    b.sphere(0.11, fcols[i % fcols.length], x, 0.58, z, 6, 5);
  }
  G.flowers = b.build();
  b = new MB();
  b.cyl(0.08, 0.12, 3.6, 0x2b2f38, 0, 1.8, 0, 8);
  b.cyl(0.22, 0.22, 0.12, 0x2b2f38, 0, 3.62, 0, 8);
  b.cone(0.3, 0.35, 0x2b2f38, 0, 4.25, 0, 8);
  G.lamp = b.build();
  b = new MB();
  b.sphere(0.24, 0xfff1c4, 0, 3.9, 0, 10, 8);
  G.lampGlow = b.build();
  b = new MB();
  b.box(2.6, 1.0, 2.6, 0xe8e2d4, 0, 0.5, 0);
  b.box(2.2, 0.3, 2.2, 0xd8d2c4, 0, 1.15, 0);
  b.sphere(0.75, GOLD, 0, 2.2, 0, 12, 10, 1, 1.1, 0.9);
  b.sphere(0.5, GOLD, 0, 3.25, 0, 12, 10);
  b.sphere(0.2, GOLD, -0.4, 3.6, 0, 8, 6);
  b.sphere(0.2, GOLD, 0.4, 3.6, 0, 8, 6);
  b.beam([0.6, 2.6, 0], [0.9, 3.5, 0.2], 0.14, GOLD, 6);
  b.beam([-0.6, 2.6, 0], [-0.95, 2.0, 0.3], 0.14, GOLD, 6);
  G.statue = b.build();
  b = new MB();
  b.dodeca = 1;
  const rock = new THREE.DodecahedronGeometry(1, 0);
  b.add(rock, 0x8a857c, 0, 0.3, 0, 0, 0, 0, 1.2, 0.7, 1);
  G.rock = b.build();
  return G;
}

export const FACTORIES = {
  carousel: makeCarousel,
  teacups: makeTeacups,
  pirate: makePirate,
  ferris: makeFerris,
  droptower: makeDropTower,
  cannonshow: makeCannonShow,
  burger: makeBurger,
  soda: makeSoda,
  balloons: makeBalloonCart,
  turret: makeTurret,
  fountain: makeFountain,
  station: makeStation,
};
