/**
 * The Follower Card's decisions on plain data: how a weight prints, how a
 * Hit Dice rating and a damage line read, what the rank under the name says,
 * which save targets a body has, how a power's text shortens to a line, and
 * which rows are starred. `follower-card.mjs` reads an actor through these;
 * `tools/test-follower-card.mjs` pins them.
 */
import { num, signed, SAVE_KEYS, togglePin } from "./frame-model.mjs";

/** The flag that lists the item ids starred on a follower's own card. */
export const STAR_FLAG = "fcStarred";

/** The save keys a legacy actor stores under other names. */
const LEGACY_SAVE_KEYS = Object.freeze({ blast: "breath", implements: "wand" });

/**
 * A 1/6-stone weight as the printed figure: whole stones, then the sixths
 * ("3 2/6"). A purse weighs a fraction of a sixth and rounds to the nearest.
 */
export function stones(value6) {
  const n = Math.max(0, Math.round(num(value6)));
  const whole = Math.floor(n / 6);
  const sixths = n % 6;
  return sixths ? `${whole} ${sixths}/6` : String(whole);
}

/** Hit Dice as the printed card writes them: an integer, or the fraction glyph. */
export function hdText(hd) {
  const n = num(hd);
  return { 0.5: "½", 0.25: "¼", 0.125: "⅛" }[n] ?? String(n);
}

/** A damage die with a modifier appended; a blank die stays blank, a zero modifier adds nothing. */
export function withMod(dice, mod) {
  if (!dice) return "";
  const m = num(mod);
  return m ? `${dice}${signed(m)}` : `${dice}`;
}

/**
 * The line under the name: the class and its level for a body with a class,
 * the Hit Dice and the type's own name for one without, the type's name alone
 * for a body that rates neither.
 */
export function rankLine({ klass = "", level = "", hd = "", hdWord = "HD", typeLabel = "" } = {}) {
  if (klass && level !== "" && level != null) return `${klass} ${level}`;
  if (hd !== "" && hd != null) return [`${hd} ${hdWord}`, typeLabel].filter(Boolean).join(" · ");
  return klass || typeLabel || "";
}

/**
 * The five save targets in the frame's order, read from the new keys first
 * and the legacy ones a stored actor may still carry; null where the body
 * stores none of them.
 */
export function saveTargets(saves) {
  if (!saves || typeof saves !== "object") return null;
  const targets = SAVE_KEYS.map((key) => {
    const slot = saves[key] ?? saves[LEGACY_SAVE_KEYS[key]];
    return slot == null ? null : num(slot.value ?? slot);
  });
  return targets.some((t) => t != null) ? targets.map((t) => t ?? 0) : null;
}

/** Five targets as one line, dot-separated. */
export function savesLine(targets) {
  return (targets ?? []).map(String).join(" · ");
}

/**
 * The number-appearing formulas a body stores, as `{check, formula}` in the
 * order dungeon (`d`), wilderness (`w`); a side with no formula is left out.
 */
export function appearingSides(appearing) {
  return [["d", "dungeon"], ["w", "wilderness"]]
    .map(([key, check]) => ({ check, formula: String(appearing?.[key] ?? "").trim() }))
    .filter((side) => side.formula);
}

/**
 * Prose shortened to one line: tags and entities gone, whitespace folded,
 * cut at the first sentence end past the floor or at the ceiling with an
 * ellipsis.
 */
export function oneLine(text, { max = 72, min = 24 } = {}) {
  const plain = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const stop = plain.slice(0, max).search(/[.;!?](?=\s)/);
  const cut = stop >= min ? plain.slice(0, stop + 1) : plain.slice(0, max).replace(/\s+\S*$/, "");
  return cut.length < plain.length ? `${cut.trimEnd()}…` : cut;
}

/** The rows a starred-id list picks out of a list of `{id}` rows, in the list's order. */
export function starredRows(rows, starredIds) {
  const ids = new Set(starredIds ?? []);
  return (rows ?? []).filter((r) => ids.has(r.id));
}

/** Star or unstar one id; the pin toggle, which answers a new list. */
export const toggleStar = togglePin;
