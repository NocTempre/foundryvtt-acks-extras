/**
 * What a container will take — the kinds a Judge ticks on the Details tab, and
 * how a candidate item is read against them. Pure; the item is a plain shape
 * (`type`, `name`, `baseType`, `clothing`, `ammo`, `chart`).
 *
 * The kinds are this module's own classification vocabulary — the same
 * standing as the base-type keys — not a table read off a page. Nothing ticked
 * means the container takes anything that fits; a wrong drop is refused with
 * the container's own wording, which is data on the container rather than a
 * string here.
 */

/** The kinds, in the order the chips render. */
export const ACCEPT_KINDS = Object.freeze([
  "weapons", "armor", "clothing", "spellPages", "scrolls", "maps", "keys",
  "liquids", "coin", "gems", "rations", "ammunition", "tools",
]);

/** The fallback refusal, used when the container has no wording of its own. */
export const DEFAULT_REFUSAL_KEY = "refusalDefault";

const NAME = {
  keys: /\bkeys?\b/i,
  scrolls: /\bscrolls?\b/i,
  spellPages: /\bspell\s*pages?\b|\bleaves\b|\bfolio\b|\bvellum\b|\bparchment\b/i,
  maps: /\bmaps?\b|\bcharts?\b/i,
  liquids: /\bflasks?\b|\bvials?\b|\bpotions?\b|\boil\b|\bwine\b|\bwater\s*skin|\bwineskin|\bale\b|\bholy water\b/i,
  rations: /\brations?\b|\bfood\b|\bbread\b|\bmeat\b|\bcheese\b|\bprovisions?\b/i,
  tools: /\btools?\b|\bcrowbar\b|\bshovel\b|\bspikes?\b|\bchisel\b|\bsaw\b|\bkit\b|\bpick\b|\bmallet\b|\bgrapnel\b|\bgrappling\b/i,
};

/**
 * Every kind a candidate reads as. A set, because one thing can be several —
 * a silver arrow is a weapon and ammunition, a potion is a liquid in a flask.
 * @param {{type?:string, name?:string, baseType?:string|null, clothing?:boolean, ammo?:boolean, chart?:boolean}} c
 * @returns {Set<string>}
 */
export function kindsOf(c = {}) {
  const out = new Set();
  const name = String(c.name ?? "");
  if (c.type === "weapon" || c.baseType === "weapon") out.add("weapons");
  if (c.type === "armor" || c.baseType === "armour" || c.baseType === "shield") out.add("armor");
  if (c.clothing || c.baseType === "clothing") out.add("clothing");
  if (c.type === "money" || c.baseType === "coin") out.add("coin");
  if (c.baseType === "gem") out.add("gems");
  if (c.baseType === "food") out.add("rations");
  if (c.ammo) out.add("ammunition");
  if (c.chart) out.add("maps");
  for (const [kind, re] of Object.entries(NAME)) if (re.test(name)) out.add(kind);
  return out;
}

/**
 * Does a container whose ticked kinds are `accepts` take a candidate reading
 * as `kinds`? Nothing ticked takes anything.
 */
export function acceptsKinds(accepts, kinds) {
  const list = Array.isArray(accepts) ? accepts.filter((k) => ACCEPT_KINDS.includes(k)) : [];
  if (!list.length) return true;
  for (const k of list) if (kinds.has(k)) return true;
  return false;
}

/** The accepted list, cleaned to known kinds in canonical order. */
export const cleanAccepts = (accepts) => ACCEPT_KINDS.filter((k) => Array.isArray(accepts) && accepts.includes(k));
