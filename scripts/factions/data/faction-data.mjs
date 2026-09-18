/* global foundry */
/**
 * FactionData — the `acks-extras.faction` actor sub-type: AN ORGANISATION.
 *
 * A guild, a temple, a syndicate, a noble house, the watch. It is an actor
 * for one reason: everything that deals with people already deals with
 * actors. A member's reaction roll can target it, the ordinary attitude item
 * keeps its relationship, a token of it can stand on a map. What it adds is
 * a LEDGER — the Judge's own record of how it stands toward a party and its
 * members, with the one row that has a consequence of its own (`wanted`) —
 * and what it holds: a seat (a place), a leader, members, and the quarters
 * it controls.
 *
 * No score is derived from the books: RAW has no reputation number, so every
 * value is what the Judge typed, and the one knob that turns standing into a
 * market shift defaults to off.
 */
import { headcountOf } from "../standing-logic.mjs";
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
import { str, int, occupantField } from "../../lib/fields.mjs";
import { FACTION_KINDS, RELATION_STANCES, STANDING_SOURCES, SUBJECT_SCOPES } from "../constants.mjs";
import { isWanted, rowsFor, sumStanding } from "../standing-logic.mjs";

const fields = foundry.data.fields;

/**
 * One standing row: who it is about, how much, why, when, and where it came
 * from. The subject's name is denormalised beside its uuid for the reason the
 * roster's is — a row about a party that has since dissolved still says whom
 * it was about.
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
 * other side's view of this one is its own row on its own sheet, because two
 * organisations rarely regard each other the same way. The name is
 * denormalised beside the uuid for the reason the roster's is.
 */
function relationField() {
  return new fields.SchemaField({
    uuid: str(),
    name: str(),
    stance: new fields.StringField({ required: true, initial: "neutral", choices: RELATION_STANCES }),
    note: str(),
    // A relation a player must not read off the sheet: the guild does not
    // advertise whose money it takes.
    hidden: new fields.BooleanField({ initial: false }),
  });
}

/**
 * One holding: a place this organisation keeps beyond its seat — a chapter
 * hall, a front, a safehouse. The seat is the principal one and stays its own
 * field; a holding is every other roof it is behind.
 */
function holdingField() {
  return new fields.SchemaField({
    uuid: str(),
    name: str(),
    note: str(),
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
      // The other places it holds. Empty by default, so an actor written
      // before the field existed loads with none rather than migrating.
      holdings: new fields.ArrayField(holdingField()),
      // How it regards other organisations. One row per other faction.
      relations: new fields.ArrayField(relationField()),
      // Who leads it — any actor.
      leaderUuid: str(),
      // The organisation this one is part of (a chapter of a wider guild).
      // Cycles are refused at the write, never merely tolerated by readers.
      parentUuid: str(),
      // Its members: the roster row a place uses, so a guild's list and an
      // inn's list are one shape.
      members: new fields.ArrayField(occupantField()),
      // The scene Regions it controls — quarters drawn as Districts. Uuids of
      // Region documents; a quarter with no faction over it is simply absent.
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
}
