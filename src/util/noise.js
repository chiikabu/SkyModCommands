// Value/gradient noise helpers used for terrain + cosmetics (deterministic).
const PERM = new Uint8Array(512);
(function init() {
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

export function perlin2(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x);
  const v = fade(y);
  const a = PERM[X] + Y;
  const b = PERM[X + 1] + Y;
  const n00 = grad(PERM[a], x, y);
  const n10 = grad(PERM[b], x - 1, y);
  const n01 = grad(PERM[a + 1], x, y - 1);
  const n11 = grad(PERM[b + 1], x - 1, y - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 0.7071;
}

export function fbm2(x, y, oct = 4) {
  let a = 0.5,
    f = 1,
    s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
