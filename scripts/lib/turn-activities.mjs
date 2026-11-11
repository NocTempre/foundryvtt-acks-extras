/**
 * The turn plan's registry and its pure helpers: what a party member can spend a
 * stationary turn on, and the arithmetic of choosing it, counting it down and
 * resolving it (JJ ch. 2, Sequence of Play).
 *
 * A feature declares an activity with `registerTurnActivity`. The registry holds
 * the declaration and calls it back; it never knows what a search, a cast or a
 * harvest is. The plan is a plain object, `{[actorId]: entry}`, an entry being
 * `{key, option, remaining, turns, by, advancedTurn?, resolvedTurn?}`. Every
 * helper takes a plan and answers a new one, so the owner of the storage writes
 * the answer in one update and nothing here touches a document.
 *
 * A member with no entry keeps watch: that is the default, and it is no entry.
 * Rest is an activity like any other, registered by whoever owns it under
 * `REST_KEY`, and `partyRest` is the one place that says when the choices add up
 * to a rest.
 *
 * A length past one turn is a printed value, so the registry never supplies one:
 * `turns` answers the imported figure, or null for "not imported", and an option
 * whose length is null cannot be locked.
 *
 * `turn`, in `advanceTurn`, is any finite number the owner reads from its clock
 * once per turn: it differs from one turn to the next and is the same on a
 * repeat call for one turn. The helpers stamp it and compare it for equality,
 * nothing more. Which turn a use "this turn" belongs to is the owner's to say,
 * so `lockActivity` takes it as a predicate rather than reading the plan.
 *
 * Foundry-free. A registrant that throws is contained at every call: a gate that
 * throws refuses (never opens), an option list that throws offers nothing, a
 * resolution that throws is reported failed.
 */
import { MODULE_ID } from "./constants.mjs";

/** The key the party-rest decision looks for; whoever registers Rest registers it under this key. */
export const REST_KEY = "rest";

/** The paces an activity declares (JJ ch. 2, Sequence of Play). */
export const TURN_PACES = Object.freeze(["hasty", "methodical"]);

/**
 * The reason ids this module itself refuses with. A registrant's `blocked` adds
 * its own, so a consumer maps an id it does not know to a generic line rather
 * than assuming this list is closed.
 */
export const TURN_REASONS = Object.freeze({
  unknownActivity: "unknownActivity",
  unknownOption: "unknownOption",
  faulted: "faulted",
  alreadyUsed: "alreadyUsed",
  notImported: "notImported",
  unknownActor: "unknownActor",
});

/** Registered activities by key; a Map iterates in insertion order. */
const activities = new Map();

/**
 * Register an activity a member can spend a stationary turn on.
 *
 * A key already registered is replaced in place, keeping its position. The
 * registry outlives a window or a sheet: register once, at `init`. Fields the
 * registry does not name are kept on the stored declaration untouched.
 * @param {object} def
 * @param {string} def.key Names the activity; unique per feature.
 * @param {"hasty"|"methodical"} def.pace Carried, never interpreted.
 * @param {(actor: Actor, ctx: object) => object[]} def.options The choices this
 *   member has. Each is a plain object with an `id` (omitted for an activity's
 *   single choice) and anything else the registrant wants, notably
 *   `confirm: "judge"` for a choice the Judge confirms on the card. The registry
 *   passes an option through untouched.
 * @param {(actor: Actor, option: object, ctx: object) => number|null} def.turns
 *   The length in whole turns, a positive integer, or null when the figure is
 *   not imported. Any other answer reads as null; rounding a printed length to
 *   whole turns is the registrant's, who has read the page.
 * @param {(actor: Actor, option: object, ctx: object) => (string|{reason: string, missing?: string[]}|null)} [def.blocked]
 *   Why this member cannot take this choice now: a reason id, or `{reason,
 *   missing}` where `missing` names what the member lacks. Null or absent means
 *   free to take it.
 * @param {(actor: Actor, option: object, ctx: object) => *} def.resolve Runs the
 *   activity when its last turn ends; awaited by `resolveDue`.
 * @param {boolean} [def.oncePerTurn] A member who already used this activity this
 *   turn is refused a second (`lockActivity`'s `usedThisTurn` says who did).
 * @returns {() => boolean} Unregisters this declaration; a no-op once another
 *   declaration has replaced it under the key.
 */
export function registerTurnActivity(def = {}) {
  const { key, pace, options, turns, resolve } = def;
  if (typeof key !== "string" || !key) throw new TypeError("registerTurnActivity: an activity needs a key");
  if (!TURN_PACES.includes(pace)) {
    throw new TypeError(`registerTurnActivity: activity "${key}" needs a pace of ${TURN_PACES.join(" or ")}`);
  }
  for (const [name, fn] of [["options", options], ["turns", turns], ["resolve", resolve]]) {
    if (typeof fn !== "function") throw new TypeError(`registerTurnActivity: activity "${key}" needs an ${name} function`);
  }
  if (def.blocked != null && typeof def.blocked !== "function") {
    throw new TypeError(`registerTurnActivity: activity "${key}" has a blocked that is not a function`);
  }
  const stored = Object.freeze({ ...def, oncePerTurn: def.oncePerTurn === true });
  activities.set(key, stored);
  return () => (activities.get(key) === stored ? activities.delete(key) : false);
}

/**
 * One registered activity.
 * @param {string} key
 * @returns {object|null} the stored declaration, or null
 */
export function turnActivity(key) {
  return activities.get(key) ?? null;
}

/**
 * Every registered activity, in registration order.
 * @returns {object[]}
 */
export function listTurnActivities() {
  return [...activities.values()];
}

/** An option's id, with an omitted id read as null. */
const idOf = (option) => option?.id ?? null;

/** A registrant callback's answer, or `fallback` after logging a throw. */
function safely(def, what, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`${MODULE_ID} | turn activity "${def.key}" threw in ${what}`, err);
    return fallback;
  }
}

/** `blocked`'s answer as null or `{reason, missing}`; an answer of any other shape refuses as faulted. */
function normalizeBlocked(answer) {
  if (answer == null || answer === false) return null;
  if (typeof answer === "string" && answer) return { reason: answer, missing: [] };
  if (typeof answer.reason === "string" && answer.reason) {
    return { reason: answer.reason, missing: Array.isArray(answer.missing) ? [...answer.missing] : [] };
  }
  return { reason: TURN_REASONS.faulted, missing: [] };
}

/** A length as a positive whole number of turns, or null for anything else. */
function normalizeTurns(answer) {
  return Number.isInteger(answer) && answer > 0 ? answer : null;
}

/** What the member's choice of this option comes to: its length and whatever blocks it. */
function evaluate(def, actor, option, ctx) {
  const faulted = { reason: TURN_REASONS.faulted, missing: [] };
  let turns;
  try {
    turns = normalizeTurns(def.turns(actor, option, ctx));
  } catch (err) {
    console.error(`${MODULE_ID} | turn activity "${def.key}" threw in turns`, err);
    return { turns: null, blocked: faulted };
  }
  const blocked = def.blocked ? safely(def, "blocked", () => normalizeBlocked(def.blocked(actor, option, ctx)), faulted) : null;
  return { turns, blocked };
}

/** An activity's options for one member; one that throws or answers no array offers nothing. */
function optionsOf(def, actor, ctx) {
  const list = safely(def, "options", () => def.options(actor, ctx), []);
  return Array.isArray(list) ? list.filter((o) => o && typeof o === "object") : [];
}

/**
 * Everything this member could spend a turn on, as a column would list it.
 * @param {Actor} actor
 * @param {object} ctx Passed to every registrant callback.
 * @returns {{key: string, pace: string, oncePerTurn: boolean, option: object,
 *   turns: number|null, blocked: {reason: string, missing: string[]}|null}[]}
 *   one row per option, in registration order; `turns` null is "not imported"
 *   and `blocked` null is free to take. `option` is the registrant's object.
 */
export function offeredActivities(actor, ctx = {}) {
  const rows = [];
  for (const def of activities.values()) {
    for (const option of optionsOf(def, actor, ctx)) {
      rows.push({ key: def.key, pace: def.pace, oncePerTurn: def.oncePerTurn, option, ...evaluate(def, actor, option, ctx) });
    }
  }
  return rows;
}

/**
 * Lock a member's choice into the plan, replacing whatever they had chosen.
 *
 * Refuses, in this order: an unregistered activity, an option the member is not
 * offered, a blocked choice, a once-per-turn activity this member already used
 * this turn, a length that is not imported. Nothing is written on a refusal.
 * @param {object} plan
 * @param {object} request
 * @param {string} request.actorId Keys the entry.
 * @param {Actor} request.actor Passed to the registrant.
 * @param {string} request.key
 * @param {string|null} [request.option] The option's id; omitted for an activity's single choice.
 * @param {string} [request.by] Who locked it, kept on the entry.
 * @param {(actorId: string, key: string) => boolean} [request.usedThisTurn] Whether
 *   the member already used the activity this turn, by the owner's own reckoning
 *   of the turn: what the plan resolved and any use outside it. Asked only of an
 *   `oncePerTurn` activity; absent, nobody has used anything.
 * @param {object} [request.ctx] Passed to every registrant callback.
 * @returns {{ok: true, plan: object, entry: object}|{ok: false, reason: string, missing: string[]}}
 */
export function lockActivity(plan, { actorId, actor, key, option = null, by, usedThisTurn, ctx = {} } = {}) {
  const refuse = (reason, missing = []) => ({ ok: false, reason, missing });
  const def = turnActivity(key);
  if (!def) return refuse(TURN_REASONS.unknownActivity);
  const chosen = optionsOf(def, actor, ctx).find((o) => idOf(o) === (option ?? null));
  if (!chosen) return refuse(TURN_REASONS.unknownOption);
  const { turns, blocked } = evaluate(def, actor, chosen, ctx);
  if (blocked) return refuse(blocked.reason, blocked.missing);
  if (def.oncePerTurn && usedThisTurn?.(actorId, key)) return refuse(TURN_REASONS.alreadyUsed);
  if (turns == null) return refuse(TURN_REASONS.notImported, ["turns"]);
  const entry = { key, option: option ?? null, remaining: turns, turns, by: by ?? null };
  return { ok: true, plan: { ...plan, [actorId]: entry }, entry };
}

/**
 * Take a member's entry out of the plan, so they keep watch again.
 * @param {object} plan
 * @param {string} actorId
 * @returns {object} the plan without the entry; the same plan when there was none
 */
export function unlockActivity(plan, actorId) {
  if (!plan || !(actorId in plan)) return plan ?? {};
  const { [actorId]: _gone, ...rest } = plan;
  return rest;
}

/**
 * Count the plan down by one turn.
 *
 * Each entry loses a turn; one that reaches zero is due and is STAMPED
 * `resolvedTurn = turn` in the plan this returns. The owner writes that plan
 * before resolving anything, so a resolution that fails part-way is never
 * rolled twice: a stamped entry is done. A second call with the same `turn`
 * changes nothing (a counted entry carries `advancedTurn`, a stamped one its
 * stamp), and an entry stamped in any other turn is finished and leaves the plan.
 * Every due entry is stamped in this one pass, so an owner that stops part-way
 * through resolving leaves the entries it had not reached stamped and never run.
 * @param {object} plan
 * @param {number} turn A finite number, once per turn (see the file header); throws otherwise.
 * @returns {{plan: object, due: {actorId: string, entry: object}[],
 *   progressed: {actorId: string, entry: object}[]}} `due` are the stamped
 *   entries to resolve, `progressed` the multi-turn entries that have turns left.
 */
export function advanceTurn(plan, turn) {
  if (!Number.isFinite(turn)) throw new TypeError("advanceTurn: turn must be a finite number");
  const next = {};
  const due = [];
  const progressed = [];
  for (const [actorId, entry] of Object.entries(plan ?? {})) {
    if (entry.resolvedTurn != null) {
      if (entry.resolvedTurn === turn) next[actorId] = entry;
      continue;
    }
    if (entry.advancedTurn === turn) {
      next[actorId] = entry;
      continue;
    }
    const remaining = Math.max(0, entry.remaining - 1);
    const moved = { ...entry, remaining, advancedTurn: turn };
    if (remaining === 0) {
      moved.resolvedTurn = turn;
      due.push({ actorId, entry: moved });
    } else {
      progressed.push({ actorId, entry: moved });
    }
    next[actorId] = moved;
  }
  return { plan: next, due, progressed };
}

/**
 * Cancel what a combat interrupts: an unresolved entry locked for a single turn
 * is cancelled, a multi-turn entry keeps its progress. An entry already stamped
 * this turn is done and is in neither list.
 * @param {object} plan
 * @returns {{plan: object, cancelled: {actorId: string, entry: object}[],
 *   kept: {actorId: string, entry: object}[]}} the lists are what the one group
 *   note card names.
 */
export function cancelForCombat(plan) {
  const next = {};
  const cancelled = [];
  const kept = [];
  for (const [actorId, entry] of Object.entries(plan ?? {})) {
    if (entry.resolvedTurn != null) {
      next[actorId] = entry;
    } else if ((entry.turns ?? entry.remaining) <= 1) {
      cancelled.push({ actorId, entry });
    } else {
      next[actorId] = entry;
      kept.push({ actorId, entry });
    }
  }
  return { plan: next, cancelled, kept };
}

/**
 * Run each due entry's activity, in order, one at a time.
 *
 * An entry whose activity or option no longer exists, or whose member is gone,
 * is dropped, not failed: the thing it was working on is not there to resolve.
 * A resolve that throws is logged and reported failed; it never stops the rest.
 * @param {{actorId: string, entry: object}[]} due From `advanceTurn`.
 * @param {object} context
 * @param {(actorId: string) => Actor|null} context.actorOf
 * @param {object} [context.ctx] Passed to the registrant.
 * @returns {Promise<{actorId: string, key: string, option: string|null,
 *   status: "resolved"|"dropped"|"failed", reason?: string, result?: *, error?: *}[]>}
 */
export async function resolveDue(due, { actorOf, ctx = {} } = {}) {
  const out = [];
  for (const { actorId, entry } of due ?? []) {
    const base = { actorId, key: entry.key, option: entry.option ?? null };
    const def = turnActivity(entry.key);
    const actor = actorOf?.(actorId) ?? null;
    if (!def) {
      out.push({ ...base, status: "dropped", reason: TURN_REASONS.unknownActivity });
    } else if (!actor) {
      out.push({ ...base, status: "dropped", reason: TURN_REASONS.unknownActor });
    } else {
      const option = optionsOf(def, actor, ctx).find((o) => idOf(o) === base.option);
      if (!option) {
        out.push({ ...base, status: "dropped", reason: TURN_REASONS.unknownOption });
        continue;
      }
      try {
        out.push({ ...base, status: "resolved", result: await def.resolve(actor, option, ctx) });
      } catch (error) {
        console.error(`${MODULE_ID} | turn activity "${def.key}" threw in resolve`, error);
        out.push({ ...base, status: "failed", error });
      }
    }
  }
  return out;
}

/**
 * Whether this turn is a party rest (RR ch. 6, Rest and Recuperation).
 *
 * Every member who owes rest chose Rest, and at least one member chose it: a
 * party of members who owe none is not rested by nobody choosing. A member owes
 * rest unless `endures` says they have the endurance capability; a member's
 * choice counts whether or not they owed. Read before `advanceTurn`, while the
 * choices are still entries.
 * @param {object} plan
 * @param {string[]} actorIds The members who take part; down or absent ones are left out by the caller.
 * @param {object} [options]
 * @param {(actorId: string) => boolean} [options.endures] The capability, as a passed-in predicate.
 * @param {string} [options.restKey] Defaults to `REST_KEY`.
 * @returns {{rests: boolean, owing: string[], chose: string[], missing: string[]}}
 *   `owing` owe rest, `chose` chose Rest, `missing` owe it and did not choose it.
 */
export function partyRest(plan, actorIds, { endures = () => false, restKey = REST_KEY } = {}) {
  const ids = actorIds ?? [];
  const owing = ids.filter((id) => !endures(id));
  const chose = ids.filter((id) => plan?.[id]?.key === restKey && plan[id].resolvedTurn == null);
  const missing = owing.filter((id) => !chose.includes(id));
  return { rests: chose.length > 0 && missing.length === 0, owing, chose, missing };
}
