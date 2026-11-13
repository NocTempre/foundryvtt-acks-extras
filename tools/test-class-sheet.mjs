/**
 * What the class constructor sheet shows for a class's rows, with no Foundry.
 *
 * The sheet's context and the three template lines that act on it (the stub
 * notice, the unread-experience and unread-title notices, and the build tooltip
 * on each experience cell) are run on classes the binder builds from invented
 * class sentences: a class read from sentences with no builder tables, the same
 * class priced from its build, a priced class a Judge has typed over, a stub,
 * and a class whose every level is filled in. The template lines are read off
 * `templates/classes/class-sheet.hbs` and compiled, so a renamed context key or
 * a moved notice fails here. Every paragraph, name and number is invented; the
 * patterns are the shipped register row's, as in the importer's prose-levels
 * suite.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

let pass = 0;
const test = async (name, fn) => {
  try {
    await fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANG = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8"));
const localize = (key) => LANG[key] ?? key;
const format = (key, data = {}) => localize(key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));

/* --- the Foundry the sheet reads, as little of it as the context needs ------------------------ */

class ItemSheetV2 {
  constructor(options = {}) {
    this.document = options.document;
  }
  get item() {
    return this.document;
  }
  get isEditable() {
    return true;
  }
  async _prepareContext() {
    return {};
  }
}
globalThis.game = { items: [], packs: [], i18n: { localize, format } };
globalThis.fromUuidSync = () => null;
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: {}, operators: { ForcedDeletion: class {} } },
  utils: {
    deepClone: (o) => structuredClone(o),
    getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o),
    setProperty: (o, p, v) => {
      const ks = p.split(".");
      const last = ks.pop();
      ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
      return true;
    },
  },
  applications: {
    api: { HandlebarsApplicationMixin: (Base) => class extends Base {} },
    sheets: { ItemSheetV2 },
    ux: { TextEditor: { implementation: { enrichHTML: async (html) => html } } },
  },
};

const { default: ClassSheet } = await import("../scripts/classes/class-sheet.mjs");
const { default: ClassData } = await import("../scripts/classes/class-data.mjs");
const { bindClass } = await import("../scripts/importer/cookbook.mjs");

/* --- the template lines under test ------------------------------------------------------------ */

const hb = Handlebars.create();
hb.registerHelper("localize", (key, options) => format(key, options?.hash));
const lines = fs.readFileSync(path.join(ROOT, "templates", "classes", "class-sheet.hbs"), "utf8").split("\n");
const noticeLines = lines.filter((l) => /^\{\{#if (isStub|xpUnread)\}\}/.test(l));
const xpLine = lines.find((l) => l.includes('name="system.levels.{{index}}.xp"'));
assert.equal(noticeLines.length, 2, "the stub and unread notices are two lines of the sheet");
assert.ok(xpLine, "the sheet has an experience cell per level");
const renderNotices = hb.compile(noticeLines.join("\n"));
const renderXpCells = hb.compile(`{{#each levels}}${xpLine}\n{{/each}}`);
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&#x3D;/g, "=").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The text of the tooltips the experience cells carry, one per cell that has one. */
const tipsOf = (html) => [...html.matchAll(/data-tooltip-text="([^"]*)"/g)].map((m) => decode(m[1]));
const cellCount = (html) => (html.match(/<input name="system\.levels\.\d+\.xp"/g) ?? []).length;

/* --- the classes the binder builds from invented sentences ------------------------------------ */

const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "register", "cat", "p13-p23-classes.json"), "utf8"));
const spec = rows[0].class;
const BODY =
  "Hit Dice:1d10 until 7th level, then +3 hp per levelafterMaximum Level:9Lore:invented. " +
  "She may make a cleave once perround per level. She receives a+2 bonus to damage on her melee attacks at 2ndlevel, " +
  "and an additional +2 at 5th, 8th, and 4thlevels. Proficiencies:She starts withthe Wayfaring proficiency, one general" +
  "proficiency, and one class proficiency. She gains ageneral proficiency at 4th and 8th levels; and a classproficiency at 2nd and 7th levels.";
const entry = {
  kind: "kind.class",
  name: "Sheet Warden",
  book: "cat",
  cite: "CAT p.1",
  meta: { key: "sheetWarden", chassis: { saves: "fighter", attack: "fighter" } },
  cleaves: spec.cleaves,
  proseLevels: spec.proseLevels,
  damageBonus: spec.damageBonus,
  // The build's allocation is the register row's; the race page it reads is invented, so the pattern is too.
  build: { ...spec.build, race: { ...spec.build.race, pattern: "Race\\s*2:[\\s\\S]{0,300}?Cost:\\s*([\\d,]+)\\s*XP" } },
};
const cut = BODY.indexOf("round per level");
const RACE_PAGE = "Race 1: invented.Cost: 99 XP. Race 2:invented features over two lines. Cost:1,111 XP.Race 3: invented. Cost: 7 XP.";
const fields = { hitDie: "1d10", maximumLevel: 9, body1c0: BODY.slice(0, cut), body1c1: BODY.slice(cut) };
const TABLES = {
  budget: { smoothing: { level: 7, nearest: 1000 }, postEight: { fighter: 7000, crusaderThief: 5000, mage: 9000 }, xpFlatAfter: 6 },
  hd: [{ value: 0, cost: 10 }, { value: 1, cost: 20 }],
  fighting: [{ value: 2, sub: "", cost: 200 }],
  thievery: [{ value: 0, cost: 0 }],
  magicTypes: { arcane: { values: [{ value: 1, cost: 30 }] }, divine: { values: [{ value: 1, cost: 40 }] } },
  tradeoffs: ["weapons.unrestrictedBroad", "weapons.broadNarrow", "weapons.narrowRestricted"].map((key) => ({ key, xpDelta: 5, xpDeltaMinFighting: 2 })),
};
const read = bindClass(entry, { fields }, "def.class.sheetWarden");
const priced = bindClass(entry, { fields: { ...fields, race8c0: RACE_PAGE.slice(0, 40), race8c1: RACE_PAGE.slice(40) } }, "def.class.sheetWarden", { builderTables: TABLES });
const stub = bindClass(entry, null, "def.class.sheetWarden");

/** A class document the sheet can open: the built system on the real data model's prototype, and the built flags. */
const document = (built, mutate = (system) => system) => {
  const system = Object.assign(Object.create(ClassData.prototype), mutate(structuredClone(built.system)));
  const flags = structuredClone(built.flags ?? {});
  return { name: built.name, system, flags, getFlag: (scope, key) => flags[scope]?.[key], effects: [], _source: {}, isOwner: true };
};
/** The sheet's context for `doc`, and the lines of the template that read it. */
const open = async (doc) => {
  const context = await new ClassSheet({ document: doc })._prepareContext({});
  return { context, notices: decode(renderNotices(context)), cells: renderXpCells(context) };
};
const withLevels = (fn) => (system) => ({ ...system, levels: system.levels.map(fn) });

await test("a class read from sentences opens with rows, a ladder and its gains, and says its experience is unread", async () => {
  const { context, notices, cells } = await open(document(read));
  assert.equal(context.isStub, false);
  assert.equal(context.levels.length, 9);
  assert.equal(context.levels[0].hd, "1d10");
  assert.equal(context.levels[8].hd, "7d10+6");
  assert.equal(context.ladders.length, 1);
  assert.equal(context.ladders[0].key, spec.damageBonus.key);
  assert.deepEqual(context.ladders[0].values.map((r) => r.value), [2, 4, 6, 8]);
  assert.equal(context.awards.filter((a) => a.isChoice).length, 6);
  assert.equal(context.xpUnread, true);
  assert.equal(context.titlesUnread, true);
  assert.equal(context.cite, "CAT p.1");
  assert.ok(!notices.includes(localize("ACKS-CLASSES.sheet.stubNotice")), "a class with rows shows no stub notice");
  assert.ok(notices.includes(format("ACKS-CLASSES.sheet.xpUnread", { cite: "CAT p.1" })), "the unread experience names the page to copy from");
  assert.ok(!notices.includes(format("ACKS-CLASSES.sheet.titlesUnread", { cite: "CAT p.1" })), "the unread-titles notice yields to the experience notice");
  assert.equal(cellCount(cells), 9, "one experience cell per level");
});

await test("an unread experience carries no build tooltip", async () => {
  const { context, cells } = await open(document(read));
  assert.equal(context.xpTip, "");
  assert.deepEqual(tipsOf(cells), []);
});

await test("a class priced from its build reads every level, names the build on each experience cell, and says its titles are unread", async () => {
  const { context, notices, cells } = await open(document(priced));
  assert.equal(context.xpUnread, false);
  assert.equal(context.titlesUnread, true);
  assert.ok(notices.includes(format("ACKS-CLASSES.sheet.titlesUnread", { cite: "CAT p.1" })));
  assert.ok(!notices.includes(format("ACKS-CLASSES.sheet.xpUnread", { cite: "CAT p.1" })));
  const tips = tipsOf(cells);
  assert.equal(tips.length, 9, "every experience cell carries the tooltip");
  assert.ok(tips.every((t) => t === context.xpTip));
  const build = priced.flags["acks-extras"].xpBuild;
  assert.equal(context.xpTip, format("ACKS-CLASSES.sheet.xpBuildTip", { ...build, magic: build.magic }));
  assert.ok(context.xpTip.includes(String(build.base)) && context.xpTip.includes(String(build.raceCost)), "the tooltip names the figures the build used");
});

await test("a build with no magic says none in the tooltip", async () => {
  const doc = document(priced);
  doc.flags["acks-extras"].xpBuild.magic = "";
  const { context } = await open(doc);
  assert.ok(context.xpTip.includes(`magic ${localize("ACKS-CLASSES.sheet.xpBuildNoMagic")},`));
});

await test("a Judge's figure typed over the priced 2nd level takes the tooltip away", async () => {
  const typed = document(priced, withLevels((r) => (r.level === 2 ? { ...r, xp: 4321 } : r)));
  const { context, cells } = await open(typed);
  assert.equal(context.xpTip, "");
  assert.deepEqual(tipsOf(cells), []);
  const beyond = document(priced, withLevels((r) => (r.level === 5 ? { ...r, xp: 4321 } : r)));
  assert.equal((await open(beyond)).context.xpTip !== "", true, "a figure typed beyond 2nd level leaves the price's own recorded base standing");
});

await test("a typed title ends the unread-titles notice, and a typed experience figure the unread-experience notice", async () => {
  const titled = await open(document(priced, withLevels((r) => (r.level === 2 ? { ...r, title: "Typed" } : r))));
  assert.equal(titled.context.titlesUnread, false);
  assert.ok(!titled.notices.includes(format("ACKS-CLASSES.sheet.titlesUnread", { cite: "CAT p.1" })));
  const filled = await open(document(read, withLevels((r) => (r.level > 1 ? { ...r, xp: 100 * r.level } : r))));
  assert.equal(filled.context.xpUnread, false);
  assert.ok(!filled.notices.includes(format("ACKS-CLASSES.sheet.xpUnread", { cite: "CAT p.1" })));
  assert.equal(filled.context.titlesUnread, true, "the titles notice follows once the experience is read");
});

await test("a class with every figure and title typed shows no notice and no tooltip", async () => {
  const full = document(read, withLevels((r) => ({ ...r, xp: r.level === 1 ? 0 : 100 * r.level, title: `Title ${r.level}` })));
  const { context, notices, cells } = await open(full);
  assert.equal(notices.trim(), "");
  assert.equal(context.xpTip, "");
  assert.deepEqual(tipsOf(cells), []);
});

await test("a class with no rows shows the stub notice and neither unread notice", async () => {
  const { context, notices, cells } = await open(document(stub));
  assert.equal(context.isStub, true);
  assert.equal(context.xpUnread, false);
  assert.equal(context.titlesUnread, false);
  assert.ok(notices.includes(localize("ACKS-CLASSES.sheet.stubNotice")));
  assert.ok(!notices.includes(format("ACKS-CLASSES.sheet.xpUnread", { cite: "CAT p.1" })));
  assert.equal(cellCount(cells), 0);
  assert.deepEqual(context.ladders, []);
});

await test("the chassis a class borrows its throws from is named by the class that publishes it, or by its key until one is held", async () => {
  const selected = (context, which) => context[which].find((o) => o.selected);
  const bare = (await open(document(read))).context;
  assert.equal(selected(bare, "saveChassisOptions").value, "fighter");
  assert.equal(selected(bare, "attackChassisOptions").value, "fighter");
  assert.equal(selected(bare, "saveChassisOptions").label, "fighter", "no fighter class held: the key stands in");
  globalThis.game.items = [{ type: "acks-extras.class", name: "Sheet Fighter", system: { key: "fighter" } }];
  try {
    const held = (await open(document(read))).context;
    assert.equal(selected(held, "saveChassisOptions").label, "Sheet Fighter");
    assert.equal(selected(held, "attackChassisOptions").label, "Sheet Fighter");
  } finally {
    globalThis.game.items = [];
  }
});

console.log(`test-class-sheet: ${pass} checks passed.`);
