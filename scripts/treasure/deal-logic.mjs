/**
 * Dealing treasure letters into a pot, on plain data and injected seams,
 * Foundry-free. A monster's treasure letter is lair treasure, and nothing here
 * infers whether the creatures were met in their lair: the Judge sets the
 * "Met in their lair" toggle on the pot's staging state (`pot.deal.metInLair`),
 * and the warning keys off that toggle alone.
 *
 * A group is one KIND of monster, and a kind deals the hoards the Judge asks of
 * its row (one to begin with) however many tokens stand for it: a treasure type
 * is the lair's hoard, and a lair is not multiplied by the bodies in it. `deal.mjs` is the Foundry side.
 */
import { MODE, PHASE, REFUSAL } from "./constants.mjs";
import { MAGIC_ERROR, armsField } from "./magic-deal-logic.mjs";
import { normalizePot } from "./pot-logic.mjs";
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
 * one hoard to deal. A kind whose sheet carries no letter is kept, so the list
 * can show it and the Judge can remove it, and it deals nothing.
 * @param {Array<{actorId?: string|null, name?: string, count?: number, letter?: string|null}>} groups
 *   `groupMonsters`' rows
 * @returns {Array<{actorId: string|null, name: string, count: number, letter: string|null, hoards: number}>}
 */
export function monsterRows(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter(Boolean)
    .map((g) => ({
      actorId: g.actorId ?? null,
      name: String(g.name ?? ""),
      count: Math.max(1, Math.floor(Number(g.count) || 1)),
      letter: letterOf(g.letter),
      hoards: 1,
    }));
}

/**
 * What a Deal sends, from the pot's staged deal state: each monster row that
 * carries a letter, its letter once per hoard it asks for (a kind's token count
 * never multiplies its hoards), then each by-hand row's letter once per hoard.
 * A line is `{letter, name, count}`, with `name` null and `count` 0 for a
 * by-hand letter.
 * @param {{monsters?: object[], hand?: object[]}} deal `pot.deal`
 * @returns {Array<{letter: string, name: string|null, count: number}>}
 */
export function dealLines(deal) {
  const lines = [];
  const hoards = (row) => Math.max(1, Math.floor(Number(row.hoards) || 1));
  for (const row of deal?.monsters ?? []) {
    const letter = letterOf(row.letter);
    if (letter) for (let i = 0; i < hoards(row); i++) lines.push({ letter, name: row.name, count: row.count });
  }
  for (const row of deal?.hand ?? []) {
    const letter = letterOf(row.letter);
    if (letter) for (let i = 0; i < hoards(row); i++) lines.push({ letter, name: null, count: 0 });
  }
  return lines;
}

/**
 * A deal list's key: its letters in the order a Deal sends them, once per hoard.
 * A pot records the key of the list it dealt (`pot.dealt`), so a later edit to
 * the list reads as a list not yet dealt.
 * @param {{monsters?: object[], hand?: object[]}} deal `pot.deal`
 * @returns {string}
 */
export const dealKey = (deal) => dealLines(deal).map((line) => line.letter).join("");

/** Whether the pot's deal list is the one it last dealt, so dealing it again would roll its hoards twice. */
export const listDealt = (pot) => !!pot?.dealt && pot.dealt === dealKey(pot.deal);

/**
 * What the Judge's Open does on a staging pot. In Table mode, with hoards
 * listed that no Deal has rolled, Open offers the pot instead of dealing it and
 * the table rolls it; every other pot opens as it always has. A lair warning
 * that stands is settled first (`warn`), and the Judge's answer, `confirmed`,
 * is carried to the deal as `lair`. An offered pot is not offered again.
 * @param {object} pot the pot's normalized flag
 * @param {{confirmed?: boolean}} [opts]
 * @returns {{ok: true, action: "open"|"offered"}|{ok: true, action: "warn", warning: {letters: string[]}}|{ok: true, action: "offer", lair: boolean}}
 */
export function planTableOpen(pot, { confirmed = false } = {}) {
  const lines = dealLines(pot?.deal);
  if (pot?.phase !== PHASE.staging || pot.mode !== MODE.table || !lines.length || listDealt(pot)) return { ok: true, action: "open" };
  if (pot.offered) return { ok: true, action: "offered" };
  const warning = lairWarning({ letters: lines, metInLair: pot.deal.metInLair });
  if (warning && !confirmed) return { ok: true, action: "warn", warning };
  return { ok: true, action: "offer", lair: !!warning };
}

/**
 * What a seat's window draws for a pot. Staging is the Judge's surface, so a
 * seat that is not a Judge is drawn a view stripped of everything it may not
 * be told (no card, no bucket, no letter, no monster) whatever the pot's
 * state, and `stripped` says the window draws no staging surface. The waiting
 * panel is drawn only when the pot is also offered, in Table mode, to a seat
 * holding LIMITED or better; `count` is the hoards its press will deal. Any
 * other pot is returned as it stands.
 * @param {{pot: object, cards: object[]}} view
 * @param {{isGM: boolean, seated: boolean}} seat
 * @returns {{waiting: boolean, stripped: boolean, view: object, count?: number}}
 */
export function tableWaiting(view, { isGM, seated }) {
  const { pot } = view;
  if (isGM || pot.phase !== PHASE.staging) return { waiting: false, stripped: false, view };
  const bare = normalizePot({ phase: pot.phase, mode: pot.mode, offered: pot.offered, messageId: pot.messageId });
  const stripped = { ...view, cards: [], pot: bare };
  if (!seated || pot.mode !== MODE.table || !pot.offered) return { waiting: false, stripped: true, view: stripped };
  return { waiting: true, stripped: true, count: dealLines(pot.deal).length, view: stripped };
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

/**
 * Whether a seat is drawn the Treasure tables button: the permission Foundry
 * itself asks of a world-setting write, which is what overriding a table
 * writes, and never a GM flag.
 * @param {{can?: (permission: string) => boolean}|null|undefined} user
 */
export const canBrowseTables = (user) => user?.can?.("SETTINGS_MODIFY") === true;

/**
 * The deal's choices as `templates/treasure/deal-options.hbs` reads them: the
 * table style (a pressed button each, its tooltip the page the imported table
 * was read from, or the bare name with none), the arms and armor column field,
 * the special-treasure and lair toggles, and the Treasure tables button. The
 * pot's rail spreads this into its deal context; a card that offers the same
 * choices hands it to the partial whole.
 *
 * `locked` disables every control and `reason` is the visible line saying why
 * (`{text, tip}`, the tooltip going on its wrapper); the rail sets neither.
 *
 * @param {object} args
 * @param {{style: string, special: boolean, metInLair: boolean, armsSetting: string}} args.deal the choices as a pot stores them
 * @param {string[]} args.styleKeys the table styles, in the order they are offered
 * @param {(style: string) => string|null} args.styleCite the page a style's imported table was read from, null while it is not imported
 * @param {{columns: Array<{key: string, label: string}>, cite: string|null}} args.arms `deal.mjs` `armsSource()`
 * @param {(key: string, data?: object) => string} args.loc the treasure lang formatter
 * @param {boolean} [args.canBrowse] `canBrowseTables` for the seat drawing it
 * @param {boolean} [args.locked]
 * @param {{text: string, tip: string}|null} [args.reason]
 */
export function dealOptionsView({ deal, styleKeys, styleCite, arms, loc, canBrowse = false, locked = false, reason = null }) {
  const cite = loc("cite.deal");
  const styles = styleKeys.map((key) => {
    const label = loc(`deal.style.${key}`);
    const page = styleCite(key);
    // No page is named while the table is not imported: the module ships no citation for a style.
    return { key, label, pressed: deal.style === key, tip: page ? loc("deal.tip.style", { style: label, cite: page }) : loc("deal.tip.styleBare", { style: label }), off: locked };
  });
  const field = armsField({ columns: arms.columns, chosen: deal.armsSetting, cite: arms.cite ?? loc("cite.arms"), loc });
  return {
    styles,
    arms: locked ? { ...field, off: true } : field,
    special: deal.special,
    lair: deal.metInLair,
    lairTip: cite,
    tablesButton: canBrowse ? { label: loc("deal.tables"), tip: loc("deal.tip.tables", { cite }) } : null,
    locked,
    reason,
  };
}
