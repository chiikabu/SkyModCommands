// Terrain mesh + painterly ground shader (lawns, dirt, sand, rock, paths, overlays).
import * as THREE from 'three';
import { MAP_X, MAP_Z } from '../sim/world.js';
import { HALF_W, MID, PARK_LZ0, PARK_LZ1, GRID_W, TERR_ROWS, TILE, DEPLOY_ROWS, TEAM_COLORS } from '../config.js';
import { U } from './materials.js';

const PT_W = GRID_W; // path texture covers x ∈ [-HALF_W, HALF_W]
const PT_H = Math.round((PARK_LZ1 * 2) / TILE); // z ∈ [-PARK_LZ1, PARK_LZ1]

export function createTerrain(world, quality = 1) {
  const step = quality >= 2 ? 1.5 : 2;
  const sx = Math.round((MAP_X * 2) / step), sz = Math.round((MAP_Z * 2) / step);
  const geo = new THREE.PlaneGeometry(MAP_X * 2, MAP_Z * 2, sx, sz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, world.heightAt(x, z));
  }
  geo.computeVertexNormals();
  geo.deleteAttribute('uv');

  // Path data texture (R = path, updated when paths change)
  const pathData = new Uint8Array(PT_W * PT_H * 4);
  const pathTex = new THREE.DataTexture(pathData, PT_W, PT_H, THREE.RGBAFormat);
  pathTex.magFilter = THREE.NearestFilter;
  pathTex.minFilter = THREE.NearestFilter;
  pathTex.needsUpdate = true;

  const uniforms = {
    uTime: U.time,
    uNight: U.night,
    uPath: { value: pathTex },
    uGrid: { value: 0 },
    uZones: { value: 0 },
    uMyTeam: { value: 0 },
    uTeam0: { value: new THREE.Color(TEAM_COLORS[0].main) },
    uTeam1: { value: new THREE.Color(TEAM_COLORS[1].main) },
    uHighlight: { value: new THREE.Vector4(0, 0, 0, 0) }, // x0,z0,x1,z1 (world) build footprint
    uHighlightOk: { value: 1 },
    uFog: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uTime;
        uniform float uNight;
        uniform sampler2D uPath;
        uniform float uGrid;
        uniform float uZones;
        uniform float uMyTeam;
        uniform vec3 uTeam0;
        uniform vec3 uTeam1;
        uniform vec4 uHighlight;
        uniform float uHighlightOk;
        uniform float uFog;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; } return s; }
        float pathAt(vec2 cell) {
          if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= ${PT_W}.0 || cell.y >= ${PT_H}.0) return 0.0;
          return texture2D(uPath, (cell + 0.5) / vec2(${PT_W}.0, ${PT_H}.0)).r;
        }
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 wp = vWPos;
          float n1 = fbm(wp.xz * 0.06);
          float n2 = fbm(wp.xz * 0.35 + 7.0);
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          vec3 grassA = vec3(0.16, 0.36, 0.07);
          vec3 grassB = vec3(0.27, 0.47, 0.1);
          vec3 grass = mix(grassA, grassB, n1);
          grass *= 0.88 + 0.24 * n2;
          float ax = abs(wp.x), az = abs(wp.z);
          // mowed lawn stripes inside the parks
          float inPark = step(ax, ${HALF_W.toFixed(1)}) * step(${PARK_LZ0.toFixed(1)}, az) * step(az, ${PARK_LZ1.toFixed(1)});
          float stripes = step(0.5, fract(wp.x / 8.0));
          grass = mix(grass, grass * mix(0.9, 1.1, stripes) + vec3(0.02, 0.04, 0.0), inPark * 0.9);
          // worn dirt in no-man's land
          float nml = step(ax, ${(HALF_W + 4).toFixed(1)}) * (1.0 - smoothstep(${(MID - 3).toFixed(1)}, ${(MID + 2).toFixed(1)}, az));
          float dirtMask = smoothstep(0.45, 0.7, fbm(wp.xz * 0.09 + 3.0)) * nml;
          vec3 dirt = mix(vec3(0.33, 0.23, 0.13), vec3(0.42, 0.31, 0.19), n2);
          vec3 col = mix(grass, dirt, dirtMask * 0.85);
          // sand + rock
          float core = step(ax, ${(HALF_W + 7).toFixed(1)}) * step(az, ${(PARK_LZ1 + 10).toFixed(1)});
          float sand = smoothstep(0.45, -0.2, wp.y) * (1.0 - core);
          col = mix(col, vec3(0.76, 0.66, 0.44) * (0.92 + 0.12 * n2), sand);
          col = mix(col, vec3(0.45, 0.43, 0.4) * (0.85 + 0.3 * n2), smoothstep(0.35, 0.6, slope));
          col = mix(col, vec3(0.3, 0.32, 0.36), smoothstep(-2.0, -4.0, wp.y));
          // paths (tile texture, rounded corners, cobbles)
          vec2 cell = vec2((wp.x + ${HALF_W.toFixed(1)}) / ${TILE.toFixed(1)}, (wp.z + ${PARK_LZ1.toFixed(1)}) / ${TILE.toFixed(1)});
          vec2 ci = floor(cell);
          vec2 cf = fract(cell);
          float p0 = pathAt(ci);
          float pm = 0.0;
          if (p0 > 0.5) {
            float l = pathAt(ci + vec2(-1, 0)), r = pathAt(ci + vec2(1, 0)), d = pathAt(ci + vec2(0, -1)), u = pathAt(ci + vec2(0, 1));
            float e = 0.12;
            float m = 1.0;
            if (l < 0.5) m *= smoothstep(0.0, e, cf.x);
            if (r < 0.5) m *= smoothstep(1.0, 1.0 - e, cf.x);
            if (d < 0.5) m *= smoothstep(0.0, e, cf.y);
            if (u < 0.5) m *= smoothstep(1.0, 1.0 - e, cf.y);
            pm = m;
          }
          if (pm > 0.0) {
            vec2 cp = wp.xz * 1.6;
            vec2 cpi = floor(cp + vec2(0.5 * step(1.0, mod(floor(cp.y), 2.0)), 0.0));
            vec2 cpf = fract(cp + vec2(0.5 * step(1.0, mod(floor(cp.y), 2.0)), 0.0));
            float edge = smoothstep(0.0, 0.12, cpf.x) * smoothstep(1.0, 0.88, cpf.x) * smoothstep(0.0, 0.14, cpf.y) * smoothstep(1.0, 0.86, cpf.y);
            vec3 stone = mix(vec3(0.62, 0.5, 0.4), vec3(0.74, 0.63, 0.52), h21(cpi));
            stone *= 0.78 + 0.22 * edge;
            col = mix(col, stone, pm);
            col = mix(col, vec3(0.55, 0.47, 0.4), (1.0 - pm) * step(0.01, pm) * 0.5);
          }
          // deployment zones / territory tints
          if (uZones > 0.01 && ax < ${HALF_W.toFixed(1)}) {
            float dz0 = step(${MID.toFixed(1)}, wp.z) * step(wp.z, ${(MID + DEPLOY_ROWS * TILE).toFixed(1)});
            float dz1 = step(${MID.toFixed(1)}, -wp.z) * step(-wp.z, ${(MID + DEPLOY_ROWS * TILE).toFixed(1)});
            float edgeStripe = step(0.5, fract((wp.x + wp.z) * 0.25 - uTime * 0.3));
            float bord0 = dz0 * (1.0 - smoothstep(0.0, 0.8, min(min(wp.z - ${MID.toFixed(1)}, ${(MID + DEPLOY_ROWS * TILE).toFixed(1)} - wp.z), ${HALF_W.toFixed(1)} - ax)));
            float bord1 = dz1 * (1.0 - smoothstep(0.0, 0.8, min(min(-wp.z - ${MID.toFixed(1)}, ${(MID + DEPLOY_ROWS * TILE).toFixed(1)} + wp.z), ${HALF_W.toFixed(1)} - ax)));
            col = mix(col, uTeam0 * 0.9 + 0.1, dz0 * 0.22 * uZones + bord0 * 0.6 * uZones * edgeStripe);
            col = mix(col, uTeam1 * 0.9 + 0.1, dz1 * 0.22 * uZones + bord1 * 0.6 * uZones * edgeStripe);
          }
          // build grid
          if (uGrid > 0.01 && ax < ${HALF_W.toFixed(1)} && az > ${MID.toFixed(1)} && az < ${PARK_LZ1.toFixed(1)}) {
            float mine = (uMyTeam < 0.5) ? step(0.0, wp.z) : step(wp.z, 0.0);
            vec2 g = abs(fract(wp.xz / ${TILE.toFixed(1)} + 0.5 * vec2(0.0, 0.0)) - 0.5);
            float line = 1.0 - smoothstep(0.44, 0.49, max(g.x, g.y));
            line = 1.0 - line;
            col = mix(col, vec3(1.0), line * 0.28 * uGrid * mine);
          }
          // footprint highlight
          if (uHighlight.z > uHighlight.x) {
            float inside = step(uHighlight.x, wp.x) * step(wp.x, uHighlight.z) * step(uHighlight.y, wp.z) * step(wp.z, uHighlight.w);
            vec3 hc = uHighlightOk > 0.5 ? vec3(0.3, 1.0, 0.5) : vec3(1.0, 0.3, 0.3);
            col = mix(col, hc, inside * 0.45);
          }
          diffuseColor.rgb = col;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;

  function updatePaths(game) {
    pathData.fill(0);
    for (let team = 0; team < 2; team++) {
      const park = game.parks[team];
      const s = team === 0 ? 1 : -1;
      for (let gz = 0; gz < TERR_ROWS; gz++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          if (park.tiles[gz * GRID_W + gx] !== -1) continue;
          const lx = -HALF_W + (gx + 0.5) * TILE, lz = MID + (gz + 0.5) * TILE;
          const x = lx * s, z = lz * s;
          const px = Math.floor((x + HALF_W) / TILE), pz = Math.floor((z + PARK_LZ1) / TILE);
          if (px < 0 || pz < 0 || px >= PT_W || pz >= PT_H) continue;
          pathData[(pz * PT_W + px) * 4] = 255;
        }
      }
    }
    pathTex.needsUpdate = true;
  }
  return { mesh, uniforms, updatePaths };
}
