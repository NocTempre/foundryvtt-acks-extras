/**
 * Magic-item table assembly: the raw Judges Journal reads of the
 * `magicItemTables` document (`table-recipes-magic-items.mjs`) become the
 * tables the Ruledata Browser projects as RollTables. The raw tables keep the
 * page's shape, a list set across two columns or pages in segments and a tail of
 * the d100 printed as inner bands under an outer face; this step joins the
 * segments, reads each row's band, nests the inner bands under their face and
 * records, for every row, which table of the document its words name. Nothing
 * ships: every band edge, name and caption is read from the Judge's own copy,
 * and a table whose bands do not tile from 1 with no gap or overlap is not
 * assembled, so a lost row never reads as a smaller die.
 *
 * A row names a table when its folded words (`printKey`) are the folded caption
 * the page printed over that table, and only then: the Random Type list's rows
 * are the hops into the category lists, and no other row is matched by guess.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc, joinCites } from "./produces.mjs";
import { printKey } from "./printed-name.mjs";
import { clean, sentence, tiles } from "./treasure-binding.mjs";

/** The registry document the magic-item tables are read into. */
export const MAGIC_ITEM_DOC_ID = "magicItemTables";

/**
 * Each table of the document as `{table: {column: raw segments in page order}}`.
 * A table of one column is `bands`; a set of lists rolled on dice of their own
 * is one column per list. The column key is the list's id, and the id a hop
 * names is `<table>.<column>`.
 */
export const LISTS = Object.freeze({
  classicType: { bands: ["randomTypeRaw"] },
  classic: {
    potions: ["potionsRaw", "potionsMoreRaw"],
    rings: ["ringsRaw"],
    scrolls: ["scrollsRaw", "scrollsMoreRaw"],
    implements: ["implementsRaw"],
    misc: ["miscRaw", "miscMoreRaw"],
    swords: ["swordsRaw"],
    armors: ["armorsRaw"],
    weapons: ["weaponsRaw", "weaponsMoreRaw"],
  },
  heroic: {
    common: ["heroicCommonRaw"],
    uncommon: ["heroicUncommonRaw", "heroicUncommonMoreRaw"],
    rare: ["heroicRareRaw", "heroicRareMoreRaw"],
    veryRare: ["heroicVeryRareRaw", "heroicVeryRareMoreRaw"],
    legendary: ["heroicLegendaryRaw"],
  },
  scrollLanguages: { bands: ["scrollLanguagesRaw"] },
  scrollSpellLevels: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`col${n}`, [`spellLevel${n}Raw`]])),
  treasureMaps: {
    contents: ["mapContentsRaw"],
    clueSpecifics: ["clueSpecificsRaw"],
    clueConcealment: ["clueConcealmentRaw"],
    clueCode: ["clueCodeRaw"],
  },
  creatureType: { bands: ["creatureTypeRaw", "creatureTypeMoreRaw"] },
});

/** The tables whose rows may name another list of the document. */
const HOPPING = Object.freeze(["classicType"]);

/** The setting-appropriate arms grids and the raw table each is read from. */
export const ARMS_RAW_KEYS = Object.freeze({
  armsArmor: "armorTypeRaw",
  armsAmmo: "ammoTypeRaw",
  armsAxe: "axeTypeRaw",
  armsBludgeon: "bludgeonTypeRaw",
  armsBow: "bowTypeRaw",
  armsSpear: "spearTypeRaw",
  armsSword: "swordTypeRaw",
  armsOther: "otherTypeRaw",
});

/** The number of setting columns every arms grid prints. */
export const SETTING_COLUMNS = 7;

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [MAGIC_ITEM_DOC_ID]: {
    ...Object.fromEntries(Object.entries(LISTS).map(([table, columns]) => [table, Object.values(columns).flat()])),
    ...ARMS_RAW_KEYS,
    captions: Object.values(LISTS).flatMap((columns) => Object.values(columns).map((keys) => keys[0])),
    listCites: Object.values(LISTS).flatMap((columns) => Object.values(columns).flat()),
    armsSettings: Object.values(ARMS_RAW_KEYS),
  },
});

/** A band cell's text as the page prints it ("a-b" or "n"); null for a dash or nothing. */
export function bandOf(cell) {
  const t = clean(cell);
  const m = t && /^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(t);
  return m ? { min: +m[1], max: +(m[2] ?? m[1]) } : null;
}

/** An item's name as the page prints it, the small-capital initials of a bracketed marker raised. */
const itemText = (cell) => {
  const s = sentence(cell);
  return s && s.replace(/\[([a-z]{1,3})\]/g, (m) => m.toUpperCase());
};

/** The cell fields of a raw row, read as text; `item` is an item's name. */
function fieldsOf(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (["min", "max", "parent", "sub", "label", "__missing"].includes(key)) continue;
    const text = key === "item" ? itemText(value) : clean(value);
    if (text) out[key] = text;
  }
  return out;
}

/**
 * The bands of one or more raw segments, ascending. A row is a main band, an
 * inner band of a tail group, or a bare outer face (a label with no cells).
 * After the main bands, each group of inner bands that restarts at 1 hangs from
 * the next outer face, which the page also prints on one line of the group or
 * beside every line of it; a printed face that is not the one the order gives
 * refuses the table. Null unless the main bands and faces tile from 1 and every
 * group's inner bands tile from 1.
 *
 * @param {object[]} segments raw tables, in the order the page sets them
 */
export function assembleNested(segments) {
  const main = [];
  const groups = [];
  let group = null;
  let pendingFace = null;
  const open = () => {
    group = { faces: new Set(), subs: [] };
    if (pendingFace != null) group.faces.add(pendingFace);
    pendingFace = null;
    groups.push(group);
  };
  for (const raw of segments) {
    for (const row of Object.values(raw ?? {})) {
      if (!row || row.__missing || !Number.isFinite(row.min) || !Number.isFinite(row.max)) continue;
      const fields = fieldsOf(row);
      const text = Object.keys(fields).length > 0;
      if (row.parent != null) {
        if (!group || (group.faces.size && !group.faces.has(row.parent)) || (group.subs.at(-1) && row.sub.min <= group.subs.at(-1).max)) open();
        group.faces.add(row.parent);
        group.subs.push({ min: row.sub.min, max: row.sub.max, ...fields });
        continue;
      }
      if (!text) {
        // A bare outer face: it sits among the inner bands it belongs to.
        if (group) group.faces.add(row.min);
        else pendingFace = row.min;
        continue;
      }
      const last = main.at(-1)?.max ?? 0;
      if (!group && row.min === last + 1) {
        main.push({ min: row.min, max: row.max, ...fields });
        continue;
      }
      if (!group || row.min <= group.subs.at(-1).max) open();
      group.subs.push({ min: row.min, max: row.max, ...fields });
    }
  }
  const top = main.at(-1)?.max ?? 0;
  const bands = [...main];
  for (const [i, g] of groups.entries()) {
    const face = top + 1 + i;
    if ([...g.faces].some((f) => f !== face) || !tiles(g.subs)) return null;
    bands.push({ min: face, max: face, sub: g.subs });
  }
  return tiles(bands) ? bands : null;
}

/**
 * The caption and its folded key for every list, `{<table>.<column>: {label,
 * key}}`; a list with no caption is left out. The spell-level lists are headed
 * by a figure, not a caption, and are named by it instead.
 */
export function captionKeys(raw) {
  const out = {};
  for (const [table, columns] of Object.entries(LISTS)) {
    if (table === "scrollSpellLevels") continue;
    for (const [column, keys] of Object.entries(columns)) {
      const label = clean(raw[keys[0]]?.caption?.label);
      if (label) out[`${table}.${column}`] = { label, key: printKey(label) };
    }
  }
  return out;
}

/**
 * The id of the one list whose caption folds to this row's words, or null when
 * none or more than one does.
 */
export function hopOf(text, captions) {
  const key = printKey(text);
  if (!key) return null;
  const hits = Object.entries(captions).filter(([, c]) => c.key === key);
  return hits.length === 1 ? hits[0][0] : null;
}

/**
 * One arms grid → `{s1..s7: [{min, max, type}]}`: for each setting column, the
 * bands of the die that pick each type, in order. Null unless every column
 * prints seven settings' worth and tiles from 1.
 */
export function assembleArms(raw) {
  const rows = Object.entries(raw ?? {}).filter(([k, r]) => /^r\d+$/.test(k) && r && !r.__missing && clean(r.label));
  if (!rows.length) return null;
  const out = {};
  for (let i = 1; i <= SETTING_COLUMNS; i++) {
    const bands = rows
      .map(([, r]) => ({ ...bandOf(r[`s${i}`]), type: clean(r.label) }))
      .filter((b) => b.min != null)
      .sort((a, b) => a.min - b.min);
    if (!tiles(bands)) return null;
    out[`s${i}`] = bands;
  }
  return out;
}

/** The setting names the arms grids' two header lines print, `{s1..s7: "name"}`; null when none was read. */
export function assembleSettings(raw = {}) {
  for (const key of Object.values(ARMS_RAW_KEYS)) {
    const [h1, h2] = [raw[key]?.head1, raw[key]?.head2];
    if (!h1 || !h2 || h1.__missing || h2.__missing) continue;
    const out = {};
    for (let i = 1; i <= SETTING_COLUMNS; i++) {
      const name = clean(`${h1[`s${i}`] ?? ""} ${h2[`s${i}`] ?? ""}`);
      if (name) out[`s${i}`] = name;
    }
    if (Object.keys(out).length) return out;
  }
  return null;
}

/**
 * The page each list was read from, `{<table>.<column>: cite}`: the cites of the
 * raw segments the list is joined from, merged by `joinCites`. A list whose
 * segments carry no cite is left out. The document's own `cites` hold one cite
 * per assembled table, which for a table of several lists names every list's
 * pages; this is what a roll's tooltip points at.
 *
 * @param {Record<string, string>} cites the raw document's `cites`, by raw key
 */
export function listCitesOf(cites = {}) {
  const out = {};
  for (const [table, columns] of Object.entries(LISTS)) {
    for (const [column, keys] of Object.entries(columns)) {
      const cite = joinCites(keys.map((k) => cites[k]));
      if (cite) out[`${table}.${column}`] = cite;
    }
  }
  return out;
}

/**
 * The magic-item tables from the raw ones. Pure. Each table assembles
 * independently, so a partial import still yields what its pages held.
 */
export function assembleMagicItemTables(raw = {}) {
  const captions = captionKeys(raw);
  const out = {};
  for (const [table, columns] of Object.entries(LISTS)) {
    const assembled = {};
    for (const [column, keys] of Object.entries(columns)) {
      let bands = assembleNested(keys.map((k) => raw[k]));
      if (!bands) continue;
      if (HOPPING.includes(table)) bands = bands.map((b) => ({ ...b, hop: hopOf(b.item, captions) }));
      assembled[column] = bands;
    }
    if (Object.keys(assembled).length) out[table] = assembled;
  }
  for (const [table, rawKey] of Object.entries(ARMS_RAW_KEYS)) {
    const grid = assembleArms(raw[rawKey]);
    if (grid) out[table] = grid;
  }
  const heads = {};
  for (const [id, c] of Object.entries(captions)) heads[id] = c.label;
  for (const [column, keys] of Object.entries(LISTS.scrollSpellLevels)) {
    const level = clean(raw[keys[0]]?.caption?.level);
    if (level) heads[`scrollSpellLevels.${column}`] = level;
  }
  if (Object.keys(heads).length) out.captions = heads;
  const settings = assembleSettings(raw);
  if (settings) out.armsSettings = settings;
  return out;
}

/**
 * Merge the engine-shaped tables into the imported `magicItemTables` doc. Raw
 * tables stay beside the assembled ones, so a re-import grows the doc instead
 * of replacing it.
 */
export async function applyMagicItemImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(MAGIC_ITEM_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleMagicItemTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  const listCites = listCitesOf(doc.cites);
  if (Object.keys(listCites).length) engine.listCites = listCites;
  await svc.importDoc(assembledDoc(doc, engine, PRODUCES[MAGIC_ITEM_DOC_ID]), { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: Object.keys(engine) };
}
