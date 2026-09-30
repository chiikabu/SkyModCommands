// Scene-graph side of the parks: attraction models, scenery instancing,
// environment dressing, fences, and night-time light pools.
import * as THREE from 'three';
import { TEAM_COLORS, HALF_W, PARK_LZ0, PARK_LZ1, MID, TILE, WATER_LEVEL } from '../config.js';
import { MAP_X, MAP_Z } from '../sim/world.js';
import { FACTORIES, makeCastle, makeGate, makeRubble, sceneryGeos } from './models.js';
import { MAT, U, addRim } from './materials.js';
import { easeOutElastic } from '../util/math.js';
import { MB } from './geo.js';

const SCENERY = ['tree', 'pine', 'palm', 'flowers', 'lamp', 'statue'];

export class BuildingRenderer {
  constructor(scene, game, effects) {
    this.scene = scene;
    this.game = game;
    this.fx = effects;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.items = new Map(); // building → record
    this.geos = sceneryGeos();
    this.scenery = {};
    for (const k of SCENERY) {
      const mat = k === 'tree' || k === 'pine' || k === 'palm' ? MAT.vcFoliage : k === 'statue' ? MAT.vcShiny : MAT.vc;
      const m = new THREE.InstancedMesh(this.geos[k], mat, 400);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.root.add(m);
      this.scenery[k] = m;
    }
    this.lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, toneMapped: false });
    this.lampGlow = new THREE.InstancedMesh(this.geos.lampGlow, this.lampGlowMat, 400);
    this.lampGlow.count = 0;
    this.lampGlow.frustumCulled = false;
    this.root.add(this.lampGlow);
    // light pools (additive ground glows) for lamps + rides at night
    const poolTexCanvas = document.createElement('canvas');
    poolTexCanvas.width = poolTexCanvas.height = 128;
    const ctx = poolTexCanvas.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(poolTexCanvas);
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffffff });
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(poolGeo, this.poolMat, 600);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 2;
    this.root.add(this.pools);
    this.sceneryDirty = true;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.buildEnvironment();
    this.buildFences();
    for (const b of game.buildings) this.add(b);
  }

  add(b) {
    if (b.def.cat === 'scenery') {
      this.sceneryDirty = true;
      return;
    }
    if (this.items.has(b)) return;
    const tc = TEAM_COLORS[b.team];
    let made;
    if (b.type === 'castle') made = makeCastle(tc.main, tc.light);
    else if (b.type === 'gate') made = makeGate(this.game.teams[b.team].parkName, tc.main, tc.css);
    else if (FACTORIES[b.type]) made = FACTORIES[b.type](tc.main);
    else return;
    const grp = made.group;
    const wrap = new THREE.Group();
    wrap.add(grp);
    wrap.position.set(b.x, this.game.world.heightAt(b.x, b.z), b.z);
    wrap.rotation.y = b.heading;
    this.root.add(wrap);
    const rec = { b, wrap, made, t0: performance.now(), pop: this.game.time > 0.5 ? 0 : 1, rubble: null, shake: 0, smokeT: 0 };
    this.items.set(b, rec);
    if (rec.pop === 0) {
      wrap.scale.setScalar(0.01);
      this.fx.puff(b.x, 0.5, b.z, 10, 0xe8dfcf, 2.2, 1.2);
      this.fx.burstConfetti(b.x, 3, b.z, 40, 6);
    }
  }
  remove(b) {
    if (b.def.cat === 'scenery') {
      this.sceneryDirty = true;
      return;
    }
    const rec = this.items.get(b);
    if (!rec) return;
    this.root.remove(rec.wrap);
    if (rec.rubble) this.root.remove(rec.rubble);
    this.items.delete(b);
    this.fx.puff(b.x, 0.5, b.z, 10, 0xd8cfbf, 2, 1);
  }
  onDestroyed(b) {
    const rec = this.items.get(b);
    if (!rec) {
      this.sceneryDirty = true;
      return;
    }
    rec.wrap.visible = b.type === 'castle';
    if (b.type !== 'castle') {
      const r = makeRubble(b.W * TILE * 0.5, b.D * TILE * 0.5, b.id * 97).group;
      r.position.copy(rec.wrap.position);
      r.rotation.y = b.heading;
      this.root.add(r);
      rec.rubble = r;
    }
    this.fx.burstDebris(b.x, 1, b.z, 26);
    this.fx.puff(b.x, 1, b.z, 22, 0x7a7068, 3.5, 2.5, 2);
    this.fx.flash(b.x, 2, b.z, 0xffb347, 12, 0.35);
    this.fx.sparks(b.x, 2, b.z, 30, 0xffb347, 10, 0.9, 0.4);
  }
  onRepaired(b) {
    const rec = this.items.get(b);
    if (!rec) return;
    rec.wrap.visible = true;
    if (rec.rubble) {
      this.root.remove(rec.rubble);
      rec.rubble = null;
    }
    rec.pop = 0;
    rec.t0 = performance.now();
    rec.wrap.scale.setScalar(0.01);
    this.fx.burstConfetti(b.x, 3, b.z, 30, 5);
  }
  onHit(b, x, z) {
    const rec = this.items.get(b);
    if (rec) rec.shake = 0.18;
  }

  rebuildScenery() {
    const counts = {};
    for (const k of SCENERY) counts[k] = 0;
    let glow = 0;
    for (const b of this.game.buildings) {
      if (b.def.cat !== 'scenery' || b.ruined) continue;
      const m = this.scenery[b.type];
      if (!m) continue;
      const i = counts[b.type]++;
      const rot = ((b.id * 2654435761) % 628) / 100;
      const sc = b.type === 'flowers' ? 1 : 0.85 + ((b.id * 7919) % 30) / 100;
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.type === 'statue' ? b.heading : rot);
      this.v.set(b.x, this.game.world.heightAt(b.x, b.z), b.z);
      this.s.set(sc, sc, sc);
      this.m4.compose(this.v, this.q, this.s);
      m.setMatrixAt(i, this.m4);
      if (b.type === 'lamp') this.lampGlow.setMatrixAt(glow++, this.m4);
    }
    for (const k of SCENERY) {
      this.scenery[k].count = counts[k];
      this.scenery[k].instanceMatrix.needsUpdate = true;
    }
    this.lampGlow.count = glow;
    this.lampGlow.instanceMatrix.needsUpdate = true;
    this.sceneryDirty = false;
    this.poolsDirty = true;
  }

  rebuildPools() {
    let n = 0;
    const c = new THREE.Color();
    const put = (x, z, r, col) => {
      if (n >= 600) return;
      this.v.set(x, this.game.world.heightAt(x, z) + 0.06, z);
      this.q.identity();
      this.s.set(r * 2, 1, r * 2);
      this.m4.compose(this.v, this.q, this.s);
      this.pools.setMatrixAt(n, this.m4);
      c.set(col);
      this.pools.setColorAt(n, c);
      n++;
    };
    for (const b of this.game.buildings) {
      if (b.ruined) continue;
      if (b.type === 'lamp') put(b.x, b.z, 4.5, 0xffd9a0);
      else if (b.def.cat === 'rides' || b.type === 'castle' || b.type === 'gate' || b.type === 'station') {
        const cols = [0xff9ec7, 0xffd27a, 0x8fd3ff, 0xc3a6ff];
        put(b.x, b.z, b.radius + 4, cols[b.id % cols.length]);
      } else if (b.def.cat === 'shops' || b.def.cat === 'defense') put(b.x, b.z, 4, 0xffe0a0);
    }
    this.pools.count = n;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
    this.poolsDirty = false;
  }

  buildEnvironment() {
    const world = this.game.world;
    const G = this.geos;
    const rnd = mulberry(1234);
    const lists = { tree: [], pine: [], palm: [], rock: [] };
    for (let i = 0; i < 5000 && lists.tree.length + lists.pine.length < 900; i++) {
      const x = (rnd() * 2 - 1) * (MAP_X - 5), z = (rnd() * 2 - 1) * (MAP_Z - 5);
      if (Math.abs(x) < HALF_W + 9 && Math.abs(z) < PARK_LZ1 + 12) continue;
      const h = world.heightAt(x, z);
      if (h < 0.6) continue;
      const hx = world.heightAt(x + 1.5, z) - h, hz = world.heightAt(x, z + 1.5) - h;
      const slope = Math.hypot(hx, hz) / 1.5;
      if (slope > 0.8) {
        if (rnd() < 0.3) lists.rock.push([x, h, z, 0.8 + rnd() * 1.8]);
        continue;
      }
      const t = h > 9 ? 'pine' : rnd() < 0.55 ? 'tree' : 'pine';
      lists[t].push([x, h, z, 0.9 + rnd() * 0.9]);
    }
    // palms along the beaches
    for (let i = 0; i < 3000 && lists.palm.length < 90; i++) {
      const x = (rnd() * 2 - 1) * (MAP_X - 5), z = (rnd() * 2 - 1) * (MAP_Z - 5);
      if (Math.abs(x) < HALF_W + 6 && Math.abs(z) < PARK_LZ1 + 10) continue;
      const h = world.heightAt(x, z);
      if (h > 0.3 && h < 1.4) lists.palm.push([x, h, z, 0.9 + rnd() * 0.5]);
    }
    // a few rocks in no-man's land
    for (let i = 0; i < 16; i++) {
      const x = (rnd() * 2 - 1) * (HALF_W - 6), z = (rnd() * 2 - 1) * (MID - 4);
      lists.rock.push([x, world.heightAt(x, z), z, 0.4 + rnd() * 0.5]);
    }
    // low-poly variants for the background forest, chunked so frustum culling works
    const lowGeo = this.lowPolyGeos();
    const CH = 110;
    for (const [k, list] of Object.entries(lists)) {
      const mat = k === 'rock' ? MAT.vc : MAT.vcFoliage;
      const chunks = new Map();
      for (const it of list) {
        const key = Math.floor(it[0] / CH) + ',' + Math.floor(it[2] / CH);
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(it);
      }
      for (const items of chunks.values()) {
        const m = new THREE.InstancedMesh(lowGeo[k] || G[k], mat, items.length);
        items.forEach(([x, y, z, s], i) => {
          this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
          this.v.set(x, y - 0.1, z);
          this.s.set(s, s * (0.9 + rnd() * 0.3), s);
          this.m4.compose(this.v, this.q, this.s);
          m.setMatrixAt(i, this.m4);
        });
        m.computeBoundingSphere();
        m.castShadow = k !== 'rock';
        m.receiveShadow = true;
        this.root.add(m);
      }
    }
  }

  lowPolyGeos() {
    const G = {};
    let b = new MB();
    b.cyl(0.14, 0.2, 2.2, 0x7a5232, 0, 1.1, 0, 5);
    b.sphere(1.05, 0x3f8f3a, 0, 2.7, 0, 7, 5);
    b.sphere(0.8, 0x4fa644, 0.55, 2.35, 0.3, 6, 4);
    b.sphere(0.7, 0x4a9e40, 0.1, 3.35, -0.2, 6, 4);
    G.tree = b.build();
    b = new MB();
    b.cyl(0.12, 0.18, 1.2, 0x6b4428, 0, 0.6, 0, 5);
    b.cone(1.2, 1.8, 0x2f6e3b, 0, 1.9, 0, 7);
    b.cone(0.95, 1.6, 0x357d43, 0, 2.9, 0, 7);
    b.cone(0.65, 1.4, 0x3c8a4a, 0, 3.8, 0, 7);
    G.pine = b.build();
    return G;
  }

  buildFences() {
    const b = new MB();
    for (const s of [1, -1]) {
      const post = (x, lz) => b.cyl(0.08, 0.08, 1.1, 0xffffff, x, 0.55, lz * s, 5);
      const rail = (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const ang = Math.atan2(x1 - x0, z1 - z0);
        b.box(0.06, 0.08, len, 0xffffff, (x0 + x1) / 2, 0.85, (z0 + z1) / 2, 0, ang, 0);
        b.box(0.06, 0.08, len, 0xffffff, (x0 + x1) / 2, 0.45, (z0 + z1) / 2, 0, ang, 0);
      };
      // sides
      for (const side of [-1, 1]) {
        const x = side * (HALF_W + 0.3);
        for (let lz = PARK_LZ0; lz <= PARK_LZ1; lz += 2) post(x, lz);
        rail(x, PARK_LZ0 * s, x, PARK_LZ1 * s);
      }
      // back with a gap for the gate
      for (let x = -HALF_W; x <= HALF_W; x += 2) if (Math.abs(x) > 7.5) post(x, PARK_LZ1 + 0.3);
      rail(-HALF_W, (PARK_LZ1 + 0.3) * s, -7.5, (PARK_LZ1 + 0.3) * s);
      rail(7.5, (PARK_LZ1 + 0.3) * s, HALF_W, (PARK_LZ1 + 0.3) * s);
      // bunting flags along the front of the park
      for (let x = -HALF_W; x <= HALF_W; x += 8) b.cyl(0.07, 0.07, 3.2, 0xffffff, x, 1.6, PARK_LZ0 * s, 6);
    }
    const m = new THREE.Mesh(b.build(), MAT.vc);
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    // bunting triangles
    const bf = new MB();
    const cols = [0xff4d6d, 0xffd60a, 0x4cc9f0, 0x80ed99, 0xc77dff];
    for (const s of [1, -1]) {
      for (let x = -HALF_W; x < HALF_W; x += 8) {
        for (let k = 0; k < 8; k++) {
          const t = (k + 0.5) / 8;
          const sag = Math.sin(t * Math.PI) * 0.6;
          const tri = new THREE.ConeGeometry(0.25, 0.5, 3);
          tri.rotateX(Math.PI);
          bf.add(tri, cols[(k + (x | 0)) % cols.length], x + t * 8, 2.9 - sag, PARK_LZ0 * s, 0, 0, 0, 1, 1, 0.2);
        }
      }
    }
    const bm = new THREE.Mesh(bf.build(), MAT.vc);
    this.root.add(bm);
  }

  update(dt) {
    const g = this.game;
    if (this.sceneryDirty) this.rebuildScenery();
    if (this.poolsDirty) this.rebuildPools();
    const night = U.night.value;
    this.poolMat.opacity = night * 0.55;
    this.pools.visible = night > 0.05;
    this.lampGlowMat.color.setScalar(0.8 + night * 3.5);
    MAT.window.color.setRGB(1, 0.82, 0.48).multiplyScalar(0.7 + night * 2.8);
    const now = performance.now();
    for (const rec of this.items.values()) {
      const b = rec.b;
      const M = rec.made;
      const a = b.anim;
      if (rec.pop < 1) {
        rec.pop = Math.min(1, (now - rec.t0) / 700);
        rec.wrap.scale.setScalar(Math.max(0.01, easeOutElastic(rec.pop)));
      }
      if (rec.shake > 0) {
        rec.shake -= dt;
        rec.wrap.position.x = b.x + (Math.random() - 0.5) * 0.25;
        rec.wrap.position.z = b.z + (Math.random() - 0.5) * 0.25;
        if (rec.shake <= 0) rec.wrap.position.set(b.x, rec.wrap.position.y, b.z);
      }
      // damage smoke / fire
      if (!b.ruined && b.hp < b.maxHp * 0.55 && b.targetable) {
        rec.smokeT -= dt;
        if (rec.smokeT <= 0) {
          rec.smokeT = b.hp < b.maxHp * 0.25 ? 0.12 : 0.35;
          const top = Math.min(b.def.height || 4, 10);
          this.fx.puff(b.x + (Math.random() - 0.5) * b.radius, top, b.z + (Math.random() - 0.5) * b.radius, 1, 0x4a4540, 1.6, 2.2, 2.2);
          if (b.hp < b.maxHp * 0.3) this.fx.fire(b.x + (Math.random() - 0.5) * b.radius, top * 0.7, b.z + (Math.random() - 0.5) * b.radius, 2, 1.2);
        }
      }
      if (b.ruined) {
        rec.smokeT -= dt;
        if (rec.smokeT <= 0) {
          rec.smokeT = 0.5;
          this.fx.puff(b.x + (Math.random() - 0.5) * 3, 0.8, b.z + (Math.random() - 0.5) * 3, 1, 0x3e3a36, 1.4, 2.4, 1.5);
        }
        continue;
      }
      switch (b.type) {
        case 'carousel':
          M.rotor.rotation.y = -a.angle;
          M.horses.forEach((h, i) => (h.position.y = 1.2 + Math.sin(a.t * 2.2 + i) * 0.25 * Math.min(1, a.speed * 1.5)));
          break;
        case 'teacups':
          M.plate.rotation.y = -a.angle;
          M.cups.forEach((c, i) => (c.rotation.y = -a.spin * (i % 2 ? -1 : 1)));
          break;
        case 'pirate':
          M.swing.rotation.x = -a.swing;
          break;
        case 'ferris': {
          M.wheel.rotation.z = a.angle;
          const R = 7.2;
          M.gondolas.forEach((gd, i) => {
            const ang = a.angle + (i / 8) * Math.PI * 2;
            gd.position.set(Math.cos(ang) * R, 9 + Math.sin(ang) * R, 0);
            gd.rotation.z = Math.sin(a.t * 1.3 + i) * 0.05 * a.speed * 4;
          });
          break;
        }
        case 'droptower':
          M.car.position.y = 1.4 + a.drop;
          break;
        case 'turret':
        case 'cannonshow': {
          const yaw = M.yaw;
          let target = b.type === 'cannonshow' ? Math.PI : yaw.rotation.y;
          if (b.aimX !== undefined && g.phase === 'battle') {
            const ang = Math.atan2(b.aimX - b.x, b.aimZ - b.z) - b.heading;
            target = ang;
          }
          let d = target - yaw.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          yaw.rotation.y += d * Math.min(1, dt * 6);
          break;
        }
        case 'fountain':
          M.jets.visible = true;
          M.jets.children.forEach((j, i) => (j.scale.y = 0.8 + Math.sin(a.t * 5 + i) * 0.25));
          break;
        case 'balloons':
          M.balloons.position.y = Math.sin(a.t * 1.4) * 0.12;
          M.balloons.rotation.y = Math.sin(a.t * 0.6) * 0.2;
          break;
      }
    }
  }
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
