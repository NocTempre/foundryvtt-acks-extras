/* global game, Hooks, ChatMessage, Roll, ui */
/**
 * Damage that lands on its bearer a count of its turns after it was dealt: the
 * record, the clock that brings it due, and the reader that applies it.
 *
 * The record is a `flags["acks-extras"].delayedDamage` flag on an Active Effect
 * of the struck creature: the clock of `turn-life.mjs` (`{combatId, combatantId,
 * edge, count, seen}`, counting the bearer's own turns, one a round) and the
 * damage, a flat `amount` or a dice `formula`, with the `source` and `cite`
 * named on the card. The number of turns or rounds, the amount and the formula
 * are the carrier's, imported; nothing here fixes one. It is its own flag and
 * never `turnLife`, since the tracker deletes a turn-life record as it comes
 * due, before anything could apply the damage (`status-effects.mjs`).
 *
 * `delayedDamageStep` is the pure step. `liftDelayedDamage` is the reader: run
 * on `TURN_BEGAN_HOOK` and `TURN_ENDED_HOOK`, which fire once per real turn and
 * not for a re-sort or a step back, it counts the bearer's turn, and when the
 * record comes due it deletes the effect FIRST (a client whose delete fails
 * applies nothing, so the damage lands once), then writes the damage through
 * `adjustHp` and posts a card naming source, cite and amount. A bearer that is
 * gone or down gets nothing; its record is deleted without a card.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_DELAYED_DAMAGE, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "./constants.mjs";
import { readTurnLife, turnLifeStep } from "./turn-life.mjs";
import { isPrimaryGM, makeLoc, numOrNull } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * A stored flag as a well-formed record, or null: a turn-life clock, a damage
 * (a flat amount of zero or more, or a formula) and the source it is named by.
 * The page is blank where the carrier read none.
 *
 * @param {object} [raw]
 * @returns {{combatId: string, combatantId: string, edge: string, count: number, seen: number, amount: number|null, formula: string, source: string, cite: string}|null}
 */
export function readDelayedDamage(raw) {
  const life = readTurnLife(raw);
  if (!life) return null;
  const amount = numOrNull(raw.amount);
  const formula = typeof raw.formula === "string" ? raw.formula.trim() : "";
  if ((amount === null || amount < 0) && !formula) return null;
  return { ...life, amount: amount !== null && amount >= 0 ? amount : null, formula, source: String(raw.source ?? "").trim(), cite: String(raw.cite ?? "").trim() };
}

/**
 * What one turn event does to a record: `{act, seen, record}`. `act` is `none`
 * (not this record's event, or nothing to write), `count` (a turn counted: write
 * `seen`), `apply` (due: delete, then deal the damage) or `drop` (due, but the
 * bearer is gone or down: delete and deal nothing). `bearer` is `{gone, down}`.
 * Pure over the clock of `turnLifeStep`.
 *
 * @param {object} raw  the stored flag
 * @param {{kind: "began"|"ended", combatId: string, combatantId: string}} event
 * @param {{gone?: boolean, down?: boolean}} [bearer]
 */
export function delayedDamageStep(raw, event, { gone = false, down = false } = {}) {
  const record = readDelayedDamage(raw);
  if (!record) return { act: "none", seen: 0, record: null };
  const step = turnLifeStep(record, event);
  if (!step.lift) return { act: step.seen !== record.seen ? "count" : "none", seen: step.seen, record };
  return { act: gone || down ? "drop" : "apply", seen: step.seen, record };
}

/**
 * The Active Effect data that carries a record, or null for an ill-formed one:
 * what a feature that deals delayed damage creates on the struck creature's
 * actor. `edge` is `start` unless named; `seen` is none.
 *
 * @param {{amount?: number, formula?: string, source: string, cite?: string, combatId: string, combatantId: string, count: number, edge?: string, name?: string, img?: string}} p
 */
export function delayedDamageEffectData({ amount, formula, source, cite = "", combatId, combatantId, count, edge = "start", name, img } = {}) {
  const record = readDelayedDamage({ combatId, combatantId, edge, count, seen: 0, amount, formula, source, cite });
  if (!record) return null;
  return { name: name ?? source, ...(img ? { img } : {}), flags: { [MODULE_ID]: { [FLAG_DELAYED_DAMAGE]: record } } };
}

/** Whether a combatant is out of the fight: defeated, or its actor marked dead. */
const isDown = (combatant) => combatant?.isDefeated === true || combatant?.defeated === true || combatant?.actor?.statuses?.has?.("dead") === true;

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
  const done = new Set();
  for (const holder of combat?.combatants ?? []) {
    const actor = holder?.actor;
    if (!actor) continue;
    for (const effect of [...(actor.effects ?? [])]) {
      const raw = effect?.flags?.[MODULE_ID]?.[FLAG_DELAYED_DAMAGE];
      const key = effect?.uuid ?? effect;
      if (raw === undefined || done.has(key)) continue;
      done.add(key);
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
        const amount = step.record.amount ?? numOrNull(await deps.roll(step.record.formula));
        if (amount === null || amount < 0) continue;
        const result = await deps.damage({ actor, combatant: bearer, amount });
        const entry = { name: bearer.name ?? actor.name, source: step.record.source, cite: step.record.cite, amount, result };
        landed.push(entry);
        await deps.post(entry);
      } catch (err) {
        console.error(`${MODULE_ID} | delayed damage on ${actor.name} could not be run`, err);
      }
    }
  }
  return landed;
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The real hands of `liftDelayedDamage`: a roll, an `adjustHp` write and the hit-point card. */
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
  };
}

let installed = false;

/** Listen on the tracker's turn edges, once. Only the primary GM's client acts, as the hooks fire there alone. */
export function installDelayedDamage() {
  if (installed) return;
  installed = true;
  const on = (kind) => (combat, combatantId) => {
    if (!isPrimaryGM()) return;
    void liftDelayedDamage(combat, combatantId, kind, foundryDeps());
  };
  Hooks.on(TURN_BEGAN_HOOK, on("began"));
  Hooks.on(TURN_ENDED_HOOK, on("ended"));
}
