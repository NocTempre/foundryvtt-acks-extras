/**
 * Magic-item table gate: do the Judges Journal's item-generation and
 * arms-and-armour tables read WHOLE from the book — every row found, every cell
 * carrying its own text, every band list tiling its die, every hop resolving?
 * And, where the Treasure Tome is local, do the tables it replaces them with
 * read as whole and with the same columns?
 *
 * The lists are set in two print columns or across two pages, three of them
 * end in a tail of inner bands under an outer face, a wrapped name is centred on
 * its label, and the small-capital initials arrive as lone lower-case runs. A
 * window or a y-bound that misses by a few points does not throw: a segment's
 * rows go missing, a wrapped line lands on the neighbouring row, and the table
 * reads plausibly short. The committed tests feed the assembler invented cells,
 * so nothing offline reads the real page.
 *
 * Reads every `magicItemTables` recipe, assembles them as the importer does
 * and fails on:
 *   - a list the assembler refuses (its bands do not tile from 1 with no gap or
 *     overlap, or a tail group's inner bands do not), or one that ends on no
 *     die's face;
 *   - a row with an empty cell, a name opening on a lower-case letter (a
 *     small-capital initial that was not restored) or ending on a stranded
 *     letter, or an unbalanced bracket;
 *   - a caption not read for a list, or a hop row of the Random Type list that
 *     does not resolve to exactly one list of the document;
 *   - an arms grid that does not read seven settings' columns each tiling the
 *     die, or whose setting names differ from another grid's, or that has no
 *     caption (its header's left cells, which item rows are linked by);
 *   - no item row linking an arms grid, a link to a grid or kind list that does
 *     not stand and, on the Tome side, a weapon-kind list that is not placed or
 *     links fewer than two grids, or that no weapons row links.
 * The die each list is thrown on is read off its own bands, so no face is
 * written here.
 *
 * The Treasure Tome side assembles the document as an import with that book
 * open does: each recipe's `over` page from the Tome, the Tome's own tables
 * (`books/tt`) from the Tome, every other table from the Journal, then places
 * the Tome's lists by the binding's own rule. It fails on the same faults and
 * also where the Tome's arms grids name other settings than the Journal's, end
 * on another die, or its Creature Type list ends on another die, and on:
 *   - a Tome list that is refused, does not tile, ends on no die's face, has a
 *     tail group ending on no face, a cell fault or no caption read;
 *   - a leaf band (outer or inner) of any STANDING hopping list, the Journal's
 *     included, whose hop does not resolve to one id of its declared target
 *     table under which a list stands;
 *   - two ids of one target table whose key sets share a key;
 *   - a subtable no hop names, or one a classic category list names that its
 *     key does not belong to;
 *   - a list in the map left unplaced where everything it hops to is in the
 *     map. A stage list that waits for a category whose subtables a later batch
 *     adds is reported, not failed.
 *
 * Requires the LOCAL Judges Journal, so it SKIPS (exit 0) where it is absent,
 * CI included; the Treasure Tome side is skipped where that book is absent.
 * Output names recipe keys, bands and columns, never a cell's text.
 *
 * Usage: node tools/importer/check-magic-item-tables.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { locatePageNumber } from "../../scripts/importer/tables-binding.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";
import { MAGIC_ITEM_RECIPES } from "../../scripts/importer/table-recipes-magic-items.mjs";
import { BOOK_CODE } from "../../scripts/importer/books/index.mjs";
import { ARMS_RAW_KEYS, SETTING_COLUMNS, assembleNested, declarationsOf, magicItemPlacement } from "../../scripts/importer/magic-item-binding.mjs";
import { FILES } from "./reference-lib.mjs";

if (!fs.existsSync(FILES.jj)) {
  console.log("magic item tables: SKIPPED — the local Judges Journal is not on this machine.");
  process.exit(0);
}

/** The faces a list may end on: the standard dice. */
const DICE = new Set([4, 6, 8, 10, 12, 20, 100]);
/** The cells that hold a sentence rather than a name, where a lower-case opening and a closing letter are the book's. */
const PROSE = new Set(["text", "content", "cues"]);

const faults = [];
const fail = (where, why) => faults.push(`${where}: ${why}`);

const sharedRecipes = MAGIC_ITEM_RECIPES.tables;
const allRecipes = TABLE_RECIPES.magicItemTables.tables;
const books = { jj: (await openBook(fs.readFileSync(FILES.jj), { book: "jj" })).doc };
const sides = ["jj"];
if (fs.existsSync(FILES.tt)) {
  books.tt = (await openBook(fs.readFileSync(FILES.tt), { book: "tt" })).doc;
  sides.push("tt");
} else console.log("magic item tables: the local Treasure Tome is not on this machine; its side is skipped.");

const pageCache = new Map();
/** A page's items, read once per book. */
async function itemsOf(book, page) {
  const key = `${book}:${page}`;
  if (!pageCache.has(key)) pageCache.set(key, await pageItems(books[book], page));
  return pageCache.get(key).items;
}

/** What is wrong with a cell's text, by shape alone; null when nothing is. */
function cellFault(col, text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "empty cell";
  if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) return "unbalanced brackets";
  if ((s.match(/\[/g) ?? []).length !== (s.match(/\]/g) ?? []).length) return "unbalanced brackets";
  if (PROSE.has(col)) return null;
  if (/^[a-z]/.test(s)) return "opens on a lower-case letter (a small-capital initial not restored)";
  if (/\s[A-WYZa-z]$/.test(s)) return "ends in a stranded letter";
  if (/^[A-Za-z]\s/.test(s)) return "begins with a stranded letter";
  return null;
}

/** The rows of a raw list, the caption left out: `[key, row]`. */
const rowsOf = (table) => Object.entries(table ?? {}).filter(([k]) => k !== "caption");

/** The setting names of an arms grid's two header lines, `a|b|…`. */
const settingNames = (raw, rawKey) =>
  [raw[rawKey]?.head1, raw[rawKey]?.head2].map((r) => Array.from({ length: SETTING_COLUMNS }, (_, i) => String(r?.[`s${i + 1}`] ?? "").replace(/\s+/g, " ").trim()).join("|")).join("|");


/** The leaf bands of a list: every band with no inner bands, and every inner band. */
const leavesOf = (bands) => bands.flatMap((b) => (b.sub ? b.sub : [b]));

/** A text as the page prints it, one line. */
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Reads and checks the document on one side. The Journal side reads every
 * shared recipe from the Journal; the Tome side reads a recipe's `over` page
 * and the Tome's own tables from the Tome and the rest from the Journal, as an
 * import with both books open does, then places the Tome's lists.
 */
async function checkSide(side) {
  const tome = side === "tt";
  const at = (where) => `${tome ? "[tt] " : ""}${where}`;
  const recipes = tome ? allRecipes : sharedRecipes;
  const bookMap = tome ? BOOK_CODE : {};
  const raw = {};
  for (const [key, recipe] of Object.entries(recipes)) {
    const use = tome && recipe.over ? recipe.over : recipe;
    const page = await locatePageNumber(books[use.book], use);
    if (page == null) {
      fail(at(key), "no page answers the recipe's locate");
      continue;
    }
    raw[key] = extractTable(await itemsOf(use.book, page), use);
  }

  const rowsRead = {};
  let listsChecked = 0;
  const { units } = declarationsOf(bookMap);
  const place = magicItemPlacement(raw, { books: bookMap });
  const assembled = place.engine;

  /* --- the band lists, the shared ones and each book's ------------------------ */
  for (const unit of units) {
    for (const [column, keys] of Object.entries(unit.columns)) {
      const id = `${unit.table}.${column}`;
      const label = unit.from ? `${id} (${unit.from} list)` : id;
      // Every row found: a missing placeholder or an unparsed band label is a row lost.
      for (const k of keys) {
        for (const [rowKey, row] of rowsOf(raw[k])) {
          if (row?.__missing) {
            fail(at(`${k} ${rowKey}`), "row not found on the page");
            continue;
          }
          if (!Number.isFinite(row.min) || !Number.isFinite(row.max)) fail(at(`${k} ${rowKey}`), "band label did not parse");
          for (const [col, text] of Object.entries(row)) {
            if (["min", "max", "parent", "sub", "label"].includes(col)) continue;
            const bad = cellFault(col, text);
            // A bare outer face has no cells at all, so an empty row is the face, not a hole.
            if (bad && !(Object.keys(row).length === 2 && bad === "empty cell")) fail(at(`${k} ${row.min}-${row.max} ${col}`), bad);
          }
        }
      }
      const bands = assembleNested(keys.map((k) => raw[k]));
      listsChecked++;
      if (!bands) {
        fail(at(label), "the binding refuses its bands (they do not tile from 1, or a tail group's inner bands do not)");
        continue;
      }
      const top = bands.at(-1).max;
      if (!DICE.has(top)) fail(at(label), `ends at ${top}, which is no die's face`);
      for (const b of bands) if (b.sub && !DICE.has(b.sub.at(-1).max)) fail(at(label), `a tail group ends at ${b.sub.at(-1).max}, which is no die's face`);
      rowsRead[label] = bands.reduce((sum, b) => sum + (b.sub ? b.sub.length : 1), 0);
      const head = raw[keys[0]]?.caption;
      if (unit.table !== "scrollSpellLevels" && !flat(head?.label)) fail(at(label), "no caption read for the list");
      if (unit.table === "scrollSpellLevels" && !flat(head?.level)) fail(at(label), "no header figure read for the list");
    }
  }

  /* --- hops: the Random Type rows, and every standing hopping list ------------ */
  const typeBands = assembled.classicType?.bands ?? [];
  if (!typeBands.length) fail(at("classicType.bands"), "no rows to hop from");
  const named = typeBands.map((b) => b.hop).filter(Boolean);
  if (new Set(named).size !== named.length) fail(at("classicType.bands"), "two rows name the same list");
  const classicColumns = [...new Set(units.filter((u) => u.table === "classic").flatMap((u) => Object.keys(u.columns)))];
  for (const column of classicColumns) if (typeBands.length && !named.includes(`classic.${column}`)) fail(at(`classic.${column}`), "no Random Type row names it");

  const unitOf = (id) => {
    const [table, column] = id.split(".");
    return units.find((u) => u.table === table && u.columns[column] === place.keysOf[id]);
  };
  let hops = 0;
  const hopped = {};
  for (const id of Object.keys(place.keysOf)) {
    const [table, column] = id.split(".");
    const bands = assembled[table]?.[column];
    const target = bands && unitOf(id)?.hops;
    if (!target) continue;
    let n = 0;
    for (const b of leavesOf(bands)) {
      const where = at(`${id} ${b.min}-${b.max}`);
      if (!b.hop) fail(where, `does not name exactly one list of ${target}`);
      else if (!b.hop.startsWith(`${target}.`)) fail(where, `names ${b.hop}, which is not a list of ${target}`);
      else if (!assembled[target]?.[b.hop.slice(target.length + 1)]) fail(where, `names ${b.hop}, under which no list stands`);
      else n++;
    }
    hops += n;
    hopped[id] = n;
  }

  /* --- the Tome's chain: key sets, orphans, tiers, placement ------------------ */
  const waiting = [];
  if (tome) {
    const targets = [...new Set(units.map((u) => u.hops).filter(Boolean))];
    const idsUnder = (target) => Object.keys(place.keySets).filter((id) => id.startsWith(`${target}.`));
    const matches = (target, text) => {
      const key = printKey(text);
      return key ? idsUnder(target).filter((id) => place.keySets[id].includes(key)) : [];
    };
    for (const target of targets) {
      const byKey = new Map();
      for (const id of idsUnder(target)) for (const key of place.keySets[id]) byKey.set(key, [...(byKey.get(key) ?? []), id]);
      for (const ids of byKey.values()) if (ids.length > 1) fail(at(target), `${ids.join(" and ")} share a caption key`);
    }
    // Every declared hopping list that assembled, standing or not: what each leaf names.
    const named = new Set();
    for (const unit of units.filter((u) => u.from && u.hops)) {
      for (const [column, keys] of Object.entries(unit.columns)) {
        const bands = assembleNested(keys.map((k) => raw[k]));
        if (!bands) continue;
        for (const b of leavesOf(bands)) {
          const hit = matches(unit.hops, b.item);
          if (hit.length === 1) {
            named.add(hit[0]);
            if (unit.table === "classic" && !hit[0].slice(unit.hops.length + 1).startsWith(column)) fail(at(`classic.${column} ${b.min}-${b.max}`), `names ${hit[0]}, a subtable of another category`);
          }
        }
      }
    }
    const subtableIds = units.filter((u) => u.from && u.table === "subtables").flatMap((u) => Object.keys(u.columns).map((c) => `subtables.${c}`));
    for (const id of subtableIds) if (!named.has(id)) fail(at(id), "no category or rarity row names it (a misread caption)");
    const hasSubtables = (column) => subtableIds.some((id) => new RegExp(`^subtables\\.${column}\\d+$`).test(id));
    const complete = classicColumns.every(hasSubtables);
    for (const id of place.unplaced) {
      const [table, column] = id.split(".");
      const unit = units.find((u) => u.from && u.table === table && column in u.columns);
      if (!unit.hops) continue; // an item list or grid unplaced did not assemble, which is its own fault above
      const bands = assembleNested(unit.columns[column].map((k) => raw[k]));
      if (!bands) continue;
      const counts = leavesOf(bands).map((b) => matches(unit.hops, b.item).length);
      if (counts.some((n) => n > 1)) fail(at(id), "a row names a caption two lists share");
      else if (counts.includes(0)) {
        const excused = table === "classic" ? !hasSubtables(column) : unit.hops === "subtables" && !complete;
        if (excused) waiting.push(id);
        else fail(at(id), `${counts.filter((n) => n === 0).length} row(s) name no list the map holds, with every list they could name in it`);
      } else waiting.push(id);
    }
  }
  const placed = tome ? units.filter((u) => u.from).flatMap((u) => Object.keys(u.columns).map((c) => `${u.table}.${c}`)).filter((id) => !place.unplaced.includes(id)) : [];

  /* --- arms grids ------------------------------------------------------------ */
  const settings = assembled.armsSettings ?? {};
  if (Object.keys(settings).length !== SETTING_COLUMNS) fail(at("armsSettings"), `${Object.keys(settings).length} setting names read, not ${SETTING_COLUMNS}`);
  const first = Object.values(ARMS_RAW_KEYS)[0];
  for (const [table, rawKey] of Object.entries(ARMS_RAW_KEYS)) {
    listsChecked++;
    const grid = assembled[table];
    if (!grid) {
      fail(at(table), "an arms column does not tile the die from 1, or the grid was not read");
      continue;
    }
    for (const [col, bands] of Object.entries(grid)) {
      if (bands.at(-1).max !== grid.s1.at(-1).max) fail(at(`${table} ${col}`), "ends on a different face from the first column");
      if (!DICE.has(bands.at(-1).max)) fail(at(`${table} ${col}`), `ends at ${bands.at(-1).max}, which is no die's face`);
    }
    rowsRead[table] = Object.keys(raw[rawKey] ?? {}).filter((k) => /^r\d+$/.test(k)).length;
    for (const h of ["head1", "head2"]) {
      const row = raw[rawKey]?.[h];
      if (!row || row.__missing) fail(at(`${rawKey} ${h}`), "header line not found");
      else for (let i = 1; i <= SETTING_COLUMNS; i++) if (!row[`s${i}`]) fail(at(`${rawKey} ${h} s${i}`), "empty header cell");
    }
    if (settingNames(raw, rawKey) !== settingNames(raw, first)) fail(at(rawKey), "setting names differ from the first grid's");
    // The header's left cells are the grid's caption, which item rows are linked by.
    if (!flat(assembled.captions?.[table])) fail(at(`${rawKey} head1`), "no caption read for the grid (its first header line has no label)");
  }

  /* --- arms links: every grid is reachable from a row, and the kind list leads to a grid -- */
  const armsLinks = {};
  for (const table of ["classic", "heroic", "subtables"]) {
    for (const [column, bands] of Object.entries(assembled[table] ?? {})) {
      if (bands.some((b) => "hop" in b)) continue;
      for (const b of leavesOf(bands)) {
        const shape = b.arms ? Object.keys(b.arms)[0] : null;
        if (shape) armsLinks[`${shape}`] = (armsLinks[shape] ?? 0) + 1;
        if (b.arms?.grid && !ARMS_RAW_KEYS[b.arms.grid]) fail(at(`${table}.${column} ${b.min}-${b.max}`), "links a grid that is not an arms grid");
        if (b.arms?.kind && !assembled.weaponKinds?.bands) fail(at(`${table}.${column} ${b.min}-${b.max}`), "links a kind list that does not stand");
      }
    }
  }
  if (!armsLinks.grid) fail(at("arms links"), "no row of an item list links an arms grid");
  if (tome) {
    const kinds = assembled.weaponKinds?.bands;
    if (!kinds) fail(at("weaponKinds.bands"), "the weapon-kind list was not placed");
    else {
      const linked = kinds.filter((b) => b.arms?.grid);
      armsLinks.kinds = linked.length;
      if (linked.length < 2) fail(at("weaponKinds.bands"), `${linked.length} kind row(s) link a grid`);
      for (const b of kinds) if (b.arms && !ARMS_RAW_KEYS[b.arms.grid]) fail(at(`weaponKinds.bands ${b.min}-${b.max}`), "links a grid that is not an arms grid");
      if (!armsLinks.kind) fail(at("arms links"), "no weapons row links the kind list");
    }
  }
  return { assembled, raw, rowsRead, listsChecked, hops, hopped, placed, unplaced: place.unplaced, waiting, armsLinks };
}

const results = {};
for (const side of sides) results[side] = await checkSide(side);

/* --- the Tome's grids are the Journal's columns ----------------------------- */
if (results.tt) {
  const [jj, tt] = [results.jj, results.tt];
  const first = Object.values(ARMS_RAW_KEYS)[0];
  if (settingNames(jj.raw, first) !== settingNames(tt.raw, first)) fail("[tt] armsSettings", "the Tome's arms grids name other settings than the Journal's");
  for (const table of Object.keys(ARMS_RAW_KEYS)) {
    const [a, b] = [jj.assembled[table]?.s1?.at(-1)?.max, tt.assembled[table]?.s1?.at(-1)?.max];
    if (a !== b) fail(`[tt] ${table}`, "ends on another die than the Journal's");
  }
  if (jj.assembled.creatureType?.bands?.at(-1)?.max !== tt.assembled.creatureType?.bands?.at(-1)?.max) fail("[tt] creatureType.bands", "ends on another die than the Journal's");
  // The Tome's spell-level grid has the Journal's columns, or the whole grid is not a drop-in.
  const [a, b] = [Object.keys(jj.assembled.scrollSpellLevels ?? {}).length, Object.keys(tt.assembled.scrollSpellLevels ?? {}).length];
  if (a !== b) fail("[tt] scrollSpellLevels", `${b} columns stand, the Journal's grid has ${a}`);
}

const armsSummary = (r) => Object.entries(r.armsLinks).map(([shape, n]) => `${shape} ${n}`).join(", ") || "none";
const counts = (r, only) => Object.entries(r.rowsRead).filter(([k]) => !only || only(k)).map(([k, n]) => `${k} ${n}`).join(", ");
const OVERLAID = ["creatureType.bands", ...Object.keys(ARMS_RAW_KEYS)];
const summary = sides
  .map((s) => {
    if (s === "jj") return `Journal: ${results.jj.listsChecked} lists read and tiling their dice; ${results.jj.hops} Random Type rows resolve to one list each. Rows read: ${counts(results.jj)}. Arms links: ${armsSummary(results.jj)}.`;
    const t = results.tt;
    const bookLists = Object.keys(t.rowsRead).filter((k) => k.includes(" (tt list)"));
    return (
      `Tome: ${t.listsChecked} lists read and tiling their dice (${bookLists.length} of them the Tome's own). ` +
      `Leaf hops resolved: ${Object.entries(t.hopped).map(([id, n]) => `${id} ${n}`).join(", ")}. ` +
      `Placed (${t.placed.length}): ${t.placed.join(", ") || "none"}. Waiting on a later batch (${t.waiting.length}): ${t.waiting.join(", ") || "none"}. ` +
      `Rows read from the Tome: ${OVERLAID.map((k) => `${k} ${t.rowsRead[k]}`).join(", ")}; ${counts(t, (k) => k.includes(" (tt list)"))}. Arms links: ${armsSummary(t)}.`
    );
  })
  .join(" ");
if (faults.length) {
  for (const f of faults) console.error(`FAIL  ${f}`);
  console.error(`magic item tables: FAILED — ${faults.length} fault(s). ${summary}`);
  process.exit(1);
}
console.log(`magic item tables: OK — ${summary}`);
