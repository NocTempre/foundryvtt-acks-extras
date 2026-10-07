/**
 * The merchandise catalogue: the label vocabulary, the binding of the
 * register's printed grids to items, the demand append, the catalogue's
 * merge order, and the migration action.
 *
 * Every figure and label in a grid below is invented: the tests prove the
 * binding reads the cells it is handed and maps names through the module's
 * own vocabulary, never that the book says anything in particular.
 *
 * Run: npm test
 */
import assert from "node:assert";
import fs from "node:fs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const {
  MERCHANDISE_KEYS,
  MERCHANDISE_ALIASES,
  DEMAND_COLUMN_KEYS,
  merchandiseKeyOf,
  merchandiseTierOf,
} = await import(new URL("../scripts/markets/merchandise-keys.mjs", import.meta.url));
const { parseGp, parseQuantity, parseDemand, parseBand, parseRacialGroups, planMerchandise, bindMerchandiseRow, planDemand, describeUnmapped } =
  await import(new URL("../scripts/importer/merchandise-binding.mjs", import.meta.url));
const { raceKeyOf, racialFromRows, listFromLine } = await import(new URL("../scripts/markets/merchandise-form.mjs", import.meta.url));

/* ------------------------- label vocabulary ------------------------- */

const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
check("the vocabulary carries one key per catalogue good", MERCHANDISE_KEYS.length === new Set(MERCHANDISE_KEYS.map((r) => r.key)).size);
for (const { key, tier } of MERCHANDISE_KEYS) {
  const label = lang[`ACKS-MARKETS.merch.${key}`];
  check(`${key}: has a label in the lang file`, typeof label === "string" && label.length > 0);
  check(`${key}: its own label maps back to it`, merchandiseKeyOf(label) === key);
  check(`${key}: its tier is one of the two`, tier === "common" || tier === "precious");
  check(`${key}: the tier lookup answers`, merchandiseTierOf(key) === tier);
}

// Spelling variants the tables and the prose print for the same good.
const VARIANTS = {
  "dye & pigment": "dyesPigments",
  "dyes & pigments": "dyesPigments",
  "Dyes and Pigments": "dyesPigments",
  "oil & sauce": "oilsSauces",
  "oils & sauces": "oilsSauces",
  "semipr. stones": "semipreciousStones",
  "semi-precious stones": "semipreciousStones",
  "Semiprecious stones*": "semipreciousStones",
  "Preserved meats": "preservedMeat",
  "Preserved meat": "preservedMeat",
  "common metals": "commonMetal",
  "beer/ale": "beerAle",
  "grain/vegetables": "grainVegetables",
  "armor/weapons": "armorWeapons",
  "armour & weapons": "armorWeapons",
  "porcelain": "finePorcelain",
  "rare books": "rareBooksArt",
  "rare woods": "rareWood",
  "common woods": "commonWood",
  "rare metals": "preciousMetals",
  "gems": "gems",
  "Gems†": "gems",
};
for (const [label, key] of Object.entries(VARIANTS)) check(`"${label}" maps to ${key}`, merchandiseKeyOf(label) === key);
check("an unknown good maps to nothing", merchandiseKeyOf("Furniture") === null);
check("an empty label maps to nothing", merchandiseKeyOf("  ") === null && merchandiseKeyOf(null) === null);
check("an alias never shadows a key's own pattern", MERCHANDISE_ALIASES.every((a) => !MERCHANDISE_KEYS.some((k) => new RegExp(k.labelRe, "i").test(a.labelRe.replace(/[\^?]/g, "")))));
check("the age and terrain columns make twenty", DEMAND_COLUMN_KEYS.length === 20);

/* ------------------------- cell parsers ------------------------- */

check("a gp price parses", parseGp("0.35gp") === 0.35);
check("a bare number is gp", parseGp("2,000") === 2000);
check("a silver price converts", parseGp("5sp") === 0.5);
check("coins add", parseGp("1gp, 25cp") === 1.25);
check("a footnote mark is ignored", parseGp("0.07gp*") === 0.07);
check("no figure is null", parseGp("—") === null && parseGp("") === null);
check("a quantity parses commas and decimals", parseQuantity("1,250") === 1250 && parseQuantity("0.4") === 0.4);
check("a dash is no quantity", parseQuantity("-") === null && parseQuantity("—") === null && parseQuantity("") === null);
check("text is no quantity", parseQuantity("n/a") === null);

check("a signed whole", parseDemand("+2").value === 2 && parseDemand("-2").value === -2);
check("a unicode minus", parseDemand("−1").value === -1);
check("a bare fraction", parseDemand("+1/2").value === 0.5 && parseDemand("-1/2").value === -0.5);
check("a mixed fraction", parseDemand("-1 1/2").value === -1.5 && parseDemand("+2 1/2").value === 2.5);
check("a vulgar half", parseDemand("+1½").value === 1.5);
check("zero is a value, not nothing", parseDemand("0").value === 0 && parseDemand("0").bad === false);
check("a dash or empty is nothing printed", parseDemand("-").value === null && parseDemand("").bad === false);
check("garbage is flagged", parseDemand("lots").bad === true);

check("a range band", JSON.stringify(parseBand("1 – 20")) === JSON.stringify({ min: 1, max: 20, special: false }));
check("a single number band", JSON.stringify(parseBand("92")) === JSON.stringify({ min: 92, max: 92, special: false }));
check("a starred single number", JSON.stringify(parseBand("* 100")) === JSON.stringify({ min: 100, max: 100, special: false }));
check("Special is a mark, not a range", JSON.stringify(parseBand("Special")) === JSON.stringify({ min: null, max: null, special: true }));
check("an unreadable band is null", parseBand("often") === null);

/* ------------------------- row binding ------------------------- */

const cells = (o) => o;
const grids = {
  common: {
    rows: [
      {
        key: "a",
        label: "grain & vegetables*",
        cells: cells({ container: "sack*", pricePerStone: "0.35gp", priceStep: "0.02gp*", c1: "1,200", c2: "300", c3: "0.5", c6: "0.01" }),
      },
      { key: "b", label: "oil & sauce", cells: cells({ container: "jar", pricePerStone: "1.5gp", priceStep: "0.1gp", c1: "40" }) },
      { key: "c", label: "Mystery cargo", cells: cells({ container: "crate", pricePerStone: "9gp", priceStep: "1gp" }) },
      { key: "d", label: "Oils", cells: cells({ container: "jar", pricePerStone: "3gp", priceStep: "0.3gp" }) },
    ],
  },
  precious: {
    rows: [
      { key: "e", label: "semipr. stones", cells: cells({ container: "pouch", pricePerStone: "80gp", priceStep: "5gp", c1: "2", c2: "1" }) },
      { key: "f", label: "Gems", cells: cells({ container: "pouch", pricePerStone: "900gp", priceStep: "40gp" }) },
    ],
  },
  randomCommon: {
    rows: [
      { label: "Grain/vegetables", cells: { band: "1 – 20" } },
      { label: "Oil & sauce", cells: { band: "21" } },
      { label: "Unlisted wares", cells: { band: "22 – 30" } },
    ],
  },
  randomPrecious: {
    rows: [
      { label: "Semi-precious stones", cells: { band: "* 100" } },
      { label: "Gems", cells: { band: "Special" } },
    ],
  },
};
const plan = planMerchandise(grids);
const byKey = Object.fromEntries(plan.rows.map((r) => [r.key, r]));
check("four goods bind", plan.rows.length === 4 && ["grainVegetables", "oilsSauces", "semipreciousStones", "gems"].every((k) => k in byKey));
check("the footnote is off the name", byKey.grainVegetables.label === "Grain & vegetables");
check("the tier is the grid's", byKey.grainVegetables.tier === "common" && byKey.gems.tier === "precious");
check("a label with no key is reported", plan.unmapped.some((u) => u.where === "common" && u.label === "Mystery cargo"));
check("a second row of one key is reported, not merged", plan.unmapped.some((u) => u.label === "Oils" && /duplicate/.test(u.reason)));
check("a random row with no good is reported", plan.unmapped.some((u) => u.where === "randomCommon" && u.label === "Unlisted wares"));

const entry = { book: "rr", cite: "RR 1, 2", pages: [7, 8], icon: "icons/x.webp" };
const grain = bindMerchandiseRow(byKey.grainVegetables, entry, "def.merchandise.table");
check("it is an item of the merchandise sub-type", grain.type === "acks-extras.merchandise");
check("the claim is per good", grain.flags["acks-extras"].cookbook.id === "def.merchandise.table.grainVegetables");
check("the key rides on the system", grain.system.key === "grainVegetables");
check("prices parse", grain.system.pricePerStoneGp === 0.35 && grain.system.priceStepGp === 0.02);
check("the container footnote is stripped", grain.system.container === "sack");
check(
  "daily stones read c1..c6, absent cells null",
  JSON.stringify(grain.system.dailyStones) === JSON.stringify([1200, 300, 0.5, null, null, 0.01]),
);
check("a range band lands as min and max", grain.system.random.table === "common" && grain.system.random.min === 1 && grain.system.random.max === 20 && grain.system.random.special === false);
check("the staple carries the tariff and season marks", grain.system.tariffExempt === true && grain.system.seasonalPrice === true);
check("the source names the book and cite", grain.system.source.book === "rr" && grain.system.source.page === "RR 1, 2");
check("the description is the stamped citation", /RR 1, 2/.test(grain.system.description));
check("the entry's icon is the item's", grain.img === "icons/x.webp");

const oil = bindMerchandiseRow(byKey.oilsSauces, entry, "def.merchandise.table");
check("no other good carries the marks", !("tariffExempt" in oil.system) && !("seasonalPrice" in oil.system));
check("a single-number band is min=max", oil.system.random.min === 21 && oil.system.random.max === 21);
const stones = bindMerchandiseRow(byKey.semipreciousStones, entry, "def.merchandise.table");
check("a starred single number is min=max on the precious table", stones.system.random.table === "precious" && stones.system.random.min === 100 && stones.system.random.max === 100);
const gems = bindMerchandiseRow(byKey.gems, entry, "def.merchandise.table");
check("Special sets the mark and no range", gems.system.random.special === true && gems.system.random.min === null && gems.system.random.max === null);
check("an unread price stays null", gems.system.pricePerStoneGp === 900 && gems.system.dailyStones.every((n) => n === null));
const bare = bindMerchandiseRow({ key: "salt", tier: "common", label: "Salt", cells: {}, random: null }, entry, "def.merchandise.table");
check("a bare row invents nothing", bare.system.pricePerStoneGp === null && bare.system.priceStepGp === null && !("random" in bare.system) && !("container" in bare.system));

/* ------------------------- demand append ------------------------- */

const demandGrids = {
  environment: {
    header: { age1: "Young", age2: "Old" },
    rows: [
      { key: "x", label: "grain/vegetables", cells: { age1: "+1/2", age2: "-1 1/2", age3: "0", age4: "+2", seaCoast: "−1", desert: "junk" } },
      { key: "y", label: "dyes & pigments", cells: { age1: "+1" } },
      { key: "z", label: "Unicorn hair", cells: { age1: "+3" } },
    ],
  },
  racial: {
    rows: [
      {
        key: "dwarf",
        label: "Dwarf",
        cells: { text: "-2demand Modifier to beer/ale, common metals, and gems +2demand Modifier to common wood, rare books and art, and zeppelins" },
      },
      { key: "elf", label: "Elf", cells: { text: "Nothing of note is priced here" } },
      { key: "gnome", label: "Gnome", cells: { text: "House rules. -1 demand modifier to salt" } },
    ],
  },
};
const demand = planDemand(demandGrids);
const grainDemand = demand.byKey.get("grainVegetables");
check("environment cells parse per column", grainDemand.environment.age1 === 0.5 && grainDemand.environment.age2 === -1.5 && grainDemand.environment.age3 === 0 && grainDemand.environment.age4 === 2);
check("a unicode minus reads", grainDemand.environment.seaCoast === -1);
check("an unreadable cell is left out and reported", !("desert" in grainDemand.environment) && demand.unmapped.some((u) => /grain/i.test(u.label) && /desert/.test(u.label)));
check("a label with no good is reported", demand.unmapped.some((u) => u.where === "environment" && u.label === "Unicorn hair"));
check("the age headers come back as printed", demand.ageHeaders.age1 === "Young" && demand.ageHeaders.age2 === "Old" && !("age3" in demand.ageHeaders));
check("dyes map through the plural-free label", demand.byKey.get("dyesPigments").environment.age1 === 1);
const dwarf = (key) => demand.byKey.get(key)?.racial?.dwarf;
check("the first group applies to every good it lists", dwarf("beerAle") === -2 && dwarf("commonMetal") === -2 && dwarf("gems") === -2);
check("the second group's amount stands apart", dwarf("commonWood") === 2 && dwarf("rareBooksArt") === 2);
check("a named good with no key is reported", demand.unmapped.some((u) => u.where === "racial:dwarf" && /zeppelins/i.test(u.label)));
check("a racial cell with no modifier is reported whole", demand.unmapped.some((u) => u.where === "racial:elf" && /no modifier/.test(u.reason)));
check("text ahead of the first modifier is reported, the modifier still applies", demand.unmapped.some((u) => u.where === "racial:gnome" && /ahead/.test(u.reason)) && demand.byKey.get("salt").racial.gnome === -1);
check("every report line names its grid", describeUnmapped(demand.unmapped).every((l) => /^[a-z]+(:[a-z]+)?: /.test(l)));

const groups = parseRacialGroups("+1/2demand Modifier to salt, and silk -1 1/2demand Modifier to spices");
check("fractional amounts head groups", groups.groups.length === 2 && groups.groups[0].amount === 0.5 && groups.groups[1].amount === -1.5);
check("a closing and is not a good", groups.groups[0].goods.join("|") === "salt|silk");

/* ------------------------- sheet form helpers ------------------------- */

check("a race key is safe as an object key", raceKeyOf(" Half. Elf ") === "halfelf");
check("rows rebuild the racial object", JSON.stringify(racialFromRows({ 0: { race: "Dwarf", value: "-2" }, 1: { race: "elf", value: "1.5" } })) === JSON.stringify({ dwarf: -2, elf: 1.5 }));
check("a row without a number or a name is left out", Object.keys(racialFromRows([{ race: "", value: 1 }, { race: "orc", value: "" }])).length === 0);
check("a race named twice keeps the last row", racialFromRows([{ race: "elf", value: 1 }, { race: "Elf", value: 3 }]).elf === 3);
check("a comma line becomes a list", JSON.stringify(listFromLine(" a, b ,, c")) === JSON.stringify(["a", "b", "c"]));

/* ------------------------- data model schema ------------------------- */

{
  class Field {
    constructor(options = {}) {
      this.options = options;
    }
  }
  class SchemaField extends Field {
    constructor(fields, options) {
      super(options);
      this.fields = fields;
    }
  }
  class ArrayField extends Field {
    constructor(element, options) {
      super(options);
      this.element = element;
    }
  }
  globalThis.foundry = {
    abstract: { TypeDataModel: class {} },
    data: { fields: { StringField: Field, NumberField: Field, BooleanField: Field, HTMLField: Field, ObjectField: Field, SchemaField, ArrayField } },
  };
  const { default: MerchandiseData } = await import(new URL("../scripts/markets/data/merchandise-data.mjs", import.meta.url));
  const schema = MerchandiseData.defineSchema();
  const wanted = ["key", "tier", "container", "pricePerStoneGp", "priceStepGp", "dailyStones", "environment", "racial", "random", "tariffExempt", "seasonalPrice", "lootKinds", "itemCategories", "aliases", "description", "source"];
  check("the schema carries every documented field", wanted.every((k) => k in schema));
  check("the environment holds one nullable figure per demand column", DEMAND_COLUMN_KEYS.every((c) => schema.environment.fields[c]?.options?.nullable === true && schema.environment.fields[c].options.initial === null));
  const initial = schema.dailyStones.options.initial();
  check("daily stones start as six unread figures", initial.length === 6 && initial.every((n) => n === null));
  check("an unread price starts null, never zero", schema.pricePerStoneGp.options.initial === null && schema.priceStepGp.options.initial === null);
  check("the random band starts absent", schema.random.fields.table.options.initial === "" && schema.random.fields.special.options.initial === false);
  delete globalThis.foundry;
}

/* ------------------------- the sheet's racial writes ------------------------- */

{
  // The sheet reads its base classes when it is imported and builds core's
  // operators when it writes; stand-ins for both are enough to press an action
  // and to process a submit on a fake sheet. The base sheet's own
  // `_processFormData` expands the form; this one hands back what it is given.
  class ForcedDeletion {}
  class ForcedReplacement {
    constructor(value) {
      this.value = value;
    }
    static create(value) {
      return new ForcedReplacement(value);
    }
  }
  class ItemSheetV2 {
    _processFormData(event, form, formData) {
      return structuredClone(formData);
    }
  }
  globalThis.foundry = {
    applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {} }, sheets: { ItemSheetV2 } },
    data: { operators: { ForcedDeletion, ForcedReplacement } },
  };
  const { default: MerchandiseSheet } = await import(new URL("../scripts/markets/apps/merchandise-sheet.mjs", import.meta.url));
  const steps = [];
  const sheet = { submit: async () => steps.push("submit"), item: { update: async (data) => steps.push(data) } };
  const press = (race) => MerchandiseSheet.DEFAULT_OPTIONS.actions.racialDelete.call(sheet, {}, { dataset: { race } });
  const keys = (object) => JSON.stringify(Object.keys(object ?? {}));

  await press(" Half. Elf ");
  check("a row delete submits the form, then writes once", steps.length === 2 && steps[0] === "submit");
  const write = steps[1];
  check("the write names the row's key nested under system.racial and nothing else", keys(write) === '["system"]' && keys(write.system) === '["racial"]' && keys(write.system.racial) === '["halfelf"]');
  check("the key's value is the deletion operator, never a stored null", write.system.racial.halfelf instanceof ForcedDeletion);

  steps.length = 0;
  await press(" . ");
  check("a row with no usable key neither submits nor writes", steps.length === 0);

  const submit = (form) => MerchandiseSheet.prototype._processFormData.call({}, null, null, form);
  const sent = submit({
    system: { aliases: "ale,  beer , " },
    racialRows: { 0: { race: " Half. Elf ", value: "1.5" }, 1: { race: "", value: "2" }, 2: { race: "dwarf", value: "" } },
  });
  check("a submit writes the racial rows as one forced replacement, under no other key", sent.system.racial instanceof ForcedReplacement && keys(sent.system) === '["aliases","racial"]' && keys(sent) === '["system"]');
  check("the replacement holds what the rows stand for, less a row with no race or no number", JSON.stringify(sent.system.racial.value) === '{"halfelf":1.5}');
  check("a comma-separated line comes back as a list", JSON.stringify(sent.system.aliases) === '["ale","beer"]');
  check("a form with no racial rows writes no racial key", keys(submit({ system: { key: "ale" } }).system) === '["key"]');
  delete globalThis.foundry;
}

/* ------------------------- the catalogue ------------------------- */

/** A Collection-like list: iterable and filterable, with NO flatMap, as Foundry's collections are. */
class FakeCollection {
  constructor(docs) {
    this.docs = docs;
  }
  [Symbol.iterator]() {
    return this.docs[Symbol.iterator]();
  }
  filter(fn) {
    return this.docs.filter(fn);
  }
  get size() {
    return this.docs.length;
  }
}

const item = (key, name, system = {}, extra = {}) => ({
  type: "acks-extras.merchandise",
  name,
  uuid: `Item.${name}`,
  system: { key, tier: "common", pricePerStoneGp: 1, priceStepGp: 0.1, dailyStones: [1, 2, 3, 4, 5, 6], ...system },
  ...extra,
});

const tableRows = [
  { type: "grainVegetables", container: "sack", pricePerStone: 1, priceStep: 0.1, byMarketClass: ["10", "-", "5", "4", "3", "2"], tier: "common" },
  { type: "salt", container: "bag", pricePerStone: 2, priceStep: 0.2, byMarketClass: ["1", "1", "1", "1", "1", "1"], tier: "common" },
  { type: "beerAle", container: "keg", pricePerStone: 3, priceStep: 0.3, byMarketClass: [], tier: "common" },
  { type: "gems", __missing: true },
];

let packFetches = 0;
const worldItems = [];
const packDocs = new Map([
  ["c1", item("grainVegetables", "Compendium grain", { pricePerStoneGp: 20 })],
  ["c2", item("salt", "Compendium salt", { pricePerStoneGp: 21 })],
  ["c3", item("ivory", "Compendium ivory", { tier: "precious" })],
]);
const pack = {
  documentName: "Item",
  collection: "world.cookbook-items",
  index: new FakeCollection([
    { _id: "c1", type: "acks-extras.merchandise" },
    { _id: "c2", type: "acks-extras.merchandise" },
    { _id: "c3", type: "acks-extras.merchandise" },
    { _id: "n1", type: "acks-extras.variation" },
    { _id: "n2", type: "weapon" },
  ]),
  async getDocument(id) {
    packFetches++;
    return packDocs.get(id);
  },
};
const otherPack = { documentName: "Actor", collection: "world.actors", index: new FakeCollection([]), async getDocument() { throw new Error("read an Actor pack"); } };

const created = [];
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  items: new FakeCollection(worldItems),
  packs: new FakeCollection([pack, otherPack]),
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
globalThis.CONFIG = { Item: { dataModels: { "acks-extras.merchandise": class {} } } };
globalThis.Item = {
  async create(data) {
    const doc = { ...data, uuid: `Item.new${created.length}` };
    created.push(doc);
    worldItems.push(doc);
    return doc;
  },
};
let legacy = { rows: tableRows };
globalThis.acksExtras = { lib: { tables: { hasDoc: () => true, getTable: () => legacy } } };

const engine = await import(new URL("../scripts/markets/engine/merchandise.mjs", import.meta.url));
const { merchandiseCatalog, merchandiseFor, primeMerchandiseCatalog, invalidateMerchandiseCatalog, buildMerchandiseFromTables } = engine;

// Table only: the legacy rows answer, the placeholder row is dropped.
let rows = merchandiseCatalog();
check("the table alone yields its readable rows", rows.map((r) => r.key).join() === "grainVegetables,salt,beerAle");
check("a table row is marked as such", rows.every((r) => r.source === "table"));
check("a table row's stones parse, a dash is unread", JSON.stringify(rows[0].dailyStones) === JSON.stringify([10, null, 5, 4, 3, 2]));
check("the staple's marks come from procedure on the table path too", rows[0].tariffExempt === true && rows[1].tariffExempt === false);
check("the table label is the module's own lang key", rows[1].label === "ACKS-MARKETS.merch.salt");
check("the catalogue is cached until something changes", merchandiseCatalog() === rows);

// Compendium over table.
const loaded = await primeMerchandiseCatalog();
check("only merchandise items are read from a pack", loaded === 3 && packFetches === 3);
rows = merchandiseCatalog();
const grainRow = merchandiseFor("grainVegetables");
check("a compendium item beats the table for its key", grainRow.source === "compendium" && grainRow.pricePerStoneGp === 20);
check("a table-only good keeps its table row", merchandiseFor("beerAle").source === "table");
check("a compendium-only good joins", merchandiseFor("ivory").source === "compendium" && merchandiseFor("ivory").tier === "precious");
check("an unknown key answers null", merchandiseFor("nothing") === null);

// World over compendium.
worldItems.push(item("grainVegetables", "World grain", { pricePerStoneGp: 300 }));
worldItems.push(item("", "Half-typed good"));
worldItems.push({ type: "weapon", name: "Sword", system: { key: "salt" } });
invalidateMerchandiseCatalog();
rows = merchandiseCatalog();
const winner = merchandiseFor("grainVegetables");
check("a world item beats a compendium item of the same key", winner.source === "world" && winner.pricePerStoneGp === 300 && winner.label === "World grain");
check("the compendium's other goods still stand", merchandiseFor("salt").source === "compendium");
check("a blank key is ignored", !rows.some((r) => r.label === "Half-typed good"));
check("a foreign item type is ignored even with a matching key", merchandiseFor("salt").label === "Compendium salt");
check("one row per key", new Set(rows.map((r) => r.key)).size === rows.length);
check("rows come in the vocabulary's order", rows.findIndex((r) => r.key === "grainVegetables") < rows.findIndex((r) => r.key === "salt") && rows.findIndex((r) => r.key === "salt") < rows.findIndex((r) => r.key === "beerAle"));
check("a row carries a full environment and six stones", Object.keys(winner.environment).length === 20 && winner.dailyStones.length === 6);
check("a row carries its uuid", winner.uuid === "Item.World grain");

// A changed table re-merges without an explicit invalidation.
legacy = { rows: [...tableRows, { type: "silk", container: "bolt", pricePerStone: 9, priceStep: 1, byMarketClass: [], tier: "precious" }] };
check("a re-read table shows up", merchandiseFor("silk")?.source === "table");

// Migration: idempotent by key.
worldItems.length = 0;
worldItems.push(item("salt", "Existing salt"));
invalidateMerchandiseCatalog({ pack: true });
const first = await buildMerchandiseFromTables();
check("the migration skips a key an item already answers for", first.skipped.includes("salt") && !first.made.includes("salt"));
check("the migration makes the goods no item stands for", first.made.slice().sort().join() === "beerAle,silk");
check("a compendium good is skipped too", first.skipped.includes("grainVegetables"));
check("a compendium good is not remade as a world item", !first.made.includes("ivory"));
const madeBeer = created.find((d) => d.system.key === "beerAle");
check("a made item carries the table's figures", madeBeer.system.pricePerStoneGp === 3 && madeBeer.system.container === "keg" && madeBeer.type === "acks-extras.merchandise");
const second = await buildMerchandiseFromTables();
check("a second run makes nothing", second.made.length === 0);
check("the made goods are now world goods", merchandiseFor("beerAle").source === "world");

globalThis.game.user.isGM = false;
const denied = await buildMerchandiseFromTables();
check("a player cannot build them", denied.made.length === 0);

console.log(`test-merchandise: OK (${pass} checks)`);
