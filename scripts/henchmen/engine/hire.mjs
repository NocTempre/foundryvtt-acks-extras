/* global game, ui, foundry, Roll, Hooks, ChatMessage, Actor, CONST */
/**
 * Candidate rolling (feature 4 — record the results, generation is a future
 * module) and the hire pipeline.
 */
import { MODULE_ID, HOOKS, FLAG_RECORD } from "../constants.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import { optTable } from "../rules/tables.mjs";

/** Normalized package key: lowercase alphanumerics (matches the harvest). */
export const packageKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Availability specialist ids → harvested package keys (JJ 254-257). */
const SPECIALIST_PACKAGE_KEYS = Object.freeze({
  alchemist: ["alchemist"],
  animalTrainerCommon: ["animaltrainerdomestic"],
  animalTrainerWild: ["animaltrainerwild"],
  animalTrainerGiant: ["animaltrainergiant"],
  animalTrainerFantastic: ["animaltrainerfantastic"],
  armorer: ["armorer"],
  engineer: ["engineer"],
  healer: ["healer"],
  healerPhysicker: ["healerphysicker"],
  healerChirurgeon: ["healerchirugeon", "healerchirurgeon"],
  marinerNavigator: ["navigator"],
  marinerCaptain: ["shipcaptain"],
  sage: ["sage"],
  lawyer: ["lawyer"],
});
import { startingLoyalty, effectiveLoyalty } from "../rules/loyalty.mjs";
import { rollAttributes } from "../rules/candidates.mjs";
import { sumEffectModifiers, hasEffectFlag } from "../effects.mjs";
import * as adapter from "../acks-adapter.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { now } from "../time.mjs";

async function roll(formula) {
  return (await new Roll(formula).evaluate()).total;
}

/**
 * Ownership grant so the hireling is VISIBLE to whoever hired it: every
 * player who owns the employer actor becomes owner of the hireling.
 */
export function employerOwnership(employer) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return Object.fromEntries(
    Object.entries(employer?.ownership ?? {})
      .filter(([id, level]) => id !== "default" && level >= OWNER)
      .map(([id]) => [id, OWNER])
  );
}

/** The employer level the candidate was shown (RR 168 presented level). */
function claimedLevelFor(location, candidate, employer) {
  const postings = location.system.postings ?? [];
  const posting = postings.find(
    (p) =>
      p.status === "active" &&
      p.employerUuid === employer.uuid &&
      (candidate.privateToUuid ? !p.segment : p.segment === candidate.segment)
  );
  const presented = posting?.presentedLevel;
  return presented != null && presented !== adapter.getLevel(employer) ? presented : null;
}

/** Update one candidate record inside a location actor. */
export async function updateCandidate(location, candidateId, changes) {
  const candidates = (location.system.candidates ?? []).map((c) => {
    const obj = c.toObject?.() ?? foundry.utils.deepClone(c);
    return obj.id === candidateId ? foundry.utils.mergeObject(obj, changes) : obj;
  });
  await location.update({ "system.candidates": candidates });
  return candidates.find((c) => c.id === candidateId);
}

function getCandidate(location, candidateId) {
  const c = (location.system.candidates ?? []).find((x) => x.id === candidateId);
  return c ? (c.toObject?.() ?? foundry.utils.deepClone(c)) : null;
}

/** Update one special-hire entry on a location actor. */
export async function updateSpecialHire(location, specialHireId, changes) {
  const entries = (location.system.specialHires ?? []).map((s) => {
    const obj = s.toObject?.() ?? foundry.utils.deepClone(s);
    return obj.id === specialHireId ? foundry.utils.mergeObject(obj, changes) : obj;
  });
  await location.update({ "system.specialHires": entries });
  return entries.find((s) => s.id === specialHireId);
}

/**
 * Register a real actor as a special hire at a location. GM entries have no
 * time limit unless one is set; found recruits default to the end of the
 * current market month.
 */
export async function addSpecialHire(location, actor, { origin = "gm", expiresTime = null, notes = "" } = {}) {
  const { secondsPerMonth } = await import("../time.mjs");
  const anchor = location.system.monthAnchorTime || now();
  const defaultExpiry = origin === "found" ? anchor + secondsPerMonth() : 0;
  const entry = {
    id: foundry.utils.randomID(),
    actorUuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    addedTime: now(),
    expiresTime: expiresTime ?? defaultExpiry,
    origin,
    status: "available",
    refusals: [],
    notes,
  };
  await location.update({
    "system.specialHires": [...(location.system.specialHires ?? []).map((s) => s.toObject?.() ?? s), entry],
  });
  return entry;
}

/**
 * Hire an EXISTING actor (special hire): characters wire through the core
 * roster; monsters through the monster path. The record notes the origin.
 */
export async function hireExistingActor(location, specialHireId, employer, opts = {}) {
  const entry = (location.system.specialHires ?? []).find((s) => s.id === specialHireId);
  if (!entry) return { error: "no-candidate" };
  if (entry.status !== "available") return { error: "not-available" };
  const actor = await fromUuid(entry.actorUuid);
  const target = actor?.actor ?? actor;
  if (!target) return { error: "no-candidate" };

  let result;
  if (target.type === "monster") {
    const { hireMonster } = await import("./monster.mjs");
    result = await hireMonster(target, employer, { ...opts });
  } else {
    // Visibility: the hiring player(s) become owners of their new hireling.
    await target.update({ ownership: { ...target.ownership, ...employerOwnership(employer) } });
    const loyaltyStart = startingLoyalty({ base: opts.baseLoyalty ?? 0, elan: !!opts.elan });
    const wage = Number(target.system?.retainer?.wage) || henchmanWage(adapter.getWageLevel(target));
    await adapter.setRetainer(target, {
      enabled: true,
      loyalty: loyaltyStart,
      wage: String(wage),
      managerid: employer.id,
      category: opts.category ?? "henchman",
      quantity: 1,
    });
    try {
      await adapter.addHenchman(employer, target.id);
    } catch (err) {
      console.warn(`${MODULE_ID} | core addHenchman failed for special hire`, err);
    }
    const record = new HenchmanRecord({
      origin: entry.origin === "found" ? "adventure" : "manual",
      locationUuid: location.uuid,
      settlementName: location.name,
      employerUuid: employer.uuid,
      hiredTime: now(),
      terms: { wageGp: wage, wageBasis: "level", lastPaidTime: now(), signingBonusGp: opts.signingBonusGp ?? null },
      loyalty: { start: loyaltyStart, permanents: [] },
      morale: { base: adapter.getMorale(target) || 0, permanents: [] },
      counters: { calamities: 0, levelsGainedInService: 0, startLevel: adapter.getLevel(target) },
      special: { skipCalamityLoyalty: hasEffectFlag(employer, "skipCalamityLoyalty") },
    });
    await target.setFlag(MODULE_ID, FLAG_RECORD, record.toObject());
    await HenchmanRecord.logEvent(target, {
      type: "hired",
      note: game.i18n.format("ACKS-HENCHMEN.event.hiredNote", { employer: employer.name, location: location.name }),
    });
    await adapter.setLoyalty(
      target,
      effectiveLoyalty(record.toObject(), {
        chaLoyalty: adapter.getChaLoyalty(employer),
        baseLoyaltyBonus: sumEffectModifiers(employer, "baseLoyalty"),
      })
    );
    Hooks.callAll(HOOKS.HIRED, { employer, actor: target, location, record: record.toObject(), candidate: null });
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer });
    result = { actor: target };
  }
  if (!result?.error) {
    await updateSpecialHire(location, specialHireId, { status: "hired" });
    if (opts.signingBonusGp > 0) {
      await adapter.spendGold(
        employer,
        opts.signingBonusGp,
        game.i18n.format("ACKS-HENCHMEN.hire.signingBonusReason", { name: entry.name })
      );
    }
  }
  return result;
}

/**
 * Henchman-limit check for an employer: 4 + CHA (core cha.retain) + effect
 * bonuses (Leadership, Blood of Kings…), against core henchmenList + our
 * monster roster, minus record.special.noSlot members (follower companions).
 * @returns {{count:number, max:number, ok:boolean}}
 */
export function checkHenchmanLimit(employer) {
  const max = adapter.getRetainMax(employer);
  const ids = [
    ...adapter.getHenchmenIds(employer),
    ...(employer.getFlag(MODULE_ID, "monsterHenchmenList") ?? []),
  ];
  let count = 0;
  for (const id of ids) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    if (actor.system?.retainer?.category && actor.system.retainer.category !== "henchman") continue;
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD);
    if (record?.special?.noSlot) continue;
    count += 1;
  }
  return { count, max, ok: count < max };
}

/**
 * Hire a candidate: create the hireling actor, wire it into the core roster,
 * write the HenchmanRecord, compute and store effective loyalty.
 *
 * @param {Actor} location
 * @param {string} candidateId
 * @param {Actor} employer
 * @param {object} [opts] - { elan, irrefusable, signingBonusGp, baseLoyalty,
 *                            category, origin, skipLimit }
 * @returns {Promise<{actor: Actor}|{error: string}>}
 */
export async function hire(location, candidateId, employer, opts = {}) {
  const candidate = getCandidate(location, candidateId);
  if (!candidate) return { error: "no-candidate" };
  const okStatus = candidate.status === "available" || (opts.fromQueue && candidate.status === "reserved");
  if (!okStatus) return { error: "not-available" };

  // Attributes roll ONCE, at hire (3d6 ×6 in order, RR 168) — class and
  // level were fixed when the monthly pool was rolled.
  if (candidate.attributes?.str == null) {
    candidate.attributes = await rollAttributes(roll);
    await updateCandidate(location, candidateId, { attributes: candidate.attributes });
  }

  const category = opts.category ?? (candidate.kind === "mercenary" ? "mercenary" : candidate.kind === "specialist" ? "specialist" : "henchman");

  // Limit enforcement (setting-gated) — only true henchmen consume slots.
  if (category === "henchman" && !opts.skipLimit) {
    const mode = game.settings.get(MODULE_ID, "enforceHenchmanLimit");
    const limit = checkHenchmanLimit(employer);
    if (!limit.ok && mode !== "off") {
      const msg = game.i18n.format("ACKS-HENCHMEN.hire.limitReached", {
        name: employer.name,
        count: limit.count,
        max: limit.max,
      });
      if (mode === "block") {
        ui.notifications.error(msg);
        return { error: "limit" };
      }
      ui.notifications.warn(msg);
    }
  }

  const loyaltyStart = startingLoyalty({
    base: opts.baseLoyalty ?? 0,
    elan: !!opts.elan,
    irrefusable: opts.irrefusable ?? null,
  });

  // 1. Create the hireling actor with retainer fields pre-set so every guard
  //    in core addHenchman passes (actor.mjs:236-272).
  const actorData = {
    name: candidate.name || game.i18n.localize("ACKS-HENCHMEN.candidate.unnamed"),
    type: "character",
    ownership: employerOwnership(employer),
    prototypeToken: { actorLink: true },
    system: {
      retainer: {
        enabled: true,
        loyalty: loyaltyStart,
        wage: String(candidate.wageGp ?? ""),
        managerid: employer.id,
        category,
        quantity: candidate.quantity ?? 1,
      },
      details: {
        level: candidate.level ?? 0,
        age: candidate.age ?? undefined,
        class: candidate.classKey || candidate.occupation || "",
      },
    },
  };
  if (candidate.attributes?.str != null) {
    actorData.system.scores = {
      str: { value: candidate.attributes.str },
      int: { value: candidate.attributes.int },
      wis: { value: candidate.attributes.wil },
      dex: { value: candidate.attributes.dex },
      con: { value: candidate.attributes.con },
      cha: { value: candidate.attributes.cha },
    };
  }
  // Actor creation needs a permission the seat may not have (player hiring
  // with no GM online and no Create Actor grant) — callers turn this error
  // into a QUEUED hire that materializes at the next GM connect.
  let actor = null;
  try {
    actor = await Actor.create(actorData);
  } catch {
    actor = null;
  }
  if (!actor) return { error: "actor-create-denied" };

  // COMMIT the hire on the market FIRST: the actor exists, so the candidate
  // is taken. Everything after this (grants, roster link, record, loyalty)
  // is enrichment — a failure there must never leave a phantom "available"
  // candidate beside a real actor (found live 2026-07-23: an aborted
  // enrichment step made hiring look broken).
  await updateCandidate(location, candidateId, { status: "hired" });

  // Grant the candidate's proficiency package (JJ 254-257) as real ability
  // items via the lib `ability-provider` contract — the items' effects then
  // feed hiring/loyalty/obedience rolls automatically. 0th henchmen key by
  // occupation; specialists map their availability type onto the package
  // labels as printed (naming glue, code by rule — incl. the book's own
  // "chirugeon" spelling). Missing provider or tables degrades to no grants.
  try {
    const provider = globalThis.acksLib?.services?.get?.("ability-provider");
    const packs = optTable("people", "occupationPackages");
    const keys = candidate.occupation
      ? [packageKey(candidate.occupation), packageKey(String(candidate.occupation).replace(/\(.*$/, ""))]
      : (SPECIALIST_PACKAGE_KEYS[candidate.specialistType] ?? []);
    const pack = packs ? keys.map((k) => packs[k]).find(Boolean) : null;
    if (provider && pack?.length) {
      const { items, missing } = await provider.resolve(pack);
      if (items.length) await actor.createEmbeddedDocuments("Item", items);
      if (missing.length) console.warn(`${MODULE_ID} | unresolved proficiencies for ${actor.name}: ${missing.join(", ")}`);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | proficiency grant failed for ${actor.name}`, err);
  }

  // 2. Core roster (reuse, not reimplement).
  try {
    await adapter.addHenchman(employer, actor.id);
  } catch (err) {
    console.warn(`${MODULE_ID} | core addHenchman failed; roster link incomplete`, err);
  }

  // 3. Module record (enrichment — non-fatal; see the commit above).
  let record;
  try {
  record = new HenchmanRecord({
    origin: opts.origin ?? "market",
    locationUuid: location.uuid,
    settlementName: location.name,
    employerUuid: employer.uuid,
    hiredTime: now(),
    identity: {
      gender: candidate.gender ?? "",
      culture: candidate.culture ?? "",
      age: candidate.age ?? null,
      occupation: candidate.occupation ?? "",
      appearance: candidate.appearance ?? "",
    },
    rolled: {
      attributes: candidate.attributes ?? {},
      classKey: candidate.classKey ?? "",
      classRarity: candidate.classRarity ?? "",
      template: candidate.template ?? "",
      level: candidate.level ?? null,
      hpRoll: candidate.hpRoll ?? null,
      doubleD100: candidate.doubleD100 ?? [],
    },
    terms: {
      wageGp: candidate.wageGp ?? null,
      wageBasis: category === "mercenary" ? "mercenary" : category === "specialist" ? "specialist" : "level",
      signingBonusGp: opts.signingBonusGp ?? null,
      claimedEmployerLevel: claimedLevelFor(location, candidate, employer),
      lastPaidTime: now(),
    },
    loyalty: { start: loyaltyStart, permanents: [] },
    morale: { base: opts.baseMorale ?? 0, permanents: [] },
    counters: { calamities: 0, levelsGainedInService: 0, startLevel: candidate.level ?? 0 },
    special: {
      skipCalamityLoyalty: hasEffectFlag(employer, "skipCalamityLoyalty"),
      noSlot: !!opts.noSlot,
      irrefusableResult: opts.irrefusableOutcome ?? "",
    },
  });
  await actor.setFlag(MODULE_ID, FLAG_RECORD, record.toObject());
  await HenchmanRecord.logEvent(actor, {
    type: "hired",
    note: game.i18n.format("ACKS-HENCHMEN.event.hiredNote", { employer: employer.name, location: location.name }),
  });

  // 4. Effective loyalty (employer CHA + baseLoyalty effects) → core field so
  //    the system's own loyalty roll button shows the right score.
  const employerMods = {
    chaLoyalty: adapter.getChaLoyalty(employer),
    baseLoyaltyBonus: sumEffectModifiers(employer, "baseLoyalty"),
  };
  await adapter.setLoyalty(actor, effectiveLoyalty(record.toObject(), employerMods));
  } catch (err) {
    console.error(`${MODULE_ID} | hire enrichment failed for ${actor.name} (record/loyalty incomplete)`, err);
  }

  // 5. Market ledger (rollback record): who signed with whom, and when.
  try {
    const log = (location.system.marketLog ?? []).map((l) => l.toObject?.() ?? l);
    const entry = { time: now(), type: "hire", note: `${actor.name} → ${employer.name} (${candidate.wageGp ?? "?"}gp)` };
    const capped = [...log, entry].slice(-100);
    await location.update({ "system.marketLog": capped });
  } catch {
    /* ledger is best-effort */
  }
  if (opts.signingBonusGp > 0) {
    await adapter.spendGold(
      employer,
      opts.signingBonusGp,
      game.i18n.format("ACKS-HENCHMEN.hire.signingBonusReason", { name: actor.name })
    );
  }

  Hooks.callAll(HOOKS.HIRED, { employer, actor, location, record: record?.toObject?.() ?? null, candidate });
  Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer });
  ChatMessage.create({
    content: game.i18n.format("ACKS-HENCHMEN.hire.hiredChat", {
      name: actor.name,
      employer: employer.name,
      wage: candidate.wageGp ?? "?",
    }),
    speaker: ChatMessage.getSpeaker({ actor: employer }),
  });
  return { actor };
}
