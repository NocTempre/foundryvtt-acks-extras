/**
 * The Region window's Place row, Foundry-free half: which dropped document
 * becomes a trap, an obstacle or a condition, the thing a drop builds, why a
 * refused drop was refused, and the counts a place's list reads as. No globals
 * are set, which is the proof the logic is Foundry-free. The DOM row and the
 * drop's writes need a live Foundry and are walked there.
 */
import assert from "node:assert/strict";
import { addThing, kindOfDrop, kindsAccepting, normalizeThings } from "../scripts/lib/place-things-logic.mjs";
import { HAZARD_ITEM_TYPE, TRAP_ITEM_TYPE } from "../scripts/formation/constants.mjs";
import { CONDITION_HAZARDS, OBSTACLE_HAZARDS } from "../scripts/formation/hazard-keys.mjs";
import { registerHazardThingKinds } from "../scripts/formation/hazard-things.mjs";
import {
  HAZARD_THING_KINDS,
  acceptsCondition,
  acceptsObstacle,
  acceptsTrap,
  countsOf,
  descriptorOf,
  refusalOfDrop,
  thingOfDrop,
} from "../scripts/formation/region-place-logic.mjs";

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

const item = (type, key, uuid = "Item.x1") =>
  descriptorOf({ documentName: "Item", type, uuid, system: key === undefined ? {} : { key } });
const trap = item(TRAP_ITEM_TYPE, undefined, "Item.trap1");
const obstacle = item(HAZARD_ITEM_TYPE, OBSTACLE_HAZARDS[0], "Compendium.acks-extras.hazards.Item.o1");
const condition = item(HAZARD_ITEM_TYPE, CONDITION_HAZARDS[0], "Item.c1");
const blank = item(HAZARD_ITEM_TYPE, "", "Item.b1");
const unknown = item(HAZARD_ITEM_TYPE, "not-a-key", "Item.b2");
const other = item("weapon", undefined, "Item.w1");
const actor = descriptorOf({ documentName: "Actor", type: TRAP_ITEM_TYPE, uuid: "Actor.a1" });

/* -------------------------------------------- */
/*  The kind predicates                          */
/* -------------------------------------------- */

{
  ok(acceptsTrap(trap), "an Item of the trap type is a trap");
  ok(!acceptsObstacle(trap) && !acceptsCondition(trap), "a trap is neither of the others");
  ok(acceptsObstacle(obstacle) && !acceptsCondition(obstacle) && !acceptsTrap(obstacle), "an obstacle hazard is only an obstacle");
  ok(acceptsCondition(condition) && !acceptsObstacle(condition) && !acceptsTrap(condition), "a condition hazard is only a condition");
  for (const bad of [blank, unknown]) {
    ok(!acceptsObstacle(bad) && !acceptsCondition(bad) && !acceptsTrap(bad), "a hazard with a blank or unknown key is accepted by no kind");
  }
  ok(!acceptsTrap(other) && !acceptsObstacle(other) && !acceptsCondition(other), "any other Item is accepted by none");
  ok(!acceptsTrap(actor), "a document that is not an Item is accepted by none, whatever its type says");
  ok(!acceptsTrap(null) && !acceptsObstacle(undefined) && !acceptsCondition(null), "no drop is accepted by none");
  eq(descriptorOf(null), null, "no document has no descriptor");
  eq(descriptorOf({ documentName: "Item", type: "x", uuid: "Item.own" }, "Item.given").uuid, "Item.given", "the uuid a drag names wins over the document's own");
  for (const key of OBSTACLE_HAZARDS) ok(acceptsObstacle(item(HAZARD_ITEM_TYPE, key)), `every obstacle key is accepted: ${key}`);
  for (const key of CONDITION_HAZARDS) ok(acceptsCondition(item(HAZARD_ITEM_TYPE, key)), `every condition key is accepted: ${key}`);
}

/* -------------------------------------------- */
/*  The one kind table                           */
/* -------------------------------------------- */

{
  const off = registerHazardThingKinds();
  eq(kindOfDrop(trap), "trap", "the table turns a trap Item into a trap");
  eq(kindOfDrop(obstacle), "obstacle", "an obstacle hazard into an obstacle");
  eq(kindOfDrop(condition), "condition", "a condition hazard into a condition");
  eq(kindOfDrop(blank), null, "a blank hazard into nothing");
  eq(kindOfDrop(other), null, "another Item into nothing");
  eq(kindsAccepting(trap), ["trap"], "exactly one kind takes a trap");
  throwsIt(() => registerHazardThingKinds(), "a kind has one registrant, so registering twice throws");
  off();
  eq(kindOfDrop(trap), null, "unregistered, the table takes nothing");
}

/* -------------------------------------------- */
/*  What a drop builds                           */
/* -------------------------------------------- */

{
  eq(
    thingOfDrop("trap", trap),
    { kind: "trap", ref: "Item.trap1", hidden: true, hint: null, point: null, params: {}, layers: {}, state: {} },
    "a trap starts hidden, with no figures, and points at the dropped Item",
  );
  eq(
    thingOfDrop("obstacle", obstacle),
    {
      kind: "obstacle",
      ref: "Compendium.acks-extras.hazards.Item.o1",
      hidden: false,
      hint: null,
      point: null,
      params: { length: null, gap: null, depth: null },
      layers: {},
      state: {},
    },
    "an obstacle keeps a compendium uuid as dropped, and its three figures start blank",
  );
  eq(thingOfDrop("condition", condition).params, {}, "a condition has no figures");
  eq(thingOfDrop("condition", condition).hidden, false, "a condition starts shown");
  throwsIt(() => thingOfDrop("body", trap), "a kind formation does not own builds nothing");
  const a = thingOfDrop("obstacle", obstacle);
  const b = thingOfDrop("obstacle", obstacle);
  ok(a.params !== b.params, "two drops share no params object");

  // The built thing is accepted by the list's own writer and kept as built.
  let list = addThing([], thingOfDrop("trap", trap));
  list = addThing(list, thingOfDrop("obstacle", obstacle));
  list = addThing(list, thingOfDrop("trap", trap));
  eq(list.map((t) => t.id), ["thing-1", "thing-2", "thing-3"], "the list assigns the ids");
  eq(list[1].params, { length: null, gap: null, depth: null }, "an obstacle's blank figures survive the list");
  eq(normalizeThings(list), list, "a built list is already in its signed shape");
}

/* -------------------------------------------- */
/*  Why a drop was refused                       */
/* -------------------------------------------- */

{
  eq(refusalOfDrop(trap, "trap"), null, "a taken drop is not refused");
  eq(refusalOfDrop(null, null), "notItem", "a drag with no document is not an Item");
  eq(refusalOfDrop(actor, null), "notItem", "an Actor is not an Item");
  eq(refusalOfDrop(blank, null), "blankHazard", "a hazard with no usable key says so");
  eq(refusalOfDrop(unknown, null), "blankHazard", "a hazard with an unknown key says the same");
  eq(refusalOfDrop(other, null), "notAccepted", "any other Item is not accepted");
}

/* -------------------------------------------- */
/*  The counts                                   */
/* -------------------------------------------- */

{
  const things = [
    { kind: "obstacle", ref: "Item.o1" },
    { kind: "trap", ref: "Item.t1" },
    { kind: "condition", ref: "Item.c1" },
    { kind: "obstacle", ref: "Item.o2" },
    { kind: "condition", ref: "Item.c2" },
    { kind: "body", ref: "Actor.a1" },
  ];
  const names = { "Item.t1": "First trap", "Item.o1": "First obstacle", "Item.c1": "First condition" };
  const rows = countsOf(things, (ref) => names[ref] ?? null);
  eq(rows.map((r) => r.kind), HAZARD_THING_KINDS, "rows follow the fixed kind order, not the list's");
  eq(rows.map((r) => r.count), [1, 2, 2], "each kind's things are counted, and other kinds are not");
  eq(rows[1].names, ["First obstacle", "Item.o2"], "a ref with no name is shown as the ref, in list order");
  eq(rows[0].names, ["First trap"], "a named ref shows its name");
  eq(countsOf([{ kind: "trap", ref: "Item.t1" }, { kind: "trap", ref: "Item.t1" }]).map((r) => r.count), [2], "the same ref twice counts twice");
  eq(countsOf([{ kind: "trap", ref: null }])[0].names, [""], "a thing with no ref has an empty name");
  eq(countsOf([]), [], "an empty place has no rows");
  eq(countsOf(undefined), [], "no list has no rows");
  eq(countsOf([{ kind: "body" }]), [], "a place of other kinds has no hazard rows");
}

console.log(`test-region-place-row: OK (${checks} checks — the three kind predicates and the one kind table, the thing a drop builds, why a drop is refused, and the counts and names grouping)`);
