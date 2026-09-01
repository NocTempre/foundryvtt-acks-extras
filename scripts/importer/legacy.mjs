/**
 * The retired standalone `acks-importer` module. The ONLY file under
 * `scripts/` allowed to name that id — everywhere else the built-in importer
 * speaks only of itself.
 */

/** World id of the separate module this feature replaces. */
export const LEGACY_ID = "acks-importer";

/**
 * Per-seat localStorage keys the standalone module wrote before this feature
 * absorbed it: two pre-possession-model prose/content caches, and the
 * refresh-bridge stamp. Purged at `ready` so an upgrading seat is not left
 * carrying dead records under the old module's name.
 */
export const LEGACY_LOCAL_KEYS = [
  "acks-importer.proseCache",
  "acks-importer.contentCache",
  "acks-importer.bridgeTouched",
];

/**
 * Server directories the standalone module wrote under the Foundry data path:
 * the shelf of staged books and the extracted page art. Both stay where they
 * are — Foundry offers no move or delete — so the shelf scan and the art
 * cache read them beside this module's own directories; new writes go to
 * the new ones only.
 */
export const LEGACY_SHELF_DIR = "acks-importer-books";
export const LEGACY_ART_DIR = "acks-importer-art";

/** True while the retired standalone module is installed and enabled. */
export const legacyImporterActive = () => !!game.modules.get(LEGACY_ID)?.active;
