/* global foundry */
/**
 * HenchmanRecord — module-owned data for one hireling, persisted at
 * `actor.flags["acks-henchmen"].record` (standalone DataModel serialized into
 * a flag, the acks-monsters MonsterExtras pattern). The core `retainer.*`
 * schema keeps what it already owns (enabled/loyalty/wage/managerid/category/
 * quantity — written through the adapter); this record holds everything the
 * core does not: rolled-up results, hire terms, the loyalty/morale ledgers,
 * and the event log.
 */
import { MODULE_ID, FLAG_RECORD } from "../constants.mjs";
// Leaf field-builders shared from acks-lib (were a verbatim copy here and in
// location-data.mjs). `fields` stays for the composite types below.
import { num, str, int } from "../../lib/fields.mjs";

const fields = foundry.data.fields;

function ledgerEntry() {
  return new fields.SchemaField({
    time: int(),
    delta: int(),
    reason: str(),
    note: str(),
    compensated: new fields.BooleanField({ initial: false }),
  });
}

export default class HenchmanRecord extends foundry.abstract.DataModel {
  static ARRAY_PATHS = ["loyalty.permanents", "morale.permanents", "events", "rolled.doubleD100"];

  static defineSchema() {
    return {
      origin: new fields.StringField({
        required: true,
        initial: "manual",
        choices: ["market", "follower", "adventure", "purchase", "manual"],
      }),
      locationUuid: str(),
      settlementName: str(),
      employerUuid: str(),
      hiredTime: int(),

      // Generated identity (RR 495-503 People; JJ 245-257 NPCs).
      identity: new fields.SchemaField({
        gender: str(),
        culture: str(),
        age: num({ integer: true }),
        occupation: str(),
        appearance: str(),
      }),

      // Feature 4: rolled results are RECORDED, generation is a future module.
      rolled: new fields.SchemaField({
        attributes: new fields.SchemaField({
          str: num({ integer: true }),
          int: num({ integer: true }),
          wil: num({ integer: true }),
          dex: num({ integer: true }),
          con: num({ integer: true }),
          cha: num({ integer: true }),
        }),
        classKey: str(),
        classRarity: str(),
        template: str(),
        level: num({ integer: true }),
        hpRoll: num({ integer: true }),
        doubleD100: new fields.ArrayField(new fields.NumberField({ integer: true })),
        notes: str(),
      }),

      terms: new fields.SchemaField({
        wageGp: num(),
        wageBasis: new fields.StringField({
          required: true,
          initial: "level",
          choices: ["level", "hd", "mercenary", "specialist", "upkeep"],
        }),
        treasureShare: new fields.NumberField({ required: true, initial: 0.5 }),
        xpShare: new fields.NumberField({ required: true, initial: 0.5 }),
        signingBonusGp: num(),
        // The employer level the hireling BELIEVES (RR 168 presented level);
        // discovery of the truth prefills the loyalty roll's apparent-level
        // penalty. null = hired honestly.
        claimedEmployerLevel: num({ integer: true }),
        lastPaidTime: int(),
        arrearsGp: new fields.NumberField({ required: true, initial: 0 }),
        vassalDomain: new fields.BooleanField({ initial: false }),
      }),

      loyalty: new fields.SchemaField({
        start: int(0),
        permanents: new fields.ArrayField(ledgerEntry()),
      }),
      morale: new fields.SchemaField({
        base: int(0),
        permanents: new fields.ArrayField(ledgerEntry()),
      }),

      counters: new fields.SchemaField({
        calamities: int(0),
        levelsGainedInService: int(0),
        startLevel: int(0),
      }),

      events: new fields.ArrayField(
        new fields.SchemaField({
          id: str(),
          time: int(),
          type: str(),
          note: str(),
          rollTotal: num({ integer: true }),
          outcome: str(),
          by: str(),
        })
      ),

      special: new fields.SchemaField({
        skipCalamityLoyalty: new fields.BooleanField({ initial: false }),
        noSlot: new fields.BooleanField({ initial: false }),
        pendingCalamity: new fields.BooleanField({ initial: false }),
        irrefusableResult: str(),
      }),
    };
  }

  /** Read (or default) the record from an actor's flags. */
  static fromActor(actor) {
    const raw = actor?.getFlag?.(MODULE_ID, FLAG_RECORD) ?? {};
    try {
      return new HenchmanRecord(raw);
    } catch (err) {
      console.warn(`${MODULE_ID} | invalid HenchmanRecord on ${actor?.name}; using defaults`, err);
      return new HenchmanRecord({});
    }
  }

  /** Persist (merge) record data onto the actor's flags. */
  static async save(actor, data) {
    return actor.setFlag(MODULE_ID, FLAG_RECORD, data);
  }

  /** Append an event (capped log) and persist. */
  static async logEvent(actor, event) {
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    const events = Array.isArray(record.events) ? [...record.events] : [];
    events.push({
      id: foundry.utils.randomID(),
      time: Math.floor(game?.time?.worldTime ?? 0),
      by: game?.user?.name ?? "",
      note: "",
      ...event,
    });
    while (events.length > 200) events.shift();
    return actor.setFlag(MODULE_ID, FLAG_RECORD, { ...record, events });
  }
}
