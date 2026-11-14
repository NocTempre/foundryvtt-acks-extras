/**
 * The pinned pixel path for a picture read: pdf.js's decoded samples to grey,
 * scaled by an integer factor, written as a PGM that the engine reads with no
 * canvas between. Integer arithmetic only, so every seat — browser or Node —
 * produces the same bytes from the same samples.
 */

/** pdf.js ImageKind values. */
const KIND = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 };

/**
 * One grey byte per pixel from a pdf.js image object (`{ width, height, kind,
 * data }`). Rec. 601 luma in 10-bit fixed point; a 1-bit image is black or
 * white.
 */
export function toGrey({ width, height, kind, data }) {
  const out = new Uint8Array(width * height);
  if (kind === KIND.RGB_24BPP || kind === KIND.RGBA_32BPP) {
    const step = kind === KIND.RGB_24BPP ? 3 : 4;
    for (let i = 0, j = 0; i < out.length; i++, j += step) out[i] = (306 * data[j] + 601 * data[j + 1] + 117 * data[j + 2] + 512) >> 10;
  } else if (kind === KIND.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = data[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
  } else throw new Error(`unsupported image kind ${kind}`);
  return out;
}

/**
 * Bilinear upscale by integer factor `k`, pixel centres aligned, edges
 * clamped. Weights are exact rationals over 2k, so the result is integer
 * arithmetic throughout.
 */
export function scaleUp(grey, width, height, k) {
  const W = width * k, H = height * k, d = 2 * k, dd = d * d, half = dd >> 1;
  const xs0 = new Int32Array(W), xs1 = new Int32Array(W), xw = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const n = 2 * x + 1 - k;
    const i = Math.floor(n / d);
    xw[x] = n - i * d;
    xs0[x] = Math.min(width - 1, Math.max(0, i));
    xs1[x] = Math.min(width - 1, Math.max(0, i + 1));
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const n = 2 * y + 1 - k;
    const j = Math.floor(n / d);
    const fy = n - j * d;
    const r0 = Math.min(height - 1, Math.max(0, j)) * width;
    const r1 = Math.min(height - 1, Math.max(0, j + 1)) * width;
    for (let x = 0; x < W; x++) {
      const fx = xw[x], a = xs0[x], b = xs1[x];
      const top = grey[r0 + a] * (d - fx) + grey[r0 + b] * fx;
      const bot = grey[r1 + a] * (d - fx) + grey[r1 + b] * fx;
      out[y * W + x] = (top * (d - fy) + bot * fy + half) / dd | 0;
    }
  }
  return { grey: out, width: W, height: H };
}

/** A binary PGM (P5) of a grey buffer. */
export function toPgm(grey, width, height) {
  const head = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(head.length + grey.length);
  out.set(head, 0);
  out.set(grey, head.length);
  return out;
}
