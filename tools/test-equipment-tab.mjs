/**
 * The character sheet's Equipment tab, Foundry-free half: the Set down control
 * on a container's header, the words of a ground pile's row under Kept
 * elsewhere (the owner's, and a bystander's at a pile of someone else's), the
 * lines a pile unfolds to with their Take controls, the take handler, and what
 * the pile does to the Load tooltip and the coin order.
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
const dotted = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
globalThis.foundry = {
  utils: {
    escapeHTML: (s) => s,
    getProperty: dotted,
    hasProperty: (obj, path) => dotted(obj, path) !== undefined,
  },
};
globalThis.game = {
  settings: { get: () => undefined },
  scenes: [],
  user: { isGM: false },
  i18n: { has: () => false, localize: (k) => k, format: fmt },
};

const { buildEquipmentTab, canSetDown, containerControls, groundRowOf, takeFromPile, pileTakePick, movesForPiles, pileReachKey } = await import("../scripts/character-sheet/tabs/equipment.mjs");

const HERO = "Actor.hero";
const PILE = "Actor.pile";

/** A flag reader over a plain flags object, the way a document answers `getFlag`. */
const flagged = (flags = {}) => (scope, key) => flags?.[scope]?.[key];
const itemOf = (id, name, { qty, flags = {}, contained, stamp } = {}) => ({
  id,
  name,
  stamp,
  // A physical item, as `isGoods` reads one: it carries a cost and a weight.
  system: { cost: 0, weight6: 0, ...(qty === undefined ? {} : { quantity: qty }) },
  getFlag: flagged({ "acks-extras": { ...flags, ...(contained ? { containedIn: contained } : {}) } }),
});

const collection = (rows) => {
  const list = [...rows];
  list.get = (id) => list.find((i) => i.id === id) ?? null;
  return list;
};

const actorOf = ({ isOwner = true, isToken = false, items = [], uuid = HERO, id = "hero", name = "Hero" } = {}) => ({
  uuid,
  id,
  name,
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

/**
 * The storage lib the tab reads. `held` is whether the viewer's own goods are
 * on the pile (`providersFor` lists it); a bystander's world has the pile among
 * `providers()` and holding goods, and nothing of the viewer's. A row is stamped
 * to `owner` unless it names its own `stamp`.
 */
const useStorage = ({ pile = pileOf(), items = goods(), owner = HERO, beside = [], held = true } = {}) => {
  const rows = [...(pile ? [{ provider: pile, items, coinGC: 0 }] : []), ...beside];
  const calls = [];
  globalThis.acksExtras = {
    lib: {
      storage: {
        providersFor: () => (held ? rows : rows.filter((r) => r.provider !== pile)),
        providers: () => rows.map((r) => r.provider),
        storedItems: (p) => rows.find((r) => r.provider === p)?.items ?? [],
        vaultOwnerUuid: () => null,
        ownerOf: (i) => ({ uuid: i.stamp ?? owner, name: "Hero" }),
        retrieve: async (...args) => {
          calls.push(args);
          return { ok: true };
        },
      },
    },
  };
  return calls;
};

/**
 * Where characters stand, through the REAL reach path: one scene, the viewer's
 * token on it, and the pile's own token either beside it or far off. With no
 * scene (`stand(null)`) the character is nowhere.
 */
const stand = (where) => {
  if (where === null) {
    globalThis.game.scenes = [];
    return;
  }
  const token = (actorId, x) => ({ id: `t-${actorId}`, uuid: `Scene.s1.Token.t-${actorId}`, actorId, x, y: 0, width: 1, height: 1, elevation: 0, hidden: false });
  const scene = { id: "s1", grid: { size: 100, distance: 5 }, tokens: [token("hero", 0), token("alys", 0), token("pile", where === "beside" ? 0 : 5000)] };
  globalThis.game.scenes = Object.assign([scene], { get: (id) => (id === "s1" ? scene : undefined) });
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
  // A pile holding nothing of the viewer's is listed only while they reach it
  // and only while it holds something (the bystander's row, below).
  useStorage({ items: [], held: false });
  stand("beside");
  eq(buildEquipmentTab(actorOf()).elsewhere.length, 0, "a pile that holds nothing is never listed, even one stood at");
  stand(null);
}

/* -------------------------------------------- */
/*  The owner's row unfolds                      */
/* -------------------------------------------- */

{
  useStorage();
  const tab = buildEquipmentTab(actorOf());
  const ground = tab.elsewhere.find((e) => e.uuid === PILE).ground;
  eq(ground.lines.map((l) => l.name), ["Backpack", "Torch", "Dagger"], "one line per row the pile holds");
  eq(ground.lines.map((l) => l.stack), [false, true, false], "only a stack has a quantity to choose");
  eq(ground.lines.find((l) => l.name === "Torch").qty, 5, "a stack's line carries its count");
  eq(ground.lines.find((l) => l.name === "Torch").pick, pileTakePick(pileOf(), "p2"), "its staging pick is keyed on the pile and the row");
  eq(ground.lines.map((l) => l.inName), ["", "Backpack", "Backpack"], "a row in the container names it");
  ok(ground.lines.every((l) => l.canTake), "the owner takes every line of their own pack");
  ok(tab.elsewhere.find((e) => e.uuid === PILE).canRetrieve, "and keeps Pick up beside the lines");
  ok(!ground.bystander, "the owner's row is not a bystander's");
  eq(ground.open, false, "the list is folded until the sheet unfolds it");
  eq(ground.foldLabel, fmt("ACKS-CHARACTER.equipment.pileShow"), "a folded row's toggle offers to show");

  const open = buildEquipmentTab(actorOf(), { openPiles: new Set([PILE]) }).elsewhere.find((e) => e.uuid === PILE).ground;
  ok(open.open, "a pile the sheet unfolded is open");
  eq(open.foldLabel, fmt("ACKS-CHARACTER.equipment.pileHide"), "and its toggle offers to hide");

  stand("away");
  const away = buildEquipmentTab(actorOf()).elsewhere.find((e) => e.uuid === PILE);
  ok(away.ground.lines.every((l) => l.canTake) && away.canRetrieve, "the owner's Take and Pick up are not reach-gated");
  stand(null);

  const mixed = goods();
  mixed[1].stamp = "Actor.someoneElse";
  useStorage({ items: mixed });
  const away2 = buildEquipmentTab(actorOf()).elsewhere.find((e) => e.uuid === PILE).ground;
  eq(away2.lines.map((l) => l.canTake), [true, false, true], "away from it, a line stamped to someone else is not the owner's to take");
  stand("beside");
  const beside = buildEquipmentTab(actorOf()).elsewhere.find((e) => e.uuid === PILE).ground;
  ok(beside.lines.every((l) => l.canTake), "standing at it, every line is");
  stand(null);

  useStorage();
  ok(buildEquipmentTab(actorOf({ isOwner: false })).elsewhere.find((e) => e.uuid === PILE).ground.lines.every((l) => !l.canTake), "a viewer who does not own the character is offered no Take");
}

/* -------------------------------------------- */
/*  A bystander's row                            */
/* -------------------------------------------- */

{
  const ALYS = { uuid: "Actor.alys", id: "alys", name: "Alys" };
  const bystander = (extra = {}) => actorOf({ ...ALYS, ...extra });
  const rowOf = (tab) => tab.elsewhere.find((e) => e.uuid === PILE);

  useStorage({ held: false });
  stand("beside");
  const tab = buildEquipmentTab(bystander());
  const row = rowOf(tab);
  ok(row, "a character standing at a pile of someone else's sees its row");
  ok(row.ground.bystander, "which is a bystander's row");
  eq(row.ground.label, fmt("ACKS-CHARACTER.equipment.groundOf", { owner: "Hero", container: "Backpack" }), "its label names the owner and the container");
  ok(row.ground.atRisk, "it carries the At risk tag");
  eq(row.ground.atRiskTip, fmt("ACKS-CHARACTER.equipment.atRiskTipOther"), "whose tooltip speaks of anyone at the pile, not of the viewer's own leaving");
  eq(row.count, 3, "its count is everything on the pile");
  eq(row.ground.lineTip, "Backpack ×1 · Torch ×5 · Dagger ×1", "its line's tooltip lists the goods");
  ok(!row.canRetrieve, "it has no Pick up: nothing on it is stamped to the viewer");
  ok(!row.canDeposit && !row.canPin, "no Deposit and no Pin");
  eq(row.ground.lines.map((l) => l.canTake), [true, true, true], "Take is offered on every line");
  eq(tab.load.tip, "", "the Load tooltip does not claim a pile that is not theirs");
  ok(!tab.purse || ![...tab.purse.payFrom, ...tab.purse.receiveInto].some((o) => o.key.includes(PILE)), "the coin order never offers it");

  ok(!rowOf(buildEquipmentTab(bystander({ isOwner: false }))).ground.lines.some((l) => l.canTake), "a viewer who does not own the bystander is offered no Take");

  stand("away");
  ok(!rowOf(buildEquipmentTab(bystander())), "out of reach of the pile the row is not listed");
  stand(null);
  ok(!rowOf(buildEquipmentTab(bystander())), "nowhere on a map, it is not listed");

  stand("beside");
  useStorage({ held: false, items: [] });
  ok(!rowOf(buildEquipmentTab(bystander())), "a pile that holds nothing is not listed");
  stand(null);
}

/* -------------------------------------------- */
/*  A move to or from a pile redraws the sheet    */
/* -------------------------------------------- */

{
  const alys = actorOf({ uuid: "Actor.alys", id: "alys", name: "Alys" });
  useStorage({ held: false });
  stand("beside");
  eq(pileReachKey(alys), PILE, "standing at a pile that holds goods, the key names it");
  stand("away");
  eq(pileReachKey(alys), "", "walked away, the key is empty, so the move redraws");
  stand(null);
  eq(pileReachKey(alys), "", "nowhere on a map, nothing is reached");
  stand("beside");
  useStorage({ held: false, items: [] });
  eq(pileReachKey(alys), "", "a pile holding nothing is no row, so it is no part of the key");
  useStorage({ pile: null });
  eq(pileReachKey(alys), "", "with no pile in the world there is nothing to reach");
  stand(null);

  ok(movesForPiles(alys, { actorId: "alys" }, { x: 100 }), "the character's own token moving answers");
  ok(movesForPiles(alys, { actorId: "alys" }, { elevation: 10 }), "so does a change of elevation");
  ok(!movesForPiles(alys, { actorId: "alys" }, { name: "Alys the Bold" }), "a change that is no move does not");
  ok(!movesForPiles(alys, { actorId: "bran", actor: actorOf({ uuid: "Actor.bran", id: "bran" }) }, { x: 100 }), "someone else's move does not");
  ok(movesForPiles(alys, { actorId: "pile", actor: pileOf() }, { y: 100 }), "a pile's token moving answers");
  const tokenActor = { ...actorOf({ isToken: true, uuid: "Scene.s1.Token.t1.Actor.alys", id: "alys" }), token: { uuid: "Scene.s1.Token.t1" } };
  ok(movesForPiles(tokenActor, { uuid: "Scene.s1.Token.t1", actorId: "alys" }, { x: 1 }), "a token actor answers to its own token");
  ok(!movesForPiles(tokenActor, { uuid: "Scene.s1.Token.t2", actorId: "alys" }, { x: 1 }), "and not to another token of the same base actor");
}

/* -------------------------------------------- */
/*  Open is the Judge's                          */
/* -------------------------------------------- */

{
  useStorage();
  const openOf = () => buildEquipmentTab(actorOf()).elsewhere.find((e) => e.uuid === PILE).canOpen;
  ok(!openOf(), "a Player's pile row offers no Open: the pile's sheet shows them nothing");
  globalThis.game.user.isGM = true;
  ok(openOf(), "a Judge's does");
  globalThis.game.user.isGM = false;

  const shelf = { ...pileOf(), name: "Cellar", getFlag: () => undefined };
  useStorage({ pile: shelf, items: [itemOf("s1", "Rope", { qty: 1 })] });
  ok(buildEquipmentTab(actorOf()).elsewhere[0].canOpen, "an ordinary place keeps Open for a Player");

  useStorage({ held: false });
  stand("beside");
  const alys = actorOf({ uuid: "Actor.alys", id: "alys", name: "Alys" });
  ok(!buildEquipmentTab(alys).elsewhere.find((e) => e.uuid === PILE).canOpen, "a bystander's row offers a Player no Open either");
  stand(null);
}

/* -------------------------------------------- */
/*  The take handler                             */
/* -------------------------------------------- */

{
  const calls = useStorage();
  const pile = pileOf();
  const actor = actorOf();
  const box = (key, value) => {
    const input = { dataset: { pick: key }, value, defaultValue: "" };
    return { input, querySelector: (sel) => (sel === `input[data-pick="${key}"]` ? input : null), querySelectorAll: () => [input] };
  };

  const stack = box(pileTakePick(pile, "p2"), "3");
  const answer = await takeFromPile(actor, pile, "p2", stack);
  eq(answer, { ok: true }, "the take answers what retrieve answered");
  eq(calls.at(-1), [pile, actor, [{ id: "p2", quantity: 3 }]], "a typed amount moves that many of that row, from the pile onto the character");
  eq(stack.input.defaultValue, "3", "the pick is spent before the move, so the redraw shows what the pile holds");

  await takeFromPile(actor, pile, "p2", box(pileTakePick(pile, "p2"), ""));
  eq(calls.at(-1), [pile, actor, [{ id: "p2", quantity: null }]], "a blank box takes the whole stack");

  await takeFromPile(actor, pile, "p3", { querySelector: () => null, querySelectorAll: () => [] });
  eq(calls.at(-1), [pile, actor, [{ id: "p3", quantity: null }]], "a row with no box takes the row whole");

  await takeFromPile(actor, pile, "p2", box(pileTakePick(pile, "p3"), "9"));
  eq(calls.at(-1), [pile, actor, [{ id: "p2", quantity: null }]], "another line's box is not this line's amount");

  const before = calls.length;
  eq(await takeFromPile(actor, pile, "", null), null, "no row named, nothing asked");
  eq(await takeFromPile(actor, null, "p2", null), null, "no pile, nothing asked");
  eq(calls.length, before, "and retrieve was not called for either");
}

/* -------------------------------------------- */
/*  A weapon or armour stack's count and equip   */
/* -------------------------------------------- */

{
  useStorage({ pile: null, items: [] });
  const physical = (id, name, type, { qty = 1, equipped = false } = {}) => ({
    id,
    name,
    type,
    img: "x.png",
    system: { cost: 0, weight6: 0, quantity: qty, equipped, melee: true, damage: { base: { formula: "1d6" } }, ac: { value: 3 } },
    effects: [],
    getFlag: flagged({}),
    parent: null,
  });
  // An actor whose rows can take a new row beside them, which `canDivide` asks.
  const holder = (items) => {
    const actor = { ...actorOf({ items }), documentName: "Actor", createEmbeddedDocuments: async () => [] };
    for (const i of items) i.parent = actor;
    return actor;
  };
  const rowsOf = (tab) => [...tab.places.flatMap((p) => p.rows), ...tab.carried.flatMap((k) => k.rows)];
  const rowFor = (actor, id) => rowsOf(buildEquipmentTab(actor)).find((r) => r.id === id);
  const stateOf = (row, action) => row.controls.state.find((c) => c.action === action);

  // A resting stack of three swords and three shirts of mail.
  const swords = physical("w3", "Sword", "weapon", { qty: 3 });
  const mail = physical("a3", "Mail", "armor", { qty: 3 });
  const lone = physical("w1", "Dagger", "weapon", { qty: 1 });
  const drawn = physical("w2", "Axe", "weapon", { qty: 1, equipped: true });
  const drawnStack = physical("w4", "Spear", "weapon", { qty: 3, equipped: true });
  const hero = holder([swords, mail, lone, drawn, drawnStack]);

  const stack = rowFor(hero, "w3");
  eq(stack.stack, true, "a stack of three shows its count");
  eq(stack.qty, 3, "with the item's own Quantity");
  eq(stack.countTip, fmt("ACKS-LIB.stack.countTip", { n: 3 }), "the count's tooltip names the Quantity it is read from");
  eq(rowFor(hero, "w1").stack, false, "a row of one shows no count");
  eq(rowFor(hero, "w1").countTip, "", "and carries no count tooltip");

  eq(stateOf(stack, "toggleEquip").title, fmt("ACKS-EQUIPMENT.action.drawOne", { rest: 2 }), "a resting weapon stack of three draws one and the stack keeps two");
  eq(stateOf(rowFor(hero, "a3"), "toggleEquip").title, fmt("ACKS-EQUIPMENT.action.equipOne", { rest: 2 }), "a resting armour stack equips one and the stack keeps two");
  eq(stateOf(rowFor(hero, "w1"), "toggleEquip").title, "ACKS-EQUIPMENT.action.draw", "a row of one keeps Draw (equip)");
  eq(stateOf(rowFor(hero, "w2"), "toggleEquip").title, "ACKS-EQUIPMENT.action.sheathe", "a drawn row keeps Sheathe");
  eq(stateOf(rowFor(hero, "w4"), "toggleEquip").title, "ACKS-EQUIPMENT.action.sheathe", "a drawn row holding three, typed in Details, still reads Sheathe");
  mail.system.quantity = 1;
  eq(stateOf(rowFor(hero, "a3"), "toggleEquip").title, "ACKS.items.Equip", "armour of one keeps the system's Equip");
  mail.system.quantity = 3;
  mail.system.equipped = true;
  eq(stateOf(rowFor(hero, "a3"), "toggleEquip").title, "ACKS.items.Unequip", "armour in use keeps the system's Unequip");
  mail.system.equipped = false;

  // The tooltip asks the press's own test: a stack the write would not divide promises nothing.
  const isolated = physical("w5", "Mace", "weapon", { qty: 3 });
  const bare = { ...holder([isolated]), createEmbeddedDocuments: undefined };
  isolated.parent = bare;
  eq(stateOf(rowFor(bare, "w5"), "toggleEquip").title, "ACKS-EQUIPMENT.action.draw", "a holder that cannot take a new row beside it divides nothing, so says Draw");
  const ringed = physical("w6", "Blade", "weapon", { qty: 3 });
  ringed.effects = [{ id: "fx" }];
  eq(stateOf(rowFor(holder([ringed]), "w6"), "toggleEquip").title, "ACKS-EQUIPMENT.action.draw", "a stack with Active Effects of its own moves whole, so says Draw");

  const divide = (row) => row.controls.state.find((c) => c.action === "divideStack");
  ok(divide(stack), "a resting weapon stack of three is offered Divide");
  eq(divide(stack).title, "ACKS-LIB.stack.divide", "by the library's own words");
  ok(!divide(rowFor(hero, "w4")), "a drawn row is offered no Divide, though it holds three");
  ok(!divide(rowFor(hero, "w1")), "a row of one is offered none");
  ok(!stateOf(stack, "splitStack"), "Split to wear is for what core cannot equip, so a weapon is never offered it");
  ok(divide(rowFor(hero, "a3")), "a resting armour stack is offered Divide");
  for (const row of [stack, rowFor(hero, "w2")]) {
    for (const group of ["state", "keep"]) ok(row.controls[group].every((c) => c.title), `every ${group} control of ${row.id} has a title for its aria-label`);
  }
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
  ok(/\["deleteActor", watchPile\]/.test(sheet), "the sheet re-renders when a pile is deleted");
  ok(!/GROUND_FLAG\)\?\.ownerUuid/.test(sheet), "and for any pile, since a bystander's row lists one that is not theirs");
  ok(/placeFold:\s*AcksCharacterSheet\.#onPlaceFold/.test(sheet) && /pileTake:\s*AcksCharacterSheet\.#onPileTake/.test(sheet), "the sheet maps the fold and the Take");
  ok(/"placeOpen", "placeFold"/.test(sheet), "the fold stays live on a sheet the viewer cannot edit");
  ok(/extends FrameMixin\(PicksMixin\(/.test(sheet), "the sheet carries the staging-pick mixin, so a typed amount is no submit and survives a redraw");
  ok(/openPiles: this\.#ui\.openPiles/.test(sheet), "the sheet hands the tab the piles it has unfolded");
  ok(/movesForPiles\(this\.actor, doc, changes\) && pileReachKey\(this\.actor\) !== this\.#pileReach/.test(sheet), "a token move redraws only when it changes which piles the character reaches");
  ok(/this\.#pileReach = pileReachKey\(actor\)/.test(sheet), "and each render records the piles it drew against");
  ok(/data-action="\{\{action\}\}" data-tooltip="\{\{title\}\}" aria-label="\{\{title\}\}"/.test(gear), "a container's header controls are named for assistive technology");
  ok(!/\sid="/.test(gear + eqTpl), "no literal id in the templates");
  ok(/<a class="acks-extras-frame__gear-name" data-action="itemEdit">\{\{name\}\}\{\{#if stack\}\} <span class="acks-nums" data-tooltip-text="\{\{countTip\}\}">×\{\{qty\}\}<\/span>\{\{\/if\}\}<\/a>/.test(gear), "the count sits in the name link and its interpolated tooltip is text");
  for (const group of ["state", "keep"]) {
    ok(new RegExp(`\\{\\{#each controls\\.${group}\\}\\}<button [^>]*data-tooltip="\\{\\{title\\}\\}" aria-label="\\{\\{title\\}\\}">`).test(gear), `each ${group} control is named for assistive technology as its tooltip reads`);
  }
  ok(/data-action="roll"[^>]*data-tooltip="\{\{localize 'ACKS-CHARACTER\.equipment\.attack'\}\}" aria-label="\{\{localize 'ACKS-CHARACTER\.equipment\.attack'\}\}"/.test(gear), "so is the roll control");
  ok(/data-action="placeRetrieveAll" data-tooltip-text="\{\{place\.ground\.pickUpTip\}\}"/.test(eqTpl), "a pile's Pick up is the retrieve action with its own tooltip");
  ok(!/title="/.test(gear + eqTpl), "no title attribute: tooltips go through core's manager");
  ok(/\{\{#if place\.canOpen\}\}<a [^>]*data-action="placeOpen"/.test(eqTpl), "a pile's name is a link to its sheet only where Open is offered");
  ok(/\{\{#if place\.canOpen\}\}<button [^>]*data-action="placeOpen"/.test(eqTpl), "and so is the Open control");
  ok(/<button type="button" class="acks-extras-frame__ctl" data-action="placeFold" aria-expanded=/.test(eqTpl), "the fold is a real button that states whether it is open");
  const takeInput = eqTpl.match(/<input class="acks-extras-pile__qty"[^>]*>/)?.[0] ?? "";
  ok(/data-pick="\{\{line\.pick\}\}"/.test(takeInput) && !/\sname="/.test(takeInput) && /aria-label=/.test(takeInput) && /min="1" max="\{\{line\.qty\}\}"/.test(takeInput), "a stack's amount is a labelled staging pick with no name");
  ok(/data-action="pileTake" aria-label="[^"]+" data-tooltip="/.test(eqTpl), "Take is named for a screen reader and carries a tooltip");
  ok(/data-pile-line="\{\{line\.id\}\}"/.test(eqTpl) && !/data-item-id/.test(eqTpl), "a pile's line is not read as one of the character's own rows");

  const lang = JSON.parse(read("../lang/en.json"));
  for (const key of [
    "ACKS-LIB.stack.countTip",
    "ACKS-EQUIPMENT.action.drawOne",
    "ACKS-EQUIPMENT.action.equipOne",
    "ACKS-EQUIPMENT.container.setDown",
    "ACKS-CHARACTER.equipment.atRisk",
    "ACKS-CHARACTER.equipment.atRiskTip",
    "ACKS-CHARACTER.equipment.pickUp",
    "ACKS-CHARACTER.equipment.pickUpCarried",
    "ACKS-CHARACTER.equipment.loadGround",
    "ACKS-CHARACTER.equipment.groundOf",
    "ACKS-CHARACTER.equipment.groundLine",
    "ACKS-CHARACTER.equipment.atRiskTipOther",
    "ACKS-CHARACTER.equipment.pileShow",
    "ACKS-CHARACTER.equipment.pileHide",
    "ACKS-CHARACTER.equipment.pileQty",
    "ACKS-CHARACTER.equipment.pileIn",
    "ACKS-CHARACTER.equipment.take",
    "ACKS-CHARACTER.equipment.takeTip",
    "ACKS-CHARACTER.equipment.takeNamed",
    "ACKS-CHARACTER.equipment.takeHow",
  ]) {
    const nested = key.split(".").reduce((o, k) => o?.[k], lang);
    ok(typeof (lang[key] ?? nested) === "string", `${key} exists`);
  }
  eq(lang["ACKS-LIB.stack.countTip"], "{n} in the stack: the item's Quantity.", "the count's tooltip names where the figure is read from");
  eq(lang["ACKS-EQUIPMENT"].action.drawOne, "Draw one (equip). The stack keeps {rest}.", "a weapon stack's Draw says it takes one and what stays");
  eq(lang["ACKS-EQUIPMENT"].action.equipOne, "Equip one. The stack keeps {rest}.", "an armour stack's Equip says the same");
}

console.log(`\ntest-equipment-tab: OK (${checks} checks — the Set down control, the ground row's words, the unfolding lines and Take, a bystander's row, Open, the take handler, the Load tooltip, the coin order's filter)`);
