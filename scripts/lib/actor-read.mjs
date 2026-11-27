/**
 * Reading the acks SYSTEM's actor sheet — small graceful-degradation
 * accessors several features each reimplemented.
 *
 * Read the system's character/monster schema and fall back to 0 when a field
 * is absent. Pure reads, no writes; Foundry-free (they touch only the plain
 * `system` object, the document's own flag and ownership answers, a
 * token's disposition, and the guarded `CONFIG` read of the system's attribute
 * table), so offline tooling can import them too.
 */

import { ACTOR_TYPE, alignmentKey } from "./vocab.mjs";
import { MODULE_ID } from "./constants.mjs";
import { summonerOf } from "./summons-logic.mjs";

/**
 * The monster stat block's flag, where a monster's `types` and its entered
 * ability `scores` live. The monsters feature owns the model; lib reads the
 * stored flag as `senses.mjs` does.
 */
const MONSTER_EXTRAS = Object.freeze({ scope: "acks-extras", key: "extras" });

/**
 * The system's own modifier for an ability score, read from the character
 * model's attribute table (`getAttributeModifier`), or null where the system
 * does not answer (no table loaded, or a score it returns no number for). The
 * one `CONFIG` read here is guarded, so offline tooling imports this file.
 */
export function attributeModifier(score) {
  const model = globalThis.CONFIG?.Actor?.dataModels?.character;
  if (typeof model?.getAttributeModifier !== "function") return null;
  const mod = model.getAttributeModifier(score);
  if (mod === null || mod === undefined || mod === "") return null;
  return Number.isFinite(Number(mod)) ? Number(mod) : null;
}

/**
 * The ability score a Judge entered on a monster's sheet (`key` is "str", "int",
 * "wis", "dex", "con" or "cha"): the whole number above zero stored on the
 * stat block, or null where the field is blank, is no whole number above zero,
 * or the actor is not a monster.
 */
export function enteredScore(actor, key) {
  if (actor?.type !== ACTOR_TYPE.monster) return null;
  const stored = actor.getFlag?.(MONSTER_EXTRAS.scope, MONSTER_EXTRAS.key)?.scores?.[key];
  if (stored === null || stored === undefined || stored === "") return null;
  const n = Number(stored);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * An ability-score modifier ("cha", "wis", …), 0 when absent. A character reads
 * the sheet's own modifier. A monster has no sheet scores: an entered score
 * answers with the system's modifier for it (`attributeModifier`), and a blank
 * one is the default specimen, which has none, so 0.
 */
export function abilityMod(actor, key) {
  if (actor?.type === ACTOR_TYPE.monster) {
    const score = enteredScore(actor, key);
    return score === null ? 0 : attributeModifier(score) ?? 0;
  }
  return Number(actor?.system?.scores?.[key]?.mod ?? 0);
}

/** A character's class level, 0 when absent. */
export const classLevel = (actor) => Number(actor?.system?.details?.level ?? 0);

/**
 * A monster's Hit Dice rating as `{count, bonus}`, parsed from `system.hp.hd`.
 * Handles a raw number, an "a/b" fraction (½-HD monsters → 0.5), a roll
 * formula ("3d8+1" → 3 with a bonus of 1; one die smaller than a d8 is the
 * fraction of a die it stands for, so the "1d4" `hdFormula` writes for a ½
 * rating reads back as 0.5, not 1), and a leading integer or decimal with an
 * optional bonus ("2+1"). Anchored so "d8" (no leading rating) → 0, not 8.
 * @returns {{count: number, bonus: number}}
 */
export function monsterHitDice(actor) {
  const hd = actor?.system?.hp?.hd;
  if (typeof hd === "number") return { count: hd, bonus: 0 };
  const s = String(hd ?? "").trim();
  const bonusOf = (m) => (m ? Number(m.replace(/\s+/g, "")) : 0);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return { count: Number(frac[1]) / Number(frac[2]), bonus: 0 };
  const dice = s.match(/^(\d+(?:\.\d+)?)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i);
  if (dice) {
    const n = parseFloat(dice[1]);
    const sides = Number(dice[2]);
    return { count: n === 1 && sides < 8 ? sides / 8 : n, bonus: bonusOf(dice[3]) };
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([+-]\s*\d+)?/);
  return m ? { count: parseFloat(m[1]), bonus: bonusOf(m[2]) } : { count: 0, bonus: 0 };
}

/** A monster's Hit Dice rating — the count alone (see `monsterHitDice`). */
export const monsterHd = (actor) => monsterHitDice(actor).count;

/**
 * The roll formula a Hit Dice rating stands for — the inverse of `monsterHd`,
 * written to `system.hp.hd` so the header, the follower card and core's own
 * HP roll all read the rating the sheet was given. A whole count rolls that
 * many dice; a fraction of one die rolls one die scaled to the fraction (a ½
 * rating on a d8 is 1d4), never below d2; a bonus rides as a flat term. Null
 * when the count is absent or not positive, so a blank rating never writes.
 * @param {{count?:number, dieType?:number, bonus?:number}} hd
 * @returns {string|null}
 */
export function hdFormula({ count, dieType, bonus } = {}) {
  const c = Number(count);
  if (!(c > 0)) return null;
  const die = Number(dieType) > 0 ? Math.round(Number(dieType)) : 8;
  const dice = c >= 1 ? Math.round(c) : 1;
  const sides = c >= 1 ? die : Math.max(2, Math.round(die * c));
  const flat = Math.round(Number(bonus) || 0);
  const term = flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : "";
  return `${dice}d${sides}${term}`;
}

/**
 * The number that stands in for "level" across actor types: class level for a
 * character, Hit Dice for a monster (ACKS substitutes HD for level, MM 351).
 */
export const hitDiceOrLevel = (actor) =>
  actor?.type === ACTOR_TYPE.character ? classLevel(actor) : monsterHd(actor);

/** The `ALIGNMENTS` key an actor's sheet names, or null for a blank or unrecognised alignment. */
export const actorAlignment = (actor) => alignmentKey(actor?.system?.details?.alignment);

/** The size a character with no stat block of its own is. */
const CHARACTER_SIZE = "man";

/** The monsters feature's size keys, smallest first, read off its published config; empty where that feature is not loaded. */
const sizeOrder = () => Object.keys(globalThis.acksExtras?.monsters?.config?.SIZES ?? {});

/** A size key's place in the monsters feature's size ladder, or null when the ladder or the key is unknown. */
export function rankOfSize(key) {
  const order = sizeOrder();
  return key && order.includes(key) ? order.indexOf(key) : null;
}

/**
 * The size key a creature is: a monster's stat block states one, a character
 * with no stat block is man-sized, and anything else is unknown (null).
 */
export function sizeKeyOf(actor) {
  if (!actor) return null;
  return actor.getFlag?.(MONSTER_EXTRAS.scope, MONSTER_EXTRAS.key)?.size || (actor.type === ACTOR_TYPE.character ? CHARACTER_SIZE : null);
}

/** A creature's size as its place in the monsters feature's size ladder, or null when no ladder or no size is known. */
export const sizeRank = (actor) => rankOfSize(sizeKeyOf(actor));

/** The monster types that are enchanted creatures by definition (RR p. 227, the defined term). */
const ENCHANTED_TYPES = Object.freeze(["construct", "enchanted", "incarnation", "undead"]);

/**
 * The race keys that count as men where a rule tells men from demi-humans
 * (RR ch. 2). The classes feature answers a race key per class; this is the
 * category each key falls in.
 */
export const MEN_RACES = new Set(["human", "people1", "people2"]);

/** The race keys that count as demi-humans (RR ch. 2). */
export const DEMI_HUMAN_RACES = new Set(["dwarf", "elf", "gnome"]);

/** The two race categories `raceCategoryOf` answers, as the kind tokens `creatureKinds` carries. */
export const RACE_CATEGORIES = Object.freeze(["human", "demi-human"]);

/** The category a race key falls in, `"human"` or `"demi-human"`, or null for a key in neither set. */
export function raceCategoryOf(key) {
  const race = String(key ?? "").trim().toLowerCase();
  if (MEN_RACES.has(race)) return "human";
  if (DEMI_HUMAN_RACES.has(race)) return "demi-human";
  return null;
}

/** A race or kind word as a lowercase slug (`"Demi-Human "` becomes `"demi-human"`). */
export function kindToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * The printed forms each closed kind key answers to: the key, the key with an
 * `s` or an `es`, and, for a key on the `man` stem, its `men` plural. Only
 * the keys given are inflected; no word the page prints is ever singularized.
 */
function formsOf(key) {
  const forms = [key, `${key}s`, `${key}es`];
  if (key.endsWith("man")) forms.push(`${key.slice(0, -3)}men`);
  return forms;
}

/**
 * The closed kind keys `matchKinds` resolves onto, as `kindToken` folds them:
 * the race categories, `MEN_RACES`, `DEMI_HUMAN_RACES` and the `types` the
 * caller passes, each once, in that order. A kinds pick offers exactly these
 * keys, so a hand never writes a word `matchKinds` would have refused.
 *
 * @param {Iterable<string>} [types]  the consumer's own type keys (lib imports no feature's vocabulary)
 * @returns {string[]}
 */
export function kindKeys(types = []) {
  return [...new Set([...RACE_CATEGORIES, ...MEN_RACES, ...DEMI_HUMAN_RACES, ...types].map((k) => kindToken(k)).filter(Boolean))];
}

/**
 * Resolve a printed qualifier to the module's kind keys, the vocabulary
 * `creatureKinds` carries. The text is split on commas, `or` and `and`, each
 * part folded by `kindToken` and matched against the forms of the closed keys:
 * the race categories, `MEN_RACES`, `DEMI_HUMAN_RACES` and the `types` the caller
 * passes (lib imports no feature's vocabulary). A part that matches no form is
 * listed in `unresolved` and writes no key, so a printed proper name never
 * becomes a filter key.
 *
 * @param {string} text  the printed qualifier
 * @param {Iterable<string>} [types]  the consumer's own type keys (the monsters feature's `MONSTER_TYPES`)
 * @returns {{kinds: string[], unresolved: string[]}}  `kinds` keys in the text's order, none twice
 */
export function matchKinds(text, types = []) {
  const byForm = new Map();
  for (const key of kindKeys(types)) {
    for (const form of formsOf(key)) if (!byForm.has(form)) byForm.set(form, key);
  }
  const kinds = [];
  const unresolved = [];
  for (const part of String(text ?? "").split(/,|\bor\b|\band\b/i)) {
    const token = kindToken(part);
    if (!token) continue;
    const key = byForm.get(token);
    if (!key) unresolved.push(token);
    else if (!kinds.includes(key)) kinds.push(key);
  }
  return { kinds, unresolved };
}

/** The classes feature's answer from a class name to a race key, or null where none is registered. */
let characterRace = null;

/**
 * Register the reader of a character's race: `fn(className)` answers the race
 * key of the class that name stands for, or null where it is unknown. The
 * classes feature registers it at `init`; a call with a non-function clears it.
 * @param {((className: string) => string|null)|null} fn
 */
export function registerCharacterRace(fn) {
  characterRace = typeof fn === "function" ? fn : null;
}

/** A character's race key from its class name through the registered reader, lowercase, or "". */
function raceOfCharacter(actor) {
  const name = String(actor?.system?.details?.class ?? "").trim();
  if (!name || !characterRace) return "";
  try {
    return String(characterRace(name) ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The kind tokens a creature answers to, lowercase, as `scopeApplies` reads
 * them in `ctx.kinds`: a monster's types and then its `subtype` (split on
 * commas, each folded by `kindToken`), `summoned` where a character summoned
 * it, `enchanted` when any of those makes it one (the defined term: a
 * construct, an incarnation, undead, any summoned creature, or a monster typed
 * enchanted), and for a character `character`, the race key its class answers
 * and that key's category (`raceCategoryOf`). An untyped monster that nobody
 * summoned gives an empty set, which a scope reads as undetermined. A character
 * whose class names no race carries neither a race nor a category.
 * @returns {Set<string>}
 */
export function creatureKinds(actor) {
  const kinds = new Set();
  if (!actor) return kinds;
  if (actor.type === ACTOR_TYPE.character) {
    kinds.add("character");
    const race = raceOfCharacter(actor);
    if (race) {
      kinds.add(race);
      const category = raceCategoryOf(race);
      if (category) kinds.add(category);
    }
  }
  const extras = actor.getFlag?.(MONSTER_EXTRAS.scope, MONSTER_EXTRAS.key);
  const types = extras?.types;
  for (const type of types ? [...types] : []) kinds.add(String(type).toLowerCase());
  for (const part of String(extras?.subtype ?? "").split(",")) {
    const token = kindToken(part);
    if (token) kinds.add(token);
  }
  if (summonerOf(actor)) kinds.add("summoned");
  if (kinds.has("summoned") || ENCHANTED_TYPES.some((type) => kinds.has(type))) kinds.add("enchanted");
  return kinds;
}

/** A token's disposition, from the document or the placeable that holds one. */
const dispositionOf = (token) => token?.disposition ?? token?.document?.disposition ?? null;

/**
 * Whether two tokens stand on opposite sides, read from their dispositions as
 * core sorts a combat's sides by them: friendly against hostile is true, the same
 * side is false, and a neutral, secret or missing token is null (unknown). It
 * answers how a token is drawn, which a Judge can set per token.
 */
export function areEnemies(tokenA, tokenB) {
  const dispositions = globalThis.CONST?.TOKEN_DISPOSITIONS ?? {};
  const friendly = dispositions.FRIENDLY ?? 1;
  const hostile = dispositions.HOSTILE ?? -1;
  const a = dispositionOf(tokenA);
  const b = dispositionOf(tokenB);
  const side = (d) => (d === friendly || d === hostile ? d : null);
  if (side(a) === null || side(b) === null) return null;
  return a !== b;
}

/**
 * True where `actor` is in an employer's service: the system marks them a
 * retainer and names an employer. Core's dismissal clears the employer and
 * leaves the mark on, so a dismissed character is marked and still free; the
 * mark alone never answers who is in service.
 */
export function inService(actor) {
  const retainer = actor?.system?.retainer;
  return !!retainer?.enabled && !!retainer.managerid;
}

/** Wage bases that mean "paid in coin, not in experience" (RR ch. 8). */
export const UNSHARED_BASES = Object.freeze(["mercenary", "specialist"]);

/**
 * Which kind of hireling `actor` is — `henchman`, `mercenary` or `specialist`
 * — or null when nobody hired them. While they serve, the system's retainer
 * category answers: it is what their sheet shows and what core sorts its
 * Hirelings tab by, and a hireling enrolled by hand carries nothing else. A
 * henchmen record whose hireling has left service answers from how they were
 * paid.
 */
export function hirelingKind(actor) {
  const retainer = actor?.system?.retainer;
  if (retainer?.enabled) return retainer.category || "henchman";
  const record = actor?.getFlag?.(MODULE_ID, "record");
  if (!record) return null;
  const basis = record.terms?.wageBasis;
  return UNSHARED_BASES.includes(basis) ? basis : "henchman";
}

/**
 * Whether a character's experience is tracked: a henchman's is, and so is
 * the experience of a character nobody hired that a player owns. Mercenaries
 * and specialists are paid in coin, and a character no player owns and nobody
 * hired is an NPC, whose level is whatever the Judge sets it to. Ownership is
 * read only where Foundry states it, so a document that carries no
 * `hasPlayerOwner` counts as a player's.
 */
export function earnsExperience(actor) {
  if (actor?.type !== ACTOR_TYPE.character) return false;
  const kind = hirelingKind(actor);
  if (kind) return kind === "henchman";
  return actor.hasPlayerOwner !== false;
}
