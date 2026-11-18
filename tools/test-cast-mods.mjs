/**
 * Offline tests for a cast's buff (`scripts/magic/cast-mods.mjs`): which rows
 * become parts of the one record a recipient takes, what each part carries,
 * and the dry run of what would yield. Foundry-free; every spell, row, weapon
 * and figure below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-mods.mjs
 */
import assert from "node:assert/strict";

globalThis.game = { i18n: { format: (key, data = {}) => `${key} ${JSON.stringify(data)}`, localize: (key) => key }, system: { id: "acks" } };

const { ROW_ON, isModRow, modifierFigure, needsBearer, modParts, modRecordData, dryYields, ownSaveRows, isOwnSaveRow } = await import("../scripts/magic/cast-mods.mjs");
const { SPELL_RECORD_CAP } = await import("../scripts/magic/constants.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { registerItemBonusSource } = await import("../scripts/lib/roll-mods.mjs");
const { castVerdicts, blocked } = await import("../scripts/magic/cast-plan.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const keyed = (row, key = row.key) => ({ row, key });
const mod = (over = {}) => ({ key: "edge", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 2, lasts: "duration", ...over });
const ward = (over = {}) => ({ key: "circle", type: "ward", appliesTo: "recipient", lasts: "duration", vsAlignment: "chaotic", ...over });

t("only a row that waits for a roll is a part; a standing figure, an unlisted target and the opponent's row are lines", () => {
  const rows = [
    keyed(mod({ key: "scoped", target: "ac", vsKinds: ["undead"] })),
    keyed(mod({ key: "plain" })),
    keyed(mod({ key: "init", target: "initiative", vsKinds: ["undead"] })),
    keyed(mod({ key: "theirs", appliesTo: "opponent", vsKinds: ["undead"] })),
    keyed({ key: "mend", type: "heal", roll: "1d6" }),
  ];
  const out = modParts(rows, { level: 3 });
  assert.deepEqual(out.parts.map((p) => [p.key, p.on]), [["scoped", "ac"]]);
  assert.deepEqual(out.lines.map((l) => l.key), ["plain", "init", "theirs"], "an unscoped, ungated modifier is a standing figure for a character");
  assert.equal(isModRow(rows[4].row), false);
  assert.deepEqual(ROW_ON, { attackThrow: "attack", damage: "damage", ac: "ac", save: "save", proficiencyThrow: "throw", reaction: "reaction", grant: "grant" });
});

t("a blank figure writes no part and is told by its key; a level-scaled figure needs a level", () => {
  const scaled = mod({ key: "grows", target: "save", vsKinds: ["undead"], value: { kind: "perLevel", base: 1, per: 1 } });
  const blank = mod({ key: "unread", target: "save", vsKinds: ["undead"], value: { kind: "flat", flat: null } });
  const out = modParts([keyed(scaled), keyed(blank)], { level: 4 });
  assert.deepEqual(out.parts.map((p) => [p.key, p.value]), [["grows", 4]]);
  assert.deepEqual(out.blank, ["unread"]);
  assert.equal(modParts([keyed(scaled)], { level: null }).parts.length, 0, "no level, no figure");
  assert.deepEqual(modParts([keyed(scaled)], { level: null }).blank, ["grows"]);
  assert.equal(modifierFigure({ value: 3 }), 3);
  assert.equal(modifierFigure({ value: { flat: 2 } }), 2);
  assert.equal(modifierFigure({ value: { kind: "flat", flat: 0 } }), 0, "a printed zero is a figure");
  assert.equal(modifierFigure({}), null);
});

t("every part provides the spell-record capability, with the row's own provides after it", () => {
  const out = modParts([keyed(mod({ key: "a", target: "ac", vsKinds: ["undead"], provides: ["kw:testprot"] })), keyed(ward())], {});
  assert.deepEqual(out.parts[0].provides, [SPELL_RECORD_CAP, "kw:testprot"]);
  assert.deepEqual(out.parts[1].provides, [SPELL_RECORD_CAP]);
});

t("an item-gated row carries the weapon's id and no other row does; with no weapon named it is a line", () => {
  registerItemBonusSource(() => []);
  const mundane = mod({ key: "mundane", gate: { kind: "weaponMundane" }, notStacksWith: ["kw:masterwork"] });
  const magic = mod({ key: "magic", gate: { kind: "weaponMagical" }, value: 1 });
  const scoped = mod({ key: "scoped", target: "ac", vsKinds: ["undead"] });
  assert.equal(needsBearer([keyed(mundane), keyed(scoped)]), true);
  assert.equal(needsBearer([keyed(scoped), keyed(ward())]), false);
  const named = modParts([keyed(mundane), keyed(magic), keyed(scoped)], { itemId: "w1" });
  assert.deepEqual(named.parts.map((p) => [p.key, p.itemId ?? null]), [["mundane", "w1"], ["magic", "w1"], ["scoped", null]]);
  assert.deepEqual(named.parts[0].notStacksWith, ["kw:masterwork"]);
  assert.deepEqual(named.parts[0].gate, { kind: "weaponMundane" });
  const none = modParts([keyed(mundane), keyed(magic), keyed(scoped)], {});
  assert.deepEqual(none.parts.map((p) => p.key), ["scoped"]);
  assert.deepEqual(none.lines.map((l) => l.key), ["mundane", "magic"]);
});

t("a ward part carries its scope and no figure, and the scope fields are copied as plain data", () => {
  const circle = ward({ vsKinds: ["undead"], vsAlignmentOf: "source", vsAlignmentMode: "except", vsEnemy: true, anyOf: [{ vsKinds: ["demon"], vsEnemy: true }, { vsAlignment: "lawful" }] });
  const [part] = modParts([keyed(circle)], {}).parts;
  assert.equal(part.on, "ward");
  assert.equal("value" in part, false);
  assert.deepEqual(part.vsKinds, ["undead"]);
  assert.equal(part.vsAlignment, "chaotic");
  assert.equal(part.vsAlignmentOf, "source");
  assert.equal(part.vsAlignmentMode, "except");
  assert.equal(part.vsEnemy, true);
  assert.deepEqual(part.anyOf, [{ vsKinds: ["demon"], vsEnemy: true }, { vsAlignment: "lawful" }]);
  assert.deepEqual(modParts([keyed(ward({ appliesTo: "ally" }))], {}).lines.map((l) => l.key), ["circle"], "a subject that is not the bearer's is a line");
});

t("the record carries lib's flag with the caster's alignment, holds no status and no change, and is timed only where its rows last", () => {
  const rows = [keyed(mod({ key: "scoped", target: "ac", vsKinds: ["undead"] })), keyed(ward())];
  const made = modParts(rows, { level: 2 });
  const card = { castId: "cast1", casterUuid: "Actor.c1" };
  const spell = { uuid: "Actor.c1.Item.s1", name: "Testward", img: "i.png", id: "def.spell.testWard", cite: "p. 9" };
  const data = modRecordData(card, made.parts, { spell, startTime: 100, sourceAlignment: "lawful", duration: { value: 60, units: "seconds" }, lasting: made.lasting, item: { id: "w1", name: "Testblade" } });
  assert.deepEqual(data.changes, []);
  assert.equal(data.statuses, undefined);
  const flag = data.flags["acks-extras"].rollMods;
  assert.deepEqual([flag.id, flag.label, flag.cite, flag.sourceAlignment], ["def.spell.testWard", "Testward", "p. 9", "lawful"]);
  assert.equal(flag.parts.length, 2);
  const read = spellEffectOf(data);
  assert.deepEqual([read.role, read.startTime, read.duration, read.item], ["recipient", 100, { value: 60, units: "seconds" }, { id: "w1", name: "Testblade" }]);
  assert.equal(read.rollMods.parts.length, 2);
  const instant = modRecordData(card, made.parts, { spell, startTime: 100, duration: { value: 60, units: "seconds" }, lasting: false });
  assert.equal(spellEffectOf(instant).duration, undefined, "rows that do not last leave the record untimed");
  assert.equal(instant.duration, undefined);
  const untimed = modRecordData(card, made.parts, { spell, startTime: 100, duration: { none: "untimed" }, lasting: true });
  assert.equal(spellEffectOf(untimed).duration, undefined);
  assert.equal(modRecordData(card, [], { spell, startTime: 1 }), null, "no parts, no record");
});

t("the dry run says which part would yield to the weapon's own bonus, by the weapon's own gate", () => {
  const off = registerItemBonusSource((item, on) => (on === "attack" ? [{ key: "fine", label: "Test fine", value: 2, provides: ["kw:masterwork"], cite: "c" }] : []));
  const item = { id: "w1", name: "Testblade", type: "weapon", flags: {}, parent: { items: [] } };
  const spell = { id: "def.spell.testEdge", name: "Testedge", cite: "p. 1" };
  const rows = [
    keyed(mod({ key: "mundane", gate: { kind: "weaponMundane" }, value: 1, notStacksWith: ["kw:masterwork"] })),
    keyed(mod({ key: "magic", gate: { kind: "weaponMagical" }, value: 5 })),
  ];
  const { parts } = modParts(rows, { itemId: "w1" });
  const bearer = { effects: [], appliedEffects: [] };
  assert.deepEqual(dryYields(parts, { item, bearer, spell }), { mundane: "Test fine" }, "the weapon is mundane: only the mundane row is read, and it is smaller than the weapon's figure");
  const bigger = modParts([keyed(mod({ key: "mundane", gate: { kind: "weaponMundane" }, value: 3, notStacksWith: ["kw:masterwork"] }))], { itemId: "w1" });
  assert.deepEqual(dryYields(bigger.parts, { item, bearer, spell }), {}, "a larger figure keeps its place");
  assert.deepEqual(dryYields(parts, { item: null, bearer, spell }), {}, "no weapon, nothing to read");
  const standing = {
    id: "fx1",
    disabled: false,
    flags: { "acks-extras": { rollMods: { id: "def.spell.testOther", label: "Test other", cite: "", sourceAlignment: null, parts: [{ key: "o", on: "attack", value: 4, itemId: "w1", gate: { kind: "weaponMundane" }, provides: [SPELL_RECORD_CAP] }] } } },
  };
  const twice = dryYields(bigger.parts, { item, bearer: { effects: [standing], appliedEffects: [standing] }, spell });
  assert.deepEqual(twice, { mundane: "Test other" }, "a second spell record's larger figure takes the place");
  off();
});

t("a cast that names a weapon needs exactly one bearer: a Player is blocked and a Judge warned", () => {
  const rows = [keyed(mod({ gate: { kind: "weaponMundane" } }))];
  const ok = { capacity: { verdict: "ok" }, rows };
  assert.deepEqual(castVerdicts({ ...ok, targets: [1], isGM: false }), []);
  const none = castVerdicts({ ...ok, targets: [], isGM: false });
  assert.deepEqual(none.map((v) => [v.key, v.severity]), [["oneBearer", "block"]]);
  assert.equal(blocked(none), true);
  const several = castVerdicts({ ...ok, targets: [1, 2], isGM: true });
  assert.deepEqual(several.map((v) => [v.key, v.severity]), [["oneBearer", "warn"]]);
  assert.equal(blocked(several), false);
  assert.deepEqual(castVerdicts({ capacity: { verdict: "ok" }, rows: [keyed(ward())], targets: [], isGM: false }), [], "a row with no weapon needs no bearer");
});

t("a ward part carries the spell's save category where a saving throw governs its row, and none where it does not", () => {
  const spellSave = { category: "spell", effect: "negates" };
  const partOf = (row, save) => modParts([keyed(row)], { level: 2, save }).parts[0];
  assert.equal(partOf(ward(), spellSave).save, "spell", "the attacker's save is named");
  assert.equal(partOf(ward({ saveEffect: "none" }), spellSave).save, undefined, "a row no save governs names none");
  assert.equal(partOf(ward({ saveEffect: "half" }), { category: "spell", effect: "none" }).save, "spell", "the row's own effect wins over the spell's");
  assert.equal(partOf(ward(), { category: "spell", effect: "none" }).save, undefined, "the spell's own none governs nothing");
  assert.equal(partOf(ward(), { category: "none", effect: "negates" }).save, undefined, "a category of none");
  assert.equal(partOf(ward(), { category: "spell", effect: "negates", kind: "attack" }).save, undefined, "an attack-kind save is no saving throw");
  assert.equal(partOf(ward(), null).save, undefined, "no spell save");
  assert.equal(modParts([keyed(mod({ key: "scoped", target: "ac", vsKinds: ["undead"] }))], { level: 2, save: spellSave }).parts[0].save, undefined, "only a ward part carries it");
});

const { endedBy } = await import("../scripts/lib/ends-on.mjs");

t("the buff record carries the causes its rows end on, once each, at lib's flag where lib finds them by id", () => {
  const rows = [keyed(ward({ endsOn: ["attack"] })), keyed(mod({ key: "scoped", target: "ac", vsKinds: ["undead"], endsOn: ["damage"] })), keyed(ward({ key: "plain" }))];
  const made = modParts(rows, { level: 2 });
  assert.deepEqual(made.endsOn, ["attack", "damage"]);
  const card = { castId: "cast1", casterUuid: "Actor.c1" };
  const spell = { uuid: "Actor.c1.Item.s1", name: "Testward", img: "i.png" };
  const data = modRecordData(card, made.parts, { spell, startTime: 100, endsOn: made.endsOn });
  assert.deepEqual(data.flags["acks-extras"].endsOn, ["attack", "damage"]);
  const effect = { id: "e1", flags: data.flags };
  assert.deepEqual([endedBy([effect], "attack"), endedBy([effect], "damage"), endedBy([effect], "moved")], [["e1"], ["e1"], []]);
  const none = modRecordData(card, modParts([keyed(ward())], {}).parts, { spell, startTime: 100, endsOn: modParts([keyed(ward())], {}).endsOn });
  assert.equal("endsOn" in none.flags["acks-extras"], false, "a row that ends on nothing writes no flag");
});


/* ---------------------------------------------------------------------- */
/*  S5b: the row kinds a record's readers take                             */
/* ---------------------------------------------------------------------- */

const { recordParts, throwResolution, recordImmunity } = await import("../scripts/lib/roll-mods.mjs");
const { saveSpec } = await import("../scripts/lib/saves.mjs");
const { modifierDisposition, DISPOSITION } = await import("../scripts/lib/typed-modifiers.mjs");

/** An actor carrying the record one cast's parts wrote, as lib's readers see it. */
const bearerOf = (parts, { id = "def.spell.testBuff", statuses = [], name = "Bearer", saves = { death: { value: 12 }, spell: { value: 14 } } } = {}) => {
  const effect = { id: "fxbuff", disabled: false, flags: { "acks-extras": { rollMods: { id, label: "Testbuff", cite: "T 1", sourceAlignment: null, parts } } } };
  return { name, type: "character", effects: [effect], appliedEffects: [effect], statuses: new Set(statuses), system: { saves, save: { mod: 0 }, scores: { wis: { mod: 0 } }, details: { level: 3 } }, getFlag: () => undefined };
};

t("a set row on armour class keeps its mode and its attack kinds, and is a part (modifierDisposition: set, narrowed, gate)", () => {
  const set = mod({ key: "worn", target: "ac", mode: "set", value: 7, attackKinds: ["melee"], appliesTo: "recipient" });
  const reasons = (row) => modifierDisposition(row, { actorType: "character", bearer: true });
  assert.equal(reasons(set).reason, "set");
  const narrowed = mod({ key: "kinds", target: "attackThrow", attackKinds: ["missile", "thrown"] });
  assert.deepEqual([reasons(narrowed).kind, reasons(narrowed).reason], [DISPOSITION.AT_ROLL, "narrowed"]);
  const gated = mod({ key: "sick", target: "damage", gate: { kind: "status", status: "weakened" } });
  assert.deepEqual([reasons(gated).kind, reasons(gated).reason], [DISPOSITION.AT_ROLL, "gate"]);
  const out = modParts([keyed(set), keyed(narrowed), keyed(gated)], { level: 3 });
  assert.deepEqual(out.parts.map((p) => p.key), ["worn", "kinds", "sick"]);
  assert.equal(out.parts[0].mode, "set");
  assert.deepEqual(out.parts[0].attackKinds, ["melee"]);
  assert.deepEqual(out.parts[1].attackKinds, ["missile", "thrown"]);
  assert.deepEqual(out.parts[2].gate, { kind: "status", status: "weakened" });
  assert.equal(out.parts[1].mode, undefined, "a row with no mode writes none");
});

t("an attackKinds part reaches lib's reader for its kinds only, and a set part is told by its mode", () => {
  const out = modParts([keyed(mod({ key: "worn", target: "ac", mode: "set", value: 7, attackKinds: ["melee"] }))], { level: 3 });
  const bearer = bearerOf(out.parts);
  assert.deepEqual(recordParts(bearer, "ac", { kind: "melee" }).kept.map((p) => [p.key, p.mode]), [["worn", "set"]]);
  assert.deepEqual(recordParts(bearer, "ac", { kind: "missile" }).kept, [], "a missile attack does not meet the melee set");
});

t("a save row narrowed by forWhat is written as saves; a word that is no saving throw leaves it a line, never an unnarrowed part", () => {
  const death = mod({ key: "dying", target: "save", forWhat: "Death", value: 2, gate: { kind: "status", status: "weakened", occasion: true } });
  const odd = mod({ key: "odd", target: "save", forWhat: "against nothing in particular", value: 2 });
  const all = mod({ key: "every", target: "save", value: 1, vsKinds: ["undead"] });
  const out = modParts([keyed(death), keyed(odd), keyed(all)], { level: 3 });
  assert.deepEqual(out.parts.map((p) => p.key), ["dying", "every"]);
  assert.deepEqual(out.parts[0].saves, ["death"]);
  assert.deepEqual(out.parts[0].gate, { kind: "status", status: "weakened", occasion: true }, "the occasion mark rides on the gate");
  assert.equal(out.parts[1].saves, undefined);
  assert.deepEqual(out.lines.map((l) => l.key), ["odd"]);
});

t("a modifies row on a proficiency's throw is a throw part with its refs, roll key and ifHas, and applies only to the throw named", () => {
  const row = { key: "leap", type: "modifies", target: "proficiencyThrow", appliesTo: "recipient", refs: ["kw:testleaping"], appliesToRoll: "jump", ifHas: ["kw:testfit"], value: 3, lasts: "duration" };
  const out = modParts([keyed(row)], { level: 3 });
  assert.equal(isModRow(row), true);
  assert.deepEqual([out.parts[0].on, out.parts[0].value, out.parts[0].refs, out.parts[0].rollKey, out.parts[0].ifHas], ["throw", 3, ["kw:testleaping"], "jump", ["kw:testfit"]]);
  assert.ok(out.parts[0].provides.includes(SPELL_RECORD_CAP));
  const prof = { id: "def.prof.testLeaping", provides: ["kw:testleaping"] };
  assert.equal(throwResolution(bearerOf(out.parts), { subject: prof, rollKey: "jump" }).total, 0, "the bearer lacks the ifHas capability, so the part does not apply");
  const free = modParts([keyed({ ...row, ifHas: [] })], { level: 3 });
  assert.equal(throwResolution(bearerOf(free.parts), { subject: prof, rollKey: "jump" }).total, 3);
  assert.equal(throwResolution(bearerOf(free.parts), { subject: { id: "def.prof.testOther", provides: [] }, rollKey: "jump" }).total, 0, "another proficiency");
  assert.equal(throwResolution(bearerOf(free.parts), { subject: prof, rollKey: "other" }).total, 0, "another roll key");
});

t("a modifier row on a proficiency's throw or a reaction is admitted; a throw with no ref is a line; a blank figure is blank", () => {
  const throwRow = mod({ key: "t", target: "proficiencyThrow", refs: ["kw:testprof"], value: 1 });
  const bare = mod({ key: "nameless", target: "proficiencyThrow", value: 1 });
  const react = mod({ key: "r", target: "reaction", value: 1, ifHas: ["kw:testaura"] });
  const blankThrow = mod({ key: "b", target: "proficiencyThrow", refs: ["kw:testprof"], value: { kind: "flat", flat: null } });
  const morale = mod({ key: "m", target: "morale", value: 1 });
  const out = modParts([keyed(throwRow), keyed(bare), keyed(react), keyed(blankThrow), keyed(morale)], { level: 3 });
  assert.deepEqual(out.parts.map((p) => [p.key, p.on]), [["t", "throw"], ["r", "reaction"]]);
  assert.deepEqual(out.parts[1].ifHas, ["kw:testaura"]);
  assert.deepEqual(out.lines.map((l) => l.key), ["nameless", "m"]);
  assert.deepEqual(out.blank, ["b"]);
});

t("a grant writes its ref and mode with a blank figure kept null, an auto throw writes no figure, and atLevel is the caster level at the row's own fraction", () => {
  const grant = { key: "climb", type: "grants", appliesTo: "recipient", ref: "def.prof.testClimbing", lasts: "duration" };
  const set = { ...grant, key: "hide", ref: "def.prof.testHiding", mode: "set", value: { kind: "flat", flat: null } };
  const scaled = { ...grant, key: "trace", ref: "def.prof.testTrace", atLevelNum: 1, atLevelDen: 2 };
  const auto = mod({ key: "free", target: "proficiencyThrow", refs: ["def.prof.testClimbing"], mode: "auto" });
  const nameless = { key: "none", type: "grants", appliesTo: "recipient" };
  const out = modParts([keyed(grant), keyed(set), keyed(scaled), keyed(auto), keyed(nameless)], { level: 6 });
  assert.deepEqual(out.parts.map((p) => [p.key, p.on, p.ref ?? null, p.value ?? null, p.mode ?? null]), [
    ["climb", "grant", "def.prof.testClimbing", null, null],
    ["hide", "grant", "def.prof.testHiding", null, "set"],
    ["trace", "grant", "def.prof.testTrace", null, null],
    ["free", "throw", null, null, "auto"],
  ]);
  assert.deepEqual(out.parts[2].atLevel, { value: 3, parts: [{ key: "level", value: 6 }, { key: "fraction", value: 0.5 }] });
  assert.equal(out.parts[0].atLevel, undefined, "a grant that states no fraction carries no level");
  assert.equal(modParts([keyed(scaled)], { level: null }).parts[0].atLevel, undefined, "no level, no atLevel");
  assert.deepEqual(out.lines.map((l) => l.key), ["none"]);
});

t("an immunity row is an immune part by its spells and conditions; one naming neither stays a line; lib reads it", () => {
  const both = { key: "willing", type: "immunity", appliesTo: "recipient", refs: ["def.spell.testSlick"], conditions: ["prone", "paralysis"], lasts: "duration" };
  const damageOnly = { key: "fireproof", type: "immunity", appliesTo: "recipient", damage: ["fire"] };
  const out = modParts([keyed(both), keyed(damageOnly)], { level: 3 });
  assert.deepEqual(out.parts.map((p) => [p.on, p.spells, p.conditions, "value" in p]), [["immune", ["def.spell.testSlick"], ["prone", "paralysis"], false]]);
  assert.deepEqual(out.lines.map((l) => l.key), ["fireproof"]);
  const found = recordImmunity(bearerOf(out.parts), { spell: { id: "def.spell.testSlick", provides: [] }, conditions: ["prone", "sleep"] });
  assert.ok(found.spell);
  assert.deepEqual(Object.keys(found.conditions), ["prone"]);
});

t("a pickKind row is narrowed to the one kind chosen, the row's first where none is, and never to a kind it does not list", () => {
  const row = (key, target) => mod({ key, target, pickKind: true, vsKinds: ["undead", "beast", "fey"], value: 2, gate: { kind: "weaponMundane" } });
  const rows = [keyed(row("hit", "attackThrow")), keyed(row("dmg", "damage"))];
  const chosen = modParts(rows, { level: 3, itemId: "w1", kind: "beast" });
  assert.deepEqual(chosen.parts.map((p) => p.vsKinds), [["beast"], ["beast"]]);
  assert.deepEqual(chosen.kind, { key: "beast", authored: ["undead", "beast", "fey"], defaulted: false });
  const dflt = modParts(rows, { level: 3, itemId: "w1" });
  assert.deepEqual([dflt.parts[0].vsKinds, dflt.kind.key, dflt.kind.defaulted], [["undead"], "undead", true]);
  const forged = modParts(rows, { level: 3, itemId: "w1", kind: "dragon" });
  assert.deepEqual([forged.parts[0].vsKinds, forged.kind.defaulted], [["undead"], true], "a kind the rows do not list is not taken");
  assert.equal(modParts([keyed(mod({ key: "plain", vsKinds: ["undead"], target: "ac" }))], { level: 3 }).kind, null);
});

t("a modifier on the spell's own save is no record part; its rows reach saveSpec for each saver, lowering the target where they hold and listing where they cannot be told", () => {
  const rowGate = mod({ key: "slow", target: "save", ownSave: true, value: -2, gate: { kind: "status", status: "weakened" } });
  const rowFree = mod({ key: "free", target: "save", ownSave: true, forWhat: "Death", value: 3 });
  const rowOther = mod({ key: "elsewhere", target: "save", ownSave: true, forWhat: "Paralysis", value: 9 });
  const rowOccasion = mod({ key: "wait", target: "save", ownSave: true, value: 4, gate: { kind: "status", status: "weakened", occasion: true } });
  const rows = [keyed(rowGate), keyed(rowFree), keyed(rowOther), keyed(rowOccasion)];
  assert.equal(isOwnSaveRow(rowGate), true);
  assert.deepEqual(modParts(rows, { level: 3 }).parts, [], "none of them is a part of any record");
  const own = ownSaveRows(rows, { level: 3, label: "Testspell", cite: "T 2" });
  assert.deepEqual(own.map((r) => r.key), ["slow", "free", "elsewhere", "wait"]);
  assert.deepEqual(own[1].saves, ["death"]);
  const well = saveSpec(bearerOf([]), "death", { ownRows: own });
  assert.deepEqual([well.baseTarget, well.target], [12, 9], "off: the gated rows add nothing, the open row lowers the target by 3, the paralysis row misses a death save");
  const weak = saveSpec(bearerOf([], { statuses: ["weakened"] }), "death", { ownRows: own });
  assert.equal(weak.target, 12 + 2 - 3, "the held gate adds its figure as written, so a penalty raises the target");
  assert.deepEqual(weak.pending.map((p) => [p.label, p.when]), [["Testspell (T 2)", "gate"]], "an occasion no roller names is pending and not in the number");
  assert.equal(weak.parts.some((p) => p.key === "wait"), false);
  assert.deepEqual(ownSaveRows([keyed(mod({ key: "unread", target: "save", ownSave: true, value: { kind: "flat", flat: null } }))], { level: 3 }), []);
});

console.log(`\n${n} cast-mods tests passed`);
