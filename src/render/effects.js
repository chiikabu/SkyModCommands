// ─────────────────────────────────────────────────────────────────────────────
//  Particle effects: confetti, popcorn, debris (lit, instanced) and soft
//  billboards for smoke / sparks / water / fire (custom shader, additive or not).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { U } from './materials.js';

const CONFETTI = [0xff4d6d, 0xffd60a, 0x4cc9f0, 0x80ed99, 0xc77dff, 0xff9f1c, 0xffffff, 0x3a86ff];
const _c = new THREE.Color();

class LitPool {
  constructor(scene, geo, max, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, side: opts.double ? THREE.DoubleSide : THREE.FrontSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.shadow;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this.p = [];
    this.bounce = opts.bounce ?? 0.35;
    this.drag = opts.drag ?? 0.02;
    this.flutter = !!opts.flutter;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }
  spawn(x, y, z, vx, vy, vz, color, size, life) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x, y, z, vx, vy, vz, color, size, life, t: 0, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12 });
  }
  update(dt, world) {
    const arr = this.mesh.instanceMatrix.array;
    const col = this.mesh.instanceColor.array;
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.p.splice(i, 1);
        continue;
      }
      const drag = this.flutter ? 2.2 : this.drag;
      p.vx -= p.vx * drag * dt;
      p.vz -= p.vz * drag * dt;
      p.vy -= (this.flutter ? 3.2 : 9.8) * dt;
      if (this.flutter) p.vy = Math.max(p.vy, -1.6);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const gy = world.heightAt(p.x, p.z) + p.size * 0.5;
      if (p.y < gy) {
        p.y = gy;
        p.vy = Math.abs(p.vy) * this.bounce;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.sx *= 0.5;
        p.sy *= 0.5;
      }
      p.rx += p.sx * dt;
      p.ry += p.sy * dt;
      const fade = Math.min(1, (p.life - p.t) / 0.5);
      const s = p.size * fade;
      this.e.set(p.rx, p.ry, p.rz);
      this.q.setFromEuler(this.e);
      this.v.set(p.x, p.y, p.z);
      this.s.set(s, s * (this.flutter ? 0.5 : 1), s);
      this.m4.compose(this.v, this.q, this.s);
      this.m4.toArray(arr, n * 16);
      _c.set(p.color);
      col[n * 3] = _c.r; col[n * 3 + 1] = _c.g; col[n * 3 + 2] = _c.b;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// Soft billboards (smoke/sparks/water/fire)
class SoftPool {
  constructor(scene, max, additive) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.attributes.position = quad.attributes.position;
    g.attributes.uv = quad.attributes.uv;
    this.off = new Float32Array(max * 4); // xyz + size
    this.col = new Float32Array(max * 4); // rgb + alpha
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(this.off, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTime: U.time },
      vertexShader: `
        attribute vec4 aOff;
        attribute vec4 aCol;
        varying vec4 vCol;
        varying vec2 vUv;
        void main() {
          vCol = aCol;
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(aOff.xyz, 1.0);
          mv.xy += position.xy * aOff.w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vCol;
        varying vec2 vUv;
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a *= a;
          gl_FragColor = vec4(vCol.rgb, vCol.a * a);
        }`,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
    this.geo = g;
    this.max = max;
    this.p = [];
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ t: 0, grow: 1, drag: 1, gravity: 0, ...o });
  }
  update(dt) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.p.splice(i, 1);
        continue;
      }
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.vz *= 1 - p.drag * dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const u = p.t / p.life;
      const size = p.size * (1 + (p.grow - 1) * u);
      const alpha = p.alpha * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
      this.off[n * 4] = p.x; this.off[n * 4 + 1] = p.y; this.off[n * 4 + 2] = p.z; this.off[n * 4 + 3] = size;
      _c.set(p.color);
      const k = p.bright || 1;
      this.col[n * 4] = _c.r * k; this.col[n * 4 + 1] = _c.g * k; this.col[n * 4 + 2] = _c.b * k; this.col[n * 4 + 3] = alpha;
      n++;
    }
    this.geo.instanceCount = n;
    this.geo.attributes.aOff.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.confetti = new LitPool(scene, new THREE.PlaneGeometry(0.16, 0.09), 2500, { double: true, flutter: true });
    this.popcorn = new LitPool(scene, new THREE.IcosahedronGeometry(0.09, 0), 900, { bounce: 0.4, shadow: false });
    this.debris = new LitPool(scene, new THREE.BoxGeometry(0.3, 0.2, 0.35), 700, { bounce: 0.25, shadow: true });
    this.smoke = new SoftPool(scene, 900, false);
    this.glow = new SoftPool(scene, 1600, true);
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
  }
  rnd(a, b) {
    return a + Math.random() * (b - a);
  }
  burstConfetti(x, y, z, n = 30, power = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = power * (0.4 + Math.random() * 0.8);
      this.confetti.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + power * 0.6, Math.sin(a) * Math.cos(e) * sp, CONFETTI[(Math.random() * CONFETTI.length) | 0], this.rnd(0.9, 1.4), this.rnd(2.2, 4));
    }
  }
  burstPopcorn(x, y, z, n = 25, power = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.3 + Math.random());
      this.popcorn.spawn(x, y + 0.2, z, Math.cos(a) * sp * 0.6, sp * 0.9 + 2, Math.sin(a) * sp * 0.6, Math.random() < 0.8 ? 0xfff3c4 : 0xffd66b, this.rnd(0.8, 1.4), this.rnd(1.8, 3.2));
    }
  }
  burstDebris(x, y, z, n = 12, colors = [0x857a6d, 0x6b6258, 0x9b6b43]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.rnd(2, 7);
      this.debris.spawn(x + this.rnd(-1, 1), y + this.rnd(0, 2), z + this.rnd(-1, 1), Math.cos(a) * sp, this.rnd(4, 9), Math.sin(a) * sp, colors[(Math.random() * colors.length) | 0], this.rnd(0.6, 1.6), this.rnd(2.5, 4));
    }
  }
  puff(x, y, z, n = 6, color = 0xdad4c8, size = 1.2, life = 1.4, rise = 1) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({ x: x + this.rnd(-0.4, 0.4), y: y + this.rnd(0, 0.4), z: z + this.rnd(-0.4, 0.4), vx: this.rnd(-1, 1), vy: this.rnd(0.3, 1.2) * rise, vz: this.rnd(-1, 1), color, size: size * this.rnd(0.7, 1.2), grow: 2.2, alpha: 0.55, life: life * this.rnd(0.7, 1.3), drag: 1.5 });
    }
  }
  flash(x, y, z, color = 0xffd27a, size = 4, life = 0.25) {
    this.glow.spawn({ x, y, z, vx: 0, vy: 0, vz: 0, color, size, grow: 1.6, alpha: 0.9, life, bright: 2.5 });
  }
  sparks(x, y, z, n = 12, color = 0xffe28a, power = 6, life = 0.6, size = 0.25, gravity = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = this.rnd(-0.3, 1.3);
      const sp = power * this.rnd(0.4, 1.1);
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, color, size: size * this.rnd(0.6, 1.3), grow: 0.3, alpha: 1, life: life * this.rnd(0.6, 1.2), drag: 1.2, gravity, bright: 3 });
    }
  }
  splash(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.rnd(1, 4);
      this.smoke.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: this.rnd(2, 5), vz: Math.sin(a) * sp, color: 0xbfefff, size: this.rnd(0.25, 0.5), grow: 1.2, alpha: 0.8, life: this.rnd(0.5, 0.9), gravity: 9, drag: 0.5 });
    }
  }
  fire(x, y, z, n = 3, size = 1) {
    for (let i = 0; i < n; i++) {
      this.glow.spawn({ x: x + this.rnd(-0.6, 0.6) * size, y: y + this.rnd(0, 0.5), z: z + this.rnd(-0.6, 0.6) * size, vx: this.rnd(-0.3, 0.3), vy: this.rnd(1.5, 3), vz: this.rnd(-0.3, 0.3), color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, size: size * this.rnd(0.6, 1.2), grow: 0.4, alpha: 0.9, life: this.rnd(0.5, 0.9), drag: 0.8, bright: 2.2 });
    }
  }
  ring(x, y, z, radius, color = 0xffffff, life = 0.6) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, y + 0.15, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, radius });
  }
  firework(x, y, z, color) {
    const cols = color ? [color] : [0xff4d6d, 0xffd60a, 0x4cc9f0, 0x80ed99, 0xc77dff, 0xff9f1c];
    const c = cols[(Math.random() * cols.length) | 0];
    const n = 70;
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = this.rnd(8, 12);
      this.glow.spawn({ x, y, z, vx: r * Math.cos(th) * sp, vy: u * sp, vz: r * Math.sin(th) * sp, color: c, size: 0.5, grow: 0.2, alpha: 1, life: this.rnd(1.2, 1.9), drag: 1.6, gravity: 2.5, bright: 4 });
    }
    this.flash(x, y, z, c, 10, 0.3);
  }
  update(dt) {
    this.confetti.update(dt, this.world);
    this.popcorn.update(dt, this.world);
    this.debris.update(dt, this.world);
    this.smoke.update(dt);
    this.glow.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const u = r.t / r.life;
      if (u >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const s = r.radius * (0.2 + u * 0.9);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.8 * (1 - u);
    }
  }
}
