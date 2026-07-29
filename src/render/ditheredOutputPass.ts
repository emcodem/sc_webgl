import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ============================================================================================
// Final output pass with output-domain dithering.
//
// WHY THIS EXISTS. Everything upstream of here is high precision: the EffectComposer's scene
// targets and UnrealBloomPass's whole mip chain are HalfFloatType, so the sun's glare falloff is
// computed as a genuinely smooth gradient. But the canvas's default framebuffer is 8 bits per
// channel, so the last write — this pass — quantizes that gradient to 256 levels. A wide, shallow
// ramp (the sun's halo fading into the near-black 0x05070a background, an atmosphere shell's
// fresnel rim) then crosses each code value over tens of pixels, and every crossing is a visible
// contour ring: banding.
//
// It is display-dependent, which is why it can look fine on one monitor and awful on another. A
// typical LCD's backlight bleed, limited contrast and panel noise smear the low-end steps together;
// an OLED reproduces each code value exactly against a true-black floor, so the same 1/255 step is
// clearly resolved. The banding was always in the signal — a good panel just stops hiding it.
//
// THE FIX is not more precision (an 8-bit canvas is what the platform gives us) but breaking up the
// quantizer: add sub-LSB noise before the hardware rounds, so a pixel whose exact value sits between
// two code values lands on either one with probability proportional to how close it is. The band
// edge becomes a stochastic mix of the two neighbouring codes instead of a hard step, and the eye
// integrates it back into a smooth ramp. Same trick as audio dither, same reason.
//
// Two details that make it actually work:
//   - It runs AFTER tone mapping and the sRGB transfer, in the same nonlinear domain the hardware
//     quantizes in. Dithering linear values would misjudge the step size badly — the sRGB curve is
//     steepest near black, exactly where the sun's halo bands.
//   - The noise is TRIANGULAR-PDF (two independent uniform samples subtracted), spanning +/-1 LSB
//     rather than +/-1/2. Flat (rectangular) noise at half an LSB leaves the quantization error
//     correlated with the signal, so faint banding survives; TPDF fully decorrelates it. This is
//     strictly more visible as noise than flat dither, but at one code value of amplitude it sits
//     below the display's own noise floor — and on a high-DPR canvas each dither sample is a
//     fraction of a CSS pixel.
//
// The noise field is static (a function of gl_FragCoord only, no time uniform): a fixed
// high-frequency pattern reads as film grain at worst and, unlike animated dither, does not shimmer
// when the camera holds still — and keeps headless verification screenshots deterministic.
// ============================================================================================

// TPDF noise: two INDEPENDENT uniform samples per pixel, subtracted.
//
// The independence is the whole ballgame, and it is easy to get wrong. This first used interleaved
// gradient noise, ign(p) = fract(K * fract(dot(p, k))), sampled twice as ign(p) - ign(p + offset).
// That is broken: a constant offset merely adds a constant to the inner dot product, so the second
// tap is a PHASE SHIFT of the first rather than an independent draw — fract(a + c) against fract(a).
// Their difference collapses to two outcomes (measured: 12 distinct values, 65% at -0.35 / 35% at
// +0.65, sd 0.476 instead of TPDF's 0.408). That is binary dither, and it cannot decorrelate the
// quantizer at any amplitude: it visibly scrambles pixels — enough to make naive plateau-length and
// adjacent-pixel-difference metrics look cured — while leaving the sun's halo contours standing.
// IGN is a low-discrepancy ORDERED pattern meant to be sampled once per pixel; it is not a
// white-noise source you can take two draws from.
//
// hash12 (Dave Hoskins' well-travelled shader hash, same family as the sun's own hash13 in
// render/meshes.ts) has an avalanche step — p3 += dot(p3, p3.yzx + 33.33) — that genuinely
// decorrelates offset inputs. Measured over 200x200 px: 12,265 distinct values, sd 0.410 against
// the ideal sqrt(2/12) = 0.408, and a clean triangular histogram. Verified by float32 emulation of
// this exact GLSL, and then visually on the GPU (see the sun-halo check in the commit message).
const DITHER_GLSL = /* glsl */`
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // Triangular PDF over [-1, 1], peaked at 0 — the difference of two independent uniforms.
  float tpdfDither(vec2 p) {
    return hash12(p) - hash12(p + vec2(17.31, 71.97));
  }
`;

// Same #ifdef names as three's own OutputShader, because the inherited OutputPass.render() sets
// material.defines from the renderer's tone mapping / output color space every time either changes.
// Overwriting the source (rather than string-patching three's) keeps this readable and independent
// of that file's exact whitespace, at the cost of having to track its structure across upgrades.
const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  uniform sampler2D tDiffuse;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  varying vec2 vUv;

  ${DITHER_GLSL}

  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);

    #ifdef LINEAR_TONE_MAPPING
      gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
    #elif defined( REINHARD_TONE_MAPPING )
      gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
    #elif defined( CINEON_TONE_MAPPING )
      gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
    #elif defined( AGX_TONE_MAPPING )
      gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
    #elif defined( NEUTRAL_TONE_MAPPING )
      gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
    #endif

    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif

    // ...and only now, in the encoded domain the framebuffer rounds in, break up the quantizer.
    gl_FragColor.rgb += tpdfDither(gl_FragCoord.xy) * uDitherAmount;
  }`;

// One 8-bit code value. Scaling this down weakens the dither (banding returns); scaling it up just
// adds visible grain without flattening the steps any further, since one LSB of TPDF already fully
// decorrelates the error. Exposed as a uniform so it can be dialled from the console
// (`__renderer` -> composer passes) while judging a panel, and set to 0 to see the raw banding.
export const DITHER_AMOUNT = 1 / 255;

export class DitheredOutputPass extends OutputPass {
  constructor(amount = DITHER_AMOUNT) {
    super();
    const mat = this.material as THREE.RawShaderMaterial;
    mat.uniforms.uDitherAmount = { value: amount };
    // declared here rather than in FRAGMENT_SHADER's body so the uniform block stays at the top
    mat.fragmentShader = FRAGMENT_SHADER.replace(
      'uniform sampler2D tDiffuse;',
      'uniform sampler2D tDiffuse;\n  uniform float uDitherAmount;'
    );
    mat.needsUpdate = true;
  }
}
