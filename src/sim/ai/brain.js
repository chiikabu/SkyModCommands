// ─────────────────────────────────────────────────────────────────────────────
//  AI park owner: scouts, budgets, builds an economy, designs coasters,
//  counter-picks armies, deploys in formation, picks a stance, adapts mid-battle.
// ─────────────────────────────────────────────────────────────────────────────
import {
  UNIT_TYPES, UNIT_ORDER, EFF, BUILDINGS, GRID_W, TERR_ROWS, DEPLOY_ROWS, SUPPLY_CAP, MAX_ROUNDS, TILE, HALF_W, MID,
  CASTLE_HP, DT, COASTER, ENTRY_FEE,
} from '../../config.js';
import { RNG } from '../../util/rng.js';
import { PERSONALITIES, DIFFICULTIES } from './personalities.js';
import { rotatedSize, entranceTile } from '../park.js';
import { inPark, inGrid, tileCenterLX, tileCenterLZ, sgn } from '../team.js';
import { designBestCoaster, stationCandidates, generateNodes, repairDesign, scoreDesign } from './coasterGen.js';
import { designTrack } from '../coaster.js';

const FRONT = new Set(['tank', 'boss']);
const MELEE = new Set(['melee', 'heavy', 'tank', 'boss', 'assassin']);
const RANGED = new Set(['ranged', 'artillery', 'skirmisher']);

export class AIPlayer {
  constructor(game, team, personality = 'gustavo', difficulty = 'normal', seed = 1) {
    this.game = game;
    this.team = team;
    this.p = PERSONALITIES[personality] || PERSONALITIES.gustavo;
    this.d = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.rng = new RNG(seed * 7919 + team * 131 + 17);
    this.queue = [];
    this.actionTimer = 1.5;
    this.memory = {
      enemyEntries: [1, 1, 1],
      enemyArmyStart: [],
      enemySurvivors: { comp: {}, value: 0 },
      armyShare: 0.55,
      roundsWon: 0,
      roundsLost: 0,
      lastIncome: 0,
    };
    this.coasterJob = null;
    this.chatCooldown = 0;
    this.battleTimer = 0;
    this.lane = 0;
    this.lastStanceChange = -99;
    this.plan = null;
    this.topUpDone = false;
    this.peeked = false;
    game.teams[team].aiIncome = this.d.income;
    game.teams[team].name = this.p.name;
    game.teams[team].parkName = this.p.parkName;
  }

  get team_() {
    return this.game.teams[this.team];
  }
  get park() {
    return this.game.parks[this.team];
  }
  get enemyTeam() {
    return 1 - this.team;
  }

  say(kind, vars = {}, force = false) {
    if (!force && this.chatCooldown > 0) return;
    const arr = this.p.taunts[kind];
    if (!arr) return;
    let text = arr[this.rng.int(0, arr.length)];
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll('{' + k + '}', v);
    this.chatCooldown = 7;
    this.game.emit('chat', { team: this.team, name: this.p.name, avatar: this.p.avatar, color: this.p.color, text });
  }

  // ── Knowledge ──
  analyze() {
    const g = this.game;
    const me = this.team, en = this.enemyTeam;
    const myUnits = g.units[me].filter((u) => u.alive);
    const myArmyValue = myUnits.reduce((s, u) => s + u.def.cost * (0.4 + 0.6 * u.hp / u.maxHp), 0);
    const hist = g.teams[en].armyHistory;
    // predicted enemy composition (value shares), recency-weighted, blended with a prior
    const share = {};
    let wsum = 0;
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      const w = Math.pow(1.8, i - hist.length + 1);
      for (const [t, n] of Object.entries(h.comp)) {
        share[t] = (share[t] || 0) + w * n * UNIT_TYPES[t].cost;
        wsum += w * n * UNIT_TYPES[t].cost;
      }
    }
    const prior = { janitor: 0.25, popper: 0.2, mascot: 0.15, clown: 0.1, strongman: 0.1, cannoneer: 0.08, bumper: 0.07, ringmaster: 0.05 };
    const blend = hist.length ? Math.max(0.12, 0.45 - hist.length * 0.1) : 1;
    const comp = {};
    for (const t of UNIT_ORDER) {
      const observed = wsum > 0 ? (share[t] || 0) / wsum : 0;
      comp[t] = observed * (1 - blend) + (prior[t] || 0.01) * blend;
    }
    // Brutal peeks at the actual current deployment late in prep
    if (this.d.peek && g.phase === 'prep' && g.phaseTime < 14) {
      const cur = {};
      let tot = 0;
      for (const u of g.units[en]) if (u.alive) { cur[u.type] = (cur[u.type] || 0) + u.def.cost; tot += u.def.cost; }
      if (tot > 0) for (const t of UNIT_ORDER) comp[t] = comp[t] * 0.3 + ((cur[t] || 0) / tot) * 0.7;
    }
    // enemy army size estimate
    const enemyIncome = g.incomePerMinute(en);
    const roundLen = 2.0; // minutes
    const survivors = this.memory.enemySurvivors.value;
    let predicted = survivors + enemyIncome * roundLen * this.memory.armyShare * this.rng.range(0.9, 1.15);
    if (g.round <= 1) predicted = Math.max(predicted, 2200);
    if (this.d.peek && g.phase === 'prep' && g.phaseTime < 14) {
      let v = 0;
      for (const u of g.units[en]) if (u.alive) v += u.def.cost;
      predicted = Math.max(predicted * 0.5, v);
    }
    // defenses
    const def = (team) => {
      let v = 0;
      const lanes = [0, 0, 0];
      for (const b of g.parks[team].buildings) {
        if (b.ruined || !b.def.combat) continue;
        const val = b.type === 'turret' ? 650 : b.type === 'fountain' ? 380 : b.type === 'cannonshow' ? 700 : b.type === 'droptower' ? 500 : 400;
        v += val;
        const lx = b.lx;
        lanes[lx < -16 ? 0 : lx > 16 ? 2 : 1] += val;
      }
      for (const c of g.coasters) {
        if (c.team !== team || c.building.ruined) continue;
        const m = c.d.lowMeters ?? 0;
        v += m * 25;
      }
      v += 600; // castle fireworks
      return { v, lanes };
    };
    const myDef = def(me), enDef = def(en);
    return {
      myUnits, myArmyValue, comp, predicted, enemyIncome, myDef, enDef,
      myCastle: g.parks[me].castle.hp / CASTLE_HP,
      enCastle: g.parks[en].castle.hp / CASTLE_HP,
      money: this.team_.money,
      income: g.incomePerMinute(me),
    };
  }

  // ── Round planning ──
  onPrepStart() {
    const g = this.game;
    this.queue = [];
    this.topUpDone = false;
    this.peeked = false;
    this.actionTimer = 0.8 + this.rng.next() * this.d.delay;
    const A = this.analyze();
    this.plan = A;
    const r = g.round;
    // Budget shares, scaled by how quickly a new attraction would pay for itself
    let econ = this.p.econ, army = this.p.army, defense = this.p.defense;
    const tRem = Math.max(0, (MAX_ROUNDS - r + 0.5) * 2.1) * Math.min(1, 0.35 + Math.min(A.myCastle, A.enCastle) * 0.9);
    let bestPayback = 1e9;
    for (const t of ['carousel', 'teacups', 'pirate', 'ferris', 'droptower', 'cannonshow']) {
      const pb = BUILDINGS[t].cost / Math.max(1, this.estimateRideIncome(t));
      if (pb < bestPayback) bestPayback = pb;
    }
    this.bestPayback = bestPayback;
    this.tRem = tRem;
    const roiFactor = Math.max(0.15, Math.min(1.7, tRem / (bestPayback * 2.4)));
    econ *= roiFactor;
    if (r >= MAX_ROUNDS - 2) econ *= 0.2;
    const threat = A.predicted / (A.myArmyValue + A.myDef.v * 0.6 + 200);
    if (threat > 1.4) { army += 0.08; defense += 0.12; econ -= 0.07; }
    if (threat > 2.4) { army += 0.1; econ -= 0.08; }
    if (A.myCastle < 0.5) defense += 0.12;
    if (A.enCastle < 0.4) { army += 0.25; econ -= 0.2; }
    if (A.myArmyValue > A.predicted * 1.7 && r > 2) econ += 0.12;
    if (r === 1) {
      army = Math.max(army, this.p.id === 'mayhem' ? 0.6 : 0.36);
      econ = Math.max(econ, this.p.id === 'mayhem' ? 0.34 : 0.5);
      defense = Math.min(defense, 0.12);
    }
    if (r === 2) econ = Math.max(econ, this.p.id === 'mayhem' ? 0.25 : 0.4);
    econ = Math.max(0.03, econ);
    const tot = econ + army + defense;
    econ /= tot; army /= tot; defense /= tot;
    const reserve = Math.min(A.money * 0.06, 350);
    const saved = Math.min(this.savings || 0, A.money - reserve);
    const spend = Math.max(0, A.money - reserve - saved);
    // Army parity: never fall behind the army we expect to face; invest the surplus.
    const parity = { mayhem: 1.3, gustavo: 1.15, baron: 1.0, penny: 0.95 }[this.p.id] ?? 1.1;
    const defended = A.myDef.v * 0.35;
    const need = Math.max(0, A.predicted * parity * (0.85 + 0.3 * this.d.counter) - A.myArmyValue - defended);
    const armyFloor = Math.min(spend, need);
    const rest = spend - armyFloor;
    const restShares = econ + defense + army * 0.35;
    this.budget = {
      econ: (rest * econ) / restShares + saved,
      army: armyFloor + (rest * army * 0.35) / restShares,
      defense: (rest * defense) / restShares,
    };
    // outgunned badly? spend on defense too
    if (need > spend * 1.3 && defense < 0.25) {
      const shift = this.budget.army * 0.15;
      this.budget.army -= shift;
      this.budget.defense += shift;
    }
    const bt = this.budget.econ + this.budget.army + this.budget.defense || 1;
    this.shares = { econ: this.budget.econ / bt, army: this.budget.army / bt, defense: this.budget.defense / bt };

    // Chatter
    if (r === 1) this.say('start', {}, true);
    else if (g.roundResult) {
      if (g.roundResult.winner === this.team) this.say('winRound', {}, true);
      else if (g.roundResult.winner === this.enemyTeam) this.say('loseRound', {}, true);
    }

    // 1) Repairs
    this.planRepairs();
    // 2) Economy
    this.planEconomy();
    // 3) Defense
    this.planDefense();
    // 4) Army + formation + stance
    this.planArmy();
    this.chooseStance();
    // interleave: sort queue by priority but mix categories
    this.queue.sort((a, b) => a.pri - b.pri);
  }

  planRepairs() {
    const park = this.park;
    const rate = this.d.repair;
    for (const b of park.buildings) {
      if (b.type === 'castle' || b.type === 'gate' || b.def.cat === 'scenery') continue;
      if (b.hp >= b.maxHp && !b.ruined) continue;
      if (this.rng.next() > rate) continue;
      const cost = park.repairCost(b);
      const important = b.def.combat || b.coaster || b.def.ride;
      if (!important && b.ruined) continue;
      this.queue.push({ kind: 'repair', b, pri: 0 + this.rng.next(), cost });
    }
  }

  planEconomy() {
    const g = this.game;
    const park = this.park;
    let budget = this.budget.econ;
    const guests = park.guestCount;
    const cap = park.guestCapacity();
    let foodShops = 0, drinkShops = 0, funShops = 0, rides = 0;
    const counts = {};
    for (const b of park.buildings) {
      if (b.ruined) continue;
      counts[b.type] = (counts[b.type] || 0) + 1;
      if (b.def.shop) {
        if (b.def.shop.need === 'hunger') foodShops++;
        else if (b.def.shop.need === 'thirst') drinkShops++;
        else funShops++;
      }
      if (b.def.ride || b.coaster) rides++;
    }
    const coasters = g.coasters.filter((c) => c.team === this.team).length;
    const picks = [];
    // Coaster first when it's time
    const maxCoasters = this.p.coasterLove > 1.4 ? 2 : this.p.coasterLove > 0.9 ? 1 : this.rng.chance(0.4) ? 1 : 0;
    const wantCoaster = coasters < maxCoasters && (g.round >= (this.p.coasterLove > 1.4 ? 1 : 2)) && budget >= 1900;
    if (wantCoaster && !this.coasterJob) {
      this.coasterJob = {
        tries: 0, max: this.d.coasterTries, best: null, budget: Math.min(budget, 6500),
        style: { defensive: this.rng.chance(this.p.defense > 0.2 ? 0.7 : 0.35), minH: 14, maxH: 18 + Math.min(14, budget / 400) },
        stations: null,
      };
      const reserve = Math.min(budget, 3500);
      budget -= reserve;
      this.coasterReserve = reserve; // protected from the end-of-planning top-up
    }
    // Rides by ROI (attractions first: no rides → no guests → no money)
    const util = Math.max(0.4, Math.min(1.2, (guests + 16) / Math.max(20, cap)));
    const rideTypes = ['carousel', 'teacups', 'pirate', 'ferris', 'droptower', 'cannonshow'];
    let guard = 0;
    let addedCap = 0;
    const shopReserve = foodShops === 0 ? 330 : 0;
    while (budget - shopReserve > 700 && guard++ < 6) {
      let best = null, bs = 0;
      for (const t of rideTypes) {
        const def = BUILDINGS[t];
        if (def.cost + 60 > budget - shopReserve) continue;
        const income = this.estimateRideIncome(t) * util;
        if (def.cost / Math.max(1, income) > (this.tRem || 20) * 0.55 && !def.combat) continue;
        let roi = income / def.cost;
        roi *= 1 / (1 + 0.55 * (counts[t] || 0));
        if (def.combat) roi *= 1 + this.p.defense * 1.5 + (this.shares.defense > 0.2 ? 0.2 : 0);
        if (def.rating) roi *= 1.15;
        if (rides === 0 && def.cost < 900) roi *= 1.3; // get a cheap starter ride going
        roi *= 1 + this.rng.gauss() * this.d.noise * 0.5;
        if (roi > bs) { bs = roi; best = t; }
      }
      if (!best) break;
      picks.push(best);
      counts[best] = (counts[best] || 0) + 1;
      rides++;
      this.savings = 0;
      addedCap += Math.min(16, Math.max(6, BUILDINGS[best].ride.cap)) * 2.4;
      budget -= BUILDINGS[best].cost + 60;
    }
    // Shops by projected demand
    const projGuests = Math.min(80, guests + addedCap * 1.1 + (rides > 0 ? 10 : 0));
    const needFood = rides === 0 ? 0 : Math.max(0, Math.ceil((projGuests - 6) / 20) - foodShops);
    const needDrink = rides === 0 ? 0 : Math.max(0, Math.ceil((projGuests - 14) / 22) - drinkShops);
    for (let i = 0; i < needFood && budget > 300; i++) { picks.push('burger'); budget -= BUILDINGS.burger.cost + 40; }
    for (let i = 0; i < needDrink && budget > 260; i++) { picks.push('soda'); budget -= BUILDINGS.soda.cost + 40; }
    if (projGuests > 30 && funShops === 0 && budget > 300) { picks.push('balloons'); budget -= 300; }
    // Save up for the next attraction instead of frittering the budget away
    const cheapest = 650 + 60;
    if (budget < cheapest && this.shares.econ > 0.12 && g.round < MAX_ROUNDS - 3) {
      this.savings = Math.min(this.team_.money * 0.9, (this.savings || 0) * 0.5 + budget);
      budget = 0;
    } else this.savings = 0;
    // Scenery to lift the rating
    if (park.rating < 82 && budget > 120) {
      const n = Math.min(10, Math.floor(budget / 30));
      for (let i = 0; i < n; i++) picks.push(this.rng.pick(['tree', 'tree', 'pine', 'palm', 'flowers', 'flowers', 'lamp']));
      if (budget > 400 && (counts.statue || 0) < 2 && this.rng.chance(0.4)) picks.push('statue');
    }
    let pri = 1;
    for (const t of picks) this.queue.push({ kind: 'build', type: t, pri: pri++ * 2 + this.rng.next() });
  }

  // Expected income/min from one more attraction of this type: what our existing
  // copies actually earn (learned), blended with a throughput model, plus the
  // entry fees of the extra guests it lets into the park.
  estimateRideIncome(type) {
    const g = this.game;
    const park = this.park;
    const R = BUILDINGS[type].ride;
    let sum = 0, n = 0;
    for (const b of park.buildings) {
      if (b.type !== type || b.ruined) continue;
      const age = (g.time - b.builtAt) / 60;
      if (age < 1.2) continue;
      sum += b.income / age;
      n++;
    }
    const model = R.price * Math.min(R.cap, 16) * (60 / (R.cycle + 6)) * 0.38;
    const learned = n ? sum / n : model;
    const room = Math.max(0.25, 1 - park.guestCount / 80);
    const capBonus = Math.min(16, Math.max(6, R.cap)) * 2.4 * ENTRY_FEE / 4.2 * room;
    return learned * 0.65 + model * 0.35 + capBonus;
  }

  planDefense() {
    const g = this.game;
    let budget = this.budget.defense;
    const park = this.park;
    let n = 0;
    const existing = park.buildings.filter((b) => b.def.combat && !b.ruined).length;
    const maxDef = 2 + g.round * (this.p.defense > 0.2 ? 1.2 : 0.7);
    let pri = 3;
    while (budget > 550 && existing + n < maxDef) {
      const t = this.rng.chance(0.62) ? 'turret' : 'fountain';
      const cost = BUILDINGS[t].cost;
      if (cost > budget) break;
      this.queue.push({ kind: 'build', type: t, defense: true, pri: pri + this.rng.next() });
      pri += 2.5;
      budget -= cost;
      n++;
    }
  }

  // Composition via counter-scoring + role needs.
  planArmy() {
    const g = this.game;
    const A = this.plan;
    let budget = this.budget.army;
    const comp = A.comp;
    const mine = {};
    let supply = 0;
    for (const u of A.myUnits) {
      mine[u.type] = (mine[u.type] || 0) + 1;
      supply += u.def.supply;
    }
    const buys = [];
    const valueOf = (c) => Object.entries(c).reduce((s, [t, n]) => s + n * UNIT_TYPES[t].cost, 0);
    let guard = 0;
    const counterPow = (this.p.counterFocus || 1) * this.d.counter;
    while (guard++ < 80) {
      const all = { ...mine };
      for (const t of buys) all[t] = (all[t] || 0) + 1;
      const totalV = valueOf(all) + 1;
      let frontV = 0, rangedV = 0, meleeCount = 0, supportN = 0, unitsN = 0;
      for (const [t, n] of Object.entries(all)) {
        const d = UNIT_TYPES[t];
        if (FRONT.has(d.role) || d.role === 'heavy') frontV += n * d.cost;
        if (RANGED.has(d.role)) rangedV += n * d.cost;
        if (MELEE.has(d.role)) meleeCount += n;
        if (d.role === 'support') supportN += n;
        unitsN += n;
      }
      let best = null, bs = 0;
      for (const t of UNIT_ORDER) {
        const d = UNIT_TYPES[t];
        if (d.cost > budget || supply + d.supply > SUPPLY_CAP) continue;
        // counter value vs predicted enemy
        let cv = 0;
        for (const [e, sh] of Object.entries(comp)) cv += sh * (EFF[t][e] ?? 1);
        cv = Math.pow(cv, 1 + counterPow);
        let s = cv * (this.p.favorites[t] || 1);
        if (frontV / totalV < 0.3 && (FRONT.has(d.role) || d.role === 'heavy' || d.role === 'melee')) s *= 1.45;
        if (rangedV / totalV < 0.18 && RANGED.has(d.role)) s *= 1.25;
        if (d.role === 'support') s *= supportN < Math.floor(meleeCount / 7) ? 1.2 : 0.05;
        if (t === 'cannonball' && (all.cannonball || 0) >= 2 + Math.floor(unitsN / 8)) s *= 0.1;
        if (t === 'giant') {
          if (g.round < 3 && this.p.id !== 'penny') s *= 0.15;
          if ((all.giant || 0) >= 2) s *= 0.3;
        }
        if (t === 'cannoneer' && (all.cannoneer || 0) >= 2 + Math.floor(frontV / 900)) s *= 0.4;
        s *= 1 / (1 + 0.035 * (all[t] || 0));
        s *= 1 + this.rng.gauss() * this.d.noise;
        if (s > bs) { bs = s; best = t; }
      }
      if (!best) break;
      buys.push(best);
      budget -= UNIT_TYPES[best].cost;
      supply += UNIT_TYPES[best].supply;
    }
    this.pendingBuys = buys;
    // counter taunt: identify the enemy's dominant unit
    let domT = null, domS = 0;
    for (const [t, s] of Object.entries(comp)) if (s > domS) { domS = s; domT = t; }
    if (domT && domS > 0.35 && g.round > 1 && buys.length) {
      let bestC = null, bc = 0;
      const counts = {};
      for (const t of buys) counts[t] = (counts[t] || 0) + 1;
      for (const [t, n] of Object.entries(counts)) {
        const v = (EFF[t][domT] || 1) * n;
        if (v > bc) { bc = v; bestC = t; }
      }
      if (bestC && (EFF[bestC][domT] || 1) > 1.25) this.pendingCounterTaunt = { unit: UNIT_TYPES[domT].name + 's', counter: UNIT_TYPES[bestC].name + 's' };
    }
    // formation for survivors + buys
    const slots = this.formation(A, [...A.myUnits.map((u) => u.type), ...buys]);
    // re-home survivors first (greedy nearest slot by type)
    const used = new Set();
    const takeSlot = (type) => {
      let si = -1;
      for (let i = 0; i < slots.length; i++) if (!used.has(i) && slots[i].type === type) { si = i; break; }
      if (si < 0) return null;
      used.add(si);
      return slots[si];
    };
    for (const u of A.myUnits) {
      const s = takeSlot(u.type);
      if (s) this.queue.push({ kind: 'move', unit: u, lx: s.lx, lz: s.lz, pri: 0.5 });
    }
    let pri = 1.5;
    for (const t of buys) {
      const s = takeSlot(t);
      if (s) this.queue.push({ kind: 'unit', type: t, lx: s.lx, lz: s.lz, pri: pri });
      pri += 1.1;
    }
  }

  // Build formation slots in local coordinates.
  formation(A, types) {
    const g = this.game;
    const comp = A.comp;
    const artilleryThreat = (comp.cannoneer || 0) + (comp.giant || 0) * 0.5;
    const spacing = artilleryThreat > 0.12 ? 2.5 : 1.85;
    // lane: attack where enemy defenses are weakest (hard AIs), random-ish for easy
    const lanes = A.enDef.lanes;
    let lane = 1;
    if (this.rng.next() < this.d.formation) {
      let minV = 1e9;
      for (let i = 0; i < 3; i++) {
        const v = lanes[i] * (1 + this.rng.next() * 0.2) + (i === 1 ? -100 : 0);
        if (v < minV) { minV = v; lane = i; }
      }
    } else lane = this.rng.int(0, 3);
    const laneX = [-18, 0, 18][lane] * (this.team === 0 ? 1 : 1);
    this.lane = lane;
    const groups = { front: [], melee: [], skirm: [], support: [], ranged: [], arty: [], cav: [], cannon: [] };
    for (const t of types) {
      const r = UNIT_TYPES[t].role;
      if (r === 'tank' || r === 'boss') groups.front.push(t);
      else if (r === 'melee' || r === 'heavy') groups.melee.push(t);
      else if (r === 'skirmisher') groups.skirm.push(t);
      else if (r === 'support') groups.support.push(t);
      else if (r === 'ranged') groups.ranged.push(t);
      else if (r === 'artillery') groups.arty.push(t);
      else if (r === 'cavalry') groups.cav.push(t);
      else groups.cannon.push(t);
    }
    const slots = [];
    const park = this.park;
    const free = (lx, lz) => {
      const gx = Math.floor((lx + HALF_W) / TILE), gz = Math.floor((lz - MID) / TILE);
      if (gx < 0 || gx >= GRID_W || gz < 0 || gz >= DEPLOY_ROWS) return false;
      if (park.tiles[gz * GRID_W + gx] > 0) return false;
      for (const s of slots) if ((s.lx - lx) ** 2 + (s.lz - lz) ** 2 < (spacing * 0.8) ** 2) return false;
      return true;
    };
    const place = (list, lz0, perRow, sp, cx = laneX, rowStep = null) => {
      list.sort();
      let row = 0, k = 0;
      while (k < list.length) {
        const n = Math.min(perRow, list.length - k);
        for (let i = 0; i < n; i++) {
          const t = list[k + i];
          const sc = UNIT_TYPES[t].scale;
          let lx = cx + (i - (n - 1) / 2) * sp * Math.max(1, sc * 0.9);
          let lz = lz0 + row * (rowStep || sp) + (sc > 2 ? 1.5 : 0);
          lx = Math.max(-HALF_W + 1.5, Math.min(HALF_W - 1.5, lx));
          lz = Math.max(MID + 1.2, Math.min(MID + DEPLOY_ROWS * TILE - 1.2, lz));
          // nudge if blocked
          let tries = 0;
          while (!free(lx, lz) && tries++ < 16) {
            lx += (tries % 2 ? 1 : -1) * tries * 0.7;
            lz += tries % 3 === 0 ? 0.8 : 0;
            lx = Math.max(-HALF_W + 1.5, Math.min(HALF_W - 1.5, lx));
            lz = Math.min(MID + DEPLOY_ROWS * TILE - 1.2, lz);
          }
          slots.push({ type: t, lx, lz });
        }
        k += n;
        row++;
      }
    };
    const wide = Math.round(12 + (spacing > 2 ? 2 : 0));
    place(groups.front, MID + 2.5, 8, spacing * 1.7);
    place(groups.melee, MID + 5.0, wide, spacing);
    place(groups.skirm, MID + 8.5, 10, spacing * 1.2);
    place(groups.support, MID + 10.5, 6, spacing * 2.5);
    place(groups.ranged, MID + 12.5, 12, spacing);
    place(groups.arty, MID + 17, 8, spacing * 1.8);
    place(groups.cannon, MID + 20.5, 8, spacing * 1.5);
    // cavalry on both flanks
    const cavL = [], cavR = [];
    groups.cav.forEach((t, i) => (i % 2 ? cavR : cavL).push(t));
    const flank = Math.min(HALF_W - 6, Math.abs(laneX) + 20);
    place(cavL, MID + 9, 2, 3.6, laneX - flank * (laneX <= 0 ? 0.6 : 1), 3.6);
    place(cavR, MID + 9, 2, 3.6, laneX + flank * (laneX >= 0 ? 0.6 : 1), 3.6);
    return slots;
  }

  chooseStance() {
    const g = this.game;
    const A = this.plan;
    const myValue = A.myArmyValue + (this.pendingBuys || []).reduce((s, t) => s + UNIT_TYPES[t].cost, 0);
    // effectiveness of my army vs predicted enemy comp
    let eff = 0, wsum = 0;
    const mine = {};
    for (const u of A.myUnits) mine[u.type] = (mine[u.type] || 0) + u.def.cost;
    for (const t of this.pendingBuys || []) mine[t] = (mine[t] || 0) + UNIT_TYPES[t].cost;
    for (const [t, v] of Object.entries(mine)) {
      for (const [e, sh] of Object.entries(A.comp)) {
        eff += v * sh * (EFF[t][e] ?? 1);
        wsum += v * sh;
      }
    }
    eff = wsum ? eff / wsum : 1;
    const myPow = myValue * eff;
    const enPow = A.predicted;
    const attackRatio = (myPow / (enPow + A.enDef.v * 0.4 + 1)) * this.p.aggression;
    const holdRatio = (myPow + A.myDef.v * 0.7) / (enPow + 1);
    const enHist = g.teams[this.enemyTeam].armyHistory;
    const enHeld = enHist.length && enHist[enHist.length - 1].stance === 'hold';
    const iHeld = this.lastStance === 'hold';
    let stance = 'charge';
    if (this.rng.next() < this.d.micro) {
      // defend when outgunned: fight under our turrets and castle fireworks
      if (attackRatio < 0.62) stance = 'hold';
      else if (attackRatio < 0.95 && holdRatio > attackRatio * 1.25) stance = 'hold';
      // don't let the game stall: if both sides sat back last round, push unless badly outmatched
      if (stance === 'hold' && enHeld && iHeld && attackRatio > 0.55) stance = 'charge';
      // mid/late game with no castle progress: the patient ones eventually strike
      if (stance === 'hold' && g.round >= 4 + Math.round(this.p.patience * 2) && attackRatio > 0.6 && this.rng.chance(0.5)) stance = 'charge';
      if (g.round >= MAX_ROUNDS - 2 && A.myCastle <= A.enCastle + 0.05) stance = 'charge';
      if (myValue < 150) stance = 'hold';
    } else if (this.rng.chance(0.3)) stance = 'hold';
    this.lastStance = stance;
    this.queue.push({ kind: 'stance', stance, pri: 50 });
    this.intendedStance = stance;
  }

  // ── Execution ──
  update(dt) {
    const g = this.game;
    if (this.chatCooldown > 0) this.chatCooldown -= dt;
    if (g.phase === 'over') return;
    // Coaster design job runs incrementally
    if (this.coasterJob && g.phase !== 'over') this.stepCoasterJob();
    if (g.phase === 'prep') {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0 && this.queue.length) {
        const a = this.queue.shift();
        this.execute(a);
        this.actionTimer = this.d.delay * (0.6 + this.rng.next() * 0.8);
      }
      // Deadline: slow (easy) AIs flush whatever is left
      if (g.phaseTime < 5 && this.queue.length) {
        let n = 0;
        while (this.queue.length && n++ < 60) this.execute(this.queue.shift());
      }
      // Late top-up: spend leftover income on more units / builds
      if (!this.topUpDone && g.phaseTime < 7 && !this.queue.length) {
        this.topUpDone = true;
        this.topUp();
      }
      if (this.d.peek && !this.peeked && g.phaseTime < 12) {
        this.peeked = true;
        this.peekAdjust();
      }

    } else if (g.phase === 'battle') {
      this.battleTimer -= dt;
      if (this.battleTimer <= 0) {
        this.battleTimer = 1;
        this.battleThink();
      }
    } else if (g.phase === 'results') {
      // opportunistic repairs of defenses
    }
  }

  // Called right before a battle starts: finish every queued action + spend leftovers.
  flushPrep() {
    let n = 0;
    while (this.queue.length && n++ < 200) this.execute(this.queue.shift());
    if (!this.topUpDone) {
      this.topUpDone = true;
      this.topUp();
    }
  }

  execute(a) {
    const g = this.game;
    const park = this.park;
    const team = this.team;
    switch (a.kind) {
      case 'repair':
        if (!a.b.removed && park.repairCost(a.b) <= this.team_.money) park.repair(a.b);
        break;
      case 'build': {
        const spot = this.findSpot(a.type, !!a.defense);
        if (spot) {
          const b = park.place(a.type, spot.gx, spot.gz, spot.rot);
          if (b && this.team_.human === false) b.aiPlaced = true;
        }
        break;
      }
      case 'unit': {
        if (g.teams[team].money < UNIT_TYPES[a.type].cost) break;
        let u = g.deploy(team, a.type, a.lx, a.lz);
        if (!u) {
          // try nearby
          for (let k = 0; k < 10 && !u; k++) {
            const lx = a.lx + this.rng.range(-3, 3), lz = a.lz + this.rng.range(-1.5, 1.5);
            u = g.deploy(team, a.type, lx, lz);
          }
        }
        break;
      }
      case 'move':
        if (a.unit.alive && !a.unit.removed) g.moveUnitHome(a.unit, a.lx, a.lz);
        break;
      case 'stance':
        g.teams[team].stance = a.stance;
        if (this.pendingCounterTaunt) {
          this.say('counter', this.pendingCounterTaunt, true);
          this.pendingCounterTaunt = null;
        } else if (this.rng.chance(0.35)) this.say(a.stance === 'hold' ? 'hold' : 'charge');
        break;
    }
  }

  topUp() {
    const g = this.game;
    const money = this.team_.money;
    if (money < 150) return;
    // Spend most leftover on units according to the same scoring, keep a small reserve
    const saveBudget = this.budget;
    this.budget = { econ: 0, defense: 0, army: Math.max(0, money - 250 - (this.savings || 0) - (this.coasterJob ? this.coasterReserve || 0 : 0)) };
    const before = this.queue.length;
    this.plan = this.analyze();
    this.planArmyTopUp();
    this.budget = saveBudget;
    let n = 0;
    while (this.queue.length && n++ < 40) this.execute(this.queue.shift());
  }

  planArmyTopUp() {
    // like planArmy but only adds new units around the existing formation
    const A = this.plan;
    const g = this.game;
    let budget = this.budget.army;
    let supply = g.supplyUsed(this.team);
    const comp = A.comp;
    const all = {};
    for (const u of A.myUnits) all[u.type] = (all[u.type] || 0) + 1;
    const counterPow = (this.p.counterFocus || 1) * this.d.counter;
    for (let k = 0; k < 30; k++) {
      let best = null, bs = 0;
      for (const t of UNIT_ORDER) {
        const d = UNIT_TYPES[t];
        if (d.cost > budget || supply + d.supply > SUPPLY_CAP) continue;
        if (t === 'giant' && g.round < 3) continue;
        if (d.role === 'support' && (all.ringmaster || 0) >= 2) continue;
        let cv = 0;
        for (const [e, sh] of Object.entries(comp)) cv += sh * (EFF[t][e] ?? 1);
        let s = Math.pow(cv, 1 + counterPow) * (this.p.favorites[t] || 1) / (1 + 0.05 * (all[t] || 0));
        s *= 1 + this.rng.gauss() * this.d.noise;
        if (s > bs) { bs = s; best = t; }
      }
      if (!best) break;
      // position: behind/around existing units of the same role
      const role = UNIT_TYPES[best].role;
      const rowZ = { tank: 2.5, boss: 3, melee: 5, heavy: 5, skirmisher: 8.5, support: 10.5, ranged: 12.5, artillery: 17, assassin: 20.5, cavalry: 9 }[role] ?? 8;
      const laneX = [-18, 0, 18][this.lane];
      let placed = false;
      for (let tries = 0; tries < 20 && !placed; tries++) {
        const lx = laneX + this.rng.range(-16, 16), lz = MID + rowZ + this.rng.range(-1, 2.5);
        if (g.canDeploy(this.team, best, lx, lz).ok) {
          this.queue.push({ kind: 'unit', type: best, lx, lz, pri: 0 });
          placed = true;
        }
      }
      if (!placed) break;
      budget -= UNIT_TYPES[best].cost;
      supply += UNIT_TYPES[best].supply;
      all[best] = (all[best] || 0) + 1;
    }
  }

  peekAdjust() {
    // Brutal: shift toward counters of what the player actually deployed with remaining money
    this.plan = this.analyze();
  }

  battleThink() {
    const g = this.game;
    if (!g.battleStarted) return;
    const me = this.team, en = this.enemyTeam;
    let myV = 0, enV = 0, myIn = 0, n = 0;
    for (const u of g.units[me]) if (u.alive) {
      myV += u.def.cost * u.hp / u.maxHp;
      n++;
      if (u.z * sgn(me) < 0) myIn++;
    }
    for (const u of g.units[en]) if (u.alive) enV += u.def.cost * u.hp / u.maxHp;
    const stance = g.teams[me].stance;
    const taken = g.teams[me].recentTaken || 0, dealt = g.teams[en].recentTaken || 0;
    if (g.time - this.lastStanceChange < 6) return;
    if (stance === 'hold' && taken > 120 && taken > dealt * 2.5 && myV > enV * 0.6 && this.rng.next() < this.d.micro) {
      // we're being shelled from outside our lines: go get them
      g.teams[me].stance = 'charge';
      this.lastStanceChange = g.time;
      this.say('charge');
      return;
    }
    if (this.rng.next() > this.d.micro) return;
    if (enV === 0 && stance !== 'charge' && myV > 0) {
      g.teams[me].stance = 'charge';
      this.lastStanceChange = g.time;
      this.say('charge');
    } else if (stance === 'charge' && myV < enV * 0.45 && enV > 400) {
      // fall back to our defenses
      g.teams[me].stance = 'hold';
      this.lastStanceChange = g.time;
      this.say('hold');
    } else if (stance === 'hold' && myV > enV * 1.6 + 300) {
      g.teams[me].stance = 'charge';
      this.lastStanceChange = g.time;
      this.say('charge');
    }
    // castle chatter
    const myCastle = g.parks[me].castle, enCastle = g.parks[en].castle;
    if (myCastle.lastHit > g.time - 1.2 && this.rng.chance(0.08)) this.say('castleHit');
    if (enCastle.lastHit > g.time - 1.2 && this.rng.chance(0.08)) this.say('hitYou');
  }

  onBattleStart() {
    this.battleTimer = 2;
  }
  onBattleEnd(res) {
    const g = this.game;
    const en = this.enemyTeam;
    // remember surviving enemy army
    const comp = {};
    let value = 0;
    for (const u of g.units[en]) if (u.alive) {
      comp[u.type] = (comp[u.type] || 0) + 1;
      value += u.def.cost * (0.5 + 0.5 * Math.min(1, (u.hp + (u.maxHp - u.hp) * 0.6) / u.maxHp));
    }
    // estimate the enemy's army spending share
    const hist = g.teams[en].armyHistory;
    const last = hist[hist.length - 1];
    if (last) {
      const growth = last.value - this.memory.enemySurvivors.value;
      const inc = Math.max(300, this.memory.lastIncome * 2.0);
      const share = Math.max(0.15, Math.min(1.2, growth / inc));
      this.memory.armyShare = this.memory.armyShare * 0.6 + share * 0.4;
    }
    this.memory.enemySurvivors = { comp, value };
    this.memory.lastIncome = g.incomePerMinute(en);
    if (res.winner === this.team) this.memory.roundsWon++;
    else if (res.winner === en) this.memory.roundsLost++;
    if (res.castleDmg[this.team] > 600) this.say('castleHit', {}, true);
    else if (res.castleDmg[en] > 600) this.say('hitYou', {}, true);
  }

  onGameOver(winner) {
    this.say(winner === this.team ? 'win' : 'lose', {}, true);
  }

  // ── Coaster design job (incremental so it never hitches the frame) ──
  stepCoasterJob() {
    const job = this.coasterJob;
    const g = this.game;
    if (!job.stations) {
      job.stations = stationCandidates(this.park, this.rng, 24);
      if (!job.stations.length) {
        this.coasterJob = null;
        return;
      }
    }
    for (let k = 0; k < 3 && job.tries < job.max; k++, job.tries++) {
      const st = job.stations[job.tries % job.stations.length];
      let nodes = generateNodes(st, this.rng, job.style);
      if (!nodes) continue;
      let d = designTrack(g, this.team, st, nodes);
      for (let fix = 0; fix < 2 && !d.valid && /hits/.test(d.reason); fix++) {
        nodes = repairDesign(g, this.team, st, nodes, d);
        d = designTrack(g, this.team, st, nodes);
      }
      if (!d.valid || d.cost > job.budget) continue;
      const sc = scoreDesign(d, { econ: 1, defense: this.p.defense * 2.5 });
      if (!job.best || sc > job.best.score) job.best = { d, st, nodes, score: sc };
    }
    if (job.tries >= job.max) {
      this.coasterJob = null;
      this.coasterReserve = 0;
      if (job.best && this.team_.money >= job.best.d.cost + 100) {
        const r = g.buildCoaster(this.team, { gx: job.best.st.gx, gz: job.best.st.gz, rot: job.best.st.rot }, job.best.nodes);
        if (r.ok) {
          const names = ['The Vortex', 'Screamin\' Eagle', 'Gutbuster', 'Loop-de-Doom', 'The Plunger', 'Thunder Mop', 'Big Wobbler', 'Sky Snake', 'Nausea Express', 'Wild Whirl'];
          r.coaster.name = this.rng.pick(names);
          this.say('coaster', { name: r.coaster.name, E: r.coaster.stats.excitement.toFixed(1), price: r.coaster.price }, true);
        }
      }
    }
  }

  // ── Placement search ──
  findSpot(type, defensive) {
    const park = this.park;
    const def = BUILDINGS[type];
    const g = this.game;
    const cands = [];
    const scenery = def.cat === 'scenery';
    // distance-to-path map (BFS over empty park tiles from path tiles)
    const distMap = this._pathDist();
    const lanes = this.plan ? this.plan.myDef.lanes : [0, 0, 0];
    const threatLane = this.memory.enemyEntries;
    for (let rot = 0; rot < (def.w === def.d ? 1 : 4); rot++) {
      const [W, D] = rotatedSize(def, rot);
      const gzMin = defensive ? 4 : DEPLOY_ROWS;
      const gzMax = defensive ? DEPLOY_ROWS + 5 : TERR_ROWS - D - 2;
      for (let gz = gzMin; gz <= gzMax; gz++) {
        for (let gx = 0; gx <= GRID_W - W; gx++) {
          let ok = true;
          for (let j = gz; j < gz + D && ok; j++)
            for (let i = gx; i < gx + W; i++) if (park.tiles[j * GRID_W + i] !== 0) { ok = false; break; }
          if (!ok) continue;
          let score = 0;
          const cxT = gx + W / 2, czT = gz + D / 2;
          if (scenery) {
            // next to paths, near rides
            const k = Math.floor(czT) * GRID_W + Math.floor(cxT);
            const pd = distMap[k];
            if (pd !== 1) continue;
            score = 10 - Math.abs(czT - 26) * 0.05 + this.rng.next() * 4;
          } else if (defensive) {
            // front rows, cover lanes with threat, spread out
            const lx = -HALF_W + cxT * TILE;
            const laneIdx = lx < -16 ? 0 : lx > 16 ? 2 : 1;
            const thr = threatLane[laneIdx] / (threatLane[0] + threatLane[1] + threatLane[2]);
            score = 20 - Math.abs(gz - (DEPLOY_ROWS - 1)) * 1.2 + thr * 12 - lanes[laneIdx] / 400 + this.rng.next() * 3;
            // don't hug other defenses
            for (const b of park.buildings) if (b.def.combat) {
              const dd = Math.hypot(b.gx - gx, b.gz - gz);
              if (dd < 5) score -= (5 - dd) * 2;
            }
          } else {
            const [ex, ez] = entranceTile(gx, gz, W, D, rot);
            if (!inPark(ex, ez)) continue;
            const pd = distMap[ez * GRID_W + ex];
            if (pd > 6) continue;
            score = 20 - pd * 2.2;
            // combat rides like the front; others prefer the safer middle/back
            if (def.combat) score += Math.max(0, 8 - Math.abs(gz - (DEPLOY_ROWS + 2))) * (1 + this.p.defense * 2);
            else score -= Math.max(0, DEPLOY_ROWS + 4 - gz) * 1.5;
            // keep the boulevard clear-ish: small penalty close to the castle
            score -= Math.max(0, 6 - Math.hypot(cxT - 24, czT - 30)) * 0.5;
            score += this.rng.next() * 3;
          }
          cands.push({ gx, gz, rot, score });
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(14, cands.length); i++) {
      const c = cands[i];
      const chk = park.canPlace(type, c.gx, c.gz, c.rot);
      if (chk.ok && chk.cost <= this.team_.money) return c;
    }
    return null;
  }

  _pathDist() {
    const park = this.park;
    const N = GRID_W * TERR_ROWS;
    const dist = new Int16Array(N).fill(99);
    const q = [];
    for (let k = 0; k < N; k++) if (park.tiles[k] === -1) { dist[k] = 0; q.push(k); }
    let h = 0;
    while (h < q.length) {
      const k = q[h++];
      const i = k % GRID_W, j = (k / GRID_W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GRID_W || nj >= TERR_ROWS) continue;
        const nk = nj * GRID_W + ni;
        if (dist[nk] <= dist[k] + 1 || park.tiles[nk] > 0) continue;
        dist[nk] = dist[k] + 1;
        q.push(nk);
      }
    }
    return dist;
  }

  // Track where enemy units entered our land (for defense lanes)
  noteIntrusion(lx) {
    const i = lx < -16 ? 0 : lx > 16 ? 2 : 1;
    this.memory.enemyEntries[i] += 1;
  }
}
