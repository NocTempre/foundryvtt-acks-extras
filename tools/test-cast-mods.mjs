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

const { ROW_ON, isModRow, modifierFigure, needsBearer, modParts, modRecordData, dryYields } = await import("../scripts/magic/cast-mods.mjs");
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
  assert.deepEqual(ROW_ON, { attackThrow: "attack", damage: "damage", ac: "ac", save: "save" });
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

console.log(`\n${n} cast-mods tests passed`);
