/**
 * Henchmen engine seams under stand-in Foundry globals: the event card's
 * button attribute against the listener that reads it, the bounds a hireling's
 * scores are held to (read off the system's data model per actor type), a
 * monster hireling changing employer, the repair pass that prunes a stale
 * monster list, and the deletion cleanup beside a delete that names several
 * actors. Names, ids and ranges are invented.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/* -------------------------------------------- */
/*  Stand-in world                              */
/* -------------------------------------------- */

const MODULE = "acks-extras";
const hooks = new Map();
const announced = [];
globalThis.Hooks = {
  on: (name, fn) => hooks.set(name, fn),
  once() {},
  call() {},
  callAll: (name, data) => announced.push([name, data?.employer?.id ?? null]),
};
globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: {} },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
  utils: {},
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.libWrapper = undefined;

/** A world collection: a Map of documents with Foundry's `contents`. */
class World extends Map {
  get contents() {
    return [...this.values()];
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
}
const actors = new World();
globalThis.game = {
  actors,
  user: { isGM: true, id: "gm" },
  users: { activeGM: { id: "gm", isGM: true, isSelf: true }, find: () => null },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: () => undefined },
  time: { worldTime: 0 },
};

/** A document over a plain source: flags, system, and updates that write back. */
function makeActor({ id, type = "character", system = {}, flags = {} }) {
  const src = { system: structuredClone(system), flags: structuredClone(flags) };
  const writes = [];
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    writes,
    get system() {
      return src.system;
    },
    getFlag: (scope, key) => src.flags[scope]?.[key],
    setFlag: async (scope, key, value) => {
      writes.push(["flag", key]);
      (src.flags[scope] ??= {})[key] = structuredClone(value);
    },
    update: async (data) => {
      writes.push(["update", Object.keys(data)]);
      if (!actors.has(id)) throw new Error(`${id} no longer exists`);
      for (const [path, value] of Object.entries(data)) {
        const parts = path.split(".");
        let node = src;
        for (const p of parts.slice(0, -1)) node = node[p] ??= {};
        node[parts.at(-1)] = value;
      }
    },
  };
  actors.set(id, actor);
  return actor;
}

/** A data model whose schema answers `getField` for the dotted paths it was given. */
const modelWith = (fields) => ({
  schema: { getField: (path) => (path in fields ? fields[path] : undefined) },
});
globalThis.CONFIG = {
  Actor: {
    dataModels: {
      character: modelWith({ "retainer.loyalty": { min: -3, max: 5 }, "details.morale": { min: -2, max: 6 } }),
      monster: modelWith({ "retainer.loyalty": { min: -3, max: 5 }, "details.morale": { min: -7, max: 2 } }),
      unbounded: modelWith({ "retainer.loyalty": {} }),
    },
  },
};

/* -------------------------------------------- */
/*  The event card's buttons                    */
/* -------------------------------------------- */

const { MODULE_ID } = await import("../scripts/henchmen/constants.mjs");
const { registerCardAction, bindCardListeners } = await import("../scripts/henchmen/chat/cards.mjs");

console.log("henchmen: the event card");
await test("a button the template writes is the button the listener binds and routes", async () => {
  const template = readFileSync(new URL("../templates/henchmen/chat/event-card.hbs", import.meta.url), "utf8");
  const attributes = [...template.matchAll(/\s(data-[\w-]+-action)=/g)].map((m) => m[1]);
  assert.deepEqual(attributes, [`data-${MODULE_ID}-action`], "one action attribute, named for the module");

  // A root that answers the selector the listener asks with the one button the template holds.
  const dataset = {
    [attributes[0].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: "doThing",
    payload: JSON.stringify({ target: "t1" }),
  };
  const clicks = [];
  const button = { dataset, addEventListener: (_type, fn) => clicks.push(fn) };
  const root = { nodeType: 1, querySelectorAll: (selector) => (selector === `[${attributes[0]}]` ? [button] : []) };
  const seen = [];
  registerCardAction("doThing", async (payload) => seen.push(payload));
  bindCardListeners(root);
  assert.equal(clicks.length, 1, "the listener found the button");
  await clicks[0]({ preventDefault() {} });
  assert.deepEqual(seen, [{ target: "t1" }], "and a click reaches the registered handler with its payload");
});

/* -------------------------------------------- */
/*  Score bounds                                */
/* -------------------------------------------- */

const adapter = await import("../scripts/henchmen/acks-adapter.mjs");
const { effectiveMoraleFor, effectiveLoyaltyFor } = await import("../scripts/henchmen/engine/events.mjs");

console.log("henchmen: score bounds come from the actor type's data model");
await test("each type answers its own range; a side the field does not bound stays open", () => {
  assert.deepEqual(adapter.loyaltyBounds("character"), { min: -3, max: 5 });
  assert.deepEqual(adapter.moraleBounds("character"), { min: -2, max: 6 });
  assert.deepEqual(adapter.moraleBounds("monster"), { min: -7, max: 2 }, "a monster's morale is bounded apart");
  assert.deepEqual(adapter.loyaltyBounds("unbounded"), { min: null, max: null });
  assert.deepEqual(adapter.moraleBounds("unbounded"), { min: null, max: null }, "a field the model lacks bounds nothing");
  assert.deepEqual(adapter.loyaltyBounds("unknownType"), { min: null, max: null }, "a type with no model bounds nothing");
});
await test("without a CONFIG the bounds are open and nothing throws", () => {
  const saved = globalThis.CONFIG;
  delete globalThis.CONFIG;
  try {
    assert.deepEqual(adapter.moraleBounds("monster"), { min: null, max: null });
  } finally {
    globalThis.CONFIG = saved;
  }
});
await test("a monster hireling's morale is held to the monster's range, a character's to the character's", () => {
  const record = { morale: { base: -5, permanents: [] } };
  const flags = { [MODULE]: { record } };
  const monster = makeActor({ id: "beast", type: "monster", system: { details: { morale: -5 } }, flags });
  const person = makeActor({ id: "hand", type: "character", system: { details: { morale: -5 } }, flags });
  assert.equal(effectiveMoraleFor(monster), -5, "inside the monster's floor");
  assert.equal(effectiveMoraleFor(person), -2, "past the character's floor");
});
await test("effective loyalty is held to the actor type's range", () => {
  const person = makeActor({ id: "hand2", type: "character", flags: { [MODULE]: { record: { loyalty: { start: 9, permanents: [] } } } } });
  assert.equal(effectiveLoyaltyFor(person), 5);
});
await test("a written loyalty is held to the range too", async () => {
  const person = makeActor({ id: "hand3", type: "character" });
  await adapter.setLoyalty(person, 40);
  assert.equal(person.system.retainer.loyalty, 5);
  await adapter.setLoyalty(person, -40);
  assert.equal(person.system.retainer.loyalty, -3);
});

/* -------------------------------------------- */
/*  A monster hireling changing employer        */
/* -------------------------------------------- */

const { assignMonsterEmployer } = await import("../scripts/henchmen/engine/monster-employer.mjs");

/** An employer, a second one, and a monster on the first's list, its record and manager naming the first. */
function twoEmployers() {
  actors.clear();
  const first = makeActor({ id: "first", flags: { [MODULE]: { monsterHenchmenList: ["beast"] } } });
  const second = makeActor({ id: "second" });
  const beast = makeActor({
    id: "beast",
    type: "monster",
    system: { retainer: { enabled: true, managerid: "first" } },
    flags: { [MODULE]: { record: { employerUuid: "Actor.first", loyalty: { start: 0, permanents: [] } } } },
  });
  return { first, second, beast };
}

console.log("henchmen: a monster hireling changes employer");
await test("the monster leaves the old list and joins the new one, and its manager and record follow", async () => {
  const { first, second, beast } = twoEmployers();
  const { previous } = await assignMonsterEmployer(beast, second);
  assert.deepEqual(first.getFlag(MODULE, "monsterHenchmenList"), [], "off the first employer's list");
  assert.deepEqual(second.getFlag(MODULE, "monsterHenchmenList"), ["beast"], "on the second's");
  assert.equal(beast.system.retainer.managerid, "second");
  assert.equal(beast.getFlag(MODULE, "record").employerUuid, "Actor.second");
  assert.deepEqual(previous.map((a) => a.id), ["first"], "the former employer is handed back to be announced");
});
await test("a monster already settled with its employer is written nowhere", async () => {
  const { first, beast } = twoEmployers();
  const { previous } = await assignMonsterEmployer(beast, first);
  assert.deepEqual([first.writes, beast.writes, previous], [[], [], []]);
});
await test("a monster held on two lists is taken off every one but the new employer's", async () => {
  const { first, second, beast } = twoEmployers();
  const third = makeActor({ id: "third", flags: { [MODULE]: { monsterHenchmenList: ["other", "beast"] } } });
  const { previous } = await assignMonsterEmployer(beast, second);
  assert.deepEqual(third.getFlag(MODULE, "monsterHenchmenList"), ["other"], "only the monster is removed");
  assert.deepEqual(previous.map((a) => a.id).sort(), ["first", "third"]);
  assert.deepEqual(first.getFlag(MODULE, "monsterHenchmenList"), []);
});
await test("a monster with no record yet gets lists and manager, and no record is invented", async () => {
  const { second, beast } = twoEmployers();
  await beast.setFlag(MODULE, "record", undefined);
  await assignMonsterEmployer(beast, second);
  assert.equal(beast.getFlag(MODULE, "record"), undefined);
  assert.equal(beast.system.retainer.managerid, "second");
});

console.log("henchmen: the monster sheet's Serve as henchman goes through the same owner");
const { ACTIONS: monsterActions } = await import("../scripts/monsters/monster-actions.mjs");
const { HOOKS } = await import("../scripts/henchmen/constants.mjs");
/** Press Serve as henchman on `monster`, the dialog answering `pick`; the roster announcements it made. */
async function serveFromSheet(monster, pick) {
  foundry.utils.escapeHTML = (s) => s;
  foundry.applications.api.DialogV2 = { prompt: async () => pick };
  announced.length = 0;
  await monsterActions.serveAsHenchman.call({ actor: monster });
  return announced.filter(([name]) => name === HOOKS.ROSTER_CHANGED).map(([, id]) => id);
}
await test("a monster served under a second employer leaves the first's list and lands on the second's, record included", async () => {
  const { first, second, beast } = twoEmployers();
  const told = await serveFromSheet(beast, "second");
  assert.deepEqual(first.getFlag(MODULE, "monsterHenchmenList"), [], "off the first employer's list");
  assert.deepEqual(second.getFlag(MODULE, "monsterHenchmenList"), ["beast"], "on the second's");
  assert.equal(beast.system.retainer.managerid, "second");
  assert.equal(beast.getFlag(MODULE, "record").employerUuid, "Actor.second");
  assert.deepEqual(told.sort(), ["first", "second"], "both rosters are announced");
});
await test("served from the sheet, core's own henchmenList is left alone", async () => {
  const { second, beast } = twoEmployers();
  await serveFromSheet(beast, "second");
  assert.equal(second.system.henchmenList, undefined);
});
await test("a monster in nobody's service is switched on and listed under its first employer", async () => {
  actors.clear();
  const first = makeActor({ id: "first" });
  const beast = makeActor({ id: "beast", type: "monster", system: { retainer: { enabled: false, managerid: "" } } });
  const told = await serveFromSheet(beast, "first");
  assert.equal(beast.system.retainer.enabled, true);
  assert.deepEqual(first.getFlag(MODULE, "monsterHenchmenList"), ["beast"]);
  assert.equal(beast.system.retainer.managerid, "first");
  assert.deepEqual(told, ["first"]);
});

/* -------------------------------------------- */
/*  Deletion cleanup                            */
/* -------------------------------------------- */

const { registerDeletionCleanup } = await import("../scripts/henchmen/repair.mjs");
registerDeletionCleanup();
const onDelete = hooks.get("deleteActor");
const errors = [];
const consoleError = console.error;
console.error = (...args) => errors.push(args.map(String).join(" "));

console.log("henchmen: deleting an employer beside its hirelings");
await test("a hireling deleted in the same operation is never updated", async () => {
  actors.clear();
  const boss = makeActor({ id: "boss", system: { henchmenList: ["hand"] } });
  const hand = makeActor({ id: "hand", system: { retainer: { managerid: "boss" } } });
  // The worst case: the co-deleted peer is still in the collection when the hook starts.
  actors.delete("boss");
  await onDelete(boss, { ids: ["boss", "hand"] }, "gm");
  assert.deepEqual(hand.writes, [], "named by the operation, so skipped");
  assert.deepEqual(errors, []);
});
await test("a hireling the collection no longer holds is never updated", async () => {
  actors.clear();
  const boss = makeActor({ id: "boss", system: { henchmenList: ["hand"] } });
  const hand = makeActor({ id: "hand", system: { retainer: { managerid: "boss" } } });
  const kept = makeActor({ id: "kept", system: { retainer: { managerid: "boss" } } });
  actors.delete("boss");
  actors.delete("hand");
  await onDelete(boss, {}, "gm");
  assert.deepEqual([hand.writes, kept.writes.length], [[], 1], "the gone one is skipped and the one still there is detached");
  assert.equal(kept.system.retainer.managerid, "");
  assert.deepEqual(errors, []);
});
await test("a hireling deleted while an earlier write is awaited is skipped, not logged", async () => {
  actors.clear();
  const boss = makeActor({ id: "boss" });
  const first = makeActor({ id: "first", system: { retainer: { managerid: "boss" } } });
  const second = makeActor({ id: "second", system: { retainer: { managerid: "boss" } } });
  actors.delete("boss");
  const update = first.update;
  first.update = async (data) => {
    await update(data);
    actors.delete("second"); // another operation lands while this write is in flight
  };
  await onDelete(boss, {}, "gm");
  assert.deepEqual(second.writes, [], "never written");
  assert.deepEqual(errors, []);
});
await test("a write that fails because its target went meanwhile is not an error; any other still is", async () => {
  actors.clear();
  const boss = makeActor({ id: "boss" });
  const racing = makeActor({ id: "racing", system: { retainer: { managerid: "boss" } } });
  actors.delete("boss");
  racing.update = async () => {
    actors.delete("racing");
    throw new Error("gone");
  };
  await onDelete(boss, {}, "gm");
  assert.deepEqual(errors, [], "deleted in flight");
  const stuck = makeActor({ id: "stuck", system: { retainer: { managerid: "boss" } } });
  stuck.update = async () => {
    throw new Error("refused");
  };
  await onDelete(boss, {}, "gm");
  assert.equal(errors.length, 1, "a failure with the target still there is reported");
});
console.error = consoleError;

console.log(`henchmen engine: ${passed} passed`);
