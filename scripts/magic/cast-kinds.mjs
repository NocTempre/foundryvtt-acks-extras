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
import { aimedAtSelf, awaitsFail, resolvesAtCast, rowNeedsThrow, ROLLED_KINDS } from "./cast-rows.mjs";
import { isModRow } from "./cast-mods.mjs";
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { isManagedEffect } from "../lib/managed-effects.mjs";
import { HELD_CONDITION_FLAG } from "../lib/held-condition.mjs";

/** The `lasts` values whose row keeps a clock, which is what a recipient's record needs to stand on. */
const RECORDED_LASTS = Object.freeze(["duration", "rounds", "nextTurn", "followingTurn"]);

/** The reach a record kind names a recipient by: any row not aimed at the caster. */
const notSelf = (row) => !aimedAtSelf(row);

/** The reach a record kind names a recipient by when only a row that says `recipient` counts, so an area or target row stays a card line. */
const toRecipient = (row) => row?.appliesTo === "recipient";

/**
 * The entry of a kind of the ruling-14 family (a card line and a record, no arithmetic): a card row with an entry per target where the row writes a recipient's record, else a card line. No saving throw governs it.
 *
 * @param {(row: object) => boolean} records  which rows of the kind name a recipient
 */
function recordKind(records) {
  return Object.freeze({ place: (row) => (writesRecipientRecord(row) ? "rowAndLine" : "line"), opens: () => true, resisted: () => false, lives: true, records });
}

/** The weapons an actor carries that are not already marked destroyed. */
export const liveWeapons = (actor) => [...(actor?.items ?? [])].filter((i) => i?.type === "weapon" && !isDestroyed(i));

/** Is this item marked destroyed? */
export function isDestroyed(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DESTROYED) ?? item?.flags?.[MODULE_ID]?.[ITEM_FLAGS.DESTROYED]);
}

/**
 * The weapon a holder loses to a `destroyItem` row: its equipped weapon, else its
 * first one, never one already destroyed. This is the default of the cast
 * dialog's per-holder pick (`chosenWeapon`), and what a cast with no pick takes.
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
 * The weapon a holder loses where the seat picked one for it: the picked weapon
 * where it is a live weapon of the holder, else the default (`pickWeapon`).
 *
 * @param {object} actor
 * @param {string|null|undefined} id  the weapon the seat picked for this holder
 * @returns {{id: string, name: string}|null}
 */
export function chosenWeapon(actor, id) {
  const picked = id ? liveWeapons(actor).find((i) => i.id === id) : null;
  return picked ? { id: picked.id, name: String(picked.name ?? "") } : pickWeapon(actor);
}

/**
 * What a `conditionRemove` row may lift from an actor: for each status id the row
 * names, the effects carrying it. An id lifts only when every effect that
 * carries it is the module's own cast or a hand's and holds that status, with
 * at most the statuses its entry brings (`impliedOf`); an effect with any other
 * status beside it, one a feature manages and one a feature holds on its behalf
 * are listed with the reason and left standing, and an id that has one is not
 * lifted at all, since lib's `lift` takes an id and ends every effect that
 * carries it. The statuses brought are the lifted id's own: lifting a brought
 * status off the effect of the status that brings it lists that effect.
 *
 * @param {Iterable<object>} effects  the actor's effects
 * @param {Iterable<string>} ids  the status ids the row names
 * @param {(statusId: string) => Iterable<string>} [impliedOf]  the statuses the registered entry for an id brings; absent, none
 * @returns {{lift: object[], statuses: string[], listed: Array<{status: string, name: string, reason: "twoStatus"|"managed"|"held"}>}}
 */
export function liftPlan(effects, ids, impliedOf = () => []) {
  const all = [...(effects ?? [])];
  const out = { lift: [], statuses: [], listed: [] };
  for (const status of new Set(Array.from(ids ?? []))) {
    const carrying = all.filter((e) => e?.statuses?.has?.(status));
    if (!carrying.length) continue;
    const brought = new Set([status, ...Array.from(impliedOf(status) ?? [])]);
    const alone = (e) => [...(e.statuses ?? [status])].every((id) => brought.has(id));
    const reasonOf = (e) => (e.getFlag?.(MODULE_ID, HELD_CONDITION_FLAG) ? "held" : isManagedEffect(e) ? "managed" : !alone(e) ? "twoStatus" : null);
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
 * - `entry(row, actor, pick)`: what the target's entry opens with beside `pending`; `pick` is the weapon the seat picked for this holder;
 * - `lineKey`: the card's footnote line, a key under the cast's strings;
 * - `records(row)`: the kind writes a recipient's record where this holds of the row and the row lasts on a clock (`writesRecipientRecord`);
 * - `step(ctx, deps)`: a step the cast takes for the kind before its card, run from the cast's dependencies and not an apply.
 */
export const APPLY_KINDS = Object.freeze({
  ignite: recordKind(notSelf),
  // A row that waits for a failed recurring save is no part of the cast save: it writes its anchor alone at the cast.
  conditionGrant: Object.freeze({ place: () => "row", opens: (card) => Boolean(card.conditions?.length), resisted: (row) => !awaitsFail(row), lives: true }),
  conditionRemove: Object.freeze({ place: () => "row", opens: (card) => Boolean(card.conditions?.length), resisted: () => false }),
  slay: Object.freeze({ place: () => "row", opens: () => true }),
  destroyItem: Object.freeze({ place: () => "rowAndLine", opens: () => true, resisted: (_row, actor) => pickWeapon(actor) !== null, entry: (_row, actor, pick) => ({ item: chosenWeapon(actor, pick) }), lineKey: "line.unheldWeapons" }),
  // The tracked kinds (a card line and the caster's record) write a recipient's record too where a row names a recipient.
  illusion: recordKind(toRecipient),
  detect: recordKind(toRecipient),
  light: recordKind(toRecipient),
  dispel: recordKind(toRecipient),
  createObject: recordKind(toRecipient),
  wall: recordKind(toRecipient),
  // A disease's onset put off: the row names the effects it holds back, on its recipient, for its duration.
  afflictionDelay: recordKind(toRecipient),
  // Takes away a quantity at once: a card line, and nothing is written to a target.
  purify: Object.freeze({ place: () => "line", opens: () => false }),
  // Closes a way for as long as it lasts: a card line, and the caster's record where the row lasts the duration. The cast's own pick of a door comes before the spend, and its step writes the seal once the cast proceeds (`deps.seal`).
  seal: Object.freeze({ place: () => "line", opens: () => false, step: (ctx, deps) => deps.seal(ctx) }),
  // A summoning's placement: no card row and no entry; the cast runs its own step.
  summon: Object.freeze({ place: () => "line", opens: () => false, step: (ctx, deps) => deps.summon(ctx) }),
});

/** The dispatch entry of a row type, or null where the type is not one of them. */
export const kindOf = (type) => (Object.hasOwn(APPLY_KINDS, type) ? APPLY_KINDS[type] : null);

/** The kinds that write a record on the recipient, as a card row with an entry per target, where the row is aimed at one and lasts on a clock. */
export const RECORD_KINDS = Object.freeze(Object.keys(APPLY_KINDS).filter((type) => APPLY_KINDS[type].records));

/** Does this row write a record on the recipient, as a card row with an entry per target? */
export const writesRecipientRecord = (row) => Boolean(kindOf(row?.type)?.records?.(row)) && RECORDED_LASTS.includes(row.lasts);

/** The step a kind takes for the cast, or null where it takes none. */
export const stepOf = (type) => kindOf(type)?.step ?? null;

/**
 * Do any of the cast's rows open an entry for a target token? A cast whose rows
 * open none measures no target: neither the range nor the count applies. A
 * row aimed at the caster, a card line, a summoning and a recurring row that waits
 * for a later round open no entry; a modifier or ward row, a rolled row that
 * resolves at the cast or is thrown, and a kind whose place is a card row do.
 * Where a row's own figures cannot say yet (a modifier's), it counts.
 *
 * @param {Array<{row: object}>} keyed  the cast's kept rows (`rowsForMode`)
 */
export function takesTargets(keyed) {
  return (keyed ?? []).some(({ row }) => {
    if (aimedAtSelf(row)) return false;
    if (isModRow(row)) return true;
    if (ROLLED_KINDS.includes(row?.type)) return resolvesAtCast(row) || rowNeedsThrow(row);
    return ["row", "rowAndLine"].includes(placeOf(row));
  });
}

/** Where a spell's row goes on the card: its kind's place, else null (the caller's own rules). */
export const placeOf = (row) => kindOf(row?.type)?.place(row) ?? null;

/** Does the card's row open an entry for a target? Rows of every other type are the caller's. */
export const rowOpens = (cardRow) => Boolean(kindOf(cardRow?.type)?.opens(cardRow));

/** Does the target's saving throw govern this row of this kind on this actor? A row of no kind is the caller's. */
export const rowResisted = (row, actor) => kindOf(row?.type)?.resisted?.(row, actor) ?? true;

/** Does a row of this type last a number of rounds, a next turn or a following one? */
export const livesKind = (type) => kindOf(type)?.lives === true;

/** What a kind's entry starts with for this actor, beside `pending`. */
export const entryOf = (row, actor, pick = null) => kindOf(row?.type)?.entry?.(row, actor, pick) ?? {};
