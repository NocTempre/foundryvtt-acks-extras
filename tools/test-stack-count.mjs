/**
 * A list row's count and its count controls are two questions with two
 * answers. The `×N` draws above one (and always for coin), whether or not the
 * surface offers a count control there (`countView`); the take-how-many field
 * draws on `offersCount`: a resting weapon or armour stack has one, a row in
 * use has none.
 *
 * Covered here: `countView`; the three storage lists' templates
 * (the location sheet's Storage tab, the character sheet's Storage tab, the
 * Storage manager) and the stash picker's row, each rendered over rows built
 * the way their sources build them; the monster Inventory's `×N`; and the
 * source pins that keep each list reading `countView` apart from `offersCount`.
 * The handlers that read the take field are the lib's `buildTransferPayload`,
 * pinned here for a stored weapon stack.
 *
 * Every name and figure is invented.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";

let passed = 0;
const ok = (fn, label) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k, d = {}) => (d.n === undefined ? k : `${k}:${d.n}`) } };
globalThis.foundry = { utils: { getProperty: () => undefined } };

const { countView } = await import("../scripts/lib/stack-count.mjs");
const { offersCount, quantityOf, buildTransferPayload } = await import("../scripts/lib/storage-logic.mjs");

const read = (path) => fs.readFileSync(path, "utf8");
const hb = Handlebars.create();
hb.registerHelper("localize", (key) => String(key));
hb.registerHelper("acksExtrasVal", (value, fallback) => value ?? fallback);

/** A plain item as the lists read one. */
const plain = (id, type, quantity, over = {}) => ({ _id: id, name: `Item ${id}`, img: "x.png", type, system: { quantity, ...(type === "weapon" || type === "armor" ? { equipped: false } : {}), ...over.system }, flags: over.flags ?? {} });

const rest3 = plain("w3", "weapon", 3);
const armour3 = plain("a3", "armor", 3);
const drawn1 = plain("w1", "weapon", 1, { system: { equipped: true } });
const drawn3 = plain("d3", "weapon", 3, { system: { equipped: true } });
const gear1 = plain("g1", "item", 1);
const gear5 = plain("g5", "item", 5);
const purse0 = plain("c0", "money", 0);
const ITEMS = [rest3, armour3, drawn1, drawn3, gear1, gear5, purse0];

/** The row context the lists build: the count on `stack`, the take field on `stackable`. */
const rowOf = (item) => {
  const { stack, countTip } = countView(item);
  return { id: item._id, name: item.name, img: item.img, quantity: quantityOf(item)?.value ?? null, stack, countTip, stackable: offersCount(item), checked: false, take: "", canTake: true };
};
const rows = ITEMS.map(rowOf);

/** The `<li>` of one row, by item id. */
const liOf = (html, id) => html.split("</li>").find((chunk) => chunk.includes(`data-item-id="${id}"`)) ?? "";
const hasCount = (li) => /acks-location-row-qty/.test(li);
const hasTake = (li) => /acks-location-row-take/.test(li);

ok(() => {
  assert.deepEqual(countView(rest3), { qty: 3, stack: true, countTip: "ACKS-LIB.stack.countTip:3" });
  assert.deepEqual(countView(drawn1), { qty: 1, stack: false, countTip: "" }, "one reads no count");
  assert.deepEqual(countView(gear1), { qty: 1, stack: false, countTip: "" }, "one of gear reads none either");
  assert.equal(countView(drawn3).stack, true, "a count is shown on a row in use that holds more than one");
  assert.deepEqual(countView(purse0), { qty: 0, stack: true, countTip: "ACKS-LIB.stack.countTip:0" }, "coin always shows, an empty purse as empty");
  assert.deepEqual(countView({ type: "weapon", system: {} }), { qty: null, stack: false, countTip: "" }, "no quantity, no count");
}, "countView draws a count above one and for coin, and names the Quantity as its source");

ok(() => {
  assert.equal(offersCount(rest3), true);
  assert.equal(offersCount(armour3), true);
  assert.equal(offersCount(drawn1), false);
  assert.equal(offersCount(drawn3), false, "a row in use is offered none, whatever its count");
  assert.equal(offersCount(gear5), true);
}, "the take field's gate is offersCount: a resting stack has it, a row in use has none");

/** Assert one list's rows, each by what its template drew. */
const checkList = (html, label) => {
  const stack = liOf(html, "w3");
  assert.ok(hasCount(stack) && /&times;3/.test(stack), `${label}: the weapon stack of three shows ×3`);
  assert.match(stack, /data-tooltip-text="ACKS-LIB\.stack\.countTip:3"/, `${label}: with the Quantity's tooltip`);
  assert.ok(hasTake(stack), `${label}: a resting weapon stack is offered the take field`);
  assert.ok(hasTake(liOf(html, "a3")) && hasCount(liOf(html, "a3")), `${label}: and a resting stack of armour`);
  const drawnOne = liOf(html, "w1");
  assert.ok(!hasCount(drawnOne) && !hasTake(drawnOne), `${label}: a drawn weapon of one shows neither`);
  const drawnThree = liOf(html, "d3");
  assert.ok(hasCount(drawnThree) && !hasTake(drawnThree), `${label}: a drawn stack shows its count and no take field`);
  const one = liOf(html, "g1");
  assert.ok(!hasCount(one) && hasTake(one), `${label}: gear of one shows no ×1 and keeps its take field`);
  assert.ok(hasCount(liOf(html, "g5")) && hasTake(liOf(html, "g5")), `${label}: gear of five shows both, as before`);
  assert.ok(hasCount(liOf(html, "c0")), `${label}: an empty purse still reads as empty`);
  assert.match(stack, /aria-label="ACKS-LOCATION\.storage\.quantityPrompt"/, `${label}: the take field is named`);
};

ok(() => {
  const template = read("templates/location/location-sheet.hbs");
  const from = template.indexOf('data-tab="storage"');
  const to = template.indexOf("{{#if tabs.gmSettings}}", from);
  const storage = hb.compile(template.slice(template.lastIndexOf("{{#if tabs.storage}}", from), to));
  const html = storage({ isGM: true, holdsGoods: true, tabs: { storage: { cssClass: "" } }, groups: [{ ownerUuid: "o", name: "Owner", canTake: true, rows }] });
  checkList(html, "location sheet");
}, "the location sheet's Storage tab splits the count from the take field");

ok(() => {
  const html = hb.compile(read("templates/location/storage-tab.hbs"))({ hasGoods: true, places: [{ uuid: "p", name: "Place", canReach: true, rows }] });
  checkList(html, "character Storage tab");
}, "the character sheet's Storage tab splits the count from the take field");

ok(() => {
  const html = hb.compile(read("templates/location/storage-manager.hbs"))({ place: { uuid: "p", name: "Place" }, groups: [{ ownerUuid: "o", name: "Owner", rows }], places: [], targets: [], owners: [] });
  checkList(html, "storage manager");
}, "the Storage manager splits the count from the take field");

const { rowHTML } = await import("../scripts/location/apps/stash-dialog.mjs");
globalThis.acksExtras = { lib: { storage: { offersCount, quantityOf }, places: { isContainerItem: () => false }, itemModel: { isGoods: () => true } } };
const pick = (item) => rowHTML({ id: item._id, name: item.name, img: item.img, toObject: () => item });

ok(() => {
  const stack = pick(rest3);
  assert.match(stack, /acks-location-pick-qty" data-tooltip-text="ACKS-LIB\.stack\.countTip:3">&times;3</);
  assert.match(stack, /name="qty_w3" min="1" max="3" placeholder="3" aria-label="ACKS-LOCATION\.storage\.quantityPrompt"/, "a resting weapon stack takes how many to leave");
  const drawn = pick(drawn1);
  assert.doesNotMatch(drawn, /acks-location-pick-qty|name="qty_/, "a drawn weapon of one shows neither");
  const drawnStack = pick(drawn3);
  assert.match(drawnStack, /acks-location-pick-qty/);
  assert.doesNotMatch(drawnStack, /name="qty_/, "a row in use is offered no quantity box");
  assert.doesNotMatch(pick(gear1), /acks-location-pick-qty/, "gear of one shows no ×1");
  assert.match(pick(gear1), /name="qty_g1"/);
  assert.match(pick(purse0), /acks-location-pick-qty/, "an empty purse shows");
}, "the stash picker draws the count and the quantity box apart");

ok(() => {
  const stored = [rest3, gear5];
  const plan = buildTransferPayload(stored, [{ id: "w3", quantity: 2 }], { newId: () => "new1" });
  assert.equal(plan.creates.length, 1);
  assert.equal(quantityOf(plan.creates[0]).value, 2, "two come back");
  assert.equal(plan.creates[0].system.equipped, false);
  assert.deepEqual(plan.sourceUpdates, [{ _id: "w3", "system.quantity": 1 }], "one stays stored");
  assert.deepEqual(plan.sourceDeletes, []);
}, "two of a stored weapon stack of three come back and one stays, by the lib's transfer plan");

ok(() => {
  const template = hb.compile(read("templates/monsters/tab-inventory.hbs"));
  const carried = [plain("m3", "item", 3), plain("m1", "item", 1), plain("m0", "item", 0)];
  const html = template({ owner: true, owned: {}, encumbrance: {}, carriedItems: carried, carriedCounts: Object.fromEntries(carried.map((i) => [i._id, countView(i)])) });
  const li = (id) => html.split("</li>").find((chunk) => chunk.includes(`data-item-id="${id}"`)) ?? "";
  assert.match(li("m3"), /gp · <span data-tooltip-text="ACKS-LIB\.stack\.countTip:3">×3<\/span><\/div>/);
  assert.doesNotMatch(li("m1"), /×/, "one prints no ×1");
  assert.doesNotMatch(li("m0"), /×/, "nor does none");
  assert.match(li("m1"), /gp<\/div>/);
}, "the monster Inventory prints ×N above one, in its meta line, with the Quantity's tooltip");

ok(() => {
  const sheet = read("scripts/monsters/monster-sheet.mjs");
  assert.match(sheet, /context\.carriedCounts = Object\.fromEntries\(context\.carriedItems\.map\(\(i\) => \[i\._id, countView\(i\)\]\)\)/);
}, "the monster sheet builds each carried row's count view from countView");

ok(() => {
  for (const file of ["scripts/location/apps/location-sheet.mjs", "scripts/location/apps/storage-tab.mjs", "scripts/location/apps/storage-manager.mjs"]) {
    const source = read(file);
    assert.match(source, /countView\(item\)/, `${file} reads the count from countView`);
    assert.match(source, /stackable: api\.offersCount\(item\)/, `${file} keeps the take field on offersCount`);
    assert.match(source, /\bstack,\s*countTip/, `${file} hands the template the count's own fields`);
  }
  assert.match(read("scripts/location/apps/stash-dialog.mjs"), /countView\(plain\)/);
}, "each list reads the count from countView and the take field from offersCount, apart");

console.log(`test-stack-count: ${passed} passed`);
