// Procedural coaster designer used by the AI (and the player's "Auto-design" button).
import { GRID_W, TERR_ROWS, DEPLOY_ROWS, HALF_W, MID, PARK_LZ1, TILE, BUILDINGS, COASTER } from '../../config.js';
import { designTrack, stationEntranceTile } from '../coaster.js';
import { rotatedSize } from '../park.js';
import { tileCenterLX, tileCenterLZ, inPark } from '../team.js';

// Find free station footprints.
export function stationCandidates(park, rng, max = 40) {
  const out = [];
  for (let tries = 0; tries < 900 && out.length < max; tries++) {
    const rot = rng.int(0, 4);
    const [W, D] = rotatedSize(BUILDINGS.station, rot);
    const gx = rng.int(1, GRID_W - W - 1);
    const gz = rng.int(DEPLOY_ROWS + 1, TERR_ROWS - D - 3);
    let ok = true;
    for (let j = gz - 1; j <= gz + D && ok; j++)
      for (let i = gx - 1; i <= gx + W && ok; i++) {
        if (i < 0 || j < 0 || i >= GRID_W || j >= TERR_ROWS) continue;
        const inside = i >= gx && i < gx + W && j >= gz && j < gz + D;
        const t = park.tiles[j * GRID_W + i];
        if (inside && t !== 0) ok = false;
      }
    if (!ok) continue;
    const [ex, ez] = stationEntranceTile(gx, gz, rot);
    if (!inPark(ex, ez) || park.tiles[ez * GRID_W + ex] > 0) continue;
    out.push({ gx, gz, rot, W, D });
  }
  return out;
}

// Generate a closed loop of nodes for a station: a rounded "stadium" loop on
// one side of the station (with gentle serpentines) and a smooth height profile
// (lift → first drop → decaying camel-back hills) with bounded curvature.
export function generateNodes(station, rng, style = {}) {
  const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]][station.rot];
  const W = station.W, D = station.D;
  const cx = -HALF_W + (station.gx + W / 2) * TILE;
  const cz = MID + (station.gz + D / 2) * TILE;
  const half = (Math.max(W, D) * TILE) / 2;
  const A = [cx - dir[0] * half, cz - dir[1] * half];
  const B = [cx + dir[0] * half, cz + dir[1] * half];
  const minX = -HALF_W + 2, maxX = HALF_W - 2;
  const defensive = !!style.defensive;
  const minZ = defensive ? MID + 2.5 : MID + DEPLOY_ROWS * TILE + 2;
  const maxZ = PARK_LZ1 - 4;
  const inB = (p) => p[0] >= minX && p[0] <= maxX && p[1] >= minZ && p[1] <= maxZ;
  let best = null;
  for (const side of rng.shuffle([1, -1])) {
    const perp = [-dir[1] * side, dir[0] * side];
    let aFront = rng.range(14, 40), aBack = rng.range(12, 34), w = rng.range(18, 50);
    for (let k = 0; k < 16; k++) {
      const P1 = [B[0] + dir[0] * aFront, B[1] + dir[1] * aFront];
      const P2 = [P1[0] + perp[0] * w, P1[1] + perp[1] * w];
      const P4 = [A[0] - dir[0] * aBack, A[1] - dir[1] * aBack];
      const P3 = [P4[0] + perp[0] * w, P4[1] + perp[1] * w];
      if (inB(P1) && inB(P2) && inB(P3) && inB(P4)) {
        best = { perp, P1, P2, P3, P4, w, aFront, aBack };
        break;
      }
      aFront = Math.max(12, aFront * 0.85);
      aBack = Math.max(11, aBack * 0.85);
      w = Math.max(15, w * 0.86);
    }
    if (best) break;
  }
  if (!best) return null;
  const { perp, P1, P2, P3, P4, w } = best;
  // Filleted polyline B→P1→P2→P3→P4→A with corner radius Rc
  const Rc = Math.min(9, w / 2 - 0.5, best.aFront - 3, best.aBack - 3);
  if (Rc < 5) return null;
  const pts2 = [];
  const poly = [B, P1, P2, P3, P4, A];
  const add = (p) => pts2.push(p);
  let cur = B;
  for (let i = 1; i < poly.length - 1; i++) {
    const P = poly[i], prev = poly[i - 1], next = poly[i + 1];
    const din = [(P[0] - prev[0]), (P[1] - prev[1])];
    const lin = Math.hypot(din[0], din[1]);
    din[0] /= lin; din[1] /= lin;
    const dout = [(next[0] - P[0]), (next[1] - P[1])];
    const lout = Math.hypot(dout[0], dout[1]);
    dout[0] /= lout; dout[1] /= lout;
    const s0 = [P[0] - din[0] * Rc, P[1] - din[1] * Rc];
    add(['L', cur, s0]);
    const c = [P[0] - din[0] * Rc + dout[0] * Rc, P[1] - din[1] * Rc + dout[1] * Rc];
    const e0 = [P[0] + dout[0] * Rc, P[1] + dout[1] * Rc];
    add(['A', s0, e0, c]);
    cur = e0;
  }
  add(['L', cur, A]);
  // sample densely along segments
  const dense = [];
  const serp = rng.range(0, 3.2);
  const serpN = rng.int(1, 3);
  for (let si = 0; si < pts2.length; si++) {
    const sg = pts2[si];
    if (sg[0] === 'L') {
      const [, a, b] = sg;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / 1));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        let x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        // serpentine on the far straight (segment index 4 = P2→P3 straight)
        if (si === 4 && L > 20) {
          const o = Math.sin(t * Math.PI * serpN) * serp * Math.sin(t * Math.PI);
          x += perp[0] * o;
          z += perp[1] * o;
        }
        dense.push([x, z]);
      }
    } else {
      const [, a, b, c] = sg;
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
      let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      let da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const n = Math.max(2, Math.ceil(Math.abs(da) * Rc));
      for (let k = 0; k < n; k++) {
        const ang = a0 + da * (k / n);
        dense.push([c[0] + Math.cos(ang) * Rc, c[1] + Math.sin(ang) * Rc]);
      }
    }
  }
  // arc length
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const S = cum[cum.length - 1];
  // Height profile h(s)
  const H0 = rng.range(style.minH || 15, style.maxH || 30);
  const H = Math.min(H0, S / 5.5);
  const sL = Math.min(S * 0.3, Math.max(24, H * 2.1));
  const sD = Math.max(20, H * 1.35);
  const feats = [];
  let pos = sL + sD;
  let hh = H * rng.range(0.45, 0.65);
  while (pos < S - 22 && hh > 2.2) {
    const Lh = Math.max(18, hh * 3.8 + rng.range(4, 10));
    if (pos + Lh > S - 16) break;
    feats.push([pos, Lh, hh]);
    pos += Lh + rng.range(0, 6);
    hh *= rng.range(0.55, 0.85);
  }
  const ss = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const base = 1.4;
  const hAt = (sv) => {
    if (sv <= sL) return 1.6 + (H - 1.6) * ss(0, sL, sv);
    if (sv <= sL + sD) return base + (H - base) * (0.5 + 0.5 * Math.cos(((sv - sL) / sD) * Math.PI));
    for (const [p0, Lh, hh2] of feats) if (sv >= p0 && sv <= p0 + Lh) return base + hh2 * (0.5 - 0.5 * Math.cos(((sv - p0) / Lh) * Math.PI * 2));
    return base;
  };
  // nodes every ~7 m
  const spacing = 7;
  const nodes = [];
  let di = 0;
  for (let sv = spacing * 1.2; sv < S - spacing * 0.8; sv += spacing) {
    while (di < cum.length - 1 && cum[di + 1] < sv) di++;
    const t = (sv - cum[di]) / ((cum[di + 1] ?? cum[di] + 1) - cum[di] || 1);
    const a = dense[di], b = dense[Math.min(dense.length - 1, di + 1)];
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    let h = hAt(sv);
    if (defensive && z < MID + DEPLOY_ROWS * TILE - 1 && sv > sL + sD * 0.6) h = Math.min(h, 1.1);
    nodes.push({ lx: x, lz: z, h });
  }
  return nodes;
}

// Raise nodes near track collisions (buildings) and retry.
export function repairDesign(game, team, station, nodes, d) {
  if (!d.hits || !d.hits.length) return nodes;
  const out = nodes.map((n) => ({ ...n }));
  const s = team === 0 ? 1 : -1;
  for (const i of d.hits) {
    const x = d.X[i] * s, z = d.Z[i] * s;
    let bi = -1, bd = 1e9;
    for (let k = 0; k < out.length; k++) {
      const dd = Math.hypot(out[k].lx - x, out[k].lz - z);
      if (dd < bd) { bd = dd; bi = k; }
    }
    if (bi >= 0 && bd < 14) {
      const lift = 13;
      for (let o = -2; o <= 2; o++) {
        const k = (bi + o + out.length) % out.length;
        const f = [0.45, 0.85, 1, 0.85, 0.45][o + 2];
        out[k].h = Math.max(out[k].h, lift * f + 1);
      }
    }
  }
  return out;
}

export function scoreDesign(d, weights) {
  if (!d.valid) return -1;
  const st = d.stats;
  const util = 0.8;
  const income = (COASTER.cars * COASTER.seatsPerCar * d.price * 60) / (st.duration + 10) * util;
  // defensive metres: low track in the deployment yard
  let lowMeters = 0;
  const s = d.team === 0 ? 1 : -1;
  for (let i = 0; i < d.n; i++) {
    const lz = d.Z[i] * s;
    if (lz < MID + DEPLOY_ROWS * TILE + 2 && d.Y[i] < 2.4) lowMeters += d.ds;
  }
  d.lowMeters = lowMeters;
  const excite = st.excitement;
  const value = income * (weights.econ ?? 1) * (0.6 + excite / 10) + lowMeters * 9 * (weights.defense ?? 0.5) + excite * 60;
  return value / Math.pow(d.cost, 0.72);
}

// Try many designs; returns {design, station, score} or null.
export function designBestCoaster(game, team, rng, opts = {}) {
  const park = game.parks[team];
  const tries = opts.tries || 40;
  const stations = stationCandidates(park, rng, Math.max(6, Math.ceil(tries / 4)));
  let best = null;
  for (let t = 0; t < tries && stations.length; t++) {
    const st = stations[t % stations.length];
    const station = { gx: st.gx, gz: st.gz, rot: st.rot, W: st.W, D: st.D };
    let nodes = generateNodes(station, rng, opts.style || {});
    if (!nodes) continue;
    let d = designTrack(game, team, station, nodes);
    for (let fix = 0; fix < 2 && !d.valid && /hits/.test(d.reason); fix++) {
      nodes = repairDesign(game, team, station, nodes, d);
      d = designTrack(game, team, station, nodes);
    }
    const sc = scoreDesign(d, opts.weights || {});
    if (sc > 0 && (!best || sc > best.score)) best = { design: d, station, score: sc, nodes: d.nodes };
  }
  return best;
}
