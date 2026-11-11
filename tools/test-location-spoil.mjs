/**
 * A spoil in a location's house pile has no claim control. The Storage tab's
 * template renders a spoil row for a player's context and for the Judge's
 * with a lock for the Judge and a take button only once released, never a
 * throw button; the sheet's source names no claim action. Plain Handlebars
 * over the storage section, with an invented row.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";

let passed = 0;
const ok = (fn, label) => { fn(); passed++; console.log(`  ok  ${label}`); };

const hb = Handlebars.create();
hb.registerHelper("localize", (key) => String(key));
const template = fs.readFileSync("templates/location/location-sheet.hbs", "utf8");
const from = template.indexOf('data-tab="storage"');
const to = template.indexOf("<section", from);
assert.ok(from > 0 && to > from, "the storage section was found");
const storage = hb.compile(template.slice(template.lastIndexOf("<section", from), to));

const row = (over) => ({ id: "r1", name: "Spoil row", img: "x.png", type: "item", quantity: 1, stackable: false, spoil: true, retrievable: false, canTake: false, ...over });
const render = (isGM, rowOver) =>
  storage({ isGM, holdsGoods: true, tabs: { storage: { cssClass: "" } }, groups: [{ ownerUuid: "house", name: "House", isHouse: true, houseControls: isGM, canTake: isGM, rows: [row(rowOver)] }] });

ok(() => {
  const html = render(false, {});
  assert.match(html, /fa-bone/, "the spoil row is drawn");
  assert.doesNotMatch(html, /houseAttemptSpoil|attemptSpoil|fa-dice-d20/);
  assert.doesNotMatch(html, /data-action="retrieveRow"/, "an unreleased spoil offers a player no take");
}, "a player's render of an unreleased spoil holds no claim button");

ok(() => {
  const html = render(false, { retrievable: true, canTake: true });
  assert.match(html, /data-action="retrieveRow"/);
  assert.doesNotMatch(html, /houseAttemptSpoil|attemptSpoil|fa-dice-d20/);
}, "a released spoil offers the take and no claim button");

ok(() => {
  const html = render(true, {});
  assert.match(html, /data-action="houseRetrievable"/, "the Judge holds the release lock");
  assert.doesNotMatch(html, /houseAttemptSpoil|attemptSpoil|fa-dice-d20/);
}, "the Judge's render holds the lock and no claim button");

ok(() => {
  const source = fs.readFileSync("scripts/location/apps/location-sheet.mjs", "utf8");
  assert.doesNotMatch(source, /houseAttemptSpoil|HouseAttemptSpoil|canAttempt/);
  assert.doesNotMatch(template, /houseAttemptSpoil|canAttempt|attemptSpoil/, "the template names no claim control");
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  for (const key of ["attemptSpoil", "spoilUnlocked", "spoilHeld"]) assert.equal(lang[`ACKS-LOCATION.storage.${key}`], undefined, key);
}, "the sheet names no claim action and the lang holds no claim string");

console.log(`test-location-spoil: ${passed} passed`);
