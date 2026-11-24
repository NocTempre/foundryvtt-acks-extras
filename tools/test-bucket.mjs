/**
 * The inventory bucket, offline (`scripts/lib/bucket.mjs`, `bucket-value.mjs`,
 * `bucket-apply.mjs` and `templates/lib/bucket*.hbs`): the entry each kind of
 * drop makes, the total against an amount due, a fit that opens on a name match
 * and that the seat can change, the settlement plan per outcome and its writer
 * (a creature is marked and never deleted), the valuation of each kind with the
 * exclusions and the blank where nothing is imported, and the pick-one render.
 * Every name, figure and policy below is invented, so this file carries no book
 * content.
 *
 * Usage: node tools/test-bucket.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry = {
  utils: {
    setProperty(obj, path, value) {
      const keys = path.split(".");
      const last = keys.pop();
      let at = obj;
      for (const k of keys) at = at[k] ??= {};
      at[last] = value;
    },
  },
};

const bucket = await import("../scripts/lib/bucket.mjs");
const value = await import("../scripts/lib/bucket-value.mjs");
const { applySettlement } = await import("../scripts/lib/bucket-apply.mjs");
const Handlebars = (await import("handlebars")).default;
const { ENTRY_KIND, OUTCOME, SETTLE, COVERAGE } = bucket;

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);

/** An item document with a stack, a cost and the writes `divideStack` and a delete make. */
function item(name, { cost = 5, qty = 3, img = "icons/test/item.svg", flat = false, type } = {}) {
  const row = {
    documentName: "Item",
    name,
    img,
    ...(type ? { type } : {}),
    // `flat` is the system's current shape, a plain whole number; the default is the `{value}` object an older copy keeps.
    system: { cost, quantity: flat ? qty : { value: qty, max: 0 } },
    flags: {},
    deleted: false,
    parent: null,
    toObject() {
      return { name: this.name, img: this.img, ...(type ? { type } : {}), system: structuredClone(this.system), flags: {} };
    },
    async update(patch) {
      for (const [path, v] of Object.entries(patch)) foundry.utils.setProperty(this, path, v);
    },
    async delete() {
      this.deleted = true;
    },
  };
  return row;
}

/** A holder whose embedded creates make a row of their own, as `divideStack` expects. */
function holder(...rows) {
  const made = [];
  const h = {
    async createEmbeddedDocuments(_type, [data]) {
      const flat = typeof data.system.quantity === "number";
      const row = item(data.name, { cost: data.system.cost, qty: flat ? data.system.quantity : data.system.quantity.value, img: data.img, flat, type: data.type });
      row.parent = h;
      made.push(row);
      return [row];
    },
  };
  for (const r of rows) r.parent = h;
  return { holder: h, made };
}

const actor = (name, extra = {}) => ({ documentName: "Actor", name, img: "icons/test/actor.svg", items: [], system: { details: { xp: 100 } }, statuses: new Set(), deleted: false, async toggleStatusEffect(id) { this.statuses.add(id); }, async delete() { this.deleted = true; }, ...extra });

const FIT = { options: [{ key: "mine", label: "Fits", names: ["lanternlight"], tone: "ok" }, { key: "other", label: "Other effect", tone: "warn" }], fallback: "other" };

/* -------------------------------------------- */

await ta("an Item drop makes an entry from the document, valued by its own cost times the stack", async () => {
  const stings = item("Lantern stings", { cost: 7, qty: 4 });
  const got = await bucket.entryFromDrop({ type: "Item", uuid: "Item.a" }, async () => stings);
  assert.equal(got.entry.kind, "item");
  assert.deepEqual([got.entry.name, got.entry.img, got.entry.qty, got.entry.cap], ["Lantern stings", "icons/test/item.svg", 4, 4]);
  assert.deepEqual([got.entry.value.gp, got.entry.value.each, got.entry.value.source], [28, 7, "cost"]);
});

await ta("an Actor drop and a Token drop make creature entries, valued only by the policy's valuer", async () => {
  const ogre = actor("Invented ogre");
  const policy = { value: (doc) => ({ gp: (doc.actor ?? doc).system.details.xp, source: "xp", cite: "p. 1" }) };
  const a = await bucket.entryFromDrop({ type: "Actor", uuid: "Actor.o" }, async () => ogre, { policy });
  assert.deepEqual([a.entry.kind, a.entry.value.gp, a.entry.qty, a.entry.img], ["actor", 100, 1, "icons/test/actor.svg"]);
  const token = { documentName: "Token", name: "Ogre token", texture: { src: "icons/test/tok.svg" }, actor: ogre };
  const k = await bucket.entryFromDrop({ type: "Token", uuid: "Scene.s.Token.t" }, async () => token, { policy });
  assert.deepEqual([k.entry.kind, k.entry.img, k.entry.name], ["token", "icons/test/tok.svg", "Ogre token"]);
  const bare = await bucket.entryFromDrop({ type: "Actor", uuid: "Actor.o" }, async () => ogre);
  assert.equal(bare.entry.value.gp, null, "no valuer and no constant: blank");
});

await ta("a drop that is no document, is gone, is a repeat or is the wrong kind is refused with its reason", async () => {
  const policy = { accepts: { kinds: ["item"] } };
  let asked = 0;
  const watching = { ...policy, value: () => (asked++, null) };
  assert.equal((await bucket.entryFromDrop({ type: "Actor", uuid: "Actor.o" }, async () => actor("Ogre"), { policy: watching })).refused, "kind");
  assert.equal(asked, 0, "a valuer is never handed a document of a kind the policy refuses");
  assert.equal((await bucket.entryFromDrop({ type: "Folder", uuid: "x" }, async () => ({}))).refused, "noDrop");
  assert.equal((await bucket.entryFromDrop({ type: "Item", uuid: "Item.z" }, async () => null)).refused, "gone");
  assert.equal((await bucket.entryFromDrop({ type: "Item", uuid: "Item.a" }, async () => item("Thing"), { present: [{ uuid: "Item.a" }] })).refused, "duplicate");
  assert.equal((await bucket.entryFromDrop({ type: "Actor", uuid: "Actor.o" }, async () => actor("Ogre"), { policy })).refused, "kind");
});

await ta("a row the policy gives a reason is listed and counts for nothing", async () => {
  const policy = { accepts: { kinds: ["item"], reason: (e) => (e.name === "Market candle" ? "Market goods are refused" : null) } };
  const ok = (await bucket.entryFromDrop({ type: "Item", uuid: "Item.a" }, async () => item("Lantern stings", { cost: 2, qty: 2 }), { policy })).entry;
  const off = (await bucket.entryFromDrop({ type: "Item", uuid: "Item.b" }, async () => item("Market candle", { cost: 50, qty: 1 }), { policy })).entry;
  assert.equal(off.reason, "Market goods are refused");
  assert.equal(bucket.totalOf([ok, off]).gp, 4, "the refused row adds nothing");
});

t("an unread cost is a blank figure, never zero", () => {
  assert.equal(value.itemValue({ cost: null }).gp, null);
  assert.equal(value.itemValue({ cost: "" }).gp, null);
  assert.equal(value.itemValue({ cost: 0 }).gp, 0);
  assert.equal(value.itemValue({ cost: undefined, cite: "p. 9" }).cite, "p. 9");
});

t("a monster part is its cost times the stack; its effects name what it serves and are never added", () => {
  const v = value.partValue({ cost: 6, count: 3, effects: ["Lanternlight", " "] });
  assert.equal(v.gp, 18);
  assert.deepEqual(v.effects, ["Lanternlight"]);
});

t("a creature is the sum of its component items, whatever bars its XP", () => {
  const parts = [{ system: { cost: 10 }, c: true, q: 2 }, { system: { cost: 4 }, c: true, q: 1 }, { system: { cost: 999 }, c: false, q: 1 }];
  const v = value.creatureValue({ system: { details: { xp: 40 } } }, {
    items: parts,
    isComponent: (i) => i.c,
    countOf: (i) => i.q,
    xpOf: (a) => a.system.details.xp,
    multiplier: 2,
    bars: { isAnimal: () => true },
  });
  assert.deepEqual([v.gp, v.source], [24, "components"]);
});

t("a creature's component items count by their own stacks unless the caller counts otherwise", () => {
  const stacked = [{ c: true, system: { cost: 10, quantity: { value: 3 } } }, { c: true, system: { cost: 4 } }];
  const v = value.creatureValue({}, { items: stacked, isComponent: (i) => i.c, xpOf: () => 999 });
  assert.equal(v.gp, 34, "3 x 10 for the stack, 1 x 4 for the item that does not stack");
});

t("a creature with no component falls back to its XP through the imported multiplier", () => {
  const a = { system: { details: { xp: 40 } } };
  const base = { items: [], isComponent: () => false, xpOf: (x) => x.system.details.xp };
  assert.equal(value.creatureValue(a, { ...base, multiplier: 3 }).gp, 120);
  assert.equal(value.creatureValue(a, { ...base }).gp, 40, "a reading with no multiplier takes the award as is");
  assert.equal(value.creatureValue(a, { ...base, multiplier: null }).gp, null, "a multiplier that applies and was not imported blanks the figure");
});

t("the XP fallback is barred for an ordinary animal, a summoned creature and a young one", () => {
  const a = { system: { details: { xp: 40 } }, tag: "" };
  const base = { items: [], isComponent: () => false, xpOf: (x) => x.system.details.xp, multiplier: 2 };
  for (const [bar, why] of [["isAnimal", "animal"], ["isSummoned", "summoned"], ["isYoung", "young"]]) {
    const v = value.creatureValue(a, { ...base, bars: { [bar]: () => true } });
    assert.deepEqual([v.gp, v.source, v.reason], [0, "excluded", why]);
  }
  assert.equal(value.creatureValue(a, { ...base, bars: { isAnimal: () => false, isSummoned: () => false } }).gp, 80);
});

t("a character victim is the award for its level from the imported table, blank with none", () => {
  const award = (level) => ({ 3: 60, 5: 90 })[level] ?? null;
  assert.equal(value.characterValue(5, { award, multiplier: 2 }).gp, 180);
  assert.equal(value.characterValue(4, { award, multiplier: 2 }).gp, null, "a level the table does not hold");
  const none = value.characterValue(5, { cite: "p. 3" });
  assert.deepEqual([none.gp, none.cite], [null, "p. 3"]);
});

t("coverage is the total against the due, unknown where either was not read", () => {
  const a = bucket.makeEntry({ uuid: "a", kind: "item", qty: 1, value: { gp: 30, source: "cost" } });
  const b = bucket.makeEntry({ uuid: "b", kind: "item", qty: 1, value: { gp: 25, source: "cost" } });
  const blank = bucket.makeEntry({ uuid: "c", kind: "actor", value: null });
  assert.deepEqual(bucket.coverage([a, b], { gp: 50 }), { total: 55, blank: 0, due: 50, short: 0, status: COVERAGE.covered });
  assert.equal(bucket.coverage([a], 50).status, COVERAGE.short);
  assert.equal(bucket.coverage([a], 50).short, 20);
  assert.equal(bucket.coverage([a, b], null).status, COVERAGE.unknown);
  const withBlank = bucket.coverage([a, b, blank], 10);
  assert.deepEqual([withBlank.status, withBlank.blank, withBlank.total], [COVERAGE.unknown, 1, 55]);
});

t("quantity is held to the stack and rescales a per-unit figure; a hand-set value drops the per-unit one", () => {
  const e = bucket.makeEntry({ uuid: "a", kind: "item", qty: 3, cap: 3, value: { gp: 15, each: 5, source: "cost" } });
  assert.equal(bucket.withQty(e, 2).value.gp, 10);
  assert.equal(bucket.withQty(e, 9).qty, 3);
  assert.equal(bucket.withQty(e, 0).qty, 1);
  const hand = bucket.withValue(e, 12);
  assert.deepEqual([hand.value.gp, hand.value.source, hand.value.each], [12, "edited", undefined]);
  const power = bucket.powerEntry({ key: "divine", name: "Divine power", amount: 8, balance: 5, value: { gp: null, each: 2, source: "power" } });
  assert.deepEqual([power.qty, power.value.gp, power.uuid], [5, 10, "power:divine"]);
});

t("the fit opens on a name match, falls back, and the seat can change it", () => {
  const match = bucket.makeEntry({ uuid: "a", kind: "item", name: "Lanternlight sting" });
  const viaEffect = bucket.makeEntry({ uuid: "b", kind: "item", name: "Plain gland", effects: ["Lantern-light"] });
  const none = bucket.makeEntry({ uuid: "c", kind: "item", name: "Quiet gland" });
  assert.equal(bucket.preselectFit(match, FIT), "mine");
  assert.equal(bucket.preselectFit(viaEffect, FIT), "mine");
  assert.equal(bucket.preselectFit(none, FIT), "other");
  assert.equal(bucket.preselectFit(none, { options: FIT.options }), "mine", "no fallback opens on the first option");
  assert.equal(bucket.preselectFit(none, { options: [{ key: "x", names: ["", "  "] }] }), "x");
  const set = bucket.withFit({ ...none, fit: "other" }, "mine", FIT);
  assert.equal(set.fit, "mine");
  assert.equal(bucket.withFit(set, "nonsense", FIT).fit, "mine", "a key the policy does not offer changes nothing");
  assert.equal(bucket.nextFit({ fit: "mine" }, FIT), "other");
  assert.equal(bucket.nextFit({ fit: "other" }, FIT), "mine");
});

t("the settlement plan follows the outcome and the kind; unmapped is kept", () => {
  const settle = { success: "consume", failure: { item: "consume" }, botch: { item: "destroy", actor: "mark" } };
  const rows = [
    bucket.makeEntry({ uuid: "i", kind: "item", qty: 2 }),
    bucket.makeEntry({ uuid: "p", kind: "power", qty: 4 }),
  ];
  assert.deepEqual(bucket.settlementPlan(rows, OUTCOME.success, settle).map((s) => s.action), ["consume", "consume"]);
  assert.deepEqual(bucket.settlementPlan(rows, OUTCOME.failure, settle).map((s) => s.action), ["consume", "keep"]);
  assert.deepEqual(bucket.settlementPlan(rows, OUTCOME.botch, settle).map((s) => s.action), ["destroy", "keep"]);
  assert.deepEqual(bucket.settlementPlan(rows, "fizzle", settle).map((s) => s.action), ["keep", "keep"]);
  assert.equal(bucket.settlementPlan(rows, OUTCOME.success, settle)[0].qty, 2);
});

t("a creature is never consumed or destroyed by a plan: it is marked", () => {
  const rows = [bucket.makeEntry({ uuid: "a", kind: "actor" }), bucket.makeEntry({ uuid: "t", kind: "token" })];
  for (const rule of ["consume", "destroy", { actor: "consume", token: "destroy" }]) {
    assert.deepEqual(bucket.settlementPlan(rows, OUTCOME.success, { success: rule }).map((s) => s.action), ["mark", "mark"], JSON.stringify(rule));
  }
  assert.deepEqual(bucket.settlementPlan(rows, OUTCOME.success, { success: "keep" }).map((s) => s.action), ["keep", "keep"]);
});

t("a row that counts for nothing is kept, and a picked bucket acts on the picked row alone", () => {
  const off = bucket.makeEntry({ uuid: "o", kind: "item", reason: "refused" });
  const a = bucket.makeEntry({ uuid: "a", kind: "item" });
  const b = bucket.makeEntry({ uuid: "b", kind: "item" });
  const settle = { botch: "destroy" };
  assert.deepEqual(bucket.settlementPlan([off, a], OUTCOME.botch, settle).map((s) => s.action), ["keep", "destroy"]);
  assert.deepEqual(bucket.settlementPlan([a, b], OUTCOME.botch, settle, { used: "b" }).map((s) => s.action), ["keep", "destroy"]);
  assert.deepEqual(bucket.settlementPlan([a, b], OUTCOME.botch, settle, { used: null }).map((s) => s.action), ["keep", "keep"]);
});

await ta("applying a plan spends a whole stack by a delete and a part of one by dividing it", async () => {
  const whole = item("Whole", { qty: 3 });
  const part = item("Part", { qty: 5 });
  const { made } = holder(whole, part);
  const docs = { whole, part };
  const out = await applySettlement(
    [{ uuid: "whole", kind: "item", qty: 3, action: "consume" }, { uuid: "part", kind: "item", qty: 2, action: "destroy" }],
    async (u) => docs[u] ?? null,
  );
  assert.equal(whole.deleted, true);
  assert.deepEqual([part.deleted, part.system.quantity.value, made.length, made[0].deleted, made[0].system.quantity.value], [false, 3, 1, true, 2]);
  assert.deepEqual(out.spent, ["whole", "part"]);
});

await ta("applying a plan to plain-number gear spends a whole stack by a delete and a part of one by dividing it", async () => {
  const whole = item("Whole", { qty: 3, flat: true, type: "item" });
  const part = item("Part", { qty: 5, flat: true, type: "item" });
  const { made } = holder(whole, part);
  const docs = { whole, part };
  const out = await applySettlement(
    [{ uuid: "whole", kind: "item", qty: 3, action: "consume" }, { uuid: "part", kind: "item", qty: 2, action: "destroy" }],
    async (u) => docs[u] ?? null,
  );
  assert.equal(whole.deleted, true);
  assert.deepEqual([part.deleted, part.system.quantity, made.length, made[0].deleted, made[0].system.quantity], [false, 3, 1, true, 2]);
  assert.deepEqual(out.spent, ["whole", "part"]);
});

await ta("a weapon or armour row is never divided: it is spent whole, whatever its quantity", async () => {
  const one = item("Sword", { qty: 1, flat: true, type: "weapon" });
  const three = item("Spears", { qty: 3, flat: true, type: "weapon" });
  const mail = item("Mail", { qty: 2, flat: true, type: "armor" });
  const { made } = holder(one, three, mail);
  const docs = { one, three, mail };
  const out = await applySettlement(
    [{ uuid: "one", kind: "item", qty: 1, action: "consume" }, { uuid: "three", kind: "item", qty: 1, action: "consume" }, { uuid: "mail", kind: "item", qty: 1, action: "destroy" }],
    async (u) => docs[u] ?? null,
  );
  assert.deepEqual([one.deleted, three.deleted, mail.deleted, made.length, out.failed.length], [true, true, true, 0, 0]);
  assert.deepEqual(out.spent, ["one", "three", "mail"]);
});

await ta("a weapon with a quantity is one entry of one; plain-number gear is an entry of its stack", async () => {
  const spears = item("Spears", { cost: 2, qty: 3, flat: true, type: "weapon" });
  const sword = item("Sword", { cost: 2, qty: 1, flat: true, type: "weapon" });
  const mail = item("Mail", { cost: 2, qty: 2, flat: true, type: "armor" });
  const torches = item("Torches", { cost: 2, qty: 4, flat: true, type: "item" });
  const docs = { spears, sword, mail, torches };
  const got = Object.fromEntries(await Promise.all(Object.keys(docs).map(async (k) => [k, (await bucket.entryFromDrop({ type: "Item", uuid: k }, async () => docs[k])).entry])));
  assert.deepEqual([got.spears.qty, got.spears.cap], [1, 1], "a weapon is not counted off");
  assert.deepEqual([got.sword.qty, got.sword.cap], [1, 1]);
  assert.deepEqual([got.mail.qty, got.mail.cap], [1, 1]);
  assert.deepEqual([got.torches.qty, got.torches.cap], [4, 4]);
});

await ta("applying a plan marks a creature dead and never deletes it, an unlinked token's actor included", async () => {
  const ogre = actor("Ogre");
  const body = actor("Body");
  const token = { documentName: "Token", actor: body, async delete() { throw new Error("a token is never deleted"); } };
  const out = await applySettlement(
    [{ uuid: "o", kind: "actor", qty: 1, action: "mark" }, { uuid: "t", kind: "token", qty: 1, action: "mark" }],
    async (u) => ({ o: ogre, t: token })[u],
  );
  assert.deepEqual([ogre.statuses.has("dead"), ogre.deleted, body.statuses.has("dead"), out.marked], [true, false, true, ["o", "t"]]);
});

await ta("applying a plan reports a missing document, hands a power and a marked item back, and keeps going past a failure", async () => {
  const stuck = item("Stuck", { qty: 1 });
  stuck.delete = async () => {
    throw new Error("refused");
  };
  const fine = item("Fine", { qty: 1 });
  const out = await applySettlement(
    [
      { uuid: "missing", kind: "item", qty: 1, action: "consume" },
      { uuid: "power:divine", kind: "power", qty: 4, action: "consume" },
      { uuid: "set", kind: "item", qty: 1, action: "mark" },
      { uuid: "stuck", kind: "item", qty: 1, action: "consume" },
      { uuid: "fine", kind: "item", qty: 1, action: "consume" },
      { uuid: "kept", kind: "item", qty: 1, action: "keep" },
    ],
    async (u) => ({ stuck, fine })[u] ?? null,
  );
  assert.deepEqual(out.gone, ["missing"]);
  assert.deepEqual(out.handed.map((s) => s.uuid), ["power:divine", "set"]);
  assert.deepEqual(out.failed, [{ uuid: "stuck", error: "refused" }]);
  assert.deepEqual([fine.deleted, out.spent], [true, ["fine"]]);
});

await ta("a stored answer reads back into entries, names a document the world lost, and drops power rows", async () => {
  const sting = item("Lantern stings", { cost: 3, qty: 6 });
  const docs = { "Item.a": sting };
  const { entries, gone } = await bucket.entriesFromAnswer(
    [{ uuid: "Item.a", qty: 2, fit: "other" }, { uuid: "Item.gone", qty: 1, fit: "" }, { uuid: "power:divine", qty: 3 }],
    async (u) => docs[u] ?? null,
    { policy: { fit: FIT } },
  );
  assert.deepEqual(gone, ["Item.gone"]);
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].qty, entries[0].fit, entries[0].value.gp], [2, "other", 6], "the value is the document's now, at the stored quantity");
  assert.deepEqual(bucket.answerOf(entries), [{ uuid: "Item.a", qty: 2, fit: "other" }]);
});

/* -------------------------------------------- */

const row = (view, uuid) => view.rows.find((r) => r.uuid === uuid);

function render(view) {
  const hbs = Handlebars.create();
  hbs.registerHelper("localize", (key) => key);
  const dir = new URL("../templates/lib/", import.meta.url);
  hbs.registerPartial("modules/acks-extras/templates/lib/bucket-row.hbs", fs.readFileSync(new URL("bucket-row.hbs", dir), "utf8"));
  return hbs.compile(fs.readFileSync(new URL("bucket.hbs", dir), "utf8"))(view);
}

t("the view carries the total against the due with its parts, and the value's page where nothing was read", () => {
  const stings = bucket.makeEntry({ uuid: "a", kind: "item", name: "Lantern stings", qty: 2, cap: 2, value: { gp: 14, each: 7, source: "cost", cite: "p. 4" }, fit: "mine" });
  const gland = bucket.makeEntry({ uuid: "b", kind: "item", name: "Gland", value: { gp: null, source: "unimported", cite: "p. 5" }, fit: "other" });
  const policy = { fit: FIT, due: { gp: 40, cite: "p. 2" }, parts: [{ label: "Level", gp: 30 }, { label: "Bench" }] };
  const view = bucket.bucketView(policy, [stings, gland], { key: "components", loc, legend: "Components" });
  assert.equal(view.head.status, COVERAGE.unknown, "a blank counted row leaves the coverage unread");
  assert.match(view.head.text, /headTotal\|.*"total":"14".*"due":"40"/);
  assert.match(view.head.tip, /"parts":": Level 30 · Bench"/);
  assert.equal(row(view, "a").qtyText, "×2");
  assert.equal(row(view, "b").valueText, "");
  assert.equal(row(view, "b").valueTip, "p. 5", "blank: the page reference alone");
  assert.match(row(view, "a").valueTip, /valueTip\.cost/);
  assert.deepEqual([row(view, "a").fit.label, row(view, "a").fit.changeable], ["Fits", true]);
  const unread = bucket.bucketView({ fit: FIT, due: null }, [], { key: "k", loc });
  assert.deepEqual([unread.head.text, unread.empty], ["", true]);
});

t("a barred creature is listed dim with its bar named, and a source the tooltip has no string for reads plain", () => {
  const a = actor("Tame ox");
  const v = value.creatureValue(a, { items: [], isComponent: () => false, xpOf: () => 10, multiplier: 2, bars: { isAnimal: () => true } });
  const barred = bucket.makeEntry({ uuid: "a", kind: "actor", name: "Tame ox", value: v });
  const odd = bucket.makeEntry({ uuid: "b", kind: "item", name: "Odd", value: { gp: 5, source: "invented" } });
  const view = bucket.bucketView({}, [barred, odd], { key: "k", loc });
  assert.deepEqual([row(view, "a").off, row(view, "a").reason, bucket.totalOf([barred]).gp], [true, "barred.animal", 0]);
  assert.match(row(view, "b").valueTip, /valueTip.plain/);
});

t("the owner's wording replaces the generic drop and empty text, and a row names its own actions", () => {
  const e = bucket.makeEntry({ uuid: "a", kind: "item", name: "Gland", qty: 2, cap: 5 });
  const view = bucket.bucketView({}, [e], { key: "k", loc, dropText: "Drop a part", emptyText: "No parts" });
  assert.deepEqual([view.dropLabel, view.rows[0].removeAction, view.rows[0].fitAction, view.rows[0].pickAction], ["Drop a part", "bucketRemove", "bucketFit", "bucketPick"]);
  assert.match(view.rows[0].qtyTip, /qtyTip/);
  assert.equal(bucket.bucketView({}, [], { key: "k", loc, emptyText: "No parts" }).emptyText, "No parts");
  const html = render({ ...view, rows: [{ ...view.rows[0], removeAction: "untarget", chips: [{ text: "Out of range", tip: "t", tone: "warn" }] }] });
  assert.match(html, /data-action="untarget"/);
  assert.match(html, /is-warn"[^>]*data-tooltip-text="t">Out of range/);
  assert.doesNotMatch(html, /data-action="bucketRemove"/);
  const edited = bucket.withValue(bucket.makeEntry({ uuid: "b", kind: "item", value: { gp: 8, source: "cost", cite: "p. 2" } }), 12);
  assert.match(bucket.bucketView({}, [edited], { key: "k", loc }).rows[0].valueTip, /"was":" \(was 8\)"/);
});

t("a row's art is the document's own image, a default icon where it has none, a glyph for power", () => {
  const withImg = bucket.makeEntry({ uuid: "a", kind: "item", name: "A", img: "icons/test/own.svg" });
  const bare = bucket.makeEntry({ uuid: "b", kind: "actor", name: "B" });
  const power = bucket.powerEntry({ key: "arcane", name: "Arcane power", balance: 3 });
  const view = bucket.bucketView({}, [withImg, bare, power], { key: "k", loc });
  assert.equal(row(view, "a").img, "icons/test/own.svg");
  assert.equal(row(view, "b").img, "icons/svg/mystery-man.svg");
  assert.deepEqual([row(view, "a").glyph, row(view, "power:arcane").glyph, row(view, "power:arcane").img], ["", "fa-bolt", ""]);
  const html = render(view);
  assert.match(html, /<img src="icons\/test\/own\.svg"/);
  assert.match(html, /fa-solid fa-bolt/);
  assert.doesNotMatch(html, /gradient|data:image/);
});

t("a standard bucket renders its rows, fit chip, X, total and drop zone without an id or a title attribute", () => {
  const e = bucket.makeEntry({ uuid: "Item.a", kind: "item", name: "Lantern stings", qty: 2, cap: 2, value: { gp: 14, each: 7, source: "cost", cite: "p. 4" }, fit: "mine" });
  const view = bucket.bucketView({ fit: FIT, due: { gp: 10 } }, [e], { key: "components", loc, legend: "Components", icon: "fa-flask" });
  const html = render(view);
  assert.match(html, /data-bucket="components"/);
  assert.match(html, /data-action="bucketFit"/);
  assert.match(html, /data-action="bucketRemove" data-uuid="Item\.a" aria-label="remove\|\{&quot;name&quot;:&quot;Lantern stings&quot;\}"/);
  assert.match(html, /is-covered/);
  assert.match(html, /data-bucket-drop="components"/);
  assert.doesNotMatch(html, /\sid=|\stitle=/);
  assert.doesNotMatch(html, /type="radio"/);
  const locked = render(bucket.bucketView({ fit: FIT }, [e], { key: "components", loc, locked: true }));
  assert.doesNotMatch(locked, /bucketRemove|data-bucket-drop|bucketFit/);
});

t("a pick-one bucket renders radios, tags the picked row Used and dims a too-low row's art and name but not its reason", () => {
  const a = bucket.makeEntry({ uuid: "a", kind: "item", name: "Antler set", img: "icons/test/a.svg" });
  const b = bucket.makeEntry({ uuid: "b", kind: "item", name: "Bone set", img: "icons/test/b.svg" });
  const c = bucket.makeEntry({ uuid: "c", kind: "item", name: "Reed set", img: "icons/test/c.svg" });
  const view = bucket.bucketView({ pick: "one", fit: FIT, due: { gp: 99 } }, [a, b, c], {
    key: "implements",
    loc,
    legend: "Implements",
    picked: "a",
    rows: {
      a: { caption: "Level 2 · effective 2", captionTip: "tip a", diamonds: { filled: 2, lost: 0 } },
      b: { caption: "Level 4 · effective 3", diamonds: { filled: 3, lost: 1 } },
      c: { caption: "Level 3 · effective 1", diamonds: { filled: 1, lost: 2 }, off: true, reason: "Effective 1 is below invocation 2" },
    },
  });
  assert.equal(view.head, null, "a pick bucket has no total");
  assert.equal(row(view, "a").fit, null);
  assert.deepEqual(row(view, "b").diamonds, [true, true, true, false]);
  assert.deepEqual([row(view, "c").off, row(view, "c").disabled, row(view, "a").picked, row(view, "b").picked], [true, true, true, false]);
  const html = render(view);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/name="bucket-implements"/g) ?? []).length, 3);
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/is-used/g) ?? []).length, 1);
  assert.match(html, /<span class="acks-extras-bucket__tag is-ok">used<\/span>/);
  assert.match(html, /Level 2 · effective 2/);
  assert.match(html, /&#9670;&#9670;/);
  assert.match(html, /disabled/);
  assert.match(html, /Effective 1 is below invocation 2/);
  const reason = html.match(/<span class="([^"]*)">Effective 1 is below/)[1];
  assert.doesNotMatch(reason, /dim/, "the reason carries no dimming class");
  const offRow = html.slice(html.indexOf('data-uuid="c"'));
  assert.match(offRow, /acks-extras-bucket__dim/);
  assert.doesNotMatch(html, /bucketFit/);
});

/* -------------------------------------------- */
/*  The row's optional slot                    */
/* -------------------------------------------- */

/** A render with the row template given by its source, so the slot's absence can be held to the template that had no slot. */
function renderWith(view, rowSource, partials = {}) {
  const hbs = Handlebars.create();
  hbs.registerHelper("localize", (key) => key);
  const dir = new URL("../templates/lib/", import.meta.url);
  hbs.registerPartial("modules/acks-extras/templates/lib/bucket-row.hbs", rowSource);
  for (const [name, source] of Object.entries(partials)) hbs.registerPartial(name, source);
  return hbs.compile(fs.readFileSync(new URL("bucket.hbs", dir), "utf8"))(view);
}

t("a bucket with no slot in use renders byte for byte as the template did without the slot, for every shape of row", () => {
  const now = fs.readFileSync(new URL("../templates/lib/bucket-row.hbs", import.meta.url), "utf8");
  const before = now.replace(/ {4}\{\{#unless pick\}\}[\s\S]*?\{\{\/unless\}\}\n/, "");
  assert.notEqual(before, now, "the slot is a block of its own lines, which this removes");
  const a = bucket.makeEntry({ uuid: "Item.a", kind: "item", name: "Lantern stings", qty: 2, cap: 2, value: { gp: 14, each: 7, source: "cost", cite: "p. 4" }, fit: "mine", img: "icons/a.svg" });
  const gone = bucket.makeEntry({ uuid: "Actor.b", kind: "actor", name: "Dead one", img: "b.png", reason: "No yield" });
  const standard = bucket.bucketView({ fit: FIT, due: { gp: 10 } }, [a, gone], { key: "components", loc, legend: "Components", icon: "fa-flask" });
  const pick = bucket.bucketView({ pick: "one", fit: FIT }, [a, gone], { key: "implements", loc, legend: "Implements", picked: "Item.a", rows: { "Item.a": { caption: "Level 2", diamonds: { filled: 1, lost: 1 } }, "Actor.b": { caption: "Level 3", off: true, reason: "Too low" } } });
  const locked = bucket.bucketView({ fit: FIT }, [a], { key: "components", loc, locked: true });
  for (const view of [standard, pick, locked]) assert.equal(renderWith(view, now), renderWith(view, before));
  for (const r of standard.rows) assert.equal("extra" in r, false, "a row without a slot carries no key for it");
});

t("a row given an extra draws that partial under its caption with the extra as its context; a pick row never draws it", () => {
  const e = bucket.makeEntry({ uuid: "Actor.v", kind: "actor", name: "Captive", value: { gp: 5, source: "xp", cite: "p. 1" } });
  const partial = "modules/acks-extras/templates/test/extra.hbs";
  const parts = { [partial]: "<b class=\"mine\">{{label}}</b>" };
  const view = bucket.bucketView({}, [e], { key: "v", loc, legend: "V", rows: { "Actor.v": { extra: { partial, label: "checks here" } } } });
  const html = renderWith(view, fs.readFileSync(new URL("../templates/lib/bucket-row.hbs", import.meta.url), "utf8"), parts);
  assert.match(html, /<span class="acks-extras-bucket__extra"><b class="mine">checks here<\/b><\/span>/);
  assert.ok(html.indexOf("acks-extras-bucket__figure") < html.indexOf("checks here"), "under the value line");
  const picked = bucket.bucketView({ pick: "one" }, [e], { key: "v", loc, legend: "V", rows: { "Actor.v": { caption: "c", extra: { partial, label: "checks here" } } } });
  assert.doesNotMatch(renderWith(picked, fs.readFileSync(new URL("../templates/lib/bucket-row.hbs", import.meta.url), "utf8"), parts), /checks here/);
});

t("the stylesheet dims an off row's controls and never its reason, rounds nothing and sizes type by the ramp", () => {
  const css = fs.readFileSync(new URL("../styles/lib-bucket.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /border-radius|999px/);
  assert.doesNotMatch(css, /font-size:\s*[\d.]+(px|rem)/);
  assert.doesNotMatch(css, /gradient/);
  const dims = css.match(/\.is-off[^{]*\{[^}]*opacity/g) ?? [];
  assert.ok(dims.length && dims.every((d) => !/reason/.test(d)));
  assert.match(css, /\.acks-extras-bucket__reason\s*\{[^}]*color:/);
});

console.log(`\n${n} bucket tests passed`);
