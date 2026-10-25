/**
 * Colours as `#rrggbb` strings: a colour mixed toward white, and a stable
 * colour drawn from any text. The map overlays read a colour by its hex
 * digits, so every colour made here is one. Foundry-free.
 */

/** A `#rrggbb` colour mixed toward white by `t`, from 0 (itself) to 1 (white). */
export function lighten(hex, t) {
  const n = parseInt(String(hex).slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * t);
  const rgb = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/**
 * A stable colour for a string: a hue hashed from its characters at one
 * saturation and lightness, so a seed is the same colour on every client and
 * in every session.
 * @param {string} seed
 * @param {{saturation?: number, lightness?: number}} [opts] each from 0 to 1
 */
export function hashedColor(seed, { saturation = 0.55, lightness = 0.42 } = {}) {
  const text = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  // HSL to RGB: the chroma, and the channel each sixth of the wheel raises.
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue / 60)];
  const byte = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}
