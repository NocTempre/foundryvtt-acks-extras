/**
 * The Skill audit window's mechanics (scripts/formation/skill-audit.mjs): an id
 * of each party's own, the opening size at the seat's type size, no declared
 * drag corner, the watch that draws the window again when its party's roster or
 * a member's ability item changes (and for nothing else), and the keyboard
 * focus that comes back after a press or a select change, and the figures and
 * names the window and the Skill tab draw (resolutions with their cited
 * tooltips, the Used-for names, the Sheet target, the progression rows).
 *
 * Stand-ins for the application base and the DOM; every id and name is
 * invented. What the page then does with those classes and parts — the scroll
 * kept across a render, two audits open together — is the live walk's
 * (docs/formation/TESTING.md, "The audit roll").
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- the real strings, so a key that does not exist fails here ------------- */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => (key in LANG ? LANG[key] : key.split(".").slice(1).reduce((at, part) => at?.[part], LANG[key.split(".")[0]]));
const format = (key, data = {}) => {
  const text = lookup(key);
  assert.equal(typeof text, "string", `lang key ${key} exists`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));
};

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
  i18n: { localize: (k) => format(k), format, has: () => true },
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
    escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]),
  },
  applications: { api: { ApplicationV2: AppBase, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

const { default: SkillAuditApp, auditWindowId, buildSkillTabHTML } = await import("../scripts/formation/skill-audit.mjs");
const { refreshLadders } = await import("../scripts/formation/ability-bridge.mjs");
const { default: Handlebars } = await import("handlebars");
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

/* --- the figures and names the window draws ----------------------------------- */
/** An ability item as the audit reads it: flags under the module's scope, a page in its cookbook flag when imported. */
function skillItem(name, { rolls = [], effects = [], provides = [], rollTarget, cite = "", id = "", flags = {} } = {}) {
  const scoped = { extras: { rolls, effects, provides }, ...(cite || id ? { cookbook: { ...(id ? { id } : {}), ...(cite ? { cite } : {}) } } : {}), ...flags };
  const doc = {
    type: "ability", name, uuid: `Actor.fT.Item.${name}`, system: rollTarget === undefined ? {} : { rollTarget }, flags: { "acks-extras": scoped },
    getFlag: (scope, key) => doc.flags[scope]?.[key],
  };
  items.set(doc.uuid, doc);
  return doc;
}
const flatThrow = (flat) => ({ key: "primary", label: "", formula: "1d20", rollType: "above", target: { kind: "flat", flat }, scale: "level" });
const ladderThrow = (...pairs) => ({ key: "primary", label: "", formula: "1d20", rollType: "above", target: { kind: "breakpoints", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) }, scale: "level" });
const seen = (html) => html.replaceAll("&#x27;", "'").replaceAll("&#x3D;", "=");

/** The audit's body as a Judge's window draws it. */
async function drawn() {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key, options) => format(key, options?.hash ?? {}));
  const app = new SkillAuditApp({ formationId: "fT" });
  const context = await app._prepareContext({ isFirstRender: false });
  const html = seen(hb.compile(fs.readFileSync(new URL("../templates/formation/skill-audit.hbs", import.meta.url), "utf8"))(context));
  return { context, html };
}

const alertness = skillItem("Alertness", {
  provides: ["kw:alertness"], cite: "XX p.1", id: "def.prof.alertness",
  effects: [{ type: "modifies", target: "proficiencyThrow", refs: ["kw:searching"], ifHas: ["kw:searching"], mode: "add", value: { flat: 2 } }],
});
const searching = skillItem("Searching", { provides: ["kw:searching"], rolls: [flatThrow(15)], rollTarget: 15, cite: "XX p.7", flags: { targetMod: 1, checkKey: "search" } });
const homebrew = skillItem("Home Cooking", { rolls: [flatThrow(11)], rollTarget: 0 });
const listening = skillItem("Hearing", { rollTarget: undefined, cite: "XX p.9" });
const scaling = skillItem("Scaling", { id: "def.skill.climbing", cite: "XX p.22", rolls: [ladderThrow([1, 15], [4, null], [8, 12])] });
const tracker = actor("fT1");
Object.assign(tracker, { img: "fT1.webp", system: { details: { level: 3 } }, items: [searching, alertness, homebrew, listening] });
for (const it of tracker.items) it.actor = tracker;
searching.parent = tracker;
setFormation("fT", roster("fT1"));
game.items.push(scaling);
await refreshLadders();

await ok("a resolution keeps its visible text and carries the cited form in its tooltip", async () => {
  const { context, html } = await drawn();
  const [member] = context.members;
  const search = member.resolutions[1];
  assert.equal(search.label, "12+");
  assert.equal(search.source, "Searching [+1]; +2 Alertness, +1 Throw bonus", "no page in the visible text");
  assert.equal(search.tip, "Target 12+: Searching [+1]; +2 Alertness (XX p.1), +1 Throw bonus.");
  assert.match(html, /<td data-tooltip-text="Target 12\+: Searching \[\+1\]; \+2 Alertness \(XX p\.1\), \+1 Throw bonus\.">\s*<strong>12\+<\/strong><br \/><span class="src">Searching \[\+1\]; \+2 Alertness, \+1 Throw bonus<\/span>/);
  const none = member.resolutions[0];
  assert.deepEqual([none.label, none.tip], ["—", ""], "a check the member cannot make carries no tooltip");
  assert.match(html, /<td><strong>—<\/strong>/);
});

await ok("the member's level reads through its lang string", async () => {
  const { html } = await drawn();
  assert.match(html, /<span class="lvl">L3<\/span>/);
  assert.equal(format("ACKS-FORMATION.audit.levelTag", { level: 7 }), "L7");
});

await ok("each Used-for select is named for its item and keeps the attributes focus restore finds it by", async () => {
  const { context, html } = await drawn();
  for (const it of context.members[0].items) {
    const tag = html.match(new RegExp(`<select data-item-uuid="${it.uuid.replaceAll(".", "\\.")}" data-field="checkKey"\\s+aria-label="([^"]*)">`));
    assert.ok(tag, `a named select for ${it.name}`);
    assert.equal(tag[1], format("ACKS-FORMATION.audit.usedForLabel", { name: it.name }));
  }
  const opts = context.members[0].items[0].checkOptions;
  assert.deepEqual(opts.map((o) => o.value), ["", "listen", "search", "bash", "trapbreak", "track"]);
  assert.ok(opts.every((o) => o.label !== o.value && o.label.length), "names, not flag ids");
  assert.equal(opts.find((o) => o.active).value, "search");
});

await ok("the Sheet target is the stored target or nothing, and its tooltip names its source", async () => {
  const { context, html } = await drawn();
  const [found, cooked, heard] = [searching, homebrew, listening].map((it) => context.members[0].items.find((row) => row.uuid === it.uuid));
  assert.deepEqual([found.target, found.targetTip], ["15+", "XX p.7"], "imported: the page");
  assert.deepEqual([cooked.target, cooked.targetTip], ["", format("ACKS-FORMATION.audit.sheetTargetTip")], "a zero is blank, and with no page the tooltip names the sheet's stored target");
  assert.deepEqual([heard.target, heard.targetTip], ["", "XX p.9"], "imported and blank: the page reference alone");
  assert.match(html, /<td data-tooltip-text="XX p\.7">15\+<\/td>/);
  assert.match(html, /<td data-tooltip-text="XX p\.9"><\/td>/);
  assert.doesNotMatch(html, /\b0\+/, "no zero target is drawn");
  assert.doesNotMatch(html, /<td[^>]*>\+<\/td>/, "no bare plus");
});

await ok("the progression table names each row for its imported skill, cites its page, and leaves a missing rung blank", async () => {
  const { context, html } = await drawn();
  assert.deepEqual(context.progressionTable, [{ name: "Scaling", tip: "XX p.22", values: "15 /  / 12" }]);
  assert.match(html, /<tr data-tooltip-text="XX p\.22"><td class="member-cell">Scaling<\/td><td>15 \/  \/ 12<\/td><\/tr>/);
  assert.doesNotMatch(html, /climbing/, "the ladder key is not shown");
});

await ok("the audit template carries no title attribute", async () => {
  const { html } = await drawn();
  assert.doesNotMatch(html, /\stitle\s*=/);
  assert.doesNotMatch(fs.readFileSync(new URL("../templates/formation/skill-audit.hbs", import.meta.url), "utf8"), /\stitle\s*=/);
});

await ok("the Skill tab names its options as the audit does, names its controls, and cites in tooltips only", async () => {
  const html = seen(buildSkillTabHTML(searching, true));
  const options = [...html.matchAll(/<option value="([^"]*)" ?(selected)? ?>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], Boolean(m[2])]);
  const { context } = await drawn();
  const audit = context.members[0].items[0].checkOptions;
  assert.deepEqual(options.map(([value, label]) => ({ value, label })), audit.map(({ value, label }) => ({ value, label })), "one list for both surfaces");
  assert.deepEqual(options.filter(([, , selected]) => selected).map(([value]) => value), ["search"]);
  assert.doesNotMatch(html, />(listen|search|bash|trapbreak|track)<\/option>/, "no flag id as an option's text");
  assert.match(html, /<select data-field="checkKey" aria-label="Used for: Searching" >/);
  assert.match(html, /<label data-tooltip="ACKS-FORMATION\.audit\.throwBonusHint">/);
  assert.match(html, /<input type="number"[^>]*data-field="targetMod" aria-label="Throw bonus \(±\)" data-tooltip="ACKS-FORMATION\.audit\.throwBonusHint"/);
  assert.doesNotMatch(html, /\stitle\s*=/);
  assert.match(html, /<li data-tooltip-text="Target 12\+: Searching \[\+1\]; \+2 Alertness \(XX p\.1\), \+1 Throw bonus\."><strong>[^<]*<\/strong>: 12\+ <em>\(Searching \[\+1\]; \+2 Alertness, \+1 Throw bonus\)<\/em><\/li>/);
});

await ok("the Skill tab escapes an item's name into its select's attribute", async () => {
  const quoted = skillItem('Odd "name" <b>', { rolls: [flatThrow(14)], rollTarget: 14, flags: { checkKey: "search" } });
  quoted.parent = tracker;
  const raw = buildSkillTabHTML(quoted, true);
  assert.ok(raw.includes('aria-label="Used for: Odd &quot;name&quot; &lt;b&gt;"'), raw);
  assert.doesNotMatch(raw, /name" </, "no raw quote or tag from the name inside an attribute");
});

console.log(`\n${passed} checks passed`);
