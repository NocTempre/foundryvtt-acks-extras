/**
 * The character sheet's Equipment tab, Foundry-free half: the Set down control
 * on a container's header, the words of a ground pile's row under Kept
 * elsewhere, and what the pile does to the Load tooltip and the coin order.
 *
 * `buildEquipmentTab` runs here against plain mocked documents and the REAL
 * lib the tab reads (loadout, container report, coin order, reach). What a
 * template draws, a render's re-fire on a pile's deletion and the buttons
 * themselves need a live Foundry and are walked there
 * (docs/character-sheet/TESTING.md).
 *
 * Every name, id and figure is invented.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const fmt = (k, d = {}) => `${k}|${JSON.stringify(d)}`;
globalThis.Hooks = { once() {}, on() {}, callAll() {}, call() {} };
globalThis.CONST = {};
globalThis.ui = {};
globalThis.canvas = {};
globalThis.foundry = { utils: { escapeHTML: (s) => s } };
globalThis.game = {
  settings: { get: () => undefined },
  scenes: [],
  user: { isGM: false },
  i18n: { has: () => false, localize: (k) => k, format: fmt },
};

const { buildEquipmentTab, canSetDown, containerControls, groundRowOf } = await import("../scripts/character-sheet/tabs/equipment.mjs");

const HERO = "Actor.hero";
const PILE = "Actor.pile";

/** A flag reader over a plain flags object, the way a document answers `getFlag`. */
const flagged = (flags = {}) => (scope, key) => flags?.[scope]?.[key];
const itemOf = (id, name, { qty, flags = {}, contained } = {}) => ({
  id,
  name,
  system: qty === undefined ? {} : { quantity: { value: qty } },
  getFlag: flagged({ "acks-extras": { ...flags, ...(contained ? { containedIn: contained } : {}) } }),
});

const collection = (rows) => {
  const list = [...rows];
  list.get = (id) => list.find((i) => i.id === id) ?? null;
  return list;
};

const actorOf = ({ isOwner = true, isToken = false, items = [] } = {}) => ({
  uuid: HERO,
  id: "hero",
  name: "Hero",
  type: "character",
  isOwner,
  isToken,
  items: collection(items),
  system: { encumbrance: {} },
  effects: [],
  getFlag: () => undefined,
});

const GROUND = { ownerUuid: HERO, ownerName: "Hero", containerName: "Backpack" };
const pileOf = (flag = GROUND) => ({
  documentName: "Actor",
  type: "acks-extras.location",
  uuid: PILE,
  id: "pile",
  name: "On the ground · Backpack",
  img: "pile.png",
  getFlag: (scope, key) => (scope === "acks-extras" && key === "ground" ? flag : undefined),
});

/** What lies in a pile: the pack that carries the set-down record, and the rest. */
const packRecord = (extra = {}) => ({ ownerUuid: HERO, worn: true, slot: "back", fromId: "pack1", ...extra });
const goods = (record = packRecord()) => [
  itemOf("p1", "Backpack", { qty: 1, flags: { setDown: record } }),
  itemOf("p2", "Torch", { qty: 5, contained: "p1" }),
  itemOf("p3", "Dagger", { qty: 1, contained: "p1" }),
];

const useStorage = ({ pile = pileOf(), items = goods(), owner = HERO, beside = [] } = {}) => {
  const rows = [...(pile ? [{ provider: pile, items, coinGC: 0 }] : []), ...beside];
  globalThis.acksExtras = {
    lib: {
      storage: {
        providersFor: () => rows,
        providers: () => rows.map((r) => r.provider),
        vaultOwnerUuid: () => null,
        ownerOf: () => ({ uuid: owner, name: "Hero" }),
      },
    },
  };
};

/* -------------------------------------------- */
/*  The Set down control                         */
/* -------------------------------------------- */

const report = (item, extra = {}) => ({ item, visible: true, concealed: false, locked: false, contents: [], capacityStone: 0, load6: 0, over: false, ...extra });
const setDownOf = (controls) => controls.find((c) => c.action === "containerSetDown");

{
  const pack = itemOf("pack1", "Backpack");
  const own = setDownOf(containerControls(actorOf(), report(pack)));
  ok(own, "an owned top-level container offers Set down");
  eq(own.title, "ACKS-EQUIPMENT.container.setDown", "its tooltip is the control's own key");
  ok(/^fa-/.test(own.icon), "it is an icon button, as its neighbours are");

  const nested = itemOf("bag1", "Pouch", { contained: "pack1" });
  ok(!setDownOf(containerControls(actorOf(), report(nested))), "a container inside another does not");
  ok(!setDownOf(containerControls(actorOf({ isToken: true }), report(pack))), "a token's own actor does not");
  ok(!setDownOf(containerControls(actorOf({ isOwner: false }), report(pack))), "a viewer who does not own the character does not");

  const locked = setDownOf(containerControls(actorOf(), report(pack, { locked: true, visible: false })));
  ok(locked, "a locked container sets down whole, so the control stays");

  ok(canSetDown(actorOf(), pack), "the predicate agrees for the owned top-level container");
  ok(!canSetDown(actorOf({ isOwner: false }), pack), "the predicate is the owner's");
  ok(!canSetDown(actorOf({ isToken: true }), pack), "the predicate refuses a token's actor");
  ok(!canSetDown(actorOf(), nested), "the predicate refuses a nested container");
  ok(!canSetDown(null, pack), "the predicate refuses a missing actor");
}

/* -------------------------------------------- */
/*  The ground row's words                       */
/* -------------------------------------------- */

{
  useStorage();
  const row = groundRowOf(actorOf(), pileOf(), goods());
  eq(row.label, fmt("ACKS-LOCATION.ground.name", { name: "Backpack" }), "the label is the container's name on the ground");
  ok(row.atRisk, "a pile holding the viewer's goods is at risk");
  eq(row.atRiskTip, fmt("ACKS-CHARACTER.equipment.atRiskTip"), "the tag's tooltip says what it means here");
  eq(row.lineTip, "Backpack ×1 · Torch ×5 · Dagger ×1", "the line's tooltip lists the viewer's goods as name ×qty");
  eq(row.count, 3, "the count is the viewer's goods");
  eq(row.pickUpTip, fmt("ACKS-CHARACTER.equipment.pickUp", { slot: "back" }), "a worn pack picks up back to its slot");

  const carried = groundRowOf(actorOf(), pileOf(), goods(packRecord({ worn: false, slot: null })));
  eq(carried.pickUpTip, fmt("ACKS-CHARACTER.equipment.pickUpCarried"), "a pack that was not worn picks up carried");

  const renamed = goods();
  renamed[0].name = "Old Backpack";
  eq(groundRowOf(actorOf(), pileOf(), renamed).label, fmt("ACKS-LOCATION.ground.name", { name: "Old Backpack" }), "the label follows the name the container carries now");

  const gone = groundRowOf(actorOf(), pileOf(), []);
  ok(!gone.atRisk && gone.atRiskTip === "", "a pile with none of the viewer's goods is not at risk");
  eq(gone.label, fmt("ACKS-LOCATION.ground.name", { name: "Backpack" }), "it still reads by the name the pile was made with");

  useStorage({ owner: "Actor.someoneElse" });
  const theirs = groundRowOf(actorOf(), pileOf(), goods());
  ok(!theirs.atRisk && theirs.lineTip === "" && theirs.count === 0, "goods stamped to another character are not the viewer's");
}

/* -------------------------------------------- */
/*  The tab                                      */
/* -------------------------------------------- */

{
  const cellar = { ...pileOf(), uuid: "Actor.cellar", id: "cellar", name: "Cellar", getFlag: () => undefined };
  useStorage({ beside: [{ provider: cellar, items: [itemOf("s1", "Rope", { qty: 1 })], coinGC: 0 }] });
  const tab = buildEquipmentTab(actorOf());
  eq(tab.elsewhere.length, 2, "the pile is listed under Kept elsewhere, beside an ordinary place");
  const place = tab.elsewhere.find((e) => e.uuid === PILE);
  ok(place.ground?.atRisk, "its row carries the ground block, at risk");
  ok(!place.canDeposit, "no Deposit on a pile");
  ok(!place.canPin, "no Pin on a pile");
  ok(place.canRetrieve, "Pick up is offered while it holds the viewer's goods");
  eq(place.reachReason, "", "a pile has no reach reason to show: picking up is not reach-gated");

  eq(tab.load.tip, fmt("ACKS-CHARACTER.equipment.loadGround", { names: "Backpack" }), "the Load tooltip names what was set down");

  const keys = (list) => list.map((o) => o.key);
  ok(tab.purse, "the coin order shows, for the ordinary place beside the pile");
  const offered = (list) => keys(list).join(" ");
  ok(!offered(tab.purse.payFrom).includes(PILE), "a pile with no coin in it is never offered to pay from");
  ok(!offered(tab.purse.receiveInto).includes(PILE), "a pile is never offered to receive into");
  ok(offered(tab.purse.receiveInto).includes("Actor.cellar"), "it still offers the ordinary place");

  globalThis.game.user.isGM = true;
  ok(!buildEquipmentTab(actorOf()).elsewhere.find((e) => e.uuid === PILE).canDeposit, "no Deposit on a pile, a Judge's seat included");
  globalThis.game.user.isGM = false;
}

{
  // The control: the same listing for an ordinary place offers all of it.
  const shelf = { ...pileOf(), name: "Cellar", getFlag: () => undefined };
  useStorage({ pile: shelf, items: [itemOf("s1", "Rope", { qty: 1 })] });
  const tab = buildEquipmentTab(actorOf());
  const place = tab.elsewhere[0];
  ok(place.ground === null && place.canPin, "an ordinary place carries no ground block and can be pinned");
  ok(place.canDeposit === place.canReach, "its Deposit follows reach, as before");
  eq(tab.load.tip, "", "no pile, no Load tooltip");
  ok(tab.purse.payFrom.some((o) => o.key.includes(PILE)), "the coin order offers an ordinary place");
}

{
  // A pile of someone else's, stood on, is not listed: nothing of the viewer's is in it.
  useStorage({ items: [] });
  globalThis.acksExtras.lib.storage.providersFor = () => [];
  const tab = buildEquipmentTab(actorOf());
  eq(tab.elsewhere.length, 0, "a pile holding none of the viewer's goods is never listed for them");
}

/* -------------------------------------------- */
/*  The template and the sheet read the same names */
/* -------------------------------------------- */

{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const sheet = read("../scripts/character-sheet/sheet.mjs");
  const gear = read("../templates/character-sheet/gear-row.hbs");
  const eqTpl = read("../templates/character-sheet/equipment.hbs");
  ok(/containerSetDown:\s*AcksCharacterSheet\.#onContainerSetDown/.test(sheet), "the sheet maps the control's action to its handler");
  ok(/\["deleteActor", watchPile\]/.test(sheet), "the sheet re-renders when a pile of the character's is deleted");
  ok(/data-action="\{\{action\}\}" data-tooltip="\{\{title\}\}" aria-label="\{\{title\}\}"/.test(gear), "a container's header controls are named for assistive technology");
  ok(!/\sid="/.test(gear + eqTpl), "no literal id in the templates");
  ok(/data-action="placeRetrieveAll" data-tooltip-text="\{\{place\.ground\.pickUpTip\}\}"/.test(eqTpl), "a pile's Pick up is the retrieve action with its own tooltip");
  ok(!/title="/.test(gear + eqTpl), "no title attribute: tooltips go through core's manager");

  const lang = JSON.parse(read("../lang/en.json"));
  for (const key of [
    "ACKS-EQUIPMENT.container.setDown",
    "ACKS-CHARACTER.equipment.atRisk",
    "ACKS-CHARACTER.equipment.atRiskTip",
    "ACKS-CHARACTER.equipment.pickUp",
    "ACKS-CHARACTER.equipment.pickUpCarried",
    "ACKS-CHARACTER.equipment.loadGround",
  ]) {
    const nested = key.split(".").reduce((o, k) => o?.[k], lang);
    ok(typeof (lang[key] ?? nested) === "string", `${key} exists`);
  }
}

console.log(`\ntest-equipment-tab: OK (${checks} checks — the Set down control, the ground row's words, the Load tooltip, the coin order's filter)`);
