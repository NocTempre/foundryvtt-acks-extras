/* global foundry */
/**
 * FactionData — the `acks-extras.faction` actor sub-type: AN ORGANISATION.
 *
 * A guild, a temple, a syndicate, a noble house, the watch. It is an actor so
 * that everything that deals with people can deal with it: a reaction roll can
 * target it and a token of it can stand on a map. It adds a ledger — the
 * Judge's record of how it stands toward a party and its members, with the one
 * row that has a consequence of its own (`wanted`) — and what it holds: a seat
 * (a place), a leader, members, and the quarters it controls.
 *
 * Every value is what the Judge typed; nothing is derived from a rule.
 *
 * See docs/factions/DECISIONS.md, "A faction is an Actor sub-type (2026-09-16)".
 */
import { headcountOf, strengthColumnTotals, strengthRevenue, strengthTotal } from "../standing-logic.mjs";
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
import { num, str, int, occupantField } from "../../lib/fields.mjs";
import { FACTION_KINDS, RELATION_STANCES, STANDING_SOURCES, SUBJECT_SCOPES } from "../constants.mjs";
import { isWanted, rowsFor, sumStanding } from "../standing-logic.mjs";

const fields = foundry.data.fields;

/**
 * One standing row: who it is about, how much, why, when, and where it came
 * from. The subject's name is stored beside its uuid so a row about a vanished
 * party still says whom it was about.
 */
function standingField() {
  return new fields.SchemaField({
    subject: new fields.SchemaField({
      scope: new fields.StringField({ required: true, initial: "party", choices: SUBJECT_SCOPES }),
      uuid: str(),
      name: str(),
    }),
    value: int(0),
    reason: str(),
    // World time, in seconds, when the row was written.
    time: int(0),
    source: new fields.StringField({ required: true, initial: "manual", choices: STANDING_SOURCES }),
  });
}

/**
 * One relation row: how THIS organisation regards another. Directed — the
 * other side's view is its own row on its own sheet. The name is stored beside
 * the uuid.
 */
function relationField() {
  return new fields.SchemaField({
    uuid: str(),
    name: str(),
    stance: new fields.StringField({ required: true, initial: "neutral", choices: RELATION_STANCES }),
    note: str(),
    // A relation a player must not read off the sheet.
    hidden: new fields.BooleanField({ initial: false }),
  });
}

/**
 * One holding: a place this organisation keeps beyond its seat. The seat stays
 * its own field.
 */
function holdingField() {
  return new fields.SchemaField({
    uuid: str(),
    name: str(),
    note: str(),
    hidden: new fields.BooleanField({ initial: false }),
  });
}

/**
 * The body's STRENGTH: its unnamed people, counted. A column per kind (a
 * class, an order, a troop type) and a row per level, or per posting where no
 * level applies, with a count under each column and the revenue that row
 * brings in where one is stated. The named roster is the other list; the two
 * are shown side by side and never added. Nothing here is derived from a rule.
 *
 * See docs/factions/DECISIONS.md, "The unnamed people are a table, and it is the body's (2026-09-30)".
 */
function strengthField() {
  return new fields.SchemaField({
    columns: new fields.ArrayField(new fields.SchemaField({ label: str() })),
    rows: new fields.ArrayField(
      new fields.SchemaField({
        level: num({ integer: true, min: 0 }),
        label: str(),
        counts: new fields.ArrayField(int(0)),
        revenue: num(),
      }),
    ),
    // Where the figures come from: a page reference, or the Judge's word.
    note: str(),
    // Display gating, like a concealed roster row.
    hidden: new fields.BooleanField({ initial: false }),
  });
}

/** The `acks-extras.faction` actor sub-type. */
export class FactionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // The fields the system touches on every actor (lib actor-compat).
      ...acksCompatStubs(),

      // --- identity ------------------------------------------------------
      kind: new fields.StringField({ required: true, initial: "other", choices: FACTION_KINDS }),
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      // The Judge's own record, rendered only inside the sheet's GM region —
      // the same convention a place's `gmNotes` follows.
      gmNotes: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      // --- what it holds -------------------------------------------------
      // Its seat: the place it is found at. A uuid, so a place in a
      // compendium serves as readily as one in the world.
      seatUuid: str(),
      // The other places it holds.
      holdings: new fields.ArrayField(holdingField()),
      // How it regards other organisations. One row per other faction.
      relations: new fields.ArrayField(relationField()),
      // Who leads it — any actor.
      leaderUuid: str(),
      // The organisation this one is part of. Cycles are refused at the write.
      parentUuid: str(),
      // Its members: the roster row a place uses.
      members: new fields.ArrayField(occupantField()),
      // Its unnamed people, counted by kind and level.
      strength: strengthField(),
      // The scene Regions it controls — quarters drawn as Districts, by uuid.
      controls: new fields.ArrayField(new fields.StringField({ blank: false })),

      // --- the ledger ----------------------------------------------------
      standing: new fields.ArrayField(standingField()),

      schemaVersion: int(1),
    };
  }

  /* -------------------------------------------- */
  /*  Derived                                      */
  /* -------------------------------------------- */

  /** The standing this faction holds toward a subject set (standing-logic). */
  standingFor(subjects, opts) {
    return sumStanding(this.standing, subjects, opts);
  }

  /** The rows that concern a subject set. */
  standingRowsFor(subjects, opts) {
    return rowsFor(this.standing, subjects, opts);
  }

  /** Does this faction hold a `wanted` row for anyone in the subject set? */
  wants(subjects) {
    return isWanted(this.standing, subjects);
  }

  /** Does this faction control the region? */
  controlsRegion(regionUuid) {
    return !!regionUuid && this.controls.includes(regionUuid);
  }

  /** Is this actor on the membership? */
  hasMember(uuid) {
    return !!uuid && this.members.some((m) => m.uuid === uuid);
  }

  /** This organisation's own row about another, or null when it holds none. */
  relationTo(uuid) {
    if (!uuid) return null;
    const row = (this.relations ?? []).find((r) => r.uuid === uuid);
    return row ? (row.toObject?.() ?? row) : null;
  }

  /** Is this place the seat or one of the holdings? */
  holdsPlace(uuid) {
    return !!uuid && (this.seatUuid === uuid || (this.holdings ?? []).some((h) => h.uuid === uuid));
  }

  /** Every place it is behind the door of, seat first, deduped. */
  get placeUuids() {
    return [...new Set([this.seatUuid, ...(this.holdings ?? []).map((h) => h.uuid)].filter((u) => !!u))];
  }

  /** Members counted with their stacks, the way a place counts its roster. */
  get headcount() {
    return headcountOf(this.members);
  }

  /** Everyone the strength block counts; 0 when no figures are recorded. */
  get strengthTotal() {
    return strengthTotal(this.strength);
  }

  /** The strength under each column, in column order. */
  get strengthColumnTotals() {
    return strengthColumnTotals(this.strength);
  }

  /** The revenue the strength rows state, summed, or null when none states one. */
  get strengthRevenue() {
    return strengthRevenue(this.strength);
  }
}
