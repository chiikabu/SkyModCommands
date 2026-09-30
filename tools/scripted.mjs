// Scripted "human-like" strategies vs the AI:  node tools/scripted.mjs <strategy> <personality> <difficulty> [games]
import { Game } from '../src/sim/game.js';
import { AIPlayer } from '../src/sim/ai/brain.js';
import { UNIT_TYPES, MID, BUILDINGS, DT } from '../src/config.js';
import { RNG } from '../src/util/rng.js';

const [strategy = 'newbie', pers = 'gustavo', diff = 'normal', games = 2] = process.argv.slice(2);

function placeArmy(g, rng, mix, budget) {
  let i = g.units[0].filter((u) => u.alive).length;
  let spent = 0;
  for (let k = 0; k < 200 && spent < budget; k++) {
    const t = rng.weighted(Object.keys(mix), (x) => mix[x]);
    const d = UNIT_TYPES[t];
    if (spent + d.cost > budget) break;
    for (let tries = 0; tries < 12; tries++) {
      const lx = rng.range(-30, 30), lz = MID + (d.role === 'ranged' || d.role === 'artillery' ? rng.range(10, 20) : rng.range(2, 9));
      if (g.deploy(0, t, lx, lz)) { spent += d.cost; break; }
    }
    i++;
  }
}
function buildSome(g, rng, types, budget) {
  const park = g.parks[0];
  let spent = 0;
  for (const t of types) {
    const cost = BUILDINGS[t].cost;
    if (spent + cost > budget) continue;
    for (let tries = 0; tries < 80; tries++) {
      const gx = rng.int(0, 44), gz = rng.int(t === 'turret' || t === 'fountain' ? 6 : 13, 38), rot = rng.int(0, 4);
      if (park.canPlace(t, gx, gz, rot).ok && park.place(t, gx, gz, rot)) { spent += cost; break; }
    }
  }
}
const policies = {
  rusher(g, rng) {
    g.teams[0].stance = 'charge';
    placeArmy(g, rng, { janitor: 6, popper: 2, clown: 1 }, g.teams[0].money);
  },
  newbie(g, rng) {
    g.teams[0].stance = 'charge';
    if (g.round <= 6) buildSome(g, rng, [rng.pick(['carousel', 'teacups', 'pirate', 'ferris'])], g.teams[0].money * 0.4);
    placeArmy(g, rng, { janitor: 3, popper: 2, mascot: 1, clown: 1, strongman: 1, cannoneer: 1, bumper: 1 }, g.teams[0].money);
  },
  turtle(g, rng) {
    g.teams[0].stance = g.round >= 7 ? 'charge' : 'hold';
    buildSome(g, rng, ['turret', 'teacups', 'turret', 'fountain', 'pirate', 'droptower', 'turret'], g.teams[0].money * 0.5);
    placeArmy(g, rng, { mascot: 2, popper: 3, cannoneer: 2, strongman: 1 }, g.teams[0].money);
  },
  giants(g, rng) {
    g.teams[0].stance = 'charge';
    if (g.round <= 2) buildSome(g, rng, ['teacups', 'carousel'], g.teams[0].money * 0.5);
    if (g.teams[0].money >= 1500) placeArmy(g, rng, { giant: 1 }, g.teams[0].money);
    placeArmy(g, rng, { popper: 1 }, Math.min(400, g.teams[0].money));
  },
};
let wins = 0;
for (let gi = 0; gi < +games; gi++) {
  const seed = 500 + gi * 31;
  const g = new Game({ seed, headless: true, players: [{ kind: 'ai', name: 'Script' }, { kind: 'ai' }] });
  g.ai[1] = new AIPlayer(g, 1, pers, diff, seed);
  const rng = new RNG(seed * 3);
  g.begin();
  let lastRound = -1;
  let steps = 0;
  while (g.phase !== 'over' && steps < 60 * 60 * 40) {
    if (g.phase === 'prep' && g.round !== lastRound && g.phaseTime < 40) {
      lastRound = g.round;
      policies[strategy](g, rng);
    }
    g.step();
    g.drainEvents();
    steps++;
  }
  if (g.winner === 0) wins++;
  console.log(`game ${gi}: winner=${g.winner === 0 ? 'SCRIPT(' + strategy + ')' : 'AI(' + pers + '/' + diff + ')'} rounds=${g.round} castles=${g.parks.map((p) => Math.round(p.castle.hp))} min=${(g.time / 60).toFixed(1)}`);
}
console.log(`${strategy} won ${wins}/${games} vs ${pers}/${diff}`);
