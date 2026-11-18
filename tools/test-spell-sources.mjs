/**
 * The castable-spell register (`lib/spell-sources.mjs`) and what magic puts in
 * it: the repertoire source (`repertoire.mjs` `makeRepertoireSource`, over
 * `cast-spell.mjs` `castReading`), the reach of a cast on its caster
 * (`cast-reach.mjs`), and `recordParts`' `entries` option that lets an available
 * grant stack beside a recorded one.
 *
 * Stand-in actors, classes and spells; every name, figure and id is invented.
 * What this pins: who counts as able to cast a spell (a tradition with a slot at
 * its level, or core's own count), what a cast on the caster would write, how
 * two sources of one spell merge, and that an available part is narrowed and
 * stacked as a recorded one. The sheet rows and the live world are the live
 * walk's (docs/magic/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, user: { targets: new Set() }, items: [], packs: [] };
globalThis.Hooks = { on() {}, once() {} };

const sources = await import("../scripts/lib/spell-sources.mjs");
const { registerSpellSource, registerSpellReach, castableSpells, availableRollMods, spellRefOf } = sources;
const { makeRepertoireSource } = await import("../scripts/magic/repertoire.mjs");
const { castReading } = await import("../scripts/magic/cast-spell.mjs");
const { makeSelfReach, twinLookups } = await import("../scripts/magic/cast-reach.mjs");
const { recordParts, rollModsOf } = await import("../scripts/lib/roll-mods.mjs");
const { spellFacts } = await import("../scripts/magic/cast-abilities.mjs");

/* --- Stand-ins ------------------------------------------------------------- */

let serial = 0;
const NONE = { byCookbookId: () => null, fromUuidSync: () => null };
const ARCANE = { key: "arcane", label: "Arcane", kind: "vancian", slots: [], spellList: [] };
const classOf = (casting = [ARCANE]) => ({ system: { casting, ladders: [] } });
const slots = (key, list) => ({ key, kind: "vancian", slots: list.map(([n, max, used = 0]) => ({ n, max, used })) });

/** A spell item: its tradition list and level, its target model, its rows and page. */
function spellItem(name, { id = `def.spell.${name}`, lists = [{ source: "arcane", level: 1 }], model = "creature", target = {}, rows = [], cite = "Test p. 1", stamp = true, flagged = true, lvl = 1 } = {}) {
  const n = ++serial;
  const spell = { effects: rows, lists, target: { model, ...target }, cite };
  return {
    id: `i${n}`,
    uuid: `Actor.test.Item.i${n}`,
    name,
    type: "spell",
    system: { lvl, cast: 0, class: "" },
    _stats: {},
    flags: { "acks-extras": { ...(flagged ? { spell } : {}), ...(stamp ? { cookbook: { id } } : {}) } },
  };
}
const grant = (key, over = {}) => ({ key, type: "grants", appliesTo: "recipient", ref: "def.prof.testClimbing", lasts: "duration", ...over });

/** An actor with its class and pools standing beside it, as the source's readers are handed them. */
function actorOf({ type = "character", level = 3, items = [], cls = classOf(), pools = [slots("arcane", [[1, 2]])], spells = { enabled: false }, effects = [] } = {}) {
  const actor = { id: `a${++serial}`, type, name: "Tester", items, effects, appliedEffects: effects, statuses: new Set(), system: { details: { level, alignment: "" }, spells }, getFlag: () => undefined, __class: cls, __pools: pools };
  for (const item of items) item.parent = actor;
  return actor;
}
const repertoire = makeRepertoireSource({ castReading, classFor: (a) => a.__class, poolsOf: (a) => a.__pools, lookups: () => NONE });
const selfReach = makeSelfReach({ lookups: () => NONE });
let unregister = [];
const arm = (...extra) => {
  unregister = [registerSpellSource("repertoire", repertoire), registerSpellReach(selfReach), ...extra];
};
const disarm = () => {
  for (const off of unregister) off();
  unregister = [];
};

/* --- The register: a caster, a non-caster, a spell it cannot cast ----------- */

await ok("a caster with a grant spell in its repertoire gets an onSelf entry carrying the part a cast would write", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1")] });
  const caster = actorOf({ items: [boon] });
  arm();
  try {
    const list = castableSpells(caster, { viewer: null });
    assert.equal(list.length, 1);
    const [entry] = list;
    assert.equal(entry.onSelf, true);
    assert.deepEqual(entry.spellRef, { cookbookId: "def.spell.Test Boon", uuid: boon.uuid, name: "Test Boon" });
    assert.equal(entry.source, "repertoire");
    assert.equal(entry.itemId, boon.id);
    assert.equal(entry.capacity, "ok");
    assert.equal(entry.casterLevel.value, 3);
    assert.equal(entry.cite, "Test p. 1");
    assert.deepEqual(entry.selfParts.map((p) => [p.on, p.ref, p.key]), [["grant", "def.prof.testClimbing", "g1"]]);
    const mods = availableRollMods(caster, { viewer: null });
    assert.equal(mods.length, 1);
    assert.deepEqual([mods[0].effect, mods[0].id, mods[0].label, mods[0].cite, mods[0].source, mods[0].part.on], [null, "def.spell.Test Boon", "Test Boon", "Test p. 1", "repertoire", "grant"]);
  } finally {
    disarm();
  }
});

await ok("a non-caster carrying the spell, an unflagged spell item and a spell with no slot at its level give none; a spent slot still lists, as none", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1")] });
  const fighter = actorOf({ items: [boon], cls: null, pools: [] });
  const attack = spellItem("Test Bite", { flagged: false, stamp: false });
  const high = spellItem("Test High Boon", { rows: [grant("g1")], lists: [{ source: "arcane", level: 3 }], lvl: 3 });
  const lowCaster = actorOf({ items: [attack, high] });
  const spent = actorOf({ items: [spellItem("Test Spent", { rows: [grant("g1")] })], pools: [slots("arcane", [[1, 2, 2]])] });
  arm();
  try {
    assert.deepEqual(castableSpells(fighter), [], "no tradition and no core count");
    assert.deepEqual(castableSpells(lowCaster), [], "a level-3 spell has no slot to cast with");
    const monster = actorOf({ type: "monster", items: [spellItem("Test Bite", { flagged: false, stamp: false, lists: [] })], cls: null, pools: [], spells: { enabled: true, 1: { max: 1 } } });
    assert.deepEqual(castableSpells(monster), [], "an unflagged spell item is core's monster attack, and no spell, whatever core's count says");
    const [entry] = castableSpells(spent);
    assert.deepEqual([entry.capacity, entry.onSelf], ["none", true], "carried and castable once a slot returns");
  } finally {
    disarm();
  }
});

await ok("a spell the caster has no tradition for gives none, and core's own count admits it only with the block on and a max at that level", () => {
  const foreign = spellItem("Test Foreign", { rows: [grant("g1")], lists: [{ source: "divine", level: 1 }] });
  const caster = actorOf({ items: [foreign] });
  const monster = (spells) => actorOf({ type: "monster", items: [spellItem("Test Core", { rows: [grant("g1")], lists: [], lvl: 1 })], cls: null, pools: [], spells });
  arm();
  try {
    assert.deepEqual(castableSpells(caster), [], "the class casts another tradition's list");
    assert.equal(castableSpells(monster({ enabled: true, 1: { max: 1 } })).length, 1);
    assert.deepEqual(castableSpells(monster({ enabled: false, 1: { max: 1 } })), [], "core's block is off");
    assert.deepEqual(castableSpells(monster({ enabled: true, 2: { max: 1 } })), [], "no max at the spell's level");
  } finally {
    disarm();
  }
});

await ok("a matched tradition whose slot grid keeps no count is listed with its capacity unknown, never hidden", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1")] });
  const caster = actorOf({ items: [boon], pools: [] });
  arm();
  try {
    assert.deepEqual(castableSpells(caster).map((e) => [e.spellRef.name, e.capacity, e.onSelf]), [["Test Boon", "unknown", true]]);
  } finally {
    disarm();
  }
});

/* --- The reach -------------------------------------------------------------- */

const reachOf = (spell, { level = 3, actor = actorOf() } = {}) => selfReach(actor, { spell, casterLevel: { value: level } });

await ok("a spell aimed at objects or a structure writes nothing on its caster; a special model cannot be told; an aimedAtSelf row survives either", () => {
  const rows = [grant("g1", { appliesTo: "target" })];
  assert.deepEqual(reachOf(spellItem("Test Rock", { model: "object", rows })), { onSelf: false, selfParts: [] });
  assert.deepEqual(reachOf(spellItem("Test Hall", { model: "structure", rows })), { onSelf: false, selfParts: [] });
  assert.deepEqual(reachOf(spellItem("Test Odd", { model: "special", rows })), { onSelf: null, selfParts: [] });
  const withSelf = [...rows, grant("g2", { appliesTo: "self" })];
  for (const model of ["object", "special"]) {
    const r = reachOf(spellItem("Test Mixed", { model, rows: withSelf }));
    assert.deepEqual([r.onSelf, r.selfParts.map((p) => p.key)], [true, ["g2"]], model);
  }
});

await ok("a blank model counts, as a grants row names none; self, creature, recipient, hdPool and area count", () => {
  for (const model of ["", "self", "creature", "recipient", "hdPool", "area"]) {
    const r = reachOf(spellItem("Test Any", { model, rows: [grant("g1")] }));
    assert.equal(r.onSelf, true, model || "blank");
  }
});

await ok("a row whose subject is the opponent or an ally is not the caster's, and a spell with no rows writes nothing", () => {
  assert.equal(reachOf(spellItem("Test Foe", { rows: [grant("g1", { appliesTo: "opponent" })] })).onSelf, false);
  assert.deepEqual(reachOf(spellItem("Test Bare", { rows: [] })), { onSelf: false, selfParts: [] });
});

await ok("the target gate decides a row for the caster: a Hit Dice cap below the caster's level leaves it out, an aimedAtSelf row is never gated", () => {
  const capped = { hdCap: { kind: "flat", flat: 2 } };
  const gated = reachOf(spellItem("Test Capped", { target: capped, rows: [grant("g1")] }), { actor: actorOf({ level: 5 }) });
  assert.deepEqual(gated, { onSelf: false, selfParts: [] });
  const within = reachOf(spellItem("Test Capped", { target: capped, rows: [grant("g1")] }), { actor: actorOf({ level: 2 }) });
  assert.equal(within.onSelf, true);
  const own = reachOf(spellItem("Test Capped", { target: capped, rows: [grant("g1", { appliesTo: "self" })] }), { actor: actorOf({ level: 5 }) });
  assert.equal(own.onSelf, true);
});

await ok("every option of a choice group counts, and both forms of a reversible spell", () => {
  const rows = [
    grant("a1", { pick: "p", pickOption: "one", ref: "def.prof.testOne" }),
    grant("a2", { pick: "p", pickOption: "two", ref: "def.prof.testTwo" }),
    grant("r1", { reversed: true, ref: "def.prof.testBack" }),
  ];
  const r = reachOf(spellItem("Test Pick", { rows }));
  assert.deepEqual(r.selfParts.map((p) => p.key), ["a1", "a2", "r1"]);
});

await ok("a copy with no rows reads its twin's, through one lazily built cookbook-id map per call", () => {
  const twin = spellItem("Test Twin", { id: "def.spell.testTwin", rows: [grant("g1")] });
  const copy = spellItem("Test Twin", { id: "def.spell.testTwin", rows: [] });
  let reads = 0;
  const docs = [spellItem("Test Other", { id: "def.spell.other" }), twin];
  globalThis.game.items = {
    [Symbol.iterator]: function* () {
      reads++;
      yield* docs;
    },
  };
  try {
    const call = {};
    const first = makeSelfReach()(actorOf(), { spell: copy, casterLevel: { value: 3 } }, call);
    const again = makeSelfReach()(actorOf(), { spell: copy, casterLevel: { value: 3 } }, call);
    assert.deepEqual([first.onSelf, again.onSelf], [true, true]);
    assert.equal(reads, 1, "the library is read once for the call");
    assert.equal(twinLookups(call).byCookbookId("Item", "def.spell.testTwin"), twin);
    assert.equal(twinLookups(call).byCookbookId("Item", "def.spell.absent"), null);
  } finally {
    globalThis.game.items = [];
  }
});

/* --- The merge and the identity --------------------------------------------- */

await ok("one spell seen through two sources is one entry: the better capacity speaks, both sources are named, and the reach is asked once", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1")] });
  const caster = actorOf({ items: [boon], pools: [slots("arcane", [[1, 2, 2]])] });
  const scroll = spellItem("Test Boon", { rows: [grant("g1")] });
  let asked = 0;
  const counting = (actor, entry, call) => {
    asked++;
    return selfReach(actor, entry, call);
  };
  const off = [registerSpellSource("repertoire", repertoire), registerSpellSource("scroll", () => [{ spell: scroll, itemId: "s1", casterLevel: { value: 7, source: "scroll", parts: [] }, capacity: "ok", cite: "Test p. 9" }]), registerSpellReach(counting)];
  try {
    const list = castableSpells(caster);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].source, list[0].sources, list[0].itemId, list[0].capacity, list[0].casterLevel.value, list[0].cite], ["scroll", ["repertoire", "scroll"], "s1", "ok", 7, "Test p. 9"]);
    assert.equal(asked, 1);
    assert.equal(list[0].selfParts.length, 1, "one part, not one per source");
    assert.deepEqual(castableSpells(caster, { kinds: ["repertoire"] }).map((e) => e.source), ["repertoire"], "kinds narrows the sources asked");
    const apart = castableSpells(caster, { kinds: ["scroll"] });
    assert.equal(apart.length, 1);
  } finally {
    off.forEach((f) => f());
  }
});

await ok("a part the reach lists for a spell that does not land on its caster reaches neither the entry nor the available parts", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1")] });
  const caster = actorOf({ items: [boon] });
  const part = { key: "x", on: "grant", ref: "def.prof.testClimbing" };
  for (const onSelf of [false, null]) {
    const off = [registerSpellSource("repertoire", repertoire), registerSpellReach(() => ({ onSelf, selfParts: [part] }))];
    try {
      assert.deepEqual(castableSpells(caster).map((e) => [e.onSelf, e.selfParts]), [[onSelf, []]]);
      assert.deepEqual(availableRollMods(caster), []);
    } finally {
      off.forEach((f) => f());
    }
  }
  const noReach = [registerSpellSource("repertoire", repertoire)];
  try {
    assert.deepEqual(castableSpells(caster).map((e) => [e.onSelf, e.selfParts]), [[null, []]], "with no reach registered nothing is told");
  } finally {
    noReach.forEach((f) => f());
  }
});

await ok("two different spells do not merge, and a source or a reach that throws is left out without breaking the others", () => {
  const a = spellItem("Test Alpha", { rows: [grant("g1")] });
  const b = spellItem("Test Beta", { rows: [grant("g1")] });
  const caster = actorOf({ items: [a, b] });
  const quiet = console.error;
  console.error = () => {};
  const off = [registerSpellSource("repertoire", repertoire), registerSpellSource("broken", () => { throw new Error("nope"); }), registerSpellReach(() => { throw new Error("nope"); })];
  try {
    const list = castableSpells(caster);
    assert.deepEqual(list.map((e) => e.spellRef.name), ["Test Alpha", "Test Beta"]);
    assert.deepEqual(list.map((e) => [e.onSelf, e.selfParts]), [[null, []], [null, []]], "a reach that throws tells nothing");
  } finally {
    console.error = quiet;
    off.forEach((f) => f());
  }
});

await ok("spellRefOf reads identity in a row's order: the cookbook id (own, else the twin's), the uuids, the folded name; spellFacts reads through it", () => {
  const twin = { uuid: "Item.twin", flags: { "acks-extras": { cookbook: { id: "def.spell.tw" } } } };
  const copy = { uuid: "Actor.x.Item.y", name: "Test Name-One", _stats: { compendiumSource: "Compendium.test.src" }, flags: {} };
  assert.deepEqual(spellRefOf(copy, twin), { cookbookId: "def.spell.tw", uuid: "Actor.x.Item.y", uuids: ["Actor.x.Item.y", "Compendium.test.src", "Item.twin"], name: "Test Name-One", key: "testnameone" });
  assert.equal(spellRefOf({ ...copy, flags: { "acks-extras": { cookbook: { id: "own" } } } }, twin).cookbookId, "own");
  const facts = spellFacts(copy, { byCookbookId: () => null, fromUuidSync: () => twin });
  assert.deepEqual([facts.id, facts.uuid, facts.uuids, facts.name], ["def.spell.tw", "Actor.x.Item.y", ["Actor.x.Item.y", "Compendium.test.src", "Item.twin"], "testnameone"]);
});

/* --- recordParts with entries ----------------------------------------------- */

/** A record's effect carrying one grant part, as a cast leaves it. */
const record = (label, ref) => ({ id: `fx${++serial}`, disabled: false, flags: { "acks-extras": { rollMods: { id: `def.spell.${label}`, label, cite: "Rec", sourceAlignment: null, parts: [{ key: `r-${label}`, on: "grant", provides: ["kw:spellrecord"], stacksWith: [], notStacksWith: [], ref }] } } } });

await ok("recordParts with entries stacks an available grant beside a recorded one, and a recorded grant of the same ref outranks the available", () => {
  const boon = spellItem("Test Boon", { rows: [grant("g1", { ref: "def.prof.testClimbing" })] });
  const other = spellItem("Test Other", { rows: [grant("g2", { ref: "def.prof.testSwimming" })] });
  const rec = record("Given", "def.prof.testSwimming");
  const caster = actorOf({ items: [boon, other], effects: [rec] });
  arm();
  try {
    const recorded = recordParts(caster, "grant", {});
    assert.deepEqual(recorded.kept.map((p) => p.refTo), ["def.prof.testSwimming"]);
    const available = availableRollMods(caster);
    assert.equal(available.length, 2);
    const both = recordParts(caster, "grant", { entries: [...rollModsOf(caster), ...available] });
    assert.deepEqual(both.kept.map((p) => [p.refTo, p.spell]), [["def.prof.testSwimming", "Given"], ["def.prof.testClimbing", "Test Boon"]]);
    assert.deepEqual(both.kept.map((p) => p.effect === null), [false, true], "the recorded part has its effect, the available one none: pale from gold");
    assert.deepEqual(both.dropped.map((p) => [p.spell, p.yieldsTo]), [["Test Other", "Given (Rec)"]], "the available part of a ref a record holds yields to the record");
  } finally {
    disarm();
  }
});


console.log(`\n${passed} spell-sources checks passed.`);
