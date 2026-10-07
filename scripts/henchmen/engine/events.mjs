/* global game, ui, foundry, Hooks, ChatMessage, libWrapper */
/**
 * Loyalty & morale automation (RR 166-167).
 *
 * GM-prompt-first with secret rolls: watchers on the GM client detect
 * calamities (hp crossing ≤0 on a managed hireling) and level gains, then
 * whisper the GM an event card with [Roll Loyalty (secret)] / [Waive]
 * buttons (the `autoRollCalamity` setting collapses prompt→roll). Bookkeeping
 * lands in the HenchmanRecord ledgers; the resulting effective loyalty (base +
 * permanents + employer CHA + employer effects) is written back to core
 * `system.retainer.loyalty` so the system's own button agrees.
 *
 * Wages: every `daysPerMonth` of worldTime per hireling, a per-employer
 * whisper offers [Pay] / [Mark missed]; missed wages are calamities (RR 166).
 */
import { MODULE_ID, HOOKS, FLAG_RECORD, FLAG_MONSTER_LIST } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { effectiveLoyalty, effectiveMorale, loyaltyDeltaForOutcome, outcomeLeavesService, clampScore, reasonKey } from "../rules/loyalty.mjs";
import { henchmanWage, mercenaryWage } from "../rules/wages.mjs";
import { FLAG_GROUP_PAY } from "./hire-group.mjs";
import { GROUP_ACTOR_TYPE as GROUP_TYPE } from "../../lib/group-logic.mjs";
import { collectEffectModifiers, sumEffectModifiers, toDialogModifiers, hasEffectFlag } from "../effects.mjs";
import * as adapter from "../acks-adapter.mjs";
import { transferCoin } from "../../lib/money.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { resolveActorSync } from "../../lib/storage.mjs";
import { openThrowDialog } from "../apps/throw-dialog.mjs";
import { postEventCard, registerCardAction, postRevealCard } from "../chat/cards.mjs";
import { getSetting } from "../settings.mjs";
import { now, secondsPerMonth, onTimeAdvanced } from "../time.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

/* ------------------------- effective scores ------------------------- */

/** Employer-derived pieces of a hireling's loyalty. */
export function employerLoyaltyMods(employer) {
  if (!employer) return { chaLoyalty: 0, baseLoyaltyBonus: 0 };
  return {
    chaLoyalty: adapter.getChaLoyalty(employer),
    baseLoyaltyBonus: sumEffectModifiers(employer, "baseLoyalty"),
  };
}

/** Effective loyalty of a hireling actor (record + employer). */
export function effectiveLoyaltyFor(actor) {
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const employer = adapter.getManager(actor);
  return effectiveLoyalty(record, employerLoyaltyMods(employer));
}

/** Effective morale (record base+permanents, falling back to core morale). */
export function effectiveMoraleFor(actor) {
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const base = sumEffectModifiers(adapter.getManager(actor), "moraleBase");
  return clampScore(effectiveMorale(record, adapter.getMorale(actor)) + base);
}

/** Recompute and persist core retainer.loyalty from the record. */
export async function syncLoyalty(actor) {
  await adapter.setLoyalty(actor, effectiveLoyaltyFor(actor));
}

/** Append a permanent loyalty ledger entry and resync. */
export async function addLoyaltyPermanent(actor, delta, reason, note = "") {
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const permanents = [...(record.loyalty?.permanents ?? []), { time: now(), delta, reason, note, compensated: false }];
  await actor.setFlag(MODULE_ID, FLAG_RECORD, {
    ...record,
    loyalty: { ...(record.loyalty ?? { start: 0 }), permanents },
  });
  await syncLoyalty(actor);
  Hooks.callAll(HOOKS.LOYALTY_EVENT, { actor, delta, reason, note });
}

/**
 * Suspend or restore one ledger entry (RR 166: a wound or tampering penalty
 * applies only "while uncompensated"). The entry stays in the ledger and
 * simply stops counting toward the effective score, so it stays reversible.
 *
 * GM-only, enforced here and not only in the roster template: a hireling's
 * owner is usually the player, and loyalty is secret Judge information.
 * @param {Actor} actor
 * @param {object} opts
 * @param {"loyalty"|"morale"} [opts.track="loyalty"] - which ledger
 * @param {number} opts.index - position in that ledger's `permanents`
 * @param {boolean} [opts.compensated=true]
 * @returns {Promise<boolean>} whether anything changed
 */
export async function setPermanentCompensated(actor, { track = "loyalty", index, compensated = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.ledger.gmOnly"));
    return false;
  }
  if (track !== "loyalty" && track !== "morale") return false;
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const permanents = [...(record[track]?.permanents ?? [])];
  const entry = permanents[index];
  if (!entry || !!entry.compensated === !!compensated) return false;
  permanents[index] = { ...entry, compensated: !!compensated };
  await actor.setFlag(MODULE_ID, FLAG_RECORD, {
    ...record,
    [track]: { ...(record[track] ?? {}), permanents },
  });
  if (track === "loyalty") await syncLoyalty(actor);
  await HenchmanRecord.logEvent(actor, {
    type: "adjustment",
    note: game.i18n.format(compensated ? "ACKS-HENCHMEN.ledger.compensatedNote" : "ACKS-HENCHMEN.ledger.restoredNote", {
      delta: entry.delta > 0 ? `+${entry.delta}` : String(entry.delta ?? 0),
      reason: game.i18n.has(reasonKey(track, entry.reason))
        ? game.i18n.localize(reasonKey(track, entry.reason))
        : entry.reason || "",
    }),
  });
  Hooks.callAll(HOOKS.LOYALTY_EVENT, { actor, delta: entry.delta, reason: entry.reason, compensated: !!compensated });
  return true;
}

/* ------------------------- loyalty / obedience rolls ------------------------- */

/**
 * Apply a resolved Hireling Loyalty outcome: event log, permanent ±1
 * bookkeeping (Grudging/Fanatic), a departure card when the hireling
 * leaves service, and the LOYALTY_ROLLED hook. Shared by the module's
 * ThrowDialog and the influence-hosted loyalty page.
 */
export async function applyLoyaltyOutcome(actor, { outcome, total = null, note = "" } = {}) {
  const employer = adapter.getManager(actor);
  await HenchmanRecord.logEvent(actor, {
    type: "loyaltyRoll",
    note,
    rollTotal: total,
    outcome,
  });
  const delta = loyaltyDeltaForOutcome(outcome);
  if (delta !== 0) {
    await addLoyaltyPermanent(actor, delta, outcome === "fanatic" ? "fanatic" : "grudging");
  }
  if (outcomeLeavesService(outcome)) {
    await postEventCard({
      titleKey: "ACKS-HENCHMEN.card.leavesService",
      bodyKey: `ACKS-HENCHMEN.outcomeHint.${outcome}`,
      data: { name: actor.name },
      buttons: [
        { action: "dismissHireling", label: "ACKS-HENCHMEN.card.dismiss", icon: "fas fa-door-open", payload: { actorUuid: actor.uuid, outcome } },
      ],
      actor,
    });
  }
  Hooks.callAll(HOOKS.LOYALTY_ROLLED, { actor, employer, result: { outcome, total } });
}

/**
 * Open the secret Hireling Loyalty roll for a hireling — as an influence-
 * hosted page when acks-influence hosts the modes (consistent UI, tones
 * hidden), else the module's own ThrowDialog. Outcome bookkeeping applies
 * automatically either way.
 * @param {Actor} actor - the hireling
 * @param {object} [opts] - { reason, title }
 */
export function openLoyaltyRoll(actor, opts = {}) {
  const employer = adapter.getManager(actor);

  // RR 168 presented-level lie: once the hireling has cause to doubt, the
  // roll takes −1 per level of difference between what was CLAIMED at hire
  // and the truth — auto-applied, GM-overridable like every derived value.
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const claimed = record.terms?.claimedEmployerLevel;
  const apparentLevelDiff =
    claimed != null && employer ? Math.max(0, claimed - adapter.getLevel(employer)) : 0;

  // Influence-hosted page (loyalty is secret: open GM-side; the completion
  // hook routes back through applyLoyaltyOutcome via the integration).
  try {
    // Late import avoids a load-order cycle (integration imports this file).
    const integration = globalThis.acksExtras?.henchmen?.integrations?.influence;
    if (integration?.hostsModes?.()) {
      integration.openLoyaltyViaInfluence({
        employer,
        hireling: actor,
        effectiveLoyalty: effectiveLoyaltyFor(actor),
        apparentLevelDiff,
        context: { actorUuid: actor.uuid, reason: opts.reason ?? "" },
      });
      return;
    }
  } catch (err) {
    console.warn("acks-extras | influence-hosted loyalty open failed; falling back", err);
  }

  const dynamicModifiers = employer ? toDialogModifiers(collectEffectModifiers(employer, "loyaltyRoll")) : [];
  openThrowDialog("hirelingLoyalty", {
    title: opts.title ?? `${actor.name}${opts.reason ? ` (${opts.reason})` : ""}`,
    actor,
    derived: { effectiveLoyalty: effectiveLoyaltyFor(actor), apparentLevelDiff },
    dynamicModifiers,
    onResolve: (result) => applyLoyaltyOutcome(actor, { outcome: result.outcome, total: result.total, note: opts.reason ?? "" }),
  });
}

/** Open the secret Hireling Obedience throw (RR 167). */
export function openObedienceRoll(actor, opts = {}) {
  const employer = adapter.getManager(actor);

  // Influence-hosted page when available (apiVersion 6+), same as loyalty.
  try {
    const integration = globalThis.acksExtras?.henchmen?.integrations?.influence;
    if (integration?.hostsMoraleModes?.()) {
      integration.openObedienceViaInfluence({
        employer,
        hireling: actor,
        effectiveMorale: effectiveMoraleFor(actor),
        context: { actorUuid: actor.uuid, reason: opts.reason ?? "" },
      });
      return;
    }
  } catch (err) {
    console.warn("acks-extras | influence-hosted obedience open failed; falling back", err);
  }

  const dynamicModifiers = employer ? toDialogModifiers(collectEffectModifiers(employer, "obedienceRoll")) : [];
  // The employer's morale-modifier effects (Command, Battlefield Prowess…)
  // condition on presence/leadership — offered as toggles on the roll.
  if (employer) dynamicModifiers.push(...toDialogModifiers(collectEffectModifiers(employer, "henchmanMorale")));
  openThrowDialog("hirelingObedience", {
    title: opts.title ?? actor.name,
    actor,
    derived: { moraleScore: effectiveMoraleFor(actor) },
    dynamicModifiers,
    onResolve: (result) =>
      applyObedienceOutcome(actor, { outcome: result.outcome, total: result.total, note: opts.reason ?? "" }),
  });
}

/**
 * Apply an obedience result — log it, and on a refusal offer the "insist"
 * card (RR 167: insisting costs 1 permanent loyalty and forces a reroll).
 *
 * Shared by the module's own ThrowDialog and the influence-hosted page, so the
 * consequences do not depend on which UI produced the roll.
 */
export async function applyObedienceOutcome(actor, { outcome, total, note = "" } = {}) {
  await HenchmanRecord.logEvent(actor, { type: "obedienceRoll", note, rollTotal: total, outcome });
  if (outcome !== "refuses") return;
  await postEventCard({
    titleKey: "ACKS-HENCHMEN.card.refusesTitle",
    bodyKey: "ACKS-HENCHMEN.card.refusesBody",
    data: { name: actor.name },
    buttons: [
      { action: "insistOrder", label: "ACKS-HENCHMEN.card.insist", icon: "fas fa-gavel", payload: { actorUuid: actor.uuid } },
    ],
    actor,
  });
}

/* ------------------------- calamities ------------------------- */

/**
 * Record a calamity: counter +1, permanent −1 loyalty, event log; then a
 * loyalty roll (prompt or auto) unless the record skips calamity rolls
 * (crusader/bladedancer followers, Utter Domination).
 */
export async function recordCalamity(actor, note = "") {
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const counters = { ...(record.counters ?? {}), calamities: (record.counters?.calamities ?? 0) + 1 };
  await actor.setFlag(MODULE_ID, FLAG_RECORD, { ...record, counters });
  await HenchmanRecord.logEvent(actor, { type: "calamity", note });
  await addLoyaltyPermanent(actor, -1, "calamity", note);
  Hooks.callAll(HOOKS.CALAMITY, { actor, note });

  const skip = record.special?.skipCalamityLoyalty || hasEffectFlag(adapter.getManager(actor) ?? actor, "skipCalamityLoyalty");
  if (skip) {
    await postEventCard({
      titleKey: "ACKS-HENCHMEN.card.calamitySkip",
      data: { name: actor.name, note },
      actor,
    });
    return;
  }
  if (getSetting("autoRollCalamity")) {
    openLoyaltyRoll(actor, { reason: note || game.i18n.localize("ACKS-HENCHMEN.event.calamity") });
  } else {
    await postEventCard({
      titleKey: "ACKS-HENCHMEN.card.calamityTitle",
      bodyKey: "ACKS-HENCHMEN.card.calamityBody",
      data: { name: actor.name, note },
      buttons: [
        { action: "rollLoyaltySecret", label: "ACKS-HENCHMEN.card.rollLoyalty", icon: "fas fa-user-secret", payload: { actorUuid: actor.uuid, reason: note } },
        { action: "waiveCalamityRoll", label: "ACKS-HENCHMEN.card.waive", icon: "fas fa-hand", payload: { actorUuid: actor.uuid } },
      ],
      actor,
    });
  }
}

/* ------------------------- wages ------------------------- */

/** The live actors on an employer's roster: core's henchmen list, then this module's monster list. */
const rosterOf = (employer) =>
  [...adapter.getHenchmenIds(employer), ...(employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [])].map((id) => game.actors.get(id)).filter(Boolean);

/** The units an employer pays: the group actors whose `unit.employerUuid` names it. */
const unitsOf = (employer) => game.actors.filter((a) => a.type === GROUP_TYPE && a.system?.unit?.employerUuid === employer.uuid);

/**
 * The roster entries an employer pays a wage to, each with its record and
 * what a month of it costs. RAW: the FULL monthly wage (RR 168) — the agreed
 * wage, else the sheet's, else the ladder's for the hireling's level — ×
 * retainer quantity for troop-scale entries. A vassal's domain income covers
 * theirs, so a vassal is not listed.
 */
function wagedOf(employer) {
  const waged = [];
  for (const actor of rosterOf(employer)) {
    if (!adapter.isRetainer(actor)) continue;
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    if (record.terms?.vassalDomain) continue;
    const retainer = adapter.getRetainer(actor);
    const monthly =
      (Number(record.terms?.wageGp ?? retainer.wage) || henchmanWage(adapter.getWageLevel(actor))) *
      Math.max(1, Number(retainer.quantity) || 1);
    waged.push({ actor, record, monthly });
  }
  return waged;
}

/**
 * Managed hirelings of one employer whose wage month has elapsed, billed the
 * monthly wage × every whole month elapsed since the last payday — no weekly
 * division anywhere in wage payment.
 */
function dueHirelings(employer, currentTime) {
  const due = [];
  for (const { actor, record, monthly } of wagedOf(employer)) {
    const last = record.terms?.lastPaidTime ?? record.hiredTime;
    // No timestamp = a pre-existing henchman never enrolled; they owe nothing
    // until enrollNewcomers() starts their clock. See docs/henchmen/
    // DECISIONS.md, "Two repair macros retire into the code that made them
    // unnecessary".
    if (last == null) continue;
    const months = Math.floor((currentTime - last) / secondsPerMonth());
    if (months >= 1) due.push({ actor, record, months, monthly, amount: monthly * months, paidThrough: last + months * secondsPerMonth() });
  }
  return due;
}

/** A mercenary group's monthly wage (RR 168): every living body's troop wage,
 *  read from each stack's troop type. The officer is a lone retainer paid through
 *  the normal hireling cycle, not counted here. */
function groupMonthlyWage(group) {
  return (group.system?.stacks ?? []).reduce((sum, s) => {
    const each = mercenaryWage(s.template?.label) ?? 0;
    return sum + each * (s.size?.current ?? 0);
  }, 0);
}

/** The employer's paid GROUPS whose wage month has elapsed. A group is billed
 *  from its own actor (linked by `unit.employerUuid`), never `henchmenList`, so
 *  it costs no PC henchman-cap slot. */
function dueGroups(employer, currentTime) {
  const due = [];
  for (const group of unitsOf(employer)) {
    const monthly = groupMonthlyWage(group);
    if (monthly <= 0) continue;
    const pay = group.getFlag(MODULE_ID, FLAG_GROUP_PAY) ?? {};
    const last = pay.lastPaidTime;
    if (last == null) continue; // same epoch trap as dueHirelings — enrollNewcomers starts the clock
    const months = Math.floor((currentTime - last) / secondsPerMonth());
    if (months >= 1) {
      due.push({ isGroup: true, group, months, monthly, amount: monthly * months, paidThrough: last + months * secondsPerMonth() });
    }
  }
  return due;
}

/** Every entry a payday would bill `employer` at `currentTime`: hirelings, then units. */
const dueOf = (employer, currentTime) => [...dueHirelings(employer, currentTime), ...dueGroups(employer, currentTime)];

/**
 * What `employer`'s payroll costs, in gp: `due` is what `payWagesFor` would
 * bill now across `count` entries, and `monthly` what a month of the whole
 * payroll costs whether or not one has elapsed. Reads only, so a hireling
 * whose wage clock has not started is billed nothing.
 * @returns {{due: number, count: number, monthly: number}}
 */
export function wageBill(employer, currentTime = now()) {
  const due = dueOf(employer, currentTime);
  const monthly = wagedOf(employer).reduce((s, w) => s + w.monthly, 0) + unitsOf(employer).reduce((s, g) => s + groupMonthlyWage(g), 0);
  return { due: due.reduce((s, d) => s + d.amount, 0), count: due.length, monthly };
}

/** Missed wages sour a unit (RR 166): drop its morale by one, clamped. */
async function adjustGroupMorale(group, delta) {
  const cur = Number(group.system?.unit?.morale ?? 0);
  await group.update({ "system.unit.morale": Math.max(-6, Math.min(4, cur + delta)) });
}

/**
 * Adopt every managed hireling/group of `employer` the module has never
 * enrolled: anything with retainer.enabled and no lastPaidTime/hiredTime gets
 * its wage clock started from `currentTime`. Pre-existing henchmen paid
 * off-books before the module arrived owe nothing for that past — the first
 * wage prompt they appear in is one month from TODAY. Runs ahead of every
 * due computation and once at ready, and is idempotent.
 */
export async function enrollNewcomers(employer, currentTime = now()) {
  for (const actor of rosterOf(employer)) {
    if (!adapter.isRetainer(actor)) continue;
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    if (record.terms?.lastPaidTime != null || record.hiredTime != null) continue;
    await actor.setFlag(MODULE_ID, FLAG_RECORD, {
      ...record,
      hiredTime: currentTime,
      origin: record.origin ?? "adopted",
      terms: { ...(record.terms ?? {}), lastPaidTime: currentTime, arrearsGp: record.terms?.arrearsGp ?? 0 },
    });
    await HenchmanRecord.logEvent(actor, { type: "adopted" });
    console.log(`${MODULE_ID} | adopted pre-existing hireling "${actor.name}" — wage clock starts now.`);
  }
  for (const group of unitsOf(employer)) {
    const pay = group.getFlag(MODULE_ID, FLAG_GROUP_PAY) ?? {};
    if (pay.lastPaidTime != null) continue;
    await group.setFlag(MODULE_ID, FLAG_GROUP_PAY, { ...pay, lastPaidTime: currentTime, arrearsGp: pay.arrearsGp ?? 0 });
    console.log(`${MODULE_ID} | adopted pre-existing unit "${group.name}" — wage clock starts now.`);
  }
}

/** Every potential employer in the world (mirrors checkWagesDue's filter). */
export function allEmployers() {
  const anyGroups = game.actors.some((g) => g.type === GROUP_TYPE);
  return game.actors.filter(
    (a) =>
      a.type === ACTOR_TYPE.character &&
      !a.system?.retainer?.enabled &&
      (a.system?.henchmenList?.length ||
        (a.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? []).length ||
        (anyGroups && unitsOf(a).length)),
  );
}

/**
 * Repair: forgive the wage debts the module recorded — for worlds where the
 * epoch-billing bug (or plain fiction) left absurd arrears and unearned
 * calamities. Per hireling of `employer`: zero `terms.arrearsGp`, mark the
 * loyalty permanents recorded for missed wages (reason "calamity", the
 * missed-wages note) COMPENSATED so they stop scoring — the entries stay in
 * the ledger, visible and reversible from the roster, rather than being
 * deleted — decrement the calamity counter by those forgiven, and re-derive
 * effective loyalty. Groups get their arrears zeroed (their morale drop is
 * left to the GM — it may have been earned since). Other calamities (wounds,
 * deaths) are untouched, and re-running the repair is a no-op.
 */
export async function forgiveWageDebts(employer) {
  const wageNote = game.i18n.localize("ACKS-HENCHMEN.wage.missedCalamity");
  const summary = { hirelings: 0, arrearsGp: 0, calamities: 0, groups: 0 };
  for (const actor of rosterOf(employer)) {
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    const permanents = record.loyalty?.permanents ?? [];
    const isWagePenalty = (p) => p.reason === "calamity" && p.note === wageNote && !p.compensated;
    const forgiven = permanents.filter(isWagePenalty).length;
    const kept = permanents.map((p) => (isWagePenalty(p) ? { ...p, compensated: true } : p));
    const arrears = Number(record.terms?.arrearsGp ?? 0);
    if (!forgiven && !arrears) continue;
    await actor.setFlag(MODULE_ID, FLAG_RECORD, {
      ...record,
      terms: { ...(record.terms ?? {}), arrearsGp: 0 },
      loyalty: { ...(record.loyalty ?? {}), permanents: kept },
      counters: {
        ...(record.counters ?? {}),
        calamities: Math.max(0, Number(record.counters?.calamities ?? 0) - forgiven),
      },
    });
    await syncLoyalty(actor);
    await HenchmanRecord.logEvent(actor, { type: "wagesForgiven", note: arrears ? `${arrears} gp` : "" });
    summary.hirelings++;
    summary.arrearsGp += arrears;
    summary.calamities += forgiven;
  }
  for (const group of unitsOf(employer)) {
    const pay = group.getFlag(MODULE_ID, FLAG_GROUP_PAY) ?? {};
    const arrears = Number(pay.arrearsGp ?? 0);
    if (!arrears) continue;
    await group.setFlag(MODULE_ID, FLAG_GROUP_PAY, { ...pay, arrearsGp: 0 });
    summary.groups++;
    summary.arrearsGp += arrears;
  }
  return summary;
}

/** The documents a payday writes besides the employer: each managed hireling and each paid unit. */
const payrollOf = (employer) => [...rosterOf(employer).filter((a) => adapter.isRetainer(a)), ...unitsOf(employer)];

/**
 * Tell this seat's user what a payday did. One handed to no GM has already
 * said so. One refused whole is told only where another seat ran it
 * (`relayed`): a seat that ran its own has heard each refused transfer. The
 * refusal names its reason and the payees when the answer carries one the
 * wording knows, and says only that nothing was paid otherwise.
 */
function tellPayday(employer, result, { relayed = false } = {}) {
  const say = (level, key, data = {}) => ui.notifications[level](game.i18n.format(`ACKS-HENCHMEN.${key}`, { name: employer.name, ...data }));
  const gp = (n) => String(Number(Number(n ?? 0).toFixed(2)));
  switch (result?.status) {
    case "nothingDue":
      return say("info", "wage.nothingDue");
    case "insufficient":
      return say("warn", "gold.insufficient", { gp: result.total.toFixed(0), reason: game.i18n.format("ACKS-HENCHMEN.wage.reason", { count: result.count }) });
    case "notYours":
      return say("warn", "wage.notYours");
    case "refused": {
      if (!relayed) return undefined;
      const who = (result.payees ?? []).map((id) => game.actors.get(id)?.name).filter(Boolean);
      const why = `wage.refusedBecause.${result.reason}`;
      return who.length && game.i18n.has(`ACKS-HENCHMEN.${why}`) ? say("warn", why, { who: who.join(", ") }) : say("warn", "wage.refused");
    }
    case "paid":
      return say("info", result.arrears > 0 ? "wage.paidPartNote" : "wage.paidNote", { gp: gp(result.paid), owed: gp(result.arrears) });
    default:
      return undefined;
  }
}

/**
 * Pay all due wages for one employer and tell this seat's user what happened
 * (`runPayday`). A payday writes every hireling's record as well as the
 * employer's coin, so a seat that may not write them all hands it to the
 * GM's. Marking a month missed is the Judge's and is never handed over.
 */
export async function payWagesFor(employer, { markMissed = false } = {}) {
  const here = game.user.isGM || markMissed || [employer, ...payrollOf(employer)].every((a) => a.isOwner);
  const result = here ? await runPayday(employer, { markMissed }) : await executeAsGM("henchmenPayWages", { employerUuid: employer.uuid });
  tellPayday(employer, result, { relayed: !here });
}

// The relayed payday: the sender must own the employer, and the GM's seat
// runs it whole and answers what it did.
registerHandler("henchmenPayWages", async ({ employerUuid, requestUserId = null } = {}) => {
  const employer = resolveActorSync(employerUuid);
  if (!employer) return { status: "gone" };
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user || !employer.testUserPermission(user, "OWNER")) return { status: "notYours" };
  }
  return runPayday(employer);
});

/**
 * Hand core's `payWages` — what the system sheet's own Pay wages button
 * calls — to `payWagesFor`. Core's method takes coin off the employer's rows,
 * lands it on nobody and records no payday. libWrapper MIXED, registered by
 * this module nowhere else; the wrapped method is never called.
 */
export function installWagePayment() {
  if (typeof libWrapper === "undefined") return false;
  const onPayWages = function () {
    return this.type === ACTOR_TYPE.character ? payWagesFor(this) : undefined;
  };
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.payWages", onPayWages, "MIXED");
  return true;
}

/**
 * One employer's payday, run at a seat that may write every document it
 * touches: gold LEAVES the employer and LANDS on each hireling, as coin where
 * they keep it. Paid GROUPS are billed the same way (the unit's coin sits on
 * the group actor), and unpaid ones accrue arrears and lose morale. Nothing
 * is said here: the caller's seat tells its user from the result.
 * @returns {Promise<{status: "nothingDue"|"insufficient"|"refused"|"missed"|"paid",
 *   total?: number, count?: number, paid?: number, arrears?: number,
 *   reason?: string, payees?: string[]}>}
 *   `total` and `count` are what was billed when the purse fell short; `paid`
 *   is the gold that left the employer and `arrears` what was booked as owed;
 *   `payees` are the ids of the actors left unpaid when every transfer was
 *   refused, and `reason` the refusal they share, when they share one
 */
async function runPayday(employer, { markMissed = false } = {}) {
  const currentTime = now();
  await enrollNewcomers(employer, currentTime);
  const due = dueOf(employer, currentTime);
  if (!due.length) return { status: "nothingDue" };
  const total = due.reduce((s, d) => s + d.amount, 0);
  // Insufficient funds stops here rather than silently becoming "missed": no
  // payday recorded, no arrears, no calamity.
  if (!markMissed && adapter.getGold(employer) + 0.005 < total) return { status: "insufficient", total, count: due.length };
  // A refused transfer has said why and moved nothing: no payday is recorded,
  // the month stays due, and the hook reports neither the entry nor its gold.
  const refused = [];
  // A wage is paid in whole coins, so a payday can move less than it billed:
  // what moved and what was booked as owed instead are counted apart, in copper.
  let movedCp = 0;
  let bookedCp = 0;
  for (const d of due) {
    if (d.isGroup) {
      // A unit is paid as a body: its wage physically lands on the GROUP
      // actor's stacks (money always sits somewhere), representable coin
      // only — what no changer can split books as arrears alongside a missed
      // month's.
      const pay = d.group.getFlag(MODULE_ID, FLAG_GROUP_PAY) ?? {};
      if (markMissed) {
        await d.group.setFlag(MODULE_ID, FLAG_GROUP_PAY, {
          lastPaidTime: d.paidThrough,
          arrearsGp: (pay.arrearsGp ?? 0) + d.amount,
        });
        await adjustGroupMorale(d.group, -1);
      } else {
        const r = await transferCoin({ from: employer, to: d.group, gp: d.amount, upTo: true, reason: game.i18n.format("ACKS-HENCHMEN.wage.reason", { count: 1 }) });
        if (!r.ok) {
          refused.push({ amount: d.amount, id: d.group.id, reason: r.reason });
          continue;
        }
        const arrearsGp = (r.arrearsCp ?? 0) / 100;
        movedCp += r.paidCp ?? 0;
        bookedCp += r.arrearsCp ?? 0;
        await d.group.setFlag(MODULE_ID, FLAG_GROUP_PAY, {
          ...pay,
          lastPaidTime: d.paidThrough,
          ...(arrearsGp > 0 ? { arrearsGp: (pay.arrearsGp ?? 0) + arrearsGp } : {}),
        });
      }
      continue;
    }
    const { actor, record, amount, paidThrough } = d;
    if (markMissed) {
      await actor.setFlag(MODULE_ID, FLAG_RECORD, {
        ...record,
        terms: { ...(record.terms ?? {}), lastPaidTime: paidThrough, arrearsGp: (record.terms?.arrearsGp ?? 0) + amount },
      });
      await HenchmanRecord.logEvent(actor, { type: "wageMissed", note: `${amount} gp` });
      await recordCalamity(actor, game.i18n.localize("ACKS-HENCHMEN.wage.missedCalamity"));
    } else {
      // The transfer: the employer's coins land on the hireling. What the
      // purse cannot represent exactly — no changer in the wilderness — books
      // as arrears until one is found.
      const r = await transferCoin({ from: employer, to: actor, gp: amount, upTo: true, reason: game.i18n.format("ACKS-HENCHMEN.wage.reason", { count: 1 }) });
      if (!r.ok) {
        refused.push({ amount, id: actor.id, reason: r.reason });
        continue;
      }
      const paidGp = (r.paidCp ?? 0) / 100;
      const owedGp = (r.arrearsCp ?? 0) / 100;
      movedCp += r.paidCp ?? 0;
      bookedCp += r.arrearsCp ?? 0;
      await actor.setFlag(MODULE_ID, FLAG_RECORD, {
        ...record,
        terms: {
          ...(record.terms ?? {}),
          lastPaidTime: paidThrough,
          ...(owedGp > 0 ? { arrearsGp: (record.terms?.arrearsGp ?? 0) + owedGp } : {}),
        },
      });
      await HenchmanRecord.logEvent(actor, {
        type: "wagePaid",
        note: owedGp > 0
          ? game.i18n.format("ACKS-HENCHMEN.wage.paidPart", { gp: paidGp, owed: owedGp })
          : game.i18n.format("ACKS-HENCHMEN.wage.paid", { gp: paidGp }),
      });
    }
  }
  const count = due.length - refused.length;
  if (!count) {
    const reasons = [...new Set(refused.map((d) => d.reason))];
    return { status: "refused", ...(reasons.length === 1 && reasons[0] ? { reason: reasons[0] } : {}), payees: refused.map((d) => d.id) };
  }
  if (markMissed) {
    Hooks.callAll(HOOKS.WAGES_MISSED, { employer, total: total - refused.reduce((s, d) => s + d.amount, 0), count });
    return { status: "missed", count };
  }
  // `total` is the coin that left the employer; `arrears` what was booked as
  // owed because no whole coin could pay it.
  Hooks.callAll(HOOKS.WAGES_PAID, { employer, total: movedCp / 100, arrears: bookedCp / 100, count });
  return { status: "paid", paid: movedCp / 100, arrears: bookedCp / 100, count };
}

/** Whisper per-employer wages-due cards (time watcher). */
async function checkWagesDue(currentTime) {
  if (!getSetting("wageReminders")) return;
  for (const employer of allEmployers()) {
    await enrollNewcomers(employer, currentTime);
    // The same list and Σ amount Pay will bill, so the card can never promise
    // one figure and charge another.
    const due = dueOf(employer, currentTime);
    if (!due.length) continue;
    const total = due.reduce((s, d) => s + d.amount, 0);
    await postEventCard({
      titleKey: "ACKS-HENCHMEN.wage.dueTitle",
      bodyKey: "ACKS-HENCHMEN.wage.dueBody",
      data: { name: employer.name, count: due.length, total },
      buttons: [
        { action: "payWages", label: "ACKS-HENCHMEN.wage.pay", icon: "fas fa-coins", payload: { employerUuid: employer.uuid } },
        { action: "missWages", label: "ACKS-HENCHMEN.wage.markMissed", icon: "fas fa-ban", payload: { employerUuid: employer.uuid } },
      ],
      actor: employer,
    });
    // lastPaidTime is set only on GM action, so a repeat reminder needs
    // another full month elapsed.
  }
}

/* ------------------------- watchers ------------------------- */

function isManagedHireling(actor) {
  return actor?.type !== undefined && adapter.isRetainer(actor) && !!adapter.getManager(actor);
}

async function onUpdateActor(actor, changes) {
  if (game.user !== game.users.activeGM) return;
  if (!isManagedHireling(actor)) return;

  // --- Calamity: hp crossing to ≤ 0 (guarded against healing yo-yos) ---
  const newHp = foundry.utils.getProperty(changes, "system.hp.value");
  if (newHp !== undefined) {
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    const pending = record.special?.pendingCalamity ?? false;
    if (newHp <= 0 && !pending) {
      await actor.setFlag(MODULE_ID, FLAG_RECORD, {
        ...record,
        special: { ...(record.special ?? {}), pendingCalamity: true },
      });
      await recordCalamity(actor, game.i18n.localize("ACKS-HENCHMEN.card.downedNote"));
    } else if (newHp > 0 && pending) {
      await actor.setFlag(MODULE_ID, FLAG_RECORD, {
        ...record,
        special: { ...(record.special ?? {}), pendingCalamity: false },
      });
    }
  }

  // --- Level gain: +1 permanent loyalty and a loyalty roll (RR 166) ---
  const newLevel = foundry.utils.getProperty(changes, "system.details.level");
  if (newLevel !== undefined) {
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    const startLevel = record.counters?.startLevel ?? 0;
    const known = startLevel + (record.counters?.levelsGainedInService ?? 0);
    if (newLevel > known) {
      const counters = {
        ...(record.counters ?? {}),
        levelsGainedInService: (record.counters?.levelsGainedInService ?? 0) + (newLevel - known),
      };
      let morale = record.morale ?? { base: 0, permanents: [] };
      // Permanent morale bumps: 0th → first level, and reaching 5th (RR 166).
      const bumps = [];
      if (known === 0 && newLevel >= 1) bumps.push({ time: now(), delta: 1, reason: "firstLevel", note: "", compensated: false });
      if (known < 5 && newLevel >= 5) bumps.push({ time: now(), delta: 1, reason: "fifthLevel", note: "", compensated: false });
      if (bumps.length) morale = { ...morale, permanents: [...(morale.permanents ?? []), ...bumps] };
      await actor.setFlag(MODULE_ID, FLAG_RECORD, { ...record, counters, morale });
      await addLoyaltyPermanent(actor, newLevel - known, "levelGain");
      await postEventCard({
        titleKey: "ACKS-HENCHMEN.card.levelGainTitle",
        bodyKey: "ACKS-HENCHMEN.card.levelGainBody",
        data: { name: actor.name, level: newLevel },
        buttons: [
          { action: "rollLoyaltySecret", label: "ACKS-HENCHMEN.card.rollLoyalty", icon: "fas fa-user-secret", payload: { actorUuid: actor.uuid, reason: game.i18n.localize("ACKS-HENCHMEN.loyaltyReason.levelGain") } },
        ],
        actor,
      });
    }
  }
}

/* ------------------------- registration ------------------------- */

export function registerEventEngine() {
  Hooks.on("updateActor", (actor, changes) => {
    onUpdateActor(actor, changes).catch((err) => console.error(`${MODULE_ID} | event watcher failed`, err));
  });
  onTimeAdvanced((worldTime) => checkWagesDue(worldTime));

  registerCardAction("rollLoyaltySecret", async ({ actorUuid, reason }) => {
    const actor = await fromUuid(actorUuid);
    if (actor) openLoyaltyRoll(actor, { reason });
  });
  registerCardAction("waiveCalamityRoll", async ({ actorUuid }) => {
    const actor = await fromUuid(actorUuid);
    if (actor) await HenchmanRecord.logEvent(actor, { type: "adjustment", note: game.i18n.localize("ACKS-HENCHMEN.card.waived") });
  });
  registerCardAction("insistOrder", async ({ actorUuid }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) return;
    await addLoyaltyPermanent(actor, -1, "insistence");
    openObedienceRoll(actor, { reason: game.i18n.localize("ACKS-HENCHMEN.card.insisted") });
  });
  registerCardAction("payWages", async ({ employerUuid }) => {
    const employer = await fromUuid(employerUuid);
    if (employer) await payWagesFor(employer);
  });
  registerCardAction("missWages", async ({ employerUuid }) => {
    const employer = await fromUuid(employerUuid);
    if (employer) await payWagesFor(employer, { markMissed: true });
  });
  registerCardAction("dismissHireling", async ({ actorUuid, outcome }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) return;
    const employer = adapter.getManager(actor);
    await HenchmanRecord.logEvent(actor, { type: "dismissed", note: outcome ?? "" });
    if (employer) {
      try {
        await adapter.delHenchman(employer, actor.id);
      } catch (err) {
        console.warn(`${MODULE_ID} | delHenchman failed`, err);
      }
      Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer });
    }
  });
}
