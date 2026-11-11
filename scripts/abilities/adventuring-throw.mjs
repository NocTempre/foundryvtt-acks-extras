/**
 * The target a character has for an Adventuring throw: the better of the
 * Adventuring proficiency's own figure and the throw of the skill that covers
 * the same activity.
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
 * The figure is the one BEFORE the creature's conditions. The throw's wrapper
 * (`lib/patches/adventuring-roll.mjs`, through `withAdventuringConditions`)
 * applies them once, to whatever figure the throw is rolled against.
 */
import { MODULE_ID } from "./constants.mjs";
import { rollsOf, keyOf, measures, throwOutcome } from "./ability-rolls.mjs";
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

/** The page an imported item's own stamp names, or the empty string. */
const citeOf = (item) => String(item?.flags?.[MODULE_ID]?.cookbook?.cite ?? item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? "");

/**
 * The throw of one held skill that answers `key`, before conditions, or null
 * when the item has no such throw or it is not a plain "roll this or higher"
 * with a figure.
 */
function throwOf(actor, item, { rollKey }) {
  const rolls = rollsOf(item);
  const index = rolls.findIndex((r, i) => (rollKey ? keyOf(r, i) === rollKey : !measures(r)));
  const roll = rolls[index];
  if (!roll || (roll.rollType || "above") !== "above") return null;
  const { outcome, target } = throwOutcome(roll, actor, item, { conditions: false });
  if (outcome !== "throw" || !Number.isFinite(target)) return null;
  return { item, itemId: item.id, rollKey: keyOf(roll, index), target, name: item.name, cite: citeOf(item) };
}

/**
 * The best (lowest) skill throw the actor holds for an Adventuring key, or null
 * where the key has no skill or the actor holds none. Never the Adventuring
 * proficiency itself, whose throws are the stored figures.
 *
 * @returns {{item: Item, itemId: string, rollKey: string, target: number, name: string, cite: string}|null}
 */
export function adventuringSkillThrow(actor, key) {
  const skill = ADVENTURING_SKILLS[key];
  if (!skill || !actor?.items) return null;
  let best = null;
  for (const item of actor.items) {
    if (item.type !== ITEM_TYPE.ability || isAdventuring(item) || !itemHasCapability(item, skill.token)) continue;
    const found = throwOf(actor, item, skill);
    if (found && (!best || found.target < best.target)) best = found;
  }
  return best;
}

/**
 * The target for one Adventuring key: the stored figure or the skill's throw,
 * whichever is better (lower), the skill only when strictly better.
 *
 * @param {Actor} actor
 * @param {string} key a `system.adventuring` key
 * @returns {{target: number|null, source: "skill"|"stored", skillName: string|undefined,
 *   cite: string|undefined, other: number|null, backs: {itemId: string, rollKey: string}|null}}
 *   `source` names the figure that won; `other` is the figure that did not,
 *   when both exist; `skillName` and `cite` are the skill's, whichever won;
 *   `backs` is the skill throw this key stands for, which a listing of the
 *   character's skill throws leaves out so the throw is not shown twice
 */
export function adventuringThrow(actor, key) {
  const raw = actor?.system?.adventuring?.[key];
  const stored = raw == null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const skill = adventuringSkillThrow(actor, key);
  const backs = skill ? { itemId: skill.itemId, rollKey: skill.rollKey } : null;
  const named = skill ? { skillName: skill.name, cite: skill.cite || undefined } : { skillName: undefined, cite: undefined };
  if (skill && (stored == null || skill.target < stored)) return { target: skill.target, source: "skill", ...named, other: stored, backs };
  return { target: stored, source: "stored", ...named, other: skill ? skill.target : null, backs };
}
