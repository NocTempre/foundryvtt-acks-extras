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
 * Data model for the `acks-extras.trap` Item subtype — one trap, as the Judge's
 * book defines one: where it is dangerous, what springs it, and what it does at
 * each of the six levels it is printed at.
 *
 * **Why this is a document and not a pile of fields on the region.** The book
 * prints thirteen worked traps, each at six levels, and those numbers are book
 * content with an owner: they reach a world through `acks-importer`, from the
 * GM's own copy, exactly as the thief ladders and the Spelunking table do. A
 * trap has to be a DOCUMENT for the importer to have something to materialize
 * into, for a Judge to keep a compendium of the ones they use, and for the same
 * trap to sit in three corridors without being typed three times.
 *
 * **Why one document holds all six levels.** A scything blade is one trap. What
 * changes with its level is what it does, not what it is — the trigger, the
 * build and the name are the same at 1st and 6th — so the levels are rows on
 * one document rather than six near-identical documents a Judge has to keep in
 * step. `level` selects the row in force; `tier` reads it.
 *
 * A Trap Zone therefore holds a REFERENCE to one of these plus its own state.
 * The definition is shared; being armed, spotted or spent belongs to the place
 * it is buried in, not to the idea of a scything blade.
 *
 * Hand creation is a first-class path, not a fallback: a Judge with no imported
 * book, or with a trap of their own devising, makes one of these on the Items
 * tab and fills it in. Nothing here requires the importer to have run, and a
 * Judge who only cares about one level fills in one row.
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

      /**
       * Crudely built: +4 to find and to remove, attacks at -2, victims save at
       * +2. One checkbox because one modifier set covers every crude trap, and
       * it describes the BUILD rather than the level, so it is not a row.
       */
      crude: new fields.BooleanField({ initial: false }),

      /**
       * Whoever set it off, or everything within the row's `radiusFeet` of the
       * spot. What a trap reaches is a property of the trap — a deadfall is an
       * area at every level — while how FAR it reaches grows, so the scope sits
       * here and the distance sits on the row.
       */
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
       * What the book says at this level, in its own words.
       *
       * The printed tier is one sentence doing several things at once — a
       * throw, a die of damage, and a rider that is prose however it is read —
       * so the import keeps it whole here and fills the typed fields beside it
       * only where the reading is unambiguous. A Judge always has the sentence
       * to check the numbers against, and a level the book states in a way
       * nothing can parse still arrives instead of being dropped.
       */
      text: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Save, attack throw, automatic damage, or nothing the module rolls. */
      resolution: new fields.StringField({
        required: true,
        initial: RESOLUTIONS.automatic,
        choices: Object.values(RESOLUTIONS),
      }),
      /**
       * What beating the save is worth. The book's traps disagree — a ceiling
       * collapse halves, a deadfall is dodged outright, a portcullis grants a
       * choice of side and no mitigation at all — so it is a field, not an
       * assumption. Ignored by a trap that makes an attack throw: a bolt that
       * missed deals nothing whatever this says.
       */
      onSuccess: new fields.StringField({
        required: true,
        initial: ON_SUCCESS.half,
        choices: Object.values(ON_SUCCESS),
      }),
      /** Which save it allows. `breath` is the Blast save in the released system. */
      saveKey: new fields.StringField({ required: false, blank: true, initial: "", choices: ["", ...SAVE_KEYS] }),
      /**
       * The attack throw for a fighter of this trap's level, from the Judge's
       * own book. The fighter progression is book content this module does not
       * hold, so the answer is stored rather than derived from `level`.
       */
      attackThrow: new fields.NumberField({ required: true, initial: 0, min: 0, max: 30, integer: true }),

      /** What it deals. Beats the pit derivation below when both are set. */
      damageFormula: new fields.StringField({ required: false, blank: true, initial: "" }),
      /** A pit's depth: 1d6 per 10' fallen is the rule, so depth is enough. */
      pitDepthFeet: new fields.NumberField({ required: true, initial: 0, min: 0, max: 500, integer: true }),
      spiked: new fields.BooleanField({ initial: false }),

      /** How far an area effect reaches at this level. */
      radiusFeet: new fields.NumberField({ required: true, initial: 0, min: 0, max: 200, integer: true }),

      /**
       * Prone, restrained, hoisted, stuck, burning, a Mortal Wounds roll — the
       * riders the book's traps carry are prose, and they are printed on the
       * card for the Judge to apply. Modelling each as a mechanic would be
       * inventing a condition system the system already owns.
       */
      rider: new fields.StringField({ required: false, blank: true, initial: "" }),
    };
  }

  /**
   * The row in force, never null.
   *
   * Every consumer reads the trap through this rather than indexing `levels`,
   * so a document whose array is short, absent or built by hand still answers
   * with a whole row instead of throwing halfway through resolving a trap that
   * has already gone off.
   */
  get tier() {
    return this.levels?.[this.level - 1] ?? this.levels?.[0] ?? emptyTier();
  }
}
