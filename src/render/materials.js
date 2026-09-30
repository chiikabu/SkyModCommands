// Shared materials + shader tweaks (rim light, wind sway, chasing bulbs).
import * as THREE from 'three';

export const U = {
  time: { value: 0 },
  night: { value: 0 }, // 0 day → 1 night
  rim: { value: 0.35 },
  wind: { value: 1 },
};

// Adds a soft stylised rim light to any lit material.
export function addRim(mat, strength = 1) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uRim = U.rim;
    shader.uniforms.uNight = U.night;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform float uNight;')
      .replace(
        '#include <opaque_fragment>',
        `{ float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);
           vec3 rimCol = mix(vec3(1.0, 0.93, 0.8), vec3(0.45, 0.6, 1.0), uNight);
           outgoingLight += rimCol * fres * uRim * ${strength.toFixed(2)} * (0.5 + 0.5 * (1.0 - uNight)); }
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'rim' + strength;
  return mat;
}

// Wind sway for foliage: displaces vertices by height (attribute-free).
export function addSway(mat, amount = 0.08) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uTime = U.time;
    shader.uniforms.uWind = U.wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float h = max(0.0, transformed.y);
          float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * ${amount.toFixed(3)} * h * uWind;
          transformed.x += sway;
          transformed.z += sway * 0.6;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'sway' + amount;
  return mat;
}

export function stdMat(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04, ...opts });
  return addRim(m, opts.rimStrength ?? 1);
}

export const MAT = {};
export function initMaterials() {
  MAT.vc = stdMat();
  MAT.vcShiny = stdMat({ roughness: 0.28, metalness: 0.25 });
  MAT.vcMetal = stdMat({ roughness: 0.35, metalness: 0.6 });
  MAT.vcFoliage = addSway(stdMat({ roughness: 0.8 }), 0.05);
  MAT.flag = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
  MAT.flag.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float w = max(0.0, position.x);
         transformed.z += sin(uTime * 6.0 + position.x * 3.0 + modelMatrix[3].x) * 0.12 * w;
         transformed.y += sin(uTime * 4.0 + position.x * 2.0) * 0.04 * w;`
      );
  };
  // Chasing light bulbs: brightness pattern driven by per-vertex phase.
  MAT.bulb = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uNight: U.night, uSpeed: { value: 0.6 } },
    vertexShader: `
      attribute float phase;
      attribute vec3 color;
      varying vec3 vCol;
      varying float vPhase;
      void main() {
        vCol = color;
        vPhase = phase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uNight;
      uniform float uSpeed;
      varying vec3 vCol;
      varying float vPhase;
      void main() {
        float chase = 0.55 + 0.45 * step(0.5, fract(vPhase * 3.0 - uTime * uSpeed));
        float twinkle = 0.85 + 0.15 * sin(uTime * 9.0 + vPhase * 40.0);
        float lvl = mix(1.7, 4.4, uNight) * chase * twinkle;
        gl_FragColor = vec4(vCol * lvl, 1.0);
      }`,
    toneMapped: false,
  });
  MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45 });
  MAT.window = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
  MAT.ghostOk = new THREE.MeshBasicMaterial({ color: 0x5cff8a, transparent: true, opacity: 0.45, depthWrite: false });
  MAT.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false });
  MAT.shadowBlob = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
  return MAT;
}

// Build a bulb mesh (points rendered as tiny spheres merged) from a Bulbs list.
export function bulbMesh(bulbs, radius = 0.09) {
  const base = new THREE.IcosahedronGeometry(radius, 0);
  const bp = base.attributes.position;
  const nv = bp.count;
  const n = bulbs.count;
  const pos = new Float32Array(n * nv * 3);
  const col = new Float32Array(n * nv * 3);
  const ph = new Float32Array(n * nv);
  const idx = base.index ? base.index.array : null;
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < nv; v++) {
      const o = (i * nv + v) * 3;
      pos[o] = bp.getX(v) + bulbs.pos[i * 3];
      pos[o + 1] = bp.getY(v) + bulbs.pos[i * 3 + 1];
      pos[o + 2] = bp.getZ(v) + bulbs.pos[i * 3 + 2];
      col[o] = bulbs.col[i * 3];
      col[o + 1] = bulbs.col[i * 3 + 1];
      col[o + 2] = bulbs.col[i * 3 + 2];
      ph[i * nv + v] = bulbs.phase[i];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  if (idx) {
    const I = new Uint32Array(n * idx.length);
    for (let i = 0; i < n; i++) for (let k = 0; k < idx.length; k++) I[i * idx.length + k] = idx[k] + i * nv;
    g.setIndex(new THREE.BufferAttribute(I, 1));
  }
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, MAT.bulb);
  m.frustumCulled = true;
  return m;
}
