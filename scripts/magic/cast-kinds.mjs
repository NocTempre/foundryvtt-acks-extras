/**
 * The row kinds a cast applies to a target with no arithmetic of their own, and
 * the one table every site that branches on a kind reads: where the kind's row
 * goes on the card (`place`), whether it opens an entry for a target
 * (`rowOpens`), whether a saving throw governs it (`rowResisted`), whether it
 * lasts a number of rounds (`livesKind`), and what its entry starts with
 * (`entryOf`). The writes live beside the amount path in `cast-apply.mjs`
 * (`applyKind`), keyed by the same type; a new kind is one entry here and one
 * there, and nothing else branches on its type. FOUNDRY-FREE: the world's
 * answers (an actor's items and effects) are read off the objects passed in.
 *
 * Also the two selections a kind makes before it writes: which conditions a
 * `conditionRemove` row may lift from an actor (`liftPlan`) and which weapon a
 * `destroyItem` row takes from a holder (`pickWeapon`).
 */
import { MODULE_ID } from "./constants.mjs";
import { aimedAtSelf } from "./cast-rows.mjs";
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { isManagedEffect } from "../lib/managed-effects.mjs";
import { HELD_CONDITION_FLAG } from "../lib/held-condition.mjs";

/** The kinds of the ruling-14 family (a record and a card line, no arithmetic) that name a recipient and lasting write the recipient's record, not only a line. */
export const RECORD_KINDS = Object.freeze(["ignite"]);

/** Does this row write a record on the recipient, as a card row with an entry per target? */
export const writesRecipientRecord = (row) => RECORD_KINDS.includes(row?.type) && !aimedAtSelf(row) && ["duration", "rounds", "nextTurn", "followingTurn"].includes(row.lasts);

/** The weapons an actor carries that are not already marked destroyed. */
export const liveWeapons = (actor) => [...(actor?.items ?? [])].filter((i) => i?.type === "weapon" && !isDestroyed(i));

/** Is this item marked destroyed? */
export function isDestroyed(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DESTROYED) ?? item?.flags?.[MODULE_ID]?.[ITEM_FLAGS.DESTROYED]);
}

/**
 * The weapon a holder loses to a `destroyItem` row: its equipped weapon, else its
 * first one, never one already destroyed. The choice is made without a control,
 * so the card names it.
 *
 * @param {object} actor
 * @returns {{id: string, name: string}|null} null where the holder carries none
 */
export function pickWeapon(actor) {
  const weapons = liveWeapons(actor);
  const chosen = weapons.find((i) => i.system?.equipped) ?? weapons[0] ?? null;
  return chosen ? { id: chosen.id, name: String(chosen.name ?? "") } : null;
}

/**
 * What a `conditionRemove` row may lift from an actor: for each status id the row
 * names, the effects carrying it. An id lifts only when every effect that
 * carries it is the module's own cast or a hand's and holds that status alone;
 * an effect with another status beside it, one a feature manages and one a
 * feature holds on its behalf are listed with the reason and left standing, and
 * an id that has one is not lifted at all, since lib's `lift` takes an id and
 * ends every effect that carries it.
 *
 * @param {Iterable<object>} effects  the actor's effects
 * @param {Iterable<string>} ids  the status ids the row names
 * @returns {{lift: object[], statuses: string[], listed: Array<{status: string, name: string, reason: "twoStatus"|"managed"|"held"}>}}
 */
export function liftPlan(effects, ids) {
  const all = [...(effects ?? [])];
  const out = { lift: [], statuses: [], listed: [] };
  for (const status of new Set(Array.from(ids ?? []))) {
    const carrying = all.filter((e) => e?.statuses?.has?.(status));
    if (!carrying.length) continue;
    const reasonOf = (e) => (e.getFlag?.(MODULE_ID, HELD_CONDITION_FLAG) ? "held" : isManagedEffect(e) ? "managed" : (e.statuses?.size ?? 1) > 1 ? "twoStatus" : null);
    const blocked = carrying.filter((e) => reasonOf(e) === "held" || reasonOf(e) === "managed");
    for (const e of carrying.filter((x) => reasonOf(x) === "twoStatus")) out.listed.push({ status, name: String(e.name ?? ""), reason: "twoStatus" });
    for (const e of blocked) out.listed.push({ status, name: String(e.name ?? ""), reason: reasonOf(e) });
    if (blocked.length) continue;
    const plain = carrying.filter((e) => reasonOf(e) === null);
    if (!plain.length) continue;
    out.statuses.push(status);
    out.lift.push(...plain);
  }
  return out;
}

/**
 * The kinds that go through the dispatch. Each entry:
 * - `place(row)`: where the spell's row goes on the card at the cast, `row` (a
 *   section with an entry per target), `rowAndLine` (a section and a footnote
 *   line) or `line`;
 * - `opens(cardRow)`: does the card's row open an entry for a target;
 * - `resisted(row, actor)`: does the target's saving throw govern this row on
 *   this target (absent: it does, wherever the save's effect says so);
 * - `lives`: the row lasts a number of rounds, a next turn or a following one;
 * - `entry(row, actor)`: what the target's entry opens with beside `pending`;
 * - `lineKey`: the card's footnote line, a key under the cast's strings.
 */
export const APPLY_KINDS = Object.freeze({
  ignite: Object.freeze({ place: (row) => (writesRecipientRecord(row) ? "rowAndLine" : "line"), opens: () => true, resisted: () => false, lives: true }),
  conditionGrant: Object.freeze({ place: () => "row", opens: (card) => Boolean(card.conditions?.length), lives: true }),
  conditionRemove: Object.freeze({ place: () => "row", opens: (card) => Boolean(card.conditions?.length), resisted: () => false }),
  slay: Object.freeze({ place: () => "row", opens: () => true }),
  destroyItem: Object.freeze({ place: () => "rowAndLine", opens: () => true, resisted: (_row, actor) => pickWeapon(actor) !== null, entry: (_row, actor) => ({ item: pickWeapon(actor) }), lineKey: "line.unheldWeapons" }),
});

/** The dispatch entry of a row type, or null where the type is not one of them. */
export const kindOf = (type) => (Object.hasOwn(APPLY_KINDS, type) ? APPLY_KINDS[type] : null);

/** Where a spell's row goes on the card: its kind's place, else null (the caller's own rules). */
export const placeOf = (row) => kindOf(row?.type)?.place(row) ?? null;

/** Does the card's row open an entry for a target? Rows of every other type are the caller's. */
export const rowOpens = (cardRow) => Boolean(kindOf(cardRow?.type)?.opens(cardRow));

/** Does the target's saving throw govern this row of this kind on this actor? A row of no kind is the caller's. */
export const rowResisted = (row, actor) => kindOf(row?.type)?.resisted?.(row, actor) ?? true;

/** Does a row of this type last a number of rounds, a next turn or a following one? */
export const livesKind = (type) => kindOf(type)?.lives === true;

/** What a kind's entry starts with for this actor, beside `pending`. */
export const entryOf = (row, actor) => kindOf(row?.type)?.entry?.(row, actor) ?? {};
