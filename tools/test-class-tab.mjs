/**
 * The character sheet's Class tab model (`buildClassTab`): when the tab reads
 * the character as bound to a class document. Stand-in actors and classes;
 * every name is invented. What this pins: `bound` is true only where the
 * actor's class flag, which only the class picker's apply writes, names the
 * class the tab resolved (by uuid, or by key); a class found only through the
 * free-text `details.class` name leaves `bound` false while the typed name
 * still shows and the class still resolves for the rest of the tab; no class
 * at all is unbound with the typed name or "none". Rendering is the live walk's.
 */
import assert from "node:assert/strict";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

class Stub {}
globalThis.game = {
  items: [],
  i18n: { localize: (k) => k, format: (k) => k },
  settings: { get: () => ({}) },
  user: {},
  users: { get: () => null, find: () => null, filter: () => [], contents: [] },
};
globalThis.fromUuidSync = () => null;
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: Stub, TypeDataModel: Stub },
  data: { fields: {} },
  utils: { getProperty: (o, p) => String(p).split(".").reduce((a, k) => a?.[k], o) },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: {} },
};

const { buildClassTab } = await import("../scripts/character-sheet/tabs/class.mjs");
const { CLASS_TYPE } = await import("../scripts/classes/constants.mjs");

const classDoc = { documentName: "Item", uuid: "Item.tc1", name: "Testclass", img: "t.png", type: CLASS_TYPE, system: { key: "testclass", casting: [] } };
const actorOf = ({ typed = "", flag } = {}) => ({
  system: { details: { class: typed, level: 1 } },
  getFlag: (scope, key) => (scope === "acks-extras" && key === "classes" ? flag : undefined),
  isOwner: true,
});

game.items = [classDoc];
globalThis.fromUuidSync = (uuid) => (uuid === classDoc.uuid ? classDoc : null);

test("a class flag naming the class by uuid is bound", () => {
  const tab = buildClassTab(actorOf({ typed: "Testclass", flag: { uuid: "Item.tc1", key: "testclass" } }));
  assert.equal(tab.bound, true);
  assert.equal(tab.className, "Testclass");
  assert.equal(tab.uuid, "Item.tc1");
});

test("a class flag naming the class by key alone is bound", () => {
  const tab = buildClassTab(actorOf({ typed: "Testclass", flag: { key: "testclass" } }));
  assert.equal(tab.bound, true);
});

test("a class found only by its typed name is not bound, and still shows its name", () => {
  const tab = buildClassTab(actorOf({ typed: "Testclass" }));
  assert.equal(tab.bound, false);
  assert.equal(tab.className, "Testclass");
  assert.equal(tab.uuid, "Item.tc1");
});

test("a class flag naming another class does not bind the typed name's class", () => {
  const tab = buildClassTab(actorOf({ typed: "Testclass", flag: { uuid: "Item.other", key: "other" } }));
  assert.equal(tab.bound, false);
});

test("a flag with neither uuid nor key binds nothing", () => {
  assert.equal(buildClassTab(actorOf({ typed: "Testclass", flag: { paths: {} } })).bound, false);
});

test("no class is unbound, with the typed name kept or blank", () => {
  const typed = buildClassTab(actorOf({ typed: "Nothing printed" }));
  assert.equal(typed.bound, false);
  assert.equal(typed.className, "Nothing printed");
  const blank = buildClassTab(actorOf());
  assert.equal(blank.bound, false);
  assert.equal(blank.className, "");
  assert.equal(blank.uuid, null);
});

console.log(`test-class-tab: ${passed} assertion groups passed.`);
