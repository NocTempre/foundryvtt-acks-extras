/* global foundry */
/**
 * LocationData — the `acks-extras.location` actor sub-type: a place.
 *
 * A place is four things, and only the first is universal:
 *
 *   1. **Identity and nesting** — a name, a region, notes, and the place it is
 *      inside of.
 *   2. **Contents** — goods (embedded items, stamped by the lib storage
 *      primitive) and a roster of the living things kept here.
 *   3. **A stack count** — identical instances are one actor until one of them
 *      diverges (`lib/place-logic.mjs`, `planSplit`).
 *   4. **A market**, optionally — the henchmen recruitment domain and the
 *      markets feature's goods trade.
 *
 * `system.market` is a nullable subtree: `null` on a place with no market, and
 * its presence is the flag (there is no `hasMarket` boolean). Adding a market
 * is one write of a defaults object (`emptyMarket`); removing one is a write of
 * `null`. See docs/location/DECISIONS.md, "A location is a PLACE, and a market is an option on one".
 *
 * Another module stores its own data in its own flag namespace on the same
 * location actor, so this schema stays minimal. Candidates are plain records,
 * not actors: an Actor is created only on hire.
 */
import { marketClassFromFamilies, clampMarketClass } from "../../henchmen/rules/availability.mjs";
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
// `num`/`str`/`int` are the lib's leaf field-builders; `fields` serves the
// non-leaf types. `occupantField` is the roster row a place and a faction share.
import { num, str, int, occupantField } from "../../lib/fields.mjs";
import { goodsSchema } from "../../markets/data/goods-schema.mjs";
import { PLACE_ROLES } from "../constants.mjs";

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
      alignmentShift: int(0),
      proficiencyName: str(),
      proficiencyRanks: num({ integer: true, min: 1, max: 3 }),
      troopType: str(),
      specialistType: str(),
    }),
    commissioned: new fields.BooleanField({ initial: false }),
    renew: new fields.BooleanField({ initial: false }), // roll a fresh pool at month end
    // Ran a whole market month unchanged: marked on the sheet (post color) and
    // renews as a commissioned search for the whole location.
    advertVeteran: new fields.BooleanField({ initial: false }),
    // The level the employer presents as (RR 168); null = honest.
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
    // The employer searches with their mercantile network: the market reads
    // one class larger for them, at the fee of the class it reads as.
    network: new fields.BooleanField({ initial: false }),
  });
}

/**
 * One candidate — an individual in the market (name, age, culture,
 * appearance, occupation generated from the location's demographics). Only
 * troop-scale entries (mercenaries, mass laborers) stay aggregated with a
 * quantity.
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
    hitDice: str(), // 0th-level HD line (JJ 252)
    profCount: num({ integer: true }), // JJ 253 general-proficiency count by age
    // Claim token: the socket that applies a hiring-roll resolution claims it
    // here first, so a resolution delivered to several GM sockets applies once.
    lastResolutionId: str(),
    // Directed-search replacement (JJ): who this candidate is highlighted
    // for, and month-long availability (exempt from weekly churn).
    highlightFor: str(),
    monthLong: new fields.BooleanField({ initial: false }),
    // A person only one employer's mercantile network reaches: shown to and
    // hired by that employer alone; otherwise a shared-pool row.
    networkFor: str(),
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
 * The MARKET subtree: the henchmen recruitment domain's fields, plus the
 * markets feature's `goods` fragment (authored in
 * scripts/markets/data/goods-schema.mjs; every writer lives there).
 * Gathered under one nullable field so a place without a market carries none of it.
 */
function marketSchema() {
  return {
    // Market-class derivation inputs: explicit override wins, then urban
    // families (local bracket table), then default IV.
    marketClassOverride: num({ integer: true, min: 1, max: 6 }),
    // The Judge's word on denomination exchange here, outranking the derived
    // rule (a market changes freely; anywhere else barters): "market" | "none".
    // Null defers to the derivation — see lib money's exchangeTermsAt.
    exchangeOverride: str(),
    urbanFamilies: num({ integer: true, min: 0 }),
    // The till float this market keeps in coin, in gp, stored and not derived.
    // Null means "derive once and write it back": families × income from the
    // imported tables, a placeholder setting otherwise. The month sweep tops
    // the house coin up to it; `tillRefreshTime` is that sweep's watermark.
    // See docs/location/DECISIONS.md, "A market's till float is stored, and a null one derives once".
    tillTargetGp: num({ min: 0 }),
    tillRefreshTime: num({ min: 0 }),
    domainUuid: str(),
    classRarityTableId: new fields.StringField({ required: true, initial: "default" }),
    // The Judge's word on a class's rarity in THIS market, consulted before
    // the rarity table on every directed search (henchmen `overrideRarity`).
    rarityOverrides: new fields.ArrayField(
      new fields.SchemaField({
        classKey: str(),
        rarity: str(),
      })
    ),
    // Classes THIS market never offers: every class draw here rolls again on
    // one, and a search directed at one is refused (henchmen `classBlocked`).
    blockedClasses: new fields.ArrayField(str()),
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
    // Start of the location's current market month. The whole market (every
    // henchman level, troop type and specialist type) is rolled at each
    // month's beginning even if nobody is hiring.
    monthAnchorTime: int(0),
    // Append-only market ledger: what the market did and when (month rolls,
    // directed replacements, hires). Capped to the recent past.
    marketLog: new fields.ArrayField(
      new fields.SchemaField({
        time: int(),
        type: str(), // monthRoll | replace | hire | reserve
        note: str(),
        // The actor a row is about, so a trader can read their own history out
        // of the market's ledger; gp is that actor's coin movement, signed
        // (paid negative), where the row is one.
        actorUuid: str(),
        gp: num(0),
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
    // The location's monthly availability ledger: one entry per generic
    // segment rolled this month, shared by all recruiters (RR 162).
    marketRolls: new fields.ArrayField(
      new fields.SchemaField({
        segment: str(),
        monthStartTime: int(),
        total: int(0),
        detail: str(),
      })
    ),
    // One employer's roll of a segment at the class their network reads the
    // market as, once per market month; what it finds beyond the town's own
    // roll is theirs alone (`networkFor`). Kept here, not on the posting, so
    // closing a notice and posting again finds the month's roll.
    networkRolls: new fields.ArrayField(
      new fields.SchemaField({
        employerUuid: str(),
        segment: str(),
        monthStartTime: int(),
        marketClass: int(0),
        total: int(0),
        detail: str(),
      })
    ),
    postings: new fields.ArrayField(postingField()),
    candidates: new fields.ArrayField(candidateField()),
    // Special hires: real actors the GM drags in (notable NPCs for hire) plus
    // recruits the party found on adventures (RR 162). GM entries stay
    // available until an optional time limit; found recruits default to the
    // end of the market month. Hiring attempts are tracked per NPC in `refusals`.
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
        // Caller-supplied via `addSpecialHire`; stored, not rendered.
        // See docs/location/DECISIONS.md, "Occupant and special-hire `notes` stay: they are write-only, not dead".
        notes: str(),
      })
    ),
    slander: new fields.ArrayField(
      new fields.SchemaField({
        // Who the entry applies to: a party (employer uuid) or an individual
        // character, so a subject is counted once across a party and its members.
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
    // The item-market subtree, authored by the markets feature (its writers
    // live there). Non-nullable: `system.market`'s presence is the only gate,
    // and clean() fills it on a market saved without one.
    goods: goodsSchema(),
  };
}

/**
 * The nullable market field. The three options make the subtree absent rather
 * than an object of empty arrays: `clean()` short-circuits on null via
 * `_validateSpecial` before it casts, so a market-less place stores `null`.
 */
const marketField = () =>
  new fields.SchemaField(marketSchema(), { required: false, nullable: true, initial: null });

/**
 * A fresh, fully-defaulted market — what "add a market to this place" writes.
 *
 * Built from a throwaway non-nullable field: a SchemaField takes ownership of
 * the field instances handed to it (`_initialize` throws if one is reused), so
 * the schema is rebuilt rather than borrowed from the live one.
 */
export const emptyMarket = () => new fields.SchemaField(marketSchema()).clean({});

/**
 * The `acks-extras.location` actor sub-type. Identity, nesting, contents and
 * stack count on every place; a nullable `market` subtree only where there is
 * one.
 */
export class LocationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // --- acks system compatibility stubs -------------------------------
      // AcksActor.prepareDerivedData runs for every actor type and touches
      // isNew / attack / initiative / movement / saves unguarded; without them
      // every location update logs a failed-data-preparation error. The set is
      // defined once in lib; its values are meaningless for a settlement.
      ...acksCompatStubs(),

      // --- identity ------------------------------------------------------
      region: str(),
      // What this place is to a city procedure (PLACE_ROLES). Blank is a listed
      // choice; a key outside the registry is refused at the write.
      role: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PLACE_ROLES)] }),
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      // The Judge's own record of what this place actually is. A second field,
      // not a gate on `notes`; rendered only inside the sheet's GM region, a UI
      // convention and not a security boundary.
      // See docs/location/DECISIONS.md, "The Judge's record of a place is a second field, not a gate on the shared notes".
      gmNotes: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      // --- nesting -------------------------------------------------------
      // The place this place is inside of. A uuid, since a parent may be a
      // location actor or any other provider the lib's place layer resolves.
      // Cycles are refused at the write (`lib/place-logic.mjs` `wouldCycle`).
      parentUuid: str(),

      // --- the map -------------------------------------------------------
      // The scene this place is. Set from the scene side (the scene holds the
      // matching flag) and mirrored here so the sheet can offer "open the map"
      // without a world scan; the link is made on demand.
      sceneUuid: str(),
      // The scene region this place is (a quarter of a city drawn as a
      // District): the same link at a finer grain, its mirror kept true by
      // scene-link.mjs.
      regionUuid: str(),

      // --- stacking ------------------------------------------------------
      // `count` is the only stack state: a place cannot express divergence as
      // an ActorDelta, so divergence is a split into a second actor. See
      // docs/lib/GROUPS.md for the invariant this is the place-shaped analogue of.
      stack: new fields.SchemaField({
        count: int(1),
        label: str(), // what one instance is called: "Bay", "Cell", "Stall"
      }),

      // --- occupancy -----------------------------------------------------
      // The living things kept here, held as references (lib `occupantField`)
      // since Foundry has no actor inside an actor. Goods are embedded items.
      roster: new fields.ArrayField(occupantField()),

      // --- the market, if this place has one -----------------------------
      market: marketField(),

      schemaVersion: int(2),
    };
  }

  /* -------------------------------------------- */
  /*  The market gate                              */
  /* -------------------------------------------- */

  /** Does this place have a market? The presence of the subtree is the flag. */
  get hasMarket() {
    return this.market != null;
  }

  /** The role key this place carries (a key of PLACE_ROLES), or "" when it has none. */
  get placeRole() {
    return typeof this.role === "string" && Object.hasOwn(PLACE_ROLES, this.role) ? this.role : "";
  }

  /* Read-through conveniences: empty collections for a market-less place.
   * Writers go through `system.market.*`; there is no write-through here. */
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
  get networkRolls() {
    return this.market?.networkRolls ?? [];
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
   * `null` when this place has no market.
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
   * subject. Accepts `{ employerUuid, characterUuid }`. Each entry matches at
   * most one scope branch, so it is counted once. A place with no market
   * returns 0.
   */
  slanderCountFor(query) {
    const { employerUuid = "", characterUuid = "" } = query ?? {};
    return (this.slander ?? []).filter((s) => {
      const scope = s.subject?.scope ?? "all";
      const uuid = s.subject?.uuid ?? "";
      if (scope === "all") return true;
      if (scope === "party") return !!employerUuid && uuid === employerUuid;
      if (scope === "character") return !!characterUuid && uuid === characterUuid;
      return false;
    }).length;
  }
}
