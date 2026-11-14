/* global game, ui, Hooks, ChatMessage */
/**
 * Monstrous henchmen (MM 351). Core `addHenchman` accepts only `character`
 * actors, so monster henchmen live on the employer flag `monsterHenchmenList`
 * and are merged into the roster by RosterApp / checkHenchmanLimit. Monsters
 * carry the shared `retainer` schema, so wage, loyalty and manager fields apply.
 */
import { MODULE_ID, HOOKS, FLAG_RECORD } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import { startingLoyalty, effectiveLoyalty } from "../rules/loyalty.mjs";
import { collectStringFlags, sumEffectModifiers, toDialogModifiers, collectEffectModifiers, unvaluedDialogModifiers } from "../effects.mjs";
import { hiringOffer } from "../rules/hiring-offer.mjs";
import { IRREFUSABLE, irrefusableOutcomes, irrefusableStart, oppositeAlignmentFigure } from "../rules/irrefusable.mjs";
import { elanFigure, originText } from "./events.mjs";
import * as adapter from "../acks-adapter.mjs";
import { openThrowDialog } from "../apps/throw-dialog.mjs";
import { checkHenchmanLimit, limitReachedMessage } from "./hire.mjs";
import { now } from "../time.mjs";
import { assignMonsterEmployer } from "./monster-employer.mjs";

/** HD for recruitment/wages: monster extras when present, else parsed. */
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
  // Animals are gated (MM 351) but not reliably detectable, so this only warns.
  if (!kinds.size) {
    warnings.push(game.i18n.localize("ACKS-HENCHMEN.monster.animalGate"));
  }
  const limit = checkHenchmanLimit(employer);
  if (!limit.ok) warnings.push(limitReachedMessage(employer, limit));
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

  // The captured-monster offer is influence-hosted when available (apiVersion 6+).
  if (captured) {
    try {
      const integration = globalThis.acksExtras?.henchmen?.integrations?.influence;
      if (integration?.hostsMoraleModes?.()) {
        integration.openIrrefusableViaInfluence({
          employer,
          monster,
          context: { actorUuid: monster.uuid, employerUuid: employer.uuid },
        });
        return;
      }
    } catch (err) {
      console.warn("acks-extras | influence-hosted irrefusable offer failed; falling back", err);
    }
  }

  // The peaceful offer needs the imported hiring table; with none, the throw does not open.
  const printed = captured ? null : hiringOffer();
  if (!captured && !printed.outcomes) return;
  // The captured offer's outcomes and opposite-alignment figure are imported; unread, the throw rolls, names no result and hires nothing.
  let irrefusable = {};
  if (captured) {
    const outcomes = irrefusableOutcomes();
    const opposite = oppositeAlignmentFigure();
    irrefusable = {
      ...(outcomes ? { outcomes } : {}),
      stepValues: opposite === null ? {} : { oppositeAlignment: opposite },
      figureTips: { oppositeAlignment: originText(IRREFUSABLE, opposite !== null) },
    };
  }
  const dynamicModifiers = [...toDialogModifiers(collectEffectModifiers(employer, "hiring")), ...unvaluedDialogModifiers(employer, "hiring")];
  openThrowDialog(throwId, {
    ...(printed
      ? { outcomes: printed.outcomes, stepValues: { previousRefusals: printed.refusalPenalty, slander: printed.slanderPenalty } }
      : irrefusable),
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
        await applyIrrefusableOutcome(monster, employer, outcome);
      } else if (outcome === "accept" || outcome === "acceptElan") {
        await hireMonster(monster, employer, { elan: outcome === "acceptElan" });
      }
    },
  });
}

/**
 * Hire a captured monster on its Irrefusable Offer result (MM 351), at the
 * imported start `irrefusableStart` gives it; a feigned acceptance is still
 * hired, and the GM is told. Nothing is hired for a roll that named no
 * result, or a result whose start is not imported.
 * @returns {Promise<{actor: Actor}|null>}
 */
export async function applyIrrefusableOutcome(monster, employer, outcome) {
  const start = irrefusableStart(outcome);
  if (!start) return null;
  if (start.figure === null) return null;
  return hireMonster(monster, employer, { irrefusableOutcome: outcome, irrefusable: start.figure, startOrigin: originText(start) });
}

/**
 * Wire an existing monster actor into the employer's service: retainer
 * fields on the monster, id onto the employer's monster list, HenchmanRecord
 * with HD-based wage (MM 351: substitute HD for level).
 */
export async function hireMonster(monster, employer, opts = {}) {
  const hd = monsterHd(monster);
  const wage = henchmanWage(hd);
  // An Irrefusable Offer start is the whole start: no élan figure rides on it.
  const loyaltyStart = startingLoyalty({
    base: opts.baseLoyalty ?? 0,
    elan: opts.irrefusable == null ? elanFigure(monster.name, opts.elan) : 0,
    irrefusable: opts.irrefusable ?? null,
    bounds: adapter.loyaltyBounds(monster.type),
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
  // After the record, which already names the new employer.
  const { previous } = await assignMonsterEmployer(monster, employer);
  await HenchmanRecord.logEvent(monster, {
    type: "hired",
    note: [game.i18n.format("ACKS-HENCHMEN.monster.hiredNote", { employer: employer.name, hd }), opts.startOrigin].filter(Boolean).join(" · "),
    outcome: opts.irrefusableOutcome ?? "",
  });

  // Effective loyalty incl. employer CHA/effects onto the core field.
  await adapter.setLoyalty(
    monster,
    effectiveLoyalty(
      record.toObject(),
      {
        chaLoyalty: adapter.getChaLoyalty(employer),
        baseLoyaltyBonus: sumEffectModifiers(employer, "baseLoyalty"),
      },
      adapter.loyaltyBounds(monster.type)
    )
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
  for (const former of previous) Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: former });
  return { actor: monster };
}
