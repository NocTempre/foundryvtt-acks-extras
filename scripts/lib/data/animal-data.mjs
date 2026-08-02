/* global foundry */
/**
 * `acks-lib.animal` — the bridge between an animal and a monster.
 *
 * THE PROBLEM. The RR equipment chapter prices ten animals — camel, hunting and
 * war dog, donkey, four horses, mule, ox — and because they are bought in a
 * shop they import as INVENTORY ITEMS. A war dog is then, as far as the system
 * is concerned, a backpack: it cannot be attacked, cannot fight, has no morale
 * and cannot be ridden. But an animal is a creature, and the books stat it as
 * one.
 *
 * THE BRIDGE. This sub-type's combat block uses the SAME FIELD PATHS as the
 * system's own monster (`hp`, `aac`, `thac0`, `movement`, `saves`,
 * `details.morale`, …). That is the whole point of it: anything that already
 * reads a monster — an encounter helper, a morale check, acks-formation's unit
 * maths — reads an animal without knowing animals exist. An animal is a monster
 * that can also be bought, loaded and ridden.
 *
 * Deliberately NOT a monster sub-type of its own making: the schema is declared
 * here rather than imported from the system because a released acks system
 * ships one bundled `acks.mjs`, not its individual data-model files, so there
 * is nothing to import at runtime. The field paths are mirrored on purpose and
 * the initials are copied from the system's templates — see actor-compat.mjs.
 *
 * What it adds beyond a monster is the shop-and-stable half: what the animal
 * can CARRY, whether it can be RIDDEN, and how well it is trained.
 */
import { savingThrowFields } from "../actor-compat.mjs";

/** How an animal was trained (RR Animal Training). Display strings are i18n keys. */
export const ANIMAL_TRAINING = Object.freeze({
  untrained: "ACKS-LIB.animal.training.untrained",
  riding: "ACKS-LIB.animal.training.riding",
  draft: "ACKS-LIB.animal.training.draft",
  war: "ACKS-LIB.animal.training.war",
  hunting: "ACKS-LIB.animal.training.hunting",
  herding: "ACKS-LIB.animal.training.herding",
});

export default class AnimalData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;
    const int = (initial, opts = {}) => new NumberField({ required: true, integer: true, initial, ...opts });

    return {
      // Schema version marker, matching the system's own convention so a future
      // migration can tell an unmigrated animal from a current one.
      _schemaVersion: new NumberField({ required: true, initial: 0, integer: true, min: 0 }),

      // --- The monster-shaped combat block. Same paths, same initials. ---
      isNew: new BooleanField({ initial: false }),
      hp: new SchemaField({
        hd: new StringField({ required: true, initial: "1d8", blank: false }),
        value: new NumberField({ required: true, initial: 4 }),
        max: new NumberField({ required: true, initial: 4 }),
        bhr: new StringField({ required: true, initial: "1d3", blank: false }),
      }),
      aac: new SchemaField({
        value: new NumberField({ initial: 0 }),
        mod: new NumberField({ initial: 0 }),
      }),
      damage: new SchemaField({
        mod: new SchemaField({
          missile: new NumberField({ initial: 0 }),
          melee: new NumberField({ initial: 0 }),
        }),
      }),
      thac0: new SchemaField({
        value: new NumberField({ initial: 19 }),
        bba: new NumberField({ initial: 0 }),
        throw: new NumberField({ required: true, initial: 10 }),
        mod: new SchemaField({
          missile: new NumberField({ initial: 0 }),
          melee: new NumberField({ initial: 0 }),
        }),
      }),
      movement: new SchemaField({
        base: new NumberField({ initial: 120 }),
        mod: new NumberField({ initial: 0 }),
        // The monster sheet reads `movement.value` (a String); the system's
        // computeAdditionnalData writes `movement.encounter` on every actor.
        // Both exist so the sheet renders and the system's derived pass has its
        // target — the same reason the compat stubs carry `encounter`.
        value: new StringField({ blank: true, initial: "" }),
        encounter: new NumberField({ initial: 40 }),
      }),
      initiative: new SchemaField({
        value: int(0),
        mod: int(0),
      }),
      // Exact monster paths — the sheet binds inputs to `surpriseothers` and
      // `avoidsurprise`, so a subset would silently drop those on save.
      surprise: new SchemaField({
        mod: new NumberField({ initial: 0 }),
        surpriseothers: new NumberField({ initial: 0 }),
        avoidsurprise: new NumberField({ initial: 0 }),
      }),
      // A war dog IS a hired creature, and the monster sheet renders the
      // retainer block regardless, so the animal carries it. `category` is a
      // plain StringField, not a choice: the sheet populates the dropdown from
      // the system's config at render, and acks-lib cannot import the system's
      // ACKS.hireling_categories at schema-definition time. Storing the chosen
      // string needs no validator here.
      retainer: new SchemaField({
        enabled: new BooleanField({ initial: false }),
        loyalty: new NumberField({ integer: true, min: -4, max: 4, initial: 0 }),
        wage: new StringField({ blank: true, initial: "" }),
        managerid: new StringField({ blank: true, initial: "" }),
        category: new StringField({ blank: true, initial: "henchman" }),
        quantity: new NumberField({ initial: 1 }),
      }),
      ...savingThrowFields(),

      details: new SchemaField({
        biography: new StringField({ blank: true, initial: "" }),
        alignment: new StringField({ blank: true, initial: "Neutral" }),
        xp: new NumberField({ initial: 0 }),
        // Same range and meaning as a monster's (MM 12), so a morale check
        // written for monsters works unchanged.
        morale: new NumberField({ integer: true, min: -6, max: 4, initial: 0 }),
        // A war dog is worth taking loot from, and the system's monster sheet
        // reads these unguarded — see the note below.
        treasure: new SchemaField({
          table: new StringField({ blank: true, initial: "" }),
          type: new StringField({ blank: true, initial: "" }),
        }),
        // The sheet's "number appearing" inputs (dungeon / wilderness). A herd
        // animal has these as much as a monster does.
        appearing: new SchemaField({
          d: new StringField({ blank: true, initial: "" }),
          w: new StringField({ blank: true, initial: "" }),
        }),
      }),

      // --- What the SYSTEM'S MONSTER SHEET reads ---
      // The bridge is only real if the sheet works, and this module ships no
      // sheet of its own: it registers the system's monster sheet for animals
      // (see module.mjs), because an animal IS a monster you can also buy. That
      // sheet touches these four unguarded, so they exist here for the same
      // reason acks-lib's compat stubs exist at all.
      pattern: new StringField({ required: true, initial: "white" }),
      counter: new SchemaField({
        value: new NumberField({ initial: 0, min: 0 }),
        max: new NumberField({ initial: 0, min: 0 }),
      }),
      spells: new SchemaField({
        // Off by default — most animals cast nothing. The field exists so the
        // sheet can ask; a magical beast is welcome to turn it on.
        enabled: new BooleanField({ initial: false }),
      }),

      // --- The half a monster does not have: bought, loaded, ridden. ---
      animal: new SchemaField({
        // Free text on purpose: the meaningful set is whatever the reader's
        // book prices, and this library ships no book values.
        species: new StringField({ blank: true, initial: "" }),
        training: new StringField({ choices: ANIMAL_TRAINING, required: false, blank: true, initial: "untrained" }),
        // Load in 1/6 stone, matching the system's `weight6` unit exactly — a
        // second weight unit in the family is a conversion bug waiting to
        // happen. Null means "not stated": the animal carries what the Judge
        // says, and 0 would claim it can carry nothing.
        capacity6: new NumberField({ required: false, nullable: true, initial: null, min: 0 }),
        // Above this load the animal is encumbered (RR's two-band scheme).
        // Null = unstated, same reasoning.
        unencumbered6: new NumberField({ required: false, nullable: true, initial: null, min: 0 }),
        // Can something ride it at all? Distinct from `training: "riding"` —
        // an ox is mountable in principle and untrained in practice.
        mountable: new BooleanField({ initial: false }),
        // What the animal cost, if the seat's book supplied a price. Never
        // shipped: a value here came from the reader's own book.
        cost: new NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      }),
    };
  }

  /**
   * Derived: the same two values the system computes for its own actors, so an
   * animal is not the one actor on the table with an empty attack bonus.
   * @override
   */
  prepareDerivedData() {
    this.thac0.bba = 10 - (this.thac0.throw ?? 10);
    this.movement.encounter = Math.floor((this.movement.base ?? 0) / 3);
  }
}
