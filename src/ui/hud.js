// ─────────────────────────────────────────────────────────────────────────────
//  In-game HUD: top bar, build dock, ready/stance box, info + scouting panels,
//  chat feed, banners, floaters, guest thoughts, minimap, tooltips.
// ─────────────────────────────────────────────────────────────────────────────
import { h, clear, stars } from './dom.js';
import { UNIT_TYPES, UNIT_ORDER, BUILDINGS, BUILD_MENU, SUPPLY_CAP, CASTLE_HP, TEAM_COLORS, PATH_COST, HALF_W, PARK_LZ1, MID, DEPLOY_ROWS, TILE, MAX_ROUNDS, COASTER, BARRAGE } from '../config.js';
import { fmtMoney, fmtTime } from '../util/math.js';

const TABS = [
  { id: 'army', icon: '⚔️', label: 'Army' },
  { id: 'rides', icon: '🎠', label: 'Rides' },
  { id: 'coaster', icon: '🎢', label: 'Coasters' },
  { id: 'shops', icon: '🍔', label: 'Shops' },
  { id: 'defense', icon: '🛡️', label: 'Defense' },
  { id: 'scenery', icon: '🌳', label: 'Scenery' },
  { id: 'paths', icon: '🛤️', label: 'Paths' },
  { id: 'manage', icon: '🔧', label: 'Manage' },
];

export class HUD {
  constructor(app, game, opts) {
    this.app = app;
    this.game = game;
    this.spectator = !!opts.spectator;
    this.me = 0;
    this.root = h('div', { id: 'hud' });
    app.ui.appendChild(this.root);
    this.tab = 'army';
    this.selected = null;
    this.floaters = [];
    this.thoughts = [];
    this.buildTop();
    if (!this.spectator) {
      this.buildDock();
      this.buildReady();
      this.buildScout();
    } else {
      this.buildSpectatorBar();
    }
    this.buildFeed();
    this.buildInfo();
    this.buildMinimap();
    this.tooltip = h('div', { class: 'tooltip hidden' });
    this.cursorHint = h('div', { class: 'cursorhint hidden' });
    this.pauseBadge = h('div', { class: 'pausebadge hidden' }, 'PAUSED');
    this.root.append(this.tooltip, this.cursorHint, this.pauseBadge);
    this.lastUpdate = 0;
    this.moneyShown = game.teams[0].money;
  }
  destroy() {
    this.root.remove();
  }

  // ── Top bar ──
  buildTop() {
    const g = this.game;
    const bar = h('div', { class: 'topbar' });
    this.myStats = h('div', { class: 'panel stats' });
    this.elMoney = h('div', { class: 'v' });
    this.elInc = h('div', { class: 'inc' });
    this.elGuests = h('div', { class: 'v' });
    this.elRating = h('div', { class: 'v' });
    this.elStars = h('div', { class: 'stars' });
    const t0 = g.teams[0];
    this.myStats.append(
      h('div', { class: 'stat money' }, this.elMoney, h('div', { class: 'l' }, this.spectator ? t0.name : 'Money'), this.elInc),
      h('div', { class: 'stat' }, this.elGuests, h('div', { class: 'l' }, 'Guests')),
      h('div', { class: 'stat' }, this.elRating, this.elStars),
    );
    const center = h('div', { class: 'panel center' });
    this.elRound = h('span', { class: 'round' });
    this.elPhase = h('span', { class: 'name' });
    this.elTimer = h('span', { class: 'timer' });
    this.cb0 = this.castleBar(0);
    this.cb1 = this.castleBar(1);
    center.append(h('div', { class: 'phase' }, this.elRound, this.elPhase, this.elTimer), h('div', { class: 'castles' }, this.cb0.el, h('div', { class: 'vs' }, 'VS'), this.cb1.el));
    const right = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' } });
    this.ctrl = h('div', { class: 'panel controls' });
    const sp = (label, val, title) => {
      const b = h('button', { class: 'ibtn', title, onclick: () => this.app.setSpeed(val) }, label);
      b.dataset.speed = val;
      return b;
    };
    this.speedBtns = [sp('⏸', 0, 'Pause (Space)'), sp('1×', 1, 'Normal speed (1)'), sp('2×', 2, 'Fast (2)'), sp('3×', 3, 'Faster (3)'), sp('🐢', 0.3, 'Slow motion (4)')];
    this.ctrl.append(...this.speedBtns, h('button', { class: 'ibtn', title: 'Settings', onclick: () => this.app.showSettings() }, '⚙'), h('button', { class: 'ibtn', title: 'Menu (Esc)', onclick: () => this.app.showPauseMenu() }, '☰'));
    const t1 = g.teams[1];
    const ai = g.ai[1];
    this.rivalCard = h('div', { class: 'panel rivalcard' },
      h('div', { class: 'av' }, ai ? ai.p.avatar : '🙂'),
      h('div', {}, h('div', { class: 'nm', style: { color: ai ? ai.p.color : '#fff' } }, t1.name), (this.elRival = h('div', { class: 'sm' }))),
    );
    right.append(this.ctrl, this.rivalCard);
    bar.append(this.myStats, center, right);
    this.root.appendChild(bar);
  }
  castleBar(team) {
    const g = this.game;
    const fill = h('div', { class: 'fill' });
    const val = h('span');
    const el = h('div', { class: 'cbar ' + (team === 0 ? 'b' : 'r') }, h('div', { class: 'nm' }, h('span', {}, '🏰 ' + g.teams[team].parkName), val), h('div', { class: 'track' }, fill));
    return { el, fill, val };
  }

  // ── Dock ──
  buildDock() {
    this.dock = h('div', { class: 'dock' });
    this.tabsEl = h('div', { class: 'panel tabs' });
    for (const t of TABS) {
      const b = h('button', { class: 'tab', onclick: () => this.setTab(t.id) }, h('span', {}, t.icon), t.label);
      b.dataset.tab = t.id;
      this.tabsEl.appendChild(b);
    }
    this.itemsEl = h('div', { class: 'panel items' });
    this.dock.append(this.itemsEl, this.tabsEl);
    this.root.appendChild(this.dock);
    this.setTab('army');
  }
  setTab(id) {
    this.tab = id;
    for (const b of this.tabsEl.children) b.classList.toggle('sel', b.dataset.tab === id);
    this.renderItems();
    this.app.tools.cancel();
  }
  renderItems() {
    const g = this.game;
    this.hideTip();
    const el = clear(this.itemsEl);
    const money = g.teams[0].money;
    const tools = this.app.tools;
    const card = (icon, name, cost, onClick, tip, sel, extra = {}) => {
      const c = h('div', { class: 'item' + (sel ? ' sel' : '') + (extra.off ? ' off' : ''), onclick: onClick },
        h('div', { class: 'ic' }, icon), h('div', { class: 'nm' }, name),
        cost !== null ? h('div', { class: 'cost' + (cost > money ? ' no' : '') }, cost === 0 ? 'FREE' : fmtMoney(cost)) : null,
        extra.badge ? h('div', { class: 'badge' }, extra.badge) : null,
        extra.count ? h('div', { class: 'count' }, extra.count) : null,
      );
      if (tip) {
        c.addEventListener('mouseenter', (e) => this.showTip(tip, c));
        c.addEventListener('mouseleave', () => this.hideTip());
      }
      el.appendChild(c);
      return c;
    };
    if (this.tab === 'army') {
      const counts = {};
      for (const u of g.units[0]) if (u.alive) counts[u.type] = (counts[u.type] || 0) + 1;
      for (const t of UNIT_ORDER) {
        const d = UNIT_TYPES[t];
        card(d.icon, d.name, d.cost, () => tools.selectUnit(t), () => this.unitTip(t), tools.tool === 'unit' && tools.unitType === t, { badge: '⚑' + d.supply, count: counts[t] ? '×' + counts[t] : '', off: g.phase !== 'prep' });
      }
    } else if (this.tab === 'coaster') {
      card('✏️', 'Design coaster', COASTER.stationCost, () => tools.startCoaster(), () => ({ title: 'Roller Coaster', desc: 'Place a station, then click to lay track nodes. Shift+Wheel (or Z/X) sets height. Low track in your yard flattens invaders! Use Auto-Design for instant thrills.', stats: [['Station', fmtMoney(COASTER.stationCost)], ['Track', '$' + COASTER.costPerMeter + '/m'], ['HP', COASTER.hp]] }), tools.tool && tools.tool.startsWith('coaster'));
      for (const c of g.coasters.filter((c) => c.team === 0)) {
        card('🎢', c.name || 'Coaster', null, () => { this.app.view.rig.setRide(c); }, () => ({ title: c.name || 'Coaster', desc: 'Click to ride it!', stats: [['Excitement', c.stats.excitement.toFixed(1)], ['Intensity', c.stats.intensity.toFixed(1)], ['Nausea', c.stats.nausea.toFixed(1)], ['Top speed', Math.round(c.stats.kmh) + ' km/h'], ['Ticket', '$' + c.price], ['Earned', fmtMoney(c.building.income)]] }), false, { badge: '🎥' });
      }
    } else if (this.tab === 'paths') {
      card('🛤️', 'Path', PATH_COST, () => tools.selectPath(false), () => ({ title: 'Path', desc: 'Click and drag to lay paths. Guests only walk on paths. Rides auto-connect.', stats: [['Cost', '$' + PATH_COST + ' / tile']] }), tools.tool === 'path');
      card('🚫', 'Remove path', 0, () => tools.selectPath(true), () => ({ title: 'Remove path', desc: 'Click and drag to remove path tiles.' }), tools.tool === 'unpath');
    } else if (this.tab === 'manage') {
      card('🔨', 'Demolish', 0, () => tools.selectDemolish(), () => ({ title: 'Demolish', desc: 'Remove a building for a 50% refund.' }), tools.tool === 'demolish');
      card('🔧', 'Repair', null, () => tools.selectRepair(), () => ({ title: 'Repair', desc: 'Click a damaged or wrecked attraction to repair it.' }), tools.tool === 'repair');
      const park = g.parks[0];
      const names = ['Cheap', 'Fair', 'Greedy'];
      const icons = ['🪙', '💵', '💰'];
      for (let i = 0; i < 3; i++) {
        card(icons[i], names[i] + ' prices', null, () => { park.pricing = i; this.renderItems(); }, () => ({ title: names[i] + ' prices', desc: ['Low prices: more happy guests, less money per ride.', 'Balanced pricing.', 'Gouge your guests: +45% per ticket, but they leave sooner.'][i] }), park.pricing === i);
      }
    } else {
      const list = BUILD_MENU[this.tab] || [];
      for (const t of list) {
        const d = BUILDINGS[t];
        card(d.icon, d.name, d.cost, () => tools.selectBuild(t), () => this.buildTip(t), tools.tool === 'build' && tools.buildType === t);
      }
    }
  }
  unitTip(t) {
    const d = UNIT_TYPES[t];
    const a = d.attack;
    const stats = [['Cost', fmtMoney(d.cost)], ['Supply', d.supply], ['Health', d.hp], ['Speed', d.speed + ' m/s']];
    if (a.kind === 'melee') stats.push(['Damage', a.damage + (a.splash ? ' (splash)' : '')], ['Reach', a.reach + ' m']);
    else if (a.kind === 'ram') stats.push(['Ram dmg', a.damage]);
    else stats.push(['Damage', a.damage + (a.splash ? ' (splash)' : '')], ['Range', a.range + ' m']);
    if (d.launch) stats.push(['Launch', d.launch.range + ' m, ' + d.launch.damage + ' dmg']);
    return { title: d.icon + ' ' + d.name, desc: d.desc, stats };
  }
  buildTip(t) {
    const d = BUILDINGS[t];
    const stats = [['Cost', fmtMoney(d.cost)], ['Size', d.w + '×' + d.d], ['HP', d.hp]];
    if (d.ride) stats.push(['Excitement', d.ride.E], ['Intensity', d.ride.I], ['Nausea', d.ride.N], ['Capacity', d.ride.cap], ['Ticket', '$' + d.ride.price]);
    if (d.shop) stats.push(['Sells', { hunger: 'Food', thirst: 'Drinks', fun: 'Balloons' }[d.shop.need]], ['Price', '$' + d.shop.price]);
    if (d.combat) stats.push(['Combat', { swing: 'Hull smash', shockwave: 'Shockwave', cannon: 'Guest artillery', turret: 'Popcorn lobs', jets: 'Water jets' }[d.combat.type]]);
    if (d.scenery) stats.push(['Scenery', '+' + d.scenery]);
    if (d.upkeep) stats.push(['Upkeep', '$' + d.upkeep + '/min']);
    return { title: d.icon + ' ' + d.name, desc: d.desc, stats };
  }
  showTip(fn, anchor) {
    const t = typeof fn === 'function' ? fn() : fn;
    clear(this.tooltip);
    this.tooltip.append(h('b', {}, t.title), h('div', { class: 'd' }, t.desc || ''));
    if (t.stats) {
      const gdiv = h('div', { class: 'g' });
      for (const [k, v] of t.stats) gdiv.append(h('span', { style: { color: 'var(--muted)' } }, k), h('span', {}, String(v)));
      this.tooltip.appendChild(gdiv);
    }
    this.tooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    this.tooltip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    this.tooltip.style.top = Math.max(8, r.top - th - 10) + 'px';
  }
  hideTip() {
    if (this.tooltip) this.tooltip.classList.add('hidden');
  }

  buildReady() {
    const g = this.game;
    this.readyBox = h('div', { class: 'panel readybox' });
    this.stanceBtns = {};
    const st = h('div', { class: 'stance' });
    for (const [id, label, tip] of [['charge', '⚔️ Charge', 'Attack the enemy park'], ['hold', '🛡️ Hold', 'Defend your land under your turrets']]) {
      const b = h('button', { title: tip, onclick: () => { g.teams[0].stance = id; this.updateStance(); this.app.audio.ui('click'); } }, label);
      this.stanceBtns[id] = b;
      st.appendChild(b);
    }
    this.supplyEl = h('div', { class: 'supply' });
    this.readyBtn = h('button', { class: 'btn big readybtn', onclick: () => this.app.ready() }, 'READY!');
    this.barrageBtn = h('button', { class: 'btn red hidden', title: 'Once per battle: the castle rains fireworks on a spot you pick (B)', onclick: () => this.app.tools.selectBarrage() }, `🎆 Fireworks barrage ${fmtMoney(BARRAGE.cost)}`);
    this.readyBox.append(h('div', { style: { fontSize: '11px', fontWeight: 900, color: 'var(--muted)', letterSpacing: '1px' } }, 'ARMY ORDERS'), st, this.supplyEl, this.barrageBtn, this.readyBtn);
    this.root.appendChild(this.readyBox);
    this.updateStance();
  }
  updateStance() {
    const s = this.game.teams[0].stance;
    for (const [id, b] of Object.entries(this.stanceBtns)) b.classList.toggle('sel', id === s);
  }

  buildSpectatorBar() {
    const g = this.game;
    this.specBox = h('div', { class: 'panel readybox' },
      h('div', { style: { fontFamily: 'var(--display)', fontSize: '18px' } }, '👀 Spectating'),
      h('div', { style: { fontSize: '12px', color: 'var(--muted)', fontWeight: 700 } }, 'Director cam is on. Drag / WASD to take over, press V to hand it back.'),
      h('button', { class: 'btn blue', onclick: () => { this.app.view.rig.mode = 'director'; } }, '🎬 Director cam'),
    );
    this.root.appendChild(this.specBox);
  }

  buildScout() {
    this.scoutEl = h('div', { class: 'panel scout hidden' });
    this.root.appendChild(this.scoutEl);
  }
  renderScout() {
    const g = this.game;
    const el = clear(this.scoutEl);
    const hist = g.teams[1].armyHistory;
    const last = hist[hist.length - 1];
    el.append(h('h5', {}, '🔭 Scouting Report'));
    if (!last) {
      el.append(h('div', { class: 'note' }, 'No intel yet. The rival army is hidden until the battle horn. Expect anything!'));
    } else {
      const army = h('div', { class: 'army' });
      for (const [t, n] of Object.entries(last.comp)) army.append(h('span', { class: 'chip', title: UNIT_TYPES[t].name }, UNIT_TYPES[t].icon, '×' + n));
      if (!Object.keys(last.comp).length) army.append(h('span', { class: 'chip' }, 'nobody!'));
      el.append(h('div', { class: 'note', style: { marginTop: 0 } }, 'Last battle they fielded:'), army);
      const def = g.parks[1].buildings.filter((b) => b.def.combat && !b.ruined).length;
      el.append(h('div', { class: 'note' }, `Park: ${def} defensive rides, ${g.coasters.filter((c) => c.team === 1).length} coaster(s). Stance last time: ${last.stance === 'hold' ? '🛡️ holding' : '⚔️ charging'}.`));
    }
  }

  buildFeed() {
    this.feed = h('div', { class: 'feed' });
    this.root.appendChild(this.feed);
  }
  push(text, opts = {}) {
    const m = h('div', { class: 'msg ' + (opts.kind || '') });
    if (opts.who) m.append(h('div', { class: 'who', style: { color: opts.color || 'var(--gold)' } }, opts.who));
    m.append(h('div', {}, text));
    this.feed.appendChild(m);
    while (this.feed.children.length > 6) this.feed.removeChild(this.feed.firstChild);
    setTimeout(() => m.classList.add('fade'), opts.life || 9000);
    setTimeout(() => m.remove(), (opts.life || 9000) + 700);
  }
  banner(title, sub = '', life = 2200) {
    if (this.bannerEl) this.bannerEl.remove();
    const b = h('div', { class: 'banner passthru' }, h('div', { class: 't' }, title), sub ? h('div', { class: 's' }, sub) : null);
    this.root.appendChild(b);
    this.bannerEl = b;
    setTimeout(() => b.classList.add('out'), life);
    setTimeout(() => b.remove(), life + 600);
  }

  // ── Info panel (selection) ──
  buildInfo() {
    this.infoEl = h('div', { class: 'panel info hidden' });
    this.root.appendChild(this.infoEl);
  }
  select(obj) {
    this.selected = obj;
    this.renderInfo();
  }
  renderInfo() {
    const o = this.selected;
    const el = this.infoEl;
    if (!o || o.removed) {
      el.classList.add('hidden');
      this.selected = null;
      return;
    }
    el.classList.remove('hidden');
    clear(el);
    const g = this.game;
    const meter = (label, v, max, color) => [h('span', {}, label), h('div', { class: 'meter' }, h('div', { style: { width: Math.min(100, (v / max) * 100) + '%', background: color } })), h('span', {}, typeof v === 'number' ? (max === 10 ? v.toFixed(1) : Math.round(v)) : v)];
    if (o.isBuilding) {
      const b = o;
      const mine = b.team === 0 && !this.spectator;
      const name = b.coaster ? b.coaster.name || 'Roller Coaster' : b.def.name;
      el.append(h('h4', {}, (b.coaster ? '🎢 ' : b.def.icon + ' ') + name), h('div', { class: 'sub' }, (b.team === 0 ? g.teams[0].parkName : g.teams[1].parkName) + (b.ruined ? ' · WRECKED' : '')));
      const ms = h('div', { class: 'meters' });
      ms.append(...meter('HP', Math.max(0, b.hp), b.maxHp, b.hp / b.maxHp > 0.5 ? '#5cff8a' : b.hp / b.maxHp > 0.25 ? '#ffd23f' : '#ff5d5d'));
      const R = b.coaster ? b.coaster.stats : b.def.ride ? { excitement: b.def.ride.E, intensity: b.def.ride.I, nausea: b.def.ride.N } : null;
      if (R) {
        ms.append(...meter('Excitement', R.excitement, 10, '#ffd23f'), ...meter('Intensity', R.intensity, 10, '#ff8a3d'), ...meter('Nausea', R.nausea, 10, '#8dff8a'));
      }
      el.appendChild(ms);
      if (b.coaster) {
        const s = b.coaster.stats;
        el.append(h('div', { class: 'kv' }, h('span', {}, 'Top speed'), h('span', {}, Math.round(s.kmh) + ' km/h')), h('div', { class: 'kv' }, h('span', {}, 'Length / drop'), h('span', {}, Math.round(s.length) + ' m / ' + Math.round(s.maxDrop) + ' m')));
      }
      if (b.def.ride || b.coaster || b.def.shop) {
        el.append(h('div', { class: 'kv' }, h('span', {}, 'Customers'), h('span', {}, b.customers)), h('div', { class: 'kv' }, h('span', {}, 'Earned'), h('span', { style: { color: 'var(--green)' } }, fmtMoney(b.income))));
        if (b.ride) el.append(h('div', { class: 'kv' }, h('span', {}, 'Queue'), h('span', {}, b.ride.queue.length + ' guests')));
      }
      if (b.def.combat) el.append(h('div', { class: 'kv' }, h('span', {}, 'Battle role'), h('span', {}, { swing: 'Hull smash', shockwave: 'Shockwave', cannon: 'Guest artillery', turret: 'Popcorn lobs', jets: 'Water jets' }[b.def.combat.type])));
      if (b.type === 'castle') el.append(h('div', { class: 'kv' }, h('span', {}, 'Defense'), h('span', {}, '🎆 Firework battery')));
      const btns = h('div', { class: 'btns' });
      if (b.coaster) btns.append(h('button', { class: 'btn blue', onclick: () => this.app.view.rig.setRide(b.coaster) }, '🎥 Ride it'));
      if (mine && b.type !== 'castle' && b.type !== 'gate') {
        const rc = g.parks[0].repairCost(b);
        if (rc > 0) btns.append(h('button', { class: 'btn green', onclick: () => { if (g.parks[0].repair(b)) this.app.audio.ui('build'); this.renderInfo(); } }, '🔧 Repair ' + fmtMoney(rc)));
        btns.append(h('button', { class: 'btn red', onclick: () => { g.parks[0].demolish(b); this.app.audio.ui('demolish'); this.select(null); } }, '🔨 ' + (b.ruined ? 'Clear' : 'Sell')));
      }
      if (btns.children.length) el.appendChild(btns);
    } else {
      const u = o;
      const d = u.def;
      el.append(h('h4', {}, d.icon + ' ' + d.name), h('div', { class: 'sub', style: { color: TEAM_COLORS[u.team].css } }, g.teams[u.team].name + (u.alive ? '' : ' · knocked out')));
      const ms = h('div', { class: 'meters' });
      ms.append(...meter('HP', Math.max(0, u.hp), u.maxHp, '#5cff8a'));
      el.append(ms, h('div', { class: 'kv' }, h('span', {}, 'Damage dealt'), h('span', {}, Math.round(u.stats.dmg))), h('div', { class: 'kv' }, h('span', {}, 'Knockouts'), h('span', {}, u.stats.kills)), h('div', { class: 'note', style: { fontSize: '12px', color: 'var(--muted)', marginTop: '6px', fontWeight: 700 } }, d.desc));
      const btns = h('div', { class: 'btns' }, h('button', { class: 'btn blue', onclick: () => this.app.view.rig.setFollow(u) }, '🎥 Follow'));
      if (u.team === 0 && !this.spectator && g.phase === 'prep' && u.alive) btns.append(h('button', { class: 'btn red', onclick: () => { g.removeUnit(u); this.select(null); this.app.audio.ui('demolish'); } }, '✖ Dismiss'));
      el.appendChild(btns);
    }
  }

  // ── Minimap ──
  buildMinimap() {
    const W = 96, H = Math.round(96 * ((PARK_LZ1 * 2 + 10) / (HALF_W * 2 + 10)));
    this.mm = h('canvas', { width: W, height: H });
    this.mmBox = h('div', { class: 'panel minimap' }, this.mm);
    this.root.appendChild(this.mmBox);
    this.mmW = W;
    this.mmH = H;
    this.mm.addEventListener('pointerdown', (e) => {
      const r = this.mm.getBoundingClientRect();
      const [x, z] = this.mmToWorld(e.clientX - r.left, e.clientY - r.top);
      this.app.view.rig.focus(x, z);
    });
  }
  worldToMM(x, z) {
    const sx = this.mmW / (HALF_W * 2 + 10), sz = this.mmH / (PARK_LZ1 * 2 + 10);
    return [(x + HALF_W + 5) * sx, (z + PARK_LZ1 + 5) * sz];
  }
  mmToWorld(px, py) {
    const sx = this.mmW / (HALF_W * 2 + 10), sz = this.mmH / (PARK_LZ1 * 2 + 10);
    return [px / sx - HALF_W - 5, py / sz - PARK_LZ1 - 5];
  }
  drawMinimap() {
    const c = this.mm.getContext('2d');
    const g = this.game;
    c.fillStyle = '#3d7a33';
    c.fillRect(0, 0, this.mmW, this.mmH);
    const rect = (x0, z0, x1, z1, col) => {
      const [a, b] = this.worldToMM(x0, z0), [d, e] = this.worldToMM(x1, z1);
      c.fillStyle = col;
      c.fillRect(Math.min(a, d), Math.min(b, e), Math.abs(d - a), Math.abs(e - b));
    };
    rect(-HALF_W, -MID, HALF_W, MID, '#6b8a45');
    rect(-HALF_W, MID, HALF_W, MID + DEPLOY_ROWS * TILE, 'rgba(47,124,246,.35)');
    rect(-HALF_W, -MID, HALF_W, -MID - DEPLOY_ROWS * TILE, 'rgba(240,65,61,.35)');
    for (const b of g.buildings) {
      if (b.def.cat === 'scenery') continue;
      const r = b.worldRect(0);
      rect(r.x0, r.z0, r.x1, r.z1, b.ruined ? '#444' : b.type === 'castle' ? '#fff' : b.team === 0 ? '#9cc3ff' : '#ffb0a8');
    }
    const hide = g.hideTeamUnits;
    for (let team = 0; team < 2; team++) {
      if (hide === team) continue;
      c.fillStyle = team === 0 ? '#2f7cf6' : '#f0413d';
      for (const u of g.units[team]) {
        if (!u.alive) continue;
        const [x, y] = this.worldToMM(u.x, u.z);
        c.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    // camera
    const t = this.app.view.rig.target;
    const [cx, cy] = this.worldToMM(t.x, t.z);
    c.strokeStyle = '#ffd23f';
    c.lineWidth = 2;
    c.strokeRect(cx - 12, cy - 9, 24, 18);
  }

  // ── Floating text + thoughts ──
  floater(x, y, z, text, color = '#5cff8a') {
    if (this.floaters.length > 24) return;
    const el = h('div', { class: 'floater', style: { color } }, text);
    this.root.appendChild(el);
    this.floaters.push({ el, x, y, z, t: 0 });
  }
  thought(guest, text) {
    if (!this.app.settings.thoughts) return;
    if (this.thoughts.length >= 3) return;
    if (guest.team !== 0 && !this.spectator) return;
    const el = h('div', { class: 'thought' }, text);
    this.root.appendChild(el);
    this.thoughts.push({ el, guest, t: 0 });
  }

  // ── Events ──
  onEvent(e) {
    const g = this.game;
    switch (e.type) {
      case 'phase':
        if (e.phase === 'prep') {
          this.banner('ROUND ' + e.round, e.round === 1 ? 'Build your park · Deploy your army' : 'Plan · Build · Deploy', 2400);
          if (!this.spectator) this.tips(e.round);
          if (!this.spectator) {
            this.renderScout();
            this.scoutEl.classList.remove('hidden');
            this.setTab(this.tab);
          }
        } else if (e.phase === 'battle') {
          this.banner('BATTLE!', 'Armies revealed', 1500);
          if (this.scoutEl) this.scoutEl.classList.add('hidden');
          if (!this.spectator) this.renderItems();
        }
        break;
      case 'fight':
        this.banner('FIGHT!', '', 900);
        break;
      case 'rampage':
        if (e.team === 0) this.banner('RAMPAGE!', 'Their army is gone — wreck their park!', 2200);
        else if (e.team === 1) this.banner(this.spectator ? 'RAMPAGE!' : 'DEFEND!', this.spectator ? '' : 'Your army fell — defenses, hold the line!', 2200);
        break;
      case 'stalemate':
        this.push('Nobody wants to fight. The crowd boos. Battle over!', { kind: 'sys' });
        break;
      case 'roundEnd': {
        const w = e.winner;
        let txt;
        if (this.spectator) txt = w < 0 ? 'Round ' + e.round + ': a draw.' : `Round ${e.round} goes to ${g.teams[w].name}!`;
        else txt = w === 0 ? `Round ${e.round} won! 🎉` : w === 1 ? `Round ${e.round} lost.` : `Round ${e.round}: draw.`;
        if (e.insurance && !this.spectator && e.insurance[0]) txt += ` Insurance paid ${fmtMoney(e.insurance[0])}.`;
        this.push(txt, { kind: w === 0 ? 'good' : w === 1 ? 'bad' : 'sys' });
        break;
      }
      case 'barrage':
        if (e.team === 1 && !this.spectator) this.push('🎆 Incoming fireworks barrage!', { kind: 'bad', life: 3500 });
        else if (this.spectator) this.push(`🎆 ${g.teams[e.team].name} calls a fireworks barrage!`, { kind: 'sys', life: 3500 });
        break;
      case 'wages':
        if (e.team === 0 && !this.spectator) this.push(`Payroll: your veterans were paid ${fmtMoney(e.amount)} in wages.`, { kind: 'sys', life: 6000 });
        break;
      case 'chat':
        this.push(e.text, { who: e.avatar + ' ' + e.name, color: e.color });
        break;
      case 'destroyed':
        if (e.b.team === 0 && !this.spectator) this.push(`Your ${e.b.coaster ? 'coaster' : e.b.def.name} was wrecked!`, { kind: 'bad' });
        else if (e.b.team === 1 && !this.spectator && e.b.type !== 'castle') this.push(`Wrecked their ${e.b.coaster ? 'coaster' : e.b.def.name}!`, { kind: 'good' });
        break;
      case 'coaster':
        if (e.team === 0 && !this.spectator) this.push(`Coaster opened! Excitement ${e.coaster.stats.excitement.toFixed(1)}, tickets $${e.coaster.price}.`, { kind: 'good' });
        break;
      case 'money':
        if ((e.team === 0 || this.spectator) && e.reason !== 'entry' && Math.random() < 0.3 && e.x !== undefined) this.floater(e.x, 4, e.z, '+$' + Math.round(e.amount));
        break;
      case 'purchase':
        if ((e.team === 0 || this.spectator) && Math.random() < 0.35) this.floater(e.x, 4.5, e.z, '+$' + e.amount);
        break;
      case 'thought':
        if (Math.random() < 0.35) this.thought(e.guest, e.text);
        break;
    }
  }

  // First-game coaching, a few lines per round.
  tips(round) {
    const T = {
      1: ['🎠 Rides earn money: open the Rides tab and place a Spinning Teacups near a path.', '⚔️ Army tab → pick a unit, then click or drag inside the glowing blue yard.', '✅ Happy? Hit READY (or Enter). The rival army stays hidden until the horn!'],
      2: ['🔭 Check the Scouting Report (bottom-left): counter what they brought last time.', '🛡️ Popcorn Cannons and Splash Fountains defend your park while earning money.', '🎆 Mid-battle, press B (or the barrage button) to rain fireworks on their densest clump — once per battle.'],
      3: ['🎢 Coasters are the best money-makers — try the Coasters tab and ✨ Auto-design.', '💡 Low coaster track through your yard flattens invaders!'],
      4: ['🧠 Mix your army: tanks up front, ranged behind, artillery at the back.', '🛡️ Outnumbered? Switch to Hold to fight under your turrets.'],
    };
    const list = T[round];
    if (!list) return;
    list.forEach((t, i) => setTimeout(() => this.push(t, { kind: 'sys', life: 11000 }), 2600 + i * 2400));
  }

  // ── Per-frame update ──
  update(dt) {
    const g = this.game;
    const view = this.app.view;
    // floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const p = view.project(f.x, f.y + f.t * 2.2, f.z);
      if (!p || f.t > 1.4) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      f.el.style.left = p.x + 'px';
      f.el.style.top = p.y + 'px';
      f.el.style.opacity = String(Math.min(1, (1.4 - f.t) * 2));
    }
    for (let i = this.thoughts.length - 1; i >= 0; i--) {
      const t = this.thoughts[i];
      t.t += dt;
      const gst = t.guest;
      const p = !gst.removed ? view.project(gst.x, gst.y + 1.4, gst.z) : null;
      if (!p || t.t > 3.2) {
        t.el.remove();
        this.thoughts.splice(i, 1);
        continue;
      }
      t.el.style.left = p.x + 'px';
      t.el.style.top = p.y + 'px';
    }
    this.lastUpdate -= dt;
    if (this.lastUpdate > 0) return;
    this.lastUpdate = 0.1;
    const me = g.teams[0];
    const park = g.parks[0];
    // money ticks smoothly
    this.moneyShown += (me.money - this.moneyShown) * 0.5;
    this.elMoney.textContent = fmtMoney(this.moneyShown);
    const inc = g.incomePerMinute(0);
    this.elInc.textContent = '+' + fmtMoney(inc) + '/min';
    this.elGuests.textContent = park.guestCount;
    this.elRating.textContent = Math.round(park.rating) + '%';
    this.elStars.textContent = stars(park.rating);
    this.elRound.textContent = 'ROUND ' + g.round + '/' + MAX_ROUNDS;
    const phaseName = { intro: 'Get Ready', prep: '🏗️ Planning', battle: g.battleStarted ? '⚔️ Battle' : '⚔️ Get ready…', results: '🏁 Round over', over: '🏆 Game over' }[g.phase] || g.phase;
    this.elPhase.textContent = phaseName;
    this.elTimer.textContent = g.phase === 'prep' || (g.phase === 'battle' && g.battleStarted) ? fmtTime(g.phaseTime) : g.phase === 'battle' ? Math.ceil(g.countdown) + '' : '';
    for (const [cb, team] of [[this.cb0, 0], [this.cb1, 1]]) {
      const hp = Math.max(0, g.parks[team].castle.hp);
      cb.fill.style.width = (hp / CASTLE_HP) * 100 + '%';
      cb.val.textContent = Math.round((hp / CASTLE_HP) * 100) + '%';
    }
    const rp = g.parks[1];
    this.elRival.textContent = `${stars(rp.rating)} · ${rp.guestCount} guests` + (this.spectator ? ` · ${fmtMoney(g.teams[1].money)}` : '');
    for (const b of this.speedBtns) b.classList.toggle('sel', +b.dataset.speed === this.app.speed);
    this.pauseBadge.classList.toggle('hidden', this.app.speed !== 0);
    if (!this.spectator) {
      const sup = g.supplyUsed(0);
      clear(this.supplyEl).append(h('span', {}, `Army ⚑ ${sup}/${SUPPLY_CAP}`), h('div', { class: 'bar' }, h('div', { style: { width: (sup / SUPPLY_CAP) * 100 + '%' } })));
      const prep = g.phase === 'prep';
      this.readyBtn.disabled = !prep || me.ready;
      this.readyBtn.textContent = prep ? (me.ready ? 'Waiting…' : '⚔️ READY!') : g.phase === 'battle' ? 'Battle on!' : '…';
      this.readyBtn.classList.toggle('readybtn', prep && !me.ready);
      const inBattle = g.phase === 'battle' && g.battleStarted;
      this.barrageBtn.classList.toggle('hidden', !inBattle);
      this.readyBtn.classList.toggle('hidden', inBattle);
      this.barrageBtn.disabled = !g.canBarrage(0);
      const bt = me.barrageUsed ? '🎆 Barrage used' : `🎆 Fireworks barrage ${fmtMoney(BARRAGE.cost)}`;
      if (this.barrageBtn.textContent !== bt) this.barrageBtn.textContent = bt;
      this.updateStance();
      // refresh affordability occasionally
      if (Math.abs(me.money - (this._lastMoney || 0)) > 30 || this._lastPhase !== g.phase) {
        this._lastMoney = me.money;
        this._lastPhase = g.phase;
        this.renderItems();
      }
    }
    if (this.selected) {
      this._infoT = (this._infoT || 0) - 1;
      if (this._infoT <= 0) {
        this._infoT = 5;
        this.renderInfo();
      }
    }
    this.drawMinimap();
  }
}
