/**
 * The light spells the party sheet's Kit row offers (`magic/light-offers.mjs`).
 * The offer logic runs against hand-built actors with the Magic tab's own
 * reading (`magicStanding`, `standingLineOf`) and the cast's (`castReading`)
 * bound to invented classes, so a gate sentence here is the tab's and not a
 * mock's. Every class, spell and name is invented fixture data.
 *
 * Run: node tools/test-light-offers.mjs
 */
import assert from "node:assert";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const WISP = { key: "wisp", label: "Wisp", kind: "vancian", slots: [{ atLevel: 1, s1: 2, s2: 1 }] };
const TIDE = { key: "tide", label: "Tide", kind: "points", pool: [{ atLevel: 1, value: 4 }] };
const CLASS_DOC = (casting, cite = "") => ({ uuid: "Item.cls1", documentName: "Item", type: "acks-extras.class", name: "Testcaster", system: { casting, ladders: [], source: { cite } } });

/** An invented spell on the lists `lists` names (each `[source, level]`) carrying the effect rows `rows`. */
const spellOf = (id, name, { lists = null, lvl = 1, rows = [{ type: "light" }] } = {}) => ({
  id, uuid: `Actor.x.Item.${id}`, name, img: "", type: "spell", system: { lvl, class: "", cast: 0, range: "", duration: "" },
  flags: { "acks-extras": { spell: { lists: (lists ?? []).map(([source, level]) => ({ source, level })), cite: "Test p. 9", effects: rows } } },
});
/** An invented caster bound to the class with `casting` (null binds none), its pools spent as `spent` says. */
const casterOf = (id, name, spells, { casting = [WISP, TIDE], spent = {}, owner = true, coreSlots = null } = {}) => ({
  id, name, uuid: `Actor.${id}`, type: "character", isOwner: owner, items: spells, effects: [],
  system: { spells: { enabled: true, ...(coreSlots ?? {}) }, details: { level: 1 } },
  getFlag: (m, k) => (casting && m === "acks-extras" && k === "classes" ? { uuid: "Item.cls1", pools: spent } : null),
});

/** Run `fn` with the world's globals standing for a seat that is, or is not, a GM, the class bound as `casting` names. */
const inWorld = async ({ isGM = false, casting = [WISP, TIDE], cite = "" }, fn) => {
  const prior = { game: globalThis.game, canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync };
  globalThis.game = { i18n: { has: () => false, localize: (k) => k.split(".").pop(), format: (k, d = {}) => `${k}|${JSON.stringify(d)}` }, combats: { get: () => null }, scenes: { active: null }, user: { isGM } };
  globalThis.canvas = { scene: null };
  const doc = CLASS_DOC(casting ?? [], cite);
  globalThis.fromUuidSync = (uuid) => (uuid === "Item.cls1" ? doc : null);
  try {
    return await fn(await import("../scripts/magic/light-offers.mjs"));
  } finally {
    globalThis.game = prior.game;
    globalThis.canvas = prior.canvas;
    globalThis.fromUuidSync = prior.fromUuidSync;
  }
};
const offersOf = (world, casters) => inWorld(world, ({ lightOffersFor }) => lightOffersFor(casters));
const keys = (offers) => offers.map((o) => o.key);
const wispSpell = (id = "s1", name = "Glimmer", extra = {}) => spellOf(id, name, { lists: [["wisp", 1]], ...extra });

console.log("light offers: who is offered what");
await test("a caster the seat owns is offered its light spell and one it does not own is not; a GM is offered both", async () => {
  const mine = casterOf("a1", "Abe", [wispSpell("s1", "Glimmer")]);
  const theirs = casterOf("b1", "Bea", [wispSpell("s2", "Glow")], { owner: false });
  assert.deepEqual(keys(await offersOf({}, [mine, theirs])), ["a1|s1|wisp"]);
  assert.deepEqual(keys(await offersOf({ isGM: true }, [mine, theirs])), ["a1|s1|wisp", "b1|s2|wisp"], "Foundry's GM owns every actor, so the seat reads it from the GM flag");
  assert.deepEqual(await offersOf({}, []), [], "no caster, no row");
});
await test("a spell is offered only for a light row of its own form that its caster can cast now", async () => {
  const caster = casterOf("a1", "Abe", [
    wispSpell("keep", "Glimmer"),
    wispSpell("rev", "Dusk", { rows: [{ type: "light", reversed: true }] }),
    wispSpell("plain", "Bolt", { rows: [{ type: "damage" }] }),
    wispSpell("bare", "Wick", { rows: [] }),
    spellOf("high", "Beacon", { lists: [["wisp", 3]] }),
    wispSpell("mixed", "Flare", { rows: [{ type: "light", reversed: true }, { type: "light" }] }),
  ]);
  assert.deepEqual(keys(await offersOf({}, [caster])), ["a1|mixed|wisp", "a1|keep|wisp"], "a reversed-only light row, a spell with none and a level the list keeps no slot at are left out; a spell with both forms' rows is in");
});
await test("a spell on two lists is two offers, each with its own key, line and slots", async () => {
  const caster = casterOf("a1", "Abe", [spellOf("s1", "Glimmer", { lists: [["wisp", 1], ["tide", 2]] })], { spent: { wisp: { s1: 1 } } });
  const offers = await offersOf({}, [caster]);
  assert.deepEqual(keys(offers), ["a1|s1|tide", "a1|s1|wisp"], "sorted by list label");
  const [tide, wisp] = offers;
  assert.deepEqual([wisp.listText, wisp.slotsText, wisp.line], ["Wisp 1", "Slots 1 / 2", "Wisp 1 · Slots 1 / 2"]);
  assert.deepEqual([tide.listText, tide.slotsText, tide.line, tide.refusal, tide.blocked], ["Tide 2", "", "Tide 2", "", false], "a points list keeps no slot row, so the line names the list alone and nothing is gated");
  assert.deepEqual([wisp.actorId, wisp.itemId, wisp.tradition, tide.tradition], ["a1", "s1", "wisp", "tide"]);
});
await test("the line's parts carry the Magic tab's tooltips, and the option reads the spell, the caster and the list", async () => {
  const caster = casterOf("a1", "Abe", [wispSpell()], { spent: { wisp: { s1: 1 } } });
  const [offer] = await offersOf({}, [caster]);
  assert.equal(offer.listTip, 'ACKS-CHARACTER.magic.listsTipCite|{"cite":"Test p. 9"}', "the spell's own page");
  assert.equal(offer.slotsTip, 'ACKS-CHARACTER.magic.slotsTip|{"used":1,"max":2,"class":"Testcaster","level":1}', "the slot row's provenance");
  assert.equal(offer.label, 'ACKS-FORMATION.app.lightCastOption|{"spell":"Glimmer","caster":"Abe","tradition":"Wisp"}');
  const [cited] = await offersOf({ cite: "Test p. 1" }, [caster]);
  assert.equal(cited.slotsTip, 'ACKS-CHARACTER.magic.slotsTipCite|{"used":1,"max":2,"class":"Testcaster","level":1,"cite":"Test p. 1"}', "the class document's page where it holds one");
});
await test("the offers sort by caster, then spell, then list", async () => {
  const zed = casterOf("z1", "Zed", [wispSpell("s1", "Alpha")]);
  const abe = casterOf("a1", "Abe", [wispSpell("s2", "Gamma"), wispSpell("s3", "Beta")]);
  assert.deepEqual(keys(await offersOf({}, [zed, abe])), ["a1|s3|wisp", "a1|s2|wisp", "z1|s1|wisp"]);
});

console.log("light offers: the gate");
await test("a Player with no slot left is shown the Magic tab's sentence and blocked; a GM is shown the warning and not", async () => {
  const caster = () => casterOf("a1", "Abe", [wispSpell()], { spent: { wisp: { s1: 2 } } });
  const [player] = await offersOf({}, [caster()]);
  assert.deepEqual([player.refusal, player.blocked, player.slotsText], ["ACKS-MAGIC.cast.notice.blocked.noSlot|{}", true, "Slots 2 / 2"]);
  const [judge] = await offersOf({ isGM: true }, [caster()]);
  assert.deepEqual([judge.refusal, judge.blocked], ["ACKS-MAGIC.cast.notice.verdict.noSlot|{}", false], "the sentence ends in the cast going ahead");
  const [free] = await offersOf({}, [casterOf("a1", "Abe", [wispSpell()], { spent: { wisp: { s1: 1 } } })]);
  assert.deepEqual([free.refusal, free.blocked], ["", false], "a slot left, nothing in the way");
});
await test("a spell on none of the class's lists is offered with its own sentence, under no list", async () => {
  const caster = () => casterOf("a1", "Abe", [spellOf("s1", "Stray", { lists: [["elsewhere", 1]] })]);
  const [player] = await offersOf({}, [caster()]);
  assert.deepEqual([player.key, player.tradition, player.refusal, player.blocked, player.slotsText], ["a1|s1|", "", "ACKS-MAGIC.cast.notice.blocked.offList|{}", true, ""]);
  assert.equal(player.label, 'ACKS-FORMATION.app.lightCastOptionBare|{"spell":"Stray","caster":"Abe","tradition":""}', "no list to name");
  const [judge] = await offersOf({ isGM: true }, [caster()]);
  assert.deepEqual([judge.refusal, judge.blocked], ["ACKS-MAGIC.cast.notice.verdict.offList|{}", false]);
});
await test("the row's gate is the tab's: the same sentence and block as the Magic tab's row for the same spell", async () => {
  for (const isGM of [false, true]) {
    const caster = casterOf("a1", "Abe", [wispSpell(), spellOf("s2", "Stray", { lists: [["elsewhere", 1]] })], { spent: { wisp: { s1: 2 } } });
    const offers = await offersOf({ isGM }, [caster]);
    const rows = await inWorld({ isGM }, async () => {
      const { buildMagicTab } = await import("../scripts/character-sheet/tabs/magic.mjs");
      const tab = buildMagicTab(caster);
      return [...tab.groups.flatMap((g) => g.levels.flatMap((l) => l.rows)), ...tab.other.flatMap((l) => l.rows)];
    });
    for (const offer of offers) {
      const row = rows.find((r) => r.id === offer.itemId && r.tradition === offer.tradition);
      assert.deepEqual([offer.refusal, offer.blocked], [row.gate?.text ?? "", row.gate?.blocked === true], `${offer.key} (GM ${isGM})`);
    }
    assert.equal(offers.length, 2);
  }
});
await test("by level, with no list: one offer with no list, core's slots, and no gate", async () => {
  const caster = casterOf("a1", "Abe", [spellOf("s1", "Glimmer", { lvl: 1 })], { casting: null, coreSlots: { 1: { max: 2 } } });
  const offers = await offersOf({ casting: null }, [caster]);
  assert.deepEqual(offers.map((o) => [o.key, o.tradition, o.listText, o.slotsText, o.line, o.listTip, o.slotsTip, o.refusal, o.blocked]), [["a1|s1|", "", "Level 1", "Slots 0 / 2", "Level 1 · Slots 0 / 2", "Test p. 9", `ACKS-FORMATION.app.lightCastSlotsCore|${JSON.stringify({ used: 0, max: 2, caster: "Abe", level: 1 })}`, "", false]]);
  assert.equal(offers[0].label, 'ACKS-FORMATION.app.lightCastOptionBare|{"spell":"Glimmer","caster":"Abe","tradition":""}');
  assert.deepEqual(await offersOf({ casting: null }, [casterOf("a1", "Abe", [spellOf("s1", "Glimmer", { lvl: 1 })], { casting: null })]), [], "core's grid holds no slot at that level, so it cannot be cast");
});

console.log(`light offers: ${passed} passed`);
