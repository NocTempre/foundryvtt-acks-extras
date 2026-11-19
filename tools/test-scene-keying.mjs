/**
 * Scene search's keying, on plain data: the lib op that changes the authored
 * half of a place's things (`reviseThings`), the edits each field of the rail
 * makes (`editsFor`, `withoutReveals`), the rail's model (`railOf`) and the
 * Things here tab's lists (`tabOf`), and the Crossing fieldset
 * (`keying-crossing-logic.mjs`). No globals are set while the keying logic
 * loads, which is the proof that half is Foundry-free; the crossing's own
 * readers load last, after the stand-ins the formation modules need, and are
 * handed to the fieldset as arguments exactly as `keying.mjs` hands them. Every
 * name and every figure here is this file's own invention; no turn count, throw
 * target, length or penalty stands for any printed one.
 */
import assert from "node:assert/strict";
import { normalizeThings, reviseThings } from "../scripts/lib/place-things-logic.mjs";
import { CHECK } from "../scripts/scene-search/constants.mjs";
import { crossingEdits, crossingOf, offeredKeys } from "../scripts/scene-search/keying-crossing-logic.mjs";
import { KEYING_REFUSAL, editsFor, railOf, reachedFrom, tabOf, withoutReveals } from "../scripts/scene-search/keying-logic.mjs";
import { sceneEntries } from "../scripts/scene-search/scene-logic.mjs";
import { overlayLots } from "../scripts/scene-search/session-logic.mjs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

const t = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
const thing = (over = {}) => ({ id: "t1", kind: "fixture", ...over });
const apply = (list, id, change) => {
  const { edits, refusal } = editsFor(normalizeThings(list), id, change);
  return { list: reviseThings(list, edits), edits, refusal };
};
const layerOf = (list, id, name) => normalizeThings(list).find((x) => x.id === id).layers[name];

/* -------------------------------------------- */
/*  reviseThings, the lib op                     */
/* -------------------------------------------- */

{
  const stored = [thing({ id: "a", hint: "old", params: { odd: 1 }, state: { shown: true, layers: { hasty: { done: true } } }, layers: { hasty: { check: "search", anyone: true, yields: { clue: "keep", reveal: ["thing:b"] } } } }), thing({ id: "b" })];
  const next = reviseThings(stored, [{ id: "a", patch: { layers: { hasty: { yields: { clue: "new" } } } } }]);
  eq(next[0].layers.hasty, { check: "search", anyone: true, yields: { clue: "new", reveal: ["thing:b"] } }, "a layer patch merges key by key: the keys it does not name stay, one level down too");
  eq(next[0].state, stored[0].state, "state survives an authored write");
  eq(next[0].params, { odd: 1 }, "params survive an authored write");
  eq(next[1], normalizeThings(stored)[1], "another thing is untouched");
  ok(stored[0].layers.hasty.yields.clue === "keep", "the input is not mutated");

  const wide = reviseThings(stored, [{ id: "a", patch: { state: { shown: false }, ref: "x", kind: "trap", point: { x: 1, y: 2 }, layers: {} } }]);
  eq(wide[0], normalizeThings(stored)[0], "state, ref, kind and point are never written by this op");
  const figured = reviseThings(stored, [{ id: "a", patch: { params: { odd: 2, length: 40 } } }]);
  eq(figured[0].params, { odd: 2, length: 40 }, "a params patch replaces the keys it names and adds the new ones");
  const cleared = reviseThings(figured, [{ id: "a", patch: { params: { length: null } } }]);
  eq(cleared[0].params, { odd: 2 }, "a null removes one params key and the keys the patch does not name stay");
  ok(!("length" in cleared[0].params), "a removed params key is absent, not undefined");
  eq(reviseThings(figured, [{ id: "a", patch: { params: { length: undefined } } }])[0].params, { odd: 2, length: 40 }, "an undefined params key is skipped");
  eq(figured[0].layers, normalizeThings(stored)[0].layers, "a params patch leaves the layers as they were");
  eq(stored[0].params, { odd: 1 }, "the input is not mutated by a params patch");
  eq(reviseThings(stored, [{ id: "zz", patch: { hint: "x" } }]).map((x) => x.hint), ["old", null], "an id the list does not hold changes nothing");

  const drop = reviseThings(stored, [{ id: "a", patch: { layers: { hasty: { check: null, anyone: null, yields: null } } } }]);
  ok(!("hasty" in drop[0].layers), "a layer whose last keys are removed is removed");
  eq(reviseThings(stored, [{ id: "a", patch: { layers: { hasty: null } } }])[0].layers, {}, "a null layer removes it");
  eq(reviseThings(stored, [{ id: "a", patch: { hint: "  " } }])[0].hint, null, "a blank hint removes the line");
  eq(reviseThings(stored, [{ id: "a", patch: { hidden: "no" } }])[0].hidden, false, "a non-boolean hidden is skipped");
}

/* -------------------------------------------- */
/*  What a field writes                          */
/* -------------------------------------------- */

{
  const base = [thing({ id: "a", layers: { hasty: { check: "skill", capability: "kw:x", tools: ["Item.one"] } } })];

  eq(apply(base, "a", { field: "hidden", value: true }).list[0].hidden, true, "Hidden writes hidden");
  eq(apply(base, "a", { field: "hint", value: " Something odd " }).list[0].hint, "Something odd", "Something more writes the hint, trimmed");
  eq(apply(base, "a", { field: "hint", value: "" }).list[0].hint, null, "a blank line removes the hint, so the table sees the generic words");

  const search = apply(base, "a", { field: "check", layer: "hasty", value: CHECK.SEARCH });
  eq(layerOf(search.list, "a", "hasty").check, "search", "Check writes check");
  ok(!("capability" in layerOf(search.list, "a", "hasty")), "leaving Proficiency drops the named capability, which a search would otherwise ask for");
  const skill = apply(base, "a", { field: "check", layer: "hasty", value: CHECK.SKILL });
  eq(layerOf(skill.list, "a", "hasty").capability, "kw:x", "staying on Proficiency keeps the capability");
  eq(apply(base, "a", { field: "check", layer: "hasty", value: "bogus" }).refusal, KEYING_REFUSAL.CHECK, "a check that is no check writes nothing");
  eq(apply(base, "a", { field: "check", layer: "hasty", value: "bogus" }).edits, [], "and makes no edit");
  eq(layerOf(apply(base, "a", { field: "capability", layer: "hasty", value: "kw:y" }).list, "a", "hasty").capability, "kw:y", "the proficiency picked is the layer's capability");
  ok(!("capability" in layerOf(apply(base, "a", { field: "capability", layer: "hasty", value: "" }).list, "a", "hasty")), "blank removes it");

  eq(layerOf(apply(base, "a", { field: "anyone", layer: "hasty", value: true }).list, "a", "hasty").anyone, true, "Others may look hastily writes anyone");
  eq(layerOf(apply(base, "a", { field: "clue", layer: "methodical", value: " a seam " }).list, "a", "methodical").yields, { clue: "a seam" }, "Yields writes the clue");
  eq(apply(base, "a", { field: "layer-less", value: 1 }).refusal, KEYING_REFUSAL.LAYER, "a layer field with no layer writes nothing");
  eq(apply(base, "a", { field: "clue", layer: "other", value: "x" }).refusal, KEYING_REFUSAL.LAYER, "and so does a layer that is not one of the two");
  eq(apply(base, "a", { field: "bogus", layer: "hasty", value: 1 }).refusal, KEYING_REFUSAL.FIELD, "a field the rail does not have writes nothing");
  eq(apply(base, "gone", { field: "hidden", value: true }).refusal, KEYING_REFUSAL.GONE, "a thing no longer in the list writes nothing");

  const twice = apply(apply(base, "a", { field: "toolAdd", layer: "hasty", value: "Item.two" }).list, "a", { field: "toolAdd", layer: "hasty", value: "Item.one" });
  eq(layerOf(twice.list, "a", "hasty").tools, ["Item.one", "Item.two"], "a tool dropped is added once");
  eq(layerOf(apply(base, "a", { field: "toolRemove", layer: "hasty", value: "Item.one" }).list, "a", "hasty").tools, [], "a tool removed leaves the rest");
  eq(apply(base, "a", { field: "toolAdd", layer: "hasty", value: "" }).refusal, KEYING_REFUSAL.FIELD, "a drop with no uuid adds nothing");

  const blank = apply(base, "a", { field: "turns", layer: "methodical", value: "" });
  ok(!("turns" in (layerOf(blank.list, "a", "methodical") ?? {})), "blank turns stores no figure: nothing stands in for a printed one");
  eq(layerOf(apply(base, "a", { field: "turns", layer: "methodical", value: "3" }).list, "a", "methodical").turns, 3, "the Judge's own figure is stored");
  for (const bad of ["0", "-1", "1.5", "abc"]) eq(apply(base, "a", { field: "turns", layer: "methodical", value: bad }).refusal, KEYING_REFUSAL.TURNS, `turns "${bad}" is refused`);
}

/* -------------------------------------------- */
/*  A session's dealt lots never reach the list  */
/* -------------------------------------------- */

{
  const stored = [thing({ id: "chest", kind: "container", layers: { methodical: { check: "search" } } })];
  const session = { lots: [{ key: "lot-1", thing: "thing:chest", layer: "methodical", cardId: "c1" }] };
  const seen = overlayLots(sceneEntries({ things: stored }), session.lots);
  eq(seen[0].layers.methodical.yields.lots, ["lot-1"], "the screen's entries carry the dealt lot's key in the layer");
  const names = new Map([["thing:chest", "chest"]]);
  eq(railOf(seen[0], seen, { names, t }).layers[1].held, ["ACKS-LOCATION.sceneSearch.keying.yields.lots.one {\"n\":1}"], "the rail shows the dealt lots read-only");
  const next = apply(stored, "chest", { field: "clue", layer: "methodical", value: "a seam" }).list;
  eq(layerOf(next, "chest", "methodical"), { check: "search", yields: { clue: "a seam" } }, "an authored write names its own keys and carries no lot key");
  ok(session.lots.length === 1 && !JSON.stringify(next).includes("lot-1"), "no dealt lot's key lands in the place's list");
}

/* -------------------------------------------- */
/*  Behind a clue                                */
/* -------------------------------------------- */

{
  const stored = [
    thing({ id: "fresco", layers: { methodical: { check: "search", yields: { clue: "x", reveal: ["thing:vault", "wall:w9"] } } } }),
    thing({ id: "vault", kind: "container", hidden: true }),
    thing({ id: "other", layers: { hasty: { yields: { reveal: ["thing:vault"] } } } }),
  ];
  const moved = apply(stored, "vault", { field: "behind", value: "other:methodical" });
  eq(layerOf(moved.list, "fresco", "methodical").yields.reveal, ["wall:w9"], "behind one clue at a time: the key leaves the clue it was behind, and a wall key beside it stays");
  ok(!(layerOf(moved.list, "other", "hasty").yields?.reveal ?? []).includes("thing:vault"), "and leaves a second front");
  eq(layerOf(moved.list, "other", "methodical").yields.reveal, ["thing:vault"], "and lands on the layer picked");
  eq(moved.edits.map((e) => e.id), ["fresco", "other"], "every thing that changes moves in the one edit list, for one write");

  const none = apply(stored, "vault", { field: "behind", value: "" });
  ok(normalizeThings(none.list).every((x) => !JSON.stringify(x.layers).includes("thing:vault")), "behind nothing takes the key from every clue");

  const same = apply(stored, "vault", { field: "behind", value: "fresco:methodical" });
  eq(same.edits.map((e) => e.id), ["other"], "behind the layer it already is: only the other front changes");

  eq(apply(stored, "vault", { field: "behind", value: "vault:hasty" }).refusal, KEYING_REFUSAL.FRONT, "a thing is never behind itself");
  eq(apply(stored, "vault", { field: "behind", value: "nobody:hasty" }).refusal, KEYING_REFUSAL.FRONT, "nor behind a thing that is not there");
  eq(apply(stored, "vault", { field: "behind", value: "fresco:other" }).refusal, KEYING_REFUSAL.FRONT, "nor behind a layer that is not one");

  const loop = [thing({ id: "a", layers: { hasty: { yields: { reveal: ["thing:b"] } } } }), thing({ id: "b", layers: { hasty: { yields: { reveal: ["thing:c"] } } } }), thing({ id: "c", hidden: true })];
  eq(apply(loop, "a", { field: "behind", value: "c:hasty" }).refusal, KEYING_REFUSAL.CYCLE, "a clue the entry itself leads to cannot be the clue in front of it");
  eq(apply(loop, "a", { field: "behind", value: "c:hasty" }).edits, [], "and writes nothing");
  eq([...reachedFrom(normalizeThings(loop).map((x) => ({ key: `thing:${x.id}`, layers: x.layers })), "thing:a")].sort(), ["thing:b", "thing:c"], "what an entry reaches is followed through other entries' reveals");

  const cleared = reviseThings(stored, withoutReveals(normalizeThings(stored), "thing:vault"));
  ok(normalizeThings(cleared).every((x) => !JSON.stringify(x.layers).includes("thing:vault")), "a removed thing's key is taken out of every reveal");
  eq(layerOf(cleared, "fresco", "methodical").yields.reveal, ["wall:w9"], "leaving the others");
}

/* -------------------------------------------- */
/*  The rail                                     */
/* -------------------------------------------- */

{
  const stored = [
    thing({ id: "fresco", hidden: false, hint: "a line", layers: { methodical: { check: "search", turns: 2, tools: ["Item.pick"], yields: { clue: "seam", reveal: ["thing:vault"] } }, hasty: { check: "skill", capability: "kw:lore", anyone: true } } }),
    thing({ id: "vault", kind: "container", hidden: true }),
    thing({ id: "plain", kind: "container" }),
  ];
  const entries = sceneEntries({ things: stored, doors: [{ id: "d1", hidden: true }], oldTraps: [{ id: "z1", known: false }], bodies: [{ id: "b1" }] });
  const names = new Map(entries.map((e) => [e.key, `name:${e.key}`]));
  const rail = (key, over = {}) => railOf(entries.find((e) => e.key === key), entries, { names, t, nameOfRef: (u) => (u === "Item.pick" ? "A pick" : ""), proficiencies: [{ token: "kw:lore", label: "Lore" }], ...over });

  const r = rail("thing:fresco");
  ok(r.keyable && r.id === "fresco", "a thing of the list is keyable");
  eq(r.hint, "a line", "the hint reads as stored");
  eq(r.hintPlaceholder, "ACKS-LOCATION.sceneSearch.screen.tell.generic", "the empty hint's placeholder is the generic words the table sees");
  eq(r.layers.map((l) => l.layer), ["hasty", "methodical"], "both layers, hasty first");
  eq(r.layers[0].skill.value, "kw:lore", "a Proficiency check names its proficiency");
  eq(r.layers[0].anyone, { on: true }, "Others may look hastily is the hasty layer's alone");
  eq(r.layers[1].anyone, null, "and the methodical layer has none");
  eq(r.layers[1].tools, { list: [{ uuid: "Item.pick", name: "A pick" }] }, "tools are the methodical layer's, named by their document");
  eq(rail("thing:plain").layers[1].tools, { list: [] }, "a layer with no tool still has the field to drop one on");
  eq(r.layers[0].tools, null, "and the hasty layer has none");
  eq(r.layers[1].turns, { value: 2 }, "turns read as stored");
  eq(r.layers[1].clue, "seam", "Yields is the clue");
  eq(r.layers[1].held, ["ACKS-LOCATION.sceneSearch.keying.yields.reveals.one {\"n\":1}"], "what a layer reveals is shown and not edited there");
  eq(r.layers[1].skill, null, "a search names no proficiency field");

  const v = rail("thing:vault");
  eq(v.behind.value, "fresco:methodical", "an entry behind a clue reads as behind that clue's layer");
  ok(!v.behind.disabled && v.canShow, "a hidden entry can be shown, and is keyed behind a clue");
  ok(rail("thing:plain").behind.disabled, "an entry that is not hidden cannot be behind a clue");
  eq(rail("thing:plain").layers[1].turns, { value: "" }, "turns with none stored read blank: nothing stands in for a printed figure");
  ok(!v.behind.options.some((o) => o.value.startsWith("vault:")), "no entry is offered as its own clue");
  ok(!v.behind.options.some((o) => o.value.startsWith("d1:")), "an entry read from the map is never a clue in front: it holds no list row");
  eq(v.behind.options.filter((o) => o.selected).map((o) => o.value), ["fresco:methodical"], "exactly one option is selected");
  const f = rail("thing:fresco");
  ok(!f.behind.options.some((o) => o.value.startsWith("vault:")), "a clue's own secret is not offered as the clue in front of it");

  const shown = railOf({ ...entries.find((e) => e.key === "thing:vault"), state: { shown: true } }, entries, { names, t });
  ok(!shown.canShow, "an entry already shown cannot be shown again");

  for (const key of ["wall:d1", "trap:z1", "body:b1"]) {
    const d = rail(key);
    ok(!d.keyable && !d.layers && !d.behind, `${key} is read from elsewhere: no field`);
    ok(d.derivedNote.includes(".derived."), `${key} says so`);
  }

  const orphan = railOf(entries.find((e) => e.key === "thing:fresco"), entries, { names, t, proficiencies: [] });
  eq(orphan.layers[0].skill.options.map((o) => o.value), ["", "kw:lore"], "a proficiency no longer offered stays selectable while a layer names it");
}

/* -------------------------------------------- */
/*  The tab                                      */
/* -------------------------------------------- */

{
  const stored = [thing({ id: "a", hidden: true, layers: { methodical: { yields: { reveal: ["thing:b"] } } } }), thing({ id: "b", kind: "lot" }), thing({ id: "c", kind: "obstacle" })];
  const entries = sceneEntries({ things: stored, doors: [{ id: "d1", hidden: false }, { id: "d2", hidden: true }], oldTraps: [{ id: "z1", known: true }], bodies: [{ id: "b1" }] });
  const names = new Map(entries.map((e) => [e.key, `n:${e.key}`]));
  const tab = tabOf(entries, names, t);
  eq(tab.things.map((r) => r.key), ["thing:a", "thing:b", "thing:c"], "the place's own things are the rows, an obstacle among them like any other kind");
  eq(tab.derived.map((r) => r.key), ["wall:d1", "wall:d2", "trap:z1"], "the map's doors and old trap zones are listed apart, and a fight's body is not a map's");
  ok(tab.things[0].flag.includes("flag.hidden") && tab.things[0].flag.includes("flag.front"), "a hidden clue's row flags both");
  ok(tab.things[1].flag.includes("flag.lot"), "a lot is flagged as dealt at open");
  eq(tab.derived[1].flag, "ACKS-LOCATION.sceneSearch.keying.flag.secretDoor", "a hidden exit's flag says it");
  ok(tab.things[0].summary.includes("summary.layer"), "a row summarises both layers");
  eq(tabOf([], new Map(), t), { things: [], derived: [] }, "a place with nothing keyed lists nothing");

  // A proficiency check's summary names the proficiency by its label, falling back to the token's word.
  const skilled = sceneEntries({ things: [thing({ id: "s", layers: { hasty: { check: "skill", capability: "kw:oldlore" } } })] });
  const named = (labelOf) => tabOf(skilled, new Map(), t, labelOf).things[0].summary;
  const labelled = named((token) => (token === "kw:oldlore" ? "Old Lore" : ""));
  ok(labelled.includes("Old Lore") && !labelled.includes("oldlore"), "the summary names a proficiency by its label");
  ok(named(() => "").includes("oldlore") && named(null).includes("oldlore"), "with no label the token's word stands");
}

/* -------------------------------------------- */
/*  The Crossing fieldset                        */
/* -------------------------------------------- */

{
  // The stand-ins the formation modules need to load; the fieldset reads none of them.
  class Stub {}
  const field = (kind) => class { constructor(options = {}) { this.kind = kind; this.options = options; } };
  globalThis.foundry = {
    abstract: { DataModel: class {}, TypeDataModel: class { static defineSchema() { return {}; } } },
    data: { regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } }, fields: { StringField: field("string"), HTMLField: field("html") }, operators: {} },
    utils: { deepClone: (v) => JSON.parse(JSON.stringify(v)), randomID: () => "id" },
    applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, sheets: { ItemSheetV2: Stub }, handlebars: {} },
  };
  globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
  globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

  const hazard = await import("../scripts/formation/hazard-logic.mjs");
  const { OBSTACLE_HAZARDS, figureRefKey } = await import("../scripts/formation/hazard-keys.mjs");
  const readers = { PARAM_KEYS: hazard.PARAM_KEYS, PICK_KEYS: hazard.PICK_KEYS, SQUEEZE_SHAPES: hazard.SQUEEZE_SHAPES, figureRefKey, penaltyPicksOf: hazard.penaltyPicksOf, readParam: hazard.readParam, readPick: hazard.readPick, setupKeysOf: hazard.setupKeysOf };
  const STEPS = [7, 11];
  const climb = OBSTACLE_HAZARDS.find((key) => !["jump", "swim", "squeeze"].includes(key));
  const hazardKeyOf = (ref) => (typeof ref === "string" && ref.startsWith("ref:") ? ref.slice(4) || null : null);
  const obstacle = (id, key, params = {}) => thing({ id, kind: "obstacle", ref: `ref:${key}`, params });
  const entryOf = (stored, id) => sceneEntries({ things: stored }).find((e) => e.key === `thing:${id}`);
  const fieldsOf = (stored, id, kind, steps = STEPS) => crossingOf(entryOf(stored, id), { kind, steps, readers, t })?.fields;
  const byKey = (fields, key) => fields.find((f) => f.key === key);
  const run = (stored, id, kind, change, steps = STEPS) => {
    const out = crossingEdits(normalizeThings(stored), id, change, { kind, steps, readers });
    return { ...out, list: reviseThings(stored, out.edits) };
  };
  const seedOf = (list, steps = STEPS) => hazard.crossingSeed(normalizeThings(list), hazardKeyOf, { penaltyPicks: hazard.penaltyPicksOf(steps) })[0]?.setup;
  const paramsOf = (list, id) => normalizeThings(list).find((x) => x.id === id).params;

  // Which keys each kind offers.
  eq(offeredKeys(climb, readers), ["length", "depth"], "a climb obstacle offers its length and depth");
  eq(offeredKeys("jump", readers), ["gap", "depth"], "a jump offers its gap and depth");
  eq(offeredKeys("squeeze", readers), ["shape", "length"], "a squeeze offers its shape and length");
  eq(offeredKeys("swim", readers), ["penaltyPick", "penaltyLarger"], "a swim offers the penalty pick and the larger figure, and no depth");
  eq(offeredKeys("waterCold", readers), [], "a condition offers nothing");
  eq(offeredKeys(null, readers), [], "a thing whose hazard did not resolve offers nothing");
  eq(fieldsOf([obstacle("o", "swim")], "o", "swim").map((f) => f.key), ["penaltyPick", "penaltyLarger"], "the fieldset lists the offered keys in the crossing's order");
  eq(crossingOf(entryOf([thing({ id: "c", kind: "condition", ref: "ref:waterCold" })], "c"), { kind: "waterCold", steps: STEPS, readers, t }), null, "a condition thing has no Crossing fieldset");
  eq(crossingOf(entryOf([obstacle("o", "swim")], "o"), { kind: null, steps: STEPS, readers, t }), null, "an obstacle whose hazard did not resolve has none");
  eq(crossingOf(entryOf([thing({ id: "f", kind: "fixture", ref: "ref:swim" })], "f"), { kind: "swim", steps: STEPS, readers, t }), null, "a thing that is no obstacle has none, whatever its ref names");

  // The penalty select, built from the imported steps.
  const swim = (params, steps) => byKey(fieldsOf([obstacle("o", "swim", params)], "o", "swim", steps), "penaltyPick");
  const selected = (f) => f.options.filter((o) => o.selected).map((o) => o.value);
  eq(swim({}).options.map((o) => o.value), ["", "none", "7", "11", "larger"], "the penalty offers not set, none, one row per imported step and larger");
  const stepRow = swim({}).options[2].label;
  ok(stepRow.includes("ACKS-FORMATION.crossing.swim.penaltyStep") && stepRow.includes("\"n\":1") && stepRow.includes("\"size\":7"), "a step's row is the crossing panel's own wording, numbered and sized");
  eq(swim({}, null).options.map((o) => o.value), ["", "none", "larger"], "with no step imported only none and larger are offered");
  eq(swim({}, []).options.map((o) => o.value), ["", "none", "larger"], "an empty list of steps is none imported too");
  eq(selected(swim({})), [""], "nothing stored reads as not set");
  eq(selected(swim({ penaltyPick: "7" })), ["7"], "a stored step is selected");
  eq(selected(swim({ penaltyPick: 11 })), ["11"], "a stored step held as a number is the same step");
  eq(selected(swim({ penaltyPick: "none" })), ["none"], "a stored none is selected, and is not the same as not set");
  eq(selected(swim({ penaltyPick: "9" })), [""], "a stored pick that is no listed step shows as not set, never defaulted");
  eq(selected(swim({ penaltyPick: "7" }, null)), [""], "a stored step shows as not set once no step is imported");
  eq(selected(swim({ penaltyPick: "larger" }, null)), ["larger"], "larger is listed whatever is imported");

  // The larger figure rides only on larger.
  const larger = (params) => byKey(fieldsOf([obstacle("o", "swim", params)], "o", "swim"), "penaltyLarger");
  ok(larger({}).disabled && larger({ penaltyPick: "none", penaltyLarger: 4 }).disabled && larger({ penaltyPick: "7", penaltyLarger: 4 }).disabled, "the larger figure is disabled while the pick is anything but larger");
  ok(!larger({ penaltyPick: "larger" }).disabled, "and enabled on larger");
  eq(larger({ penaltyPick: "larger", penaltyLarger: "4" }).value, 4, "a stored larger figure reads as the crossing reads it");
  eq(larger({ penaltyPick: "none", penaltyLarger: 4 }).value, "", "a figure stored beside a pick that is not larger is not shown");
  eq(larger({ penaltyPick: "larger", penaltyLarger: 0 }).value, "", "a figure the crossing refuses shows blank");

  // The shape and the figures.
  const shape = (params) => byKey(fieldsOf([obstacle("o", "squeeze", params)], "o", "squeeze"), "shape");
  eq(shape({}).options.map((o) => o.value), ["", "chokepoint", "squeeze"], "the shape offers not set and each shape the seed accepts");
  eq(selected(shape({ shape: "squeeze" })), ["squeeze"], "a stored shape is selected");
  eq(selected(shape({ shape: "wide" })), [""], "a stored shape the seed would not take shows as not set");
  const length = (params) => byKey(fieldsOf([obstacle("o", climb, params)], "o", climb), "length");
  eq(length({ length: "40" }).value, 40, "a stored figure reads through the crossing's reader");
  eq([length({}).value, length({ length: 0 }).value, length({ length: "x" }).value, length({ length: -3 }).value], ["", "", "", ""], "a blank or refused figure reads blank, and no figure stands in its place");
  const tip = length({}).tip;
  ok(tip.includes("keying.crossing.tip") && tip.includes("ACKS-FORMATION.crossing.length") && tip.includes(`crossing.ref.${figureRefKey(climb)}`), "a field's tooltip names the field and the page the kind cites");
  ok(swim({}).tip.includes("crossing.ref.swimming"), "each kind cites its own page");
  eq(swim({}).options[0].label, "ACKS-LOCATION.sceneSearch.keying.crossing.unset", "the not-set row says so");

  // What a change writes, and what the seed then reads.
  const base = [obstacle("o", climb, { length: 30, odd: 1 })];
  eq(paramsOf(run(base, "o", climb, { field: "length", value: "45" }).list, "o"), { length: 45, odd: 1 }, "a figure is stored as the reader returns it, and the keys beside it stay");
  const blanked = paramsOf(run(base, "o", climb, { field: "length", value: "" }).list, "o");
  ok(!("length" in blanked) && blanked.odd === 1, "a blank figure removes its key (absent, not undefined) and nothing else");
  ok(!("length" in paramsOf(run(base, "o", climb, { field: "length", value: "0" }).list, "o")), "a figure the crossing refuses removes its key, as the panel's own save does");
  ok(!("length" in paramsOf(run(base, "o", climb, { field: "length", value: null }).list, "o")), "so does a missing value");
  eq(run(base, "o", climb, { field: "length", value: "45" }).edits, [{ id: "o", patch: { params: { length: 45 } } }], "the edit names only the key it changes");
  eq(seedOf(run(base, "o", climb, { field: "length", value: "45" }).list), { length: 45 }, "a written figure round-trips through the seed");
  eq(seedOf(run(base, "o", climb, { field: "length", value: "" }).list), {}, "a cleared figure seeds nothing, so the panel's default stands");

  const sq = [obstacle("q", "squeeze")];
  const shaped = run(sq, "q", "squeeze", { field: "shape", value: "squeeze" }).list;
  eq(seedOf(shaped), { shape: "squeeze" }, "a written shape round-trips through the seed");
  ok(!("shape" in paramsOf(run(shaped, "q", "squeeze", { field: "shape", value: "" }).list, "q")), "a blank shape removes the key");
  eq(run(sq, "q", "squeeze", { field: "shape", value: "wide" }).refusal, KEYING_REFUSAL.FIELD, "a shape the seed would not take is refused");
  eq(run(sq, "q", "squeeze", { field: "shape", value: "wide" }).edits, [], "and writes nothing");

  const sw = [obstacle("w", "swim")];
  eq(seedOf(run(sw, "w", "swim", { field: "penaltyPick", value: "7" }).list), { penaltyPick: "7" }, "a written step round-trips through the seed");
  eq(run(sw, "w", "swim", { field: "penaltyPick", value: "9" }).refusal, KEYING_REFUSAL.FIELD, "a pick that is no imported step is refused");
  eq(run(sw, "w", "swim", { field: "penaltyPick", value: "7" }, null).refusal, KEYING_REFUSAL.FIELD, "a step is refused once no step is imported");
  eq(run(sw, "w", "swim", { field: "penaltyLarger", value: "4" }).refusal, KEYING_REFUSAL.FIELD, "a larger figure is refused while the pick is not larger");
  const onLarger = run(sw, "w", "swim", { field: "penaltyPick", value: "larger" }).list;
  eq(seedOf(onLarger), { penaltyPick: "larger" }, "larger alone seeds the pick and no figure");
  const sized = run(onLarger, "w", "swim", { field: "penaltyLarger", value: "12" }).list;
  eq(seedOf(sized), { penaltyPick: "larger", penaltyLarger: 12 }, "a larger figure round-trips through the seed");
  const left = paramsOf(run(sized, "w", "swim", { field: "penaltyPick", value: "none" }).list, "w");
  eq(left, { penaltyPick: "none" }, "leaving larger removes the larger figure in the same write");
  ok(!("penaltyLarger" in left), "and the key is absent");
  const unset = paramsOf(run(sized, "w", "swim", { field: "penaltyPick", value: "" }).list, "w");
  ok(!("penaltyPick" in unset) && !("penaltyLarger" in unset), "a blank pick removes the pick and the larger figure, both absent");
  const noFigure = paramsOf(run(sized, "w", "swim", { field: "penaltyLarger", value: "" }).list, "w");
  ok(!("penaltyLarger" in noFigure) && noFigure.penaltyPick === "larger", "a blank larger figure removes only itself");

  // Refusals.
  eq(run(base, "o", climb, { field: "gap", value: "5" }).refusal, KEYING_REFUSAL.FIELD, "a key the kind does not offer is refused");
  eq(run(sw, "w", "swim", { field: "movement", value: "running" }).refusal, KEYING_REFUSAL.FIELD, "movement is never carried");
  eq(run(sw, "w", "swim", { field: "judgeMod", value: "2" }).refusal, KEYING_REFUSAL.FIELD, "the Judge's modifier is never carried");
  eq(run(sw, "w", "swim", { field: "depth", value: "5" }).refusal, KEYING_REFUSAL.FIELD, "a swim has no depth");
  eq(run(base, "o", null, { field: "length", value: "5" }).refusal, KEYING_REFUSAL.FIELD, "a thing whose hazard did not resolve is refused");
  eq(run(base, "zz", climb, { field: "length", value: "5" }).refusal, KEYING_REFUSAL.GONE, "a thing the place no longer holds is refused as gone");
  eq(run([thing({ id: "x", kind: "fixture", ref: `ref:${climb}` })], "x", climb, { field: "length", value: "5" }).refusal, KEYING_REFUSAL.FIELD, "a thing that is no obstacle is refused");
}

console.log(`test-scene-keying: OK (${checks} checks — the lib op over the authored half and its params merge, each rail field's write, the dealt-lot guard, behind a clue and its loop guard, the rail's model and the Things here tab's lists, the Crossing fieldset's offer, reads and writes)`);
