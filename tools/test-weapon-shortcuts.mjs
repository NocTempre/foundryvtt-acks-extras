/**
 * The printed groups as shortcuts over the training units: which weapons an
 * option or a Weapon Focus holds, how much of them a grant covers, what a press
 * writes, and what the surface says of each.
 *
 * The whole pipeline runs: an invented `weapons` grid and invented `weaponLists`
 * are registered as ruledata, `librarySource` places the rows, and the training
 * units, the shortcut builder and the press read what comes out. Every noun,
 * name and figure is INVENTED; the category tokens are the module's own. No
 * value is read off a book.
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
globalThis.foundry = {
  utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), randomID: () => "rand0000", mergeObject: (a, b) => ({ ...a, ...b }) },
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class {} }, handlebars: { loadTemplates: () => {} }, instances: new Map() },
};
globalThis.CONST = { ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 } };
globalThis.Hooks = { once: () => {}, on: () => {}, callAll: () => {} };

const { registerTable, unregisterTable, resetTables, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { registerWeaponSource, optionFindings, optionUnits, weaponKeys, weaponRow } = await import("../scripts/lib/weapons.mjs");
const { librarySource, WEAPONS_DOC, WEAPONS_TABLE } = await import("../scripts/equipment/weapon-source.mjs");
const { SHORTCUT_LISTS, canonicalGrant, coverageOf, coveredUnits, shortcutUnits, shortcuts, toggledUnits, weaponUnits } = await import("../scripts/equipment/training-view.mjs");
const { categoryTip, trainingShortcuts } = await import("../scripts/character-sheet/tabs/stats.mjs");
const { toggleTrainingShortcut } = await import("../scripts/classes/training.mjs");
const { FLAG_FROM_CLASS } = await import("../scripts/classes/constants.mjs");

let pass = 0;
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

// ----------------------------------------------------------------- the import
const ROW = (name, block, size, use) => ({ name, block, size, melee: use === "m", missile: use === "r", damage: "1d4" });
const GRID = {
  zorka: ROW("Zork A", "Zorks", "small", "m"),
  zorkb: ROW("Zork B", "Zorks", "medium", "m"),
  zorkc: ROW("Zork C", "Zorks", "large", "m"),
  blorpa: ROW("Blorp A", "Blorps", "small", "r"),
  blorpb: ROW("Blorp B", "Blorps", "medium", "r"),
  quuxa: ROW("Quux A", "Odds", "tiny", "m"),
  quuxb: ROW("Quux B", "Odds", "small", "m"),
  quuxc: ROW("Quux C", "Odds", "large", "m"),
  gnarl: ROW("Gnarl", "Odds", "small", "m"),
  klonka: ROW("Klonk A", "Klonks", "medium", "m"),
  klonkr: ROW("Klonk R", "Klonks", "small", "r"),
  stray: ROW("Stray", null, "medium", "m"),
};
const LISTS = {
  id: "weaponLists",
  cites: { options: "ZZ p.1; ZZ p.2", focus: "ZZ p.3" },
  tables: {
    category: { axe: ["zork"], bow: ["blorp"], other: ["quux"], crossbow: ["klonk"] },
    focus: { zorks: ["zork"], quuxs: ["quux", "gnarl"] },
    options: {
      restricted: { cite: "ZZ p.2", options: [{ n: 1, marker: "i", label: "gnarl", weapon: "gnarl" }] },
      narrow: {
        cite: "ZZ p.2",
        options: [
          { n: 1, marker: "i", label: "any zorks", nouns: ["zork"] },
          { n: 2, marker: "ii", label: "any blorps", nouns: ["blorp"] },
          { n: 3, marker: "iii", label: "any combination of 2", any: 2 },
        ],
      },
      broad: {
        cite: "ZZ p.2",
        options: [
          { n: 1, marker: "i", label: "any tiny or small melee weapons", melee: true, sizes: ["tiny", "small"] },
          { n: 2, marker: "ii", label: "all missile weapons", missile: true },
        ],
      },
      martial: {
        cite: "ZZ p.1",
        options: [
          { n: 1, marker: "1", label: "quuxes", nouns: ["quux"] },
          { n: 2, marker: "2", label: "zorks and blorps", nouns: ["zork", "blorp"] },
        ],
      },
    },
  },
};
const layer = { priority: PRIORITY.WORLD, source: "test" };
const before = registerWeaponSource(librarySource);

eq("nothing imported, no unit, no shortcut and nothing to report", [weaponUnits().length, shortcuts(), optionFindings()], [0, [], { unplaced: [], notWhole: [] }]);
eq("with no list the surface says not imported and draws no row", trainingShortcuts({ effects: [] }), { imported: false, rows: [] });

registerTable({ id: WEAPONS_DOC, tables: { [WEAPONS_TABLE]: GRID } }, layer);
eq("a grid with no lists has units and still no shortcut", [weaponUnits().length, shortcuts()], [12, []]);
registerTable(LISTS, layer);

// ----------------------------------------------------------------- placement
const cat = (k) => weaponRow(k).cat;
eq("a row neither name nor sub-header places takes its sub-header mates' kind", [cat("gnarl"), cat("quuxa")], ["other", "other"]);
eq("a row with no sub-header and no name stays unplaced", [cat("stray"), weaponRow("stray").options], [null, []]);
eq("a row placed on a category no option names holds no option", [cat("klonka"), weaponRow("klonka").options], ["crossbow", []]);

// ----------------------------------------------------------------- the shortcuts
eq(
  "one shortcut per group that holds weapons, restricted picks and combinations left out, in list order",
  shortcuts().map((s) => s.id),
  ["narrow.1", "narrow.2", "broad.1", "broad.2", "martial.1", "martial.2", "focus.zorks", "focus.quuxs"],
);
eq("the lists a row is drawn for are the pick lists and Weapon Focus", SHORTCUT_LISTS, ["narrow", "broad", "martial", "focus"]);
const unitsOf = (id) => shortcutUnits(id);
eq("a noun list holds the rows its noun places", unitsOf("narrow.1"), ["zorka", "zorkb", "zorkc"]);
eq("a size-and-use predicate holds the rows that satisfy it", [unitsOf("broad.1"), unitsOf("broad.2")], [["gnarl", "quuxa", "quuxb", "zorka"], ["blorpa", "blorpb", "klonkr"]]);
eq("an option holds a mates-placed row beside its named ones", unitsOf("martial.1"), ["gnarl", "quuxa", "quuxb", "quuxc"]);
eq("options overlap", [unitsOf("martial.2"), unitsOf("narrow.1").every((k) => unitsOf("martial.2").includes(k))], [["blorpa", "blorpb", "zorka", "zorkb", "zorkc"], true]);
eq("a Weapon Focus holds the rows filed under it", [unitsOf("focus.zorks"), unitsOf("focus.quuxs")], [["zorka", "zorkb", "zorkc"], ["gnarl", "quuxa", "quuxb", "quuxc"]]);
eq("a shortcut carries its printed words, marker and its list's page", shortcuts().slice(0, 1).concat(shortcuts().slice(-1)).map((s) => [s.label, s.marker, s.cite, s.kind]), [["any zorks", "i", "ZZ p.2", "nouns"], ["quux, gnarl", "", "", "focus"]]);
eq("an id no shortcut has holds nothing", [unitsOf("restricted.1"), unitsOf("narrow.3"), unitsOf("nope"), unitsOf(undefined)], [[], [], [], []]);
eq("the option reader answers a predicate's weapons too and a combination's none", [optionUnits("broad.2"), optionUnits("narrow.3")], [["blorpa", "blorpb", "klonkr"], []]);

// ----------------------------------------------------------------- coverage and presses
const keys = (csv) => coveredUnits(csv.split(",").filter(Boolean)).units;
eq("coverage is all, some or none of the set", [coverageOf(["zorka", "zorkb"], keys("axe")), coverageOf(["zorka", "blorpa"], keys("axe")), coverageOf(["blorpa"], keys("axe")), coverageOf([], keys("axe"))], ["all", "some", "none", "none"]);
eq("a press on an empty grant adds the units, written as the category they complete", toggledUnits("", unitsOf("narrow.1")), "axe");
eq("pressed again it withdraws them", toggledUnits("axe", unitsOf("narrow.1")), "");
eq("a partly covered set completes on a press and withdraws when forced off", [toggledUnits("zorka", unitsOf("narrow.1")), toggledUnits("axe", unitsOf("narrow.1"), false)], ["axe", ""]);
eq("overlapping shortcuts write the one grant", toggledUnits(toggledUnits("", unitsOf("narrow.1")), unitsOf("martial.2")), "axe,bow");
eq("withdrawing one overlap leaves the weapons the other still holds", toggledUnits("axe,bow", unitsOf("narrow.2")), "axe");
eq("a size clause a shortcut takes a weapon from is rewritten into what remains", toggledUnits("melee:small", unitsOf("narrow.1"), false), "gnarl,quuxb");
eq("a clause the withdrawal does not touch stands", toggledUnits("melee:tiny,melee:small", unitsOf("narrow.1"), false), "melee:tiny,gnarl,quuxb");
eq("a token nothing recognises rides through a press", toggledUnits("pointy stick", unitsOf("narrow.1")), "axe,pointy stick");
eq("a set holding no unit writes nothing", [toggledUnits("axe", []), toggledUnits("axe", ["nope"])], [null, null]);

eq("a saved `other` ticks its members, mates-placed ones too", [...keys("other")].sort(), ["gnarl", "quuxa", "quuxb", "quuxc"]);
eq("and writes back as the same set, whatever spelling the canonical form gives it", [...coveredUnits(canonicalGrant(keys("other")).split(",")).units].sort(), ["gnarl", "quuxa", "quuxb", "quuxc"]);
eq("the option that holds exactly those weapons reads as covered whole", coverageOf(unitsOf("martial.1"), keys("other")), "all");
eq("a press that takes one member out rewrites the category into its remainder", toggledUnits("other", ["quuxa"], false), "gnarl,quuxb,quuxc");

// ----------------------------------------------------------------- findings
eq(
  "the weapons no option holds and the categories no option holds whole are reported",
  optionFindings(),
  { unplaced: ["klonka", "stray"], notWhole: ["crossbow"] },
);

// ----------------------------------------------------------------- the surface
const trained = (grant, extra = {}) => ({
  effects: [{ name: "Class Training", disabled: false, changes: [{ key: "flags.acks-extras.weaponProf", type: "add", value: grant, priority: 20 }], getFlag: (_m, k) => (k === FLAG_FROM_CLASS ? "Item.class1" : undefined) }],
  getFlag: () => undefined,
  ...extra,
});
{
  const shown = trainingShortcuts(trained("axe,gnarl"));
  eq("one row per list that holds a group, in list order, each captioned by its list", shown.rows.map((r) => [r.key, r.buttons.length]), [["narrow", 2], ["broad", 2], ["martial", 2], ["focus", 2]]);
  check("an imported list is not reported missing", shown.imported === true);
  const by = (id) => shown.rows.flatMap((r) => r.buttons).find((b) => b.id === id);
  eq("a button shows how much of its weapons the class grant covers", [by("narrow.1").state, by("narrow.2").state, by("martial.1").state].map(String), ["all", "none", "some"]);
  eq("its face carries the state, the count and the pressed state", [by("narrow.1").on, by("martial.1").partial, by("martial.1").count, by("narrow.1").pressed, by("martial.1").pressed, by("narrow.2").pressed], [true, true, "1/4", "true", "mixed", "false"]);
  check("its label is the printed words and its aria-label names the state and the count", by("narrow.1").label === "any zorks" && /stats\.shortcutAria\|.*any zorks.*"held":3,"total":3/.test(by("narrow.1").aria));
  check("its tooltip names the list, the marker, the page and the count", /stats\.shortcutTip\|/.test(by("martial.1").tip) && /optionList\.martial\|\{\} 1/.test(by("martial.1").tip) && /ZZ p\.1/.test(by("martial.1").tip) && /"held":1,"total":4/.test(by("martial.1").tip));
  check("a Weapon Focus names the page of the focus table and has no marker", /ZZ p\.3/.test(by("focus.zorks").tip) && !/focus [0-9]/.test(by("focus.zorks").tip));
  const twoEffects = trained("axe");
  twoEffects.effects.push({ ...trained("other").effects[0], name: "Path Training" });
  const faceOf = (a, id) => trainingShortcuts(a).rows.flatMap((r) => r.buttons).find((b) => b.id === id).state;
  eq("the face reads the grant a press rewrites, the first effect carrying one, and no other", [faceOf(twoEffects, "narrow.1"), faceOf(twoEffects, "martial.1")], ["all", "none"]);
  check("a group no weapon is placed on is marked empty, so the surface disables it and says why", (() => {
    registerTable({ id: "weaponLists", tables: { options: { narrow: { cite: "ZZ p.2", options: [{ n: 9, marker: "ix", label: "any flibs", nouns: ["flib"] }] } } } }, { priority: PRIORITY.OVERRIDE });
    const empty = trainingShortcuts(trained("")).rows.flatMap((r) => r.buttons).find((b) => b.id === "narrow.9");
    unregisterTable("weaponLists", { priority: PRIORITY.OVERRIDE });
    return empty.empty === true && /stats\.shortcutTipEmpty\|/.test(empty.tip) && empty.count === "0/0";
  })());
  registerTable({ id: "weaponLists", tables: { options: LISTS.tables.options } }, { priority: PRIORITY.OVERRIDE });
  check("a Judge's override has no page and the tooltip says it was set by the Judge", /stats\.optionWhereJudge\|/.test(trainingShortcuts(trained("")).rows[0].buttons[0].tip) && !/ZZ p\.2/.test(trainingShortcuts(trained("")).rows[0].buttons[0].tip));
  unregisterTable("weaponLists", { priority: PRIORITY.OVERRIDE });
}

{
  const tip = (token, ...members) => categoryTip({ token }, "Label", members.map((k) => ({ key: k })));
  const axes = tip("axe", "zorka", "zorkb", "zorkc");
  check("a category header names the printed options that hold its weapons, each with its page", /stats\.optionsHolding\|/.test(axes) && /any zorks/.test(axes) && /zorks and blorps/.test(axes) && /ZZ p\.2/.test(axes) && /ZZ p\.1/.test(axes));
  check("and a size-and-use option one of its weapons satisfies", /any tiny or small melee weapons/.test(axes));
  check("and not the restricted list's single picks", !/label\W+gnarl/.test(tip("other", "quuxa", "quuxb", "gnarl")) && /label\W+quuxes/.test(tip("other", "quuxa", "quuxb", "gnarl")));
  const crossbows = tip("crossbow", "klonka");
  check("a category no option holds says so, and that no one option holds it whole", /stats\.optionsNoneHold/.test(crossbows) && /stats\.optionsNotWhole/.test(crossbows));
  check("and says how many of its weapons are in no option", /stats\.optionsLoose\|\{"count":1\}/.test(crossbows));
  check("a category some option holds whole carries neither finding", !/optionsNotWhole|optionsLoose/.test(axes));
  unregisterTable(WEAPONS_DOC, { priority: PRIORITY.WORLD });
  unregisterTable("weaponLists", { priority: PRIORITY.WORLD });
  check("with no option imported the header says so and names none", /stats\.optionsNotImported/.test(tip("axe", "zorka")) && !/optionsHolding/.test(tip("axe", "zorka")));
}

// ----------------------------------------------------------------- the press
registerTable({ id: WEAPONS_DOC, tables: { [WEAPONS_TABLE]: GRID } }, layer);
registerTable(LISTS, layer);
{
  const effect = {
    name: "Class Training",
    changes: [{ key: "flags.acks-extras.weaponProf", type: "add", value: "melee:small", priority: 20 }],
    getFlag: (_m, k) => (k === FLAG_FROM_CLASS ? "Item.class1" : undefined),
    async update(data) {
      Object.assign(effect, data);
      return effect;
    },
  };
  const actor = { type: "character", items: [], effects: [effect], getFlag: () => undefined };
  const grant = () => effect.changes.find((c) => c.key === "flags.acks-extras.weaponProf")?.value ?? "";
  check("a press writes the grant canonically through the effect", (await toggleTrainingShortcut(actor, "narrow.1", { on: false })) === true && grant() === "gnarl,quuxb");
  await toggleTrainingShortcut(actor, "narrow.1");
  eq("a press that decides itself adds what is missing", grant(), "melee:small,axe");
  await toggleTrainingShortcut(actor, "narrow.1");
  eq("and withdraws it when everything is there", grant(), "gnarl,quuxb");
  eq("an id with no units writes nothing", [await toggleTrainingShortcut(actor, "restricted.1"), await toggleTrainingShortcut(actor, "nope"), grant()], [false, false, "gnarl,quuxb"]);
  const bare = { type: "character", items: [], effects: [], getFlag: () => undefined, async createEmbeddedDocuments() { return []; } };
  eq("with no training effect and none to create, nothing is written", await toggleTrainingShortcut(bare, "narrow.1"), false);
}

unregisterTable(WEAPONS_DOC, { priority: PRIORITY.WORLD });
unregisterTable("weaponLists", { priority: PRIORITY.WORLD });
registerWeaponSource(before);
resetTables();
check("everything withdrawn, no unit and no shortcut", weaponKeys().length === 0 && shortcuts().length === 0);

console.log(`test-weapon-shortcuts: ${pass} checks passed`);
