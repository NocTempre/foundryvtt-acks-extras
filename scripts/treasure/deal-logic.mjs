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
import { MAGIC_ERROR } from "./magic-deal-logic.mjs";
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
 * @param {(args: {letter: string, toggles: object}) => Promise<{truths: object[], errors: object[], cite: string|null, audit?: object[]}>} args.deal
 *   one letter dealt (`dealHoard`, with the style and special choice already bound)
 * @param {(args: {letter: string, truths: object[]}) => Promise<{truths: object[], errors: object[], audit: object[]}>} [args.rollMagic]
 *   rolls the magic placeholders of one letter's truths (`magic-deal-logic.mjs`
 *   `rollMagicTruths`, bound); its errors and audit rows join the letter's, and
 *   without it the placeholders are staged as dealt
 * @param {(truths: object[]) => Promise<string[]>} args.stage puts truths in the pot, returning the new card ids
 * @returns {Promise<{ok: true, dealt: Array<{letter: string, cards: number, errors: object[], cite: string|null, audit?: object[]}>, staged: string[]}|{ok: false, reason: string}>}
 *   a letter's `audit` is the deal's throws and the magic rolls' steps, and is present only where there are rows
 */
export async function runLetterDeal({ isGM, pot, letters, confirmLair, deal, rollMagic, stage }) {
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
    let cards = result.truths;
    let errors = result.errors;
    let audit = result.audit ?? [];
    if (typeof rollMagic === "function") {
      const magic = await rollMagic({ letter, truths: cards });
      cards = magic.truths;
      errors = [...errors, ...magic.errors];
      audit = [...audit, ...magic.audit];
    }
    truths.push(...cards);
    dealt.push({ letter, cards: cards.length, errors, cite: result.cite, ...(audit.length ? { audit } : {}) });
  }
  const staged = truths.length ? await stage(truths) : [];
  return { ok: true, dealt, staged };
}

/**
 * The staged monster rows for a list of kinds: each row as the pot stores it,
 * ticked when its sheet carries a letter and left clear when it carries none.
 * @param {Array<{actorId?: string|null, name?: string, count?: number, letter?: string|null}>} groups
 *   `groupMonsters`' rows
 * @returns {Array<{actorId: string|null, name: string, count: number, letter: string|null, on: boolean}>}
 */
export function monsterRows(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter(Boolean)
    .map((g) => {
      const letter = letterOf(g.letter);
      return { actorId: g.actorId ?? null, name: String(g.name ?? ""), count: Math.max(1, Math.floor(Number(g.count) || 1)), letter, on: !!letter };
    });
}

/**
 * What a Deal sends, from the pot's staged deal state: one line per ticked
 * monster row that carries a letter (one hoard per kind, never one per token),
 * then the by-hand letter. A line is `{letter, name, count}`, with `name` null
 * and `count` 0 for the by-hand letter.
 * @param {{monsters?: object[], letter?: string|null}} deal `pot.deal`
 * @returns {Array<{letter: string, name: string|null, count: number}>}
 */
export function dealLines(deal) {
  const lines = (deal?.monsters ?? [])
    .filter((row) => row.on && letterOf(row.letter))
    .map((row) => ({ letter: letterOf(row.letter), name: row.name, count: row.count }));
  const byHand = letterOf(deal?.letter);
  if (byHand) lines.push({ letter: byHand, name: null, count: 0 });
  return lines;
}

/** The per-letter error codes a deal words by name; any other code is worded generically with the code in it. */
export const DEAL_ERROR_CODES = Object.freeze(["not-imported", "unknown-type", "unknown-style", "column-skipped", "special-missing", "coin-missing", MAGIC_ERROR]);

/** The reasons a deal refuses that the window words itself; the two lair reasons are the warning's, so the window says nothing for them. */
export const DEAL_REFUSAL_WORDED = Object.freeze([REFUSAL.notAllowed, REFUSAL.phase, REFUSAL.empty]);

/**
 * What to tell the Judge about a deal's outcome: a list of
 * `{level, key, args}` where `key` is a lang key under `ACKS-TREASURE.`.
 * A refusal says its reason (the lair reasons say nothing: the warning is
 * their answer); a deal that staged nothing says so; every distinct error of
 * every letter is worded once, naming the letter; a deal that staged cards
 * says how many and for which letters.
 * @param {{ok: boolean, reason?: string, dealt?: Array<{letter: string, cards: number, errors: object[]}>, staged?: string[]}} outcome `runLetterDeal`'s result
 * @returns {Array<{level: "info"|"warn", key: string, args: object}>}
 */
export function dealMessages(outcome) {
  if (!outcome) return [];
  if (!outcome.ok) {
    if (outcome.reason === DEAL_REFUSAL.lairUnconfirmed || outcome.reason === DEAL_REFUSAL.lairDeclined) return [];
    const reason = DEAL_REFUSAL_WORDED.includes(outcome.reason) ? outcome.reason : REFUSAL.failed;
    return [{ level: "warn", key: `deal.refuse.${reason}`, args: {} }];
  }
  const messages = [];
  for (const one of outcome.dealt ?? []) {
    const seen = new Set();
    for (const error of one.errors ?? []) {
      const code = DEAL_ERROR_CODES.includes(error?.code) ? error.code : "other";
      const id = `${code}|${error?.column ?? ""}|${code === "other" ? error?.code : ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      messages.push({ level: "warn", key: `deal.error.${code}`, args: { letter: one.letter, column: error?.column ?? "", style: error?.style ?? "", code: error?.code ?? "" } });
    }
  }
  const cards = (outcome.staged ?? []).length;
  if (cards) messages.push({ level: "info", key: "deal.done", args: { n: cards, letters: (outcome.dealt ?? []).filter((d) => d.cards).map((d) => d.letter).join(", ") } });
  else if (!messages.length) messages.push({ level: "warn", key: "deal.nothing", args: {} });
  return messages;
}
