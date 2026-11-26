/**
 * The scene's haul: lots dealt unfound behind the entries that hide them, the
 * found mark and what each reader of a pot does with it, bands fixed at the
 * deal, and the Foundry side over a fake world. Every letter, thing and table
 * here is this file's own invention.
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

let usersNow = [{ id: "j1", isGM: true }, { id: "p1", isGM: false }, { id: "p2", isGM: false }];
const gone = [];
const setPath = (target, path, value) => {
  const keys = path.split(".");
  let at = target;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)] = value;
};
/** A pile's embedded collection: a Map with core's `contents`. */
class CardMap extends Map {
  get contents() {
    return [...this.values()];
  }
}
const pileOf = (id) => {
  const pile = {
    id,
    uuid: `Cards.${id}`,
    type: "pile",
    documentName: "Cards",
    name: "",
    flags: {},
    ownership: {},
    cards: new CardMap(),
    async createEmbeddedDocuments(_kind, data) {
      return data.map((d) => {
        const card = { id: `c${this.cards.size + 1}`, ...structuredClone(d) };
        this.cards.set(card.id, card);
        return card;
      });
    },
    async updateEmbeddedDocuments(_kind, updates) {
      for (const { _id, ...rest } of updates) for (const [path, value] of Object.entries(rest)) setPath(this.cards.get(_id), path, value);
    },
    async deleteEmbeddedDocuments(_kind, ids) {
      for (const cid of ids) this.cards.delete(cid);
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
    },
    async delete() {
      gone.push(this.id);
    },
  };
  return pile;
};
let piles = [];
globalThis.game = {
  user: { isGM: true },
  users: { filter: (fn) => usersNow.filter(fn) },
  i18n: { lang: "en", localize: (key) => (key.startsWith("ACKS-TREASURE.hoard.coin.") ? "game.i18n coin" : key), format: (key) => key },
  items: { find: (fits) => { const c = { name: "game.i18n coin", type: "money", system: { coppervalue: 1, quantity: 1, unitweight: 1 } }; return fits(c) ? { toObject: () => structuredClone(c) } : undefined; } },
  actors: { get: () => undefined },
  cards: { get: (id) => piles.find((p) => p.id === id) },
  messages: { get: () => undefined },
  packs: [],
};
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OWNER: 3 } };
globalThis.ui = { notifications: { warn() {} } };
globalThis.ChatMessage = { create: async () => ({ id: "msg" }), getWhisperRecipients: () => [] };
globalThis.foundry = {
  dice: { MersenneTwister: { random: () => 0.5 } },
  documents: { Cards: { implementation: { create: async (data) => { const pile = Object.assign(pileOf(`pot${piles.length + 1}`), data); piles.push(pile); return pile; } } } },
  utils: { escapeHTML: (s) => String(s) },
};

const { PHASE, REFUSAL, MODULE_ID, POT_FLAG, CARD_FLAG, POOL } = await import("../scripts/treasure/constants.mjs");
const L = await import("../scripts/treasure/pot-logic.mjs");
const { grabLots } = await import("../scripts/treasure/grab-pot.mjs");
const { DEAL_REFUSAL } = await import("../scripts/treasure/deal-logic.mjs");
const H = await import("../scripts/scene-search/haul-logic.mjs");
const { CODE } = await import("../scripts/scene-search/constants.mjs");
const { outcomeOf, sceneEntries } = await import("../scripts/scene-search/scene-logic.mjs");

const truth = (over = {}) => L.normalizeTruth({ pool: POOL.item, label: "Wooden spoon", weight6: 1, ...over });
const valued = (label, gp, over = {}) => truth({ label, valueGp: gp, ...over });
const card = (id, over = {}, face = null, value = 0) => ({ id, face, value, truth: truth(over) });
const view = (cards, pot = {}) => ({ id: "pot", pot: L.normalizePot({ phase: PHASE.open, order: cards.map((c) => c.id), ...pot }), cards });
const player = { id: "p1", isGM: false };
const judge = { id: "j1", isGM: true };

/* --- the mark lives in the truth --- */
{
  eq(L.normalizeTruth({}).found, true, "a truth that states no mark is found");
  eq(L.normalizeTruth({ found: false }).found, false, "an unfound mark is kept");
  eq(L.normalizeTruth({ found: true }).found, true, "a found mark is kept");
  eq(L.normalizeTruth({ found: "no" }).found, true, "only a real false is unfound");
  eq([L.normalizeTruth({}).lot, L.normalizeTruth({ lot: 7 }).lot, L.normalizeTruth({ lot: "" }).lot], [null, null, null], "a lot key is a string or null");
  eq(L.normalizeTruth({ lot: "den/1" }).lot, "den/1", "a lot key is kept");
  const round = L.normalizeTruth(L.normalizeTruth({ found: false, lot: "den/1" }));
  eq([round.found, round.lot], [false, "den/1"], "normalizing twice keeps both");
  ok(L.isFound(card("a")) && !L.isFound(card("b", { found: false })), "isFound reads the truth");
}

/* --- sources --- */
{
  eq(H.normalizeSources(null), [], "no list, no sources");
  eq(
    H.normalizeSources([
      { thing: " den ", letters: ["Y", { letter: "Z" }, null, "none"] },
      { thing: "", letters: ["Y"] },
      { thing: "x", letters: [] },
      { thing: "chest", layer: "methodical", truths: [{ label: "gem" }] },
      { thing: "rug", layer: "teleport", letters: ["Y"] },
      "junk",
      null,
    ]),
    [
      { thing: "den", layer: "hasty", letters: ["Y", "Z"], truths: [], owners: [] },
      { thing: "chest", layer: "methodical", letters: [], truths: [{ label: "gem" }], owners: [null] },
      { thing: "rug", layer: "hasty", letters: ["Y"], truths: [], owners: [] },
    ],
    "a source names its thing, defaults to the hasty check, and drops what holds nothing",
  );
  eq([H.lotKey("den", 1), H.lotKey("den", 2)], ["den/1", "den/2"], "a lot's key is its thing and its place in that thing");
}

/* --- the deal, over injected seams --- */
const fakeDeal = (log = []) => async ({ letter, toggles }) => {
  log.push({ letter, toggles });
  return { truths: letter === "N" ? [] : [valued(`${letter} one`, 1), valued(`${letter} two`, 2)], errors: [], cite: null };
};
const fakeStage = (log = []) => async (truths) => {
  log.push(truths);
  return truths.map((_t, i) => `card${i + 1}`);
};
const staged = (deal = {}) => L.normalizePot({ phase: PHASE.staging, deal });
{
  const dealt = [];
  const stagedLog = [];
  let asked = 0;
  const r = await H.runHaulDeal({
    isGM: true,
    pot: staged({ metInLair: false, toggles: { noMagic: true } }),
    sources: [{ thing: "den", letters: ["Y"] }, { thing: "chest", layer: "methodical", letters: ["Z"] }, { thing: "den", letters: ["Y"] }],
    confirmLair: async (warning) => (asked++, eq(warning, { letters: ["Y", "Z"] }, "the warning names every letter of every source"), true),
    deal: fakeDeal(dealt),
    stage: fakeStage(stagedLog),
  });
  eq([r.ok, asked], [true, 1], "the lair is asked once for the whole haul");
  eq(dealt.length, 3, "each source's letter is dealt through the dealer");
  eq(dealt[0].toggles, { noMagic: true, forceCursed: false }, "the pot's deal toggles reach the dealer");
  eq(stagedLog.length, 1, "every lot is staged in one call");
  ok(stagedLog[0].every((t) => t.found === false), "every lot is staged unfound");
  eq(stagedLog[0].map((t) => t.lot), ["den/1", "den/2", "chest/1", "chest/2", "den/3", "den/4"], "keys count per thing across its sources");
  eq(r.lots, [
    { key: "den/1", thing: "den", layer: "hasty", cardId: "card1" },
    { key: "den/2", thing: "den", layer: "hasty", cardId: "card2" },
    { key: "chest/1", thing: "chest", layer: "methodical", cardId: "card3" },
    { key: "chest/2", thing: "chest", layer: "methodical", cardId: "card4" },
    { key: "den/3", thing: "den", layer: "hasty", cardId: "card5" },
    { key: "den/4", thing: "den", layer: "hasty", cardId: "card6" },
  ], "the map names each lot's key, thing, layer and card");
  eq(r.dealt.map((d) => [d.letter, d.thing]), [["Y", "den"], ["Z", "chest"], ["Y", "den"]], "the dealt report names the source");

  const lair = await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "a", letters: ["Y"] }], confirmLair: async () => (asked++, false), deal: fakeDeal(), stage: fakeStage() });
  eq([lair.ok, asked], [true, 1], "a pot met in its lair asks nothing");

  const log = [];
  eq((await H.runHaulDeal({ isGM: true, pot: staged(), sources: [{ thing: "a", letters: ["Y"] }], deal: fakeDeal(), stage: fakeStage(log) })), { ok: false, reason: DEAL_REFUSAL.lairUnconfirmed }, "no confirm, refused");
  eq((await H.runHaulDeal({ isGM: true, pot: staged(), sources: [{ thing: "a", letters: ["Y"] }], confirmLair: async () => false, deal: fakeDeal(), stage: fakeStage(log) })), { ok: false, reason: DEAL_REFUSAL.lairDeclined }, "a declined warning is refused");
  eq(log, [], "and nothing is staged on either");
  eq((await H.runHaulDeal({ isGM: false, pot: staged(), sources: [{ thing: "a", letters: ["Y"] }], deal: fakeDeal(), stage: fakeStage(log) })).reason, REFUSAL.notAllowed, "a player is refused");
  eq((await H.runHaulDeal({ isGM: true, pot: L.normalizePot({ phase: PHASE.open }), sources: [{ thing: "a", letters: ["Y"] }], deal: fakeDeal(), stage: fakeStage(log) })).reason, REFUSAL.phase, "an open pot is refused");
  eq((await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [], deal: fakeDeal(), stage: fakeStage(log) })).reason, REFUSAL.empty, "no source is refused");
  const none = await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "a", letters: ["N"] }], deal: fakeDeal(), stage: fakeStage(log) });
  eq([none.ok, none.reason, log], [false, REFUSAL.empty, []], "a deal that makes nothing stages nothing");
  const short = await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "a", letters: ["Y"] }], deal: fakeDeal(), stage: async () => ["only"] });
  eq(short.reason, REFUSAL.failed, "a stage that returns the wrong number of cards fails");
  const own = await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "body", truths: [{ label: "purse" }] }], deal: fakeDeal(), stage: fakeStage() });
  eq([own.ok, own.lots.map((l) => l.key)], [true, ["body/1"]], "ready-made truths are tagged and staged like dealt ones");

  // A haul given a magic roll hands it each letter's truths and stages what it answers; without one the truths are staged as dealt.
  {
    const rolledFor = [];
    const rollMagic = async ({ letter, truths }) => {
      rolledFor.push([letter, truths.map((t) => t.label)]);
      return { truths: [...truths.map((t) => ({ ...t, label: `${t.label} rolled` })), valued(`${letter} magic`, 9)], errors: [{ code: "magic", reason: "no-match" }], audit: [{ where: `${letter}.magic`, magic: true }] };
    };
    const log = [];
    const rolled = await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "den", letters: ["Y"] }, { thing: "chest", letters: ["Z"] }], deal: fakeDeal(), rollMagic, stage: fakeStage(log) });
    eq(rolledFor, [["Y", ["Y one", "Y two"]], ["Z", ["Z one", "Z two"]]], "each letter's truths go to the roll");
    eq(log[0].map((t) => t.label), ["Y one rolled", "Y two rolled", "Y magic", "Z one rolled", "Z two rolled", "Z magic"], "what the roll answers is what is staged");
    eq(rolled.lots.map((l) => l.key), ["den/1", "den/2", "den/3", "chest/1", "chest/2", "chest/3"], "a rolled truth takes its lot after the roll, like any other");
    eq(rolled.dealt.map((d) => [d.letter, d.thing, d.cards, d.errors.length, d.audit?.length]), [["Y", "den", 3, 1, 1], ["Z", "chest", 3, 1, 1]], "the roll's errors and audit rows join each letter's report");
    const plainLog = [];
    await H.runHaulDeal({ isGM: true, pot: staged({ metInLair: true }), sources: [{ thing: "den", letters: ["Y"] }], deal: fakeDeal(), stage: fakeStage(plainLog) });
    eq(plainLog[0].map((t) => t.label), ["Y one", "Y two"], "with no roll the truths are staged as dealt");
  }

  // A body's carried goods keep the item they were made from, and the letter's truths after them carry none.
  const spoon = { actorUuid: "Actor.b1", itemId: "i1" };
  const owned = await H.runHaulDeal({
    isGM: true,
    pot: staged({ metInLair: true }),
    sources: [{ thing: "body:b1", letters: ["Y"], truths: [{ label: "spoon" }, { label: "ladle" }], owners: [spoon, { actorUuid: "", itemId: "i2" }] }],
    deal: fakeDeal(),
    stage: fakeStage(),
  });
  eq(owned.lots.map((l) => [l.key, l.owner ?? null]), [["body:b1/1", spoon], ["body:b1/2", null], ["body:b1/3", null], ["body:b1/4", null]], "a lot made from a body's item names it, one with no owner or a blank one names none, and dealt lots follow");
}

/* --- which card stands for which body item --- */
{
  const lots = [
    { key: "body:b1/1", owner: { actorUuid: "Actor.b1", itemId: "i1" } },
    { key: "body:b1/2", owner: { actorUuid: "Actor.b1", itemId: "i2" } },
    { key: "body:b1/3" },
    { key: "body:b2/1", owner: { actorUuid: "Actor.b2", itemId: "i9" } },
  ];
  // The cards were made in another order than the lots were asked in, and one lot's card is gone.
  const v = view([card("z9", { lot: "body:b1/2" }), card("a1", { lot: "body:b1/1" }), card("m5", { lot: "body:b1/3" })]);
  eq(
    H.carriedOf(lots, v),
    { a1: { actorUuid: "Actor.b1", itemId: "i1" }, z9: { actorUuid: "Actor.b1", itemId: "i2" } },
    "the map is by the key a card carries, never the order made; a lot with no owner or no card maps nothing",
  );
  eq([H.carriedOf(null, v), H.carriedOf(lots, null)], [{}, {}], "no lots or no view maps nothing");
}

/* --- a check finds exactly its lots --- */
{
  const v = view([card("a", { lot: "den/1", found: false }), card("b", { lot: "den/2", found: false }), card("c", { lot: "chest/1", found: false }), card("d")]);
  const before = structuredClone(v);
  const r = L.planFound(v, ["den/1", "den/2", "nope"]);
  eq([r.ok, r.ids, r.already, r.missing], [true, ["a", "b"], [], ["nope"]], "the outcome's lots turn, a key no card carries is reported");
  eq(r.view.cards.map((c) => [c.id, c.truth.found]), [["a", true], ["b", true], ["c", false], ["d", true]], "exactly those lots are found, the others untouched");
  eq(v, before, "the input view is not changed");
  eq(L.planFound(r.view, ["den/1", "chest/1"]).ids, ["c"], "a lot found before is not turned again");
  eq(L.planFound(r.view, ["den/1"]).already, ["den/1"], "and is named as already found");
  eq(L.planFound(v, []).ids, [], "no keys, no change");
  eq(L.planFound(v, "den/1").ids, [], "keys that are not a list change nothing");
  ok(L.planFound(view([card("a", { lot: "x/1", found: false })], { phase: PHASE.closed }), ["x/1"]).ok === false, "a closed pot takes no mark");
  eq(L.planFound(view([card("a", { lot: "x/1", found: false })], { order: [] }), ["x/1"]).missing, ["x/1"], "a card outside the pot's order is not a lot of it");
  eq(L.planFound(null, ["x"]).reason, REFUSAL.noPot, "no pot is refused");

  eq(H.foundKeys({ code: CODE.FOUND, lots: ["a", "a", "", 3, "b"] }), ["a", "b"], "a found answer's lots are the keys");
  eq([H.foundKeys({ code: CODE.FOUND_NOTHING, lots: ["a"] }), H.foundKeys({ code: CODE.VAGUE }), H.foundKeys({ refusal: "scene:hastyLocked" }), H.foundKeys(null)], [[], [], [], []], "every other answer finds nothing");
  eq(H.foundKeys({ code: CODE.FOUND }), [], "a found answer with no lots finds none");
}

/* --- what each seat is shown --- */
{
  const mixed = view([card("a", { lot: "x/1", found: false, valueGp: 5 }), card("b", { valueGp: 7 }, 0), card("c", { lot: "x/2", valueGp: 3 })]);
  eq(L.seatCards(mixed).map((c) => c.id), ["b", "c"], "a player's cards are the found ones, in order");
  eq(L.seatCards(mixed, { isGM: true }).map((c) => c.id), ["a", "b", "c"], "the Judge's are all of them");
  eq(L.turnedOf(mixed), { turned: 1, count: 2 }, "the count and the turned count are over found lots only");
  eq(L.cardView(mixed.cards[0], { isGM: true }).found, false, "the Judge's tile says the lot is not found");
  eq(L.cardView(mixed.cards[2], { isGM: true }).found, true, "and a found one is");
  const unmarked = view([card("a"), card("b"), card("c")]);
  eq([L.seatCards(unmarked).length, L.turnedOf(unmarked).count], [3, 3], "a pot with no marks shows everything, as before");
  eq(L.turnedOf(view([card("a", {}, 0), card("b")])), { turned: 1, count: 2 }, "an unmarked pot counts as it always did");
  const up = view([card("a", { found: false, valueGp: 5 }, 0), card("b", { valueGp: 2 }, 0)]);
  eq(L.haulOf(L.seatCards(up).map((c) => L.cardView(c, { isGM: false }))).totalGp, 2, "the haul a player reads counts found lots only");

  const hidden = view([card("a", { lot: "x/1", found: false })], { audience: ["p1"] });
  eq(L.planFlip(hidden, "a", { sender: player, seated: true }).reason, REFUSAL.notInPot, "a player cannot turn an unfound lot");
  eq(L.planFlip(hidden, "a", { sender: judge, seated: true }).reason, REFUSAL.notInPot, "nor can the Judge, until it is found");
  eq(L.planFlip(L.planFound(hidden, ["x/1"]).view, "a", { sender: player, seated: true }).ok, true, "once found, it turns");
  const seen = view([card("a", { found: false }, 0)], { audience: [] });
  eq(L.planClaim(seen, "a", { sender: judge, seated: true, hasTarget: true, owns: true, ownedByTable: true }).reason, REFUSAL.notInPot, "an unfound lot cannot be claimed even if its face is up");
  ok(L.planClaim(view([card("a", {}, 0)]), "a", { sender: judge, seated: true, hasTarget: true, owns: true, ownedByTable: true }).ok, "a lot with no mark is claimed as before");
  eq(grabLots(view([card("a", { found: false }, 0), card("b", {}, 0)])).map((l) => l.id), ["b"], "a grab offers found lots only");

  const closing = L.planClose(view([card("a", { found: false, label: "Hidden" }, 0), card("b", { label: "Seen" }, 0)]));
  eq([closing.left.map((c) => c.id), closing.record.map((r) => r.id)], [["b"], ["b"]], "a lot never found is neither filed nor recorded");
  eq(L.planClose(view([card("a", {}, 0), card("b")])).record.length, 2, "an unmarked pot records every card");
}

/* --- bands are fixed at the deal --- */
{
  const stagedCards = (found) => [card("a", { valueGp: 1, found }), card("b", { valueGp: 5, found }), card("c", { valueGp: 9, found })];
  const staging = (cards) => ({ id: "pot", pot: L.normalizePot({ phase: PHASE.staging, order: ["a", "b", "c"] }), cards });
  const allFound = L.planOpen(staging(stagedCards(true)), { audience: [], rng: () => 0 });
  const noneFound = L.planOpen(staging(stagedCards(false)), { audience: [], rng: () => 0 });
  eq(noneFound.bands, allFound.bands, "bands are ranked over every lot, found or not");
  ok(new Set(Object.values(allFound.bands)).size === 3, "the three lots do not share a band");
  const v = { ...staging(stagedCards(false)), pot: noneFound.flag, cards: stagedCards(false).map((c) => ({ ...c, value: noneFound.bands[c.id] })) };
  const found = L.planFound(v, []);
  const some = L.planFound({ ...v, cards: v.cards.map((c) => (c.id === "b" ? { ...c, truth: { ...c.truth, lot: "k/1" } } : c)) }, ["k/1"]);
  eq(some.view.cards.map((c) => c.value), v.cards.map((c) => c.value), "finding a lot leaves every band as it was");
  eq(found.view.cards.map((c) => c.value), v.cards.map((c) => c.value), "and so does finding none");
  eq(L.withBands(some.view).cards.map((c) => c.value), v.cards.map((c) => c.value), "an opened pot's bands are not re-ranked over what is found");
}

/* --- attaching lots to the place's things --- */
{
  const things = [{ id: "den", kind: "floor", layers: { hasty: { yields: { lots: ["old"], clue: null } } } }, { id: "chest", kind: "container" }];
  const before = structuredClone(things);
  const r = H.attachLots(things, [
    { key: "den/1", thing: "den", layer: "hasty" },
    { key: "den/1", thing: "den", layer: "hasty" },
    { key: "chest/1", thing: "chest", layer: "methodical" },
    { key: "body/1", thing: "body", layer: "hasty" },
  ]);
  eq(r.things[0].layers.hasty.yields, { lots: ["old", "den/1"], clue: null }, "a key joins the layer's list once, the layer's other keys kept");
  eq(r.things[1].layers.methodical.yields.lots, ["chest/1"], "a layer that was not authored is made");
  eq(r.missing, ["body/1"], "a lot whose thing is not in the stored list is reported");
  eq(things, before, "the input list is not changed");
  eq(H.attachLots(null, []), { things: [], missing: [] }, "no list, no things");

  // The loop with S1: a check at the entry answers with the keys, and the keys find the cards.
  const hidden = H.attachLots([{ id: "den", kind: "floor", hidden: false }], [{ key: "den/1", thing: "den", layer: "hasty" }]).things;
  const entries = sceneEntries({ things: hidden });
  const entry = entries.find((e) => e.key === "thing:den");
  const out = outcomeOf(entry, "hasty", { id: "m1", level: 1, capabilities: ["kw:searching"], tools: [] }, { entries, figures: { hastyTarget: 11, searchBonus: 0 } }, { passed: true });
  eq([out.code, out.lots], [CODE.FOUND, ["den/1"]], "the entry's check answers with the lot's key");
  const pot = view([card("a", { lot: "den/1", found: false }), card("b", { lot: "other/1", found: false })]);
  eq(L.planFound(pot, H.foundKeys(out)).ids, ["a"], "and only that lot turns found");
  const failed = outcomeOf(entry, "hasty", { id: "m1", level: 1, capabilities: ["kw:searching"], tools: [] }, { entries, figures: { hastyTarget: 11, searchBonus: 0 } }, { passed: false });
  eq(L.planFound(pot, H.foundKeys(failed)).ids, [], "a failed throw finds none");
}

/* --- the Foundry side, over a fake world --- */
{
  const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");
  const { dealSceneHaul, markSceneFound } = await import("../scripts/scene-search/haul.mjs");
  const { potOf, progressOf, viewOf } = await import("../scripts/treasure/pot.mjs");
  resetTables();
  registerTable({
    id: "treasure",
    cites: { typeClassic: "INV p. 1" },
    tables: {
      typeClassic: {
        Y: { category: "Odds", avgValue: null, cp: "2", sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: null },
        Z: { category: "Odds", avgValue: null, cp: "90", sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: null },
        W: { category: "Odds", avgValue: null, cp: null, sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: "100% 1 widgets" },
      },
      typeUnits: { classic: { cp: "37s" } },
    },
  }, { priority: PRIORITY.WORLD });

  const cardsOf = (pile) => pile.cards.contents;
  const sources = [{ thing: "den", letters: ["Y"] }, { thing: "chest", layer: "methodical", letters: ["Z"] }];

  let r = await dealSceneHaul({ sources });
  eq([r.ok, r.reason, piles.length, gone], [false, DEAL_REFUSAL.lairUnconfirmed, 1, ["pot1"]], "an unconfirmed lair refuses and leaves no pot behind");
  r = await dealSceneHaul({ sources, confirmLair: async () => false });
  eq([r.reason, gone], [DEAL_REFUSAL.lairDeclined, ["pot1", "pot2"]], "a declined warning leaves no pot behind");
  r = await dealSceneHaul({ sources: [], metInLair: true });
  eq([r.reason, gone.length], [REFUSAL.empty, 3], "no source leaves no pot behind");
  r = await dealSceneHaul({ sources: [{ thing: "a", letters: ["Q"] }], metInLair: true });
  eq([r.ok, r.reason, gone.length], [false, REFUSAL.empty, 4], "a letter the tables do not hold deals nothing and leaves no pot behind");
  eq(r.dealt[0].errors.length > 0, true, "and says why");

  globalThis.game.user.isGM = false;
  const before = piles.length;
  eq([(await dealSceneHaul({ sources, metInLair: true })).reason, piles.length], [REFUSAL.notAllowed, before], "a player deals nothing and makes no pot");
  globalThis.game.user.isGM = true;

  let asked = 0;
  r = await dealSceneHaul({ sources, scene: { sceneId: "scene1", placeUuid: "Actor.place1" }, confirmLair: async () => (asked++, true) });
  eq([r.ok, asked], [true, 1], "a confirmed deal runs after one ask");
  const pile = piles.at(-1);
  eq([r.potId, r.potUuid, pile.id === r.potId], [pile.id, pile.uuid, true], "the pot's id and uuid are answered");
  eq(potOf(pile).phase, PHASE.open, "the pot is open when the scene opens: there is no staging step");
  eq(potOf(pile).origin, { kind: "scene", sceneId: "scene1", placeUuid: "Actor.place1" }, "the pot is tied to the scene");
  eq(potOf(pile).messageId, null, "no doorway card is posted");
  eq(pile.ownership, { default: 0, p1: 1, p2: 1 }, "the table's seats are given limited sight and no more");
  eq(r.lots.map((l) => [l.key, l.thing, l.layer]), [["den/1", "den", "hasty"], ["chest/1", "chest", "methodical"]], "each lot is keyed to the entry that hides it");
  ok(cardsOf(pile).every((c) => c.flags[MODULE_ID][CARD_FLAG].found === false), "every lot is dealt unfound");
  eq(r.lots.map((l) => cardsOf(pile).find((c) => c.id === l.cardId).flags[MODULE_ID][CARD_FLAG].lot), ["den/1", "chest/1"], "the card carries its key");
  const bands = cardsOf(pile).map((c) => c.value);
  ok(bands[0] < bands[1], "the bands are set at the deal, ranked over every lot");
  {
    const impl = globalThis.foundry.documents.Cards.implementation;
    const create = impl.create;
    impl.create = async (data) => {
      const made = await create(data);
      const add = made.createEmbeddedDocuments;
      made.createEmbeddedDocuments = async function (kind, list) {
        return (await add.call(this, kind, list)).reverse();
      };
      return made;
    };
    try {
      const rev = await dealSceneHaul({ sources, confirmLair: async () => true });
      const rp = piles.at(-1);
      eq(rev.lots.map((l) => cardsOf(rp).find((c) => c.id === l.cardId).flags[MODULE_ID][CARD_FLAG].lot), rev.lots.map((l) => l.key), "each lot names the card carrying its key, whatever order the create answers in");
    } finally {
      impl.create = create;
    }
  }

  eq([progressOf(pile).count, progressOf(pile).turned], [0, 0], "the doorway's count and the window's read no lot before one is found");
  const seat = (isGM) => L.seatCards(viewOf(pile), { isGM }).length;
  eq([seat(false), seat(true), L.turnedOf(viewOf(pile)).count], [0, 2, 0], "a player is shown no lot, the Judge both, and the header counts none");

  const found = await markSceneFound(pile, { code: CODE.FOUND, layer: "hasty", lots: ["den/1"], clue: null, reveal: [], more: [] });
  eq([found.ok, found.ids.length], [true, 1], "a found answer marks its lot");
  eq([seat(false), L.turnedOf(viewOf(pile)).count, L.seatCards(viewOf(pile)).map((c) => c.truth.lot)], [1, 1, ["den/1"]], "the player is shown that lot and no other");
  eq([progressOf(pile).count, progressOf(pile).view.cards.length], [1, 2], "the doorway's count reads the found lot, though the pot holds both");
  eq(cardsOf(pile).map((c) => c.value), bands, "finding it left every band as dealt");
  eq((await markSceneFound(pile, { code: CODE.FOUND_NOTHING, lots: ["chest/1"] })).ids, [], "a found-nothing answer marks nothing");
  eq((await markSceneFound(pile, { code: CODE.VAGUE })).ids, [], "nor does a vague hint");
  globalThis.game.user.isGM = false;
  eq((await markSceneFound(pile, { code: CODE.FOUND, lots: ["chest/1"] })).reason, REFUSAL.notAllowed, "a player's client marks nothing");
  globalThis.game.user.isGM = true;
  eq(seat(false), 1, "and the other lot is still hidden");

  const mixed = await dealSceneHaul({
    sources: [{ thing: "z", truths: [truth({ label: "Ring", magical: true }), truth({ label: "Spoon" })] }],
    metInLair: true,
    toggles: { noMagic: true },
  });
  eq([mixed.ok, mixed.lots.map((l) => l.key)], [true, ["z/2"]], "a lot the deal toggles strike when the pot opens is not in the answered map");

  // The choices a fight-over card recorded are the pot's own deal; nothing asked leaves a pot to start as a hand-made one does.
  {
    const potDeal = async (over) => {
      const made = await dealSceneHaul({ sources: [{ thing: "z3", truths: [truth({ label: "Cup" })] }], ...over });
      return { made, deal: potOf(piles.at(-1)).deal };
    };
    const picked = (d) => [d.style, d.special, d.metInLair, d.armsSetting];
    const asked = await potDeal({ style: "heroic", special: true, metInLair: true, armsSetting: "s2" });
    eq([asked.made.ok, picked(asked.deal)], [true, ["heroic", true, true, "s2"]], "the pot that opens carries the asked style, special, lair and arms column");
    eq(picked((await potDeal({ style: "gritty", special: false, metInLair: false, armsSetting: "s3" })).deal), ["gritty", false, false, "s3"], "and a different ask is carried as asked");
    eq(picked((await potDeal({})).deal), ["classic", false, false, ""], "with nothing asked it starts as a hand-made pot does");

    globalThis.game.user.getFlag = (scope, key) => (scope === MODULE_ID && key === "treasureArms" ? "s5" : undefined);
    try {
      eq(picked((await potDeal({ style: "heroic" })).deal)[3], "s5", "no column asked keeps the Judge's last choice");
      eq(picked((await potDeal({ armsSetting: "" })).deal)[3], "", "a blank column the card asked for wins over the Judge's last choice");
      eq(picked((await potDeal({ armsSetting: "s2" })).deal)[3], "s2", "and so does a named one");
    } finally {
      delete globalThis.game.user.getFlag;
    }

    // A searched hoard's magic is rolled by the pot's own binding: the deal's style and the pot's arms column reach the roll service.
    {
      const services = await import("../scripts/lib/services.mjs");
      const { acksExtras } = await import("../scripts/namespace.mjs");
      const savedRoll = services.get("magic-item-roll");
      const savedMagic = acksExtras.magicItems;
      const asks = [];
      services.register("magic-item-roll", { roll: async (a) => (asks.push({ from: a.from, style: a.style, armsSetting: a.armsSetting }), { ok: true, start: a.from, steps: [], item: { list: "classic.wd", text: "Alpha widget", fields: { item: "Alpha widget" }, flag: null, ref: null, uuid: null } }) });
      acksExtras.magicItems = { starts: () => ({ classic: [{ key: "wd", id: "classic.wd", caption: "Widget" }], heroic: [], gritty: [] }) };
      try {
        const magicHaul = await dealSceneHaul({ sources: [{ thing: "den", letters: ["W"] }], metInLair: true, armsSetting: "s2" });
        eq([magicHaul.ok, asks], [true, [{ from: "classic.wd", style: "classic", armsSetting: "s2" }]], "the pot's arms column and style reach the magic roll");
        const labels = cardsOf(piles.at(-1)).map((c) => c.flags[MODULE_ID][CARD_FLAG].label);
        ok(labels.includes("Alpha widget") && !labels.includes("widgets"), "the pot that opens holds the rolled card, not the placeholder");
        asks.length = 0;
        await dealSceneHaul({ sources: [{ thing: "den", letters: ["W"] }], metInLair: true });
        eq(asks.map((a) => a.armsSetting), [undefined], "a pot with no column passes no setting");
      } finally {
        services.register("magic-item-roll", savedRoll ?? {});
        acksExtras.magicItems = savedMagic;
      }
    }

    // The lair warning stays the Judge's notice: on, it is never raised; off, it is raised once and the deal goes on.
    let raised = 0;
    const warned = { sources, scene: { sceneId: "scene1" }, confirmLair: async () => (raised++, true) };
    eq([(await dealSceneHaul({ ...warned, metInLair: true })).ok, raised], [true, 0], "with Met in their lair on the warning is never raised");
    eq([(await dealSceneHaul({ ...warned, metInLair: false })).ok, raised], [true, 1], "with it off the warning is raised once and the deal goes on");
  }

  // A fight's goods: the pot's origin maps each card to the body item it stands for; the goods stay on the bodies until their lots are found (below).
  const spoon ={ actorUuid: "Actor.b1", itemId: "i1" };
  const fight = await dealSceneHaul({
    sources: [{ thing: "body:b1", truths: [truth({ label: "Spoon" }), truth({ label: "Ladle" })], owners: [spoon, null] }],
    metInLair: true,
    scene: { sceneId: "scene1", placeUuid: "Actor.place1" },
  });
  const fightPile = piles.at(-1);
  const cardOf = (key) => cardsOf(fightPile).find((c) => c.flags[MODULE_ID][CARD_FLAG].lot === key).id;
  eq(
    potOf(fightPile).origin,
    { kind: "scene", sceneId: "scene1", placeUuid: "Actor.place1", takeOff: true, carried: { [cardOf("body:b1/1")]: spoon }, taken: [] },
    "a body's carried item is mapped by its card, and only that one",
  );
  eq(fight.lots.length, 2, "and both lots are dealt");
  await dealSceneHaul({ sources: [{ thing: "body:b2", truths: [truth({ label: "Cup" })], owners: [{ actorUuid: "Actor.b2", itemId: "i2" }] }], metInLair: true });
  eq(potOf(piles.at(-1)).origin?.takeOff, true, "goods carried by a body are mapped even where no scene id is given");
  await dealSceneHaul({ sources: [{ thing: "z2", truths: [truth({ label: "Cup" })] }], metInLair: true, scene: { sceneId: "scene1" } });
  eq(potOf(piles.at(-1)).origin, { kind: "scene", sceneId: "scene1", placeUuid: null }, "a pot with no carried goods owes no take-off");
}

/* --- goods leave the bodies as their lots are found, and a reopened search takes its pot back --- */
{
  const { dealSceneHaul, markSceneFound, reattachSceneHaul } = await import("../scripts/scene-search/haul.mjs");
  const { takeOffBodies } = await import("../scripts/treasure/search.mjs");
  const { potOf, viewOf } = await import("../scripts/treasure/pot.mjs");

  // Bodies: an actor uuid to its items. A sticky item reports itself after a delete, as a body that cannot lose it would.
  const bodies = new Map();
  const deleted = [];
  const body = (uuid, ids, { sticky = false } = {}) => {
    const items = new Map(ids.map((id) => [id, { id, delete: async () => (deleted.push(`${uuid}|${id}`), sticky || items.delete(id)) }]));
    bodies.set(uuid, items);
    return items;
  };
  globalThis.fromUuidSync = (uuid) => {
    const pile = piles.find((p) => p.uuid === uuid);
    if (pile) return pile;
    return bodies.has(uuid) ? { documentName: "Actor", items: { get: (id) => bodies.get(uuid).get(id) } } : null;
  };
  const cardsOf = (pile) => pile.cards.contents;
  const cardOf = (pile, key) => cardsOf(pile).find((c) => c.flags[MODULE_ID][CARD_FLAG].lot === key)?.id;
  const found = (key) => ({ code: CODE.FOUND, layer: "hasty", lots: [key], clue: null, reveal: [], more: [] });
  const calls = [];
  const takeOff = (pile, only) => (calls.push(only.cardIds), takeOffBodies(pile, only));
  const dealt = async (uuid, over = {}) => {
    const r = await dealSceneHaul({
      sources: [{ thing: `body:${over.id ?? "t1"}`, truths: [truth({ label: "Spoon" }), truth({ label: "Ladle" }), truth({ label: "Cup" })], owners: [{ actorUuid: uuid, itemId: "i1" }, { actorUuid: uuid, itemId: "i2" }, null] }],
      metInLair: true,
      scene: { sceneId: "scene1", placeUuid: "Actor.place1" },
    });
    return { r, pile: piles.at(-1) };
  };

  // Nothing leaves a body when the pot opens.
  const t1 = body("Actor.t1", ["i1", "i2"]);
  const { r, pile } = await dealt("Actor.t1");
  eq([t1.size, deleted.length, calls.length], [2, 0, 0], "opening the pot takes nothing off the body");
  eq(potOf(pile).origin.taken, [], "and settles no card");

  // A lot found takes its own good, once.
  const first = await markSceneFound(pile, found("body:t1/1"), { takeOff });
  eq([first.ok, first.ids, first.tookOff, [...t1.keys()], potOf(pile).origin.taken], [true, [cardOf(pile, "body:t1/1")], 1, ["i2"], [cardOf(pile, "body:t1/1")]], "finding a lot takes its good off the body and settles its card, and the body's other good stays");
  const again = await markSceneFound(pile, found("body:t1/1"), { takeOff });
  eq([again.ids, again.already, again.tookOff, calls.length, deleted], [[], ["body:t1/1"], undefined, 1, ["Actor.t1|i1"]], "a lot found again takes nothing, and the take-off is not even asked");
  const own = await markSceneFound(pile, found("body:t1/3"), { takeOff });
  eq([own.tookOff, own.ids.length, [...t1.keys()]], [0, 1, ["i2"]], "a lot no body carried (a table's draw) is found and takes nothing");
  eq(
    (await markSceneFound(pile, { code: CODE.FOUND_NOTHING, lots: ["body:t1/2"] }, { takeOff })).ids,
    [],
    "a check that found nothing marks nothing",
  );
  eq([calls.length, [...t1.keys()]], [2, ["i2"]], "and asks for no take-off");
  const second = await markSceneFound(pile, found("body:t1/2"), { takeOff });
  eq([second.tookOff, [...t1.keys()], potOf(pile).origin.taken.length], [1, [], 2], "the second good leaves when its own lot is found");

  // The once-guard: a body that still reports the item is not taken from twice.
  const t2 = body("Actor.t2", ["i1", "i2"], { sticky: true });
  const two = await dealt("Actor.t2", { id: "t2" });
  deleted.length = 0;
  await markSceneFound(two.pile, found("body:t2/1"), { takeOff });
  eq([deleted, t2.has("i1")], [["Actor.t2|i1"], true], "the item is deleted once (this body still reports it)");
  eq([await takeOffBodies(two.pile, { cardIds: [cardOf(two.pile, "body:t2/1")] }), deleted.length], [0, 1], "a card already settled is never taken for again, though its body still reports the item");
  eq(await takeOffBodies(two.pile), 1, "a take-off for every card settles the one left, once");
  eq(deleted, ["Actor.t2|i1", "Actor.t2|i2"], "each item was deleted once");
  eq(await takeOffBodies(two.pile), 0, "and a second one has nothing left");

  // A body that is gone leaves its card standing, found, on the snapshot.
  bodies.delete("Actor.t2");
  body("Actor.t3", []);
  const three = await dealt("Actor.t3", { id: "t3" });
  deleted.length = 0;
  const gone3 = await markSceneFound(three.pile, found("body:t3/1"), { takeOff });
  eq([gone3.ok, gone3.tookOff, deleted, potOf(three.pile).origin.taken.includes(cardOf(three.pile, "body:t3/1")), viewOf(three.pile).cards.find((c) => c.id === cardOf(three.pile, "body:t3/1")).truth.found], [true, 0, [], true, true], "a body already gone takes nothing, the lot is still found and its card keeps the snapshot");

  // A take-off that throws does not lose the mark.
  const four = await dealt("Actor.t1", { id: "t4" });
  const errors = console.error;
  console.error = () => {};
  const broke = await markSceneFound(four.pile, found("body:t4/1"), { takeOff: async () => { throw new Error("no"); } });
  console.error = errors;
  eq([broke.ok, broke.ids.length, broke.tookOff], [true, 1, undefined], "a take-off that throws leaves the lot found");
  eq((await markSceneFound(four.pile, found("body:t4/2"))).tookOff, undefined, "with no take-off supplied the lot is marked and nothing is taken");

  // A player's client finds nothing and takes nothing.
  const callsBefore = calls.length;
  globalThis.game.user.isGM = false;
  eq([(await markSceneFound(pile, found("body:t1/2"), { takeOff })).reason, calls.length], [REFUSAL.notAllowed, callsBefore], "a player's client takes nothing");
  globalThis.game.user.isGM = true;

  // Reattaching a pot: its lots and their found marks come back, nothing is dealt or written.
  const kept = r.lots.map(({ key, thing, layer }) => ({ key, thing, layer }));
  const before = JSON.stringify(pile.flags) + JSON.stringify(cardsOf(pile));
  const potsBefore = piles.length;
  const session = [{ id: "t1", ref: "Actor.t1", state: {}, layers: {} }, { id: "other", state: { layers: { hasty: { done: true } } }, layers: {} }];
  const back = reattachSceneHaul({ potUuid: pile.uuid, lots: kept }, session);
  eq(back.potUuid, pile.uuid, "the pot the first opening dealt is taken back");
  eq(back.lots.map((l) => [l.key, l.thing, l.layer, l.cardId]), kept.map((l) => [l.key, l.thing, l.layer, cardOf(pile, l.key)]), "with each lot attached to its entry, layer and card");
  eq(back.bodies[0].state, { layers: { hasty: { found: true } } }, "and a body whose lots are all found reads as found again");
  eq(back.bodies[1], session[1], "a body with no lot is as it was");
  eq([JSON.stringify(pile.flags) + JSON.stringify(cardsOf(pile)), piles.length, session[0].state], [before, potsBefore, {}], "nothing is dealt or written, and the input is untouched");

  const partial = reattachSceneHaul({ potUuid: two.pile.uuid, lots: [{ key: "body:t2/1", thing: "body:t2", layer: "hasty" }, { key: "body:t2/2", thing: "body:t2", layer: "hasty" }] }, [{ id: "t2", state: {} }]);
  eq([partial.lots.length, partial.bodies[0].state], [2, {}], "a body with a lot still unfound is not read as found");
  eq(reattachSceneHaul({ potUuid: pile.uuid, lots: [{ key: "body:t1/1", thing: "body:t1", layer: "nonsense" }, { key: "body:t1/1", thing: "body:t1" }] }, []).lots.map((l) => l.layer), ["hasty", "hasty"], "a stored layer that is no layer reads as the hasty one");
  eq(reattachSceneHaul({ potUuid: pile.uuid, lots: [{ key: "body:gone/1", thing: "body:gone", layer: "hasty" }] }, []).lots, [], "a lot whose card is not in the pot is not attached");
  eq([reattachSceneHaul({ potUuid: "Cards.nope", lots: kept }, session), reattachSceneHaul({ potUuid: null, lots: kept }, session), reattachSceneHaul({}, session), reattachSceneHaul(undefined)], [null, null, null, null], "a pot that is gone, or none that was kept, is null");
  eq(reattachSceneHaul({ potUuid: "Actor.t1", lots: kept }, session), null, "a uuid that names no pot is null");
  await pile.update({ [`flags.${MODULE_ID}.${POT_FLAG}.phase`]: PHASE.closed });
  eq(reattachSceneHaul({ potUuid: pile.uuid, lots: kept }, session), null, "a closed pot is not reattached");
}

/* --- a reopened body reads its layers from the pot --- */
{
  const lots = [
    { key: "body:a/1", thing: "body:a", layer: "hasty", cardId: "c1" },
    { key: "body:a/2", thing: "body:a", layer: "hasty", cardId: "c2" },
    { key: "body:b/1", thing: "body:b", layer: "hasty", cardId: "c3" },
    { key: "body:b/2", thing: "body:b", layer: "methodical", cardId: "c4" },
    { key: "body:c/1", thing: "body:c", layer: "hasty", cardId: "c9" },
  ];
  const pot = view([card("c1", { lot: "body:a/1" }), card("c2", { lot: "body:a/2" }), card("c3", { lot: "body:b/1" }), card("c4", { lot: "body:b/2", found: false })]);
  const bodies = [{ id: "a", state: { revealed: ["x"] } }, { id: "b", state: {} }, { id: "c" }, { id: "d", state: { layers: { hasty: { done: true } } } }];
  const out = H.bodiesWithFound(bodies, lots, pot);
  eq(out[0].state, { revealed: ["x"], layers: { hasty: { found: true } } }, "a body whose lots are all found reads as found, the rest of its state kept");
  eq(out[1].state, { layers: { hasty: { found: true } } }, "a layer is read apart from its body's other layer: the methodical one is not found");
  eq(out[2], bodies[2], "a lot whose card is not in the pot makes no layer found");
  eq(out[3], bodies[3], "a body with no lot is as it was");
  eq(bodies[1].state, {}, "the input is not changed");
  const mixed = H.bodiesWithFound([{ id: "a" }], lots.slice(0, 2), view([card("c1", { lot: "body:a/1" }), card("c2", { lot: "body:a/2", found: false })]));
  eq(mixed[0], { id: "a" }, "one lot of a layer still unfound leaves the layer unfound");
  eq(H.bodiesWithFound(null, null, null), [], "no bodies, none read");
}

/* --- an opening that leaves nothing, and the closing record --- */
{
  const { dealSceneHaul, markSceneFound } = await import("../scripts/scene-search/haul.mjs");
  const { closePot, potOf, viewOf } = await import("../scripts/treasure/pot.mjs");
  const before = gone.length;
  const empty = await dealSceneHaul({ sources: [{ thing: "z", truths: [truth({ label: "Ring", magical: true })] }], metInLair: true, toggles: { noMagic: true } });
  eq([empty.ok, empty.reason, gone.length], [false, REFUSAL.dealEmpty, before + 1], "an opening that strikes every lot refuses and leaves no pot behind");

  const posted = [];
  globalThis.foundry.applications = { handlebars: { renderTemplate: async () => "<div></div>" } };
  globalThis.game.messages = { get: (id) => (id === "msg" ? { update: async (data) => posted.push(data) } : undefined) };
  const r = await dealSceneHaul({ sources: [{ thing: "z", truths: [truth({ label: "Spoon" }), truth({ label: "Ladle" })] }], metInLair: true, doorway: true });
  const pile = piles.at(-1);
  eq([r.ok, potOf(pile).messageId], [true, "msg"], "a doorway is posted when asked for");
  await markSceneFound(pile, { code: CODE.FOUND, lots: ["z/1"] });
  const closed = await closePot(pile);
  eq([closed.ok, posted.length], [true, 1], "closing rewrites the doorway as the record");
  eq(posted[0].content.match(/<li>/g)?.length, 1, "the record lists the found lot and not the other");
  eq(viewOf(pile).cards.length, 2, "the pile held both lots");
}

console.log(`test-scene-haul: ${checks} checks passed`);
