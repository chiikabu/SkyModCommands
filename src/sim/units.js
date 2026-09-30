// ─────────────────────────────────────────────────────────────────────────────
//  Units: wobbly soldiers (and bumper cars) with role-based battle AI.
// ─────────────────────────────────────────────────────────────────────────────
import { UNIT_TYPES, DT, GRAVITY, HALF_W, MID, PARK_LZ1 } from '../config.js';
import { Ragdoll, driveRagdoll, tickAnim, playAnim, knock } from './ragdoll.js';
import { PELVIS, NECK, HEAD, RHAND, LHAND, TIP, RFOOT, LFOOT } from './physics.js';
import { sgn, forwardHeading, toWorldX, toWorldZ, inOwnTerritory } from './team.js';
import { colliderDistance } from './world.js';

export const WEAPON_LEN = { mop: 1.05, mallet: 1.25, whip: 1.35, popgun: 0.75, none: 0 };
const ANIM_DUR = { swing: 0.62, slam: 1.15, punch: 0.42, throw: 0.62, whip: 0.6, fire: 0.5, stomp: 1.2, aim: 0.5 };
const MELEE_ROLES = new Set(['melee', 'tank', 'heavy', 'boss', 'cavalry', 'assassin']);

// Target preference by attacker role → target role.
const PREF = {
  melee: { ranged: 1.25, artillery: 1.4, support: 1.2, skirmisher: 1.1 },
  tank: { melee: 1.15, heavy: 1.1, skirmisher: 1.2, assassin: 1.2 },
  heavy: { tank: 1.45, boss: 1.4, cavalry: 1.4, melee: 1.15 },
  ranged: { boss: 1.2, skirmisher: 1.35, cavalry: 1.3, assassin: 1.3, support: 1.2, ranged: 1.1 },
  artillery: {},
  skirmisher: { ranged: 1.9, artillery: 2.2, support: 1.6, melee: 0.8, tank: 0.6, heavy: 0.8 },
  cavalry: { ranged: 2.1, artillery: 2.6, support: 1.8, skirmisher: 1.3, melee: 0.9, tank: 0.45, heavy: 0.55, boss: 0.5 },
  assassin: { artillery: 2.6, ranged: 1.8, support: 1.6 },
  support: {},
  boss: { tank: 1.1, heavy: 1.1 },
};
const VALUE = (u) => u.def.cost;

let NEXT_ID = 1;

export class Unit {
  constructor(game, team, type, lx, lz) {
    this.id = NEXT_ID++;
    this.game = game;
    this.team = team;
    this.type = type;
    const def = (this.def = UNIT_TYPES[type]);
    this.role = def.role;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.alive = true;
    this.homeLX = lx;
    this.homeLZ = lz;
    this.rd = new Ragdoll({ scale: def.scale, weaponLen: WEAPON_LEN[def.weapon] || 0, mass: def.type === 'giant' ? 14 : undefined });
    if (type === 'giant') {
      this.rd.mass = 16;
      this.rd.bodyRadiusMul = 1.25;
      this.rd.turnRate = 3;
    }
    if (type === 'mascot') this.rd.bodyRadiusMul = 1.25;
    this.rd.owner = this;
    this.rd.team = team;
    this.rd.kind = 'unit';
    this.rd.pose = this.basePose();
    this.target = null;
    this.targetIsUnit = false;
    this.pending = null;
    this.cooldown = game.rng.range(0.1, 0.8);
    this.thinkTimer = game.rng.range(0, 0.3);
    this.buff = 0;
    this.deathTime = -1;
    this.flying = false;
    this.launched = false;
    this.flyTime = 0;
    this.stats = { dmg: 0, kills: 0 };
    this.vehicle = null;
    this.engaged = 0;
    this.lastHitTime = -10;
    this.pieFace = 0;
    this.dir = [0, 0];
    this.placedRound = game.round;
    this.radius = 0.32 * def.scale;
    this.wander = game.rng.range(-1, 1);
    const x = toWorldX(team, lx), z = toWorldZ(team, lz);
    const hd = forwardHeading(team);
    game.phys.alloc(this.rd, x, z, hd);
    this.rd.targetHeading = hd;
    if (def.vehicle) this.makeVehicle(x, z, hd);
  }

  basePose() {
    const w = this.def.weapon;
    if (w === 'mop' || w === 'mallet') return 'guard';
    if (w === 'popgun') return 'aim';
    if (w === 'whip') return 'whipReady';
    if (this.def.vehicle) return 'drive';
    if (this.def.attack.kind === 'ranged') return 'ready';
    if (this.def.attack.anim === 'punch') return 'fists';
    return 'idle';
  }

  get x() {
    if (this.vehicle) return this.vehicle.x;
    return this.game.phys.x[this.rd.base + PELVIS];
  }
  get z() {
    if (this.vehicle) return this.vehicle.z;
    return this.game.phys.z[this.rd.base + PELVIS];
  }
  get y() {
    return this.game.phys.y[this.rd.base + PELVIS];
  }
  get stunned() {
    return this.rd.stun > 0 || this.rd.muscle < 0.6 || this.flying;
  }
  velocity() {
    if (this.vehicle) return [Math.sin(this.vehicle.h) * this.vehicle.speed, Math.cos(this.vehicle.h) * this.vehicle.speed];
    const p = this.game.phys, k = this.rd.base + PELVIS;
    return [(p.x[k] - p.px[k]) / DT, (p.z[k] - p.pz[k]) / DT];
  }

  makeVehicle(x, z, h) {
    this.vehicle = { x, z, h, speed: 0, radius: 1.25, hitCd: new Map(), bounce: 0, wreck: false, turnDir: 0, pass: 0 };
    this.rd.pinned = { x, y: 0, z, pose: 'drive', fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 };
    this.rd.noCollide = true;
    this.updateSeat();
  }
  updateSeat() {
    const v = this.vehicle;
    const g = this.game.world.heightAt(v.x, v.z);
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const pn = this.rd.pinned;
    pn.x = v.x - fx * 0.25;
    pn.y = g + 0.62;
    pn.z = v.z - fz * 0.25;
    pn.fx = fx; pn.fy = 0; pn.fz = fz;
    this.rd.heading = v.h;
    this.rd.targetHeading = v.h;
  }

  // Teleport back to home (used between rounds)
  resetToHome() {
    const phys = this.game.phys;
    const x = toWorldX(this.team, this.homeLX), z = toWorldZ(this.team, this.homeLZ);
    const hd = forwardHeading(this.team);
    this.rd.muscle = 1;
    this.rd.targetMuscle = 1;
    this.rd.stun = 0;
    this.rd.anim = null;
    this.rd.footOverride = null;
    this.rd.gravityScale = 1;
    phys.placeStanding(this.rd, x, z, hd);
    this.rd.targetHeading = hd;
    this.rd.vx = this.rd.vz = 0;
    this.target = null;
    this.flying = false;
    this.launched = false;
    this.pieFace = 0;
    this.buff = 0;
    if (this.vehicle) {
      this.vehicle.x = x; this.vehicle.z = z; this.vehicle.h = hd; this.vehicle.speed = 0;
      this.updateSeat();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Battle AI + per-step update
// ─────────────────────────────────────────────────────────────────────────────
export class UnitSystem {
  constructor(game) {
    this.game = game;
    this.tmp = [0, 0];
  }

  // Called every step for every unit (alive or not).
  update(u) {
    const g = this.game;
    const rd = u.rd;
    if (!u.alive) {
      driveRagdoll(g.phys, rd);
      return;
    }
    if (u.cooldown > 0) u.cooldown -= DT;
    if (u.buff > 0) {
      u.buff -= DT;
      if (u.buffRegen) u.hp = Math.min(u.maxHp, u.hp + u.buffRegen * DT);
    }
    if (u.pieFace > 0) u.pieFace -= DT;
    // cannonball flight
    if (u.flying) {
      this.updateFlight(u);
      driveRagdoll(g.phys, rd);
      return;
    }
    const battle = g.phase === 'battle' && g.battleStarted;
    if (u.vehicle) {
      this.updateVehicle(u, battle);
      driveRagdoll(g.phys, rd);
      if (tickAnim(rd, DT)) this.strike(u);
      return;
    }
    if (!battle) {
      // Prep / post-battle: stand at home (or celebrate)
      rd.vx = rd.vz = 0;
      if (g.phase === 'prep') this.steerHome(u, 1.5);
      if (g.celebrate === u.team && !rd.anim && g.rng.chance(0.01)) playAnim(rd, 'cheer', 1.2);
      driveRagdoll(g.phys, rd);
      tickAnim(rd, DT);
      return;
    }
    u.thinkTimer -= DT;
    if (u.thinkTimer <= 0) {
      u.thinkTimer = 0.22 + g.rng.next() * 0.1;
      this.think(u);
    }
    if (u.stunned) {
      rd.vx = rd.vz = 0;
    } else {
      this.act(u);
    }
    driveRagdoll(g.phys, rd);
    if (tickAnim(rd, DT)) this.strike(u);
  }

  steerHome(u, speed) {
    const rd = u.rd;
    const hx = toWorldX(u.team, u.homeLX), hz = toWorldZ(u.team, u.homeLZ);
    const dx = hx - u.x, dz = hz - u.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) {
      const sp = Math.min(speed, d * 1.5);
      rd.vx = (dx / d) * sp;
      rd.vz = (dz / d) * sp;
      if (d > 1.5) rd.targetHeading = Math.atan2(dx, dz);
    } else {
      rd.vx = rd.vz = 0;
      rd.targetHeading = forwardHeading(u.team);
    }
  }

  // ── Target selection ──
  think(u) {
    const g = this.game;
    const enemies = g.units[1 - u.team];
    const stance = g.teams[u.team].stance;
    const def = u.def;
    const ux = u.x, uz = u.z;
    const role = u.role;
    const atk = def.attack;
    const range = atk.range || atk.reach || 1.5;
    const sense = role === 'artillery' ? 58 : role === 'cavalry' ? 60 : role === 'ranged' ? 40 : role === 'boss' ? 40 : 34;
    const pref = PREF[role] || {};
    let best = null, bestScore = 0;

    if (role === 'artillery') {
      // cluster targeting (value of enemies inside the splash)
      const minR = atk.minRange || 0;
      for (const e of enemies) {
        if (!e.alive || e.flying) continue;
        const d = Math.hypot(e.x - ux, e.z - uz);
        if (d > sense || d < minR) continue;
        if (stance === 'hold' && d > range + 6 && !inOwnTerritory(u.team, e.x, e.z)) continue;
        let v = 0;
        for (const f of enemies) {
          if (!f.alive) continue;
          const dd = Math.hypot(f.x - e.x, f.z - e.z);
          if (dd < atk.splash * 1.1) v += VALUE(f) * (1 - dd / (atk.splash * 1.6));
        }
        const s = v / (1 + Math.max(0, d - range) / 10) * (e === u.target ? 1.2 : 1);
        if (s > bestScore) {
          bestScore = s;
          best = e;
        }
      }
    } else if (role !== 'support') {
      for (const e of enemies) {
        if (!e.alive || e.flying) continue;
        const dx = e.x - ux, dz = e.z - uz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > sense) continue;
        if (stance === 'hold' && !inOwnTerritory(u.team, e.x, e.z) && d > range + 2) continue;
        const falloff = MELEE_ROLES.has(role) && role !== 'cavalry' ? 7 : 18;
        let s = (pref[e.role] || 1) / (1 + d / falloff);
        if (e.hp < e.maxHp * 0.35) s *= 1.25;
        if (MELEE_ROLES.has(role) && role !== 'cavalry') s /= 1 + 0.3 * Math.max(0, e.engaged - (e.def.scale > 1.5 ? 4 : 1));
        if (e.target === u && d < 8) s *= 1.5;
        if (e === u.target) s *= 1.3;
        if (s > bestScore) {
          bestScore = s;
          best = e;
        }
      }
    }
    if (u.target && u.targetIsUnit && u.target.alive && u.target !== best && MELEE_ROLES.has(role)) {
      u.target.engaged = Math.max(0, u.target.engaged - 1);
    }
    if (best) {
      if (best !== u.target && MELEE_ROLES.has(role)) best.engaged++;
      u.target = best;
      u.targetIsUnit = true;
      return;
    }
    u.target = null;
    u.targetIsUnit = false;
    // No enemy units: structures. Siege logic — silence nearby defenses that are
    // shooting at us, otherwise head for the castle; wreck rides only when they're
    // right in the way (or when the castle is out of reach).
    if (role === 'support') return;
    let bs = null, bsd = 1e9;
    const castle = g.parks[1 - u.team].castle;
    const cd = castle && castle.hp > 0 ? Math.hypot(castle.x - ux, castle.z - uz) - castle.radius : 1e9;
    for (const b of g.buildings) {
      if (b.team === u.team || !b.targetable || b.hp <= 0) continue;
      const dd = Math.hypot(b.x - ux, b.z - uz) - b.radius;
      let limit, pr;
      if (stance === 'hold') {
        limit = atk.range || 3;
        pr = 1;
      } else if (b.type === 'castle') {
        limit = 60;
        pr = 0.35;
      } else if (b.def.combat || b.coaster) {
        limit = 11;
        pr = 0.5;
      } else {
        limit = cd < 45 ? 2.5 : 12;
        pr = 1;
      }
      if (dd > limit) continue;
      if (dd * pr < bsd) {
        bsd = dd * pr;
        bs = b;
      }
    }
    if (bs) {
      u.target = bs;
      u.targetIsUnit = false;
    }
  }

  // ── Movement + attack decisions ──
  act(u) {
    const g = this.game;
    const rd = u.rd;
    const def = u.def;
    const atk = def.attack;
    const stance = g.teams[u.team].stance;
    const speedMul = u.buff > 0 ? 1.2 : 1;
    const speed = def.speed * speedMul * 1.12;
    const ux = u.x, uz = u.z;
    let mvx = 0, mvz = 0, faceX = 0, faceZ = 0;
    const t = u.target;

    if (u.role === 'support') {
      // stay behind the ally front, whip anything close
      const allies = g.units[u.team];
      let cx = 0, cz = 0, n = 0;
      for (const a of allies) {
        if (!a.alive || a === u || a.role === 'support') continue;
        if (!MELEE_ROLES.has(a.role) && a.role !== 'skirmisher') continue;
        cx += a.x; cz += a.z; n++;
      }
      let near = null, nd = 1e9;
      for (const e of g.units[1 - u.team]) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - ux, e.z - uz);
        if (d < nd) { nd = d; near = e; }
      }
      if (n > 0) {
        cx /= n; cz /= n;
        // behind the center relative to the nearest enemy (or the enemy side)
        let bx = 0, bz = sgn(u.team);
        if (near) {
          const dx = cx - near.x, dz = cz - near.z;
          const l = Math.hypot(dx, dz) || 1;
          bx = dx / l; bz = dz / l;
        }
        const tx = cx + bx * 5, tz = cz + bz * 5;
        const dx = tx - ux, dz = tz - uz;
        const d = Math.hypot(dx, dz);
        if (d > 1.2) { mvx = (dx / d) * Math.min(speed, d); mvz = (dz / d) * Math.min(speed, d); }
      } else if (stance === 'charge') {
        this.followField(u, speed * 0.8);
        mvx = rd.vx; mvz = rd.vz;
      }
      if (near && nd < atk.reach + 0.6) {
        faceX = near.x - ux; faceZ = near.z - uz;
        if (u.cooldown <= 0 && !rd.anim) this.startAttack(u, near);
      } else if (near) {
        faceX = near.x - ux; faceZ = near.z - uz;
      }
    } else if (t && u.targetIsUnit) {
      const dx = t.x - ux, dz = t.z - uz;
      const d = Math.hypot(dx, dz) || 0.001;
      const nx = dx / d, nz = dz / d;
      faceX = dx; faceZ = dz;
      const kind = atk.kind;
      if (kind === 'melee') {
        const reach = atk.reach + t.radius + 0.1;
        if (d > reach * 0.85) {
          this.steerTo(u, t.x, t.z, speed);
          mvx = rd.vx; mvz = rd.vz;
        }
        if (d < reach + 0.35 && u.cooldown <= 0 && !rd.anim) this.startAttack(u, t);
      } else if (kind === 'ranged' || kind === 'lob') {
        const range = atk.range;
        const minR = atk.minRange || 0;
        // threat: nearest enemy that wants to hit me in melee
        let threat = null, td = 1e9;
        for (const e of g.units[1 - u.team]) {
          if (!e.alive || !MELEE_ROLES.has(e.role) || e.stunned) continue;
          const dd = Math.hypot(e.x - ux, e.z - uz);
          if (dd < td) { td = dd; threat = e; }
        }
        const kiteDist = u.role === 'artillery' ? Math.max(minR + 2, 9) : u.role === 'skirmisher' ? 3.2 : 6.5;
        const canKite = threat && td < kiteDist && (threat.def.speed <= def.speed * 1.15 || u.role === 'artillery') && threat.role !== 'cavalry';
        if (canKite && u.cooldown > 0.25) {
          // back off away from the threat, drifting toward home side
          let ax = ux - threat.x, az = uz - threat.z;
          const l = Math.hypot(ax, az) || 1;
          ax /= l; az /= l;
          ax += 0; az += sgn(u.team) * 0.35;
          const l2 = Math.hypot(ax, az) || 1;
          mvx = (ax / l2) * speed; mvz = (az / l2) * speed;
          // keep in bounds
          if (Math.abs(ux + mvx) > HALF_W - 1) mvx = 0;
        } else if (d > range * 0.95) {
          this.steerTo(u, t.x, t.z, speed);
          mvx = rd.vx; mvz = rd.vz;
        } else if (d < minR + 1) {
          mvx = -nx * speed; mvz = -nz * speed;
        } else if (u.role === 'skirmisher' && (d > range * 0.55 || (t.def.attack.minRange && d > t.def.attack.minRange * 0.6))) {
          mvx = nx * speed * 0.7; mvz = nz * speed * 0.7;
        }
        if (d <= range && d >= minR && u.cooldown <= 0 && !rd.anim) this.startAttack(u, t);
      }
    } else if (t && !u.targetIsUnit) {
      // Structure target: walk to nearest point on its footprint
      let cp = null;
      for (const c of t.colliders) {
        const r = colliderDistance(c, ux, uz);
        if (!cp || r.d < cp.d) cp = r;
      }
      if (cp) {
        faceX = cp.x - ux; faceZ = cp.z - uz;
        const reach = atk.kind === 'melee' ? atk.reach + 0.45 : atk.range || 3;
        if (cp.d > reach * 0.8) {
          if (t.type === 'castle' && cp.d > 6) this.followField(u, speed, g.castleFields[u.team]);
          else this.steerTo(u, cp.x, cp.z, speed, t);
          mvx = rd.vx; mvz = rd.vz;
        }
        if (cp.d <= reach && u.cooldown <= 0 && !rd.anim) this.startAttack(u, t);
      }
    } else {
      // No target
      if (stance === 'charge') {
        this.followField(u, speed * 0.92);
        mvx = rd.vx; mvz = rd.vz;
      } else {
        this.steerHome(u, speed * 0.7);
        mvx = rd.vx; mvz = rd.vz;
      }
    }
    // Hold stance: don't leave own territory by much
    if (stance === 'hold' && u.role !== 'artillery') {
      const lz = uz * sgn(u.team);
      if (lz < MID - 3 && mvz * sgn(u.team) < 0) mvz = 0;
    }
    // Separation from allies
    const allies = g.units[u.team];
    let sx = 0, sz = 0;
    for (const a of allies) {
      if (a === u || !a.alive || a.vehicle) continue;
      const dx = ux - a.x, dz = uz - a.z;
      const d2 = dx * dx + dz * dz;
      const rr = (u.radius + a.radius) * 1.6;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const f = (rr - d) / rr;
        sx += (dx / d) * f;
        sz += (dz / d) * f;
      }
    }
    mvx += sx * 2.2;
    mvz += sz * 2.2;
    // Map bounds
    if (ux > HALF_W - 0.5 && mvx > 0) mvx = -0.5;
    if (ux < -HALF_W + 0.5 && mvx < 0) mvx = 0.5;
    rd.vx = mvx;
    rd.vz = mvz;
    if (faceX || faceZ) rd.targetHeading = Math.atan2(faceX, faceZ);
    else if (Math.abs(mvx) + Math.abs(mvz) > 0.3) rd.targetHeading = Math.atan2(mvx, mvz);
  }

  steerTo(u, tx, tz, speed, ignore = null) {
    const g = this.game;
    const rd = u.rd;
    const ux = u.x, uz = u.z;
    let dx = tx - ux, dz = tz - uz;
    const d = Math.hypot(dx, dz) || 0.001;
    dx /= d; dz /= d;
    // obstacle check a few metres ahead
    const look = Math.min(d, 4);
    const blk = g.world.segmentBlocked(ux, uz, ux + dx * look, uz + dz * look, 1.2, ignore);
    if (blk) {
      // try rotated directions
      let bestA = null;
      for (const a of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const rx = dx * ca - dz * sa, rz = dx * sa + dz * ca;
        if (!g.world.segmentBlocked(ux, uz, ux + rx * 3.5, uz + rz * 3.5, 1.2, ignore)) {
          bestA = [rx, rz];
          break;
        }
      }
      if (bestA) {
        dx = bestA[0]; dz = bestA[1];
      } else {
        // fall back to the flow field
        const f = g.fields[u.team];
        if (f && f.direction(ux, uz, this.tmp)) {
          dx = this.tmp[0]; dz = this.tmp[1];
        }
      }
    }
    rd.vx = dx * speed;
    rd.vz = dz * speed;
  }

  followField(u, speed, field = null) {
    const g = this.game;
    const rd = u.rd;
    const f = field || g.castleFields[u.team] || g.fields[u.team];
    const dir = f ? f.direction(u.x, u.z, this.tmp) : null;
    let dx, dz;
    if (dir) {
      dx = dir[0]; dz = dir[1];
    } else {
      dx = 0; dz = -sgn(u.team);
    }
    // blend with previous direction for smoothness + slight individual wander
    u.dir[0] = u.dir[0] * 0.85 + dx * 0.15;
    u.dir[1] = u.dir[1] * 0.85 + dz * 0.15;
    const l = Math.hypot(u.dir[0], u.dir[1]) || 1;
    rd.vx = (u.dir[0] / l) * speed;
    rd.vz = (u.dir[1] / l) * speed;
  }

  startAttack(u, target) {
    const atk = u.def.attack;
    const g = this.game;
    const anim = atk.anim;
    let dur = ANIM_DUR[anim] || 0.6;
    dur = Math.min(dur, atk.cooldown * 0.95);
    if (anim === 'aim') {
      playAnim(u.rd, 'fire', dur);
    } else {
      playAnim(u.rd, anim, dur, anim === 'punch' ? (u.flip = !u.flip) : false);
    }
    u.pending = target;
    u.cooldown = atk.cooldown * g.rng.range(0.9, 1.1) / (u.buff > 0 ? 1.1 : 1);
  }

  // Resolve the damaging moment of an attack animation.
  strike(u) {
    const g = this.game;
    const t = u.pending;
    u.pending = null;
    if (!u.alive || !t) return;
    const atk = u.def.attack;
    const def = u.def;
    const dmgMul = u.buff > 0 ? 1.3 : 1;
    const ux = u.x, uz = u.z;
    const h = u.rd.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    if (atk.kind === 'melee') {
      if (t.isBuilding) {
        if (t.hp > 0) {
          let cp = null;
          for (const c of t.colliders) {
            const r = colliderDistance(c, ux, uz);
            if (!cp || r.d < cp.d) cp = r;
          }
          if (cp && cp.d <= atk.reach + 0.9) {
            g.damageBuilding(t, atk.damage * (atk.structMult || 1) * dmgMul, u, cp.x, cp.z);
            if (atk.splash) g.splash(u.team, cp.x, cp.z, atk.splash, atk.damage * dmgMul * 0.8, atk.knock, u, 'slam');
          }
        }
        return;
      }
      if (!t.alive) return;
      const d = Math.hypot(t.x - ux, t.z - uz);
      const reach = atk.reach + t.radius + 0.5;
      if (atk.splash) {
        const ix = ux + fx * atk.reach * 0.7, iz = uz + fz * atk.reach * 0.7;
        g.splash(u.team, ix, iz, atk.splash, atk.damage * dmgMul, atk.knock, u, atk.anim === 'stomp' ? 'stomp' : 'slam');
        if (atk.anim === 'stomp' || def.scale > 1.1) g.emit('shake', { x: ix, z: iz, power: atk.anim === 'stomp' ? 0.9 : 0.35 });
        return;
      }
      if (d <= reach) {
        const nx = (t.x - ux) / (d || 1), nz = (t.z - uz) / (d || 1);
        const part = g.rng.chance(0.4) ? HEAD : NECK;
        g.damageUnit(t, atk.damage * dmgMul, u, nx, 0.35, nz, atk.knock, part);
        g.emit('melee', { x: t.x, y: t.y + 0.6, z: t.z, weapon: def.weapon, anim: atk.anim, team: u.team });
      } else {
        g.emit('whiff', { x: ux, z: uz });
      }
    } else if (atk.kind === 'ranged' || atk.kind === 'lob') {
      if (t.isBuilding || !t.alive) return;
      const p = g.phys;
      const hk = u.rd.base + (def.weapon === 'popgun' ? TIP : RHAND);
      const sx = p.x[hk], sy = p.y[hk], sz = p.z[hk];
      // lead the target
      const [tvx, tvz] = t.velocity();
      const dist = Math.hypot(t.x - sx, t.z - sz);
      let tt = dist / atk.projSpeed;
      if (atk.kind === 'lob') tt = Math.max(0.9, dist / atk.projSpeed * 1.35);
      const lead = u.type === 'popper' ? 0.85 : 0.7;
      let tx = t.x + tvx * tt * lead, tz = t.z + tvz * tt * lead;
      const ty = t.y + (atk.kind === 'lob' ? -0.8 : 0.35);
      // accuracy spread
      const spread = atk.spread || 0.03;
      tx += g.rng.gauss() * dist * spread;
      tz += g.rng.gauss() * dist * spread;
      g.projectiles.fire({
        type: atk.proj, team: u.team, source: u,
        sx, sy, sz, tx, ty, tz, time: tt, gravity: atk.kind === 'lob' ? GRAVITY : atk.proj === 'pie' ? 6 : 2.5,
        damage: atk.damage * dmgMul, splash: atk.splash || 0, knock: atk.knock, stun: atk.stun || 0,
      });
      if (def.weapon === 'popgun') {
        // recoil
        knock(g.phys, u.rd, -fx, 0.1, -fz, 3.5);
        g.emit('shot', { x: sx, y: sy, z: sz, kind: 'popgun', team: u.team });
      } else g.emit('throw', { x: sx, y: sy, z: sz, kind: atk.proj });
    }
  }

  // ── Bumper car ──
  updateVehicle(u, battle) {
    const g = this.game;
    const v = u.vehicle;
    v.px = v.x; v.pz = v.z; v.ph = v.h;
    const def = u.def;
    const stance = g.teams[u.team].stance;
    let tx = null, tz = null;
    let wantSpeed = 0;
    if (!battle) {
      const hx = toWorldX(u.team, u.homeLX), hz = toWorldZ(u.team, u.homeLZ);
      if (Math.hypot(hx - v.x, hz - v.z) > 1.5) {
        tx = hx; tz = hz; wantSpeed = 3;
      } else {
        v.speed *= 0.9;
        const dh = forwardHeading(u.team) - v.h;
        v.h += Math.atan2(Math.sin(dh), Math.cos(dh)) * 0.05;
      }
    } else {
      u.thinkTimer -= DT;
      if (u.thinkTimer <= 0) {
        u.thinkTimer = 0.3;
        this.think(u);
      }
      const t = u.target;
      if (t && u.targetIsUnit && t.alive) {
        const dx = t.x - v.x, dz = t.z - v.z;
        const d = Math.hypot(dx, dz);
        const fx = Math.sin(v.h), fz = Math.cos(v.h);
        const ahead = (dx * fx + dz * fz) / (d || 1);
        if (v.pass > 0) {
          // overshoot after a ram, then turn around
          v.pass -= DT;
          tx = v.x + fx * 10; tz = v.z + fz * 10;
          wantSpeed = def.speed;
        } else if (ahead < 0.2 && d < 7) {
          // target behind at close range: loop around
          tx = v.x + fx * 6 + fz * 4; tz = v.z + fz * 6 - fx * 4;
          wantSpeed = def.speed * 0.7;
        } else {
          // lead target
          const [tvx, tvz] = t.velocity();
          const tt = Math.min(1.2, d / Math.max(4, v.speed));
          tx = t.x + tvx * tt; tz = t.z + tvz * tt;
          wantSpeed = def.speed;
        }
      } else if (t && !u.targetIsUnit && t.hp > 0) {
        tx = t.x; tz = t.z; wantSpeed = def.speed * 0.8;
      } else if (stance === 'charge') {
        const dir = g.fields[u.team] ? g.fields[u.team].direction(v.x, v.z, this.tmp) : null;
        if (dir) {
          tx = v.x + dir[0] * 6; tz = v.z + dir[1] * 6;
        } else {
          tx = v.x; tz = v.z - sgn(u.team) * 6;
        }
        wantSpeed = def.speed * 0.6;
      } else {
        const hx = toWorldX(u.team, u.homeLX), hz = toWorldZ(u.team, u.homeLZ);
        if (Math.hypot(hx - v.x, hz - v.z) > 2) { tx = hx; tz = hz; wantSpeed = def.speed * 0.5; }
      }
    }
    if (u.rd.stun > 0 || v.bounce > 0) {
      v.bounce -= DT;
      wantSpeed = 0;
    }
    if (tx !== null) {
      const desired = Math.atan2(tx - v.x, tz - v.z);
      let dh = desired - v.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const turn = 2.6 * DT;
      v.h += Math.max(-turn, Math.min(turn, dh));
      if (Math.abs(dh) > 1.2) wantSpeed *= 0.55;
    }
    const acc = wantSpeed > v.speed ? 6.5 : 9;
    v.speed += Math.max(-acc * DT, Math.min(acc * DT, wantSpeed - v.speed));
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    v.x += fx * v.speed * DT;
    v.z += fz * v.speed * DT;
    // static colliders
    const cs = g.world.collidersAt(v.x, v.z);
    if (cs) {
      for (const c of cs) {
        if (c.ghost || c.h < 0.6) continue;
        const r = colliderDistance(c, v.x, v.z);
        if (r.d < v.radius) {
          const inside = r.d < 1e-3;
          let nx = v.x - r.x, nz = v.z - r.z;
          const l = Math.hypot(nx, nz) || 1;
          if (inside) { nx = -fx; nz = -fz; } else { nx /= l; nz /= l; }
          const pen = v.radius - r.d;
          v.x += nx * pen;
          v.z += nz * pen;
          if (battle && c.owner && c.owner.isBuilding && c.owner.team !== u.team && c.owner.hp > 0 && v.speed > 3) {
            g.damageBuilding(c.owner, def.attack.damage * 0.5 * (v.speed / def.speed), u, r.x, r.z);
          }
          v.speed *= 0.3;
          v.bounce = 0.35;
        }
      }
    }
    // map bounds
    v.x = Math.max(-HALF_W - 1, Math.min(HALF_W + 1, v.x));
    v.z = Math.max(-PARK_LZ1 - 2, Math.min(PARK_LZ1 + 2, v.z));
    // vs other cars
    for (const team of [0, 1]) {
      for (const o of g.units[team]) {
        if (o === u || !o.alive || !o.vehicle) continue;
        const dx = v.x - o.vehicle.x, dz = v.z - o.vehicle.z;
        const d = Math.hypot(dx, dz);
        const rr = v.radius + o.vehicle.radius;
        if (d < rr && d > 1e-4) {
          const pen = (rr - d) * 0.5;
          v.x += (dx / d) * pen; v.z += (dz / d) * pen;
          o.vehicle.x -= (dx / d) * pen; o.vehicle.z -= (dz / d) * pen;
          if (battle && o.team !== u.team && v.speed > 3) {
            const cd = v.hitCd.get(o.id) || 0;
            if (g.time > cd) {
              v.hitCd.set(o.id, g.time + 0.8);
              g.damageUnit(o, def.attack.damage * 0.6 * (v.speed / def.speed), u, -dx / d, 0.2, -dz / d, 4, NECK);
              g.emit('bump', { x: v.x, z: v.z, power: v.speed });
            }
          }
          v.speed *= 0.7;
        }
      }
    }
    // ram ragdolls
    if (battle && v.speed > 2.5) {
      g.phys.queryBodies(v.x + fx * 0.6, v.z + fz * 0.6, v.radius + 0.4, (rd, k, dist) => {
        if (rd === u.rd) return;
        const o = rd.owner;
        if (!o) return;
        const dy = g.phys.y[k] - g.world.heightAt(v.x, v.z);
        if (dy > 2.2) return;
        if (rd.kind === 'unit' && o.team !== u.team && o.alive) {
          const cd = v.hitCd.get(o.id) || 0;
          if (g.time < cd) return;
          v.hitCd.set(o.id, g.time + 0.7);
          const power = v.speed / def.speed;
          g.damageUnit(o, def.attack.damage * power * (u.buff > 0 ? 1.3 : 1), u, fx, 0.55, fz, def.attack.knock * (0.5 + power), NECK);
          g.emit('bump', { x: v.x, z: v.z, power: v.speed });
          v.speed *= 0.62;
          if (u.targetIsUnit && u.target === o) v.pass = 0.9;
        } else if (rd.kind === 'unit' && o.team === u.team) {
          // nudge friends
          g.phys.impulse(rd, fx * 1.5, 0.3, fz * 1.5);
        } else if (rd.kind === 'guest') {
          knock(g.phys, rd, fx, 0.6, fz, 8);
          o.onKnocked && o.onKnocked();
        }
      });
    }
    u.updateSeat();
  }

  // ── Human cannonball ──
  launch(u) {
    const g = this.game;
    const L = u.def.launch;
    u.launched = true;
    const enemies = g.units[1 - u.team];
    let best = null, bs = 0;
    for (const e of enemies) {
      if (!e.alive || e.flying) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d > L.range || d < 8) continue;
      let v = 0;
      for (const f of enemies) {
        if (!f.alive) continue;
        const dd = Math.hypot(f.x - e.x, f.z - e.z);
        if (dd < L.splash) v += (PREF.assassin[f.role] || 0.6) * f.def.cost * (1 - dd / (L.splash * 1.5));
      }
      if (v > bs) { bs = v; best = e; }
    }
    if (!best) return false;
    const T = Math.max(1.4, Math.min(3.0, Math.hypot(best.x - u.x, best.z - u.z) / 24));
    const [tvx, tvz] = best.velocity();
    const tx = best.x + tvx * T * 0.6, tz = best.z + tvz * T * 0.6;
    const ty = g.world.heightAt(tx, tz) + 0.8;
    const sy = u.y;
    const vx = (tx - u.x) / T, vz = (tz - u.z) / T;
    const vy = (ty - sy + 0.5 * GRAVITY * T * T) / T;
    u.rd.targetMuscle = 0;
    u.rd.muscle = 0;
    g.phys.setVelocity(u.rd, vx, vy, vz);
    u.rd.noDamp = true;
    u.flying = true;
    u.flyTime = 0;
    g.emit('cannon', { x: u.x, y: u.y, z: u.z, team: u.team, vx, vy, vz });
    return true;
  }

  updateFlight(u) {
    const g = this.game;
    u.flyTime += DT;
    const p = g.phys;
    const k = u.rd.base + PELVIS;
    const vy = (p.y[k] - p.py[k]) / DT;
    const gy = g.world.heightAt(p.x[k], p.z[k]);
    let impact = false;
    if (u.flyTime > 0.35 && vy < 0) {
      if (p.y[k] - gy < 0.7) impact = true;
      else {
        g.phys.queryBodies(p.x[k], p.z[k], 1.0, (rd) => {
          if (rd.kind === 'unit' && rd.owner.team !== u.team && rd.owner.alive) impact = true;
        });
      }
    }
    if (u.flyTime > 5) impact = true;
    if (impact) {
      u.flying = false;
      u.rd.noDamp = false;
      const L = u.def.launch;
      g.splash(u.team, p.x[k], p.z[k], L.splash, L.damage * (u.buff > 0 ? 1.3 : 1), L.knock, u, 'cannonball');
      g.emit('explosion', { x: p.x[k], y: gy + 0.3, z: p.z[k], size: 1.2, kind: 'confetti' });
      g.emit('shake', { x: p.x[k], z: p.z[k], power: 0.6 });
      u.rd.stun = 0.9;
      u.rd.targetMuscle = 1;
    }
  }
}
