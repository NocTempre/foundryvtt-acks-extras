/**
 * An item the carrier runs, on its row of a sheet (`item-run-row.mjs` and its
 * Foundry half `item-run-row-view.mjs`), offline: the state tag and the line by
 * state (a toggle lowered and raised, a used-up kind with stock and spent, an
 * always-on item, an always-on engaged reach with and without its ring), the
 * presses each state offers and to whom (an owner by Foundry's own test, never a
 * role), the tooltips' three shapes (read from an import, computed, the page
 * alone), and the two presses' door: Raise, Lower and Use go through `Item#use`,
 * and Card scrolls to the activation's card. Foundry-free with stand-ins; every
 * name and figure below is invented.
 *
 * Usage: node tools/test-item-run-row.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = { utils: { randomID: () => "rid", escapeHTML: (s) => String(s) }, data: { operators: { ForcedDeletion } } };
const messages = [];
messages.get = (id) => messages.find((m) => m.id === id);
const me = { id: "me", isGM: false };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], messages, time: { worldTime: 0 }, get user() { return me; } };
const notes = [];
globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text]), error: (text) => notes.push(["error", text]) } };

const { hasRunRow, itemRunRowModel, parseRunLeft } = await import("../scripts/lib/item-run-row.mjs");
const run = await import("../scripts/lib/item-run.mjs");
const view = await import("../scripts/lib/item-run-row-view.mjs");
const { engagedActivationId } = await import("../scripts/lib/aura-reach-logic.mjs");
const { engagedStateOf } = await import("../scripts/lib/aura-reach.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/** The localizer a test hands in: the key and its data, so a line is checked by what it was built from. */
const say = (key, data) => (data ? `${key}${JSON.stringify(data)}` : key);
const reach = { engaged: false, feet: 30, tip: "Gear: 30′ (PG 1)", cite: "PG 1" };
const keys = (model) => model.presses.map((p) => p.key);

await t("a toggle lowered reads its tag, its use and its reach with where the figure came from, and offers Raise to an owner", () => {
  const row = itemRunRowModel({ kind: "toggle", runnable: true, owner: true, reach, use: "Raised and lowered", say });
  assert.equal(row.state, "lowered");
  assert.equal(row.tag.label, "row.tag.lowered");
  assert.equal(row.tag.variant, "ghost");
  assert.equal(row.use, "Raised and lowered");
  assert.deepEqual(row.reach, { engaged: false, label: "row.reaches", feet: 30, blank: false, tip: "Gear: 30′ (PG 1)", cite: "PG 1" });
  assert.deepEqual(keys(row), ["raise"]);
  assert.equal(row.presses[0].action, "itemRunPress");
  assert.equal(row.count, null);
});

await t("a lowered toggle whose reach was never imported shows the page alone in the figure's place", () => {
  const blank = itemRunRowModel({ kind: "toggle", runnable: true, owner: true, reach: { engaged: false, feet: null, tip: "PG 1", cite: "PG 1" }, say });
  assert.equal(blank.reach.blank, true);
  assert.equal(blank.reach.feet, null);
  assert.equal(blank.reach.tip, "PG 1");
});

await t("a toggle raised reads Raised with no round, counts the bodies the card lists with the parts named, and offers Card and Lower", () => {
  const row = itemRunRowModel({ kind: "toggle", active: true, runnable: true, owner: true, reach, card: { inRange: 3 }, say });
  assert.equal(row.state, "raised");
  assert.equal(row.tag.variant, "solid");
  assert.equal(row.tag.label, "row.tag.raised");
  assert.equal(row.count.n, 3);
  assert.equal(row.count.label, 'row.inRange{"n":3}');
  assert.equal(row.count.tip, 'row.inRangeTipOf{"n":3,"feet":30}');
  assert.deepEqual(keys(row), ["card", "lower"]);
  assert.equal(row.presses[0].action, "itemRunCard");
  assert.equal(row.presses[1].action, "itemRunPress");
});

await t("a raised toggle whose card is not readable leaves the count out and still offers Card and Lower", () => {
  const gone = itemRunRowModel({ kind: "toggle", active: true, runnable: true, owner: true, reach, card: { inRange: null }, say });
  assert.equal(gone.count, null);
  assert.deepEqual(keys(gone), ["card", "lower"]);
  const none = itemRunRowModel({ kind: "toggle", active: true, runnable: true, owner: true, reach: { ...reach, feet: null }, card: { inRange: 0 }, say });
  assert.equal(none.count.n, 0, "none in range is a count, not a gap");
  assert.equal(none.count.tip, 'row.inRangeTip{"n":0}', "a blank reach leaves the radius out of the tooltip");
});

await t("a used-up kind offers Use (a fuse, Light) while it has stock, and once spent a press that is off and says so", () => {
  for (const kind of ["once", "fuse", "consume"]) {
    const ready = itemRunRowModel({ kind, runnable: true, owner: true, reach, say });
    assert.equal(ready.state, "ready");
    assert.deepEqual(keys(ready), [kind === "fuse" ? "light" : "use"]);
    assert.equal(ready.presses[0].disabled, false);
    const spent = itemRunRowModel({ kind, stocked: false, runnable: true, owner: true, reach, say });
    assert.equal(spent.state, "spent");
    assert.equal(spent.tag.label, "row.tag.spent");
    assert.deepEqual(keys(spent), ["spent"]);
    assert.equal(spent.presses[0].disabled, true);
    assert.equal(spent.presses[0].label, "row.press.spent", "the off press carries its own word");
  }
});

await t("a fuse's press reads Light: the runner's own word, its own tooltip, the fire glyph and the primary variant, through the same action", () => {
  const row = itemRunRowModel({ kind: "fuse", runnable: true, owner: true, reach, say });
  const [light] = row.presses;
  assert.equal(light.key, "light");
  assert.equal(light.label, "press.light");
  assert.equal(light.tip, "row.press.lightTip");
  assert.equal(light.icon, "fa-solid fa-fire");
  assert.equal(light.variant, "primary");
  assert.equal(light.action, "itemRunPress");
  assert.equal(itemRunRowModel({ kind: "once", runnable: true, owner: true, reach, say }).presses[0].label, "row.press.use", "a once item keeps Use");
});

await t("a lit fuse reads state lit with a solid tag naming its rounds and a tip, and offers Light only where the stack holds a spare", () => {
  const spare = itemRunRowModel({ kind: "fuse", lit: { n: 3 }, spare: true, runnable: true, owner: true, reach, say });
  assert.equal(spare.state, "lit");
  assert.equal(spare.tag.label, 'strip.tag.lit{"n":3}');
  assert.equal(spare.tag.tip, 'strip.tagTip.lit{"n":3}');
  assert.equal(spare.tag.variant, "solid");
  assert.deepEqual(keys(spare), ["light"]);
  const none = itemRunRowModel({ kind: "fuse", lit: { n: 3 }, spare: false, stocked: false, runnable: true, owner: true, reach, say });
  assert.equal(none.state, "lit", "the tag carries the state where no press is left");
  assert.deepEqual(none.presses, []);
  const seen = itemRunRowModel({ kind: "fuse", lit: { n: 1 }, spare: false, runnable: true, owner: false, reach, say });
  assert.equal(seen.state, "lit", "a seat that is no owner reads the tag");
  assert.equal(seen.tag.tip, 'strip.tagTip.lit{"n":1}');
  assert.equal(itemRunRowModel({ kind: "fuse", runnable: true, owner: true, reach, say }).tag.tip, undefined, "an unlit tag carries no tip");
  assert.equal(itemRunRowModel({ kind: "once", lit: { n: 2 }, runnable: true, owner: true, reach, say }).state, "ready", "only a fuse reads lit");
});

await t("a consume item an owner holds carries its swigs left, with the tooltip of where the figure came from, and no other kind carries one", () => {
  const model = (left, extra = {}) => itemRunRowModel({ kind: "consume", runnable: true, owner: true, reach, left, say, ...extra });
  const rolled = model({ value: 4, from: { by: "roll", formula: "1d6", total: 4 }, cite: "PG 9" }).left;
  assert.equal(rolled.value, 4);
  assert.equal(rolled.label, "row.left");
  assert.equal(rolled.tip, 'row.leftTipRolled{"total":4,"formula":"1d6","cite":"PG 9"}');
  assert.equal(model({ value: 2, from: { by: "hand" }, cite: "PG 9" }).left.tip, "row.leftTipHand");
  const blank = model({ value: null, from: null, cite: "PG 9" }).left;
  assert.equal(blank.value, null);
  assert.equal(blank.tip, 'row.leftTipBlank{"cite":"PG 9"}');
  assert.equal(model(null).left.value, null, "a row read with no figures is blank");
  assert.equal(model({ value: null, from: { by: "hand" }, cite: "" }).left.tip, 'row.leftTipBlank{"cite":""}', "a hand tip needs a figure typed");
  assert.equal(itemRunRowModel({ kind: "consume", runnable: true, owner: false, reach, say }).left, null, "a seat that is no owner has no box");
  for (const kind of ["once", "fuse", "toggle", ""]) assert.equal(itemRunRowModel({ kind, runnable: true, owner: true, reach, say }).left, null);
});

await t("a blank page reference drops the empty parentheses from a swig tooltip", () => {
  const real = (key, data) => ({ "row.leftTipRolled": `Rolled ${data?.total} on ${data?.formula}; each swig takes one. (${data?.cite})`, "row.leftTipBlank": `Rolled from dice, or typed here. (${data?.cite})`, "row.left": "Swigs left" })[key] ?? key;
  const left = (from, cite) => itemRunRowModel({ kind: "consume", runnable: true, owner: true, left: { value: 3, from, cite }, say: real }).left.tip;
  assert.equal(left({ by: "roll", formula: "1d6", total: 3 }, ""), "Rolled 3 on 1d6; each swig takes one.");
  assert.equal(left({ by: "roll", formula: "1d6", total: 3 }, "PG 9"), "Rolled 3 on 1d6; each swig takes one. (PG 9)");
  assert.equal(left(null, ""), "Rolled from dice, or typed here.");
});

await t("parseRunLeft: blank is no count, a whole number from none up is that count, anything else is refused", () => {
  assert.deepEqual(parseRunLeft(""), { ok: true, left: null });
  assert.deepEqual(parseRunLeft("   "), { ok: true, left: null });
  assert.deepEqual(parseRunLeft(null), { ok: true, left: null });
  assert.deepEqual(parseRunLeft("0"), { ok: true, left: 0 });
  assert.deepEqual(parseRunLeft(" 7 "), { ok: true, left: 7 });
  assert.deepEqual(parseRunLeft(3), { ok: true, left: 3 });
  for (const bad of ["-1", "2.5", "1e2", "abc", "3 swigs", -2, 1.5, NaN, {}]) assert.deepEqual(parseRunLeft(bad), { ok: false }, String(bad));
});

await t("a kind no runner takes offers no press: it would reach the system's own card", () => {
  const row = itemRunRowModel({ kind: "fuse", runnable: false, owner: true, reach, say });
  assert.deepEqual(row.presses, []);
  assert.equal(row.state, "ready");
});

await t("a seat that does not own the item reads the state tag and nothing else", () => {
  for (const args of [{ kind: "toggle", active: true, card: { inRange: 2 } }, { kind: "toggle" }, { kind: "once" }, { kind: "" }]) {
    const row = itemRunRowModel({ ...args, runnable: true, owner: false, reach, use: "words", say });
    assert.deepEqual(row.presses, []);
    assert.equal(row.use, "");
    assert.equal(row.reach, null);
    assert.equal(row.count, null);
    assert.equal(row.ring, null);
    assert.equal(row.nothing, "");
    assert.ok(row.tag.label);
  }
});

await t("an item with no activation is always on with nothing to press", () => {
  const row = itemRunRowModel({ kind: "", runnable: true, owner: true, reach, say });
  assert.equal(row.state, "always");
  assert.equal(row.tag.label, "row.tag.always");
  assert.equal(row.nothing, "row.nothing");
  assert.deepEqual(row.presses, []);
  assert.equal(row.ring, null, "a distance reach has no ring to read");
});

await t("an always-on engaged reach names the adjacent square with its shipped page and tooltip, and reads whether its ring stands", () => {
  const engaged = { engaged: true, feet: null, tip: "", cite: "" };
  const standing = itemRunRowModel({ kind: "", owner: true, reach: engaged, engaged: { stands: true, count: 2 }, say });
  assert.deepEqual(standing.reach, { engaged: true, label: "card.engagedNote", tip: "card.engagedNoteTip" });
  assert.deepEqual(standing.ring, { stands: true, n: 2, label: 'row.ringStands{"n":2}', tip: 'row.ringStandsTip{"n":2}' });
  const idle = itemRunRowModel({ kind: "", owner: true, reach: engaged, engaged: { stands: false, count: 0 }, say });
  assert.deepEqual(idle.ring, { stands: false, label: "row.ringNone", tip: "row.ringNoneTip" });
  assert.deepEqual(idle.presses, []);
});

await t("an item has a row where it carries an activation, or no activation and a row that names a reach", () => {
  assert.equal(hasRunRow({ run: { activation: { kind: "toggle" } }, reaches: [] }), true);
  assert.equal(hasRunRow({ run: null, reaches: [{}] }), true);
  assert.equal(hasRunRow({ run: null, reaches: [] }), false, "a plain item is no run item");
});

/* -------------------------------------------- */
/*  The Foundry half                             */
/* -------------------------------------------- */

const owned = { value: true };
const uses = [];
const itemOf = (flag, extra = {}) => ({
  uuid: "I.1",
  name: "Gear",
  type: "item",
  get isOwner() { return owned.value; },
  actor: null,
  system: {},
  flags: { "acks-extras": { itemRun: flag, cookbook: { cite: "PG 1" } } },
  use: async () => void uses.push("use"),
  ...extra,
});
const rows = [{ key: "r", reach: { pulse: "standing", radius: { value: "30" }, filter: {} } }];
const items = new Map();
globalThis.fromUuidSync = (uuid) => items.get(uuid) ?? null;
const put = (item) => (items.set(item.uuid, item), item);
run.registerActivationRunner("toggle", async () => ({ ok: true }));
run.registerActivationRunner("once", async () => ({ ok: true }));

await t("the row of a lowered toggle is read from the item: its figure, its page, and the press for its owner", () => {
  const row = view.itemRunRowFor(put(itemOf({ activation: { kind: "toggle", state: { active: false } }, rows })));
  assert.equal(row.state, "lowered");
  assert.equal(row.reach.feet, 30);
  assert.equal(row.reach.cite, "PG 1");
  assert.ok(row.reach.tip.includes("30′") && row.reach.tip.includes("PG 1"), "read from the row and the item's page");
  assert.deepEqual(row.presses.map((p) => [p.key, p.itemUuid]), [["raise", "I.1"]]);
  assert.equal(row.use, "Raised and lowered");
});

await t("a reach with no figure imported reads blank and the tooltip is the item's page alone", () => {
  const blank = [{ key: "r", reach: { pulse: "standing", radius: { doc: "d", table: "t", row: "r", figure: "f" }, filter: {} } }];
  const row = view.itemRunRowFor(put(itemOf({ activation: { kind: "toggle", state: { active: false } }, rows: blank })));
  assert.equal(row.reach.feet, null);
  assert.equal(row.reach.blank, true);
  assert.equal(row.reach.tip, "PG 1");
});

await t("a raised toggle counts the bodies its card lists in reach for this seat, by Foundry's ownership of each token", () => {
  const mine = { testUserPermission: () => true };
  const theirs = { testUserPermission: () => false };
  items.set("T.mine", mine);
  items.set("T.theirs", theirs);
  messages.length = 0;
  messages.push({ id: "M1", flags: { "acks-extras": { itemRunCard: { activationId: "act", lowered: false, subjects: { a: { uuid: "T.mine", state: "in" }, b: { uuid: "T.theirs", state: "in" }, c: { uuid: "T.mine", state: "out" } } } } } });
  const item = put(itemOf({ activation: { kind: "toggle", state: { active: true, activationId: "act", regionId: "" } }, rows }));
  const row = view.itemRunRowFor(item);
  assert.equal(row.state, "raised");
  assert.equal(row.count.n, 1, "only a body in reach whose token the seat owns; the card shows this seat no other");
  assert.deepEqual(row.presses.map((p) => p.key), ["card", "lower"]);
  messages.length = 0;
  assert.equal(view.itemRunRowFor(item).count, null, "no card, no count");
});

await t("a spent item reads through the one used-up test and its press is off", () => {
  const stack = (n) => ({ system: { quantity: n } });
  const used = { activation: { kind: "consume", uses: { value: "1" } }, rows: [{ key: "r", reach: { pulse: "action", radius: { value: "10" }, filter: {} } }] };
  run.registerActivationRunner("consume", async () => ({ ok: true }));
  const left = view.itemRunRowFor(put(itemOf(used, stack(2))));
  assert.deepEqual(left.presses.map((p) => [p.key, p.disabled]), [["use", false]]);
  const none = view.itemRunRowFor(put(itemOf(used, stack(0))));
  assert.equal(none.state, "spent");
  assert.deepEqual(none.presses.map((p) => [p.key, p.disabled]), [["spent", true]]);
  run.registerActivationRunner("consume", null);
});

await t("a once-only item the editor's tick marks (an empty `uses`) reads Ready with a count and Used up at none, its press off", () => {
  const stack = (n) => ({ system: { quantity: n } });
  const ticked = { activation: { kind: "once", uses: {} }, rows: [{ key: "r", reach: { pulse: "action", radius: { value: "10" }, filter: {} } }] };
  run.registerActivationRunner("once", async () => ({ ok: true }));
  assert.deepEqual(view.itemRunRowFor(put(itemOf(ticked, stack(2)))).presses.map((p) => [p.key, p.disabled]), [["use", false]]);
  const none = view.itemRunRowFor(put(itemOf(ticked, stack(0))));
  assert.equal(none.state, "spent");
  assert.deepEqual(none.presses.map((p) => [p.key, p.disabled]), [["spent", true]]);
  const unticked = view.itemRunRowFor(put(itemOf({ ...ticked, activation: { kind: "once" } }, stack(0))));
  assert.notEqual(unticked.state, "spent", "unticked, a count of none leaves it usable");
  run.registerActivationRunner("once", null);
});

await t("a non-owner's row has the tag alone, and an item with nothing to draw has no row", () => {
  owned.value = false;
  const row = view.itemRunRowFor(put(itemOf({ activation: { kind: "toggle", state: { active: false } }, rows })));
  owned.value = true;
  assert.deepEqual(row.presses, []);
  assert.equal(row.reach, null);
  assert.equal(view.itemRunRowFor(put(itemOf(undefined))), null, "a plain item");
  assert.equal(view.itemRunRowFor(null), null);
  const always = view.itemRunRowFor(put(itemOf({ rows })));
  assert.equal(always.state, "always");
});

await t("an always-on engaged row reads its ring through the bearer's token: none before a fight, then the bodies it engages", () => {
  const engagedRows = [{ key: "e", reach: { pulse: "turnStart+enter", engaged: true, filter: {} } }];
  const item = put(itemOf({ rows: engagedRows }));
  const body = (id) => ({ id, actor: { id, statuses: new Set() } });
  const bearer = { ...body("bear"), attachments: { regions: [] } };
  item.actor = { isToken: true, token: bearer };
  assert.deepEqual(engagedStateOf(bearer, item, engagedRows[0]), { stands: false, count: 0 });
  assert.equal(view.itemRunRowFor(item).ring.stands, false);
  const aura = { type: "acks-extras.aura", disabled: false, system: { sourceUuid: "I.1", bearerUuid: "A", activationId: engagedActivationId("x"), rowKey: "e" } };
  const region = { behaviors: [aura], tokens: new Set([bearer, body("a"), body("b")]) };
  bearer.attachments.regions.push(region);
  const state = engagedStateOf(bearer, item, engagedRows[0]);
  assert.equal(state.stands, true);
  assert.equal(state.count, 2, "the bearer is never counted among the bodies it engages");
  const other = { ...aura, system: { ...aura.system, rowKey: "zz" } };
  region.behaviors = [other];
  assert.equal(engagedStateOf(bearer, item, engagedRows[0]).stands, false, "another row's ring is not this row's");
  region.behaviors = [aura];
  region.tokens.add({ id: "hid", actor: { id: "hid", statuses: new Set(["hidden"]) } });
  assert.equal(engagedStateOf(bearer, item, engagedRows[0]).count, 2, "a hidden body is not engaged");
});

/** A press button as a sheet hands it to the action: its dataset and aria state. */
const button = (uuid, attrs = {}) => ({ dataset: { itemUuid: uuid }, isConnected: true, getAttribute: (name) => attrs[name] ?? null });

await t("Raise, Lower and Use go through Item#use, once per press, and only for an owner", async () => {
  uses.length = 0;
  notes.length = 0;
  put(itemOf({ activation: { kind: "toggle", state: { active: false } }, rows }));
  await view.pressItemRun(button("I.1"));
  assert.deepEqual(uses, ["use"]);
  owned.value = false;
  await view.pressItemRun(button("I.1"));
  owned.value = true;
  assert.deepEqual(uses, ["use"], "a seat that does not own the item reaches nothing");
  assert.equal(notes.at(-1)[1], "ACKS-LIB.itemRun.refused.notOwner");
  await view.pressItemRun(button("I.1", { "aria-disabled": "true" }));
  assert.deepEqual(uses, ["use"], "a press that is off does nothing");
  await view.pressItemRun(button("I.missing"));
  assert.equal(notes.at(-1)[1], "ACKS-LIB.itemRun.refused.gone");
  const held = button("I.1");
  held.dataset.busy = "1";
  await view.pressItemRun(held);
  assert.deepEqual(uses, ["use"], "a second press while the first runs is one press");
});

await t("Card shows the activation's card in the chat log, and says so where it is gone", () => {
  const scrolled = [];
  const lines = [];
  globalThis.ui.sidebar = { changeTab: (...args) => lines.push(args) };
  globalThis.ui.chat = { element: { querySelector: (selector) => (selector.includes('"M1"') ? { scrollIntoView: (o) => scrolled.push(o) } : null) } };
  messages.length = 0;
  messages.push({ id: "M1", flags: { "acks-extras": { itemRunCard: { activationId: "act", subjects: {} } } } });
  put(itemOf({ activation: { kind: "toggle", state: { active: true, activationId: "act", regionId: "" } }, rows }));
  assert.equal(view.openItemRunCard(button("I.1")).id, "M1");
  assert.deepEqual(lines, [["chat", "primary"]]);
  assert.equal(scrolled.length, 1);
  notes.length = 0;
  messages.length = 0;
  assert.equal(view.openItemRunCard(button("I.1")), null);
  assert.equal(notes.at(-1)[1], "ACKS-LIB.itemRun.refused.noCard");
  owned.value = false;
  assert.equal(view.openItemRunCard(button("I.1")), null, "Card is the owner's");
  owned.value = true;
});

await t("a raised card's making, change or deletion re-renders the open sheet of the actor that carries its item, and no other", async () => {
  const { installItemRunStrip } = await import("../scripts/lib/item-run-strip.mjs");
  const hooked = {};
  const prior = globalThis.Hooks.on;
  globalThis.Hooks.on = (name, fn) => { hooked[name] = fn; };
  installItemRunStrip();
  globalThis.Hooks.on = prior;
  const actor = { documentName: "Actor", isToken: false, getActiveTokens: () => [] };
  const stranger = { documentName: "Actor", isToken: false, getActiveTokens: () => [] };
  let renders = 0;
  const sheet = (document) => ({ rendered: true, document, render() { renders += 1; } });
  globalThis.foundry.applications = { instances: new Map([["a", sheet(actor)], ["b", sheet(stranger)]]) };
  put(itemOf({ rows }, { actor }));
  const message = { flags: { "acks-extras": { itemRunCard: { itemUuid: "I.1", subjects: {} } } } };
  for (const name of ["createChatMessage", "updateChatMessage", "deleteChatMessage"]) hooked[name](message);
  assert.equal(renders, 3, "one render of the carrier's sheet for each");
  hooked.createChatMessage({ flags: {} });
  assert.equal(renders, 3, "a message that is no card renders nothing");
  delete globalThis.foundry.applications;
});

/* -------------------------------------------- */
/*  A fuse's light and a drinkable's swigs left  */
/* -------------------------------------------- */

const fuseRecord = (extra) => ({ flags: { "acks-extras": { fuse: { source: "I.1", activationId: "a", spot: { x: 0 }, ...extra } } } });
const fuseRows = [{ key: "r", reach: { pulse: "action", radius: { value: "10" }, filter: {} } }];

await t("a fuse row reads its rounds from the clock it burns on: the bearer's turns in a fight, the world clock's due moment out of one", () => {
  run.registerActivationRunner("fuse", async () => ({ ok: true }));
  const fuseItem = (effects, quantity) => put(itemOf({ activation: { kind: "fuse", state: { active: false } }, rows: fuseRows }, { actor: { effects }, ...(quantity === undefined ? {} : { system: { quantity } }) }));
  game.time.worldTime = 100;
  const world = view.itemRunRowFor(fuseItem([fuseRecord({ dueAt: 250 })], 2));
  assert.equal(world.state, "lit");
  assert.equal(world.tag.label, "ACKS-LIB.itemRun.strip.tag.lit", "the strip's own words, with the rounds as data");
  assert.equal(world.tag.tip, "ACKS-LIB.itemRun.strip.tagTip.lit");
  assert.deepEqual(world.presses.map((p) => p.key), ["light"], "a second one in the stack can be lit");
  const roundsOf = (effects) => view.itemRunRowFor(fuseItem(effects, 2));
  const seen = [];
  const real = globalThis.game.i18n.format;
  globalThis.game.i18n.format = (key, data) => (seen.push([key, data]), key);
  roundsOf([fuseRecord({ dueAt: 250 })]);
  roundsOf([fuseRecord({ dueAt: 101 })]);
  roundsOf([fuseRecord({ dueAt: 50 })]);
  roundsOf([fuseRecord({ clock: { combatId: "c", combatantId: "k", count: 5, seen: 2 } })]);
  globalThis.game.i18n.format = real;
  const rounds = seen.filter(([key]) => key === "ACKS-LIB.itemRun.strip.tag.lit").map(([, data]) => data.n);
  assert.deepEqual(rounds, [3, 1, 1, 3], "150s on 60s rounds is three; a moment inside the next round, or past, is one; 5 counted less 2 seen is three");
  game.time.worldTime = 0;
  assert.equal(view.itemRunRowFor(fuseItem([], 2)).state, "ready", "no fuse of the item on the actor, not lit");
  const other = view.itemRunRowFor(fuseItem([{ flags: { "acks-extras": { fuse: { source: "I.other", activationId: "a", spot: {}, dueAt: 9 } } } }], 2));
  assert.equal(other.state, "ready", "another item's fuse is not this one's");
});

await t("a lit fuse's Light is offered only where the stack holds more than it has lit; an item with no quantity counts one", () => {
  const fuseItem = (effects, quantity) => put(itemOf({ activation: { kind: "fuse", state: { active: false } }, rows: fuseRows }, { actor: { effects }, ...(quantity === undefined ? {} : { system: { quantity } }) }));
  const lit = [fuseRecord({ dueAt: 600 })];
  assert.deepEqual(view.itemRunRowFor(fuseItem(lit, 2)).presses.map((p) => p.key), ["light"]);
  assert.deepEqual(view.itemRunRowFor(fuseItem(lit, 1)).presses, [], "one in the stack, one lit: no spare");
  assert.deepEqual(view.itemRunRowFor(fuseItem(lit)).presses, [], "no quantity reads as one");
  const two = [fuseRecord({ dueAt: 600 }), fuseRecord({ dueAt: 700, activationId: "b" })];
  assert.deepEqual(view.itemRunRowFor(fuseItem(two, 2)).presses, [], "two lit of two");
  assert.deepEqual(view.itemRunRowFor(fuseItem(two, 3)).presses.map((p) => p.key), ["light"], "two lit of three");
  assert.equal(view.itemRunRowFor(fuseItem(two, 2)).state, "lit");
  run.registerActivationRunner("fuse", null);
});

const consumeFlag = (activation) => ({ activation: { kind: "consume", ...activation }, rows: [] });

await t("a consume row carries its swigs left from the item with the tooltip of its provenance and the item's page", () => {
  run.registerActivationRunner("consume", async () => ({ ok: true }));
  const rowOf = (activation) => view.itemRunRowFor(put(itemOf(consumeFlag(activation))));
  const rolled = rowOf({ left: 4, leftFrom: { by: "roll", formula: "1d6", total: 4 } }).left;
  assert.equal(rolled.value, 4);
  assert.equal(rolled.label, "ACKS-LIB.itemRun.row.left");
  assert.equal(rolled.tip, "ACKS-LIB.itemRun.row.leftTipRolled");
  assert.equal(rowOf({ left: 2, leftFrom: { by: "hand" } }).left.tip, "ACKS-LIB.itemRun.row.leftTipHand");
  const blank = rowOf({}).left;
  assert.equal(blank.value, null);
  assert.equal(blank.tip, "ACKS-LIB.itemRun.row.leftTipBlank");
  const data = [];
  const real = globalThis.game.i18n.format;
  globalThis.game.i18n.format = (key, d) => (data.push([key, d]), key);
  rowOf({ left: 4, leftFrom: { by: "roll", formula: "1d6", total: 4 } });
  globalThis.game.i18n.format = real;
  assert.deepEqual(data.find(([key]) => key === "ACKS-LIB.itemRun.row.leftTipRolled")[1], { total: 4, formula: "1d6", cite: "PG 1" }, "the page is the item's own");
  owned.value = false;
  assert.equal(rowOf({ left: 4 }).left, null, "a seat that does not own the item has no box");
  owned.value = true;
  run.registerActivationRunner("consume", null);
});

/** A swigs-left box as a sheet draws it: its dataset and value, and the listeners it takes. */
const box = (uuid, value) => {
  const listeners = {};
  return { dataset: { itemUuid: uuid }, value, listeners, addEventListener: (name, fn) => (listeners[name] = fn) };
};

await t("writeRunLeft writes the typed count and its hand provenance for an owner, clears both on a blank, and writes nothing for a bad entry or a seat that is no owner", async () => {
  const writes = [];
  notes.length = 0;
  const base = "flags.acks-extras.itemRun.activation";
  put(itemOf(consumeFlag({ left: 5, leftFrom: { by: "roll", formula: "1d6", total: 5 } }), { update: async (data) => (writes.push(data), data) }));
  await view.writeRunLeft(box("I.1", "3"));
  assert.deepEqual(writes.pop(), { [`${base}.left`]: 3, [`${base}.leftFrom`]: { by: "hand" } });
  await view.writeRunLeft(box("I.1", "0"));
  assert.deepEqual(writes.pop(), { [`${base}.left`]: 0, [`${base}.leftFrom`]: { by: "hand" } }, "none left is a count");
  await view.writeRunLeft(box("I.1", " "));
  assert.deepEqual(writes.pop(), { [`${base}.left`]: null, [`${base}.leftFrom`]: null });
  const bad = box("I.1", "2.5");
  assert.equal(await view.writeRunLeft(bad), null);
  assert.equal(writes.length, 0, "an invalid entry writes nothing");
  assert.equal(bad.value, "5", "and the box is set back to the stored count");
  owned.value = false;
  const refused = box("I.1", "1");
  await view.writeRunLeft(refused);
  owned.value = true;
  assert.equal(writes.length, 0, "Foundry's ownership of the item decides, not the role");
  assert.equal(notes.at(-1)[1], "ACKS-LIB.itemRun.refused.notOwner");
  assert.equal(refused.value, "5");
  await view.writeRunLeft(box("I.missing", "1"));
  assert.equal(notes.at(-1)[1], "ACKS-LIB.itemRun.refused.gone");
  put(itemOf({ activation: { kind: "once", state: {} }, rows: [] }, { update: async (data) => (writes.push(data), data) }));
  await view.writeRunLeft(box("I.1", "1"));
  assert.equal(writes.length, 0, "only a consume item has swigs");
});

await t("bindItemRunRows wires each box once, and its change reaches writeRunLeft without bubbling to the sheet's form", async () => {
  const writes = [];
  put(itemOf(consumeFlag({}), { update: async (data) => (writes.push(data), data) }));
  const one = box("I.1", "4");
  one.dataset = { itemUuid: "I.1" };
  const root = { nodeType: 1, querySelectorAll: (selector) => (selector === "input[data-acks-extras-run-left]" ? [one] : []) };
  view.bindItemRunRows(root);
  view.bindItemRunRows(root);
  assert.equal(one.dataset.wired, "1");
  let stopped = 0;
  one.listeners.change({ stopPropagation: () => (stopped += 1) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stopped, 1);
  assert.equal(writes.length, 1);
  view.bindItemRunRows(null);
  view.bindItemRunRows({});
});

console.log(`\ntest-item-run-row: ${passed} checks passed.`);
