/**
 * Scene search's pure model: the place's list of things, the entries a scene
 * holds, what each seat sees, the public "more remains" mark, who may attempt
 * which check, and what a check answers. No globals are set, which is the
 * proof the model is Foundry-free. Every name and every figure here is this
 * file's own invention; no throw target stands for any printed one.
 */
import assert from "node:assert/strict";
import {
  THING_KINDS,
  addThing,
  kindOfDrop,
  kindsAccepting,
  nextThingId,
  normalizeThings,
  registerThingKind,
  removeThing,
  resetThing,
} from "../scripts/lib/place-things-logic.mjs";
import { CAPABILITY, CHECK, CODE, KIND_DEFAULTS, MORE, REFUSAL, SCENE, defaultLayer } from "../scripts/scene-search/constants.mjs";
import {
  behindClue,
  isVisible,
  layerOptions,
  layerRefusal,
  moreRemains,
  normalizeLayer,
  normalizeSceneThings,
  outcomeOf,
  recordOutcome,
  remainingKinds,
  sceneEntries,
  seatView,
} from "../scripts/scene-search/scene-logic.mjs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};
const throwsIt = (fn, msg) => {
  assert.throws(fn, undefined, msg);
  checks++;
};
const freeze = (value) => {
  if (value && typeof value === "object") for (const v of Object.values(value)) freeze(v);
  return Object.freeze(value);
};

const layer = (over = {}) => ({ check: CHECK.INSPECT, yields: { lots: [], clue: null, reveal: [] }, ...over });
const thing = (over = {}) => ({ id: "t1", kind: THING_KINDS.CONTAINER, ...over });
const entriesOf = (things, extra = {}) => sceneEntries({ things, ...extra });
const byKey = (entries, key) => entries.find((e) => e.key === key);

const THIEF = { id: "a-thief", level: 3, capabilities: [CAPABILITY.SEARCHING], tools: [] };
const PLAIN = { id: "a-plain", level: 3, capabilities: [], tools: [] };
const figures = { hastyTarget: 14, methodicalTarget: 7, searchBonus: 2, skillTargets: { reading: 11 } };

/* -------------------------------------------- */
/*  The list                                     */
/* -------------------------------------------- */

{
  const raw = freeze([
    { id: "chest", kind: "container", ref: "Item.abc", hidden: true, hint: "  a lid  ", point: { x: "10", y: 20 }, params: { gap: 5, custom: { deep: [1] } }, state: { known: true, searchLock: { z: 1 }, odd: 7 } },
    "not an object",
    null,
    { id: "x", kind: "dragon" },
    { id: "chest", kind: "fixture" },
    { kind: "floor" },
    { kind: "lot", point: { x: null, y: 4 }, hint: "   ", ref: "" },
  ]);
  const list = normalizeThings(raw);
  eq(list.map((t) => t.id), ["chest", "thing-1", "thing-2"], "three drop cases only; a missing id is assigned, not dropped");
  eq(list[0].kind, "container", "the first of two same-id entries is the one kept");
  eq(list[0].hint, "a lid", "hint is trimmed");
  eq(list[0].point, { x: 10, y: 20 }, "a numeric point is read");
  eq(list[0].params, { gap: 5, custom: { deep: [1] } }, "unknown params keys survive");
  eq(list[0].state, { known: true, searchLock: { z: 1 }, odd: 7 }, "unknown state keys survive");
  eq(list[2].point, null, "a half point is null");
  eq(list[2].hint, null, "a blank hint is null");
  eq(list[2].ref, null, "an empty ref is null");
  eq(list[2].hidden, false, "hidden defaults false");
  ok(list[0].params !== raw[0].params && list[0].state !== raw[0].state, "the result shares no object with the input");
  eq(normalizeThings(undefined), [], "a non-list reads empty");
}

{
  eq(nextThingId([{ id: "thing-4" }, { id: "chest" }, { id: "thing-2" }]), "thing-5", "past the highest thing-n");
  const before = freeze([{ id: "a", kind: "body", state: { keep: 1 } }]);
  const after = addThing(before, { kind: "floor", params: { odd: true } });
  eq(before.length, 1, "addThing leaves its input list alone");
  eq(after.map((t) => t.id), ["a", "thing-1"], "a thing with no id is given one");
  eq(after[0].state, { keep: 1 }, "siblings keep their state through an add");
  eq(after[1].params, { odd: true }, "the new thing keeps its params");
  eq(addThing(before, { kind: "floor" }, { makeId: () => "mine" }).at(-1).id, "mine", "makeId names the new thing");
  throwsIt(() => addThing(before, { id: "a", kind: "floor" }), "a taken id throws");
  throwsIt(() => addThing(before, { id: "n", kind: "dragon" }), "an unknown kind throws");
  throwsIt(() => addThing(before, null), "a non-thing throws");
  const seen = [];
  addThing([], { kind: "fixture", layers: { hasty: { check: "skill" }, methodical: "bad" } }, { layer: (l, name, t) => (seen.push([name, t.kind, l.check]), l) });
  eq(seen, [["hasty", "fixture", "skill"]], "the layer normalizer sees each authored layer and its thing; a non-object layer is skipped");
}

{
  const before = freeze([
    { id: "a", kind: "body", params: { p: 1 }, state: { q: 2 } },
    { id: "b", kind: "fixture", params: { r: 3 }, state: { s: 4 } },
  ]);
  const after = removeThing(before, "a");
  eq(after.map((t) => t.id), ["b"], "removeThing drops the one thing");
  eq(after[0].params, { r: 3 }, "a sibling keeps its params when another is removed");
  eq(after[0].state, { s: 4 }, "a sibling keeps its state when another is removed");
  eq(before.length, 2, "removeThing leaves its input list alone");
  eq(removeThing(before, "nope").map((t) => t.id), ["a", "b"], "an unknown id removes nothing");
}

{
  const authored = {
    id: "a",
    kind: "container",
    ref: "Item.x",
    hidden: true,
    hint: "heavy",
    point: { x: 1, y: 2 },
    params: { gap: 9, registrantOnly: "yes" },
    layers: { hasty: { check: "inspect", yields: { clue: "kept" } } },
    state: { known: true, searchLock: { a1: 2 }, repeatLock: { a1: 3 }, layers: { hasty: { found: true } }, shown: true },
  };
  const before = freeze([authored, { id: "b", kind: "fixture", state: { stays: 1 } }]);
  const after = resetThing(before, "a");
  eq(after[0].state, {}, "a reset clears every state key, registrants' included");
  eq({ ...after[0], state: null }, { ...normalizeThings([authored])[0], state: null }, "a reset keeps hidden, hint, point, ref, params and layers");
  eq(after[0].params.registrantOnly, "yes", "a registrant's params key survives a reset");
  eq(after[1].state, { stays: 1 }, "another thing's state survives a reset");
  eq(before[0].state.known, true, "resetThing leaves its input list alone");
}

{
  const off = [];
  off.push(registerThingKind(THING_KINDS.TRAP, { accepts: (d) => d.documentName === "Item" && d.type === "trap" }));
  off.push(registerThingKind(THING_KINDS.CONTAINER, { accepts: (d) => d.documentName === "Item" && d.type === "chest" }));
  off.push(registerThingKind(THING_KINDS.FIXTURE, { accepts: (d) => d.documentName === "Item" }));
  eq(kindOfDrop({ documentName: "Item", type: "trap" }), null, "two kinds accepting is ambiguous: null");
  eq(kindsAccepting({ documentName: "Item", type: "trap" }), ["trap", "fixture"], "the accepting kinds, in registration order");
  eq(kindOfDrop({ documentName: "Item", type: "chest" }), null, "container and fixture both accept a chest");
  off[2]();
  eq(kindOfDrop({ documentName: "Item", type: "chest" }), "container", "one accepting kind is the answer");
  eq(kindOfDrop({ documentName: "Actor" }), null, "no kind accepts an actor");
  throwsIt(() => registerThingKind(THING_KINDS.TRAP, { accepts: () => true }), "a kind has one registrant");
  throwsIt(() => registerThingKind("dragon", { accepts: () => true }), "an unnamed kind cannot register");
  throwsIt(() => registerThingKind(THING_KINDS.EXIT, {}), "accepts is required");
  off.forEach((fn) => fn());
  eq(kindsAccepting({ documentName: "Item", type: "trap" }), [], "unregistering empties the table");
  registerThingKind(THING_KINDS.TRAP, { accepts: () => true })();
  checks++;
}

/* -------------------------------------------- */
/*  Layers and defaults                          */
/* -------------------------------------------- */

{
  eq(normalizeLayer({}, defaultLayer("body", "hasty")), defaultLayer("body", "hasty"), "an empty layer reads as its default");
  const l = normalizeLayer({ check: "teleport", capability: "  reading ", anyone: "yes", tools: ["u1", "u1", "", 3, " u2 "], turns: -2, yields: { lots: ["l1", "l1"], clue: "  Found: a ledge ", reveal: ["thing:a", "wall:9", "door:3", "thing:", "plain"] } });
  eq(l, { check: "inspect", capability: "reading", anyone: false, tools: ["u1", "u2"], turns: null, yields: { lots: ["l1"], clue: "Found: a ledge", reveal: ["thing:a", "wall:9"] } }, "layer fields are cleaned");
  eq(normalizeLayer({ turns: "3" }).turns, 3, "a positive turns count is kept");
  eq(KIND_DEFAULTS.body.hasty, CHECK.INSPECT, "a body's hasty check is an inspection");
  eq(defaultLayer("floor", "hasty").check, CHECK.SEARCH, "a floor's hasty check takes the searching throw");
  eq(defaultLayer("lot", "hasty").check, CHECK.SEARCH, "open loot's hasty check takes the searching throw");
  for (const kind of Object.values(THING_KINDS)) eq(defaultLayer(kind, "methodical").check, CHECK.SEARCH, `${kind} methodical is a search`);
  for (const kind of ["body", "container", "fixture", "exit", "trap", "obstacle", "condition"]) eq(defaultLayer(kind, "hasty").check, CHECK.INSPECT, `${kind} hasty is an inspection`);
  const stored = normalizeSceneThings([{ id: "f", kind: "floor", layers: { methodical: { yields: { lots: ["l"] } } } }]);
  eq(stored[0].layers.methodical.check, CHECK.SEARCH, "a stored layer is completed from its kind's default");
  eq(stored[0].layers.hasty, undefined, "a layer nobody authored is not stored");
}

/* -------------------------------------------- */
/*  Entries                                      */
/* -------------------------------------------- */

{
  const entries = sceneEntries({
    things: [{ id: "rug", kind: "floor", layers: { hasty: { yields: { lots: ["coins"] } } } }, { id: "mural", kind: "fixture" }],
    doors: [{ id: "w1", hidden: true, point: { x: 5, y: 5 } }, { id: "w2", hidden: false }, { hidden: true }, { id: "  " }],
    oldTraps: [{ id: "z1", known: false }, { id: "z2", known: true, point: { x: 1, y: 1 } }],
    bodies: [{ id: "b1", state: { layers: { hasty: { found: true } } }, layers: { hasty: { yields: { lots: ["purse"] } } } }, null],
  });
  eq(entries.map((e) => e.key), ["thing:rug", "thing:mural", "wall:w1", "wall:w2", "trap:z1", "trap:z2", "body:b1"], "one entry per inspectable, derived rows keyed by their source");
  eq(entries.map((e) => e.source), ["thing", "thing", "door", "door", "oldTrap", "oldTrap", "body"], "each entry names its source");
  eq(entries.map((e) => e.kind), ["floor", "fixture", "exit", "exit", "trap", "trap", "body"], "derived rows take their kind");
  eq(entries.filter((e) => e.hidden).map((e) => e.key), ["wall:w1", "trap:z1"], "a hidden door and an unknown trap start hidden");
  eq(byKey(entries, "thing:rug").layers.hasty.yields.lots, ["coins"], "an authored yield is kept");
  eq(byKey(entries, "thing:rug").layers.hasty.check, CHECK.SEARCH, "the floor's default check carries under its authored yield");
  eq(byKey(entries, "thing:mural").layers.methodical.check, CHECK.SEARCH, "both layers are present on every entry");
  eq(byKey(entries, "body:b1").state.layers.hasty.found, true, "a derived row's state is carried");
  eq(sceneEntries(), [], "no input, no entries");
}

/* -------------------------------------------- */
/*  What a seat sees                             */
/* -------------------------------------------- */

{
  const mural = thing({ id: "mural", kind: "fixture", layers: { methodical: layer({ check: CHECK.SEARCH, yields: { lots: [], clue: "Found: a loose stone", reveal: ["thing:safe", "wall:w9"] } }) } });
  const safe = thing({ id: "safe", hidden: true, layers: { hasty: layer({ yields: { lots: ["gems"] } }) } });
  const judgeOnly = thing({ id: "cache", hidden: true });
  const shown = thing({ id: "shrine", hidden: true, state: { shown: true } });
  const doors = [{ id: "w9", hidden: true }];
  const entries = entriesOf([mural, safe, judgeOnly, shown], { doors });

  eq(seatView(entries, { isGM: true }).length, 5, "the Judge sees every entry");
  eq(seatView(entries, { isGM: false }).map((e) => e.key), ["thing:mural", "thing:shrine"], "a player sees neither the hidden thing, the Judge-only one, nor the hidden exit behind the unsolved clue");
  ok(behindClue(byKey(entries, "thing:safe"), entries), "a hidden thing a layer names is behind that clue");
  ok(!behindClue(byKey(entries, "thing:cache"), entries), "a hidden thing nothing names is the Judge's to show, not behind a clue");
  ok(!isVisible(byKey(entries, "thing:cache"), entries), "the Judge-only thing stays unseen");
  ok(isVisible(byKey(entries, "thing:shrine"), entries), "state.shown shows a hidden thing");

  const solved = entriesOf([{ ...mural, state: { layers: { methodical: { found: true } } } }, safe, judgeOnly, shown], { doors });
  eq(seatView(solved, { isGM: false }).map((e) => e.key), ["thing:mural", "thing:safe", "thing:shrine", "wall:w9"], "a solved clue brings what it reveals into view; the Judge-only thing stays out");
  ok(!behindClue(byKey(solved, "thing:safe"), solved), "a solved clue no longer holds its thing back");

  const attempted = entriesOf([{ ...mural, state: { layers: { methodical: { done: true, found: false, failed: { a: 1 } } } } }, safe], {});
  ok(!isVisible(byKey(attempted, "thing:safe"), attempted), "a failed attempt at the clue reveals nothing");
  const shownBehind = entriesOf([mural, { ...safe, state: { shown: true } }], {});
  ok(isVisible(byKey(shownBehind, "thing:safe"), shownBehind), "the Judge may show a thing that hides behind a clue");
}

/* -------------------------------------------- */
/*  The GUMSHOE mark                             */
/* -------------------------------------------- */

{
  const front = thing({ id: "front", kind: "fixture", layers: { methodical: layer({ check: CHECK.SEARCH, yields: { clue: "Found: a seam", reveal: ["thing:back"] } }) } });
  const back = thing({ id: "back", hidden: true, layers: { hasty: layer({ yields: { lots: ["hoard"] } }) } });
  const plainBox = thing({ id: "box", layers: { hasty: layer({ yields: { lots: ["trinket"] } }) } });
  const empty = thing({ id: "empty" });
  const entries = entriesOf([front, back, plainBox, empty]);

  ok(moreRemains(byKey(entries, "thing:front"), entries), "an unsolved clue marks the entry in front of it");
  ok(!moreRemains(byKey(entries, "thing:back"), entries), "what hides behind the unsolved clue carries no mark of its own");
  ok(moreRemains(byKey(entries, "thing:box"), entries), "an unfound lot marks its entry");
  ok(!moreRemains(byKey(entries, "thing:empty"), entries), "an entry that yields nothing has nothing more");
  eq(remainingKinds(byKey(entries, "thing:front"), entries), [MORE.CLUE, MORE.REVEAL], "the clue and the reveal are the kinds that remain on the front");
  eq(remainingKinds(byKey(entries, "thing:box"), entries), [MORE.LOTS], "an unfound lot reads as lots");

  const solved = entriesOf([{ ...front, state: { layers: { methodical: { found: true } } } }, back, plainBox, empty]);
  ok(!moreRemains(byKey(solved, "thing:front"), solved), "a solved clue no longer marks its entry");
  ok(moreRemains(byKey(solved, "thing:back"), solved), "the revealed thing carries its own mark once the clue is solved");
  const half = entriesOf([plainBox], {});
  eq(remainingKinds({ ...byKey(half, "thing:box"), state: { layers: { hasty: { found: true } } } }, half), [], "a found layer contributes nothing");

  const dangling = entriesOf([thing({ id: "solo", layers: { methodical: layer({ yields: { reveal: ["thing:ghost"] } }) } })]);
  ok(!moreRemains(byKey(dangling, "thing:solo"), dangling), "a reveal that names nothing in the scene is not something more");
  const open = entriesOf([thing({ id: "solo", layers: { methodical: layer({ yields: { reveal: ["thing:seen"] } }) } }), thing({ id: "seen" })]);
  ok(!moreRemains(byKey(open, "thing:solo"), open), "a reveal that names a thing already in view is not something more");
}

/* -------------------------------------------- */
/*  Who may attempt what                         */
/* -------------------------------------------- */

const hastySearch = (extra = {}) => thing({ id: "den", layers: { hasty: layer({ check: CHECK.SEARCH, yields: { lots: ["stash"] }, ...extra }) } });
const ctxOf = (entries, extra = {}) => ({ entries, figures, ...extra });

{
  const entries = entriesOf([hastySearch()]);
  const entry = entries[0];
  const [hasty, methodical] = layerOptions(entry, THIEF, ctxOf(entries));
  eq([hasty.layer, methodical.layer], ["hasty", "methodical"], "one option per layer, hasty first");
  eq([hasty.mode, hasty.refusal, hasty.target, hasty.bonus], ["search", null, 14, 2], "the thief's hasty search is a throw at the stated target with the stated bonus");
  eq([methodical.mode, methodical.refusal, methodical.target, methodical.bonus], ["search", null, 7, null], "a methodical search needs no capability and takes no thief's bonus");

  const plain = layerOptions(entry, PLAIN, ctxOf(entries));
  eq([plain[0].mode, plain[0].refusal], ["vague", null], "a member without the capability stays assignable and gets the vague hint only");
  eq([plain[1].mode, plain[1].refusal], ["search", null], "the same member may search methodically");

  const open = entriesOf([hastySearch({ anyone: true })]);
  const anyone = layerOptions(open[0], PLAIN, ctxOf(open))[0];
  eq([anyone.mode, anyone.target, anyone.bonus], ["search", 14, null], "a layer open to others lets them throw, without the thief's bonus");

  eq(layerOptions(entry, THIEF, { entries })[0].refusal, REFUSAL.NOT_IMPORTED, "a thrown check with no target imported cannot be assigned");
  eq(layerOptions(entry, THIEF, ctxOf(entries, { figures: { hastyTarget: "" } }))[0].refusal, REFUSAL.NOT_IMPORTED, "a blank target is not a target");

  const inspect = entriesOf([thing({ id: "pile", layers: { hasty: layer({ yields: { lots: ["bits"] } }) } })]);
  const lookers = layerOptions(inspect[0], PLAIN, { entries: inspect });
  eq([lookers[0].mode, lookers[0].refusal, lookers[0].target], ["inspect", null, null], "an inspection needs no throw and no imported figure");

  const found = entriesOf([thing({ id: "pile", state: { layers: { hasty: { found: true } } }, layers: { hasty: layer({ yields: { lots: ["bits"] } }) } })]);
  eq(layerOptions(found[0], PLAIN, { entries: found })[0].refusal, REFUSAL.ALREADY_FOUND, "a found layer is not attempted again");
}

{
  const skilled = entriesOf([thing({ id: "carving", kind: "fixture", layers: { hasty: layer({ check: CHECK.SKILL, capability: "reading", yields: { clue: "Found: a name" } }), methodical: layer({ check: CHECK.SKILL, capability: "reading", yields: { clue: "Found: a map" } }) } })]);
  const reader = { id: "r", level: 1, capabilities: ["reading"], tools: [] };
  const withSkill = layerOptions(skilled[0], reader, ctxOf(skilled));
  eq([withSkill[0].mode, withSkill[0].target, withSkill[1].refusal], ["skill", 11, null], "a member with the capability throws the skill's target");
  const without = layerOptions(skilled[0], PLAIN, ctxOf(skilled));
  eq([without[0].mode, without[0].refusal], ["vague", null], "a missing skill at the hasty check is the vague hint (the owner's rule)");
  eq(layerRefusal(skilled[0], "methodical", PLAIN, ctxOf(skilled)), { refusal: REFUSAL.CAPABILITY_MISSING, capability: "reading" }, "a missing skill at the methodical check is a refusal naming the capability");
  eq(layerRefusal(skilled[0], "methodical", reader, ctxOf(skilled)), null, "no refusal for a member who holds it");
  eq(layerOptions(skilled[0], reader, { entries: skilled, figures: { skillTargets: {} } })[0].refusal, REFUSAL.NOT_IMPORTED, "a skill with no imported target cannot be assigned");

  const open = entriesOf([thing({ id: "tablet", layers: { hasty: layer({ check: CHECK.SKILL, capability: "reading", anyone: true, yields: { clue: "Found: a date" } }) } })]);
  eq(layerOptions(open[0], PLAIN, ctxOf(open))[0].mode, "vague", "\"others may look hastily\" opens a search, never a skill");

  const unnamed = entriesOf([thing({ id: "u", layers: { hasty: layer({ check: CHECK.SKILL }) } })]);
  eq(layerOptions(unnamed[0], reader, ctxOf(unnamed))[0].refusal, REFUSAL.SKILL_UNNAMED, "a skill layer that names no capability cannot be assigned");

  const tooled = entriesOf([thing({ id: "lock", layers: { methodical: layer({ check: CHECK.SEARCH, tools: ["u-pick", "u-oil"] }) } })]);
  const kit = { id: "k", level: 1, capabilities: [], tools: ["u-pick"] };
  eq(layerRefusal(tooled[0], "methodical", kit, ctxOf(tooled)), { refusal: REFUSAL.TOOL_MISSING, missing: ["u-oil"] }, "a missing tool is named by uuid");
  eq(layerRefusal(tooled[0], "methodical", { ...kit, tools: ["u-oil", "u-pick", "u-extra"] }, ctxOf(tooled)), null, "holding every tool lifts the refusal");
}

/* -------------------------------------------- */
/*  The hasty lock                               */
/* -------------------------------------------- */

{
  const entries = entriesOf([hastySearch()]);
  const ctx = ctxOf(entries);
  const miss = outcomeOf(entries[0], "hasty", THIEF, ctx, { passed: false });
  eq([miss.code, miss.failed, miss.locks], [CODE.FOUND_NOTHING, true, true], "a failed hasty throw is found nothing, and locks");
  const state = recordOutcome(entries[0].state, "hasty", THIEF, miss);
  eq(state.layers.hasty.failed, { [THIEF.id]: 3 }, "the lock stores {actorId: level}, trap-rules' shape");
  eq([state.layers.hasty.done, state.layers.hasty.found, state.layers.hasty.by], [true, false, [THIEF.id]], "the layer is done, not found, and says who");
  const locked = { ...entries[0], state };
  eq(layerRefusal(locked, "hasty", THIEF, ctx), { refusal: REFUSAL.HASTY_LOCKED }, "the same character at the same level is locked out");
  eq(layerRefusal(locked, "hasty", { ...THIEF, level: 2 }, ctx)?.refusal, REFUSAL.HASTY_LOCKED, "a lower level stays locked");
  eq(layerRefusal(locked, "hasty", { ...THIEF, level: 4 }, ctx), null, "a level gained lifts the lock");
  eq(layerRefusal(locked, "hasty", { ...THIEF, id: "another" }, ctx), null, "the lock is the character's, not the spot's");
  eq(layerRefusal(locked, "methodical", THIEF, ctx), null, "a failed hasty throw does not lock the methodical check");
  const again = recordOutcome(state, "hasty", { ...THIEF, level: 4 }, outcomeOf(locked, "hasty", { ...THIEF, level: 4 }, ctx, { passed: false }));
  eq(again.layers.hasty.failed[THIEF.id], 4, "a second failure at the new level locks at that level");

  const slow = outcomeOf(entries[0], "methodical", THIEF, ctx, { passed: false });
  ok(slow.failed && !slow.locks, "a failed methodical throw does not lock");
  const afterSlow = { ...entries[0], state: recordOutcome(entries[0].state, "methodical", THIEF, slow) };
  eq(layerRefusal(afterSlow, "methodical", THIEF, ctx), null, "a methodical check may be repeated");
  eq(afterSlow.state.layers.methodical.failed, {}, "no lock is stored for a methodical failure");

  const stray = { ...entries[0], state: { layers: { methodical: { failed: { [THIEF.id]: 9 } } } } };
  eq(layerRefusal(stray, "methodical", THIEF, ctx), null, "a methodical check is never locked, whatever the record holds");
  const kept = recordOutcome({ layers: { hasty: { found: true } } }, "hasty", THIEF, { code: CODE.FOUND_NOTHING });
  eq(kept.layers.hasty.found, true, "a layer once found stays found");

  const keeps = recordOutcome({ known: true, layers: { methodical: { progress: 2 } }, shown: true }, "hasty", THIEF, miss);
  eq([keeps.known, keeps.shown, keeps.layers.methodical.progress], [true, true, 2], "recording keeps every key it does not own");
  eq(recordOutcome(entries[0].state, "hasty", THIEF, { code: CODE.NEEDS_ROLL }), {}, "a missing throw records nothing");
  eq(recordOutcome(entries[0].state, "hasty", THIEF, { refusal: REFUSAL.HASTY_LOCKED }), {}, "a refusal records nothing");
  const won = recordOutcome(state, "hasty", { ...THIEF, id: "b", level: 3 }, outcomeOf(entries[0], "hasty", { ...THIEF, id: "b" }, ctx, { passed: true }));
  eq([won.layers.hasty.found, won.layers.hasty.by, won.layers.hasty.failed], [true, [THIEF.id, "b"], { [THIEF.id]: 3 }], "a find marks the layer found and keeps the earlier lock");
}

/* -------------------------------------------- */
/*  Reach                                        */
/* -------------------------------------------- */

{
  const at = (point) => entriesOf([thing({ id: "far", point, layers: { methodical: layer({ yields: { lots: ["x"] } }) } })]);
  const base = { figures, searchReachFeet: 10, feetPerPixel: 0.1, partyPoint: { x: 0, y: 0 } };
  const refusalAt = (point, extra = {}) => {
    const entries = at(point);
    return layerRefusal(entries[0], "methodical", PLAIN, { entries, ...base, ...extra });
  };
  eq(refusalAt({ x: 60, y: 80 }), null, "100 px at a tenth of a foot is 10 feet: within reach");
  const out = refusalAt({ x: 600, y: 800 });
  eq([out.refusal, out.distanceFeet, out.reachFeet], [REFUSAL.OUT_OF_REACH, 100, 10], "a thing past the reach is refused with both figures");
  eq(refusalAt(null, {}), null, "a thing with no point is the Judge's call");
  eq(refusalAt({ x: 600, y: 800 }, { searchReachFeet: null }), null, "a reach not imported never refuses");
  eq(refusalAt({ x: 600, y: 800 }, { partyPoint: null }), null, "no party position never refuses");
  eq(refusalAt({ x: 600, y: 800 }, { feetPerPixel: null }), null, "no scale never refuses");
  eq(refusalAt({ x: 600, y: 800 }, { searchReachFeet: "" }), null, "a blank reach never refuses");
  const entries = at({ x: 600, y: 800 });
  eq(layerOptions(entries[0], PLAIN, { entries, ...base }).map((o) => o.refusal), [REFUSAL.OUT_OF_REACH, REFUSAL.OUT_OF_REACH], "reach applies to both checks");
}

/* -------------------------------------------- */
/*  What a check answers                         */
/* -------------------------------------------- */

{
  const clueText = "Found: the third tile lifts";
  const front = thing({ id: "altar", kind: "fixture", layers: { hasty: layer({ yields: { lots: ["offering"] } }), methodical: layer({ check: CHECK.SEARCH, yields: { clue: clueText, reveal: ["thing:vault"] } }) } });
  const vault = thing({ id: "vault", hidden: true, layers: { hasty: layer({ yields: { lots: ["bullion"] } }) } });
  const entries = entriesOf([front, vault]);
  const entry = byKey(entries, "thing:altar");
  const ctx = ctxOf(entries);

  const looked = outcomeOf(entry, "hasty", PLAIN, ctx);
  eq([looked.code, looked.lots, looked.more], [CODE.FOUND, ["offering"], [MORE.CLUE, MORE.REVEAL]], "an inspection finds what it yields and names the kinds still unfound");
  const miss = outcomeOf(entry, "methodical", PLAIN, ctx, { passed: false });
  eq([miss.code, miss.more], [CODE.FOUND_NOTHING, [MORE.LOTS, MORE.CLUE, MORE.REVEAL]], "a failed search finds nothing, and the mark still says more remains");
  const hit = outcomeOf(entry, "methodical", PLAIN, ctx, { passed: true });
  eq([hit.code, hit.clue, hit.reveal, hit.more], [CODE.FOUND, clueText, ["thing:vault"], [MORE.LOTS]], "a passed search yields the clue and what it reveals; the hasty layer's lot is still unfound");
  eq(outcomeOf(entry, "methodical", PLAIN, ctx), { code: CODE.NEEDS_ROLL, layer: "methodical" }, "a thrown check without its result asks for the roll");
  ok(Object.values(CODE).every((c) => c.startsWith(SCENE)) && Object.values(REFUSAL).every((c) => c.startsWith(SCENE)), "every code carries the scene: prefix");

  // Q3: a member without the capability, hasty check.
  const den = entriesOf([hastySearch()]);
  const vague = outcomeOf(den[0], "hasty", PLAIN, ctxOf(den));
  eq([vague.code, vague.lots, vague.clue], [CODE.VAGUE, undefined, undefined], "something present: the vague hint and no contents");
  const bare = entriesOf([thing({ id: "bare", layers: { hasty: layer({ check: CHECK.SEARCH }) } })]);
  eq(outcomeOf(bare[0], "hasty", PLAIN, ctxOf(bare)).code, CODE.FOUND_NOTHING, "nothing present: found nothing, not the hint");
  eq(outcomeOf(bare[0], "hasty", THIEF, ctxOf(bare), { passed: true }).code, CODE.FOUND_NOTHING, "a passed throw at an empty layer finds nothing");

  // Nothing leaks from a miss, a vague hint or a hint's kinds.
  for (const result of [looked.more, miss, outcomeOf(entry, "hasty", PLAIN, ctx).more, outcomeOf(byKey(entries, "thing:altar"), "methodical", PLAIN, ctx, { passed: false })]) {
    const text = JSON.stringify(result);
    ok(!text.includes("vault") && !text.includes(clueText) && !text.includes("bullion"), "a hint names no id and no clue text");
  }
  const vagueText = JSON.stringify(outcomeOf(entriesOf([{ ...front, layers: { hasty: layer({ check: CHECK.SEARCH, yields: { clue: clueText, reveal: ["thing:vault"] } }) } }, vault])[0], "hasty", PLAIN, ctxOf(entries)));
  ok(!vagueText.includes("vault") && !vagueText.includes(clueText), "the vague answer carries no id and no clue text");

  const refused = outcomeOf(entry, "hasty", PLAIN, { ...ctx, searchReachFeet: 5, feetPerPixel: 1, partyPoint: { x: 0, y: 0 } });
  eq(refused.code, CODE.FOUND, "an entry with no point is never out of reach");
  const far = entriesOf([thing({ id: "far", point: { x: 99, y: 0 } })]);
  eq(outcomeOf(far[0], "hasty", PLAIN, { entries: far, searchReachFeet: 5, feetPerPixel: 1, partyPoint: { x: 0, y: 0 } }), { refusal: REFUSAL.OUT_OF_REACH, layer: "hasty", distanceFeet: 99, reachFeet: 5 }, "a refused check answers its refusal and nothing else");
}

/* -------------------------------------------- */
/*  Reset                                        */
/* -------------------------------------------- */

{
  const authored = [
    { id: "altar", kind: "fixture", params: { odd: 1 }, layers: { methodical: { check: "search", yields: { clue: "Found: a seam" } } }, state: { known: true, layers: { methodical: { done: true, found: true } }, shown: true } },
  ];
  const before = entriesOf(authored);
  ok(!moreRemains(before[0], before), "found: nothing more remains");
  const after = entriesOf(resetThing(authored, "altar"));
  ok(moreRemains(after[0], after), "a reset forgets what was found: the clue is unfound again");
  eq(after[0].layers.methodical.yields.clue, "Found: a seam", "a reset keeps the authored layer");
  eq(after[0].params, { odd: 1 }, "a reset keeps the registrant's params");
  eq(after[0].state, {}, "a reset leaves the state empty");
  eq(layerRefusal(after[0], "methodical", PLAIN, ctxOf(after)), null, "and the check may be made again");
}

console.log(`test-scene-search: OK (${checks} checks — the thing list and its drops, add, remove and reset, the kind registry, layer defaults, entries, seat view, the GUMSHOE mark, assignment and refusals, the hasty lock, reach, outcomes and the hint's kinds)`);
