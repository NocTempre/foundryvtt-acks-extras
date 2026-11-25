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
import { readFileSync } from "node:fs";
import {
  xpBar, hpCell, acCell, nextAcMode, slowedTone, moveCell, gripCell, lightCell, saveCells, partyCell, tabList, resolveTab,
  effectivePins, togglePin, buildFrameModel, loadBar, bridgeHands, slotBadge, storedSystem, carriesMorale, partyMenuModel, standingBySpell,
  castMenuModel, castTrackers, castTrackerKey, castTrackerShape, castRail, isCaster, CAST_TRACKERS,
} from "../scripts/character-sheet/view-model.mjs";
import { CONDITION_SAVES, RAIL_CONDITIONS, SAVE_KEYS, TAB_ORDER } from "../scripts/character-sheet/constants.mjs";
import { buildThrows } from "../scripts/character-sheet/tabs/stats.mjs";

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

console.log("character sheet: the party menu and the cast column");
/** A summon entry as `partyOf` gives it; a null record is one bound by hand. */
const summonEntry = (tokenId, record) => ({ tokenId, held: null, name: `Beast ${tokenId}`, img: null, record });
/** A summon riding in a party token, as `summonsOnScene` lists it. */
const heldEntry = (actorId, record) => ({ tokenId: null, held: { partyId: "pty", actorId }, name: `Held ${actorId}`, img: null, record });
/** The ids an entry list reaches: a scene token by its id, a held summon by its member id. */
const reachedIds = (entries) => entries.map((e) => e.tokenId ?? e.held.actorId);
const castRecord = (castId, spellId = "", extra = {}) => ({ castId, spellId, sourceUuid: "Actor.src1", name: "Grey Beast", at: 10, ...extra });
const menuKinds = (items) => items.map((i) => i.kind);
/** A summoning spell as `castOf` gives it. */
const summonSpell = (id, name, level = 3) => ({ id, name, level, summon: true });
/** A spell that casts through its own use. */
const plainSpell = (id, name, level = 1) => ({ id, name, level, summon: false });
test("every summoning spell is offered: Cast while none of its creatures stand, Dismiss with the count once some do", () => {
  const spells = [summonSpell("spB", "Bramble Call"), summonSpell("spA", "Ash Call")];
  const party = { henchmen: [], summons: [summonEntry("t1", castRecord("c1", "spB")), summonEntry("t2", castRecord("c1", "spB")), summonEntry("t3", castRecord("c2", "spB"))] };
  const items = castMenuModel({ party, spells, owner: true });
  const cast = items.find((i) => i.kind === "cast");
  assert.deepEqual([cast.spellId, cast.key, cast.data.name], ["spA", "party.cast", "Ash Call"], "the spell with nothing standing offers Cast");
  const dismiss = items.filter((i) => i.kind === "dismiss");
  assert.equal(dismiss.length, 1, "one Dismiss per spell, whatever number of casts stand");
  assert.deepEqual([dismiss[0].spellId, dismiss[0].data, reachedIds(dismiss[0].entries)], ["spB", { name: "Bramble Call", n: 3 }, ["t1", "t2", "t3"]], "the spell's Dismiss names it, counts its standing creatures and covers both casts");
  assert.ok(!items.some((i) => i.kind === "cast" && i.spellId === "spB"), "no Cast while the spell's creatures stand");
  assert.ok(menuKinds(items).indexOf("cast") < menuKinds(items).indexOf("dismiss"), "the spells read in name order");
  assert.ok(!items.some((i) => i.kind === "dismissAll"), "one Dismiss needs no Dismiss all");
});
test("a cast whose spell is gone is a loose cast, dismissed by itself under its record's name", () => {
  const party = { summons: [summonEntry("t1", castRecord("c9", "gone1", { spellName: "Old Word" })), summonEntry("t2", castRecord("c9", "gone1", { spellName: "Old Word" })), summonEntry("t3", castRecord("c8"))] };
  const items = castMenuModel({ party, spells: [], owner: true });
  const loose = items.filter((i) => i.kind === "dismiss");
  assert.deepEqual(loose.map((i) => [i.castId, i.data.name, reachedIds(i.entries)]), [["c9", "Old Word", ["t1", "t2"]], ["c8", "Grey Beast", ["t3"]]], "a dangling spell reads by its recorded name; a bare summoning by its creature's");
  const all = items.find((i) => i.kind === "dismissAll");
  assert.deepEqual(reachedIds(all.entries), ["t1", "t2", "t3"], "two dismissals add Dismiss all over every recorded summon");
  assert.deepEqual(all.tipData, { n: 3 });
});
test("a creature bound by hand keeps Release and is never in a Dismiss", () => {
  const party = { summons: [summonEntry("t1", null), summonEntry("t2", castRecord("c1", "spA"))] };
  const items = castMenuModel({ party, spells: [summonSpell("spA", "Ash Call")], owner: true });
  const release = items.find((i) => i.kind === "release");
  assert.deepEqual([release.tokenIds, release.data], [["t1"], { n: 1 }]);
  assert.ok(items.filter((i) => i.entries).every((i) => !reachedIds(i.entries).includes("t1")), "no Dismiss reaches the bound creature");
});
test("every standing summon is reached by exactly one of spell Dismiss, loose Dismiss and Release", () => {
  // A GM's bare summoning cast from a spell that is no summoning spell: its id resolves on the actor but not among the summoning spells.
  const party = {
    summons: [
      summonEntry("a", castRecord("c1", "spA")),
      summonEntry("b", castRecord("c2", "plain1", { spellName: "Plain Word" })),
      summonEntry("c", castRecord("c3")),
      summonEntry("d", null),
      summonEntry("e", castRecord("c4", "spA")),
    ],
  };
  const items = castMenuModel({ party, spells: [summonSpell("spA", "Ash Call"), plainSpell("plain1", "Plain Word")], owner: true });
  const reach = new Map();
  for (const it of items.filter((i) => i.kind === "dismiss" || i.kind === "release")) for (const id of it.entries ? reachedIds(it.entries) : it.tokenIds) reach.set(id, (reach.get(id) ?? 0) + 1);
  assert.deepEqual([...reach.entries()].sort(), [["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1]]);
});
test("a spell that does not summon is cast through its own use, in spell-level then name order, with its level shown", () => {
  const spells = [plainSpell("p2", "Zephyr", 2), summonSpell("s3", "Ash Call", 3), plainSpell("p1b", "Mend", 1), plainSpell("p1a", "Bolt", 1)];
  const items = castMenuModel({ party: {}, spells, owner: true });
  assert.deepEqual(items.map((i) => i.spellId), ["p1a", "p1b", "p2", "s3"], "level first, then name");
  assert.deepEqual(menuKinds(items), ["use", "use", "use", "cast"]);
  assert.deepEqual([items[0].label, items[0].valueKey, items[0].valueData], ["Bolt", "cast.level", { n: 1 }]);
  assert.ok(items.every((i) => i.kind !== "use" || i.tipKey === "cast.levelTip"), "the level on a plain spell's row names where it is read from, and the summoning cast's tip is not hung on it");
});
test("the cast menu is the owner's alone; the spell-less Summon… is offered only where the seat may summon bare", () => {
  const party = { summons: [summonEntry("t1", castRecord("c1", "spA"))] };
  const spells = [summonSpell("spA", "Ash Call"), plainSpell("p1", "Bolt")];
  assert.deepEqual(castMenuModel({ party, spells, owner: false, bare: true }), [], "a seat that does not own the character is offered nothing");
  assert.ok(!castMenuModel({ party, spells, owner: true, bare: false }).some((i) => i.kind === "summon"), "a Player seat is offered no Summon…");
  assert.ok(castMenuModel({ party, spells, owner: true, bare: true }).some((i) => i.kind === "summon"), "a GM seat is");
});
test("binding by hand is retired: the menu offers no Bind; an owner with nothing to cast gets one disabled row", () => {
  assert.ok(!castMenuModel({ party: {}, owner: true, controlled: [{ id: "x" }] }).some((i) => i.kind === "bind"), "no Bind, whatever is controlled");
  const none = castMenuModel({ party: {}, owner: true });
  assert.deepEqual([menuKinds(none), none[0].disabled, none[0].key], [["none"], true, "cast.nothing"]);
});
test("the owner rows follow the spells in the order loose Dismiss, Dismiss all, Summon…, Release", () => {
  const party = { summons: [summonEntry("t1", castRecord("c1")), summonEntry("t2", castRecord("c2", "spA")), summonEntry("t3", null)] };
  const items = castMenuModel({ party, spells: [summonSpell("spA", "Ash Call")], owner: true, bare: true });
  assert.deepEqual(menuKinds(items), ["dismiss", "dismiss", "dismissAll", "summon", "release"]);
});
test("the party menu keeps who stands, who is away, the roster and the Followers tab, and no summon management", () => {
  const party = { henchmen: [{ onScene: true, tokenIds: ["h1"], name: "Henchling", img: null }, { onScene: false }], summons: [summonEntry("t1", castRecord("c1", "spA")), summonEntry("t2", null)] };
  const owner = partyMenuModel({ party, owner: true, roster: true });
  assert.deepEqual(menuKinds(owner), ["token", "token", "token", "info", "roster", "tab"], "the owner's menu holds the token rows, the away count, the roster and the tab");
  assert.deepEqual(owner.slice(0, 3).map((i) => i.valueKey), ["party.henchman", "party.summon", "party.summon"]);
  assert.deepEqual(menuKinds(partyMenuModel({ party, owner: false, roster: true })), ["token", "token", "token", "info", "tab"], "a viewer sees who stands and the tab, no roster");
  assert.deepEqual(menuKinds(partyMenuModel({ party, owner: true, roster: false })), ["token", "token", "token", "info", "tab"], "a hireling's sheet shows no roster");
  assert.deepEqual(menuKinds(partyMenuModel({ party: {}, owner: true, roster: true })), ["roster", "tab"], "a character with no party still reaches the roster and the tab");
});
test("the Magic tab's standing count groups the summons by the spell their record names", () => {
  const m = standingBySpell([summonEntry("t1", castRecord("c1", "spA")), summonEntry("t2", castRecord("c2", "spA")), summonEntry("t3", castRecord("c3")), summonEntry("t4", null)]);
  assert.deepEqual([...m.entries()].map(([id, list]) => [id, reachedIds(list)]), [["spA", ["t1", "t2"]]]);
});
test("a summon held in the party token is counted and dismissed beside the ones on the scene", () => {
  const party = { summons: [summonEntry("t1", castRecord("c1", "spA")), heldEntry("m2", castRecord("c1", "spA")), heldEntry("m3", castRecord("c2"))] };
  const items = castMenuModel({ party, spells: [summonSpell("spA", "Ash Call")], owner: true });
  const dismiss = items.find((i) => i.kind === "dismiss" && i.spellId === "spA");
  assert.deepEqual([reachedIds(dismiss.entries), dismiss.data.n], [["t1", "m2"], 2], "the spell's Dismiss holds the token and the held summon, and counts both");
  assert.deepEqual(dismiss.entries[1].held, { partyId: "pty", actorId: "m2" }, "a held entry names its party and member for the relay");
  assert.deepEqual(reachedIds(items.find((i) => i.kind === "dismiss" && i.castId === "c2").entries), ["m3"], "a loose cast reaches its held summon too");
  assert.deepEqual([...standingBySpell(party.summons).get("spA")].map((e) => e.tokenId), ["t1", null], "the Magic tab counts the held one");
  const menu = partyMenuModel({ party, owner: true });
  assert.deepEqual(menu.filter((i) => i.kind === "token").map((i) => [i.tokenId, !!i.disabled]), [["t1", false], [null, true], [null, true]], "a held summon is listed and has no token to pick");
});
test("the Magic tab's standing count carries its tooltip and its Dismiss is named and wired", () => {
  const tpl = readFileSync(new URL("../templates/character-sheet/spell-row.hbs", import.meta.url), "utf8");
  assert.match(tpl, /data-tooltip-text="\{\{spell\.summon\.tip\}\}">\{\{spell\.summon\.label\}\}/, "the count shows its provenance on hover");
  const dismiss = tpl.split("\n").find((l) => l.includes('data-action="spellDismiss"'));
  assert.ok(dismiss && /<button type="button"/.test(dismiss) && /aria-label="\{\{localize /.test(dismiss), "a real button with a name");
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /spellDismiss: AcksCharacterSheet\.#onSpellDismiss/);
});

/** The Magic tab's rows for a caster holding the given spells and effects, with the fights `fights` names standing in the world. */
const magicTabOf = async ({ spells, effects = [], fights = {} }) => {
  const priorGame = globalThis.game;
  const priorCanvas = globalThis.canvas;
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` }, combats: { get: (id) => fights[id] ?? null }, scenes: { active: null } };
  globalThis.canvas = { scene: null };
  try {
    const { buildMagicTab } = await import("../scripts/character-sheet/tabs/magic.mjs");
    const actor = { name: "Testcaster", uuid: "Actor.c", type: "character", system: { spells: { enabled: true } }, items: spells, effects, isOwner: true, getFlag: () => null };
    return buildMagicTab(actor).levels.flatMap((level) => level.rows);
  } finally {
    globalThis.game = priorGame;
    globalThis.canvas = priorCanvas;
  }
};
const magicSpell = (id, name, { summoning = false } = {}) => ({ id, uuid: `Actor.c.Item.${id}`, name, img: "", type: "spell", parent: { type: "character" }, system: { lvl: 1 }, flags: summoning ? { "acks-extras": { spell: { type: "summoning" } } } : {} });
const declaredEffect = (castId, spellUuid, pending) => ({ id: `e${castId}`, flags: { "acks-extras": { spellEffect: { spellUuid, castId, casterUuid: "Actor.c", role: "caster", pending: { spellUuid, combatId: "k1", round: 2, declaredRound: 2, at: 10, ...pending } } } } });
const declaredOf = async (spells, effects, fights = { k1: { round: 2, scene: { name: "Testyard" } } }) => Object.fromEntries((await magicTabOf({ spells, effects, fights })).map((row) => [row.id, row.declared]));

const testAsync = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
await testAsync("a spell with a pending declaration shows the Declared tag, a line naming the fight and the caster's turn, and a tooltip assembled at render; a summoning is placed and any other cast is cast", async () => {
  const spells = [magicSpell("sp1", "Ash Call", { summoning: true }), magicSpell("sp2", "Testbolt"), magicSpell("sp3", "Idle")];
  const rows = await declaredOf(spells, [declaredEffect("c1", "Actor.c.Item.sp1", {}), declaredEffect("c2", "Actor.c.Item.sp2", { declaredRound: undefined })]);
  assert.deepEqual(rows.sp3, null, "a spell with no declaration shows nothing");
  const fight = 'ACKS-MAGIC.cast.dialog.fightOnRound|{\\"scene\\":\\"Testyard\\",\\"round\\":2}';
  assert.deepEqual(rows.sp1, {
    tag: "ACKS-CHARACTER.magic.declared|{}",
    line: `ACKS-CHARACTER.magic.declaredLine|{"fight":"${fight}","name":"Testcaster"}`,
    tip: `ACKS-CHARACTER.magic.declaredTip|{"spell":"Ash Call","fight":"${fight}","name":"Testcaster"}`,
  }, "a summoning's tooltip says it is placed");
  assert.match(rows.sp2.tip, /^ACKS-CHARACTER\.magic\.declaredTipCast\|/, "any other spell's says it is cast");
  assert.ok(rows.sp2.line.includes("fightOn|") && !rows.sp2.line.includes("fightOnRound"), "a record written before the round was stored names the fight without a round");
});
await testAsync("a lost declaration shows nothing (a lapsed one is deleted with its records), one still standing shows whatever round its fight is in, and one whose fight is gone still shows, naming no fight", async () => {
  const spells = [magicSpell("sp1", "Testbolt")];
  const standing = await declaredOf(spells, [declaredEffect("c1", "Actor.c.Item.sp1", { round: 1 })]);
  assert.ok(standing.sp1, "the record stands until the caster's turn that reaches its lapse round ends, and the cast would still resolve it");
  const lost = await declaredOf(spells, [declaredEffect("c1", "Actor.c.Item.sp1", { lost: { cause: "damage", at: 11 } })]);
  assert.equal(lost.sp1, null);
  const gone = await declaredOf(spells, [declaredEffect("c1", "Actor.c.Item.sp1", { combatId: "k9" })], {});
  assert.deepEqual([gone.sp1.tag, gone.sp1.line, gone.sp1.tip], ["ACKS-CHARACTER.magic.declared|{}", 'ACKS-CHARACTER.magic.declaredLineNoFight|{"fight":"","name":"Testcaster"}', 'ACKS-CHARACTER.magic.declaredTipCastNoFight|{"spell":"Testbolt","fight":"","name":"Testcaster"}'], "Declared, with no fight named");
  const other = await declaredOf(spells, [{ id: "plain", flags: {} }, declaredEffect("c1", "Actor.c.Item.other", {})]);
  assert.equal(other.sp1, null, "an effect no cast wrote, and another spell's declaration, are not this row's");
});
test("the Magic tab's row draws the tag and the line from the declaration and has no control to withdraw it", () => {
  const tpl = readFileSync(new URL("../templates/character-sheet/spell-row.hbs", import.meta.url), "utf8");
  assert.match(tpl, /<span class="acks-tag acks-tag--solid" data-tooltip-text="\{\{spell\.declared\.tip\}\}">\{\{spell\.declared\.tag\}\}<\/span>/, "the tag shows its provenance on hover");
  assert.match(tpl, /\{\{spell\.declared\.line\}\}/);
  assert.ok(!/withdraw/i.test(tpl), "no page prints withdrawing a declared cast, so the row has no control for it");
});

await testAsync("a summoning's row counts what stands and, where some ride in a party, how many joined it; its tooltips say where the count came from", async () => {
  const priorGame = globalThis.game;
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const { summonRowOf } = await import("../scripts/character-sheet/tabs/magic.mjs");
    const scene = { name: "Testyard" };
    const token = { tokenId: "t1", held: null, party: null };
    const held = (actorId, name = "Hollow Company") => ({ tokenId: null, held: { partyId: "pty", actorId }, party: { id: "pty", name } });
    assert.deepEqual(summonRowOf([], { scene }), { standing: 0, label: 'ACKS-CHARACTER.magic.standing|{"n":0}', tip: 'ACKS-CHARACTER.magic.standingTip|{"n":0,"scene":"Testyard"}', joined: null }, "nothing standing reads the scene's tooltip and no joined figure");
    assert.deepEqual(summonRowOf([token, token], { scene: null }).tip, 'ACKS-CHARACTER.magic.standingTip|{"n":2,"scene":"—"}', "tokens read the scene's tooltip, with a dash where there is no scene");
    assert.equal(summonRowOf([token, token], { scene }).joined, null);
    const all = summonRowOf([held("m1"), held("m2")], { scene });
    assert.deepEqual([all.standing, all.label, all.tip], [2, 'ACKS-CHARACTER.magic.standing|{"n":2}', 'ACKS-CHARACTER.magic.standingTipParty|{"n":2,"party":"Hollow Company"}'], "every creature held in the party reads the party's tooltip");
    assert.deepEqual(all.joined, { n: 2, label: 'ACKS-CHARACTER.magic.joined|{"n":2,"party":"Hollow Company"}', tip: 'ACKS-CHARACTER.magic.standingTipParty|{"n":2,"party":"Hollow Company"}' });
    const mixed = summonRowOf([token, held("m1")], { scene });
    assert.deepEqual([mixed.standing, mixed.tip, mixed.joined.n], [2, 'ACKS-CHARACTER.magic.standingTip|{"n":2,"scene":"Testyard"}', 1], "a token among them keeps the scene's tooltip, and only the held one is counted as joined");
    assert.equal(summonRowOf([held("m1", "Hollow Company"), held("m2", "Second Band")], { scene }).joined.label, 'ACKS-CHARACTER.magic.joined|{"n":2,"party":"Hollow Company, Second Band"}', "two parties are both named");
  } finally {
    globalThis.game = priorGame;
  }
});
test("the Magic tab's row marks its standing count and its joined count, each with its provenance on hover, and draws no literal id or title", () => {
  const tpl = readFileSync(new URL("../templates/character-sheet/spell-row.hbs", import.meta.url), "utf8");
  assert.match(tpl, /data-summon="standing" data-tooltip-text="\{\{spell\.summon\.tip\}\}">\{\{spell\.summon\.label\}\}/);
  assert.match(tpl, /\{\{#if spell\.summon\.joined\}\}<span [^>]*data-summon="joined" data-tooltip-text="\{\{spell\.summon\.joined\.tip\}\}">\{\{spell\.summon\.joined\.label\}\}<\/span>/, "the joined figure shows only where some joined");
  assert.ok(!/\sid=|\stitle=/.test(tpl), "no literal id (a second copy of the sheet would duplicate it) and no title attribute");
});

/**
 * The Magic tab's whole context for a caster holding `spells`. `casting` binds an invented class that casts from
 * those rows (null binds none); `spent` is the actor's spent pools; `cite` the class document's own citation.
 */
const magicContextOf = async ({ spells, casting = null, ladders = [], cite = "", owner = true, spent = {}, level = 1, isGM = false, effects = [], fights = {} }) => {
  const priorGame = globalThis.game;
  const priorCanvas = globalThis.canvas;
  const priorUuid = globalThis.fromUuidSync;
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` }, combats: { get: (id) => fights[id] ?? null }, scenes: { active: null }, user: { isGM } };
  globalThis.canvas = { scene: null };
  const doc = { uuid: "Item.cls1", documentName: "Item", type: "acks-extras.class", name: "Testcaster", system: { casting: casting ?? [], ladders, source: { cite } } };
  globalThis.fromUuidSync = (uuid) => (uuid === "Item.cls1" ? doc : null);
  try {
    const { buildMagicTab } = await import("../scripts/character-sheet/tabs/magic.mjs");
    const actor = {
      name: "Testcaster", uuid: "Actor.c", type: "character", system: { spells: { enabled: true }, details: { level } }, items: spells, effects, isOwner: owner,
      getFlag: (m, k) => (casting && m === "acks-extras" && k === "classes" ? { uuid: "Item.cls1", pools: spent } : null),
    };
    return buildMagicTab(actor);
  } finally {
    globalThis.game = priorGame;
    globalThis.canvas = priorCanvas;
    globalThis.fromUuidSync = priorUuid;
  }
};
/** An invented spell on the lists `lists` names (each `[source, level]`), with core's `lvl` and `class` as given. */
const listedSpell = (id, name, { lists = null, lvl = 1, cls = "" } = {}) => ({
  id, uuid: `Actor.c.Item.${id}`, name, img: "", type: "spell", parent: { type: "character" }, system: { lvl, class: cls, cast: 0, range: "", duration: "" },
  flags: lists ? { "acks-extras": { spell: { lists: lists.map(([source, level]) => ({ source, level })), cite: "Test p. 9" } } } : {},
});
const WISP = { key: "wisp", label: "Wisp", kind: "vancian", slots: [{ atLevel: 1, s1: 2, s2: 1 }] };
const TIDE = { key: "tide", label: "Tide", kind: "points", pool: [{ atLevel: 1, value: 4 }] };
const GLEAM = { key: "gleam", label: "Gleam", kind: "gnostic", levelCap: "reach" };

await testAsync("a character with no class bound, or a class that casts from no list, keeps the tab by level: the sheet's own slot grid, no heading, every row key it had", async () => {
  const spells = [listedSpell("a", "Aflame", { lists: [["wisp", 1]] }), listedSpell("b", "Bolt", { lvl: 2 })];
  for (const casting of [null, []]) {
    const tab = await magicContextOf({ spells, casting });
    assert.deepEqual([tab.mode, tab.byList, tab.groups, tab.other], ["levels", false, [], []]);
    assert.deepEqual(tab.levels.map((l) => [l.n, l.used, l.max, l.maxPath, l.rows.map((r) => r.id)]), [[1, 0, 0, "system.spells.1.max", ["a"]], [2, 0, 0, "system.spells.2.max", ["b"]]]);
    const row = tab.levels[0].rows[0];
    for (const key of ["id", "name", "img", "cast", "memorized", "line", "save", "summon", "declared"]) assert.ok(key in row, `the row keeps ${key}`);
    assert.deepEqual([row.lists, row.offList], [null, false], "no lists line and no off-list mark outside the list mode");
  }
});
await testAsync("a class that casts from lists groups the spells under a heading per list, with its slot row and hand pips per level, and the rest under Other spells", async () => {
  const spells = [
    listedSpell("a", "Aflame", { lists: [["wisp", 1], ["tide", 2]], cls: "Wisp" }),
    listedSpell("b", "Bolt", { lists: [["wisp", 2]] }),
    listedSpell("h", "Hush", { lists: [["gust", 1]] }),
    listedSpell("p", "Plain", { lvl: 3 }),
  ];
  const tab = await magicContextOf({ spells, casting: [WISP, TIDE], cite: "Test p. 1", spent: { wisp: { s1: 1 } } });
  assert.deepEqual([tab.mode, tab.byList, tab.levels], ["lists", true, []]);
  assert.deepEqual(tab.groups.map((g) => [g.key, g.label, g.className]), [["wisp", "Wisp", "Testcaster"], ["tide", "Tide", "Testcaster"]], "a heading per list, in the class's order");
  const [wisp, tide] = tab.groups;
  assert.deepEqual(wisp.levels.map((l) => [l.n, l.slot && [l.slot.used, l.slot.max], l.rows.map((r) => r.id)]), [[1, [1, 2], ["a"]], [2, [0, 1], ["b"]]]);
  assert.equal(wisp.levels[0].slot.tip, 'ACKS-CHARACTER.magic.slotsTipCite|{"used":1,"max":2,"class":"Testcaster","level":1,"cite":"Test p. 1"}', "the slot figure says where it came from, with the class document's own citation");
  assert.deepEqual(wisp.levels[0].slot.pips.map((p) => [p.slot, p.spent, p.label]), [["s1", true, 'ACKS-CLASSES.casting.pipGive|{"list":"Wisp","level":1}'], ["s1", false, 'ACKS-CLASSES.casting.pipSpend|{"list":"Wisp","level":1}']], "a filled pip gives the slot back and an empty one spends it, each named");
  assert.deepEqual([wisp.points, tide.points.used, tide.points.max, tide.levels.map((l) => [l.n, l.slot]), tide.levels[0].rows[0].id], [null, 0, 4, [[2, null]], "a"], "a points list has its pool and no slot row per level");
  assert.equal(wisp.levels[0].rows[0].lists.text, 'Wisp 1 · ACKS-CHARACTER.magic.listsAlso|{"lists":"Tide 2"}', "a spell on two lists names the other");
  assert.equal(tide.levels[0].rows[0].lists.text, 'Tide 2 · ACKS-CHARACTER.magic.listsAlso|{"lists":"Wisp 1"}', "and stands at the other list's level there");
  assert.equal(wisp.levels[0].rows[0].lists.tip, 'ACKS-CHARACTER.magic.listsTipCite|{"cite":"Test p. 9"}', "the lists line carries the spell flag's own citation");
  assert.deepEqual(tab.other.map((l) => [l.n, l.rows.map((r) => [r.id, r.offList, r.lists && r.lists.text])]), [[1, [["h", true, "Gust 1"]]], [3, [["p", false, null]]]], "Other spells: by the level on the spell, off a list or on none");
  const row = wisp.levels[0].rows[0];
  for (const key of ["id", "name", "img", "cast", "memorized", "line", "save", "summon", "declared"]) assert.ok(key in row, `the row keeps ${key}`);
  assert.equal(row.line, "", "the row line leaves core's class string to the lists line, which names the list and its level");
});
await testAsync("a slot figure with no class citation names its parts alone, and a spell with no lists says its list was read from the class field", async () => {
  const tab = await magicContextOf({ spells: [listedSpell("a", "Aflame", { lvl: 1, cls: "Wisp" })], casting: [WISP] });
  assert.equal(tab.groups[0].levels[0].slot.tip, 'ACKS-CHARACTER.magic.slotsTip|{"used":0,"max":2,"class":"Testcaster","level":1}');
  const row = tab.groups[0].levels[0].rows[0];
  assert.deepEqual([row.lists.text, row.lists.tip], ["Wisp 1", "ACKS-CHARACTER.magic.listsTipClass|{}"]);
  assert.equal(row.countTip, 'ACKS-CHARACTER.magic.castTip|{"spell":"Aflame"}');
});
await testAsync("a ladder list shows its text as the heading's note with no slot row, and a list with no slot row at this level still has its heading", async () => {
  const ladders = [{ key: "reach", label: "Reach", values: [{ atLevel: 1, value: 1, text: "Testreach" }] }];
  const tab = await magicContextOf({ spells: [listedSpell("a", "Aflame", { lists: [["gleam", 1]] })], casting: [GLEAM, WISP], ladders, cite: "Test p. 1" });
  assert.deepEqual(tab.groups.map((g) => g.label), ["Gleam", "Wisp"], "a heading for each list the class casts from");
  assert.deepEqual([tab.groups[0].points, tab.groups[0].note, tab.groups[0].levels.map((l) => l.slot)], [null, "Testreach", [null]]);
  assert.equal(tab.groups[0].noteTip, 'ACKS-CHARACTER.magic.ladderTipCite|{"class":"Testcaster","level":1,"cite":"Test p. 1"}', "the ladder's text names where it was read from");
  const late = await magicContextOf({ spells: [], casting: [{ ...WISP, slots: [{ atLevel: 5, s1: 3 }] }] });
  assert.deepEqual(late.groups.map((g) => [g.label, g.levels]), [["Wisp", []]], "no slot row yet at this level: the heading stands with no levels");
});
await testAsync("the hand pips are controls only on a seat that owns the character", async () => {
  const tpl = readFileSync(new URL("../templates/character-sheet/magic.hbs", import.meta.url), "utf8");
  const buttons = tpl.split("\n").filter((l) => l.includes('data-action="poolSlot"'));
  assert.equal(buttons.length, 1);
  assert.ok(/<button type="button"/.test(buttons[0]) && /aria-label="\{\{pip\.label\}\}"/.test(buttons[0]), "a real button, named");
  const branches = /\{\{#if mg\.editable\}\}\s*<span class="acks-extras-classes-handpips" role="group"[\s\S]*?data-action="poolSlot"[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/.exec(tpl);
  assert.ok(branches, "the buttons sit in the owner branch");
  assert.ok(branches[1].includes('aria-hidden="true"') && !/<button|data-action/.test(branches[1]), "the other branch draws spans that name nothing and press nothing");
  assert.ok(!/isGM|user\.isGM/.test(tpl), "no hard-coded role: the seat's ownership gates the pips");
  const own = await magicContextOf({ spells: [], casting: [WISP], owner: true });
  const seen = await magicContextOf({ spells: [], casting: [WISP], owner: false });
  assert.deepEqual([own.editable, seen.editable], [true, false], "the template reads the actor's ownership");
  assert.deepEqual(seen.groups[0].levels.map((l) => [l.n, l.slot.max]), [[1, 2], [2, 1]], "a seat that cannot own still reads every heading and figure");
});
test("the hand pips write through the sheet's own actions and the strip leaves the module's sheet its rest control and power line only", () => {
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /poolSlot: AcksCharacterSheet\.#onPoolSlot/);
  assert.match(sheet, /poolPoints: AcksCharacterSheet\.#onPoolPoints/);
  assert.match(sheet, /castingStripElement\(this\.actor, this, \{ traditions: false \}\)/, "the module's sheet draws no pips on the strip");
  assert.match(sheet, /"magic", "spell-row", "service"/, "the row partial is preloaded");
  const casting = readFileSync(new URL("../scripts/classes/casting.mjs", import.meta.url), "utf8");
  assert.match(casting, /const strip = castingStripElement\(doc, app\);/, "the system's own sheet keeps its strip whole");
  assert.match(casting, /const rest = actor\.isOwner === true \? /, "the strip's rest control is drawn for an owner of the character");
  assert.match(casting, /if \(actor\.isOwner !== true\) return;/, "and its pips and points pair answer an owner alone");
});

/** Every row of a Magic tab context, with the heading it stands under (null in Other spells and by level). */
const rowsUnder = (tab) => [
  ...tab.levels.flatMap((l) => l.rows.map((row) => ({ under: null, row }))),
  ...tab.groups.flatMap((g) => g.levels.flatMap((l) => l.rows.map((row) => ({ under: g.key, row })))),
  ...tab.other.flatMap((l) => l.rows.map((row) => ({ under: null, row }))),
];
const gateSpells = () => [
  listedSpell("a", "Aflame", { lists: [["wisp", 1]] }),
  listedSpell("b", "Bolt", { lists: [["wisp", 2]] }),
  listedSpell("d", "Dual", { lists: [["wisp", 1], ["tide", 2]] }),
  listedSpell("h", "Hush", { lists: [["gust", 1]] }),
  listedSpell("p", "Plain", { lvl: 3 }),
];
await testAsync("a Player's off-list row and full-level row are blocked with their sentence on the row; nothing else is", async () => {
  const tab = await magicContextOf({ spells: gateSpells(), casting: [WISP, TIDE], spent: { wisp: { s1: 2 } } });
  const gates = rowsUnder(tab).map(({ under, row }) => [row.id, under, row.gate && [row.gate.key, row.gate.blocked, row.gate.text]]);
  assert.deepEqual(gates, [
    ["a", "wisp", ["noSlot", true, "ACKS-MAGIC.cast.notice.blocked.noSlot|{}"]],
    ["d", "wisp", ["noSlot", true, "ACKS-MAGIC.cast.notice.blocked.noSlot|{}"]],
    ["b", "wisp", null],
    ["d", "tide", null],
    ["h", null, ["offList", true, "ACKS-MAGIC.cast.notice.blocked.offList|{}"]],
    ["p", null, null],
  ], "a two-list spell is gated by the heading it stands under, and a spell that names no list is not off list");
});
await testAsync("a Judge's rows carry the warning and stay on", async () => {
  const tab = await magicContextOf({ spells: gateSpells(), casting: [WISP, TIDE], spent: { wisp: { s1: 2 } }, isGM: true });
  const gated = rowsUnder(tab).filter(({ row }) => row.gate).map(({ under, row }) => [row.id, under, row.gate.key, row.gate.blocked, row.gate.text]);
  assert.deepEqual(gated, [
    ["a", "wisp", "noSlot", false, "ACKS-MAGIC.cast.notice.verdict.noSlot|{}"],
    ["d", "wisp", "noSlot", false, "ACKS-MAGIC.cast.notice.verdict.noSlot|{}"],
    ["h", null, "offList", false, "ACKS-MAGIC.cast.notice.verdict.offList|{}"],
  ]);
});
test("the row's gate is judged by listGate, the gate claimant's own judge", () => {
  const tab = readFileSync(new URL("../scripts/character-sheet/tabs/magic.mjs", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../scripts/magic/cast-gate.mjs", import.meta.url), "utf8");
  assert.ok(/listGate\(\{ capacity, offList, isGM \}\)/.test(tab), "the row asks listGate");
  assert.ok(/listGate\(\{ capacity, offList, isGM: /.test(gate), "and so does the claimant");
});
await testAsync("a row whose spell has a cast declared and waiting is exempt from both gates", async () => {
  const fights = { k1: { round: 2, scene: { name: "Testyard" } } };
  const effects = [declaredEffect("c1", "Actor.c.Item.a", {}), declaredEffect("c2", "Actor.c.Item.h", {})];
  const tab = await magicContextOf({ spells: gateSpells(), casting: [WISP, TIDE], spent: { wisp: { s1: 2 } }, effects, fights });
  const byId = Object.fromEntries(rowsUnder(tab).filter(({ under }) => under !== "tide").map(({ row }) => [row.id, row]));
  assert.deepEqual([byId.a.declared !== null, byId.a.gate, byId.h.declared !== null, byId.h.gate], [true, null, true, null]);
  assert.equal(byId.d.gate.key, "noSlot", "a spell with none declared is still gated");
});
await testAsync("a character with no class, or a class that casts from no list, has no gate and no tradition on any row; a row under a heading carries its key and Other spells none", async () => {
  for (const casting of [null, []]) {
    const tab = await magicContextOf({ spells: gateSpells(), casting });
    assert.ok(rowsUnder(tab).every(({ row }) => row.gate === null && row.tradition === ""), "nothing is blocked where the module does not know the answer");
  }
  const tab = await magicContextOf({ spells: gateSpells(), casting: [WISP, TIDE] });
  assert.deepEqual(rowsUnder(tab).map(({ under, row }) => [row.id, under, row.tradition]), [["a", "wisp", "wisp"], ["d", "wisp", "wisp"], ["b", "wisp", "wisp"], ["d", "tide", "tide"], ["h", null, ""], ["p", null, ""]]);
});
await testAsync("a row's gate is the verdict the cast window raises for the same spell and tradition", async () => {
  const { castReading } = await import("../scripts/magic/cast-spell.mjs");
  const { castVerdicts } = await import("../scripts/magic/cast-plan.mjs");
  const spells = gateSpells();
  const tab = await magicContextOf({ spells, casting: [WISP, TIDE], spent: { wisp: { s1: 2 } } });
  const classItem = { system: { casting: [WISP, TIDE] } };
  const pools = [{ key: "wisp", slots: [{ n: 1, max: 2, used: 2 }, { n: 2, max: 1, used: 0 }] }, { key: "tide", pool: { max: 4, used: 0 } }];
  for (const { under, row } of rowsUnder(tab)) {
    const item = spells.find((s) => s.id === row.id);
    const read = castReading({ items: spells, system: { spells: { enabled: true } } }, item, { classItem, pools, tradition: under });
    const window = castVerdicts({ capacity: read.capacity, offList: read.offList, isGM: false }).map((v) => v.key);
    assert.deepEqual(row.gate ? [row.gate.key] : [], window, `${row.id} under ${under}`);
  }
});
test("the row sends its tradition, and the template turns Cast off on a blocked row and says why on a line of its own", () => {
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  const cast = /static #onSpellCast\(event, target\) \{[\s\S]*?\n  \}/.exec(sheet)?.[0] ?? "";
  assert.match(cast, /dataset\?\.tradition/, "the row's tradition is read");
  assert.match(cast, /item\.use\?\.\(\{[^}]*tradition/, "and passed to the system's use");
  const tpl = readFileSync(new URL("../templates/character-sheet/spell-row.hbs", import.meta.url), "utf8");
  assert.match(tpl, /data-item-id="\{\{spell\.id\}\}"\{\{#if spell\.tradition\}\} data-tradition="\{\{spell\.tradition\}\}"\{\{\/if\}\}>/, "the attribute is on the row under a heading only");
  const button = tpl.split("\n").find((l) => l.includes('data-action="spellCast"'));
  assert.ok(/\{\{#if spell\.gate\.blocked\}\} disabled\{\{\/if\}\}/.test(button) && /aria-label="\{\{localize 'ACKS-CHARACTER\.magic\.cast'\}\}"/.test(button), "Cast is off for a blocked row and keeps its name");
  assert.match(tpl, /\n  \{\{#if spell\.gate\}\}<span class="acks-extras-frame__gate"[^>]*>[\s\S]*?\{\{spell\.gate\.text\}\}<\/span>\{\{\/if\}\}\n<\/div>/, "the reason is visible text, a direct child of the row");
});

/** A caster-side cast record as `castOf` gives it. */
const record = (id, extra = {}) => ({ id, name: `Spell ${id}`, img: `icons/${id}.webp`, clock: "3t", remaining: 1.5, total: 3, created: 100, ended: false, ...extra });
test("a character is a caster by a spell item or a caster-side cast record, and by nothing else", () => {
  assert.equal(isCaster({ spells: [], records: [] }), false);
  assert.equal(isCaster({}), false);
  assert.equal(isCaster({ spells: [plainSpell("p", "Bolt")], records: [] }), true);
  assert.equal(isCaster({ spells: [], records: [record("r1", { ended: true })] }), true, "a cast that has ended still marks a caster");
  assert.equal(isCaster({ spells: [], records: [], summons: [{ tokenId: "t1", record: null }] }), true, "a summon standing keeps its Dismiss or Release reachable");
  assert.equal(castRail({ spells: [], records: [], owner: true }), null, "no cast column for a non-caster, so its rails are as they were");
  assert.deepEqual([castRail({ spells: [plainSpell("p", "Bolt")], records: [], owner: false }).owner, castRail({ spells: [plainSpell("p", "Bolt")], owner: true }).owner], [false, true]);
});
test("the trackers are five cells, newest cast first, a pad for each one unfilled", () => {
  const cells = castTrackers([record("old", { created: 10 }), record("new", { created: 30 }), record("mid", { created: 20 })]);
  assert.equal(cells.length, CAST_TRACKERS);
  assert.equal(CAST_TRACKERS, 5);
  assert.deepEqual(cells.map((c) => c.kind), ["record", "record", "record", "pad", "pad"]);
  assert.deepEqual(cells.slice(0, 3).map((c) => c.id), ["new", "mid", "old"]);
  assert.deepEqual(castTrackers([]).map((c) => c.kind), ["pad", "pad", "pad", "pad", "pad"]);
  assert.deepEqual(castTrackers([record("a"), record("b")]).slice(0, 2).map((c) => c.id), ["b", "a"], "casts made at the same time read later-listed first");
});
test("a tracker fills with what is left of its duration, as the Effects tab draws it, and has none without a set duration", () => {
  const [half, unknown, open] = castTrackers([
    record("a", { created: 3, remaining: 1.5, total: 3 }),
    record("b", { created: 2, remaining: null, total: 3 }),
    record("c", { created: 1, remaining: null, total: 0, clock: "—" }),
  ]);
  assert.deepEqual([half.pct, half.state, half.clock], [50, "left", "3t"]);
  assert.deepEqual([unknown.pct, unknown.state], [100, "lasts"], "a duration whose remainder the clock cannot read stands at its total");
  assert.deepEqual([open.pct, open.state], [null, "open"], "a cast with no duration has no fill");
  assert.equal(castTrackers([record("x", { remaining: 9, total: 3 })])[0].pct, 100, "never above full");
});
test("a cast whose end has been announced takes no tracker", () => {
  const cells = castTrackers([record("live", { created: 1 }), record("done", { created: 2, ended: true })]);
  assert.deepEqual(cells.filter((c) => c.kind === "record").map((c) => c.id), ["live"]);
});
test("more casts than cells: the last cell shows how many it hides", () => {
  const six = Array.from({ length: 6 }, (_, i) => record(`r${i}`, { created: i }));
  const cells = castTrackers(six);
  assert.deepEqual(cells.map((c) => c.kind), ["record", "record", "record", "record", "more"]);
  assert.deepEqual(cells.slice(0, 4).map((c) => c.id), ["r5", "r4", "r3", "r2"]);
  assert.equal(cells[4].n, 2, "the fifth stands for the two oldest");
  assert.deepEqual(castTrackers(six.slice(0, 5)).map((c) => c.kind), ["record", "record", "record", "record", "record"], "exactly five fit without a +n");
});
test("the tracker key moves with a fill or a clock and with nothing else", () => {
  const a = [record("r1", { remaining: 2, total: 3, clock: "2t" })];
  assert.equal(castTrackerKey(a), castTrackerKey([{ ...a[0], name: "Renamed", img: "other.webp" }]), "a name or an image is not a fill");
  assert.notEqual(castTrackerKey(a), castTrackerKey([{ ...a[0], remaining: 1, clock: "1t" }]));
  assert.notEqual(castTrackerKey(a), castTrackerKey([]));
});
test("the tracker shape holds through a clock advance and moves when a cast comes, goes or ends", () => {
  const a = [record("r1", { remaining: 2, total: 3, clock: "2t" })];
  const shape = (rs) => castTrackerShape(castTrackers(rs));
  assert.equal(shape(a), shape([{ ...a[0], remaining: 1, clock: "1t" }]), "a fill that ran down is painted in place");
  assert.notEqual(shape(a), shape([...a, record("r2", { remaining: 3, total: 3 })]), "a new cast re-renders");
  assert.notEqual(shape(a), shape([{ ...a[0], ended: true }]), "an ended cast leaves its cell");
});
test("a clock advance paints the trackers in place instead of re-rendering the sheet", () => {
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /castTrackerShape\(trackers\) !== this\.#castShape \|\| !this\.#paintTrackers\(trackers\)/, "only a changed shape, or a cell not found, re-renders");
  assert.match(sheet, /"cast-id": t\.id/, "a record's cell carries its id for the paint");
});
test("the frame model carries the cast column for a caster and none for anyone else", () => {
  const base = { xp: {}, hp: { value: 1, max: 1 }, ac: {}, move: {}, grip: {}, light: {}, saves: {} };
  assert.equal(buildFrameModel({ ...base, cast: { owner: true, spells: [], records: [] } }, {}).rails.cast, null);
  assert.equal(buildFrameModel(base, {}).rails.cast, null, "a snapshot with no cast facts is no caster's");
  const caster = buildFrameModel({ ...base, cast: { owner: true, spells: [plainSpell("p", "Bolt")], records: [record("r1")] } }, {});
  assert.equal(caster.rails.cast.owner, true);
  assert.deepEqual(caster.rails.cast.trackers.map((c) => c.kind), ["record", "pad", "pad", "pad", "pad"]);
  assert.equal(caster.rails.party.mode, "none", "the party cell is untouched by the column");
});
test("the cast column is wired: a shared optional column, an owner-only action, tooltips and names on every cell", () => {
  const rails = readFileSync(new URL("../templates/lib/frame/rails.hbs", import.meta.url), "utf8");
  assert.match(rails, /\{\{#if cells\.cast\}\}\s*<div class="acks-extras-frame__rail acks-extras-frame__rail--cast">/, "the column is optional in the shared frame");
  assert.ok(rails.indexOf("cells.cast") < rails.indexOf("{{#unless folded}}"), "it sits outside the unfolded-only part, so a folded card keeps it");
  const cell = readFileSync(new URL("../templates/lib/frame/cell.hbs", import.meta.url), "utf8");
  assert.match(cell, /\{\{#if tipText\}\}data-tooltip-text="\{\{tipText\}\}"/);
  assert.match(cell, /\{\{#if label\}\}aria-label="\{\{label\}\}"\{\{\/if\}\}/);
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /castMenu: AcksCharacterSheet\.#onCastMenu/);
  const viewActions = sheet.slice(sheet.indexOf("static VIEW_ACTIONS"), sheet.indexOf("static PARTS"));
  assert.ok(!viewActions.includes('"castMenu"'), "a seat that cannot edit the character cannot cast for it");
  assert.match(sheet, /static #onCastMenu\(event, target\) \{\s*if \(!this\.actor\.isOwner\) return;/);
  assert.match(sheet, /\{ \.\.\.entry, cls: "is-pad" \}/, "a seat that is not the owner gets a pad with no action");
  assert.match(sheet, /attr\(\{ tab: "effects" \}\)/, "a tracker opens the Effects tab");
  const css = readFileSync(new URL("../styles/lib-frame.css", import.meta.url), "utf8");
  assert.match(css, /\.acks-extras-frame__rail--cast \{/);
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const keys = [
    ...castMenuModel({ party: { summons: [summonEntry("t1", castRecord("c1", "s")), summonEntry("t2", null)] }, spells: [summonSpell("s", "A"), summonSpell("z", "Z"), plainSpell("p", "B")], owner: true, bare: true }),
    ...castMenuModel({ owner: true }),
    ...partyMenuModel({ party: { henchmen: [{ onScene: false }] }, owner: true, roster: true }),
  ].flatMap((i) => [i.key, i.tipKey, i.valueKey]).filter(Boolean);
  for (const k of [...keys, "rail.cast", "rail.castViewer", "cast.track.left", "cast.track.lasts", "cast.track.open", "cast.track.more", "cast.track.pad"]) assert.ok(`ACKS-CHARACTER.${k}` in lang, `lang key ${k}`);
  assert.ok(!/bind summons/.test(lang["ACKS-CHARACTER.rail.partyNone"]), "the empty party cell no longer promises Bind");
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
test("Magic appears for a caster, Trade for a trader, Service for a hireling, and the order is fixed", () => {
  const gated = ["magic", "trade", "service"];
  assert.deepEqual(tabList({}).map((t) => t.key), TAB_ORDER.filter((k) => !gated.includes(k)));
  assert.deepEqual(tabList({ caster: true }).map((t) => t.key), TAB_ORDER.filter((k) => k !== "trade" && k !== "service"));
  assert.deepEqual(tabList({ trader: true }).map((t) => t.key), TAB_ORDER.filter((k) => k !== "magic" && k !== "service"));
  assert.deepEqual(tabList({ retainer: true }).map((t) => t.key), TAB_ORDER.filter((k) => k !== "magic" && k !== "trade"));
  assert.deepEqual(tabList({ caster: true, trader: true, retainer: true }).map((t) => t.key), [...TAB_ORDER]);
});
test("Service badges the owed calamity throw, and nothing while none is owed", () => {
  const owed = tabList({ retainer: true, calamity: 1 }).find((t) => t.key === "service");
  assert.equal(owed.n, 1);
  const quiet = tabList({ retainer: true }).find((t) => t.key === "service");
  assert.equal(quiet.n, undefined);
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
const { saveModifiers, effectClock, isTimer, castOf } = await import("../scripts/character-sheet/snapshot.mjs");
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
  _source: { system: { save: { mod: 0 }, saves: { paralysis: { value: 13 }, death: { value: 14 }, blast: { value: 15 }, implements: { value: 16 }, spell: { value: 17 } } } },
  appliedEffects: effects.map((e) => ({ disabled: false, ...e })),
});
test("an add on the all-save modifier colours every save; a subtraction reads negative; a lowered target reads as help", () => {
  const mods = saveModifiers(withEffects(
    { changes: [change("system.save.mod", "add", 2)] },
    { changes: [change("system.save.mod", "subtract", 1)] },
    { changes: [change("system.saves.blast.value", "add", -1)] },
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
const conditionTables = await import("../scripts/lib/tables.mjs");
const conditionFixture = await import("./core-conditions-fixture.mjs");
test("a condition joins every save it reaches, and one that reaches a single save colours that cell alone", () => {
  const { registerTable, unregisterTable, PRIORITY } = conditionTables;
  // Invented figures.
  const modifiers = { "cover-waist-high": { against: -3, blast: 3 }, fatigued: { all: -2 }, hungry: { all: -5 } };
  registerTable({ id: "conditions", source: "invented", tables: { modifiers } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const actor = { ...withEffects(), uuid: "Actor.covered", statuses: new Set(["cover-waist-high", "fatigued"]) };
    assert.deepEqual(saveModifiers(actor), { paralysis: -2, death: -2, blast: 1, implements: -2, spell: -2 });
    // A condition core's effect applies to the save modifier is read from its effect's change, once: the
    // module's table has no save row for it, whatever the table holds for the condition's other rolls.
    const { conditionChanges, conditionValue } = conditionFixture;
    const step = conditionValue("hungry", "system.save.mod");
    const hungry = { ...withEffects({ statuses: new Set(["hungry"]), changes: conditionChanges("hungry") }), uuid: "Actor.hungry", statuses: new Set(["hungry"]) };
    assert.deepEqual(saveModifiers(hungry), { paralysis: step, death: step, blast: step, implements: step, spell: step });
    // A condition two effects carry reaches each cell once, as Foundry applies its change to the field once.
    const prior = globalThis.CONFIG;
    globalThis.CONFIG = { ...(prior ?? {}), ACKS: { ...(prior?.ACKS ?? {}), conditions: conditionFixture.coreConditions() } };
    try {
      const twice = conditionFixture.actorOf("character", [conditionFixture.implyingEffect("starving"), conditionFixture.effectOf("hungry")]);
      assert.deepEqual(saveModifiers(twice), { paralysis: step, death: step, blast: step, implements: step, spell: step });
    } finally {
      globalThis.CONFIG = prior;
    }
  } finally {
    unregisterTable("conditions", { priority: PRIORITY.WORLD });
  }
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

console.log("character sheet: the cast column's facts");
/** An Active Effect as `castOf` reads one: the cast record flag, the source duration, the prepared clock and the creation time. */
const castEffect = (id, record, extra = {}) => ({
  id,
  name: `Cast ${id}`,
  img: `icons/${id}.webp`,
  disabled: false,
  flags: record ? { "acks-extras": { spellEffect: { spellUuid: "Item.s1", castId: `c-${id}`, casterUuid: "Actor.a1", ...record } } } : {},
  _source: { duration: { value: 10, units: "rounds" } },
  duration: { units: "rounds", remaining: 4 },
  _stats: { createdTime: 500 },
  ...extra,
});
test("castOf lists the spells and only the caster-side records, with the Effects tab's clock, and marks an ended one", () => {
  const actor = {
    isOwner: true,
    items: [
      { id: "i1", type: "spell", name: "Bolt", system: { lvl: 2 }, parent: { type: "character" } },
      { id: "i2", type: "spell", name: "Hound Call", system: { lvl: 4 }, flags: { "acks-extras": { spell: { type: "summoning" } } }, parent: { type: "character" } },
      { id: "i3", type: "weapon", name: "Sword", system: {} },
    ],
    effects: [
      castEffect("e1", { role: "caster" }),
      castEffect("e2", { role: "recipient" }),
      castEffect("e3", null),
      castEffect("e4", { role: "caster", ended: 700 }, { _stats: { createdTime: 100 } }),
    ],
  };
  const cast = castOf(actor);
  assert.equal(cast.owner, true);
  assert.deepEqual(cast.spells, [{ id: "i1", name: "Bolt", level: 2, summon: false }, { id: "i2", name: "Hound Call", level: 4, summon: true }], "spell items only, with whether each summons");
  assert.deepEqual(cast.records.map((r) => r.id), ["e1", "e4"], "a recipient's record and an effect no cast made are no tracker's");
  assert.deepEqual([cast.records[0].clock, cast.records[0].remaining, cast.records[0].total, cast.records[0].created, cast.records[0].ended], ["4r", 4, 10, 500, false]);
  assert.equal(cast.records[1].ended, true);
  assert.deepEqual(castTrackers(cast.records).map((c) => c.kind), ["record", "pad", "pad", "pad", "pad"], "the ended cast takes no cell");
  assert.equal(castOf({ isOwner: false, items: [], effects: [] }).owner, false);
  assert.equal(isCaster(castOf({ items: [], effects: [castEffect("e2", { role: "recipient" })] })), false, "bearing a spell's effect is not casting");
});

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

console.log("character sheet: a place's count badge");
// A localizer that names the key and the data it was handed, so a test reads what the badge asked for.
const badgeLoc = (key, d = {}) => `${key}|${JSON.stringify(d)}`;
const use = (over = {}) => ({ magic: 1, equip: 0, used: 1, cap: 3, ...over });
test("an uncapped place has no badge and nothing to explain", () => {
  assert.deepEqual(slotBadge("belt", use({ cap: Infinity }), null, badgeLoc), { capacity: null, capacityHint: "" });
});
test("a capped place shows its larger count against the cap and names the page an imported cap was read from", () => {
  const { capacity, capacityHint } = slotBadge("ring", use(), { state: "page", cite: "XX 7" }, badgeLoc);
  assert.equal(capacity, "1 / 3");
  assert.ok(capacityHint.startsWith('equipment.slotUse|{"magic":1,"cap":3,"equip":0} '), "the two counts lead");
  assert.ok(capacityHint.endsWith('equipment.slotCap.page|{"cite":"XX 7"}'), "the page follows");
});
test("a Judge's override is named as theirs, and a figure of the slot's own carries no source", () => {
  assert.ok(slotBadge("ring", use(), { state: "judge", cite: null }, badgeLoc).capacityHint.endsWith("equipment.slotCap.judge|{}"));
  assert.equal(slotBadge("head", use({ cap: 1 }), null, badgeLoc).capacityHint, 'equipment.slotUse|{"magic":1,"cap":1,"equip":0}');
});
test("an imported cap not read leaves the figure blank and points at the page that prints it", () => {
  assert.deepEqual(slotBadge("ring", use({ cap: null }), { state: "none", cite: null }, badgeLoc), { capacity: "1 /", capacityHint: "equipment.slotCap.none.ring|{}" });
});

console.log("character sheet: the editable fields");
test("an editable field renders the stored value, so an effect's addition is never written back as the base", () => {
  const actor = { _source: { system: { ac: { mod: 0 }, surprise: { avoidsurprise: 0 } } }, system: { ac: { mod: 1 }, surprise: { avoidsurprise: 1 } } };
  assert.equal(storedSystem(actor).ac.mod, 0);
  assert.equal(storedSystem(actor).surprise.avoidsurprise, 0);
  assert.equal(storedSystem({ system: { ac: { mod: 2 } } }).ac.mod, 2);
  assert.deepEqual(storedSystem(null), {});
});
test("the Stats tab's surprise rows hold the stored figure and carry the signed figure in force with how it is made", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const actor = {
      type: "character",
      _source: { system: { surprise: { surpriseothers: 0, avoidsurprise: 0 }, initiative: { mod: 1 } } },
      system: { surprise: { surpriseothers: 0, avoidsurprise: 2 }, initiative: { value: 3, mod: 1 }, scores: { dex: { mod: 1 } } },
      hasPlayerOwner: true,
    };
    const t = buildThrows(actor);
    assert.equal(t.avoidSurprise, 0, "the input holds the stored value");
    assert.equal(t.avoidSurpriseNow.value, "+2", "the note is the figure Rolls shows");
    assert.ok(t.avoidSurpriseNow.tip.includes('"stored":"+0","effects":"+2","value":"+2"'), "the tip names the stored value and the effects' share");
    assert.equal(t.surpriseOthers, 0);
    assert.equal(t.surpriseOthersNow.value, "+0");
    assert.ok(t.surpriseOthersNow.tip.includes('"value":"+0"') && !t.surpriseOthersNow.tip.includes("effects"), "no effect: the tip names only the total");
    assert.equal(t.initiative, "+3");
    assert.ok(t.initiativeTip.includes('"stored":"+1","dex":"+1","effects":"+1","value":"+3"'), "initiative names the stored modifier, Dexterity and the effects' share");
    const monster = buildThrows({ type: "monster", _source: { system: { initiative: { mod: 2 } } }, system: { initiative: { value: 2, mod: 2 }, scores: { dex: { mod: 3 } } } });
    assert.ok(monster.initiativeTip.includes('"dex":"+0","effects":"+0"'), "only a character's initiative takes Dexterity");
    const negative = buildThrows({ _source: { system: { surprise: { avoidsurprise: 1 } } }, system: { surprise: { avoidsurprise: -1 } } });
    assert.equal(negative.avoidSurpriseNow.value, "−1");
    assert.ok(negative.avoidSurpriseNow.tip.includes('"effects":"−2"'));
  } finally {
    delete globalThis.game;
  }
});
test("morale is carried by a serving hireling and by a character no player owns, never by a player's", () => {
  assert.equal(carriesMorale({ system: { retainer: { enabled: true } }, hasPlayerOwner: true }), true);
  assert.equal(carriesMorale({ system: { retainer: { enabled: false } }, hasPlayerOwner: false }), true);
  assert.equal(carriesMorale({ system: { retainer: { enabled: false } }, hasPlayerOwner: true }), false);
  assert.equal(carriesMorale({ system: {} }), false);
  assert.equal(carriesMorale(null), false);
});

/** A character with one loadout part per change and abilities carrying typed modifiers. Figures invented. */
function typedActor({ changes = [], parts = [], abilities = [], save = { stored: 0, inForce: 0 } } = {}) {
  const flag = { "acks-extras": { loadout: true, loadoutParts: parts } };
  const loadout = { id: "acksExtLoadout00", flags: flag, getFlag: (m, k) => flag[m]?.[k], changes, statuses: new Set() };
  return {
    type: "character",
    _source: { system: { save: { mod: save.stored }, initiative: { mod: 0 }, surprise: { avoidsurprise: 0, surpriseothers: 0 } } },
    system: { save: { mod: save.inForce }, initiative: { value: changes.filter((c) => c.key === "system.initiative.mod").reduce((s, c) => s + Number(c.value), 0), mod: 0 }, scores: { dex: { mod: 0 } }, surprise: {}, details: { level: 1 } },
    items: abilities.map((a, i) => ({ id: `a${i}`, type: "ability", name: a.name, flags: { "acks-extras": { extras: { effects: a.effects, effectsFrom: a.from ?? "recipe" } } } })),
    effects: [loadout],
    appliedEffects: [loadout],
  };
}
test("the Stats tab names each typed part the loadout wrote, marks a scan's unverified, and lists what it left out", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const actor = typedActor({
      changes: [{ key: "system.initiative.mod", type: "add", value: "2" }],
      parts: [{ label: "Swift", itemId: "a0", unverified: true }],
      abilities: [
        { name: "Swift", effects: [{ type: "modifier", target: "initiative", value: { kind: "flat", flat: 2 } }], from: "scan" },
        { name: "Wary", effects: [{ type: "modifier", target: "initiative", value: { kind: "flat", flat: 3 }, condition: "situational" }] },
      ],
    });
    const t = buildThrows(actor);
    assert.ok(t.initiativeTip.includes('stats.partUnverified|{"label":"Swift","value":"+2"}'), "the scan's part is named with its figure and marked");
    const left = t.initiativeTip.split(" · ").find((l) => l.includes("stats.notApplied|")) ?? "";
    assert.ok(left.includes("Wary") && left.includes("stats.reason.condition"), "the situational modifier is listed as not applied, with why");
    assert.ok(!t.initiativeTip.includes('stats.part|{"label":"Wary"'), "a part not applied carries no figure as if applied");
  } finally {
    delete globalThis.game;
  }
});
test("the save row carries the shared modifier in force and a tooltip naming the loadout's save parts", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const actor = typedActor({
      save: { stored: 1, inForce: 3 },
      changes: [{ key: "system.save.mod", type: "add", value: "2" }],
      parts: [{ label: "Steady", itemId: "a0", unverified: false }],
      abilities: [{ name: "Steady", effects: [{ type: "modifier", target: "save", value: { kind: "flat", flat: 2 } }] }],
    });
    const t = buildThrows(actor);
    assert.equal(t.saveMod, 1, "the input holds the stored value");
    assert.equal(t.saveModNow.value, "+3", "the note is the figure in force");
    assert.ok(t.saveModNow.tip.includes('modifierTipListed|{"stored":"+1","value":"+3"}') && !t.saveModNow.tip.includes('"effects"'), "the tip names the stored value and states no lump of the effects");
    assert.ok(t.saveModNow.tip.includes('stats.part|{"label":"Steady","value":"+2"}'), "the recipe's part is named, unmarked");
    const plain = buildThrows({ _source: { system: { save: { mod: 0 } } }, system: { save: { mod: 0 } } });
    assert.equal(plain.saveModNow.value, "+0", "a record with nothing on it reads +0");
  } finally {
    delete globalThis.game;
  }
});

const { RULEDATA_DOC } = await import("../scripts/equipment/overlays/scavenged.mjs");
test("a rule's part whose figure is an imported table cites the page, or says the Judge set it", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  const tipFor = () =>
    buildThrows(
      typedActor({
        changes: [{ key: "system.surprise.avoidsurprise", type: "add", value: "1" }],
        parts: [{ labelKey: "ACKS-EQUIPMENT.part.helm", table: "heavyHelm" }],
        abilities: [],
      }),
    ).avoidSurpriseNow.tip;
  try {
    conditionTables.unregisterTable(RULEDATA_DOC);
    conditionTables.registerTable({ id: RULEDATA_DOC, cites: { heavyHelm: "ZZ p. 9" }, tables: { heavyHelm: { surprise: 1 } } }, { priority: conditionTables.PRIORITY.WORLD });
    assert.ok(tipFor().includes('stats.partCited|{"label":"ACKS-EQUIPMENT.part.helm","value":"+1","cite":"ZZ p. 9"}'), "the imported page is named");
    conditionTables.registerTable({ id: RULEDATA_DOC, tables: { heavyHelm: { surprise: 1 } } }, { priority: conditionTables.PRIORITY.OVERRIDE });
    assert.ok(tipFor().includes('stats.partJudge|{"label":"ACKS-EQUIPMENT.part.helm","value":"+1"}'), "the Judge's own figure says so, with no page");
    assert.ok(!tipFor().includes("ZZ p. 9"), "the Judge's figure is not credited to the page");
  } finally {
    conditionTables.unregisterTable(RULEDATA_DOC);
    delete globalThis.game;
  }
});

const { lightRow } = await import("../scripts/character-sheet/tabs/stats.mjs");
const { LIGHT_DOC, LIGHT_TABLE } = await import("../scripts/lib/light.mjs");
test("a light's vision row reads its reach from the imported table, cites the page, and is blank when nothing is imported", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    conditionTables.unregisterTable(LIGHT_DOC);
    const bare = lightRow("torch");
    assert.equal(bare.value, "", "no figure before the import");
    assert.ok(!String(bare.value).includes("undefined"));
    assert.ok(!bare.note && !bare.tip, "nothing imported is a blank row with no note and no tooltip");
    conditionTables.registerTable({ id: LIGHT_DOC, source: { pages: "ZZ p. 4" }, tables: { [LIGHT_TABLE]: { torch: { bright: 7, dim: 13, turns: 5 } } } }, { priority: conditionTables.PRIORITY.WORLD });
    const lit = lightRow("torch");
    assert.equal(lit.value, "13′", "the imported reach");
    assert.ok(lit.tip.includes("vision.lightTip") && lit.tip.includes("ZZ p. 4"), "the tooltip names the page");
    assert.ok(!lit.note, "an imported figure carries no not-imported note");
  } finally {
    conditionTables.unregisterTable(LIGHT_DOC);
    delete globalThis.game;
  }
});

const { armourStepRow } = await import("../scripts/character-sheet/tabs/stats.mjs");
test("an armour-training line shows the rungs it adds with their parts, and is blank when no step is imported", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const bare = armourStepRow({ name: "Plate Drill", step: null, rank: 2, steps: null, cite: "" });
    assert.equal(bare.value, "", "no figure before the import");
    assert.ok(!bare.note && !bare.tip, "a blank line with no note and no tooltip");
    const read = armourStepRow({ name: "Plate Drill", step: 2, rank: 3, steps: 6, cite: "ZZ p. 4" });
    assert.equal(read.value, "+6", "step times rank");
    assert.ok(read.tip.includes("stats.armourStepTip|") && read.tip.includes('"step":2') && read.tip.includes('"rank":3') && read.tip.includes("ZZ p. 4"), "the tooltip names its parts and the page");
    assert.ok(!read.note, "an imported step carries no not-imported note");
    assert.ok(armourStepRow({ name: "Plate Drill", step: 2, rank: 1, steps: 2, cite: "" }).tip.includes("stats.armourStepTipRow|"), "a step with no page names the row alone");
  } finally {
    delete globalThis.game;
  }
});

const { acTips, summedArmour } = await import("../scripts/character-sheet/tabs/stats.mjs");
const sheetArmour = (name, type, ac, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""), name, type: "armor",
  system: { equipped: over.equipped ?? true, type, ac: { value: ac }, quantity: 1, cost: 0, weight6: 0 },
  getFlag: () => undefined, effects: [],
});
test("the AC tooltip names every armour core sums, each with its figure, and their total", () => {
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
  try {
    const tips = acTips({ type: "character", effects: [] }, { scores: { dex: { mod: 1 } }, ac: { value: 9, shield: 1, mod: 0 } }, { ac: { mod: 0 } }, { parts: [], listed: [] }, [{ name: "Test Hauberk", value: 4 }, { name: "Test Helm", value: 2 }]);
    const part = (tip) => { const outer = JSON.parse(tip.slice(tip.indexOf("|") + 1).split(" · ")[0]); return outer.armour; };
    const read = (s) => ({ key: s.slice(0, s.indexOf("|")), data: JSON.parse(s.slice(s.indexOf("|") + 1)) });
    const named = read(part(tips.armour));
    assert.equal(named.key, "ACKS-CHARACTER.stats.acBaseNamed");
    assert.equal(named.data.value, 6, "the total is the sum of both pieces");
    assert.deepEqual(named.data.items.split(", ").map((s) => read(s).data), [{ name: "Test Hauberk", value: 4 }, { name: "Test Helm", value: 2 }], "each piece is named with its own figure");
    assert.equal(read(part(tips.shield)).key, "ACKS-CHARACTER.stats.acBaseNamed", "the shield row names the armour too");
    const none = acTips({ type: "character", effects: [] }, { scores: { dex: { mod: 0 } }, ac: { value: 0, shield: 0 } }, { ac: { mod: 0 } }, { parts: [], listed: [] }, []);
    assert.equal(read(part(none.armour)).key, "ACKS-CHARACTER.stats.acBaseNone", "no armour is stated as none");
  } finally {
    delete globalThis.game;
  }
});
test("the armour the tooltip lists is core's set: every equipped armour not typed shield, a helmet included, a shield excluded", () => {
  globalThis.game = { settings: { get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : undefined) }, i18n: { has: () => false, localize: (k) => k, format: (k) => k } };
  try {
    const items = [
      sheetArmour("Test Hauberk", "medium", 4),
      sheetArmour("Test Helm", "light", 2),
      sheetArmour("Test Shield", "shield", 1),
      sheetArmour("Test Spare", "heavy", 5, { equipped: false }),
      sheetArmour("Test Cap", "light", null),
    ];
    const read = summedArmour({ type: "character", items, system: {}, effects: [], getFlag: () => undefined });
    assert.deepEqual(read.map((a) => [a.name, a.value]).sort(), [["Test Cap", 0], ["Test Hauberk", 4], ["Test Helm", 2]], "worn pieces with their own figures; none from the shield or the unworn suit; a null figure reads 0");
    assert.deepEqual(summedArmour({ type: "character" }), [], "a record with no items has none");
  } finally {
    delete globalThis.game;
  }
});

console.log("character sheet: what each effect adds, named on the figure it moved");
const { signed: signedFigure } = await import("../scripts/character-sheet/view-model.mjs");
const { actorOf: fixtureActor, conditionValue: fixtureValue, coreConditions: fixtureConditions, effectOf: fixtureEffect, implyingEffect: fixtureImplying } = conditionFixture;
const mockGame = () => ({ i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } });
const condName = (id) => `core.${id}`;
const namedEffect = (effect, id) => `ACKS-LIB.conditionRoll.targetAc.named|${JSON.stringify({ effect, condition: condName(id) })}`;
const partText = (label, value) => `ACKS-CHARACTER.stats.part|${JSON.stringify({ label, value })}`;
const OTHER_EFFECTS = "ACKS.throw.modifier.otherEffects";
const withConditions = (fn) => () => {
  const prior = globalThis.CONFIG;
  globalThis.CONFIG = { ...(prior ?? {}), ACKS: { ...(prior?.ACKS ?? {}), conditions: fixtureConditions() } };
  globalThis.game = mockGame();
  try {
    fn();
  } finally {
    globalThis.CONFIG = prior;
    delete globalThis.game;
  }
};
const noTyped = { parts: [], listed: [] };
/** The lines of an Armor Class tooltip after its head, one string each. */
const acLinesOf = (actor, over = {}) => acTips(actor, { ...actor.system, ...over }, { ac: { mod: 0 } }, noTyped, []).armour.split(" · ").slice(1);

test("the AC tooltip names each effect that moves it, in order, a charge's step with the condition it belongs to", withConditions(() => {
  const rage = fixtureValue("berserk", "system.ac.mod");
  const disorder = fixtureValue("disordered", "system.ac.mod");
  const hero = fixtureActor("character", [fixtureEffect("berserk", { name: condName("berserk") }), fixtureImplying("charging", { name: "Test Charge" })], { ac: 10 });
  assert.deepEqual(
    acLinesOf(hero),
    [partText(condName("berserk"), signedFigure(rage)), partText(namedEffect("Test Charge", "disordered"), signedFigure(disorder))],
    "one line per effect, in the order Foundry applied them; the effect named as its own condition is named once",
  );
  const head = acTips(hero, hero.system, { ac: { mod: 0 } }, noTyped, []).armour.split(" · ")[0];
  assert.ok(head.includes('"stored":"+0"') && !head.includes("effects"), "the head states the stored bonus and no lump of the effects");
  assert.ok(acLinesOf(fixtureActor("character", [], { ac: 10 })).length === 0, "no effect, no line");
}));
test("a condition two effects carry is listed once, and a disabled effect not at all", withConditions(() => {
  const disorder = fixtureValue("disordered", "system.ac.mod");
  const hero = fixtureActor("character", [fixtureImplying("charging", { name: "Test Charge" }), fixtureEffect("disordered", { name: condName("disordered") }), fixtureEffect("berserk", { disabled: true })], { ac: 10 });
  // Foundry applied the step once; the mock folded both carriers, so the prepared figure is set to what Foundry holds.
  hero.system.ac.mod = disorder;
  assert.deepEqual(acLinesOf(hero), [partText(namedEffect("Test Charge", "disordered"), signedFigure(disorder))]);
}));
test("a remainder line, core's Other Effects, is added only where the lines do not sum to what the effects moved", withConditions(() => {
  const rage = fixtureValue("berserk", "system.ac.mod");
  const hero = fixtureActor("character", [fixtureEffect("berserk", { name: condName("berserk") })], { ac: 10 });
  assert.equal(acLinesOf(hero).length, 1, "the lines account for the whole figure: no remainder");
  hero.system.ac.mod = rage + 5;
  assert.deepEqual(acLinesOf(hero).slice(1), [partText(OTHER_EFFECTS, "+5")], "what no effect line states is the remainder");
}));
test("the loadout effect keeps its own parts and gets no second line", withConditions(() => {
  const rage = fixtureValue("berserk", "system.ac.mod");
  const base = typedActor({
    changes: [{ key: "system.ac.mod", type: "add", value: "2" }],
    parts: [{ label: "Steady", itemId: "a0", unverified: false }],
    abilities: [{ name: "Steady", effects: [{ type: "modifier", target: "ac", value: { kind: "flat", flat: 2 } }] }],
  });
  const hero = fixtureActor("character", [...base.effects, fixtureEffect("berserk", { name: condName("berserk") })], { ac: 10, extra: { items: base.items } });
  const lines = acTips(hero, hero.system, { ac: { mod: 0 } }, noTyped, []).armour.split(" · ").slice(1);
  assert.deepEqual(lines, [partText(condName("berserk"), signedFigure(rage)), partText("Steady", "+2")], "the effect's line, then the loadout's part once; no remainder for the loadout's share");
}));
test("the save row's tooltip states the stored value, a line per effect in order, and a remainder only where one exists", withConditions(() => {
  const step = fixtureValue("hungry", "system.save.mod");
  const hand = { statuses: [], name: "Test Hand", changes: [{ key: "system.save.mod", type: "add", value: 3 }] };
  const hero = fixtureActor("character", [fixtureEffect("hungry", { name: condName("hungry") }), fixtureEffect("hungry", hand)], { saveMod: 0, extra: { _source: { system: { save: { mod: 0 } } } } });
  const tip = buildThrows(hero).saveModNow.tip.split(" · ");
  assert.equal(tip[0], `ACKS-CHARACTER.stats.modifierTipListed|${JSON.stringify({ stored: "+0", value: signedFigure(step + 3) })}`);
  assert.deepEqual(tip.slice(1), [partText(condName("hungry"), signedFigure(step)), partText("Test Hand", "+3")]);
  hero.system.save.mod += 4;
  assert.deepEqual(buildThrows(hero).saveModNow.tip.split(" · ").filter((l) => l.includes(OTHER_EFFECTS)), [partText(OTHER_EFFECTS, "+4")]);
  assert.ok(!tip.some((l) => l.includes(OTHER_EFFECTS)), "no remainder where the lines sum to the figure");
  const bare = fixtureActor("character", [], { saveMod: 2, extra: { _source: { system: { save: { mod: 2 } } } } });
  assert.equal(buildThrows(bare).saveModNow.value, "+2");
  assert.ok(buildThrows(bare).saveModNow.tip.startsWith("ACKS-CHARACTER.stats.modifierTipPlain|"), "no effect: the plain tip");
}));
test("a line for an effect that sets or multiplies the figure says the change's type in Foundry's word, and an adding effect reads as before", withConditions(() => {
  // Invented words, so the line proves the label is read from Foundry's strings.
  const words = { "EFFECT.CHANGES.TYPES.override": "Replacer", "EFFECT.CHANGES.TYPES.multiply": "Scaler" };
  globalThis.game.i18n.localize = (k) => words[k] ?? k;
  const kindText = (label, kind, value) => `ACKS-CHARACTER.stats.partKind|${JSON.stringify({ label, kind, value })}`;
  const fx = (key, name, changes) => fixtureEffect("hungry", { statuses: [], name, changes: changes.map(([type, value]) => ({ key, type, value })) });
  const AC_KEY = "system.ac.mod";
  const armour = (hero, stored) => acTips(hero, hero.system, { ac: { mod: stored } }, noTyped, []).armour.split(" · ").slice(1);

  const setter = fixtureActor("character", [fx(AC_KEY, "Test Ring", [["override", 9]])], { ac: 10 });
  setter.system.ac.mod = 9;
  assert.deepEqual(armour(setter, 4), [kindText("Test Ring", "Replacer", "+5")], "one kind: the word follows the name, the figure is the shift from the stored value");

  const both = fixtureActor("character", [fx(AC_KEY, "Test Charm", [["multiply", 2], ["override", 9]])], { ac: 10 });
  both.system.ac.mod = 9;
  assert.deepEqual(armour(both, 4), [kindText("Test Charm", "Scaler, Replacer", "+5")], "two kinds: each in Foundry's word, joined");

  const adder = fixtureActor("character", [fx(AC_KEY, "Test Band", [["add", 5], ["subtract", 2]])], { ac: 10 });
  adder.system.ac.mod = 4 + 3;
  assert.deepEqual(armour(adder, 4), [partText("Test Band", "+3")], "an effect that only adds and subtracts is the plain line");

  const hero = fixtureActor("character", [fx("system.save.mod", "Test Hand", [["override", 6]])], { saveMod: 0, extra: { _source: { system: { save: { mod: 0 } } } } });
  assert.deepEqual(buildThrows(hero).saveModNow.tip.split(" · ").slice(1), [kindText("Test Hand", "Replacer", "+6")], "the saving throw tooltip says it too");
}));

console.log("character sheet: adding a proficiency by hand");
const atest = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
const { addProficiency, proficiencyOptions, blankProficiencyData } = await import("../scripts/abilities/add-proficiency.mjs");
const { abilityBucket } = await import("../scripts/classes/sheet-tabs.mjs");

/** A world holding one class whose own list names one definition, and a general list of two. All names invented. */
function handWorld({ withClass = true, cold = false } = {}) {
  const definition = (uuid, id, name, type) => ({
    uuid, name, type: "ability",
    flags: { "acks-extras": { cookbook: { id } } },
    system: { proficiencytype: type },
    toObject: () => ({ _id: uuid, name, type: "ability", flags: { "acks-extras": { cookbook: { id } } }, system: { proficiencytype: type } }),
  });
  const both = definition("Item.both", "def.prof.both", "Both Lists", "general");
  const general = definition("Item.gen", "def.prof.gen", "Only General", "general");
  const klass = { uuid: "Item.cls", name: "Testclass", type: "acks-extras.class", flags: {}, system: { inventory: { classProfs: ["def.prof.both", "def.prof.gone"] }, awards: [] } };
  const made = [];
  const asked = [];
  const warned = [];
  const actor = {
    isOwner: true,
    items: [],
    getFlag: () => null,
    system: { details: { class: withClass ? "Testclass" : "", level: 1 } },
    createEmbeddedDocuments: async (_type, data) => {
      made.push(...data);
      actor.items.push(...data);
      return data.map((d) => ({ ...d, sheet: { render() {} } }));
    },
  };
  const docs = [both, general, ...(withClass ? [klass] : [])];
  // A cold shelf holds its rows in the index only until something loads them.
  const shelf = {
    metadata: { packageType: "world", label: "ACKS Cookbook — Item" },
    documentName: "Item",
    collection: "world.cold-shelf",
    index: { size: docs.length },
    size: 0,
    contents: [],
    getDocuments: async () => {
      shelf.contents.push(...docs);
      shelf.size = docs.length;
      return docs;
    },
  };
  globalThis.game = {
    items: cold ? [] : docs,
    packs: cold ? [shelf] : [],
    i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` },
  };
  globalThis.ui = { notifications: { warn: (m) => warned.push(m) } };
  return { actor, made, asked, warned, ask: (answer) => async (list, options) => { asked.push({ list, options }); return answer; } };
}
const dropWorld = () => {
  delete globalThis.game;
  delete globalThis.ui;
};

await atest("the class list offers the bound class's own proficiencies, and drops a ref the library cannot resolve", async () => {
  const { actor } = handWorld();
  try {
    assert.deepEqual(proficiencyOptions(actor, "class").map((o) => o.name), ["Both Lists"]);
    assert.deepEqual(proficiencyOptions(actor, "general").map((o) => o.name), ["Both Lists", "Only General"]);
    assert.deepEqual(proficiencyOptions(actor, "powers"), [], "an unknown list offers nothing");
  } finally {
    dropWorld();
  }
});

await atest("a pick from the class list is granted as a class proficiency even where the definition is typed general", async () => {
  const w = handWorld();
  try {
    const done = await addProficiency(w.actor, "class", { ask: w.ask({ ref: "def.prof.both" }) });
    assert.deepEqual(done, { via: "library", ref: "def.prof.both" });
    assert.equal(w.made.length, 1);
    assert.equal(w.made[0].system.proficiencytype, "class");
    assert.equal(abilityBucket(w.made[0], new Set()), "class", "it files under the list whose button was pressed");
  } finally {
    dropWorld();
  }
});

await atest("a pick from the general list is granted as a general proficiency", async () => {
  const w = handWorld();
  try {
    await addProficiency(w.actor, "general", { ask: w.ask({ ref: "def.prof.gen" }) });
    assert.equal(w.made[0].system.proficiencytype, "general");
    assert.equal(abilityBucket(w.made[0], new Set()), "general");
  } finally {
    dropWorld();
  }
});

await atest("picking one already held adds another copy, never a silent nothing", async () => {
  const w = handWorld();
  try {
    await addProficiency(w.actor, "class", { ask: w.ask({ ref: "def.prof.both" }) });
    const options = proficiencyOptions(w.actor, "class");
    assert.equal(options[0].owned, true, "the held one is marked for the picker");
    await addProficiency(w.actor, "class", { ask: w.ask({ ref: "def.prof.both" }) });
    assert.equal(w.made.length, 2);
  } finally {
    dropWorld();
  }
});

await atest("Blank makes an empty ability of the list's type, and each lands in its own bucket", async () => {
  const w = handWorld();
  try {
    const cls = await addProficiency(w.actor, "class", { ask: w.ask({ blank: true }) });
    const gen = await addProficiency(w.actor, "general", { ask: w.ask({ blank: true }) });
    assert.equal(cls.via, "blank");
    assert.equal(gen.via, "blank");
    assert.deepEqual(w.made.map((d) => [d.type, d.system.proficiencytype]), [["ability", "class"], ["ability", "general"]]);
    assert.deepEqual(w.made.map((d) => abilityBucket(d, new Set())), ["class", "general"]);
    assert.deepEqual(blankProficiencyData("class", "X"), { name: "X", type: "ability", system: { proficiencytype: "class" } });
  } finally {
    dropWorld();
  }
});

await atest("with no class list to pick from, the class control makes a blank class proficiency without a dialog", async () => {
  const w = handWorld({ withClass: false });
  try {
    const done = await addProficiency(w.actor, "class", { ask: w.ask({ ref: "def.prof.both" }) });
    assert.equal(done.via, "blank");
    assert.equal(w.asked.length, 0, "nothing to choose from, nothing asked");
    assert.equal(w.made[0].system.proficiencytype, "class");
    // The general list needs no class.
    await addProficiency(w.actor, "general", { ask: w.ask(null) });
    assert.equal(w.asked.length, 1);
  } finally {
    dropWorld();
  }
});

await atest("a closed dialog, an empty pick and a non-owner create nothing", async () => {
  const w = handWorld();
  try {
    assert.equal(await addProficiency(w.actor, "class", { ask: w.ask(null) }), null);
    assert.equal(await addProficiency(w.actor, "class", { ask: w.ask({ ref: "" }) }), null);
    assert.equal(w.warned.length, 1, "an empty pick says why nothing happened");
    w.actor.isOwner = false;
    assert.equal(await addProficiency(w.actor, "class", { ask: w.ask({ blank: true }) }), null);
    assert.equal(w.made.length, 0);
  } finally {
    dropWorld();
  }
});

await atest("a library shelf not yet loaded still offers its list, instead of falling through to a blank", async () => {
  const w = handWorld({ cold: true });
  try {
    const done = await addProficiency(w.actor, "class", { ask: w.ask({ ref: "def.prof.both" }) });
    assert.equal(w.asked.length, 1, "the picker was shown");
    assert.deepEqual(w.asked[0].options.map((o) => o.name), ["Both Lists"]);
    assert.equal(done.via, "library");
    assert.equal(w.made[0].system.proficiencytype, "class");
  } finally {
    dropWorld();
  }
});

await atest("the Abilities tab carries one add control per list, wired to the sheet's action", async () => {
  const { readFileSync } = await import("node:fs");
  const tpl = readFileSync(new URL("../templates/character-sheet/abilities.hbs", import.meta.url), "utf8");
  for (const list of ["class", "general"]) {
    const chip = tpl.split("\n").find((l) => l.includes(`data-action="proficiencyCreate" data-list="${list}"`));
    assert.ok(chip, `a ${list} control exists`);
    assert.match(chip, /<button type="button"/, "a real button, so the keyboard reaches it");
    assert.match(chip, /data-tooltip="\{\{localize /, "it carries a tooltip key");
  }
  const sheet = readFileSync(new URL("../scripts/character-sheet/sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /proficiencyCreate: AcksCharacterSheet\.#onProficiencyCreate/);
});

console.log("character sheet: summons on a scene");
{
  const services = await import("../scripts/lib/services.mjs");
  const { summonsOnScene } = await import("../scripts/character-sheet/snapshot.mjs");
  const summoner = { uuid: "Actor.summoner1" };
  const row = (actorId, summonedBy, castId, stashed = true) => ({ actorId, actor: { img: "i.webp" }, name: `Wolf ${actorId}`, stashed, summonedBy, summon: castId ? castRecord(castId, "spA") : null });
  const roster = { list: () => [{ id: "here", name: "Hollow Company" }, { id: "away", name: "Second Band" }], members: (id) => (id === "here" ? [row("m1", summoner.uuid, "c1"), row("m2", summoner.uuid, "c1", false), row("m3", "Actor.other", "c1")] : [row("m4", summoner.uuid, "c1")]) };
  const formations = { here: { id: "here", sceneId: "scnA" }, away: { id: "away", sceneId: "scnB" } };
  const before = globalThis.game;
  const foundryBefore = globalThis.foundry;
  globalThis.foundry = { utils: { deepClone: (v) => JSON.parse(JSON.stringify(v)) } };
  globalThis.game = { settings: { get: () => formations } };
  services.register("party-roster", roster);
  try {
    const scene = { id: "scnA", tokens: [{ id: "tok1", name: "Wolf", texture: { src: "t.webp" }, actor: { uuid: "Actor.w", getFlag: (ns, key) => (key === "summonedBy" ? summoner.uuid : { castId: "c0", spellId: "spA" }) } }] };
    test("a held summon is listed only for a party token on the scene, as an entry that names its party and member", () => {
      const out = summonsOnScene(summoner, scene);
      assert.deepEqual(out.map((e) => [e.tokenId, e.held, e.name]), [["tok1", null, "Wolf"], [null, { partyId: "here", actorId: "m1" }, "Wolf m1"]], "the scene token, then the stashed summon of the party standing here; a deployed one and another caster's are not listed again");
      assert.deepEqual(out.map((e) => e.party), [null, { id: "here", name: "Hollow Company" }], "a held entry names its party as the roster lists it, a scene token none");
      assert.deepEqual(out[1].held, { partyId: "here", actorId: "m1" }, "and `held` stays what it was");
      assert.deepEqual(summonsOnScene(summoner, { id: "scnC", tokens: [] }), [], "a scene with no party token holds none");
      assert.deepEqual(summonsOnScene(summoner, { id: "scnB", tokens: [] }).map((e) => e.held?.actorId), ["m4"], "each party is read on its own scene");
    });
  } finally {
    services.register("party-roster", {});
    globalThis.game = before;
    if (before === undefined) delete globalThis.game;
    globalThis.foundry = foundryBefore;
    if (foundryBefore === undefined) delete globalThis.foundry;
  }
}

console.log(`character sheet: ${passed} passed`);
