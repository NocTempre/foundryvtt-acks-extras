/* global foundry */
import { DEMAND_COLUMN_KEYS, MARKET_CLASS_COUNT, MERCHANDISE_TIERS } from "../merchandise-keys.mjs";

/**
 * Data model for the `acks-extras.merchandise` Item sub-type: one good in the
 * trade catalogue (see docs/markets/MODEL.md, "The merchandise catalogue").
 *
 * The item is deliberately non-physical: no `cost`, no `weight6`. It defines a
 * kind of goods, not a load of them, so encumbrance never counts it and it is
 * never carried. Every figure is imported from the Judge's own book or typed
 * by the Judge; the schema ships no values, and an unread figure stays `null`
 * so it cannot pass for a printed zero.
 */
export default class MerchandiseData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    // Resolved in the method, not at module scope: the offline harness imports
    // this file before it builds the `foundry` mock.
    const fields = foundry.data.fields;
    const figure = () => new fields.NumberField({ required: true, nullable: true, initial: null });
    const strings = () => new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] });
    return {
      /**
       * The catalogue key the markets look a good up by. A blank key is allowed
       * so a half-typed hand-made good still saves; the catalogue ignores it
       * until it is filled.
       */
      key: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** The tier the good belongs to. */
      tier: new fields.StringField({ required: true, blank: false, initial: MERCHANDISE_TIERS[0], choices: [...MERCHANDISE_TIERS] }),

      /** What the good travels and sells in, as printed. */
      container: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Base price per stone, in gp. */
      pricePerStoneGp: figure(),

      /** One demand step of the price, in gp per stone. */
      priceStepGp: figure(),

      /** Stones on offer in a month, by market class, class I first. */
      dailyStones: new fields.ArrayField(figure(), {
        initial: () => Array.from({ length: MARKET_CLASS_COUNT }, () => null),
      }),

      /**
       * The demand modifier this good takes from the settlement's age band and
       * terrain, by column key; halves allowed. A column with no printed
       * modifier stays `null`.
       */
      environment: new fields.SchemaField(Object.fromEntries(DEMAND_COLUMN_KEYS.map((key) => [key, figure()]))),

      /** The demand modifier a settlement's dominant race applies, by race key. */
      racial: new fields.ObjectField({ initial: {} }),

      /** Where the good sits on the random-merchandise table, when it does. */
      random: new fields.SchemaField({
        table: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...MERCHANDISE_TIERS] }),
        min: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null }),
        max: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null }),
        special: new fields.BooleanField({ initial: false }),
      }),

      /** The good is exempt from the transit tariff. */
      tariffExempt: new fields.BooleanField({ initial: false }),

      /** The good's price follows the season. */
      seasonalPrice: new fields.BooleanField({ initial: false }),

      /** The kinds of loot that sell as this good. */
      lootKinds: strings(),

      /** The equipment categories that sell as this good. */
      itemCategories: strings(),

      /** Other names the good goes by, for matching a name typed or printed elsewhere. */
      aliases: strings(),

      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      /** Where the figures were read from: the book id and the page reference. */
      source: new fields.SchemaField({
        book: new fields.StringField({ required: false, blank: true, initial: "" }),
        page: new fields.StringField({ required: false, blank: true, initial: "" }),
      }),
    };
  }
}
