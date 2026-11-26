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
// The body, with the `tabs.storage` gate that wraps it.
const to = template.indexOf("{{#if tabs.gmSettings}}", from);
assert.ok(from > 0 && to > from, "the storage section was found");
const storage = hb.compile(template.slice(template.lastIndexOf("{{#if tabs.storage}}", from), to));

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
  // A non-Judge owner of the place: the context draws the lock and the take for it.
  const html = storage({ isGM: false, editable: true, holdsGoods: true, tabs: { storage: { cssClass: "" } }, groups: [{ ownerUuid: "house", name: "House", isHouse: true, houseControls: true, canTake: true, rows: [row({ canTake: true })] }] });
  assert.match(html, /data-action="houseRetrievable"/, "the place's owner holds the release lock");
  assert.match(html, /data-action="retrieveRow"/, "and takes the unreleased row");
  assert.doesNotMatch(html, /houseAttemptSpoil|attemptSpoil|fa-dice-d20/);
}, "an owner who is not a Judge holds the lock and the take");

ok(() => {
  const source = fs.readFileSync("scripts/location/apps/location-sheet.mjs", "utf8");
  // `#houseRowBlocked`, cut out of the source and run against a mock sheet.
  const head = source.indexOf("#houseRowBlocked(itemId, ownerUuid) {");
  const body = source.slice(head + "#houseRowBlocked(itemId, ownerUuid) {".length, source.indexOf("\n  }\n", head));
  const blocked = new Function("acksExtras", "MODULE_ID", `return function (itemId, ownerUuid) {${body}\n}`)({ lib: { money: { HOUSE_OWNER: "house" } } }, "acks-extras");
  const sheet = (isOwner, retrievable) => ({ actor: { isOwner, items: { get: () => ({ flags: { "acks-extras": { storage: { retrievable } } } }) } } });
  assert.equal(blocked.call(sheet(true, false), "r1", "house"), false, "the place's owner is blocked on no house row");
  assert.equal(blocked.call(sheet(false, false), "r1", "house"), true, "another seat is blocked on a locked house row");
  assert.equal(blocked.call(sheet(false, true), "r1", "house"), false, "and let through once it is marked retrievable");
  assert.equal(blocked.call(sheet(false, false), "r1", "Actor.hero"), false, "a row stamped to a character is no house row");

  const writer = source.slice(source.indexOf("static async #onHouseRetrievable"), source.indexOf("static async #onDepositHere"));
  assert.doesNotMatch(writer, /isGM/);
}, "the block on a locked house row follows the place's ownership, and the lock's writer reads no role");

ok(() => {
  const source = fs.readFileSync("scripts/location/apps/location-sheet.mjs", "utf8");
  assert.doesNotMatch(source, /houseAttemptSpoil|HouseAttemptSpoil|canAttempt/);
  assert.doesNotMatch(template, /houseAttemptSpoil|canAttempt|attemptSpoil/, "the template names no claim control");
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  for (const key of ["attemptSpoil", "spoilUnlocked", "spoilHeld"]) assert.equal(lang[`ACKS-LOCATION.storage.${key}`], undefined, key);
}, "the sheet names no claim action and the lang holds no claim string");

console.log(`test-location-spoil: ${passed} passed`);
