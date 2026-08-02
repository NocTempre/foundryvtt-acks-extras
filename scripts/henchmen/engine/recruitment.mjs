/* global game, foundry, Roll, Hooks, ChatMessage, CONST */
/**
 * Recruitment engine — RAW model (RR 162, JJ 118):
 *
 *  - AVAILABILITY IS A PROPERTY OF THE MARKET. Each generic segment
 *    (henchmen of a level, a mercenary troop type, a specialist type) is
 *    rolled ONCE PER GAME MONTH PER LOCATION, using the location's market
 *    class — shared by every recruiter in town. ½ (round up) of the pool
 *    arrives in week 1, ¼ (round down, min 1) in week 2, the rest in week 3.
 *  - A POSTING is a recruiter's PAID SEARCH: the weekly fee (per hireling
 *    type, RR 162) buys access to that segment's arrived candidates.
 *  - SPECIFIC searches (by class or proficiency, JJ 118) are paid and rolled
 *    SEPARATELY, privately, per recruiter — once per month per specification,
 *    capped by the market's base henchman availability.
 *  - Every candidate is a UNIQUE INDIVIDUAL: name, gender, age, culture,
 *    appearance, and (0th level) occupation + class trajectory, generated
 *    from the location's demographics. Class and level are FIXED at pool
 *    roll (anti-fishing); attributes roll once at hire. Only troop-scale
 *    entries (mercenaries, mass laborers) stay aggregated.
 *
 * All processing is idempotent (worldTime watermarks) — updateWorldTime
 * re-fires are safe.
 */
import { MODULE_ID, HOOKS, SECONDS_PER_DAY, SECONDS_PER_WEEK } from "../constants.mjs";
import {
  rollMonthlyPool,
  arrivalSplit,
  shiftMarketClass,
  searchFeeFormula,
  clampMarketClass,
} from "../rules/availability.mjs";
import { parseAvailability } from "../rules/dice.mjs";
import { rollClassFromDistribution, rollRandomLevel, rollProficiencyLevel } from "../rules/candidates.mjs";
import { generateIdentity, classInfo } from "../rules/identity.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import { getTable, optTable, hasDoc } from "../rules/tables.mjs";
import { sumEffectModifiers } from "../effects.mjs";
import { getSetting } from "../settings.mjs";
import * as adapter from "../acks-adapter.mjs";
import { registerSocketAction } from "../sockets.mjs";
import { now, secondsPerMonth, calendarMonthStart, sameMarketMonth } from "../time.mjs";
import { postSlaveMarketCard } from "./slavery-market.mjs";

/** Foundry dice bridge for the pure rules functions. */
export async function rollDice(formula) {
  const roll = await new Roll(formula).evaluate();
  return roll.total;
}

/** Kinds that draw on the shared location pool vs. private JJ searches. */
export const GENERIC_KINDS = ["henchman", "mercenary", "specialist"];
export const PRIVATE_KINDS = ["henchmanByClass", "henchmanByClassProficiency", "henchmanByProficiency"];

/**
 * Directed-search SPECIFICITY (user's RAW model): a successful directed
 * search REPLACES rolled leveled henchmen still left in the month; when
 * several searches contend, the more specific resolves first (random on
 * ties). 4 = class+level, 3 = class, 2 = class proficiency, 1 = general
 * proficiency.
 */
export function specSpecificity(spec) {
  if (spec.kind === "henchmanByClass") return spec.level >= 1 ? 4 : 3;
  if (spec.kind === "henchmanByClassProficiency") return 2;
  if (spec.kind === "henchmanByProficiency") return 1;
  return 0;
}

/** Shared-pool key for a generic spec. A GENERAL henchman post (the option
 *  players buy — "an adventuring henchman") covers every henchman level. */
export function segmentKeyFor(spec) {
  if (spec.kind === "henchman") return spec.general || spec.level == null ? "henchman:*" : `henchman:${spec.level}`;
  if (spec.kind === "mercenary") return `mercenary:${spec.troopType}`;
  if (spec.kind === "specialist") return `specialist:${spec.specialistType}`;
  return "";
}

/* ------------------------- commissions ------------------------- */
/**
 * A posting that has advertised THE SAME THING through a whole market month
 * upgrades to a COMMISSION (the JJ mechanic): its own further rolls shift
 * one rarity toward common. `advertVeteran` is stamped at the monthly roll
 * on postings that already existed when the ending month began (a posting's
 * spec is immutable, so it advertised the same thing throughout).
 */

/**
 * Effective market class for a recruiter's own dealings (fees, private
 * searches): Mercantile Network shifts it. The SHARED pool always uses the
 * location's own class — the town's stock doesn't depend on who is asking.
 */
export function effectiveMarketClass(location, employer) {
  const base = location.system.marketClass;
  const shift = employer ? sumEffectModifiers(employer, "marketClass") : 0;
  return shiftMarketClass(base, shift);
}

/**
 * Troop-scale (aggregated) segments: mercenaries always; specialist types
 * whose Class I availability uses a ×multiplier (laborers, rowers, sailors,
 * copyists, street-corner ruffians) — the book counts them by the score.
 */
function isMassSpec(spec) {
  if (spec.kind === "mercenary") return true;
  if (spec.kind !== "specialist") return false;
  const row = (optTable("availability", "specialistAvailability")?.rows ?? []).find((r) => r.type === spec.specialistType);
  const parsed = row ? parseAvailability(row.byMarketClass[0]) : null;
  return !!parsed && parsed.mult > 1;
}

function demographicsOf(location) {
  return (location.system.demographics ?? []).map((d) => d.toObject?.() ?? d);
}

/** Append to the location's market ledger (rollback record), capped. */
export function marketLogAppend(list, time, type, note) {
  const out = [...list, { time, type, note }];
  return out.length > 100 ? out.slice(-100) : out;
}

/**
 * Apply a successful DIRECTED SEARCH as pool REPLACEMENT (user's RAW model,
 * JJ 118-119): up to `quantity` valid leveled henchmen still left in the
 * month (pending or unhired) are randomly replaced by what the recruiter
 * sought. Only step-3 rolled henchmen (level 1+, shared pool) qualify;
 * class+level searches replace only their level. Replaced candidates are
 * highlighted for the posting employer and stay available ALL month (no
 * weekly churn). Mutates `candidates` in place; returns the replaced count.
 */
export function applyDirectedReplacement({ location, spec, employerUuid, quantity, rarity, candidates }) {
  if (!(quantity > 0)) return 0;
  const eligible = candidates.filter(
    (c) =>
      String(c.segment ?? "").startsWith("henchman:") &&
      (c.level ?? 0) >= 1 &&
      ["pending", "available"].includes(c.status) &&
      !c.highlightFor &&
      (spec.kind !== "henchmanByClass" || spec.level == null || c.level === spec.level)
  );
  // random order among the eligible
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const picks = eligible.slice(0, Math.min(quantity, eligible.length));
  const demographics = demographicsOf(location);
  for (const c of picks) {
    // The search FOUND this person: available immediately and for the whole
    // month (user model) — a pending future-week arrival that stayed
    // "pending" was invisible and unhirable (found live 2026-07-23).
    c.status = "available";
    // Directed results are PRIVATE to the recruiter (JJ 118) and live in
    // the Recruitment tab's directed bucket — not the shared walk-in tabs
    // (user report 2026-07-23). Employer-less GM posts stay shared.
    c.privateToUuid = employerUuid ?? "";
    const changesClass = spec.kind === "henchmanByClass" || spec.kind === "henchmanByClassProficiency";
    if (changesClass && spec.classKey) {
      c.classKey = spec.classKey;
      c.classRarity = rarity ?? c.classRarity;
      // a new class can mean a new race/culture — the person changes
      // (best-effort: missing people tables must not stall processing)
      try {
        const identity = generateIdentity({ demographics, level: c.level ?? 1, classKey: spec.classKey });
        c.name = identity.name;
        c.gender = identity.gender;
        c.culture = identity.culture;
        c.age = identity.age;
        c.appearance = identity.appearance;
      } catch (err) {
        console.warn("acks-henchmen | replacement identity regen failed (people tables missing?)", err);
      }
    }
    if (spec.kind === "henchmanByProficiency" || spec.kind === "henchmanByClassProficiency") {
      const tag = `${spec.proficiencyName} ×${spec.proficiencyRanks ?? 1}`;
      c.notes = c.notes ? `${c.notes} · ${tag}` : tag;
    }
    c.highlightFor = employerUuid ?? "";
    c.monthLong = true;
  }
  return picks.length;
}

/**
 * Build ONE candidate for a GM post: place the NPC the GM named, honouring the
 * fields they specified (class, level, proficiency) and randomising ONLY the
 * ones they left blank (name, culture, age, appearance, and any unspecified
 * class or level). A GM does not search — they stock the pool — so this mints a
 * concrete individual available now, a normal shared henchman for its level.
 * `monthLong` exempts it from the weekly churn (a deliberate placement should
 * not wander off after a week); the month rollover still refreshes the market.
 */
async function buildGmCandidate(location, spec, { marketClass = 4 } = {}) {
  const demographics = demographicsOf(location);
  const variant = location.system.classRarityTableId || "default";

  // Level: use the specified one, else roll for the market.
  let level = spec.level != null && spec.level >= 1 ? spec.level : null;
  if (level == null) {
    const rolled = await rollRandomLevel(rollDice, clampMarketClass(marketClass));
    level = rolled.level;
  }

  // Class: use the specified one, else roll from the leveled distribution.
  let classKey = spec.classKey ?? "";
  let doubleD100;
  if (!classKey && level > 0) {
    const rolled = await rollClassFromDistribution(rollDice, variant, level);
    classKey = rolled.classKey;
    doubleD100 = rolled.rolls;
  }

  const c = {
    id: foundry.utils.randomID(),
    kind: "henchman", // a concrete individual joins the henchman pool
    quantity: 1,
    segment: `henchman:${level}`, // shared pool member for its level
    privateToUuid: "",
    highlightFor: "",
    monthLong: true,
    status: "available",
    availableFromTime: now(),
    classKey,
    level,
    wageGp: henchmanWage(level),
    wageUnit: "month",
    notes: spec.proficiencyName ? `${spec.proficiencyName} ×${spec.proficiencyRanks ?? 1}` : "",
  };
  if (doubleD100) c.doubleD100 = doubleD100;

  // Identity (name / gender / culture / age / appearance) is always randomised
  // — the dialog does not capture it, so it is "unspecified". Best-effort.
  try {
    const identity = generateIdentity({ demographics, level, classKey, station: "commoner" });
    c.name = identity.name;
    c.gender = identity.gender;
    c.culture = identity.culture;
    c.age = identity.age;
    c.appearance = identity.appearance;
    if (identity.hitDice) c.hitDice = identity.hitDice;
    if (identity.profCount != null) c.profCount = identity.profCount;
  } catch (err) {
    console.warn(`${MODULE_ID} | GM candidate identity generation failed`, err);
  }
  return c;
}

/**
 * Build candidate records for one rolled pool.
 * @returns {Promise<object[]>}
 */
async function buildCandidates({ location, spec, total, marketClass, segment, privateToUuid, monthStart, rarity, notBefore = 0 }) {
  const [w1, w2, w3] = arrivalSplit(total);
  const weeks = [
    { week: 1, count: w1 },
    { week: 2, count: w2 },
    { week: 3, count: w3 },
  ];
  const candidates = [];
  const mass = isMassSpec(spec);
  const demographics = demographicsOf(location);
  const rand = Math.random;

  for (const { week, count } of weeks) {
    if (count <= 0) continue;
    // LATE ROLLS: when the month is rolled after its start (clock jumped,
    // nobody processed), arrivals schedule from the ROLL time — backdating
    // them to the month start made whole cohorts expire instantly (one week
    // of visibility each; user report 2026-07-23). On-time rolls keep the
    // RAW week 1/2/3 pacing.
    const availableFromTime = Math.max(monthStart + (week - 1) * SECONDS_PER_WEEK, notBefore + (week - 1) * SECONDS_PER_WEEK);
    const base = {
      segment: segment ?? "",
      privateToUuid: privateToUuid ?? "",
      kind: spec.kind,
      level: spec.level ?? null,
      classKey: spec.classKey ?? "",
      classRarity: rarity ?? "",
      troopType: spec.troopType ?? "",
      specialistType: spec.specialistType ?? "",
      wageGp: null,
      wageUnit: "month",
      availableFromTime,
      status: "pending",
    };

    if (mass) {
      // Troop-scale: one aggregated row per arrival week. The combined
      // composite/longbow entry resolves to the settlement's variant
      // (RR 164: a settlement has one of the two, not both); troop types
      // without a human wage (e.g. dwarven mounted crossbowmen) fall back
      // to their race's wage.
      let wageType = spec.troopType;
      let labelKey = spec.kind === "mercenary" ? `ACKS-HENCHMEN.troop.${spec.troopType}` : `ACKS-HENCHMEN.specialist.${spec.specialistType}`;
      if (spec.troopType === "compositeBowmanLongbowman") {
        wageType = location.system.compositeVariant === "longbow" ? "longbowman" : "compositeBowman";
        labelKey = `ACKS-HENCHMEN.troop.${wageType}`;
      }
      const row =
        spec.kind === "mercenary"
          ? (optTable("wages", "mercenaryWages")?.rows ?? []).find((r) => r.type === wageType)
          : (optTable("availability", "specialistAvailability")?.rows ?? []).find((r) => r.type === spec.specialistType);
      const mercWage = row?.wages ? (row.wages.man ?? Object.values(row.wages).find((w) => w != null) ?? null) : null;
      candidates.push({
        ...base,
        id: foundry.utils.randomID(),
        name: game.i18n.localize(labelKey),
        quantity: count,
        wageGp: spec.kind === "mercenary" ? mercWage : (row?.wage ?? null),
        wageUnit: spec.kind === "mercenary" ? "month" : (row?.wageUnit ?? "month"),
      });
      continue;
    }

    // Individuals: identity + fixed class/level per candidate (anti-fishing).
    // CLASS ROLLS FIRST (bucket distribution, location rarity variant);
    // culture/sex resolve downstream from the class registry.
    const variant = location.system.classRarityTableId || "default";
    for (let i = 0; i < count; i++) {
      const candidate = { ...base, id: foundry.utils.randomID(), quantity: 1 };
      if (spec.kind === "henchman") {
        if ((spec.level ?? 0) > 0) {
          const rolled = await rollClassFromDistribution(rollDice, variant, spec.level);
          candidate.classKey = rolled.classKey;
          candidate.doubleD100 = rolled.rolls;
        }
        // 0th-level henchmen have NO class (user's market model: classes are
        // rolled on the double-d100 for level 1-4 ONLY; a 0th prospect rolls
        // a street OCCUPATION and takes a class when they actually level).
        candidate.wageGp = henchmanWage(spec.level ?? 0);
      } else if (spec.kind === "henchmanByClass") {
        if (!candidate.level || candidate.level <= 0) {
          const rolled = await rollRandomLevel(rollDice, clampMarketClass(marketClass));
          candidate.level = rolled.level;
        }
        candidate.wageGp = henchmanWage(candidate.level ?? 0);
      } else if (spec.kind === "henchmanByProficiency") {
        // A leveled proficiency post finds candidates AT that level (the
        // level set the search's rarity); unleveled (GM tool) rolls it.
        if (spec.level >= 1) {
          candidate.level = spec.level;
        } else {
          const lvl = await rollProficiencyLevel(rollDice, clampMarketClass(marketClass));
          candidate.level = lvl.level;
        }
        if (candidate.level > 0) {
          const cls = await rollClassFromDistribution(rollDice, variant, candidate.level);
          candidate.classKey = cls.classKey;
          candidate.doubleD100 = cls.rolls;
        }
        // 0th-level proficiency finds stay classless (occupation only).
        candidate.notes = spec.proficiencyName
          ? `${spec.proficiencyName} ×${spec.proficiencyRanks ?? 1}`
          : "";
        candidate.wageGp = henchmanWage(candidate.level ?? 0);
      } else if (spec.kind === "specialist") {
        const row = (optTable("availability", "specialistAvailability")?.rows ?? []).find(
          (r) => r.type === spec.specialistType
        );
        candidate.wageGp = row?.wage ?? null;
        candidate.wageUnit = row?.wageUnit ?? "month";
      }

      const identity = generateIdentity({
        rand,
        demographics,
        level: candidate.level ?? 0,
        classKey: spec.kind === "specialist" ? "" : candidate.classKey,
        // JJ 252 station: mercenaries roll the militia/mercenary HD line.
        station: spec.kind === "mercenary" ? "militia" : "commoner",
      });
      candidate.name = identity.name;
      candidate.gender = identity.gender;
      candidate.culture = identity.culture;
      candidate.age = identity.age;
      candidate.appearance = identity.appearance;
      if (identity.hitDice) candidate.hitDice = identity.hitDice;
      if (identity.profCount != null) candidate.profCount = identity.profCount;
      // Occupation belongs ONLY to 0th-level henchman prospects (JJ 254);
      // they carry NO class. A specialist's occupation IS their type;
      // leveled candidates have real classes already.
      const henchKind = ["henchman", "henchmanByClass", "henchmanByProficiency"].includes(spec.kind);
      if (henchKind && (candidate.level ?? 0) === 0) {
        if (!candidate.occupation && identity.occupation) candidate.occupation = identity.occupation;
      }
      candidates.push(candidate);
    }
  }
  return candidates;
}

/* ------------------------- shared pools ------------------------- */

/**
 * Every generic spec this location's market carries: henchmen of each level,
 * every mercenary troop type (camel troops only in desert realms), every
 * specialist type.
 */
export function allSegmentSpecs(location) {
  const specs = [];
  for (let level = 0; level <= 4; level++) specs.push({ kind: "henchman", level });
  for (const row of optTable("availability", "mercenaryAvailability")?.rows ?? []) {
    if (row.desert && !location.system.desertRealm) continue;
    specs.push({ kind: "mercenary", troopType: row.type });
  }
  for (const row of optTable("availability", "specialistAvailability")?.rows ?? []) {
    specs.push({ kind: "specialist", specialistType: row.type });
  }
  return specs;
}

/**
 * Roll the WHOLE market for a new month (RR 162: availability belongs to
 * the town, and the townsfolk exist whether or not anyone is hiring — a
 * party that starts searching in week 2 finds week-1 arrivals already come
 * and gone). Purges every public row of the previous month (hired
 * candidates live on as actors) and rebuilds all segments anchored at
 * `anchorTime`.
 * @returns {Promise<{candidates: object[], marketRolls: object[]}>}
 */
export async function rollMonth(location, anchorTime, rollTime = anchorTime) {
  const marketClass = location.system.marketClass; // the town's own stock
  const candidates = [];
  const marketRolls = [];
  for (const spec of allSegmentSpecs(location)) {
    const segment = segmentKeyFor(spec);
    const result = await rollMonthlyPool(spec, marketClass, rollDice);
    if (result.error) continue;
    marketRolls.push({ segment, monthStartTime: anchorTime, total: result.quantity, detail: result.detail });
    if (result.quantity <= 0) continue;
    candidates.push(
      ...(await buildCandidates({
        location,
        spec,
        total: result.quantity,
        marketClass,
        segment,
        privateToUuid: "",
        monthStart: anchorTime,
        notBefore: rollTime,
      }))
    );
  }
  return { candidates, marketRolls };
}

/* ------------------------- postings (paid searches) ------------------------- */

/**
 * Roll and charge one week's search fee (RR 162: fee per week per hireling
 * type, rolled). The fee is the TOWN's posted rate — the location's own
 * market class, NOT the employer's Mercantile-Network-shifted class (that
 * shift governs availability, not the cost of advertising here). Rolled once
 * as a VISIBLE dice roll; the same total is shown, deducted, and logged.
 * @param {Actor} location
 * @param {Actor|null} employer
 * @param {number} week - the week number being charged (for the card)
 */
async function chargeWeeklyFee(location, employer, week = 1) {
  const mc = location.system.marketClass;
  const formula = searchFeeFormula(mc);
  const roll = await new Roll(formula).evaluate();
  const gp = roll.total;
  // Show the fee as an actual roll so it never reads as a flat charge.
  await ChatMessage.create({
    flavor: game.i18n.format("ACKS-HENCHMEN.fee.card", { name: location.name, week, formula }),
    rolls: [roll],
    speaker: ChatMessage.getSpeaker({ actor: employer ?? location }),
    whisper: adapter.gmIds(),
  });
  let paid = false;
  if (employer) {
    paid = await adapter.spendGold(employer, gp, game.i18n.format("ACKS-HENCHMEN.fee.reason", { name: location.name }), {
      chat: false, // the roll card above IS the receipt
    });
  }
  return { gp, paid };
}

/**
 * Create a posting (paid search). Generic kinds join the shared segment
 * pool; specific kinds roll a private pool (JJ 118: once per month per
 * specification per recruiter, at the recruiter's effective market class,
 * capped by base henchman availability).
 */
export async function createPosting(location, rawSpec, employer, { dedicatedSearcherUuid = "", playersSeeDetails = true, requestUserId = null } = {}) {
  const currentTime = now();
  // presentedLevel travels on the POSTING (RR 168 lie), not the spec — keep
  // it out of spec comparisons and storage.
  const { presentedLevel = null, ...spec } = rawSpec;
  const isPrivate = PRIVATE_KINDS.includes(spec.kind);
  // A GM at the keyboard (no requestUserId) placing a directed NPC is stocking
  // the pool, not searching: it skips the player search rules (criteria,
  // once-per-month-per-spec) and simply adds the named NPC, so a GM can place
  // as many as they like.
  const gmAdd = isPrivate && !requestUserId;
  const segment = isPrivate ? "" : segmentKeyFor(spec);

  // Player posts name WHAT they want: at least one criterion beyond a warm
  // body, and (for leveled searches) the level — it sets the price. Plain
  // "any henchman of level X" posts are a GM tool. Enforced here so socket
  // relays cannot bypass the dialog.
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (user && !user.isGM) {
      const employerActor = employer?.actor ?? employer;
      if (!employerActor || !employerActor.testUserPermission(user, "OWNER")) return { error: "not-yours" };
      // Players buy the listed options: the GENERAL henchman post, a
      // mercenary/specialist TYPE, or a directed search naming its target.
      if (spec.kind === "henchman" && !(spec.general || spec.level == null)) return { error: "criteria-required" };
      if ((spec.kind === "henchmanByClass" || spec.kind === "henchmanByClassProficiency") && !spec.classKey) return { error: "criteria-required" };
      if ((spec.kind === "henchmanByProficiency" || spec.kind === "henchmanByClassProficiency") && !String(spec.proficiencyName ?? "").trim())
        return { error: "criteria-required" };
    }
  }

  // Alignment openness (directed class searches): an opposed-alignment
  // class is harder to recruit openly — rarity shift per the table.
  if ((spec.kind === "henchmanByClass" || spec.kind === "henchmanByClassProficiency") && !spec.alignmentShift) {
    const classAlignment = classInfo(spec.classKey)?.alignment;
    if (classAlignment) {
      const shifts = optTable("rarity", "alignmentRecruitment")?.shifts ?? {};
      spec.alignmentShift = shifts[location.system.settlementAlignment ?? "lawful"]?.[classAlignment] ?? 0;
    }
  }

  // Duplicate checks: one active search per employer per segment / spec-month.
  const postings = (location.system.postings ?? []).map((p) => p.toObject?.() ?? foundry.utils.deepClone(p));
  if (!isPrivate) {
    const dup = postings.find((p) => p.status === "active" && p.segment === segment && p.employerUuid === (employer?.uuid ?? ""));
    if (dup) return { error: "duplicate-segment" };
  } else if (!gmAdd) {
    // Once per month per TYPE of directed search per recruiter (user's RAW
    // model): a second by-class search this month is blocked even for a
    // different class. GM placements are exempt (they are not searches).
    const dup = postings.find(
      (p) =>
        p.status === "active" &&
        p.employerUuid === (employer?.uuid ?? "") &&
        (p.spec.toObject?.() ?? p.spec)?.kind === spec.kind &&
        sameMarketMonth(p.monthStartTime, currentTime)
    );
    if (dup) return { error: "duplicate-spec-this-month" };
  }

  const posting = {
    id: foundry.utils.randomID(),
    createdTime: currentTime,
    monthStartTime: currentTime,
    segment,
    employerUuid: employer?.uuid ?? "",
    dedicatedSearcherUuid,
    presentedLevel,
    spec,
    commissioned: !!spec.commissioned,
    totalAvailable: 0,
    rollDetail: "",
    arrivalPlan: [],
    feesPaid: [],
    lastProcessedTime: currentTime,
    status: "active",
    playersSeeDetails,
  };

  let newCandidates = [];
  let nextRolls = null;
  let anchorUpdate = null;

  let replacedCandidates = null;
  let replacedCount = 0;
  // A GM does not SEARCH — they place the NPC they named (gmAdd, computed
  // above): ADD that candidate to the pool, random only on the fields left
  // blank. Players still pay to search, which finds people by replacement.
  if (gmAdd) {
    const mc = effectiveMarketClass(location, employer);
    const placed = await buildGmCandidate(location, spec, { marketClass: mc });
    newCandidates = [placed];
    posting.totalAvailable = 1;
    posting.rollDetail = `GM-placed: ${placed.classKey || "henchman"}${placed.level ? ` L${placed.level}` : ""}`;
  } else if (isPrivate) {
    // DIRECTED SEARCH → POOL REPLACEMENT (user's RAW model): the roll
    // (final rarity vs. Henchman Availability by Market Class and Rarity)
    // does not mint new people — it replaces rolled leveled henchmen still
    // left in the month with what the recruiter sought.
    const mc = effectiveMarketClass(location, employer);
    const result = await rollMonthlyPool(spec, mc, rollDice, Math.random, location.system.classRarityTableId || "default");
    if (result.error) return { error: result.error };
    posting.totalAvailable = result.quantity;
    posting.rollDetail = result.detail;
    replacedCandidates = (location.system.candidates ?? []).map((c) => c.toObject?.() ?? foundry.utils.deepClone(c));
    replacedCount = applyDirectedReplacement({
      location,
      spec,
      employerUuid: employer?.uuid ?? "",
      quantity: result.quantity,
      rarity: result.rarity,
      candidates: replacedCandidates,
    });
  } else {
    // The town's market is rolled at month start regardless of searches —
    // a posting just buys access. Initialize the market on first contact.
    let rolls = (location.system.marketRolls ?? []).map((r) => r.toObject?.() ?? r);
    if (!location.system.monthAnchorTime || !rolls.length) {
      const month = await rollMonth(location, currentTime);
      newCandidates = month.candidates;
      nextRolls = month.marketRolls;
      rolls = month.marketRolls;
      anchorUpdate = currentTime;
    }
    if (segment === "henchman:*") {
      const hench = rolls.filter((r) => r.segment.startsWith("henchman:"));
      posting.totalAvailable = hench.reduce((s2, r) => s2 + (r.total ?? 0), 0);
      posting.rollDetail = hench.map((r) => `${r.segment.split(":")[1]}: ${r.total}`).join(", ");
    } else {
      const entry = rolls.find((r) => r.segment === segment);
      posting.totalAvailable = entry?.total ?? 0;
      posting.rollDetail = entry?.detail ?? "";
    }
  }

  // A GM placement is not a paid search — no weekly fee, no ledger line.
  let fee = { gp: 0 };
  if (!gmAdd) {
    fee = await chargeWeeklyFee(location, employer, 1);
    posting.feesPaid.push({ time: currentTime, gp: fee.gp });
  }

  const update = { "system.postings": [...postings, posting] };
  if (!gmAdd) {
    update["system.searchLedger"] = [
      ...(location.system.searchLedger ?? []).map((l) => l.toObject?.() ?? l),
      { time: currentTime, gp: fee.gp, postingId: posting.id, paidByUuid: employer?.uuid ?? "" },
    ];
  }
  if (replacedCandidates) {
    // directed search: the pool itself was rewritten (replacements)
    update["system.candidates"] = newCandidates.length ? [...replacedCandidates, ...newCandidates] : replacedCandidates;
    update["system.marketLog"] = marketLogAppend(
      (location.system.marketLog ?? []).map((l) => l.toObject?.() ?? l),
      currentTime,
      "replace",
      `${posting.rollDetail || spec.kind}: ${replacedCount} of ${posting.totalAvailable} rolled replaced for ${employer?.name ?? "?"}`
    );
  } else if (newCandidates.length) {
    update["system.candidates"] = [
      ...(location.system.candidates ?? []).map((c) => c.toObject?.() ?? c),
      ...newCandidates,
    ];
    if (gmAdd) {
      update["system.marketLog"] = marketLogAppend(
        (location.system.marketLog ?? []).map((l) => l.toObject?.() ?? l),
        currentTime,
        "gmPlace",
        `${posting.rollDetail} — ${newCandidates[0]?.name ?? "?"}`
      );
    }
  }
  if (nextRolls) update["system.marketRolls"] = nextRolls;
  if (anchorUpdate) update["system.monthAnchorTime"] = anchorUpdate;
  await location.update(update);
  Hooks.callAll(HOOKS.POSTING_CREATED, { location, posting, employer });
  return { posting, fee, replaced: replacedCount, gmPlaced: gmAdd, placedName: gmAdd ? newCandidates[0]?.name : undefined };
}

/* ------------------------- time processing ------------------------- */

/**
 * Idempotent due-processing for one location: arrivals, weekly fees per
 * active posting, monthly pool refresh (shared segments with an active
 * search; private searches re-roll monthly while active — JJ: "paying the
 * fee and rolling again each month").
 */
export async function processLocation(location, currentTime = now()) {
  const sys = location.system;
  const postings = (sys.postings ?? []).map((p) => p.toObject?.() ?? foundry.utils.deepClone(p));
  let candidates = (sys.candidates ?? []).map((c) => c.toObject?.() ?? foundry.utils.deepClone(c));
  let marketRolls = (sys.marketRolls ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
  const ledger = (sys.searchLedger ?? []).map((l) => l.toObject?.() ?? foundry.utils.deepClone(l));
  let marketLog = (sys.marketLog ?? []).map((l) => l.toObject?.() ?? l);
  let changed = false;
  let monthAnchorTime = sys.monthAnchorTime || 0;
  const arrivals = new Map();

  // 0. Month anchor: the WHOLE market rolls at the start of every month,
  // hiring or no hiring. With a world calendar the market month IS the
  // calendar month (anchor = the month's first second, so week-1 arrivals
  // land in its first week); day-counted months are the fallback. Initialize
  // on first contact; on rollover, purge all public rows (hired candidates
  // are actors now) and re-roll. Multiple unobserved months: only the
  // current one matters.
  let monthRolled = false;
  const calStart = calendarMonthStart(currentTime);
  const rolledOver =
    monthAnchorTime &&
    (calStart != null ? monthAnchorTime < calStart : currentTime - monthAnchorTime >= secondsPerMonth());
  // GUARD (critical): the month is due to roll, but rolling REPLACES the whole
  // shared market. If the availability tables are not loaded — the book link
  // that seeds them does not persist on a remote, and a world relaunch / GM
  // leaving / module update can leave the registry momentarily empty — the roll
  // would produce ZERO and persist an empty market over a full one ("values
  // disappear between loads"). Never roll on missing tables: keep the existing
  // market intact and retry on the next process (the Reload button forces it).
  const marketDue = !monthAnchorTime || rolledOver;
  if (marketDue && !hasDoc("availability")) {
    console.warn(`${MODULE_ID} | market roll deferred for "${location.name}": availability tables not loaded (book not re-imported?)`);
  }
  if (marketDue && hasDoc("availability")) {
    // Long-running adverts: postings that already existed when the ending
    // month began ran it in full — designate them; their searches ease one
    // rarity for the whole location while the advert stays up.
    if (rolledOver) {
      for (const p of postings) {
        if (p.status === "active" && !p.advertVeteran && (p.createdTime ?? Infinity) < monthAnchorTime) {
          p.advertVeteran = true;
          changed = true;
        }
      }
    }
    if (!monthAnchorTime) {
      monthAnchorTime = calStart ?? currentTime;
    } else if (calStart != null) {
      monthAnchorTime = calStart;
    } else {
      while (currentTime - monthAnchorTime >= secondsPerMonth()) monthAnchorTime += secondsPerMonth();
    }
    const month = await rollMonth(location, monthAnchorTime, currentTime);
    // Replaced directed results (monthLong) belong to the ENDED month and
    // expire with it; legacy private rows (pre-replacement model) persist
    // until their posting re-rolls.
    candidates = [...candidates.filter((c) => c.privateToUuid && !c.monthLong), ...month.candidates];
    marketRolls = month.marketRolls;
    changed = monthRolled = true;
    marketLog = marketLogAppend(
      marketLog,
      currentTime,
      "monthRoll",
      `anchor ${monthAnchorTime}: ${month.marketRolls.length} segments, ${month.candidates.length} candidates`
    );
  }
  // Optional RAW slavery (JJ 409): each fresh market month, remind the GM
  // what the slave market offers. Gated by setting + imported tables.
  // Best-effort: a card failure must never stall market processing.
  if (monthRolled) await postSlaveMarketCard(location).catch((err) => console.warn(`${MODULE_ID} | slave-market card failed`, err));
  // Keep active generic postings' info in sync with the current month.
  for (const posting of postings) {
    if (posting.status !== "active" || !posting.segment) continue;
    if (posting.segment === "henchman:*") {
      const hench = marketRolls.filter((r) => r.segment.startsWith("henchman:"));
      const anchor = hench[0]?.monthStartTime;
      if (hench.length && posting.monthStartTime !== anchor) {
        posting.monthStartTime = anchor;
        posting.totalAvailable = hench.reduce((s2, r) => s2 + (r.total ?? 0), 0);
        posting.rollDetail = hench.map((r) => `${r.segment.split(":")[1]}: ${r.total}`).join(", ");
        changed = true;
      }
      continue;
    }
    const entry = marketRolls.find((r) => r.segment === posting.segment);
    if (entry && posting.monthStartTime !== entry.monthStartTime) {
      posting.monthStartTime = entry.monthStartTime;
      posting.totalAvailable = entry.total;
      posting.rollDetail = entry.detail;
      changed = true;
    }
  }

  // 1. Arrivals: pending candidates whose week has come. (Pending rows are
  // GM-only information everywhere — players never see who hasn't arrived.)
  for (const c of candidates) {
    if (c.status === "pending" && c.availableFromTime <= currentTime) {
      c.status = "available";
      changed = true;
      const key = c.segment || c.privateToUuid || "private";
      arrivals.set(key, (arrivals.get(key) ?? 0) + (c.quantity ?? 1));
    }
  }

  // 1b. Weekly churn: a SHARED-pool candidate stays on the market for ONE
  // WEEK after arriving — unhired, they take other work and DISAPPEAR.
  // Exempt: directed-search results (privateToUuid — legacy) and REPLACED
  // candidates (monthLong): the person a recruiter's search found stays
  // available the whole month instead of the weekly rotation.
  const before = candidates.length;
  candidates = candidates.filter(
    (c) => !(c.status === "available" && !c.privateToUuid && !c.monthLong && currentTime - c.availableFromTime >= SECONDS_PER_WEEK)
  );
  if (candidates.length !== before) changed = true;

  // 1c. Special hires: expire entries past their time limit (GM entries
  // default to none; found recruits default to the market month's end).
  const specialHires = (sys.specialHires ?? []).map((s) => s.toObject?.() ?? foundry.utils.deepClone(s));
  for (const entry of specialHires) {
    if (entry.status === "available" && entry.expiresTime > 0 && currentTime >= entry.expiresTime) {
      entry.status = "expired";
      changed = true;
    }
  }

  // 2. Weekly fees per active posting (fee per week per type searched —
  // each posting pays its own ROLLED fee every week it runs). Per-posting
  // try/catch: one unpayable employer (deleted actor, permission on a
  // player-run pass) must never stall the whole board.
  for (const posting of postings) {
    if (posting.status !== "active") continue;
    try {
      const employerDoc = posting.employerUuid ? await fromUuid(posting.employerUuid).catch(() => null) : null;
      const employer = employerDoc?.actor ?? employerDoc;
      const weeksElapsed = Math.floor((currentTime - posting.createdTime) / SECONDS_PER_WEEK) + 1;
      const feesPaid = posting.feesPaid.length;
      for (let w = feesPaid; w < weeksElapsed; w++) {
        const fee = await chargeWeeklyFee(location, employer, w + 1);
        posting.feesPaid.push({ time: currentTime, gp: fee.gp });
        ledger.push({ time: currentTime, gp: fee.gp, postingId: posting.id, paidByUuid: posting.employerUuid });
        changed = true;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | weekly fee failed for posting ${posting.id}`, err);
    }
    posting.lastProcessedTime = currentTime;
  }

  // 3a. Directed searches re-roll monthly while active ("paying the fee and
  // rolling again each month") and apply as POOL REPLACEMENT against the
  // fresh month. Contending searches resolve MORE SPECIFIC FIRST (class+
  // level > class > class proficiency > general proficiency), random order
  // on ties; each consumes replacement targets before the next.
  const duePrivates = postings.filter((p) => {
    if (p.status !== "active" || !PRIVATE_KINDS.includes(p.spec.kind)) return false;
    return calStart != null ? p.monthStartTime < calStart : currentTime - p.monthStartTime >= secondsPerMonth();
  });
  duePrivates.sort(
    (a, b) =>
      specSpecificity(b.spec.toObject?.() ?? b.spec) - specSpecificity(a.spec.toObject?.() ?? a.spec) || Math.random() - 0.5
  );
  for (const posting of duePrivates) {
    try {
      const employerDoc = posting.employerUuid ? await fromUuid(posting.employerUuid).catch(() => null) : null;
      const employer = employerDoc?.actor ?? employerDoc;
      // This recruiter's previous directed results purge on re-roll. The
      // guard is CRITICAL: an employer-less posting ("" uuid) must never
      // match the shared pool's empty privateToUuid — that deleted the
      // whole fresh month (user report 2026-07-23, reproduced live).
      if (posting.employerUuid) candidates = candidates.filter((c) => c.privateToUuid !== posting.employerUuid);
      else candidates = candidates.filter((c) => !(c.monthLong && !c.privateToUuid && c.highlightFor === ""));
      const mc = effectiveMarketClass(location, employer);
      // Detached copy; a month-old advert re-rolls AS A COMMISSION (its own
      // rarity shifts one step toward common — the JJ mechanic).
      const spec = { ...(posting.spec.toObject?.() ?? posting.spec) };
      if (posting.advertVeteran) spec.commissioned = true;
      const result = await rollMonthlyPool(spec, mc, rollDice, Math.random, sys.classRarityTableId || "default");
      if (!result.error) {
        posting.totalAvailable = result.quantity;
        posting.rollDetail = result.detail;
        posting.monthStartTime = currentTime;
        const n = applyDirectedReplacement({
          location,
          spec,
          employerUuid: posting.employerUuid,
          quantity: result.quantity,
          rarity: result.rarity,
          candidates,
        });
        marketLog = marketLogAppend(
          marketLog,
          currentTime,
          "replace",
          `${result.detail || spec.kind}: ${n} of ${result.quantity} rolled replaced for ${employer?.name ?? "?"}`
        );
      }
      changed = true;
    } catch (err) {
      console.warn(`${MODULE_ID} | directed re-roll failed for posting ${posting.id}`, err);
    }
  }

  // (Shared-segment rollover is handled by the month anchor in step 0 —
  // the whole market re-rolls together at each month's start.)

  if (changed) {
    await location.update({
      "system.postings": postings,
      "system.candidates": candidates,
      "system.marketRolls": marketRolls,
      "system.monthAnchorTime": monthAnchorTime,
      "system.specialHires": specialHires,
      "system.searchLedger": ledger,
      "system.marketLog": marketLog,
    });
    for (const [segment, count] of arrivals) {
      Hooks.callAll(HOOKS.CANDIDATES_ARRIVED, { location, segment, count });
    }
  }
  return { changed, arrived: [...arrivals.values()].reduce((s, n) => s + n, 0) };
}

/**
 * Reload — RECOVER a market that reads empty because of a render / registry
 * error, not because it is genuinely empty. It does NOT roll or regenerate the
 * market: rolling is Process time's job, and there is one regenerate path, not
 * two.
 *
 * The imported ruledata persists as world data (acks-location), but a reload /
 * GM change / module update can leave the in-memory registry without it — which
 * blanks the market's labels and can throw the sheet's render, so the board
 * LOOKS empty though its candidates are still stored on the location actor.
 * This re-mirrors that persisted data back into the registry; the caller then
 * re-renders and the existing market and its labels reappear. Client-local and
 * side-effect-free on the location (no write), so any viewer may run it.
 *
 * @returns {Promise<{reloaded: object|null, tablesPresent: boolean}>}
 */
export async function reloadMarket() {
  const svc = globalThis.acksLib?.services?.get?.("ruledata-import");
  let reloaded = null;
  try {
    reloaded = (await svc?.reload?.()) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | ruledata reload failed`, err);
  }
  return { reloaded, tablesPresent: hasDoc("availability") };
}

/**
 * Close a posting (take a notice down). Players own their own posts but
 * cannot write the location actor, so non-GM calls relay through the GM
 * socket ("closePosting") — only the posting employer's owner or a GM may
 * close it.
 */
export async function closePosting(location, postingId, { requestUserId = null } = {}) {
  const postings = (location.system.postings ?? []).map((p) => p.toObject?.() ?? foundry.utils.deepClone(p));
  const posting = postings.find((p) => p.id === postingId);
  if (!posting) return { error: "no-posting" };
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    const employer = posting.employerUuid ? await fromUuid(posting.employerUuid).catch(() => null) : null;
    const employerActor = employer?.actor ?? employer;
    const allowed = user?.isGM || (employerActor && employerActor.testUserPermission(user, "OWNER"));
    if (!allowed) return { error: "not-yours" };
  }
  posting.status = "closed";
  await location.update({ "system.postings": postings });
  return { posting };
}

registerSocketAction("closePosting", async ({ locationUuid, postingId, requestUserId }) => {
  const location = await fromUuid(locationUuid);
  if (location) await closePosting(location.actor ?? location, postingId, { requestUserId });
});

/** Player posting creation relays through the GM (players cannot write the
 *  location actor); employer ownership + criteria are enforced in
 *  createPosting against requestUserId. */
registerSocketAction("createPosting", async ({ locationUuid, spec, employerUuid, playersSeeDetails, requestUserId }) => {
  const locationDoc = await fromUuid(locationUuid);
  const location = locationDoc?.actor ?? locationDoc;
  const employerDoc = employerUuid ? await fromUuid(employerUuid).catch(() => null) : null;
  if (!location) return;
  await createPosting(location, spec, employerDoc?.actor ?? employerDoc, { playersSeeDetails, requestUserId });
});

/** Process every location actor in the world (GM-side time hook target).
 *  Each location computes its own effective time (market offsets included). */
export async function processAllLocations() {
  const type = `${MODULE_ID}.location`;
  for (const actor of game.actors.filter((a) => a.type === type)) {
    try {
      await processLocation(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | processing ${actor.name} failed`, err);
    }
  }
}

