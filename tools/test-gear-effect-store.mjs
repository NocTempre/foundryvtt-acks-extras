/**
 * A carried item's effect rows on its item sheet, offline: where the group is
 * placed (`item-sheet-host.mjs`), the editor's store over `itemRun.rows` and
 * what makes it writable (`gear-effect-rows.mjs`), the gear domain's pickers
 * and fields, the line a row wears and the tooltip of its reach figure, the
 * template that draws it, and the hook that places and wires it
 * (`gear-effect-sheet.mjs`). Foundry-free with stand-ins; every name, page and
 * figure below is invented.
 *
 * Usage: node tools/test-gear-effect-store.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hooks = {};
let randomN = 0;
globalThis.Hooks = { once() {}, callAll() {}, on: (name, fn) => (hooks[name] ??= []).push(fn) };
let rendered = [];
let renderGate = null;
const TEMPLATE_FILE = new URL("../templates/lib/gear-effect-rows.hbs", import.meta.url);
const Handlebars = (await import("handlebars")).default;
globalThis.foundry = {
  utils: {
    getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
    randomID: () => `rid${++randomN}`,
    escapeHTML: (text) => String(text),
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
  },
  applications: {
    api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } },
    handlebars: {
      renderTemplate: async (path, model) => {
        rendered.push({ path, model });
        if (renderGate) await renderGate;
        return `<section class="acks-extras-gear-rows">${model.rows.length}</section>`;
      },
    },
  },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true } };
globalThis.ui = { notifications: { warn() {}, error() {} } };

const host = await import("../scripts/lib/item-sheet-host.mjs");
const rows = await import("../scripts/lib/gear-effect-rows.mjs");
const sheet = await import("../scripts/lib/gear-effect-sheet.mjs");
const editor = await import("../scripts/lib/apps/effect-row-editor.mjs");
const vocab = await import("../scripts/lib/vocab.mjs");
const tables = await import("../scripts/lib/tables.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/** A DOM stand-in: elements answer `querySelector` from a selector map. */
const el = (map = {}, extra = {}) => ({ querySelector: (selector) => map[selector] ?? null, ...extra });

/** An item stand-in over a flag bag. */
function item({ rows: stored, owner = true, locked = false, type = "item", flag = undefined, cite = "" } = {}) {
  const flags = { "acks-extras": { ...(flag ?? (stored ? { itemRun: { activation: { kind: "toggle" }, rows: stored } } : {})), ...(cite ? { cookbook: { cite } } : {}) } };
  const updates = [];
  return {
    documentName: "Item", type, uuid: "Item.invented", name: "Invented Charm", isOwner: owner,
    compendium: locked ? { locked: true } : null, flags,
    getFlag: (scope, key) => flags[scope]?.[key],
    update: async (data) => { updates.push(data); return data; },
    updates,
  };
}

const say = (key, data = {}) => (Object.keys(data).length ? `${key}|${JSON.stringify(data)}` : key);

/* --- where the group goes --- */
await t("the host finder answers the first Details host, in the monster annotations' order", () => {
  const stack = el(), panel = el(), scroll = el(), part = el(), description = el(), content = el();
  const all = {
    '.acks-extras-item-sheet__panel[data-tab="details"] > .acks-extras-item-sheet__stack': stack,
    '.acks-extras-item-sheet__panel[data-tab="details"]': panel,
    ".acks-extras-item-sheet__scroll": scroll,
    '[data-application-part="details"]': part,
    '[data-application-part="description"]': description,
    ".window-content": content,
  };
  assert.deepEqual(host.ITEM_SHEET_HOSTS, Object.keys(all), "the list is the annotations' own, in order");
  assert.deepEqual(host.DETAILS_HOSTS, Object.keys(all).slice(0, 4));
  const drop = (...gone) => Object.fromEntries(Object.entries(all).filter(([, node]) => !gone.includes(node)));
  assert.equal(host.findItemSheetHost(el(all)), stack);
  assert.equal(host.findItemSheetHost(el(drop(stack))), panel);
  assert.equal(host.findItemSheetHost(el(drop(stack, panel))), scroll);
  assert.equal(host.findItemSheetHost(el(drop(stack, panel, scroll))), part);
  assert.equal(host.findItemSheetHost(el(drop(stack, panel, scroll, part))), description);
  assert.equal(host.findItemSheetHost(el(drop(stack, panel, scroll, part, description))), content);
  const bare = el();
  assert.equal(host.findItemSheetHost(bare), bare, "no host: the root itself");
});

await t("a Details-only search never falls outside the Details tab", () => {
  const content = el(), description = el(), part = el();
  assert.equal(host.findItemSheetHost(el({ ".window-content": content, '[data-application-part="description"]': description }), { detailsOnly: true }), null);
  assert.equal(host.findItemSheetHost(el({ '[data-application-part="details"]': part, ".window-content": content }), { detailsOnly: true }), part);
});

await t("the nearest vertical scroller is read through the element's own window", () => {
  const style = new Map();
  const view = { getComputedStyle: (node) => ({ overflowY: style.get(node) ?? "visible" }) };
  const root = { ownerDocument: { defaultView: view }, parentElement: null };
  const body = { ownerDocument: root.ownerDocument, parentElement: root };
  const group = { ownerDocument: root.ownerDocument, parentElement: body };
  assert.equal(host.scrollerOf(group, root), null);
  style.set(body, "auto");
  assert.equal(host.scrollerOf(group, root), body);
  style.set(group, "scroll");
  assert.equal(host.scrollerOf(group, root), group);
});

await t("the monster annotations take their host and scroller from the lib file", () => {
  const source = readFileSync(new URL("../scripts/monsters/item-annotations.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ findItemSheetHost, scrollerOf \} from "\.\.\/lib\/item-sheet-host\.mjs"/);
  assert.match(source, /findItemSheetHost\(root\)/);
  assert.ok(!/const HOSTS\b/.test(source) && !/function scrollerOf/.test(source), "no second copy of either");
});

/* --- the store --- */
await t("the store reads a clone of the stored rows and writes only the rows path", async () => {
  const stored = [{ key: "a", type: "modifier", reach: { pulse: "standing", radius: { value: "5" } } }];
  const it = item({ rows: stored });
  const store = rows.gearEffectStore(it);
  assert.equal(store.domain, "gear");
  assert.equal(store.key, "Item.invented:itemRun.rows");
  const read = store.read();
  assert.deepEqual(read, stored);
  read[0].type = "throw";
  assert.equal(it.flags["acks-extras"].itemRun.rows[0].type, "modifier", "a read is a copy");
  const written = await store.write([...read, { key: "b", type: "capability" }]);
  assert.equal(written.length, 2);
  assert.deepEqual(Object.keys(it.updates[0]), ["flags.acks-extras.itemRun.rows"], "nothing but the rows path, so the activation is never rewritten");
  assert.equal(it.updates[0]["flags.acks-extras.itemRun.rows"][0].reach.radius.value, "5", "a reach rides back as stored");
});

await t("an item with no itemRun, or one with rows and no activation, reads its rows", () => {
  assert.deepEqual(rows.gearEffectStore(item()).read(), []);
  const bare = item({ flag: { itemRun: { rows: [{ key: "a", type: "modifier" }] } } });
  assert.deepEqual(rows.gearEffectStore(bare).read(), [{ key: "a", type: "modifier" }]);
});

await t("the store is writable by Foundry ownership alone, never by the seat's role", () => {
  assert.equal(rows.gearEffectStore(item({ owner: true })).editable(), true);
  assert.equal(rows.gearEffectStore(item({ owner: false })).editable(), false);
  assert.equal(game.user.isGM, true, "the stand-in seat is a GM");
  assert.equal(rows.gearEffectStore(item({ owner: false })).editable(), false, "a GM seat that does not own it is not offered the controls here");
  assert.equal(rows.gearEffectStore(item({ owner: true, locked: true })).editable(), false, "a locked pack is read-only");
  assert.ok(!/isGM/.test(readFileSync(new URL("../scripts/lib/gear-effect-rows.mjs", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")), "no role is read");
});

await t("Add row on a carried item mints a key and the editor opens on it", async () => {
  const it = item({ rows: [{ key: "a", type: "modifier" }] });
  const actions = editor.effectRowActions(rows.gearEffectStore);
  await actions.effectAdd.call({ document: it });
  const next = it.updates[0]["flags.acks-extras.itemRun.rows"];
  assert.equal(next.length, 2);
  assert.match(next[1].key, /^_rid\d+$/, "a Judge's key starts with an underscore");
  assert.equal(next[1].type, "modifier");
  assert.deepEqual(next[0], { key: "a", type: "modifier" }, "the other rows are untouched");
});

/* --- the gear domain --- */
await t("the gear domain offers an ability's kinds, subjects and scales, and none of a cast's", () => {
  assert.deepEqual(Object.keys(vocab.effectTypesFor(vocab.GEAR_DOMAIN)), Object.keys(vocab.effectTypesFor("ability")));
  assert.deepEqual(Object.keys(vocab.effectSubjectsFor(vocab.GEAR_DOMAIN)), Object.keys(vocab.effectSubjectsFor("ability")));
  assert.deepEqual(Object.keys(vocab.valueScalesFor(vocab.GEAR_DOMAIN)), Object.keys(vocab.valueScalesFor("ability")));
  const kinds = vocab.effectTypesFor(vocab.GEAR_DOMAIN);
  assert.ok(kinds.modifier && kinds.capability);
  assert.ok(!kinds.damage && !kinds.heal && !kinds.summon, "damage and heal stay spell-only");
  assert.ok(Object.keys(vocab.effectTypesFor("spell")).length > Object.keys(kinds).length);
});

await t("the gear domain's fields are an ability's, and no editor field is the reach", () => {
  for (const type of Object.keys(vocab.EFFECT_TYPES)) {
    assert.deepEqual(editor.fieldsForType(type, vocab.GEAR_DOMAIN), editor.fieldsForType(type, "ability"), `${type} edits the same fields`);
    assert.ok(!editor.fieldsForType(type, vocab.GEAR_DOMAIN).some((name) => name === "reach" || name.startsWith("reach.")));
  }
  const stored = { type: "modifier", key: "k", reach: { pulse: "standing", radius: { value: "5" }, filter: { kinds: ["alpha"] } } };
  assert.deepEqual(editor.mergeRowEdit(stored, { note: "x" }).reach, stored.reach, "an edit keeps the stored reach");
});

/* --- the line a row wears --- */
const reachRow = (radius, extra = {}) => ({ key: "r", type: "modifier", reach: { pulse: "standing", radius, ...extra } });
const ctx = { itemName: "Invented Charm", cite: "XX p. 9", say };

await t("a row with no reach has its kind and nothing else", () => {
  const line = rows.gearRowSummary({ key: "a", type: "modifier" }, ctx);
  assert.equal(line.kind, "Modifier");
  assert.equal(line.reach, null);
  assert.equal(line.save, false);
});

await t("a reach figure the row holds carries the item's name, the figure and the page", () => {
  const { reach } = rows.gearRowSummary(reachRow({ value: "15" }), ctx);
  assert.equal(reach.blank, false);
  assert.equal(reach.radius, 15);
  assert.equal(reach.label, "gearRows.inReach");
  assert.equal(reach.tip, "Invented Charm: 15′ (XX p. 9)");
});

await t("a reach figure read from an imported table cites the table's own page", () => {
  tables.registerTable({ id: "invented-doc", tables: { sizes: { big: { radius: 20 } } }, cites: { sizes: "ZZ p. 3" } }, { priority: tables.PRIORITY.CATALOG });
  const { reach } = rows.gearRowSummary(reachRow({ doc: "invented-doc", table: "sizes", row: "big", figure: "radius" }), ctx);
  assert.equal(reach.radius, 20);
  assert.equal(reach.tip, "Invented Charm: 20′ (ZZ p. 3)");
  tables.resetTables();
});

await t("a blank reach figure is no number, no words: only the page reference", () => {
  tables.registerTable({ id: "invented-doc", tables: { sizes: {} }, cites: { sizes: "ZZ p. 3" } }, { priority: tables.PRIORITY.CATALOG });
  const { reach } = rows.gearRowSummary(reachRow({ doc: "invented-doc", table: "sizes", row: "big", figure: "radius" }), ctx);
  assert.equal(reach.blank, true);
  assert.equal(reach.radius, null);
  assert.equal(reach.tip, "ZZ p. 3");
  assert.equal(reach.aria, "ZZ p. 3");
  tables.resetTables();
  const bare = rows.gearRowSummary(reachRow(null), ctx).reach;
  assert.equal(bare.tip, "XX p. 9", "with no table named, the item's page");
  const none = rows.gearRowSummary(reachRow(null), { ...ctx, cite: "" }).reach;
  assert.equal(none.tip, "", "no page to point at: no tooltip");
  assert.equal(none.aria, "gearRows.reach", "the glyph is still named");
});

await t("the engaged reach names its square's page and shows no radius", () => {
  const { reach } = rows.gearRowSummary(reachRow(null, { engaged: true }), ctx);
  assert.equal(reach.engaged, true);
  assert.equal(reach.radius, null);
  assert.equal(reach.tip, "itemRun.card.engagedNoteTip");
});

await t("a row that names a save is marked, and one that does not is not", () => {
  assert.equal(rows.gearRowSummary(reachRow({ value: "5" }, { save: { value: "Paralysis" } }), ctx).save, true);
  assert.equal(rows.gearRowSummary(reachRow({ value: "5" }), ctx).save, false);
  assert.equal(rows.gearRowSummary({ key: "a", type: "modifier", target: "Paralysis" }, ctx).save, false, "a row with no reach is never one that saves");
  // The runner reads a reach row's save as the reach's own reference, else the row's `target` (`item-run.mjs` `saveNameOf`); the line says the same.
  assert.equal(rows.gearRowSummary({ ...reachRow({ value: "5" }), target: "Paralysis" }, ctx).save, true, "a reach row whose target names the save asks one");
  assert.equal(rows.gearRowSummary(reachRow({ value: "5" }, { on: ["save"], modifier: { value: "1" } }), ctx).save, false, "a direct reach row with a figure and no save is no save");
});

await t("the group's model lists the rows by index and carries ownership", () => {
  const it = item({ rows: [{ key: "a", type: "modifier" }, reachRow({ value: "8" })], cite: "XX p. 9" });
  const model = rows.gearRowsModel(it, { say });
  assert.equal(model.editable, true);
  assert.deepEqual(model.rows.map((r) => r.index), [0, 1]);
  assert.equal(model.rows[0].name, `gearRows.row|{"n":1}`);
  assert.equal(model.rows[1].reach.radius, 8);
  assert.equal(model.rows[1].cite, "XX p. 9");
  assert.equal(rows.gearRowsModel(item({ rows: [], owner: false }), { say }).editable, false);
});

/* --- the template --- */
const hbs = Handlebars.create();
hbs.registerHelper("localize", (key) => key);
const draw = (model) => hbs.compile(readFileSync(TEMPLATE_FILE, "utf8"))(model);

await t("the template draws controls for an owner and none for any other seat", () => {
  const it = item({ rows: [reachRow({ value: "15" }, { save: { value: "x" } })], cite: "XX p. 9" });
  const owner = draw(rows.gearRowsModel(it, { say }));
  assert.match(owner, /data-gear-rows="add"/);
  assert.match(owner, /data-gear-rows="edit" data-index="0"/);
  assert.match(owner, /data-gear-rows="delete" data-index="0"/);
  const other = draw(rows.gearRowsModel(item({ rows: [reachRow({ value: "15" })], owner: false }), { say }));
  assert.ok(!/data-gear-rows|<button/.test(other), "a seat that cannot edit sees the list with no Add, Edit or Delete");
  assert.match(other, /acks-extras-gear-rows__line/);
});

await t("the template carries no id and no title attribute, and names its controls", () => {
  const source = readFileSync(TEMPLATE_FILE, "utf8");
  assert.ok(!/\sid\s*=/.test(source.replace(/\{\{!--[\s\S]*?--\}\}/g, "")), "no literal id");
  assert.ok(!/\stitle=/.test(source.replace(/\{\{!--[\s\S]*?--\}\}/g, "")), "tooltips are core's, never a title attribute");
  const it = item({ rows: [reachRow({ value: "15" })] });
  const html = draw(rows.gearRowsModel(it, { say }));
  for (const button of html.match(/<button[^>]*>/g)) assert.match(button, /aria-label="[^"]+"/, "every button is named");
});

await t("a figure carries its tooltip, and a blank one draws a glyph with the page reference and no digits", () => {
  const figure = draw(rows.gearRowsModel(item({ rows: [reachRow({ value: "15" })], cite: "XX p. 9" }), { say }));
  assert.match(figure, /data-tooltip-text="Invented Charm: 15′ \(XX p\. 9\)"[^>]*>15′/);
  tables.registerTable({ id: "invented-doc", tables: { sizes: {} }, cites: { sizes: "ZZ p. 3" } }, { priority: tables.PRIORITY.CATALOG });
  const blank = draw(rows.gearRowsModel(item({ rows: [reachRow({ doc: "invented-doc", table: "sizes", row: "big", figure: "radius" })] }), { say }));
  tables.resetTables();
  assert.match(blank, /acks-extras-gear-rows__blank" role="img" data-tooltip-text="ZZ p\. 3" aria-label="ZZ p\. 3"><i class="fa-solid fa-book" inert>/);
  const line = blank.match(/acks-extras-gear-rows__line">([\s\S]*?)<\/span>\s*(?:<button|<\/div>)/)?.[1] ?? "";
  assert.ok(!/\d/.test(line.replace(/<[^>]*>/g, "")), "no number on the line");
});

await t("a reach with no page to point at draws the glyph with no tooltip attribute", () => {
  const html = draw(rows.gearRowsModel(item({ rows: [reachRow(null)] }), { say }));
  assert.match(html, /acks-extras-gear-rows__blank" role="img" aria-label="gearRows.reach"/);
  assert.ok(!/data-tooltip-text=""/.test(html));
});

/* --- the hook --- */
/** A group stand-in with three wired controls, and the host that takes it. */
function sheetDom({ hasHost = true, old = null } = {}) {
  const appended = [];
  const controls = ["add", "edit", "delete"].map((kind, i) => {
    const listeners = {};
    return { dataset: { gearRows: kind, index: String(i) }, addEventListener: (type, fn) => (listeners[type] = fn), click: () => listeners.click({ preventDefault() {}, stopPropagation() {} }) };
  });
  const group = { querySelectorAll: () => controls };
  const hostEl = {
    appendChild: (node) => appended.push(node),
    ownerDocument: { createElement: () => ({ set innerHTML(html) { this.html = html; this.firstElementChild = group; } }) },
  };
  const removed = [];
  const stale = old ? { remove: () => removed.push("old") } : null;
  const root = {
    nodeType: 1,
    isConnected: true,
    querySelector: (selector) => (selector === ".acks-extras-gear-rows" ? stale : selector === '[data-application-part="details"]' && hasHost ? hostEl : null),
  };
  return { root, appended, controls, group, removed };
}
const sheetHooks = () => hooks.renderApplicationV2.at(-1);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

sheet.installGearEffectSheet();
sheet.installGearEffectSheet();

await t("the hooks are registered once", () => {
  assert.equal(hooks.renderApplicationV2.length, 1);
  assert.equal(hooks.preRenderApplicationV2.length, 1);
});

await t("an owner's sheet gets the group at the end of its Details host, and the old one is removed", async () => {
  rendered = [];
  const it = item({ rows: [{ key: "a", type: "modifier" }] });
  const dom = sheetDom({ old: true });
  sheetHooks()({ document: it }, dom.root);
  await settle();
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].path, "modules/acks-extras/templates/lib/gear-effect-rows.hbs");
  assert.deepEqual(dom.removed, ["old"]);
  assert.deepEqual(dom.appended, [dom.group]);
});

await t("the group's Add, Edit and Delete press the editor's handlers over this item", async () => {
  const it = item({ rows: [{ key: "a", type: "modifier" }] });
  const dom = sheetDom();
  sheetHooks()({ document: it }, dom.root);
  await settle();
  dom.controls[0].click();
  await settle();
  assert.equal(it.updates.length, 1, "Add wrote the item's rows");
  assert.equal(it.updates[0]["flags.acks-extras.itemRun.rows"].length, 2);
});

await t("a sheet with no Details host gets no group, never one outside the tab", async () => {
  const it = item({ rows: [{ key: "a", type: "modifier" }] });
  const dom = sheetDom({ hasHost: false });
  sheetHooks()({ document: it }, dom.root);
  await settle();
  assert.deepEqual(dom.appended, []);
});

await t("a seat that cannot edit an item with no rows draws nothing, and one with rows draws the list", async () => {
  rendered = [];
  const empty = sheetDom({ old: true });
  sheetHooks()({ document: item({ owner: false }) }, empty.root);
  await settle();
  assert.equal(rendered.length, 0);
  assert.deepEqual(empty.appended, []);
  assert.deepEqual(empty.removed, ["old"], "a stale group is still cleared");
  const full = sheetDom();
  sheetHooks()({ document: item({ owner: false, rows: [{ key: "a", type: "modifier" }] }) }, full.root);
  await settle();
  assert.equal(full.appended.length, 1);
  assert.equal(rendered.at(-1).model.editable, false);
});

await t("only an item of type item is touched", async () => {
  rendered = [];
  for (const type of ["weapon", "ability", "armor"]) {
    const dom = sheetDom();
    sheetHooks()({ document: item({ type, rows: [{ key: "a", type: "modifier" }] }) }, dom.root);
    sheetHooks()({ document: { documentName: "Actor", type: "item" } }, dom.root);
    await settle();
    assert.deepEqual(dom.appended, []);
  }
  assert.equal(rendered.length, 0);
});

await t("a render that finishes after a newer one places nothing", async () => {
  const it = item({ rows: [{ key: "a", type: "modifier" }] });
  const app = { document: it };
  const first = sheetDom();
  let release;
  renderGate = new Promise((resolve) => (release = resolve));
  sheetHooks()(app, first.root);
  const second = sheetDom();
  sheetHooks()(app, second.root);
  renderGate = null;
  release();
  await settle();
  assert.deepEqual(first.appended, [], "the older render is discarded");
  assert.equal(second.appended.length, 1);
});

console.log(`\n${passed} passed`);
