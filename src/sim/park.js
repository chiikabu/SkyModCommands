// ─────────────────────────────────────────────────────────────────────────────
//  Park: grid placement, paths, rides (with seats + combat hooks), economy.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BUILDINGS, TILE, GRID_W, TERR_ROWS, DEPLOY_ROWS, PATH_COST, DT, GRAVITY, CASTLE_DEFENSE, HALF_W, MID,
} from '../config.js';
import { sgn, tileCenterLX, tileCenterLZ, inGrid, inPark, forwardHeading } from './team.js';
import { knock } from './ragdoll.js';
import { colliderDistance } from './world.js';

let NEXT_BID = 1;
const TAU = Math.PI * 2;

export function rotatedSize(def, rot) {
  return rot % 2 === 0 ? [def.w, def.d] : [def.d, def.w];
}
export function entranceTile(gx, gz, W, D, rot) {
  switch (rot) {
    case 0: return [gx + (W >> 1), gz - 1];
    case 1: return [gx + W, gz + (D >> 1)];
    case 2: return [gx + (W >> 1), gz + D];
    default: return [gx - 1, gz + (D >> 1)];
  }
}

export class Building {
  constructor(park, type, gx, gz, rot) {
    this.isBuilding = true;
    this.id = NEXT_BID++;
    this.park = park;
    this.game = park.game;
    this.team = park.team;
    this.type = type;
    this.def = BUILDINGS[type];
    this.gx = gx;
    this.gz = gz;
    this.rot = rot;
    const [W, D] = rotatedSize(this.def, rot);
    this.W = W;
    this.D = D;
    const s = sgn(this.team);
    const lx = -HALF_W + (gx + W / 2) * TILE;
    const lz = MID + (gz + D / 2) * TILE;
    this.lx = lx;
    this.lz = lz;
    this.x = lx * s;
    this.z = lz * s;
    this.heading = forwardHeading(this.team) - rot * (Math.PI / 2);
    this.radius = (Math.max(W, D) * TILE) / 2;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.targetable = this.def.cat !== 'scenery' && type !== 'gate';
    this.state = 'open';
    this.builtAt = this.game.time;
    this.colliders = [];
    this.cooldown = 0;
    this.income = 0;
    this.customers = 0;
    this.lastHit = -99;
    this.anim = { t: Math.random() * 50, speed: 0, angle: 0, swing: 0, swingV: 0, drop: 0, dropV: 0, spin: 0 };
    this.entrance = null;
    if (this.def.ride) {
      this.ride = { phase: 'idle', timer: 0, riders: [], queue: [], cycles: 0 };
    }
    if (this.def.shop) this.shop = { queue: [], serving: null, timer: 0 };
    this.hitCd = new Map();
    this.seatCache = null;
  }
  get ruined() {
    return this.state === 'ruined';
  }
  get cost() {
    return this.def.cost;
  }
  // Local-grid rect → world rect
  worldRect(pad = 0) {
    const s = sgn(this.team);
    const lx0 = -HALF_W + this.gx * TILE + pad, lx1 = -HALF_W + (this.gx + this.W) * TILE - pad;
    const lz0 = MID + this.gz * TILE + pad, lz1 = MID + (this.gz + this.D) * TILE - pad;
    const xa = lx0 * s, xb = lx1 * s, za = lz0 * s, zb = lz1 * s;
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
  }
  // world-space direction vectors for the building's local frame (model faces +z)
  frame() {
    const h = this.heading;
    return { fx: Math.sin(h), fz: Math.cos(h), rx: -Math.cos(h), rz: Math.sin(h) };
  }
  // transform model-space (mx right?, my, mz forward) → world. Model x axis = -right... we use three.js convention:
  // model +x maps to world (cos h, 0, -sin h), model +z maps to (sin h, 0, cos h)
  toWorld(mx, my, mz) {
    const h = this.heading;
    const c = Math.cos(h), s = Math.sin(h);
    return [this.x + mx * c + mz * s, my, this.z - mx * s + mz * c];
  }
}

export class Park {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.tiles = new Int32Array(GRID_W * TERR_ROWS); // 0 empty, -1 path, >0 building id
    this.buildings = [];
    this.byId = new Map();
    this.pathVersion = 1;
    this.castle = null;
    this.gate = null;
    this.rating = 50;
    this.guestCount = 0;
    this.injuries = 0;
    this.pricing = 1; // 0 cheap, 1 fair, 2 greedy
    this.upkeepTimer = 0;
    this.ratingTimer = 0;
    this.sceneryScore = 0;
  }

  tile(gx, gz) {
    return this.tiles[gz * GRID_W + gx];
  }
  setTile(gx, gz, v) {
    this.tiles[gz * GRID_W + gx] = v;
  }
  isPath(gx, gz) {
    return inGrid(gx, gz) && this.tiles[gz * GRID_W + gx] === -1;
  }

  setupStart() {
    // Castle in the middle-back of the park, gate at the very back.
    this.castle = this.place('castle', 21, 27, 0, { free: true, noPath: true });
    this.gate = this.place('gate', 22, 40, 0, { free: true, noPath: true });
    // Main boulevard + ring round the castle + front avenue
    const P = (gx, gz) => this.placePath(gx, gz, true);
    for (let gz = 33; gz <= 39; gz++) { P(23, gz); P(24, gz); }
    for (let gx = 20; gx <= 27; gx++) { P(gx, 26); P(gx, 33); }
    for (let gz = 26; gz <= 33; gz++) { P(20, gz); P(27, gz); }
    for (let gz = 19; gz <= 25; gz++) { P(23, gz); P(24, gz); }
    for (let gx = 8; gx <= 39; gx++) P(gx, 19);
    for (let gx = 12; gx <= 35; gx++) P(gx, 36);
    for (let gz = 20; gz <= 35; gz++) { P(12, gz); P(35, gz); }
    // Free decoration around the plaza
    const deco = [[19, 25, 'tree'], [28, 25, 'tree'], [19, 34, 'tree'], [28, 34, 'tree'], [22, 38, 'flowers'], [25, 38, 'flowers'],
      [21, 20, 'lamp'], [26, 20, 'lamp'], [13, 20, 'palm'], [34, 20, 'palm'], [11, 35, 'pine'], [36, 35, 'pine']];
    for (const [gx, gz, t] of deco) this.place(t, gx, gz, 0, { free: true, noPath: true });
    // Starter attractions so the gates open with something to do
    this.place('carousel', 14, 28, 1, { free: true });
    this.place('burger', 29, 29, 3, { free: true });
    this.pathVersion++;
  }

  // ── Validation ──
  canPlace(type, gx, gz, rot, opts = {}) {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, reason: 'Unknown' };
    const [W, D] = rotatedSize(def, rot);
    for (let j = gz; j < gz + D; j++)
      for (let i = gx; i < gx + W; i++) {
        if (!inGrid(i, j)) return { ok: false, reason: 'Outside your land' };
        if (this.tiles[j * GRID_W + i] !== 0) return { ok: false, reason: 'Space occupied' };
      }
    // don't build on units standing in the deploy zone (checked by caller for units)
    const isRideLike = def.ride || def.shop;
    let pathTiles = [];
    if (isRideLike && !opts.noPath) {
      const [ex, ez] = entranceTile(gx, gz, W, D, rot);
      if (!inPark(ex, ez)) {
        if (def.ride) return { ok: false, reason: 'Entrance must face into the park' };
      } else {
        const t = this.tiles[ez * GRID_W + ex];
        if (t > 0) return { ok: false, reason: 'Entrance blocked' };
        const r = this.findPathRoute(ex, ez, { gx, gz, W, D });
        if (!r) return { ok: false, reason: 'No path connection' };
        pathTiles = r;
      }
    }
    const cost = (opts.free ? 0 : def.cost) + pathTiles.length * PATH_COST;
    return { ok: true, cost, pathTiles, W, D };
  }

  // A* from entrance tile to nearest existing path tile over empty park tiles; returns new tiles to pave.
  findPathRoute(sx, sz, avoid) {
    if (this.isPath(sx, sz)) return [];
    const blockedByAvoid = (i, j) => avoid && i >= avoid.gx && i < avoid.gx + avoid.W && j >= avoid.gz && j < avoid.gz + avoid.D;
    const N = GRID_W * TERR_ROWS;
    const came = new Int32Array(N).fill(-2);
    const q = [sz * GRID_W + sx];
    came[q[0]] = -1;
    let head = 0;
    let found = -1;
    while (head < q.length) {
      const k = q[head++];
      const i = k % GRID_W, j = (k / GRID_W) | 0;
      if (this.tiles[k] === -1) {
        found = k;
        break;
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (!inPark(ni, nj)) continue;
        const nk = nj * GRID_W + ni;
        if (came[nk] !== -2) continue;
        const tv = this.tiles[nk];
        if (tv > 0 || blockedByAvoid(ni, nj)) continue;
        came[nk] = k;
        q.push(nk);
      }
    }
    if (found < 0) return null;
    const tilesOut = [];
    let k = came[found];
    while (k >= 0) {
      tilesOut.push([k % GRID_W, (k / GRID_W) | 0]);
      k = came[k];
    }
    return tilesOut;
  }

  // ── Mutation ──
  place(type, gx, gz, rot = 0, opts = {}) {
    const chk = this.canPlace(type, gx, gz, rot, opts);
    if (!chk.ok) return null;
    const team = this.game.teams[this.team];
    if (!opts.free && team.money < chk.cost) return null;
    if (!opts.free) this.game.spend(this.team, chk.cost, 'build');
    const b = new Building(this, type, gx, gz, rot);
    for (let j = gz; j < gz + b.D; j++) for (let i = gx; i < gx + b.W; i++) this.tiles[j * GRID_W + i] = b.id;
    for (const [i, j] of chk.pathTiles) this.placePath(i, j, true);
    if ((b.def.ride || b.def.shop) && !opts.noPath) {
      const [ex, ez] = entranceTile(gx, gz, b.W, b.D, rot);
      if (inPark(ex, ez)) {
        b.entrance = { gx: ex, gz: ez, x: tileCenterLX(ex) * sgn(this.team), z: tileCenterLZ(ez) * sgn(this.team) };
      }
    }
    this.buildings.push(b);
    this.byId.set(b.id, b);
    this.game.buildings.push(b);
    this.addColliders(b);
    this.pathVersion++;
    this.game.markNavDirty();
    this.game.emit('built', { b, team: this.team });
    return b;
  }

  addColliders(b) {
    const w = this.game.world;
    const r = b.worldRect(0.25);
    const t = b.type;
    const def = b.def;
    const mk = (c) => {
      c.owner = b;
      b.colliders.push(w.addCollider(c));
    };
    if (def.cat === 'scenery') {
      if (t === 'flowers') return;
      const rr = t === 'lamp' ? 0.18 : t === 'statue' ? 1.1 : 0.45;
      mk({ type: 'cyl', x: b.x, z: b.z, r: rr, h: t === 'statue' ? 3.5 : 3.2 });
      return;
    }
    if (t === 'castle') {
      mk({ type: 'box', ...b.worldRect(0.4), h: 9, walkable: false });
      return;
    }
    if (t === 'gate') {
      // two pillars, open middle
      const f = b.frame();
      for (const side of [-1, 1]) {
        mk({ type: 'cyl', x: b.x + f.rx * side * 3.2, z: b.z + f.rz * side * 3.2, r: 0.8, h: 8 });
      }
      return;
    }
    if (t === 'ferris') {
      mk({ type: 'box', ...b.worldRect(0.6), h: 3.5, walkable: false });
      return;
    }
    if (t === 'droptower') {
      mk({ type: 'cyl', x: b.x, z: b.z, r: 1.9, h: 6, walkable: false });
      return;
    }
    if (t === 'station') {
      mk({ type: 'box', ...r, h: 2.2 });
      return;
    }
    const h = Math.min(def.height, 5);
    mk({ type: 'box', ...r, h, walkable: false });
  }

  placePath(gx, gz, free = false) {
    if (!inPark(gx, gz)) return false;
    const k = gz * GRID_W + gx;
    if (this.tiles[k] !== 0) return false;
    if (!free) {
      if (this.game.teams[this.team].money < PATH_COST) return false;
      this.game.spend(this.team, PATH_COST, 'build');
    }
    this.tiles[k] = -1;
    this.pathVersion++;
    this.game.emit('path', { team: this.team, gx, gz });
    return true;
  }
  removePath(gx, gz) {
    const k = gz * GRID_W + gx;
    if (this.tiles[k] !== -1) return false;
    this.tiles[k] = 0;
    this.pathVersion++;
    this.game.emit('path', { team: this.team, gx, gz, removed: true });
    return true;
  }

  demolish(b, refund = 0.5) {
    if (b.type === 'castle' || b.type === 'gate') return false;
    if (b.type === 'station' && b.coaster) {
      this.game.removeCoaster(b.coaster, refund);
      return true;
    }
    this.removeBuilding(b);
    if (refund > 0 && !b.ruined) this.game.earn(this.team, Math.round(b.def.cost * refund), 'refund');
    return true;
  }

  removeBuilding(b) {
    for (let j = b.gz; j < b.gz + b.D; j++) for (let i = b.gx; i < b.gx + b.W; i++) {
      const k = j * GRID_W + i;
      if (this.tiles[k] === b.id) this.tiles[k] = 0;
    }
    for (const c of b.colliders) this.game.world.removeCollider(c);
    b.colliders = [];
    this.evict(b);
    this.buildings.splice(this.buildings.indexOf(b), 1);
    this.byId.delete(b.id);
    const gi = this.game.buildings.indexOf(b);
    if (gi >= 0) this.game.buildings.splice(gi, 1);
    b.removed = true;
    this.pathVersion++;
    this.game.markNavDirty();
    this.game.emit('removed', { b });
  }

  // Throw riders off + clear queues (ride destroyed / closed)
  evict(b) {
    if (b.ride) {
      for (const g of b.ride.riders) this.game.guests.unseat(g, true);
      b.ride.riders.length = 0;
      for (const g of b.ride.queue) g.onQueueCancelled && g.onQueueCancelled();
      b.ride.queue.length = 0;
      b.ride.phase = 'idle';
    }
    if (b.shop) {
      for (const g of b.shop.queue) g.onQueueCancelled && g.onQueueCancelled();
      b.shop.queue.length = 0;
    }
  }

  ruin(b) {
    b.state = 'ruined';
    b.hp = 0;
    this.evict(b);
    // rubble: low walkable collider
    for (const c of b.colliders) this.game.world.removeCollider(c);
    b.colliders = [];
    if (b.type !== 'castle') {
      const r = b.worldRect(0.3);
      const c = { type: 'box', ...r, h: 0.5, walkable: true, owner: b };
      b.colliders.push(this.game.world.addCollider(c));
    }
    b.targetable = false;
    this.game.markNavDirty();
  }

  repairCost(b) {
    if (b.ruined) return Math.round(b.def.cost * 0.6);
    return Math.round(b.def.cost * 0.5 * (1 - b.hp / b.maxHp));
  }
  repair(b) {
    const cost = this.repairCost(b);
    if (cost <= 0) return false;
    if (this.game.teams[this.team].money < cost) return false;
    this.game.spend(this.team, cost, 'repair');
    if (b.ruined) {
      for (const c of b.colliders) this.game.world.removeCollider(c);
      b.colliders = [];
      b.state = 'open';
      b.targetable = b.def.cat !== 'scenery';
      this.addColliders(b);
      b.builtAt = this.game.time;
      this.game.markNavDirty();
    }
    b.hp = b.maxHp;
    this.game.emit('repaired', { b });
    return true;
  }

  // ── Per-step simulation of rides + defences ──
  update() {
    const g = this.game;
    const battle = g.phase === 'battle' && g.battleStarted;
    for (const b of this.buildings) {
      b.anim.t += DT;
      if (b.ruined) continue;
      if (b.ride && !b.coaster) this.updateRide(b, battle);
      if (b.def.combat && battle) this.updateCombat(b);
      if (b.type === 'castle' && battle) this.updateCastle(b);
      if (b.type === 'fountain') b.anim.spin += DT;
    }
    // upkeep every 10s
    this.upkeepTimer += DT;
    if (this.upkeepTimer >= 10) {
      this.upkeepTimer = 0;
      let up = 0;
      for (const b of this.buildings) if (!b.ruined && b.def.upkeep) up += b.def.upkeep;
      if (up > 0) g.spend(this.team, up / 6, 'upkeep');
    }
    this.ratingTimer -= DT;
    if (this.ratingTimer <= 0) {
      this.ratingTimer = 1.5;
      this.computeRating();
    }
  }

  enemiesNear(x, z, r) {
    const list = this.game.units[1 - this.team];
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  updateRide(b, battle) {
    const R = b.ride;
    const def = b.def.ride;
    const g = this.game;
    const a = b.anim;
    // Close ride during nearby fighting (guests evacuate)
    const danger = battle && this.enemiesNear(b.x, b.z, 22);
    if (danger && R.phase !== 'idle' && !b.def.combat) {
      this.evict(b);
    }
    const combatRun = battle && b.def.combat && (b.type === 'pirate' || b.type === 'droptower');
    switch (R.phase) {
      case 'idle':
        a.speed *= 0.97;
        if (combatRun) {
          R.phase = 'running';
          R.timer = 999;
        } else if (!danger && R.queue.length > 0) {
          R.phase = 'loading';
          R.timer = b.type === 'cannonshow' ? 1.2 : 3.0;
        }
        break;
      case 'loading': {
        // board queued guests who have arrived at the entrance
        while (R.riders.length < def.cap && R.queue.length) {
          const gst = R.queue[0];
          if (!gst.atEntrance) break;
          R.queue.shift();
          R.riders.push(gst);
          g.guests.seat(gst, b, R.riders.length - 1);
          const price = Math.round(this.ticketPrice(b));
          g.earn(this.team, price, 'rides', b);
          b.income += price;
          b.customers++;
        }
        R.timer -= DT;
        if (R.timer <= 0 || R.riders.length >= def.cap) {
          if (R.riders.length === 0 && !combatRun) {
            R.phase = 'idle';
          } else {
            R.phase = 'running';
            R.timer = def.cycle;
            R.cycles++;
            if (b.type === 'cannonshow' && R.riders.length) {
              g.guests.fireFromCannon(R.riders[0], b, null);
              R.riders.length = 0;
            }
          }
        }
        break;
      }
      case 'running':
        R.timer -= DT;
        if (combatRun && !battle) R.timer = Math.min(R.timer, 2);
        if (R.timer <= 0) {
          R.phase = 'unloading';
          R.timer = 1.4;
        }
        break;
      case 'unloading':
        a.speed *= 0.95;
        R.timer -= DT;
        if (R.timer <= 0) {
          for (const gst of R.riders) g.guests.finishRide(gst, b);
          R.riders.length = 0;
          R.phase = 'idle';
        }
        break;
    }
    const running = R.phase === 'running';
    // Animate
    switch (b.type) {
      case 'carousel':
        a.speed += ((running ? 0.9 : 0) - a.speed) * DT * 0.8;
        a.angle += a.speed * DT;
        break;
      case 'teacups':
        a.speed += ((running ? 1.1 : 0) - a.speed) * DT * 0.9;
        a.angle += a.speed * DT;
        a.spin += a.speed * 2.6 * DT;
        break;
      case 'ferris':
        a.speed += ((running ? 0.22 : 0) - a.speed) * DT * 0.6;
        a.angle += a.speed * DT;
        break;
      case 'pirate': {
        // driven pendulum
        const target = running ? 1.25 : 0;
        const amp = Math.abs(a.swing) + Math.abs(a.swingV) / 1.4;
        const drive = amp < target ? 1.6 : -0.4;
        a.swingV += (-1.96 * Math.sin(a.swing) - 0.05 * a.swingV) * DT;
        a.swingV += Math.sign(a.swingV || 1) * drive * DT * (running ? 1 : 0.6);
        if (!running) a.swingV *= 0.992;
        a.swing += a.swingV * DT;
        if (b.def.combat && battle) this.pirateHits(b);
        break;
      }
      case 'droptower': {
        // cycle: lift slowly to top, hold, drop
        const cyc = battle ? 7 : def.cycle;
        if (running) {
          a.dropT = (a.dropT || 0) + DT;
          const t = a.dropT % cyc;
          const prev = a.drop;
          if (t < cyc * 0.55) a.drop = (t / (cyc * 0.55)) * 20;
          else if (t < cyc * 0.75) a.drop = 20;
          else {
            const u = (t - cyc * 0.75) / (cyc * 0.25);
            a.drop = 20 * (1 - Math.min(1, u * u * 1.6));
          }
          if (prev > 1 && a.drop <= 0.01 && battle) this.shockwave(b);
        } else {
          a.drop = Math.max(0, a.drop - DT * 3);
          a.dropT = 0;
        }
        break;
      }
      case 'cannonshow':
        a.angle = 0.7;
        break;
    }
  }

  ticketPrice(b) {
    let base;
    if (b.coaster) base = b.coaster.price;
    else base = b.def.ride ? b.def.ride.price : b.def.shop ? b.def.shop.price : 0;
    const mult = [0.7, 1, 1.45][this.pricing];
    return base * mult * (0.75 + this.rating / 200);
  }

  // Seat transforms for guests riding (world pos + forward + up)
  seat(b, i, out) {
    const a = b.anim;
    const def = b.def;
    let mx = 0, my = 1, mz = 0, fx = 0, fz = 1, ux = 0, uy = 1, uz = 0;
    switch (b.type) {
      case 'carousel': {
        const n = def.ride.cap;
        const ang = a.angle + (i / n) * TAU;
        const r = i % 2 ? 3.2 : 4.1;
        mx = Math.cos(ang) * r;
        mz = Math.sin(ang) * r;
        my = 1.25 + Math.sin(a.t * 2.2 + i) * 0.25 * Math.min(1, a.speed * 1.5);
        // face tangentially
        fx = -Math.sin(ang); fz = Math.cos(ang);
        break;
      }
      case 'teacups': {
        const cup = i % 4, slot = (i / 4) | 0;
        const ang = a.angle + (cup / 4) * TAU;
        const cx = Math.cos(ang) * 3.2, cz = Math.sin(ang) * 3.2;
        const sa = a.spin * (cup % 2 ? -1 : 1) + (slot / 3) * TAU;
        mx = cx + Math.cos(sa) * 0.7;
        mz = cz + Math.sin(sa) * 0.7;
        my = 0.95;
        fx = -Math.cos(sa); fz = -Math.sin(sa);
        break;
      }
      case 'pirate': {
        const row = i % 8, side = i < 8 ? -1 : 1;
        const along = (row - 3.5) * 1.1;
        // ship swings along model z around pivot at height 8
        const th = a.swing;
        const ly = -5.2, lz = along, lx = side * 0.8;
        mz = lz * Math.cos(th) - ly * Math.sin(th);
        my = 8 + lz * Math.sin(th) + ly * Math.cos(th);
        mx = lx;
        fx = -side; fz = 0;
        uy = Math.cos(th); uz = -Math.sin(th);
        break;
      }
      case 'ferris': {
        const n = 8, gi = i % n;
        const ang = a.angle + (gi / n) * TAU;
        const R = 7.2;
        mx = Math.cos(ang) * R + ((i >= n) ? 0.35 : -0.35);
        my = 9 + Math.sin(ang) * R - 1.1;
        mz = (i >= n ? 0.45 : -0.45);
        fx = 0; fz = i >= n ? -1 : 1;
        break;
      }
      case 'droptower': {
        const ang = (i / 8) * TAU;
        mx = Math.cos(ang) * 1.7;
        mz = Math.sin(ang) * 1.7;
        my = 1.4 + a.drop;
        fx = Math.cos(ang); fz = Math.sin(ang);
        break;
      }
      default:
        my = 1;
    }
    const w = b.toWorld(mx, my, mz);
    const h = b.heading, c = Math.cos(h), s = Math.sin(h);
    out.x = w[0];
    out.y = w[1] + this.game.world.heightAt(b.x, b.z);
    out.z = w[2];
    out.fx = fx * c + fz * s;
    out.fy = 0;
    out.fz = -fx * s + fz * c;
    out.ux = ux * c + uz * s;
    out.uy = uy;
    out.uz = -ux * s + uz * c;
    // re-orthogonalise forward against up
    const d = out.fx * out.ux + out.fy * out.uy + out.fz * out.uz;
    out.fx -= d * out.ux; out.fy -= d * out.uy; out.fz -= d * out.uz;
    const l = Math.hypot(out.fx, out.fy, out.fz) || 1;
    out.fx /= l; out.fy /= l; out.fz /= l;
    return out;
  }

  // ── Defensive attractions ──
  updateCombat(b) {
    const g = this.game;
    const c = b.def.combat;
    if (b.cooldown > 0) {
      b.cooldown -= DT;
      return;
    }
    if (c.type === 'turret' || c.type === 'jets' || c.type === 'cannon') {
      const target = this.pickTarget(b, c.range, c.type === 'jets' ? 0 : 3, c.splash || 0);
      if (!target) {
        b.cooldown = 0.25;
        return;
      }
      b.aimX = target.x;
      b.aimZ = target.z;
      const topY = g.world.heightAt(b.x, b.z) + (c.type === 'jets' ? 1.8 : 4.2);
      if (c.type === 'turret') {
        const d = Math.hypot(target.x - b.x, target.z - b.z);
        const T = Math.max(0.8, d / 17);
        const [tvx, tvz] = target.velocity();
        g.projectiles.fire({
          type: 'turretpop', team: this.team, source: b, sx: b.x, sy: topY, sz: b.z,
          tx: target.x + tvx * T * 0.7, ty: target.y - 0.6, tz: target.z + tvz * T * 0.7, time: T, gravity: GRAVITY,
          damage: c.damage, splash: c.splash, knock: c.knock, structMult: 0,
        });
        g.emit('shot', { x: b.x, y: topY, z: b.z, kind: 'turret', team: this.team });
        b.cooldown = c.cooldown;
      } else if (c.type === 'jets') {
        for (let k = 0; k < 4; k++) {
          const T = Math.hypot(target.x - b.x, target.z - b.z) / 16;
          g.projectiles.fire({
            type: 'jet', team: this.team, source: b, sx: b.x, sy: topY, sz: b.z,
            tx: target.x + g.rng.gauss() * 0.8, ty: target.y + 0.2, tz: target.z + g.rng.gauss() * 0.8, time: T + k * 0.04, gravity: 7,
            damage: c.damage / 2, splash: 0, knock: c.knock / 2, structMult: 0,
          });
        }
        g.emit('shot', { x: b.x, y: topY, z: b.z, kind: 'jets', team: this.team, tx: target.x, tz: target.z });
        b.cooldown = c.cooldown;
      } else if (c.type === 'cannon') {
        // fire a (willing?) guest at the enemy
        g.guests.fireFromCannon(null, b, target);
        b.cooldown = c.cooldown;
      }
    }
  }

  updateCastle(b) {
    if (b.cooldown > 0) {
      b.cooldown -= DT;
      return;
    }
    const g = this.game;
    const c = CASTLE_DEFENSE;
    const target = this.pickTarget(b, c.range, 0, c.splash);
    if (!target) {
      b.cooldown = 0.3;
      return;
    }
    const sy = g.world.heightAt(b.x, b.z) + 14;
    const d = Math.hypot(target.x - b.x, target.z - b.z);
    const T = Math.max(0.9, d / 14);
    const [tvx, tvz] = target.velocity();
    const f = b.frame();
    const side = g.rng.chance(0.5) ? 1 : -1;
    g.projectiles.fire({
      type: 'firework', team: this.team, source: b,
      sx: b.x + f.rx * side * 4.5, sy, sz: b.z + f.rz * side * 4.5,
      tx: target.x + tvx * T * 0.8, ty: target.y, tz: target.z + tvz * T * 0.8, time: T, gravity: 6,
      damage: c.damage, splash: c.splash, knock: c.knock, structMult: 0,
    });
    g.emit('shot', { x: b.x, y: sy, z: b.z, kind: 'firework', team: this.team });
    b.cooldown = c.cooldown;
  }

  pickTarget(b, range, minRange, splash) {
    const g = this.game;
    let best = null, bs = 0;
    const enemies = g.units[1 - this.team];
    for (const e of enemies) {
      if (!e.alive || e.flying) continue;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (d > range || d < minRange) continue;
      let v = 1;
      if (splash > 0) {
        for (const f of enemies) {
          if (f === e || !f.alive) continue;
          const dd = Math.hypot(f.x - e.x, f.z - e.z);
          if (dd < splash) v += 0.7;
        }
      }
      // prefer units attacking our buildings, and closer ones
      if (e.target && e.target.isBuilding) v *= 1.4;
      v /= 1 + d / range;
      if (v > bs) {
        bs = v;
        best = e;
      }
    }
    return best;
  }

  pirateHits(b) {
    const g = this.game;
    const a = b.anim;
    if (Math.abs(a.swingV) < 0.6) return;
    // hull bottom points along model z
    const th = a.swing;
    for (let k = -2; k <= 2; k++) {
      const lz = k * 1.6, ly = -5.8;
      const mz = lz * Math.cos(th) - ly * Math.sin(th);
      const my = 8 + lz * Math.sin(th) + ly * Math.cos(th);
      if (my > 2.6) continue;
      const [wx, , wz] = b.toWorld(0, my, mz);
      for (const e of g.units[1 - this.team]) {
        if (!e.alive) continue;
        const dx = e.x - wx, dz = e.z - wz;
        if (dx * dx + dz * dz > 2.4 * 2.4) continue;
        const cd = b.hitCd.get(e.id) || 0;
        if (g.time < cd) continue;
        b.hitCd.set(e.id, g.time + 1.0);
        // push along swing direction (model z)
        const f = b.frame();
        const dir = Math.sign(a.swingV);
        g.damageUnit(e, b.def.combat.damage, b, f.fx * dir, 0.7, f.fz * dir, b.def.combat.knock, 1);
        g.emit('bump', { x: wx, z: wz, power: 10 });
      }
    }
  }

  shockwave(b) {
    const g = this.game;
    const c = b.def.combat;
    g.splash(this.team, b.x, b.z, c.radius, c.damage, c.knock, b, 'shockwave');
    g.emit('shockwave', { x: b.x, z: b.z, r: c.radius, team: this.team });
    g.emit('shake', { x: b.x, z: b.z, power: 0.5 });
  }

  computeRating() {
    const g = this.game;
    let attract = 0, scen = 0, ruined = 0, shops = 0, rides = 0;
    for (const b of this.buildings) {
      if (b.ruined) {
        ruined++;
        continue;
      }
      if (b.def.ride || b.coaster) {
        const E = b.coaster ? b.coaster.stats.excitement : b.def.ride.E;
        attract += E * Math.sqrt(b.coaster ? 12 : b.def.ride.cap);
        rides++;
      }
      if (b.def.shop) shops++;
      if (b.def.scenery) scen += b.def.scenery;
      if (b.def.rating) attract += b.def.rating * 2;
    }
    this.sceneryScore = scen;
    const hap = g.guests.avgHappiness(this.team);
    const attractScore = Math.min(40, attract * 0.9);
    const sceneryPts = Math.min(18, scen * 0.55);
    const shopPts = Math.min(8, shops * 2.5);
    const happyPts = (hap / 100) * 26;
    const penalty = ruined * 4 + Math.min(20, this.injuries * 1.5);
    const target = Math.max(5, Math.min(100, 8 + attractScore + sceneryPts + shopPts + happyPts - penalty));
    this.rating += (target - this.rating) * 0.25;
    this.injuries *= 0.9;
    this.rideCount = rides;
  }

  guestCapacity() {
    let cap = 14;
    for (const b of this.buildings) {
      if (b.ruined) continue;
      if (b.def.ride || b.coaster) cap += (b.coaster ? 16 : Math.min(16, Math.max(6, b.def.ride.cap))) * 2.4;
      if (b.def.shop) cap += 3;
    }
    return cap;
  }

  // Heuristic value of the park (for AI + scoring)
  value() {
    let v = 0;
    for (const b of this.buildings) if (!b.ruined) v += b.def.cost;
    return v;
  }
}
