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
import {
  hdRating, bodyFormIcon, DEFAULT_GLYPH, feet, moveReading, sensesReading, loadReading, statblockColumns, rollRows,
} from "../scripts/monsters/statblock.mjs";

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
  assert.equal(bodyFormIcon("no-such-form"), DEFAULT_GLYPH);
  assert.equal(bodyFormIcon(undefined), DEFAULT_GLYPH);
  assert.notEqual(bodyFormIcon("humanoid"), DEFAULT_GLYPH);
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
test("past normal is amber, past the maximum red, and no maximum means twice normal", () => {
  assert.equal(loadReading({ stone: 15, normal: 10, max: 20 }).tone, "warn");
  assert.equal(loadReading({ stone: 25, normal: 10, max: 20 }).tone, "bad");
  assert.equal(loadReading({ stone: 15, normal: 10 }).max, 20);
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
  encounter: { dungeon: { wandering: "2d4", lair: "1d6" }, wilderness: { wandering: "", lair: "3d10" } },
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

console.log(`\nmonster sheet: ${passed} passed`);
