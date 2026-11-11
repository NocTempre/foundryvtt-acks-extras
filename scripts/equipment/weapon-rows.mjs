/* global game, Hooks, console */
/**
 * The weapon rows the library holds, published as ruledata.
 *
 * The importer mints one core `weapon` item per printed row of the seat's own
 * weapons grid (`def.weapon.*`), writing the row's figures into the system's
 * own fields: size, melee and missile, the special qualities, the cleave
 * limit, the base and alternate damage. This module reads those fields back
 * and registers them as the `weapons` ruledata document at WORLD priority,
 * table `grid`, one row per weapon key (`weaponIdentity`'s vocabulary), so a
 * reader asks the registry for a weapon's row instead of the source for a
 * constant. A world with no minted weapons publishes nothing, and every
 * reader's answer is null.
 *
 * A row is exactly what the library item carries. An item that does not carry
 * the system's structured weapon fields (an import from before they were
 * written) yields no row; nothing is inferred to stand in for it. The row's
 * citation is the item's stored one, so a figure's tooltip can name the page.
 *
 * No consumer in the module reads the document yet.
 */
import { registerTable, unregisterTable, PRIORITY } from "../lib/tables.mjs";
import { libraryItems, cookbookId, whenReady } from "../lib/library.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { MODULE_ID } from "./constants.mjs";
import { weaponIdentity, CORE_SIZES } from "./profiles.mjs";

/** The ruledata document the rows are published in. */
export const WEAPONS_DOC = "weapons";

/** The table inside it: one row per weapon key. */
export const WEAPONS_TABLE = "grid";

/** The cookbook id prefix the importer mints a weapon row under. */
const MINTED_PREFIX = "def.weapon.";

/**
 * What `publish` registers for `tools/validate-producers.mjs`: the one table.
 * Its rows are keyed by the weapon keys of the world's minted weapons, so no
 * static list can name them.
 */
export const PRODUCES = Object.freeze({ [WEAPONS_DOC]: { [WEAPONS_TABLE]: null } });

/** A quality word reduced to letters, the form a special-property key takes. */
const wordKey = (w) => String(w ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Does this item hold the schema's defaults where the row's figures belong,
 * as an import from before the importer wrote the system's weapon fields
 * does? Two shapes mark it:
 *  - a melee weapon with no size: the type cell prints a size for every melee
 *    row, and the earlier import read none;
 *  - a quality word kept as a custom tag while its special property is unlit:
 *    the earlier import handed the words to a tag migration that lit nothing.
 */
function isLegacyImport(sys) {
  if (sys.melee && !CORE_SIZES[sys.size]) return true;
  const tags = Array.isArray(sys.customTags) ? sys.customTags : [];
  return tags.some((tag) => {
    const key = wordKey(typeof tag === "string" ? tag : tag?.title);
    const prop = key in sys.special ? key : key.startsWith("cleave") && "cleave" in sys.special ? "cleave" : null;
    return prop !== null && sys.special[prop] !== true;
  });
}

/**
 * Does this document carry the system's structured weapon fields, as the
 * importer wrote them? A live document always holds every field (the schema
 * fills the defaults), so presence alone proves nothing; `isLegacyImport`
 * names the shapes that are only defaults.
 */
function hasCoreFields(sys) {
  return (
    sys != null &&
    typeof sys.melee === "boolean" &&
    typeof sys.missile === "boolean" &&
    sys.special != null &&
    typeof sys.special === "object" &&
    typeof sys.damage?.base?.formula === "string" &&
    typeof sys.size === "string" &&
    !isLegacyImport(sys)
  );
}

/** The page the item's own import stamp names, or the empty string. */
const citeOfItem = (item) =>
  String(item?.flags?.[MODULE_ID]?.cookbook?.cite ?? item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? item?.system?.source?.cite ?? "");

/**
 * The row one minted weapon item states, or null when it carries no core
 * fields. A size the system calls `na` is no size, and a cleave limit is read
 * only from a weapon that cleaves.
 */
export function rowOf(item) {
  const sys = item?.system;
  if (!hasCoreFields(sys)) return null;
  const special = Object.keys(sys.special)
    .filter((k) => sys.special[k] === true)
    .sort();
  const cleaves = special.includes("cleave");
  const limit = sys.cleaveLimit;
  return {
    size: CORE_SIZES[sys.size] ?? null,
    melee: sys.melee,
    missile: sys.missile,
    thrown: special.includes("thrown"),
    handy: special.includes("handy"),
    special,
    cleaveLimit:
      cleaves && limit && typeof limit === "object"
        ? { numeric: Number.isFinite(limit.numeric) ? limit.numeric : null, addStrMod: limit.addStrMod === true }
        : null,
    damage: sys.damage.base.formula,
    damage2h: typeof sys.damage?.alternate?.formula === "string" ? sys.damage.alternate.formula : "",
    cite: citeOfItem(item),
  };
}

/** The rung a key's identity source holds: a minted id outranks a name match. */
const SOURCE_RANK = Object.freeze({ mint: 0, flag: 1, name: 2, skin: 3, loose: 4 });

/**
 * Every minted weapon in the library as `{ [weaponKey]: row }`. Where two
 * items resolve to one key, the better-attested identity wins, then library
 * order (the sidebar's before a shelf's).
 *
 * @param {object} [opts]
 * @param {Set<string>} [opts.except] document ids to leave out, for a delete
 *   whose hook fires before the collection drops the document
 */
export function weaponRows({ except = null } = {}) {
  const best = new Map();
  for (const item of libraryItems()) {
    if (item.type !== ITEM_TYPE.weapon || !cookbookId(item).startsWith(MINTED_PREFIX)) continue;
    if (except?.has(item.id)) continue;
    const identity = weaponIdentity(item);
    if (!identity.key) continue;
    const row = rowOf(item);
    if (!row) continue;
    const rank = SOURCE_RANK[identity.source] ?? 9;
    const held = best.get(identity.key);
    if (!held || rank < held.rank) best.set(identity.key, { rank, row });
  }
  return Object.fromEntries([...best].map(([key, { row }]) => [key, row]));
}

/** Whether this client's registry currently holds the published document. */
let _published = false;

/**
 * Rebuild the `weapons` document from the library and register it at WORLD
 * priority, replacing the previous publication. With no row to publish the
 * document is withdrawn. A citation shared by every row is also recorded on
 * the table, which is where `citeOf` looks.
 *
 * @param {object} [opts]
 * @param {Set<string>} [opts.except] see `weaponRows`
 * @returns {number} how many rows were published
 */
export function publish({ except = null } = {}) {
  const grid = weaponRows({ except });
  const keys = Object.keys(grid);
  if (!keys.length) {
    if (_published) unregisterTable(WEAPONS_DOC, { priority: PRIORITY.WORLD });
    _published = false;
    return 0;
  }
  const cites = new Set(keys.map((k) => grid[k].cite));
  const [shared] = cites;
  registerTable(
    {
      id: WEAPONS_DOC,
      source: { book: "rr" },
      cites: cites.size === 1 && shared ? { [WEAPONS_TABLE]: shared } : {},
      tables: { [WEAPONS_TABLE]: grid },
    },
    { priority: PRIORITY.WORLD, source: `${MODULE_ID}.equipment` },
  );
  _published = true;
  return keys.length;
}

/** Is this a library weapon, the only kind whose change moves the rows? */
const isLibraryWeapon = (item) =>
  item?.type === ITEM_TYPE.weapon && !item.parent && cookbookId(item).startsWith(MINTED_PREFIX);

/**
 * Publish once the library has loaded, and again whenever a library weapon is
 * created, updated or deleted. The library warms in the background, so the
 * first publication awaits it; a deleted document is left out explicitly
 * because its hook can fire while the collection still lists it.
 */
export function registerWeaponRows() {
  Hooks.once("ready", async () => {
    await whenReady();
    const count = publish();
    if (count) console.log(`${MODULE_ID} | equipment published ${count} weapon row(s).`);
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (!isLibraryWeapon(item) || !game.ready) return;
      publish({ except: hook === "deleteItem" ? new Set([item.id]) : null });
    });
  }
}
