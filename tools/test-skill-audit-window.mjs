/**
 * The Skill audit window's mechanics (scripts/formation/skill-audit.mjs): an id
 * of each party's own, the opening size at the seat's type size, no declared
 * drag corner, the watch that draws the window again when its party's roster or
 * a member's ability item changes (and for nothing else), and the keyboard
 * focus that comes back after a press or a select change.
 *
 * Stand-ins for the application base and the DOM; every id and name is
 * invented. What the page then does with those classes and parts — the scroll
 * kept across a render, two audits open together — is the live walk's
 * (docs/formation/TESTING.md, "The audit roll").
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
const hooks = new Map();
let hookSerial = 0;
globalThis.Hooks = {
  on(name, fn) { const id = ++hookSerial; (hooks.get(name) ?? hooks.set(name, new Map()).get(name)).set(id, fn); return id; },
  off(name, id) { hooks.get(name)?.delete(id); },
  once() {}, call() {}, callAll() {},
};
const fire = (name, ...args) => { for (const fn of [...(hooks.get(name)?.values() ?? [])]) fn(...args); };
const hooked = () => [...hooks.values()].reduce((n, m) => n + m.size, 0);

const formations = {};
const settings = { fontScale: 14, formations };
globalThis.game = {
  user: { id: "gm1", isGM: true },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: (_scope, key) => settings[key] },
  actors: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuidSync = (uuid) => items.get(uuid) ?? null;
globalThis.document = {};
globalThis.CONFIG = {};
class Stub {}

/** A minimal ApplicationV2: options from the class's defaults, an id, a render count. */
class AppBase {
  constructor(options = {}) {
    const defaults = this.constructor.DEFAULT_OPTIONS;
    this.options = this._initializeApplicationOptions({ ...defaults, ...options, position: { ...defaults.position, ...options.position } });
    this.id = this.options.id ?? "app";
    this.rendered = true;
    this.renders = 0;
    this.element = null;
  }
  _initializeApplicationOptions(options) { return options; }
  async _onFirstRender() {}
  async _onClose() {}
  _attachFrameListeners() {}
  async _postRender() {}
  async _onRender() {}
  async _prepareContext() { return {}; }
  render() { this.renders += 1; }
}

globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: {
    debounce: (fn) => fn,
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    escapeHTML: (s) => String(s),
  },
  applications: { api: { ApplicationV2: AppBase, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

const { default: SkillAuditApp, auditWindowId } = await import("../scripts/formation/skill-audit.mjs");
const { isModuleWindow } = await import("../scripts/lib/window-resize.mjs");

/* --- fixtures ---------------------------------------------------------------- */
const items = new Map();
const actor = (id) => { const a = { id, name: id, items: [] }; game.actors.set(id, a); return a; };
const roster = (...ids) => ({ members: ids.map((id) => ({ actorId: id })) });
const ability = (parent, type = "ability") => ({ type, parent });
const setFormation = (id, record) => { formations[id] = record; };

actor("alpha1"); actor("alpha2"); actor("beta1"); actor("stray");
setFormation("fA", roster("alpha1", "alpha2"));
setFormation("fB", roster("beta1"));

/** An app opened as a party's Judge opens it, past its first render. */
async function open(formationId) {
  const app = new SkillAuditApp({ formationId });
  await app._onFirstRender({}, {});
  return app;
}

/** A DOM stand-in: a root holding action buttons and fields, and a document whose focus a test sets. */
function fakeDom() {
  const body = { nodeType: 1 };
  const doc = { body, documentElement: { nodeType: 1 }, activeElement: body };
  const mk = (dataset) => {
    const el = { nodeType: 1, dataset, disabled: false, listeners: {} };
    el.closest = (sel) => (sel === "[data-action]" && "action" in dataset ? el : null);
    el.focus = () => { doc.activeElement = el; };
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    return el;
  };
  const buttons = [mk({ action: "toggleAbility", itemUuid: "Actor.a.Item.1" })];
  const selects = [mk({ itemUuid: "Actor.a.Item.1", field: "checkKey" }), mk({ itemUuid: "Actor.a.Item.2", field: "checkKey" })];
  const root = { nodeType: 1, ownerDocument: doc, listeners: [] };
  root.contains = (el) => el === root || buttons.includes(el) || selects.includes(el);
  root.querySelectorAll = (sel) => (sel === "[data-action]" ? buttons : sel === "[data-item-uuid][data-field]" ? selects : []);
  root.addEventListener = (type, fn, opts) => { root.listeners.push({ type, fn, opts }); };
  return { doc, root, buttons, selects };
}

/* --- the id ------------------------------------------------------------------ */
await ok("each party's audit takes an id of its own", async () => {
  const a = new SkillAuditApp({ formationId: "fA" });
  const b = new SkillAuditApp({ formationId: "fB" });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, auditWindowId("fA"));
  assert.equal(b.id, auditWindowId("fB"));
  assert.ok(a.id.includes("fA") && !a.id.includes("fB"));
  assert.equal(auditWindowId("fA"), auditWindowId("fA"), "the same party names the same id");
});

await ok("an audit opened with no party falls back to the bare root id, and an explicit id wins", async () => {
  assert.equal(new SkillAuditApp().id, auditWindowId());
  assert.equal(new SkillAuditApp({ formationId: "fA", id: "custom" }).id, "custom");
});

/* --- the window's declaration ------------------------------------------------- */
await ok("the opening size follows the seat's type size", async () => {
  settings.fontScale = 14;
  const base = new SkillAuditApp({ formationId: "fA" });
  const { width, height } = SkillAuditApp.DEFAULT_OPTIONS.position;
  assert.deepEqual([base.options.position.width, base.options.position.height], [width, height]);
  settings.fontScale = 28;
  const big = new SkillAuditApp({ formationId: "fA" });
  assert.deepEqual([big.options.position.width, big.options.position.height], [width * 2, height * 2]);
  settings.fontScale = 14;
});

await ok("the drag corner is the lib hook's: no resizable declared, a module class named", async () => {
  const opts = SkillAuditApp.DEFAULT_OPTIONS;
  assert.equal("resizable" in opts.window, false);
  assert.equal(isModuleWindow({ options: opts }), true);
  assert.equal(opts.classes.includes("acks-extras-scroll"), false, "the scroller is the body part's root, not the content box");
});

/* --- the watch ---------------------------------------------------------------- */
await ok("opening registers the watch and closing removes every hook", async () => {
  const before = hooked();
  const app = await open("fA");
  assert.equal(hooked() - before, 5);
  await app._onClose({});
  assert.equal(hooked(), before);
});

await ok("a roster change draws the window again; a write that leaves the roster alone does not", async () => {
  const app = await open("fA");
  const setting = { key: "acks-extras.formations" };
  fire("updateSetting", setting);
  assert.equal(app.renders, 0, "an unchanged roster draws nothing");
  setFormation("fA", { members: [{ actorId: "alpha1" }, { actorId: "alpha2" }], clock: { turns: 3 } });
  fire("updateSetting", setting);
  assert.equal(app.renders, 0, "a clock tick draws nothing");
  setFormation("fA", roster("alpha1", "alpha2", "stray"));
  fire("updateSetting", setting);
  assert.equal(app.renders, 1, "a member joined");
  fire("updateSetting", setting);
  assert.equal(app.renders, 1, "the roster is read once per change");
  setFormation("fA", roster("alpha1", "stray"));
  fire("createSetting", setting);
  assert.equal(app.renders, 2, "a member left");
  fire("updateSetting", { key: "acks-extras.somethingElse" });
  setFormation("fA", roster("stray"));
  fire("updateSetting", { key: "acks-extras.somethingElse" });
  assert.equal(app.renders, 2, "another setting's key is not the record");
  setFormation("fA", roster("alpha1", "alpha2"));
  await app._onClose({});
});

await ok("an ability item of a member is a reason to draw again, in each of its three writes", async () => {
  const app = await open("fA");
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    const before = app.renders;
    fire(hook, ability(game.actors.get("alpha2")));
    assert.equal(app.renders, before + 1, hook);
  }
  await app._onClose({});
});

await ok("an unrelated actor's item, or a member's item of another type, draws nothing", async () => {
  const app = await open("fA");
  fire("createItem", ability(game.actors.get("stray")));
  fire("updateItem", ability(game.actors.get("beta1")));
  fire("deleteItem", ability(game.actors.get("alpha1"), "weapon"));
  fire("createItem", { type: "ability", parent: null });
  fire("createItem", undefined);
  assert.equal(app.renders, 0);
  await app._onClose({});
});

await ok("two parties' audits open together each draw for their own members only", async () => {
  const a = await open("fA");
  const b = await open("fB");
  fire("updateItem", ability(game.actors.get("alpha1")));
  assert.deepEqual([a.renders, b.renders], [1, 0]);
  fire("updateItem", ability(game.actors.get("beta1")));
  assert.deepEqual([a.renders, b.renders], [1, 1]);
  await a._onClose({});
  fire("updateItem", ability(game.actors.get("alpha1")));
  assert.deepEqual([a.renders, b.renders], [1, 1], "a closed audit is no longer told");
  await b._onClose({});
});

await ok("a roster with a summon member watches the world actor it stands for", async () => {
  actor("wolf");
  setFormation("fC", { members: [{ actorId: "minted1", baseActorId: "wolf" }, { blank: true }] });
  const app = await open("fC");
  fire("createItem", ability(game.actors.get("wolf")));
  assert.equal(app.renders, 1);
  await app._onClose({});
});

/* --- focus -------------------------------------------------------------------- */
await ok("focus returns to the control a press re-rendered", async () => {
  const app = new SkillAuditApp({ formationId: "fA" });
  const dom = fakeDom();
  app.element = dom.root;
  app._attachFrameListeners();
  const click = dom.root.listeners.find((l) => l.type === "click");
  assert.ok(click && click.opts?.capture === true, "a capture-phase click listener on the root");
  const [button] = dom.buttons;
  dom.doc.activeElement = button;
  click.fn({ target: button });
  dom.doc.activeElement = dom.doc.body;
  await app._postRender({}, {});
  assert.equal(dom.doc.activeElement, button);
});

await ok("focus returns to the select a change re-rendered, and stays where the user has gone", async () => {
  const app = new SkillAuditApp({ formationId: "fA" });
  const dom = fakeDom();
  app.element = dom.root;
  const item = { setFlag: async () => {}, unsetFlag: async () => {}, getFlag: () => undefined };
  items.set("Actor.a.Item.2", item);
  await app._onRender({}, {});
  const [first, second] = dom.selects;
  dom.doc.activeElement = second;
  await second.listeners.change({ currentTarget: Object.assign(second, { value: "search" }) });
  dom.doc.activeElement = dom.doc.body;
  await app._postRender({}, {});
  assert.equal(dom.doc.activeElement, second, "the select the change was made in");
  dom.doc.activeElement = dom.doc.body;
  await app._postRender({}, {});
  assert.equal(dom.doc.activeElement, second, "a second render of the same write");
  dom.doc.activeElement = first;
  await app._postRender({}, {});
  dom.doc.activeElement = dom.doc.body;
  await app._postRender({}, {});
  assert.equal(dom.doc.activeElement, dom.doc.body, "a render that finds focus held ends the memory");
  items.delete("Actor.a.Item.2");
});

console.log(`\n${passed} checks passed`);
