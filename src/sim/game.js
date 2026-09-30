// ─────────────────────────────────────────────────────────────────────────────
//  Game: owns the simulation, phases, economy, damage and the event stream.
// ─────────────────────────────────────────────────────────────────────────────
import {
  DT, START_MONEY, PREP_TIME, BATTLE_TIME, RAMPAGE_TIME, MAX_ROUNDS, UNIT_TYPES, SUPPLY_CAP, TEAM_COLORS,
  HALF_W, MID, DEPLOY_ROWS, TILE, BUILDINGS, COASTER, INSURANCE, SURVIVOR_HEAL, PAYROLL, HOME_TURF,
} from '../config.js';
import { RNG } from '../util/rng.js';
import { World } from './world.js';
import { Physics, PELVIS, NECK, HEAD } from './physics.js';
import { knock } from './ragdoll.js';
import { Unit, UnitSystem } from './units.js';
import { Projectiles } from './projectiles.js';
import { Park } from './park.js';
import { GuestSystem } from './guests.js';
import { Coaster, designTrack, stationEntranceTile } from './coaster.js';
import { FlowField } from './nav.js';
import { sgn, toWorldX, toWorldZ, inDeploy, tileOfLX, tileOfLZ, tileCenterLX, tileCenterLZ } from './team.js';

export class Game {
  constructor(opts = {}) {
    this.opts = opts;
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.rng = new RNG(this.seed);
    this.world = new World();
    this.phys = new Physics(this.world, 600);
    this.time = 0;
    this.round = 0;
    this.phase = 'setup';
    this.phaseTime = 0;
    this.battleStarted = false;
    this.countdown = 0;
    this.rampage = -1;
    this.events = [];
    this.units = [[], []];
    this.buildings = [];
    this.coasters = [];
    this.projectiles = new Projectiles(this);
    this.unitSys = new UnitSystem(this);
    this.teams = [0, 1].map((id) => ({
      id,
      name: opts.players?.[id]?.name || (id === 0 ? 'You' : 'Rival'),
      parkName: opts.players?.[id]?.parkName || (id === 0 ? 'Wobbleland' : 'Chaos Kingdom'),
      human: opts.players?.[id]?.kind === 'human',
      money: START_MONEY,
      stance: 'charge',
      ready: false,
      color: TEAM_COLORS[id],
      stats: { earned: 0, spent: 0, kills: 0, lost: 0, dmg: 0, bdmg: 0, roundsWon: 0, income: { rides: 0, shops: 0, entry: 0 } },
      earnLog: [], // [time, amount]
      lastArmy: {},
      armyHistory: [],
    }));
    this.parks = [new Park(this, 0), new Park(this, 1)];
    this.guests = new GuestSystem(this);
    this.fields = [new FlowField(this.world), new FlowField(this.world)];
    this.castleFields = [new FlowField(this.world), new FlowField(this.world)];
    this.navDirty = true;
    this.navTimer = 0;
    this.winner = -1;
    this.overReason = '';
    this.celebrate = -1;
    this.ai = [null, null];
    this.battleLog = [];
    this.headless = !!opts.headless;
    this.speed = 1;
    this.roundResult = null;
    for (const p of this.parks) p.setupStart();
    this.phase = 'intro';
    this.phaseTime = opts.introTime ?? 0;
  }

  // ── Events ──
  emit(type, data = {}) {
    data.type = type;
    this.events.push(data);
  }
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ── Economy ──
  earn(team, amount, reason = 'misc', at = null) {
    const t = this.teams[team];
    if (t.aiIncome && (reason === 'rides' || reason === 'shops' || reason === 'entry')) amount *= t.aiIncome;
    t.money += amount;
    t.stats.earned += amount;
    if (t.stats.income[reason] !== undefined) t.stats.income[reason] += amount;
    t.earnLog.push([this.time, amount]);
    if (reason === 'rides' || reason === 'shops' || reason === 'entry') this.emit('money', { team, amount, reason, x: at ? at.x : undefined, z: at ? at.z : undefined });
  }
  spend(team, amount, reason = 'misc') {
    const t = this.teams[team];
    t.money -= amount;
    t.stats.spent += amount;
  }
  incomePerMinute(team) {
    const t = this.teams[team];
    const cutoff = this.time - 60;
    let s = 0;
    let i = 0;
    while (i < t.earnLog.length && t.earnLog[i][0] < cutoff - 120) i++;
    if (i > 0) t.earnLog.splice(0, i);
    for (const [tm, a] of t.earnLog) if (tm >= cutoff) s += a;
    const span = Math.min(60, Math.max(10, this.time));
    return (s * 60) / span;
  }

  // ── Units ──
  supplyUsed(team) {
    let s = 0;
    for (const u of this.units[team]) if (u.alive) s += u.def.supply;
    return s;
  }
  canDeploy(team, type, lx, lz) {
    const def = UNIT_TYPES[type];
    if (!def) return { ok: false, reason: 'Unknown unit' };
    if (this.phase !== 'prep' && this.phase !== 'intro') return { ok: false, reason: 'Only during planning' };
    if (this.teams[team].money < def.cost) return { ok: false, reason: 'Not enough money' };
    if (this.supplyUsed(team) + def.supply > SUPPLY_CAP) return { ok: false, reason: 'Army is full' };
    const gx = tileOfLX(lx), gz = tileOfLZ(lz);
    if (!inDeploy(gx, gz) || lz < MID + 0.8 || Math.abs(lx) > HALF_W - 0.8) return { ok: false, reason: 'Place units in your deployment yard' };
    const park = this.parks[team];
    if (park.tile(gx, gz) > 0) return { ok: false, reason: 'Blocked by a building' };
    // spacing
    const x = toWorldX(team, lx), z = toWorldZ(team, lz);
    const minD = 0.9 * def.scale + (def.vehicle ? 1.2 : 0);
    for (const u of this.units[team]) {
      if (!u.alive) continue;
      const ux = toWorldX(team, u.homeLX), uz = toWorldZ(team, u.homeLZ);
      const r = minD + 0.45 * u.def.scale + (u.vehicle ? 1.1 : 0);
      if ((ux - x) ** 2 + (uz - z) ** 2 < r * r) return { ok: false, reason: 'Too close to another unit' };
    }
    return { ok: true };
  }
  deploy(team, type, lx, lz, free = false) {
    const chk = this.canDeploy(team, type, lx, lz);
    if (!chk.ok && !free) return null;
    const def = UNIT_TYPES[type];
    if (!free) this.spend(team, def.cost, 'units');
    const u = new Unit(this, team, type, lx, lz);
    this.units[team].push(u);
    this.emit('deploy', { team, unit: u });
    return u;
  }
  removeUnit(u, refund = true) {
    const arr = this.units[u.team];
    const i = arr.indexOf(u);
    if (i >= 0) arr.splice(i, 1);
    this.phys.release(u.rd);
    u.removed = true;
    if (refund && u.alive) {
      const full = u.placedRound === this.round;
      this.earn(u.team, Math.round(u.def.cost * (full ? 1 : 0.5)), 'refund');
    }
    this.emit('undeploy', { unit: u });
  }
  moveUnitHome(u, lx, lz) {
    u.homeLX = lx;
    u.homeLZ = lz;
    u.resetToHome();
  }

  damageUnit(t, amount, source, dx, dy, dz, power, part = NECK) {
    if (!t.alive || amount <= 0 && power <= 0) return;
    if (t.team === (source && source.team)) return;
    // home-turf advantage for defenders
    if (source && source.isBuilding === undefined && source.team !== undefined && source.x !== undefined) {
      const s = source.team === 0 ? 1 : -1;
      if (source.z * s > MID) amount *= HOME_TURF;
    }
    const dealt = Math.min(t.hp, amount);
    t.hp -= amount;
    this.lastDamageTime = this.time;
    this.teams[t.team].recentTaken = (this.teams[t.team].recentTaken || 0) + dealt;
    t.lastHitTime = this.time;
    if (source && source.team !== undefined) {
      this.teams[source.team].stats.dmg += dealt;
      if (source.stats) source.stats.dmg += dealt;
    }
    if (power > 0) {
      const l = Math.hypot(dx, dy, dz) || 1;
      if (t.vehicle) {
        // cars get shoved
        t.vehicle.x += (dx / l) * power * 0.05;
        t.vehicle.z += (dz / l) * power * 0.05;
        t.vehicle.speed *= 0.7;
      } else knock(this.phys, t.rd, dx / l, dy / l, dz / l, power, t.rd.base + part);
    }
    this.emit('hit', { x: t.x, y: t.y + 0.5 * t.def.scale, z: t.z, amount, team: t.team, unit: t, big: amount > 40 });
    if (t.hp <= 0) this.killUnit(t, source);
  }

  // Stuns with diminishing returns: big units resist, and a fresh stun grants brief immunity.
  stunUnit(e, dur) {
    const sc = e.def.scale;
    const mul = sc >= 2 ? 0.15 : sc >= 1.15 ? 0.5 : 1;
    e.pieFace = 3.5;
    if (this.time < (e.stunImmune || 0)) return;
    const d = dur * mul;
    if (d < 0.1) return;
    e.rd.stun = Math.max(e.rd.stun, d);
    e.stunImmune = this.time + d + 1.6;
  }

  killUnit(t, source) {
    if (!t.alive) return;
    t.alive = false;
    t.hp = 0;
    t.deathTime = this.time;
    const rd = t.rd;
    rd.targetMuscle = 0;
    rd.muscle = 0;
    rd.stun = 0;
    rd.anim = null;
    rd.footOverride = null;
    if (t.vehicle) {
      t.vehicle.wreck = true;
      t.vehicle.speed = 0;
      rd.pinned = null;
      rd.noCollide = false;
      this.phys.impulse(rd, (Math.random() - 0.5) * 3, 7, (Math.random() - 0.5) * 3);
      this.emit('explosion', { x: t.vehicle.x, y: 0.8, z: t.vehicle.z, size: 0.8, kind: 'car' });
    }
    this.teams[t.team].stats.lost++;
    if (source && source.team !== undefined && source.team !== t.team) {
      this.teams[source.team].stats.kills++;
      if (source.stats) source.stats.kills++;
    }
    this.emit('death', { x: t.x, y: t.y, z: t.z, team: t.team, unit: t, kind: t.type });
  }

  // Area damage to enemies of `team`; knocks guests + corpses too.
  splash(team, x, z, radius, damage, power, source, kind, direct = null, stun = 0) {
    const enemies = this.units[1 - team];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dz = e.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const r = radius + e.radius;
      if (d > r) continue;
      const f = e === direct ? 1 : 1 - 0.55 * (d / r);
      const l = d || 1;
      this.damageUnit(e, damage * f, source, dx / l, 0.9, dz / l, power * f, PELVIS);
      if (stun > 0 && e.alive) this.stunUnit(e, stun * f);
    }
    // cosmetic flinging of corpses + guests (any team)
    this.phys.queryBodies(x, z, radius + 0.5, (rd, k, d) => {
      if (rd.kind === 'guest') {
        if (rd.owner.seat) return;
        const dx = this.phys.x[k] - x, dz = this.phys.z[k] - z;
        const l = Math.hypot(dx, dz) || 1;
        knock(this.phys, rd, dx / l, 1.0, dz / l, power * 0.9 * (1 - d / (radius + 0.5)) + 3);
        rd.owner.onKnocked();
      } else if (rd.kind === 'unit' && !rd.owner.alive) {
        const dx = this.phys.x[k] - x, dz = this.phys.z[k] - z;
        const l = Math.hypot(dx, dz) || 1;
        this.phys.impulse(rd, (dx / l) * power * 0.6, power * 0.6, (dz / l) * power * 0.6);
      }
    });
  }
  splashBuildings(team, x, z, radius, damage, source) {
    if (damage <= 0) return;
    for (const b of this.buildings) {
      if (b.team === team || !b.targetable || b.hp <= 0) continue;
      const d = Math.hypot(b.x - x, b.z - z) - b.radius;
      if (d < radius) this.damageBuilding(b, damage, source, x, z);
    }
  }
  damageBuilding(b, amount, source, x, z) {
    if (b.hp <= 0 || !b.targetable || amount <= 0) return;
    if (source && source.team === b.team) return;
    if (this.phase !== 'battle') return;
    b.hp -= amount;
    b.lastHit = this.time;
    this.lastDamageTime = this.time;
    if (source && source.team !== undefined) this.teams[source.team].stats.bdmg += amount;
    this.emit('bhit', { b, x: x ?? b.x, z: z ?? b.z, amount });
    if (b.hp <= 0) this.destroyBuilding(b, source);
  }
  destroyBuilding(b, source) {
    const park = this.parks[b.team];
    park.ruin(b);
    if (b.coaster) {
      b.coaster.destroy();
    }
    this.emit('destroyed', { b, x: b.x, z: b.z, team: b.team });
    if (b.type === 'castle') this.gameOver(1 - b.team, 'castle');
  }

  // ── Coasters ──
  buildCoaster(team, station, nodes, free = false) {
    const park = this.parks[team];
    const design = designTrack(this, team, station, nodes);
    if (!design.valid) return { ok: false, reason: design.reason };
    if (!free && this.teams[team].money < design.cost) return { ok: false, reason: 'Not enough money' };
    const chk = park.canPlace('station', station.gx, station.gz, station.rot, { noPath: true });
    if (!chk.ok) return { ok: false, reason: chk.reason };
    // path to station entrance
    const [ex, ez] = stationEntranceTile(station.gx, station.gz, station.rot);
    const route = park.findPathRoute(ex, ez, { gx: station.gx, gz: station.gz, W: chk.W, D: chk.D });
    if (!route) return { ok: false, reason: 'Station entrance not reachable by path' };
    const pathCost = route.length * 10;
    const total = design.cost + pathCost;
    if (!free && this.teams[team].money < total) return { ok: false, reason: 'Not enough money' };
    const b = park.place('station', station.gx, station.gz, station.rot, { free: true, noPath: true });
    if (!b) return { ok: false, reason: 'Cannot place station' };
    for (const [i, j] of route) park.placePath(i, j, true);
    if (!free) this.spend(team, total, 'build');
    b.entrance = { gx: ex, gz: ez, x: tileCenterLX(ex) * sgn(team), z: tileCenterLZ(ez) * sgn(team) };
    b.maxHp = b.hp = COASTER.hp;
    b.def = { ...BUILDINGS.station, cost: design.cost, hp: COASTER.hp };
    station.building = b;
    const c = new Coaster(this, team, b, design);
    this.coasters.push(c);
    park.pathVersion++;
    this.emit('coaster', { coaster: c, team });
    return { ok: true, coaster: c };
  }
  removeCoaster(c, refund = 0.5) {
    c.destroy();
    const i = this.coasters.indexOf(c);
    if (i >= 0) this.coasters.splice(i, 1);
    const park = this.parks[c.team];
    if (refund > 0 && !c.building.ruined) this.earn(c.team, Math.round(c.d.cost * refund), 'refund');
    park.removeBuilding(c.building);
    this.emit('coasterRemoved', { coaster: c });
  }

  markNavDirty() {
    this.navDirty = true;
  }
  rebuildNav() {
    for (let team = 0; team < 2; team++) {
      const goals = [];
      const f = this.fields[team];
      for (const b of this.buildings) {
        if (b.team === team || !b.targetable || b.hp <= 0) continue;
        // cells around the footprint
        const r = b.worldRect(-1.2);
        for (let x = r.x0; x <= r.x1 + 0.01; x += TILE) {
          for (let z = r.z0; z <= r.z1 + 0.01; z += TILE) {
            const [i, j] = f.cellOf(x, z);
            goals.push([i, j]);
          }
        }
      }
      const block = (c) => !c.ghost && c.h >= 1.2 && c.owner && c.owner.isBuilding && c.owner.def.cat !== 'scenery' && c.owner.hp > 0;
      f.build(goals, block);
      // siege field: straight for the enemy castle (rides only matter if they block the way)
      const cf = this.castleFields[team];
      const castle = this.parks[1 - team].castle;
      const cg = [];
      if (castle && castle.hp > 0) {
        const r = castle.worldRect(-1.2);
        for (let x = r.x0; x <= r.x1 + 0.01; x += TILE) for (let z = r.z0; z <= r.z1 + 0.01; z += TILE) cg.push(cf.cellOf(x, z));
      }
      cf.build(cg.length ? cg : goals, block);
    }
    this.navDirty = false;
  }

  // ── Phases ──
  begin() {
    this.startPrep();
  }
  startPrep() {
    this.round++;
    this.phase = 'prep';
    this.phaseTime = this.round === 1 ? PREP_TIME + 33 : PREP_TIME;
    this.battleStarted = false;
    this.rampage = -1;
    this.celebrate = -1;
    this.projectiles.clear();
    for (let team = 0; team < 2; team++) {
      const keep = [];
      for (const u of this.units[team]) {
        if (!u.alive) {
          this.phys.release(u.rd);
          u.removed = true;
          continue;
        }
        u.hp = Math.min(u.maxHp, u.hp + (u.maxHp - u.hp) * SURVIVOR_HEAL);
        u.resetToHome();
        keep.push(u);
      }
      this.units[team] = keep;
      this.teams[team].ready = false;
      // payroll: veterans want wages
      if (this.round > 1) {
        const wages = Math.round(keep.reduce((s, u) => s + u.def.cost, 0) * PAYROLL);
        if (wages > 0) {
          this.spend(team, wages, 'wages');
          this.emit('wages', { team, amount: wages });
        }
      }
    }
    for (const t of this.teams) t.ready = false;
    this.emit('phase', { phase: 'prep', round: this.round });
    for (const ai of this.ai) if (ai) ai.onPrepStart();
  }
  startBattle() {
    this.phase = 'battle';
    this.phaseTime = BATTLE_TIME;
    this.battleStarted = false;
    this.battleStartTime = this.time;
    this.countdown = 3;
    this.lastDamageTime = this.time + 3;
    this.rampage = -1;
    // Record armies (the enemy gets to scout what you brought)
    for (let team = 0; team < 2; team++) {
      const comp = {};
      let value = 0;
      for (const u of this.units[team]) {
        if (!u.alive) continue;
        comp[u.type] = (comp[u.type] || 0) + 1;
        value += u.def.cost;
        u.startHp = u.hp;
      }
      this.teams[team].lastArmy = comp;
      this.teams[team].armyHistory.push({ round: this.round, comp, value, stance: this.teams[team].stance });
      this.teams[team].armyStart = value;
    }
    this.battleStats = { castle0: this.parks[0].castle.hp, castle1: this.parks[1].castle.hp, lost: [this.teams[0].stats.lost, this.teams[1].stats.lost] };
    this.emit('phase', { phase: 'battle', round: this.round });
    for (const ai of this.ai) if (ai) ai.onBattleStart();
  }
  endBattle() {
    const res = this.evaluateRound();
    // Insurance: refund part of the value of units lost this battle
    for (let team = 0; team < 2; team++) {
      let lostValue = 0;
      for (const u of this.units[team]) if (!u.alive && u.deathTime >= this.battleStartTime) lostValue += u.def.cost;
      const refund = Math.round(lostValue * INSURANCE);
      if (refund > 0) {
        this.earn(team, refund, 'insurance');
        res.insurance = res.insurance || [0, 0];
        res.insurance[team] = refund;
      }
    }
    this.roundResult = res;
    if (res.winner >= 0) this.teams[res.winner].stats.roundsWon++;
    this.celebrate = res.winner;
    this.emit('roundEnd', res);
    for (const ai of this.ai) if (ai) ai.onBattleEnd(res);
    if (this.phase === 'over') return;
    if (this.round >= MAX_ROUNDS) {
      const c0 = this.parks[0].castle.hp, c1 = this.parks[1].castle.hp;
      this.gameOver(c0 === c1 ? (this.parks[0].value() >= this.parks[1].value() ? 0 : 1) : c0 > c1 ? 0 : 1, 'rounds');
      return;
    }
    this.phase = 'results';
    this.phaseTime = 3.5;
  }
  evaluateRound() {
    const alive = [0, 1].map((t) => this.units[t].filter((u) => u.alive).length);
    const valueLeft = [0, 1].map((t) => this.units[t].reduce((s, u) => s + (u.alive ? u.def.cost * (u.hp / u.maxHp) : 0), 0));
    const castleDmg = [this.battleStats.castle0 - this.parks[0].castle.hp, this.battleStats.castle1 - this.parks[1].castle.hp];
    const lost = [0, 1].map((t) => this.teams[t].stats.lost - this.battleStats.lost[t]);
    let winner = -1;
    const score0 = valueLeft[0] + castleDmg[1] * 0.5;
    const score1 = valueLeft[1] + castleDmg[0] * 0.5;
    if (Math.abs(score0 - score1) > 60) winner = score0 > score1 ? 0 : 1;
    return { round: this.round, winner, alive, valueLeft, castleDmg, lost };
  }
  gameOver(winner, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = winner;
    this.overReason = reason;
    this.celebrate = winner;
    this.emit('gameOver', { winner, reason });
    for (const ai of this.ai) if (ai) ai.onGameOver(winner);
  }

  setReady(team) {
    this.teams[team].ready = true;
  }

  // ── Main fixed step ──
  step() {
    this.time += DT;
    const ph = this.phase;
    if (ph === 'intro') {
      this.phaseTime -= DT;
      if (this.phaseTime <= 0) this.begin();
    } else if (ph === 'prep') {
      this.phaseTime -= DT;
      const humansReady = this.teams.every((t) => !t.human || t.ready);
      const allAI = this.teams.every((t) => !t.human);
      if (this.phaseTime <= 0 || (humansReady && !allAI && this.teams.some((t) => t.human)) || (allAI && this.phaseTime <= 0)) {
        // AIs finish their planning before the horn sounds
        for (const ai of this.ai) if (ai) ai.flushPrep();
        this.startBattle();
      }
    } else if (ph === 'battle') {
      if (!this.battleStarted) {
        this.countdown -= DT;
        if (this.countdown <= 0) {
          this.battleStarted = true;
          this.emit('fight', {});
          for (const team of [0, 1]) for (const u of this.units[team]) if (u.alive && u.def.launch && !u.launched) this.unitSys.launch(u);
        }
      } else {
        this.phaseTime -= DT;
        const a0 = this.units[0].some((u) => u.alive), a1 = this.units[1].some((u) => u.alive);
        if (!a0 || !a1) {
          if (this.rampage < 0) {
            this.rampage = !a0 && !a1 ? 2 : RAMPAGE_TIME;
            this.emit('rampage', { team: a0 ? 0 : a1 ? 1 : -1 });
          }
          this.rampage -= DT;
          if (this.rampage <= 0) this.endBattle();
        }
        if (this.phase === 'battle' && this.phaseTime <= 0) this.endBattle();
        // Stalemate: nobody has hurt anybody for a while
        if (this.phase === 'battle' && this.time - this.lastDamageTime > 22 && BATTLE_TIME - this.phaseTime > 28) {
          this.emit('stalemate', {});
          this.endBattle();
        }
      }
    } else if (ph === 'results') {
      this.phaseTime -= DT;
      if (this.phaseTime <= 0) this.startPrep();
    }

    // decay "recent damage taken" trackers (≈ 8 s window)
    for (const t of this.teams) if (t.recentTaken) t.recentTaken *= 1 - DT / 8;
    // AI brains
    for (const ai of this.ai) if (ai) ai.update(DT);
    // Scouting: note where invaders break into each park
    if (ph === 'battle' && this.battleStarted && (Math.floor(this.time / DT) % 60) === 0) {
      for (let team = 0; team < 2; team++) {
        const ai = this.ai[team];
        if (!ai) continue;
        const s = team === 0 ? 1 : -1;
        for (const u of this.units[1 - team]) {
          if (!u.alive) continue;
          const lz = u.z * s;
          if (lz > MID + DEPLOY_ROWS * TILE - 6) ai.noteIntrusion(u.x * s);
        }
      }
    }

    // Nav fields
    this.navTimer -= DT;
    if (this.navDirty && this.navTimer <= 0) {
      this.rebuildNav();
      this.navTimer = 0.5;
    }
    // Units
    for (let team = 0; team < 2; team++) {
      const arr = this.units[team];
      for (let i = 0; i < arr.length; i++) this.unitSys.update(arr[i]);
    }
    // Corpse cleanup (keep bodies around for a while, TABS-style)
    if ((Math.floor(this.time / DT) & 31) === 0) this.cleanupCorpses();
    // Guests
    this.guests.update();
    // Physics
    this.phys.step();
    // Projectiles
    this.projectiles.update();
    // Parks + coasters
    this.parks[0].update();
    this.parks[1].update();
    for (const c of this.coasters) c.update();
  }

  cleanupCorpses() {
    let corpses = 0;
    for (let team = 0; team < 2; team++) for (const u of this.units[team]) if (!u.alive && !u.removed) corpses++;
    const limit = 110;
    if (corpses <= limit) return;
    // remove oldest
    const all = [];
    for (let team = 0; team < 2; team++) for (const u of this.units[team]) if (!u.alive && !u.removed) all.push(u);
    all.sort((a, b) => a.deathTime - b.deathTime);
    for (let i = 0; i < corpses - limit; i++) {
      const u = all[i];
      this.phys.release(u.rd);
      u.removed = true;
      const arr = this.units[u.team];
      arr.splice(arr.indexOf(u), 1);
    }
  }
}
