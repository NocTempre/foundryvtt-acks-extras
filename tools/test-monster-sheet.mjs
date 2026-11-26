/**
 * Pure-logic regression tests for the Full Monster sheet's Statblock model.
 * No Foundry: the snapshot is built by hand, so these assert the decisions
 * the frame makes — the band's rating, the rail readings, the load bar, the
 * dashboard's rows and ids and which of them roll or post, and the pins —
 * rather than what a running world happens to render. Every figure is
 * invented fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  hdRating, bodyFormIcon, BODY_FORM_ICONS, DEFAULT_GLYPH, feet, moveReading, sensesReading, loadReading, statblockColumns, rollRows, attackReading, attackRowOf,
} from "../scripts/monsters/statblock.mjs";
import { printKey } from "../scripts/importer/printed-name.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/** A localizer that returns the key with its data, so a row's words can be asserted without a language file. */
const loc = (key, data) => (data ? `${key}:${JSON.stringify(data)}` : key);

console.log("monster sheet: the band");
test("the Hit Dice rating prints count, range, signed bonus and asterisks", () => {
  assert.equal(hdRating({ count: 4 }), "4");
  assert.equal(hdRating({ count: 4, bonus: 1 }), "4+1");
  assert.equal(hdRating({ count: 4, bonus: -1, asterisks: 2 }), "4−1 **");
  assert.equal(hdRating({ count: 5, countMax: 12 }), "5–12");
  assert.equal(hdRating({ count: 5, countMax: 5 }), "5", "a range that collapses prints one count");
});
test("no count means no rating, so the band falls back to the formula", () => {
  assert.equal(hdRating({}), null);
  assert.equal(hdRating({ count: "" }), null);
});
test("a body form with no glyph wears the paw, and so does no form", () => {
  const icons = { [printKey("zorvine")]: "fa-solid fa-test" };
  assert.equal(bodyFormIcon("no-such-form", icons), DEFAULT_GLYPH);
  assert.equal(bodyFormIcon(undefined, icons), DEFAULT_GLYPH);
  assert.equal(bodyFormIcon("", icons), DEFAULT_GLYPH);
});
test("a body form's glyph is found by the hash of its key, however the key is cased or spaced", () => {
  const icons = { [printKey("zorvine")]: "fa-solid fa-test" };
  assert.equal(bodyFormIcon("zorvine", icons), "fa-solid fa-test");
  assert.equal(bodyFormIcon("Zor-Vine", icons), "fa-solid fa-test");
});
test("the glyph map is keyed by hashes, each naming one Font Awesome glyph", () => {
  const entries = Object.entries(BODY_FORM_ICONS);
  assert.ok(entries.length > 0);
  for (const [key, glyph] of entries) {
    assert.match(key, /^[0-9a-z]{4,7}$/, "a base-36 hash of a folded name");
    assert.match(glyph, /^fa-solid fa-[a-z-]+$/);
  }
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
});

console.log("monster sheet: the right rail");
test("the movement cell reads the row in force, falling back to the first", () => {
  const speeds = [{ type: "ground", combat: 40, run: 120 }, { type: "fly", combat: 60, run: 180 }];
  assert.equal(moveReading(speeds, 0).sub, "40′");
  assert.equal(moveReading(speeds, 1).sub, "60′");
  assert.equal(moveReading(speeds, 7).index, 0, "an index past the rows takes the first");
  assert.equal(moveReading([{ type: "swim", run: 90 }]).sub, "90′", "no combat figure reads the run");
});
test("no speeds is a pad", () => {
  assert.deepEqual(moveReading([]), { row: null, index: -1, sub: "", pad: true });
});
test("the senses cell prints the lightless range alone, and pads with nothing recorded", () => {
  assert.equal(sensesReading({ vision: ["lightless"], lightlessRange: 60 }).sub, "60′");
  assert.equal(sensesReading({ vision: ["normal"], lightlessRange: 60 }).sub, "");
  assert.equal(sensesReading({ otherSenses: [{ type: "scent", range: 30 }] }).any, true);
  assert.equal(sensesReading({}).pad, true);
});
test("feet carries the prime", () => {
  assert.equal(feet(30), "30′");
  assert.equal(feet("x"), "0′");
});

console.log("monster sheet: the load bar");
test("the bar fills toward the maximum and ticks at the normal load", () => {
  assert.deepEqual(loadReading({ stone: 5, normal: 10, max: 20 }), { pct: 25, tick: 50, tone: null, unset: false, carried: 5, normal: 10, max: 20 });
});
test("past normal is amber, past the maximum red, and no maximum takes the imported multiple", () => {
  assert.equal(loadReading({ stone: 15, normal: 10, max: 20 }).tone, "warn");
  assert.equal(loadReading({ stone: 25, normal: 10, max: 20 }).tone, "bad");
  assert.equal(loadReading({ stone: 15, normal: 10, maxMultiple: 3 }).max, 30);
  assert.equal(loadReading({ stone: 35, normal: 10, maxMultiple: 3 }).tone, "bad");
});
test("with no maximum and no imported multiple, no ceiling is invented and the bar scales to the larger load", () => {
  const l = loadReading({ stone: 15, normal: 10 });
  assert.equal(l.max, null);
  assert.equal(l.tone, "warn");
  assert.equal(l.pct, 100);
  assert.equal(l.tick, 67);
  assert.equal(loadReading({ stone: 400, normal: 10 }).tone, "warn", "past normal is never red without a ceiling");
});
test("no normal load is an unset bar", () => {
  const l = loadReading({ stone: 7 });
  assert.equal(l.unset, true);
  assert.equal(l.pct, 0);
});

console.log("monster sheet: the dashboard");
const snap = () => ({
  pins: ["morale", "atk:w1"],
  saves: { paralysis: 14, death: 13, blast: 15, implements: 16, spell: 17 },
  saveLabels: { paralysis: "P", death: "D", blast: "B", implements: "I", spell: "S" },
  savesAs: { cls: "Fighter", level: "4" },
  morale: -1,
  loyalty: null,
  initiative: 1,
  surpriseOthers: 0,
  surpriseAvoid: 2,
  encounter: {
    dungeon: { wandering: "2d4", lair: "1d6", formula: "2d4" },
    wilderness: { wandering: "", lair: "3d10", formula: "3d10" },
  },
  lairChance: 35,
  treasure: { type: "F", linked: true },
  attackThrow: 7,
  attacks: [
    { id: "w1", name: "Claw", damage: "1d4", damageType: "Slashing", natural: true, extraordinary: false, counter: { value: 1, max: 2 } },
    { id: "w2", name: "Bite", damage: "", damageType: "", natural: false, extraordinary: true, counter: { value: 0, max: 1 } },
  ],
  hp: { value: 9, max: 18, formula: "4d8" },
  hdText: "4",
  abilities: [
    { id: "a1", name: "Leap", rollable: true, target: 12, line: "" },
    { id: "a2", name: "Stench", rollable: false, target: null, line: "aura" },
  ],
  speeds: [{ label: "Ground", combat: 40, run: 120, hover: false }, { label: "Fly", combat: 60, run: 180, hover: true }],
  vision: [{ key: "lightless", label: "Lightless" }],
  lightlessRange: 60,
  otherSenses: [{ label: "Scent", range: 30, note: "" }],
  load: { stone: 5, normal: 10, max: 20, rider: null },
  defenses: { immune: ["Cold"], resist: ["Fire"], susceptible: ["Silver"] },
  spells: { enabled: false },
});

test("an attack's damage tag carries the creature's own modifier, and its tooltip names both parts", () => {
  const plain = statblockColumns(snap(), loc).columns[1][0].rows;
  assert.equal(plain[0].damage, "1d4");
  assert.equal(plain[0].damageTip, "");
  const modded = statblockColumns({ ...snap(), damageMod: 2 }, loc).columns[1][0].rows;
  assert.equal(modded[0].damage, "1d4 +2");
  assert.equal(modded[0].damageTip, 'statblock.row.damageWithMod:{"formula":"1d4","mod":"+2"}');
  assert.equal(modded[1].damage, "—", "no die, nothing to add to");
  assert.equal(statblockColumns({ ...snap(), damageMod: -1 }, loc).columns[1][0].rows[0].damage, "1d4 −1");
});
test("a leader's kit damage is named on the attack even at none, and a blank one carries the row's page alone", () => {
  const kit = { troop: "bowmen", label: "Bowmen", role: "champion", compute: true, cite: "QQ p.41" };
  const tipOf = (damage, damageMod) => statblockColumns({ ...snap(), kit, derived: { kit: { cite: "QQ p.41", damage } }, damageMod }, loc).columns[1][0].rows[0];
  const worked = tipOf({ value: 0, base: 2, step: -2, leaderDamage: 1, memberDamage: 3 }, 0);
  assert.equal(worked.damage, "1d4", "a modifier of none adds nothing to the die");
  assert.match(worked.damageTip, /^statblock\.tip\.damageKitLeader:/);
  const blank = tipOf({ missing: true, value: null }, 0);
  assert.equal(blank.damage, "1d4");
  assert.equal(blank.damageTip, "QQ p.41");
  const blankNull = tipOf({ missing: true, value: null }, null);
  assert.equal(blankNull.damage, "1d4", "a field left blank adds nothing to the die and prints no figure");
  assert.equal(blankNull.damageTip, "QQ p.41");
  assert.equal(tipOf({ value: null, missing: false }, 0).damageTip, "", "an empty record names nothing");
});
test("a weapon's own damage bonus shows in the tag and the tooltip names it beside the creature's modifier", () => {
  const rowOf = (over, bonusDamage) => statblockColumns({ ...snap(), ...over, attacks: [{ ...snap().attacks[0], bonusDamage }] }, loc).columns[1][0].rows[0];
  const both = rowOf({ damageMod: 2 }, 1);
  assert.equal(both.damage, "1d4 +3");
  assert.equal(both.damageTip, 'statblock.row.damageWithMod:{"formula":"1d4","mod":"+2"} · statblock.row.damageWithBonus:{"bonus":"+1"}');
  const alone = rowOf({ damageMod: 0 }, -1);
  assert.equal(alone.damage, "1d4 −1");
  assert.equal(alone.damageTip, 'statblock.row.damageWithBonus:{"bonus":"−1"}');
  assert.equal(rowOf({ damageMod: 2 }, 0).damage, "1d4 +2", "a plain weapon is as before");
  assert.equal(rowOf({ damageMod: 2 }, -2).damage, "1d4", "a bonus that cancels the modifier leaves the die alone");
});
test("a held leader-table die: the tag is the die alone, the tooltip names the row, the page and the take-back, and no converted die", () => {
  const dice = { rows: { header: { col1: "+1" }, r1: { die: "1d8", col1: "1d10" } }, cite: "QQ p.9" };
  const leader = { source: "table", cite: "QQ p.12", ac: 8, armour: "felt", die: "1d8", row: "Champion", damage: 1 };
  const grade = (over = {}, attack = {}) => statblockColumns({ ...snap(), dice, damageMod: 1, derived: { leader }, attacks: [{ ...snap().attacks[0], damage: "1d8", bonusDamage: -1, ...attack }], ...over }, loc).columns[1][0].rows[0];
  const held = grade();
  assert.equal(held.damage, "1d8", "the die alone");
  assert.match(held.damageTip, /^statblock\.tip\.dieTable:/);
  assert.deepEqual(JSON.parse(held.damageTip.slice("statblock.tip.dieTable:".length)), { die: "1d8", row: "Champion", cite: "QQ p.12", mod: "+1", takeBack: "−1" });
  assert.ok(!held.damageTip.includes("dieConverted"), "the table's die is not converted again");
  const withTrait = grade({ damageMod: 2, derived: { leader, organisation: { damage: { value: 2, base: 1, trait: 1 }, trait: { label: "Trait C", cite: "QQ p.3" } } } });
  assert.equal(withTrait.damage, "1d8 +1", "an ungated trait's figure rides on the die");
  assert.match(withTrait.damageTip, /dieTable.* · statblock\.tip\.orgFigure/);
  assert.ok(!withTrait.damageTip.includes("dieConverted"), "nor with a trait's figure, where the table holds a cell for the sum");
  assert.equal(grade({}, { bonusDamage: 0 }).damageTip.includes("dieTable"), false, "the tip is gone once the bonus is edited");
  assert.equal(grade({}, { damage: "1d6" }).damageTip.includes("dieTable"), false, "and once the formula is");
  assert.equal(grade({ derived: { leader: { ...leader, cite: "" } } }).damageTip.includes('"cite":"—"'), true, "an override of the table reads no page");
  assert.equal(grade({ derived: { leader: { ...leader, die: "" } } }).damageTip.includes("dieTable"), false, "a die only recorded names nothing");
  assert.match(grade({}, { damage: "1d8", bonusDamage: 0 }).damage, /^1d8 \+1$/, "an attack that does not hold the take-back shows what core adds");
});
test("the Loyalty row: none for a creature that serves nobody, blank with the page for an empty field, signed for a score", () => {
  const loyaltyRows = (s) => statblockColumns(s, loc).columns.flat().find((g) => g.key === "reactions").rows.filter((r) => r.id === "loyalty");
  assert.deepEqual(loyaltyRows(snap()), [], "null is a creature in nobody's service");
  const blank = loyaltyRows({ ...snap(), loyalty: "" });
  assert.equal(blank.length, 1, "an empty field keeps its row, which still rolls (and is refused there)");
  assert.equal(blank[0].value, "", "no figure stands in");
  assert.ok(blank[0].valueTip, "and the tooltip names the page");
  assert.equal(loyaltyRows({ ...snap(), loyalty: 0 })[0].value, "+0", "a score of zero is a score");
  assert.equal(loyaltyRows({ ...snap(), loyalty: -2 })[0].valueTip ?? "", "");
});
test("three columns: throws, attacks and abilities, then the readings", () => {
  const { columns } = statblockColumns(snap(), loc);
  assert.deepEqual(columns.map((c) => c.map((g) => g.key)), [
    ["saves", "reactions", "encounter"],
    ["attacks", "hitPoints", "abilities"],
    ["movement", "senses", "load", "defences"],
  ]);
});
test("every roll row has a stable id of its own kind, and the pins are read off them", () => {
  const { columns, ids } = statblockColumns(snap(), loc);
  assert.deepEqual(ids.slice(0, 5), ["save:paralysis", "save:death", "save:blast", "save:implements", "save:spell"]);
  assert.ok(ids.includes("atk:w1") && ids.includes("abl:a1") && ids.includes("post:a2") && ids.includes("hp") && ids.includes("hd"));
  assert.equal(new Set(ids).size, ids.length, "no two rows share an id");
  const rows = rollRows(columns);
  assert.deepEqual(rows.filter((r) => r.pinned).map((r) => r.id), ["morale", "atk:w1"]);
});
test("a save row prints its target as a throw; loyalty appears only in service", () => {
  const { columns } = statblockColumns(snap(), loc);
  const saves = columns[0][0];
  assert.equal(saves.rows[0].value, "14+");
  assert.equal(saves.note, 'statblock.note.savesAs:{"cls":"Fighter","level":"4"}');
  assert.equal(columns[0][1].rows.some((r) => r.id === "loyalty"), false);
  const served = statblockColumns({ ...snap(), loyalty: 2 }, loc);
  assert.equal(served.columns[0][1].rows.find((r) => r.id === "loyalty").value, "+2");
});
test("the encounter rows: the sides' figures on the line, the lair chance only when set, the treasure drawn only when linked", () => {
  const { columns } = statblockColumns(snap(), loc);
  const enc = columns[0][2];
  assert.ok(enc.rows[0].line.includes("wandering") && enc.rows[0].line.includes("2d4"));
  assert.equal(enc.rows[2].value, "35%");
  assert.equal(enc.rows[2].rollable, true);
  assert.equal(enc.rows[3].rollable, true);
  const bare = statblockColumns({ ...snap(), lairChance: null, treasure: { type: "", linked: false } }, loc);
  assert.equal(bare.columns[0][2].rows[2].rollable, false);
  assert.equal(bare.columns[0][2].rows[3].rollable, false);
  assert.equal(bare.columns[0][2].rows[3].line, "statblock.row.treasureNone");
});
test("an encounter row rolls only a formula; a count in units reads and offers no roll", () => {
  const { columns } = statblockColumns(snap(), loc);
  assert.equal(columns[0][2].rows[0].rollable, true);
  const units = { wandering: "2d7 knots", lair: "1 muster", formula: "" };
  const counted = statblockColumns({ ...snap(), encounter: { dungeon: units, wilderness: units } }, loc);
  const [dungeon, wilderness] = counted.columns[0][2].rows;
  assert.ok(dungeon.line.includes("2d7 knots") && dungeon.line.includes("1 muster"));
  assert.equal(dungeon.rollable, false);
  assert.equal(wilderness.rollable, false);
  assert.equal(dungeon.lineTip, "statblock.row.inUnits");
  assert.equal(columns[0][2].rows[0].lineTip, "", "a line that rolls carries no such note");
  const none = { wandering: "", lair: "", formula: "" };
  const bare = statblockColumns({ ...snap(), encounter: { dungeon: none, wilderness: none } }, loc);
  assert.equal(bare.columns[0][2].rows[0].rollable, false);
  assert.equal(bare.columns[0][2].rows[0].lineTip, "", "no line, nothing to explain");
});
test("an attack row carries the throw, the damage, the counter and the item; a missing damage reads as a dash", () => {
  const { columns } = statblockColumns(snap(), loc);
  const [claw, bite] = columns[1][0].rows;
  assert.equal(claw.value, "7+");
  assert.equal(claw.damage, "1d4");
  assert.deepEqual(claw.counter, { value: 1, max: 2 });
  assert.equal(claw.item, "w1");
  assert.ok(claw.line.includes("Slashing") && claw.line.includes("statblock.row.natural"));
  assert.equal(bite.damage, "—");
  assert.ok(bite.line.includes("statblock.row.extraordinary"));
});
test("an attack throw that is not a number shows no figure: an empty cell, the captions without it", () => {
  const read = attackReading(snap(), loc);
  assert.deepEqual(read, { cell: "7+", note: 'statblock.note.attacks:{"n":7}', title: 'frame.rail.attack:{"n":7}' });
  for (const none of [null, undefined, "", "x", NaN]) {
    const bare = { ...snap(), attackThrow: none };
    assert.deepEqual(attackReading(bare, loc), { cell: "", note: "statblock.note.attacksNoThrow", title: "frame.rail.attackNoThrow" }, `${String(none)} reads as no figure`);
    const group = statblockColumns(bare, loc).columns[1][0];
    assert.equal(group.note, "statblock.note.attacksNoThrow");
    assert.deepEqual(group.rows.map((r) => r.value), ["", ""], "no `N+` cell, no 0+ or NaN+ in its place");
    assert.deepEqual(group.rows.map((r) => r.id), ["atk:w1", "atk:w2"], "the rows are still there to roll");
  }
  assert.equal(attackReading({ ...snap(), attackThrow: 0 }, loc).cell, "0+", "a stored zero is a number");
});
test("an ability with a throw rolls it; one without posts its card", () => {
  const { columns } = statblockColumns(snap(), loc);
  const [leap, stench] = columns[1][2].rows;
  assert.equal(leap.id, "abl:a1");
  assert.equal(leap.value, "12+");
  assert.equal(leap.post, false);
  assert.equal(stench.id, "post:a2");
  assert.equal(stench.post, true);
});
test("hit points roll from the rating and the dice row posts; the formula is the rule's note", () => {
  const { columns } = statblockColumns(snap(), loc);
  const hp = columns[1][1];
  assert.equal(hp.note, "4d8");
  assert.equal(hp.rows[0].value, "9 / 18");
  assert.equal(hp.rows[1].post, true);
  assert.equal(hp.rows[1].line, "4");
});
test("the readings: speeds as combat / run, hover on the line; senses with their ranges", () => {
  const { columns } = statblockColumns(snap(), loc);
  const [movement, senses] = columns[2];
  assert.equal(movement.kind, "readings");
  assert.equal(movement.rows[0].value, "40′ / 120′");
  assert.equal(movement.rows[1].line, "statblock.row.hover");
  assert.equal(senses.rows[0].value, "60′");
  assert.equal(senses.rows[1].value, "30′");
});
test("the defences are pills in three tones, and the spell group appears only for a caster", () => {
  const { columns } = statblockColumns(snap(), loc);
  const defences = columns[2][3];
  assert.deepEqual(defences.pills.map((p) => p.tone), ["on", "pos", "neg"]);
  const caster = statblockColumns({ ...snap(), spells: { enabled: true, casterClass: "Mage", casterLevel: 3, slots: [{ level: "1", used: 1, max: 2 }] } }, loc);
  const spells = caster.columns[2][4];
  assert.equal(spells.kind, "pills");
  assert.equal(spells.tab, "spells");
  assert.equal(spells.pills.length, 1);
  assert.equal(spells.pills[0].tone, "ts");
});
test("empty lists say so instead of drawing nothing", () => {
  const { columns } = statblockColumns({ ...snap(), attacks: [], abilities: [], speeds: [], vision: [], otherSenses: [] }, loc);
  assert.equal(columns[1][0].rows.length, 0);
  assert.equal(columns[1][0].empty, "statblock.row.noAttacks");
  assert.equal(columns[2][0].empty, "statblock.row.noSpeeds");
  assert.equal(columns[2][1].empty, "statblock.row.noSenses");
});
test("the load group is a bar with the rider as its one row, and says so when no normal load is set", () => {
  const { columns } = statblockColumns({ ...snap(), load: { stone: 5, normal: 10, max: 20, rider: { name: "Rider", stone: 2.5 } } }, loc);
  const load = columns[2][2];
  assert.equal(load.kind, "bar");
  assert.equal(load.bar.pct, 25);
  assert.equal(load.rows[0].value, "2.5 st");
  const unset = statblockColumns({ ...snap(), load: { stone: 5, normal: null, max: null, rider: null } }, loc);
  assert.equal(unset.columns[2][2].note, "statblock.note.loadUnset");
});
test("the load note names no maximum where there is none", () => {
  const { columns } = statblockColumns({ ...snap(), load: { stone: 15, normal: 10, max: null, rider: null } }, loc);
  assert.equal(columns[2][2].note, `statblock.note.loadNoMax:${JSON.stringify({ stone: 15, normal: 10 })}`);
});

console.log("monster sheet: an attack row");
/** A live-shaped owned weapon: the system's `types` is a Set, and the flags sit on the document. */
const weaponDoc = ({ types = [], extraordinary, flags = {}, bonus } = {}) => ({
  id: "w1",
  name: "Bite",
  flags: { "acks-extras": flags },
  getFlag: (m, k) => (m === "acks-extras" ? flags[k] : undefined),
  system: { damage: { base: { formula: "1d6", types: new Set(types), ...(extraordinary === undefined ? {} : { extraordinary }) } }, ...(bonus === undefined ? {} : { bonus }), counter: { value: 1, max: 1 } },
});
const asKey = (key) => key ?? "";
test("a core type beats a stale flag", () => {
  assert.equal(attackRowOf(weaponDoc({ types: ["fire"], flags: { damageType: "slashing" } }), asKey).damageType, "fire");
});
test("a weapon core states no type for shows a blank row, whatever a flag says", () => {
  assert.equal(attackRowOf(weaponDoc({ flags: { damageType: "slashing" } }), asKey).damageType, "");
  assert.equal(attackRowOf(weaponDoc(), asKey).damageType, "");
});
test("the core extraordinary mark shows with no flag, and a stale flag alone does not", () => {
  assert.equal(attackRowOf(weaponDoc({ extraordinary: true }), asKey).extraordinary, true);
  assert.equal(attackRowOf(weaponDoc({ extraordinary: false, flags: { extraordinary: true } }), asKey).extraordinary, false);
});
test("the natural-weapon mark stays the monster feature's flag", () => {
  assert.equal(attackRowOf(weaponDoc({ flags: { naturalWeapon: "bite" } }), asKey).natural, true);
  assert.equal(attackRowOf(weaponDoc(), asKey).natural, false);
});
test("the row carries the die and the counter", () => {
  const row = attackRowOf(weaponDoc(), asKey);
  assert.equal(row.damage, "1d6");
  assert.deepEqual(row.counter, { value: 1, max: 1 });
});
test("the row carries the weapon's own damage bonus, none where the weapon holds none or a bare number", () => {
  assert.equal(attackRowOf(weaponDoc({ bonus: { attack: 0, damage: -2 } }), asKey).bonusDamage, -2);
  assert.equal(attackRowOf(weaponDoc(), asKey).bonusDamage, 0);
  assert.equal(attackRowOf(weaponDoc({ bonus: 0 }), asKey).bonusDamage, 0);
});

console.log("monster sheet: the Ecology tab's recipe door");
test("the Ecology tab reads no role, so every seat that can see it sees the Organisation button", () => {
  const hbs = readFileSync(new URL("../templates/monsters/tab-ecology.hbs", import.meta.url), "utf8");
  assert.doesNotMatch(hbs, /isGM/, "shown to every seat that can see the tab");
});

console.log(`\nmonster sheet: ${passed} passed`);
