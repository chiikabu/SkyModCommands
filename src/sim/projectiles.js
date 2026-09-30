// Ballistic projectiles: darts, pies, popcorn tubs, fireworks, water jets.
import { DT } from '../config.js';
import { HEAD, NECK, PELVIS } from './physics.js';
import { pointInCollider } from './world.js';

const HIT_R = { dart: 0.32, pie: 0.42, popcorn: 0.55, turretpop: 0.6, firework: 0.6, jet: 0.75 };

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
  }
  clear() {
    this.list.length = 0;
  }
  // Fire from s to t arriving after `time` seconds under `gravity`.
  fire(o) {
    const T = Math.max(0.05, o.time);
    const g = o.gravity;
    const p = {
      id: this.nextId++,
      type: o.type,
      team: o.team,
      source: o.source,
      x: o.sx, y: o.sy, z: o.sz,
      vx: (o.tx - o.sx) / T,
      vy: (o.ty - o.sy + 0.5 * g * T * T) / T,
      vz: (o.tz - o.sz) / T,
      gravity: g,
      damage: o.damage,
      splash: o.splash || 0,
      knock: o.knock || 0,
      stun: o.stun || 0,
      life: T * 1.6 + 1.5,
      age: 0,
      structMult: o.structMult ?? (o.source && o.source.def && o.source.def.attack ? o.source.def.attack.structMult : 1) ?? 1,
      dead: false,
      spin: Math.random() * 6,
    };
    this.list.push(p);
    return p;
  }

  update() {
    const g = this.game;
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += DT;
      p.vy -= p.gravity * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.z += p.vz * DT;
      p.life -= DT;
      let impact = false, hitUnit = null, hitK = -1;
      const hr = HIT_R[p.type] || 0.4;
      // direct unit hits
      if (p.age > 0.05) {
        g.phys.queryBodies(p.x, p.z, hr + 0.5, (rd, k) => {
          if (hitUnit || rd.kind !== 'unit') return;
          const o = rd.owner;
          if (!o.alive || o.team === p.team) return;
          // 3D check against head / neck / pelvis
          const P = g.phys;
          for (const part of [HEAD, NECK, PELVIS]) {
            const kk = rd.base + part;
            const dx = P.x[kk] - p.x, dy = P.y[kk] - p.y, dz = P.z[kk] - p.z;
            const r = hr + P.rad[kk] * 1.3;
            if (dx * dx + dy * dy + dz * dz < r * r) {
              hitUnit = o;
              hitK = part;
              return;
            }
          }
        });
      }
      if (hitUnit) impact = true;
      const gy = g.world.heightAt(p.x, p.z);
      if (!impact && p.y <= gy) {
        impact = true;
        p.y = gy;
      }
      // buildings
      let hitB = null;
      if (!impact) {
        const cs = g.world.collidersAt(p.x, p.z);
        if (cs) {
          for (const c of cs) {
            if (c.ghost) continue;
            const top = (c.y0 || 0) + c.h;
            if (p.y > top || (c.y0 && p.y < c.y0)) continue;
            if (!pointInCollider(c, p.x, p.z)) continue;
            impact = true;
            if (c.owner && c.owner.isBuilding && c.owner.team !== p.team) hitB = c.owner;
            break;
          }
        }
      }
      if (!impact && p.life > 0) continue;
      // resolve impact
      L.splice(i, 1);
      if (p.splash > 0) {
        g.splash(p.team, p.x, p.z, p.splash, p.damage, p.knock, p.source, p.type, hitUnit);
        if (hitB) g.damageBuilding(hitB, p.damage * p.structMult, p.source, p.x, p.z);
        else {
          // splash also clips buildings inside the radius
          g.splashBuildings(p.team, p.x, p.z, p.splash, p.damage * p.structMult * 0.5, p.source);
        }
        g.emit('explosion', { x: p.x, y: p.y, z: p.z, size: p.splash / 3, kind: p.type });
        g.emit('shake', { x: p.x, z: p.z, power: Math.min(0.5, p.splash * 0.08) });
      } else if (hitUnit) {
        const l = Math.hypot(p.vx, p.vz) || 1;
        g.damageUnit(hitUnit, p.damage, p.source, p.vx / l, 0.25, p.vz / l, p.knock, hitK);
        if (p.stun) {
          hitUnit.rd.stun = Math.max(hitUnit.rd.stun, p.stun);
          hitUnit.pieFace = 3.5;
        }
        g.emit('impact', { x: p.x, y: p.y, z: p.z, kind: p.type, team: p.team });
      } else if (hitB) {
        g.damageBuilding(hitB, p.damage * p.structMult, p.source, p.x, p.z);
        g.emit('impact', { x: p.x, y: p.y, z: p.z, kind: p.type, team: p.team });
      } else {
        g.emit('impact', { x: p.x, y: p.y, z: p.z, kind: p.type, ground: true, vx: p.vx, vy: p.vy, vz: p.vz, team: p.team });
      }
    }
  }
}
