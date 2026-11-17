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
 * A row names a list when its folded words (`printKey`) are the folded caption
 * the page printed over that list, and only then. Only the rows of a HOPPING
 * list are matched: the Random Type list, and each category and rarity list a
 * book's list map declares. Each is matched against the lists of the table its
 * declaration names (`hops`), never another.
 *
 * A book that prints a table of its own contributes a list map
 * (`books/index.mjs`, `magicItemLists`): which raw tables join into which list
 * id, which tables hop where, and which hashed spellings a list is also named
 * by. A book's list that is PLACED replaces the shared list under its id.
 * A list is placed when its bands tile and, for a hopping list, every leaf
 * band's hop resolves to an id under which a list stands; a list that cannot
 * place leaves the one standing there in its place, so a roll never ends on a
 * non-item. A hop is resolved against the key set of an id, every caption either
 * book prints for it, whichever book's list stands there.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc, joinCites } from "./produces.mjs";
import { printKey } from "./printed-name.mjs";
import { clean, sentence, tiles } from "./treasure-binding.mjs";
import { BOOK_CODE } from "./books/index.mjs";

/** The registry document the magic-item tables are read into. */
export const MAGIC_ITEM_DOC_ID = "magicItemTables";

/**
 * Each table of the document as `{table: {column: raw segments in page order}}`.
 * A table of one column is `bands`; a set of lists rolled on dice of their own
 * is one column per list. The column key is the list's id, and the id a hop
 * names is `<table>.<column>`. These are the shared recipes' lists; a book's
 * own lists are declared in its list map.
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

/** The shared tables whose rows name another list, each with the table its hops land in. */
const HOPPING = Object.freeze({ classicType: "classic" });

/**
 * Every list declaration of the document: the shared tables' lists, then each
 * book's list map's, in the manifest's order, and the hashed spellings the maps
 * add by list id. A unit is `{from, table, hops, whole, columns}`: `from` is
 * null for a shared table and a book's id for a map's; `hops` the table its
 * rows name lists of, or null; `whole` whether its lists are one printed grid
 * that replaces the table or none; `columns` the raw keys of each list.
 *
 * @param {Record<string, {magicItemLists?: {lists?: object, alsoKeys?: object}}>} books each book's contribution
 */
export function declarationsOf(books = BOOK_CODE) {
  const units = Object.entries(LISTS).map(([table, columns]) => ({ from: null, table, hops: HOPPING[table] ?? null, whole: false, columns }));
  const alsoKeys = {};
  for (const [bookId, contribution] of Object.entries(books ?? {})) {
    const map = contribution?.magicItemLists;
    for (const [table, u] of Object.entries(map?.lists ?? {})) units.push({ from: bookId, table, hops: u.hops ?? null, whole: !!u.whole, columns: u.lists });
    for (const [id, hashes] of Object.entries(map?.alsoKeys ?? {})) (alsoKeys[id] ??= []).push(...hashes);
  }
  return { units, alsoKeys };
}

/** The raw keys each engine table reads, over the shared lists and every book's: `{table: [raw key]}`. */
const rawKeysByTable = (units) => {
  const out = {};
  for (const u of units) (out[u.table] ??= []).push(...Object.values(u.columns).flat());
  return out;
};

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
export const PRODUCES = Object.freeze(
  (() => {
    const { units } = declarationsOf();
    return {
      [MAGIC_ITEM_DOC_ID]: {
        ...rawKeysByTable(units),
        ...ARMS_RAW_KEYS,
        captions: units.flatMap((u) => Object.values(u.columns).map((keys) => keys[0])),
        listCites: units.flatMap((u) => Object.values(u.columns).flat()),
        armsSettings: Object.values(ARMS_RAW_KEYS),
      },
    };
  })(),
);

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


/** The raw keys of each shared list, `{<table>.<column>: [raw key]}`: the lists a cite is read for when no book's are placed. */
const SHARED_KEYS = Object.freeze(Object.fromEntries(Object.entries(LISTS).flatMap(([table, columns]) => Object.entries(columns).map(([column, keys]) => [`${table}.${column}`, keys]))));

/**
 * The page each list was read from, `{<table>.<column>: cite}`: the cites of the
 * raw segments the list is joined from, merged by `joinCites`. A list whose
 * segments carry no cite is left out. The document's own `cites` hold one cite
 * per assembled table, which for a table of several lists names every list's
 * pages; this is what a roll's tooltip points at.
 *
 * @param {Record<string, string>} cites the raw document's `cites`, by raw key
 * @param {Record<string, string[]>} [keysOf] each list id's raw keys; the shared lists' when omitted
 *   (`magicItemPlacement` returns the standing lists')
 */
export function listCitesOf(cites = {}, keysOf = SHARED_KEYS) {
  const out = {};
  for (const [id, keys] of Object.entries(keysOf)) {
    const cite = joinCites(keys.map((k) => cites[k]));
    if (cite) out[id] = cite;
  }
  return out;
}

/** The leaf bands of a list: every band with no inner bands, and every inner band. */
const leavesOf = (bands) => bands.flatMap((b) => (b.sub ? b.sub : [b]));

/**
 * The magic-item tables from the raw ones, with where each list came from.
 * Pure. Each list assembles independently, so a partial import still yields
 * what its pages held, and each book's list is placed or left out as the
 * module docstring says.
 *
 * @param {object} [raw] the document's raw tables, by raw key
 * @param {object} [options]
 * @param {Record<string, object>} [options.books] each book's contribution (`magicItemLists`);
 *   every registered book's by default
 * @returns {{engine: object, keysOf: Record<string, string[]>, unplaced: string[]}}
 *   `engine` the assembled tables; `keysOf` the raw keys behind each list id (the lists
 *   that stand, and a shared list that did not assemble); `unplaced` the id of every book
 *   list whose pages were read and that does not stand; `keySets` each hop target id's
 *   folded caption keys, `{<table>.<column>: [key]}`
 */
export function magicItemPlacement(raw = {}, { books = BOOK_CODE } = {}) {
  const { units, alsoKeys } = declarationsOf(books);
  const lists = units.flatMap((unit) =>
    Object.entries(unit.columns).map(([column, keys]) => ({ id: `${unit.table}.${column}`, table: unit.table, column, keys, unit, bands: assembleNested(keys.map((k) => raw[k])) })),
  );

  // The key set of a list id: the folded caption of every raw segment, of either
  // book, that joins into a list under the id, and the id's own hashed spellings.
  // A hop resolves against the id, so it holds whichever book's list stands there.
  const targets = new Set(units.map((u) => u.hops).filter(Boolean));
  const keySets = new Map();
  const keySetOf = (id) => keySets.get(id) ?? keySets.set(id, new Set()).get(id);
  for (const l of lists) {
    if (!targets.has(l.table)) continue;
    for (const k of l.keys) {
      const key = printKey(clean(raw[k]?.caption?.label));
      if (key) keySetOf(l.id).add(key);
    }
  }
  for (const [id, hashes] of Object.entries(alsoKeys)) for (const h of hashes) keySetOf(id).add(h);
  const resolve = (text, target) => {
    const key = printKey(text);
    if (!key) return null;
    const hits = [...keySets].filter(([id, set]) => id.startsWith(`${target}.`) && set.has(key)).map(([id]) => id);
    return hits.length === 1 ? hits[0] : null;
  };
  /** A hopping list's bands with `hop` on every leaf band and inner band; a tail's outer band carries none. */
  const withHops = (bands, target) =>
    bands.map((b) => (b.sub ? { ...b, hop: null, sub: b.sub.map((s) => ({ ...s, hop: resolve(s.item, target) })) } : { ...b, hop: resolve(b.item, target) }));

  const standing = new Map(lists.filter((l) => l.unit.from === null && l.bands).map((l) => [l.id, l]));
  const placed = new Set();
  const replacedTables = new Set();
  const bookLists = lists.filter((l) => l.unit.from !== null);

  // A book's list is placed once it assembles and, if it hops, every leaf's hop
  // names an id a list stands under. A placed list can make another ready, so
  // this runs to a fixed point (subtables, then the category and rarity lists,
  // then the type list).
  const hopsReady = (l) => leavesOf(withHops(l.bands, l.unit.hops)).every((b) => b.hop && standing.has(b.hop));
  for (let moved = true; moved; ) {
    moved = false;
    for (const l of bookLists) {
      if (placed.has(l) || !l.bands || l.unit.whole) continue;
      if (l.unit.hops && !hopsReady(l)) continue;
      standing.set(l.id, l);
      placed.add(l);
      moved = true;
    }
  }
  // A printed grid of side-by-side lists replaces its table whole or not at all.
  for (const unit of units.filter((u) => u.from !== null && u.whole)) {
    const group = bookLists.filter((l) => l.unit === unit);
    if (!group.length || !group.every((l) => l.bands)) continue;
    for (const l of lists) if (l.unit.from === null && l.table === unit.table) standing.delete(l.id);
    for (const l of group) {
      standing.set(l.id, l);
      placed.add(l);
    }
    replacedTables.add(unit.table);
  }

  const engine = {};
  for (const l of standing.values()) {
    const bands = l.unit.hops ? withHops(l.bands, l.unit.hops) : l.bands;
    (engine[l.table] ??= {})[l.column] = bands;
  }

  // The caption and the cite name the list that stands, or the shared list that
  // was read and did not assemble.
  const named = [...standing.values(), ...lists.filter((l) => l.unit.from === null && !standing.has(l.id) && !replacedTables.has(l.table))];
  const heads = {};
  const keysOf = {};
  for (const l of named) {
    keysOf[l.id] = l.keys;
    if (l.table === "scrollSpellLevels") {
      const level = clean(raw[l.keys[0]]?.caption?.level);
      if (level) heads[l.id] = level;
    } else {
      const label = clean(raw[l.keys[0]]?.caption?.label);
      if (label) heads[l.id] = label;
    }
  }
  if (Object.keys(heads).length) engine.captions = heads;

  for (const [table, rawKey] of Object.entries(ARMS_RAW_KEYS)) {
    const grid = assembleArms(raw[rawKey]);
    if (grid) engine[table] = grid;
  }
  const settings = assembleSettings(raw);
  if (settings) engine.armsSettings = settings;

  const read = (l) => l.keys.some((k) => Object.keys(raw[k] ?? {}).length > 0);
  const unplaced = bookLists.filter((l) => !placed.has(l) && read(l)).map((l) => l.id);
  return { engine, keysOf, unplaced, keySets: Object.fromEntries([...keySets].map(([id, set]) => [id, [...set]])) };
}

/**
 * The magic-item tables from the raw ones. Pure; see `magicItemPlacement`.
 *
 * @param {object} [raw] the document's raw tables, by raw key
 * @param {object} [options] as `magicItemPlacement`'s
 */
export function assembleMagicItemTables(raw = {}, options) {
  return magicItemPlacement(raw, options).engine;
}

/**
 * Merge the engine-shaped tables into the imported `magicItemTables` doc. Raw
 * tables stay beside the assembled ones, so a re-import grows the doc instead
 * of replacing it. `unplaced` names each list of a book's whose pages were read
 * and that the shared list still stands in for.
 */
export async function applyMagicItemImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(MAGIC_ITEM_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [], unplaced: [] };
  const { engine, keysOf, unplaced } = magicItemPlacement(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [], unplaced };
  const listCites = listCitesOf(doc.cites, keysOf);
  if (Object.keys(listCites).length) engine.listCites = listCites;
  await svc.importDoc(assembledDoc(doc, engine, PRODUCES[MAGIC_ITEM_DOC_ID]), { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: Object.keys(engine), unplaced };
}
