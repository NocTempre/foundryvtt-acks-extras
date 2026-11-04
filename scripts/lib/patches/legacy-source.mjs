/* global CONFIG */
/**
 * Core patch: a character, monster or item whose stored record still holds
 * the system's old field names or shapes loads with their values under the
 * new ones.
 *
 * The system's `migrateData` renames them (an actor's `thac0` → `attack`,
 * `aac` → `ac` and the saves `breath` → `blast`, `wand` → `implements`; an
 * item's string damage, numeric bonus, tag list, weight and `aac`, and an old
 * save key), but only while the record's `_schemaVersion` is below current.
 * Its world migration stamps the record through a diffed update built from the
 * already-migrated document, so the stamp is all that is written: the record
 * keeps the old fields, the next load skips the rename, and the schema fills
 * the new fields with their defaults.
 *
 * An actor runs `migrateLegacyCombatSource` ahead of the system's own method,
 * filling only a new field that is absent. An item whose record a rename
 * would still change runs the system's own method with the stamp held below
 * current for that one call, so the system's own helpers do the renaming,
 * and gets the stamp back after. Neither writes: what each document was
 * rescued from is kept against its loaded `system` source, where the
 * stamped-record repair check reads it and writes it to the record.
 *
 * Only a whole record is rescued. A change set (`options.partial`) carries no
 * stamp, so the system migrates it on its own.
 *
 * See docs/lib/DECISIONS.md, "A stamped record's old combat fields are read at
 * load", and "A stamped item is read at load and written by a repair check".
 */
import { MODULE_ID } from "../constants.mjs";
import { legacyItemFields, migrateLegacyCombatSource } from "../actor-compat.mjs";

/** The system's actor types whose `migrateData` skips its renames on a current stamp. */
const RESCUED_TYPES = ["character", "monster"];

/** The system's item types whose `migrateData` skips its renames on a current stamp. */
const RESCUED_ITEM_TYPES = ["weapon", "armor", "item", "ability", "spell"];

/** Loaded `system` source → the fields it was rescued from. */
const rescued = new WeakMap();

/**
 * The fields a document's loaded `system` source was rescued from, or null
 * when it loaded as stored. Keyed by the object, so a document whose record
 * has since been rewritten whole answers null.
 *
 * @param {object} system  a document's `_source.system`
 * @returns {string[]|null}
 */
export function rescuedFields(system) {
  return (system && rescued.get(system)) ?? null;
}

/** Forget a rescue once its record has been written. */
export function forgetRescue(system) {
  if (system) rescued.delete(system);
}

/**
 * Add `fields` to what `system` was rescued from. An embedded item's source
 * is migrated twice, once inside its parent's and once as its own document,
 * and the second pass sees only what the first left, so the lists are joined.
 */
function remember(system, fields) {
  const known = rescued.get(system) ?? [];
  rescued.set(system, [...known, ...fields.filter((f) => !known.includes(f))]);
}

/** Wrap one data model's `migrateData` with `rescue`, warning when there is no model. */
function wrap(documentName, type, rescue) {
  const model = CONFIG[documentName]?.dataModels?.[type];
  if (typeof model?.migrateData !== "function") {
    console.warn(`${MODULE_ID} | no ${type} data model to wrap; a stamped record's old fields will load as defaults.`);
    return;
  }
  // An own static, reassigned: `super.migrateData` inside the system's
  // method still resolves against the class it was written on.
  const original = model.migrateData;
  model.migrateData = function (source, options) {
    return rescue.call(this, original, source, options);
  };
}

/** An actor: fill each absent new field from its old name, then the system's method. */
function rescueActor(original, source, options) {
  const filled = [];
  if (!options?.partial) migrateLegacyCombatSource(source, filled);
  const out = original.call(this, source, options);
  if (filled.length) remember(out ?? source, filled);
  return out;
}

/** An item: the system's method, with the stamp held below current while its renames run. */
function rescueItem(type, original, source, options) {
  // A record carries its stamp; creation data and change sets do not, and the
  // system migrates those on its own.
  if (options?.partial || !source || !Object.hasOwn(source, "_schemaVersion")) return original.call(this, source, options);
  const fields = legacyItemFields(type, source);
  if (!fields.length) return original.call(this, source, options);
  if (fields.includes("alternate")) source.damage.alternate = { ...(source.damage.alternate ?? {}), formula: "" };
  const stamp = source._schemaVersion;
  source._schemaVersion = 0;
  let out;
  try {
    out = original.call(this, source, options);
  } finally {
    source._schemaVersion = stamp;
    if (out && out !== source) out._schemaVersion = stamp;
  }
  remember(out ?? source, fields);
  return out;
}

/**
 * Install at `init`, before the world's documents are built: `setup` is too
 * late, since `initializeDocuments` constructs every document ahead of it.
 */
export function installLegacyCombatRescue() {
  for (const type of RESCUED_TYPES) wrap("Actor", type, rescueActor);
  for (const type of RESCUED_ITEM_TYPES) {
    wrap("Item", type, function (original, source, options) {
      return rescueItem.call(this, type, original, source, options);
    });
  }
}
