/**
 * Offline tests for the summon rows the spells register authors (the calling,
 * the summoning, the ten conjure entries and the undead pair) and for
 * `summonOptionsOf` carrying a row's `max`. The rows are read from the register
 * and from the compiled cookbook; their locators run through the importer's
 * own `materializeEffects` against fixtures holding only the words each pattern reads,
 * so this file carries no book content. Foundry-free.
 *
 * Usage: node tools/test-magic-summon-rows.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { materializeEffects } from "../scripts/importer/executor.mjs";
import { summonOptionsOf } from "../scripts/magic/summon-spell.mjs";
import { spellRecipeProblems } from "./importer/spell-recipe-rules.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const register = read("register/rr/p196-p262-spells.json");
const cookbook = read("cookbook/spells.json").entries;
const creatures = read("cookbook/mm.json").entries;

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const CALLING = "def.spell.callOfTheWolf";
const SUMMONING = "def.spell.summonManes";
const CONJURATION = "def.spell.conjureCacodemonSpawn";
const REMAINS = ["def.spell.faithfulCompanion", "def.spell.unlivingPuppet"];

/**
 * The conjure entries. Three print their outcome in their own text; the rest
 * print that they are identical to one of the three, and the register records
 * which in `meta.readsAs` (the entry whose page gives the mark). The pins below
 * are what the register must say.
 */
const GENIE = "def.spell.conjureGenie";
const MAJOR = "def.spell.conjureMajorElemental";
const OWN_TEXT = [CONJURATION, GENIE, MAJOR];
const READS_AS = {
  "def.spell.conjureDybbuk": CONJURATION,
  "def.spell.conjureFiend": CONJURATION,
  "def.spell.conjureHellion": CONJURATION,
  "def.spell.conjureImp": CONJURATION,
  "def.spell.conjureIncubus": CONJURATION,
  "def.spell.conjurePettyElemental": MAJOR,
  "def.spell.conjureSupremeElemental": MAJOR,
};
const CONJURES = [...OWN_TEXT, ...Object.keys(READS_AS)];
const ALL = [CALLING, SUMMONING, ...CONJURES, ...REMAINS];

/** What a conjure entry must carry: every register entry named `conjure…`, each with one keyed conjuration row marked hostile at control's end. */
const conjureProblems = (entries) => {
  const problems = [];
  for (const e of entries.filter((x) => /^def\.spell\.conjure[A-Z]/.test(x.id))) {
    const rows = (e.effects ?? []).filter((r) => r.type === "summon");
    if (rows.length !== 1) problems.push(`${e.id}: ${rows.length} summon rows, one wanted`);
    else if (rows[0].summonFormat !== "conjuration" || rows[0].controlEnd !== "hostile") problems.push(`${e.id}: its row is not a conjuration that ends hostile`);
    const source = e.meta?.readsAs;
    if (source !== undefined && !entries.some((x) => x.id === source && /^def\.spell\.conjure[A-Z]/.test(x.id) && x.meta?.readsAs === undefined)) problems.push(`${e.id}: readsAs names no conjure entry that reads its own page`);
  }
  return problems;
};

const rowsOf = (id) => register.find((e) => e.id === id)?.effects ?? [];
const only = (id) => {
  const rows = rowsOf(id);
  assert.equal(rows.length, 1, `${id} has one row`);
  return rows[0];
};
const located = (id, text) => materializeEffects(rowsOf(id), [text])[0];

t("every summon entry carries one keyed summon row", () => {
  for (const id of ALL) {
    const row = only(id);
    assert.equal(row.type, "summon", id);
    assert.equal(row.key, "creature", id);
  }
});

t("every summon row passes the spell recipe rules, in the register and as compiled", () => {
  for (const id of ALL) {
    assert.deepEqual(spellRecipeProblems({ effects: rowsOf(id) }), [], `${id} register`);
    assert.deepEqual(spellRecipeProblems({ effects: cookbook[id].fields.effects.specs }), [], `${id} cookbook`);
    assert.deepEqual(cookbook[id].fields.effects.specs, rowsOf(id), `${id}: the compiled specs are the register's`);
  }
});

t("the rules take a summon format and a control kind, and refuse any other word", () => {
  const row = { key: "creature", type: "summon" };
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...row, summonFormat: "calling", control: "cooperative" }] }), []);
  assert.deepEqual(spellRecipeProblems({ effects: [row] }), [], "both are optional");
  assert.match(spellRecipeProblems({ effects: [{ ...row, summonFormat: "rite" }] }).join("\n"), /summonFormat "rite" is not a summon format/);
  assert.match(spellRecipeProblems({ effects: [{ ...row, control: "loyal" }] }).join("\n"), /control "loyal" is not a control kind/);
});

t("the formats and controls are the structure each entry's kind of spell states", () => {
  assert.deepEqual([only(CALLING).summonFormat, only(CALLING).control], ["calling", "cooperative"]);
  assert.deepEqual([only(SUMMONING).summonFormat, only(SUMMONING).control], ["summoning", "obedient"]);
  for (const id of CONJURES) assert.deepEqual([only(id).summonFormat, only(id).control], ["conjuration", "obedient"], id);
  for (const id of REMAINS) assert.deepEqual([only(id).summonFormat, only(id).control], [undefined, "obedient"], `${id}: no summon format`);
});

t("a row names its creature by a cookbook id the compiled monsters hold, except the conjuration's", () => {
  assert.ok(creatures[only(CALLING).ref], "the calling's creature");
  assert.ok(creatures[only(SUMMONING).ref], "the summoning's creature");
  for (const id of [...CONJURES, ...REMAINS]) assert.equal(only(id).ref, undefined, `${id} names no creature`);
});

t("no figure is written: count, Hit Dice and ceiling are located or absent", () => {
  for (const id of ALL) for (const field of ["amount", "value", "max"]) assert.equal(only(id)[field], undefined, `${id}.${field} is never a literal`);
  assert.deepEqual(only(CALLING).from.map((l) => l.into), ["amount"]);
  assert.deepEqual(only(SUMMONING).from.map((l) => l.into), ["max"]);
  for (const id of CONJURES) assert.deepEqual(only(id).from.map((l) => l.into), id === GENIE ? ["amount"] : ["amount", "value"], `${id}: the genie's page prints no Hit Dice`);
  for (const id of REMAINS) assert.equal(only(id).from, undefined, `${id}: its Hit Dice come from the remains`);
  for (const id of [CALLING, SUMMONING, ...CONJURES]) assert.equal(only(id).onMiss, "blank", `${id} keeps its row when a figure is missed`);
});

t("the calling's count is read through an article as one", () => {
  const row = located(CALLING, "Zzz calls a widget to the caster.");
  assert.equal(row.amount, 1);
  assert.equal(row.unread, undefined);
  assert.equal(row.max, undefined);
  assert.equal(only(CALLING).from[0].articles, true);
});

t("the summoning's count is a ceiling per level carried in max, and states no amount", () => {
  const row = located(SUMMONING, "Zzz summons one widget per level.");
  assert.deepEqual(row.max, { kind: "perLevel", base: 1, per: 1 });
  assert.equal(row.amount, undefined, "an amount would cap the count at one");
  const caster = located(SUMMONING, "Zzz summons one widget per caster level.");
  assert.deepEqual(caster.max, { kind: "perLevel", base: 1, per: 1 });
});

t("the conjuration's Hit Dice and count are located and its row carries no creature", () => {
  const row = located(CONJURATION, "Zzz conjure a widget with 3 HD.");
  assert.equal(row.amount, 1);
  assert.deepEqual(row.value, { kind: "flat", flat: 3 });
  assert.equal(row.ref, undefined);
  assert.equal(row.unread, undefined);
});

t("every conjure row locates its count and Hit Dice from the words its pattern reads, spaced or welded", () => {
  // Only the words each locator's pattern reads, after a filler word, with figures that are no entry's own.
  const SHAPES = [
    ["def.spell.conjureDybbuk", "Zzz conjure a widget with 7 HD.", 7],
    ["def.spell.conjureImp", "Zzz conjure an item with 5 HD.", 5],
    ["def.spell.conjureMajorElemental", "Zzz conjure a 9 HD elemental.", 9],
    ["def.spell.conjureSupremeElemental", "Zzz conjure a 11 HD elemental.", 11],
    [GENIE, "Zzz conjure a widget from that sphere.", undefined],
  ];
  for (const [id, text, hd] of SHAPES) {
    for (const sentence of [text, text.replace(/\s+/g, "")]) {
      const row = located(id, sentence);
      assert.equal(row.amount, 1, `${id}: count`);
      assert.deepEqual(row.value, hd === undefined ? undefined : { kind: "flat", flat: hd }, `${id}: Hit Dice`);
      assert.equal(row.unread, undefined, id);
    }
  }
  assert.deepEqual(located(GENIE, "Zzz.").unread, ["amount"]);
});

t("a page that prints none of it leaves the figures blank and the row standing, listed unread", () => {
  const calling = located(CALLING, "Zzz serves the caster.");
  assert.deepEqual([calling.type, calling.ref, calling.amount, calling.unread], ["summon", only(CALLING).ref, undefined, ["amount"]]);
  const summoning = located(SUMMONING, "Zzz serves the caster.");
  assert.deepEqual([summoning.max, summoning.unread], [undefined, ["max"]]);
  const conjuration = located(CONJURATION, "Zzz.");
  assert.deepEqual([conjuration.amount, conjuration.value, conjuration.unread], [undefined, undefined, ["amount", "value"]]);
});

t("the undead pair's rows are the same with or without a page: nothing is located", () => {
  for (const id of REMAINS) {
    assert.deepEqual(materializeEffects(rowsOf(id), ["Any text at all."]), materializeEffects(rowsOf(id), []));
    assert.deepEqual(materializeEffects(rowsOf(id), []), [{ key: "creature", type: "summon", control: "obedient", controlEnd: "gone" }]);
  }
});

t("each summon entry states what becomes of its creatures when control ends, as structure the lint accepts", () => {
  const ends = { [CALLING]: "gone", [SUMMONING]: "gone", ...Object.fromEntries(CONJURES.map((id) => [id, "hostile"])), "def.spell.faithfulCompanion": "gone", "def.spell.unlivingPuppet": "gone" };
  for (const [id, end] of Object.entries(ends)) {
    assert.equal(only(id).controlEnd, end, id);
    assert.equal(cookbook[id].fields.effects.specs[0].controlEnd, end, `${id}: compiled`);
  }
  const row = { key: "creature", type: "summon" };
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...row, controlEnd: "stays" }, { ...row, key: "other", controlEnd: "hostile" }] }), []);
  assert.deepEqual(spellRecipeProblems({ effects: [row] }), [], "optional: a blank reads as stays");
  assert.match(spellRecipeProblems({ effects: [{ ...row, controlEnd: "vanish" }] }).join("\n"), /controlEnd "vanish" is not a control end/);
});

t("every conjure entry in the register carries the conjuration row, the ten the book prints", () => {
  const found = register.filter((e) => /^def\.spell\.conjure[A-Z]/.test(e.id)).map((e) => e.id).sort();
  assert.deepEqual(found, [...CONJURES].sort(), "the register's conjure entries are the ten pinned");
  assert.deepEqual(conjureProblems(register), []);
});

t("an entry that reads its mark from a sibling says so in meta.readsAs, and carries the sibling's mark", () => {
  const mark = (id) => { const { summonFormat, control, controlEnd } = only(id); return { summonFormat, control, controlEnd }; };
  for (const id of OWN_TEXT) assert.equal(register.find((e) => e.id === id).meta.readsAs, undefined, `${id} reads its own page`);
  for (const [id, source] of Object.entries(READS_AS)) {
    assert.equal(register.find((e) => e.id === id).meta.readsAs, source, `${id} reads as ${source}`);
    assert.deepEqual(mark(id), mark(source), `${id} carries ${source}'s mark`);
    assert.equal(cookbook[id].meta.readsAs, source, `${id}: compiled`);
  }
});

t("a conjure entry with no row, or with another reading, is a problem", () => {
  const bare = register.map((e) => (e.id === "def.spell.conjureImp" ? { ...e, effects: undefined } : e));
  assert.match(conjureProblems(bare).join("\n"), /conjureImp: 0 summon rows/);
  const stays = register.map((e) => (e.id === "def.spell.conjureFiend" ? { ...e, effects: [{ ...only("def.spell.conjureFiend"), controlEnd: "stays" }] } : e));
  assert.match(conjureProblems(stays).join("\n"), /conjureFiend: its row is not a conjuration that ends hostile/);
  const added = [...register, { id: "def.spell.conjureNew", effects: [] }];
  assert.match(conjureProblems(added).join("\n"), /conjureNew: 0 summon rows/);
  const lost = register.map((e) => (e.id === "def.spell.conjureImp" ? { ...e, meta: { ...e.meta, readsAs: "def.spell.conjureNowhere" } } : e));
  assert.match(conjureProblems(lost).join("\n"), /conjureImp: readsAs names no conjure entry that reads its own page/);
  const chained = register.map((e) => (e.id === "def.spell.conjureImp" ? { ...e, meta: { ...e.meta, readsAs: "def.spell.conjureFiend" } } : e));
  assert.match(conjureProblems(chained).join("\n"), /conjureImp: readsAs names no conjure entry that reads its own page/);
});

t("the compiled cookbook holds a row for every conjure entry, the register's", () => {
  const compiled = Object.keys(cookbook).filter((id) => /^def\.spell\.conjure[A-Z]/.test(id)).sort();
  assert.deepEqual(compiled, [...CONJURES].sort());
  for (const id of CONJURES) assert.deepEqual(cookbook[id].fields.effects?.specs, rowsOf(id), `${id}: compiled`);
});

const rowOf = (extra) => ({ type: "summon", ref: "x.ref", amount: 2, value: { kind: "flat", flat: 3 }, summonFormat: "calling", control: "cooperative", ...extra });
const withRows = (rows) => ({ flags: { "acks-extras": { spell: { effects: rows } } } });

t("summonOptionsOf carries a row's max through unresolved, the same object", () => {
  const max = { kind: "perLevel", base: 1, per: 1 };
  const [option] = summonOptionsOf(withRows([rowOf({ max })]));
  assert.equal(option.max, max, "not resolved, not copied");
  assert.deepEqual([option.amount, option.value, option.summonFormat, option.control], [2, { kind: "flat", flat: 3 }, "calling", "cooperative"]);
});

t("summonOptionsOf carries a row's controlEnd, blank where it states none", () => {
  assert.equal(summonOptionsOf(withRows([rowOf({ controlEnd: "hostile" })]))[0].controlEnd, "hostile");
  assert.equal(summonOptionsOf(withRows([rowOf()]))[0].controlEnd, "");
});

t("a materialized register row reaches summonOptionsOf with its controlEnd", () => {
  const [option] = summonOptionsOf(withRows(materializeEffects(rowsOf(CONJURATION), ["This spell opens a portal."])));
  assert.equal(option.controlEnd, "hostile");
});

t("summonOptionsOf answers a null max for a row with none, and reads a twin's max", () => {
  assert.equal(summonOptionsOf(withRows([rowOf()]))[0].max, null);
  const max = { kind: "perLevel", base: 1, per: 1 };
  const twin = withRows([rowOf({ max })]);
  assert.deepEqual(summonOptionsOf(withRows([]), { twin })[0].max, max);
  assert.equal(summonOptionsOf(withRows([]), { twin: null }).length, 0);
});

t("a materialized register row reaches summonOptionsOf with its located max and no amount", () => {
  const rows = materializeEffects(rowsOf(SUMMONING), ["This spell summons one imp per level of experience."]);
  const [option] = summonOptionsOf(withRows(rows));
  assert.deepEqual(option.max, { kind: "perLevel", base: 1, per: 1 });
  assert.equal(option.amount, 0, "a row stating no amount sets no limit");
  assert.equal(option.ref, only(SUMMONING).ref);
});

console.log(`\n${n} magic summon row tests passed`);
