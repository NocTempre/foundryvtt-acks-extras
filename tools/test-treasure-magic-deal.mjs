/**
 * Rolling a dealt hoard's magic cards on the imported item tables: which list a
 * hoard cell's noun names, what each outcome of a roll becomes in the pot, the
 * refusals that leave a placeholder and say so, the audit rows, and the deal
 * toggles acting on a rolled card. The pure part is `magic-deal-logic.mjs`; the
 * end-to-end cases run the real deal, the real roll service and the real
 * contract wiring over a fake world. Every noun, caption, list and item here is
 * this file's own invention.
 */
import assert from "node:assert/strict";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const stored = [];
const pile = {
  id: "pile1",
  type: "pile",
  documentName: "Cards",
  flags: {},
  cards: new Map(),
  async createEmbeddedDocuments(_kind, data) {
    return data.map((d) => { const c = { id: `card${stored.length}` }; stored.push(d); this.cards.set(c.id, c); return c; });
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
const hooks = { init: [], setup: [] };
globalThis.Hooks = { once: (name, fn) => hooks[name]?.push(fn), on() {}, callAll() {} };
globalThis.game = {
  user: { isGM: true },
  i18n: { lang: "en", localize: (key) => key, format: (key) => key },
  actors: { get: () => undefined },
  items: { find: () => undefined },
  cards: { get: (id) => (id === pile.id ? pile : undefined) },
  packs: [],
  modules: { get: () => null },
};
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.foundry = {};

const { MODULE_ID, CARD_FLAG, POT_FLAG, PHASE, POOL } = await import("../scripts/treasure/constants.mjs");
const { apparentName, claimItemData, dealOf, normalizePot, normalizeTruth, rankWorth } = await import("../scripts/treasure/pot-logic.mjs");
const { DEAL_ERROR_CODES, dealMessages } = await import("../scripts/treasure/deal-logic.mjs");
const { MAGIC_ERROR, MAGIC_REASON, rollMagicTruths, startFor, unknownTruth } = await import("../scripts/treasure/magic-deal-logic.mjs");
const { PRIORITY, registerTable, resetTables, unregisterTable } = await import("../scripts/lib/tables.mjs");
const services = await import("../scripts/lib/services.mjs");
const { acksExtras } = await import("../scripts/namespace.mjs");
await import("../scripts/magic-items/module.mjs");
const { readFileSync } = await import("node:fs");
const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/** A placeholder as the hoard deals it, a magic truth carrying its noun. */
const placeholder = (noun) => ({ ...normalizeTruth({ pool: POOL.magic, label: noun ?? "magic", magical: true, detected: false }), tableRef: noun });
const LISTS = {
  classic: [{ key: "wd", id: "classic.wd", caption: "Widget" }, { key: "gz", id: "classic.gz", caption: "Gizmo" }, { key: "gz2", id: "classic.gz2", caption: "Gizmos" }, { key: "mm", id: "classic.mm", caption: "Sprocket, Mini" }],
  heroic: [{ key: "hw", id: "heroic.hw", caption: "Widget" }],
};

/* --- which list a noun names ---------------------------------------------------- */
{
  eq(startFor("widgets", "classic", LISTS), { ok: true, id: "classic.wd" }, "a plural noun names the singular caption");
  eq(startFor("Widget", "classic", LISTS), { ok: true, id: "classic.wd" }, "a noun is matched without regard to case");
  eq(startFor("mini sprocket", "classic", LISTS), { ok: true, id: "classic.mm" }, "a caption's name forms are read (head first, qualifier after a comma)");
  eq(startFor("wobbles", "classic", LISTS), { ok: false, reason: MAGIC_REASON.noMatch }, "a noun that matches nothing does not roll");
  eq(startFor("gizmos", "classic", LISTS), { ok: false, reason: MAGIC_REASON.ambiguous }, "a noun two lists answer to does not roll");
  eq(startFor("widgets", "heroic", LISTS), { ok: true, id: "heroic.hw" }, "heroic reads the rarity lists");
  eq(startFor("widgets", "gritty", LISTS), { ok: true, id: "heroic.hw" }, "gritty reads the same rarity lists");
  eq(startFor("sprocket", "heroic", LISTS), { ok: false, reason: MAGIC_REASON.noMatch }, "a classic category is not a rarity");
  eq(startFor(null, "classic", LISTS), { ok: false, reason: MAGIC_REASON.noNoun }, "a placeholder with no noun does not roll");
  eq(startFor("", "classic", LISTS), { ok: false, reason: MAGIC_REASON.noNoun }, "a blank noun does not roll");
  eq(startFor("magic", "classic", { classic: [{ key: "x", id: "classic.x", caption: "Gadget" }] }), { ok: false, reason: MAGIC_REASON.noMatch }, "a synthetic ref matches no caption");
  eq(startFor("widgets", "classic", { classic: [], heroic: [] }), { ok: false, reason: "not-imported" }, "no lists read: not imported");
  eq(startFor("widgets", "classic", null), { ok: false, reason: "not-imported" }, "no lists at all: not imported");
  eq(startFor("widgets", "classic", { classic: [{ id: "classic.wd", caption: null }] }), { ok: false, reason: MAGIC_REASON.noMatch }, "a list with no caption read is never named");
}

/* --- the shapes a real import prints, in invented words ------------------------- */
{
  // A group whose captions all carry one trailing word the cells leave off, its
  // keys camel-cased; one name is a later word of a sibling's, one a substring.
  const TIERS = {
    heroic: [
      { key: "plain", id: "heroic.plain", caption: "Plain Things" },
      { key: "unplain", id: "heroic.unplain", caption: "Unplain Things" },
      { key: "odd", id: "heroic.odd", caption: "Odd Things" },
      { key: "veryOdd", id: "heroic.veryOdd", caption: "Very Odd Things" },
    ],
  };
  eq(startFor("odd", "heroic", TIERS), { ok: true, id: "heroic.odd" }, "a noun without the group's trailing word meets its list's key");
  eq(startFor("very odd", "heroic", TIERS), { ok: true, id: "heroic.veryOdd" }, "a two-word noun meets a camel-cased key");
  eq(startFor("plain", "heroic", TIERS), { ok: true, id: "heroic.plain" }, "a name inside a longer sibling name names only its own list");
  eq(startFor("unplain", "heroic", TIERS), { ok: true, id: "heroic.unplain" }, "the longer name names its own list");
  eq(startFor("odd things", "heroic", TIERS), { ok: true, id: "heroic.odd" }, "the full caption still names its list");
  eq(startFor("things", "heroic", TIERS), { ok: false, reason: MAGIC_REASON.noMatch }, "the shared trailing word alone names no list");
  eq(startFor("widget, gizmo, or sprocket", "classic", LISTS), { ok: false, reason: MAGIC_REASON.compound }, "a noun naming a choice of lists is refused, not matched by its first word");
  eq(startFor("of each other kind (widget, gizmo)", "classic", LISTS), { ok: false, reason: MAGIC_REASON.compound }, "a noun naming one of each of a list is refused");
  eq(startFor("widget; gizmo", "classic", LISTS), { ok: false, reason: MAGIC_REASON.compound }, "a semicolon is a compound too");
  eq(startFor("whatever", "classic", { ...LISTS, classicType: { key: "bands", id: "classicType.bands", caption: "Kind" } }), { ok: false, reason: MAGIC_REASON.noMatch }, "a noun that names no list never falls to the type list");
}

{
  const { dealHoard: engine } = await import("../scripts/treasure/hoard-logic.mjs");
  const dealt = engine({ type: "A", tables: { type: { rows: { A: { magic: "1" } }, cite: "INV" } }, kinds: [{ key: "magic", pool: "magic", column: "magic", names: [] }], roll: () => null });
  eq(dealt.cards.map((c) => [c.pool, c.tableRef]), [["magic", null]], "a magic kind that prints no noun deals a placeholder with no ref, never its own key");
}

/* --- unknown truth ---------------------------------------------------------------- */
const knownItemData = () => ({
  name: "Delta item",
  type: "item",
  system: { quantity: { value: 1 } },
  flags: { [MODULE_ID]: { markets: { magic: true, detected: true, identified: "full", cursed: true, curseKnown: true } } },
});
const knownTruth = () => normalizeTruth({ source: { uuid: "Item.d", data: knownItemData() }, pool: POOL.item, label: "Delta item", magical: true, detected: true, identified: "full" });
{
  const t = unknownTruth(knownTruth());
  eq([t.pool, t.magical, t.detected, t.identified], [POOL.magic, true, false, "none"], "a dealt find is magic, undetected and unidentified");
  const m = t.source.data.flags[MODULE_ID].markets;
  eq([m.identified, m.detected, m.curseKnown, m.cursed, m.magic], ["none", false, undefined, true, true], "the snapshot's own identification and curse-known marks are cleared, the curse and the magic kept");
  const claimed = claimItemData(t, (d) => d);
  const cm = claimed.flags[MODULE_ID].markets;
  eq([cm.identified, cm.detected, cm.curseKnown, cm.cursed], ["none", false, undefined, true], "a claim creates an item that knows no more than the card");
  eq(knownTruth().source.data.flags[MODULE_ID].markets.identified, "full", "the source truth is not changed");
  const coin = normalizeTruth({ pool: POOL.coins, label: "5 Tin", coin: { name: "Tin", cv: 1, count: 5 } });
  eq(unknownTruth(coin), coin, "a coin a bundle delivers is left as coin");
  const bare = unknownTruth(normalizeTruth({ source: { uuid: "Item.e", data: { name: "x", type: "item", flags: {} } }, pool: POOL.item, label: "x" }));
  eq([bare.pool, bare.magical, bare.detected, bare.source.data.flags[MODULE_ID].markets], [POOL.magic, true, false, { magic: true, identified: "none", detected: false }], "a snapshot with no markets is marked magic, undetected and unidentified, so a claim is flagged magic");
}

/* --- what a rolled find passes for ------------------------------------------------- */
{
  const ph = placeholder("widgets");
  const t = unknownTruth(knownTruth(), ph);
  eq([t.mask, apparentName(t)], [{ name: "widgets" }, "widgets"], "a rolled find with no disguise wears its placeholder's name, never its own");
  eq(rankWorth(t), 0, "and, with no cost to pass for, ranks as the placeholder did");
  const claimed = claimItemData(t, (d, m) => ({ ...d, name: m.name }));
  eq(claimed.name, "widgets", "a claim delivers the item wearing what it passed for");
  const disguised = normalizeTruth({ ...knownTruth(), mask: { name: "Gamma thing", cost: 7 } });
  const d = unknownTruth(disguised, ph);
  eq([d.mask, apparentName(d), rankWorth(d)], [{ name: "Gamma thing", cost: 7 }, "Gamma thing", 7], "a document's own disguise wins, and its cost ranks the find");
  eq(unknownTruth(knownTruth()).mask, null, "with no placeholder and no disguise, no mask is made up");
}

/* --- a rolled bundle: only its magic part is magic ----------------------------------- */
{
  const plainGood = normalizeTruth({ source: { uuid: "Item.d", data: { name: "Plain good", type: "item", flags: {} } }, pool: POOL.item, label: "Plain good", magical: false, detected: true });
  const markedGood = normalizeTruth({ source: { uuid: "Item.d", data: { name: "Marked good", type: "item", flags: { [MODULE_ID]: { markets: { magic: true } } } } }, pool: POOL.item, label: "Marked good", magical: false, detected: true });
  const coin = normalizeTruth({ pool: POOL.coins, label: "2 Tin", coin: { name: "Tin", cv: 1, count: 2 } });
  const r = await rollMagicTruths({ truths: [placeholder("widgets")], style: "classic", where: "Q.magic", lists: LISTS, roll: async () => ({ ok: true, start: "classic.wd", steps: [], item: { text: "Delta item", uuid: "Item.d", flag: null } }), resolve: async () => [knownTruth(), plainGood, markedGood, coin] });
  eq(r.truths.map((x) => [x.label, x.pool, x.magical, x.detected, x.mask?.name ?? null]), [
    ["Delta item", POOL.magic, true, false, "widgets"],
    ["Plain good", POOL.item, false, true, null],
    ["Marked good", POOL.magic, true, false, "widgets"],
    ["2 Tin", POOL.coins, false, true, null],
  ], "the document and a good marked magic are made unknown; a plain good and the coin stay as dealt");
  eq(r.truths[1], plainGood, "the plain good is passed through unchanged");
}

/* --- the roll's outcomes, on a fake roll ------------------------------------------- */
const item = (text, extra = {}) => ({ list: "classic.wd", text, fields: { item: text }, flag: null, ref: null, uuid: null, ...extra });
const walked = (it, extra = {}) => ({ ok: true, start: "classic.wd", steps: [{ list: "classic.wd", die: "1d6", total: 2, band: { min: 1, max: 2 }, caption: "Widget", cite: "INV p.2" }], item: it, rolls: [], ...extra });
const run = (truths, over = {}) => rollMagicTruths({ truths, style: "classic", where: "Q.magic", lists: LISTS, roll: async () => walked(item("Alpha widget")), resolve: async () => null, ...over });
{
  const asked = [];
  let r = await run([placeholder("widgets"), normalizeTruth({ pool: POOL.coins, label: "5 Tin", coin: { name: "Tin", cv: 1, count: 5 } }), normalizeTruth({ pool: POOL.gems, label: "pebble", valueGp: 4 })], { roll: async (a) => (asked.push(a), walked(item("Alpha widget"))) });
  eq(asked, [{ from: "classic.wd", style: "classic" }], "a matched card is rolled once, at the list its noun names, in the deal's style");
  eq(r.truths.map((t) => [t.pool, t.label]), [[POOL.magic, "Alpha widget"], [POOL.coins, "5 Tin"], [POOL.gems, "pebble"]], "the rolled card is named for its item; every other truth passes through in place");
  eq(r.errors, [], "no error");

  r = await run([placeholder("widgets")]);
  const [t] = r.truths;
  eq([t.pool, t.label, t.magical, t.detected, t.identified, t.source.data], [POOL.magic, "Alpha widget", true, false, "none", null], "an item with no document is a magic placeholder named for it");
  eq(apparentName(t), "widgets", "and the table reads the placeholder's name, never the item's");
  ok(!("tableRef" in t), "a rolled card carries no ref");
  eq(r.audit.at(-1).cite, "INV p.2", "and the audit row cites the last list the walk read");

  const found = async () => [knownTruth()];
  r = await run([placeholder("widgets")], { roll: async () => walked(item("Delta item", { uuid: "Item.d" })), resolve: found });
  eq([r.truths[0].label, r.truths[0].source.uuid, r.truths[0].detected, r.truths[0].identified, r.truths[0].source.data.flags[MODULE_ID].markets.identified], ["Delta item", "Item.d", false, "none", "none"], "an item that resolves is that document, stored undetected and unidentified though its source is identified");

  const resolved = [];
  r = await run([placeholder("widgets")], { roll: async () => walked(item("Delta item", { uuid: "Item.d" })), resolve: async (uuid) => (resolved.push(uuid), null) });
  eq([resolved, r.truths.map((t) => t.label), r.errors], [["Item.d"], ["Delta item"], []], "a uuid no document answers is the named placeholder, with no error");
  r = await run([placeholder("widgets")], { roll: async () => walked(item("Delta item", { uuid: "Item.d" })), resolve: async () => [] });
  eq(r.truths.map((t) => t.label), ["Delta item"], "a document that delivers nothing is the named placeholder");
  r = await run([placeholder("widgets")], { roll: async () => walked(item("Delta item", { uuid: "Item.d" })), resolve: async () => { throw new Error("gone"); } });
  eq([r.truths.map((t) => t.label), r.errors], [["Delta item"], []], "a resolver that throws is the named placeholder");

  const two = async () => [knownTruth(), normalizeTruth({ pool: POOL.coins, label: "2 Tin", coin: { name: "Tin", cv: 1, count: 2 } })];
  r = await run([placeholder("widgets")], { roll: async () => walked(item("Delta item", { uuid: "Item.d" })), resolve: two });
  eq(r.truths.map((t) => [t.pool, t.detected]), [[POOL.magic, false], [POOL.coins, true]], "a bundle's goods are each stored, only the magic one made unknown");

  const nouns = [];
  r = await run([placeholder("widgets"), placeholder("widgets"), placeholder("widgets")], { roll: async (a) => (nouns.push(a.from), walked(item(`Item ${nouns.length}`))) });
  eq([nouns.length, r.truths.map((t) => t.label)], [3, ["Item 1", "Item 2", "Item 3"]], "each card is rolled on its own, once");
}

/* --- refusals: the placeholder stays, an error says so ------------------------------ */
{
  const refused = async (label, truths, over, reason, rolled = 0) => {
    let n = 0;
    const base = over.roll ?? (async () => walked(item("Alpha widget")));
    const r = await run(truths, { ...over, roll: over.roll === null ? null : async (a) => (n++, base(a)) });
    eq(r.truths, truths, `${label}: the cards stay as dealt`);
    eq(r.errors.map((e) => [e.code, e.reason]), truths.map(() => [MAGIC_ERROR, reason]), `${label}: one error each, with its reason`);
    eq(n, rolled, `${label}: rolled ${rolled} time(s)`);
    return r;
  };
  await refused("no match", [placeholder("wobbles")], {}, MAGIC_REASON.noMatch);
  await refused("ambiguous", [placeholder("gizmos")], {}, MAGIC_REASON.ambiguous);
  await refused("no noun", [placeholder(null)], {}, MAGIC_REASON.noNoun);
  await refused("nothing imported", [placeholder("widgets")], { lists: { classic: [], heroic: [] } }, "not-imported");
  await refused("no roll service", [placeholder("widgets")], { roll: null }, MAGIC_REASON.noRoller);
  await refused("rarity required", [placeholder("widgets")], { roll: async () => ({ ok: false, reason: "rarity-required", start: null, steps: [], item: null }) }, "rarity-required", 1);
  const walkError = await refused("a walk error", [placeholder("widgets")], { roll: async () => ({ ok: false, reason: "die-mismatch", start: "classic.wd", steps: [{ list: "classic.wd", die: "1d6", total: 3, band: { min: 3, max: 4 }, caption: "Widget", cite: "INV p.2" }], item: null }) }, "die-mismatch", 1);
  eq(walkError.audit.map((a) => [a.list, a.total]), [["classic.wd", 3]], "a walk that failed late still audits what it threw");
  await refused("a roll that throws", [placeholder("widgets")], { roll: async () => { throw new Error("boom"); } }, MAGIC_REASON.failed, 1);
  await refused("a roll that answers nothing", [placeholder("widgets")], { roll: async () => null }, MAGIC_REASON.failed, 1);
  await refused("an item no row reached", [placeholder("widgets")], { roll: async () => walked(item("A link row", { flag: "missing-list" })) }, MAGIC_REASON.noItem, 1);
  await refused("an item with no name", [placeholder("widgets")], { roll: async () => walked(item(null)) }, MAGIC_REASON.noItem, 1);
  await refused("an item with a blank name", [placeholder("widgets")], { roll: async () => walked(item("  ")) }, MAGIC_REASON.noItem, 1);

  const mixed = await run([placeholder("widgets"), placeholder("wobbles"), placeholder("widgets")]);
  eq(mixed.truths.map((t) => t.label), ["Alpha widget", "wobbles", "Alpha widget"], "one refusal leaves the others rolled, in place");
  eq(mixed.errors.length, 1, "and is the only error");
}

/* --- the audit rows ----------------------------------------------------------------- */
{
  const two = walked(item("Alpha widget"), { steps: [
    { list: "classic.kk", die: "1d6", total: 2, band: { min: 1, max: 2 }, caption: "Kind", cite: "INV p.1", inner: { die: "1d4", total: 3, band: { min: 3, max: 3 } } },
    { list: "classic.wd", die: "1d20+1", total: 7, band: { min: 5, max: 9 }, caption: "Widget", cite: "INV p.2" },
  ], start: "classic.kk" });
  const r = await run([placeholder("widgets")], { roll: async () => two });
  eq(r.audit, [
    { where: "Q.magic", expr: "1d6", sides: 6, min: 1, max: 6, total: 2, cite: "INV p.1", magic: true, start: "classic.kk", list: "classic.kk", caption: "Kind" },
    { where: "Q.magic", expr: "1d4", sides: 4, min: 1, max: 4, total: 3, cite: "INV p.1", magic: true, start: "classic.kk", list: "classic.kk", caption: "Kind", inner: true },
    { where: "Q.magic", expr: "1d20+1", sides: 20, min: 2, max: 21, total: 7, cite: "INV p.2", magic: true, start: "classic.kk", list: "classic.wd", caption: "Widget", item: "Alpha widget" },
  ], "each die thrown is a row in the hoard's shape, with its list, caption, start and the item reached");
  eq((await run([placeholder("wobbles")])).audit, [], "a card that was not rolled audits nothing");
}

/* --- the deal toggles act on a rolled card ----------------------------------------------- */
{
  const named = normalizeTruth({ pool: POOL.magic, label: "Beta widget", magical: true, detected: false });
  const rolled = unknownTruth(knownTruth());
  const kept = normalizeTruth({ pool: POOL.magic, label: "wobbles", magical: true, detected: false });
  const plain = normalizeTruth({ pool: POOL.item, label: "Plain thing", source: { uuid: "Item.p", data: { name: "Plain thing", type: "item", flags: {} } } });
  const view = (toggles) => ({
    id: "pile1",
    pot: normalizePot({ phase: PHASE.staging, order: ["r", "n", "k", "p"], deal: { toggles } }),
    cards: [["r", rolled], ["n", named], ["k", kept], ["p", plain]].map(([id, truth]) => ({ id, face: null, value: 0, truth })),
  });
  eq(dealOf(view({ noMagic: true })).removed, ["r", "n", "k"], "No magic strikes a rolled card, a named placeholder and a kept one alike");
  eq(dealOf(view({ noMagic: false })).removed, [], "with the toggle off nothing is struck");
  const forced = dealOf(view({ forceCursed: true })).forced;
  eq(forced.map((f) => f.id), ["r"], "Force cursed marks the rolled card with a snapshot, and skips the placeholders as it always has");
  const fm = forced[0].flags[MODULE_ID].markets;
  eq([fm.cursed, fm.curseKnown], [true, undefined], "the curse is set and, the card being unidentified, not known");
  const both = dealOf(view({ noMagic: true, forceCursed: true }));
  eq([both.removed, both.forced], [["r", "n", "k"], []], "No magic wins over Force cursed");
}

/* --- end to end: the real deal, the real roll service, the real contract ---------------- */
{
  const { dealLettersIntoPot } = await import("../scripts/treasure/deal.mjs");
  const { rollMagicItem, starts } = await import("../scripts/magic-items/roll-service.mjs");
  const { MAGIC_ITEM_DOC } = await import("../scripts/magic-items/constants.mjs");
  for (const fn of hooks.init) fn();
  ok(services.get("magic-item-roll")?.roll === rollMagicItem && acksExtras.magicItems.starts === starts, "the real wiring offers the roll and the starts");

  const band = (min, max, rest) => ({ min, max, ...rest });
  const treasure = {
    id: "treasure",
    cites: { typeClassic: "INV t", typeHeroic: "INV th" },
    tables: {
      typeClassic: {
        M: { category: "Odds", avgValue: null, cp: null, sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: "100% 1 widgets; 100% 1 gizmos; 100% 1 wobbles" },
        N: { category: "Odds", avgValue: null, cp: null, sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: "100% 3 widgets" },
        L: { category: "Odds", avgValue: null, cp: null, sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: "100% 1 links" },
      },
      typeHeroic: { M: { category: "Odds", avgValue: null, cp: null, sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: "100% 1 widgets" } },
      typeUnits: { classic: {}, heroic: {} },
    },
  };
  const magic = {
    id: MAGIC_ITEM_DOC,
    cites: { classic: "INV p.2", heroic: "INV p.3" },
    tables: {
      classic: {
        wd: [band(1, 2, { item: "Alpha widget", ref: "cb.alpha" }), band(3, 4, { item: "Beta widget" }), band(5, 6, { item: "Gamma widget", ref: "cb.gone" })],
        gz: [band(1, 6, { item: "Delta gizmo" })],
        gz2: [band(1, 6, { item: "Epsilon gizmo" })],
        lp: [band(1, 6, { item: "Lost link", hop: "classic.nowhere" })],
      },
      heroic: { hw: [band(1, 20, { item: "Zeta widget" })] },
      captions: { "classic.wd": "Widget", "classic.gz": "Gizmo", "classic.gz2": "Gizmos", "classic.lp": "Link", "heroic.hw": "Widget" },
    },
  };
  const alphaItem = {
    uuid: "Item.alpha",
    name: "Alpha widget",
    type: "item",
    flags: { [MODULE_ID]: { markets: { magic: true, detected: true, identified: "full", curseKnown: true } } },
    toObject() { return { name: this.name, type: "item", system: { quantity: { value: 1 } }, flags: structuredClone(this.flags) }; },
  };
  globalThis.fromUuid = async (uuid) => (uuid === "Item.alpha" ? alphaItem : null);
  services.register("cookbook-items", { documentOf: async (ref) => (ref === "cb.alpha" ? { uuid: "Item.alpha" } : null) });
  const sequence = (...totals) => { const q = [...totals]; const f = (expr) => (f.asked.push(expr), { total: q.shift(), sides: Number(expr.slice(expr.indexOf("d") + 1)) }); f.asked = []; return f; };
  const fresh = () => { stored.length = 0; pile.cards.clear(); pile.flags = { [MODULE_ID]: { [POT_FLAG]: { phase: PHASE.staging, deal: { metInLair: true } } } }; };
  const truthsStored = () => stored.map((d) => d.flags[MODULE_ID][CARD_FLAG]);
  const world = () => { resetTables(); registerTable(treasure, { priority: PRIORITY.WORLD }); registerTable(magic, { priority: PRIORITY.WORLD }); };

  world();
  fresh();
  let roller = sequence(1);
  let r = await dealLettersIntoPot(pile, { letters: ["M"], roller });
  eq(r.ok, true, "the deal runs");
  const m = truthsStored();
  eq(m.map((t) => [t.pool, t.label]), [[POOL.magic, "Alpha widget"], [POOL.magic, "gizmos"], [POOL.magic, "wobbles"]], "the matched noun is rolled; an ambiguous one and an unmatched one stay as dealt");
  eq([m[0].source.uuid, m[0].detected, m[0].identified, m[0].magical], ["Item.alpha", false, "none", true], "the rolled card is the linked document, stored undetected and unidentified though that document is identified");
  eq(m[0].source.data.flags[MODULE_ID].markets.curseKnown, undefined, "with no curse knowledge");
  eq(roller.asked.length, 1, "only the matched card was rolled");
  eq(r.dealt[0].errors.map((e) => [e.code, e.reason, e.noun]), [[MAGIC_ERROR, "ambiguous", "gizmos"], [MAGIC_ERROR, "no-match", "wobbles"]], "the refusals are in the deal's errors");
  eq(r.dealt[0].audit.filter((a) => a.magic), [{ where: "M.magic", expr: "1d6", sides: 6, min: 1, max: 6, total: 1, cite: "INV p.2", magic: true, start: "classic.wd", list: "classic.wd", caption: "Widget", item: "Alpha widget" }], "the letter's audit carries the walk");
  ok(r.dealt[0].audit.some((a) => !a.magic), "beside the hoard's own throws");
  eq(dealMessages(r).filter((x) => x.key.includes("magic")).map((x) => [x.level, x.key, x.args.letter]), [["warn", `deal.error.${MAGIC_ERROR}`, "M"]], "the Judge's notice says the magic was not rolled, once");
  ok(typeof lang[`ACKS-TREASURE.deal.error.${MAGIC_ERROR}`] === "string" && DEAL_ERROR_CODES.includes(MAGIC_ERROR), "and has its own words");

  fresh();
  roller = sequence(3, 5, 1);
  r = await dealLettersIntoPot(pile, { letters: ["N"], roller });
  eq(truthsStored().map((t) => [t.label, t.source.uuid]), [["Beta widget", null], ["Gamma widget", null], ["Alpha widget", "Item.alpha"]], "one hoard line of three rolls three times: an item with no ref and one whose ref no document answers are named, one with a document is it");
  eq(r.dealt[0].errors, [], "none of that is an error");

  fresh();
  r = await dealLettersIntoPot(pile, { letters: ["L"], roller: sequence(2) });
  eq([truthsStored().map((t) => t.label), r.dealt[0].errors.map((e) => e.reason)], [["links"], [MAGIC_REASON.noItem]], "a walk that ended on a link no list answers names no item");

  fresh();
  roller = sequence(1);
  r = await dealLettersIntoPot(pile, { letters: ["M"], style: "heroic", roller });
  eq([truthsStored().map((t) => t.label), roller.asked], [["Zeta widget"], ["1d20"]], "heroic starts at the rarity list the noun names, thrown on that list's own die");

  fresh();
  r = await dealLettersIntoPot(pile, { letters: ["N"], roller: () => ({ total: 99, sides: 6 }) });
  eq([truthsStored().map((t) => t.label), r.dealt[0].errors.map((e) => e.reason)], [["widgets", "widgets", "widgets"], ["roll-out-of-range", "roll-out-of-range", "roll-out-of-range"]], "a walk error keeps every placeholder and reports it");
  eq(dealMessages(r).filter((x) => x.key.includes("magic")).length, 1, "three refusals are one notice");

  const saved = services.get("magic-item-roll");
  services.register("magic-item-roll", {});
  fresh();
  r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq([truthsStored().map((t) => t.label), r.dealt[0].errors.map((e) => e.reason)], [["widgets", "gizmos", "wobbles"], ["no-roller", "no-roller", "no-roller"]], "no roll service: the placeholders stay and say so");
  services.register("magic-item-roll", saved);

  unregisterTable(MAGIC_ITEM_DOC, { priority: PRIORITY.WORLD });
  fresh();
  r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq([r.ok, truthsStored().map((t) => t.label), [...new Set(r.dealt[0].errors.map((e) => e.reason))]], [true, ["widgets", "gizmos", "wobbles"], ["not-imported"]], "no item tables imported: nothing is rolled, nothing is invented");

  world();
  fresh();
  const gone = acksExtras.magicItems;
  acksExtras.magicItems = undefined;
  r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq([truthsStored().map((t) => t.label), [...new Set(r.dealt[0].errors.map((e) => e.reason))]], [["widgets", "gizmos", "wobbles"], ["not-imported"]], "no list set to read: the placeholders stay and say so");
  acksExtras.magicItems = gone;
}

/* --- a noun printed before its count begins at the type list -------------------------- */
{
  const TYPED = { ...LISTS, classicType: { key: "bands", id: "classicType.bands", caption: "Kind" } };
  const T = { typeList: true };
  eq(startFor("whatever", "classic", TYPED, T), { ok: true, id: "classicType.bands" }, "a noun-first noun that names no list begins at the type list");
  eq(startFor("whatever", "classic", TYPED), { ok: false, reason: MAGIC_REASON.noMatch }, "the same noun printed count-first never falls to the type list");
  eq(startFor("whatever", "classic", TYPED, { typeList: false }), { ok: false, reason: MAGIC_REASON.noMatch }, "an explicit false is the plain case");
  eq(startFor("widgets", "classic", TYPED, T), { ok: true, id: "classic.wd" }, "a list the noun names wins over the type list");
  eq(startFor("gizmos", "classic", TYPED, T), { ok: false, reason: MAGIC_REASON.ambiguous }, "two matches stay ambiguous");
  eq(startFor("whatever", "heroic", TYPED, T), { ok: false, reason: MAGIC_REASON.noMatch }, "heroic has no type list");
  eq(startFor("whatever", "gritty", TYPED, T), { ok: false, reason: MAGIC_REASON.noMatch }, "gritty has no type list");
  eq(startFor("whatever", "classic", LISTS, T), { ok: false, reason: "not-imported" }, "no type list imported: not imported");
  eq(startFor("whatever", "classic", { ...LISTS, classicType: null }, T), { ok: false, reason: "not-imported" }, "a null type list is not imported");
  eq(startFor("whatever", "classic", { classicType: TYPED.classicType }, T), { ok: true, id: "classicType.bands" }, "a type list alone is enough");
  eq(startFor("whatever, other", "classic", TYPED, T), { ok: false, reason: MAGIC_REASON.compound }, "a compound noun is refused before the type list");
  eq(startFor(null, "classic", TYPED, T), { ok: false, reason: MAGIC_REASON.noNoun }, "no noun is refused before the type list");

  const typed = (noun) => ({ ...placeholder(noun), typeList: true });
  const asked = [];
  const roll = async (a) => (asked.push(a), walked(item("Alpha widget")));
  let r = await run([typed("whatever")], { lists: TYPED, roll });
  eq([asked, r.errors], [[{ from: "classicType.bands", style: "classic" }], []], "a type-list placeholder is rolled from the type list");
  eq(r.truths[0].label, "Alpha widget", "and is replaced by what the walk reached");

  asked.length = 0;
  r = await run([typed("whatever"), placeholder("whatever"), typed("whatever"), placeholder("whatever")], { lists: TYPED, roll });
  eq(asked, [{ from: "classicType.bands", style: "classic" }, { from: "classicType.bands", style: "classic" }], "the answer is kept per noun and kind of start: the type-list pair rolls, the plain pair does not");
  eq(r.errors, [{ code: MAGIC_ERROR, reason: MAGIC_REASON.noMatch, noun: "whatever" }, { code: MAGIC_ERROR, reason: MAGIC_REASON.noMatch, noun: "whatever" }], "a plain placeholder of the same noun is still refused, whichever came first");
  r = await run([placeholder("whatever"), typed("whatever")], { lists: TYPED, roll });
  eq(r.truths.map((t) => t.label), ["whatever", "Alpha widget"], "the plain one stays a placeholder and the typed one rolls, in either order");

  r = await run([typed("whatever")], { style: "heroic", lists: TYPED, roll });
  eq(r.errors, [{ code: MAGIC_ERROR, reason: MAGIC_REASON.noMatch, noun: "whatever" }], "a type-list placeholder in heroic is refused");
  r = await run([typed("whatever")], { lists: LISTS, roll });
  eq(r.errors, [{ code: MAGIC_ERROR, reason: "not-imported", noun: "whatever" }], "no type list read: the placeholder stays and says so");
}

console.log(`treasure magic deal: ${checks} checks passed`);
