// Compact deterministic 3D value-noise + fBm, used to give celestial bodies procedural surface
// detail (displacement + colour mottling) without any texture assets. Deterministic (hash-based, no
// Math.random) so a body always generates the same terrain.

function hash3(i: number, j: number, k: number): number {
  let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = (n * 1274126177) | 0;
  return ((n & 0x7fffffff) % 100000) / 100000; // 0..1
}

const fade = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);

  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  const y0 = lerp(x00, x10, v), y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w); // 0..1
}

// Fractal Brownian motion — layered value noise. Returns roughly 0..1.
export function fbm(x: number, y: number, z: number, octaves = 5): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
