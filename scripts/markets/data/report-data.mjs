/* global foundry */
import { REPORT_OUTCOMES } from "../rules/reports.mjs";

/**
 * Data model for the `acks-extras.marketReport` Item sub-type: what one
 * character believes about one market's demand (docs/markets/MODEL.md, "Market
 * reports").
 *
 * The item is non-physical (no `cost`, no `weight6`) and lives on the trade
 * house, stamped with its owner through `lib/storage`. It holds only what its
 * owner believes: a false assessment is stored as a report whose beliefs are
 * wrong, and the true demand never enters it.
 */
export default class MarketReportData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    // Resolved in the method, not at module scope: the offline harness imports
    // this file before it builds the `foundry` mock.
    const fields = foundry.data.fields;
    const text = () => new fields.StringField({ required: true, blank: true, initial: "" });
    return {
      /** The market location the report is about. */
      marketUuid: text(),

      /** The market's name when the report was written, shown when the market is gone. */
      marketName: text(),

      /** The character who made the assessment. */
      assessorUuid: text(),

      /** The party the assessment was made for. */
      partyId: text(),

      /** World time (seconds) the assessment resolved. */
      time: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** How the assessment went; `false` is never shown to a non-GM. */
      outcome: new fields.StringField({ required: true, blank: false, initial: REPORT_OUTCOMES[0], choices: [...REPORT_OUTCOMES] }),

      /** The demand modifier believed for each good, by catalogue key. */
      beliefs: new fields.ArrayField(
        new fields.SchemaField({
          category: new fields.StringField({ required: true, blank: false }),
          dm: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        }),
        { initial: [] },
      ),

      /** Reserved: prices a trader saw in a market month. Nothing writes it yet. */
      pricesSeen: new fields.ArrayField(
        new fields.SchemaField({
          category: new fields.StringField({ required: true, blank: false }),
          monthStart: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          priceCp: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        }),
        { initial: [] },
      ),

      /** The owner's own notes. */
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),
    };
  }
}
