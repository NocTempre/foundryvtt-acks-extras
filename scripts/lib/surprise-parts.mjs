/**
 * The figures an opposing creature imposes on the Surprise Matrix's rolls: the
 * against-side half of a surprise roll, beside the figures a combatant's own
 * conditions give it (`conditions.mjs` `rollMath("surprise")`).
 *
 * The carrier is a typed `modifier` row of an ability, `{target: "surprise",
 * appliesTo: "opponent", value}`: the row a character's loadout already writes
 * to `surprise.surpriseothers` (`typed-modifiers.mjs` `OPPONENT_PATHS`, which
 * core reads as the highest among a side's opponents). A creature whose type has
 * no such field, a monster, has no other reader, so this one reads it, and a
 * character's row is left to core and never counted twice. The figure is the
 * row's own, imported; a row that resolves to none, or to zero, adds nothing.
 *
 * The sides are the matrix's: hostile, neutral and secret combatants against
 * friendly ones (`patches/surprise-card.mjs`). Each combatant's roll gains the
 * SUM of the parts carried by the other side's combatants, so two carriers add
 * where core's own field takes the highest. A row under a gate or a free-text
 * condition that nothing at the matrix can decide is not applied: it comes back
 * in `left` for the caller to tell. Foundry-free.
 */
import { OPPONENT_PATHS, consumedRows, gateVerdict } from "./typed-modifiers.mjs";

/** The `modifier` target the carrier names. */
export const SURPRISE_TARGET = "surprise";

/** The side of the matrix each pool of combatants rolls on. */
const SIDE_OF_POOL = Object.freeze({ friendly: "adventurers", hostile: "monsters", neutral: "monsters", secret: "monsters" });

/** The side a matrix pool rolls on, or null for a key that is no pool. */
export const sideOfPool = (pool) => SIDE_OF_POOL[pool] ?? null;

/** The other side of the matrix. */
const other = (side) => (side === "monsters" ? "adventurers" : "monsters");

/** The page an item cites: the import's `cookbook.cite`, blank where it carries none. */
const citeOfItem = (item) => String(item?.getFlag?.("acks-extras", "cookbook")?.cite ?? item?.flags?.["acks-extras"]?.cookbook?.cite ?? "").trim();

/**
 * What one creature imposes on an opposing side's surprise rolls: `parts`,
 * `[{source, cite, value}]` (the ability's name, its page, the row's figure at
 * the creature's level), and `left`, `[{source, why}]` for a row that would
 * count if its gate or condition could be decided here (`why` is `gate` or
 * `condition`). A character's rows are core's own and read as none.
 *
 * @param {object} actor
 * @param {{resolve?: Function}} [options]  the value resolver, as `consumedRows` takes it
 */
export function opposingSurpriseParts(actor, options = {}) {
  const out = { parts: [], left: [] };
  if (!actor || OPPONENT_PATHS[actor.type]?.[SURPRISE_TARGET]) return out;
  for (const { item, spec, value } of consumedRows(actor, SURPRISE_TARGET, options)) {
    if (spec.appliesTo !== "opponent" || typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
    const source = String(item?.name ?? "");
    if (spec.gate?.kind) {
      const verdict = gateVerdict(actor, spec.gate, {});
      if (verdict !== true) {
        if (verdict === null) out.left.push({ source, why: "gate" });
        continue;
      }
    }
    if (typeof spec.condition === "string" && spec.condition.trim()) {
      out.left.push({ source, why: "condition" });
      continue;
    }
    out.parts.push({ source, cite: citeOfItem(item), value });
  }
  return out;
}

/**
 * What each side of the matrix is imposed on, from the combatants of the pools:
 * `{imposedOn: {monsters, adventurers}, left}`. `imposedOn.monsters` is every
 * part an adventurer carries, `[{source, cite, value, bearer}]`, and the other
 * side's the monsters'; `left` is what `opposingSurpriseParts` could not decide,
 * each with its `bearer`. A combatant with no actor, and a key that is no pool,
 * contribute nothing.
 *
 * @param {Record<string, object[]>} pools  the matrix's combatants by disposition
 * @param {{read?: Function, resolve?: Function}} [options]  `read` replaces `opposingSurpriseParts`
 */
export function surpriseAgainst(pools, { read = opposingSurpriseParts, resolve } = {}) {
  const carried = { monsters: [], adventurers: [] };
  const left = [];
  for (const [pool, combatants] of Object.entries(pools ?? {})) {
    const side = sideOfPool(pool);
    if (!side) continue;
    for (const combatant of combatants ?? []) {
      if (!combatant?.actor) continue;
      const bearer = String(combatant.name ?? combatant.actor.name ?? "");
      const found = read(combatant.actor, { resolve });
      for (const part of found.parts) carried[side].push({ ...part, bearer });
      for (const note of found.left) left.push({ ...note, bearer });
    }
  }
  return { imposedOn: { monsters: carried[other("monsters")], adventurers: carried[other("adventurers")] }, left };
}

/** The sum of the figures of a list of parts. */
export const sumOfParts = (parts) => (parts ?? []).reduce((sum, p) => sum + p.value, 0);
