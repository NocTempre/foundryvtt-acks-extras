/* global foundry */
/**
 * Data model for the `acks-extras.vehicle` Actor sub-type — a cart, a wagon, a
 * galley or a sailing ship as a DOCUMENT.
 *
 * A vehicle is the one thing in ACKS that is simultaneously a container, a
 * crew roster, a team of animals and a speed table, and the model keeps those
 * four as separate subtrees because they answer to different rules and change
 * at different moments: cargo shifts every time someone loads a sack, crew
 * changes when a sailor dies, the team changes when a horse goes lame, and the
 * printed speeds never change at all.
 *
 * WHY A NAMESPACED SUB-TYPE. Core has an open request for vehicle sheets and
 * may one day ship a `vehicle` actor type of its own. This one is
 * `acks-extras.vehicle`, which cannot collide with a bare `vehicle`, so core
 * shipping theirs costs a migration rather than a name fight.
 *
 * THE MODEL IS STRUCTURE ONLY, as everywhere in this family: no printed cargo
 * capacity, crew complement, speed or cost ships here. A galley's 170 rowers
 * reach a world through acks-importer from the GM's own book, or a Judge types
 * them. A blank vehicle is a valid homebrew starting point.
 */
import { num, str, int, bool, html, choice } from "../lib/fields.mjs";
import { acksCompatStubs } from "../lib/actor-compat.mjs";

/**
 * What kind of thing this is. The distinction is not decoration: a cart is
 * moved by animals over ground that may refuse it, a vessel is moved by crew
 * and wind over water, and almost every derived number branches here.
 */
export const VEHICLE_KINDS = Object.freeze({
  land: { label: "ACKS-VEHICLES.kind.land" },
  sea: { label: "ACKS-VEHICLES.kind.sea" },
});

/**
 * Draft animals in heavy-horse equivalents (RR ch. 4: "One ox, two mules, or
 * two medium horses can be substituted for 1 heavy horse"). Stored as the
 * PULL each animal contributes so a mixed team — an ox and two mules — adds up
 * without a lookup table of every combination.
 */
export const DRAFT_EQUIVALENTS = Object.freeze({
  heavyHorse: 1,
  ox: 1,
  mediumHorse: 0.5,
  mule: 0.5,
  donkey: 0.5,
});

/** Terrains a wheeled vehicle enters only where a road runs (RR ch. 4). */
export const ROAD_ONLY_TERRAIN = Object.freeze(["desert", "mountains", "forest", "swamp"]);

export default class VehicleData extends foundry.abstract.TypeDataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric keys. */
  static ARRAY_PATHS = ["team.animals", "speeds.tiers", "crew.roles"];

  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;

    /**
     * One printed load/speed tier for a land vehicle. The book gives carts and
     * wagons TWO of these per team size — "up to 80 stone at 60', or up to 120
     * stone at 30'" — which is a load-dependent speed, not a capacity and a
     * separate speed. Stored in stone (the printed unit); the sixths the
     * capacity primitive counts in are derived where they are needed.
     */
    const speedTier = () =>
      new SchemaField({
        maxLoadStone: num({ min: 0 }),
        feetPerTurn: num({ min: 0 }),
        // Which team size the row belongs to, in heavy-horse equivalents: the
        // book prints a pair of tiers per team, and a wagon with four horses
        // reads different rows than the same wagon with two.
        team: num({ min: 0 }),
      });

    /**
     * One crew role and its complement. Sea vessels print three — sailors,
     * rowers, marines — but a role is a row rather than a fixed field because
     * a homebrew vessel may want gunners, and because marines behave unlike
     * the other two: they are cargo that fights, not motive power.
     */
    const crewRole = () =>
      new SchemaField({
        key: str(), // "sailors" | "rowers" | "marines" | homebrew
        label: str(),
        required: int(0, { min: 0 }), // a full complement
        aboard: int(0, { min: 0 }), // who is actually here
        // Marines do not row. A role that does not drive the vessel is not
        // counted when asking how understrength it is.
        motive: bool(true),
      });

    /** One animal in the team, bound by uuid so its own sheet stays the truth. */
    const teamAnimal = () =>
      new SchemaField({
        uuid: str(),
        name: str(),
        kind: choice(DRAFT_EQUIVALENTS, { initial: "heavyHorse" }),
        // A lame or dead animal stays on the roster and stops pulling — the
        // Judge should not have to delete a horse to record that it fell.
        pulling: bool(true),
      });

    return {
      // The acks system's prepareDerivedData runs for EVERY actor type and
      // touches isNew / thac0 / initiative / movement / saves unguarded, so a
      // sub-type without them logs a failed-data-preparation error on every
      // update. The family keeps ONE definition of that set in lib; the values
      // are meaningless for a wagon.
      ...acksCompatStubs(),

      _schemaVersion: int(0, { min: 0 }),

      kind: choice(VEHICLE_KINDS, { initial: "land" }),
      source: new SchemaField({ book: str(), cite: str(), ref: str() }),
      description: html(),

      /**
       * Cargo capacity in STONE, as the book prints it. What is actually
       * aboard is the actor's own inventory, weighed by the capacity
       * primitive — never a number typed here, or the two disagree the moment
       * someone loads a sack.
       */
      cargo: new SchemaField({
        capacityStone: num({ min: 0 }),
        // A passenger rides as 50 stone of cargo, and 50 stone of cargo can go
        // in place of each crew member (RR ch. 7). Both directions are the
        // same exchange rate, so it is stored once.
        passengerStone: num({ min: 0, initial: 50 }),
        passengers: int(0, { min: 0 }),
      }),

      /** Who mans it. Empty on a cart, three rows deep on a galley. */
      crew: new SchemaField({ roles: new ArrayField(crewRole()) }),

      /** What pulls it. Empty on a vessel. */
      team: new SchemaField({
        // Heavy-horse equivalents the vehicle is BUILT for; the tiers above
        // say what each team size can haul and how fast.
        required: num({ min: 0 }),
        animals: new ArrayField(teamAnimal()),
      }),

      speeds: new SchemaField({
        /** Land: the printed load/speed tiers. */
        tiers: new ArrayField(speedTier()),
        /** Sea: feet per combat round. */
        oarSprint: num({ min: 0 }),
        oarCruise: num({ min: 0 }),
        oarSlow: num({ min: 0 }),
        sail: num({ min: 0 }),
        /** Sea: miles in a twelve-hour day. */
        voyageOar: num({ min: 0 }),
        voyageSail: num({ min: 0 }),
      }),

      /** Structural hit points: a vessel at 0 sinks in 1d10 rounds. */
      ac: num({ integer: true }),
      shp: new SchemaField({ value: num({ min: 0, integer: true }), max: num({ min: 0, integer: true }) }),

      /**
       * The crew's state, which multiplies every speed: underfed crew move at
       * half, starving or dehydrated at a third (RR ch. 7 §"Surviving").
       */
      condition: new SchemaField({
        underfed: bool(false),
        starving: bool(false),
      }),

      /** A stowed mast costs a galley speed; a Judge toggles it, RAW applies it. */
      mastStowed: bool(false),

      /**
       * Whether a driver with the Driving proficiency holds the reins. Worth a
       * road multiplier of 2 instead of 3/2 — and worth nothing off a road.
       */
      driverProficient: bool(false),

      /**
       * Ranks of Seafaring aboard (RR ch. 3): one to sail or row, two to do
       * both and captain her, three for a master mariner — who alone can tack
       * in a strong wind, at two-ninths speed.
       */
      seafaringRank: int(0, { min: 0, max: 3 }),
    };
  }

  /** Reconstruct arrays from FormDataExtended's numeric-keyed objects. */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    for (const path of VehicleData.ARRAY_PATHS) {
      const value = foundry.utils.getProperty(data, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(data, path, Object.values(value));
      }
    }
    return data;
  }

  /** Heavy-horse equivalents actually in harness and able to pull. */
  get draftPull() {
    return (this.team?.animals ?? [])
      .filter((a) => a.pulling)
      .reduce((sum, a) => sum + (DRAFT_EQUIVALENTS[a.kind] ?? 0), 0);
  }

  /** Is this vessel or cart able to move at all under its own arrangements? */
  get canMove() {
    if (this.kind === "land") return this.draftPull > 0;
    // A vessel needs at least one of whatever drives it.
    return (this.crew?.roles ?? []).some((r) => r.motive && r.aboard > 0);
  }
}
