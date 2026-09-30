// Team helpers: local <-> world transforms (team 1 is rotated 180° about the origin).
import { TILE, HALF_W, MID, GRID_W, TERR_ROWS, DEPLOY_ROWS, PARK_LZ0, PARK_LZ1 } from '../config.js';

export const sgn = (team) => (team === 0 ? 1 : -1);
export const toWorldX = (team, lx) => lx * sgn(team);
export const toWorldZ = (team, lz) => lz * sgn(team);
export const toLocalX = (team, x) => x * sgn(team);
export const toLocalZ = (team, z) => z * sgn(team);
// Heading (radians) pointing from this team toward the enemy.
export const forwardHeading = (team) => (team === 0 ? Math.PI : 0);

export const tileCenterLX = (gx) => -HALF_W + (gx + 0.5) * TILE;
export const tileCenterLZ = (gz) => MID + (gz + 0.5) * TILE;
export const tileOfLX = (lx) => Math.floor((lx + HALF_W) / TILE);
export const tileOfLZ = (lz) => Math.floor((lz - MID) / TILE);
export const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < GRID_W && gz < TERR_ROWS;
export const inPark = (gx, gz) => gx >= 0 && gx < GRID_W && gz >= DEPLOY_ROWS && gz < TERR_ROWS;
export const inDeploy = (gx, gz) => gx >= 0 && gx < GRID_W && gz >= 0 && gz < DEPLOY_ROWS;

// Which team's territory is a world point in? (-1 = no man's land)
export function territoryOf(x, z) {
  if (Math.abs(x) > HALF_W + 2) return -1;
  if (z > MID) return 0;
  if (z < -MID) return 1;
  return -1;
}
export function localDepth(team, z) {
  return z * sgn(team);
}
export function inOwnPark(team, x, z) {
  const lz = z * sgn(team);
  return lz >= PARK_LZ0 && lz <= PARK_LZ1 + 6 && Math.abs(x) <= HALF_W + 1;
}
export function inOwnTerritory(team, x, z) {
  const lz = z * sgn(team);
  return lz >= MID - 1 && Math.abs(x) <= HALF_W + 2;
}
