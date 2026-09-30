// Procedural sky dome: gradient, sun/moon, drifting fbm clouds, stars.
import * as THREE from 'three';
import { U } from './materials.js';

export function createSky() {
  const geo = new THREE.SphereGeometry(1400, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: U.time,
      uNight: U.night,
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float sunH = uSunDir.y;
        // day palette
        vec3 dayTop = vec3(0.16, 0.42, 0.86);
        vec3 dayHor = vec3(0.70, 0.86, 1.0);
        // sunset palette
        vec3 setTop = vec3(0.22, 0.24, 0.55);
        vec3 setHor = vec3(1.0, 0.55, 0.32);
        // night palette
        vec3 nTop = vec3(0.015, 0.02, 0.07);
        vec3 nHor = vec3(0.06, 0.08, 0.2);
        float sunset = smoothstep(0.35, 0.0, abs(sunH - 0.05)) * (1.0 - uNight);
        vec3 top = mix(mix(dayTop, setTop, sunset), nTop, uNight);
        vec3 hor = mix(mix(dayHor, setHor, sunset), nHor, uNight);
        float t = pow(max(h, 0.0), 0.55);
        vec3 col = mix(hor, top, t);
        // below horizon: fade to a hazy ground colour
        col = mix(col, hor * 0.8, smoothstep(0.0, -0.15, d.y));
        // sun glow + disc
        float sd = max(dot(d, uSunDir), 0.0);
        vec3 sunCol = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.55, 0.25), sunset);
        col += sunCol * pow(sd, 12.0) * 0.45 * (1.0 - uNight);
        col += sunCol * smoothstep(0.9993, 0.9997, sd) * 6.0 * (1.0 - uNight);
        // moon (opposite-ish)
        vec3 moonDir = normalize(vec3(-uSunDir.x, abs(uSunDir.y) + 0.35, -uSunDir.z));
        float md = max(dot(d, moonDir), 0.0);
        col += vec3(0.75, 0.85, 1.0) * (smoothstep(0.9990, 0.9994, md) * 2.5 + pow(md, 60.0) * 0.25) * uNight;
        // stars
        if (d.y > 0.0) {
          vec2 sp = d.xz / (d.y + 0.25) * 120.0;
          float st = hash(floor(sp));
          float twk = 0.6 + 0.4 * sin(uTime * 3.0 + st * 60.0);
          col += vec3(1.0) * step(0.9965, st) * smoothstep(0.45, 1.0, fract(sp.x) * fract(sp.y) * 4.0) * twk * uNight * 1.6 * smoothstep(0.0, 0.2, d.y);
        }
        // clouds (projected on a dome)
        if (d.y > 0.01) {
          vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = fbm(cp);
          float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.0, 0.18, d.y);
          vec3 cDay = mix(vec3(1.0), vec3(1.0, 0.72, 0.55), sunset);
          vec3 cNight = vec3(0.14, 0.16, 0.26);
          vec3 cCol = mix(cDay, cNight, uNight);
          float shade = 0.75 + 0.25 * smoothstep(0.5, 0.9, fbm(cp * 1.7 + 3.1));
          col = mix(col, cCol * shade, cov * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
