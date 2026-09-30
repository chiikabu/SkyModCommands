# 🎢 Coaster Carnage — Totally Accurate Theme Park Warfare

A 3D browser game that fuses **Totally Accurate Battle Simulator** with **Planet Coaster**:
build a theme park whose guests fund a wobbly physics-driven army, design roller coasters that
flatten invaders, and topple the rival park's castle — against genuinely scheming AI rivals.

**Play:** open `dist/index.html` in any modern browser (it is a single self-contained file).

## Features
- **Wobbly active ragdolls** — every unit and guest is a Verlet-physics ragdoll held up by
  spring "muscles": they stumble, get flung by explosions, get back up, and flop when knocked out.
- **10 unit types** — janitors, dart poppers, pie clowns, mascot bruisers, ringmasters,
  bumper cars, human cannonballs, strongmen, popcorn cannoneers and inflatable giants.
- **A real theme park** — rides, shops, scenery and auto-connecting paths; guests with needs
  queue, ride (you can see them on the rides), pay, get hungry, panic during invasions.
- **Rides fight** — popcorn cannons, splash fountains, drop-tower shockwaves, pirate-ship hull
  smashes, a human-cannon show that fires guests at the enemy, and low coaster track that
  flattens trespassers.
- **Roller coaster designer** — lay nodes, set heights, see live excitement/intensity/nausea
  ratings from a physics-simulated test run with auto-banking, or hit ✨ Auto-design. Ride it in
  first person.
- **Competent AI rivals** — four personalities × four difficulties. They scout your armies,
  counter-pick, budget between economy/army/defense by payback time, design their own coasters,
  deploy in role-based formations aimed at your weakest lane, pick Charge/Hold stances and
  change them mid-battle, call fireworks barrages on your densest clumps, repair, and taunt you.
- **Fireworks Barrage** — once per battle, pay to have your castle rain fireworks on any spot.
- **Comeback mechanics** — fallen units pay out insurance, big armies cost wages, you hit harder
  on home turf, and survivors heal between rounds, so a bad round is never the end.
- **Night battles** — the day/night cycle rolls on; stadium floodlights switch on after dusk.
- **Watch mode** — AI vs AI with an automatic director camera.
- **Shaders & post** — procedural sky with clouds/stars, painterly terrain + cobblestone paths,
  depth-tinted water with foam, chasing light bulbs, day/night cycle with light pools, bloom,
  tilt-shift miniature effect, grading and vignette.
- **Procedural audio** — band-organ waltz while building, galop during battles, war horn,
  synthesised sound effects and comedic screams. No asset files.

## Controls
| Action | Input |
| --- | --- |
| Pan / rotate / zoom | WASD or edge-scroll · right-drag · mouse wheel · Q/E (touch: drag, pinch, twist) |
| Place unit / building | Pick from the dock, left-click (drag to paint) · R rotates |
| Dismiss unit / cancel tool | Right-click |
| Start battle | READY button or Enter |
| Pause / speed / slow-mo | Space · 1 2 3 · 4 |
| Coaster node height | Shift + wheel or Z / X · Backspace undo · Enter build |
| Fireworks barrage (during battle) | Barrage button or B, then click a spot |
| Ride your coaster / hide HUD | C · H |

## Development
```bash
npm install
npm run build        # → dist/index.html (single file)
npm run dev          # rebuild on change
npm run sim -- 4 gustavo hard baron normal   # headless AI-vs-AI balance runs
```

Source layout: `src/sim` (deterministic simulation: physics, units, park, guests, coasters,
AI), `src/render` (three.js scene, shaders, models, effects), `src/ui` (HUD, tools, menus),
`src/audio` (WebAudio synth).
