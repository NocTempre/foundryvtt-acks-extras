/**
 * Shared identifiers for the character sheet. Foundry-free, so the view-model
 * tests can import them.
 */
export { MODULE_ID } from "../lib/constants.mjs";

/** The feature's lang root — every `ACKS-CHARACTER.*` key hangs off it. */
export const LANG = "ACKS-CHARACTER";

/** The sheet's own class on the application root; injectors gate on it via `ownsSheet`. */
export const SHEET_CLASS = "acks-extras-character-sheet";

/** The frame's flags, saves, movement modes and AC readings are the lib's (`lib/frame-model.mjs`). */
export { SHEET_FLAG, FOLD_FLAG, SAVE_KEYS, SAVE_ICONS, MOVE_MODES, AC_MODES } from "../lib/frame-model.mjs";

/**
 * Actor flag recording the last official-sheet import: `importedAt`, `fields`
 * (every box the form had filled, by module key) and `notes` (the exact block
 * the import wrote into the notes, so the next one replaces it). The export
 * reads the boxes the character keeps no field for back out of `fields`.
 */
export const PDF_RECORD_FLAG = "sheetPdf";

/** User flag: which organisation the Stats tab's weapon list is regrouped by — a viewing preference, so the viewer's. */
export const TRAINING_VIEW_FLAG = "trainingView";

/** The tab keys, in the one order they ever appear. */
export const TAB_ORDER = Object.freeze(["rolls", "abilities", "equipment", "stats", "class", "magic", "trade", "service", "followers", "notes", "effects"]);

/** The mark each duration unit wears on a clock, keyed as Foundry names the unit. */
export const CLOCK_MARKS = Object.freeze({ rounds: "r", turns: "t", seconds: "s", minutes: "m", hours: "h", days: "d", months: "mo", years: "y" });

/** The adventuring throws the system stores, in the printed order. */
export const ADVENTURING_KEYS = Object.freeze(["dungeonbashing", "climb", "listening", "searching", "trapbreaking"]);

/**
 * Which save a condition rides on, by status id (the lib's condition
 * catalogue is the id list). The book names the save only for escapes
 * (Paralysis) and enervation (Death); the rest take the save of what imposed
 * them. A status absent here takes its source's own `save`.
 */
export const CONDITION_SAVES = Object.freeze({
  paralyzed: "paralysis",
  restrained: "paralysis",
  petrified: "paralysis",
  webbed: "paralysis",
  enervated: "death",
  burning: "blast",
  slumbering: "spell",
  frightened: "spell",
  bewitched: "spell",
});

/**
 * Conditions with no save, riding on the right-rail cell they change:
 * prone and stuck on movement, unconscious and dead on HP, blinded on light.
 */
export const RAIL_CONDITIONS = Object.freeze({
  prone: "move",
  stuck: "move",
  unconscious: "hp",
  dead: "hp",
  blinded: "light",
});

/** Light-cell glyphs by what the character sees by. */
export const LIGHT_ICONS = Object.freeze({
  dark: "fa-solid fa-moon",
  day: "fa-solid fa-sun",
  blind: "fa-solid fa-eye-slash",
  torch: "fa-solid fa-fire-flame-curved",
  lantern: "fa-solid fa-lightbulb",
  candle: "fa-solid fa-fire-flame-simple",
  shadowy: "fa-solid fa-eye-low-vision",
  lightless: "fa-solid fa-eye",
});

/**
 * Actor flag naming the character a creature was summoned by (an actor uuid).
 * Written on the summoned actor — a token's own delta for an unlinked token —
 * by the party cell's bind control; read by the party count.
 */
export const SUMMON_FLAG = "summonedBy";

/** The far-right rail: tools that act on the sheet, never on the character. */
export const TOOL_CELLS = Object.freeze([
  { key: "editDescription", icon: "fa-solid fa-pen-to-square" },
  { key: "changeArt", icon: "fa-solid fa-image" },
  { key: "editTags", icon: "fa-solid fa-tags" },
  { key: "ownership", icon: "fa-solid fa-user-lock" },
  { key: "source", icon: "fa-solid fa-book-open", gmOnly: true },
  { key: "tweaks", icon: "fa-solid fa-screwdriver-wrench" },
]);
