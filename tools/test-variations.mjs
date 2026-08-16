/**
 * Base types and variations: what an item is, how it differs, what that is
 * worth, and who is allowed to know. Pure functions; no Foundry, no world.
 */
import assert from "node:assert/strict";
import {
  BASE_TYPE,
  baseTypeAllowed,
  baseTypeIsDeclared,
  baseTypeOf,
  baseTypesFor,
  documentBaseType,
} from "../scripts/equipment/base-types.mjs";
import {
  addRefusal,
  conditionalClaims,
  definitionFrom,
  entryOf,
  familyOf,
  isLegible,
  sumDeltas,
  totalPrice,
  values,
  visibleVariations,
} from "../scripts/equipment/variations.mjs";
import { FIELD_KIND, blankData, coerceData, coerceField, usableSpecs } from "../scripts/lib/field-spec.mjs";
import { inferBaseType } from "../scripts/equipment/base-type-infer.mjs";
import { contentsOf, siblingsOf } from "../scripts/lib/item-model.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

/** An item, as the flag readers see one. */
const item = (type, baseType) => ({
  type,
  flags: baseType ? { "acks-extras": { baseType } } : {},
});

/* -------------------------------------------- */
/*  Base types                                  */
/* -------------------------------------------- */

test("a declared base type wins", () => {
  assert.equal(baseTypeOf(item("item", BASE_TYPE.gem)), BASE_TYPE.gem);
});

test("an undeclared item falls back to what its document already is", () => {
  assert.equal(baseTypeOf(item("weapon")), BASE_TYPE.weapon);
  assert.equal(baseTypeOf(item("armor")), BASE_TYPE.armour);
  assert.equal(baseTypeOf(item("money")), BASE_TYPE.coin);
  assert.equal(baseTypeOf(item("item")), BASE_TYPE.gear);
});

test("name-pattern inference fills the gap for worlds that predate the flag", () => {
  // Dropping inference in the release that adds the flag would strip every
  // existing world's clothing of the slots it was granted by name.
  const infer = () => BASE_TYPE.clothing;
  assert.equal(baseTypeOf(item("item"), { infer }), BASE_TYPE.clothing);
});

test("a declared type beats the guess, which is the point of declaring", () => {
  const infer = () => BASE_TYPE.clothing;
  assert.equal(baseTypeOf(item("item", BASE_TYPE.gem), { infer }), BASE_TYPE.gem);
});

test("a base type its document cannot carry is refused, declared or guessed", () => {
  // Core reads AC off `armor` documents; a gem claiming to be armour would have
  // core computing from underneath it.
  assert.equal(baseTypeOf(item("weapon", BASE_TYPE.gem)), BASE_TYPE.weapon);
  assert.equal(baseTypeOf(item("weapon"), { infer: () => BASE_TYPE.food }), BASE_TYPE.weapon);
});

test("a picker offers only what the document can be", () => {
  assert.ok(baseTypesFor("item").includes(BASE_TYPE.gem));
  assert.ok(!baseTypesFor("item").includes(BASE_TYPE.weapon));
  assert.ok(baseTypesFor("armor").includes(BASE_TYPE.shield));
});

test("declared and inferred are distinguishable, so a migration can find the gaps", () => {
  assert.equal(baseTypeIsDeclared(item("item", BASE_TYPE.gem)), true);
  assert.equal(baseTypeIsDeclared(item("item")), false);
});

test("every base type has a document it is allowed on", () => {
  for (const t of Object.values(BASE_TYPE)) {
    assert.ok(["item", "weapon", "armor", "money"].some((d) => baseTypeAllowed(t, d)), `${t} fits nowhere`);
  }
});

test("gear is the floor: anything physical may be gear", () => {
  assert.equal(documentBaseType("item"), BASE_TYPE.gear);
  for (const d of ["item", "weapon", "armor"]) assert.equal(baseTypeAllowed(BASE_TYPE.gear, d), true);
});

/* -------------------------------------------- */
/*  The legacy guess, still standing in         */
/* -------------------------------------------- */

const named = (name, type, system = {}) => inferBaseType({ name, type, system });

test("the name guess reads the same tables the rest of the feature reads", () => {
  assert.equal(named("Backpack", "item"), BASE_TYPE.gear);
  assert.equal(named("Cloak", "item"), BASE_TYPE.clothing);
  assert.equal(named("Sword", "weapon"), BASE_TYPE.weapon);
});

test("a shield is told from a suit by core's own field, not by its name", () => {
  assert.equal(named("Shield", "armor", { type: "shield" }), BASE_TYPE.shield);
  assert.equal(named("Plate", "armor", { type: "heavy" }), BASE_TYPE.armour);
});

test("cloth sold by weight is goods, not a garment", () => {
  // The clothing table's first row exists to say exactly this.
  assert.equal(named("Linen (10 lb)", "item"), null);
});

test("a name nothing recognises guesses nothing, which is a real answer", () => {
  // The caller falls back to what the document is, and for gear that is right.
  assert.equal(named("Curious Rock", "item"), null);
  assert.equal(baseTypeOf({ type: "item", name: "Curious Rock", flags: {} }, { infer: inferBaseType }), BASE_TYPE.gear);
});

/* -------------------------------------------- */
/*  Conflicts                                   */
/* -------------------------------------------- */

const DEFS = {
  "masterwork.weaponToHit": { key: "masterwork.weaponToHit", appliesTo: ["weapon"], deltas: { bonus: 1 }, cost: { add: 80 } },
  "masterwork.armorAC": { key: "masterwork.armorAC", appliesTo: ["armour"], deltas: { ac: 1 }, cost: { add: 650 } },
  "condition.dented": { key: "condition.dented", deltas: { bonus: -1 }, cost: { mul: 0.5 } },
  "material.silver": { key: "material.silver", cost: { baseMul: 10 } },
  "form.buckler": { key: "form.buckler", appliesTo: ["shield"], deltas: { ac: 1 } },
  "gem.cut": { key: "gem.cut", appliesTo: ["gem"], deltas: {} },
  // The one printed cross-family rule: enchanting a weapon makes it masterwork.
  "magical.plusOne": { key: "magical.plusOne", supersedes: ["masterwork.*"], deltas: { bonus: 1 } },
};
const define = (k) => DEFS[k] ?? null;
const entry = (key, over = {}) => ({ id: key, key, data: {}, hidden: false, read: true, ...over });

test("the family is the key's namespace", () => {
  assert.equal(familyOf("masterwork.weaponToHit"), "masterwork");
  assert.equal(familyOf("material.silver"), "material");
});

test("two variants of the same thing clash, and the clash is named", () => {
  const refusal = addRefusal([entry("masterwork.weaponToHit")], DEFS["masterwork.armorAC"], { define });
  assert.equal(refusal.reason, "familyClash");
  assert.equal(refusal.key, "masterwork.weaponToHit");
});

test("a scavenged masterwork silvered buckler is entirely legal", () => {
  // Four families, four entries, no refusal at any step — the case the owner named.
  const entries = [];
  for (const key of ["masterwork.weaponToHit", "condition.dented", "material.silver", "form.buckler"]) {
    assert.equal(addRefusal(entries, DEFS[key], { define }), null, `${key} was refused`);
    entries.push(entry(key));
  }
  assert.equal(entries.length, 4);
});

test("a variation is refused on a base type it does not apply to", () => {
  const refusal = addRefusal([], DEFS["gem.cut"], { baseType: BASE_TYPE.weapon, define });
  assert.equal(refusal.reason, "wrongBaseType");
});

test("a definition with no appliesTo goes on anything", () => {
  assert.equal(addRefusal([], DEFS["material.silver"], { baseType: BASE_TYPE.gem, define }), null);
});

test("a printed cross-family rule is honoured in both directions", () => {
  // Magic supersedes masterwork, so neither order lets both sit on one blade.
  const addingMagic = addRefusal([entry("masterwork.weaponToHit")], DEFS["magical.plusOne"], { define });
  assert.equal(addingMagic.reason, "supersedes");
  const addingMasterwork = addRefusal([entry("magical.plusOne")], DEFS["masterwork.weaponToHit"], { define });
  assert.equal(addingMasterwork.reason, "superseded");
});

test("nothing else is refused — no invented interaction matrix", () => {
  // A poisoned gem is a Judge's business, not a table's.
  assert.equal(addRefusal([entry("gem.cut")], DEFS["magical.plusOne"], { baseType: BASE_TYPE.gem, define }), null);
});

/* -------------------------------------------- */
/*  A variation DOCUMENT reads as entry + definition */
/* -------------------------------------------- */

/** The shape a `acks-extras.variation` Item presents, without Foundry. */
const doc = (id, system) => ({ id, type: "acks-extras.variation", system });

test("a document splits into what it is and what is true of this one", () => {
  const v = doc("v1", {
    key: "masterwork.weaponToHit",
    appliesTo: ["weapon"],
    supersedes: [],
    deltas: { bonus: 1, damage: 0, ac: 0, weight6: 0 },
    cost: { baseMul: 1, add: 80, mul: 1 },
    hidden: true,
    read: false,
    data: { maker: "Thane" },
  });
  assert.deepEqual(entryOf(v), {
    id: "v1",
    key: "masterwork.weaponToHit",
    data: { maker: "Thane" },
    hidden: true,
    read: false,
  });
  const def = definitionFrom(v);
  assert.equal(def.key, "masterwork.weaponToHit");
  assert.deepEqual(def.appliesTo, ["weapon"]);
  assert.equal(def.cost.add, 80);
});

test("a document with no key is not a definition at all", () => {
  assert.equal(definitionFrom(doc("v2", { key: "" })), null);
  assert.equal(definitionFrom(undefined), null);
});

test("the rules read documents exactly as they read entries", () => {
  const applied = [
    doc("a", { key: "masterwork.weaponToHit", deltas: { bonus: 1 }, cost: { baseMul: 1, add: 80, mul: 1 } }),
    doc("b", { key: "material.silver", deltas: {}, cost: { baseMul: 10, add: 0, mul: 1 } }),
  ];
  const byKey = new Map(applied.map((v) => [v.system.key, definitionFrom(v)]));
  const d = sumDeltas(applied.map(entryOf), (k) => byKey.get(k) ?? null);
  assert.equal(d.bonus, 1);
  assert.equal(totalPrice(10, d), 180); // (10 x 10) + 80

  // And a second masterwork is refused against what the documents already say.
  const refusal = addRefusal(applied.map(entryOf), definitionFrom(doc("c", { key: "masterwork.both" })), {
    define: (k) => byKey.get(k) ?? null,
  });
  assert.equal(refusal.reason, "familyClash");
  assert.equal(refusal.key, "masterwork.weaponToHit");
});

/* -------------------------------------------- */
/*  What they add up to                         */
/* -------------------------------------------- */

test("deltas from several families sum", () => {
  const d = sumDeltas([entry("masterwork.weaponToHit"), entry("condition.dented")], define);
  assert.equal(d.bonus, 0); // +1 masterwork, -1 dent
});

test("the cost order is the rules': base scaled, surcharge added, whole scaled", () => {
  // A silvered masterwork sword, dented. Silver multiplies the WEAPON's price
  // and must not multiply the flat masterwork surcharge; the dent then takes a
  // fraction of the whole.
  const d = sumDeltas(
    [entry("material.silver"), entry("masterwork.weaponToHit"), entry("condition.dented")],
    define,
  );
  assert.equal(totalPrice(10, d), (10 * 10 + 80) * 0.5);
});

test("a variation may compute its contribution instead of declaring one", () => {
  // Named arms scale by the wielder's level, so there is no constant to hold.
  const named = {
    key: "named.heirloom",
    contribute: (e, ctx) => ({ bonus: Math.floor((ctx.level ?? 1) / 3), cost: { mul: 2 } }),
  };
  const d = sumDeltas([entry("named.heirloom")], (k) => (k === "named.heirloom" ? named : null), { level: 9 });
  assert.equal(d.bonus, 3);
  assert.equal(d.costMul, 2);
});

/* -------------------------------------------- */
/*  True and apparent                           */
/* -------------------------------------------- */

test("a hidden variation is priced into the truth and out of the appearance", () => {
  const entries = [entry("material.silver", { hidden: true }), entry("masterwork.weaponToHit")];
  const v = values(10, entries, define);
  assert.equal(v.true, 10 * 10 + 80);
  assert.equal(v.apparent, 10 + 80); // silver unseen, so unpriced
});

test("hidden governs presentation, never mechanics", () => {
  // A disguised magic sword still hits as one: deltas count every entry.
  const entries = [entry("magical.plusOne", { hidden: true })];
  assert.equal(sumDeltas(entries, define).bonus, 1);
  assert.deepEqual(visibleVariations(entries), []);
});

test("a conditional claim is gathered, never applied", () => {
  const crest = { key: "appearance.crest", value: { conditional: [{ audience: "House Aurelian", mul: 4 }] } };
  const claims = conditionalClaims([entry("appearance.crest")], (k) => (k === "appearance.crest" ? crest : null));
  assert.equal(claims.length, 1);
  assert.equal(claims[0].audience, "House Aurelian");
  // It contributed nothing to either price.
  const v = values(100, [entry("appearance.crest")], (k) => (k === "appearance.crest" ? crest : null));
  assert.equal(v.true, 100);
});

test("a hidden claim is not offered at all — it is not known to exist", () => {
  const crest = { key: "appearance.crest", value: { conditional: [{ audience: "anyone", mul: 4 }] } };
  const claims = conditionalClaims([entry("appearance.crest", { hidden: true })], () => crest);
  assert.deepEqual(claims, []);
});

/* -------------------------------------------- */
/*  Seen, and understood                        */
/* -------------------------------------------- */

test("an inscription in a language you have is read", () => {
  const insc = { key: "appearance.inscription", language: "Zaharan" };
  assert.equal(isLegible(entry("appearance.inscription"), insc, { languages: ["Common", "Zaharan"] }), true);
});

test("an inscription in a language you lack is seen but not read", () => {
  // The entry is NOT hidden — the writing is plainly there. Only its meaning
  // is out of reach, which is the whole texture of the thing.
  const insc = { key: "appearance.inscription", language: "Zaharan" };
  const e = entry("appearance.inscription");
  assert.equal(e.hidden, false);
  assert.equal(isLegible(e, insc, { languages: ["Common"] }), false);
});

test("an appearance in no particular language is always legible", () => {
  assert.equal(isLegible(entry("appearance.crest"), { key: "appearance.crest" }, { languages: [] }), true);
});

test("a Judge may mark an entry unread regardless of language", () => {
  assert.equal(isLegible(entry("appearance.crest", { read: false }), { key: "appearance.crest" }, {}), false);
});

/* -------------------------------------------- */
/*  Field specs                                 */
/* -------------------------------------------- */

test("a spec naming a kind this version does not know is reported, not dropped", () => {
  const { fields, unusable } = usableSpecs([
    { key: "carat", kind: FIELD_KIND.number },
    { key: "resonance", kind: "hyperspectral" },
  ]);
  assert.deepEqual(fields.map((f) => f.key), ["carat"]);
  assert.deepEqual(unusable, ["resonance"]);
});

test("a select with no choices is unusable", () => {
  assert.deepEqual(usableSpecs([{ key: "cut", kind: FIELD_KIND.select }]).unusable, ["cut"]);
});

test("numbers coerce and clamp to the spec's own bounds", () => {
  const spec = { key: "carat", kind: FIELD_KIND.number, min: 0, max: 10 };
  assert.equal(coerceField(spec, "3"), 3);
  assert.equal(coerceField(spec, "99"), 10);
  assert.equal(coerceField(spec, "nonsense"), 0);
});

test("a select falls back to its initial rather than accepting a stranger", () => {
  const spec = { key: "cut", kind: FIELD_KIND.select, choices: [{ value: "rose" }, { value: "table" }], initial: "table" };
  assert.equal(coerceField(spec, "rose"), "rose");
  assert.equal(coerceField(spec, "brilliant"), "table");
});

test("coercing a payload leaves keys the spec never mentioned alone", () => {
  // An importer dropping a field must not delete what a Judge recorded under
  // it — the data outlives the spec, and a later import may bring it back.
  const out = coerceData([{ key: "carat", kind: FIELD_KIND.number }], { carat: "2", provenance: "dug up" });
  assert.equal(out.carat, 2);
  assert.equal(out.provenance, "dug up");
});

test("a blank payload is every field at its declared initial", () => {
  const specs = [
    { key: "carat", kind: FIELD_KIND.number, initial: 1 },
    { key: "flawless", kind: FIELD_KIND.boolean },
  ];
  assert.deepEqual(blankData(specs), { carat: 1, flawless: false });
});

/* -------------------------------------------- */
/*  Containment: a variation lives inside an item */
/* -------------------------------------------- */

/**
 * A collection with the two reads `siblingsOf` promises — `filter` and `get`.
 * A plain array has one and not the other, and the containment layer uses both.
 */
const collection = (items) => {
  const arr = [...items];
  arr.get = (id) => arr.find((i) => i.id === id) ?? null;
  return arr;
};

/** A base item and its applied variations, in one world collection. */
function world(base, ...variations) {
  const all = collection([base, ...variations]);
  for (const it of all) it.parent = null;
  return all;
}

const varDoc = (id, key, extra = {}) => ({
  id,
  type: "acks-extras.variation",
  name: key,
  system: { key, appliesTo: [], supersedes: [], deltas: {}, cost: {}, ...extra },
  flags: { "acks-extras": { containedIn: extra.on ?? null } },
  getFlag: (_ns, k) => (k === "containedIn" ? extra.on ?? null : undefined),
});

test("contents resolve against the collection the item is actually in", () => {
  const sword = { id: "s1", type: "weapon", system: {}, flags: {}, getFlag: () => undefined };
  const mw = varDoc("v1", "masterwork.weaponToHit", { on: "s1" });
  const loose = varDoc("v2", "material.silver");
  const all = world(sword, mw, loose);
  assert.deepEqual(contentsOf(all, "s1").map((i) => i.id), ["v1"]);
  assert.deepEqual(contentsOf(all, "nope").map((i) => i.id), []);
});

test("a compendium item holds nothing rather than reporting an empty world", () => {
  // Its pack is not loaded, so "no contents" would be a guess. Say so instead.
  assert.equal(siblingsOf({ id: "x", pack: "acks-extras.variations" }), null);
});

test("an actor's own items are the siblings when it carries the item", () => {
  const items = collection([]);
  assert.equal(siblingsOf({ id: "x", parent: { items } }), items);
});

console.log(
  `test-variations: OK (${passed} checks — base types, inference fallback, families, printed supersession, documents, containment, cost order, true vs apparent, legibility, field specs)`,
);
