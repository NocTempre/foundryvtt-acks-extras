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

const { hasRunRow, itemRunRowModel } = await import("../scripts/lib/item-run-row.mjs");
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

await t("a used-up kind offers Use while it has stock, and once spent a press that is off and says so", () => {
  for (const kind of ["once", "fuse", "consume"]) {
    const ready = itemRunRowModel({ kind, runnable: true, owner: true, reach, say });
    assert.equal(ready.state, "ready");
    assert.deepEqual(keys(ready), ["use"]);
    assert.equal(ready.presses[0].disabled, false);
    const spent = itemRunRowModel({ kind, stocked: false, runnable: true, owner: true, reach, say });
    assert.equal(spent.state, "spent");
    assert.equal(spent.tag.label, "row.tag.spent");
    assert.deepEqual(keys(spent), ["spent"]);
    assert.equal(spent.presses[0].disabled, true);
    assert.equal(spent.presses[0].label, "row.press.spent", "the off press carries its own word");
  }
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

console.log(`\ntest-item-run-row: ${passed} checks passed.`);
