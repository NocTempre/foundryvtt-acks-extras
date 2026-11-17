/**
 * Treasure-table assembly: the raw Judges Journal reads of the `treasure`
 * document (`table-recipes-treasure.mjs`) become the tables the Ruledata
 * Browser projects as RollTables. The raw tables keep the page's shape, two of
 * the special-treasure lists in two segments; this step joins the segments,
 * reads each row's band, and splits the treasure types' first cell into its
 * category and average value. Nothing ships: every band edge, name and figure
 * is read from the Judge's own copy, and a table whose bands do not tile from 1
 * with no gap or overlap is not assembled, so a lost row never reads as a
 * smaller die.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { TYPE_LETTERS } from "./table-recipes-treasure.mjs";

/** The registry document the treasure tables are read into. */
export const TREASURE_DOC_ID = "treasure";

/** The special-treasure lists: each kind of lot, and the raw segments it is read from, top to bottom. */
export const SPECIAL_RAW_KEYS = Object.freeze({
  cp: ["specialCpRaw", "specialCpMoreRaw"],
  sp: ["specialSpRaw"],
  ep: ["specialEpRaw"],
  gp: ["specialGpRaw", "specialGpMoreRaw"],
  pp: ["specialPpRaw"],
  ornamental: ["specialOrnamentalRaw"],
  gem: ["specialGemRaw", "specialGemMoreRaw"],
  brilliant: ["specialBrilliantRaw"],
  trinket: ["specialTrinketRaw"],
  jewelry: ["specialJewelryRaw"],
  regalia: ["specialRegaliaRaw"],
});

/** The raw treasure-type grids and the engine table each becomes. */
export const TYPE_RAW_KEYS = Object.freeze({ typeClassicRaw: "typeClassic", typeHeroicRaw: "typeHeroic" });

/** The raw band lists whose rows carry a value and a type, and the engine table each becomes. */
export const VALUE_RAW_KEYS = Object.freeze({ gemValueRaw: "gemValue", jewelryValueRaw: "jewelryValue" });

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [TREASURE_DOC_ID]: {
    ...Object.fromEntries(Object.entries(TYPE_RAW_KEYS).map(([raw, key]) => [key, raw])),
    ...Object.fromEntries(Object.entries(VALUE_RAW_KEYS).map(([raw, key]) => [key, raw])),
    special: Object.values(SPECIAL_RAW_KEYS).flat(),
  },
});

/** A cell's text, whitespace folded; null when nothing is left. */
const clean = (cell) => String(cell ?? "").replace(/\s+/g, " ").trim() || null;

/**
 * A band list's text: the small-caps initial a drop cap leaves lower-case rises,
 * and nothing else is changed.
 */
const sentence = (cell) => {
  const s = clean(cell);
  return s && s.replace(/^./, (c) => c.toUpperCase());
};

/** Whether ascending bands start at 1 and meet with no gap and no overlap. */
const tiles = (bands) => bands.length > 0 && bands[0].min === 1 && bands.every((b, i) => b.min <= b.max && (i === 0 || b.min === bands[i - 1].max + 1));

/**
 * The bands of one or more raw segments, ascending, each carrying the fields
 * `read` makes of its row. Null unless the bands tile from 1.
 *
 * @param {object[]} segments raw tables, in the order the page sets them
 * @param {(row: object) => object|null} read a row's fields; null drops the row
 */
export function assembleBands(segments, read) {
  const bands = [];
  for (const raw of segments) {
    for (const row of Object.values(raw ?? {})) {
      if (!row || !Number.isFinite(row.min) || !Number.isFinite(row.max)) continue;
      const fields = read(row);
      if (fields) bands.push({ min: row.min, max: row.max, ...fields });
    }
  }
  bands.sort((a, b) => a.min - b.min);
  return tiles(bands) ? bands : null;
}

/**
 * A treasure-type row's first cell, the category and the average value
 * stacked, as `{category, avgValue}`; the value is null where the cell holds
 * none, and the whole cell is the category.
 */
export function splitTypeHead(cell) {
  const s = clean(cell);
  if (!s) return { category: null, avgValue: null };
  const m = /^(.*?)\s*([\d,]+\s*gp)$/i.exec(s);
  return m ? { category: m[1] || null, avgValue: m[2].replace(/\s+/g, "") } : { category: s, avgValue: null };
}

/**
 * One raw treasure-type grid → `{<letter>: {category, avgValue, cp, sp, ep,
 * gp, pp, gems, jewelry, magic}}`, each cell the page's text. A letter whose
 * row the page did not yield is left out; null when none was.
 */
export function assembleTypes(raw) {
  const out = {};
  for (const letter of TYPE_LETTERS) {
    const row = raw?.[letter];
    if (!row || row.__missing) continue;
    const { head, ...cells } = row;
    out[letter] = { ...splitTypeHead(head), ...Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, clean(v)])) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The treasure tables from the raw ones. Pure. Each table assembles
 * independently, so a partial import still yields what its pages held.
 */
export function assembleTreasureTables(raw = {}) {
  const out = {};
  for (const [rawKey, key] of Object.entries(TYPE_RAW_KEYS)) {
    const table = assembleTypes(raw[rawKey]);
    if (table) out[key] = table;
  }
  for (const [rawKey, key] of Object.entries(VALUE_RAW_KEYS)) {
    const bands = assembleBands([raw[rawKey]], (r) => (clean(r.value) && clean(r.type) ? { value: clean(r.value), type: sentence(r.type) } : null));
    if (bands) out[key] = { bands };
  }
  const special = {};
  for (const [kind, rawKeys] of Object.entries(SPECIAL_RAW_KEYS)) {
    const bands = assembleBands(rawKeys.map((k) => raw[k]), (r) => (clean(r.text) ? { result: sentence(r.text) } : null));
    if (bands) special[kind] = bands;
  }
  if (Object.keys(special).length) out.special = special;
  return out;
}

/**
 * Merge the engine-shaped tables into the imported `treasure` doc. Raw tables
 * stay beside the assembled ones, so a re-import grows the doc instead of
 * replacing it.
 */
export async function applyTreasureImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(TREASURE_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleTreasureTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(assembledDoc(doc, engine, PRODUCES[TREASURE_DOC_ID]), { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: Object.keys(engine) };
}
