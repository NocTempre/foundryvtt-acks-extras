/**
 * One terrain vocabulary, reconciled: the book names the same country
 * differently from table to table.
 *
 * The engine keys terrain by the movement table's names, the table every speed
 * derivation brackets on, so every binder that reads terrain names out of
 * PROSE passes them through here first.
 *
 * This is naming, not content: no target, modifier or rate is decided here. A
 * name the map does not know passes through unchanged, so it reaches the
 * registry as itself.
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
 * Re-key a `{terrain: value}` map, keeping the printed spelling too, so a
 * world using either vocabulary finds its row.
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
