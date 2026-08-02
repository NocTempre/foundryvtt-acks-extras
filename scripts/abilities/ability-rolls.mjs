/* global foundry, game, Roll, ChatMessage */
/**
 * The roller behind the Rolls tab — and, through roll-wrap.mjs, behind every
 * other way the game rolls an ability.
 *
 * The core ability item carries ONE roll (formula, type, target). Most ACKS
 * proficiencies offer several: Animal Husbandry diagnoses, cures, cures serious
 * injury and extracts venom, three of those on their own rank ladder. So an
 * ability's rolls live in `flags["acks-abilities"].extras.rolls`.
 *
 * ONE STORE, ONE READ PATH. `rollsOf()` is the only place anything asks an
 * ability what it rolls, and it folds core's singleton fields in on the way out
 * — so an item this module has never migrated still presents the same shape,
 * and roll #1 is not reached by different code than roll #3.
 *
 * Targets resolve against the CHARACTER, not the item: a rank ladder needs how
 * many times the proficiency was taken, a level ladder needs the actor's level.
 * A shared world item has neither, so it shows the ladder instead of a number.
 */
import { MODULE_ID } from "./constants.mjs";
import { slug } from "../lib/vocab.mjs";

/**
 * How many times an actor has this ability. The books rate several
 * proficiencies by rank ("if the character selects Animal Husbandry twice…"),
 * and taking it twice is how you hold rank 2 — so rank is the count of
 * same-named ability items the actor carries.
 */
export function rankOf(actor, item) {
  if (!actor || !item) return 1;
  const mine = slug(item.name);
  const n = actor.items.filter((i) => i.type === item.type && slug(i.name) === mine).length;
  return Math.max(1, n);
}

/** The scales a target may be keyed on, for this actor holding this item. */
export function scalesFor(actor, item) {
  return {
    level: Number(actor?.system?.details?.level ?? actor?.system?.level ?? 1) || 1,
    rank: rankOf(actor, item),
  };
}

/**
 * Resolve a roll's target number, or null when it cannot be known here.
 * Delegates to acks-lib so the ladder semantics have one definition.
 */
export function targetOf(roll, actor, item) {
  const resolve = globalThis.acksLib?.resolveLevelValue;
  if (!resolve) return roll?.target?.flat ?? null;
  const scales = scalesFor(actor, item);
  return resolve(roll?.target, scales.level, scales);
}

/**
 * Every roll an ability offers — THE read path.
 *
 * Reads this module's store, and folds the core item's singleton fields in when
 * that store is empty, so an ability nobody has migrated yet still answers in
 * one shape. A core record sitting at its schema defaults (`1d20`, target 0) is
 * NOT a roll: those are the initials the field ships with, not a throw anyone
 * entered, and materializing them puts a meaningless d20 button on hundreds of
 * proficiencies that make no throw at all.
 *
 * @param {Item} item
 * @returns {object[]} rolls in presentation order (possibly empty)
 */
export function rollsOf(item) {
  const stored = item?.getFlag(MODULE_ID, "extras")?.rolls ?? [];
  if (stored.length) return stored;

  const s = item?.system ?? {};
  const hasTarget = Number(s.rollTarget ?? 0) !== 0;
  const hasFormula = !!s.roll && s.roll !== "1d20";
  if (!hasTarget && !hasFormula) return [];

  return [
    {
      key: "primary",
      label: "",
      formula: s.roll || "1d20",
      rollType: s.rollType || "above",
      target: { kind: "flat", flat: Number(s.rollTarget ?? 0) },
      scale: "level",
      condition: "",
    },
  ];
}

/**
 * Roll one of an ability's rolls and post the result.
 *
 * Success is reported only when a target is known. On a shared world item there
 * is no character to resolve a ladder against, so the roll still happens and
 * the result stands on its own rather than being scored against a guess.
 */
export async function rollAbility(item, key) {
  const rolls = rollsOf(item);
  const roll = rolls.find((r) => r.key === key) ?? rolls[0];
  if (!roll) return null;
  const actor = item.actor ?? null;
  const target = targetOf(roll, actor, item);

  const evaluated = await new Roll(roll.formula || "1d20").evaluate();
  const type = roll.rollType || "above";
  const total = evaluated.total;
  const success = target == null ? null : type === "below" ? total <= target : type === "result" ? total === target : total >= target;

  const label = [item.name, roll.label].filter(Boolean).join(" — ");
  const targetText =
    target == null
      ? game.i18n.localize("ACKS-ABILITIES.roll.noTarget")
      : `${game.i18n.localize("ACKS-ABILITIES.roll.target")} ${target}${type === "above" ? "+" : type === "below" ? "-" : ""}`;
  const verdict =
    success == null ? "" : success ? game.i18n.localize("ACKS-ABILITIES.roll.success") : game.i18n.localize("ACKS-ABILITIES.roll.failure");

  await evaluated.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${foundry.utils.escapeHTML?.(label) ?? label}<br><span class="acks-abilities-roll-target">${targetText}${
      verdict ? ` — <strong>${verdict}</strong>` : ""
    }</span>${roll.condition ? `<br><em>${foundry.utils.escapeHTML?.(roll.condition) ?? roll.condition}</em>` : ""}`,
  });
  return { total, target, success };
}
