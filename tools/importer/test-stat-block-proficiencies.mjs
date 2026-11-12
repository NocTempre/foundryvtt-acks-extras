/**
 * What an ability item minted for a stat block's proficiency says it is.
 *
 * A name the definitions carry resolves to the library's item or to the
 * definition built as `bindAbility` builds it, so the minted copy holds the
 * definition's own extras, category included. A name nothing resolves is minted
 * as a namesake whose category is BLANK, which every reader answers as unknown.
 * It is never the proficiency a missing category used to read as.
 *
 * Foundry-free and book-free: every name and definition below is invented.
 * Run: node tools/importer/test-stat-block-proficiencies.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { bindMonster, bindProficiency, loadCookbook, proficiencyPools, proficiencyResolver } from "../../scripts/importer/cookbook.mjs";
import { mapPairs, namesakeAbility } from "../../scripts/importer/stats-map.mjs";

let pass = 0;
const check = (label, fn) => {
  try {
    fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${label}`);
    throw err;
  }
};

const MODULE = "acks-extras";
const SCHEMA = "acks-cookbook/2";
const entry = (kind, name, category, extra = {}) => ({ kind, name, cite: "ZZ 1", pages: [1], book: "zz", fields: {}, meta: { category, general: kind === "kind.proficiency" }, ...extra });

const CONTENT = {
  proficiencies: {
    schema: SCHEMA,
    entries: {
      "def.prof.inventedStyle": entry("kind.proficiency", "Invented Style", "fightingStyle"),
      "def.prof.inventedHeld": entry("kind.proficiency", "Invented Held", "armorProficiency"),
    },
  },
  powers: {
    schema: SCHEMA,
    entries: { "def.power.inventedKnack": entry("kind.power", "Invented Knack", "classPower") },
  },
};
// A power the books print under another name than the definition's own.
const REGISTERS = { tables: { powerSource: { classZed: [{ name: "Printed Knack", ref: "def.power.inventedKnack" }] } } };

globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => {
      const name = String(url).split("/").pop().replace(/\.json$/, "");
      if (name === "registers") return REGISTERS;
      if (name === "index") return { books: [], content: Object.keys(CONTENT) };
      if (CONTENT[name]) return structuredClone(CONTENT[name]);
      throw new Error(`404 ${url}`);
    },
    deepClone: (x) => structuredClone(x),
  },
};

/** An ability item the library holds, as a document answers for it. */
const heldItem = (id, name, extras) => {
  const flags = { [MODULE]: { cookbook: { id }, extras } };
  return {
    name,
    type: "ability",
    flags,
    getFlag: (scope, key) => flags[scope]?.[key],
    toObject: () => structuredClone({ _id: "keepOut", folder: "keepOut", sort: 9, name, type: "ability", flags }),
  };
};
globalThis.game = {
  packs: [],
  actors: [],
  items: [heldItem("def.prof.inventedHeld", "Invented Held", { category: "armorProficiency", qty: 2 })],
};

assert.ok(await loadCookbook(), "the invented cookbooks load");

const extrasOf = (item) => item.flags?.[MODULE]?.extras;
const cookbookIdOf = (item) => item.flags?.[MODULE]?.cookbook?.id;

/** One stat block's proficiencies, bound as a monster import binds them. */
const bound = (...profs) => bindMonster({ fields: { stats: { proficiencies: profs } } }).items.filter((i) => i.type === "ability");

/* --- bindMonster: the three tiers ------------------------------------------------------ */

const [fromCookbook, fromLibrary, fromPrinted, unresolved] = bound(
  { text: "Invented Style", target: 6 },
  { text: "Invented Held" },
  { text: "Printed Knack" },
  { text: "Uninvented Craft" },
);

check("a name the cookbook carries is built with its definition's category", () => {
  assert.equal(cookbookIdOf(fromCookbook), "def.prof.inventedStyle");
  assert.equal(extrasOf(fromCookbook).category, "fightingStyle");
});

check("the creature's own throw rides the resolved item", () => {
  assert.equal(fromCookbook.system.rollTarget, 6);
  assert.equal(fromCookbook.system.roll, "1d20");
});

check("a name the library already holds is copied whole, extras included, and leaves its filing behind", () => {
  assert.equal(cookbookIdOf(fromLibrary), "def.prof.inventedHeld");
  assert.equal(extrasOf(fromLibrary).category, "armorProficiency");
  assert.equal(extrasOf(fromLibrary).qty, 2);
  for (const key of ["_id", "folder", "sort"]) assert.equal(key in fromLibrary, false, key);
});

check("a power's printed name resolves to the definition the register maps it to", () => {
  assert.equal(cookbookIdOf(fromPrinted), "def.power.inventedKnack");
  assert.equal(extrasOf(fromPrinted).category, "classPower");
});

check("a name nothing resolves is a namesake of blank category, with no definition behind it", () => {
  assert.equal(unresolved.name, "Uninvented Craft");
  assert.ok(extrasOf(unresolved), "the item says so in its own extras");
  assert.equal(extrasOf(unresolved).category, "");
  assert.equal(cookbookIdOf(unresolved), undefined);
});

check("an unresolved name never reads as a proficiency", () => {
  assert.notEqual(extrasOf(unresolved).category, "proficiency");
  assert.notEqual(extrasOf(unresolved).category, undefined, "a category left absent would take the model's default");
});

check("an authored ref wins over the name", () => {
  const [item] = bound({ text: "Uninvented Craft", ref: "def.prof.inventedStyle" });
  assert.equal(cookbookIdOf(item), "def.prof.inventedStyle");
  assert.equal(item.name, "Invented Style");
});

check("a creature that prints no proficiency mints none", () => {
  assert.deepEqual(bound(), []);
  assert.deepEqual(bound({ text: "None" }), []);
});

/* --- bindProficiency: the same answer from the shared function --------------------------- */

check("bindProficiency and bindMonster agree on a name", () => {
  const item = bindProficiency({ text: "Invented Style", target: 6 }, proficiencyPools());
  assert.deepEqual(item, fromCookbook);
});

/* --- mapPairs: the stat-block path of the first-pass importer ----------------------------- */

const pairs = [{ label: "Proficiencies", value: "Invented Style, Uninvented Craft" }];

check("without a resolver, every named proficiency is a blank-category namesake", () => {
  const abilities = mapPairs(pairs).items.filter((i) => i.type === "ability");
  assert.deepEqual(abilities.map((i) => i.name), ["Invented Style", "Uninvented Craft"]);
  for (const item of abilities) assert.equal(extrasOf(item).category, "");
  assert.deepEqual(abilities[1], namesakeAbility("Uninvented Craft"));
});

// The importer's resolver gives a name its definition and leaves the rest unknown.
{
  const resolve = await proficiencyResolver();
  const abilities = mapPairs(pairs, { proficiency: resolve }).items.filter((i) => i.type === "ability");
  check("a resolved name carries its definition's extras", () => {
    assert.equal(cookbookIdOf(abilities[0]), "def.prof.inventedStyle");
    assert.equal(extrasOf(abilities[0]).category, "fightingStyle");
  });
  check("an unresolved name stays a blank-category namesake", () => {
    assert.equal(extrasOf(abilities[1]).category, "");
    assert.equal(cookbookIdOf(abilities[1]), undefined);
  });
}

check("a block that prints no proficiency mints none", () => {
  assert.deepEqual(mapPairs([{ label: "Proficiencies", value: "None" }]).items, []);
});

/* --- the readers --------------------------------------------------------------------------- */

const { abilityContributions } = await import("../../scripts/lib/proficiency-strip.mjs");

check("the Training strip takes nothing from an unknown-category ability, whatever its name", () => {
  // The abilities API as the model answers it: the stored category, blank when none is.
  globalThis.acksExtras = {
    abilities: { selectionsOf: () => [], getExtras: (item) => ({ category: item.flags?.[MODULE]?.extras?.category ?? "" }) },
  };
  const actor = { items: [fromCookbook, fromLibrary, unresolved, { ...unresolved, name: "Invented Style", flags: {} }] };
  assert.deepEqual(abilityContributions(actor).map((c) => [c.name, c.category]), [["Invented Style", "fightingStyle"], ["Invented Held", "armorProficiency"]]);
});

/* --- the ability model and its sheet ------------------------------------------------------- */

// Only the schema's own defaults are read, so every field class is one recorder.
class Field {
  constructor(...args) {
    this.args = args;
    this.options = args[0] ?? {};
  }
}
globalThis.foundry.abstract = { DataModel: class {} };
globalThis.foundry.data = { fields: new Proxy({}, { get: () => Field }) };
const { default: AbilityExtras } = await import("../../scripts/abilities/ability-extras.mjs");

check("an ability with no stored category reads as unknown, not as a proficiency", () => {
  const field = AbilityExtras.defineSchema().category;
  assert.equal(field.options.initial, "", "the model's own default");
  assert.equal(field.options.blank, true, "a blank is a valid stored value");
  assert.ok(!Object.values(field.options.choices ?? {}).includes("unknown"), "blank is the unknown, not a vocabulary entry");
});

check("the sheet's category select offers the blank, so a save cannot stamp the first category", () => {
  const source = fs.readFileSync(new URL("../../templates/abilities/tab-mechanics.hbs", import.meta.url), "utf8");
  const select = /<select name="\{\{x\}\}\.category">([^]*?)<\/select>/.exec(source)?.[1] ?? "";
  assert.match(select, /selectOptions choices\.category[^}]*\bblank=/);
});

console.log(`test-stat-block-proficiencies: ${pass} passed`);
