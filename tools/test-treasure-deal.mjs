/**
 * Dealing letters into a pot: the "Met in their lair" state, the lair warning,
 * selected tokens grouped by kind, and the Foundry-side deal over a fake world.
 * Every letter, creature and table here is this file's own invention.
 */
import assert from "node:assert/strict";

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

const flags = {};
const pile = {
  id: "pile1",
  type: "pile",
  documentName: "Cards",
  flags,
  cards: new Map(),
  async createEmbeddedDocuments(_kind, data) {
    return data.map((_d, i) => ({ id: `card${this.cards.size + i}` })).map((c) => (this.cards.set(c.id, c), c));
  },
  async update(changes) {
    for (const [path, value] of Object.entries(changes)) {
      const keys = path.split(".");
      let at = this;
      for (const k of keys.slice(0, -1)) at = at[k] ??= {};
      at[keys.at(-1)] = value;
    }
  },
};
let controlled = [];
globalThis.game = {
  user: { isGM: true },
  i18n: { lang: "en", localize: (key) => key, format: (key) => key },
  actors: { get: (id) => ({ a1: { name: "Mossback" } })[id] },
  items: { find: () => undefined },
  cards: { get: (id) => (id === pile.id ? pile : undefined) },
  packs: [],
};
globalThis.canvas = { tokens: { get controlled() { return controlled; } } };
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.foundry = {};

const { PHASE, MODULE_ID, POT_FLAG } = await import("../scripts/treasure/constants.mjs");
const { normalizePot, setMetInLair, setToggle, DEAL_TOGGLE } = await import("../scripts/treasure/pot-logic.mjs");
const { DEAL_REFUSAL, groupMonsters, lairWarning, runLetterDeal } = await import("../scripts/treasure/deal-logic.mjs");

/* --- the staging state --- */
{
  eq(normalizePot({}).deal.metInLair, false, "met in their lair defaults off");
  eq(normalizePot({ deal: { metInLair: true } }).deal.metInLair, true, "a true is kept");
  eq(normalizePot({ deal: { metInLair: "yes" } }).deal.metInLair, false, "only a real true counts");
  eq(normalizePot({ deal: { metInLair: 1 } }).deal.metInLair, false, "a truthy non-boolean is off");
  const staged = normalizePot({ phase: PHASE.staging });
  const set = setMetInLair(staged, true);
  eq(set.deal.metInLair, true, "the Judge sets it during staging");
  eq(set.deal.toggles, staged.deal.toggles, "setting it leaves the deal toggles alone");
  eq(setMetInLair(set, false).deal.metInLair, false, "and clears it");
  eq(staged.deal.metInLair, false, "the input pot is not changed");
  ok(setMetInLair(normalizePot({ phase: PHASE.open }), true) === null, "no change once the pot is open");
  eq(setToggle(set, DEAL_TOGGLE.noMagic, true).deal.metInLair, true, "a toggle set later keeps it");
}

/* --- the warning --- */
{
  eq(lairWarning({ letters: ["Q"], metInLair: false }), { letters: ["Q"] }, "a letter not met in its lair warns");
  ok(lairWarning({ letters: ["Q"], metInLair: true }) === null, "met in their lair: no warning");
  ok(lairWarning({ letters: [], metInLair: false }) === null, "no letters: no warning");
  ok(lairWarning({ letters: [null, "", "none", "None"], metInLair: false }) === null, "blank and none are no letter");
  ok(lairWarning({ letters: ["Q"] }) !== null, "an unset toggle is not met");
  ok(lairWarning({ letters: ["Q"], metInLair: "true" }) !== null, "only a real true silences it");
  eq(lairWarning({ letters: ["Q", "R", "Q", null], metInLair: false }), { letters: ["Q", "R"] }, "distinct letters in order");
  eq(lairWarning({ letters: [{ letter: "R" }, { letter: null }], metInLair: false }), { letters: ["R"] }, "rows carrying letters are read");
  ok(lairWarning() === null, "no arguments is no warning");
}

/* --- grouping --- */
{
  eq(groupMonsters([]), [], "no tokens, no rows");
  eq(groupMonsters(null), [], "no list, no rows");
  const rows = groupMonsters([
    { actorId: "a1", name: "Mossback", letter: "Q" },
    { actorId: "b2", name: "Gloomling", letter: null },
    { actorId: "a1", name: "Mossback", letter: "Q" },
    { actorId: "a1", name: "Mossback", letter: "Q" },
    { actorId: "c3", name: "Hollow", letter: "none" },
  ]);
  eq(rows, [
    { actorId: "a1", name: "Mossback", count: 3, letter: "Q" },
    { actorId: "b2", name: "Gloomling", count: 1, letter: null },
    { actorId: "c3", name: "Hollow", count: 1, letter: null },
  ], "one row per kind, in first-seen order, a no-letter kind kept with null");
  eq(groupMonsters([{ actorId: "a1", name: "Mossback", letter: null }, { actorId: "a1", name: "Mossback", letter: "R" }])[0].letter, "R", "a group takes the first letter any token carries");
  eq(groupMonsters([{ actorId: "a1", name: "Mossback", letter: "Q" }, { actorId: "a1", name: "Mossback", letter: null }, { actorId: "a1", name: "Mossback", letter: "R" }])[0].letter, "Q", "a later token never replaces a letter already found");
  eq(groupMonsters([{ name: "Wisp" }, { name: "Wisp" }, { name: "Gust" }]).map((r) => [r.name, r.count]), [["Wisp", 2], ["Gust", 1]], "tokens with no actor id group by name");
  eq(groupMonsters([{ actorId: "a1", name: "x" }, null, undefined]).map((r) => r.count), [1], "a hole in the list is skipped");
}

/* --- the deal, on injected seams --- */
const plain = () => {
  const log = { dealt: [], staged: [], confirms: [] };
  return {
    log,
    base: {
      isGM: true,
      pot: normalizePot({ phase: PHASE.staging }),
      letters: ["Q", "R"],
      deal: async ({ letter, toggles }) => {
        log.dealt.push([letter, toggles]);
        return { truths: [{ label: `${letter}1` }, { label: `${letter}2` }], errors: [], cite: "INV p. 1" };
      },
      stage: async (truths) => {
        log.staged.push(truths.map((t) => t.label));
        return truths.map((_t, i) => `id${i}`);
      },
    },
  };
};
{
  let w = plain();
  let r = await runLetterDeal({ ...w.base, isGM: false });
  eq(r, { ok: false, reason: "notAllowed" }, "a seat that is not the Judge's is refused");
  r = await runLetterDeal({ ...w.base, pot: normalizePot({ phase: PHASE.open }) });
  eq(r, { ok: false, reason: "phase" }, "an open pot is refused");
  r = await runLetterDeal({ ...w.base, letters: [null, "none"] });
  eq(r, { ok: false, reason: "empty" }, "no letter is refused");
  eq(w.log.dealt, [], "none of those dealt");

  r = await runLetterDeal(w.base);
  eq(r, { ok: false, reason: DEAL_REFUSAL.lairUnconfirmed }, "a warning with no confirm refuses");
  eq([w.log.dealt, w.log.staged], [[], []], "and stages nothing");

  const asked = [];
  r = await runLetterDeal({ ...w.base, confirmLair: async (warning) => (asked.push(warning), false) });
  eq(r, { ok: false, reason: DEAL_REFUSAL.lairDeclined }, "a declined confirm refuses");
  eq(asked, [{ letters: ["Q", "R"] }], "the confirm is shown the letters");
  r = await runLetterDeal({ ...w.base, confirmLair: () => undefined });
  eq(r.reason, DEAL_REFUSAL.lairDeclined, "only a true confirms");
  eq([w.log.dealt, w.log.staged], [[], []], "a decline stages nothing");

  r = await runLetterDeal({ ...w.base, confirmLair: async () => true });
  eq(r.ok, true, "a confirm deals");
  eq(w.log.dealt.map((d) => d[0]), ["Q", "R"], "each letter dealt once, in order");
  eq(w.log.staged, [["Q1", "Q2", "R1", "R2"]], "every truth staged in one go");
  eq(r.dealt, [
    { letter: "Q", cards: 2, errors: [], cite: "INV p. 1" },
    { letter: "R", cards: 2, errors: [], cite: "INV p. 1" },
  ], "the result names each letter's cards");
  eq(r.staged, ["id0", "id1", "id2", "id3"], "and the staged ids");

  w = plain();
  let asks = 0;
  r = await runLetterDeal({ ...w.base, pot: normalizePot({ phase: PHASE.staging, deal: { metInLair: true } }), confirmLair: async () => (asks++, false) });
  eq(r.ok, true, "met in their lair deals");
  eq(asks, 0, "and asks no one");

  w = plain();
  const pot = normalizePot({ phase: PHASE.staging, deal: { metInLair: true, toggles: { noMagic: true } } });
  await runLetterDeal({ ...w.base, pot, letters: ["Q"] });
  eq(w.log.dealt[0][1], { noMagic: true, forceCursed: false }, "the pot's deal toggles reach the deal");

  w = plain();
  r = await runLetterDeal({
    ...w.base,
    pot,
    deal: async () => ({ truths: [], errors: [{ code: "not-imported" }], cite: null }),
  });
  eq(r.staged, [], "a deal of nothing stages nothing");
  eq(w.log.staged, [], "and never calls stage");
  eq(r.dealt[0].errors, [{ code: "not-imported" }], "its errors are carried");
}

/* --- the Foundry side, over a fake world --- */
{
  const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");
  const { dealLettersIntoPot, selectedMonsterGroups } = await import("../scripts/treasure/deal.mjs");
  globalThis.game.items = { find: (fits) => { const c = { name: "game.i18n coin", type: "money", system: { coppervalue: 1, quantity: 1, unitweight: 1 } }; return fits(c) ? { toObject: () => structuredClone(c) } : undefined; } };
  globalThis.game.i18n.localize = (key) => (key.startsWith("ACKS-TREASURE.hoard.coin.") ? "game.i18n coin" : key);
  resetTables();
  registerTable({
    id: "treasure",
    cites: { typeClassic: "INV p. 1" },
    tables: {
      typeClassic: { Z: { category: "Odds", avgValue: null, cp: "2", sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: null } },
      typeUnits: { classic: { cp: "37s" } },
    },
  }, { priority: PRIORITY.WORLD });

  const reset = (potFlag) => {
    pile.cards.clear();
    for (const k of Object.keys(flags)) delete flags[k];
    flags[MODULE_ID] = { [POT_FLAG]: potFlag };
  };
  const cardsIn = () => pile.cards.size;
  const orderOf = () => flags[MODULE_ID][POT_FLAG].order ?? [];

  reset({ phase: PHASE.staging });
  let r = await dealLettersIntoPot(pile, { letters: ["Z"] });
  eq(r, { ok: false, reason: "lairUnconfirmed" }, "no confirm: refused");
  eq([cardsIn(), orderOf()], [0, []], "and nothing staged");

  r = await dealLettersIntoPot(pile, { letters: ["Z"], confirmLair: async () => false });
  eq(r.reason, "lairDeclined", "confirm false: refused");
  eq(cardsIn(), 0, "and nothing staged");

  let asked = 0;
  r = await dealLettersIntoPot(pile, { letters: ["Z"], confirmLair: async () => (asked++, true) });
  eq([r.ok, asked], [true, 1], "confirm true: dealt after one ask");
  eq([cardsIn(), orderOf().length], [1, 1], "the card is staged in the pot");
  eq(r.dealt[0].cite, "INV p. 1", "the deal's cite is carried");

  reset({ phase: PHASE.staging, deal: { metInLair: true } });
  asked = 0;
  r = await dealLettersIntoPot(pile, { letters: [{ letter: "Z" }], confirmLair: async () => (asked++, false) });
  eq([r.ok, asked, cardsIn()], [true, 0, 1], "met in their lair: dealt without asking");

  globalThis.game.user.isGM = false;
  r = await dealLettersIntoPot(pile, { letters: ["Z"], confirmLair: async () => true });
  eq(r, { ok: false, reason: "notAllowed" }, "a player is refused");
  globalThis.game.user.isGM = true;

  controlled = [
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "synth1", system: { details: { treasure: { type: "Z", table: "" } } } } },
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "synth2", system: { details: { treasure: { type: "Z" } } } } },
    { name: "Drifter", document: { actorId: "zz" }, actor: { id: "zz", system: { details: { treasure: { type: "none" } } } } },
    { name: "Bare", document: {}, actor: null },
  ];
  eq(selectedMonsterGroups(), [
    { actorId: "a1", name: "Mossback", count: 2, letter: "Z" },
    { actorId: "zz", name: "Drifter", count: 1, letter: null },
    { actorId: null, name: "Bare", count: 1, letter: null },
  ], "selected tokens are grouped by base actor, read off canvas");
  controlled = [];
  eq(selectedMonsterGroups(), [], "nothing selected, no rows");
  globalThis.canvas = undefined;
  eq(selectedMonsterGroups(), [], "no canvas, no rows");
}

console.log(`treasure deal: ${checks} checks passed`);
