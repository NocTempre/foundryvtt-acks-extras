/**
 * Pure-logic regression tests for the item sheet's view-model and its helpers.
 * No Foundry: the snapshot is built by hand, so these assert the decisions the
 * sheet makes — tab order, the simple-mode collapse, the pin FIFO, the value
 * badge, identification gating, accept-kind refusal, the price ledger — rather
 * than what a running world happens to render.
 *
 * Run: npm test
 */
import assert from "node:assert";
import { buildItemSheetModel, togglePin, effectivePins, resolveTab, valueBadge, TAB_ORDER } from "../scripts/equipment/item-sheet/view-model.mjs";
import { kindsOf, acceptsKinds, cleanAccepts, ACCEPT_KINDS } from "../scripts/equipment/item-sheet/accept-kinds.mjs";
import { priceLedger } from "../scripts/equipment/item-sheet/price-ledger.mjs";
import { stoneLabel, gpLabel, signed, initialOf } from "../scripts/equipment/item-sheet/format.mjs";
import {
  CHIP, HAND_SLOTS, stripChips, toggledSet, placeChips, nextPlaces, gripChips, nextGrips,
  qualityChips, nextQuality, otherTags, withTag, withoutTag,
} from "../scripts/equipment/item-sheet/construction-model.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/** A minimal snapshot: a plain item with nothing on it. */
const base = (over = {}) => ({
  id: "i1",
  name: "Crowbar",
  img: "icons/svg/item-bag.svg",
  type: "item",
  baseType: "gear",
  description: "<p>Iron.</p>",
  tags: [],
  qty: 1,
  stackable: true,
  weight6: 1,
  cost: 5,
  valueMode: "priced",
  wearable: false,
  worn: false,
  wornSlot: null,
  slotGuess: null,
  favorite: null,
  split: false,
  magic: { is: false, aura: null, identified: "none" },
  disguise: { enabled: false, active: false },
  named: null,
  container: null,
  spellbook: null,
  chart: null,
  condition: null,
  rolls: [],
  effects: { own: [], inherited: [] },
  price: { lines: [{ key: "listed", label: "Listed", op: null, amount: 5, running: 5 }], final: 5, apparent: null },
  variations: [],
  acceptKinds: [...ACCEPT_KINDS],
  pins: [],
  ...over,
});

const weaponRolls = [
  { key: "attackModes", name: "Attack Modes", note: "", src: null, rows: [
    { id: "atk:melee", m: "1H", glyph: "slashing", v: "1d6", label: "Melee", line: "+0 throw", mods: [], rollable: true },
    { id: "atk:missile", m: "HRL", glyph: "slashing", v: "1d6", label: "Hurled", line: "+0 throw", mods: [], rollable: true },
  ] },
  { key: "maneuvers", name: "Special Manoeuvres", note: "", src: null, rows: [
    { id: "man:disarm", m: "DIS", glyph: null, v: "−4", label: "Disarm", line: "", mods: [], rollable: true },
  ] },
];

console.log("item sheet: format");
test("stone labels use the books' fractions", () => {
  assert.equal(stoneLabel(0), "—");
  assert.equal(stoneLabel(1), "¹⁄₆");
  assert.equal(stoneLabel(3), "¹⁄₂");
  assert.equal(stoneLabel(6), "1");
  assert.equal(stoneLabel(15), "2¹⁄₂");
  assert.equal(stoneLabel(1.5), "0.25");
});
test("gold is thousands-separated and a missing price is a dash", () => {
  assert.equal(gpLabel(32000), "32,000 gp");
  assert.equal(gpLabel(10.5), "10.5 gp");
  assert.equal(gpLabel(null), "—");
  assert.equal(signed(-2), "−2");
  assert.equal(signed(0), "+0");
  assert.equal(initialOf("  tooth-breaker"), "T");
});

console.log("item sheet: tabs and simple mode");
test("a plain item collapses to simple mode with no tabs", () => {
  const m = buildItemSheetModel(base(), { isGM: true, editable: true });
  assert.equal(m.simple, true);
  assert.deepEqual(m.tabs.map((t) => t.key), ["rolls", "effects", "details"], "the always-on tabs still exist in the definition");
  assert.equal(m.rails.right.length, 0, "no right rail in simple mode");
});
test("tabs appear in the one fixed order and only when they have data", () => {
  const m = buildItemSheetModel(base({
    rolls: weaponRolls,
    chart: { sceneName: "Vale", explored: null, pct: 0.62 },
    condition: { labels: [], damaged: false, destroyed: false, material: "iron", acNow: null, acFull: null, notes: [] },
    container: { holds: true, capacityStone: 4, cap6: 24, load6: 6, locked: false, lockMod: 0, keys: [], accepts: [], refusal: "", contents: [], canSee: true },
    magic: { is: true, aura: "arcane", identified: "partial" },
  }), { isGM: true, editable: true });
  const keys = m.tabs.map((t) => t.key);
  assert.deepEqual(keys, ["rolls", "chart", "durability", "effects", "contents", "appearance", "details"]);
  assert.deepEqual(keys, TAB_ORDER.filter((k) => keys.includes(k)));
  assert.equal(m.simple, false);
});
test("the Appearance tab is Judge-only", () => {
  const snap = base({ magic: { is: true, aura: "arcane", identified: "full" } });
  assert.ok(buildItemSheetModel(snap, { isGM: true }).tabs.some((t) => t.key === "appearance"));
  assert.ok(!buildItemSheetModel(snap, { isGM: false }).tabs.some((t) => t.key === "appearance"));
  assert.ok(!buildItemSheetModel(snap, { isGM: true, previewAsPlayer: true }).tabs.some((t) => t.key === "appearance"));
});
test("the first available tab stands in when the current one disappears", () => {
  assert.equal(resolveTab("chart", ["rolls", "details"]), "rolls");
  assert.equal(resolveTab("details", ["rolls", "details"]), "details");
  assert.equal(resolveTab(null, []), null);
});

console.log("item sheet: pins");
test("nothing pinned defaults to the first two rolls in document order", () => {
  assert.deepEqual(effectivePins([], ["a", "b", "c"]), ["a", "b"]);
  assert.deepEqual(effectivePins(["zzz"], ["a", "b"]), ["a", "b"], "a stale pin falls back");
});
test("pinning a third unpins the oldest, and pinning a pinned roll unpins it", () => {
  assert.deepEqual(togglePin(["a", "b"], ["a", "b", "c"], "c"), ["b", "c"]);
  assert.deepEqual(togglePin(["b", "c"], ["a", "b", "c"], "c"), ["b"]);
});
test("the art shows the pinned rolls and counts the overflow", () => {
  const m = buildItemSheetModel(base({ rolls: weaponRolls, pins: ["man:disarm"] }), { isGM: true });
  assert.deepEqual(m.rails.rolls.map((r) => r.id), ["man:disarm"]);
  assert.equal(m.rails.leftPads.length, 1);
  assert.equal(m.art.more, "+2");
});

console.log("item sheet: value and identification");
test("value modes drive the badge", () => {
  assert.equal(valueBadge({ mode: "na", fullCost: 5 }).text, "—");
  assert.equal(valueBadge({ mode: "unknown", fullCost: 5 }).text, null);
  assert.equal(valueBadge({ mode: "priced", fullCost: 10000, apparentCost: 15, hideMagic: true }).text, "15 gp");
  assert.equal(valueBadge({ mode: "priced", fullCost: 10000, apparentCost: 15, hideMagic: false }).text, "10,000 gp");
});
test("the band types the listed price only where the badge reads the plain value", () => {
  const plain = buildItemSheetModel(base(), { isGM: true, editable: true });
  assert.equal(plain.band.valueEditable, true);
  assert.equal(plain.band.listed, 5);
  assert.equal(plain.band.valueDiffers, false, "no layers: the field is the value");
  const layered = buildItemSheetModel(base({ price: { base: 5, lines: [{ key: "listed", amount: 5, running: 5 }, { key: "silver", op: "mul", amount: 2, running: 10 }], final: 10, apparent: null } }), { isGM: true, editable: true });
  assert.equal(layered.band.listed, 5, "the field holds the listed price, not the worth");
  assert.equal(layered.band.valueDiffers, true, "and the worth reads beside it");
  assert.equal(buildItemSheetModel(base({ valueMode: "unknown" }), { isGM: true, editable: true }).band.valueEditable, false);
  assert.equal(buildItemSheetModel(base({ valueMode: "na" }), { isGM: true, editable: true }).band.valueEditable, false);
  const apparent = buildItemSheetModel(base({ magic: { is: true, aura: "arcane", identified: "none" }, price: { lines: [], final: 10000, apparent: 15 } }), { isGM: false, editable: true });
  assert.equal(apparent.band.valueEditable, false, "an apparent worth is not typed over");
});
test("a player sees no own effects and the apparent value until identified", () => {
  const snap = base({
    magic: { is: true, aura: "arcane", identified: "partial" },
    effects: { own: [{ id: "e", label: "Protection", detail: "", when: "Worn" }], inherited: [{ label: "Dex", detail: "", src: "Attribute" }] },
    price: { lines: [], final: 10000, apparent: 15 },
  });
  const player = buildItemSheetModel(snap, { isGM: false });
  assert.equal(player.effects.own.length, 0);
  assert.equal(player.effects.inherited.length, 1, "grants from the bearer stay visible");
  assert.equal(player.effects.hiddenByIdentification, true);
  assert.equal(player.band.value, "15 gp");
  assert.equal(player.art.aura, "arcane", "the aura shows from step 2");
  const found = buildItemSheetModel({ ...snap, magic: { ...snap.magic, identified: "none" } }, { isGM: false });
  assert.equal(found.art.aura, null, "no aura at step 1");
  const judge = buildItemSheetModel(snap, { isGM: true });
  assert.equal(judge.effects.own.length, 1);
  assert.equal(judge.band.value, "10,000 gp");
});

console.log("item sheet: disguise");
test("a Judge sees the true item striped; a player sees the document as it is", () => {
  const snap = base({
    name: "Iron Torc",
    rolls: weaponRolls,
    disguise: { enabled: true, active: true, trueName: "Ring of Protection +1", trueDescription: "<p>gold</p>", apparentName: "Iron Torc" },
  });
  const judge = buildItemSheetModel(snap, { isGM: true });
  assert.equal(judge.band.name, "Ring of Protection +1");
  assert.equal(judge.band.striped, true);
  assert.equal(judge.band.masked, true);
  const player = buildItemSheetModel(snap, { isGM: false });
  assert.equal(player.band.name, "Iron Torc");
  assert.equal(player.band.striped, false);
  assert.equal(player.rolls.groups.length, 0, "the mask hides the true item's rolls");
  const preview = buildItemSheetModel(snap, { isGM: true, previewAsPlayer: true });
  assert.equal(preview.band.name, "Iron Torc");
  assert.equal(preview.previewAsPlayer, true);
});
test("damage is never disguised: the band keeps the condition tag under a mask", () => {
  const snap = base({
    condition: { labels: ["Dented"], damaged: true, destroyed: false, material: "iron", acNow: null, acFull: null, notes: [] },
    disguise: { enabled: true, active: true, trueName: "X", apparentName: "Y" },
  });
  const player = buildItemSheetModel(snap, { isGM: false });
  assert.equal(player.band.condition, "damaged");
  assert.equal(player.durability, null, "the tab itself is masked");
});

console.log("item sheet: rails");
test("a stack offers a split, a split item offers a restack, a single item equips", () => {
  const stack = buildItemSheetModel(base({ qty: 3, wearable: true, rolls: weaponRolls }), { isGM: true });
  assert.equal(stack.rails.right[0].key, "split");
  assert.equal(stack.band.qtyShown, 3);
  const split = buildItemSheetModel(base({ qty: 1, wearable: true, split: true, rolls: weaponRolls }), { isGM: true });
  assert.equal(split.rails.right[0].key, "restack");
  assert.equal(split.band.qtyShown, null);
  const single = buildItemSheetModel(base({ qty: 1, wearable: true, worn: true, slotShort: "Main", rolls: weaponRolls }), { isGM: true });
  assert.equal(single.rails.right[0].key, "equip");
  assert.equal(single.rails.right[0].on, true);
});
test("a torch stack is never worn: its equip cell readies one, and it is not simple", () => {
  const bundle = buildItemSheetModel(base({ qty: 6, stackable: true, readiable: true }), { isGM: true });
  assert.equal(bundle.simple, false, "the cell needs the state rail");
  assert.equal(bundle.rails.right[0].key, "equip");
  assert.equal(bundle.rails.right[0].title, "readyHint");
  assert.equal(bundle.rails.right[0].on, false);
});
test("the right rail is always four cells tall", () => {
  const m = buildItemSheetModel(base({
    wearable: true, favorite: false, rolls: weaponRolls,
    container: { holds: true, capacityStone: 4, cap6: 24, load6: 12, locked: true, lockMod: -2, keys: [], accepts: [], refusal: "", contents: [], canSee: false },
  }), { isGM: true });
  assert.deepEqual(m.rails.right.map((c) => c.key), ["equip", "favorite", "capacity", "lock"]);
  assert.equal(m.rails.rightPads.length, 0);
  assert.equal(m.rails.right[2].pct, "50%");
  assert.equal(m.rails.right[3].v, "−2");
});
test("the editor rail leads with the pencil, drops ownership on embedded items and source for players", () => {
  const world = buildItemSheetModel(base({ embedded: false }), { isGM: true, editable: true });
  assert.deepEqual(world.rails.editor.map((c) => c.key), ["edit", "changeArt", "ownership", "source"]);
  const embedded = buildItemSheetModel(base({ embedded: true }), { isGM: false, editable: true });
  assert.deepEqual(embedded.rails.editor.map((c) => c.key), ["edit", "changeArt"]);
});
test("the sheet opens locked: editing needs the permission and the pencil, and the pencil says which", () => {
  const locked = buildItemSheetModel(base(), { isGM: true, editable: true });
  assert.equal(locked.editable, true);
  assert.equal(locked.editing, false);
  assert.deepEqual(locked.rails.editor[0], { key: "edit", icon: "fa-solid fa-pen", on: false, title: "edit" });
  const armed = buildItemSheetModel(base(), { isGM: true, editable: true, editing: true });
  assert.equal(armed.editing, true);
  assert.equal(armed.rails.editor[0].on, true);
  assert.equal(armed.rails.editor[0].title, "editDone");
  const viewer = buildItemSheetModel(base(), { isGM: false, editable: false, editing: true });
  assert.equal(viewer.editing, false, "no permission, no pencil — whatever the flag says");
  assert.equal(viewer.details.identifyOffered, false);
});

console.log("item sheet: construction strips");
test("a strip shows every option, the inferred set dashed and the declared set solid", () => {
  const inferred = stripChips(["a", "b", "c"], { declared: null, inferred: ["b"] });
  assert.deepEqual(inferred.map((c) => c.state), [CHIP.OFF, CHIP.AUTO, CHIP.OFF]);
  const declared = stripChips(["a", "b", "c"], { declared: ["a"], inferred: ["b"] });
  assert.deepEqual(declared.map((c) => c.state), [CHIP.ON, CHIP.OFF, CHIP.OFF], "a declaration outranks the inference");
  assert.deepEqual(stripChips(["a"], { declared: null, inferred: ["a"], locked: ["a"] })[0], { key: "a", state: CHIP.AUTO, locked: true });
});
test("a click declares the inferred set with one change, and a locked key never flips", () => {
  assert.deepEqual(toggledSet({ declared: null, inferred: ["b"] }, "a"), ["b", "a"], "the first click starts from what the module believes");
  assert.deepEqual(toggledSet({ declared: ["a", "b"], inferred: [] }, "a"), ["b"]);
  assert.deepEqual(toggledSet({ declared: null, inferred: ["b"], locked: ["b"] }, "b"), ["b"]);
});
test("a weapon's hands are lit, locked and kept first; nothing lit is the carried answer", () => {
  const sword = { declared: null, inferred: [...HAND_SLOTS], weapon: true };
  const chips = placeChips(sword);
  assert.equal(chips.length, 14, "every slot the character sheet knows");
  assert.deepEqual(chips.find((c) => c.key === "mainHand"), { key: "mainHand", state: CHIP.AUTO, locked: true });
  assert.equal(chips.find((c) => c.key === "belt").state, CHIP.OFF);
  assert.deepEqual(nextPlaces(sword, "belt"), [...HAND_SLOTS, "belt"]);
  assert.deepEqual(nextPlaces({ declared: ["belt", "mainHand"], inferred: [], weapon: true }, "belt"), [...HAND_SLOTS], "a hand-edited flag gets its hands back");
  assert.deepEqual(nextPlaces({ declared: ["head"], inferred: ["head"], weapon: false }, "head"), [], "carried, worn nowhere — a real answer");
  assert.deepEqual(nextPlaces({ declared: null, inferred: ["head"], weapon: false }, "neck"), ["head", "neck"]);
});
test("grips: versatile is both lit, and both off hands the question back to the size table", () => {
  assert.deepEqual(gripChips({ declared: null, inferred: "versatile" }).map((c) => c.state), [CHIP.AUTO, CHIP.AUTO]);
  assert.deepEqual(gripChips({ declared: "2h", inferred: "versatile" }).map((c) => c.state), [CHIP.OFF, CHIP.ON]);
  assert.equal(nextGrips({ declared: null, inferred: "versatile" }, "1h"), "2h");
  assert.equal(nextGrips({ declared: "1h", inferred: "1h" }, "2h"), "versatile");
  assert.equal(nextGrips({ declared: "2h", inferred: "1h" }, "2h"), null, "a weapon nobody can hold is not an answer");
});
const registry = [
  { key: "melee", raw: "ACKS.items.Melee", label: "Melee" },
  { key: "twohanded", raw: "ACKS.items.TwoHanded", label: "Two-handed" },
  { key: "brace", raw: "ACKS.items.Brace", label: "Brace" },
];
const stored = [{ title: "Two-Handed", value: "Two-Handed" }, { title: "Melee", value: "Melee" }, { title: "Iron", value: "Iron" }];
test("a quality reads the field where one exists and the stored tag otherwise, in any spelling", () => {
  const chips = qualityChips(registry, stored, { melee: false });
  assert.deepEqual(chips.map((c) => [c.key, c.on]), [["melee", false], ["twohanded", true], ["brace", false]]);
  assert.equal(qualityChips(registry, [], { melee: true })[0].on, true, "the field wins over a missing tag");
  assert.equal(qualityChips(registry, [{ title: "Brace", value: "ACKS.items.Brace" }])[2].on, true, "core's own spelling reads too");
  assert.deepEqual(otherTags(registry, stored), ["Iron"]);
});
test("a quality click writes the tag in core's spelling and the field it mirrors", () => {
  const on = nextQuality(registry, stored, "melee", true);
  assert.deepEqual(on.tags, [{ title: "Two-Handed", value: "Two-Handed" }, { title: "Iron", value: "Iron" }, { title: "Melee", value: "ACKS.items.Melee" }]);
  assert.equal(on.melee, true);
  const off = nextQuality(registry, stored, "twohanded", false);
  assert.deepEqual(off.tags.map((t) => t.title), ["Melee", "Iron"]);
  assert.ok(!("twohanded" in off), "no field to mirror");
  assert.equal(nextQuality(registry, stored, "bogus", true), null);
});
test("free-text tags add once and remove by their text", () => {
  assert.equal(withTag(stored, " Iron "), null, "already there");
  assert.equal(withTag(stored, "  "), null);
  assert.deepEqual(withTag(stored, "Family heirloom").at(-1), { title: "Family heirloom", value: "Family heirloom" });
  assert.deepEqual(withoutTag(stored, "Iron").map((t) => t.title), ["Two-Handed", "Melee"]);
});

console.log("item sheet: accept kinds");
test("a candidate reads as every kind it is", () => {
  assert.deepEqual([...kindsOf({ type: "weapon", name: "Silver Arrow", ammo: true })].sort(), ["ammunition", "weapons"]);
  assert.deepEqual([...kindsOf({ type: "item", name: "Flask of Oil" })], ["liquids"]);
  assert.deepEqual([...kindsOf({ type: "item", name: "Brass Key" })], ["keys"]);
  assert.deepEqual([...kindsOf({ type: "money", name: "Gold Pieces" })], ["coin"]);
  assert.deepEqual([...kindsOf({ type: "item", name: "Chart of the Vale", chart: true })], ["maps"]);
  assert.deepEqual([...kindsOf({ type: "item", name: "Rope" })], []);
});
test("nothing ticked takes anything; a list refuses what it does not name", () => {
  assert.equal(acceptsKinds([], new Set()), true);
  assert.equal(acceptsKinds(["maps", "scrolls"], new Set(["maps"])), true);
  assert.equal(acceptsKinds(["maps", "scrolls"], new Set(["weapons"])), false);
  assert.deepEqual(cleanAccepts(["maps", "bogus", "scrolls"]), ["scrolls", "maps"], "canonical order, unknown dropped");
});

console.log("item sheet: price ledger");
test("the ledger applies plating, surcharge and resale in the rules' order", () => {
  const { lines, final } = priceLedger({ base: 7, silverMul: 10, masterwork: { label: "+1 to hit", add: 80 }, condition: { label: "Dented", mul: 0.67 } });
  assert.deepEqual(lines.map((l) => l.key), ["listed", "silver", "masterwork", "condition"]);
  assert.equal(lines[1].running, 70);
  assert.equal(lines[2].running, 150);
  assert.equal(final, 100.5);
});
test("variations contribute in the same three phases", () => {
  const { final } = priceLedger({ base: 10, variations: [{ name: "Gilded", add: 2 }, { name: "Masterwork", baseMul: 1.5 }] });
  assert.equal(final, 17, "(10 × 1.5) + 2");
});

console.log(`item sheet: ${passed} checks passed`);
