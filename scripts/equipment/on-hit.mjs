/* global game */
/**
 * What a hit with on-hit ammunition asks and writes: the prompt card posted for
 * the struck token (`onHitPost`), the one place the shot's stack is read before
 * the spend empties it (`settleShot`), and the writer of the card's outcome
 * (`onHitOutcome`), which lib's item runner calls on the Save press.
 *
 * The stack carries `{saveKind, saveMod, formula, delayTurns, source, cite}`
 * (`ammo.mjs` `onHitOf`), every figure a gear row printed. The delay counts
 * dungeon turns, so a failed save writes a delayed-damage record on the WORLD
 * clock (`lib/delayed-damage.mjs`), due `delayTurns` turns after the press (the
 * page, MM p. 56, counts the delay in turns);
 * nothing here fixes a figure, and a blank one writes nothing. A passed save
 * writes nothing.
 */
import { delayedDamageEffectData } from "../lib/delayed-damage.mjs";
import { dueAtAfter } from "../lib/item-run-logic.mjs";
import { turnSeconds } from "../lib/time-unit.mjs";
import { MODULE_ID } from "./constants.mjs";
import { consumeForAttack, onHitOf, shotStack } from "./ammo.mjs";
import { classifyWeapon } from "./profiles.mjs";

/** What a card with a blank figure answers: nothing written, the entry the Judge's. */
const NO_FIGURE = Object.freeze({ records: [], names: [], life: "raised", state: "judge", judge: true, why: "figure" });

/** The card kind this feature registers an outcome writer for. */
export const ON_HIT_KIND = "onHit";

/**
 * The argument of lib's `postOutcomeCard` for one shot, or null where nothing is
 * asked: the shot did not hit, struck no token, or its stack carries no hit
 * effect. The card speaks for the attacker, and its one subject is the struck
 * token, whose owners and the GMs press the Save. A blank save kind or modifier
 * stays blank. `now` is the world time of the strike, stored as `struckAt` so a
 * failed save's delay counts from the hit and not from the press (null where
 * unread, and the press's time is used).
 *
 * @param {{stack: object|null, isHit: boolean, target: {uuid: string, name?: string}|null, attacker: {uuid: string, name?: string}, weapon?: object, now?: number}} p
 * @returns {object|null}
 */
export function onHitPost({ stack, isHit, target, attacker, now } = {}) {
  if (isHit !== true || !target?.uuid) return null;
  const hit = onHitOf(stack);
  if (!hit) return null;
  return {
    kind: ON_HIT_KIND,
    itemUuid: stack.uuid,
    title: hit.source || stack.name,
    subtitle: attacker?.name ?? "",
    subjects: [{ key: target.uuid, name: target.name ?? "" }],
    saveName: hit.saveKind ?? "",
    saveMod: hit.saveMod,
    facts: { formula: hit.formula, delayTurns: hit.delayTurns, source: hit.source, cite: hit.cite, struckAt: Number.isFinite(now) ? now : null },
    speakerActorUuid: attacker?.uuid ?? "",
  };
}

/**
 * Settle one resolved attack: read what a hit would ask, then spend the
 * ammunition, then post the card. The stack is read FIRST because the spend can
 * empty it, and an emptied stack is no longer the shot's stack. Neither the
 * spend nor the post can fail the attack: each error is logged and dropped.
 *
 * @param {{actor: object, item: object, ctx?: object, outcome?: object, type: string, profile?: object}} p  `profile` is `classifyWeapon(item)` unless a caller already holds it
 * @param {{spend?: Function, post?: Function}} [deps]  the spend (`consumeForAttack`) and the card post (lib's `postOutcomeCard`), replaceable for a test
 */
export function settleShot({ actor, item, ctx, outcome, type, profile = classifyWeapon(item) }, { spend = consumeForAttack, post = postCard } = {}) {
  let card = null;
  try {
    card = onHitPost({
      stack: shotStack(actor, item, profile),
      isHit: outcome?.resolution?.isHit === true,
      target: outcome?.result?.target ?? ctx?.target ?? null,
      attacker: actor,
      weapon: item,
      now: game.time?.worldTime,
    });
  } catch (err) {
    console.error(`${MODULE_ID} | on-hit ammunition could not be read`, err);
  }
  Promise.resolve(spend(actor, item, profile, { type })).catch((err) => console.error(`${MODULE_ID} | ammunition consumption failed`, err));
  if (card) Promise.resolve(post(card)).catch((err) => console.error(`${MODULE_ID} | on-hit card could not be posted`, err));
}

/** Post a card through lib's item runner, loaded when first needed. */
async function postCard(card) {
  const { postOutcomeCard } = await import("../lib/item-run.mjs");
  return postOutcomeCard(card);
}

/**
 * The writer of an on-hit card's outcome, answering what the Save press
 * writes. A passed save writes nothing. A failed one writes one delayed-damage
 * record on the struck creature: the card's formula, rolled when it falls due,
 * named by the card's source and page, due the card's count of turns on the
 * world clock after the strike (`struckAt`, else this press). A card with no formula or count, or a world
 * clock that cannot be read, writes nothing and is the Judge's (`why`
 * "figure"), answered at the Save as `state: "judge"` since the common press
 * reads no `judge` flag in that phase, and the entry is then the Judge's with
 * no record.
 *
 * @param {{phase: string, card: object, saved: boolean}} p
 * @returns {{records: object[], names: string[], life: string}|{records: [], names: [], life: string, state: "judge", judge: true, why: string}}
 */
export function onHitOutcome({ phase, card, saved } = {}) {
  if (phase !== "verdict" || saved === true) return { records: [], names: [], life: "raised" };
  const dueAt = dueAtAfter(card?.delayTurns, turnSeconds(), Number.isFinite(card?.struckAt) ? card.struckAt : game.time?.worldTime);
  const formula = typeof card?.formula === "string" ? card.formula.trim() : "";
  if (dueAt === null || !formula) return NO_FIGURE;
  const source = String(card.source ?? "") || String(card.title ?? "");
  const data = delayedDamageEffectData({ formula, source, cite: String(card.cite ?? ""), dueAt });
  if (!data) return NO_FIGURE;
  return { records: [data], names: [source], life: "timed" };
}

/**
 * Register the on-hit card's outcome writer with lib's item runner, which is
 * loaded here and not at import so the attack seam's own import of this file
 * pulls in none of it.
 */
export async function installOnHit() {
  const { registerPressOutcome } = await import("../lib/item-run.mjs");
  registerPressOutcome(ON_HIT_KIND, onHitOutcome);
}
