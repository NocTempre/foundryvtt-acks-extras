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
import { slug, ATTRIBUTES, isMeasure } from "../lib/vocab.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
// The classes registry, not lib: lib returns null for the `progression` kind
// by design (it cannot see the world's class documents), and a throw that
// borrows a published ladder is exactly that kind.
import { resolveLevelOutcome } from "../classes/registry.mjs";

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

/** The vocabulary key a proficiency-throw modifier is written against. */
const THROW_TARGET = "proficiencyThrow";

/** Does `forWhat` name this ability? Splits the "A and B" the books write. */
const namesActivity = (forWhat, wanted) =>
  String(forWhat)
    .split(/\s*(?:,|\band\b|\bor\b|&|\/)\s*/i)
    .some((part) => slug(part) === wanted);

/**
 * What this character's abilities do to THIS ability's throws.
 *
 * The books state a great many of these — Lockpicking Expertise gives "+2 on
 * Lockpicking proficiency throws", a methodical attempt gives +4 on its own
 * throw — and they are extracted onto the granting ability as modifiers naming
 * the activity they apply to. Nothing read them, so every one of them sat
 * inert: a character holding both Lockpicking and Lockpicking Expertise showed
 * the bare class ladder, and the Lockbreaker template grants exactly that pair.
 *
 * Two rules keep this from over-applying:
 *
 * - **One ability, counted once.** Holding a proficiency twice is RANK (RR
 *   §III.3 — the target drops by 4 per selection), which the ladder's `rank`
 *   scale already answers. Iterating both copies would apply the bonus twice
 *   and then let the ladder apply it again.
 * - **A modifier must NAME what it modifies.** An unattributed "+2 to
 *   proficiency throws" is not evidence of anything: it is what the importer's
 *   generic scan leaves behind when it drops the activity from the sentence,
 *   and applying those to every throw would give a character every bonus in
 *   their list on every roll they make.
 *
 * A modifier scoped to ONE way of attempting the thing names that throw
 * (`appliesToRoll`), and the name is the guard: "methodical" is a key, not a
 * reading of prose. Deciding it from `condition` instead would get Lockpicking
 * wrong, whose condition names both of its throws in a single string
 * ("methodical attempt (one turn); not a hasty attempt").
 *
 * A modifier that is conditioned but names no throw is a gap in what was
 * captured, not a modifier to guess at; it is returned unapplied so a caller
 * can say so rather than silently dropping it.
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
      // A penalty an ability imposes on its VICTIMS is not one its holder
      // suffers. Without this the two are indistinguishable and the ability
      // reads inverted.
      if ((effect.appliesTo ?? "self") !== "self") continue;
      if (effect.mode && effect.mode !== "add") continue;
      // A modifier may name more than one activity — the books state plenty
      // as "on Hiding and Sneaking proficiency throws" — so the field holds a
      // list and any member matching is a match.
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
 * Is this throw a MEASURE — dice with nothing to beat?
 *
 * The one predicate every surface asks, so the sheet row, the tag strip,
 * Favorites, the editor's preview and the chat card cannot disagree about
 * whether a throw has a target at all. A measure is not "a throw whose target
 * failed to resolve": the two look identical from a null and read completely
 * differently, which is the bug this distinction removes.
 */
export const measures = (roll) => isMeasure(roll?.rollType);

/**
 * What a throw is CALLED when the book gave it no name of its own.
 *
 * "Proficiency throw" is right for a throw that is one and wrong for a measure,
 * which is not thrown against anything — an ability's effect roll labelled as a
 * proficiency throw reads as a second attempt at the first one.
 */
export const labelOf = (roll) =>
  roll?.label || game.i18n.localize(measures(roll) ? "ACKS-ABILITIES.roll.unnamedMeasure" : "ACKS-ABILITIES.roll.unnamed");

/**
 * What an ability score contributes to this throw — null when the throw
 * declares none, or when there is no character whose score to read.
 *
 * A throw's score term is written two ways: the modifier itself, and a multiple
 * of it. One multiplier covers both, so `times` is 1 for the plain case and
 * nothing has to be typed for it.
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
  // A blank multiplier is "once", not "never": the field is left empty far more
  // often than it is set, and reading it as 0 would silently cancel the score
  // the reader just chose.
  const times = Number.isFinite(raw) ? raw : 1;
  return { key, label: ATTRIBUTES[key]?.label ?? key.toUpperCase(), times, mod, bonus: mod * times };
}

/**
 * Does a throw's score term actually move its target?
 *
 * An exact-match throw takes no modifier at all — there is no "easier" to be
 * had — so a score declared on one is stated rather than applied. Every surface
 * that prints the term asks HERE, so none of them can announce a bonus the
 * target does not carry.
 */
export const scoreApplies = (roll) => {
  const type = roll?.rollType || "above";
  return type !== "result" && type !== "measure";
};

/**
 * A score term as one line — "WIL +2", or "WIL +2 × 4 = +8" when it is
 * multiplied. Written as the MODIFIER it is, not as the target it moved: the
 * target is printed beside it and the two read as one sentence.
 *
 * Where the term LANDS differs by throw, and the line has to say which, because
 * all three look identical otherwise. A scored throw carries it in the target
 * printed beside it. A MEASURE has no target, so it carries it in the result —
 * `measuredFormula` puts it in the dice. An exact-match throw carries it
 * nowhere, and says so rather than stating a bonus that does nothing.
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
 * What a throw comes to for this character — the WHOLE verdict, not a number.
 *
 * A target is read at the roll's OWN scale. Animal Husbandry's diagnosis ladder
 * is rated by rank, so reading it at the character's class level answers a
 * question nobody asked — a 5th-level character who took the proficiency once
 * would diagnose on the third rung. `scale` is what the sheet already labels the
 * ladder with; it is what the ladder is read at too.
 *
 * A number is not always the answer. A printed progression may say the throw is
 * not made at all — a rung the character cannot act on, or one where the result
 * simply happens. Those rungs reach the roller through `outcome`, so an
 * automatic result is not rolled for and an unavailable one is not offered as
 * though it were merely unresolved.
 *
 * Resolution goes through the CLASSES registry, not through lib. lib returns
 * null for the `progression` kind by design — it cannot see the world's class
 * documents — so a throw borrowing a published ladder resolved to nothing at
 * all and read as a throw with no target. The registry completes exactly that
 * kind and defers to lib for the rest, which is what makes a borrowed table
 * resolve at roll time and not only in the picker.
 *
 * @returns {{outcome: string, target: number|null, text: string}}
 *   `outcome` is "throw" (roll against `target`), "auto" (no roll — it happens)
 *   or "none" (not available to this character yet); `text` is the printed cell.
 */
export function throwOutcome(roll, actor, item) {
  const none = (target = null, text = "") => ({ outcome: "throw", target, text });
  // A measure has no target by construction, whatever a previous edit left in
  // the target fields. Answering from those would score a quantity against a
  // number nobody rolled towards.
  if (measures(roll)) return none();
  const target = roll?.target;
  const scales = scalesFor(actor, item);
  const at = scales[roll?.scale || "level"];
  // A scale nothing here can supply (Arcane Value, Hit Dice — no consumer
  // computes them yet). A flat target still answers; a ladder does not, and the
  // sheet shows the whole ladder rather than a number read at the wrong rung.
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
 * THE one place this string is built. Four surfaces show it (the Rolls tab, the
 * expanded row's tag strip, Favorites, the cycle control's tooltip) and they
 * used to build it three different ways, which is how a measure came to read as
 * `?` on one and `—` on another.
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
 * Resolve a roll's target number, or null when it cannot be known here.
 *
 * The number half of `throwOutcome`, kept because most callers only want the
 * number and asking through one function is what stops them disagreeing. An
 * automatic or unavailable rung has no target, and says so by having none.
 */
export const targetOf = (roll, actor, item) => throwOutcome(roll, actor, item).target;

/**
 * A resolved target with the character's standing bonuses folded in — what
 * their other abilities give this throw, and the ability score it is written
 * against.
 *
 * The books state these as bonuses to the ROLL; the sheet shows a target, and
 * the two are the same statement read from opposite ends — so a bonus lowers a
 * throw that must reach its target and raises one that must stay under it. An
 * exact-match throw takes neither: there is no "easier" to be had.
 *
 * Applied HERE rather than at each caller, so the strip, the roller, the chat
 * card and Favorites cannot disagree about what a throw comes to.
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

/**
 * The key of the throw a bare roll reaches — the stored default, or the first.
 *
 * Resolved leniently on READ rather than repaired on write, because the two
 * things that invalidate a default (the throw deleted, the ability re-imported
 * with a different set) both leave a key naming nothing, and an ability that
 * silently rolls its first throw is better than one that rolls nothing.
 */
export function defaultKeyOf(item) {
  const rolls = rollsOf(item);
  if (!rolls.length) return null;
  const stored = item?.getFlag(MODULE_ID, FLAG_EXTRAS)?.defaultRoll || "";
  const found = rolls.findIndex((r, i) => keyOf(r, i) === stored);
  return found >= 0 ? stored : keyOf(rolls[0], 0);
}

/**
 * Make one throw the ability's default. Writes the KEY, never the index — a
 * later edit that reorders or inserts a throw must not move the default onto a
 * different one.
 */
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
      name: [item?.name, roll?.label].filter(Boolean).join(" — ") || labelOf(roll),
      formula,
    }),
  );
  return "1d20";
}

/**
 * A measure's dice with its score term folded in — appended to the formula.
 *
 * On a SCORED throw a score moves the target, which is where `targetOf` puts
 * it. A measure has no target to move, so the only place the term can land is
 * the result, and it has to land in the FORMULA rather than on the total:
 * `toMessage` attaches the Roll and Foundry renders that Roll's own dice box,
 * so a total adjusted afterwards would be contradicted by the box beside it.
 *
 * Every other throw is returned untouched — a score is already inside its
 * target, and adding it here would apply it twice.
 */
function measuredFormula(roll, item, actor) {
  const formula = rollableFormula(roll, item);
  if (!measures(roll)) return formula;
  const bonus = scoreTerm(roll, actor)?.bonus ?? 0;
  return bonus ? `${formula} ${signed(bonus)}` : formula;
}

/**
 * The system's OWN throw card — the template it posts every save, reaction and
 * exploration roll through, and the sibling of the one attacks use.
 *
 * Reused rather than reproduced: a proficiency throw is a throw, and it should
 * arrive wearing the same banner, portrait and success rule as everything else
 * the table rolls. Posting it as a bare flavour line is what made it the one
 * roll with no headline. Nothing here re-templates the card, so a system that
 * restyles its chat carries this along with it.
 */
const CARD_TEMPLATE = "systems/acks/templates/chat/roll-result.hbs";

/** Text safe to drop into the card's `{{{triple-stashed}}}` details slot. */
const esc = (text) => foundry.utils.escapeHTML?.(text) ?? text;

/**
 * Why a SCORED throw came up with no target — "" when it has one.
 *
 * Two different failures reach the same null and they are not the same news: a
 * shared world item has no character to read a ladder against, while an owned
 * one whose ladder starts above this character's level is a throw they cannot
 * yet make. Telling the reader the first when the second happened sends them
 * looking for a copy on a character they are already looking at.
 */
function missingTargetText(target, actor) {
  if (target != null) return "";
  return game.i18n.localize(actor ? "ACKS-ABILITIES.roll.noRung" : "ACKS-ABILITIES.roll.noTarget");
}

/**
 * The card's context, in the shape core's template reads.
 *
 * The target rides the SUCCESS row (`Success (14+)`) rather than a line of its
 * own — core's template already prints it there, and stating it twice is how
 * the old flavour line read. The details slot is left for what core has no
 * field for: the condition the book puts on the throw, and the reason a target
 * could not be resolved.
 *
 * A MEASURE has none of that. It is not scored, so no success row, no target,
 * and above all no explanation of a missing one — "no target on a shared item"
 * over a quantity roll reads as a defect in a throw that worked as written.
 */
function cardData(item, actor, roll, { target, success, suffix, verdict }) {
  const term = scoreTerm(roll, actor);
  const outcome = verdict?.outcome ?? "throw";
  const details = [
    // An automatic rung is not a missing target — the page prints a cell there
    // saying no throw is made, and the cell is quoted rather than paraphrased.
    outcome !== "throw"
      ? esc(
          game.i18n.format(outcome === "auto" ? "ACKS-ABILITIES.roll.autoDetail" : "ACKS-ABILITIES.roll.noneDetail", {
            cell: verdict.text || "—",
          }),
        )
      : measures(roll)
        ? ""
        : esc(missingTargetText(target, actor)),
    // The score is already inside the target, so the line is there to say WHY
    // the target moved — a throw that reads 4+ on one character and 6+ on
    // another is otherwise unexplained at the table.
    term ? esc(scoreText(term, roll)) : "",
    roll.condition ? `<em>${esc(roll.condition)}</em>` : "",
  ].filter(Boolean).join("<br>");

  return {
    title: [item.name, roll.label].filter(Boolean).join(" — "),
    data: {
      item: { img: item.img },
      actor: { img: actor?.img ?? item.img },
      // Core's template hides the body of a blind card behind this; the message
      // mode below is what actually withholds it. Both read the same field.
      roll: { blindroll: !!item.system?.blindroll },
    },
    result: {
      details,
      isSuccess: success === true,
      isFailure: success === false,
      // The SUCCESS row carries the target, and on an automatic rung it carries
      // the cell the page prints instead — "Success (D)" is the table's own
      // answer, where "Success ()" would read as a number that failed to load.
      target: outcome === "auto" ? verdict.text : target == null ? "" : `${target}${suffix}`,
    },
  };
}

/**
 * Roll one of an ability's rolls and post the result.
 *
 * Success is reported only when a target is known. On a shared world item there
 * is no character to resolve a ladder against, so the roll still happens and
 * the result stands on its own rather than being scored against a guess. A
 * MEASURE stands on its own by construction — it is asked "how much", and the
 * total is the whole answer.
 *
 * THE one place an ability's throw is posted — the Rolls tab's buttons and
 * core's own roll path (through roll-wrap.mjs) both arrive here — so blind is
 * honoured wherever the roll was started from.
 */
export async function rollAbility(item, key) {
  const rolls = rollsOf(item);
  // No key names the ability's DEFAULT throw, not its first. Every route that
  // cannot pass one — the row's icon, the chat card's button, `item.use()`, a
  // macro — arrives here that way, so the choice has to be honoured at the
  // bottom rather than at each of them.
  const wanted = key ?? defaultKeyOf(item);
  const roll = rolls.find((r, i) => keyOf(r, i) === wanted) ?? rolls[0];
  if (!roll) return null;
  const actor = item.actor ?? null;
  const verdict = throwOutcome(roll, actor, item);

  // A rung the character has not reached is not a throw that failed — it is a
  // throw the page does not offer them. Rolling anyway would post a failure
  // they can never turn into a success, so the clicker is told and nothing
  // reaches the table.
  if (verdict.outcome === "none") {
    ui.notifications.info(
      game.i18n.format("ACKS-ABILITIES.roll.notAvailable", {
        name: [item.name, roll.label].filter(Boolean).join(" — "),
        cell: verdict.text || "—",
      }),
    );
    return { total: null, target: null, success: null, outcome: "none" };
  }

  // An AUTOMATIC rung makes no throw at all: the table says the result happens.
  // Posting a d20 beside it would invite the table to read the die as the thing
  // that decided it.
  if (verdict.outcome === "auto") {
    await postAutomatic(item, actor, roll, verdict);
    return { total: null, target: null, success: true, outcome: "auto" };
  }

  const target = verdict.target;
  const evaluated = await new Roll(measuredFormula(roll, item, actor)).evaluate();
  const type = roll.rollType || "above";
  const total = evaluated.total;
  const success = target == null ? null : type === "below" ? total <= target : type === "result" ? total === target : total >= target;

  const suffix = type === "above" ? "+" : type === "below" ? "-" : "";

  // The card, or the plain line it replaced. A system that has moved or renamed
  // its chat template must cost the throw its banner, never its result — this
  // roller is the ONE place an ability's throw is posted, so a throw here is a
  // throw the player already made.
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      cardData(item, actor, roll, { target, success, suffix, verdict }),
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
      // The card carries the throw's own dice display; `toMessage` attaches the
      // Roll either way, so the card deliberately renders WITHOUT `rollACKS` and
      // lets the message show the one box every other roll shows.
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
    // An undefined mode falls through to the seat's own default, which is what
    // toMessage does when nothing is passed at all.
    { messageMode: messageModeFor(item) },
  );
  return { total, target, success, outcome: "throw" };
}

/**
 * The card for a rung that needs no throw — same banner, no dice.
 *
 * Posted as a plain message rather than through `Roll#toMessage`, because there
 * is no Roll: the table's answer is the cell, and attaching a die to it would
 * put a number on screen that decided nothing. Blind is honoured the same way,
 * since an automatic result is still a result the GM may be withholding.
 */
async function postAutomatic(item, actor, roll, verdict) {
  let content = null;
  try {
    content = await foundry.applications.handlebars.renderTemplate(
      CARD_TEMPLATE,
      cardData(item, actor, roll, { target: null, success: true, suffix: "", verdict }),
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
    { messageMode: messageModeFor(item) },
  );
}
