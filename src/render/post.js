// Post-processing: HDR MSAA render → bloom → tilt-shift → tone map → grade/vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 1.0 },
    uFocus: { value: 0.52 },
    uBand: { value: 0.22 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uAmount;
    uniform float uFocus;
    uniform float uBand;
    varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - uFocus) - uBand);
      float r = d * uAmount * 9.0;
      vec4 base = texture2D(tDiffuse, vUv);
      if (r < 0.05) { gl_FragColor = base; return; }
      vec4 acc = vec4(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float rr = sqrt(float(i) + 0.5) / sqrt(12.0);
        vec2 off = vec2(cos(a), sin(a)) * rr * r / uRes * 4.0;
        acc += texture2D(tDiffuse, vUv + off);
        wsum += 1.0;
      }
      gl_FragColor = mix(base, acc / wsum, clamp(r, 0.0, 1.0));
    }`,
};

const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSat: { value: 1.12 },
    uContrast: { value: 1.04 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSat;
    uniform float uContrast;
    uniform vec4 uFlash;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      // warm highlights, cool shadows
      col += vec3(0.02, 0.01, -0.01) * smoothstep(0.5, 1.0, l) - vec3(0.0, -0.004, -0.02) * (1.0 - smoothstep(0.0, 0.4, l));
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette * 2.2;
      col *= v;
      col = mix(col, uFlash.rgb, uFlash.a);
      // subtle film grain
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.012;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createPost(renderer, scene, camera, quality) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples: quality >= 1 ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.82);
  composer.addPass(bloom);
  const tilt = new ShaderPass(TiltShift);
  composer.addPass(tilt);
  const output = new OutputPass();
  composer.addPass(output);
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  return {
    composer, bloom, tilt, grade, renderPass,
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      tilt.uniforms.uRes.value.set(w, h);
    },
  };
}
