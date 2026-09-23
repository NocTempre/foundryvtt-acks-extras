/* global foundry, game, Roll, ChatMessage, ui */
/**
 * The ability roller: the Rolls tab's buttons and, through roll-wrap.mjs, every
 * other route the game rolls an ability by.
 *
 * An ability's throws live in `flags["acks-extras"].extras.rolls` (core's item
 * holds one). `rollsOf()` is the only read — it folds core's singleton fields
 * in — and `writeRolls()` the only write. Targets resolve against the
 * CHARACTER (rank or level); a shared world item shows the ladder instead.
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import AbilityExtras from "./ability-extras.mjs";
import { slug, ATTRIBUTES, isMeasure } from "../lib/vocab.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
import { auditLine, rollDetailsDialog, situationalTerm, skipDialogFor } from "../lib/roll-dialog.mjs";
// The classes registry, not lib: lib cannot see the world's class documents,
// so it answers null for the `progression` kind a borrowed ladder uses.
import { resolveLevelOutcome } from "../classes/registry.mjs";

/**
 * An actor's rank in this ability: the count of same-named ability items it
 * carries (rank N is N copies).
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

/** The vocabulary key a proficiency-throw modifier is written against. */
const THROW_TARGET = "proficiencyThrow";

/** Does `forWhat` name this ability? Splits the "A and B" the books write. */
const namesActivity = (forWhat, wanted) =>
  String(forWhat)
    .split(/\s*(?:,|\band\b|\bor\b|&|\/)\s*/i)
    .some((part) => slug(part) === wanted);

/**
 * What this character's other abilities do to THIS ability's throws: the
 * proficiency-throw modifiers naming it in `forWhat`. Each ability counts once
 * (a second copy is rank, RR §III.3); one scoped by `appliesToRoll` applies to
 * that throw alone; a conditioned one naming no throw is returned in `pending`,
 * unapplied. See docs/abilities/DECISIONS.md, "A modifier must name what it
 * modifies, and may name the throw".
 *
 * @param {object} [roll] the throw being resolved; omit for the ability's
 *   unscoped total
 * @returns {{bonus: number, pending: Array<{name: string, amount: number, condition: string}>}}
 */
export function throwModifiers(actor, item, roll = null) {
  const out = { bonus: 0, pending: [] };
  if (!actor || !item) return out;
  const mine = slug(item.name);
  const resolve = globalThis.acksExtras?.lib?.resolveLevelValue;

  const seen = new Set();
  for (const other of actor.items ?? []) {
    if (other.type !== item.type) continue;
    const name = slug(other.name);
    if (seen.has(name)) continue;
    seen.add(name);

    for (const effect of other.getFlag(MODULE_ID, FLAG_EXTRAS)?.effects ?? []) {
      if (effect?.type !== "modifier" || effect.target !== THROW_TARGET) continue;
      // A penalty imposed on the ability's victims is not its holder's.
      if ((effect.appliesTo ?? "self") !== "self") continue;
      if (effect.mode && effect.mode !== "add") continue;
      // `forWhat` may name several activities; any member matching is a match.
      if (!effect.forWhat || !namesActivity(effect.forWhat, mine)) continue;

      const scales = scalesFor(actor, other);
      const amount = resolve ? resolve(effect.value, scales.level, scales) : (effect.value?.flat ?? null);
      if (typeof amount !== "number" || !amount) continue;

      const scoped = String(effect.appliesToRoll ?? "");
      if (scoped) {
        // Named a throw: it applies to that one and to no other.
        if (roll && roll.key === scoped) out.bonus += amount;
        continue;
      }
      if (effect.condition) out.pending.push({ name: other.name, amount, condition: effect.condition });
      else out.bonus += amount;
    }
  }
  return out;
}

/**
 * A number with its sign always shown, the way a modifier is written.
 */
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

/**
 * Is this throw a MEASURE — dice with nothing to beat? The one predicate every
 * surface asks; a measure and an unresolved target both carry a null target.
 */
export const measures = (roll) => isMeasure(roll?.rollType);

/**
 * What a throw is called when it has no label of its own: the unnamed-throw
 * wording, or the unnamed-measure wording for a measure.
 */
export const labelOf = (roll) =>
  roll?.label || game.i18n.localize(measures(roll) ? "ACKS-ABILITIES.roll.unnamedMeasure" : "ACKS-ABILITIES.roll.unnamed");

/**
 * What an ability score contributes to this throw — its modifier times
 * `times` — or null when the throw declares no score or there is no character.
 *
 * @param {object} roll the throw
 * @param {Actor} actor the character holding it
 * @returns {{key: string, label: string, times: number, mod: number, bonus: number}|null}
 */
export function scoreTerm(roll, actor) {
  const key = roll?.score?.key;
  if (!key || !actor) return null;
  const mod = abilityMod(actor, key);
  const raw = Number(roll.score.times ?? 1);
  // A blank multiplier reads as once, never as zero.
  const times = Number.isFinite(raw) ? raw : 1;
  return { key, label: ATTRIBUTES[key]?.label ?? key.toUpperCase(), times, mod, bonus: mod * times };
}

/**
 * Does a throw's score term move its target? Not on an exact-match throw or a
 * measure, where the term is stated rather than applied. Every surface that
 * prints the term asks here.
 */
export const scoreApplies = (roll) => {
  const type = roll?.rollType || "above";
  return type !== "result" && type !== "measure";
};

/**
 * A score term as one line — "WIL +2", or "WIL +2 × 4 = +8" when multiplied —
 * written as the modifier, not the target it moved. Given a throw the term does
 * not move, the line says where it lands instead: in a measure's result, or
 * nowhere on an exact-match throw.
 */
export function scoreText(term, roll = null) {
  const written = scoreWritten(term);
  if (!written || !roll || scoreApplies(roll)) return written;
  const key = measures(roll) ? "ACKS-ABILITIES.roll.scoreInResult" : "ACKS-ABILITIES.roll.scoreUnapplied";
  return game.i18n.format(key, { term: written });
}

/** The term as the modifier it is written as, with no claim about the target. */
function scoreWritten(term) {
  if (!term) return "";
  const where = { score: term.label, mod: signed(term.mod) };
  return term.times === 1
    ? game.i18n.format("ACKS-ABILITIES.roll.scoreTerm", where)
    : game.i18n.format("ACKS-ABILITIES.roll.scoreTermTimes", { ...where, times: term.times, total: signed(term.bonus) });
}

/**
 * What a throw comes to for this character — the whole verdict, read at the
 * roll's own `scale` and resolved through the classes registry (which completes
 * the `progression` kind lib cannot see).
 *
 * @returns {{outcome: string, target: number|null, text: string}}
 *   `outcome` is "throw" (roll against `target`), "auto" (no roll — it happens)
 *   or "none" (not available to this character yet); `text` is the printed cell.
 */
export function throwOutcome(roll, actor, item) {
  const none = (target = null, text = "") => ({ outcome: "throw", target, text });
  // A measure has no target, whatever the target fields still hold.
  if (measures(roll)) return none();
  const target = roll?.target;
  const scales = scalesFor(actor, item);
  const at = scales[roll?.scale || "level"];
  // A scale nothing here supplies (Arcane Value, Hit Dice): a flat target still
  // answers; a ladder does not, and the sheet shows it whole.
  if (at == null) return none((target?.kind ?? "flat") === "flat" ? (target?.flat ?? null) : null);

  let verdict;
  try {
    verdict = resolveLevelOutcome(target, at, scales);
  } catch (err) {
    console.error(`${MODULE_ID} | could not resolve a throw's target`, err);
    return none(target?.flat ?? null);
  }
  if (verdict.outcome !== "throw") return verdict;
  return { ...verdict, target: withModifiers(verdict.target, roll, actor, item) };
}

/**
 * How a throw READS on a control — "15+", "3-", "12", a measure's dice, the
 * cell a lettered rung prints, or "—" when nothing resolved.
 *
 * THE one place this string is built, for all four surfaces that show it (the
 * Rolls tab, the expanded row's tag strip, Favorites, the cycle control's
 * tooltip).
 */
export function throwText(roll, actor, item) {
  if (measures(roll)) return roll?.formula || "1d20";
  const { outcome, target, text } = throwOutcome(roll, actor, item);
  if (outcome !== "throw") return text || (outcome === "auto" ? game.i18n.localize("ACKS-ABILITIES.roll.autoShort") : "—");
  if (target == null) return text || "—";
  const type = roll?.rollType || "above";
  return `${target}${type === "below" ? "-" : type === "result" ? "" : "+"}`;
}

/**
 * Resolve a roll's target number, or null when it cannot be known here — the
 * number half of `throwOutcome`. An automatic or unavailable rung has none.
 */
export const targetOf = (roll, actor, item) => throwOutcome(roll, actor, item).target;

/**
 * A resolved target with the character's standing bonuses folded in: other
 * abilities' modifiers and the throw's score term. A bonus lowers an "above"
 * target and raises a "below" one; an exact-match throw takes neither. Applied
 * here, once, so every surface reads the same number.
 */
function withModifiers(target, roll, actor, item) {
  if (typeof target !== "number" || !actor) return target;
  const bonus = throwModifiers(actor, item, roll).bonus + (scoreTerm(roll, actor)?.bonus ?? 0);
  if (!bonus) return target;
  const type = roll?.rollType || "above";
  if (type === "result") return target;
  return type === "below" ? target + bonus : target - bonus;
}

/**
 * Every roll an ability offers — THE read path. Folds core's singleton fields
 * in when this module's store is empty; core's schema defaults (`1d20`,
 * target 0) are not a roll.
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
 * The handle a roll answers to: its stored key, or `roll<index>` when it has
 * none. The one rule every lookup uses — never gate a lookup on the stored key
 * alone.
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
 * Give every roll a unique key. An existing key is never rewritten (macros and
 * importing modules hold it), and all existing keys are claimed before blank
 * ones are filled from labels.
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

/**
 * The key of the throw a bare roll reaches — the stored default, or the first.
 * A stored key naming no current throw (deleted, or re-imported away) reads as
 * the first; it is resolved on read, never repaired on write.
 */
export function defaultKeyOf(item) {
  const rolls = rollsOf(item);
  if (!rolls.length) return null;
  const stored = item?.getFlag(MODULE_ID, FLAG_EXTRAS)?.defaultRoll || "";
  const found = rolls.findIndex((r, i) => keyOf(r, i) === stored);
  return found >= 0 ? stored : keyOf(rolls[0], 0);
}

/** Make one throw the ability's default. Writes the key, never the index, so a reorder cannot move it. */
export async function setDefaultKey(item, key) {
  const raw = foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {});
  raw.defaultRoll = String(key ?? "");
  await item.update({ [`flags.${MODULE_ID}.${FLAG_EXTRAS}`]: AbilityExtras.normalize(raw) });
  return raw.defaultRoll;
}

/** The throw AFTER the current default, wrapping — what the cycle control steps to. */
export function nextKeyAfter(item, key) {
  const rolls = rollsOf(item);
  if (rolls.length < 2) return null;
  const keys = rolls.map((r, i) => keyOf(r, i));
  const at = keys.indexOf(key);
  return keys[(at + 1) % keys.length];
}

/** A new, empty roll — what "add a roll" puts in the list. */
export const blankRoll = () => ({
  key: "",
  label: "",
  formula: "1d20",
  rollType: "above",
  target: { kind: "flat", flat: null },
  scale: "level",
  score: { key: "", times: 1 },
  condition: "",
  note: "",
});

/** Every roll, as a detached copy safe to mutate and hand back to writeRolls. */
export const readRolls = (item) => foundry.utils.deepClone(rollsOf(item));

/**
 * Persist an ability's rolls — THE write path. Settles keys first. An emptied
 * list also resets core's singleton roll fields to their schema initials, or
 * rollsOf() would fold the deleted throw back in.
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
 * The chat message mode for an ability's throws: "blind" when core's
 * ability-wide `system.blindroll` is set ("self" for a GM, as core's
 * `AcksDice.#sendRoll` does), else undefined for the seat's default. Mode names
 * are Foundry 14's `CONFIG.ChatMessage.modes` keys.
 */
function messageModeFor(item) {
  if (!item?.system?.blindroll) return undefined;
  return game.user?.isGM ? "self" : "blind";
}

/**
 * A throw's formula, or "1d20" when it is blank or unparseable. An unparseable
 * one also warns, naming the throw — Foundry's parser would otherwise throw
 * inside this async roller as an unhandled rejection.
 */
function rollableFormula(roll, item) {
  const formula = String(roll?.formula ?? "").trim();
  if (!formula) return "1d20";
  if (Roll.validate(formula)) return formula;
  ui.notifications.warn(
    game.i18n.format("ACKS-ABILITIES.roll.badFormula", {
      name: [item?.name, roll?.label].filter(Boolean).join(" — ") || labelOf(roll),
      formula,
    }),
  );
  return "1d20";
}

/**
 * The formula to roll: a measure's dice with its score term appended (in the
 * formula, not the total, so Foundry's dice box agrees); any other throw's
 * formula unchanged — its score is already in the target.
 */
function measuredFormula(roll, item, actor) {
  const formula = rollableFormula(roll, item);
  if (!measures(roll)) return formula;
  const bonus = scoreTerm(roll, actor)?.bonus ?? 0;
  return bonus ? `${formula} ${signed(bonus)}` : formula;
}

/**
 * The system's OWN throw card — the template it posts every save, reaction and
 * exploration roll through. Nothing here re-templates it, so a system restyle
 * carries ability throws along. See docs/abilities/DECISIONS.md, "A
 * proficiency throw wears the system's own chat card".
 */
const CARD_TEMPLATE = "systems/acks/templates/chat/roll-result.hbs";

/** Text safe to drop into the card's `{{{triple-stashed}}}` details slot. */
const esc = (text) => foundry.utils.escapeHTML?.(text) ?? text;

/**
 * Why a scored throw has no target — a shared world item (no character to read
 * against), or an owned one below its ladder's first rung — or "" when it has
 * one.
 */
function missingTargetText(target, actor) {
  if (target != null) return "";
  return game.i18n.localize(actor ? "ACKS-ABILITIES.roll.noRung" : "ACKS-ABILITIES.roll.noTarget");
}

/**
 * The card's context in the shape core's template reads. The target rides
 * core's success row; the details slot carries the natural die behind a total
 * that is more than dice, the throw's condition and any unresolved-target
 * reason. A measure is unscored and carries no target line.
 */
async function cardData(item, actor, roll, { target, success, suffix, verdict, evaluated }) {
  const term = scoreTerm(roll, actor);
  const outcome = verdict?.outcome ?? "throw";
  const details = [
    evaluated ? esc(auditLine(evaluated)) : "",
    // An automatic or unavailable rung prints its cell, not a missing-target line.
    outcome !== "throw"
      ? esc(
          game.i18n.format(outcome === "auto" ? "ACKS-ABILITIES.roll.autoDetail" : "ACKS-ABILITIES.roll.noneDetail", {
            cell: verdict.text || "—",
          }),
        )
      : measures(roll)
        ? ""
        : esc(missingTargetText(target, actor)),
    // Names the score term that moved the target.
    term ? esc(scoreText(term, roll)) : "",
    roll.condition ? `<em>${esc(roll.condition)}</em>` : "",
  ].filter(Boolean).join("<br>");

  return {
    title: [item.name, roll.label].filter(Boolean).join(" — "),
    // The card carries its own dice: Foundry substitutes roll HTML only for
    // content with no child elements, and this template opens with a section.
    rollACKS: evaluated ? await evaluated.render() : null,
    data: {
      item: { img: item.img },
      actor: { img: actor?.img ?? item.img },
      // Core's template hides a blind card's body; the message mode withholds it.
      roll: { blindroll: !!item.system?.blindroll },
    },
    result: {
      details,
      isSuccess: success === true,
      isFailure: success === false,
      // On an automatic rung the success row carries the printed cell.
      target: outcome === "auto" ? verdict.text : target == null ? "" : `${target}${suffix}`,
    },
  };
}

/**
 * Roll one of an ability's throws (its default when `key` is omitted) and post
 * the result. The one place an ability's throw is posted, so blind applies
 * wherever the roll started. Success is scored only when a target is known; a
 * measure's total is the whole answer.
 *
 * A throw asks for a situational modifier first, unless `skipDialog` is true
 * or the system's skip key is held on `event`; the modifier joins the formula
 * as its own term, never the target. A rung with nothing to roll asks nothing.
 *
 * @param {Item} item
 * @param {string} [key] the throw; the ability's default when omitted
 * @param {object} [opts]
 * @param {Event} [opts.event]          the gesture that asked, read for the skip key
 * @param {boolean} [opts.skipDialog]   true rolls without asking
 * @param {number} [opts.bonus]         the situational modifier, or what the dialog opens on
 * @param {string} [opts.messageMode]   the visibility, or what the dialog opens on; a blind ability overrides it
 * @returns {Promise<{total: number|null, target: number|null, success: boolean|null, outcome: string}|null>}
 *   null when the ability has no throw or the dialog was closed
 */
export async function rollAbility(item, key, { event, skipDialog, bonus = 0, messageMode } = {}) {
  const rolls = rollsOf(item);
  // No key means the default throw: every route that cannot pass one arrives so.
  const wanted = key ?? defaultKeyOf(item);
  const roll = rolls.find((r, i) => keyOf(r, i) === wanted) ?? rolls[0];
  if (!roll) return null;
  const actor = item.actor ?? null;
  const verdict = throwOutcome(roll, actor, item);

  // An unavailable rung posts nothing; the clicker is told why.
  if (verdict.outcome === "none") {
    ui.notifications.info(
      game.i18n.format("ACKS-ABILITIES.roll.notAvailable", {
        name: [item.name, roll.label].filter(Boolean).join(" — "),
        cell: verdict.text || "—",
      }),
    );
    return { total: null, target: null, success: null, outcome: "none" };
  }

  // A blind ability's mode is the ability's, not the roller's.
  const forced = messageModeFor(item);
  let mode = forced ?? messageMode;

  // An automatic rung posts its card with no dice.
  if (verdict.outcome === "auto") {
    await postAutomatic(item, actor, roll, verdict, mode);
    return { total: null, target: null, success: true, outcome: "auto" };
  }

  const target = verdict.target;
  const type = roll.rollType || "above";
  const base = measuredFormula(roll, item, actor);
  let extra = Math.trunc(Number(bonus)) || 0;
  if (!skipDialogFor(event, skipDialog)) {
    const asked = await rollDetailsDialog({
      title: [item.name, roll.label].filter(Boolean).join(" — "),
      formula: base,
      messageMode: mode,
      lockMode: !!forced,
      bonus: extra,
      hint: type === "below" ? game.i18n.localize("ACKS-ABILITIES.roll.belowHint") : "",
    });
    if (!asked) return null;
    extra = asked.bonus;
    mode = asked.messageMode;
  }
  const evaluated = await new Roll(`${base}${situationalTerm(extra)}`).evaluate();
  const total = evaluated.total;
  const success = target == null ? null : type === "below" ? total <= target : type === "result" ? total === target : total >= target;

  const suffix = type === "above" ? "+" : type === "below" ? "-" : "";

  // The card, or a plain line when it cannot render (a moved or renamed core
  // template): a missing template costs the throw its banner, never its result.
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      await cardData(item, actor, roll, { target, success, suffix, verdict, evaluated }),
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not render ${CARD_TEMPLATE}; posting the throw without its card`, err);
  }

  const label = [item.name, roll.label].filter(Boolean).join(" — ");
  const targetText = measures(roll)
    ? ""
    : target == null
      ? missingTargetText(target, actor)
      : `${game.i18n.localize("ACKS-ABILITIES.roll.target")} ${target}${suffix}`;
  const word =
    success == null ? "" : success ? game.i18n.localize("ACKS-ABILITIES.roll.success") : game.i18n.localize("ACKS-ABILITIES.roll.failure");

  await evaluated.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      // The card renders the dice (`rollACKS`); the Roll is still attached for
      // Dice So Nice and roll inspection.
      ...(content
        ? { content }
        : {
            flavor: `${esc(label)}${
              targetText || word
                ? `<br><span class="acks-abilities-roll-target">${targetText}${
                    word ? `${targetText ? " — " : ""}<strong>${word}</strong>` : ""
                  }</span>`
                : ""
            }${roll.condition ? `<br><em>${esc(roll.condition)}</em>` : ""}`,
          }),
    },
    // undefined falls through to the seat's own default.
    { messageMode: mode },
  );
  return { total, target, success, outcome: "throw" };
}

/**
 * The card for a rung that needs no throw — same banner, no dice — posted as a
 * plain message because there is no Roll. Blind applies.
 */
async function postAutomatic(item, actor, roll, verdict, messageMode) {
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      await cardData(item, actor, roll, { target: null, success: true, suffix: "", verdict }),
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not render ${CARD_TEMPLATE}; posting the automatic result without its card`, err);
  }
  const label = [item.name, roll.label].filter(Boolean).join(" — ");
  await ChatMessage.create(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      ...(content
        ? { content }
        : {
            content: `<p>${esc(label)} — <strong>${esc(
              game.i18n.format("ACKS-ABILITIES.roll.autoDetail", { cell: verdict.text || "—" }),
            )}</strong></p>`,
          }),
    },
    { messageMode },
  );
}
