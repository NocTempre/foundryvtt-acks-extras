/**
 * Overlapping encounter zones composed into one answer, field by field.
 *
 * A party can stand in several zones at once — a wood drawn over a whole
 * valley and a hollow drawn inside it. Each field is answered by the SMALLEST
 * zone that states it, so a narrow zone refines a wide one without having to
 * repeat what the wide one already says. A zero or an empty value states
 * nothing and leaves the field to the next zone out. Two zones of equal area
 * are taken in the order given, first first.
 *
 * Pure: areas and fields in, the composed fields and their sources out. The
 * Foundry side (which regions, how large) is `zones.mjs` and
 * `encounter-zone.mjs`.
 */

/**
 * The fields a zone composes, each at the value that states nothing: what a
 * party standing in no zone reads.
 */
export const ZONE_FIELD_DEFAULTS = Object.freeze({
  tableUuid: "",
  encounterTarget: 0,
  journeyCadence: "",
  dayThrows: 0,
  nightThrows: 0,
});

/** Whether a field's value says anything: a non-zero number for a number field, a non-blank string otherwise. */
const states = (key, value) =>
  typeof ZONE_FIELD_DEFAULTS[key] === "number"
    ? Number.isFinite(Number(value)) && Number(value) !== 0
    : typeof value === "string" && value.trim() !== "";

/**
 * The area enclosed by one closed ring of `[x, y, x, y, …]` points, by the
 * shoelace sum. Always positive, whichever way the ring winds; a ring of
 * fewer than three points encloses nothing.
 */
export function polygonArea(ring) {
  const pts = Array.isArray(ring) ? ring : [];
  const n = Math.floor(pts.length / 2);
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  const area = Math.abs(twice) / 2;
  return Number.isFinite(area) ? area : 0;
}

/**
 * Compose stacked zones. Each layer is `{area, fields, …}`; anything else a
 * layer carries (its region, its behaviour) rides along untouched so the
 * caller can name what answered.
 *
 * @param {Array<{area: number, fields: object}>} layers  in document order
 * @returns {{fields: object, sources: object}} `fields` holds every key of
 *   `ZONE_FIELD_DEFAULTS`, each the smallest stating layer's value or the
 *   default; `sources` maps each key to the layer that supplied it, or null.
 *   A layer whose area is not a finite number sorts after every measured one.
 */
export function composeZones(layers = []) {
  const ordered = (Array.isArray(layers) ? layers : [])
    .map((layer, index) => ({ layer, index, area: Number.isFinite(Number(layer?.area)) ? Number(layer.area) : Infinity }))
    .sort((a, b) => a.area - b.area || a.index - b.index);
  const fields = { ...ZONE_FIELD_DEFAULTS };
  const sources = Object.fromEntries(Object.keys(ZONE_FIELD_DEFAULTS).map((key) => [key, null]));
  for (const key of Object.keys(ZONE_FIELD_DEFAULTS)) {
    const hit = ordered.find(({ layer }) => states(key, layer?.fields?.[key]));
    if (!hit) continue;
    const value = hit.layer.fields[key];
    fields[key] = typeof ZONE_FIELD_DEFAULTS[key] === "number" ? Number(value) : String(value).trim();
    sources[key] = hit.layer;
  }
  return { fields, sources };
}

/**
 * The distinct layers that supplied any field of a composition, in the order
 * of `ZONE_FIELD_DEFAULTS`.
 */
export function sourceLayers(composed) {
  const out = [];
  for (const layer of Object.values(composed?.sources ?? {})) {
    if (layer && !out.includes(layer)) out.push(layer);
  }
  return out;
}
