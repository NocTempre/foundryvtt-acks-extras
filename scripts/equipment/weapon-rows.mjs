/* global game, Hooks, console */
/**
 * The weapon rows the library holds, published as ruledata.
 *
 * The importer mints one core `weapon` item per printed row of the seat's own
 * weapons grid (`def.weapon.*`), writing the row's figures into the system's
 * own fields. This module reads those fields back and registers them as the
 * `weapons` ruledata document at WORLD priority, table `grid`, one row per
 * weapon. A world with no minted weapons publishes nothing, and every reader's
 * answer is null.
 *
 * A row is keyed by the tail of the item's mint id (`def.weapon.<tail>`) folded
 * to lowercase letters and digits, and carries the library item's name, grid
 * sub-header (`block`), the system's figures, its own damage types and its
 * stored citation. An item without the system's structured weapon fields
 * yields no row.
 *
 * The rows are read through `libraryDocsWhere`, which tests the shelves' index
 * rows and loads only the minted weapons and the variation documents (the
 * attack throw's masterwork figure reads those from the library synchronously,
 * so they are held once the rows are in). A change to a library weapon is read
 * again once per burst of hooks, from the index, so a shelf the cache lifetime
 * has evicted still answers with every row.
 *
 * Readers that must wait for the first publication await `rowsReady()`, an
 * action a user starts awaits `rowsSettled()` (bounded), and one that redraws
 * on a change listens for `ROWS_CHANGED_HOOK`. Every reader of a weapon asks
 * the weapon seam, whose registered source (`weapon-source.mjs`) reads this
 * document.
 */
import { registerTable, unregisterTable, PRIORITY } from "../lib/tables.mjs";
import { libraryDocsWhere, cookbookId } from "../lib/library.mjs";
import { ITEM_TYPE, slug } from "../lib/vocab.mjs";
import { announceChange } from "../lib/util.mjs";
import { MODULE_ID, VARIATION_ITEM_TYPE } from "./constants.mjs";
import { WEAPONS_DOC, WEAPONS_TABLE } from "./weapon-source.mjs";

export { WEAPONS_DOC, WEAPONS_TABLE };

/** The hook fired, debounced, after the published rows changed. */
export const ROWS_CHANGED_HOOK = "acksExtras.weaponRowsChanged";

/** How long the rows settle before `ROWS_CHANGED_HOOK` fires, in milliseconds. */
export const ROWS_DEBOUNCE_MS = 50;

/** The cookbook id prefix the importer mints a weapon row under. */
const MINTED_PREFIX = "def.weapon.";

/** How long a burst of weapon hooks settles before the library is read again, in milliseconds. */
export const ROWS_REREAD_MS = 40;

/** The `performance.mark` set when the first publication of the rows begins, read by tools/live/perf-leads.mjs. */
export const ROWS_MARK_STARTED = "acks-extras:weaponRows:started";

/** The `performance.mark` set when the first publication of the rows has landed or failed. */
export const ROWS_MARK_PUBLISHED = "acks-extras:weaponRows:published";

/** Set a `performance.mark`; a seat with none loses only the measurement. */
function mark(name) {
  try {
    globalThis.performance?.mark?.(name);
  } catch {
    /* no timeline to mark */
  }
}

/**
 * What the rows need from the library, tested on an index row (`type`, the
 * stamp): the minted weapons, and every variation document, since the attack
 * throw's masterwork figure is read from the held variations synchronously and
 * a row of the index cannot name a variation's `key`.
 */
const isRowSource = (row) =>
  row.type === VARIATION_ITEM_TYPE || (row.type === ITEM_TYPE.weapon && cookbookId(row).startsWith(MINTED_PREFIX));

/** Read what the rows need from the library: the one read of the first publication and of each burst. */
const readRowSources = (except = null) => libraryDocsWhere("Item", isRowSource, { except });

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
export const keyOfItem = (item) => slug(cookbookId(item).slice(MINTED_PREFIX.length));

/**
 * Every minted weapon among `docs` as `{ [weaponKey]: row }`; the rest of the
 * list (the variations the read also answers with) is skipped. Where two items
 * carry one mint id, list order decides, which is library order (the sidebar's
 * before a shelf's).
 *
 * @param {object[]} docs the library documents the rows are read from (`readRowSources`)
 */
export function weaponRows(docs) {
  const rows = {};
  for (const item of docs ?? []) {
    if (item.type !== ITEM_TYPE.weapon || !cookbookId(item).startsWith(MINTED_PREFIX)) continue;
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

/** The pending debounce timer of a republish read, or null. */
let _reread = null;

/** The republish read in flight, or null. */
let _rereading = null;

/** Whether a hook has changed the library since the read in flight began. */
let _dirty = false;

/** Document ids deleted since the last read began, left out of the next one. */
const _gone = new Set();

/** Resolvers of the actions waiting for a quiet republish. */
let _quiet = [];

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
 * `rowsReady` for an ACTION a user starts (a draw, a readied torch, a loadout
 * rebuild, an attack throw), which classifies a weapon from the rows. A world
 * with no weapon rows settles too, and so does a republish that a hook has
 * queued: the action reads the rows the change publishes. A publication that
 * never lands releases the action after `timeoutMs`, with a warning.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] the longest to wait, in milliseconds
 * @returns {Promise<void>}
 */
export async function rowsSettled({ timeoutMs = ROWS_WAIT_MS } = {}) {
  if (_settled && !_reread && !_rereading) return;
  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${MODULE_ID} | the weapon rows were not published within ${timeoutMs} ms; the action answers from the rows in hand.`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([_first.then(whenQuiet), bound]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once no republish is queued or in flight. */
const whenQuiet = () => (_reread || _rereading ? new Promise((resolve) => _quiet.push(resolve)) : undefined);

/**
 * Rebuild the `weapons` document from the library documents `docs` and
 * register it at WORLD priority, replacing the previous publication. With no
 * row to publish the document is withdrawn. A citation shared by every row is
 * also recorded on the table, which is where `citeOf` looks. Each publication
 * announces `ROWS_CHANGED_HOOK`, debounced.
 *
 * @param {object[]} docs the documents `readRowSources` answers with; `weaponRows`
 * @returns {number} how many rows were published
 */
export function publish(docs) {
  const grid = weaponRows(docs);
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

/** Let the actions waiting on a quiet republish go. */
function releaseQuiet() {
  const waiting = _quiet;
  _quiet = [];
  for (const resolve of waiting) resolve();
}

/**
 * Read the library again and publish, once for every change that arrived since
 * the last read began: a hook that lands while a read is in flight is read
 * again after it. It starts behind the first publication, so a change heard
 * before the rows were first published cannot publish ahead of it.
 */
async function republish() {
  await _first;
  while (_dirty) {
    _dirty = false;
    const except = new Set(_gone);
    _gone.clear();
    try {
      publish(await readRowSources(except));
    } catch (err) {
      console.error(`${MODULE_ID} | the weapon rows could not be republished`, err);
    }
  }
}

/** Queue one republish for a library weapon's create, update or delete; a burst of them is one read. */
function queueRepublish(item, deleted) {
  if (deleted) _gone.add(item.id);
  else _gone.delete(item.id);
  _dirty = true;
  clearTimeout(_reread);
  _reread = setTimeout(() => {
    _reread = null;
    _rereading ??= republish().finally(() => {
      _rereading = null;
      if (!_reread && !_dirty) releaseQuiet();
    });
  }, ROWS_REREAD_MS);
}

/**
 * Publish once the library's weapons and variations have been read, and again
 * whenever a library weapon is created, updated or deleted. The first
 * publication reads the shelves' indexes (`rowsReady` resolves when it has
 * landed, even where it failed); a change is read again from the index, once per
 * burst, with a deleted document's id left out because its hook can fire while
 * the collection still lists it.
 */
export function registerWeaponRows() {
  _settled = false;
  _first = new Promise((resolve) => {
    Hooks.once("ready", async () => {
      mark(ROWS_MARK_STARTED);
      try {
        const count = publish(await readRowSources());
        if (count) console.log(`${MODULE_ID} | equipment published ${count} weapon row(s).`);
      } catch (err) {
        console.error(`${MODULE_ID} | the weapon rows could not be published`, err);
      } finally {
        mark(ROWS_MARK_PUBLISHED);
        _settled = true;
        resolve();
      }
    });
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (!isLibraryWeapon(item) || !game.ready) return;
      queueRepublish(item, hook === "deleteItem");
    });
  }
}
