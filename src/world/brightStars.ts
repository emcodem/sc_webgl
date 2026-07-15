// Real starfield data: the Yale Bright Star Catalog (BSC5), 9096 stars down to visual magnitude
// ~8. Sourced from https://github.com/brettonw/YaleBrightStarCatalog (bsc5-short.json, verbatim in
// data/) and parsed here into GPU-ready attribute arrays: unit direction on the celestial sphere,
// plus a per-star size / brightness (from visual magnitude) and RGB colour (from the catalogue's
// blackbody colour temperature K). render/meshes.ts::createStarfield consumes these.
//
// The absolute orientation of the sky in the game world is arbitrary (the render layer just anchors
// this sphere to the camera) — what matters is that the *relative* positions are real, so actual
// constellations appear with their true shapes.

// `?raw` keeps the catalogue out of the typechecker's literal-type machinery (a 9096-element JSON
// object would balloon tsc); we parse the text ourselves, which is a sub-millisecond one-off.
import catalogText from './data/bsc5-short.json?raw';

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

interface RawStar { RA: string; Dec: string; V?: string; K?: string }

const RA_RE = /(\d+)h\s*(\d+)m\s*([\d.]+)s/;
const DEC_RE = /([+-])\s*(\d+)\D+?(\d+)\D+?(\d+)/;
const DEG2RAD = Math.PI / 180;

// Visual-magnitude → visual-weight mapping. Brighter stars have *smaller* magnitudes; the catalogue
// spans ~-1.5 (Sirius) to ~8. We normalise to 0 (faintest) .. 1 (brightest) then bias so only the
// genuinely bright stars grow large — matching how a real sky reads as mostly faint pinpricks.
const MAG_BRIGHTEST = -1.5;
const MAG_FAINTEST = 8.0;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Blackbody colour-temperature (Kelvin) → linear-ish RGB, Tanner Helland's well-known approximation.
// Cool stars (~2300K) come out orange-red, the Sun (~5800K) near-white, hot O/B stars (>10000K)
// blue-white — the familiar stellar palette.
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
  out[o] = clamp01(r / 255);
  out[o + 1] = clamp01(g / 255);
  out[o + 2] = clamp01(b / 255);
}

export function loadBrightStars(radius: number): BrightStars {
  const raw: RawStar[] = JSON.parse(catalogText);
  const count = raw.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const bright = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  let n = 0;
  for (let i = 0; i < count; i++) {
    const s = raw[i];
    const ra = RA_RE.exec(s.RA);
    const dec = DEC_RE.exec(s.Dec);
    if (!ra || !dec) continue; // skip any malformed row rather than poison the buffer

    const raDeg = (parseInt(ra[1]) + parseInt(ra[2]) / 60 + parseFloat(ra[3]) / 3600) * 15;
    const decMag = parseInt(dec[2]) + parseInt(dec[3]) / 60 + parseInt(dec[4]) / 3600;
    const decDeg = (dec[1] === '-' ? -1 : 1) * decMag;
    const raRad = raDeg * DEG2RAD;
    const decRad = decDeg * DEG2RAD;
    const cosDec = Math.cos(decRad);

    const p = n * 3;
    positions[p] = radius * cosDec * Math.cos(raRad);
    positions[p + 1] = radius * Math.sin(decRad);
    positions[p + 2] = radius * cosDec * Math.sin(raRad);

    const mag = s.V !== undefined ? parseFloat(s.V) : MAG_FAINTEST;
    const w = clamp01((MAG_FAINTEST - mag) / (MAG_FAINTEST - MAG_BRIGHTEST));
    sizes[n] = 1.0 + 6.0 * w * w;      // faint ~1px, Sirius ~7px
    bright[n] = 0.28 + 0.72 * Math.pow(w, 1.2);

    const kelvin = s.K !== undefined && s.K !== '' ? parseFloat(s.K) : 5800;
    kelvinToRgb(kelvin, colors, p);
    n++;
  }

  return {
    count: n,
    positions: positions.subarray(0, n * 3),
    sizes: sizes.subarray(0, n),
    bright: bright.subarray(0, n),
    colors: colors.subarray(0, n * 3)
  };
}
