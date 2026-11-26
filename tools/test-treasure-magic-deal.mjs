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
const { ARMS_TIER, MAGIC_ERROR, MAGIC_REASON, apparentOf, armsBases, findBase, holdsMagicPlaceholder, isArmsBaseRow, rollMagicTruths, startFor, unknownTruth } = await import("../scripts/treasure/magic-deal-logic.mjs");
const { registerWeaponSource } = await import("../scripts/lib/weapons.mjs");
const { slug } = await import("../scripts/lib/vocab.mjs");
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
  system: { quantity: 1 },
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
  eq(rankWorth(t), 0, "and, with no cost to pass for and no apparent value carried, ranks as the placeholder did");
  const valued = normalizeTruth({ ...knownTruth(), source: { uuid: "Item.d", data: { ...knownItemData(), flags: { [MODULE_ID]: { markets: { ...knownItemData().flags?.[MODULE_ID]?.markets, apparentValueGp: 31 } } } } } });
  const v = unknownTruth(valued, ph);
  eq([apparentName(v), rankWorth(v)], ["widgets", 31], "a rolled find whose snapshot carries an apparent value ranks by it, still wearing its placeholder's name");
  const vd = unknownTruth(normalizeTruth({ ...valued, mask: { name: "Gamma thing", cost: 7 } }), ph);
  eq(rankWorth(vd), 7, "a document's own disguise keeps its cost over the apparent value");
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

/* --- which truths are placeholders, and which index rows a deal's arms read ------------- */
{
  const plain = normalizeTruth({ pool: POOL.item, label: "Plain thing", source: { uuid: "Item.p", data: { name: "Plain thing", type: "item", flags: {} } } });
  const named = normalizeTruth({ pool: POOL.magic, label: "Named thing", magical: true, detected: false });
  eq([holdsMagicPlaceholder([plain, named]), holdsMagicPlaceholder([]), holdsMagicPlaceholder(undefined), holdsMagicPlaceholder([null, plain])], [false, false, false, false], "a magic card with no noun to roll, no truths and a null are no placeholder");
  eq([holdsMagicPlaceholder([plain, placeholder("widgets")]), holdsMagicPlaceholder([placeholder(null)])], [true, true], "a magic truth carrying its noun is one, a null noun included");
  const row = (type, stamp) => ({ type, flags: { [MODULE_ID]: { cookbook: { id: stamp } } } });
  eq([row("weapon", "def.weapon.x"), row("armor", "def.armor.x"), row("weapon", "def.armor.x"), row("armor", "def.weapon.x"), row("weapon", "x"), { type: "weapon" }].map(isArmsBaseRow), [true, true, false, false, false, false], "an arm's base row is a minted weapon or a minted armour, read off the type and the stamp alone");
}

/* --- an arm's apparent worth: the base found by import stamp, plus masterwork ------- */
{
  const mint = (id, name, type, cost, { system = {}, flags = {} } = {}) => ({ uuid: `Item.${id.split(".").pop()}`, name, type, system: { cost, ...system }, flags: { [MODULE_ID]: { cookbook: { id }, ...flags } } });
  const keyOf = (i) => slug(i.flags[MODULE_ID].cookbook.id.slice("def.weapon.".length));
  const LIB = [
    mint("def.weapon.zorkBlade", "Zork Blade", "weapon", 19),
    mint("def.weapon.quillSpear", "Quill Spear", "weapon", 7),
    // Typed `weapon` on purpose: only the ammunition stamp keeps it from being a base.
    mint("def.weapon.tineDarts", "Tine Darts", "weapon", 5, { flags: { ammunition: true } }),
    mint("def.armor.tarnHauberkArmor", "Tarn Hauberk Armor", "armor", 40, { system: { type: "heavy" } }),
    mint("def.armor.tarnBuckler", "Tarn Buckler", "armor", 10, { system: { type: "shield" } }),
    mint("def.armor.tarnBarding", "Tarn Barding", "armor", 90, { system: { type: "heavy" }, flags: { armor: { barding: true } } }),
    mint("def.armor.tarnHelm", "Tarn Helm", "armor", 12, { system: { type: "light" }, flags: { armor: { helmet: true } } }),
    // A document that is not a mint is no base.
    { uuid: "Item.byHand", name: "Hand Spear", type: "weapon", system: { cost: 3 }, flags: {} },
  ];
  const previous = registerWeaponSource({ rows: { zorkblade: {}, quillspear: {}, tinedarts: {} } });
  const bases = armsBases(LIB, keyOf);
  eq(bases.map((b) => [b.name, b.kind]), [["Zork Blade", "weapon"], ["Quill Spear", "weapon"], ["Tarn Hauberk Armor", "armor"], ["Tarn Buckler", "shield"]], "bases are minted weapons, armour and shields: no ammunition, barding, helmet or hand-made document");
  eq(bases[0], { uuid: "Item.zorkBlade", name: "Zork Blade", costGp: 19, kind: "weapon", key: "zorkblade" }, "a weapon carries its seam key and cost");

  const pick = (name) => findBase(name, bases)?.name ?? null;
  eq([pick("Zork Blade"), pick("zork blade"), pick("Blade, Zork")], ["Zork Blade", "Zork Blade", "Zork Blade"], "a weapon is found through the weapon seam over the name's forms");
  eq(pick("Tarn Hauberk Armor"), "Tarn Hauberk Armor", "armour is found by its own name");
  eq([pick("Tarn Hauberk"), pick("Zork Bl."), pick("Tarn Haub. Armor")], ["Tarn Hauberk Armor", "Zork Blade", "Tarn Hauberk Armor"], "a miss falls to the leading words, a period standing for a cut-short word");
  eq([pick("Quill"), pick("Tarn"), pick("Blade")], [null, null, null], "one word that opens a longer name stands for no base");
  eq([pick("Tarn Bu."), pick("Wobble Gear"), pick(""), pick(null)], ["Tarn Buckler", null, null, null], "a cut-short word that fits one name is that name; a name nothing holds is none");
  const twins = armsBases([mint("def.armor.tarnBulwark", "Tarn Bulwark", "armor", 11, { system: { type: "shield" } }), ...LIB.slice(3, 5)], keyOf);
  eq(findBase("Tarn Bu.", twins), null, "a leading-words fit that holds two names names neither");
  eq([pick("Tine Darts"), pick("Tine Dart"), pick("Tine D.")], [null, null, null], "an ammunition document is never a base, by name or by leading words");

  const masterwork = (asked = []) => (tier) => (asked.push(tier), { weaponBoth: 403, armorAC: 211 }[tier]);
  const asked = [];
  const row = (text, extra = {}) => item(text, extra);
  eq(apparentOf(row("Zork Blade +1", { arms: { name: true } }), { bases, masterwork: masterwork(asked) }), { baseUuid: "Item.zorkBlade", baseGp: 19, masterworkGp: 403 }, "a row linked by name: the noun before its bonuses is the base, and a weapon takes the both-tier cost");
  eq(apparentOf(row("Shiny +2", { arms: { grid: "armsZz" }, armsType: "Tarn Hauberk Armor" }), { bases, masterwork: masterwork(asked) }), { baseUuid: "Item.tarnHauberkArmor", baseGp: 40, masterworkGp: 211, type: "Tarn Hauberk Armor" }, "a rolled type is the base, armour takes the AC-tier cost, and the type is kept beside the figures");
  eq(apparentOf(row("Shiny +2", { arms: { grid: "armsZz" }, armsType: "  Tarn Hauberk Armor " }), { bases, masterwork: masterwork() }).type, "Tarn Hauberk Armor", "the type kept is trimmed");
  eq("type" in apparentOf(row("Zork Blade +1", { arms: { name: true } }), { bases, masterwork: masterwork() }), false, "a row linked by name rolled no type, so keeps none");
  eq(apparentOf(row("Shiny +1", { arms: { kind: "k" }, armsType: "Tarn Buckler" }), { bases, masterwork: masterwork(asked) }).masterworkGp, 211, "a shield takes the AC-tier cost");
  eq([asked, ARMS_TIER], [["weaponBoth", "armorAC", "armorAC"], { weapon: "weaponBoth", armor: "armorAC", shield: "armorAC" }], "the tier is asked once per arm, by the base's kind");
  eq(apparentOf(row("Band of Tines +1", { arms: { name: true } }), { bases, masterwork: masterwork() }), null, "a ring linked by name finds no base, so no figures");
  eq(apparentOf(row("Cloak of Quills +1, +2 versus X", { arms: { name: true } }), { bases, masterwork: masterwork() }), null, "so does a cloak with bonuses alone");
  eq(apparentOf(row("Tine Darts +1", { arms: { name: true } }), { bases, masterwork: masterwork() }), null, "ammunition finds no base, so no figures");
  eq(apparentOf(row("Tine Darts +1", { arms: { grid: "armsZz" }, armsType: "Tine Darts" }), { bases, masterwork: masterwork() }), null, "a rolled ammunition type finds none either");
  eq(apparentOf(row("Zork Blade +1, Shiny", { arms: { name: true } }), { bases, masterwork: masterwork() }), null, "a row that prints a figure of its own has no noun, so no figures");
  eq(apparentOf(row("Zork Blade +1"), { bases, masterwork: masterwork() }), null, "a row with no arms link names no arm");
  eq(apparentOf(row("Zork Blade +1", { arms: { grid: "armsZz" } }), { bases, masterwork: masterwork() }), null, "a link rolled no type on names no arm");
  const costless = armsBases([mint("def.weapon.zorkBlade", "Zork Blade", "weapon", undefined)], keyOf);
  eq([apparentOf(row("Zork Blade +1", { arms: { name: true } }), { bases: costless, masterwork: masterwork() }), apparentOf(row("Zork Blade +1", { arms: { name: true } }), { bases: armsBases([mint("def.weapon.zorkBlade", "Zork Blade", "weapon", 0)], keyOf), masterwork: masterwork() })], [null, null], "a base with no positive cost gives none");
  const blade = row("Zork Blade +1", { arms: { name: true } });
  eq([null, undefined, 0, "lots", -4].map((mw) => apparentOf(blade, { bases, masterwork: () => mw })), [null, null, null, null, null], "no positive tier cost gives none");
  eq([apparentOf(blade, { bases, masterwork: null }), apparentOf(blade, { bases: [], masterwork: masterwork() }), apparentOf(blade, { bases: null, masterwork: masterwork() })], [null, null, null], "no tier source and no bases give none");

  // Through the deal: what is rolled, passed, and stored.
  const asks = [];
  const rolling = (it) => async (a) => (asks.push(a), walked(it));
  const withArms = (it, over = {}) => run([placeholder("widgets")], { roll: rolling(it), armsSetting: "s2", bases, masterwork: masterwork(), ...over });
  let r = await withArms(row("Zork Blade +1", { arms: { name: true } }));
  eq([asks.at(-1), r.truths[0].apparent, r.truths[0].label], [{ from: "classic.wd", style: "classic", armsSetting: "s2" }, { baseUuid: "Item.zorkBlade", baseGp: 19, masterworkGp: 403 }, "Zork Blade +1"], "the pot's column goes to the roll, and an arm is stored with its figures");
  eq(rankWorth(r.truths[0]), 422, "and the card ranks 19 plus 403");
  r = await withArms(row("Zork Blade +1", { arms: { name: true } }), { armsSetting: "" });
  eq([asks.at(-1), r.truths[0].apparent?.baseGp ?? null], [{ from: "classic.wd", style: "classic" }, 19], "a blank column passes no setting, and a row that names its base is priced all the same");
  r = await withArms(row("Zork Blade +1", { arms: { name: true } }), { armsSetting: undefined });
  eq(r.truths[0].apparent?.baseGp ?? null, 19, "as with an unset column");
  r = await withArms(row("Weapon +1", { arms: { kind: "weaponKinds.bands" } }), { armsSetting: "" });
  eq([r.truths[0].apparent, rankWorth(r.truths[0])], [null, 0], "a kind-linked row with no column has no type, so stores nothing");
  r = await withArms(row("Zork Blade +1", { arms: { grid: "armsZz" } }), { armsSetting: "" });
  eq(r.truths[0].apparent, null, "nor does a grid-linked row the roll left untyped");
  r = await withArms(row("Band of Tines +1", { arms: { name: true } }));
  eq([r.truths[0].apparent, rankWorth(r.truths[0]), r.errors], [null, 0, []], "a ring row stores nothing and is no error");
  r = await withArms(row("Tine Darts +1", { arms: { name: true } }));
  eq([r.truths[0].apparent, rankWorth(r.truths[0])], [null, 0], "an ammunition row stores nothing");
  r = await withArms(row("Zork Blade +1", { arms: { name: true } }), { masterwork: () => null });
  eq([r.truths[0].apparent, r.errors], [null, []], "no masterwork document: nothing stored, nothing wrong");
  r = await withArms(row("Zork Blade +1", { arms: { name: true } }), { masterwork: () => { throw new Error("boom"); } });
  eq([r.truths[0].apparent, r.errors], [null, []], "a tier source that throws stores nothing and does not throw");
  r = await withArms(row("Zork Blade +1", { arms: { name: true } }), { bases: undefined, masterwork: undefined });
  eq(r.truths[0].apparent, null, "no seams stores nothing");
  r = await withArms(row("Zork Blade +1", { arms: { grid: "armsZz" }, armsType: "Quill Spear" }));
  eq(r.truths[0].apparent, { baseUuid: "Item.quillSpear", baseGp: 7, masterworkGp: 403, type: "Quill Spear" }, "a rolled type is stored as its base, and kept on the truth as the type rolled");

  const two = async () => [knownTruth(), normalizeTruth({ pool: POOL.coins, label: "2 Tin", coin: { name: "Tin", cv: 1, count: 2 } })];
  r = await withArms(row("Zork Blade +1", { arms: { name: true }, uuid: "Item.d" }), { resolve: two });
  eq(r.truths.map((t) => [t.pool, t.apparent?.baseGp ?? null]), [[POOL.magic, 19], [POOL.coins, null]], "a document the roll links to carries the figures on its magic part alone");
  r = await withArms(row("Zork Blade +1", { arms: { name: true }, uuid: "Item.d" }), { resolve: async () => [knownTruth()], armsSetting: "" });
  eq(r.truths[0].apparent?.baseGp ?? null, 19, "and with no column, since the row names its base");

  registerWeaponSource(previous);
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
    toObject() { return { name: this.name, type: "item", system: { quantity: 1 }, flags: structuredClone(this.flags) }; },
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
  const seen = [];
  services.register("magic-item-roll", { roll: (a) => (seen.push(a.armsSetting), saved.roll(a)) });
  fresh();
  pile.flags[MODULE_ID][POT_FLAG].deal.armsSetting = "s4";
  r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq([r.ok, seen, truthsStored()[0].apparent], [true, ["s4"], null], "the pot's arms column reaches the roll; a library holding no base and no masterwork document stores nothing");
  fresh();
  seen.length = 0;
  await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq(seen, [undefined], "a pot with no column passes no setting");
  services.register("magic-item-roll", {});
  fresh();
  r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
  eq([truthsStored().map((t) => t.label), r.dealt[0].errors.map((e) => e.reason)], [["widgets", "gizmos", "wobbles"], ["no-roller", "no-roller", "no-roller"]], "no roll service: the placeholders stay and say so");
  services.register("magic-item-roll", saved);

  // An arm is priced from the shelf's index-read documents: the minted base and the masterwork variation, never a whole-shelf load.
  {
    globalThis.CONFIG.Item = { compendiumIndexFields: [] };
    const { declareLibraryIndexFields } = await import("../scripts/lib/library.mjs");
    declareLibraryIndexFields();
    const { shelfMock, sourceDoc } = await import("./lib-shelf-mock.mjs");
    const variation = { key: "masterwork.weaponBoth", deltas: { bonus: 1, damage: 1, ac: 0, weight6: 0 }, cost: { baseMul: 1, add: 403, mul: 1 }, source: { cite: "INV p. 7" } };
    const arms = shelfMock({
      docs: [
        ...Array.from({ length: 20 }, (_, i) => sourceDoc(`f${i}`, `Filler ${i}`, "equipment")),
        sourceDoc("w1", "Zork Blade", "weapon", "def.weapon.zorkBlade", { cost: 19 }),
        sourceDoc("w2", "Zork Blade copy", "weapon", "def.weapon.zorkBlade", { cost: 99 }),
        sourceDoc("v1", "Masterwork both", "acks-extras.variation", "def.variation.both", variation),
      ],
    });
    const keptItems = globalThis.game.items;
    const keptPacks = globalThis.game.packs;
    globalThis.game.items = [];
    globalThis.game.packs = [arms];
    services.register("magic-item-roll", { roll: async () => ({ ok: true, item: { text: "Zork Blade +1", arms: { name: true } } }) });
    fresh();
    r = await dealLettersIntoPot(pile, { letters: ["M"], roller: sequence(1) });
    eq(truthsStored()[0].apparent, { baseUuid: "Compendium.w1", baseGp: 19, masterworkGp: 403 }, "an arm is priced from its base and the masterwork figure read off the shelf");
    ok(arms.calls.getDocuments.length >= 1 && arms.calls.getDocuments.every((q) => Array.isArray(q?._id__in)), "and every load named its ids: no whole shelf was loaded");
    eq(arms.calls.getDocuments[0]._id__in.slice().sort(), ["v1", "w1", "w2"], "the one load asked for the weapons and the variation, and for no filler");
    eq(arms.calls.getIndex.length, 1, "after one index read");
    globalThis.game.items = keptItems;
    globalThis.game.packs = keptPacks;
    services.register("magic-item-roll", saved);
  }

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

/* --- the deal panel's arms column and the Judge's card: the window's own context -------- */
{
  const { MAGIC_ITEM_DOC } = await import("../scripts/magic-items/constants.mjs");
  const { armsColumns, armsField, armsBandParts } = await import("../scripts/treasure/magic-deal-logic.mjs");
  const { armsParts } = await import("../scripts/treasure/pot-logic.mjs");
  const { armsSource } = await import("../scripts/treasure/deal.mjs");

  // Pure: the columns the import read, "(none)" first, the pot's own selected.
  const grid = (...keys) => Object.fromEntries(keys.map((k) => [k, [{ min: 1, max: 6, type: `Type ${k}` }]]));
  const tables = { armsSettings: { s2: "Beta setting", s1: "Alpha setting", s10: "Kappa setting", s3: "  ", s4: "Delta setting", s5: 7 }, armsSword: grid("s1", "s2", "s3", "s10", "s5"), armsOther: { s4: [] } };
  eq(armsColumns(tables), [{ key: "s1", label: "Alpha setting" }, { key: "s2", label: "Beta setting" }, { key: "s10", label: "Kappa setting" }], "the columns are the named ones some grid has rows under, in column order: a blank name, a non-text name and a column with no rows are left out");
  eq([armsColumns(null), armsColumns({}), armsColumns({ armsSettings: { s1: "Alpha setting" } }), armsColumns({ armsSettings: { s1: "Alpha setting" }, armsSword: { s1: "nope" } })], [[], [], [], []], "no grid imported means no column, however the settings are named");
  eq(armsColumns({ armsSettings: { x1: "Odd", s1: "Alpha setting" }, armsBow: grid("s1", "x1") }).map((c) => c.key), ["s1"], "a key that is no setting key is not a column");
  const tl = (key, data = {}) => lang[`ACKS-TREASURE.${key}`].replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");
  const cols = armsColumns(tables);
  let f = armsField({ columns: cols, chosen: "", cite: "INV p. 9", loc: tl });
  eq([f.off, f.options.map((o) => [o.key, o.label, o.selected]), f.tip], [false, [["", "(none)", true], ["s1", "Alpha setting", false], ["s2", "Beta setting", false], ["s10", "Kappa setting", false]], "INV p. 9"], "a new pot: (none) first and selected, the tooltip the page alone");
  f = armsField({ columns: cols, chosen: "s2", cite: "INV p. 9", loc: tl });
  eq([f.options.filter((o) => o.selected).map((o) => o.key), f.tip], [["s2"], "Beta setting (INV p. 9)"], "the pot's own column is the selected one, and the tooltip names the column and the page");
  f = armsField({ columns: cols, chosen: "s7", cite: "INV p. 9", loc: tl });
  eq([f.options.filter((o) => o.selected).map((o) => o.key), f.tip], [[""], "INV p. 9"], "a stored column the import no longer has reads as (none)");
  f = armsField({ columns: [], chosen: "s1", cite: "INV p. 9", loc: tl });
  eq([f.off, f.options.map((o) => [o.key, o.selected]), f.tip], [true, [["", true]], "INV p. 9"], "no column imported: the field is off, holds (none) alone, and its tooltip is the page reference alone");
  const gpOf = (n) => String(n);
  eq(armsBandParts({ type: "Tarn Hauberk Armor", baseGp: 40, masterworkGp: 211 }, { cite: "INV p. 9", loc: tl, gp: gpOf }), "Tarn Hauberk Armor 40 gp (its imported item) + masterwork 211 gp (RR ch. 4) · INV p. 9", "a typed arm's parts: the type, its base's cost, the masterwork cost and the pages");
  eq(armsBandParts({ type: "", baseGp: 19, masterworkGp: 403 }, { cite: "INV p. 9", loc: tl, gp: gpOf }), "Base 19 gp (its imported item) + masterwork 403 gp (RR ch. 4) · INV p. 9", "an arm with no type names no type");

  // The truths the cards carry, and which of them show their parts.
  const arm = (over = {}) => normalizeTruth({ pool: POOL.magic, label: "Rolled shiny", magical: true, detected: false, mask: { name: "Plain thing" }, apparent: { baseUuid: "Item.x", baseGp: 40, masterworkGp: 211, type: "Tarn Hauberk Armor" }, ...over });
  eq(armsParts(arm()), { type: "Tarn Hauberk Armor", baseGp: 40, masterworkGp: 211 }, "an undetected arm with figures shows its parts");
  eq(armsParts(arm({ apparent: { baseUuid: null, baseGp: 19, masterworkGp: 403 } })), { type: "", baseGp: 19, masterworkGp: 403 }, "a row linked by name shows its parts with no type");
  eq([armsParts(arm({ mask: { name: "Plain thing", cost: 7 } })), armsParts(arm({ detected: true })), armsParts(arm({ apparent: null })), armsParts(arm({ valueGp: 5 })), armsParts(arm({ source: { uuid: "Item.x", data: { flags: { [MODULE_ID]: { markets: { apparentValueGp: 12 } } } } } }))], [null, null, null, null, null], "a mask's cost, a detected card, no figures, a stated worth and an apparent value each rank it by something else, so no parts");
  eq([rankWorth(arm()), rankWorth(arm({ mask: { name: "Plain thing", cost: 7 } }))], [251, 7], "the parts, where shown, are what the rank is");

  // The window's context: the real sheet over a mocked base class.
  const keep = { foundry: globalThis.foundry, format: game.i18n.format, localize: game.i18n.localize, isGM: game.user.isGM };
  let seatedPile = null;
  globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: (Base) => Base, DocumentSheetV2: class { get document() { return seatedPile; } async _prepareContext() { return {}; } }, DialogV2: {} } } };
  game.i18n.format = (key, data = {}) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");
  game.i18n.localize = (key) => lang[key] ?? key;
  const { default: PotSheet } = await import("../scripts/treasure/pot-sheet.mjs");
  const potWith = (truths, deal = {}) => {
    const cards = truths.map((t, i) => ({ id: `c${i}`, face: null, value: 0, flags: { [MODULE_ID]: { [CARD_FLAG]: t } } }));
    return { id: "pot9", documentName: "Cards", type: "pile", testUserPermission: (user) => !!user?.isGM, flags: { [MODULE_ID]: { [POT_FLAG]: { phase: PHASE.staging, order: cards.map((c) => c.id), deal } } }, cards: { contents: cards, get: (id) => cards.find((c) => c.id === id) } };
  };
  const contextOf = async (pile, { gm = true } = {}) => {
    seatedPile = pile;
    game.user.isGM = gm;
    return new PotSheet()._prepareContext({});
  };
  const imported = (extra = {}) => { resetTables(); registerTable({ id: MAGIC_ITEM_DOC, cites: { armsSettings: "INV p. 9" }, tables: { armsSettings: { s1: "Alpha setting", s2: "Beta setting" }, armsSword: grid("s1", "s2"), ...extra } }, { priority: PRIORITY.WORLD }); };
  const typed = arm();
  const named = arm({ label: "Named shiny", apparent: { baseUuid: null, baseGp: 19, masterworkGp: 403 } });
  const masked = arm({ label: "Masked shiny", mask: { name: "Plain thing", cost: 7 } });
  const plain = normalizeTruth({ pool: POOL.item, label: "Wooden spoon", valueGp: 1 });

  imported();
  let ctx = await contextOf(potWith([typed, named, masked, plain], { armsSetting: "s2" }));
  eq([ctx.deal.arms.off, ctx.deal.arms.options.map((o) => [o.key, o.label, o.selected]), ctx.deal.arms.tip], [false, [["", "(none)", false], ["s1", "Alpha setting", false], ["s2", "Beta setting", true]], "Beta setting (INV p. 9)"], "the Judge's panel lists (none) and the imported columns with the pot's own selected, and the tooltip names it and the page the import recorded");
  eq(ctx.deal.styles.length > 0 && Object.keys(ctx.deal).indexOf("arms") === Object.keys(ctx.deal).indexOf("styles") + 1, true, "the field follows the table style in the panel's context");
  // The Treasure tables button on the real sheet follows the permission Foundry asks of a world-setting write, and a GM flag alone grants it nothing.
  const hadCan = game.user.can;
  game.user.can = (permission) => permission === "SETTINGS_MODIFY";
  ctx = await contextOf(potWith([plain]));
  eq([ctx.deal.tablesButton?.label, ctx.deal.tablesButton?.tip], ["Treasure tables", "Imported treasure tables (JJ ch. 4)"], "a seat with SETTINGS_MODIFY is drawn the button, its tooltip the page reference");
  game.user.can = () => false;
  ctx = await contextOf(potWith([plain]));
  eq([game.user.isGM, ctx.deal.tablesButton], [true, null], "a GM whose world withholds SETTINGS_MODIFY is drawn none");
  game.user.can = hadCan;
  ctx = await contextOf(potWith([plain]));
  eq([ctx.deal.arms.options.find((o) => o.selected).key, ctx.deal.arms.tip], ["", "INV p. 9"], "a new pot has none picked, and its tooltip is the page alone");
  eq(armsSource().cite, "INV p. 9", "the page is the one the import recorded");
  resetTables();
  registerTable({ id: MAGIC_ITEM_DOC, tables: { armsSettings: { s1: "Alpha setting" }, armsSword: grid("s1") } }, { priority: PRIORITY.WORLD });
  ctx = await contextOf(potWith([plain], { armsSetting: "s1" }));
  eq([ctx.deal.arms.off, ctx.deal.arms.tip], [false, "Alpha setting (JJ ch. 4)"], "with no page recorded the tooltip falls to the reference the module ships");
  resetTables();
  registerTable({ id: MAGIC_ITEM_DOC, source: { pages: "INV whole span" }, tables: { armsSettings: { s1: "Alpha setting" }, armsSword: grid("s1") } }, { priority: PRIORITY.WORLD });
  eq(armsSource().cite, null, "the document's whole span is no page for the columns, so none is named");
  resetTables();
  registerTable({ id: MAGIC_ITEM_DOC, cites: { armsSettings: "INV p. 9" }, tables: { armsSettings: { s1: "Alpha setting" }, armsSword: grid("s1") } }, { priority: PRIORITY.OVERRIDE });
  eq(armsSource().cite, null, "a Judge's override has no page to point at");
  resetTables();
  ctx = await contextOf(potWith([plain], { armsSetting: "s1" }));
  eq([ctx.deal.arms.off, ctx.deal.arms.options.map((o) => [o.key, o.label, o.selected]), ctx.deal.arms.tip], [true, [["", "(none)", true]], "JJ ch. 4"], "with nothing imported the field is off, blank, and its tooltip is the page reference alone");
  imported({ armsSword: {} });
  ctx = await contextOf(potWith([plain]));
  eq(ctx.deal.arms.off, true, "settings named but no grid under them is no grid imported");

  // The Judge's card: the type, and the band's tooltip.
  imported();
  ctx = await contextOf(potWith([typed, named, masked, plain], { armsSetting: "s1" }));
  const [cTyped, cNamed, cMasked, cPlain] = ctx.cards;
  eq([cTyped.rolledText, cNamed.rolledText, cMasked.rolledText, cPlain.rolledText], ["Undetected · rolled: Tarn Hauberk Armor", "", "Undetected · rolled: Tarn Hauberk Armor", ""], "a typed arm's line names the type rolled, masked or not; a card with no type rolled, none");
  const band = (c) => `${c.bandName} band: ranked within this pot by its apparent worth`;
  eq(cTyped.bandTip, `${band(cTyped)} · Tarn Hauberk Armor 40 gp (its imported item) + masterwork 211 gp (RR ch. 4) · JJ ch. 4`, "the band's tooltip is the one it had, with the parts and the pages after it, in the world's figures");
  eq(cNamed.bandTip, `${band(cNamed)} · Base 19 gp (its imported item) + masterwork 403 gp (RR ch. 4) · JJ ch. 4`, "an arm with no type names its base and masterwork alone; the page is the procedure's, never the import's page for the columns");
  eq([cMasked.bandTip, cPlain.bandTip], [band(cMasked), band(cPlain)], "a card whose rank is not those parts says nothing of them");

  // A Player seat: no field, no type, no parts, in anything the window is handed.
  ctx = await contextOf(potWith([typed, named, masked, plain], { armsSetting: "s2" }), { gm: false });
  eq([ctx.deal, ctx.isGM], [null, false], "a Player seat's window carries no deal panel, so no arms field");
  eq(JSON.stringify(ctx).match(/.{20}(Alpha setting|Beta setting|Tarn Hauberk|rolled:|masterwork).{20}/i), null, "and nothing of the columns, the type or the parts is in what it is handed");
  eq(ctx.cards.every((c) => c.rolledType === "" && c.armsParts === null && c.rolledText === ""), true, "every card's type and parts are blank in a Player's view");
  const open = potWith([typed, named]);
  open.flags[MODULE_ID][POT_FLAG].phase = PHASE.open;
  open.flags[MODULE_ID][POT_FLAG].audience = ["u1"];
  ctx = await contextOf(open, { gm: false });
  ok(!/Tarn Hauberk|rolled:|masterwork \d|Alpha setting/i.test(JSON.stringify(ctx)), "an opened pot's Player window says none of it either");
  eq(ctx.cards.every((c) => c.rolledText === "" && !/masterwork/.test(c.bandTip)), true, "its band tooltips are the plain ones");

  Object.assign(game.i18n, { format: keep.format, localize: keep.localize });
  game.user.isGM = keep.isGM;
  globalThis.foundry = keep.foundry;
  resetTables();
}

console.log(`treasure magic deal: ${checks} checks passed`);
