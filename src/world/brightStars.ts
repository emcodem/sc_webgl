// Real starfield data: the Yale Bright Star Catalog (BSC5), 9096 stars down to visual magnitude
// ~8, sourced from https://github.com/brettonw/YaleBrightStarCatalog. The raw catalogue lives in
// data/ (verbatim, for provenance) but is NOT bundled — scripts/genBrightStars.mjs bakes only the
// fields we draw into the compact brightStarsData.ts, which we decode here into GPU-ready attribute
// arrays: unit direction on the celestial sphere, plus per-star size / brightness (from visual
// magnitude) and RGB colour (from the catalogue's blackbody colour temperature K).
// render/meshes.ts::createStarfield consumes these.
//
// The absolute orientation of the sky in the game world is arbitrary (the render layer just anchors
// this sphere to the camera) — what matters is that the *relative* positions are real, so actual
// constellations appear with their true shapes.

import { BRIGHT_STARS, RA_SCALE, DEC_SCALE, MAG_SCALE } from './brightStarsData';

export interface BrightStars {
  count: number;
  /** xyz unit direction per star, length count*3 */
  positions: Float32Array;
  /** point size per star (GPU pixels @ dpr 1) */
  sizes: Float32Array;
  /** brightness 0..1 per star */
  bright: Float32Array;
  /** rgb 0..1 per star, length count*3 */
  colors: Float32Array;
}

const DEG2RAD = Math.PI / 180;

// Visual-magnitude → visual-weight mapping. Brighter stars have *smaller* magnitudes; the catalogue
// spans ~-1.5 (Sirius) to ~8 (the naked-eye limit). MAG_BRIGHTEST is pushed past Sirius so no single
// star maxes out the size/brightness curve, and MAG_CUTOFF trims the faintest tail — both tuned by
// eye via a temporary slider panel (since removed).
const MAG_BRIGHTEST = -3.0;
const MAG_CUTOFF = 6.6;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Blackbody colour-temperature (Kelvin) → linear-ish RGB, Tanner Helland's well-known approximation.
// Cool stars (~2300K) come out orange-red, the Sun (~5800K) near-white, hot O/B stars (>10000K)
// blue-white — the familiar stellar palette. The raw approximation is realistically desaturated
// (most stars cluster close to white), which reads as bland at render scale; SATURATION_BOOST
// pushes each channel away from the grey midpoint (NASA's "Eyes on the Solar System" does the same
// artistic amplification so constellations show visible colour instead of uniform white pinpricks).
const SATURATION_BOOST = 2.2;

function kelvinToRgb(kelvin: number, out: Float32Array, o: number): void {
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  let rn = clamp01(r / 255);
  let gn = clamp01(g / 255);
  let bn = clamp01(b / 255);

  const luma = 0.3 * rn + 0.59 * gn + 0.11 * bn;
  rn = clamp01(luma + (rn - luma) * SATURATION_BOOST);
  gn = clamp01(luma + (gn - luma) * SATURATION_BOOST);
  bn = clamp01(luma + (bn - luma) * SATURATION_BOOST);

  out[o] = rn;
  out[o + 1] = gn;
  out[o + 2] = bn;
}

export function loadBrightStars(radius: number): BrightStars {
  const { ra, dec, mag, k } = BRIGHT_STARS;

  const kept: number[] = [];
  for (let i = 0; i < ra.length; i++) {
    if (mag[i] / MAG_SCALE <= MAG_CUTOFF) kept.push(i);
  }

  const count = kept.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const bright = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  for (let j = 0; j < count; j++) {
    const i = kept[j];
    const raRad = (ra[i] / RA_SCALE) * DEG2RAD;
    const decRad = (dec[i] / DEC_SCALE) * DEG2RAD;
    const cosDec = Math.cos(decRad);

    const p = j * 3;
    positions[p] = radius * cosDec * Math.cos(raRad);
    positions[p + 1] = radius * Math.sin(decRad);
    positions[p + 2] = radius * cosDec * Math.sin(raRad);

    const m = mag[i] / MAG_SCALE;
    const w = clamp01((MAG_CUTOFF - m) / (MAG_CUTOFF - MAG_BRIGHTEST));
    sizes[j] = 2.5 + 14.0 * Math.pow(w, 1.5);  // faintest ~2.5px, Sirius ~16.5px — a wide spread so
                                                // brightness differences actually read as size too
    bright[j] = 0.35 + 0.65 * Math.pow(w, 1.1);

    kelvinToRgb(k[i], colors, p);
  }

  return { count, positions, sizes, bright, colors };
}
