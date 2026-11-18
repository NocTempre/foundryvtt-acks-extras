/**
 * Treasure-table assembly: the raw Judges Journal reads of the `treasure`
 * document (`table-recipes-treasure.mjs`) become the tables the Ruledata
 * Browser projects as RollTables. The raw tables keep the page's shape, two of
 * the special-treasure lists in two segments; this step joins the segments,
 * reads each row's band, and splits the treasure types' first cell into its
 * category and average value. Beside those it keeps the coin columns' unit
 * (`typeUnits`), each special list's lot unit read off its caption
 * (`specialPer`) and the dice legends above the gem and jewelry value lists
 * (`gemDice`, `jewelryDice`), which a generator needs and a RollTable cannot
 * express. Each legend row names the special list it stands for (`list`), read
 * from the lists' own captions, and the one band of a gem or jewelry list that
 * leaves the lot as it was is marked (`keep`), so a consumer pairs and picks
 * by structure and not by order or wording. Nothing ships: every band edge, name and figure
 * is read from the Judge's own copy, and a table whose bands do not tile from 1
 * with no gap or overlap is not assembled, so a lost row never reads as a
 * smaller die.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { TYPE_LETTERS } from "./table-recipes-treasure.mjs";
import { foldLabel, holdsKey, printKey } from "./printed-name.mjs";

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
export const TYPE_RAW_KEYS = Object.freeze({ typeClassicRaw: "typeClassic", typeHeroicRaw: "typeHeroic", typeGrittyRaw: "typeGritty" });

/** The raw band lists whose rows carry a value and a type, and the engine table each becomes. */
export const VALUE_RAW_KEYS = Object.freeze({ gemValueRaw: "gemValue", jewelryValueRaw: "jewelryValue" });

/** The raw unit lines printed under each treasure-type grid's coin columns, and the grid each belongs to. */
export const UNIT_RAW_KEYS = Object.freeze({ typeClassicUnitsRaw: "classic", typeHeroicUnitsRaw: "heroic", typeGrittyUnitsRaw: "gritty" });

/** The raw dice legends printed above the value lists, and the engine table each becomes. */
export const DICE_RAW_KEYS = Object.freeze({ gemDiceRaw: "gemDice", jewelryDiceRaw: "jewelryDice" });

/**
 * The special lists each dice legend's rows stand for, in the page's order: a
 * legend row is tagged with one of these by its kind (`legendListOf`).
 */
export const LEGEND_LISTS = Object.freeze({
  gemDice: Object.freeze(["ornamental", "gem", "brilliant"]),
  jewelryDice: Object.freeze(["trinket", "jewelry", "regalia"]),
});

/** The coin columns a unit line sits under. */
const COIN_KEYS = Object.freeze(["cp", "sp", "ep", "gp", "pp"]);

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [TREASURE_DOC_ID]: {
    ...Object.fromEntries(Object.entries(TYPE_RAW_KEYS).map(([raw, key]) => [key, raw])),
    ...Object.fromEntries(Object.entries(VALUE_RAW_KEYS).map(([raw, key]) => [key, raw])),
    ...Object.fromEntries(Object.entries(DICE_RAW_KEYS).map(([raw, key]) => [key, raw])),
    special: Object.values(SPECIAL_RAW_KEYS).flat(),
    specialPer: Object.values(SPECIAL_RAW_KEYS).map((keys) => keys[0]),
    typeUnits: Object.keys(UNIT_RAW_KEYS),
  },
});

/** A cell's text, whitespace folded; null when nothing is left. */
export const clean = (cell) => String(cell ?? "").replace(/\s+/g, " ").trim() || null;

/**
 * A band list's text: the small-caps initial a drop cap leaves lower-case rises,
 * and nothing else is changed.
 */
export const sentence = (cell) => {
  const s = clean(cell);
  return s && s.replace(/^./, (c) => c.toUpperCase());
};

/** Whether ascending bands start at 1 and meet with no gap and no overlap. */
export const tiles = (bands) => bands.length > 0 && bands[0].min === 1 && bands.every((b, i) => b.min <= b.max && (i === 0 || b.min === bands[i - 1].max + 1));

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
 * none, and the whole cell is the category. The value may be bracketed, as the
 * Treasure Tome prints it; the brackets are not kept.
 */
export function splitTypeHead(cell) {
  const s = clean(cell);
  if (!s) return { category: null, avgValue: null };
  const m = /^(.*?)\s*\(?([\d,]+\s*gp)\)?$/i.exec(s);
  const raised = (t) => t.replace(/^./, (c) => c.toUpperCase());
  return m ? { category: m[1] ? raised(m[1]) : null, avgValue: m[2].replace(/\s+/g, "") } : { category: raised(s), avgValue: null };
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
  const captions = captionKinds(raw);
  const legends = {};
  for (const [rawKey, key] of Object.entries(DICE_RAW_KEYS)) {
    const legend = assembleLegend(raw[rawKey], { group: LEGEND_LISTS[key], captions });
    if (legend) legends[key] = legend;
  }
  for (const list of Object.values(LEGEND_LISTS).flat()) {
    const bands = special[list];
    const candidates = bands ? keepCandidates(bands, kindFormsOf(list, Object.values(legends).flat(), captions)) : [];
    if (candidates.length === 1) candidates[0].keep = true;
  }
  if (Object.keys(special).length) out.special = special;
  const per = assembleSpecialPer(raw);
  if (per) out.specialPer = per;
  const units = assembleTypeUnits(raw);
  if (units) out.typeUnits = units;
  for (const [key, legend] of Object.entries(legends)) out[key] = { legend };
  return out;
}

/**
 * The spellings one printed kind goes by, folded: itself and its other number.
 * A legend names a kind in one number and a list's caption or a result may use
 * the other.
 */
export function numberForms(kind) {
  const k = foldLabel(kind);
  if (!k) return [];
  const forms = new Set([k]);
  if (k.endsWith("ies")) forms.add(`${k.slice(0, -3)}y`);
  else if (/(?:s|x|ch|sh)es$/.test(k)) forms.add(k.slice(0, -2));
  else if (k.endsWith("s")) forms.add(k.slice(0, -1));
  if (!k.endsWith("s")) forms.add(/(?:x|ch|sh)$/.test(k) ? `${k}es` : /[^aeiou]y$/.test(k) ? `${k.slice(0, -1)}ies` : `${k}s`);
  return [...forms];
}

/**
 * The kind each gem or jewelry list's caption names, `{<list>: text}`: what
 * follows "per" in the caption, less the bracketed figure that closes it. A
 * list whose caption was not read is left out.
 */
export function captionKinds(raw = {}) {
  const per = assembleSpecialPer(raw) ?? {};
  const out = {};
  for (const list of Object.values(LEGEND_LISTS).flat()) {
    const kind = per[list]?.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (kind) out[list] = kind;
  }
  return out;
}

/**
 * Which special list one legend row's kind is, by the captions: `{list}`, or
 * `{why}` when none can be named. The kind is matched to the caption of each
 * list of its legend, singular or plural; the match must be the only one and
 * must be the list at the row's own place in the legend. A row that matches
 * none, matches two, or matches a list other than its place's is left
 * untagged: a place alone never names a list.
 *
 * @param {string} kind the legend row's printed kind
 * @param {string[]} group the legend's lists, in the page's order
 * @param {number} index the row's place in the legend
 * @param {{[list: string]: string}} captions `captionKinds`
 * @returns {{list: string}|{why: "no-caption"|"ambiguous"|"position"}}
 */
export function legendListOf(kind, group, index, captions) {
  const mine = new Set(numberForms(kind));
  const hits = group.filter((list) => numberForms(captions?.[list]).some((f) => mine.has(f)));
  if (hits.length !== 1) return { why: hits.length ? "ambiguous" : "no-caption" };
  return group[index] === hits[0] ? { list: hits[0] } : { why: "position" };
}

/** The foldings of every kind name a gem or jewelry list goes by: the legend row tagged with it and its caption, both numbers. */
export function kindFormsOf(list, legendRows, captions) {
  const row = (legendRows ?? []).find((r) => r.list === list);
  return row ? [...new Set([...numberForms(row.kind), ...numberForms(captions?.[list])])] : [];
}

/**
 * The bands of a gem or jewelry list whose result is a lot of one of the
 * list's own kind, which leaves the lot as it was. Such a result opens on a
 * bare count of one (not a dice expression) and holds the kind, in either
 * number, as a word of its own, any bracketed note aside. Nothing is matched
 * when no kind is known.
 *
 * @param {object[]} bands the list's bands
 * @param {string[]} forms `kindFormsOf`
 */
export function keepCandidates(bands, forms) {
  const keys = forms.map((f) => printKey(f)).filter(Boolean);
  return (bands ?? []).filter((b) => {
    const rest = /^1\s+(.+)$/.exec(String(b.result ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())?.[1];
    return !!rest && keys.some((key) => holdsKey(rest, key));
  });
}

/**
 * The lot unit each special-treasure list is rolled per, `{<kind>: text}`: what
 * follows "per" in the caption the page opens the list with, as printed. A list
 * whose caption was not read is left out; null when none was.
 */
export function assembleSpecialPer(raw = {}) {
  const out = {};
  for (const [kind, rawKeys] of Object.entries(SPECIAL_RAW_KEYS)) {
    const label = clean(raw[rawKeys[0]]?.caption?.label);
    const per = label && /\bper\s+(.+)$/i.exec(label)?.[1];
    if (per) out[kind] = per;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The unit printed under the coin columns of each treasure-type grid,
 * `{classic|heroic|gritty: {cp, sp, ep, gp, pp}}`, each cell as printed. A grid whose
 * unit line was not read is left out; null when none was.
 */
export function assembleTypeUnits(raw = {}) {
  const out = {};
  for (const [rawKey, grid] of Object.entries(UNIT_RAW_KEYS)) {
    const row = raw[rawKey]?.units;
    if (!row || row.__missing) continue;
    const cells = Object.fromEntries(COIN_KEYS.map((c) => [c, clean(row[c])]).filter(([, v]) => v));
    if (Object.keys(cells).length) out[grid] = cells;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A value list's dice legend, `[{dice, avg, kind, list?}]` in the page's order:
 * the dice each kind of lot is rolled on, the average it comes to and the kind,
 * as printed, and `list`, the special list the kind names (`legendListOf`),
 * where `group` and `captions` are given and the captions settle it. Null when
 * no row was read.
 *
 * @param {object} raw the raw legend table
 * @param {{group?: string[], captions?: object}} [by] the legend's lists in order, and `captionKinds`
 */
export function assembleLegend(raw, { group, captions } = {}) {
  const rows = Object.values(raw ?? {})
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r && !r.__missing && clean(r.label) && clean(r.type))
    .map(({ r, i }) => {
      const row = { dice: clean(r.label), avg: clean(r.avg), kind: clean(r.type) };
      const named = group && captions ? legendListOf(row.kind, group, i, captions) : null;
      return named?.list ? { ...row, list: named.list } : row;
    });
  return rows.length ? rows : null;
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
