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
const { normalizePot, setDealChoice, setMetInLair, setMonsterOn, setMonsters, setToggle, DEAL_STYLE, DEAL_TOGGLE } = await import("../scripts/treasure/pot-logic.mjs");
const { DEAL_ERROR_CODES, DEAL_REFUSAL, dealLines, dealMessages, groupMonsters, lairWarning, monsterRows, runLetterDeal } = await import("../scripts/treasure/deal-logic.mjs");
const { STYLE_TABLE } = await import("../scripts/treasure/hoard-map.mjs");
const { readFileSync } = await import("node:fs");
const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

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

/* --- the staged deal state: monster rows, the by-hand letter, style and special --- */
{
  const fresh = normalizePot({});
  eq([fresh.deal.monsters, fresh.deal.letter, fresh.deal.style, fresh.deal.special], [[], null, "classic", false], "a new pot stages no rows, no letter, classic, no special");
  eq(DEAL_STYLE, Object.keys(STYLE_TABLE), "the styles listed are the keys the hoard maps");

  const rows = normalizePot({
    deal: {
      monsters: [
        { actorId: "a1", name: "Mossback", count: 3.7, letter: " Q ", on: true },
        { actorId: "", name: 5, count: 0, letter: "none", on: true },
        { actorId: 7, name: "Drifter", count: "x", letter: null, on: "yes" },
        null,
        "junk",
      ],
    },
  }).deal.monsters;
  eq(rows, [
    { actorId: "a1", name: "Mossback", count: 3, letter: "Q", on: true },
    { actorId: null, name: "5", count: 1, letter: null, on: false },
    { actorId: null, name: "Drifter", count: 1, letter: null, on: false },
  ], "rows are cleaned: counts floor to one or more, a letter is trimmed, a row with no letter is never ticked, only a real true ticks");
  eq(normalizePot({ deal: { monsters: "x" } }).deal.monsters, [], "rows that are not a list are none");

  const kept = normalizePot({ deal: { letter: " R ", style: "gritty", special: true } });
  eq([kept.deal.letter, kept.deal.style, kept.deal.special], ["R", "gritty", true], "a by-hand letter, a listed style and special are kept");
  eq(normalizePot({ deal: { letter: "none", style: "epic", special: "yes" } }).deal, fresh.deal, "'none' is no letter, an unlisted style is classic, special needs a real true");

  const staged = normalizePot({ phase: PHASE.staging });
  const set = setMonsters(staged, [{ actorId: "a1", name: "Mossback", count: 2, letter: "Q", on: true }, { actorId: "a2", name: "Wisp", count: 1, letter: null, on: true }]);
  eq(set.deal.monsters.map((r) => [r.name, r.on]), [["Mossback", true], ["Wisp", false]], "setMonsters stores the rows, a letterless one clear");
  eq(setMonsters(normalizePot({ phase: PHASE.open }), []), null, "rows are staged in staging only");
  eq(staged.deal.monsters, [], "the input pot is not changed");
  eq(setMetInLair(set, true).deal.monsters, set.deal.monsters, "the lair toggle keeps the rows");

  eq(setMonsterOn(set, 0, false).deal.monsters[0].on, false, "a row is cleared");
  eq(setMonsterOn(setMonsterOn(set, 0, false), 0, true).deal.monsters[0].on, true, "and ticked again");
  eq(setMonsterOn(set, 1, true), null, "a row with no letter cannot be ticked");
  eq(setMonsterOn(set, 2, true), null, "a row that does not exist is refused");
  eq(setMonsterOn(set, -1, true), null, "a negative index is refused");
  eq(setMonsterOn(set, "0", true), null, "an index that is not an integer is refused");
  eq(setMonsterOn(normalizePot({ phase: PHASE.open, deal: { monsters: [{ name: "x", letter: "Q" }] } }), 0, true), null, "ticking is staging only");

  eq(setDealChoice(staged, "style", "heroic").deal.style, "heroic", "a listed style is set");
  eq(setDealChoice(staged, "style", "epic"), null, "an unlisted style is refused");
  eq(setDealChoice(staged, "special", true).deal.special, true, "special is set");
  eq(setDealChoice(setDealChoice(staged, "special", true), "special", false).deal.special, false, "and cleared");
  eq(setDealChoice(staged, "special", "yes").deal.special, false, "only a real true sets it");
  eq(setDealChoice(staged, "letter", " K ").deal.letter, "K", "a by-hand letter is trimmed");
  eq(setDealChoice(setDealChoice(staged, "letter", "K"), "letter", "").deal.letter, null, "a blank clears it");
  eq(setDealChoice(staged, "metInLair", true), null, "a key that is not a choice is refused");
  eq(setDealChoice(normalizePot({ phase: PHASE.open }), "style", "heroic"), null, "choices are staging only");
  eq(setDealChoice(set, "style", "gritty").deal.monsters, set.deal.monsters, "a choice keeps the rows");
}

/* --- rows from groups, and what a Deal sends --- */
{
  const groups = groupMonsters([{ actorId: "a1", name: "Mossback", letter: "Q" }, { actorId: "a1", name: "Mossback", letter: "Q" }, { actorId: "a2", name: "Wisp", letter: null }]);
  eq(monsterRows(groups), [
    { actorId: "a1", name: "Mossback", count: 2, letter: "Q", on: true },
    { actorId: "a2", name: "Wisp", count: 1, letter: null, on: false },
  ], "a kind with a letter is ticked, one without is clear");
  eq(monsterRows([{ actorId: "a1", name: "m", count: 0, letter: "none" }, null]), [{ actorId: "a1", name: "m", count: 1, letter: null, on: false }], "'none' is no letter; a hole is skipped");
  eq(monsterRows(undefined), [], "no kinds, no rows");

  const dealOf = (monsters, letter) => normalizePot({ deal: { monsters, letter } }).deal;
  eq(dealLines(dealOf([
    { name: "Mossback", count: 4, letter: "Q", on: true },
    { name: "Wisp", count: 1, letter: "Q", on: true },
    { name: "Gust", count: 2, letter: "R", on: false },
    { name: "Bare", count: 1, letter: null, on: true },
  ], "Z")), [
    { letter: "Q", name: "Mossback", count: 4 },
    { letter: "Q", name: "Wisp", count: 1 },
    { letter: "Z", name: null, count: 0 },
  ], "one line per ticked row with a letter, a kind's count never multiplies its hoard, the by-hand letter last");
  eq(dealLines(dealOf([], null)), [], "nothing ticked and no letter: no line");
  eq(dealLines(undefined), [], "no state, no line");
}

/* --- what the Judge is told --- */
{
  const dealt = (letter, cards, errors = []) => ({ letter, cards, errors });
  eq(dealMessages(undefined), [], "no outcome, no message");
  eq(dealMessages({ ok: false, reason: "lairUnconfirmed" }), [], "the warning answers a lair refusal, so nothing is said");
  eq(dealMessages({ ok: false, reason: "lairDeclined" }), [], "a declined lair says nothing");
  eq(dealMessages({ ok: false, reason: "empty" }), [{ level: "warn", key: "deal.refuse.empty", args: {} }], "an empty deal is said");
  eq(dealMessages({ ok: false, reason: "phase" })[0].key, "deal.refuse.phase", "an open pot is said");
  eq(dealMessages({ ok: false, reason: "notAllowed" })[0].key, "deal.refuse.notAllowed", "a seat that may not is said");
  eq(dealMessages({ ok: false, reason: "somethingNew" })[0].key, "deal.refuse.failed", "any other reason is a generic failure");
  eq(dealMessages({ ok: true, dealt: [dealt("Q", 2), dealt("R", 0)], staged: ["a", "b"] }), [{ level: "info", key: "deal.done", args: { n: 2, letters: "Q" } }], "cards staged: the count and the letters that made them");
  eq(
    dealMessages({ ok: true, dealt: [dealt("Q", 0, [{ code: "not-imported", table: "t" }])], staged: [] }),
    [{ level: "warn", key: "deal.error.not-imported", args: { letter: "Q", column: "", style: "", code: "not-imported" } }],
    "nothing imported: the error, and no 'nothing' beside it",
  );
  const many = dealMessages({
    ok: true,
    dealt: [
      dealt("Q", 1, [{ code: "column-skipped", column: "gems" }, { code: "column-skipped", column: "gems" }, { code: "column-skipped", column: "jewelry" }, { code: "weird" }, { code: "weird" }, { code: "odd" }]),
      dealt("R", 1, [{ code: "column-skipped", column: "gems" }]),
    ],
    staged: ["x"],
  });
  eq(many.slice(0, -1).map((m) => `${m.key}:${m.args.letter}:${m.args.column || m.args.code}`), [
    "deal.error.column-skipped:Q:gems",
    "deal.error.column-skipped:Q:jewelry",
    "deal.error.other:Q:weird",
    "deal.error.other:Q:odd",
    "deal.error.column-skipped:R:gems",
  ], "each distinct error of each letter once");
  eq(many.at(-1), { level: "info", key: "deal.done", args: { n: 1, letters: "Q, R" } }, "and the count last");
  eq(dealMessages({ ok: true, dealt: [dealt("Q", 0)], staged: [] }), [{ level: "warn", key: "deal.nothing", args: {} }], "a deal of nothing, with no error, says so");
  for (const code of DEAL_ERROR_CODES) ok(typeof lang[`ACKS-TREASURE.deal.error.${code}`] === "string", `error code ${code} has its lang string`);
  for (const key of ["deal.error.other", "deal.done", "deal.nothing", "deal.refuse.empty", "deal.refuse.phase", "deal.refuse.notAllowed", "deal.refuse.failed"]) ok(typeof lang[`ACKS-TREASURE.${key}`] === "string", `${key} has its lang string`);
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
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "synth1", type: "monster", system: { details: { treasure: { type: "Z", table: "" } } } } },
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "synth2", type: "monster", system: { details: { treasure: { type: "Z" } } } } },
    { name: "Drifter", document: { actorId: "zz" }, actor: { id: "zz", type: "monster", system: { details: { treasure: { type: "none" } } } } },
    { name: "Hero", document: { actorId: "pc" }, actor: { id: "pc", type: "character", system: {} } },
    { name: "Bare", document: {}, actor: null },
  ];
  eq(selectedMonsterGroups(), [
    { actorId: "a1", name: "Mossback", count: 2, letter: "Z" },
    { actorId: "zz", name: "Drifter", count: 1, letter: null },
  ], "selected monster tokens are grouped by base actor, read off canvas; a character or an actorless token is skipped");
  controlled = [];
  eq(selectedMonsterGroups(), [], "nothing selected, no rows");

  // The staged-state writes, and the pot the entries open.
  const { setDealMonsterOn, setDealMonsters, setDealOption, setDealMetInLair } = await import("../scripts/treasure/pot.mjs");
  const { newDealPot } = await import("../scripts/treasure/deal.mjs");
  const stored = () => flags[MODULE_ID][POT_FLAG].deal;
  reset({ phase: PHASE.staging });
  await setDealMonsters(pile, [{ actorId: "a1", name: "Mossback", count: 2, letter: "Z", on: true }, { actorId: "a2", name: "Wisp", count: 1, letter: null, on: true }]);
  eq(stored().monsters.map((r) => [r.name, r.on]), [["Mossback", true], ["Wisp", false]], "rows are written to the pot's flag, a letterless one clear");
  await setDealMonsterOn(pile, 0, false);
  eq(stored().monsters[0].on, false, "a tick is written");
  eq(await setDealMonsterOn(pile, 1, true), null, "a row with no letter writes nothing");
  eq(stored().monsters[1].on, false, "and stays clear");
  await setDealOption(pile, "style", "gritty");
  await setDealOption(pile, "special", true);
  await setDealOption(pile, "letter", " K ");
  eq([stored().style, stored().special, stored().letter], ["gritty", true, "K"], "style, special and the by-hand letter are written");
  eq(await setDealOption(pile, "style", "epic"), null, "an unlisted style writes nothing");
  await setDealMetInLair(pile, true);
  eq(stored().monsters.length, 2, "a later write keeps the rows");
  r = await dealLettersIntoPot(pile, { letters: ["Z"], style: "classic" });
  eq(r.ok, true, "a staged pot with the lair set deals unasked");
  eq(stored().letter, "K", "a deal leaves the staged letter alone");
  reset({ phase: PHASE.open });
  eq([await setDealMonsters(pile, []), await setDealMonsterOn(pile, 0, true), await setDealOption(pile, "special", true)], [null, null, null], "an open pot takes none of them");
  globalThis.game.user.isGM = false;
  reset({ phase: PHASE.staging, deal: { monsters: [{ name: "x", letter: "Z", on: false }] } });
  eq([await setDealMonsters(pile, [{ name: "y", letter: "Z" }]), await setDealMonsterOn(pile, 0, true), await setDealOption(pile, "special", true)], [null, null, null], "a player writes none of them");
  eq(flags[MODULE_ID][POT_FLAG].deal.monsters, [{ name: "x", letter: "Z", on: false }], "and nothing is stored");
  globalThis.game.user.isGM = true;

  const made = [];
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
  globalThis.ui = { notifications: { warn() {} } };
  globalThis.foundry = { documents: { Cards: { implementation: { create: async (data) => (made.push(data), { id: "newpot", sheet: null }) } } } };
  controlled = [
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "a1", type: "monster", system: { details: { treasure: { type: "Z" } } } } },
    { name: "Mossback", document: { actorId: "a1" }, actor: { id: "a1", type: "monster", system: { details: { treasure: { type: "Z" } } } } },
    { name: "Drifter", document: { actorId: "zz" }, actor: { id: "zz", type: "monster", system: { details: { treasure: { type: "none" } } } } },
  ];
  await newDealPot();
  const opened = made.at(-1).flags[MODULE_ID][POT_FLAG];
  eq(opened.deal.monsters, [
    { actorId: "a1", name: "Mossback", count: 2, letter: "Z", on: true },
    { actorId: "zz", name: "Drifter", count: 1, letter: null, on: false },
  ], "selected tokens open the pot staged with one row per kind, a kind with a letter ticked");
  eq([opened.phase, opened.order], [PHASE.staging, []], "the pot is staging and nothing is dealt");
  controlled = [];
  await newDealPot();
  eq(made.at(-1).flags[MODULE_ID][POT_FLAG].deal.monsters, [], "nothing selected opens By hand, as before");
  await newDealPot([{ actorId: "a1", name: "Mossback", count: 1, letter: "Z" }]);
  eq(made.at(-1).flags[MODULE_ID][POT_FLAG].deal.monsters.map((x) => [x.name, x.on]), [["Mossback", true]], "a sheet opens the pot with its one monster ticked");
  await newDealPot([{ actorId: "a1", name: "Mossback", count: 1, letter: null }]);
  eq(made.at(-1).flags[MODULE_ID][POT_FLAG].deal.monsters.map((x) => [x.name, x.on]), [["Mossback", false]], "a sheet with no letter opens its row clear");
  globalThis.game.user.isGM = false;
  const before = made.length;
  eq([await newDealPot([{ actorId: "a1", name: "x", count: 1, letter: "Z" }]), made.length], [null, before], "a player opens no pot");
  globalThis.game.user.isGM = true;
  globalThis.canvas = undefined;
  eq(selectedMonsterGroups(), [], "no canvas, no rows");
}

console.log(`treasure deal: ${checks} checks passed`);
