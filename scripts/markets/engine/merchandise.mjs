/* global game, Hooks, Item, ui, CONFIG */
/**
 * The merchandise catalogue: the goods the markets trade, read from the
 * `acks-extras.merchandise` Items and, where a world holds none, from the
 * legacy imported `mercantile.merchandiseTypes` table.
 *
 * Three layers merge per key, the last winning: the table rows, the library's
 * compendium items, then the world's own Items. A Judge adds or overrides a
 * good by making a world Item with that key. The catalogue is a plain-data
 * snapshot, cached until a merchandise Item is created, changed or deleted;
 * the compendium half is loaded by `primeMerchandiseCatalog` (at `ready`),
 * because a pack's documents are read asynchronously and the readers here are
 * synchronous. See docs/markets/MODEL.md, "The merchandise catalogue".
 */
import { MODULE_ID, LANG, MERCHANDISE_TYPE } from "../constants.mjs";
import { merchandiseLabel } from "../config.mjs";
import { DEMAND_COLUMN_KEYS, MARKET_CLASS_COUNT, MERCHANDISE_KEYS, merchandiseTierOf } from "../merchandise-keys.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { isMissingRow, citeOf } from "../../lib/tables.mjs";

/** The good whose tariff and season follow the printed procedure for staple food. */
const STAPLE_KEY = "grainVegetables";

/** How long a pack change waits for a burst of them to end before the compendium half reloads. */
const PACK_RELOAD_MS = 300;

/** Where a catalogue row was read from. */
export const CATALOG_SOURCE = Object.freeze({ world: "world", compendium: "compendium", table: "table" });

/** A JSON-safe copy: a data model's `toObject()` or a plain object, either way detached. */
const plain = (value) => JSON.parse(JSON.stringify(value?.toObject?.() ?? value ?? null));

const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The empty demand layer: every column present, none printed. */
const blankEnvironment = () => Object.fromEntries(DEMAND_COLUMN_KEYS.map((column) => [column, null]));

/** The catalogue row of one merchandise Item, or null while its key is blank. */
function rowOfItem(doc, source) {
  const system = plain(doc?.system) ?? {};
  const key = String(system.key ?? "").trim();
  if (!key) return null;
  const stones = Array.isArray(system.dailyStones) ? system.dailyStones : [];
  const random = system.random ?? {};
  return {
    key,
    tier: system.tier || merchandiseTierOf(key) || "common",
    label: doc.name || key,
    container: system.container ?? "",
    pricePerStoneGp: num(system.pricePerStoneGp),
    priceStepGp: num(system.priceStepGp),
    dailyStones: Array.from({ length: MARKET_CLASS_COUNT }, (_, i) => num(stones[i])),
    environment: { ...blankEnvironment(), ...(system.environment ?? {}) },
    racial: { ...(system.racial ?? {}) },
    random: { table: random.table || null, min: num(random.min), max: num(random.max), special: !!random.special },
    tariffExempt: !!system.tariffExempt,
    seasonalPrice: !!system.seasonalPrice,
    lootKinds: [...(system.lootKinds ?? [])],
    itemCategories: [...(system.itemCategories ?? [])],
    aliases: [...(system.aliases ?? [])],
    uuid: doc.uuid ?? null,
    source,
  };
}

/** The catalogue row of one legacy `merchandiseTypes` table row. */
function rowOfTable(row) {
  const key = String(row.type ?? "").trim();
  const staple = key === STAPLE_KEY;
  return {
    key,
    tier: row.tier || merchandiseTierOf(key) || "common",
    label: game.i18n.localize(merchandiseLabel(key)),
    container: row.container ?? "",
    pricePerStoneGp: num(row.pricePerStone),
    priceStepGp: num(row.priceStep),
    dailyStones: Array.from({ length: MARKET_CLASS_COUNT }, (_, i) => num(row.byMarketClass?.[i])),
    environment: blankEnvironment(),
    racial: {},
    random: { table: null, min: null, max: null, special: false },
    tariffExempt: staple,
    seasonalPrice: staple,
    lootKinds: [],
    itemCategories: [],
    aliases: [],
    uuid: null,
    source: CATALOG_SOURCE.table,
  };
}

/** The legacy table's rows that hold a key, placeholders for unread rows dropped. */
const tableRows = (table = optTable("mercantile", "merchandiseTypes")) => (table?.rows ?? []).filter((r) => r && !isMissingRow(r) && r.type);

/** The compendium items' rows, set by `primeMerchandiseCatalog`; null until then. */
let compendiumRows = null;
let cache = null;

/** Forget the merged snapshot (and the compendium half when `pack` is set). */
export function invalidateMerchandiseCatalog({ pack = false } = {}) {
  cache = null;
  if (pack) compendiumRows = null;
}

/**
 * Load the compendium half of the catalogue: every merchandise Item in every
 * Item pack, read through the pack index so no other pack's documents are
 * fetched. Safe to call again; it replaces the compendium snapshot.
 * @returns {Promise<number>} how many compendium goods were read
 */
export async function primeMerchandiseCatalog() {
  const rows = [];
  for (const pack of [...(game.packs ?? [])]) {
    if (pack.documentName !== "Item") continue;
    const ids = [...(pack.index ?? [])].filter((entry) => entry.type === MERCHANDISE_TYPE).map((entry) => entry._id ?? entry.id);
    for (const id of ids) {
      try {
        const row = rowOfItem(await pack.getDocument(id), CATALOG_SOURCE.compendium);
        if (row) rows.push(row);
      } catch (err) {
        console.warn(`${MODULE_ID} | merchandise: ${pack.collection} item ${id} could not be read`, err);
      }
    }
  }
  compendiumRows = rows;
  cache = null;
  return rows.length;
}

/** Catalogue order: the table's own order for known keys, then the rest by label. */
function ordered(rows) {
  const rank = new Map(MERCHANDISE_KEYS.map((row, i) => [row.key, i]));
  return rows.sort((a, b) => {
    const ra = rank.get(a.key) ?? Infinity;
    const rb = rank.get(b.key) ?? Infinity;
    return ra === rb ? String(a.label).localeCompare(String(b.label)) : ra - rb;
  });
}

/**
 * Every good the markets can trade, one row per key, as plain data.
 *
 * A row: `{key, tier, label, container, pricePerStoneGp, priceStepGp,
 * dailyStones (six, class I first), environment (a modifier or null per demand
 * column), racial ({raceKey: modifier}), random {table, min, max, special},
 * tariffExempt, seasonalPrice, lootKinds, itemCategories, aliases, uuid,
 * source}`, `source` being "world", "compendium" or "table". A world Item wins
 * over a compendium Item of the same key, which wins over the legacy table.
 * The returned array is the cached snapshot: read it, never write it.
 * @returns {object[]}
 */
export function merchandiseCatalog() {
  const table = optTable("mercantile", "merchandiseTypes");
  if (cache && cache.table === (table?.rows ?? null)) return cache.rows;
  const byKey = new Map();
  for (const row of tableRows(table)) byKey.set(String(row.type).trim(), rowOfTable(row));
  for (const row of compendiumRows ?? []) byKey.set(row.key, row);
  for (const doc of [...(game.items ?? [])]) {
    if (doc.type !== MERCHANDISE_TYPE) continue;
    const row = rowOfItem(doc, CATALOG_SOURCE.world);
    if (row) byKey.set(row.key, row);
  }
  const rows = ordered([...byKey.values()]);
  cache = { rows, table: table?.rows ?? null };
  return rows;
}

/**
 * The catalogue row for one key, or null when the key names no good.
 * @param {string} key
 * @returns {object|null}
 */
export const merchandiseFor = (key) => merchandiseCatalog().find((row) => row.key === key) ?? null;

/**
 * GM: make a world merchandise Item for every good the imported legacy table
 * holds that no Item stands for yet, so the Judge can edit them and the
 * catalogue reads them as world goods. Idempotent by key: a key that a world
 * or compendium Item already answers for is skipped. Reports what it made and
 * what it skipped in one notification.
 * @returns {Promise<{made: string[], skipped: string[]}>}
 */
export async function buildMerchandiseFromTables() {
  if (!game.user?.isGM) {
    ui.notifications?.warn(game.i18n.localize(`${LANG}.merchandise.migrate.gmOnly`));
    return { made: [], skipped: [] };
  }
  if (!CONFIG.Item?.dataModels?.[MERCHANDISE_TYPE]) {
    ui.notifications?.warn(game.i18n.localize(`${LANG}.merchandise.migrate.noType`));
    return { made: [], skipped: [] };
  }
  const rows = tableRows();
  if (!rows.length) {
    ui.notifications?.warn(game.i18n.localize(`${LANG}.merchandise.migrate.noTable`));
    return { made: [], skipped: [] };
  }
  await primeMerchandiseCatalog();
  const present = new Set(merchandiseCatalog().filter((row) => row.source !== CATALOG_SOURCE.table).map((row) => row.key));
  const page = citeOf("mercantile", "merchandiseTypes") ?? "";
  const made = [];
  const skipped = [];
  for (const row of rows) {
    const key = String(row.type).trim();
    if (present.has(key)) {
      skipped.push(key);
      continue;
    }
    const base = rowOfTable(row);
    const doc = await Item.create({
      name: base.label,
      type: MERCHANDISE_TYPE,
      system: {
        key,
        tier: base.tier,
        container: base.container,
        pricePerStoneGp: base.pricePerStoneGp,
        priceStepGp: base.priceStepGp,
        dailyStones: base.dailyStones,
        tariffExempt: base.tariffExempt,
        seasonalPrice: base.seasonalPrice,
        source: { book: "rr", page },
      },
    });
    if (doc) made.push(key);
    else skipped.push(key);
  }
  invalidateMerchandiseCatalog();
  ui.notifications?.info(game.i18n.format(`${LANG}.merchandise.migrate.done`, { made: made.length, skipped: skipped.length }));
  return { made, skipped };
}

/**
 * Keep the snapshot honest: any change to a merchandise Item, in the world or
 * a pack, drops it (and a pack's change also reloads the compendium half once
 * the burst of changes ends). Registers nothing where there is no `Hooks`.
 */
function watch() {
  let reload = null;
  if (typeof Hooks === "undefined") return;
  const changed = (doc) => {
    if (doc?.type !== MERCHANDISE_TYPE) return;
    invalidateMerchandiseCatalog();
    if (!doc.pack) return;
    // An import writes a pack's goods one after another; one reload after the burst.
    clearTimeout(reload);
    reload = setTimeout(
      () => primeMerchandiseCatalog().catch((err) => console.warn(`${MODULE_ID} | merchandise: the compendium could not be reloaded`, err)),
      PACK_RELOAD_MS,
    );
  };
  for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, changed);
}
watch();
