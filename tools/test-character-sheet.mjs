/**
 * Pure-logic regression tests for the character sheet's view-model. No
 * Foundry: the snapshot is built by hand, so these assert the decisions the
 * frame makes — the XP bar's gold state, the HP fill, the AC cycle, the grip
 * glyphs, the light cell's reading order, the condition riders, the tab
 * badges and the pin store — rather than what a running world happens to
 * render. The one snapshot read that touches Foundry's effect shape, the
 * save modifiers, runs against a hand-built actor whose deprecated numeric
 * shims throw. Every figure is invented fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert";
import {
  xpBar, hpCell, acCell, nextAcMode, slowedTone, moveCell, gripCell, lightCell, saveCells, partyCell, tabList, resolveTab,
  effectivePins, togglePin, buildFrameModel, loadBar, bridgeHands,
} from "../scripts/character-sheet/view-model.mjs";
import { CONDITION_SAVES, RAIL_CONDITIONS, SAVE_KEYS, TAB_ORDER } from "../scripts/character-sheet/constants.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("character sheet: the band");
test("the XP bar fills toward the threshold and goes gold at it", () => {
  assert.deepEqual(xpBar({ value: 500, next: 2000 }), { pct: 25, full: false, value: 500, next: 2000 });
  assert.equal(xpBar({ value: 2000, next: 2000 }).full, true);
  assert.equal(xpBar({ value: 2600, next: 2000 }).pct, 100);
});
test("no threshold means an empty bar that never goes gold", () => {
  assert.deepEqual(xpBar({ value: 900, next: 0 }), { pct: 0, full: false, value: 900, next: null });
  assert.equal(xpBar({}).full, false);
});

console.log("character sheet: the right rail");
test("the heart holds the current total and fills by the fraction", () => {
  assert.deepEqual(hpCell({ value: 9, max: 20 }), { n: 9, pct: 45, zero: false, on: false, tone: null });
  assert.equal(hpCell({ value: 20, max: 20 }).on, true);
});
test("zero hit points reads red and flags the mortal-wounds state", () => {
  const c = hpCell({ value: 0, max: 12 });
  assert.equal(c.zero, true);
  assert.equal(c.tone, "bad");
  assert.equal(hpCell({ value: -3, max: 12 }).pct, 0);
});
test("the AC cycle steps shield → without → unarmoured and back", () => {
  assert.equal(nextAcMode("shield"), "armour");
  assert.equal(nextAcMode("armour"), "none");
  assert.equal(nextAcMode("none"), "shield");
});
test("the AC cell states the reading in force, and collapses shield onto armour with no shield", () => {
  const ac = { value: 6, shield: 1, naked: 1 };
  assert.deepEqual(acCell(ac, "shield"), { mode: "shield", n: 6, hasShield: true });
  assert.deepEqual(acCell(ac, "armour"), { mode: "armour", n: 5, hasShield: true });
  assert.deepEqual(acCell(ac, "none"), { mode: "none", n: 1, hasShield: true });
  assert.deepEqual(acCell({ value: 5, shield: 0, naked: 1 }, "shield"), { mode: "armour", n: 5, hasShield: false });
});
test("the load colours the movement cell: amber past the first breakpoint, red past the last", () => {
  const bp = { low: 25, mid: 35, high: 50 };
  assert.equal(slowedTone(10, bp), null);
  assert.equal(slowedTone(30, bp), "warn");
  assert.equal(slowedTone(60, bp), "bad");
  assert.equal(moveCell({ modes: { exploration: 90, combat: 30 }, pct: 30, breakpoints: bp }, "combat").value, 30);
  assert.equal(moveCell({ modes: { exploration: 90 }, pct: 30, breakpoints: bp }).tone, "warn");
});
test("the grip cell draws open hands, one clenched, both on a haft, or shield and hand", () => {
  assert.deepEqual(gripCell({ weapons: [], cleaves: 1 }).hands, ["open", "open"]);
  assert.equal(gripCell({ weapons: [], cleaves: 1 }).sub, "", "no cleave count with nothing held");
  const one = gripCell({ weapons: [{ name: "Sword", twoHanded: false }], cleaves: 1 });
  assert.deepEqual(one.hands, ["fist", "open"]);
  assert.equal(one.sub, "×1");
  assert.equal(one.tone, "hi");
  const two = gripCell({ weapons: [{ name: "Great axe", twoHanded: true }], cleaves: 2 });
  assert.deepEqual(two.hands, ["fist", "fist"]);
  assert.equal(two.joined, true);
  assert.equal(two.tone, "full");
  const shield = gripCell({ weapons: [{ name: "Sword", twoHanded: true }], shieldInHand: true, cleaves: 0 });
  assert.deepEqual(shield.hands, ["fist", "shield"]);
  assert.equal(shield.joined, false, "a shield in hand denies the two-handed grip");
  assert.equal(shield.sub, "");
});
test("the light cell reads blinded, then a burning source, then daylight, then a sense, then the dark", () => {
  assert.equal(lightCell({ blinded: true, lit: { type: "torch", reach: 30 } }).key, "blind");
  const torch = lightCell({ lit: { type: "torch", remaining: 4, turns: 6, reach: 30 }, ambient: "day" });
  assert.equal(torch.key, "torch");
  assert.equal(torch.sub, "30′");
  assert.equal(torch.pct, 67);
  assert.equal(torch.tone, "tm");
  assert.equal(lightCell({ ambient: "day", sense: { kind: "lightless", range: 60 } }).sub, "∞");
  const dv = lightCell({ ambient: "dark", sense: { kind: "lightless", range: 60 } });
  assert.equal(dv.sub, "60′");
  assert.equal(dv.tone, "hi");
  const dark = lightCell({ ambient: "dark" });
  assert.equal(dark.key, "dark");
  assert.equal(dark.sub, "0′");
  assert.equal(dark.tone, "bad");
});

test("the party cell counts henchmen as a figure and summons as asterisks, for those on the scene", () => {
  const party = { henchmen: [{ onScene: true }, { onScene: false }, { onScene: true }], summons: [{}, {}] };
  const c = partyCell(party);
  assert.equal(c.mode, "party");
  assert.equal(c.sub, "2**");
  assert.equal(c.tone, null);
  assert.equal(partyCell({ henchmen: [{ onScene: false }], summons: [] }).sub, "0", "a party with nobody on the scene reads zero");
  assert.equal(partyCell({ henchmen: [], summons: [{}] }).sub, "0*", "summons alone still show the henchmen figure");
});
test("no party and no formation is a pad; a calamity turns the cell red", () => {
  const none = partyCell({});
  assert.equal(none.mode, "none");
  assert.equal(none.pad, true);
  assert.equal(partyCell({ henchmen: [{ onScene: true }], calamity: 1 }).tone, "neg");
});
test("the cell promotes to the formation only when its party token is on the scene", () => {
  const away = partyCell({ formation: { name: "The Company", onScene: false, membersOnScene: 0 }, henchmen: [{ onScene: true }], summons: [] });
  assert.equal(away.mode, "party");
  const here = partyCell({ formation: { name: "The Company", onScene: true, membersOnScene: 5 }, henchmen: [{ onScene: true }], summons: [{}] });
  assert.equal(here.mode, "formation");
  assert.equal(here.sub, "5");
  assert.equal(here.icon, "fa-solid fa-people-line");
});

console.log("character sheet: the left rail");
test("every condition mapping names a real save or a real right-rail cell", () => {
  for (const save of Object.values(CONDITION_SAVES)) assert.ok(SAVE_KEYS.includes(save), save);
  for (const cell of Object.values(RAIL_CONDITIONS)) assert.ok(["move", "hp", "light"].includes(cell), cell);
});
test("a clean save cell carries its glyph, its target and no tone", () => {
  const cells = saveCells({ saves: { paralysis: 13, death: 14, blast: 15, implements: 16, spell: 17 } });
  assert.equal(cells.length, 5);
  assert.deepEqual(cells.map((c) => c.target), [13, 14, 15, 16, 17]);
  assert.ok(cells.every((c) => c.tone === null && c.sub === ""));
});
test("a rider takes over its save: clock, fill, corner glyph, and a count when two share it", () => {
  const riders = [
    { save: "paralysis", name: "Webbed", clock: "3r", remaining: 3, total: 6, icon: "fa-solid fa-spider" },
    { save: "paralysis", name: "Held", clock: "held", remaining: null, total: 0 },
    { save: "death", name: "Poisoned", clock: "6r", remaining: 6, total: 10 },
  ];
  const [par, death, blast] = saveCells({ saves: {}, riders });
  assert.equal(par.tone, "neg");
  assert.equal(par.pct, 50);
  assert.equal(par.sub, "3r");
  assert.equal(par.count, 2);
  assert.equal(par.corner, "fa-solid fa-snowflake");
  assert.equal(death.pct, 60);
  assert.equal(death.count, 0);
  assert.equal(blast.tone, null);
});
test("a modifier in force colours the save green or amber, and splits under a rider", () => {
  const cells = saveCells({ saves: {}, saveMods: { spell: 1, death: -1 } });
  assert.equal(cells[4].tone, "pos");
  assert.equal(cells[4].sub, "+1");
  assert.equal(cells[1].tone, "warn");
  assert.equal(cells[1].sub, "−1");
  const split = saveCells({ saves: {}, saveMods: { spell: 1 }, riders: [{ save: "spell", clock: "4t", remaining: 4, total: 5 }] })[4];
  assert.equal(split.tone, "split");
  assert.equal(split.sub, "+1 4t");
});

console.log("character sheet: the tab strip");
test("Magic appears for a caster only, and the order is fixed", () => {
  assert.deepEqual(tabList({}).map((t) => t.key), TAB_ORDER.filter((k) => k !== "magic"));
  assert.deepEqual(tabList({ caster: true }).map((t) => t.key), [...TAB_ORDER]);
});
test("counts sit on Followers and Effects; gold badges are choices waiting; Class goes gold when full", () => {
  const tabs = tabList({ pending: 2, followers: 3, timers: 1, full: true, hasClass: true, unansweredPaths: 1 });
  const by = Object.fromEntries(tabs.map((t) => [t.key, t]));
  assert.equal(by.abilities.p, 2);
  assert.equal(by.followers.n, 3);
  assert.equal(by.effects.n, 1);
  assert.equal(by.class.dyn, true);
  assert.equal(by.class.p, 1);
  assert.equal(by.rolls.n, undefined);
  assert.equal(tabList({ full: true, hasClass: false }).find((t) => t.key === "class").dyn, undefined, "no class, nothing to advance");
});
test("the active tab survives when it still exists and falls back to the first otherwise", () => {
  assert.equal(resolveTab("magic", ["rolls", "stats"]), "rolls");
  assert.equal(resolveTab("stats", ["rolls", "stats"]), "stats");
});

console.log("character sheet: pins");
test("pins are bounded to what still exists and toggle in pin order", () => {
  assert.deepEqual(effectivePins(["save:death", "gone", "adv:climb"], ["save:death", "adv:climb"]), ["save:death", "adv:climb"]);
  assert.deepEqual(togglePin(["a"], "b"), ["a", "b"]);
  assert.deepEqual(togglePin(["a", "b"], "a"), ["b"]);
  assert.deepEqual(togglePin(undefined, "a"), ["a"]);
});

console.log("character sheet: the frame");
test("the frame model composes the parts and respects the viewer's mode choices", () => {
  const snap = {
    xp: { value: 2000, next: 2000 },
    hp: { value: 12, max: 12 },
    ac: { value: 6, shield: 1, naked: 1 },
    move: { modes: { exploration: 120, combat: 40 }, pct: 10, breakpoints: { low: 25, mid: 35, high: 50 } },
    grip: { weapons: [{ name: "Sword", twoHanded: false }], cleaves: 1 },
    light: { ambient: "dark" },
    saves: { paralysis: 13 },
    riders: [],
    saveMods: {},
    formation: { name: "The Company" },
    caster: true,
    hasClass: true,
    followers: 2,
  };
  const m = buildFrameModel(snap, { isGM: false, activeTab: "magic", acMode: "none", moveMode: "combat", folded: true });
  assert.equal(m.xp.full, true);
  assert.equal(m.active, "magic");
  assert.equal(m.rails.ac.n, 1);
  assert.equal(m.rails.move.value, 40);
  assert.equal(m.rails.formation.name, "The Company");
  assert.equal(m.rails.party.mode, "none", "no party facts given: the cell is a pad");
  assert.equal(m.folded, true);
  assert.ok(!m.rails.tools.some((t) => t.key === "source"), "the source cell is the Judge's");
  assert.ok(buildFrameModel(snap, { isGM: true }).rails.tools.some((t) => t.key === "source"));
  assert.equal(m.tabs.find((t) => t.key === "class").dyn, true);
});

console.log("character sheet: the snapshot's effect reads");
// Foundry 14 names an effect change by its string `type` and a duration by
// `{value, units}`; the numeric enum, a change's `mode` and a duration's
// `rounds`/`turns`/`seconds` survive only as shims that log a deprecation on
// every read. All of them THROW here, so a read of any fails the suite
// instead of logging on a live client.
globalThis.CONST = {
  ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 },
};
Object.defineProperty(globalThis.CONST, "ACTIVE_EFFECT_MODES", {
  get() {
    throw new Error("accessed deprecated CONST.ACTIVE_EFFECT_MODES");
  },
});
const { saveModifiers, effectClock, isTimer } = await import("../scripts/character-sheet/snapshot.mjs");
const throwing = (target, ...keys) => {
  for (const k of keys) {
    Object.defineProperty(target, k, {
      get() {
        throw new Error(`accessed deprecated ${k}`);
      },
    });
  }
  return target;
};
const change = (key, type, value, priority = null) => throwing({ key, type, value: String(value), priority }, "mode");
const withEffects = (...effects) => ({
  _source: { system: { save: { mod: 0 }, saves: { paralysis: { value: 13 }, death: { value: 14 }, breath: { value: 15 }, implements: { value: 16 }, spell: { value: 17 } } } },
  appliedEffects: effects.map((e) => ({ disabled: false, ...e })),
});
test("an add on the all-save modifier colours every save; a subtraction reads negative; a lowered target reads as help", () => {
  const mods = saveModifiers(withEffects(
    { changes: [change("system.save.mod", "add", 2)] },
    { changes: [change("system.save.mod", "subtract", 1)] },
    { changes: [change("system.saves.breath.value", "add", -1)] },
  ));
  assert.deepEqual(mods, { paralysis: 1, death: 1, blast: 2, implements: 1, spell: 1 });
});
test("an override, a multiply or a bound reads as the shift it makes to the source value, in Foundry's order", () => {
  const mods = saveModifiers(withEffects(
    { changes: [change("system.saves.death.value", "override", 10)] },
    { changes: [change("system.saves.spell.value", "multiply", 2)] },
    { changes: [change("system.saves.implements.value", "downgrade", 12), change("system.saves.paralysis.value", "upgrade", 12)] },
    { changes: [change("system.save.mod", "add", 2), change("system.save.mod", "override", 0)] },
  ));
  // death 14 → 10 helps by 4; spell 17 → 34 hinders by 17; implements 16 → 12 helps by 4; paralysis stays 13;
  // the all-save +2 is set back to 0 by the override, which applies last.
  assert.deepEqual(mods, { paralysis: 0, death: 4, blast: 0, implements: 4, spell: -17 });
});
test("a disabled effect, a custom change, a non-number or another field counts for nothing", () => {
  const mods = saveModifiers(withEffects(
    { disabled: true, changes: [change("system.save.mod", "add", 4)] },
    { changes: [change("system.save.mod", "custom", 1), change("system.save.mod", "add", "not a number"), change("system.hp.max", "add", 3)] },
  ));
  assert.deepEqual(mods, { paralysis: 0, death: 0, blast: 0, implements: 0, spell: 0 });
  assert.deepEqual(saveModifiers({ appliedEffects: [{ disabled: false, changes: [change("system.save.mod", "add", 1)] }] }).death, 1, "no source at all reads from zero");
});

console.log("character sheet: the clock");
// A fixture effect as Foundry 14 hands it over: the source duration in
// {value, units}, the prepared duration with what is left, and the legacy
// unit getters throwing on both.
const timed = (value, units, prepared = null) => ({
  disabled: false,
  _source: { duration: throwing({ value, units, expiry: null, expired: false }, "rounds", "turns", "seconds") },
  duration: prepared ? throwing({ ...prepared }, "rounds", "turns") : throwing({ value, units, remaining: Infinity }, "rounds", "turns"),
});
globalThis.CONFIG = { time: { roundTime: 60, turnTime: 0 } };
test("rounds and turns count in combat, and outside it are read back through the world's round length", () => {
  assert.deepEqual(effectClock(timed(6, "rounds", { units: "rounds", remaining: 4 })), { clock: "4r", remaining: 4, total: 6, units: "rounds" });
  assert.deepEqual(effectClock(timed(6, "rounds", { units: "seconds", remaining: 360 })), { clock: "6r", remaining: 6, total: 6, units: "rounds" });
  assert.equal(effectClock(timed(6, "rounds", { units: "seconds", remaining: 330 })).clock, "6r", "a part round still to run rounds up");
  assert.equal(effectClock(timed(6, "rounds", { units: "seconds", remaining: 300 })).remaining, 5);
  assert.deepEqual(effectClock(timed(3, "turns", { units: "turns", remaining: 2 })), { clock: "2t", remaining: 2, total: 3, units: "turns" });
  assert.deepEqual(effectClock(timed(3, "turns")), { clock: "3t", remaining: null, total: 3, units: "turns" }, "turns take no world time here: the clock stands at its total");
  assert.deepEqual(effectClock(timed(6, "rounds", { units: "rounds", remaining: -2 })), { clock: "0r", remaining: 0, total: 6, units: "rounds" }, "an expired timer reads zero, never negative");
});
test("every time unit reads in the unit the effect was given, with the calendar's own count of what is left", () => {
  assert.deepEqual(effectClock(timed(30, "minutes", { units: "minutes", remaining: 12 })), { clock: "12m", remaining: 12, total: 30, units: "minutes" });
  assert.equal(effectClock(timed(2, "hours", { units: "hours", remaining: 2 })).clock, "2h");
  assert.equal(effectClock(timed(3, "days", { units: "days", remaining: 1 })).clock, "1d");
  assert.equal(effectClock(timed(2, "months", { units: "months", remaining: 2 })).clock, "2mo");
  assert.deepEqual(effectClock(timed(2, "months", { units: "months", remaining: 3 })), { clock: "2mo", remaining: 2, total: 2, units: "months" }, "core counts a month's remainder up past the total; what is left never exceeds what was given");
  assert.equal(effectClock(timed(1, "years", { units: "years", remaining: 1 })).clock, "1y");
  assert.equal(effectClock(timed(2, "hours")).clock, "2h", "nothing prepared: the total stands");
});
test("seconds climb to minutes, hours or days by the world calendar, and to Earth's lengths without one", () => {
  const at = (s) => effectClock(timed(s, "seconds", { units: "seconds", remaining: s })).clock;
  assert.equal(at(30), "30s");
  assert.equal(at(90), "2m");
  assert.equal(at(5400), "2h");
  assert.equal(at(172800), "2d");
  globalThis.game = { time: { calendar: { days: { secondsPerMinute: 60, minutesPerHour: 60, hoursPerDay: 10 } } } };
  assert.equal(at(36000), "1d", "a ten-hour day is a day");
  assert.equal(at(9000), "3h");
  delete globalThis.game;
});
test("no duration is no timer, and a disabled timer is not one either", () => {
  assert.deepEqual(effectClock(timed(null, "seconds")), { clock: "—", remaining: null, total: 0, units: null });
  assert.equal(isTimer(timed(null, "seconds")), false);
  assert.equal(isTimer(timed(6, "rounds")), true);
  assert.equal(isTimer({ ...timed(6, "rounds"), disabled: true }), false);
  assert.equal(effectClock({}).clock, "—");
});
delete globalThis.CONFIG;

console.log("character sheet: the Load bar");
test("the bar fills to the burden and runs a phantom on to the true weight", () => {
  const bar = loadBar({ value6: 26, true6: 32, max6: 120, pct: 22, breakpoints: { low: 25, mid: 50, high: 75 } });
  assert.deepEqual(bar, { pct: 22, phantom: 5, capped: false, eased6: 6, ticks: [25, 50, 75] });
});
test("past the maximum the phantom stops at the end of the track and says so", () => {
  const bar = loadBar({ value6: 100, true6: 140, max6: 120, pct: 83, breakpoints: {} });
  assert.deepEqual([bar.pct, bar.phantom, bar.capped, bar.eased6, bar.ticks], [83, 17, true, 40, []]);
});
test("no phantom when nothing is forgiven, or when a correction adds weight", () => {
  assert.equal(loadBar({ value6: 30, true6: 30, max6: 120, pct: 25, breakpoints: {} }).phantom, 0);
  const heavier = loadBar({ value6: 36, true6: 30, max6: 120, pct: 30, breakpoints: {} });
  assert.deepEqual([heavier.phantom, heavier.eased6], [0, 0]);
});
test("with no maximum the fill falls back to the system's own percentage and draws no phantom", () => {
  const bar = loadBar({ value6: 30, true6: 40, max6: 0, pct: 40, breakpoints: {} });
  assert.deepEqual([bar.pct, bar.phantom, bar.capped], [40, 0, false]);
});

console.log("character sheet: the hands");
const place = (key, rows = [], extra = {}) => ({ key, label: key, icon: `i-${key}`, rows, empty: !rows.length, capacity: `${rows.length} / 1`, full: false, equip: rows.length, magic: 0, ...extra });
test("with nothing held in both hands the hands stay apart and the both-hands place is not listed", () => {
  const places = bridgeHands([place("head"), place("mainHand", [{ id: "sw" }]), place("offHand"), place("bothHands")]);
  assert.deepEqual(places.map((p) => p.key), ["head", "mainHand", "offHand"]);
  assert.equal(places[1].span, undefined);
});
test("a weapon in both hands folds the hands into one spanning row that keeps the main hand's key", () => {
  const places = bridgeHands([place("head"), place("mainHand"), place("offHand"), place("bothHands", [{ id: "gs" }], { label: "Both hands", hint: "held in both" })]);
  assert.deepEqual(places.map((p) => p.key), ["head", "mainHand"]);
  const hands = places[1];
  assert.equal(hands.label, "Both hands");
  assert.deepEqual(hands.rows.map((r) => r.id), ["gs"]);
  assert.deepEqual(hands.span, [{ key: "mainHand", label: "mainHand", icon: "i-mainHand" }, { key: "offHand", label: "offHand", icon: "i-offHand" }]);
  assert.deepEqual([hands.empty, hands.capacity, hands.full], [false, null, false]);
});
test("the spanning row lists what both hands hold first and is full past two things", () => {
  const places = bridgeHands([place("mainHand", [{ id: "a" }]), place("offHand", [{ id: "b" }]), place("bothHands", [{ id: "gs" }])]);
  assert.deepEqual(places[0].rows.map((r) => r.id), ["gs", "a", "b"]);
  assert.equal(places[0].full, true);
});

console.log(`character sheet: ${passed} passed`);
