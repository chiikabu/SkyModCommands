// ─────────────────────────────────────────────────────────────────────────────
//  App shell: screens, settings, game lifecycle and the main loop.
// ─────────────────────────────────────────────────────────────────────────────
import { h, clear } from './dom.js';
import { Game } from '../sim/game.js';
import { AIPlayer } from '../sim/ai/brain.js';
import { PERSONALITIES, DIFFICULTIES } from '../sim/ai/personalities.js';
import { GameView } from '../render/view.js';
import { HUD } from './hud.js';
import { Tools } from './tools.js';
import { AudioSys } from '../audio/audio.js';
import { DT, UNIT_TYPES, UNIT_ORDER, BUILDINGS, MAX_ROUNDS, CASTLE_HP } from '../config.js';
import { fmtMoney } from '../util/math.js';

const DEFAULTS = { quality: 2, tiltShift: true, bloom: true, timeMode: 'cycle', music: 0.5, sfx: 0.7, edgePan: true, thoughts: true, rival: 'gustavo', difficulty: 'normal', parkName: 'Wobbleland' };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cc-settings') || '{}');
    return { ...DEFAULTS, ...s };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export class App {
  constructor() {
    this.settings = loadSettings();
    this.ui = document.getElementById('ui');
    this.canvas = document.getElementById('c');
    this.view = new GameView(this.canvas, this.settings);
    this.audio = new AudioSys(this.settings);
    this.game = null;
    this.hud = null;
    this.mode = 'title';
    this.speed = 1;
    this.acc = 0;
    this.last = performance.now();
    this.hudHidden = false;
    this.overlay = h('div', { id: 'overlay' });
    this.ui.appendChild(this.overlay);
    // unlock audio on first interaction
    const unlock = () => {
      this.audio.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.startAttract();
    this.showTitle();
    requestAnimationFrame((t) => this.loop(t));
  }
  saveSettings() {
    try {
      localStorage.setItem('cc-settings', JSON.stringify(this.settings));
    } catch (e) {}
  }

  // ── Game lifecycle ──
  newGame(players, ais, opts = {}) {
    if (this.hud) this.hud.destroy();
    this.hud = null;
    if (this.tools) this.tools.cancel();
    const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    const g = new Game({ seed, players });
    ais.forEach((a, i) => {
      if (a) g.ai[i] = new AIPlayer(g, i, a.personality, a.difficulty, seed + i * 17);
    });
    g.begin();
    this.game = g;
    this.view.attach(g);
    this.acc = 0;
    return g;
  }
  startAttract() {
    const names = Object.keys(PERSONALITIES);
    const a = names[(Math.random() * names.length) | 0];
    let b = names[(Math.random() * names.length) | 0];
    if (b === a) b = names[(names.indexOf(a) + 1) % names.length];
    this.mode = 'title';
    this.newGame([{ kind: 'ai' }, { kind: 'ai' }], [{ personality: a, difficulty: 'hard' }, { personality: b, difficulty: 'hard' }]);
    this.game.phaseTime = 12; // get to the action fast
    this.view.todOffset = 0.18;
    this.view.rig.mode = 'director';
    this.view.rig.focus(0, 30, 110, 0.6);
    this.view.rig.goalPitch = 0.55;
    this.view.rig.snap();
    this.view.rig.enabled = false;
    this.speed = 1.5;
  }
  startVsAI() {
    const s = this.settings;
    this.mode = 'play';
    this.view.todOffset = 0;
    const g = this.newGame([{ kind: 'human', name: 'You', parkName: s.parkName || 'Wobbleland' }, { kind: 'ai' }], [null, { personality: s.rival, difficulty: s.difficulty }]);
    this.speed = 1;
    this.view.rig.enabled = true;
    this.view.rig.mode = 'free';
    this.view.rig.edgePan = s.edgePan;
    this.view.rig.focus(0, 52, 95, 0);
    this.view.rig.goalPitch = 0.9;
    this.view.rig.snap();
    this.tools = this.tools || new Tools(this);
    this.hud = new HUD(this, g, { spectator: false });
    clear(this.overlay);
    this.hud.push(`Welcome to ${s.parkName}! Build rides for cash, deploy your wobbly army in the blue yard, then hit READY. Destroy the rival castle to win.`, { kind: 'sys', life: 16000 });
    this.audio.setMode('prep');
    this.audio.ui('ready');
  }
  startWatch(a, b, diff) {
    this.mode = 'watch';
    this.view.todOffset = 0;
    const g = this.newGame([{ kind: 'ai' }, { kind: 'ai' }], [{ personality: a, difficulty: diff }, { personality: b, difficulty: diff }]);
    this.speed = 1;
    this.view.rig.enabled = true;
    this.view.rig.mode = 'director';
    this.view.rig.edgePan = false;
    this.view.rig.focus(0, 0, 120, 0.4);
    this.view.rig.goalPitch = 0.7;
    this.view.rig.snap();
    this.tools = this.tools || new Tools(this);
    this.hud = new HUD(this, g, { spectator: true });
    clear(this.overlay);
    this.audio.setMode('prep');
  }
  quitToTitle() {
    if (this.tools) this.tools.cancel();
    if (this.hud) this.hud.destroy();
    this.hud = null;
    this.startAttract();
    this.showTitle();
  }
  ready() {
    const g = this.game;
    if (!g || g.phase !== 'prep') return;
    if (!g.units[0].some((u) => u.alive) && !this._warnedEmpty) {
      this._warnedEmpty = true;
      this.hud.push('No army deployed! Your park defenses will have to hold alone. Press READY again to confirm.', { kind: 'bad', life: 6000 });
      return;
    }
    this._warnedEmpty = false;
    g.setReady(0);
    this.audio.ui('ready');
    if (this.tools) this.tools.cancel();
  }
  setSpeed(s) {
    this.speed = s;
    this.audio.ui('tick');
  }

  // ── Main loop ──
  loop(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    if (g) {
      g.hideTeamUnits = this.mode === 'play' && g.phase === 'prep' ? 1 : -1;
      this.acc += dt * this.speed;
      let n = 0;
      const maxSteps = 10;
      while (this.acc >= DT && n < maxSteps) {
        g.step();
        this.acc -= DT;
        n++;
        const ev = g.drainEvents();
        this.view.handleEvents(ev, this.audio);
        if (this.hud) for (const e of ev) this.hud.onEvent(e);
        for (const e of ev) this.onGameEvent(e);
      }
      if (n >= maxSteps) this.acc = 0;
      if (this.mode === 'title' && g.phase === 'over') {
        // endless attract mode
        this._restartT = (this._restartT || 0) + dt;
        if (this._restartT > 12) {
          this._restartT = 0;
          this.startAttract();
          return requestAnimationFrame((t) => this.loop(t));
        }
      }
    }
    this.view.frame(dt, this.acc / DT);
    if (this.hud) this.hud.update(dt);
    if (this.tools && this.mode === 'play') this.tools.update();
    requestAnimationFrame((t) => this.loop(t));
  }
  onGameEvent(e) {
    if (e.type === 'gameOver' && this.mode !== 'title') {
      setTimeout(() => this.showResults(e.winner), 2200);
      if (this.mode === 'play') this.audio.fanfare(e.winner === 0);
      else this.audio.fanfare(true);
    }
    if (e.type === 'phase' && this.mode === 'play' && e.phase === 'prep' && this.speed > 1.5) this.speed = 1;
  }
  onKey(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    const g = this.game;
    if (this.mode === 'title') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.speed = this.speed === 0 ? this._prevSpeed || 1 : ((this._prevSpeed = this.speed), 0);
        break;
      case 'Digit1': this.setSpeed(1); break;
      case 'Digit2': this.setSpeed(2); break;
      case 'Digit3': this.setSpeed(3); break;
      case 'Digit4': this.setSpeed(0.3); break;
      case 'Escape':
        if (this.tools && this.tools.tool) this.tools.cancel();
        else if (this.view.rig.mode === 'ride' || this.view.rig.mode === 'follow') this.view.rig.exitSpecial();
        else if (this.overlay.children.length) {
          clear(this.overlay);
          if (this._pausedByMenu) {
            this.speed = this._prevSpeed || 1;
            this._pausedByMenu = false;
          }
        } else this.showPauseMenu();
        break;
      case 'Enter':
        if (this.mode === 'play' && !(this.tools && this.tools.tool && this.tools.tool.startsWith('coaster'))) this.ready();
        break;
      case 'KeyH':
        this.hudHidden = !this.hudHidden;
        if (this.hud) this.hud.root.style.display = this.hudHidden ? 'none' : '';
        break;
      case 'KeyV':
        if (this.mode === 'watch') this.view.rig.mode = 'director';
        break;
      case 'Home':
        this.view.rig.focus(0, 52, 95, 0);
        break;
      case 'KeyC': {
        const c = g && (this.hud?.selected?.coaster || g.coasters.find((c) => c.team === 0));
        if (c) this.view.rig.setRide(c);
        break;
      }
    }
  }

  // ── Screens ──
  showTitle() {
    clear(this.overlay);
    const logo = h('div', { class: 'logo' },
      h('h1', {}, 'COASTER', h('br'), 'CARNAGE'),
      h('div', { class: 'sub' }, 'TOTALLY ACCURATE THEME PARK WARFARE'),
      h('div', { class: 'tag' }, '🎢 Build a park · 🧹 Raise a wobbly army · 🏰 Topple their castle'),
    );
    const menu = h('div', { class: 'menu' },
      h('button', { class: 'btn big', onclick: () => this.showRivalSelect() }, '▶ PLAY VS AI'),
      h('button', { class: 'btn big blue', onclick: () => this.showWatchSelect() }, '👀 WATCH AI BATTLE'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn ghost', onclick: () => this.showHelp() }, '❓ How to play'),
        h('button', { class: 'btn ghost', onclick: () => this.showSettings() }, '⚙ Settings')),
    );
    this.overlay.append(h('div', { id: 'title' }, logo, menu, h('div', { class: 'credits' }, 'All 3D, shaders, physics, AI and music generated procedurally in your browser.')));
  }
  modal(content, onClose) {
    clear(this.overlay);
    const back = h('div', { class: 'modal-back' }, h('div', { class: 'panel modal' }, ...content));
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back && onClose) onClose();
    });
    this.overlay.appendChild(back);
  }
  showRivalSelect() {
    const s = this.settings;
    const rivals = h('div', { class: 'rivals' });
    const draw = () => {
      clear(rivals);
      for (const p of Object.values(PERSONALITIES)) {
        rivals.append(h('div', { class: 'rival' + (s.rival === p.id ? ' sel' : ''), onclick: () => { s.rival = p.id; draw(); this.audio.ui('click'); } },
          h('div', { class: 'av' }, p.avatar), h('div', { class: 'nm' }, p.name), h('div', { class: 'tt', style: { color: p.color } }, p.title), h('div', { class: 'bl' }, p.blurb)));
      }
    };
    draw();
    const diff = h('div', { class: 'seg' });
    const drawDiff = () => {
      clear(diff);
      const tips = { easy: 'Slow, sloppy, forgiving.', normal: 'Solid counters, fair economy.', hard: 'Sharp counters, fast builds, +12% income.', brutal: 'Merciless: +35% income and it peeks at your army.' };
      for (const d of Object.values(DIFFICULTIES)) diff.append(h('button', { class: s.difficulty === d.id ? 'sel' : '', title: tips[d.id], onclick: () => { s.difficulty = d.id; drawDiff(); this.audio.ui('click'); } }, d.name));
    };
    drawDiff();
    const name = h('input', { class: 'txt', value: s.parkName, maxlength: 22 });
    name.addEventListener('input', () => (s.parkName = name.value || 'Wobbleland'));
    this.modal([
      h('h2', {}, 'Choose your rival'),
      h('p', {}, 'Every rival runs a real park and a real army. They scout your armies, counter-pick your favourite units, design their own coasters, and taunt you about it.'),
      rivals,
      h('h3', {}, 'Difficulty'), diff,
      h('h3', {}, 'Your park'), name,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => this.showTitle() }, 'Back'), h('button', { class: 'btn big', onclick: () => { this.saveSettings(); this.startVsAI(); } }, 'OPEN THE GATES!')),
    ], () => this.showTitle());
  }
  showWatchSelect() {
    const names = Object.keys(PERSONALITIES);
    let a = names[0], b = names[1], diff = 'hard';
    const box = h('div');
    const draw = () => {
      clear(box);
      const pick = (cur, set) => {
        const seg = h('div', { class: 'seg' });
        for (const p of Object.values(PERSONALITIES)) seg.append(h('button', { class: cur === p.id ? 'sel' : '', onclick: () => { set(p.id); draw(); } }, p.avatar + ' ' + p.name));
        return seg;
      };
      const dseg = h('div', { class: 'seg' });
      for (const d of Object.values(DIFFICULTIES)) dseg.append(h('button', { class: diff === d.id ? 'sel' : '', onclick: () => { diff = d.id; draw(); } }, d.name));
      box.append(h('h3', {}, '🔵 Blue corner'), pick(a, (v) => (a = v)), h('h3', {}, '🔴 Red corner'), pick(b, (v) => (b = v)), h('h3', {}, 'Skill'), dseg);
    };
    draw();
    this.modal([h('h2', {}, 'Watch an AI battle'), h('p', {}, 'Sit back with some popcorn. The director camera follows the action — grab the camera any time, press V to give it back.'), box,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => this.showTitle() }, 'Back'), h('button', { class: 'btn big blue', onclick: () => this.startWatch(a, b, diff) }, 'START SHOW'))], () => this.showTitle());
  }
  showHelp() {
    const back = this.mode === 'title' ? () => this.showTitle() : () => clear(this.overlay);
    const units = h('div', { class: 'unit-ref' });
    for (const t of UNIT_ORDER) {
      const d = UNIT_TYPES[t];
      units.append(h('div', {}, h('b', {}, d.icon + ' ' + d.name + ' '), fmtMoney(d.cost), h('br'), d.desc));
    }
    this.modal([
      h('h2', {}, 'How to play'),
      h('div', { class: 'help-grid' },
        h('div', { class: 'help-card', html: '<b>🎢 Build a park.</b> Rides and shops attract guests who pay entry fees and tickets. Paths connect automatically. Scenery raises your park rating, which brings more (and richer) guests.' }),
        h('div', { class: 'help-card', html: '<b>⚔️ Raise an army.</b> During <b>Planning</b>, pick a unit in the Army tab and click (or drag to paint) inside your blue deployment yard. Right-click a unit to dismiss it for a refund.' }),
        h('div', { class: 'help-card', html: '<b>🛡️ Rides fight too.</b> Popcorn Cannons lob explosive tubs, Splash Fountains hose invaders away, Drop Towers send shockwaves, Pirate Ships smack anyone underneath, the Human Cannon fires guests at the enemy, and low coaster track flattens trespassers.' }),
        h('div', { class: 'help-card', html: '<b>🏰 Win the war.</b> Hit <b>READY</b> to start the battle. Choose <b>Charge</b> to attack or <b>Hold</b> to defend under your turrets (you can switch mid-battle). Survivors return home. Wreck the rival castle to win.' }),
        h('div', { class: 'help-card', html: '<b>🧠 Know your rival.</b> The AI scouts your army each round and counters it. Mix your units, read the Scouting Report, and counter their counters. Lost units pay out 40% insurance.' }),
        h('div', { class: 'help-card', html: '<b>🎮 Controls.</b> <span class="kbd">WASD</span> pan · right-drag rotate · wheel zoom · <span class="kbd">Q</span><span class="kbd">E</span> rotate · <span class="kbd">R</span> rotate building · <span class="kbd">Space</span> pause · <span class="kbd">1</span>-<span class="kbd">4</span> speed/slow-mo · <span class="kbd">Enter</span> ready · <span class="kbd">H</span> hide HUD · <span class="kbd">C</span> ride your coaster · <span class="kbd">Esc</span> cancel/menu' }),
      ),
      h('h3', {}, 'Units'), units,
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: back }, 'Got it!')),
    ], back);
  }
  showSettings() {
    const s = this.settings;
    const back = this.mode === 'title' ? () => this.showTitle() : () => clear(this.overlay);
    const seg = (key, opts, after) => {
      const el = h('div', { class: 'seg' });
      const draw = () => {
        clear(el);
        for (const [v, label] of opts) el.append(h('button', { class: s[key] === v ? 'sel' : '', onclick: () => { s[key] = v; draw(); this.saveSettings(); after && after(); } }, label));
      };
      draw();
      return el;
    };
    const slider = (key) => {
      const i = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key], style: { width: '260px' } });
      i.addEventListener('input', () => { s[key] = +i.value; this.audio.applyVolumes(); this.saveSettings(); });
      return i;
    };
    this.modal([
      h('h2', {}, 'Settings'),
      h('h3', {}, 'Graphics quality'), seg('quality', [[0, 'Low'], [1, 'Medium'], [2, 'High']], () => this.hud && this.hud.push('Quality applies after reloading the page.', { kind: 'sys' })),
      h('h3', {}, 'Time of day'), seg('timeMode', [['cycle', '🌗 Day/night cycle'], ['day', '☀️ Day'], ['sunset', '🌇 Sunset'], ['night', '🌙 Night']]),
      h('h3', {}, 'Effects'), seg('tiltShift', [[true, 'Tilt-shift on'], [false, 'Tilt-shift off']]), h('div', { style: { height: '8px' } }), seg('bloom', [[true, 'Bloom on'], [false, 'Bloom off']]),
      h('h3', {}, 'Camera'), seg('edgePan', [[true, 'Edge scrolling on'], [false, 'Edge scrolling off']], () => (this.view.rig.edgePan = s.edgePan)),
      h('h3', {}, 'Guest thoughts'), seg('thoughts', [[true, 'Show'], [false, 'Hide']]),
      h('h3', {}, 'Music'), slider('music'),
      h('h3', {}, 'Sound effects'), slider('sfx'),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: back }, 'Done')),
    ], back);
  }
  showPauseMenu() {
    if (this.mode === 'title') return;
    this._prevSpeed = this.speed || this._prevSpeed || 1;
    this.speed = 0;
    this._pausedByMenu = true;
    const resume = () => {
      clear(this.overlay);
      this.speed = this._prevSpeed || 1;
      this._pausedByMenu = false;
    };
    this.modal([
      h('h2', {}, 'Paused'),
      h('div', { class: 'menu', style: { margin: '14px auto' } },
        h('button', { class: 'btn big', onclick: resume }, 'Resume'),
        h('button', { class: 'btn ghost', onclick: () => this.showHelp() }, '❓ How to play'),
        h('button', { class: 'btn ghost', onclick: () => this.showSettings() }, '⚙ Settings'),
        h('button', { class: 'btn ghost', onclick: () => { this._pausedByMenu = false; this.mode === 'watch' ? this.showWatchSelect() : this.startVsAI(); } }, '↻ Restart'),
        h('button', { class: 'btn red', onclick: () => { this._pausedByMenu = false; this.quitToTitle(); } }, 'Quit to title')),
    ], resume);
  }
  showResults(winner) {
    const g = this.game;
    if (!g) return;
    const t = g.teams;
    const play = this.mode === 'play';
    const won = winner === 0;
    const title = play ? (won ? 'VICTORY!' : 'DEFEAT') : `${t[winner].name} WINS!`;
    const reason = g.overReason === 'castle' ? (play ? (won ? 'Their castle crumbles into confetti.' : 'Your castle has fallen.') : 'The castle has fallen!') : 'Decided on castle health after ' + MAX_ROUNDS + ' rounds.';
    const row = (k, a, b) => [h('div', { class: 'a' }, a), h('div', { class: 'k' }, k), h('div', { class: 'b' }, b)];
    const cmp = h('div', { class: 'cmp' },
      h('div', { class: 'a', style: { fontFamily: 'var(--display)', fontSize: '18px' } }, t[0].name), h('div'), h('div', { class: 'b', style: { fontFamily: 'var(--display)', fontSize: '18px' } }, t[1].name),
      ...row('Castle', Math.round((Math.max(0, g.parks[0].castle.hp) / CASTLE_HP) * 100) + '%', Math.round((Math.max(0, g.parks[1].castle.hp) / CASTLE_HP) * 100) + '%'),
      ...row('Rounds won', t[0].stats.roundsWon, t[1].stats.roundsWon),
      ...row('Knockouts', t[0].stats.kills, t[1].stats.kills),
      ...row('Units lost', t[0].stats.lost, t[1].stats.lost),
      ...row('Money earned', fmtMoney(t[0].stats.earned), fmtMoney(t[1].stats.earned)),
      ...row('Park rating', Math.round(g.parks[0].rating) + '%', Math.round(g.parks[1].rating) + '%'),
      ...row('Coasters', g.coasters.filter((c) => c.team === 0).length, g.coasters.filter((c) => c.team === 1).length),
    );
    clear(this.overlay);
    const box = h('div', { class: 'panel results' },
      h('h2', { class: play && !won ? 'lose' : 'win' }, title),
      h('p', { style: { color: 'var(--muted)', fontWeight: 800 } }, reason, ' · ', g.round, ' rounds'),
      cmp,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn big', onclick: () => (this.mode === 'watch' ? this.showWatchSelect() : this.startVsAI()) }, play ? 'Rematch' : 'Another!'),
        play ? h('button', { class: 'btn blue', onclick: () => this.showRivalSelect() }, 'New rival') : null,
        h('button', { class: 'btn ghost', onclick: () => this.quitToTitle() }, 'Title')),
    );
    this.overlay.appendChild(box);
  }
}
