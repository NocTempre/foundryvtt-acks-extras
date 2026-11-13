/* global game, Hooks, console */
/**
 * The weapon rows the library holds, published as ruledata.
 *
 * The importer mints one core `weapon` item per printed row of the seat's own
 * weapons grid (`def.weapon.*`), writing the row's figures into the system's
 * own fields: size, melee and missile, the special qualities, the cleave
 * limit, the base and alternate damage and the damage types. This module reads
 * those fields back and registers them as the `weapons` ruledata document at
 * WORLD priority, table `grid`, one row per weapon, so a reader asks the
 * registry for a weapon's row instead of the source for a constant. A world
 * with no minted weapons publishes nothing, and every reader's answer is null.
 *
 * A row is keyed by the tail of the item's mint id (`def.weapon.<tail>`) folded
 * to lowercase letters and digits: the key is what the page printed and
 * nothing the module knows about weapons, so the key space stays the grid's own
 * and no table of names has to exist for a row to be found. A row carries what
 * the library item carries: its name, the grid sub-header the row was filed
 * under (`block`), the system's figures and the item's own damage types. An
 * item that does not carry the system's structured weapon fields yields no
 * row; nothing is inferred to stand in for it. The row's citation is the item's stored one, so a figure's
 * tooltip can name the page.
 *
 * Readers that must wait for the first publication await `rowsReady()`, and an
 * action a user starts awaits `rowsSettled()`, which is bounded; one that
 * redraws on a change listens for `ROWS_CHANGED_HOOK`. Every reader of a
 * weapon asks the weapon seam, whose registered source (`weapon-source.mjs`)
 * reads this document.
 */
import { registerTable, unregisterTable, PRIORITY } from "../lib/tables.mjs";
import { libraryItems, cookbookId, whenReady } from "../lib/library.mjs";
import { ITEM_TYPE, slug } from "../lib/vocab.mjs";
import { announceChange } from "../lib/util.mjs";
import { MODULE_ID } from "./constants.mjs";
import { WEAPONS_DOC, WEAPONS_TABLE } from "./weapon-source.mjs";

export { WEAPONS_DOC, WEAPONS_TABLE };

/** The hook fired, debounced, after the published rows changed. */
export const ROWS_CHANGED_HOOK = "acksExtras.weaponRowsChanged";

/** How long the rows settle before `ROWS_CHANGED_HOOK` fires, in milliseconds. */
export const ROWS_DEBOUNCE_MS = 50;

/** The cookbook id prefix the importer mints a weapon row under. */
const MINTED_PREFIX = "def.weapon.";

/** The sizes the system's weapon schema names; its `na` is no size. */
const SIZES = Object.freeze(["tiny", "small", "medium", "large"]);

/**
 * What `publish` registers for `tools/validate-producers.mjs`: the one table.
 * Its rows are keyed by the mint ids of the world's minted weapons, so no
 * static list can name them.
 */
export const PRODUCES = Object.freeze({ [WEAPONS_DOC]: { [WEAPONS_TABLE]: null } });

/** Does this document carry the system's structured weapon fields the row reads? */
function hasCoreFields(sys) {
  return (
    sys != null &&
    typeof sys.melee === "boolean" &&
    typeof sys.missile === "boolean" &&
    sys.special != null &&
    typeof sys.special === "object" &&
    typeof sys.damage?.base?.formula === "string" &&
    typeof sys.size === "string"
  );
}

/** The page the item's own import stamp names, or the empty string. */
const citeOfItem = (item) =>
  String(item?.flags?.[MODULE_ID]?.cookbook?.cite ?? item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? item?.system?.source?.cite ?? "");

/** The grid sub-header the importer filed the item's row under, or null. */
const blockOfItem = (item) => {
  const block = item?.flags?.[MODULE_ID]?.weapon?.block ?? item?.getFlag?.(MODULE_ID, "weapon")?.block;
  return typeof block === "string" && block.trim() ? block.trim() : null;
};

/** The damage types the item's own base damage states, sorted; empty when it states none. */
const typesOfItem = (item) => {
  const types = item?.system?.damage?.base?.types;
  return (types ? Array.from(types) : []).filter((t) => typeof t === "string" && t).sort();
};

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
    name: String(item.name ?? ""),
    block: blockOfItem(item),
    size: SIZES.includes(sys.size) ? sys.size : null,
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
    types: typesOfItem(item),
    cite: citeOfItem(item),
  };
}

/** The key a minted item's row is published under: its mint id's tail, folded. */
const keyOfItem = (item) => slug(cookbookId(item).slice(MINTED_PREFIX.length));

/**
 * Every minted weapon in the library as `{ [weaponKey]: row }`. Where two
 * items carry one mint id, library order decides (the sidebar's before a
 * shelf's).
 *
 * @param {object} [opts]
 * @param {Set<string>} [opts.except] document ids to leave out, for a delete
 *   whose hook fires before the collection drops the document
 */
export function weaponRows({ except = null } = {}) {
  const rows = {};
  for (const item of libraryItems()) {
    if (item.type !== ITEM_TYPE.weapon || !cookbookId(item).startsWith(MINTED_PREFIX)) continue;
    if (except?.has(item.id)) continue;
    const key = keyOfItem(item);
    if (!key || key in rows) continue;
    const row = rowOf(item);
    if (row) rows[key] = row;
  }
  return rows;
}

/** Whether this client's registry currently holds the published document. */
let _published = false;

/** The pending `ROWS_CHANGED_HOOK` timer, or null. */
let _announce = null;

/** The first publication after load; resolved at once where none is awaited. */
let _first = Promise.resolve();

/** Whether the first publication has settled; true where no publisher was ever registered. */
let _settled = true;

/** The longest an action waits for the first publication, in milliseconds. */
export const ROWS_WAIT_MS = 60000;

/** Fire `ROWS_CHANGED_HOOK` once, `ROWS_DEBOUNCE_MS` after the last change in a burst. */
function announceRowsChanged() {
  clearTimeout(_announce);
  _announce = setTimeout(() => {
    _announce = null;
    announceChange(ROWS_CHANGED_HOOK);
  }, ROWS_DEBOUNCE_MS);
}

/**
 * Resolves once the first publication after load has landed: the library has
 * loaded and the rows it holds are in the registry. A reader that answers
 * from the rows awaits this before its first answer; where the publisher was
 * never registered it resolves at once.
 */
export const rowsReady = () => _first;

/**
 * `rowsReady` for an ACTION a user starts: a draw, a readied torch, a loadout
 * rebuild, an attack throw. It classifies a weapon from the rows, so it waits
 * for the first publication and its answer equals the one given long after load.
 * A world with no weapon rows imported settles too (the publication lands with
 * zero rows, and every reader then answers "not imported"); a publication that
 * never lands releases the action after `timeoutMs`, with a warning, so no
 * action hangs.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] the longest to wait, in milliseconds
 * @returns {Promise<void>}
 */
export async function rowsSettled({ timeoutMs = ROWS_WAIT_MS } = {}) {
  if (_settled) return;
  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${MODULE_ID} | the weapon rows were not published within ${timeoutMs} ms; the action answers from the rows in hand.`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([_first, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rebuild the `weapons` document from the library and register it at WORLD
 * priority, replacing the previous publication. With no row to publish the
 * document is withdrawn. A citation shared by every row is also recorded on
 * the table, which is where `citeOf` looks. Each publication announces
 * `ROWS_CHANGED_HOOK`, debounced.
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
    const changed = _published;
    _published = false;
    if (changed) announceRowsChanged();
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
  announceRowsChanged();
  return keys.length;
}

/** Is this a library weapon, the only kind whose change moves the rows? */
const isLibraryWeapon = (item) =>
  item?.type === ITEM_TYPE.weapon && !item.parent && cookbookId(item).startsWith(MINTED_PREFIX);

/**
 * Publish once the library has loaded, and again whenever a library weapon is
 * created, updated or deleted. The library warms in the background, so the
 * first publication awaits it (`rowsReady` resolves when it has landed, even
 * where it failed); a deleted document is left out explicitly because its hook
 * can fire while the collection still lists it.
 */
export function registerWeaponRows() {
  _settled = false;
  _first = new Promise((resolve) => {
    Hooks.once("ready", async () => {
      try {
        await whenReady();
        const count = publish();
        if (count) console.log(`${MODULE_ID} | equipment published ${count} weapon row(s).`);
      } catch (err) {
        console.error(`${MODULE_ID} | the weapon rows could not be published`, err);
      } finally {
        _settled = true;
        resolve();
      }
    });
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (!isLibraryWeapon(item) || !game.ready) return;
      publish({ except: hook === "deleteItem" ? new Set([item.id]) : null });
    });
  }
}
