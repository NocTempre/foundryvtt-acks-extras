/**
 * The item sheet's Quantity: the Record list's first field on a weapon, a suit
 * of armour and gear (whole numbers from zero, one tooltip), the title band's
 * count and that field showing ONE value (each writes only when it is the
 * control that fired), the pencil locking the field, and the Contents tab's
 * count (above one, and always for coin). Strings come from the shipped lang
 * file, so a missing key fails here. Every name and figure is invented; no
 * Foundry.
 *
 * Run: node tools/test-item-sheet-quantity.mjs
 */
import assert from "node:assert";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const lang = JSON.parse(read("../lang/en.json"));
const flat = {};
const walk = (node, path) => {
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  else flat[path] = node;
};
walk(lang, "");

const dotted = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
const setDotted = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
};

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.CONFIG = { ACKS: {} };
globalThis.game = {
  user: { isGM: false },
  settings: { get: () => null },
  i18n: {
    localize: (k) => flat[k] ?? k,
    format: (k, d = {}) => String(flat[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => d[n] ?? ""),
    has: (k) => k in flat,
  },
  modules: { get: () => ({ active: false }) },
};
globalThis.foundry = {
  utils: {
    getProperty: dotted,
    setProperty: setDotted,
    hasProperty: (o, p) => dotted(o, p) !== undefined,
    deleteProperty: (o, p) => {
      const keys = p.split(".");
      const last = keys.pop();
      const parent = keys.reduce((x, k) => x?.[k], o);
      if (parent) delete parent[last];
    },
  },
  data: { fields: {} },
  applications: {
    api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class {} },
    // The form's own reading, before the sheet adds its rules: the form data as given.
    sheets: { ItemSheetV2: class { _processFormData(event, form, formData) { return structuredClone(formData); } } },
    handlebars: {},
  },
};

const { recordOf, contentRowOf } = await import("../scripts/equipment/item-sheet/snapshot.mjs");
const { default: AcksItemSheet } = await import("../scripts/equipment/item-sheet/sheet.mjs");
const { default: Handlebars } = await import("handlebars");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const piece = (type, quantity, extra = {}) => ({
  id: `${type}1`,
  name: "Test piece",
  img: "x.png",
  type,
  system: { quantity, equipped: false, damage: { base: { formula: "1d6" } }, ac: { value: 2 }, ...extra },
  effects: [],
  getFlag: () => undefined,
});

console.log("item sheet: the Record list's Quantity");
test("it is the first field of a weapon, armour and gear, with the band's tooltip and whole numbers", () => {
  for (const type of ["weapon", "armor", "item"]) {
    const [first] = recordOf(piece(type, 3));
    assert.equal(first.name, "system.quantity", type);
    assert.equal(first.value, 3, `${type} shows the item's own count`);
    assert.equal(first.type, "number");
    assert.equal(first.whole, true, `${type} takes whole numbers`);
    assert.equal(first.hint, flat["ACKS-EQUIPMENT.itemSheet.band.quantity"], `${type} carries the band's one string`);
  }
});
test("a weapon of one still lists it, and a drawn row shows what was typed", () => {
  assert.equal(recordOf(piece("weapon", 1))[0].value, 1);
  assert.equal(recordOf(piece("weapon", 3, { equipped: true }))[0].value, 3);
});
test("the weapon's and armour's other fields follow it unchanged", () => {
  assert.equal(recordOf(piece("weapon", 1))[1].name, "system.damage.base.formula");
  assert.equal(recordOf(piece("armor", 1))[1].name, "system.ac.value");
  assert.ok(recordOf(piece("weapon", 1)).slice(1).every((f) => !f.whole), "only the count is a whole number");
});

console.log("item sheet: the Record template");
{
  Handlebars.registerHelper("localize", (key) => String(key));
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("not", (v) => !v);
  Handlebars.registerHelper("disabled", (v) => (v ? "disabled" : ""));
  Handlebars.registerHelper("checked", (v) => (v ? "checked" : ""));
  const record = Handlebars.compile(read("../templates/equipment/item-sheet/record.hbs"));
  const render = (item, editing) => record({ record: recordOf(item), editing });
  const inputOf = (html, name) => html.match(new RegExp(`<input[^>]*name="${name.replace(/\./g, "\\.")}"[^>]*>`))?.[0] ?? "";

  test("the count is min 0 step 1, and a figure that is not a count stays step any", () => {
    const html = render(piece("weapon", 3), true);
    assert.ok(/name="system\.quantity"[^>]*min="0" step="1"/.test(inputOf(html, "system.quantity")), inputOf(html, "system.quantity"));
    assert.ok(!/step=/.test(inputOf(html, "system.damage.base.formula")), "a text field takes no step");
    assert.ok(/step="any"/.test(inputOf(html, "system.bonus.attack")) && !/min=/.test(inputOf(html, "system.bonus.attack")), "a bonus is any figure");
  });
  test("the label carries the tooltip", () => {
    const html = render(piece("armor", 3), true);
    assert.ok(html.includes(`data-tooltip="${flat["ACKS-EQUIPMENT.itemSheet.band.quantity"]}"`));
  });
  test("the pencil locks it with every other field, on any row", () => {
    for (const equipped of [false, true]) {
      const locked = inputOf(render(piece("weapon", 3, { equipped }), false), "system.quantity");
      assert.ok(/\sdisabled>$/.test(locked), `locked, equipped ${equipped}: ${locked}`);
      assert.ok(!/disabled/.test(inputOf(render(piece("weapon", 3, { equipped }), true), "system.quantity")), `editable, equipped ${equipped}`);
    }
  });
}

console.log("item sheet: the band and Details show one value");
{
  const item = piece("weapon", 3);
  const submit = (data, fired) => AcksItemSheet.prototype._processFormData.call({ item }, { target: { name: fired } }, null, data);
  test("typing in Details is not undone by the band's stale count", () => {
    const out = submit({ system: { quantity: 5 }, acksBandQty: "3" }, "system.quantity");
    assert.equal(out.system.quantity, 5);
    assert.ok(!("acksBandQty" in out), "the band's own name never reaches the document");
  });
  test("typing in the band wins over Details' stale count, as a whole number from zero", () => {
    assert.equal(foundry.utils.getProperty(submit({ system: { quantity: 3 }, acksBandQty: "7" }, "acksBandQty"), "system.quantity"), 7);
    assert.equal(foundry.utils.getProperty(submit({ system: { quantity: 3 }, acksBandQty: "-2" }, "acksBandQty"), "system.quantity"), 0);
  });
  test("a submit another control fired writes neither the band's count nor over Details'", () => {
    const out = submit({ system: { quantity: 3 }, acksBandQty: "9" }, "system.bonus.attack");
    assert.equal(out.system.quantity, 3);
    assert.ok(!("acksBandQty" in out));
  });
  test("the band's input has its own name, the whole-number bounds and the same tooltip", () => {
    const band = read("../templates/equipment/item-sheet/band.hbs");
    assert.ok(/name="acksBandQty"[^>]*min="0" step="1"[\s\S]*?ACKS-EQUIPMENT\.itemSheet\.band\.quantity/.test(band));
  });
}

console.log("item sheet: the Contents tab's count");
{
  const coin = (qty) => ({ id: "c1", name: "Coin", type: "money", system: { quantity: qty, coppervalue: 1 }, effects: [], getFlag: () => undefined });
  test("a row shows its count above one, and coin always, an empty purse included", () => {
    assert.equal(contentRowOf(piece("item", 1)).stack, false);
    assert.equal(contentRowOf(piece("item", 2)).stack, true);
    assert.equal(contentRowOf(piece("weapon", 3)).stack, true);
    for (const n of [0, 1, 40]) assert.equal(contentRowOf(coin(n)).stack, true, `coin ${n}`);
  });
  test("its tooltip names the item's Quantity, read at render", () => {
    assert.equal(contentRowOf(piece("item", 4)).qtyTip, "4 in the stack: the item's Quantity.");
    assert.equal(contentRowOf(piece("item", 1)).qtyTip, "");
    assert.equal(contentRowOf(piece("item", 4)).qty, 4);
  });
  test("the template draws ×n only for a stack, with the tooltip as text", () => {
    Handlebars.registerHelper("localize", (key) => String(key));
    const tpl = Handlebars.compile(read("../templates/equipment/item-sheet/contents.hbs"));
    const rows = [piece("item", 1), piece("item", 3), coin(0)].map(contentRowOf);
    const html = tpl({ contents: { canSee: true, contents: rows.map((r, i) => ({ ...r, wt: "1", id: `r${i}` })), accepts: [] }, editable: false });
    const counts = [...html.matchAll(/<span class="acks-extras-item-sheet__row-line acks-nums" data-tooltip-text="([^"]*)">×(\d+)<\/span>/g)].map((m) => [m[2], m[1]]);
    assert.deepEqual(counts, [["3", "3 in the stack: the item&#x27;s Quantity."], ["0", "0 in the stack: the item&#x27;s Quantity."]]);
  });
}

console.log(`item sheet quantity: ${passed} checks passed`);
