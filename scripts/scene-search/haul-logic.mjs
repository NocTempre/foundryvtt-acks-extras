/**
 * The scene's haul on plain data, Foundry-free: dealing a place's treasure into
 * a pot when the scene opens, which entry holds which lot, and which lots a
 * check finds. `haul.mjs` is the Foundry side.
 *
 * The deal is the treasure feature's own (`treasure/deal-logic.mjs`
 * `runLetterDeal`, over the hoard generator), run once per SOURCE: a source is
 * the entry that hides what it deals, with the letters (or ready truths) the
 * Judge gave it. The caller says which entry holds what; nothing here chooses
 * a hiding place. Every lot is staged unfound with a key (`<thing>/<n>`) that
 * the thing lists under its layer's `yields.lots`, and a check that finds the
 * entry answers with those keys (`scene:found`), which `foundKeys` reads. The
 * pot ranks its bands once, when it opens (`treasure/pot-logic.mjs`
 * `planOpen`), over every lot, so finding one never moves another's band.
 */
import { PHASE, REFUSAL } from "../treasure/constants.mjs";
import { DEAL_REFUSAL, lairWarning, runLetterDeal } from "../treasure/deal-logic.mjs";
import { letterOf } from "../treasure/search-logic.mjs";
import { potCards } from "../treasure/pot-logic.mjs";
import { LAYER_NAMES } from "../lib/place-things-logic.mjs";
import { CODE, LAYER } from "./constants.mjs";

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The sources of a haul in their clean shape: `{thing, layer, letters, truths}`.
 * `thing` is the id of the place's thing that hides the lots, `layer` the check
 * that finds them (the hasty check unless it names the methodical one: "Finding
 * the loot is the hasty check of the room"), `letters` the treasure letters to
 * deal for it and `truths` goods already made into card truths. A source with
 * no thing, or neither letters nor truths, is dropped.
 * @param {Array<{thing: string, layer?: string, letters?: Array<string|{letter: string|null}>, truths?: object[]}>} list
 */
export function normalizeSources(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isPlain(raw)) continue;
    const thing = typeof raw.thing === "string" ? raw.thing.trim() : "";
    const letters = (Array.isArray(raw.letters) ? raw.letters : []).map((x) => letterOf(typeof x === "string" ? x : x?.letter)).filter(Boolean);
    const truths = (Array.isArray(raw.truths) ? raw.truths : []).filter(isPlain);
    if (!thing || !(letters.length || truths.length)) continue;
    out.push({ thing, layer: LAYER_NAMES.includes(raw.layer) ? raw.layer : LAYER.HASTY, letters, truths });
  }
  return out;
}

/** The key a thing lists its nth lot under (1-based). */
export const lotKey = (thing, n) => `${thing}/${n}`;

/**
 * Deal a scene's haul into a staged pot, one source at a time, every lot
 * unfound. Judge-only; the pot must be staging. The lair warning
 * (`lairWarning`) stands once for every letter of every source: `confirmLair`
 * is awaited once and the deal runs only on `true`, and with none supplied the
 * deal refuses `lairUnconfirmed` and stages nothing. Each source's letters then
 * go through `runLetterDeal` (the pot's toggles honoured), the truths of every
 * source are tagged `found: false` with their key, and all are staged in one
 * call, in source order, so `ids[i]` is the card of lot `i`.
 *
 * @param {object} args
 * @param {boolean} args.isGM
 * @param {object} args.pot the pot's normalized flag
 * @param {Array<object>} args.sources see `normalizeSources`
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} [args.confirmLair]
 * @param {(args: {letter: string, toggles: object}) => Promise<{truths: object[], errors: object[], cite: string|null}>} args.deal one letter dealt
 * @param {(truths: object[]) => Promise<string[]>} args.stage puts truths in the pot, returning the new card ids
 * @returns {Promise<{ok: true, dealt: object[], lots: Array<{key: string, thing: string, layer: string, cardId: string}>}|{ok: false, reason: string, dealt?: object[]}>}
 */
export async function runHaulDeal({ isGM, pot, sources, confirmLair, deal, stage }) {
  if (!isGM) return { ok: false, reason: REFUSAL.notAllowed };
  if (!pot || pot.phase !== PHASE.staging) return { ok: false, reason: REFUSAL.phase };
  const list = normalizeSources(sources);
  if (!list.length) return { ok: false, reason: REFUSAL.empty };
  const warning = lairWarning({ letters: list.flatMap((s) => s.letters), metInLair: pot.deal?.metInLair });
  if (warning) {
    if (typeof confirmLair !== "function") return { ok: false, reason: DEAL_REFUSAL.lairUnconfirmed };
    if ((await confirmLair(warning)) !== true) return { ok: false, reason: DEAL_REFUSAL.lairDeclined };
  }
  // The warning is answered for the whole haul, so each source's deal runs as a pot met in its lair.
  const answered = { ...pot, deal: { ...pot.deal, metInLair: true } };
  const counts = new Map();
  const planned = [];
  const tagged = [];
  const dealt = [];
  for (const source of list) {
    const truths = [...source.truths];
    if (source.letters.length) {
      const result = await runLetterDeal({
        isGM,
        pot: answered,
        letters: source.letters,
        deal,
        stage: async (made) => {
          truths.push(...made);
          return [];
        },
      });
      if (!result.ok) return result;
      dealt.push(...result.dealt.map((d) => ({ ...d, thing: source.thing })));
    }
    for (const truth of truths) {
      const n = (counts.get(source.thing) ?? 0) + 1;
      counts.set(source.thing, n);
      const key = lotKey(source.thing, n);
      tagged.push({ ...truth, found: false, lot: key });
      planned.push({ key, thing: source.thing, layer: source.layer });
    }
  }
  if (!tagged.length) return { ok: false, reason: REFUSAL.empty, dealt };
  const ids = await stage(tagged);
  if (!Array.isArray(ids) || ids.length !== tagged.length) return { ok: false, reason: REFUSAL.failed, dealt };
  return { ok: true, dealt, lots: planned.map((p, i) => ({ ...p, cardId: ids[i] })) };
}

/**
 * The planned lots that are still in the opened pot: a deal toggle may strike a
 * card when the pot opens, and its key then names nothing.
 * @param {Array<{key: string, cardId: string}>} lots `runHaulDeal`'s lots
 * @param {object} view the opened pot's `PotView`
 */
export function lotsInPot(lots, view) {
  const held = new Set(potCards(view).map((c) => c.id));
  return (Array.isArray(lots) ? lots : []).filter((lot) => held.has(lot.cardId));
}

/**
 * The place's thing list with each lot's key added to the `yields.lots` of the
 * layer of the thing that hides it: a NEW list, the input untouched. A lot whose
 * thing is not in the list (a fight's body is read from its record, not stored
 * here) is returned in `missing`, and the caller keeps it where that entry's
 * layers live.
 * @param {object[]} things the place's stored list
 * @param {Array<{key: string, thing: string, layer: string}>} lots
 * @returns {{things: object[], missing: string[]}}
 */
export function attachLots(things, lots) {
  const out = structuredClone(Array.isArray(things) ? things : []);
  const missing = [];
  for (const lot of Array.isArray(lots) ? lots : []) {
    const thing = out.find((t) => t?.id === lot.thing);
    if (!thing) {
      missing.push(lot.key);
      continue;
    }
    thing.layers = isPlain(thing.layers) ? thing.layers : {};
    const layer = isPlain(thing.layers[lot.layer]) ? thing.layers[lot.layer] : {};
    thing.layers[lot.layer] = layer;
    layer.yields = isPlain(layer.yields) ? layer.yields : {};
    const held = Array.isArray(layer.yields.lots) ? layer.yields.lots : [];
    layer.yields.lots = held.includes(lot.key) ? held : [...held, lot.key];
  }
  return { things: out, missing };
}

/**
 * The lot keys a check's outcome finds: the `lots` of a `scene:found` answer,
 * and nothing for any other answer (a vague hint, found-nothing, a refusal).
 * @param {{code?: string, lots?: string[]}|null} outcome `outcomeOf`'s answer
 * @returns {string[]}
 */
export function foundKeys(outcome) {
  if (outcome?.code !== CODE.FOUND) return [];
  return [...new Set((Array.isArray(outcome.lots) ? outcome.lots : []).filter((k) => typeof k === "string" && k))];
}
