/* global foundry, game, fromUuidSync */
/**
 * LocationData — the `acks-extras.location` actor sub-type: A PLACE.
 *
 * A place is four things, and only the first is universal:
 *
 *   1. **Identity and nesting** — a name, a region, notes, and the place it is
 *      inside of. Every location has this, from a duchy to a chest.
 *   2. **Contents** — goods (real embedded items, stamped by acks-lib's storage
 *      primitive) and a ROSTER of the living things kept here, which items
 *      cannot represent because Foundry has no actor-inside-an-actor.
 *   3. **A stack count** — eight identical warehouse bays are one actor until
 *      one of them becomes interesting (acks-lib place-logic.mjs, `planSplit`).
 *   4. **A market**, optionally — the henchmen recruitment domain and the
 *      markets feature's goods trade.
 *
 * THE MARKET IS A NULLABLE SUBTREE. `system.market` is `null` on a cave, a
 * wagon and a chest — not an object of empty arrays, genuinely absent — because
 * a nullable SchemaField's `clean()` short-circuits on null before it ever casts
 * to an object. Adding a market is one write of a defaults object; removing one
 * is a write of `null`.
 *
 * There is deliberately NO `hasMarket` boolean. The presence of the subtree IS
 * the flag, so the two can never disagree — the failure mode a separate boolean
 * would have introduced is a location whose flag says "market" and whose data
 * says otherwise, which is exactly the class of bug the storage/bank split was
 * retired for.
 *
 * DESIGNED FOR EXTENSION: another module stores its own data in its own flag
 * namespace on the same location actor, so this schema stays minimal.
 *
 * Candidates are plain records, NOT actors — a Class I market can roll hundreds
 * of 0th-level candidates; a real Actor is created only on hire.
 */
import { marketClassFromFamilies, clampMarketClass } from "../../henchmen/rules/availability.mjs";
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
// num/str/int are the family's leaf field-builders — one definition in acks-lib
// (this file and henchman-record.mjs each had a verbatim copy). `fields` is
// still needed locally for the non-leaf types (SchemaField, ArrayField, HTMLField).
import { num, str, int } from "../../lib/fields.mjs";
import { goodsSchema } from "../../markets/data/goods-schema.mjs";
import { migrateLocationSource } from "./location-migrate.mjs";

const fields = foundry.data.fields;

/**
 * One recruitment posting — a recruiter's PAID SEARCH (fee per week per
 * hireling type, RR 162). Generic searches (by level / troop / specialist)
 * grant access to the LOCATION's shared monthly pool for that segment;
 * specific searches (by class / proficiency, JJ 118) are rolled separately
 * and privately for the paying recruiter.
 */
function postingField() {
  return new fields.SchemaField({
    id: str(),
    createdTime: int(),
    monthStartTime: int(), // start of the current availability month (private searches)
    segment: str(), // shared-pool key for generic searches, e.g. "henchman:1"
    employerUuid: str(),
    dedicatedSearcherUuid: str(), // occupies one ancillary activity per day (informational)
    spec: new fields.SchemaField({
      kind: new fields.StringField({
        required: true,
        initial: "henchman",
        choices: ["henchman", "henchmanByClass", "henchmanByClassProficiency", "henchmanByProficiency", "mercenary", "specialist"],
      }),
      general: new fields.BooleanField({ initial: false }), // the player-facing "adventuring henchmen" post
      level: num({ integer: true, min: 0, max: 14 }),
      classKey: str(),
      rarityOverride: str(),
      levelShift: int(0),
      alignmentShift: int(0),
      proficiencyName: str(),
      proficiencyRanks: num({ integer: true, min: 1, max: 3 }),
      troopType: str(),
      specialistType: str(),
    }),
    commissioned: new fields.BooleanField({ initial: false }),
    renew: new fields.BooleanField({ initial: false }), // roll a fresh pool at month end
    // Ran a whole market month unchanged: designated on the sheet (post
    // color) and eases its search one rarity for the whole location.
    advertVeteran: new fields.BooleanField({ initial: false }),
    // The level the employer PRESENTS as (RR 168: candidates judge by
    // appearance and spending — lying is possible; discovery = loyalty
    // roll at −1 per level of difference). null = honest.
    presentedLevel: num({ integer: true, min: 0, max: 14 }),
    totalAvailable: int(0),
    rollDetail: str(),
    arrivalPlan: new fields.ArrayField(
      new fields.SchemaField({
        week: int(1),
        count: int(0),
        materialized: new fields.BooleanField({ initial: false }),
      })
    ),
    feesPaid: new fields.ArrayField(
      new fields.SchemaField({ time: int(), gp: int(0) })
    ),
    lastProcessedTime: int(),
    status: new fields.StringField({ required: true, initial: "active", choices: ["active", "closed", "exhausted"] }),
    playersSeeDetails: new fields.BooleanField({ initial: true }),
  });
}

/**
 * One candidate — a UNIQUE INDIVIDUAL in the market (name, age, culture,
 * appearance, occupation generated from the location's demographics). Only
 * troop-scale entries (mercenaries, mass laborers) stay aggregated with a
 * quantity; the pool total is bookkeeping, the people are individuals.
 */
function candidateField() {
  return new fields.SchemaField({
    id: str(),
    segment: str(), // shared-pool key ("" for private specific searches)
    privateToUuid: str(), // employer uuid for JJ specific searches ("" = public)
    name: str(),
    gender: str(),
    culture: str(),
    age: num({ integer: true }),
    occupation: str(),
    appearance: str(),
    hitDice: str(), // 0th-level HD line (JJ 252), e.g. "1/2 HD (1d4 hp)"
    profCount: num({ integer: true }), // JJ 253 general-proficiency count by age
    // Claim token: the socket that applies a hiring-roll resolution claims it
    // here first, so the same resolution delivered to several GM sockets
    // (GM in two windows, co-GM) applies exactly once.
    lastResolutionId: str(),
    // Directed-search replacement (JJ): who this candidate is highlighted
    // for, and month-long availability (exempt from weekly churn).
    highlightFor: str(),
    monthLong: new fields.BooleanField({ initial: false }),
    kind: new fields.StringField({ required: true, initial: "henchman" }),
    quantity: int(1), // >1 only for aggregated troop-scale rows
    level: num({ integer: true }),
    classKey: str(),
    classRarity: str(),
    template: str(),
    attributes: new fields.SchemaField({
      str: num({ integer: true }),
      int: num({ integer: true }),
      wil: num({ integer: true }),
      dex: num({ integer: true }),
      con: num({ integer: true }),
      cha: num({ integer: true }),
    }),
    hpRoll: num({ integer: true }),
    doubleD100: new fields.ArrayField(new fields.NumberField({ integer: true })),
    wageGp: num(),
    wageUnit: str(),
    troopType: str(),
    specialistType: str(),
    availableFromTime: int(),
    status: new fields.StringField({
      required: true,
      initial: "pending",
      // "reserved": accepted with no GM online and no actor-create permission —
      // the hire is QUEUED (pendingHires) and materializes at next GM connect.
      choices: ["pending", "available", "hired", "reserved", "refused", "slandered", "withdrawn"],
    }),
    refusals: new fields.ArrayField(
      new fields.SchemaField({
        employerUuid: str(),
        time: int(),
        result: str(),
      })
    ),
    notes: str(),
  });
}

/**
 * One occupant — a living thing kept at this place.
 *
 * A REFERENCE, not an embedded document: Foundry cannot embed an Actor in an
 * Actor, so a garrison, a stabled horse and a captive dragon are all uuids. The
 * name and image are DENORMALISED alongside, for the same reason storage stamps
 * `ownerName` next to `ownerUuid` — a deleted actor leaves a row that still says
 * what used to be here, which is a record a GM can act on rather than a blank.
 */
function occupantField() {
  return new fields.SchemaField({
    uuid: str(),
    name: str(),
    img: str(),
    kind: new fields.StringField({
      required: true,
      initial: "actor",
      choices: ["actor", "group", "monster", "henchman", "place"],
    }),
    // A group row counts its whole stack: a platoon billeted at an inn is 30
    // people asleep in it, and a headcount that said 1 would mislead every
    // capacity decision made from this sheet.
    quantity: int(1),
    ownerUuid: str(), // who put it here / whose it is; "" = the place's own
    // Caller-supplied at placement (acks-lib `occupantRow` / `addOccupant` option
    // bag), and kept when a stored row absorbs its derived scene duplicate. No
    // sheet control renders it yet: a consumer's text is stored, not shown.
    notes: str(),
    // Display gating only, never a security boundary — the same ruling storage
    // makes about attribution. A garrison that must genuinely stay secret
    // belongs on a GM-owned place.
    hidden: new fields.BooleanField({ initial: false }),
  });
}

/**
 * The MARKET subtree: the henchmen recruitment domain's fields, plus the
 * markets feature's `goods` fragment (authored in
 * scripts/markets/data/goods-schema.mjs; every writer lives there).
 *
 * Gathered under one nullable field so a place without a market carries none of
 * it — which is what makes "markets are not the default" true of the DATA and
 * not merely of the UI.
 */
function marketSchema() {
  return {
    // Market-class derivation inputs: explicit override wins, then urban
    // families (local bracket table), then acks-domains courtesy read,
    // then default IV.
    marketClassOverride: num({ integer: true, min: 1, max: 6 }),
    // The Judge's word on denomination exchange here, outranking the derived
    // rule (a market changes freely; anywhere else barters): "market" | "none".
    // Null defers to the derivation — see lib money's exchangeTermsAt.
    exchangeOverride: str(),
    urbanFamilies: num({ integer: true, min: 0 }),
    domainUuid: str(),
    classRarityTableId: new fields.StringField({ required: true, initial: "default" }),
    // Settlement alignment: directed searches for opposed-alignment classes
    // shift one rarity step (alignmentRecruitment table); the default
    // ladders encode a lawful town, other alignments override via variant.
    settlementAlignment: new fields.StringField({
      required: true,
      initial: "lawful",
      choices: ["lawful", "neutral", "chaotic"],
    }),
    desertRealm: new fields.BooleanField({ initial: false }), // camel troops available
    compositeVariant: new fields.StringField({
      required: true,
      initial: "composite",
      choices: ["composite", "longbow"],
    }),
    // Demographics: weighted culture mix driving candidate identity
    // generation (RR 495-503). Empty = uniform random across all cultures.
    demographics: new fields.ArrayField(
      new fields.SchemaField({
        culture: str(),
        weight: int(1),
      })
    ),
    // Start of the location's current market month. The WHOLE market
    // (every henchman level, troop type, and specialist type) is rolled at
    // each month's beginning even if nobody is hiring — so a party that
    // starts searching in week 2 finds the town as it already is.
    monthAnchorTime: int(0),
    // Append-only MARKET LEDGER: what the market did and when (month
    // rolls, directed replacements, hires) — the GM's record for manual
    // rollbacks after clock adjustments. Capped to the recent past.
    marketLog: new fields.ArrayField(
      new fields.SchemaField({
        time: int(),
        type: str(), // monthRoll | replace | hire | reserve
        note: str(),
      })
    ),
    // Hires accepted with no GM online and no actor-create permission —
    // materialized into real actors at the next GM connect.
    pendingHires: new fields.ArrayField(
      new fields.SchemaField({
        id: str(),
        candidateId: str(),
        specialHireId: str(),
        employerUuid: str(),
        signingGp: num(),
        time: int(),
        result: new fields.SchemaField({
          outcome: str(),
          natural: num({ integer: true }),
          total: num({ integer: true }),
        }),
      })
    ),
    // The LOCATION's monthly availability ledger: one entry per generic
    // segment rolled this month (availability is a property of the market,
    // RR 162 — shared by all recruiters; rolled once per month per type).
    marketRolls: new fields.ArrayField(
      new fields.SchemaField({
        segment: str(),
        monthStartTime: int(),
        total: int(0),
        detail: str(),
      })
    ),
    postings: new fields.ArrayField(postingField()),
    candidates: new fields.ArrayField(candidateField()),
    // Special hires: REAL actors the GM drags in (notable NPCs for hire)
    // plus recruits the party FOUND on adventures (RR 162). GM entries
    // stay available until an optional time limit; found recruits default
    // to end of the market month (RAW gives no fixed window — Judge's
    // call). Hiring attempts are tracked per NPC in `refusals`.
    specialHires: new fields.ArrayField(
      new fields.SchemaField({
        id: str(),
        actorUuid: str(),
        name: str(),
        img: str(),
        addedTime: int(),
        expiresTime: int(0), // 0 = no limit
        origin: new fields.StringField({ required: true, initial: "gm", choices: ["gm", "found"] }),
        status: new fields.StringField({
          required: true,
          initial: "available",
          choices: ["available", "hired", "expired"],
        }),
        refusals: new fields.ArrayField(
          new fields.SchemaField({
            employerUuid: str(),
            time: int(),
            result: str(),
          })
        ),
        lastResolutionId: str(), // multi-GM-socket claim (see candidateField)
        // Caller-supplied via `addSpecialHire` (public api, and the
        // `registerFoundRecruit` wrapper that spreads its options). Stored, not
        // rendered by the special-hires table.
        notes: str(),
      })
    ),
    slander: new fields.ArrayField(
      new fields.SchemaField({
        // WHO the −1 applies to. One location-held entry can name a party
        // (employer uuid) or an individual character, so a subject is counted
        // once and never double-tallied across a party and its members.
        subject: new fields.SchemaField({
          scope: new fields.StringField({
            required: true,
            initial: "all",
            choices: ["all", "party", "character"],
          }),
          uuid: str(), // employer/party actor uuid, or character uuid; "" when scope="all"
        }),
        npcName: str(),
        time: int(),
        note: str(),
      })
    ),
    searchLedger: new fields.ArrayField(
    new fields.SchemaField({
      time: int(),
      gp: int(0),
      postingId: str(),
      paidByUuid: str(),
    })
    ),
    // The ITEM-MARKET subtree — authored by the markets feature (its writers
    // live there); composed here exactly as the recruitment fields above are.
    // Non-nullable: every market trades goods, `system.market`'s presence is
    // the only gate, and clean() fills it on locations saved before it existed.
    goods: goodsSchema(),
  };
}

/**
 * The nullable market field. The three options are what make the subtree
 * genuinely absent rather than an object of empty arrays: `clean()`
 * short-circuits on null via `_validateSpecial` before it ever casts to an
 * object, so `system.market` on a cave stores the literal `null`.
 */
const marketField = () =>
  new fields.SchemaField(marketSchema(), { required: false, nullable: true, initial: null });

/**
 * A fresh, fully-defaulted market — what "add a market to this place" writes.
 *
 * Built from a THROWAWAY non-nullable field: a SchemaField takes ownership of
 * the field instances handed to it (`_initialize` sets `field.parent` and throws
 * if one is reused), so the schema is rebuilt rather than borrowed from the
 * live one.
 */
export const emptyMarket = () => new fields.SchemaField(marketSchema()).clean({});

/**
 * The `acks-extras.location` actor sub-type. Identity, nesting, contents and
 * stack count on every place; a nullable `market` subtree only where there is
 * one. `migrateData` folds a v1 location (market fields as siblings of `region`)
 * into the subtree on load, so an un-migrated world reads correctly on its first
 * render rather than after a sweep.
 */
export class LocationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // --- acks system compatibility stubs -------------------------------
      // AcksActor.prepareDerivedData runs for EVERY actor type and touches
      // isNew / thac0 / initiative / movement / saves.implements|wand
      // unguarded; without them every location update logs a failed-data-
      // preparation error. ONE definition of that set now lives in acks-lib
      // (its setup sweep reads these world-wide, so it is a family concern, not
      // a per-module one). Values are meaningless for a settlement.
      ...acksCompatStubs(),

      // --- identity ------------------------------------------------------
      region: str(),
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      // --- nesting -------------------------------------------------------
      // The place this place is inside of. A uuid, not an id, because a parent
      // may be a location actor OR any other provider — acks-lib's place layer
      // resolves all of them the same way, and a bare id could not say which.
      // Cycles are refused at the write (acks-lib place-logic `wouldCycle`),
      // never merely tolerated by the readers.
      parentUuid: str(),

      // --- the map -------------------------------------------------------
      // The scene this place IS. Set from the scene side (the scene holds the
      // matching flag) and mirrored here so the sheet can offer "open the map"
      // without a world scan. Never auto-created — the link is made on demand.
      sceneUuid: str(),

      // --- stacking ------------------------------------------------------
      // Eight identical warehouse bays are ONE actor until one of them becomes
      // interesting. `count` is the only stack state, because unlike a group's
      // bodies a place cannot express divergence as an ActorDelta — so
      // divergence here is a SPLIT into a second actor. See docs/lib/GROUPS.md
      // for the invariant this is the place-shaped analogue of.
      stack: new fields.SchemaField({
        count: int(1),
        label: str(), // what one instance is called: "Bay", "Cell", "Stall"
      }),

      // --- occupancy -----------------------------------------------------
      // The living things kept here. Goods are embedded items (acks-lib
      // storage); these cannot be, so they are references.
      roster: new fields.ArrayField(occupantField()),

      // --- the market, if this place has one -----------------------------
      market: marketField(),

      schemaVersion: int(2),
    };
  }

  /* -------------------------------------------- */
  /*  The market gate                              */
  /* -------------------------------------------- */

  /**
   * Does this place have a market? The presence of the subtree IS the flag —
   * there is no second boolean to fall out of step with it.
   */
  get hasMarket() {
    return this.market != null;
  }

  /* Read-through conveniences so a caller that only wants to LIST something
   * does not have to null-check the subtree at every use. They return empty
   * collections for a market-less place, which is the truthful answer: a cave
   * has no postings, rather than an unknown number of them. Writers must still
   * go through `system.market.*` — there is no write-through here, deliberately,
   * because a write to a null subtree is a bug worth surfacing. */
  get postings() {
    return this.market?.postings ?? [];
  }
  get candidates() {
    return this.market?.candidates ?? [];
  }
  get specialHires() {
    return this.market?.specialHires ?? [];
  }
  get marketRolls() {
    return this.market?.marketRolls ?? [];
  }
  get slander() {
    return this.market?.slander ?? [];
  }
  get demographics() {
    return this.market?.demographics ?? [];
  }
  get searchLedger() {
    return this.market?.searchLedger ?? [];
  }
  get marketLog() {
    return this.market?.marketLog ?? [];
  }
  get pendingHires() {
    return this.market?.pendingHires ?? [];
  }
  get monthAnchorTime() {
    return this.market?.monthAnchorTime ?? 0;
  }

  /* -------------------------------------------- */
  /*  Derived                                      */
  /* -------------------------------------------- */

  /**
   * Effective market class 1..6 (1 = largest), before per-actor effect shifts.
   * `null` when this place has no market — callers that need a number for a
   * market-less place are asking the wrong question, and a null says so louder
   * than a default IV would.
   */
  get marketClass() {
    const market = this.market;
    if (!market) return null;
    if (market.marketClassOverride) return clampMarketClass(market.marketClassOverride);
    if (market.urbanFamilies !== null && market.urbanFamilies !== undefined) {
      try {
        return marketClassFromFamilies(market.urbanFamilies);
      } catch {
        /* tables not loaded yet */
      }
    }
    // Courtesy read of a linked acks-domains domain (heavy WIP — guarded).
    try {
      const domains = game?.modules?.get?.("acks-domains");
      if (domains?.active && market.domainUuid) {
        const domain = fromUuidSync?.(market.domainUuid);
        const urban = domain?.system?.families?.urban;
        const profile = domains.api?.rules?.settlementProfile?.(Number(urban) || 0);
        if (profile?.marketClass) return clampMarketClass(profile.marketClass);
      }
    } catch {
      /* domains API changed — fall through */
    }
    return 4;
  }

  /** Living things recorded here, counting a group row as its whole stack. */
  get headcount() {
    return (this.roster ?? []).reduce((sum, row) => sum + (Number(row?.quantity) > 0 ? Number(row.quantity) : 1), 0);
  }

  /** How many identical instances this actor stands for. Always at least 1. */
  get instanceCount() {
    const n = Math.floor(Number(this.stack?.count) || 1);
    return n > 0 ? n : 1;
  }

  /**
   * Count of active refuse-and-slander entries that apply to a recruiting
   * subject. Accepts `{ employerUuid, characterUuid }`; a bare string is treated
   * as `employerUuid` (back-compat shim for one release). Each entry matches at
   * most one scope branch, so it is counted exactly once — the property that
   * lets a party-wide and an individual slander coexist without double counting.
   *
   * A place with no market has nobody to slander you to: 0, not an error.
   */
  slanderCountFor(query) {
    const { employerUuid = "", characterUuid = "" } =
      typeof query === "string" ? { employerUuid: query } : (query ?? {});
    return (this.slander ?? []).filter((s) => {
      const scope = s.subject?.scope ?? "all";
      const uuid = s.subject?.uuid ?? "";
      if (scope === "all") return true;
      if (scope === "party") return !!employerUuid && uuid === employerUuid;
      if (scope === "character") return !!characterUuid && uuid === characterUuid;
      return false;
    }).length;
  }

  /* -------------------------------------------- */
  /*  Migration                                    */
  /* -------------------------------------------- */

  /**
   * v1 → v2: the market fields were siblings of `region`; they are now the
   * `market` subtree, and a location that never had a market gets `null`.
   *
   * Runs before validation on load (TypeDataField._migrate → migrateDataSafe),
   * so an un-migrated world reads correctly on the first render rather than
   * after a sweep. The rules live in location-migrate.mjs, Foundry-free and
   * unit-tested; this is the seam Foundry calls.
   */
  static migrateData(source) {
    return super.migrateData(migrateLocationSource(source));
  }
}
