/**
 * Reading the acks SYSTEM's actor sheet — small graceful-degradation
 * accessors several features each reimplemented.
 *
 * Read the system's character/monster schema and fall back to 0 when a field
 * is absent. Pure reads, no writes; Foundry-free (they touch only the plain
 * `system` object, the document's own flag and ownership answers, and a
 * token's disposition), so
 * offline tooling can import them too.
 */

import { ACTOR_TYPE, alignmentKey } from "./vocab.mjs";
import { MODULE_ID } from "./constants.mjs";
import { summonerOf } from "./summons-logic.mjs";

/** An ability-score modifier ("cha", "wis", …), 0 when absent. */
export const abilityMod = (actor, key) => Number(actor?.system?.scores?.[key]?.mod ?? 0);

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

/**
 * The monster stat block's flag, where a monster's `types` live. The monsters
 * feature owns the model; lib reads the stored flag as `senses.mjs` does.
 */
const MONSTER_EXTRAS = Object.freeze({ scope: "acks-extras", key: "extras" });

/** The monster types that are enchanted creatures by definition (RR p. 227, the defined term). */
const ENCHANTED_TYPES = Object.freeze(["construct", "enchanted", "incarnation", "undead"]);

/**
 * The kind tokens a creature answers to, lowercase, as `scopeApplies` reads
 * them in `ctx.kinds`: a monster's types, `summoned` where a character
 * summoned it, `enchanted` when any of those makes it one (the defined term:
 * a construct, an incarnation, undead, any summoned creature, or a monster typed
 * enchanted), and `character` for a character. An untyped monster that nobody
 * summoned gives an empty set, which a scope reads as undetermined.
 * @returns {Set<string>}
 */
export function creatureKinds(actor) {
  const kinds = new Set();
  if (!actor) return kinds;
  if (actor.type === ACTOR_TYPE.character) kinds.add("character");
  const types = actor.getFlag?.(MONSTER_EXTRAS.scope, MONSTER_EXTRAS.key)?.types;
  for (const type of types ? [...types] : []) kinds.add(String(type).toLowerCase());
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
