// Equal-cost pure-army matchups:  node tools/matchups.mjs [budget] [seeds] [typesCsv]
import { Game } from '../src/sim/game.js';
import { UNIT_TYPES, UNIT_ORDER, MID } from '../src/config.js';

const budget = +(process.argv[2] || 1800);
const seeds = +(process.argv[3] || 3);
const types = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : UNIT_ORDER;
const seedOff = +(process.argv[5] || 0);
const asJson = process.argv.includes('--json');

function deployArmy(g, team, type) {
  const d = UNIT_TYPES[type];
  const n = Math.max(1, Math.round(budget / d.cost));
  const perRow = Math.min(12, n);
  for (let i = 0; i < n; i++) {
    const col = i % perRow, row = Math.floor(i / perRow);
    const sp = d.vehicle ? 3.5 : 1.9 * Math.max(1, d.scale);
    const lx = (col - (perRow - 1) / 2) * sp;
    const lz = MID + 4 + row * sp + (d.role === 'artillery' || d.role === 'ranged' ? 6 : 0);
    g.deploy(team, type, lx, lz, true);
  }
  return n;
}
function fight(a, b, seed) {
  const g = new Game({ seed, headless: true, players: [{ kind: 'ai' }, { kind: 'ai' }] });
  g.begin();
  // strip castle defense influence: fight in no-man's land only
  deployArmy(g, 0, a);
  deployArmy(g, 1, b);
  g.startBattle();
  let steps = 0;
  while (g.phase === 'battle' && steps < 60 * 110) {
    g.step();
    g.drainEvents();
    steps++;
    // stop when one side is wiped (ignore rampage)
    const a0 = g.units[0].some((u) => u.alive), a1 = g.units[1].some((u) => u.alive);
    if (!a0 || !a1) break;
  }
  const val = (t) => g.units[t].reduce((s, u) => s + (u.alive ? u.def.cost * u.hp / u.maxHp : 0), 0);
  const v0 = val(0), v1 = val(1);
  return v0 > v1 ? 1 : v0 < v1 ? 0 : 0.5;
}
const res = {};
const t0 = Date.now();
for (const a of types) {
  res[a] = {};
  for (const b of types) {
    if (a === b) { res[a][b] = 0.5; continue; }
    if (res[b] && res[b][a] !== undefined) { res[a][b] = 1 - res[b][a]; continue; }
    let w = 0;
    for (let s = 0; s < seeds; s++) {
      // alternate sides to remove side bias
      if (s % 2 === 0) w += fight(a, b, 100 + s + seedOff);
      else w += 1 - fight(b, a, 100 + s + seedOff);
    }
    res[a][b] = w / seeds;
  }
}
if (asJson) { console.log(JSON.stringify(res)); process.exit(0); }
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('', 11) + types.map((t) => pad(t.slice(0, 6), 7)).join(''));
for (const a of types) {
  let avg = 0;
  const row = types.map((b) => { avg += res[a][b]; return pad(res[a][b].toFixed(2), 7); }).join('');
  console.log(pad(a, 11) + row + '  avg ' + (avg / types.length).toFixed(2));
}
console.log('took', ((Date.now() - t0) / 1000).toFixed(0), 's');
