/**
 * What a pot's cards wear, decided on plain data and Foundry-free: the picture
 * on a back or a face and how much of the card it fills (`backArt`, `faceArt`,
 * `artTier`), and the frame, corners, foil and grime a back or a face is dressed
 * with (`backDress`, `faceDress`). The window only spreads these results into
 * its context, so every branch is reachable offline.
 *
 * A back is dressed from `backKey`, `band` and `auraBack` alone: the fields
 * `cardView` carries so that an undetected magic card's back is its plain twin's.
 * A face is dressed from what the seat is shown (`look`, `poolKey`, `kind`,
 * `artSrc`), and a masked or undetected card passes no `kind` (the item's
 * cookbook id), so it falls back to the pool and band rows.
 *
 * Book art is read through an injectable reader. Until the book-art library
 * exists the reader is `noArt`, so every card shows its lozenge or its item's own
 * picture; no art ships. The grime, foil and vignette layers paint only a
 * texture the reader finds (`textureArt`): no texture is drawn by the module.
 */
import { BAND_COUNT, POOL } from "./constants.mjs";
import { clampBand } from "./pot-logic.mjs";

/** How much of a card a picture takes: the whole card, a framed slot, or the lozenge stand-in (an svg icon, or nothing). */
export const ART_TIER = Object.freeze({ full: "full", slot: "slot", lozenge: "lozenge" });

/** The world directory pictures are uploaded into (the importer's art directory); a picture there is full art. */
export const WORLD_ART_DIR = "acks-extras-art";

/** The reader of book art until the book-art library exists: it finds nothing. */
export const noArt = () => null;

let reader = noArt;

/**
 * Wire the reader of book art: a function `({side, pool, band, kind?}) => path|null`.
 * Anything that is not a function restores `noArt`.
 */
export function setArtReader(read) {
  reader = typeof read === "function" ? read : noArt;
}

const pathOf = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bare = (path) => path.split(/[?#]/)[0];

/** Whether a picture is one Foundry or the module draws for any item: a path under core's `icons/`. */
export const isCoreDefault = (path) => bare(path).replace(/^\/+/, "").startsWith("icons/");

/** Whether a core icon that is a raster earns the framed slot like any other raster. The one place to change if it should not. */
const CORE_RASTER_SLOTS = true;

/**
 * The tier of a picture: full art for a raster under the world art directory,
 * the framed slot for any other raster, the lozenge for an svg, an unknown file
 * type or no path at all.
 */
export function artTier(path) {
  const p = pathOf(path);
  if (!p) return ART_TIER.lozenge;
  const file = bare(p);
  if (!/\.(png|jpe?g|webp|avif|gif)$/i.test(file)) return ART_TIER.lozenge;
  if (file.split("/").includes(WORLD_ART_DIR)) return ART_TIER.full;
  return isCoreDefault(file) && !CORE_RASTER_SLOTS ? ART_TIER.lozenge : ART_TIER.slot;
}

/** A picture as the template reads it: the path only where there is a raster to show, and the tier as booleans. */
function artOf(path) {
  const tier = artTier(path);
  const shown = tier !== ART_TIER.lozenge;
  return { src: shown ? pathOf(path) : null, tier, full: tier === ART_TIER.full, slot: tier === ART_TIER.slot };
}

/** What the reader finds, or null: a reader that throws or answers a non-path finds nothing. */
function read(request, from) {
  try {
    return pathOf(from(request));
  } catch {
    return null;
  }
}

/**
 * The picture on a card's back: the reader's, asked for the displayed pool and
 * the band only. A back never reads a kind or the item's own picture, so two
 * backs of one pool and band never differ by what their faces hide.
 * @param {{backKey: string, band: number}} back the fields `cardView` carries for a back
 * @param {function} [from] the reader, defaulting to the wired one
 */
export function backArt({ backKey, band }, from = reader) {
  return artOf(read({ side: "back", pool: backKey, band: clampBand(band) }, from));
}

/**
 * The picture on a turned card: the reader's, asked for the pool, band and kind
 * the seat is shown, else the item's own picture where it is not one core draws
 * for any item.
 * @param {{poolKey: string, band: number, kind: string|null, artSrc: string}} face the fields `cardView` carries for a face
 * @param {function} [from] the reader, defaulting to the wired one
 */
export function faceArt({ poolKey, band, kind, artSrc }, from = reader) {
  const found = read({ side: "face", pool: poolKey, band: clampBand(band), kind: kind ?? null }, from);
  const own = pathOf(artSrc);
  return artOf(found ?? (own && !isCoreDefault(own) ? own : null));
}

/** The textures a layer may ask the reader for, by layer. */
export const TEXTURE = Object.freeze({ grime: "grime", foil: "foil", foilMagic: "foil-magic", vignette: "vignette" });

/**
 * The texture a grime, foil or vignette layer paints, as a CSS `url()` value,
 * or null when the reader finds none, and the layer is then not rendered. The
 * reader is asked `{side: "texture", kind, band}`.
 * @param {string} kind one of `TEXTURE`
 * @param {number} band the card's band
 * @param {function} [from] the reader, defaulting to the wired one
 * @returns {string|null}
 */
export function textureArt(kind, band, from = reader) {
  const path = read({ side: "texture", kind, band: clampBand(band) }, from);
  if (!path || artTier(path) === ART_TIER.lozenge) return null;
  return `url("${path.replace(/["\\\s]/g, encodeURIComponent)}")`;
}

/**
 * How a back is dressed, by band and aura. The frame is a hairline at the lowest
 * band and a double rule above it, gold on a card whose aura is detected;
 * lozenge corners and the rich fleck join from the third band, lozenge breaks and
 * the foil at the last. A special pool's back is notched. Every ornament count
 * repeats the pips, so the band never rests on colour alone. `grime` falls with
 * the band: 3 for the lowest, 0 for the highest.
 * @param {{backKey: string, band: number, auraBack: boolean}} back
 * @returns {{className: string, frame: string, corners: boolean, breaks: boolean, foil: string, notched: boolean, grime: number}}
 */
export function backDress({ backKey, band, auraBack }) {
  const b = clampBand(band);
  const frame = auraBack ? "gold" : b === 0 ? "hair" : "double";
  const notched = backKey === POOL.special;
  const className = ["acks-porphyry", b >= 2 && "acks-porphyry--rich", `is-frame-${frame}`, notched && "is-notched"].filter(Boolean).join(" ");
  return { className, frame, corners: b >= 2, breaks: b >= BAND_COUNT - 1, foil: b >= BAND_COUNT - 1 ? "prism" : "", notched, grime: BAND_COUNT - 1 - b };
}

/**
 * How a turned card, or a Judge's tile, is dressed. The frame follows the look
 * (a hairline, a double keyline with filled corners for known magic, a heavy
 * rule with hollow corners for a curse); the foil goes on known magic and on the
 * last band, never on a curse; a curse wears a still vignette. A plain face of the lower bands is aged stock, so value reads as
 * treasure pulled from muck. A special pool's face is notched. `look` and `poolKey`
 * are what the seat is shown (`cardView`), so nothing here says more than the
 * face does.
 * @param {{look: string, band: number, poolKey: string}} face
 * @returns {{className: string, frame: string, corners: string, vignette: boolean, foil: string, aged: boolean, notched: boolean}}
 */
export function faceDress({ look, band, poolKey }) {
  const b = clampBand(band);
  const frame = look === "cursed" ? "cursed" : look === "magic" ? "magic" : "plain";
  const aged = frame === "plain" && b <= 1;
  const foil = frame === "cursed" ? "" : frame === "magic" ? "magic" : b >= BAND_COUNT - 1 ? "prism" : "";
  const notched = poolKey === POOL.special;
  const className = ["acks-parchment", aged && "acks-parchment--aged", `is-frame-${frame}`, notched && "is-notched"].filter(Boolean).join(" ");
  return {
    className,
    frame,
    corners: frame === "magic" ? "filled" : frame === "cursed" ? "hollow" : "",
    vignette: frame === "cursed",
    foil,
    aged,
    notched,
  };
}
