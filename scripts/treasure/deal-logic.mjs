/**
 * Dealing treasure letters into a pot, on plain data and injected seams,
 * Foundry-free. A monster's treasure letter is lair treasure, and nothing here
 * infers whether the creatures were met in their lair: the Judge sets the
 * "Met in their lair" toggle on the pot's staging state (`pot.deal.metInLair`),
 * and the warning keys off that toggle alone.
 *
 * A group is one KIND of monster, and a kind deals ONE hoard of its letter however
 * many tokens stand for it: a treasure type is the lair's hoard, and a lair is
 * not multiplied by the bodies in it. `deal.mjs` is the Foundry side.
 */
import { PHASE, REFUSAL } from "./constants.mjs";
import { letterOf } from "./search-logic.mjs";

/** Reasons a letter deal refuses, beside `REFUSAL`'s: the lair was neither met nor confirmed. */
export const DEAL_REFUSAL = Object.freeze({ lairUnconfirmed: "lairUnconfirmed", lairDeclined: "lairDeclined" });

/** A letter as a string, from a bare letter or a row carrying one; null where it names none. */
const lettersOf = (list) =>
  (Array.isArray(list) ? list : [])
    .map((x) => letterOf(typeof x === "string" ? x : x?.letter))
    .filter(Boolean);

/**
 * The warning a lair-only deal stands behind. Null when the Judge says the
 * creatures were met in their lair, or when no letter is being dealt;
 * otherwise the distinct letters, in order, for the warning to name.
 * @param {{letters: Array<string|{letter: string|null}>, metInLair: boolean}} args
 * @returns {{letters: string[]}|null}
 */
export function lairWarning({ letters, metInLair } = {}) {
  if (metInLair === true) return null;
  const named = [...new Set(lettersOf(letters))];
  return named.length ? { letters: named } : null;
}

/**
 * Selected tokens grouped by kind of monster, one row per kind. A kind is the
 * token's BASE actor, so linked tokens and unlinked tokens of one actor are one
 * row; a token with no actor id is a kind of its own name. A row's letter is the
 * first the group's tokens carry (null where none does, and the row is still
 * listed so the UI can grey it). Rows keep the order each kind first appears in.
 * @param {Array<{actorId?: string|null, name?: string, letter?: string|null}>} tokens
 *   the adapter's plain read: the base actor's id and name, and the letter read
 *   from the token's own actor (an unlinked token's data may differ from its base)
 * @returns {Array<{actorId: string|null, name: string, count: number, letter: string|null}>}
 */
export function groupMonsters(tokens) {
  const groups = new Map();
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token) continue;
    const actorId = typeof token.actorId === "string" && token.actorId ? token.actorId : null;
    const name = String(token.name ?? "");
    const key = actorId ? `id:${actorId}` : `name:${name}`;
    const row = groups.get(key) ?? { actorId, name, count: 0, letter: null };
    row.count++;
    row.letter ??= letterOf(token.letter);
    groups.set(key, row);
  }
  return [...groups.values()];
}

/**
 * Deal a list of letters into a staged pot, behind the lair warning.
 *
 * Nothing is dealt for a Judge-less seat, an open pot or a list with no letter.
 * While the warning stands the injected `confirmLair(warning)` decides: with none
 * supplied the deal refuses (`lairUnconfirmed`), so a lair hoard nobody was warned
 * about is never dealt; a falsy answer refuses (`lairDeclined`). Each letter is
 * then dealt once, in order, honouring the pot's deal toggles, and every truth
 * is staged in one go.
 *
 * @param {object} args
 * @param {boolean} args.isGM
 * @param {object} args.pot the pot's normalized flag
 * @param {Array<string|{letter: string|null}>} args.letters
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} [args.confirmLair]
 * @param {(args: {letter: string, toggles: object}) => Promise<{truths: object[], errors: object[], cite: string|null}>} args.deal
 *   one letter dealt (`dealHoard`, with the style and special choice already bound)
 * @param {(truths: object[]) => Promise<string[]>} args.stage puts truths in the pot, returning the new card ids
 * @returns {Promise<{ok: true, dealt: Array<{letter: string, cards: number, errors: object[], cite: string|null}>, staged: string[]}|{ok: false, reason: string}>}
 */
export async function runLetterDeal({ isGM, pot, letters, confirmLair, deal, stage }) {
  if (!isGM) return { ok: false, reason: REFUSAL.notAllowed };
  if (!pot || pot.phase !== PHASE.staging) return { ok: false, reason: REFUSAL.phase };
  const list = lettersOf(letters);
  if (!list.length) return { ok: false, reason: REFUSAL.empty };
  const warning = lairWarning({ letters: list, metInLair: pot.deal?.metInLair });
  if (warning) {
    if (typeof confirmLair !== "function") return { ok: false, reason: DEAL_REFUSAL.lairUnconfirmed };
    if ((await confirmLair(warning)) !== true) return { ok: false, reason: DEAL_REFUSAL.lairDeclined };
  }
  const dealt = [];
  const truths = [];
  for (const letter of list) {
    const result = await deal({ letter, toggles: pot.deal?.toggles ?? {} });
    truths.push(...result.truths);
    dealt.push({ letter, cards: result.truths.length, errors: result.errors, cite: result.cite });
  }
  const staged = truths.length ? await stage(truths) : [];
  return { ok: true, dealt, staged };
}
