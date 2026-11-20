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
 * stay the stored figure; Dungeonbashing's also takes the thrower's Strength
 * (`bashStrPart`, its one owner), as a part.
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
import { rollsOf, keyOf, measures, throwOutcome, defaultKeyOf, citeOf, modifiesParts, recordNoteFor } from "./ability-rolls.mjs";
import { itemHasCapability } from "../lib/capabilities.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { isAdventuring, ADVENTURING_REF } from "../classes/grants.mjs";
import { bashStrPart } from "../formation/doors.mjs";

/** The Adventuring keys whose figure takes the thrower's Strength (`bashStrPart`). */
export const STRENGTH_ADVENTURING = Object.freeze(["dungeonbashing"]);

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
 * @param {boolean} [opts.auto=true] answer a throw a spell record made automatic as `auto`; false reads the character's own throw there
 * @returns {{item: Item, itemId: string, rollKey: string, target: number|null, name: string, cite: string,
 *   parts: Array<{kind: string, label: string, value: number, cite: string}>, scaled: boolean,
 *   auto?: {label: string, cite: string, value: number}, record?: object}|null}
 *   `scaled` is true where the figure moves with level or rank; `auto` is the spell
 *   that made the throw automatic, with a null `target` (nothing to roll); `record`
 *   is what the character's spell records did to the throw, where one did
 */
export function skillThrow(actor, item, rollKey, { fallback = false, auto = true } = {}) {
  const rolls = rollsOf(item);
  let index = rolls.findIndex((r, i) => (rollKey ? keyOf(r, i) === rollKey : !measures(r)));
  if (index < 0 && fallback) index = rolls.findIndex((r, i) => keyOf(r, i) === defaultKeyOf(item));
  const roll = rolls[index];
  if (!roll || (roll.rollType || "above") !== "above") return null;
  let verdict = throwOutcome(roll, actor, item, { conditions: false });
  // A spell made the throw automatic: no figure, no roll. A caller that cannot
  // act on that reads the character's own throw instead, with no record on it.
  if (verdict.outcome === "auto" && verdict.record?.auto) {
    if (auto) {
      return { item, itemId: item.id, rollKey: keyOf(roll, index), target: null, auto: verdict.record.auto, name: item.name, cite: citeOf(item), parts: [], scaled: false, record: verdict.record };
    }
    verdict = throwOutcome(roll, actor, item, { conditions: false, records: false });
  }
  const { outcome, target, parts, record } = verdict;
  if (outcome !== "throw" || !Number.isFinite(target)) return null;
  // A figure a spell set is a figure whatever the throw's own target holds; only the character's own needs one read.
  const set = !!record?.set;
  const scaled = !set && !isFlat(roll.target);
  if (!set && !scaled && !(Number(typeof roll.target === "number" ? roll.target : roll.target?.flat) > 0)) return null;
  return { item, itemId: item.id, rollKey: keyOf(roll, index), target, name: item.name, cite: citeOf(item), parts: parts ?? [], scaled, ...(record ? { record } : {}) };
}

/**
 * The best (lowest) throw of the actor's held abilities that provide `token`,
 * at `rollKey`; never the Adventuring proficiency itself.
 */
function bestThrow(actor, token, rollKey, { allow, fallback = false, auto = true } = {}) {
  let best = null;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability || isAdventuring(item) || !itemHasCapability(item, token)) continue;
    if (allow && !allow(item)) continue;
    const found = skillThrow(actor, item, rollKey, { fallback, auto });
    if (!found) continue;
    // A throw a spell made automatic needs no figure and beats every one that has one.
    if (found.auto) return found;
    if (!best || found.target < best.target) best = found;
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
 * @param {boolean} [opts.auto=true] see `skillThrow`
 * @returns {{item: Item, itemId: string, rollKey: string, target: number|null, name: string, cite: string,
 *   auto?: object}|null} `skillThrow`'s answer for the best skill; an `auto` one has no target
 */
export function adventuringSkillThrow(actor, key, { allow, auto = true } = {}) {
  const skill = ADVENTURING_SKILLS[key];
  if (!skill || !actor?.items) return null;
  return bestThrow(actor, skill.token, skill.rollKey, { allow, auto });
}

/**
 * The ability whose own throw stands in for the stored Adventuring figure on
 * `key`, or null where the key has none or the actor holds none.
 */
export function adventuringStandIn(actor, key, { allow, auto = true } = {}) {
  const stand = ADVENTURING_STAND_INS[key];
  if (!stand || !actor?.items) return null;
  return bestThrow(actor, stand.token, stand.rollKey, { allow, auto });
}

/**
 * The Adventuring proficiency as a spell record's throw part names it: its
 * definition id, so a part whose `ref` is that id (or its capability) reaches
 * the stored figures, each by its key.
 */
const ADVENTURING_SUBJECT = Object.freeze({ id: ADVENTURING_REF, provides: Object.freeze([]) });

/**
 * What the stored figure reads under the character's spell records: a `set`
 * replaces it (the activity bonuses yield, as does any bonus a record adds), a
 * bonus a record adds lowers it, and an automatic one is no figure at all. The
 * stored value itself is never touched.
 */
function storedRecord(actor, key) {
  const note = recordNoteFor(actor, ADVENTURING_SUBJECT, key);
  if (!note) return null;
  if (!note.set || !note.added.length) return note;
  const to = note.set.cite ? `${note.set.label} (${note.set.cite})` : note.set.label;
  return { ...note, added: [], dropped: [...note.dropped, ...note.added.map((p) => ({ ...p, set: false, yieldsTo: to }))] };
}

/** An answer with no figure: a spell made the throw automatic, and `via` is the held throw to post, if there is one. */
function autoAnswer(source, auto, record, extra = {}) {
  return { target: null, source, skillName: undefined, cite: undefined, other: null, backs: null, standIn: null, parts: [], auto, via: null, record, ...extra };
}

/**
 * The target for one Adventuring key: the stored figure (or the stand-in's, where
 * no skill is held and it is better), lowered by the bonuses that name the
 * activity, against the held skill's throw; whichever is better (lower), the
 * skill only when strictly better.
 *
 * The character's spell records act on it as they do on a held throw. A record
 * that names the Adventuring proficiency and the key sets or lowers the stored
 * side, and one on a held skill's throw (or on the stand-in's) moves that
 * throw. A throw made automatic answers with `auto` and no target, and wins
 * over every figure.
 *
 * @param {Actor} actor
 * @param {string} key a `system.adventuring` key
 * @param {object} [opts]
 * @param {(item: Item) => boolean} [opts.allow] withdraws the abilities it refuses
 *   from the skill and the stand-in (the Judge's ruling that a skill is not used)
 * @param {boolean} [opts.auto=true] answer an automatic throw as `auto`; false reads the figure the character
 *   has without that record, for a caller with no way to roll nothing
 * @param {boolean} [opts.strength=true] false leaves the thrower's Strength out of a
 *   `STRENGTH_ADVENTURING` figure, for a caller that itemizes it itself
 * @returns {{target: number|null, source: "skill"|"standIn"|"stored", skillName: string|undefined,
 *   cite: string|undefined, other: number|null, backs: {itemId: string, rollKey: string}|null,
 *   standIn: {name: string, cite: string, target: number}|null,
 *   parts: Array<{kind: string, label: string, value: number, cite: string}>,
 *   auto?: {label: string, cite: string, value: number}, via?: {itemId: string, rollKey: string}|null,
 *   record?: object|null}}
 *   `source` names the figure that won; `other` is the figure that did not,
 *   when both exist; `skillName` and `cite` are the skill's, whichever won;
 *   `backs` is the skill throw this key stands for, which a listing of the
 *   character's skill throws leaves out so the throw is not shown twice;
 *   `standIn` is the ability that replaced the stored figure, when one did;
 *   `parts` itemizes the bonuses inside `target`; `auto` names the spell that
 *   made the throw automatic (`target` is then null) and `via` the held ability
 *   throw that posts it; `record` is what the spell records did to the winner;
 *   `missing` names an unimported figure the target needs (`target` is then null)
 */
export function adventuringThrow(actor, key, { allow, auto = true, strength = true } = {}) {
  const raw = actor?.system?.adventuring?.[key];
  const stored = raw == null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const skill = adventuringSkillThrow(actor, key, { allow, auto });
  const backs = skill ? { itemId: skill.itemId, rollKey: skill.rollKey } : null;
  const named = skill ? { skillName: skill.name, cite: skill.cite || undefined } : { skillName: undefined, cite: undefined };
  if (skill?.auto) return autoAnswer("skill", skill.auto, skill.record, { ...named, backs, via: backs });

  // Where no skill is held, an ability that stands in replaces the stored
  // figure when it is better.
  const stand = skill ? null : adventuringStandIn(actor, key, { allow, auto });
  if (stand?.auto) {
    return autoAnswer("standIn", stand.auto, stand.record, { standIn: { name: stand.name, cite: stand.cite, target: null }, via: { itemId: stand.itemId, rollKey: stand.rollKey } });
  }
  let own = storedRecord(actor, key);
  if (own?.auto) {
    if (auto) return autoAnswer("stored", own.auto, own, { ...named, backs });
    own = null; // a caller that cannot act on it reads the stored figure as the character has it
  }
  const usesStand = !!stand && (stored == null || stand.target < stored);
  const base = usesStand ? stand.target : stored;
  const baseSource = usesStand ? "standIn" : "stored";
  const standIn = usesStand ? { name: stand.name, cite: stand.cite, target: stand.target } : null;

  // The bonuses that name the activity without needing the skill held.
  const token = ADVENTURING_SKILLS[key]?.token;
  const adventuringParts = token && base != null
    ? modifiesParts(actor, { id: null, provides: [token] }, { unskilled: true }).kept.map(({ label, value, cite }) => ({ kind: "abilities", label, value, cite }))
    : [];
  let side;
  let sideParts;
  if (own?.set) {
    // A figure a spell set is the stored side as it stands: nothing stored, nothing named for the activity, nothing added.
    side = own.set.value == null || !Number.isFinite(Number(own.set.value)) ? null : Number(own.set.value);
    sideParts = [];
  } else {
    const added = (own?.added ?? []).map(({ label, value, cite }) => ({ kind: "spell", label, value, cite }));
    sideParts = base == null ? [] : [...adventuringParts, ...added];
    side = base == null ? null : base - sideParts.reduce((sum, part) => sum + part.value, 0);
  }
  const record = own ?? null;

  // The thrower's Strength, on the figure as the character has it (not on one a spell set).
  if (strength && side != null && !own?.set && STRENGTH_ADVENTURING.includes(key)) {
    const str = bashStrPart(actor);
    if (str?.missing) {
      return { target: null, source: baseSource, ...named, other: null, backs, standIn, parts: [], record, missing: [str.missing] };
    }
    if (str) {
      sideParts = [...sideParts, str];
      side -= str.value;
    }
  }

  if (skill && (side == null || skill.target < side)) {
    return { target: skill.target, source: "skill", ...named, other: side, backs, standIn: null, parts: skill.parts, record: skill.record ?? null };
  }
  return { target: side, source: own?.set ? "stored" : baseSource, ...named, other: skill ? skill.target : usesStand && !own?.set ? stored : null, backs, standIn: own?.set ? null : standIn, parts: sideParts, record };
}
