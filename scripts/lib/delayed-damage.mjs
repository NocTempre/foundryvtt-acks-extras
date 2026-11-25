/* global game, Hooks, ChatMessage, Roll, ui */
/**
 * Damage that lands on its bearer a count of its turns after it was dealt: the
 * record, the clocks that bring it due, and the readers that apply it.
 *
 * The record is a `flags["acks-extras"].delayedDamage` flag on an Active Effect
 * of the struck creature: a clock and the damage, a flat `amount` or a dice
 * `formula`, with the `source` and `cite` named on the card. The number of turns
 * or rounds, the amount and the formula are the carrier's, imported; nothing
 * here fixes one. It is its own flag and never `turnLife`, since the tracker
 * deletes a turn-life record as it comes due, before anything could apply the
 * damage (`status-effects.mjs`).
 *
 * The record keeps one of two clocks. The combat clock is the one of
 * `turn-life.mjs` (`{combatId, combatantId, edge, count, seen}`, counting the
 * bearer's own turns, one a round). The world clock is `{dueAt}`, a reading of
 * `game.time.worldTime` in seconds: a record made outside any fight starts on
 * it, and a record whose fight ends before it is due is moved onto it. A
 * `dueAt` that is present wins: a flag that still holds the combat fields beside
 * it is read as a world-clock record.
 *
 * `delayedDamageStep` and `delayedDamageDue` are the pure steps.
 * `liftDelayedDamage` is the combat reader, run on `TURN_BEGAN_HOOK` and
 * `TURN_ENDED_HOOK`, which fire once per real turn and not for a re-sort or a
 * step back; `liftWorldDelayedDamage` is the world reader, run when the clock
 * moves forward; `convertDelayedDamage` moves a deleted fight's records onto the
 * world clock. A due record is deleted FIRST (a client whose delete fails
 * applies nothing, so the damage lands once), then the damage is written through
 * `adjustHp` and a card names source, cite and amount. A bearer that is gone or
 * down gets nothing; its record is deleted without a card.
 *
 * The rounds a fight still had to run become seconds at the world's round
 * length, read at the moment of conversion (`time-unit.mjs` `roundSeconds`).
 * Where the world has imported none, nothing can be converted: the record is
 * deleted and the Judge is warned, once, with what is owed, to apply by hand.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_DELAYED_DAMAGE, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "./constants.mjs";
import { readTurnLife, turnLifeStep } from "./turn-life.mjs";
import { roundSeconds } from "./time-unit.mjs";
import { isPrimaryGM, makeLoc, numOrNull, unset } from "./util.mjs";
import { onWorldTimeAdvanced } from "./world-time.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The combat-clock keys a conversion takes off the flag. */
const COMBAT_KEYS = Object.freeze(["combatId", "combatantId", "edge", "count", "seen"]);

/**
 * A stored flag as a well-formed record, or null: a clock (the world's `dueAt`,
 * else a turn-life clock), a damage (a flat amount of zero or more, or a
 * formula) and the source it is named by. The page is blank where the carrier
 * read none. A world-clock record carries `dueAt` and no combat fields.
 *
 * @param {object} [raw]
 * @returns {{combatId: string, combatantId: string, edge: string, count: number, seen: number, amount: number|null, formula: string, source: string, cite: string}|{dueAt: number, amount: number|null, formula: string, source: string, cite: string}|null}
 */
export function readDelayedDamage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const amount = numOrNull(raw.amount);
  const formula = typeof raw.formula === "string" ? raw.formula.trim() : "";
  if ((amount === null || amount < 0) && !formula) return null;
  const damage = { amount: amount !== null && amount >= 0 ? amount : null, formula, source: String(raw.source ?? "").trim(), cite: String(raw.cite ?? "").trim() };
  const dueAt = numOrNull(raw.dueAt);
  if (dueAt !== null) return { dueAt, ...damage };
  const life = readTurnLife(raw);
  return life ? { ...life, ...damage } : null;
}

/** Whether a read record is on the world clock. */
const onWorldClock = (record) => record != null && "dueAt" in record;

/**
 * What one turn event does to a record: `{act, seen, record}`. `act` is `none`
 * (not this record's event, or nothing to write), `count` (a turn counted: write
 * `seen`), `apply` (due: delete, then deal the damage) or `drop` (due, but the
 * bearer is gone or down: delete and deal nothing). `bearer` is `{gone, down}`.
 * Pure over the clock of `turnLifeStep`. A world-clock record is never touched
 * by a turn.
 *
 * @param {object} raw  the stored flag
 * @param {{kind: "began"|"ended", combatId: string, combatantId: string}} event
 * @param {{gone?: boolean, down?: boolean}} [bearer]
 */
export function delayedDamageStep(raw, event, { gone = false, down = false } = {}) {
  const record = readDelayedDamage(raw);
  if (!record || onWorldClock(record)) return { act: "none", seen: 0, record: null };
  const step = turnLifeStep(record, event);
  if (!step.lift) return { act: step.seen !== record.seen ? "count" : "none", seen: step.seen, record };
  return { act: gone || down ? "drop" : "apply", seen: step.seen, record };
}

/**
 * What the world clock does to a record: `{act, record}`. `act` is `none` (not a
 * world-clock record, or not yet due), `apply` (due: delete, then deal the
 * damage) or `drop` (due, but the bearer is down: delete and deal nothing).
 * Pure.
 *
 * @param {object} raw  the stored flag
 * @param {number} worldTime  the clock's reading, in seconds
 * @param {{down?: boolean}} [bearer]
 */
export function delayedDamageDue(raw, worldTime, { down = false } = {}) {
  const record = readDelayedDamage(raw);
  const now = numOrNull(worldTime);
  if (!onWorldClock(record) || now === null || now < record.dueAt) return { act: "none", record: null };
  return { act: down ? "drop" : "apply", record };
}

/**
 * What a fight's end does to one of its combat-clock records: `{act, record}`.
 * `none` for a record that is not this fight's or already on the world clock;
 * `drop` for a bearer that is gone or down (nothing is owed); `convert` with the
 * world-clock `record`, due the rounds still to run from `now`; `owed` when the
 * world has no round length (or no clock reading) to convert with, so the
 * Judge applies it by hand. The rounds still to run are the count less the
 * turns seen, at least none, each a whole round of `roundSeconds`. Pure.
 *
 * @param {object} raw  the stored flag
 * @param {string} combatId  the fight that ended
 * @param {{now: number, roundSeconds: number|null, gone?: boolean, down?: boolean}} at
 */
export function delayedDamageToWorld(raw, combatId, { now, roundSeconds: seconds, gone = false, down = false } = {}) {
  const record = readDelayedDamage(raw);
  if (!record || onWorldClock(record) || record.combatId !== combatId) return { act: "none", record: null };
  if (gone || down) return { act: "drop", record };
  const rate = numOrNull(seconds);
  const at = numOrNull(now);
  if (rate === null || !(rate > 0) || at === null) return { act: "owed", record };
  const rounds = Math.max(record.count - record.seen, 0);
  const { amount, formula, source, cite } = record;
  return { act: "convert", record: { dueAt: Math.ceil(at + rounds * rate), amount, formula, source, cite } };
}

/**
 * The Active Effect data that carries a record, or null for an ill-formed one:
 * what a feature that deals delayed damage creates on the struck creature's
 * actor. A `dueAt` (world seconds) puts it on the world clock, the combat
 * fields being left out; otherwise `edge` is `start` unless named and `seen` is
 * none.
 *
 * @param {{amount?: number, formula?: string, source: string, cite?: string, dueAt?: number, combatId?: string, combatantId?: string, count?: number, edge?: string, name?: string, img?: string}} p
 */
export function delayedDamageEffectData({ amount, formula, source, cite = "", dueAt, combatId, combatantId, count, edge = "start", name, img } = {}) {
  const clock = numOrNull(dueAt) !== null ? { dueAt } : { combatId, combatantId, edge, count, seen: 0 };
  const record = readDelayedDamage({ ...clock, amount, formula, source, cite });
  if (!record) return null;
  return { name: name ?? source, ...(img ? { img } : {}), flags: { [MODULE_ID]: { [FLAG_DELAYED_DAMAGE]: record } } };
}

/** Whether a combatant is out of the fight: defeated, or its actor marked dead. */
const isDown = (combatant) => combatant?.isDefeated === true || combatant?.defeated === true || combatant?.actor?.statuses?.has?.("dead") === true;

/** Whether an actor is marked dead. */
const actorDown = (actor) => actor?.statuses?.has?.("dead") === true;

/** Every delayed-damage effect on `actors`, once each (one actor behind two combatants holds each record once). */
function* recordEffects(actors) {
  const done = new Set();
  for (const actor of actors ?? []) {
    if (!actor) continue;
    for (const effect of [...(actor.effects ?? [])]) {
      const raw = effect?.flags?.[MODULE_ID]?.[FLAG_DELAYED_DAMAGE];
      const key = effect?.uuid ?? effect;
      if (raw === undefined || done.has(key)) continue;
      done.add(key);
      yield { actor, effect, raw };
    }
  }
}

/** Roll or read a due record's amount and write it: the entry that landed, or null when no amount could be read. */
async function deal(actor, combatant, name, record, deps) {
  const amount = record.amount ?? numOrNull(await deps.roll(record.formula));
  if (amount === null || amount < 0) return null;
  const result = await deps.damage({ actor, combatant, amount });
  return { name, source: record.source, cite: record.cite, amount, result };
}

/**
 * Apply a turn event to every delayed-damage record on the actors of `combat`.
 * One actor behind two combatants holds each record once. The damage, its
 * rolling and its card are the `deps`' (`deps.roll(formula)` answers a number,
 * `deps.damage({actor, combatant, amount})` the `adjustHp` result,
 * `deps.post({...})` the card), so this is testable without Foundry.
 *
 * @param {object} combat
 * @param {string} combatantId  the combatant whose turn began or ended
 * @param {"began"|"ended"} kind
 * @param {{roll: Function, damage: Function, post: Function}} deps
 * @returns {Promise<object[]>} what landed, `[{name, source, cite, amount, result}]`
 */
export async function liftDelayedDamage(combat, combatantId, kind, deps) {
  const landed = [];
  const event = { kind, combatId: combat?.id, combatantId };
  for (const { actor, effect, raw } of recordEffects([...(combat?.combatants ?? [])].map((holder) => holder?.actor))) {
    const bearer = combat.combatants.get?.(readDelayedDamage(raw)?.combatantId) ?? null;
    const step = delayedDamageStep(raw, event, { gone: !bearer?.actor, down: isDown(bearer) });
    if (step.act === "none") continue;
    try {
      if (step.act === "count") {
        await effect.setFlag(MODULE_ID, FLAG_DELAYED_DAMAGE, { ...step.record, seen: step.seen });
        continue;
      }
      // Claim the record before dealing it: a delete that fails means another client has it.
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      if (step.act !== "apply") continue;
      const entry = await deal(actor, bearer, bearer.name ?? actor.name, step.record, deps);
      if (!entry) continue;
      landed.push(entry);
      await deps.post(entry);
    } catch (err) {
      console.error(`${MODULE_ID} | delayed damage on ${actor.name} could not be run`, err);
    }
  }
  return landed;
}

/**
 * Lift every world-clock record of `actors` that the clock's reading has
 * reached: delete first, then roll, write and post as `liftDelayedDamage` does.
 * A bearer marked dead gets nothing, and its record goes.
 *
 * @param {Iterable<object>} actors  every actor that may hold a record
 * @param {number} worldTime  the clock's reading, in seconds
 * @param {{roll: Function, damage: Function, post: Function}} deps
 * @returns {Promise<object[]>} what landed, `[{name, source, cite, amount, result}]`
 */
export async function liftWorldDelayedDamage(actors, worldTime, deps) {
  const landed = [];
  for (const { actor, effect, raw } of recordEffects(actors)) {
    const step = delayedDamageDue(raw, worldTime, { down: actorDown(actor) });
    if (step.act === "none") continue;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      if (step.act !== "apply") continue;
      const entry = await deal(actor, null, actor.name, step.record, deps);
      if (!entry) continue;
      landed.push(entry);
      await deps.post(entry);
    } catch (err) {
      console.error(`${MODULE_ID} | delayed damage on ${actor.name} could not be run`, err);
    }
  }
  return landed;
}

/**
 * A fight has ended: move each of its pending records onto the world clock.
 * `actors` is every actor that may hold one (the fight's own combatants may be
 * gone with their tokens, but a record lives on its actor). A record moves with
 * one write; one whose bearer is down is deleted with nothing owed (a bearer
 * that has left the fight is still struck, so its record moves); one
 * with no round length to convert by is deleted FIRST and then `deps.warn` is
 * called once with `{name, amount, source, cite}`, `amount` the flat figure or
 * the formula's text unrolled.
 *
 * @param {object} combat
 * @param {Iterable<object>} actors
 * @param {{now: number, roundSeconds: number|null}} clock  the clock's reading and the round's seconds, read by the caller at this moment
 * @param {{warn: Function}} deps
 * @returns {Promise<Array<{name: string, act: "convert"|"drop"|"owed"}>>}
 */
export async function convertDelayedDamage(combat, actors, { now, roundSeconds: seconds }, deps) {
  const done = [];
  for (const { actor, effect, raw } of recordEffects(actors)) {
    const life = readDelayedDamage(raw);
    if (!life || onWorldClock(life) || life.combatId !== combat?.id) continue;
    const bearer = combat.combatants?.get?.(life.combatantId) ?? null;
    // The bearer's place in the fight no longer matters on the world's clock: only a bearer that is down is owed nothing.
    const step = delayedDamageToWorld(raw, combat.id, { now, roundSeconds: seconds, down: isDown(bearer) || actorDown(actor) });
    if (step.act === "none") continue;
    const name = bearer?.name ?? actor.name;
    try {
      if (step.act === "convert") {
        const path = `flags.${MODULE_ID}.${FLAG_DELAYED_DAMAGE}`;
        // The combat keys are unset in the same write, so no flag holds two clocks.
        await effect.update({ [path]: { ...step.record, ...Object.fromEntries(COMBAT_KEYS.map((key) => [key, unset()])) } });
      } else {
        await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
        if (step.act === "owed") await deps.warn({ name, amount: step.record.amount ?? step.record.formula, source: step.record.source, cite: step.record.cite });
      }
      done.push({ name, act: step.act });
    } catch (err) {
      console.error(`${MODULE_ID} | delayed damage on ${actor.name} could not be moved to the world clock`, err);
    }
  }
  return done;
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The real hands of the readers: a roll, an `adjustHp` write, the hit-point card and the Judge's warning. */
function foundryDeps() {
  return {
    roll: async (formula) => (await new Roll(formula).evaluate()).total,
    damage: async ({ actor, combatant, amount }) => {
      const { resolveTargets, adjustHp } = await import("./hp.mjs");
      const token = combatant?.token ?? null;
      const [target] = resolveTargets(token ? { tokens: [token] } : { actors: [actor] });
      if (!target || target.reason) return { ok: false, why: target?.reason ?? "gone" };
      const [written] = await adjustHp([{ target, amount, multiplier: 1 }], { mode: "damage" });
      return written ?? { ok: false, why: "failed" };
    },
    post: async ({ name, source, cite, amount, result }) => {
      const { renderRollCard } = await import("./roll-card.mjs");
      if (!result?.ok) {
        ui.notifications?.warn(loc("delayedDamage.refused", { name, source, why: String(result?.why ?? "") }));
        return;
      }
      const content = renderRollCard({
        title: loc("delayedDamage.title"),
        sections: [{
          rows: [{
            name,
            total: `${result.before} → ${result.after}`,
            detail: cite ? loc("delayedDamage.detail", { amount, source, cite }) : loc("delayedDamage.detailBare", { amount, source }),
            tooltip: cite || undefined,
          }],
        }],
        labels: { total: loc("hp.card.colHp") },
      });
      if (content) await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ user: game.user }) });
    },
    warn: ({ name, amount, source, cite }) => {
      ui.notifications?.warn(cite ? loc("delayedDamage.owed", { name, amount, source, cite }) : loc("delayedDamage.owedBare", { name, amount, source }));
    },
  };
}

/** Every world actor and unlinked token's actor: where a record may live. */
async function recordHolders() {
  const { worldActors } = await import("./repair.mjs");
  return worldActors();
}

let installed = false;
let clockQueue = Promise.resolve();

/** Run `work` after the one before it, so two clock steps in quick succession never lift one record twice. */
const queued = (work) => {
  clockQueue = clockQueue.then(work).catch((err) => console.error(`${MODULE_ID} | delayed damage could not be run`, err));
  return clockQueue;
};

/**
 * Listen on the tracker's turn edges, on a fight's deletion and on the world
 * clock, once. Only the primary GM's client acts, as the turn hooks fire there
 * alone and the clock registrar gates on it.
 */
export function installDelayedDamage() {
  if (installed) return;
  installed = true;
  const on = (kind) => (combat, combatantId) => {
    if (!isPrimaryGM()) return;
    void liftDelayedDamage(combat, combatantId, kind, foundryDeps());
  };
  Hooks.on(TURN_BEGAN_HOOK, on("began"));
  Hooks.on(TURN_ENDED_HOOK, on("ended"));
  Hooks.on("deleteCombat", (combat) => {
    if (!isPrimaryGM()) return;
    void queued(async () => {
      const now = game.time.worldTime;
      const actors = [...[...(combat?.combatants ?? [])].map((holder) => holder?.actor), ...(await recordHolders())];
      const deps = foundryDeps();
      await convertDelayedDamage(combat, actors, { now, roundSeconds: roundSeconds() }, deps);
      await liftWorldDelayedDamage(actors, now, deps);
    });
  });
  onWorldTimeAdvanced((worldTime) => {
    void queued(async () => liftWorldDelayedDamage(await recordHolders(), worldTime, foundryDeps()));
  });
}
