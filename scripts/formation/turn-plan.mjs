/* global game, foundry, ChatMessage */
/**
 * The turn plan on the table: what each party member spends a stationary
 * dungeon turn on (JJ ch. 2, Sequence of Play, the Delve stage's first step).
 *
 * Storage is the party actor's `flags["acks-extras"].turnPlan`, lib's plan shape
 * (`lib/turn-activities.mjs`): one entry per member, no entry meaning the member
 * keeps watch. Only a GM client writes it; a player's lock is the `plan` request
 * (`player-requests.mjs`), and the refusal they see is computed on their own
 * client from the same registrations, so those register on every client at init.
 *
 * The formation registers the delve's own activities (RR ch. 6): the two
 * searches, listening and bashing as group checks rolled once per turn on one
 * card for the members who chose them; the two Trapbreaking columns against a
 * trap the party has found; battering; and Rest. Each answers a length of one
 * turn except battering, whose length is not imported (ROADMAP §6), so it
 * cannot lock.
 *
 * The Advance turn and Rest presses resolve the plan (`resolvePlanTurn`), in
 * `runPlanTurn`'s order: the clock spends the turn once and every roll after it
 * is made with `spend: false`. A move cancels the open entries
 * (`cancelPlanForMove`); a fight cancels the single-turn ones and keeps the
 * multi-turn ones' progress, on one card (`cancelPlanForCombat`).
 */
import { MODULE_ID } from "./constants.mjs";
import { makeLoc, unset } from "../lib/util.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import {
  REST_KEY,
  cancelForCombat,
  offeredActivities,
  partyRest,
  registerTurnActivity,
  turnActivity,
  unlockActivity,
} from "../lib/turn-activities.mjs";
import { cancelForMove, lockForMember, memberBlock, queueGroup, runPlanTurn } from "./turn-plan-logic.mjs";
import { getFormation, getMemberActor, getPartyActor, isDown, isHurried, realMembers } from "./formation-model.mjs";
import { PARTY_CHECKS, resolveCheck, rollPartyCheck } from "./party-rolls.mjs";
import { advanceTurns, hasEndurance, postNotesCard } from "./turn-engine.mjs";
import { attemptDisarm, disarmRefusal, knownPlacementsNear } from "./trap-zone.mjs";

/** The party actor's flag holding the plan. */
export const PLAN_FLAG = "turnPlan";

const loc = makeLoc("ACKS-FORMATION");

/** The delve's group checks: the activity key is the `PARTY_CHECKS` key it rolls. */
const GROUP_CHECKS = Object.freeze({
  searchHasty: "hasty",
  searchMethodical: "methodical",
  listen: "hasty",
  dungeonbashing: "hasty",
});

/** The two Trapbreaking columns, by activity key. */
const TRAPBREAKS = Object.freeze({ trapbreakHasty: "hasty", trapbreakMethodical: "methodical" });

/** The activity battering a door down registers under. */
export const BATTER_KEY = "batter";

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/** The stored plan, as a copy the caller may change; `{}` with no party actor or no plan. */
export function readPlan(formation) {
  const raw = getPartyActor(formation)?.getFlag?.(MODULE_ID, PLAN_FLAG);
  return raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : {};
}

/**
 * Write the plan whole. A plain update merges, so an entry the new plan lacks
 * would survive it: the flag is replaced outright, and an empty plan removes it.
 * Nothing is written when the plan is unchanged.
 * @returns {Promise<boolean>} whether a write was made
 */
async function writePlan(formation, plan) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user.isGM) return false;
  const before = actor.getFlag(MODULE_ID, PLAN_FLAG) ?? {};
  if (JSON.stringify(before) === JSON.stringify(plan ?? {})) return false;
  const update = Object.keys(plan ?? {}).length
    ? { [`flags.${MODULE_ID}.${PLAN_FLAG}`]: foundry.data.operators.ForcedReplacement.create(plan) }
    : { [`flags.${MODULE_ID}.${PLAN_FLAG}`]: unset() };
  await actor.update(update);
  return true;
}

/* -------------------------------------------- */
/*  The formation's activities                  */
/* -------------------------------------------- */

/** The record of an actor in the party, or null. */
const memberOf = (formation, actorId) => realMembers(formation).find((m) => m.actorId === actorId) ?? null;

/**
 * Whether a member already used a once-per-turn activity this turn, outside
 * the plan. Listening is limited only while the party moves (RR ch. 6), which
 * a move already refuses, so this holds the party check's own mark.
 */
const usedThisTurn = (formation) => (_actorId, key) =>
  key === "listen" && !!formation.clock?.movedThisTurn && formation.clock.lastListenTurn === formation.clock.turnsTotal;

/** Register a party check the members who chose it roll together. */
function registerGroupCheck(checkKey, pace) {
  const cfg = PARTY_CHECKS[checkKey];
  registerTurnActivity({
    key: checkKey,
    pace,
    label: cfg.label,
    oncePerTurn: !!cfg.oncePerTurn,
    options: () => [{}],
    turns: () => 1,
    blocked: (actor, _option, ctx) => {
      if (cfg.blockedWhenHurried && ctx.formation && isHurried(ctx.formation)) return "hurried";
      return resolveCheck(actor, cfg) ? null : "noThrow";
    },
    resolve: (actor, _option, ctx) => queueGroup(ctx, checkKey, actor.id),
  });
}

/** Register a Trapbreaking column, one option per trap the party has found within reach. */
function registerTrapbreak(key, mode) {
  const cfg = PARTY_CHECKS[key];
  const near = (ctx) => (ctx.formation ? knownPlacementsNear(ctx.formation) : []);
  registerTurnActivity({
    key,
    pace: mode,
    label: cfg.label,
    options: (_actor, ctx) => near(ctx).map((p) => ({ id: p.uuid, kind: p.kind })),
    turns: () => 1,
    blocked: (actor, option, ctx) => {
      const refusal = disarmRefusal(near(ctx).find((p) => p.uuid === option.id) ?? null, actor, mode);
      return refusal ? `trap:${refusal}` : null;
    },
    resolve: (actor, option, ctx) =>
      attemptDisarm(getFormation(ctx.formation.id) ?? ctx.formation, actor, { mode, targetUuid: option.id, spend: false }),
  });
}

/**
 * Register the delve's activities. Called once at init on every client: the
 * column and a player's refusal read them where the plan is shown.
 */
export function registerFormationActivities() {
  for (const [key, pace] of Object.entries(GROUP_CHECKS)) registerGroupCheck(key, pace);
  for (const [key, mode] of Object.entries(TRAPBREAKS)) registerTrapbreak(key, mode);
  registerTurnActivity({
    key: BATTER_KEY,
    pace: "methodical",
    label: "ACKS-FORMATION.plan.activity.batter",
    options: () => [{}],
    // The length is the door's printed figure, which no import reads: the choice cannot lock.
    turns: () => null,
    resolve: () => ({ done: BATTER_KEY }),
  });
  registerTurnActivity({
    key: REST_KEY,
    pace: "methodical",
    label: "ACKS-FORMATION.plan.activity.rest",
    options: () => [{}],
    turns: () => 1,
    // The rest itself is the turn's: `partyRest` decides it before the clock moves.
    resolve: () => ({ rested: true }),
  });
}

/* -------------------------------------------- */
/*  Locking                                     */
/* -------------------------------------------- */

/** The member's own state, as `memberBlock` reads it. */
function memberState(formation, actorId) {
  const member = memberOf(formation, actorId);
  const actor = member ? getMemberActor(member) : null;
  return {
    actor,
    state: {
      member: actor ? member : null,
      moved: !!formation.clock?.movedThisTurn,
      inCombat: !!formation.combat?.active,
      down: actor ? isDown(actor, member) : false,
    },
  };
}

/** The lock against a plan, written nowhere. */
function lockAgainst(formation, plan, { actorId, key, option = null, by = null }) {
  const { actor, state } = memberState(formation, actorId);
  return lockForMember(
    plan,
    { actorId, actor, key, option, by, usedThisTurn: usedThisTurn(formation), ctx: { formation, member: state.member } },
    state,
  );
}

/**
 * Why this lock would be refused, or null: the same decision `lockPlan` makes,
 * for a player's own client, which the relay answers nothing to.
 * @returns {{reason: string, missing: string[]}|null}
 */
export function planRefusal(formation, request) {
  const result = lockAgainst(formation, readPlan(formation), request);
  return result.ok ? null : { reason: result.reason, missing: result.missing };
}

/**
 * Lock a member's choice into the stored plan, on a GM client.
 * @param {object} formation
 * @param {{actorId: string, key: string, option?: string|null, by?: string|null}} request
 *   `by` is the id of the user who locked it.
 * @returns {Promise<{ok: true, entry: object}|{ok: false, reason: string, missing: string[]}>}
 */
export async function lockPlan(formation, request) {
  const result = lockAgainst(formation, readPlan(formation), request);
  if (!result.ok) return result;
  await writePlan(formation, result.plan);
  return { ok: true, entry: result.entry };
}

/** Take a member's entry out of the stored plan, on a GM client: they keep watch again. */
export async function unlockPlan(formation, actorId) {
  return writePlan(formation, unlockActivity(readPlan(formation), actorId));
}

/* -------------------------------------------- */
/*  Resolution                                  */
/* -------------------------------------------- */

/** The members who take part in the turn: in the party, not left behind, detached or down. */
function takingPart(formation) {
  return realMembers(formation)
    .filter((m) => !m.left && !m.detached)
    .filter((m) => {
      const actor = getMemberActor(m);
      return actor && !isDown(actor, m);
    })
    .map((m) => m.actorId);
}

/**
 * Advance the turn with the plan: the Advance turn and Rest presses, and a
 * player's rest request. The clock spends one turn, resting when the Judge
 * pressed Rest or every member who owes rest chose it; the plan counts down and
 * is written stamped; each due entry resolves through its own activity, and each
 * group check is rolled once, for the members who chose it, on one card.
 * @param {object} formation
 * @param {object} [opts]
 * @param {boolean} [opts.resting] The Judge's own Rest.
 * @returns {Promise<object|null>} `runPlanTurn`'s answer; null off a GM client
 */
export async function resolvePlanTurn(formation, { resting = false } = {}) {
  if (!game.user.isGM || !formation) return null;
  const fid = formation.id;
  const outcome = await runPlanTurn({
    plan: readPlan(formation),
    memberIds: takingPart(formation),
    endures: (id) => hasEndurance(game.actors.get(id)),
    forcedRest: resting,
    spendTurn: ({ resting: rests }) => advanceTurns(formation, 1, rests ? { resting: true } : { reason: "plan" }),
    turnOf: () => (getFormation(fid) ?? formation).clock.turnsTotal,
    writePlan: (plan) => writePlan(getFormation(fid) ?? formation, plan),
    actorOf: (id) => (memberOf(getFormation(fid) ?? formation, id) ? game.actors.get(id) ?? null : null),
    ctx: { formation },
    flush: async (groups) => {
      const rolled = {};
      for (const [checkKey, only] of groups) {
        rolled[checkKey] = await rollPartyCheck(getFormation(fid) ?? formation, checkKey, { only, spend: false });
      }
      return rolled;
    },
  });
  const unresolved = outcome.results.filter((r) => r.status !== "resolved");
  if (unresolved.length) {
    await postNotesCard(formation, unresolved.map((r) => ({
      type: "warn",
      text: loc(`plan.${r.status}`, {
        name: game.actors.get(r.actorId)?.name ?? "?",
        activity: activityLabel(r.key),
      }),
    })));
  }
  return outcome;
}

/* -------------------------------------------- */
/*  Interruptions                               */
/* -------------------------------------------- */

/**
 * A fight takes the party mid-turn: every open single-turn entry is cancelled,
 * a multi-turn entry keeps its progress, and one card says which. Nothing is
 * posted for an empty plan. See docs/formation/DECISIONS.md,
 * "The turn plan is the party's, and only Turn and Rest resolve it".
 */
export async function cancelPlanForCombat(formation) {
  if (!game.user.isGM || !formation) return null;
  const { plan, cancelled, kept } = cancelForCombat(readPlan(formation));
  if (!cancelled.length && !kept.length) return { cancelled, kept };
  await writePlan(formation, plan);
  const row = ({ actorId, entry }, outcome) => ({
    name: game.actors.get(actorId)?.name ?? "?",
    detail: activityLabel(entry.key),
    total: entry.remaining,
    outcome,
    emphasis: "neutral",
  });
  const content = renderRollCard({
    title: loc("plan.combat.title"),
    subtitle: formation.name,
    note: loc("plan.combat.note"),
    labels: { total: loc("plan.combat.turnsLeft") },
    sections: [{
      rows: [
        ...cancelled.map((c) => row(c, loc("plan.combat.cancelled"))),
        ...kept.map((k) => row(k, loc("plan.combat.kept"))),
      ],
    }],
  });
  await ChatMessage.create({ content, speaker: { alias: formation.name } });
  return { cancelled, kept };
}

/** The party moved: every open entry ends, and the table is told whose. */
export async function cancelPlanForMove(formation) {
  if (!game.user.isGM || !formation) return null;
  const { plan, cancelled } = cancelForMove(readPlan(formation));
  if (!cancelled.length) return { cancelled };
  await writePlan(formation, plan);
  const names = cancelled.map(({ actorId }) => game.actors.get(actorId)?.name ?? "?").join(", ");
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${foundry.utils.escapeHTML(loc("plan.moved", { names }))}</em></div>`,
    speaker: { alias: formation.name },
  });
  return { cancelled };
}

/* -------------------------------------------- */
/*  The column                                  */
/* -------------------------------------------- */

/** Whether a lang key exists; false where the localization cannot say. */
const hasKey = (key) => (typeof game.i18n?.has === "function" ? game.i18n.has(key) : false);

/** An activity's name; a key nothing registered reads as itself. */
export function activityLabel(key) {
  const label = turnActivity(key)?.label ?? `ACKS-FORMATION.plan.activity.${key}`;
  return hasKey(label) ? game.i18n.localize(label) : key;
}

/**
 * A refusal as the column and the warning say it. A trap's refusal is the trap
 * dialog's own line; the party's reasons are the formation's; lib's are lib's;
 * anything else is the generic line. A refusal for a figure nobody imported
 * has no words and answers an empty string.
 */
export function reasonText(reason, actor = null) {
  const name = actor?.name ?? "";
  if (reason === "notImported") return "";
  if (typeof reason === "string" && reason.startsWith("trap:")) {
    return game.i18n.format(`ACKS-FORMATION.traps.refuse.${reason.slice(5)}`, { name });
  }
  for (const key of [`ACKS-FORMATION.plan.reason.${reason}`, `ACKS-LIB.turnActivity.reason.${reason}`]) {
    if (hasKey(key)) return game.i18n.format(key, { name });
  }
  return game.i18n.localize("ACKS-LIB.turnActivity.reason.other");
}

/** An option's name in the select: the activity, and for a trap which one. */
function optionLabel(row) {
  const base = activityLabel(row.key);
  if (row.option?.kind) return `${base} (${loc(`traps.${row.option.kind === "wall" ? "targetWall" : "targetZone"}`)})`;
  return base;
}

/**
 * The Turn plan section on the Dungeon tab: one row per member, what they have
 * locked or that they keep watch, what stops them choosing, and the choices
 * they have, for the seats that may choose for them.
 * @returns {{rows: object[], rest: {rests: boolean, chose: number, missing: string[]}|null}}
 */
export function planView(formation) {
  const plan = readPlan(formation);
  const ctx = { formation };
  const rows = realMembers(formation).map((member) => {
    const actor = getMemberActor(member);
    const owned = actor?.testUserPermission?.(game.user, "OWNER") ?? false;
    const { state } = memberState(formation, member.actorId);
    const blockId = memberBlock(state);
    const entry = plan[member.actorId] ?? null;
    const view = {
      actorId: member.actorId,
      name: actor?.name ?? game.i18n.localize("ACKS-FORMATION.app.missingActor"),
      canControl: game.user.isGM || owned,
      block: blockId ? reasonText(blockId, actor) : null,
      entry: null,
      options: [],
    };
    if (entry) {
      const done = entry.resolvedTurn != null;
      const by = entry.by ? game.users.get(entry.by)?.name ?? "" : "";
      view.entry = {
        label: activityLabel(entry.key),
        done,
        remaining: entry.remaining,
        turns: entry.turns,
        multi: (entry.turns ?? 1) > 1,
        tip: game.i18n.format(by ? "ACKS-FORMATION.plan.entryTipBy" : "ACKS-FORMATION.plan.entryTip", {
          remaining: entry.remaining,
          turns: entry.turns ?? entry.remaining,
          by,
        }),
      };
    }
    if (actor && view.canControl && !blockId) {
      view.options = offeredActivities(actor, { ...ctx, member }).map((row) => {
        const why = row.blocked ? reasonText(row.blocked.reason, actor) : null;
        return {
          value: `${row.key}|${row.option?.id ?? ""}`,
          label: why ? `${optionLabel(row)} — ${why}` : optionLabel(row),
          disabled: !!row.blocked || row.turns == null,
          selected: !!entry && entry.key === row.key && (entry.option ?? "") === (row.option?.id ?? ""),
        };
      });
    }
    return view;
  });
  const chose = rows.filter((r) => plan[r.actorId]?.key === REST_KEY).length;
  let rest = null;
  if (chose) {
    const decision = partyRest(plan, takingPart(formation), { endures: (id) => hasEndurance(game.actors.get(id)) });
    rest = {
      rests: decision.rests,
      missing: decision.missing.map((id) => game.actors.get(id)?.name ?? "?").join(", "),
    };
  }
  return { rows, rest };
}

/** The `key|option` a column select carries, split; null for an empty pick. */
export function parsePick(value) {
  if (typeof value !== "string" || !value.includes("|")) return null;
  const [key, option] = value.split("|");
  return key ? { key, option: option || null } : null;
}
