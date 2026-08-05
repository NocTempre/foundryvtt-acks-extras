/* global foundry, game, Roll, ChatMessage, ui */
/**
 * The roller behind the Rolls tab — and, through roll-wrap.mjs, behind every
 * other way the game rolls an ability.
 *
 * The core ability item carries ONE roll (formula, type, target). Most ACKS
 * proficiencies offer several: Animal Husbandry diagnoses, cures, cures serious
 * injury and extracts venom, three of those on their own rank ladder. So an
 * ability's rolls live in `flags["acks-extras"].extras.rolls`.
 *
 * ONE STORE, ONE READ PATH. `rollsOf()` is the only place anything asks an
 * ability what it rolls, and it folds core's singleton fields in on the way out
 * — so an item this module has never migrated still presents the same shape,
 * and roll #1 is not reached by different code than roll #3. `writeRolls()` is
 * its counterpart: the only place anything changes the set, so keys stay unique
 * and an emptied list stays empty.
 *
 * Targets resolve against the CHARACTER, not the item: a rank ladder needs how
 * many times the proficiency was taken, a level ladder needs the actor's level.
 * A shared world item has neither, so it shows the ladder instead of a number.
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import AbilityExtras from "./ability-extras.mjs";
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
 *
 * A target is read at the roll's OWN scale. Animal Husbandry's diagnosis ladder
 * is rated by rank, so reading it at the character's class level answers a
 * question nobody asked — a 5th-level character who took the proficiency once
 * would diagnose on the third rung. `scale` is what the sheet already labels the
 * ladder with; it is what the ladder is read at too.
 */
export function targetOf(roll, actor, item) {
  const resolve = globalThis.acksExtras?.lib?.resolveLevelValue;
  const target = roll?.target;
  if (!resolve) return target?.flat ?? null;
  const scales = scalesFor(actor, item);
  const at = scales[roll?.scale || "level"];
  // A scale nothing here can supply (Arcane Value, Hit Dice — no consumer
  // computes them yet). A flat target still answers; a ladder does not, and the
  // sheet shows the whole ladder rather than a number read at the wrong rung.
  if (at == null) return (target?.kind ?? "flat") === "flat" ? (target?.flat ?? null) : null;
  return resolve(target, at, scales);
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
 * The handle a roll answers to: its stored key, or its position when it has
 * none. ONE rule, used by the sheet's buttons, by `rollAbility(item, key)` and
 * by the editor — so a roll that predates the editor and carries no key is
 * still reachable. Never gate a lookup on the stored key alone: clicking the
 * third throw of a keyless import then rolled the first.
 */
export const keyOf = (roll, index) => roll?.key || `roll${index}`;

/** `base`, suffixed until nothing in `taken` holds it. */
function uniqueKey(base, taken) {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  taken.add(key);
  return key;
}

/**
 * Give every roll a key that no other roll in the ability holds.
 *
 * A key that EXISTS is never rewritten. It is the handle a macro or an
 * importing module holds, so renaming a throw must not silently retarget them;
 * the label is what the reader identifies a roll by, the key is what code does.
 * That is why the pass that KEEPS keys runs first and claims them all — filling
 * a blank one from its label cannot then take a name a later roll was already
 * answering to.
 */
function settleKeys(rolls) {
  const settled = rolls.map((roll) => ({ ...roll }));
  const taken = new Set();
  for (const roll of settled) if (roll.key) roll.key = uniqueKey(roll.key, taken);
  settled.forEach((roll, i) => {
    if (!roll.key) roll.key = uniqueKey(slug(roll.label) || `roll${i}`, taken);
  });
  return settled;
}

/** A new, empty roll — what "add a roll" puts in the list. */
export const blankRoll = () => ({
  key: "",
  label: "",
  formula: "1d20",
  rollType: "above",
  target: { kind: "flat", flat: null },
  scale: "level",
  condition: "",
  note: "",
});

/** Every roll, as a detached copy safe to mutate and hand back to writeRolls. */
export const readRolls = (item) => foundry.utils.deepClone(rollsOf(item));

/**
 * Persist an ability's rolls — THE write path, the counterpart to rollsOf().
 *
 * Two things happen here that a bare setFlag would not do:
 *
 * Keys are settled before writing, so every roll has a unique handle whatever
 * the caller assembled.
 *
 * An emptied list also resets core's singleton roll fields to their schema
 * initials. rollsOf() folds those fields in when the store is empty, so
 * deleting the last roll of an ability whose throw still lived there would
 * resurrect it on the very next render. The initials are what the fold reads as
 * "no roll", which is what the deletion just said.
 */
export async function writeRolls(item, rolls) {
  const settled = settleKeys(rolls);
  const raw = foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
  raw.rolls = settled;
  let cleaned;
  try {
    cleaned = AbilityExtras.normalize(raw);
  } catch (err) {
    console.error(`${MODULE_ID} | roll normalization failed; saving as-is`, err);
    cleaned = raw;
  }
  const update = { [`flags.${MODULE_ID}.${FLAG_EXTRAS}`]: cleaned };
  if (!settled.length) {
    update["system.roll"] = "1d20";
    update["system.rollTarget"] = 0;
  }
  await item.update(update);
  return cleaned.rolls;
}

/**
 * How an ability's throws are posted to chat, or undefined to leave the seat's
 * own default alone.
 *
 * `system.blindroll` is core's field and it is ABILITY-wide: it hides every
 * throw the ability offers, not a chosen one. A GM rolling a blind ability
 * posts to themselves instead — blind exists to keep a result from the table,
 * and the GM is who the result is for. That is core's own rule
 * (`AcksDice.#sendRoll`), applied to each of an ability's throws rather than to
 * the single throw core can store.
 *
 * The mode names are Foundry 14's `CONFIG.ChatMessage.modes` keys; the legacy
 * `rollMode` spellings core still uses are deprecated and log on every call.
 */
function messageModeFor(item) {
  if (!item?.system?.blindroll) return undefined;
  return game.user?.isGM ? "self" : "blind";
}

/**
 * A throw's dice, or the 1d20 default.
 *
 * The formula is a free-text field, so it holds whatever was typed — or whatever
 * a book's prose gave it. Foundry's parser throws on an unparseable formula, and
 * this roller is async, so that throw would surface as an unhandled rejection
 * with no card and no explanation. The default already covers a blank formula;
 * it covers an unrollable one too, and names the throw so it can be corrected.
 */
function rollableFormula(roll, item) {
  const formula = String(roll?.formula ?? "").trim();
  if (!formula) return "1d20";
  if (Roll.validate(formula)) return formula;
  ui.notifications.warn(
    game.i18n.format("ACKS-ABILITIES.roll.badFormula", {
      name: [item?.name, roll?.label].filter(Boolean).join(" — ") || game.i18n.localize("ACKS-ABILITIES.roll.unnamed"),
      formula,
    }),
  );
  return "1d20";
}

/**
 * Roll one of an ability's rolls and post the result.
 *
 * Success is reported only when a target is known. On a shared world item there
 * is no character to resolve a ladder against, so the roll still happens and
 * the result stands on its own rather than being scored against a guess.
 *
 * THE one place an ability's throw is posted — the Rolls tab's buttons and
 * core's own roll path (through roll-wrap.mjs) both arrive here — so blind is
 * honoured wherever the roll was started from.
 */
export async function rollAbility(item, key) {
  const rolls = rollsOf(item);
  const roll = rolls.find((r, i) => keyOf(r, i) === key) ?? rolls[0];
  if (!roll) return null;
  const actor = item.actor ?? null;
  const target = targetOf(roll, actor, item);

  const evaluated = await new Roll(rollableFormula(roll, item)).evaluate();
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

  await evaluated.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${foundry.utils.escapeHTML?.(label) ?? label}<br><span class="acks-abilities-roll-target">${targetText}${
        verdict ? ` — <strong>${verdict}</strong>` : ""
      }</span>${roll.condition ? `<br><em>${foundry.utils.escapeHTML?.(roll.condition) ?? roll.condition}</em>` : ""}`,
    },
    // An undefined mode falls through to the seat's own default, which is what
    // toMessage does when nothing is passed at all.
    { messageMode: messageModeFor(item) },
  );
  return { total, target, success };
}
