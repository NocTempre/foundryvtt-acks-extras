/* global foundry, game */
/**
 * LocationData — the `acks-henchmen.location` actor sub-type: a settlement
 * where hirelings are recruited. Holds the market-class derivation inputs,
 * recruitment postings, candidate records, the per-town slander registry,
 * and a search-fee ledger.
 *
 * DESIGNED FOR EXTENSION by the future domain-module family: other modules
 * (e.g. a structures/strongholds module) store their own data in their own
 * flag namespace on the same location actor; this schema stays minimal.
 *
 * Candidates are plain records, NOT actors — a Class I market can roll
 * hundreds of 0th-level candidates; a real Actor is created only on hire.
 */
import { marketClassFromFamilies, clampMarketClass } from "../../henchmen/rules/availability.mjs";
import { acksCompatStubs } from "../../lib/actor-compat.mjs";
// num/str/int are the family's leaf field-builders — one definition in acks-lib
// (this file and henchman-record.mjs each had a verbatim copy). `fields` is
// still needed locally for the non-leaf types (SchemaField, ArrayField, HTMLField).
import { num, str, int } from "../../lib/fields.mjs";

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
      // --- location data -------------------------------------------------
      region: str(),
      notes: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      // Market-class derivation inputs: explicit override wins, then urban
      // families (local bracket table), then acks-domains courtesy read,
      // then default IV.
      marketClassOverride: num({ integer: true, min: 1, max: 6 }),
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
      schemaVersion: int(1),
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
    };
  }

  /**
   * Legacy → subject migration: the flat `partyKey` string became a structured
   * `subject {scope, uuid}`. A blank key meant "applies to everyone"; any other
   * value was an employer/party uuid. Runs before validation on load.
   */
  /** Effective market class 1..6 (1 = largest), before per-actor effect shifts. */
  get marketClass() {
    if (this.marketClassOverride) return clampMarketClass(this.marketClassOverride);
    if (this.urbanFamilies !== null && this.urbanFamilies !== undefined) {
      try {
        return marketClassFromFamilies(this.urbanFamilies);
      } catch {
        /* tables not loaded yet */
      }
    }
    // Courtesy read of a linked acks-domains domain (heavy WIP — guarded).
    try {
      const domains = game?.modules?.get?.("acks-domains");
      if (domains?.active && this.domainUuid) {
        const domain = fromUuidSync?.(this.domainUuid);
        const urban = domain?.system?.families?.urban;
        const profile = domains.api?.rules?.settlementProfile?.(Number(urban) || 0);
        if (profile?.marketClass) return clampMarketClass(profile.marketClass);
      }
    } catch {
      /* domains API changed — fall through */
    }
    return 4;
  }

  /**
   * Count of active refuse-and-slander entries that apply to a recruiting
   * subject. Accepts `{ employerUuid, characterUuid }`; a bare string is treated
   * as `employerUuid` (back-compat shim for one release). Each entry matches at
   * most one scope branch, so it is counted exactly once — the property that
   * lets a party-wide and an individual slander coexist without double counting.
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
}
