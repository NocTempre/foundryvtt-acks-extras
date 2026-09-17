/**
 * Points of interest: the pure derivations.
 *
 * Every figure here is INVENTED — the district-travel turns a real world holds
 * arrive through the importer. What is pinned is the SHAPE: two outlines meet
 * on a boundary or do not; a hop is priced from the relation and the pace or
 * refused with the missing thing named; a marker carries its expiry in world
 * seconds and hides behind no journal entry; a promoted marker becomes a place
 * with the words the Judge was looking at; and a place's own token is never
 * somebody living on the map it stands on.
 */
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/lib/constants.mjs";
import { LOCATION_TYPE } from "../scripts/location/constants.mjs";
import { sceneOccupants } from "../scripts/lib/place.mjs";
import {
  DISTRICT_RELATION, TRANSIENT_FLAG, districtRelation, expiredNoteIds, noteLabel, poiTravelTurns,
  promotedPlaceData, ringsTouch, transientNoteData, transientOf,
} from "../scripts/formation/poi-logic.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/* ---------------- ringsTouch ---------------- */

const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s];

ok("two quarters that share a street meet on it", () => {
  assert.equal(ringsTouch([square(0, 0, 100)], [square(100, 0, 100)]), true);
});

ok("two quarters a road apart do not", () => {
  assert.equal(ringsTouch([square(0, 0, 100)], [square(120, 0, 100)]), false);
});

ok("a corner on the other's edge is a meeting", () => {
  assert.equal(ringsTouch([square(0, 0, 100)], [square(100, 100, 100)]), true, "corner to corner");
  assert.equal(ringsTouch([square(0, 0, 100)], [square(100, 50, 100)]), true, "corner onto an edge");
});

ok("the tolerance is the hand's slack, not a neighbourhood", () => {
  assert.equal(ringsTouch([square(0, 0, 100)], [square(105, 0, 100)], 8), true, "5 apart within 8");
  assert.equal(ringsTouch([square(0, 0, 100)], [square(120, 0, 100)], 8), false, "20 apart is a gap");
  assert.equal(ringsTouch([square(0, 0, 100)], [square(120, 0, 100)], 25), true, "unless the slack says so");
});

ok("an outline made of nothing meets nothing", () => {
  assert.equal(ringsTouch([], [square(0, 0, 100)]), false);
  assert.equal(ringsTouch([square(0, 0, 100)], null), false);
  assert.equal(ringsTouch([[]], [square(0, 0, 100)]), false);
});

ok("a quarter drawn as two islands meets through either", () => {
  assert.equal(ringsTouch([square(0, 0, 50), square(300, 300, 50)], [square(350, 300, 50)]), true);
});

/* ---------------- districtRelation ---------------- */

ok("no quarter at one end is outside, and touch is not asked", () => {
  let asked = 0;
  const touch = () => { asked++; return true; };
  assert.equal(districtRelation(null, { id: "b" }, { touch }), DISTRICT_RELATION.OUTSIDE);
  assert.equal(districtRelation({ id: "a" }, undefined, { touch }), DISTRICT_RELATION.OUTSIDE);
  assert.equal(asked, 0);
});

ok("the same quarter, by identity or by id, is the same and touch is not asked", () => {
  let asked = 0;
  const touch = () => { asked++; return false; };
  const a = { id: "a" };
  assert.equal(districtRelation(a, a, { touch }), DISTRICT_RELATION.SAME);
  assert.equal(districtRelation({ id: "a" }, { id: "a" }, { touch }), DISTRICT_RELATION.SAME);
  assert.equal(asked, 0);
});

ok("two different quarters are adjacent when they touch and far when they do not", () => {
  const seen = [];
  const a = { id: "a" };
  const b = { id: "b" };
  assert.equal(districtRelation(a, b, { touch: (x, y) => { seen.push([x, y]); return true; } }), DISTRICT_RELATION.ADJACENT);
  assert.deepEqual(seen, [[a, b]], "asked once, in order");
  assert.equal(districtRelation(a, b, { touch: () => false }), DISTRICT_RELATION.FAR);
  assert.equal(districtRelation(a, b), DISTRICT_RELATION.FAR, "with no way to ask, two quarters are far");
});

/* ---------------- poiTravelTurns ---------------- */

const FIGURES = { same: { commuting: 1, meandering: 3 }, adjacent: { commuting: 2 } }; // invented

ok("a hop within or into the next quarter is priced from the imported figure", () => {
  assert.deepEqual(poiTravelTurns(FIGURES, "same", "meandering"), { turns: 3, missing: "" });
  assert.deepEqual(poiTravelTurns(FIGURES, "adjacent", "commuting"), { turns: 2, missing: "" });
});

ok("a hop the figures cannot price says which piece is missing", () => {
  assert.deepEqual(poiTravelTurns(FIGURES, "far", "commuting"), { turns: null, missing: "relation" });
  assert.deepEqual(poiTravelTurns(FIGURES, "outside", "commuting"), { turns: null, missing: "relation" });
  assert.deepEqual(poiTravelTurns(null, "same", "commuting"), { turns: null, missing: "table" });
  assert.deepEqual(poiTravelTurns(FIGURES, "adjacent", "meandering"), { turns: null, missing: "pace" });
  assert.deepEqual(poiTravelTurns({ same: { commuting: -1 } }, "same", "commuting"), { turns: null, missing: "pace" }, "a negative figure is no figure");
});

ok("turns are whole, and a figure that arrived as text still counts", () => {
  assert.equal(poiTravelTurns({ same: { commuting: 2.7 } }, "same", "commuting").turns, 2);
  assert.equal(poiTravelTurns({ same: { commuting: "4" } }, "same", "commuting").turns, 4);
  assert.deepEqual(poiTravelTurns({ same: { commuting: 0 } }, "same", "commuting"), { turns: 0, missing: "" }, "zero is a price");
});

/* ---------------- noteLabel ---------------- */

ok("a short text is its own label, whitespace folded", () => {
  assert.equal(noteLabel("A  cutpurse\n works the crowd "), "A cutpurse works the crowd");
  assert.equal(noteLabel(null), "");
});

ok("a long text is cut at a word and marked as cut", () => {
  const text = "The watch is turning out a tavern whose landlord owes the wrong people money";
  const label = noteLabel(text, 30);
  assert.ok(label.endsWith("…"), label);
  assert.ok(label.length <= 31, label);
  assert.equal(label, "The watch is turning out a…");
  assert.equal(noteLabel("abcdefghijklmnopqrstuvwxyz", 10), "abcdefghij…", "no word boundary: a hard cut");
});

/* ---------------- transientNoteData ---------------- */

ok("a marker hides behind no journal entry and carries its own clock", () => {
  const data = transientNoteData({
    x: 1050, y: 950, text: "A cutpurse works the crowd", now: 1000, turns: 6, turnSeconds: 600,
    icon: "icons/svg/hazard.svg", source: "district", table: "Old District incidents", formationId: "f1", regionUuid: "Scene.s.Region.r",
  });
  assert.equal(data.entryId, null);
  assert.equal(data.pageId, null);
  assert.equal(data.global, false);
  assert.deepEqual(data.texture, { src: "icons/svg/hazard.svg" });
  assert.equal(data.x, 1050);
  assert.equal(data.y, 950);
  assert.equal(data.text, "A cutpurse works the crowd");
  const t = data.flags[MODULE_ID][TRANSIENT_FLAG];
  assert.equal(t.rolledAt, 1000);
  assert.equal(t.expiresAt, 1000 + 6 * 600);
  assert.equal(t.source, "district");
  assert.equal(t.table, "Old District incidents");
  assert.equal(t.formationId, "f1");
  assert.equal(t.regionUuid, "Scene.s.Region.r");
  assert.equal(transientOf(data), t, "and reads back as the marker it is");
});

ok("the label is cut but the flag keeps the whole text", () => {
  const text = "x".repeat(200);
  const data = transientNoteData({ x: 0, y: 0, text, now: 0, turns: 1, turnSeconds: 600, icon: "i.svg" });
  assert.ok(data.text.length < 200);
  assert.equal(data.flags[MODULE_ID][TRANSIENT_FLAG].text, text);
});

ok("a negative lifetime expires at once, never in the past", () => {
  const data = transientNoteData({ x: 0, y: 0, text: "t", now: 500, turns: -3, turnSeconds: 600, icon: "i.svg" });
  assert.equal(data.flags[MODULE_ID][TRANSIENT_FLAG].expiresAt, 500);
});

/* ---------------- expiredNoteIds ---------------- */

ok("only markers whose time is up are collected; other notes are never touched", () => {
  const mk = (id, expiresAt) => ({ id, flags: { [MODULE_ID]: { [TRANSIENT_FLAG]: { expiresAt } } } });
  const notes = [
    mk("due", 1000), mk("later", 1001), mk("past", 5),
    { id: "plain", flags: {} },
    { id: "other", flags: { [MODULE_ID]: { something: true } } },
    { id: "unclocked", flags: { [MODULE_ID]: { [TRANSIENT_FLAG]: { expiresAt: "soon" } } } },
  ];
  assert.deepEqual(expiredNoteIds(notes, 1000), ["due", "past"]);
  assert.deepEqual(expiredNoteIds(notes, 0), []);
  assert.deepEqual(expiredNoteIds(null, 0), []);
  assert.equal(transientOf(notes[3]), null);
});

/* ---------------- promotedPlaceData ---------------- */

ok("a promoted marker is a place with the incident as its notes, inside its quarter", () => {
  const data = promotedPlaceData({ name: " The Cutpurse Corner ", text: "A <b>cutpurse</b> & \"friends\"", parentUuid: "Actor.q", img: "icons/svg/house.svg" });
  assert.equal(data.name, "The Cutpurse Corner");
  assert.equal(data.type, LOCATION_TYPE);
  assert.equal(data.img, "icons/svg/house.svg");
  assert.equal(data.system.parentUuid, "Actor.q");
  assert.equal(data.system.notes, "<p>A &lt;b&gt;cutpurse&lt;/b&gt; &amp; &quot;friends&quot;</p>", "text is text, never markup");
});

ok("an unnamed promotion is named by its label, and nothing is invented for what is absent", () => {
  const data = promotedPlaceData({ text: "A cutpurse works the crowd", parentUuid: null });
  assert.equal(data.name, "A cutpurse works the crowd");
  assert.equal(data.system.parentUuid, "");
  assert.equal("img" in data, false, "no icon named, none set — the location hook supplies the default");
  assert.equal(promotedPlaceData({ name: "X" }).system.notes, "", "no text, no paragraph");
});

/* ---------------- sceneOccupants ---------------- */

ok("a place's token stands on the map without living there", () => {
  const scene = {
    tokens: [
      { actor: { uuid: "Actor.shrine", name: "Shrine", documentName: "Actor", type: LOCATION_TYPE, isToken: false } },
      { actor: { uuid: "Actor.hero", name: "Hero", documentName: "Actor", type: "character", isToken: false } },
      { actor: { uuid: "Actor.hero", name: "Hero", documentName: "Actor", type: "character", isToken: false } },
      { actor: null },
    ],
  };
  const rows = sceneOccupants(scene);
  assert.deepEqual(rows.map((r) => r.uuid), ["Actor.hero"], "one body, once; the shrine is not a tenant");
});

console.log("\ntest-poi: all " + passed + " checks passed");
