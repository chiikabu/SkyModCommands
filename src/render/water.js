// Stylised water: layered waves, depth colouring from the terrain heightfield,
// shoreline foam, fresnel sky reflection and sun glints.
import * as THREE from 'three';
import { MAP_X, MAP_Z } from '../sim/world.js';
import { WATER_LEVEL } from '../config.js';
import { U } from './materials.js';

export function createWater(world, sunDir) {
  // heightfield texture (downsampled 2 m)
  const w = Math.floor(world.nx / 2), h = Math.floor(world.nz / 2);
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = world.h[j * 2 * world.nx + i * 2];
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: U.time,
      uNight: U.night,
      uHeight: { value: tex },
      uSunDir: { value: sunDir },
      uMap: { value: new THREE.Vector4(-MAP_X, -MAP_Z, MAP_X * 2, MAP_Z * 2) },
      uLevel: { value: WATER_LEVEL },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    },
    fog: true,
    vertexShader: `
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uNight;
      uniform sampler2D uHeight;
      uniform vec3 uSunDir;
      uniform vec4 uMap;
      uniform float uLevel;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 p = vWPos.xz;
        // wave normal from a few travelling sines + noise
        float t = uTime;
        vec2 grad = vec2(0.0);
        grad += vec2(0.6, 0.3) * cos(dot(p, vec2(0.12, 0.06)) + t * 1.1) * 0.35;
        grad += vec2(-0.3, 0.7) * cos(dot(p, vec2(-0.05, 0.14)) + t * 1.4) * 0.3;
        grad += vec2(0.2, -0.5) * cos(dot(p, vec2(0.21, -0.17)) + t * 2.1) * 0.18;
        float nn = vnoise(p * 0.7 + t * 0.4) - vnoise(p * 0.7 - t * 0.35 + 3.0);
        grad += vec2(nn) * 0.25;
        vec3 n = normalize(vec3(-grad.x * 0.35, 1.0, -grad.y * 0.35));
        vec3 v = normalize(cameraPosition - vWPos);
        // depth from terrain
        vec2 uv = (p - uMap.xy) / uMap.zw;
        float th = -8.0;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) th = texture2D(uHeight, uv).r;
        float depth = max(0.0, uLevel - th);
        vec3 shallow = vec3(0.18, 0.78, 0.78);
        vec3 deep = vec3(0.03, 0.26, 0.5);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 4.5, depth));
        // sky reflection via fresnel
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 skyCol = mix(vec3(0.62, 0.8, 1.0), vec3(0.05, 0.07, 0.16), uNight);
        col = mix(col, skyCol, 0.25 + fres * 0.6);
        // sun / moon glint
        vec3 L = normalize(uNight > 0.5 ? vec3(-uSunDir.x, 0.5, -uSunDir.z) : uSunDir);
        vec3 hv = normalize(L + v);
        float spec = pow(max(dot(n, hv), 0.0), 180.0);
        col += mix(vec3(1.0, 0.95, 0.8), vec3(0.6, 0.7, 1.0), uNight) * spec * mix(2.2, 0.8, uNight);
        // shoreline foam
        float foamN = vnoise(p * 1.3 + t * 0.8);
        float foam = smoothstep(0.55, 0.0, depth) * smoothstep(0.35, 0.75, foamN + 0.35 * sin(depth * 8.0 - t * 2.5));
        col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
        col *= mix(1.0, 0.28, uNight);
        float alpha = mix(0.55, 0.96, smoothstep(0.0, 2.0, depth));
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.renderOrder = 1;
  return mesh;
}
