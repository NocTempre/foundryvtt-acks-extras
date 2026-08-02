/* global game, ui, Hooks, ChatMessage */
/**
 * Monstrous henchmen (MM 351). Core `addHenchman` accepts only `character`
 * actors, and the core system stays as-is — so monster henchmen live on the
 * employer flag `monsterHenchmenList` and are merged into the roster by
 * RosterApp / checkHenchmanLimit. Monsters carry the shared `retainer`
 * schema natively, so wage/loyalty/manager fields work unchanged.
 */
import { MODULE_ID, HOOKS, FLAG_RECORD, FLAG_MONSTER_LIST } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import { startingLoyalty, effectiveLoyalty } from "../rules/loyalty.mjs";
import { collectStringFlags, sumEffectModifiers, toDialogModifiers, collectEffectModifiers } from "../effects.mjs";
import { getTable } from "../rules/tables.mjs";
import * as adapter from "../acks-adapter.mjs";
import { openThrowDialog } from "../apps/throw-dialog.mjs";
import { checkHenchmanLimit } from "./hire.mjs";
import { now } from "../time.mjs";

/** HD for recruitment/wages: acks-monsters extras when present, else parsed. */
export function monsterHd(monster) {
  return adapter.getWageLevel(monster);
}

/**
 * MM 351 validation: HD must be LESS than employer level; animals need an
 * unlocked recruit kind (Beast Friendship / Friends of Birds and Beasts).
 * @returns {{ok: boolean, warnings: string[], errors: string[]}}
 */
export function validateMonsterRecruit(monster, employer) {
  const errors = [];
  const warnings = [];
  const hd = monsterHd(monster);
  const level = adapter.getLevel(employer);
  if (hd >= level) {
    errors.push(game.i18n.format("ACKS-HENCHMEN.monster.hdCap", { hd, level }));
  }
  const kinds = collectStringFlags(employer, "recruitKinds");
  // Sapient monster types are open to everyone; animals are gated (MM 351).
  // Without acks-monsters typing we can't detect animals reliably — warn only.
  if (!kinds.size) {
    warnings.push(game.i18n.localize("ACKS-HENCHMEN.monster.animalGate"));
  }
  const limit = checkHenchmanLimit(employer);
  if (!limit.ok) {
    warnings.push(
      game.i18n.format("ACKS-HENCHMEN.hire.limitReached", { name: employer.name, count: limit.count, max: limit.max })
    );
  }
  return { ok: errors.length === 0, warnings, errors };
}

/**
 * Open the recruitment throw for a monster: the standard Reaction to Hiring
 * Offer when found peacefully/in a market, or the Irrefusable Offer when the
 * monster was defeated and captured (MM 351).
 */
export function recruitMonster(monster, employer, { captured = false } = {}) {
  const check = validateMonsterRecruit(monster, employer);
  for (const w of check.warnings) ui.notifications.warn(w);
  if (!check.ok) {
    for (const e of check.errors) ui.notifications.error(e);
    return;
  }
  const throwId = captured ? "irrefusableOffer" : "reactionToHiring";

  // The captured-monster offer is influence-hosted when available (apiVersion
  // 6+); the peaceful offer is an ordinary hiring reaction and already routes
  // through the hiring page elsewhere.
  if (captured) {
    try {
      const integration = globalThis.acksHenchmen?.integrations?.influence;
      if (integration?.hostsMoraleModes?.()) {
        integration.openIrrefusableViaInfluence({
          employer,
          monster,
          context: { actorUuid: monster.uuid, employerUuid: employer.uuid },
        });
        return;
      }
    } catch (err) {
      console.warn("acks-henchmen | influence-hosted irrefusable offer failed; falling back", err);
    }
  }

  const dynamicModifiers = toDialogModifiers(collectEffectModifiers(employer, "hiring"));
  openThrowDialog(throwId, {
    title: `${monster.name} — ${employer.name}`,
    actor: employer,
    derived: {
      chaMod: adapter.getChaMod(employer),
      monsterMorale: Math.max(0, adapter.getMorale(monster)),
      previousRefusals: 0,
      slanderCount: 0,
    },
    dynamicModifiers,
    infoText: game.i18n.format("ACKS-HENCHMEN.monster.info", {
      name: monster.name,
      hd: monsterHd(monster),
      wage: henchmanWage(monsterHd(monster)),
    }),
    onResolve: async (result) => {
      const outcome = result.outcome;
      Hooks.callAll(HOOKS.HIRING_OUTCOME, { monster, employer, result });
      if (captured) {
        const loyaltyOnHire = getTable("throws", "irrefusableOfferOutcomes").loyaltyOnHire ?? {};
        if (outcome === "betrayal" || outcome === "escape") {
          // The monster FEIGNS acceptance — hire it, but the GM knows.
          await hireMonster(monster, employer, { irrefusableOutcome: outcome, baseLoyalty: -4 });
        } else if (outcome in loyaltyOnHire) {
          await hireMonster(monster, employer, {
            irrefusableOutcome: outcome,
            irrefusable: loyaltyOnHire[outcome],
            elan: outcome === "acceptElan",
          });
        }
      } else if (outcome === "accept" || outcome === "acceptElan") {
        await hireMonster(monster, employer, { elan: outcome === "acceptElan" });
      }
    },
  });
}

/**
 * Wire an existing monster actor into the employer's service: retainer
 * fields on the monster, id onto the employer's monster list, HenchmanRecord
 * with HD-based wage (MM 351: substitute HD for level).
 */
export async function hireMonster(monster, employer, opts = {}) {
  const hd = monsterHd(monster);
  const wage = henchmanWage(hd);
  const loyaltyStart = startingLoyalty({
    base: opts.baseLoyalty ?? 0,
    elan: !!opts.elan,
    irrefusable: opts.irrefusable ?? null,
  });

  // Visibility: the hiring player(s) become owners of the monster hireling.
  const { employerOwnership } = await import("./hire.mjs");
  await monster.update({ ownership: { ...monster.ownership, ...employerOwnership(employer) } });

  await adapter.setRetainer(monster, {
    enabled: true,
    loyalty: loyaltyStart,
    wage: String(wage),
    managerid: employer.id,
    category: "henchman",
    quantity: 1,
  });

  const list = employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [];
  if (!list.includes(monster.id)) {
    await employer.setFlag(MODULE_ID, FLAG_MONSTER_LIST, [...list, monster.id]);
  }

  const record = new HenchmanRecord({
    origin: "adventure",
    employerUuid: employer.uuid,
    hiredTime: now(),
    terms: { wageGp: wage, wageBasis: "hd", lastPaidTime: now() },
    loyalty: { start: loyaltyStart, permanents: [] },
    morale: { base: adapter.getMorale(monster), permanents: [] },
    counters: { calamities: 0, levelsGainedInService: 0, startLevel: Math.floor(hd) },
    special: { irrefusableResult: opts.irrefusableOutcome ?? "" },
  });
  await monster.setFlag(MODULE_ID, FLAG_RECORD, record.toObject());
  await HenchmanRecord.logEvent(monster, {
    type: "hired",
    note: game.i18n.format("ACKS-HENCHMEN.monster.hiredNote", { employer: employer.name, hd }),
    outcome: opts.irrefusableOutcome ?? "",
  });

  // Effective loyalty incl. employer CHA/effects onto the core field.
  await adapter.setLoyalty(
    monster,
    effectiveLoyalty(record.toObject(), {
      chaLoyalty: adapter.getChaLoyalty(employer),
      baseLoyaltyBonus: sumEffectModifiers(employer, "baseLoyalty"),
    })
  );

  if (opts.irrefusableOutcome === "betrayal" || opts.irrefusableOutcome === "escape") {
    // GM-only truth: the acceptance is feigned.
    ChatMessage.create({
      content: game.i18n.format(`ACKS-HENCHMEN.monster.feigned.${opts.irrefusableOutcome}`, { name: monster.name }),
      whisper: adapter.gmIds(),
    });
  }
  ChatMessage.create({
    content: game.i18n.format("ACKS-HENCHMEN.hire.hiredChat", {
      name: monster.name,
      employer: employer.name,
      wage,
    }),
    speaker: ChatMessage.getSpeaker({ actor: employer }),
  });
  Hooks.callAll(HOOKS.HIRED, { employer, actor: monster, location: null, record: record.toObject(), candidate: null });
  Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer });
  return { actor: monster };
}
