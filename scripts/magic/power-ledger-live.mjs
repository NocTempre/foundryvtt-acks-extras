/* global game, foundry, fromUuidSync, ui */
/**
 * The power ledger as the live world has it (`power-ledger.mjs` is the model):
 * the flag on the actor, the calendar's unit lengths, the imported lifetimes,
 * the write a seat makes or asks the GM's client to make, and the API the
 * ritual and sacrifice slices call. Magic owns the ledger; the classes feature
 * hosts its chip (`classes/power-chip.mjs`) and reads it through here.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_POWER, POWER_HANDLER } from "./constants.mjs";
import { POWER_KIND, POWER_KINDS, POWER_OP, POWER_ROW_PREFIX, powerOps, powerRow, kindOfRow, readLedger, nextExpiry, spanDays, chipModel, checkPowerRequest } from "./power-ledger.mjs";
import { readDivineLifetime, readArcaneLifetime } from "./research-tables.mjs";
import { dayOfWorldTime } from "../lib/world-time.mjs";

/** A string of the ledger's lang group. */
const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.power.${key}`, data ?? {});

/** A calendar figure as a number of at least one, else null. */
const figure = (n) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Number(n) : null);

/**
 * How many days each unit a lifetime may name is in the calendar the world runs:
 * a day is one, a year is the calendar's days per year, a month is that over its
 * months (whole days, rounded up, as core converts an effect's month) and a week
 * is the calendar's own list of weekdays. A unit the calendar cannot say is null,
 * so a lifetime in it never expires anything.
 */
export function calendarUnitDays(calendar = game.time?.calendar) {
  const year = figure(calendar?.days?.daysPerYear);
  const months = figure(calendar?.months?.values?.length);
  return {
    day: 1,
    week: Array.isArray(calendar?.days?.values) ? figure(calendar.days.values.length) : null,
    month: year && months ? Math.ceil(year / months) : null,
    year,
  };
}

/**
 * Both powers' lifetimes as the chip and the expiry read them: `{divine, arcane}`,
 * each `{span, lifetime, cite, byHand}`. Divine's `{count, unit}` is imported
 * whole. Arcane's page names the unit and no count, so its count is the ledger's
 * own (Judge-written, blank until set). `span` is whole days, or null where
 * nothing is imported, the count is blank or the calendar cannot say the unit.
 */
export function lifetimesFor(ledger, { lookup, calendar } = {}) {
  const units = calendarUnitDays(calendar);
  const divine = readDivineLifetime(lookup);
  const arcane = readArcaneLifetime(lookup);
  const arcaneSpan = arcane.lifetime ? { unit: arcane.lifetime.unit, count: ledger.arcane.count } : null;
  return {
    divine: { lifetime: divine.lifetime, span: spanDays(divine.lifetime, units), cite: divine.cite, byHand: divine.byHand },
    arcane: { lifetime: arcaneSpan, span: spanDays(arcaneSpan, units), cite: arcane.cite, byHand: arcane.byHand },
  };
}

/** The dependencies of `powerOps` as this client has them. */
export const liveDeps = () => ({
  read: (actor) => actor?.flags?.[MODULE_ID]?.[FLAG_POWER],
  write: (actor, kind, next) => actor.update({ [`flags.${MODULE_ID}.${FLAG_POWER}.${kind}`]: next }),
  // Whether Foundry lets this user write the actor, never whether the user owns it: a GM writes every actor.
  canWrite: (actor) => actor?.canUserModify?.(game.user, "update") === true,
  // Undefined with no GM to ask, which `powerOps` reports as not written.
  relay: async (request) => {
    if (game.user.isGM || !game.users.activeGM) return undefined;
    const { executeAsGM } = await import("../lib/sockets.mjs");
    return executeAsGM(POWER_HANDLER, request);
  },
  today: () => dayOfWorldTime(game.time.worldTime),
  isJudge: () => game.user.isGM === true,
  lifetime: (kind, ledger) => lifetimesFor(ledger)[kind].span,
  newId: () => foundry.utils.randomID(),
});

const ops = () => powerOps(liveDeps());

/** The actor's ledger, cleaned. */
export const ledgerOf = (actor) => readLedger(liveDeps().read(actor));

/**
 * The GM's client runs a request a seat could not write, after it checks who
 * sent it: the sender Foundry attested, never what the payload says.
 */
export async function powerHandler(payload = {}) {
  const { judgeDeclares } = await import("../lib/sockets.mjs");
  let actor = null;
  try {
    actor = payload.actorUuid ? fromUuidSync(payload.actorUuid) : null;
  } catch {
    actor = null;
  }
  const fromJudge = judgeDeclares(payload.requestUserId);
  const user = game.users.get(payload.requestUserId);
  const verdict = checkPowerRequest(payload, { actor, fromJudge, owns: fromJudge || actor?.testUserPermission?.(user, "OWNER") === true });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  return ops().apply(actor, payload.kind, payload.op, payload.args ?? {}, fromJudge);
}

let registered = false;

/** Register the ledger's relay handler. Once, at `init`. */
export function registerPower() {
  if (registered) return;
  registered = true;
  void import("../lib/sockets.mjs").then(({ registerHandler }) => registerHandler(POWER_HANDLER, powerHandler));
}

/** The chip's model for an actor, as the viewing user sees it. */
export function chipModelFor(actor) {
  const ledger = ledgerOf(actor);
  return chipModel({ ledger, today: liveDeps().today(), lifetimes: lifetimesFor(ledger), loc, judge: game.user.isGM === true });
}

/** Tell the user what a refused or short write came to. */
export function announce(result) {
  if (!result) return;
  if (result.ok === false) ui.notifications?.warn(loc(`refused.${result.reason}`));
  else if (result.warn) ui.notifications?.warn(loc(`warn.${result.warn}`));
}

/**
 * The ledger's API, `acksExtras.magic.power`: what the ritual and sacrifice
 * slices read and write. Every write answers `{ok, ...}`; a refusal is
 * `{ok: false, reason}` and a short Judge's spend is `{ok: true, warn: "short"}`.
 */
export const powerApi = {
  KIND: POWER_KIND,
  KINDS: POWER_KINDS,
  OP: POWER_OP,
  ROW_PREFIX: POWER_ROW_PREFIX,
  /** The actor's ledger, cleaned: `{divine: {entries}, arcane: {entries, count}}`. */
  read: ledgerOf,
  /** Both lifetimes as read now: `{divine, arcane}`, each `{span, lifetime, cite, byHand}`. */
  lifetimes: (actor) => lifetimesFor(ledgerOf(actor)),
  /** The whole power of a kind the actor holds today, expiry applied. */
  balance: (actor, kind) => ops().balance(actor, kind),
  /** The next power to fade: `{day, amount, inDays}`, or null when nothing fades. */
  expiry(actor, kind) {
    const ledger = ledgerOf(actor);
    return POWER_KINDS.includes(kind) ? nextExpiry(ledger[kind].entries, liveDeps().today(), lifetimesFor(ledger)[kind].span) : null;
  },
  /** Power gained: `gain(actor, kind, {amount, name, img, ref})`. */
  gain: (actor, kind, args) => ops().gain(actor, kind, args),
  /** Power spent: `spend(actor, kind, {amount, name, img, ref})`. */
  spend: (actor, kind, args) => ops().spend(actor, kind, args),
  /** A spend taken back by its entry id (the Judge's). */
  undo: (actor, kind, id) => ops().undo(actor, kind, id),
  /** The arcane lifetime's count, `null` to blank it (the Judge's). */
  setCount: (actor, count) => ops().setCount(actor, count),
  /** The bucket row for a power, capped by the balance; null when none is held. */
  row(actor, kind, { amount = 1, name, value = null, fit = "" } = {}) {
    return powerRow({ kind, name: name ?? loc(`kind.${kind}`), balance: ops().balance(actor, kind), amount, value, fit });
  },
  /** The kind a bucket's power row names, or null. */
  kindOfRow,
  /** Spend what a settlement handed back for a power row (`applySettlement`'s `handed`). */
  settle(actor, step, { name, img, ref } = {}) {
    const kind = kindOfRow(step?.uuid);
    if (!kind) return Promise.resolve({ ok: false, reason: "kind" });
    return ops().spend(actor, kind, { amount: step.qty, name, img, ref });
  },
};
