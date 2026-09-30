// ─────────────────────────────────────────────────────────────────────────────
//  GameView: owns the three.js renderer/scene and turns simulation state +
//  events into pixels (lighting, day/night, effects, picking).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { initMaterials, U, MAT } from './materials.js';
import { createSky } from './sky.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { RagdollRenderer } from './ragdolls.js';
import { BuildingRenderer } from './buildings.js';
import { CoasterRenderer } from './coasterMesh.js';
import { ProjectileRenderer } from './projectilesMesh.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { createPost } from './post.js';
import { TEAM_COLORS } from '../config.js';
import { clamp, smoothstep, lerp } from '../util/math.js';

const TEAM_CONFETTI = [0x2f7cf6, 0xf0413d];

export class GameView {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    const quality = settings.quality ?? 2;
    this.quality = quality;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    this.basePR = Math.min(window.devicePixelRatio || 1, quality >= 2 ? 2 : quality === 1 ? 1.25 : 1);
    this.resScale = 1;
    this.perf = { ema: 0, t: -3, lowStreak: 0, downgraded: false };
    r.setPixelRatio(this.basePR);
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false;
    r.shadowMap.enabled = quality >= 1;
    r.shadowMap.type = THREE.PCFShadowMap;
    initMaterials();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2600);
    this.sunDir = new THREE.Vector3(0.45, 0.72, 0.35).normalize();
    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xbad4f0, 260, 1100);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a5a3a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
    this.sun.castShadow = quality >= 1;
    const sm = quality >= 2 ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 500;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.post = createPost(r, this.scene, this.camera, quality);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.flash = { color: new THREE.Color(1, 1, 1), a: 0 };
    window.addEventListener('resize', () => this.resize());
    this.game = null;
    this.timeOfDay = 0.3;
    this.pathDirty = false;
  }
  // Dynamic resolution: keep ~50+ fps on slower GPUs by trading pixels, not features.
  perfTick(dt) {
    const P = this.perf;
    if (dt <= 0 || dt > 0.25) return;
    P.ema = P.ema ? P.ema * 0.94 + dt * 0.06 : dt;
    P.t += dt;
    if (P.t < 1.5) return;
    P.t = 0;
    if (P.ema > 1 / 44 && this.resScale > 0.55) this.setResScale(this.resScale - 0.1);
    else if (P.ema > 1 / 44 && !P.downgraded && this.sun.castShadow) {
      // last resort: smaller shadow map
      P.downgraded = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    } else if (P.ema < 1 / 58 && this.resScale < 1) this.setResScale(Math.min(1, this.resScale + 0.05));
  }
  setResScale(s) {
    this.resScale = s;
    const pr = this.basePR * s;
    this.renderer.setPixelRatio(pr);
    this.post.composer.setPixelRatio(pr);
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  attach(game) {
    this.detach();
    this.game = game;
    const g = game;
    this.world = g.world;
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.terrain = createTerrain(g.world, this.quality);
    this.content.add(this.terrain.mesh);
    this.water = createWater(g.world, this.sunDir);
    this.content.add(this.water);
    this.effects = new Effects(this.content, g.world);
    this.ragdolls = new RagdollRenderer(this.content, g);
    this.buildingsR = new BuildingRenderer(this.content, g, this.effects);
    this.coasters = new CoasterRenderer(this.content, g);
    for (const c of g.coasters) this.coasters.add(c);
    this.projectiles = new ProjectileRenderer(this.content, g);
    this.buildFloodlights();
    this.terrain.updatePaths(g);
    if (!this.rig) this.rig = new CameraRig(this.camera, this.canvas, g.world);
    else this.rig.world = g.world;
  }
  // Stadium floodlights around no-man's land: real spotlights that switch on at dusk.
  buildFloodlights() {
    this.floods = [];
    const pole = new THREE.CylinderGeometry(0.22, 0.35, 18, 8);
    const head = new THREE.BoxGeometry(3.2, 1.4, 0.6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c6470, roughness: 0.5, metalness: 0.6 });
    this.floodLampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8, toneMapped: false });
    for (const [x, z] of [[-54, 22], [54, 22], [-54, -22], [54, -22]]) {
      const gy = this.world.heightAt(x, z);
      const p = new THREE.Mesh(pole, poleMat);
      p.position.set(x, gy + 9, z);
      p.castShadow = true;
      this.content.add(p);
      const hd = new THREE.Mesh(head, this.floodLampMat);
      hd.position.set(x - Math.sign(x) * 0.4, gy + 18.4, z);
      hd.lookAt(0, 0, z * 0.2);
      this.content.add(hd);
      const L = new THREE.SpotLight(0xfff0d0, 0, 0, 0.62, 0.7, 2);
      L.position.set(x, gy + 18.6, z);
      L.target.position.set(x * 0.2, 0, z * 0.1);
      this.content.add(L, L.target);
      this.floods.push(L);
    }
  }

  detach() {
    if (!this.content) return;
    this.scene.remove(this.content);
    this.content.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.content = null;
    this.game = null;
  }

  // ── Events → effects ──
  handleEvents(events, audio) {
    const fx = this.effects;
    const cam = this.camera.position;
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.unit) this.ragdolls.onHit(e.unit);
          fx.burstConfetti(e.x, e.y, e.z, e.big ? 14 : 5, e.big ? 5 : 3);
          if (e.big) fx.sparks(e.x, e.y, e.z, 6, 0xfff1a8, 4, 0.35, 0.3);
          break;
        case 'death':
          fx.burstConfetti(e.x, e.y + 0.6, e.z, 45, 6);
          fx.puff(e.x, e.y, e.z, 3, 0xffffff, 0.9, 0.9);
          break;
        case 'melee':
          fx.sparks(e.x, e.y, e.z, 5, 0xffffff, 3, 0.25, 0.22, 4);
          break;
        case 'explosion': {
          const k = e.kind;
          const sz = e.size || 1;
          if (k === 'popcorn' || k === 'turretpop') {
            fx.burstPopcorn(e.x, e.y, e.z, 30 * sz, 6 * sz);
            fx.flash(e.x, e.y + 0.5, e.z, 0xffe0a0, 4 * sz, 0.22);
            fx.puff(e.x, e.y + 0.3, e.z, 5, 0xfff6e0, 1.3 * sz, 1.0);
          } else if (k === 'firework') {
            fx.firework(e.x, e.y + 0.5, e.z);
          } else if (k === 'car') {
            fx.burstDebris(e.x, e.y, e.z, 9, [0x6b6f78, 0xdddddd, 0xffd23f, 0xff5d5d]);
            fx.flash(e.x, e.y + 0.5, e.z, 0xffb347, 5, 0.3);
            fx.puff(e.x, e.y, e.z, 8, 0x555555, 1.5, 1.8, 1.5);
          } else {
            fx.burstConfetti(e.x, e.y + 0.5, e.z, 70 * sz, 8 * sz);
            fx.flash(e.x, e.y + 0.5, e.z, 0xfff0c0, 5 * sz, 0.25);
            fx.puff(e.x, e.y + 0.2, e.z, 7, 0xeae2d2, 1.5 * sz, 1.2);
          }
          break;
        }
        case 'shockwave':
          fx.ring(e.x, this.world.heightAt(e.x, e.z), e.z, e.r, 0xffffff, 0.7);
          fx.puff(e.x, 0.5, e.z, 16, 0xe8dfcf, 1.8, 1.2);
          break;
        case 'impact':
          if (e.kind === 'pie') {
            fx.puff(e.x, e.y, e.z, 5, 0xfffdf0, 0.6, 0.7);
          } else if (e.kind === 'jet') {
            fx.splash(e.x, e.y, e.z, 8);
          } else if (e.kind === 'dart') {
            fx.sparks(e.x, e.y, e.z, 3, 0xffffff, 2, 0.2, 0.15, 3);
          } else fx.puff(e.x, e.y, e.z, 2, 0xd8cfbf, 0.6, 0.6);
          break;
        case 'cannon':
          fx.puff(e.x, e.y, e.z, 10, 0xeeeeee, 1.4, 1.2, 1.5);
          fx.flash(e.x, e.y, e.z, 0xffc070, 4, 0.2);
          fx.sparks(e.x, e.y, e.z, 12, 0xffd27a, 7, 0.4, 0.25, 2);
          break;
        case 'shot':
          if (e.kind === 'jets') fx.splash(e.x, e.y, e.z, 10);
          else {
            fx.puff(e.x, e.y, e.z, 3, 0xffffff, 0.7, 0.6);
            fx.flash(e.x, e.y, e.z, 0xffd27a, 1.8, 0.12);
          }
          break;
        case 'bump':
          fx.sparks(e.x, 0.8, e.z, 10, 0x9fe0ff, 5, 0.35, 0.25, 5);
          break;
        case 'coasterHit':
          fx.burstConfetti(e.x, e.y + 1, e.z, 60, 9);
          fx.flash(e.x, e.y + 1, e.z, 0xffffff, 3, 0.15);
          break;
        case 'built':
          this.buildingsR.add(e.b);
          this.pathDirty = true;
          break;
        case 'removed':
          this.buildingsR.remove(e.b);
          this.pathDirty = true;
          break;
        case 'destroyed':
          this.buildingsR.onDestroyed(e.b);
          this.rig.shake(this.distFactor(e.x, e.z) * 0.8);
          break;
        case 'repaired':
          this.buildingsR.onRepaired(e.b);
          break;
        case 'bhit':
          this.buildingsR.onHit(e.b, e.x, e.z);
          if (Math.random() < 0.5) fx.burstDebris(e.x, 1.5, e.z, 2);
          break;
        case 'path':
          this.pathDirty = true;
          break;
        case 'coaster':
          this.coasters.add(e.coaster);
          break;
        case 'coasterRemoved':
          this.coasters.remove(e.coaster);
          break;
        case 'shake':
          this.rig.shake(e.power * this.distFactor(e.x, e.z));
          break;
        case 'fight':
          this.flashScreen(0xffffff, 0.35);
          break;
        case 'gameOver':
          this.victoryFireworks = { t: 0, winner: e.winner };
          break;
        case 'barrage':
          fx.ring(e.x, this.world.heightAt(e.x, e.z), e.z, 10, e.team === 0 ? 0x7fb3ff : 0xff7a73, 1.4);
          break;
        case 'splat':
          fx.puff(e.x, 1, e.z, 4, 0xffffff, 0.8, 0.8);
          break;
      }
      if (audio) audio.onEvent(e, this);
    }
  }
  distFactor(x, z) {
    const t = this.rig.target;
    const d = Math.hypot(t.x - x, t.z - z);
    return clamp(1.2 - d / 70, 0, 1);
  }
  flashScreen(color, a) {
    this.flash.color.set(color);
    this.flash.a = a;
  }

  // ── Day / night ──
  updateLighting(dt) {
    const s = this.settings;
    const g = this.game;
    let p;
    if (s.timeMode === 'day') p = 0.3;
    else if (s.timeMode === 'sunset') p = 0.47;
    else if (s.timeMode === 'night') p = 0.75;
    else p = ((g ? g.time : 0) / 420 + 0.22 + (this.todOffset || 0)) % 1;
    this.timeOfDay = lerp(this.timeOfDay, p, s.timeMode === 'cycle' ? 1 : Math.min(1, dt * 2));
    const ang = this.timeOfDay * Math.PI * 2;
    // stretch the day: sun stays up longer
    const elev = Math.sin(ang) * 0.9 + 0.12;
    const sunDir = this.sunDir.set(Math.cos(ang) * 0.75, elev, 0.45).normalize();
    const night = smoothstep(0.08, -0.16, elev);
    U.night.value = night;
    this.sky.material.uniforms.uSunDir.value.copy(sunDir);
    const sunset = smoothstep(0.35, 0.02, elev) * (1 - night);
    const sunCol = new THREE.Color(1, 0.94, 0.84).lerp(new THREE.Color(1, 0.58, 0.32), sunset);
    const moonCol = new THREE.Color(0.55, 0.65, 1.0);
    this.sun.color.copy(sunCol).lerp(moonCol, night);
    this.sun.intensity = lerp(3.1 * (1 - sunset * 0.35), 0.8, night);
    this.hemi.intensity = lerp(0.85, 0.48, night);
    if (this.floods) {
      for (const L of this.floods) L.intensity = night * 3800;
      this.floodLampMat.color.setRGB(1, 0.96, 0.85).multiplyScalar(0.4 + night * 3.2);
    }
    this.hemi.color.set(0xcfe3ff).lerp(new THREE.Color(0x3a4a7a), night);
    this.hemi.groundColor.set(0x6a5a3a).lerp(new THREE.Color(0x1a1a2a), night);
    const fogDay = new THREE.Color(0xbad4f0).lerp(new THREE.Color(0xf0b890), sunset * 0.6);
    this.scene.fog.color.copy(fogDay).lerp(new THREE.Color(0x0a1024), night);
    U.rim.value = lerp(0.32, 0.9, night);
    // shadow light: sun by day, moon by night
    const lightDir = night > 0.5 ? new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.5, -sunDir.z).normalize() : sunDir;
    const t = this.rig.target;
    const span = clamp(this.rig.dist * 1.1, 40, 150);
    this.sun.position.set(t.x + lightDir.x * 200, t.y + lightDir.y * 200, t.z + lightDir.z * 200);
    this.sun.target.position.copy(t);
    const sc = this.sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
    }
    this.renderer.toneMappingExposure = lerp(1.05, 1.25, night);
    this.post.bloom.strength = lerp(0.22, 0.8, night);
    this.post.bloom.radius = lerp(0.3, 0.5, night);
    this.post.bloom.threshold = lerp(2.1, 0.85, night);
    // deployment-zone overlay during planning
    const zu = this.terrain.uniforms.uZones;
    const wantZones = g && (g.phase === 'prep' || (g.phase === 'battle' && !g.battleStarted)) ? 1 : 0;
    zu.value += (wantZones - zu.value) * Math.min(1, dt * 3);
  }

  // ── Frame ──
  frame(dt, alpha) {
    if (!this.game) return;
    const g = this.game;
    this.perfTick(dt);
    U.time.value += dt;
    this.updateLighting(dt);
    if (this.pathDirty) {
      this.terrain.updatePaths(g);
      this.pathDirty = false;
    }
    this.ragdolls.update(alpha);
    this.buildingsR.update(dt);
    this.coasters.update(alpha);
    this.projectiles.update(alpha, dt, this.effects);
    this.effects.update(dt);
    this.rig.update(dt, g, alpha);
    if (this.victoryFireworks) {
      const v = this.victoryFireworks;
      v.t += dt;
      if (Math.random() < dt * 6 && v.t < 40) {
        const park = g.parks[v.winner];
        const c = park.castle;
        this.effects.firework(c.x + (Math.random() - 0.5) * 40, 25 + Math.random() * 20, c.z + (Math.random() - 0.5) * 30, TEAM_COLORS[v.winner].main);
      }
    }
    // post settings
    const tiltOn = this.settings.tiltShift && this.rig.mode !== 'ride';
    this.post.tilt.enabled = tiltOn;
    if (tiltOn) this.post.tilt.uniforms.uAmount.value = clamp((this.rig.dist - 25) / 120, 0, 1) * 0.9 + 0.1;
    this.post.bloom.enabled = this.settings.bloom !== false;
    this.flash.a = Math.max(0, this.flash.a - dt * 1.8);
    this.post.grade.uniforms.uFlash.value.set(this.flash.color.r, this.flash.color.g, this.flash.color.b, this.flash.a);
    this.post.grade.uniforms.uTime.value = U.time.value % 100;
    this.renderer.info.reset();
    this.post.composer.render(dt);
  }

  // ── Picking ──
  rayFromScreen(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }
  pickGround(cx, cy) {
    if (!this.world) return null;
    const ray = this.rayFromScreen(cx, cy);
    const o = ray.origin, d = ray.direction;
    let t = 0;
    let prev = null;
    for (let i = 0; i < 1200; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = this.world.heightAt(x, z);
      if (y <= h) {
        // refine
        let lo = prev ?? t - 1, hi = t;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          const yy = o.y + d.y * m;
          if (yy <= this.world.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = t;
      t += Math.max(0.5, t * 0.01);
      if (t > 2000) break;
    }
    return null;
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }
  pickUnit(cx, cy, filter = null) {
    const g = this.game;
    let best = null, bd = 28;
    for (let team = 0; team < 2; team++) {
      for (const u of g.units[team]) {
        if (!u.alive || (filter && !filter(u))) continue;
        const p = this.project(u.x, u.y + 0.4 * u.def.scale, u.z);
        if (!p) continue;
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < bd) {
          bd = d;
          best = u;
        }
      }
    }
    return best;
  }
}
