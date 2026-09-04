/**
 * Shared identifiers for the character sheet. Foundry-free, so the view-model
 * tests can import them.
 */
export { MODULE_ID } from "../lib/constants.mjs";

/** The feature's lang root — every `ACKS-CHARACTER.*` key hangs off it. */
export const LANG = "ACKS-CHARACTER";

/** The sheet's own class on the application root; injectors gate on it via `ownsSheet`. */
export const SHEET_CLASS = "acks-extras-character-sheet";

/**
 * Actor flag holding what the sheet keeps ON the character: `pins` (roll,
 * timer and resource ids starred for the folded bar) and `acMode` (which AC
 * the rail cell states). Character data, so it is owner-written.
 */
export const SHEET_FLAG = "sheet";

/**
 * User flag holding the fold state per actor id. A viewing preference lives
 * with the viewer: an observer seat can fold a sheet it cannot edit.
 */
export const FOLD_FLAG = "sheetFold";
/** User flag: which organisation the Stats tab's weapon list is regrouped by — a viewing preference, so the viewer's. */
export const TRAINING_VIEW_FLAG = "trainingView";

/** The tab keys, in the one order they ever appear. */
export const TAB_ORDER = Object.freeze(["rolls", "abilities", "equipment", "stats", "class", "magic", "followers", "notes", "effects"]);

/** The five saving throws, in the printed order, keyed as the released system stores them. */
export const SAVE_KEYS = Object.freeze(["paralysis", "death", "blast", "implements", "spell"]);

/** The glyph each save cell wears (Font Awesome, per DECISIONS "the rails draw Foundry's icons"). */
export const SAVE_ICONS = Object.freeze({
  paralysis: "fa-solid fa-snowflake",
  death: "fa-solid fa-skull",
  blast: "fa-solid fa-burst",
  implements: "fa-solid fa-wand-magic",
  spell: "fa-solid fa-hat-wizard",
});

/**
 * The six movement modes the system derives, each with the glyph its rail
 * cell and its Stats row wear and the unit its figure is read in.
 */
export const MOVE_MODES = Object.freeze([
  { key: "exploration", icon: "fa-solid fa-map", unit: "perTurn" },
  { key: "combat", icon: "fa-solid fa-crosshairs", unit: "perRound" },
  { key: "chargerun", icon: "fa-solid fa-person-running", unit: "perRound" },
  { key: "expedition", icon: "fa-solid fa-person-hiking", unit: "perDay" },
  { key: "stealth", icon: "fa-solid fa-user-ninja", unit: "perRound" },
  { key: "climb", icon: "fa-solid fa-mountain", unit: "perRound" },
]);

/** The three readings of the AC cell, in cycle order. */
export const AC_MODES = Object.freeze(["shield", "armour", "none"]);

/** The adventuring throws the system stores, in the printed order. */
export const ADVENTURING_KEYS = Object.freeze(["dungeonbashing", "climb", "listening", "searching", "trapbreaking"]);

/**
 * Which save a condition rides on, by status id. The book names the save only
 * for escapes (Paralysis) and enervation (Death); the rest take the save of
 * what imposed them, which is what the mapping states for the statuses Foundry
 * and the system ship. A status absent here takes its source's own `save`.
 */
export const CONDITION_SAVES = Object.freeze({
  paralysis: "paralysis",
  restrain: "paralysis",
  petrified: "paralysis",
  webbed: "paralysis",
  poison: "death",
  disease: "death",
  bleeding: "death",
  degen: "death",
  enervated: "death",
  burning: "blast",
  frozen: "blast",
  shock: "blast",
  corrode: "blast",
  sleep: "spell",
  slumbering: "spell",
  fear: "spell",
  curse: "spell",
  charmed: "spell",
});

/**
 * Conditions with no save, riding on the right-rail cell they change:
 * prone and stuck on movement, unconscious and dead on HP, blinded on light.
 */
export const RAIL_CONDITIONS = Object.freeze({
  prone: "move",
  stun: "move",
  unconscious: "hp",
  dead: "hp",
  blind: "light",
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
