/* global game, ui, Roll, ChatMessage */
/**
 * The group hit-point tool's Foundry half: which rows a selection becomes
 * (`resolveTargets`), the writes (`adjustHp`, `restoreHp`) and the report.
 *
 * Damage and healing are written by core's own `applyDamage`. A value set
 * outright, and damage held at 0, are written as an ordinary actor update.
 * Either way the write is an actor update, so everything that reacts to one
 * reacts here too. A party member riding in the party token's stash has no
 * document to update: the `party-roster` service (docs/lib/API.md) writes
 * that member's stashed token for it.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import * as services from "./services.mjs";
import { renderRollCard } from "./roll-card.mjs";
import { postToJudges, showDice } from "./roll-audience.mjs";
import { HP_MODE, HP_REASON, hpEligibility, planHpChange } from "./hp-logic.mjs";
import { deployedBodies, isGroupActor } from "./group-logic.mjs";

const loc = makeLoc(LANG_PREFIX);

/** Why a write did not land. Each key is also the last part of its label's lang key, hp.why.<key> under lib's root. */
export const HP_WHY = Object.freeze({ gone: "gone", moved: "moved", noHp: "noHp", failed: "failed" });

const roster = () => services.get("party-roster");

/** An actor's hit points as `{value, max}`, or null when it has none. */
function hpOf(actor) {
  const hp = actor?.system?.hp;
  return Number.isFinite(hp?.value) && Number.isFinite(hp?.max) ? { value: hp.value, max: hp.max } : null;
}

/**
 * @typedef {object} HpTarget
 * @property {string} key       unique per target: the uuid of the actor it
 *                              updates, or `party.<id>.<actorId>` for a member
 *                              in a party token's stash
 * @property {string} name
 * @property {string} img
 * @property {Actor|null} document  the actor an update reaches: a world actor
 *                              or a token's synthetic actor; null for a stashed
 *                              member
 * @property {{party: string, actorId: string}|null} stash  where a stashed
 *                              member's hit points are kept
 * @property {{value: number, max: number}|null} hp
 * @property {string|null} reason  a key of `HP_REASON` when it cannot be adjusted
 * @property {string} partyName the party it was found through, or ""
 */

/** A target updated through an actor document: a world actor, or a token's synthetic actor. */
function documentTarget(actor, { name = null, partyName = "" } = {}) {
  return {
    key: actor.uuid,
    name: name || actor.name,
    img: actor.img,
    document: actor,
    stash: null,
    hp: hpOf(actor),
    reason: hpEligibility(actor),
    partyName,
  };
}

/** A token's target: its world actor when linked, else the token's own actor. */
function tokenTarget(token, partyName = "") {
  const actor = token.actor;
  if (!actor) return null;
  return documentTarget(actor, { name: token.actorLink ? actor.name : token.name, partyName });
}

/**
 * A stack's targets: each of its bodies on the map, or, while none is, the
 * stack itself, which is left out with its reason.
 */
function stackTargets(group, partyName = "") {
  const bodies = deployedBodies(group, game.scenes ?? []);
  if (!bodies.length) return [documentTarget(group, { partyName })];
  return bodies.map((token) => tokenTarget(token, partyName)).filter(Boolean);
}

/** Every member of party `id`, as targets. Nothing without a roster. */
function partyTargets(id) {
  const svc = roster();
  if (!svc) return [];
  const partyName = svc.list?.().find((p) => p.id === id)?.name ?? "";
  return (svc.members?.(id) ?? []).flatMap((m) => {
    if (isGroupActor(m.actor)) return stackTargets(m.actor, partyName);
    if (m.document) return documentTarget(m.document, { name: m.name, partyName });
    const reason = hpEligibility(m.actor);
    return {
      key: `party.${id}.${m.actorId}`,
      name: m.name,
      img: m.actor?.img ?? "icons/svg/mystery-man.svg",
      document: null,
      stash: { party: id, actorId: m.actorId },
      hp: m.hp ?? null,
      reason: reason ?? (m.hp ? null : HP_REASON.noHp),
      partyName,
    };
  });
}

/**
 * The rows a selection becomes, in the order given, each once. A token the
 * party roster knows as a party token becomes that party's members. A linked
 * token becomes its world actor, so two tokens of one character make one row;
 * an unlinked token is its own row. A stack becomes its bodies on the map.
 *
 * @param {{tokens?: Array<Token|TokenDocument>, actors?: Actor[], parties?: string[]}} [from]
 * @returns {HpTarget[]}
 */
export function resolveTargets({ tokens = [], actors = [], parties = [] } = {}) {
  const out = new Map();
  const seenParties = new Set();
  const add = (target) => {
    if (target && !out.has(target.key)) out.set(target.key, target);
  };
  const addParty = (id) => {
    if (!id || seenParties.has(id)) return;
    seenParties.add(id);
    for (const target of partyTargets(id)) add(target);
  };
  for (const t of tokens) {
    const token = t?.document ?? t;
    if (!token) continue;
    const party = roster()?.partyOf?.(token) ?? null;
    if (party) addParty(party);
    else if (isGroupActor(token.actor)) stackTargets(token.actor).forEach(add);
    else add(tokenTarget(token));
  }
  for (const actor of actors) {
    if (isGroupActor(actor)) stackTargets(actor).forEach(add);
    else if (actor) add(documentTarget(actor));
  }
  for (const id of parties) addParty(id);
  return [...out.values()];
}

/**
 * The same target as it stands now, with its hit points re-read. A stashed
 * member who has since been deployed becomes their token's target. A target
 * whose document is gone keeps its row with `document` and `hp` null.
 */
export function refreshTarget(target) {
  const keep = { name: target.name, partyName: target.partyName };
  if (target.stash) {
    const member = roster()?.members?.(target.stash.party)?.find((m) => m.actorId === target.stash.actorId);
    if (!member) return { ...target, hp: null };
    if (member.document) return { ...documentTarget(member.document, keep), key: target.key };
    return { ...target, hp: member.hp ?? null };
  }
  const doc = target.document;
  // A token's synthetic actor is rebuilt with its token, so it is found again
  // through the token, and the token is what can be gone.
  const actor = doc?.isToken ? (doc.token?.parent?.tokens?.get?.(doc.token.id)?.actor ?? null) : doc && game.actors.get(doc.id);
  return actor ? { ...documentTarget(actor, keep), key: target.key } : { ...target, document: null, hp: null };
}

/** Is `amount` a whole number as typed, needing no roll? */
export const isFlatAmount = (amount) => /^\s*-?\d+\s*$/.test(String(amount ?? ""));

/**
 * The amount each of `count` targets takes: a whole number as it stands, a
 * formula rolled once for everyone or once per target.
 * @returns {Promise<{amounts: number[], rolls: Roll[], formula: string|null}>}
 * @throws when the formula is not one Foundry can roll
 */
export async function rollAmounts(amount, count, { perTarget = false } = {}) {
  if (isFlatAmount(amount)) return { amounts: Array(count).fill(parseInt(amount, 10)), rolls: [], formula: null };
  const formula = String(amount ?? "").trim();
  if (!formula || !Roll.validate(formula)) throw new Error(loc("hp.badFormula", { formula }));
  const rolls = [];
  for (let i = 0; i < (perTarget ? count : 1); i++) rolls.push(await new Roll(formula).evaluate());
  const amounts = perTarget ? rolls.map((r) => r.total) : Array(count).fill(rolls[0]?.total ?? 0);
  return { amounts, rolls, formula };
}

/**
 * Write one target. Damage and healing go through core's `applyDamage`
 * unless the floor at 0 changes what core would store; then, and for a set,
 * the planned value is written as an update. Planned from the value read now.
 */
async function writeOne(target, { mode, amount, multiplier, floorAtZero }) {
  const fresh = refreshTarget(target);
  if (fresh.stash && !fresh.document) {
    const change = { mode, amount, multiplier, floorAtZero };
    const next = (hp) => planHpChange(hp, change)?.after ?? null;
    const done = await roster()?.adjustStashedHp?.(fresh.stash.party, fresh.stash.actorId, next);
    return done ? { ok: true, before: done.before, after: done.after, max: done.max ?? null } : { ok: false, why: HP_WHY.moved };
  }
  const actor = fresh.document;
  if (!actor) return { ok: false, why: HP_WHY.gone };
  const plan = planHpChange(fresh.hp, { mode, amount, multiplier, floorAtZero });
  if (!plan) return { ok: false, why: HP_WHY.noHp };
  if (plan.delta !== 0) {
    const core = mode === HP_MODE.set ? null : planHpChange(fresh.hp, { mode, amount, multiplier });
    if (core?.after === plan.after && typeof actor.applyDamage === "function") {
      await actor.applyDamage(mode === HP_MODE.heal ? -amount : amount, multiplier);
    } else {
      await actor.update({ "system.hp.value": plan.after });
    }
  }
  const after = hpOf(actor);
  return { ok: true, before: plan.before, after: after?.value ?? plan.after, max: after?.max ?? plan.max };
}

/**
 * Apply one change to each entry, one write per target. A target that fails
 * is reported and the rest still land.
 *
 * @param {Array<{target: HpTarget, amount: number, multiplier?: number}>} entries
 * @param {{mode: string, floorAtZero?: boolean}} opts
 * @returns {Promise<object[]>} per entry: `{target, amount, multiplier, ok,
 *   before, after, max, crossedDown, crossedUp, why, error}`
 */
export async function adjustHp(entries, { mode = HP_MODE.damage, floorAtZero = false } = {}) {
  const results = [];
  for (const { target, amount, multiplier = 1 } of entries) {
    let outcome;
    try {
      outcome = await writeOne(target, { mode, amount, multiplier, floorAtZero });
    } catch (err) {
      console.error(`acks-extras | hit points for ${target.name} were not written`, err);
      outcome = { ok: false, why: HP_WHY.failed, error: err.message };
    }
    const result = { target, amount, multiplier, ...outcome };
    if (outcome.ok) {
      result.crossedDown = outcome.before > 0 && outcome.after <= 0;
      result.crossedUp = outcome.before <= 0 && outcome.after > 0;
    }
    results.push(result);
  }
  return results;
}

/**
 * Put back what `results` changed: each written target returns to its value
 * from before, as a set.
 * @returns {Promise<object[]>} results in `adjustHp`'s shape
 */
export async function restoreHp(results) {
  const entries = results.filter((r) => r.ok && r.after !== r.before);
  const restored = [];
  for (const r of entries) {
    const [back] = await adjustHp([{ target: r.target, amount: r.before }], { mode: HP_MODE.set });
    restored.push(back);
  }
  return restored;
}

/** A multiplier as the card prints it: nothing for ×1, a half as ½. */
export function multiplierLabel(multiplier) {
  const m = Number(multiplier);
  if (m === 1 || !Number.isFinite(m)) return "";
  return `×${m === 0.5 ? "½" : m}`;
}

/** What was done to one row, for the line under its name. */
function detailOf(result, mode) {
  if (!result.ok) return [loc(`hp.why.${result.why}`), result.error].filter(Boolean).join(" ");
  const mult = mode === HP_MODE.set ? "" : multiplierLabel(result.multiplier);
  return loc(`hp.card.${mode}`, { amount: result.amount, mult }).trim();
}

/**
 * Post the report of a change, or of its undo: one row per target with its
 * hit points before and after, under the party's name when every row came
 * from one party. Whispered to the GMs, with the dice shown to them alone,
 * unless `visible`.
 * @param {object[]} results `adjustHp`'s results
 * @param {{mode: string, formula?: string|null, rolls?: Roll[], visible?: boolean, undone?: boolean}} opts
 * @returns {Promise<ChatMessage|null>}
 */
export async function postHpReport(results, { mode, formula = null, rolls = [], visible = false, undone = false } = {}) {
  const parties = new Set(results.map((r) => r.target.partyName));
  const rows = results.map((r) => ({
    name: r.target.name,
    total: r.ok ? `${r.before} → ${r.after}` : "—",
    detail: detailOf(r, mode),
    tooltip: formula ?? undefined,
    outcome: r.crossedDown ? loc("hp.card.down") : r.crossedUp ? loc("hp.card.up") : "",
    emphasis: r.crossedDown ? "failure" : r.crossedUp ? "success" : undefined,
  }));
  const content = renderRollCard({
    title: loc(undone ? "hp.card.undoTitle" : "hp.card.title"),
    subtitle: parties.size === 1 ? [...parties][0] : "",
    sections: [{ rows }],
    labels: { total: loc("hp.card.colHp") },
  });
  if (!content) return null;
  if (!visible) return postToJudges({ content, rolls });
  await showDice(rolls);
  return ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ user: game.user }) });
}

/**
 * Adjust the hit points of everyone `from` names, with no window: the API's
 * way, for a macro. Rows that cannot be adjusted are left out. GM only.
 * @param {{tokens?: object[], actors?: object[], parties?: string[]}} from
 * @param {{mode?: string, amount: number|string, multiplier?: number, perTarget?: boolean,
 *   floorAtZero?: boolean, report?: boolean, visible?: boolean}} opts
 * @returns {Promise<object[]|null>} `adjustHp`'s results, or null for a player
 */
export async function adjustTargets(
  from,
  { mode = HP_MODE.damage, amount, multiplier = 1, perTarget = false, floorAtZero = false, report = true, visible = false } = {},
) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(loc("hp.gmOnly"));
    return null;
  }
  const targets = resolveTargets(from ?? {}).filter((t) => !t.reason && t.hp);
  if (!targets.length) return [];
  const { amounts, rolls, formula } = await rollAmounts(amount, targets.length, { perTarget });
  const entries = targets.map((target, i) => ({ target, amount: amounts[i], multiplier }));
  const results = await adjustHp(entries, { mode, floorAtZero });
  if (report) await postHpReport(results, { mode, formula, rolls, visible });
  return results;
}
