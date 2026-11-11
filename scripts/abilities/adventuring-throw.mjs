/**
 * The target a character has for an Adventuring throw: the better of the
 * Adventuring proficiency's own figure and the throw of the skill that covers
 * the same activity, with the character's bonuses to it.
 *
 * `system.adventuring` is a stored field nothing class- or level-driven ever
 * writes, so on its own it reads the system's defaults at every level. A skill
 * the character holds (Searching, Listening, Trapbreaking) carries a ladder
 * resolved at the character's level by the abilities roller (`throwOutcome`),
 * the one reading every ability surface shares. This file joins the two: it
 * holds no figure and no ladder, only which skill throw answers which
 * Adventuring key. Climbing and Dungeonbashing have no skill throw, so they
 * stay the stored figure.
 *
 * Two more things reach an Adventuring figure. An ability that stands in for
 * the Adventuring throw where the character holds no skill (the `searchListen`
 * throw of an Alertness-like ability, a target in place of the stored one), and
 * the `modifies` rows that name the activity without needing the skill held
 * (Trapfinding's), which lower whichever Adventuring figure answers. Both come
 * out of the abilities' own rows; nothing here names an ability.
 *
 * The figure is the one BEFORE the creature's conditions. The throw's wrapper
 * (`lib/patches/adventuring-roll.mjs`, through `withAdventuringConditions`)
 * applies them once, to whatever figure the throw is rolled against.
 */
import { rollsOf, keyOf, measures, throwOutcome, defaultKeyOf, citeOf, modifiesParts } from "./ability-rolls.mjs";
import { itemHasCapability } from "../lib/capabilities.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { isAdventuring } from "../classes/grants.mjs";

/**
 * The skill throw behind each Adventuring key: the capability token that names
 * the skill, and the key of the throw within it. A null throw key takes the
 * skill's own first throw, for a skill that has only the one.
 */
export const ADVENTURING_SKILLS = Object.freeze({
  listening: Object.freeze({ token: "kw:listening", rollKey: null }),
  searching: Object.freeze({ token: "kw:searching", rollKey: "methodical" }),
  trapbreaking: Object.freeze({ token: "kw:trapbreaking", rollKey: "methodical" }),
});

/**
 * The ability that stands in for the Adventuring throw where no skill is held:
 * the capability token the ability provides, and the key of its throw. Search
 * and listen only; the throw replaces the stored figure, it is not added to it.
 */
export const ADVENTURING_STAND_INS = Object.freeze({
  listening: Object.freeze({ token: "kw:alertness", rollKey: "searchListen" }),
  searching: Object.freeze({ token: "kw:alertness", rollKey: "searchListen" }),
});

/** A target that is the importer's flat figure rather than a ladder or a rank row. */
const isFlat = (target) => typeof target === "number" || (target?.kind ?? "flat") === "flat";

/**
 * One throw of an ability, resolved for the actor before conditions, or null
 * when the item has no such throw or it is not a plain "roll this or higher"
 * with a figure. A flat target of zero or less is the importer's "no number
 * read" sentinel and is no figure.
 *
 * @param {Actor} actor
 * @param {Item} item the ability
 * @param {string|null} rollKey the throw's key; null takes the first throw that is not a measure
 * @param {object} [opts]
 * @param {boolean} [opts.fallback=false] a key the item has no throw for reads its default throw instead
 * @returns {{item: Item, itemId: string, rollKey: string, target: number, name: string, cite: string,
 *   parts: Array<{kind: string, label: string, value: number, cite: string}>, scaled: boolean}|null}
 *   `scaled` is true where the figure moves with level or rank
 */
export function skillThrow(actor, item, rollKey, { fallback = false } = {}) {
  const rolls = rollsOf(item);
  let index = rolls.findIndex((r, i) => (rollKey ? keyOf(r, i) === rollKey : !measures(r)));
  if (index < 0 && fallback) index = rolls.findIndex((r, i) => keyOf(r, i) === defaultKeyOf(item));
  const roll = rolls[index];
  if (!roll || (roll.rollType || "above") !== "above") return null;
  const { outcome, target, parts } = throwOutcome(roll, actor, item, { conditions: false });
  if (outcome !== "throw" || !Number.isFinite(target)) return null;
  const scaled = !isFlat(roll.target);
  if (!scaled && !(Number(typeof roll.target === "number" ? roll.target : roll.target?.flat) > 0)) return null;
  return { item, itemId: item.id, rollKey: keyOf(roll, index), target, name: item.name, cite: citeOf(item), parts: parts ?? [], scaled };
}

/**
 * The best (lowest) throw of the actor's held abilities that provide `token`,
 * at `rollKey`; never the Adventuring proficiency itself.
 */
function bestThrow(actor, token, rollKey, { allow, fallback = false } = {}) {
  let best = null;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability || isAdventuring(item) || !itemHasCapability(item, token)) continue;
    if (allow && !allow(item)) continue;
    const found = skillThrow(actor, item, rollKey, { fallback });
    if (found && (!best || found.target < best.target)) best = found;
  }
  return best;
}

/**
 * The best (lowest) skill throw the actor holds for an Adventuring key, or null
 * where the key has no skill or the actor holds none. Never the Adventuring
 * proficiency itself, whose throws are the stored figures.
 *
 * @param {Actor} actor
 * @param {string} key
 * @param {object} [opts]
 * @param {(item: Item) => boolean} [opts.allow] withdraws the items it refuses
 * @returns {{item: Item, itemId: string, rollKey: string, target: number, name: string, cite: string}|null}
 */
export function adventuringSkillThrow(actor, key, { allow } = {}) {
  const skill = ADVENTURING_SKILLS[key];
  if (!skill || !actor?.items) return null;
  return bestThrow(actor, skill.token, skill.rollKey, { allow });
}

/**
 * The ability whose own throw stands in for the stored Adventuring figure on
 * `key`, or null where the key has none or the actor holds none.
 */
export function adventuringStandIn(actor, key, { allow } = {}) {
  const stand = ADVENTURING_STAND_INS[key];
  if (!stand || !actor?.items) return null;
  return bestThrow(actor, stand.token, stand.rollKey, { allow });
}

/**
 * The target for one Adventuring key: the stored figure (or the stand-in's, where
 * no skill is held and it is better), lowered by the bonuses that name the
 * activity, against the held skill's throw; whichever is better (lower), the
 * skill only when strictly better.
 *
 * @param {Actor} actor
 * @param {string} key a `system.adventuring` key
 * @param {object} [opts]
 * @param {(item: Item) => boolean} [opts.allow] withdraws the abilities it refuses
 *   from the skill and the stand-in (the Judge's ruling that a skill is not used)
 * @returns {{target: number|null, source: "skill"|"standIn"|"stored", skillName: string|undefined,
 *   cite: string|undefined, other: number|null, backs: {itemId: string, rollKey: string}|null,
 *   standIn: {name: string, cite: string, target: number}|null,
 *   parts: Array<{kind: string, label: string, value: number, cite: string}>}}
 *   `source` names the figure that won; `other` is the figure that did not,
 *   when both exist; `skillName` and `cite` are the skill's, whichever won;
 *   `backs` is the skill throw this key stands for, which a listing of the
 *   character's skill throws leaves out so the throw is not shown twice;
 *   `standIn` is the ability that replaced the stored figure, when one did;
 *   `parts` itemizes the bonuses inside `target`
 */
export function adventuringThrow(actor, key, { allow } = {}) {
  const raw = actor?.system?.adventuring?.[key];
  const stored = raw == null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const skill = adventuringSkillThrow(actor, key, { allow });
  const backs = skill ? { itemId: skill.itemId, rollKey: skill.rollKey } : null;
  const named = skill ? { skillName: skill.name, cite: skill.cite || undefined } : { skillName: undefined, cite: undefined };

  // Where no skill is held, an ability that stands in replaces the stored
  // figure when it is better.
  const stand = skill ? null : adventuringStandIn(actor, key, { allow });
  const usesStand = !!stand && (stored == null || stand.target < stored);
  const base = usesStand ? stand.target : stored;
  const baseSource = usesStand ? "standIn" : "stored";
  const standIn = usesStand ? { name: stand.name, cite: stand.cite, target: stand.target } : null;

  // The bonuses that name the activity without needing the skill held.
  const token = ADVENTURING_SKILLS[key]?.token;
  const adventuringParts = token && base != null
    ? modifiesParts(actor, { id: null, provides: [token] }, { unskilled: true }).kept.map(({ label, value, cite }) => ({ kind: "abilities", label, value, cite }))
    : [];
  const side = base == null ? null : base - adventuringParts.reduce((sum, part) => sum + part.value, 0);
  const sideParts = side == null ? [] : adventuringParts;

  if (skill && (side == null || skill.target < side)) {
    return { target: skill.target, source: "skill", ...named, other: side, backs, standIn: null, parts: skill.parts };
  }
  return { target: side, source: baseSource, ...named, other: skill ? skill.target : usesStand ? stored : null, backs, standIn, parts: sideParts };
}
