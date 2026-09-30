// ─────────────────────────────────────────────────────────────────────────────
//  Park guests: wobbly visitors with needs who ride rides, buy snacks, pay,
//  panic when invaded, and occasionally get fired out of a cannon.
// ─────────────────────────────────────────────────────────────────────────────
import { DT, GRID_W, TERR_ROWS, TILE, GRAVITY, ENTRY_FEE, MAX_GUESTS, PARK_LZ1, HALF_W, BUILDINGS } from '../config.js';
import { Ragdoll, driveRagdoll, knock } from './ragdoll.js';
import { PELVIS } from './physics.js';
import { sgn, tileCenterLX, tileCenterLZ, tileOfLX, tileOfLZ, inPark } from './team.js';

let NEXT_GID = 1;
const SHIRTS = [0xff6f59, 0xffd23f, 0x3bceac, 0x0ead69, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xfee440, 0xef476f, 0x06d6a0, 0x118ab2, 0xff9f1c, 0xe0e0e0, 0x8338ec];
const PANTS = [0x2b2d42, 0x3d5a80, 0x6b705c, 0x264653, 0x8d99ae, 0x5c4033, 0x1d3557, 0xa68a64];
const SKINS = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd, 0xd9a066];
const HATS = [null, null, null, 'cap', 'sunhat', 'beanie', 'ears', 'propeller'];
const THOUGHTS = {
  wow: ['WOW! Best ride ever!', 'Again! Again!', 'That was AMAZING!', 'My hair is gone. Worth it.'],
  meh: ['That was... fine.', 'Bit tame, honestly.', 'Was that it?'],
  sick: ['I feel sick...', 'Too... much... spinning...', 'Never again.'],
  hungry: ['I could eat a horse.', 'Burger time!', 'So hungry...'],
  thirsty: ['I need a drink!', 'Parched!'],
  panic: ['AAAAAH!', 'RUN!', 'Why is there a bear?!', 'NOT AGAIN!', 'I want a refund!', 'MOMMY!'],
  pretty: ['This park is gorgeous!', 'So many trees!', 'What a lovely place.'],
  broke: ['Out of money...', 'Everything is so expensive!'],
  leave: ['Time to go home.', 'What a day!'],
  cannon: ['WHEEEEEE!', 'I PAID FOR THIS?!', 'TELL MY WIFE I...', 'YOLOOOO!'],
  ugly: ['This park is a wreck.', 'Who designed this?!'],
};

export class Guest {
  constructor(sys, team) {
    const g = sys.game;
    const r = g.rng;
    this.id = NEXT_GID++;
    this.sys = sys;
    this.team = team;
    this.money = Math.round(r.range(60, 190));
    this.happiness = r.range(55, 80);
    this.hunger = r.range(0, 40);
    this.thirst = r.range(0, 40);
    this.energy = r.range(70, 100);
    this.nausea = 0;
    this.pref = r.range(2.5, 9.5);
    this.age = 0;
    this.lifetime = r.range(150, 320);
    this.state = 'arrive';
    this.goal = null;
    this.dest = null; // building
    this.atEntrance = false;
    this.seat = null;
    this.history = [];
    this.offset = r.range(-0.55, 0.55);
    this.speed = r.range(1.35, 1.85);
    this.decideTimer = 0;
    this.waitTimer = 0;
    this.thought = null;
    this.thoughtTime = 0;
    this.flying = false;
    this.flyTime = 0;
    this.volunteer = false;
    this.removed = false;
    const scale = r.range(0.78, 1.0);
    this.look = {
      shirt: r.pick(SHIRTS), pants: r.pick(PANTS), skin: r.pick(SKINS), hat: r.pick(HATS),
      balloon: null, hatColor: r.pick(SHIRTS), kid: scale < 0.84,
    };
    this.rd = new Ragdoll({ scale, strength: 0.9, wobble: 0.9 });
    this.rd.owner = this;
    this.rd.team = team;
    this.rd.kind = 'guest';
    this.rd.pose = 'idle';
    this.alive = true;
  }
  get x() {
    return this.sys.game.phys.x[this.rd.base + PELVIS];
  }
  get z() {
    return this.sys.game.phys.z[this.rd.base + PELVIS];
  }
  get y() {
    return this.sys.game.phys.y[this.rd.base + PELVIS];
  }
  think(kind) {
    const arr = THOUGHTS[kind];
    if (!arr) return;
    this.thought = arr[(Math.random() * arr.length) | 0];
    this.thoughtTime = 3.2;
    this.sys.game.emit('thought', { guest: this, text: this.thought, kind });
  }
  onKnocked() {
    if (this.seat) return;
    this.rd.stun = Math.max(this.rd.stun, 1.6);
    this.happiness -= 18;
    const park = this.sys.game.parks[this.team];
    park.injuries += 1;
    if (this.state !== 'flee' && this.state !== 'flying') this.startFlee();
  }
  onQueueCancelled() {
    this.dest = null;
    this.atEntrance = false;
    if (this.state === 'toRide' || this.state === 'toShop' || this.state === 'queue') this.state = 'wander';
  }
  startFlee() {
    this.leaveQueue();
    this.state = 'flee';
    this.rd.pose = 'panic';
    if (Math.random() < 0.3) this.think('panic');
  }
  leaveQueue() {
    if (this.dest) {
      const q = this.dest.ride ? this.dest.ride.queue : this.dest.shop ? this.dest.shop.queue : null;
      if (q) {
        const i = q.indexOf(this);
        if (i >= 0) q.splice(i, 1);
      }
    }
    this.dest = null;
    this.atEntrance = false;
  }
}

export class GuestSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.fields = new Map(); // key -> {version, dist}
    this.spawnTimer = [0, 0];
    this.count = [0, 0];
    this._seat = {};
  }

  avgHappiness(team) {
    let s = 0, n = 0;
    for (const g of this.list) if (g.team === team && !g.removed) { s += g.happiness; n++; }
    return n ? s / n : 60;
  }

  // BFS distance field over path tiles from a tile.
  field(team, key, gx, gz) {
    const park = this.game.parks[team];
    const fk = team + ':' + key;
    let f = this.fields.get(fk);
    if (f && f.version === park.pathVersion) return f.dist;
    const dist = f && f.dist ? f.dist : new Int16Array(GRID_W * TERR_ROWS);
    dist.fill(32767);
    const q = [];
    if (inPark(gx, gz)) {
      dist[gz * GRID_W + gx] = 0;
      q.push(gz * GRID_W + gx);
    }
    let h = 0;
    while (h < q.length) {
      const k = q[h++];
      const i = k % GRID_W, j = (k / GRID_W) | 0;
      const d = dist[k] + 1;
      if (i > 0) this._relax(park, dist, q, k - 1, d);
      if (i < GRID_W - 1) this._relax(park, dist, q, k + 1, d);
      if (j > 0) this._relax(park, dist, q, k - GRID_W, d);
      if (j < TERR_ROWS - 1) this._relax(park, dist, q, k + GRID_W, d);
    }
    this.fields.set(fk, { version: park.pathVersion, dist });
    return dist;
  }
  _relax(park, dist, q, k, d) {
    if (park.tiles[k] !== -1 || dist[k] <= d) return;
    dist[k] = d;
    q.push(k);
  }

  spawn(team) {
    const g = this.game;
    const park = g.parks[team];
    const gst = new Guest(this, team);
    const s = sgn(team);
    const lx = g.rng.range(-3, 3), lz = PARK_LZ1 + g.rng.range(5, 8);
    if (!g.phys.alloc(gst.rd, lx * s, lz * s, team === 0 ? Math.PI : 0)) return null;
    this.list.push(gst);
    this.count[team]++;
    gst.state = 'arrive';
    if (park.gate) {
      g.earn(team, ENTRY_FEE * [0.6, 1, 1.5][park.pricing], 'entry');
    }
    return gst;
  }

  despawn(gst) {
    if (gst.removed) return;
    gst.removed = true;
    gst.leaveQueue();
    if (gst.seat) this.unseat(gst, false);
    this.game.phys.release(gst.rd);
    this.count[gst.team]--;
  }

  update() {
    const g = this.game;
    // Spawning
    for (let team = 0; team < 2; team++) {
      const park = g.parks[team];
      const cap = Math.min(MAX_GUESTS, park.guestCapacity());
      park.guestCount = this.count[team];
      const invaded = g.phase === 'battle' && g.battleStarted && park.enemiesNear(0, 70 * sgn(team), 45);
      this.spawnTimer[team] -= DT;
      if (this.spawnTimer[team] <= 0) {
        this.spawnTimer[team] = 1;
        const room = 1 - this.count[team] / cap;
        const p = (0.2 + (park.rating / 100) * 0.8) * Math.max(0, room);
        if (!invaded && room > 0 && g.rng.next() < p) this.spawn(team);
      }
    }
    // Guests
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const gst = L[i];
      if (gst.removed) {
        L.splice(i, 1);
        continue;
      }
      this.updateGuest(gst);
      if (gst.removed) {
        L.splice(i, 1);
        continue;
      }
      driveRagdoll(g.phys, gst.rd);
    }
  }

  updateGuest(gst) {
    const g = this.game;
    const park = g.parks[gst.team];
    const rd = gst.rd;
    gst.age += DT;
    if (gst.thoughtTime > 0) gst.thoughtTime -= DT;
    // needs
    gst.hunger += DT * 0.32;
    gst.thirst += DT * 0.42;
    gst.energy -= DT * 0.22;
    gst.nausea = Math.max(0, gst.nausea - DT * 0.6);
    // happiness drifts toward the park's appeal
    const targetHap = 30 + park.rating * 0.55 - Math.max(0, gst.hunger - 70) * 0.4 - Math.max(0, gst.thirst - 70) * 0.4;
    gst.happiness += (targetHap - gst.happiness) * DT * 0.02;
    gst.happiness = Math.max(0, Math.min(100, gst.happiness));

    if (gst.flying) {
      this.updateFlying(gst);
      return;
    }
    if (gst.seat) {
      const b = gst.seat.b;
      if (b.removed || b.ruined) {
        this.unseat(gst, true);
        return;
      }
      if (b.coaster) b.coaster.seatTransform(gst.seat.i, this._seat);
      else park.seat(b, gst.seat.i, this._seat);
      const s = this._seat;
      rd.pinned.x = s.x; rd.pinned.y = s.y; rd.pinned.z = s.z;
      rd.pinned.fx = s.fx; rd.pinned.fy = s.fy; rd.pinned.fz = s.fz;
      rd.pinned.ux = s.ux; rd.pinned.uy = s.uy; rd.pinned.uz = s.uz;
      const intense = b.coaster ? b.coaster.train.v > 9 : b.type === 'droptower' || b.type === 'pirate';
      rd.pinned.pose = intense ? 'wheee' : b.type === 'ferris' || b.type === 'carousel' ? 'sit' : 'wheee';
      return;
    }
    if (rd.stun > 0 || rd.muscle < 0.5) {
      rd.vx = rd.vz = 0;
      return;
    }
    // danger check
    if (g.phase === 'battle' && g.battleStarted && gst.state !== 'flee' && gst.state !== 'exit') {
      gst.dangerTimer = (gst.dangerTimer || 0) - DT;
      if (gst.dangerTimer <= 0) {
        gst.dangerTimer = 0.5;
        if (park.enemiesNear(gst.x, gst.z, 16)) gst.startFlee();
      }
    }
    switch (gst.state) {
      case 'arrive':
        this.walkArrive(gst);
        break;
      case 'wander':
      case 'idle':
        gst.decideTimer -= DT;
        if (gst.decideTimer <= 0) {
          gst.decideTimer = 1 + g.rng.next();
          this.decide(gst);
        }
        if (gst.state === 'wander') this.walkWander(gst);
        else { rd.vx *= 0.8; rd.vz *= 0.8; }
        break;
      case 'toRide':
      case 'toShop':
        this.walkTo(gst);
        break;
      case 'queue':
        this.waitInQueue(gst);
        break;
      case 'shopping':
        rd.vx = rd.vz = 0;
        gst.waitTimer -= DT;
        if (gst.waitTimer <= 0) this.finishShop(gst);
        break;
      case 'exit':
      case 'flee':
        this.walkExit(gst);
        break;
      case 'offmap':
        this.walkOffmap(gst);
        break;
    }
  }

  local(gst) {
    const s = sgn(gst.team);
    return [gst.x * s, gst.z * s];
  }
  moveToward(gst, lx, lz, speed) {
    const s = sgn(gst.team);
    const [gx, gz] = this.local(gst);
    const dx = lx - gx, dz = lz - gz;
    const d = Math.hypot(dx, dz) || 1e-4;
    const sp = Math.min(speed, d * 2.5);
    gst.rd.vx = (dx / d) * sp * s;
    gst.rd.vz = (dz / d) * sp * s;
    if (d > 0.3) gst.rd.targetHeading = Math.atan2(dx * s, dz * s);
    return d;
  }

  walkArrive(gst) {
    // walk in through the gate to the first path tile
    const d = this.moveToward(gst, tileCenterLX(23) + 1 + gst.offset, tileCenterLZ(39), gst.speed);
    if (d < 1.2) {
      gst.state = 'wander';
      gst.decideTimer = 0;
    }
  }

  walkExit(gst) {
    const flee = gst.state === 'flee';
    const [lx, lz] = this.local(gst);
    const speed = flee ? 3.6 : gst.speed;
    gst.rd.pose = flee ? 'panic' : gst.look.balloon ? 'balloon' : 'idle';
    // outside of park paths (e.g. launched guests) → run off the side of the map
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    if (lz > tileCenterLZ(38) + 0.6 && Math.abs(lx) < 6) {
      // at / beyond the gate: walk straight out and despawn
      this.moveToward(gst, lx * 0.6, PARK_LZ1 + 14, speed);
      if (lz > PARK_LZ1 + 11) this.despawn(gst);
      return;
    }
    if (lz > PARK_LZ1 - 1) {
      // outside the park fence: go round to the gate area
      this.moveToward(gst, 0, PARK_LZ1 + 4, speed);
      if (Math.abs(lx) < 6) this.despawn(gst);
      return;
    }
    if (!inPark(gx, gz) || !this.game.parks[gst.team].isPath(gx, gz)) {
      // head straight for the gate
      if (!inPark(gx, gz)) {
        gst.state = 'offmap';
        return;
      }
      this.moveToward(gst, tileCenterLX(23) + 1, tileCenterLZ(39), speed);
      return;
    }
    const dist = this.field(gst.team, 'exit', 23, 39);
    this.followField(gst, dist, gx, gz, speed, () => {
      this.moveToward(gst, tileCenterLX(23) + 1 + gst.offset, PARK_LZ1 + 4, speed);
    });
  }

  walkOffmap(gst) {
    // run toward the nearest side of the map and vanish
    const [lx, lz] = this.local(gst);
    const side = lx >= 0 ? 1 : -1;
    gst.rd.pose = 'panic';
    this.moveToward(gst, side * (HALF_W + 16), lz, 3.4);
    if (Math.abs(lx) > HALF_W + 12) this.despawn(gst);
  }

  followField(gst, dist, gx, gz, speed, atGoal) {
    const k = gz * GRID_W + gx;
    const here = dist[k];
    if (here === 0) {
      atGoal();
      return;
    }
    if (here >= 32767) {
      // disconnected: wander off
      gst.state = gst.state === 'flee' || gst.state === 'exit' ? 'offmap' : 'wander';
      return;
    }
    let best = here, bi = gx, bj = gz;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [di, dj] of nb) {
      const ni = gx + di, nj = gz + dj;
      if (ni < 0 || nj < 0 || ni >= GRID_W || nj >= TERR_ROWS) continue;
      const v = dist[nj * GRID_W + ni];
      if (v < best) {
        best = v; bi = ni; bj = nj;
      }
    }
    // lateral offset perpendicular to travel for natural crowds
    const dx = bi - gx, dz = bj - gz;
    const ox = -dz * gst.offset, oz = dx * gst.offset;
    this.moveToward(gst, tileCenterLX(bi) + ox, tileCenterLZ(bj) + oz, speed);
  }

  walkWander(gst) {
    const [lx, lz] = this.local(gst);
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    const park = this.game.parks[gst.team];
    gst.rd.pose = gst.look.balloon ? 'balloon' : 'idle';
    if (!gst.wanderTo || gst.wanderT <= 0) {
      // pick a random neighbouring path tile a few steps away
      gst.wanderT = 3 + Math.random() * 3;
      let cx = gx, cz = gz;
      for (let s = 0; s < 6; s++) {
        const opts = [];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (park.isPath(cx + di, cz + dj)) opts.push([cx + di, cz + dj]);
        if (!opts.length) break;
        [cx, cz] = opts[(Math.random() * opts.length) | 0];
      }
      gst.wanderTo = [cx, cz];
    }
    gst.wanderT -= DT;
    const d = this.moveToward(gst, tileCenterLX(gst.wanderTo[0]) + gst.offset, tileCenterLZ(gst.wanderTo[1]), gst.speed * 0.8);
    if (d < 0.8) gst.wanderT = 0;
  }

  decide(gst) {
    const g = this.game;
    const park = g.parks[gst.team];
    if (gst.money < 3 || gst.energy < 5 || gst.happiness < 18 || gst.age > gst.lifetime) {
      gst.state = 'exit';
      gst.think(gst.money < 3 ? 'broke' : gst.happiness < 18 ? 'ugly' : 'leave');
      return;
    }
    const [lx, lz] = this.local(gst);
    const needFood = gst.hunger > 62, needDrink = gst.thirst > 62;
    let best = null, bs = 0;
    for (const b of park.buildings) {
      if (b.ruined || !b.entrance) continue;
      let w = 0;
      if (b.shop) {
        const need = b.def.shop.need;
        if (need === 'hunger' && needFood) w = 3 + gst.hunger / 20;
        else if (need === 'thirst' && needDrink) w = 3 + gst.thirst / 20;
        else if (need === 'fun' && !gst.look.balloon && gst.happiness > 55 && gst.money > 20) w = 0.25;
        if (b.shop.queue.length > 6) w *= 0.3;
      } else if (b.ride) {
        if (needFood || needDrink) continue;
        if (gst.money < this.game.parks[gst.team].ticketPrice(b)) continue;
        const E = b.coaster ? b.coaster.stats.excitement : b.def.ride.E;
        const I = b.coaster ? b.coaster.stats.intensity : b.def.ride.I;
        if (I > gst.pref + 2.8) continue;
        if (gst.nausea > 45 && (b.coaster ? b.coaster.stats.nausea : b.def.ride.N) > 3) continue;
        w = E * Math.max(0.15, 1 - Math.abs(I - gst.pref) / 10);
        if (gst.history.includes(b.id)) w *= 0.35;
        const q = b.ride.queue.length;
        const cap = b.coaster ? 12 : b.def.ride.cap;
        w /= 1 + q / (cap * 1.5);
        if (b.coaster && !b.coaster.open) w = 0;
      }
      if (w <= 0) continue;
      const d = Math.hypot(b.lx - lx, b.lz - lz);
      w /= 1 + d / 45;
      w *= 0.7 + Math.random() * 0.6;
      if (w > bs) {
        bs = w;
        best = b;
      }
    }
    if (best) {
      gst.dest = best;
      gst.atEntrance = false;
      if (best.ride) {
        best.ride.queue.push(gst);
        gst.state = 'toRide';
      } else {
        best.shop.queue.push(gst);
        gst.state = 'toShop';
      }
      gst.rd.pose = gst.look.balloon ? 'balloon' : 'idle';
      return;
    }
    gst.state = 'wander';
    if (needFood && Math.random() < 0.2) gst.think('hungry');
    else if (needDrink && Math.random() < 0.2) gst.think('thirsty');
    else if (Math.random() < 0.04) gst.think(park.rating > 60 ? 'pretty' : 'ugly');
  }

  walkTo(gst) {
    const b = gst.dest;
    if (!b || b.removed || b.ruined) {
      gst.leaveQueue();
      gst.state = 'wander';
      return;
    }
    const [lx, lz] = this.local(gst);
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    const park = this.game.parks[gst.team];
    if (!park.isPath(gx, gz)) {
      // step back onto the network: nearest path tile around
      let found = null;
      for (let r = 1; r < 4 && !found; r++)
        for (let dj = -r; dj <= r && !found; dj++)
          for (let di = -r; di <= r; di++) if (park.isPath(gx + di, gz + dj)) { found = [gx + di, gz + dj]; break; }
      if (found) this.moveToward(gst, tileCenterLX(found[0]), tileCenterLZ(found[1]), gst.speed);
      else {
        gst.leaveQueue();
        gst.state = 'exit';
      }
      return;
    }
    const e = b.entrance;
    const dist = this.field(gst.team, 'b' + b.id, e.gx, e.gz);
    this.followField(gst, dist, gx, gz, gst.speed, () => {
      gst.atEntrance = true;
      gst.state = b.ride ? 'queue' : 'queue';
    });
  }

  waitInQueue(gst) {
    const b = gst.dest;
    if (!b || b.removed || b.ruined) {
      gst.leaveQueue();
      gst.state = 'wander';
      return;
    }
    const q = b.ride ? b.ride.queue : b.shop.queue;
    const idx = q.indexOf(gst);
    if (idx < 0) {
      gst.state = 'wander';
      return;
    }
    // stand in a little spiral around the entrance
    const e = b.entrance;
    const ang = idx * 2.1;
    const rr = 0.3 + Math.sqrt(idx) * 0.55;
    this.moveToward(gst, tileCenterLX(e.gx) + Math.cos(ang) * rr, tileCenterLZ(e.gz) + Math.sin(ang) * rr, 0.9);
    if (b.shop && idx === 0) {
      q.shift();
      gst.state = 'shopping';
      gst.waitTimer = 1.4;
    }
    gst.queueTime = (gst.queueTime || 0) + DT;
    if (gst.queueTime > 60) {
      gst.leaveQueue();
      gst.happiness -= 8;
      gst.state = 'wander';
      gst.queueTime = 0;
    }
  }

  finishShop(gst) {
    const b = gst.dest;
    const g = this.game;
    gst.dest = null;
    gst.atEntrance = false;
    gst.state = 'wander';
    gst.queueTime = 0;
    if (!b || b.ruined || b.removed) return;
    const park = g.parks[gst.team];
    const price = Math.round(park.ticketPrice(b));
    if (gst.money < price) {
      gst.think('broke');
      return;
    }
    gst.money -= price;
    g.earn(gst.team, price, 'shops');
    b.income += price;
    b.customers++;
    const need = b.def.shop.need;
    if (need === 'hunger') gst.hunger = Math.max(0, gst.hunger - 75);
    else if (need === 'thirst') gst.thirst = Math.max(0, gst.thirst - 80);
    else gst.look.balloon = [0xff4d6d, 0xffd60a, 0x4cc9f0, 0x80ed99, 0xc77dff][(Math.random() * 5) | 0];
    gst.happiness = Math.min(100, gst.happiness + (need === 'fun' ? 14 : 6));
    gst.energy = Math.min(100, gst.energy + 5);
    g.emit('purchase', { x: b.x, z: b.z, team: gst.team, amount: price });
  }

  seat(gst, b, i) {
    gst.atEntrance = false;
    gst.state = 'riding';
    gst.seat = { b, i };
    gst.queueTime = 0;
    const rd = gst.rd;
    rd.pinned = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, pose: 'sit' };
    rd.noCollide = true;
    // teleport near the seat so constraints don't explode
    const s = this._seat;
    if (b.coaster) b.coaster.seatTransform(i, s);
    else this.game.parks[gst.team].seat(b, i, s);
    const p = this.game.phys;
    const k = rd.base + PELVIS;
    p.teleport(rd, s.x - p.x[k], s.y - p.y[k], s.z - p.z[k]);
    p.setVelocity(rd, 0, 0, 0);
    const price = Math.round(this.game.parks[gst.team].ticketPrice(b));
    gst.money -= price;
  }

  unseat(gst, eject) {
    const rd = gst.rd;
    gst.seat = null;
    rd.pinned = null;
    rd.noCollide = false;
    if (eject) {
      knock(this.game.phys, rd, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 6);
      gst.startFlee();
    } else {
      gst.state = 'wander';
    }
  }

  finishRide(gst, b) {
    if (!gst.seat) return;
    const rd = gst.rd;
    this.unseat(gst, false);
    // place at the entrance
    const e = b.entrance;
    if (e) {
      const p = this.game.phys;
      const k = rd.base + PELVIS;
      const s = sgn(gst.team);
      const ex = tileCenterLX(e.gx) * s, ez = tileCenterLZ(e.gz) * s;
      p.placeStanding(rd, ex, ez, rd.heading);
    }
    const E = b.coaster ? b.coaster.stats.excitement : b.def.ride.E;
    const I = b.coaster ? b.coaster.stats.intensity : b.def.ride.I;
    const N = b.coaster ? b.coaster.stats.nausea : b.def.ride.N;
    const fit = 1 - Math.abs(I - gst.pref) / 8;
    gst.happiness = Math.min(100, gst.happiness + E * 3.2 * Math.max(0.1, fit) + 2);
    gst.nausea += N * 6;
    gst.energy -= 4;
    gst.history.push(b.id);
    if (gst.history.length > 3) gst.history.shift();
    gst.dest = null;
    gst.state = 'wander';
    if (Math.random() < 0.25) gst.think(gst.nausea > 50 ? 'sick' : E > 5.5 ? 'wow' : 'meh');
  }

  // Human cannon: fire guest (or a volunteer) either into the net (peace) or at a target (war).
  fireFromCannon(gst, b, target) {
    const g = this.game;
    const team = b.team;
    if (!gst) {
      // volunteer appears at the muzzle
      if (this.count[team] >= MAX_GUESTS + 8) return;
      gst = new Guest(this, team);
      gst.volunteer = true;
      if (!g.phys.alloc(gst.rd, b.x, b.z, b.heading)) return;
      this.list.push(gst);
      this.count[team]++;
    } else if (gst.seat) {
      gst.seat = null;
      gst.rd.pinned = null;
    }
    const rd = gst.rd;
    rd.noCollide = true;
    const f = b.frame();
    const mz = 2.4;
    const sx = b.x + f.fx * mz, sz = b.z + f.fz * mz, sy = g.world.heightAt(b.x, b.z) + 2.9;
    const p = g.phys;
    const k = rd.base + PELVIS;
    p.teleport(rd, sx - p.x[k], sy - p.y[k], sz - p.z[k]);
    let tx, tz, ty, T;
    if (target) {
      const d = Math.hypot(target.x - sx, target.z - sz);
      T = Math.max(1.2, Math.min(3.2, d / 22));
      const [tvx, tvz] = target.velocity();
      tx = target.x + tvx * T * 0.7;
      tz = target.z + tvz * T * 0.7;
      ty = g.world.heightAt(tx, tz) + 0.6;
      gst.warhead = { damage: b.def.combat.damage, splash: b.def.combat.splash, knock: b.def.combat.knock, b };
    } else {
      // the net sits at the back of the show ground
      tx = b.x - f.fx * 3.5;
      tz = b.z - f.fz * 3.5;
      ty = g.world.heightAt(tx, tz) + 1.4;
      T = 1.35;
      gst.warhead = null;
    }
    const vx = (tx - sx) / T, vz = (tz - sz) / T, vy = (ty - sy + 0.5 * GRAVITY * T * T) / T;
    rd.targetMuscle = 0;
    rd.muscle = 0;
    p.setVelocity(rd, vx, vy, vz);
    gst.flying = true;
    gst.flyTime = 0;
    gst.state = 'flying';
    gst.leaveQueue();
    gst.think('cannon');
    g.emit('cannon', { x: sx, y: sy, z: sz, team, vx, vy, vz, show: !target });
  }

  updateFlying(gst) {
    const g = this.game;
    gst.flyTime += DT;
    const p = g.phys;
    const k = gst.rd.base + PELVIS;
    const vy = (p.y[k] - p.py[k]) / DT;
    const gy = g.world.heightAt(p.x[k], p.z[k]);
    let impact = false;
    if (gst.flyTime > 0.4 && vy < 0) {
      if (p.y[k] - gy < (gst.warhead ? 0.7 : 1.3)) impact = true;
      if (gst.warhead && !impact) {
        p.queryBodies(p.x[k], p.z[k], 1.1, (rd) => {
          if (rd.kind === 'unit' && rd.owner.team !== gst.team && rd.owner.alive) impact = true;
        });
      }
    }
    if (gst.flyTime > 5) impact = true;
    if (!impact) return;
    gst.flying = false;
    gst.rd.noCollide = false;
    if (gst.warhead) {
      const w = gst.warhead;
      g.splash(gst.team, p.x[k], p.z[k], w.splash, w.damage, w.knock, w.b, 'guestbomb');
      g.emit('explosion', { x: p.x[k], y: gy + 0.3, z: p.z[k], size: 1.1, kind: 'confetti' });
      g.emit('shake', { x: p.x[k], z: p.z[k], power: 0.5 });
      gst.rd.stun = 1.3;
      gst.rd.targetMuscle = 1;
      gst.state = 'offmap';
      gst.warhead = null;
    } else {
      // bounce in the net
      g.phys.impulse(gst.rd, 0, 5.5, 0);
      gst.rd.stun = 1.0;
      gst.rd.targetMuscle = 1;
      gst.happiness = Math.min(100, gst.happiness + 20);
      gst.state = gst.volunteer ? 'offmap' : 'wander';
      g.emit('splat', { x: p.x[k], z: p.z[k] });
    }
  }

  // Remove guests that ended up in the enemy territory etc. and clean on game end
  clearAll() {
    for (const gst of this.list) this.despawn(gst);
    this.list.length = 0;
  }
}
