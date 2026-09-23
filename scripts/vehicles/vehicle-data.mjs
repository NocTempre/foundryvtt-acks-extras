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
 * capacity, crew complement, speed or cost ships here. A galley's whole
 * rowing complement reaches a world through the importer from the GM's own
 * book, or a Judge types it. A blank vehicle is a valid homebrew starting
 * point.
 */
import { num, str, int, bool, html, choice } from "../lib/fields.mjs";
import { acksCompatStubs } from "../lib/actor-compat.mjs";
import { COMPLEMENT_MEANS } from "./berths.mjs";
import { draftEquivalent } from "./vehicle-speed.mjs";

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
 * The draft kinds a team row can name — the STRUCTURAL half. A team is
 * counted in heavy-horse equivalents, so the heavy horse's own value is the
 * UNIT's definition (one, necessarily) and ships; what every other animal is
 * worth against it is printed (RR ch. 4 substitutes oxen, mules and medium
 * horses for a heavy horse at rates the page states) and arrives through the
 * `travel` document's `draftEquivalents` table. Unimported, a team of heavy
 * horses still counts and anything else is unpriced rather than guessed.
 */
export const DRAFT_KINDS = Object.freeze({
  heavyHorse: { label: "ACKS-VEHICLES.draft.heavyHorse", unit: true },
  mediumHorse: { label: "ACKS-VEHICLES.draft.mediumHorse" },
  ox: { label: "ACKS-VEHICLES.draft.ox" },
  mule: { label: "ACKS-VEHICLES.draft.mule" },
  donkey: { label: "ACKS-VEHICLES.draft.donkey" },
});

/** Terrains a wheeled vehicle enters only where a road runs (RR ch. 4). */
export const ROAD_ONLY_TERRAIN = Object.freeze(["desert", "mountains", "forest", "swamp"]);

/**
 * HOW a land vehicle is carried — the discriminator the vehicle-combat rule
 * turns on (RR ch. 6: a back-carrier may fight where a puller may only join
 * a charge, and a hand-carrier never fights). Blank reads as pulled, the
 * common case.
 */
export const CARRIAGE = Object.freeze({
  pulled: { label: "ACKS-VEHICLES.carriage.pulled" },
  handCarried: { label: "ACKS-VEHICLES.carriage.handCarried" },
  backCarried: { label: "ACKS-VEHICLES.carriage.backCarried" },
});

// The base is dereferenced at module scope, so a stand-in takes its place
// where `foundry` is absent (Node test graphs reach this file through the
// occupants feeder) — the class itself is only ever instantiated by Foundry.
const TypeDataModel = globalThis.foundry?.abstract?.TypeDataModel ?? class {};

export default class VehicleData extends TypeDataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric keys. */
  static ARRAY_PATHS = ["team.animals", "speeds.tiers", "crew.roles"];

  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;

    /**
     * One printed load/speed tier for a land vehicle: a load-dependent speed,
     * not a capacity and a separate speed — the book gives carts and wagons
     * two of these per team size. Stored in stone (the printed unit); the
     * sixths the capacity primitive counts in are derived where needed.
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
        // What one UNNAMED hand of a non-motive role carries, in stone —
        // the marines rule charges their gear as freight, and only a typed
        // rate lets an abstract complement charge the hold the way named
        // occupants' real inventories do. Filled from the Judge's own book;
        // null = unstated, charges nothing.
        gearStone: new foundry.data.fields.NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      });

    /** One animal in the team, bound by uuid so its own sheet stays the truth. */
    const teamAnimal = () =>
      new SchemaField({
        uuid: str(),
        name: str(),
        kind: choice(DRAFT_KINDS, { initial: "heavyHorse" }),
        // How many animals this row IS. A four-horse wagon is a team of four
        // identical horses, and making a Judge create four actors to say so —
        // and unharness them one at a time — is bookkeeping the printed table
        // does not ask for. A row dragged from a specific animal keeps its
        // uuid and stands for one; a row typed by hand stands for as many as
        // it says.
        count: int(1, { min: 1 }),
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
      // How a land vehicle is carried; the vehicle-combat card reads it.
      carriage: choice(CARRIAGE),
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
        // A passenger rides as cargo, and cargo can go in place of a crew
        // member at the same printed rate (RR ch. 7) — both directions are
        // one exchange rate, stored once.
        passengerStone: num({ min: 0, initial: 50 }),
        passengers: int(0, { min: 0 }),
      }),

      /** Who mans it. Empty on a cart, three rows deep on a galley. */
      crew: new SchemaField({
        // What the printed Crew column MEANS on this vehicle: the driver, the
        // driver and warriors (chariots), or the passengers (howdahs). Blank
        // follows the kind — `complementMeans()` answers for it.
        means: choice(COMPLEMENT_MEANS),
        roles: new ArrayField(crewRole()),
      }),

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

      /** Structural hit points: at 0 the vessel begins sinking (see startSinkingClock). */
      ac: num({ integer: true }),
      shp: new SchemaField({ value: num({ min: 0, integer: true }), max: num({ min: 0, integer: true }) }),

      /**
       * The crew's state, which multiplies every speed: underfed and
       * starving/dehydrated each cost speed, at printed penalties (RR ch. 7
       * §"Surviving").
       */
      condition: new SchemaField({
        underfed: bool(false),
        starving: bool(false),
      }),

      /** A stowed mast costs a galley speed; a Judge toggles it, RAW applies it. */
      mastStowed: bool(false),

      /**
       * Whether a driver with the Driving proficiency holds the reins —
       * worth a better road multiplier, and nothing off a road.
       */
      driverProficient: bool(false),

      /**
       * Ranks of Seafaring aboard (RR ch. 3): one to sail or row, two to do
       * both and captain her, three for a master mariner who alone can tack
       * in a strong wind.
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

  /**
   * The submitted rows laid OVER the stored ones. A row carries fields the
   * form has no input for (an animal's uuid and name, set only by dragging
   * it into harness), so rebuilding from the form alone would come back
   * nameless and bound to nothing. `named` (the form's actual input names)
   * decides which fields the submission overwrites; a submitted default is
   * indistinguishable from a field deliberately cleared, so only a NAMED
   * field is taken and the rest stand as the stored row had them.
   *
   * Never fold this into `normalize`: that turns a shape into another shape
   * and knows nothing about the document, while this needs the stored row.
   */
  static mergeSubmit(stored, submitted, named = null) {
    const data = VehicleData.normalize(submitted);
    for (const path of VehicleData.ARRAY_PATHS) {
      const rows = foundry.utils.getProperty(data, path);
      if (!Array.isArray(rows)) continue;
      const was = foundry.utils.getProperty(stored ?? {}, path) ?? [];
      foundry.utils.setProperty(
        data,
        path,
        rows.map((row, i) => {
          const base = foundry.utils.deepClone(was[i] ?? {});
          if (!named) return { ...base, ...row };
          for (const field of Object.keys(row)) {
            if (named.has(`system.${path}.${i}.${field}`)) base[field] = row[field];
          }
          return base;
        }),
      );
    }
    return data;
  }

  /**
   * Heavy-horse equivalents actually in harness and able to pull. A kind the
   * registry cannot price contributes nothing — see `draftEquivalent`.
   */
  get draftPull() {
    // Each row stands for `count` animals of its kind.
    return (this.team?.animals ?? [])
      .filter((a) => a.pulling)
      .reduce((sum, a) => {
        const per = draftEquivalent(a.kind);
        return sum + (Number.isFinite(per) ? per : 0) * Math.max(1, Number(a.count) || 1);
      }, 0);
  }

  /** Is this vessel or cart able to move at all under its own arrangements? */
  get canMove() {
    if (this.kind === "land") return this.draftPull > 0;
    // A vessel needs at least one of whatever drives it.
    return (this.crew?.roles ?? []).some((r) => r.motive && r.aboard > 0);
  }
}
