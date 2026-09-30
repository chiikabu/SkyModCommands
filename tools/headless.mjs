// Headless AI-vs-AI runner for balance testing:  node tools/headless.mjs [games] [p0] [d0] [p1] [d1]
import { Game } from '../src/sim/game.js';
import { AIPlayer } from '../src/sim/ai/brain.js';

const [games = 4, p0 = 'gustavo', d0 = 'normal', p1 = 'baron', d1 = 'normal', verbose = '1'] = process.argv.slice(2);
const results = [];
for (let gi = 0; gi < +games; gi++) {
  const seed = 1000 + gi * 77;
  const g = new Game({ seed, headless: true, players: [{ kind: 'ai' }, { kind: 'ai' }] });
  g.ai[0] = new AIPlayer(g, 0, p0, d0, seed);
  g.ai[1] = new AIPlayer(g, 1, p1, d1, seed + 1);
  g.begin();
  const t0 = Date.now();
  let steps = 0;
  const log = [];
  while (g.phase !== 'over' && steps < 60 * 60 * 40) {
    g.step();
    steps++;
    for (const e of g.drainEvents()) {
      if (e.type === 'chat' && verbose === '2') log.push(`[${(g.time).toFixed(0)}s] ${e.name}: ${e.text}`);
      if (e.type === 'roundEnd' && verbose !== '0') {
        const t = g.teams;
        const armies = [0, 1].map((k) => JSON.stringify(t[k].armyHistory[t[k].armyHistory.length - 1]?.comp || {}));
        console.log(`  R${e.round} winner=${e.winner} alive=${e.alive} castleDmg=${e.castleDmg.map(Math.round)} money=${t.map((x) => Math.round(x.money))} inc/min=${[0, 1].map((k) => Math.round(g.incomePerMinute(k)))} guests=${g.guests.count} rides=${g.parks.map((p) => p.buildings.filter((b) => b.def.ride || b.coaster).length)} coasters=${g.coasters.map((c) => c.team)} stance=${t.map((x) => x.armyHistory[x.armyHistory.length - 1]?.stance)}\n     A0 ${armies[0]}\n     A1 ${armies[1]}`);
      }
    }
  }
  const el = (Date.now() - t0) / 1000;
  results.push({ winner: g.winner, rounds: g.round, reason: g.overReason, castles: g.parks.map((p) => Math.round(p.castle.hp)), el });
  console.log(`game ${gi}: winner=${g.winner} (${g.winner === 0 ? p0 : p1}) rounds=${g.round} reason=${g.overReason} castles=${results[gi].castles} gameTime=${(g.time / 60).toFixed(1)}min real=${el.toFixed(1)}s`);
  if (verbose === '2') console.log(log.join('\n'));
}
const w0 = results.filter((r) => r.winner === 0).length;
console.log(`\n${p0}/${d0} won ${w0}/${results.length} vs ${p1}/${d1}; avg rounds ${(results.reduce((s, r) => s + r.rounds, 0) / results.length).toFixed(1)}`);
