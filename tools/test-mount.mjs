/**
 * The mount binding as a sheet gesture makes it, against documents that behave
 * like Foundry's: which drops the lib's hook answers and which it leaves to
 * the sheet they landed on, and that goods dragged between a rider and the
 * mount they ride are moved, never copied.
 *
 * The hook answers synchronously (`false` cancels the sheet's own handling)
 * and makes its writes afterwards, so every test settles before it reads.
 * Flag writes fire `updateActor` the way a live document does, because the
 * attachment index is invalidated from that hook and nowhere else.
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const setProperty = (obj, path, value) => {
  const parts = path.split(".");
  let node = obj;
  for (const key of parts.slice(0, -1)) node = node[key] ??= {};
  node[parts.at(-1)] = value;
  return true;
};

const MODULE = "acks-extras";
const ANIMAL = "acks-extras.animal";

let serial = 0;
const said = { info: [], warn: [] };
const handlers = new Map();
const worldActors = new Coll();
const fire = (name, ...args) => (handlers.get(name) ?? []).map((fn) => fn(...args));

globalThis.acksExtras ??= {};
globalThis.Hooks = {
  on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
  once() {},
  call() {},
  callAll() {},
};
globalThis.ui = { notifications: { info: (text) => said.info.push(text), warn: (text) => said.warn.push(text), error() {} } };
globalThis.foundry = { utils: { setProperty, randomID: () => `r${++serial}`, deepClone: (v) => structuredClone(v) } };
const scenes = new Coll();
globalThis.game = {
  actors: worldActors,
  scenes,
  items: new Coll(),
  packs: [],
  user: { isGM: false, id: "player" },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
};
globalThis.fromUuidSync = (uuid) => {
  const [kind, actorId, , itemId] = String(uuid).split(".");
  return kind === "Actor" ? (worldActors.get(actorId)?.items.get(itemId) ?? null) : null;
};

function makeItem(data, parent) {
  const src = structuredClone(data);
  src._id ??= `i${++serial}`;
  src.flags ??= {};
  const doc = {
    get id() { return src._id; },
    get _id() { return src._id; },
    get name() { return src.name; },
    get type() { return src.type; },
    get system() { return src.system; },
    get flags() { return src.flags; },
    get uuid() { return `${parent.uuid}.Item.${src._id}`; },
    parent,
    getFlag: (scope, key) => src.flags?.[scope]?.[key],
    toObject: () => structuredClone(src),
    update: async (changes) => {
      for (const [key, value] of Object.entries(changes)) setProperty(src, key, value);
      return doc;
    },
  };
  return doc;
}

/** A world actor the seat in play owns unless a test says otherwise. */
function makeActor({ id, name = id, type = "character", items = [] }) {
  const actor = { id, name, type, documentName: "Actor", uuid: `Actor.${id}`, isToken: false, isOwner: true, system: {}, flags: {}, items: new Coll() };
  const add = (data) => {
    const doc = makeItem(data, actor);
    actor.items.set(doc.id, doc);
    return doc;
  };
  actor.createEmbeddedDocuments = async (_kind, datas) => datas.map(add);
  actor.updateEmbeddedDocuments = async (_kind, updates) => {
    for (const { _id, ...changes } of updates) await actor.items.get(_id).update(changes);
    return updates;
  };
  actor.deleteEmbeddedDocuments = async (_kind, ids) => {
    for (const itemId of ids) actor.items.delete(itemId);
  };
  actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];
  actor.setFlag = async (scope, key, value) => {
    actor.flags = { ...actor.flags, [scope]: { ...(actor.flags?.[scope] ?? {}), [key]: value } };
    fire("updateActor", actor, { flags: { [scope]: { [key]: value } } });
    return actor;
  };
  actor.unsetFlag = async (scope, key) => {
    const { [key]: _gone, ...rest } = actor.flags?.[scope] ?? {};
    actor.flags = { ...actor.flags, [scope]: rest };
    fire("updateActor", actor, { flags: { [scope]: { [`-=${key}`]: null } } });
    return actor;
  };
  for (const data of items) add(data);
  worldActors.set(id, actor);
  return actor;
}

const goods = (name, over = {}) => ({ name, type: "item", system: { cost: 1, weight6: 6, quantity: { value: 1, max: 0 } }, ...over });
const coin = (name, qty) => ({ name, type: "money", system: { coppervalue: 100, quantity: qty, quantitybank: 0 } });
const feature = (name) => ({ name, type: "ability", system: { description: "" } });

const names = (actor) => actor.items.map((i) => i.name).sort();
const row = (actor, name) => actor.items.find((i) => i.name === name);
/** Every write the mock makes resolves in a microtask, so one turn of the timer queue outlasts them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const { registerAttachmentIndex, attach, attachedTo } = await import("../scripts/lib/attachment.mjs");
const mount = await import("../scripts/lib/mount.mjs");
const { mountOf, riderOf, ride, dismount, mountActor, registerMountDrop } = mount;

registerAttachmentIndex();
registerMountDrop();

/** Drop `data` on `target`'s sheet: what the hook answered, once its writes have landed. */
const drop = async (target, data) => {
  const [answer] = fire("dropActorSheetData", target, {}, data);
  await settle();
  return answer;
};
const dropActor = (target, actor) => drop(target, { type: "Actor", uuid: actor.uuid });
const dropItem = (target, item) => drop(target, { type: "Item", uuid: item.uuid });

let passed = 0;
const test = async (name, fn) => {
  serial = 0;
  said.info.length = 0;
  said.warn.length = 0;
  worldActors.clear();
  scenes.clear();
  fire("createActor"); // a new world: whatever the index held is gone
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/* -------------------------------------------- */
/*  The drop that seats a rider                  */
/* -------------------------------------------- */

console.log("mount: the drop that seats a rider");

await test("an animal dropped on a character seats the character on it, and says so", async () => {
  const hero = makeActor({ id: "hero" });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  assert.equal(await dropActor(hero, horse), false, "the sheet's own handler, which hires what is dropped on it, does not run");
  assert.equal(mountOf(hero), horse);
  assert.equal(riderOf(horse), hero);
  assert.deepEqual(hero.flags[MODULE].attachedTo, { uuid: "Actor.horse", role: "rider", station: null, kind: null });
  assert.deepEqual(said.info, ["ACKS-LIB.mount.mounted"]);
});

await test("any other actor, and any other sheet, is left to the sheet it landed on", async () => {
  const hero = makeActor({ id: "hero" });
  const wolf = makeActor({ id: "wolf", type: "monster" });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  const friend = makeActor({ id: "friend" });
  assert.equal(await dropActor(hero, wolf), undefined, "a monster on a character is the sheet's to place");
  assert.equal(await dropActor(hero, friend), undefined);
  assert.equal(await dropActor(wolf, horse), undefined, "an animal on a monster's sheet seats nobody");
  assert.equal(await drop(hero, { type: "Actor", uuid: "Actor.gone" }), undefined);
  assert.equal(mountOf(hero), null);
  assert.deepEqual(said.info, []);
});

await test("a seat that does not own the animal is answered with a refusal, never a hire", async () => {
  const hero = makeActor({ id: "hero" });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  horse.isOwner = false;
  assert.equal(await dropActor(hero, horse), false);
  assert.equal(mountOf(hero), null);
  assert.deepEqual([said.info, said.warn], [[], ["ACKS-LIB.mount.notOwner"]]);
});

await test("a second animal replaces the first, and a second rider unseats the first", async () => {
  const hero = makeActor({ id: "hero" });
  const squire = makeActor({ id: "squire" });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  const mule = makeActor({ id: "mule", type: ANIMAL });
  await dropActor(hero, horse);
  await dropActor(hero, mule);
  assert.deepEqual([mountOf(hero), riderOf(horse), riderOf(mule)], [mule, null, hero]);
  await dropActor(squire, mule);
  assert.deepEqual([mountOf(hero), mountOf(squire), riderOf(mule)], [null, mule, squire]);
});

await test("ride says nothing when the binding is refused", async () => {
  const hero = makeActor({ id: "hero" });
  assert.equal(await ride(hero, hero), false);
  assert.deepEqual([said.info, said.warn], [[], ["ACKS-LIB.mount.selfMount"]]);
  const wolf = makeActor({ id: "wolf", type: "monster" });
  assert.equal(await ride(hero, wolf), true, "a monster is ridden through the same call");
  assert.equal(mountOf(hero), wolf);
});

/* -------------------------------------------- */
/*  Goods between a rider and their mount        */
/* -------------------------------------------- */

console.log("mount: goods between a rider and their mount");

await test("goods dragged from the rider to the mount leave the rider", async () => {
  const hero = makeActor({ id: "hero", items: [goods("Rope"), goods("Lantern")] });
  const horse = makeActor({ id: "horse", type: ANIMAL, items: [goods("Saddle")] });
  await ride(hero, horse);
  assert.equal(await dropItem(horse, row(hero, "Rope")), false, "the sheet's own drop, which copies, does not run");
  assert.deepEqual([names(hero), names(horse)], [["Lantern"], ["Rope", "Saddle"]]);
});

await test("and from the mount back to the rider", async () => {
  const hero = makeActor({ id: "hero", items: [goods("Lantern")] });
  const horse = makeActor({ id: "horse", type: ANIMAL, items: [goods("Saddle"), goods("Rope")] });
  await ride(hero, horse);
  assert.equal(await dropItem(hero, row(horse, "Rope")), false);
  assert.deepEqual([names(hero), names(horse)], [["Lantern", "Rope"], ["Saddle"]]);
});

await test("a container goes with what is inside it", async () => {
  const bags = { ...goods("Saddlebags"), _id: "bags", flags: { [MODULE]: { container: {} } } };
  const inBags = { ...goods("Rations"), flags: { [MODULE]: { containedIn: "bags" } } };
  const hero = makeActor({ id: "hero", items: [bags, inBags, goods("Lantern")] });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  await ride(hero, horse);
  assert.equal(await dropItem(horse, row(hero, "Saddlebags")), false);
  assert.deepEqual([names(hero), names(horse)], [["Lantern"], ["Rations", "Saddlebags"]]);
  assert.equal(row(horse, "Rations").getFlag(MODULE, "containedIn"), row(horse, "Saddlebags").id, "still inside, under the container's new id");
});

await test("two actors that do not ride each other are left to the sheet", async () => {
  const hero = makeActor({ id: "hero", items: [goods("Rope")] });
  const squire = makeActor({ id: "squire" });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  const mule = makeActor({ id: "mule", type: ANIMAL });
  await ride(squire, horse);
  assert.equal(await dropItem(horse, row(hero, "Rope")), undefined, "somebody else's mount");
  assert.equal(await dropItem(mule, row(hero, "Rope")), undefined, "an animal nobody rides");
  assert.equal(await dropItem(hero, row(hero, "Rope")), undefined, "a drop within one sheet");
  assert.deepEqual([names(hero), names(horse), names(mule)], [["Rope"], [], []]);
});

await test("once the rider is off, the pair is two actors again", async () => {
  const hero = makeActor({ id: "hero", items: [goods("Rope")] });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  await ride(hero, horse);
  await dismount(hero);
  assert.equal(await dropItem(horse, row(hero, "Rope")), undefined);
  assert.deepEqual([names(hero), names(horse)], [["Rope"], []]);
});

await test("coin, and what is not goods, are left to the sheet", async () => {
  const hero = makeActor({ id: "hero", items: [coin("Gold", 40), feature("Riding")] });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  await ride(hero, horse);
  assert.equal(await dropItem(horse, row(hero, "Gold")), undefined, "coin is moved by the sheet's own rule");
  assert.equal(await dropItem(horse, row(hero, "Riding")), undefined);
  assert.equal(await drop(horse, { type: "Item", uuid: "Actor.hero.Item.gone" }), undefined);
  assert.equal(await drop(horse, { type: "Item" }), undefined);
  assert.deepEqual([names(hero), names(horse)], [["Gold", "Riding"], []]);
});

await test("a seat that owns only one of the two moves nothing", async () => {
  const hero = makeActor({ id: "hero", items: [goods("Rope")] });
  const horse = makeActor({ id: "horse", type: ANIMAL });
  await ride(hero, horse);
  horse.isOwner = false;
  assert.equal(await dropItem(horse, row(hero, "Rope")), false, "answered, so nothing is copied either");
  assert.deepEqual([names(hero), names(horse)], [["Rope"], []]);
  assert.equal(said.warn.length, 1);
});

/* -------------------------------------------- */
/*  An unlinked token in the carry               */
/* -------------------------------------------- */

console.log("mount: an unlinked token in the carry");

const uuids = (actors) => actors.map((a) => a.uuid);

/**
 * An unlinked token of `base`, as core stores one: its own flags in the
 * delta's source, its actor reading the base's flags under the delta's and
 * writing the delta, and that write calling `updateActor` the way
 * `ActorDelta#_onUpdate` does. `bound` puts a binding in the delta before the
 * token exists, as a paste or a redeploy does. Placed silently: a test fires
 * `createToken` when the hook is the subject.
 */
function placeToken(base, { id, scene = "s1", bound = null }) {
  if (!scenes.has(scene)) scenes.set(scene, { id: scene, uuid: `Scene.${scene}`, tokens: new Coll() });
  const host = scenes.get(scene);
  const delta = { flags: bound ? { [MODULE]: { attachedTo: { station: null, kind: null, ...bound } } } : {} };
  const token = { id, uuid: `${host.uuid}.Token.${id}`, actorId: base.id, actorLink: false, _source: { delta }, parent: host };
  const own = (scope, key) => delta.flags[scope] && key in delta.flags[scope];
  const actor = {
    id: base.id,
    name: `${base.name} (${id})`,
    type: base.type,
    documentName: "Actor",
    uuid: `${token.uuid}.Actor.${base.id}`,
    isToken: true,
    isOwner: true,
    token,
    system: {},
    items: new Coll(),
    getFlag: (scope, key) => (own(scope, key) ? delta.flags[scope][key] : base.getFlag(scope, key)),
    setFlag: async (scope, key, value) => {
      delta.flags = { ...delta.flags, [scope]: { ...(delta.flags[scope] ?? {}), [key]: value } };
      fire("updateActor", actor, { flags: { [scope]: { [key]: value } } });
      return actor;
    },
    unsetFlag: async (scope, key) => {
      const { [key]: _gone, ...rest } = delta.flags[scope] ?? {};
      delta.flags = { ...delta.flags, [scope]: rest };
      fire("updateActor", actor, { flags: { [scope]: { [`-=${key}`]: null } } });
      return actor;
    },
  };
  Object.defineProperty(token, "actor", { get: () => (token.actorLink ? base : actor) });
  host.tokens.set(id, token);
  return token;
}

await test("an unlinked token riding a world mount is the mount's rider", async () => {
  const cavalier = makeActor({ id: "cavalier", type: "monster" });
  const steed = makeActor({ id: "steed", type: ANIMAL });
  const token = placeToken(cavalier, { id: "t1" });
  assert.equal(await mountActor(token.actor, steed), true);
  assert.equal(mountOf(token.actor), steed);
  assert.equal(riderOf(steed), token.actor, "found from the mount's side, as the token's own actor");
  assert.equal(mountOf(cavalier), null, "the world actor rides nothing");
});

await test("each placed copy that boards is its own passenger, and the base is none of them", async () => {
  const goblin = makeActor({ id: "goblin", type: "monster" });
  const wagon = makeActor({ id: "wagon", type: "acks-extras.vehicle" });
  const a = placeToken(goblin, { id: "ta" });
  const b = placeToken(goblin, { id: "tb", scene: "s2" });
  await attach(a.actor, wagon, "passenger");
  await attach(b.actor, wagon, "passenger");
  assert.deepEqual(uuids(attachedTo(wagon, "passenger")), [a.actor.uuid, b.actor.uuid]);
});

await test("an attached world actor counts once, however many of its tokens are placed", async () => {
  const ox = makeActor({ id: "ox", type: "monster" });
  const wagon = makeActor({ id: "wagon", type: "acks-extras.vehicle" });
  await attach(ox, wagon, "draft");
  for (const id of ["t1", "t2", "t3"]) placeToken(ox, { id });
  assert.deepEqual(attachedTo(wagon, "draft"), [ox], "the copies inherit the binding and are not counted for it");
});

await test("a new rider unseats a token rider, and the token's own binding goes", async () => {
  const cavalier = makeActor({ id: "cavalier", type: "monster" });
  const hero = makeActor({ id: "hero" });
  const steed = makeActor({ id: "steed", type: ANIMAL });
  const token = placeToken(cavalier, { id: "t1" });
  await mountActor(token.actor, steed);
  await mountActor(hero, steed);
  assert.equal(riderOf(steed), hero);
  assert.equal(token._source.delta.flags[MODULE].attachedTo, undefined, "written to the delta, where the binding was");
  assert.equal(mountOf(token.actor), null);
});

await test("a token or a scene that arrives already bound is found without a reload", async () => {
  const cavalier = makeActor({ id: "cavalier", type: "monster" });
  const steed = makeActor({ id: "steed", type: ANIMAL });
  const mule = makeActor({ id: "mule", type: ANIMAL });
  assert.equal(riderOf(steed), null, "the index is built before either arrives");
  const pasted = placeToken(cavalier, { id: "t1", bound: { uuid: steed.uuid, role: "rider" } });
  fire("createToken", pasted, {}, "gm");
  assert.equal(riderOf(steed), pasted.actor);
  assert.equal(riderOf(mule), null);
  const imported = placeToken(cavalier, { id: "t2", scene: "s9", bound: { uuid: mule.uuid, role: "rider" } });
  fire("createScene", scenes.get("s9"), {}, "gm");
  assert.equal(riderOf(mule), imported.actor);
});

await test("a token linked since is its base actor again, and not a second copy of it", async () => {
  const goblin = makeActor({ id: "goblin", type: "monster" });
  const wagon = makeActor({ id: "wagon", type: "acks-extras.vehicle" });
  await attach(goblin, wagon, "passenger");
  const token = placeToken(goblin, { id: "t1" });
  await attach(token.actor, wagon, "passenger");
  assert.deepEqual(uuids(attachedTo(wagon)), [goblin.uuid, token.actor.uuid]);
  token.actorLink = true;
  assert.deepEqual(attachedTo(wagon), [goblin], "an entry the index still holds resolves to the base and is dropped");
  fire("updateToken", token, { actorLink: true }, {}, "gm");
  assert.deepEqual(attachedTo(wagon), [goblin]);
});

await test("a binding written through the token's own document is found", async () => {
  const cavalier = makeActor({ id: "cavalier", type: "monster" });
  const steed = makeActor({ id: "steed", type: ANIMAL });
  const token = placeToken(cavalier, { id: "t1" });
  assert.equal(riderOf(steed), null);
  const binding = { uuid: steed.uuid, role: "rider", station: null, kind: null };
  token._source.delta.flags = { [MODULE]: { attachedTo: binding } };
  fire("updateToken", token, { delta: { flags: { [MODULE]: { attachedTo: binding } } } }, {}, "gm");
  assert.equal(riderOf(steed), token.actor);
});

await test("a deleted mount frees its token rider, on the primary GM's client", async () => {
  const cavalier = makeActor({ id: "cavalier", type: "monster" });
  const steed = makeActor({ id: "steed", type: ANIMAL });
  const token = placeToken(cavalier, { id: "t1" });
  await mountActor(token.actor, steed);
  const users = game.users;
  game.users = { activeGM: { isSelf: true } };
  try {
    worldActors.delete(steed.id);
    fire("deleteActor", steed, {}, "gm");
    await settle();
  } finally {
    game.users = users;
  }
  assert.equal(token._source.delta.flags[MODULE].attachedTo, undefined);
});
console.log(`test-mount: ${passed} checks passed`);
