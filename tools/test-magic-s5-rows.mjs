/**
 * Offline tests for the register rows of the ten spells of slice S5e: each entry's
 * compiled recipe (`cookbook/spells.json`, from `register/rr/p196-p262-spells.json`)
 * holds the shape the cast reads, and the cast's own code (`cast-mods.mjs`,
 * `cast-rows.mjs`, `cast-gates.mjs`) turns each row into the part lib's readers
 * take (`lib/roll-mods.mjs`). Foundry-free.
 *
 * What a page prints is not here: every figure and every actor below is invented,
 * and a recipe's located fields are filled by hand where the cast needs them.
 * Whether the locators match the printed page is a rules test
 * (`tools/rules-tests/`, machine-local).
 *
 * Usage: node tools/test-magic-s5-rows.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, system: { id: "acks" }, user: { targets: new Set() } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };

const { MONSTER_TYPES, SIZES } = await import("../scripts/monsters/config.mjs");
globalThis.acksExtras = { monsters: { config: { MONSTER_TYPES, SIZES } } };

const { spellRecipeProblems } = await import("./importer/spell-recipe-rules.mjs");
const { CONDITIONS, ATTACK_KINDS } = await import("../scripts/lib/conditions.mjs");
const { CONDITION_KEYS, capabilityForId } = await import("../scripts/lib/vocab.mjs");
const { modParts, isModRow } = await import("../scripts/magic/cast-mods.mjs");
const { keyedRows, pickGroups, rowsForMode, awaitsFail } = await import("../scripts/magic/cast-rows.mjs");
const { targetGate } = await import("../scripts/magic/cast-gates.mjs");
const { rowOpens, kindOf } = await import("../scripts/magic/cast-kinds.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");
const { recordParts, throwResolution, recordImmunity, registerItemBonusSource } = await import("../scripts/lib/roll-mods.mjs");
const { modifierDisposition, DISPOSITION } = await import("../scripts/lib/typed-modifiers.mjs");
registerItemBonusSource(() => []);

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cookbookDir = path.join(REPO, "cookbook");
const cb = JSON.parse(fs.readFileSync(path.join(cookbookDir, "spells.json"), "utf8"));
/** Every definition id the cookbook holds, so a token a row names is proven to be one. */
const KNOWN = new Set();
for (const file of fs.readdirSync(cookbookDir).filter((f) => f.endsWith(".json"))) {
  const json = JSON.parse(fs.readFileSync(path.join(cookbookDir, file), "utf8"));
  for (const id of Object.keys(json.entries ?? {})) KNOWN.add(id);
}

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const ID = {
  allure: "def.spell.allure",
  armour: "def.spell.arcaneArmor",
  bane: "def.spell.baneRune",
  chameleon: "def.spell.chameleon",
  leaping: "def.spell.leaping",
  trace: "def.spell.passWithoutTrace",
  silent: "def.spell.silentStep",
  spider: "def.spell.spiderClimbing",
  slick: "def.spell.slickness",
  sharp: "def.spell.sharpness",
};
const specsOf = (id) => cb.entries[id].fields.effects.specs;
const valuesOf = (id) => cb.entries[id].fields.values?.specs ?? [];
const rowOf = (id, key) => specsOf(id).find((s) => s.key === key);
/** A spec as the row a materialized import leaves: no recipe keys, plus the located fields a test names. */
const asRow = (spec, located = {}) => {
  const { from, each, onMiss, noteFrom, ...row } = spec;
  return { ...row, origin: "register", ...located };
};
const flat = (v) => ({ kind: "flat", flat: v });
const rowsFor = (id, located = {}) => specsOf(id).map((s) => asRow(s, located[s.key] ?? {}));
const keyed = (id, located) => keyedRows(rowsFor(id, located));

/* ------------------------------------------------------------------ */
/*  The compiled recipes                                               */
/* ------------------------------------------------------------------ */

t("the ten entries carry recipes in the compiled cookbook, and the recipe lint finds nothing in them", () => {
  for (const id of Object.values(ID)) {
    assert.ok(specsOf(id)?.length, `${id} effects`);
    assert.deepEqual(spellRecipeProblems({ effects: specsOf(id), values: valuesOf(id) }), [], id);
    for (const s of specsOf(id)) assert.match(s.key, /^[a-z][A-Za-z0-9]*$/);
  }
  assert.deepEqual(Object.values(ID).map((id) => specsOf(id).map((s) => s.key)), [
    ["aura", "bonus"],
    ["missile", "melee", "mageMissile"],
    ["attackMundane", "damageMundane", "attackMagical", "damageMagical"],
    ["bonus", "grant"],
    ["bonus", "distances"],
    ["grant"],
    ["bonus", "grant"],
    ["grant", "auto", "unimpeded"],
    ["objects", "floor", "footing", "armour", "willing"],
    ["attack", "damageMundane", "damageMagical"],
  ]);
});

t("every definition id and capability a row names is one the cookbook defines, and every word a row uses is in lib's tables", () => {
  const caps = new Set([...KNOWN].map(capabilityForId));
  for (const id of Object.values(ID)) {
    for (const s of specsOf(id)) {
      for (const token of [s.ref, ...(s.refs ?? []), ...(s.ifHas ?? [])].filter(Boolean)) {
        assert.ok(token.startsWith("kw:") ? caps.has(token) : KNOWN.has(token), `${id} ${s.key} names ${token}`);
      }
      for (const c of [...(s.conditions ?? []), ...(s.untimed ?? [])]) assert.ok(Object.hasOwn(CONDITIONS, c) && Object.hasOwn(CONDITION_KEYS, c), `${id} ${s.key} ${c}`);
      for (const k of s.attackKinds ?? []) assert.ok(ATTACK_KINDS.includes(k), k);
    }
  }
});

t("no row carries a figure: every number rides a located field, so an unread page leaves each one blank", () => {
  for (const id of Object.values(ID)) {
    for (const s of specsOf(id)) {
      assert.equal(s.value, undefined, `${id} ${s.key}`);
      assert.equal(s.exemptSizeOver, undefined);
      assert.equal(s.atLevelNum, undefined);
      assert.equal(s.note, undefined, "no authored prose");
    }
  }
});

t("sharpness (ruling 141): its three rows are the ones the page prints, left as built", () => {
  const [attack, mundane, magical] = specsOf(ID.sharp);
  assert.deepEqual([attack.target, attack.gate.kind, attack.notStacksWith], ["attackThrow", "weaponMundane", ["kw:masterwork"]]);
  assert.deepEqual([mundane.target, mundane.gate.kind, mundane.notStacksWith], ["damage", "weaponMundane", ["kw:masterwork"]]);
  assert.deepEqual([magical.target, magical.gate.kind, magical.notStacksWith], ["damage", "weaponMagical", undefined]);
  assert.ok([attack, mundane, magical].every((r) => r.type === "modifier" && r.mode === "add" && r.lasts === "duration" && r.from.length === 1));
});

/* ------------------------------------------------------------------ */
/*  Allure                                                             */
/* ------------------------------------------------------------------ */

/** An actor carrying one spell record's parts and the abilities a test names, as lib's readers see it. */
const bearerOf = (parts, { provides = [], id = "def.spell.testBuff", statuses = [], type = "character", size, kinds } = {}) => {
  const effect = { id: "fx1", disabled: false, flags: { "acks-extras": { rollMods: { id, label: "Testbuff", cite: "T 1", sourceAlignment: null, parts } } } };
  const items = provides.map((p, i) => ({ id: `a${i}`, type: "ability", name: `Held ${p}`, getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { provides: [p] } : undefined) }));
  return {
    name: "Bearer",
    type,
    items,
    effects: [effect],
    appliedEffects: [effect],
    statuses: new Set(statuses),
    system: { saves: {}, details: { level: 3 }, ac: { value: 10 }, scores: { dex: { mod: 0 } } },
    getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { ...(size ? { size } : {}), ...(kinds ? { types: kinds } : {}) } : undefined),
  };
};

t("allure: a grant of the proficiency and a reaction bonus that waits for it; the bonus reads only where the proficiency is held, the grant only where it is not", () => {
  const [aura, bonus] = specsOf(ID.allure);
  assert.deepEqual([aura.type, aura.ref, aura.mode, aura.lasts], ["grants", "def.prof.mysticAura", undefined, "duration"]);
  assert.deepEqual([bonus.type, bonus.target, bonus.mode, bonus.ifHas, bonus.tones], ["modifier", "reaction", "add", ["kw:mysticaura"], undefined]);
  const made = modParts(keyed(ID.allure, { bonus: { value: flat(3) } }), { level: 4 });
  assert.deepEqual(made.parts.map((p) => [p.key, p.on, p.value ?? null, p.ref ?? null, p.ifHas ?? null]), [
    ["aura", "grant", null, "def.prof.mysticAura", null],
    ["bonus", "reaction", 3, null, ["kw:mysticaura"]],
  ]);
  const without = bearerOf(made.parts);
  assert.deepEqual(recordParts(without, "grant").kept.map((p) => p.refTo), ["def.prof.mysticAura"]);
  assert.deepEqual(recordParts(without, "reaction").kept, [], "no Mystic Aura, so no further bonus");
  const holder = bearerOf(made.parts, { provides: [capabilityForId("def.prof.mysticAura")] });
  assert.deepEqual(recordParts(holder, "grant").kept, [], "a holder is granted nothing");
  assert.deepEqual(recordParts(holder, "reaction").kept.map((p) => p.value), [3]);
});

t("allure: a bonus the import left blank writes no part and is told by its key; the grant still stands", () => {
  const made = modParts(keyed(ID.allure), { level: 4 });
  assert.deepEqual([made.parts.map((p) => p.key), made.blank], [["aura"], ["bonus"]]);
});

/* ------------------------------------------------------------------ */
/*  Arcane armor                                                       */
/* ------------------------------------------------------------------ */

t("arcane armor: two sets on armour class by attack kind, thrown counted with missile, and an immunity to the named spell", () => {
  const [missile, melee, spell] = specsOf(ID.armour);
  assert.deepEqual([missile.target, missile.mode, missile.attackKinds, melee.attackKinds, melee.mode], ["ac", "set", ["missile", "thrown"], ["melee"], "set"]);
  assert.deepEqual([spell.type, spell.refs, spell.conditions, spell.saveEffect], ["immunity", ["def.spell.mageMissile"], undefined, "none"]);
  assert.ok(KNOWN.has(spell.refs[0]));
  for (const row of [missile, melee]) assert.deepEqual(modifierDisposition(asRow(row, { value: flat(6) }), { actorType: "character", bearer: true }).reason, "set");
});

t("arcane armor: each set reaches lib's reader for its kinds only, and the spell it names is an immunity of the record", () => {
  const made = modParts(keyed(ID.armour, { missile: { value: flat(6) }, melee: { value: flat(4) } }), { level: 4 });
  assert.deepEqual(made.parts.map((p) => [p.key, p.on, p.mode ?? null, p.value ?? null]), [["missile", "ac", "set", 6], ["melee", "ac", "set", 4], ["mageMissile", "immune", null, null]]);
  const bearer = bearerOf(made.parts);
  const kept = (kind) => recordParts(bearer, "ac", { kind }).kept.map((p) => [p.key, p.value]);
  assert.deepEqual([kept("missile"), kept("thrown"), kept("melee")], [[["missile", 6]], [["missile", 6]], [["melee", 4]]]);
  const found = recordImmunity(bearer, { spell: { id: "def.spell.mageMissile", provides: [] } });
  assert.equal(found.spell?.label, "Testbuff (T 1)");
  assert.equal(recordImmunity(bearer, { spell: { id: "def.spell.other", provides: [] } }).spell, null);
});

t("arcane armor: a figure the import left blank writes no armour part and leaves the immunity", () => {
  const made = modParts(keyed(ID.armour), { level: 4 });
  assert.deepEqual([made.parts.map((p) => p.key), made.blank], [["mageMissile"], ["missile", "melee"]]);
});

/* ------------------------------------------------------------------ */
/*  Bane-rune                                                          */
/* ------------------------------------------------------------------ */

t("bane-rune: four weapon rows (attack and damage, mundane and magical) each offering the module's creature kinds to a pick, with no masterwork clause", () => {
  const rows = specsOf(ID.bane);
  assert.deepEqual(rows.map((r) => [r.target, r.gate.kind]), [["attackThrow", "weaponMundane"], ["damage", "weaponMundane"], ["attackThrow", "weaponMagical"], ["damage", "weaponMagical"]]);
  for (const r of rows) {
    assert.deepEqual([r.type, r.mode, r.pickKind, r.notStacksWith], ["modifier", "add", true, undefined]);
    assert.deepEqual(r.vsKinds, Object.keys(MONSTER_TYPES), "the module's own kind keys (owner question 1c.24)");
  }
  assert.deepEqual(valuesOf(ID.bane), [{ target: { model: "object" } }]);
});

t("bane-rune: with a weapon named the rows are parts narrowed to the kind picked, the first kind where none is, and never a kind a row does not list", () => {
  const located = Object.fromEntries(specsOf(ID.bane).map((s, i) => [s.key, { value: flat(i < 2 ? 2 : 1) }]));
  const rows = keyed(ID.bane, located);
  const chosen = modParts(rows, { level: 3, itemId: "w1", kind: "undead" });
  assert.deepEqual(chosen.parts.map((p) => [p.key, p.on, p.value, p.vsKinds, p.itemId, p.gate.kind]), [
    ["attackMundane", "attack", 2, ["undead"], "w1", "weaponMundane"],
    ["damageMundane", "damage", 2, ["undead"], "w1", "weaponMundane"],
    ["attackMagical", "attack", 1, ["undead"], "w1", "weaponMagical"],
    ["damageMagical", "damage", 1, ["undead"], "w1", "weaponMagical"],
  ]);
  assert.deepEqual(chosen.kind, { key: "undead", authored: Object.keys(MONSTER_TYPES), defaulted: false });
  assert.deepEqual([chosen.lasting, chosen.endsOn], [true, []]);
  const dflt = modParts(rows, { level: 3, itemId: "w1" });
  assert.deepEqual([dflt.parts[0].vsKinds, dflt.kind.defaulted], [[Object.keys(MONSTER_TYPES)[0]], true]);
  assert.equal(modParts(rows, { level: 3, itemId: "w1", kind: "dragon" }).kind.defaulted, true, "dragon is no key of the module's list, so the first stands");
  assert.deepEqual(modParts(rows, { level: 3 }).parts, [], "with no weapon named the rows are card lines");
});

/* ------------------------------------------------------------------ */
/*  Chameleon and silent step                                          */
/* ------------------------------------------------------------------ */

const SKILL = { [ID.chameleon]: ["kw:hiding", "def.skill.hiding"], [ID.silent]: ["kw:sneaking", "def.skill.sneaking"] };

t("chameleon and silent step: a bonus where the skill is held and a set target where it is not, each exempting a creature above a located size", () => {
  for (const [id, [cap, def]] of Object.entries(SKILL)) {
    const [bonus, grant] = specsOf(id);
    assert.deepEqual([bonus.type, bonus.target, bonus.mode, bonus.refs, bonus.ifHas], ["modifies", "proficiencyThrow", "add", [cap], [cap]]);
    assert.deepEqual([grant.type, grant.mode, grant.ref, grant.ifHas], ["grants", "set", def, undefined]);
    for (const row of [bonus, grant]) {
      assert.deepEqual(row.from.map((l) => l.into ?? "value"), ["value", "exemptSizeOver"], "the figure and the size are both read from the page");
      assert.equal(row.lasts, "duration");
    }
  }
});

t("chameleon: exactly one of the two applies to a bearer: the bonus to a holder's throw, the set target (and a granted throw) to one without the skill", () => {
  const made = modParts(keyed(ID.chameleon, { bonus: { value: flat(5) }, grant: { value: flat(9) } }), { level: 3 });
  assert.deepEqual(made.parts.map((p) => [p.key, p.on, p.mode ?? null, p.value, p.ref ?? null, p.refs ?? null]), [
    ["bonus", "throw", "add", 5, null, ["kw:hiding"]],
    ["grant", "grant", "set", 9, "def.skill.hiding", null],
  ]);
  const subject = { id: "def.skill.hiding", provides: [] };
  const lacking = bearerOf(made.parts);
  assert.equal(throwResolution(lacking, { subject }).total, 0, "no Hiding, so the bonus waits on the capability");
  assert.deepEqual(recordParts(lacking, "grant", { rollType: "above" }).kept.map((p) => [p.refTo, p.mode, p.value]), [["def.skill.hiding", "set", 9]]);
  const holder = bearerOf(made.parts, { provides: ["kw:hiding"] });
  assert.equal(throwResolution(holder, { subject }).total, 5);
  assert.deepEqual(recordParts(holder, "grant").kept, [], "a holder has the skill already, so no throw is granted");
});

t("silent step: a blank set target still writes the grant (null, shown as a dash), and a blank bonus is told", () => {
  const made = modParts(keyed(ID.silent), { level: 3 });
  assert.deepEqual(made.parts.map((p) => [p.key, p.on, p.mode, p.value]), [["grant", "grant", "set", null]]);
  assert.deepEqual(made.blank, ["bonus"]);
  assert.equal(made.parts[0].ref, "def.skill.sneaking");
});

t("a row that exempts above a size leaves a larger recipient out and a man-sized or smaller one in; an unread size gates nothing", () => {
  const row = asRow(rowOf(ID.chameleon, "bonus"), { exemptSizeOver: "man" });
  const creature = (size) => bearerOf([], { size, type: "monster" });
  const gate = (actor, r = row) => targetGate({ actor, row: r, level: 3 });
  assert.equal(gate(creature("small")).affected, true);
  assert.equal(gate(creature("man")).affected, true, "the size itself is in");
  const large = gate(creature("large"));
  assert.deepEqual([large.affected, large.why.key, large.why.parts.map((p) => p.key)], [false, "size", ["size", "over"]]);
  assert.equal(gate(bearerOf([])).affected, true, "a character is man-sized");
  assert.equal(gate(creature("colossal"), asRow(rowOf(ID.chameleon, "bonus"))).affected, true, "no size read, no gate");
});

/* ------------------------------------------------------------------ */
/*  Leaping                                                            */
/* ------------------------------------------------------------------ */

t("leaping: a bonus on the held Acrobatics throw, and the distances a line for the Judge (they wait for formation)", () => {
  const [bonus, distances] = specsOf(ID.leaping);
  assert.deepEqual([bonus.type, bonus.mode, bonus.refs, bonus.ifHas, bonus.appliesToRoll], ["modifies", "add", ["kw:acrobatics"], undefined, undefined]);
  assert.deepEqual([distances.type, distances.saveEffect, !!distances.noteFrom?.pattern], ["limitation", "none", true]);
  assert.equal(isModRow(distances), false);
  assert.equal(kindOf(distances.type), null);
  assert.equal(describeSpellEffect(asRow(distances)).text, "—");
  assert.equal(describeSpellEffect(asRow(distances, { note: "an invented clause" })).text, "an invented clause");
  const made = modParts(keyed(ID.leaping, { bonus: { value: flat(4) } }), { level: 3 });
  assert.deepEqual(made.parts.map((p) => [p.on, p.value, p.refs]), [["throw", 4, ["kw:acrobatics"]]]);
  const bearer = bearerOf(made.parts);
  assert.equal(throwResolution(bearer, { subject: { id: "def.prof.acrobatics", provides: [] } }).total, 4);
  assert.equal(throwResolution(bearer, { subject: { id: "def.prof.other", provides: [] } }).total, 0, "another proficiency's throw is not moved");
});

/* ------------------------------------------------------------------ */
/*  Pass without trace                                                 */
/* ------------------------------------------------------------------ */

t("pass without trace: a grant of the proficiency with no throw; its level is the bearer's until a fraction is stored (owner question)", () => {
  const [grant] = specsOf(ID.trace);
  assert.deepEqual([grant.type, grant.ref, grant.mode, grant.lasts], ["grants", "def.prof.passingWithoutTrace", undefined, "duration"]);
  assert.deepEqual(grant.from.map((l) => l.into), ["exemptSizeOver"], "no atLevel locator: the page states the caster's level with no figure to read");
  const plain = modParts(keyed(ID.trace), { level: 6 });
  assert.deepEqual(plain.parts.map((p) => [p.on, p.ref, p.mode ?? null, p.atLevel ?? null]), [["grant", "def.prof.passingWithoutTrace", null, null]]);
  const stored = modParts(keyedRows([asRow(grant, { atLevelNum: 1, atLevelDen: 1 })]), { level: 6 });
  assert.deepEqual(stored.parts[0].atLevel?.value, 6, "once a whole-level pair is stored the part carries the caster's level");
});

/* ------------------------------------------------------------------ */
/*  Spider climbing                                                    */
/* ------------------------------------------------------------------ */

t("spider climbing: the proficiency for a bearer without it, an automatic throw for one who has it, and a line for the rest of the clause", () => {
  const [grant, auto, line] = specsOf(ID.spider);
  assert.deepEqual([grant.type, grant.ref, grant.mode], ["grants", "def.prof.climbing", undefined]);
  assert.deepEqual([auto.type, auto.target, auto.mode, auto.refs, auto.ifHas], ["modifies", "proficiencyThrow", "auto", ["kw:climbing"], ["kw:climbing"]]);
  assert.deepEqual([line.type, isModRow(line)], ["limitation", false]);
  const made = modParts(keyed(ID.spider), { level: 5 });
  assert.deepEqual(made.parts.map((p) => [p.key, p.on, p.mode ?? null, p.value ?? null]), [["grant", "grant", null, null], ["auto", "throw", "auto", null]]);
  const subject = { id: "def.skill.climbing", provides: [] };
  const lacking = bearerOf(made.parts);
  assert.deepEqual(recordParts(lacking, "grant").kept.map((p) => p.refTo), ["def.prof.climbing"]);
  assert.equal(throwResolution(lacking, { subject }).outcome, "throw", "no Climbing held: the granted throw is rolled, not automatic");
  const holder = bearerOf(made.parts, { provides: ["kw:climbing"] });
  assert.deepEqual(recordParts(holder, "grant").kept, []);
  assert.deepEqual([throwResolution(holder, { subject }).outcome, throwResolution(holder, { subject }).auto?.spell], ["auto", "Testbuff"]);
  assert.equal(throwResolution(holder, { subject: { id: "def.skill.hiding", provides: [] } }).outcome, "throw", "another skill's throw is not automatic");
});

/* ------------------------------------------------------------------ */
/*  Slickness                                                          */
/* ------------------------------------------------------------------ */

t("slickness: one pick group of three options; the floor option is a recurring failed-save prone with its own lines, the creature option an immunity", () => {
  const rows = keyed(ID.slick);
  const groups = pickGroups(rows.map((r) => r.row), "normal");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options.map((o) => [o.token, o.rows.map((r) => r.key)]), [["objects", ["objects"]], ["floor", ["floor", "footing", "armour"]], ["creature", ["willing"]]]);
  const floor = rowOf(ID.slick, "floor");
  assert.deepEqual([floor.type, floor.appliesTo, floor.conditions, floor.untimed, floor.saveEffect, floor.lasts], ["conditionGrant", "area", ["prone"], ["prone"], "negates", "duration"]);
  assert.deepEqual([floor.recur, floor.recurAt, floor.recurSave, floor.recurTarget], ["laterRounds", "bearerStart", "fail", undefined]);
  assert.equal(awaitsFail(floor), true, "the cast writes only its anchor; a failed press writes prone");
  assert.equal(rowOpens(asRow(floor)), true);
  const willing = rowOf(ID.slick, "willing");
  assert.deepEqual([willing.type, willing.conditions, willing.saveEffect, willing.lasts], ["immunity", ["grabbed", "restrained", "stuck", "wrestled"], "none", "duration"]);
  assert.equal(willing.refs, undefined);
});

t("slickness: the cast keeps one option's rows; the lines are the Judge's, and the spell-wide save is the category read from the page", () => {
  const rows = keyed(ID.slick);
  const keep = (use) => rowsForMode(rows.map((r) => r.row), "normal", { use }).map(({ key }) => key);
  assert.deepEqual([keep("objects"), keep("floor"), keep("creature")], [["objects"], ["floor", "footing", "armour"], ["willing"]]);
  for (const key of ["objects", "footing", "armour"]) {
    const spec = rowOf(ID.slick, key);
    assert.deepEqual([spec.type, spec.saveEffect, !!spec.noteFrom?.pattern, isModRow(spec)], ["limitation", "none", true, false]);
  }
  assert.deepEqual(valuesOf(ID.slick).map((v) => [v.target, v.save, (v.from ?? []).map((l) => l.into)]), [[{ model: "area", area: { shape: "cube" } }, { effect: "negates", kind: "save", perTarget: true }, ["save.category"]]]);
});

t("slickness: the willing-creature row is an immune part naming the grapple conditions, which a record on the bearer answers to lib's reader", () => {
  const made = modParts(keyed(ID.slick).filter(({ key }) => key === "willing"), { level: 3 });
  assert.deepEqual(made.parts.map((p) => [p.on, p.conditions, p.spells ?? null, "value" in p]), [["immune", ["grabbed", "restrained", "stuck", "wrestled"], null, false]]);
  assert.equal(made.lasting, true);
  const bearer = bearerOf(made.parts);
  const found = recordImmunity(bearer, { conditions: ["grabbed", "wrestled", "prone"] });
  assert.deepEqual(Object.keys(found.conditions).sort(), ["grabbed", "wrestled"], "prone is not a grapple condition");
});

t("slickness: the floor writes no buff part, and an unrelated row stays out of the buff", () => {
  const made = modParts(keyed(ID.slick).filter(({ key }) => key !== "willing"), { level: 3 });
  assert.deepEqual([made.parts, made.blank], [[], []]);
  assert.equal(isModRow(rowOf(ID.slick, "floor")), false);
});

console.log(`\n${n} tests passed`);
