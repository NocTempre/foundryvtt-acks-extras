/* global foundry */
import { SAVE_KEYS } from "../constants.mjs";
import {
  ON_SUCCESS,
  RESOLUTIONS,
  SCOPES,
  TRAP_LEVELS,
  TRIGGER_DEFAULT,
  TRIGGER_DIE,
  emptyTier,
} from "../trap-rules.mjs";

/**
 * Data model for the `acks-extras.trap` Item subtype — one trap, as the
 * Judge's book defines one: where it is dangerous, what springs it, and what
 * it does at each of the six levels it is printed at. A Trap Zone holds a
 * reference to one of these plus its own state (armed, spotted, spent); the
 * definition is shared. Hand creation is a first-class path, not a fallback.
 * See docs/formation/DECISIONS.md, "A trap is a document; the region and
 * the wall only place it".
 */
export default class TrapData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    // Resolved here rather than at module scope: `TRAP_ITEM_TYPE` above is
    // imported by Foundry-free code (and by the offline tests), and a
    // module-level `foundry.data.fields` would break that import.
    const fields = foundry.data.fields;
    return {
      /**
       * Which of the six rows is in force. The book rates a trap against a
       * divine spell of the same level, which is guidance for the Judge writing
       * the effect rather than a number anything here computes with.
       */
      level: new fields.NumberField({ required: true, initial: 1, min: 1, max: TRAP_LEVELS, integer: true }),

      /**
       * What this trap does at each level, 1st through 6th.
       *
       * Rows are allowed to be empty: a Judge inventing a trap for one level
       * owes nothing for the other five, and an imported trap fills whichever
       * the book prints. Reading is always through `tier`, never by index, so
       * a short or absent array degrades to an empty row instead of throwing.
       */
      levels: new fields.ArrayField(new fields.SchemaField(TrapData.tierSchema(fields)), {
        required: true,
        initial: () => Array.from({ length: TRAP_LEVELS }, () => emptyTier()),
      }),

      /** 1d6 at or under this springs it — widened or narrowed per the book. */
      triggerOn: new fields.NumberField({
        required: true,
        initial: TRIGGER_DEFAULT,
        min: 0,
        max: TRIGGER_DIE,
        integer: true,
      }),
      /** How it is set off, in the Judge's words: tripwire, pressure plate, rune. */
      trigger: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** One checkbox for the trap's whole crude modifier set; describes the build, not the level. */
      crude: new fields.BooleanField({ initial: false }),

      /** Whoever set it off, or everything within the row's `radiusFeet` of the spot. */
      scope: new fields.StringField({ required: true, initial: SCOPES.triggerer, choices: Object.values(SCOPES) }),

      description: new fields.HTMLField({ required: false, blank: true }),
    };
  }

  /**
   * One level's worth of trap: everything the book restates per tier.
   *
   * @param {object} fields `foundry.data.fields`, passed in so this stays
   *   callable from `defineSchema` without a module-level Foundry reference.
   */
  static tierSchema(fields) {
    return {
      /**
       * What the book says at this level, in its own words. Kept whole
       * alongside the typed fields, which fill in only where the reading is
       * unambiguous.
       */
      text: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Save, attack throw, automatic damage, or nothing the module rolls. */
      resolution: new fields.StringField({
        required: true,
        initial: RESOLUTIONS.automatic,
        choices: Object.values(RESOLUTIONS),
      }),
      /**
       * What beating the save is worth. Ignored by a trap that makes an
       * attack throw: a bolt that missed deals nothing whatever this says.
       */
      onSuccess: new fields.StringField({
        required: true,
        initial: ON_SUCCESS.half,
        choices: Object.values(ON_SUCCESS),
      }),
      /** Which save it allows. `breath` is the Blast save in the released system. */
      saveKey: new fields.StringField({ required: false, blank: true, initial: "", choices: ["", ...SAVE_KEYS] }),
      /**
       * The attack throw for a fighter of this trap's level, stored rather
       * than derived — see docs/formation/DECISIONS.md, "A trap is a
       * document; the region and the wall only place it".
       */
      attackThrow: new fields.NumberField({ required: true, initial: 0, min: 0, max: 30, integer: true }),

      /** What it deals. Beats the pit derivation below when both are set. */
      damageFormula: new fields.StringField({ required: false, blank: true, initial: "" }),
      /** A pit's depth, in feet. */
      pitDepthFeet: new fields.NumberField({ required: true, initial: 0, min: 0, max: 500, integer: true }),
      spiked: new fields.BooleanField({ initial: false }),

      /** How far an area effect reaches at this level. */
      radiusFeet: new fields.NumberField({ required: true, initial: 0, min: 0, max: 200, integer: true }),

      /** A rider condition, in the Judge's words, printed on the card to apply. */
      rider: new fields.StringField({ required: false, blank: true, initial: "" }),
    };
  }

  /**
   * The row in force, never null. Every consumer reads the trap through
   * this rather than indexing `levels`, so a short, absent or hand-built
   * array still answers with a whole row.
   */
  get tier() {
    return this.levels?.[this.level - 1] ?? this.levels?.[0] ?? emptyTier();
  }
}
