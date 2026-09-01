/**
 * One terrain vocabulary, reconciled.
 *
 * The book names the same country differently from table to table — the
 * movement multipliers say "Grassland, scrubland", the aerial search clause
 * says "clear, grass, scrub… barren", the foraging targets say "clear", and
 * the encounter tables say "Grassland (any)". They are the same places.
 *
 * The engine keys terrain by the movement table's names, because that is the
 * table every speed derivation already brackets on. So every binder that reads
 * terrain names out of PROSE passes them through here first, and a forage
 * target printed for "clear" reaches a party standing in "grassland".
 *
 * This is naming, not content: no target, modifier or rate is decided here.
 * What each terrain is WORTH still comes off the page. A name the map does not
 * know is passed through unchanged rather than dropped — an unrecognized
 * terrain should reach the registry as itself, where a Judge can see it, not
 * vanish into a table that silently lacks a row.
 */

/**
 * Prose spelling → the movement table's key. Both spellings are kept in the
 * output, so a world whose own terrain vocabulary uses the book's other name
 * still matches.
 */
const ALIASES = Object.freeze({
  clear: "grassland",
  grass: "grassland",
  grasslands: "grassland",
  scrub: "scrubland",
  scrublands: "scrubland",
  barren: "barrens",
  deserts: "desert",
  forests: "forest",
  woods: "forest",
  hill: "hills",
  mountain: "mountains",
  jungles: "jungle",
  swamps: "swamp",
});

/** One prose terrain name → the engine's key for it. */
export function terrainKey(name) {
  const key = String(name ?? "").trim().toLowerCase();
  return ALIASES[key] ?? key;
}

/**
 * A list of prose terrain names → the engine's keys, with the printed spelling
 * kept alongside. Membership tests then match either, and a `targets` map
 * carries a row under both names.
 */
export function terrainKeys(names) {
  const out = [];
  for (const name of names ?? []) {
    const printed = String(name ?? "").trim().toLowerCase();
    if (!printed) continue;
    out.push(printed);
    const key = terrainKey(printed);
    if (key !== printed) out.push(key);
  }
  return [...new Set(out)];
}

/**
 * Re-key a `{terrain: value}` map, keeping the printed spelling too.
 *
 * Both are kept because the two vocabularies are both real: a world may use
 * the book's other name for a terrain, and a row under only one of them would
 * read as "not imported" to half of them.
 */
export function keyTerrainMap(map) {
  if (!map || typeof map !== "object") return map;
  const out = {};
  for (const [name, value] of Object.entries(map)) {
    out[name] = value;
    const key = terrainKey(name);
    if (key !== name) out[key] = value;
  }
  return out;
}
