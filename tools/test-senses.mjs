/**
 * Offline tests for the senses' printed figures: the shadowy senses' radius
 * and Night Vision's multiple are the import's (the `senses` document), and a
 * world that has imported neither gives the sense no radius and the light no
 * multiplied reach. Every figure below is invented for the test and is no
 * page's, so a figure left in source fails.
 *
 * Not registered in `tools/run-tests.mjs`; run it directly:
 *   node tools/test-senses.mjs
 */
import assert from "node:assert/strict";
import * as T from "../scripts/lib/tables.mjs";
import {
  DETECTION_MODES, LIGHTLESS_DEFAULT_TABLE, NIGHT_VISION_TABLE, SENSES_DOC, SHADOWY_SENSES_TABLE, VISION_MODES,
  canSeeInDark, lightlessDefaultRange, nightLightFactor, senseCite, senseProfile, shadowySenseRange,
} from "../scripts/lib/senses.mjs";
import { lightCell } from "../scripts/character-sheet/view-model.mjs";

let passed = 0;
const t = (name, fn) => {
  T.unregisterTable(SENSES_DOC);
  fn();
  T.unregisterTable(SENSES_DOC);
  passed++;
  console.log(`ok - ${name}`);
};

const mockActor = (extras = null, itemNames = [], statuses = []) => ({
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? extras : undefined),
  items: itemNames.map((name) => ({ type: "ability", name, getFlag: () => undefined })),
  effects: [],
  statuses: new Set(statuses),
});

/** Invented figures, registered the way an import registers them. */
const SHADOWY = 17;
const FACTOR = 3;
const DEFAULT = 23;
const importSenses = (tables = { [SHADOWY_SENSES_TABLE]: { shadowyReach: SHADOWY }, [NIGHT_VISION_TABLE]: { indoorFactor: FACTOR }, [LIGHTLESS_DEFAULT_TABLE]: { defaultReach: DEFAULT } }, priority = T.PRIORITY.WORLD, pages = "ZZ p. 9") =>
  T.registerTable({ id: SENSES_DOC, source: { pages }, tables }, { priority });

t("nothing imported: the figures read null, never a default", () => {
  assert.equal(shadowySenseRange(), null);
  assert.equal(nightLightFactor(), null);
  assert.equal(lightlessDefaultRange(), null);
  assert.equal(senseCite("shadowy"), null);
  assert.equal(senseCite("night"), null);
  assert.equal(senseCite("lightless"), null);
});

t("nothing imported: a shadowy sense is still the sense, with no radius", () => {
  const thief = mockActor(null, ["Shadowy Senses"]);
  const profile = senseProfile(thief);
  assert.equal(profile.sightRange, null, "no radius to show");
  assert.equal(profile.seesInDark, true, "the creature still sees without light");
  assert.equal(profile.visionMode, VISION_MODES.SHADOWY);
  assert.deepEqual(profile.detection, {}, "a sense with no radius adds no detection range");
  assert.equal(canSeeInDark(thief), true, "the movement rule reads the same answer");
  const blind = senseProfile(mockActor({ vision: ["blind"] }));
  assert.deepEqual([blind.sightRange, blind.seesInDark], [null, true], "a blind creature with nothing recorded navigates, by no radius");
});

t("nothing imported: a shadowy sense still goes out under deafness", () => {
  const profile = senseProfile(mockActor(null, ["Shadowy Senses"], ["deafened"]));
  assert.deepEqual([profile.sightRange, profile.seesInDark, profile.suppressed], [0, false, true]);
});

t("nothing imported: a dark sense with no recorded range has none, and one that has a range still wins", () => {
  const named = senseProfile(mockActor(null, ["Infravision"]));
  assert.deepEqual([named.sightRange, named.seesInDark, named.visionMode], [null, true, VISION_MODES.LIGHTLESS], "the sense is there with no reach");
  assert.deepEqual(named.detection, {});
  const blank = senseProfile(mockActor({ vision: ["lightless"] }));
  assert.deepEqual([blank.sightRange, blank.seesInDark], [null, true], "a stat line that records no range takes none of ours");
  const recorded = senseProfile(mockActor({ vision: ["lightless"], lightlessRange: 90 }));
  assert.equal(recorded.sightRange, 90, "a recorded range is the creature's own");
  const both = senseProfile(mockActor({ vision: ["lightless"], lightlessRange: 90, otherSenses: [{ type: "echolocation" }] }));
  assert.equal(both.sightRange, 90, "it looks through the sense it can measure");
  assert.deepEqual(both.detection, { [DETECTION_MODES.LIGHTLESS]: 90 }, "and detects only with that one");
  const bat = senseProfile(mockActor({ vision: ["blind"], otherSenses: [{ type: "echolocation", range: 41 }] }));
  assert.equal(bat.sightRange, 41, "a recorded range is the creature's own, imported or not");
});

t("nothing imported: Night Vision has no multiplied reach where light reaches it, and none where it does not", () => {
  const owl = mockActor({ vision: ["night"] });
  assert.equal(senseProfile(owl, { litBy: 15 }).sightRange, null, "light with no multiple is no figure");
  assert.equal(senseProfile(owl, { litBy: 0 }).sightRange, 0, "unlit is the dark reading whatever the multiple");
  assert.equal(senseProfile(owl).sightRange, 0);
  assert.equal(senseProfile(owl, { litBy: 15 }).visionMode, VISION_MODES.NIGHT);
  assert.equal(senseProfile(owl, { litBy: 15 }).seesInDark, false, "and it is still no dark sight");
  assert.equal(senseProfile(mockActor(), { litBy: 15 }).sightRange, 0, "nobody else reads the light");
});

t("imported: the shadowy radius is the sense's reach and detection range", () => {
  importSenses();
  assert.equal(shadowySenseRange(), SHADOWY);
  const profile = senseProfile(mockActor(null, ["Shadowy Senses"]));
  assert.equal(profile.sightRange, SHADOWY);
  assert.deepEqual(profile.detection, { [DETECTION_MODES.SHADOWY]: SHADOWY });
  assert.equal(senseProfile(mockActor({ vision: ["blind"] })).sightRange, SHADOWY, "a blind creature with nothing recorded takes it too");
  const both = senseProfile(mockActor(null, ["Shadowy Senses", "Infravision"]));
  assert.deepEqual(both.detection, { [DETECTION_MODES.SHADOWY]: SHADOWY, [DETECTION_MODES.LIGHTLESS]: DEFAULT });
  assert.equal(both.sightRange, SHADOWY > DEFAULT ? SHADOWY : DEFAULT, "the longer of the two");
});

t("imported: a dark sense whose stat line records no range takes the default reach", () => {
  importSenses();
  assert.equal(lightlessDefaultRange(), DEFAULT);
  assert.equal(senseProfile(mockActor({ vision: ["lightless"] })).sightRange, DEFAULT);
  assert.equal(senseProfile(mockActor(null, ["Infravision"])).sightRange, DEFAULT);
  assert.equal(senseProfile(mockActor({ vision: ["lightless"], lightlessRange: 90 })).sightRange, 90, "a recorded range is never replaced");
  assert.equal(senseCite("lightless"), "ZZ p. 9");
});

t("imported: Night Vision multiplies the light that reaches it, by the imported multiple", () => {
  importSenses();
  assert.equal(nightLightFactor(), FACTOR);
  const owl = mockActor({ vision: ["night"] });
  assert.equal(senseProfile(owl, { litBy: 15 }).sightRange, FACTOR * 15);
  assert.equal(senseProfile(owl, { litBy: 4 }).sightRange, FACTOR * 4);
  assert.equal(senseProfile(owl, { litBy: 0 }).sightRange, 0, "unlit collapses to the dark reading");
  assert.equal(senseProfile(mockActor({ vision: ["lightless"], lightlessRange: 60 }), { litBy: 15 }).sightRange, 60, "a dark sense keeps its own range");
});

t("imported: the page it came from names itself, and a Judge's override is no page", () => {
  importSenses();
  assert.equal(senseCite("shadowy"), "ZZ p. 9");
  assert.equal(senseCite("night"), "ZZ p. 9");
  importSenses({ [SHADOWY_SENSES_TABLE]: { shadowyReach: SHADOWY + 5 } }, T.PRIORITY.OVERRIDE, "");
  assert.equal(shadowySenseRange(), SHADOWY + 5, "the Judge's figure wins");
  assert.equal(senseCite("shadowy"), null, "and says it is the Judge's");
  assert.equal(nightLightFactor(), FACTOR, "the other table still reads the import");
  T.unregisterTable(SENSES_DOC, { priority: T.PRIORITY.OVERRIDE });
  assert.equal(shadowySenseRange(), SHADOWY, "reverting the override restores the import");
});

t("a figure that is not a positive number is not read", () => {
  for (const bad of [0, -5, "", null, undefined, "far", NaN, Infinity]) {
    importSenses({ [SHADOWY_SENSES_TABLE]: { shadowyReach: bad }, [NIGHT_VISION_TABLE]: { indoorFactor: bad }, [LIGHTLESS_DEFAULT_TABLE]: { defaultReach: bad } });
    assert.equal(shadowySenseRange(), null, `${String(bad)}: no radius`);
    assert.equal(nightLightFactor(), null, `${String(bad)}: no multiple`);
    assert.equal(lightlessDefaultRange(), null, `${String(bad)}: no default reach`);
    T.unregisterTable(SENSES_DOC);
  }
  importSenses({ [SHADOWY_SENSES_TABLE]: {} });
  assert.equal(shadowySenseRange(), null, "an empty placeholder table reads nothing");
  assert.equal(nightLightFactor(), null, "a table that is absent reads nothing");
});

t("the character sheet's light cell says a radius is not imported, with no figure", () => {
  const unread = lightCell({ ambient: "dark", sense: { kind: "shadowy", range: null } });
  assert.deepEqual([unread.key, unread.sub, unread.imported], ["shadowy", "—", false]);
  const read = lightCell({ ambient: "dark", sense: { kind: "shadowy", range: SHADOWY, cite: "ZZ p. 9" } });
  assert.deepEqual([read.sub, read.cite, read.imported], [`${SHADOWY}′`, "ZZ p. 9", undefined]);
  assert.equal(lightCell({ ambient: "dark", sense: { kind: "lightless", range: 61 } }).sub, "61′", "a lightless sense is unchanged");
});

console.log(`test-senses: ${passed} passed`);
