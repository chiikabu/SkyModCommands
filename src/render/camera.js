// RTS / park-builder camera: orbit, pan, zoom, edge-scroll, follow, ride-cam,
// and an automatic "director" for spectating AI battles.
import * as THREE from 'three';
import { HALF_W, PARK_LZ1 } from '../config.js';
import { clamp, lerp } from '../util/math.js';

export class CameraRig {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.target = new THREE.Vector3(0, 0, 44);
    this.goal = new THREE.Vector3(0, 0, 44);
    this.yaw = 0;
    this.goalYaw = 0;
    this.pitch = 0.78;
    this.goalPitch = 0.78;
    this.dist = 70;
    this.goalDist = 70;
    this.keys = new Set();
    this.drag = null;
    this.mode = 'free';
    this.follow = null;
    this.shakeAmt = 0;
    this.edgePan = true;
    this.mouse = { x: 0, y: 0, inside: false };
    this.rideCoaster = null;
    this.director = { t: 0, shot: null };
    this.enabled = true;
    this._bind();
  }
  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this.drag = { btn: e.button, x: e.clientX, y: e.clientY, moved: 0 };
        d.setPointerCapture(e.pointerId);
      }
    });
    d.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.btn === 2 && !e.shiftKey) {
        this.goalYaw -= dx * 0.006;
        this.goalPitch = clamp(this.goalPitch + dy * 0.004, 0.18, 1.45);
        if (this.mode === 'ride') this.exitSpecial();
      } else {
        this.panScreen(-dx, -dy);
      }
    });
    d.addEventListener('pointerup', (e) => {
      if (this.drag && (e.button === 2 || e.button === 1)) {
        this.lastDragMoved = this.drag.moved;
        this.drag = null;
      }
    });
    d.addEventListener('pointerleave', () => (this.mouse.inside = false));
    d.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      if (e.shiftKey && this.shiftWheel && this.shiftWheel(e)) return;
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) * 0.0018));
      this.goalDist = clamp(this.goalDist * k, 8, 230);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  panScreen(dx, dy) {
    const s = this.dist * 0.0016;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // screen right = (cos yaw, -sin yaw), screen up (into screen) = -(sin yaw, cos yaw)
    this.goal.x += (dx * Math.cos(this.yaw) + dy * fx) * s;
    this.goal.z += (-dx * Math.sin(this.yaw) + dy * fz) * s;
    if (this.mode !== 'free' && this.mode !== 'director') this.exitSpecial();
  }
  exitSpecial() {
    this.mode = 'free';
    this.follow = null;
    this.rideCoaster = null;
  }
  snap() {
    this.target.copy(this.goal);
    this.yaw = this.goalYaw;
    this.pitch = this.goalPitch;
    this.dist = this.goalDist;
  }
  focus(x, z, dist = null, yaw = null) {
    this.goal.set(x, 0, z);
    if (dist) this.goalDist = dist;
    if (yaw !== null) this.goalYaw = yaw;
  }
  setFollow(unit) {
    this.mode = 'follow';
    this.follow = unit;
    this.goalDist = Math.min(this.goalDist, 18);
  }
  setRide(coaster) {
    this.mode = 'ride';
    this.rideCoaster = coaster;
  }
  shake(p) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + p);
  }
  update(dt, game, alpha) {
    const k = this.keys;
    if (this.enabled) {
      const sp = this.dist * 0.9 * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.2 : 1);
      let mx = 0, mz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
      if (this.edgePan && this.mouse.inside && document.pointerLockElement == null && !this.drag) {
        const m = 6;
        if (this.mouse.x < m) mx -= 1;
        if (this.mouse.x > window.innerWidth - m) mx += 1;
        if (this.mouse.y < m) mz -= 1;
        if (this.mouse.y > window.innerHeight - m) mz += 1;
      }
      if (mx || mz) {
        const c = Math.cos(this.goalYaw), s = Math.sin(this.goalYaw);
        this.goal.x += (mx * c + mz * s) * sp;
        this.goal.z += (-mx * s + mz * c) * sp;
        if (this.mode === 'follow' || this.mode === 'ride' || this.mode === 'director') this.mode = 'free';
      }
      if (k.has('KeyQ')) this.goalYaw += dt * 1.6;
      if (k.has('KeyE')) this.goalYaw -= dt * 1.6;
      if (k.has('KeyR') && !k.has('ControlLeft')) this.goalPitch = clamp(this.goalPitch + dt * 0.8, 0.18, 1.45);
      if (k.has('KeyF') && !this._fHeld) this.goalPitch = clamp(this.goalPitch - dt * 0.8, 0.18, 1.45);
      if (k.has('Equal') || k.has('NumpadAdd')) this.goalDist = clamp(this.goalDist * (1 - dt * 1.5), 8, 230);
      if (k.has('Minus') || k.has('NumpadSubtract')) this.goalDist = clamp(this.goalDist * (1 + dt * 1.5), 8, 230);
    }
    if (this.mode === 'follow' && this.follow) {
      const u = this.follow;
      if (u.removed) this.exitSpecial();
      else this.goal.set(u.x, 0, u.z);
    }
    if (this.mode === 'director') this.updateDirector(dt, game);
    // clamp to the island
    this.goal.x = clamp(this.goal.x, -HALF_W - 40, HALF_W + 40);
    this.goal.z = clamp(this.goal.z, -PARK_LZ1 - 40, PARK_LZ1 + 40);
    const t = 1 - Math.exp(-dt * 7);
    this.target.lerp(this.goal, t);
    this.yaw = lerp(this.yaw, this.goalYaw, t);
    this.pitch = lerp(this.pitch, this.goalPitch, t);
    this.dist = lerp(this.dist, this.goalDist, t);
    const cam = this.camera;
    if (this.mode === 'ride' && this.rideCoaster && !this.rideCoaster.building.removed) {
      const c = this.rideCoaster;
      const T = c.train;
      const s0 = T.prevS + (T.s - T.prevS) * alpha;
      const f = c.frameAt(s0 + 0.9, {});
      cam.position.set(f.x + f.ux * 1.45, f.y + f.uy * 1.45, f.z + f.uz * 1.45);
      const la = c.frameAt(s0 + 9, {});
      cam.up.set(f.ux, f.uy, f.uz);
      cam.lookAt(la.x + la.ux * 1.0, la.y + la.uy * 1.0, la.z + la.uz * 1.0);
      cam.fov = 75;
      cam.updateProjectionMatrix();
      return;
    }
    cam.up.set(0, 1, 0);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    const gy = this.world.heightAt(this.target.x, this.target.z);
    const ty = gy + (this.mode === 'follow' ? 1.2 : 0);
    const cp = Math.cos(this.pitch);
    let px = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    let pz = this.target.z + Math.cos(this.yaw) * cp * this.dist;
    let py = ty + Math.sin(this.pitch) * this.dist;
    const minY = this.world.heightAt(px, pz) + 2;
    if (py < minY) py = minY;
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * Math.min(1.5, this.dist / 40);
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s;
      pz += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.exp(-dt * 7);
    }
    cam.position.set(px, py, pz);
    cam.lookAt(this.target.x, ty, this.target.z);
  }
  // Automatic camera for AI-vs-AI spectating: frames the action.
  updateDirector(dt, game) {
    const D = this.director;
    D.t -= dt;
    if (D.t > 0 && D.shot) {
      if (D.shot.follow && D.shot.follow.alive) this.goal.set(D.shot.follow.x, 0, D.shot.follow.z);
      this.goalYaw += dt * (D.shot.spin || 0);
      return;
    }
    D.t = 6 + Math.random() * 5;
    let cx = 0, cz = 0, n = 0;
    const units = [...game.units[0], ...game.units[1]].filter((u) => u.alive);
    for (const u of units) {
      cx += u.x;
      cz += u.z;
      n++;
    }
    const r = Math.random();
    if (game.phase === 'battle' && n > 0) {
      cx /= n;
      cz /= n;
      if (r < 0.45) {
        D.shot = { spin: (Math.random() - 0.5) * 0.12 };
        this.focus(cx, cz, 38 + Math.random() * 20, this.goalYaw + (Math.random() - 0.5) * 1.2);
        this.goalPitch = 0.55 + Math.random() * 0.35;
      } else {
        const u = units[(Math.random() * units.length) | 0];
        D.shot = { follow: u, spin: 0.15 };
        this.focus(u.x, u.z, 14 + Math.random() * 8);
        this.goalPitch = 0.35 + Math.random() * 0.25;
      }
    } else {
      // park tour
      const parks = game.parks;
      const p = parks[(Math.random() * 2) | 0];
      const bs = p.buildings.filter((b) => b.def.cat === 'rides' || b.type === 'castle' || b.type === 'station');
      const b = bs[(Math.random() * bs.length) | 0];
      if (b) {
        D.shot = { spin: 0.1 * (Math.random() < 0.5 ? -1 : 1) };
        this.focus(b.x, b.z, 30 + Math.random() * 20, Math.random() * Math.PI * 2);
        this.goalPitch = 0.4 + Math.random() * 0.4;
      }
    }
  }
}
