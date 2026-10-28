/* global CONFIG */
/**
 * Core patch: a character or monster whose stored record still names the
 * system's old combat fields loads with their values under the new names.
 *
 * The system's `migrateData` renames `thac0` → `attack`, `aac` → `ac` and the
 * saves `breath` → `blast`, `wand` → `implements`, but only while the record's
 * `_schemaVersion` is below current. Its world migration stamps the record
 * through a diffed update built from the already-migrated document, so the
 * stamp is all that is written: the record keeps the old fields, the next load
 * skips the rename, and the schema fills the new fields with their defaults.
 * This runs `migrateLegacyCombatSource` ahead of the system's own method on
 * every load. It fills only a new field that is absent and writes nothing, so
 * a record the system did migrate is left as it is.
 *
 * See docs/lib/DECISIONS.md, "A stamped record's old combat fields are read at
 * load".
 */
import { MODULE_ID } from "../constants.mjs";
import { migrateLegacyCombatSource } from "../actor-compat.mjs";

/** The system's actor types whose `migrateData` skips its renames on a current stamp. */
const RESCUED_TYPES = ["character", "monster"];

/**
 * Install at `init`, before the world's documents are built: `setup` is too
 * late, since `initializeDocuments` constructs every actor ahead of it.
 */
export function installLegacyCombatRescue() {
  for (const type of RESCUED_TYPES) {
    const model = CONFIG.Actor?.dataModels?.[type];
    if (typeof model?.migrateData !== "function") {
      console.warn(`${MODULE_ID} | no ${type} data model to wrap; a stamped record's old combat fields will load as defaults.`);
      continue;
    }
    // An own static, reassigned: `super.migrateData` inside the system's
    // method still resolves against the class it was written on.
    const original = model.migrateData;
    model.migrateData = function (source) {
      migrateLegacyCombatSource(source);
      return original.call(this, source);
    };
  }
}
