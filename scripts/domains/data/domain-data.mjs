/* global foundry */
/**
 * DomainData — the `acks-extras.domain` actor sub-type: A RULER'S DOMAIN.
 *
 * The record a printed domain sheet keeps: who rules it and under whom, the
 * territory and its peasant families, the places it holds and the stronghold
 * it has raised, the month's revenue and expense lines, its morale, and the
 * vassals below it. Places are held BY REFERENCE: a settlement stays where it
 * stands in the place tree, and the domain lists it.
 *
 * Every figure is the record's or the Judge's. A line left blank is unset —
 * not zero — and the sums in `domain-logic.mjs` say so. The shape and its
 * normaliser are `domain-logic.mjs`'s; this file only declares the fields.
 */
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
import { num, str, int, bool, choice } from "../../lib/fields.mjs";
import { ALIGNMENTS } from "../../lib/vocab.mjs";
import { CLASSIFICATIONS, EXPENSE_LINES, HOLDING_ROLES, REVENUE_LINES } from "../constants.mjs";
import { hexCountOf, holdsIn, peasantFamiliesOf, strongholdValueOf } from "../domain-logic.mjs";

const fields = foundry.data.fields;

const enumOf = (keys) => Object.fromEntries(keys.map((k) => [k, { label: k }]));
const count = (initial = 0) => int(initial, { min: 0 });
const countOrNull = (opts = {}) => num({ integer: true, min: 0, ...opts });

/** One revenue or expense line: a rate per family and a flat figure for each side, all unset to begin. */
function lineField() {
  return new fields.SchemaField({
    peasantPer: num(),
    urbanPer: num(),
    peasantGp: num(),
    urbanGp: num(),
    note: str(),
  });
}

const linesField = (keys) => new fields.SchemaField(Object.fromEntries(keys.map((k) => [k, lineField()])));

/** Hexes a vassal row names: a count, the labels where known, the classifications they carry. */
function hexesField() {
  return new fields.SchemaField({
    count: countOrNull(),
    labels: new fields.ArrayField(new fields.StringField({ blank: false })),
    classes: new fields.ArrayField(new fields.StringField({ choices: CLASSIFICATIONS })),
  });
}

/** The `acks-extras.domain` actor sub-type. */
export class DomainData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // The fields the system touches on every actor (lib actor-compat).
      ...acksCompatStubs(),

      // --- who rules it, and under whom --------------------------------
      rulerUuid: str(),
      // The ruler as the record names them, for a ruler with no actor.
      rulerName: str(),
      title: str(),
      // The liege's domain. Cycles are refused at the write (`setLiege`).
      parentUuid: str(),
      // The liege as the record names them, for a liege with no domain actor.
      liegeName: str(),
      classification: choice(enumOf(CLASSIFICATIONS)),
      // Blank: the ruler's own.
      alignment: choice(ALIGNMENTS),
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      gmNotes: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      // --- the land ------------------------------------------------------
      territory: new fields.ArrayField(new fields.SchemaField({
        id: str(),
        label: str(),
        hexLabels: new fields.ArrayField(new fields.StringField({ blank: false })),
        // How many hexes, where `hexLabels` does not name them; null is unknown.
        count: countOrNull({ initial: 1 }),
        // Where a painted hex sits; null for a row nobody painted.
        map: new fields.SchemaField({ sceneUuid: str(), key: str() }, { required: false, nullable: true, initial: null }),
        landValue: num(),
        improvement: num({ initial: 0 }),
        families: count(),
        // Whether a player is shown the land value.
        revealed: bool(),
        note: str(),
      })),

      // --- what it holds -------------------------------------------------
      holdings: new fields.ArrayField(new fields.SchemaField({
        // The place; blank for a record's place not yet on any map.
        uuid: str(),
        name: str(),
        role: new fields.StringField({ required: true, initial: "other", choices: HOLDING_ROLES }),
        // An unplaced row's own figures. A placed row reads its place's.
        families: countOrNull(),
        marketClass: num({ integer: true, min: 1, max: 6 }),
        investmentGp: num({ initial: 0, min: 0 }),
        note: str(),
        hidden: bool(),
      })),
      structures: new fields.ArrayField(new fields.SchemaField({
        id: str(),
        name: str(),
        count: count(1),
        ac: num(),
        unitCapacity: num(),
        shp: num(),
        // The row's whole cost, all its units together.
        costGp: num(),
        note: str(),
      })),

      // --- the month -----------------------------------------------------
      revenue: linesField(REVENUE_LINES),
      expenses: linesField(EXPENSE_LINES),
      otherRevenue: new fields.ArrayField(new fields.SchemaField({ id: str(), label: str(), gp: num() })),
      otherExpenses: new fields.ArrayField(new fields.SchemaField({ id: str(), label: str(), gp: num() })),
      // What this domain pays its liege. Unset is not zero.
      tributeGp: num(),
      morale: new fields.SchemaField({
        current: num({ integer: true }),
        base: num({ integer: true }),
      }),

      // --- the realm -----------------------------------------------------
      vassalRows: new fields.ArrayField(new fields.SchemaField({
        id: str(),
        name: str(),
        rulerName: str(),
        families: new fields.SchemaField({ peasant: countOrNull(), urban: countOrNull() }),
        realmFamilies: countOrNull(),
        revenueGp: num(),
        tributeGp: num(),
        extraTaxGp: num({ initial: 0 }),
        domainHexes: hexesField(),
        realmHexes: hexesField(),
        realmGarrisonGp: num(),
        favors: str(),
        duties: str(),
        note: str(),
      })),
      favors: new fields.ArrayField(new fields.SchemaField({ id: str(), label: str(), note: str() })),
      duties: new fields.ArrayField(new fields.SchemaField({ id: str(), label: str(), note: str() })),

      schemaVersion: int(1),
    };
  }

  /* -------------------------------------------- */
  /*  Derived                                      */
  /* -------------------------------------------- */

  /** Peasant families: the territory rows summed. */
  get peasantFamilies() {
    return peasantFamiliesOf(this.territory);
  }

  /** The hexes the territory covers, and how many rows give no count. */
  get hexCount() {
    return hexCountOf(this.territory);
  }

  /** The stronghold's value, and how many structures give no cost. */
  get strongholdValue() {
    return strongholdValueOf(this.structures);
  }

  /** Does this domain hold exactly this place? */
  holdsPlace(uuid) {
    return holdsIn(this, uuid);
  }

  /** Every place this domain holds, deduped. */
  get placeUuids() {
    return [...new Set((this.holdings ?? []).map((h) => h.uuid).filter((u) => !!u))];
  }

  /** Is there a lord this domain answers to — a liege domain, or one the record names? */
  get hasLiege() {
    return !!(this.parentUuid || this.liegeName);
  }
}
