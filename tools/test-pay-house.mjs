/**
 * "Pay the house": the picker's pay mode and the Storage tab's control for it.
 * The pure half (`location/pay-house-logic.mjs`) builds what a payer offers and
 * turns a form's picks into the `{id, count}` list `lib/money.mjs` `giveCoin`
 * takes; the picker's row, the place sheet's button and the House figure's
 * tooltip are checked where they are drawn. The writes are
 * `test-coin-flows.mjs`'s.
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
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k) => k } };
globalThis.foundry = { utils: { getProperty: () => undefined } };

const { payOffer, paySpec, payTotalCp, payParts, coinParts } = await import("../scripts/location/pay-house-logic.mjs");
const { payRowHTML } = await import("../scripts/location/apps/stash-dialog.mjs");

const coin = (id, name, cv, qty) => ({ _id: id, type: "money", name, img: `${id}.webp`, system: { coppervalue: cv, quantity: qty } });
const rows = [
  coin("g", "Crown", 100, 52),
  coin("s", "Penny", 10, 14),
  coin("empty", "Spent", 100, 0),
  coin("token", "Token", 0, 9),
  { _id: "rope", type: "item", name: "Rope", system: { quantity: 3 } },
];
const offer = payOffer(rows);

ok(() => {
  assert.deepEqual(offer.map((o) => [o.id, o.held, o.cv]), [["g", 52, 100], ["s", 14, 10]], "coin with coin on it, worth something each, and nothing else");
  assert.deepEqual(payOffer(null), []);
  assert.deepEqual(payOffer([{ id: "x", type: "money", name: "Marked", system: { coppervalue: 1, quantity: 2 } }]).map((o) => o.id), ["x"], "a document's `id` reads as plain data's `_id`");
}, "the offer keeps coin rows only");

ok(() => {
  const spec = (...picks) => paySpec(offer, picks);
  assert.deepEqual(spec({ id: "g", checked: true, raw: "30" }), [{ id: "g", count: 30 }]);
  assert.deepEqual(spec({ id: "g", checked: false, raw: "30" }), [], "an unchecked row is not paid");
  assert.deepEqual(spec({ id: "s", checked: true, raw: "" }), [{ id: "s", count: 14 }], "a blank count is the whole stack");
  assert.deepEqual(spec({ id: "s", checked: true }), [{ id: "s", count: 14 }], "and so is none given");
  assert.deepEqual(spec({ id: "g", checked: true, raw: "99" }), [{ id: "g", count: 52 }], "a count above what is held is capped at what is held");
  assert.deepEqual(spec({ id: "g", checked: true, raw: 2.7 }), [{ id: "g", count: 2 }], "a part of a coin is not paid");
  assert.deepEqual(spec({ id: "g", checked: true, raw: "0" }, { id: "s", checked: true, raw: "-3" }, { id: "g", checked: true, raw: "many" }), [], "a count under one, or text, drops the row");
  assert.deepEqual(spec({ id: "empty", checked: true, raw: "1" }, { id: "rope", checked: true, raw: "1" }, { id: "gone", checked: true }), [], "a row the offer does not hold cannot be asked for");
  assert.deepEqual(paySpec(offer, null), []);
}, "a pick becomes a count capped at what the row holds");

ok(() => {
  const spec = [{ id: "g", count: 30 }, { id: "s", count: 5 }, { id: "gone", count: 9 }];
  assert.equal(payTotalCp(offer, spec), 3050, "each coin at the rate its row states");
  assert.equal(payTotalCp(offer, []), 0);
  assert.deepEqual(payParts(offer, spec), [{ name: "Crown", count: 30 }, { name: "Penny", count: 5 }], "the tooltip names each coin and its count");
}, "the total and its parts are read from the rows' own rates");

ok(() => {
  const house = [coin("a", "Crown", 100, 40), coin("b", "Penny", 10, 20), coin("c", "Crown", 100, 2), coin("d", "Crown", 90, 1), { type: "item", name: "Rope", system: { quantity: 4 } }, coin("e", "Spent", 100, 0)];
  assert.deepEqual(coinParts(house), [{ name: "Crown", count: 42 }, { name: "Penny", count: 20 }, { name: "Crown", count: 1 }], "one entry per kind, name and rate together");
  assert.deepEqual(coinParts(null), []);
}, "a figure of gold is told by its coins");

const { escape } = await import("../scripts/lib/util.mjs");
ok(() => {
  const html = payRowHTML({ id: "g", name: "<b>Crown</b>", img: "g.webp", toObject: () => rows[0] });
  assert.match(html, /name="pick_g"/);
  assert.match(html, /name="qty_g" min="1" max="52" placeholder="52" aria-label="ACKS-LOCATION\.storage\.quantityPrompt"/, "a count box capped at what is held, blank for the whole stack");
  assert.match(html, /acks-location-pick-qty" data-tooltip-text="ACKS-LIB\.stack\.countTip[^"]*">&times;52</, "the held figure says where it came from");
  assert.ok(html.includes(escape("<b>Crown</b>")) && !html.includes("<b>Crown"), "a name is escaped");
}, "the picker's pay row is a checkbox, the coin, what is held and a capped count box");

const hb = Handlebars.create();
hb.registerHelper("localize", (key) => key);
const template = read("templates/location/location-sheet.hbs");
const storage = (() => {
  const from = template.indexOf('data-tab="storage"');
  const to = template.indexOf("{{#if tabs.gmSettings}}", from);
  return hb.compile(template.slice(template.lastIndexOf("{{#if tabs.storage}}", from), to));
})();
const tab = (extra) => storage({ tabs: { storage: { cssClass: "" } }, groups: [], ...extra });

ok(() => {
  assert.match(tab({ canPay: true }), /data-action="payHouse"/, "the control is on the Storage tab");
  assert.doesNotMatch(tab({ canPay: false }), /payHouse/, "and is drawn only for a seat that owns a character");
  const html = tab({ canPay: true, canDeposit: true });
  assert.ok(html.indexOf('data-action="depositHere"') < html.indexOf('data-action="payHouse"'), "beside Deposit here, after it");
  assert.match(tab({ canPay: true, holdsGoods: false }), /payHouse/, "storage need not be on");
}, "the Storage tab draws Pay the house for a seat that can pay");

ok(() => {
  const group = { ownerUuid: "h", name: "House", coinGC: 42, coinTip: "Crown ×40 · Penny ×20", canTake: false, rows: [] };
  assert.match(tab({ groups: [group] }), /acks-location-coin"[^>]*data-tooltip-text="Crown ×40 · Penny ×20"/, "the figure's tooltip is its coins and counts, set at render");
}, "a group's coin figure carries a tooltip");

ok(() => {
  const sheet = read("scripts/location/apps/location-sheet.mjs");
  assert.match(sheet, /payHouse: LocationSheet\.#onPayHouse/, "the action is registered");
  const viewer = sheet.match(/const VIEWER_CONTROLS = (.*);/)[1];
  assert.match(viewer, /data-action="payHouse"/, "and is live for a seat that only observes the place");
  assert.match(sheet, /openStashDialog\(mine, this\.actor, \{ mode: "pay" \}\)/, "it opens the picker in pay mode");
}, "the sheet wires the control through the viewer's re-enabled controls");

ok(() => {
  const lang = JSON.parse(read("lang/en.json"));
  const source = read("scripts/location/apps/stash-dialog.mjs") + read("scripts/location/apps/location-sheet.mjs");
  const used = [...source.matchAll(/loc\("(storage\.(?:pay|coinPart)[\w.]*)"/g)].map((m) => `ACKS-LOCATION.${m[1]}`);
  assert.ok(used.length >= 6, "the pay mode asks for its own strings");
  for (const key of new Set(used)) assert.ok(key in lang, `${key} is in the lang file`);
  for (const reason of read("scripts/lib/money.mjs").match(/const GIVE_REFUSALS = \[(.*)\]/)[1].split(",").map((s) => s.trim().replaceAll('"', ""))) {
    assert.ok(`ACKS-LIB.money.give.${reason}` in lang, `giveCoin's ${reason} refusal has its sentence`);
  }
}, "every string the pay mode asks for exists");

console.log(`test-pay-house: ${passed} passed`);
