/**
 * The item runner's presses on the Token HUD (`item-run-hud.mjs`), offline: which
 * of an actor's items draw a control (one with an activation, owned by this
 * seat, not used up), the verb each reads (a toggle's Raise or Lower by its
 * state, Light for a fuse, held off while it is lit and the stack holds no spare,
 * Use for any other kind), `active` while raised, the item's own picture
 * or the aura glyph where it has none or wears a default one, and the actor's
 * item order. Foundry-free with stand-ins; every name below is invented.
 *
 * Usage: node tools/test-item-run-hud.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: false } };

const { itemRunHudControls, HUD_FALLBACK_IMG } = await import("../scripts/lib/item-run-hud.mjs");
const { SPENDING_KINDS } = await import("../scripts/lib/item-run-logic.mjs");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const SACK = "icons/default/sack.webp";
const OWN = "icons/own/picture.webp";

/** A plain stand-in item: `run` is the stored `itemRun` flag, `quantity` the system count (omitted for none). */
const item = (id, run, { type = "item", img = OWN, sort = 0, isOwner = true, quantity, name = `Thing ${id}` } = {}) => ({
  id,
  name,
  type,
  img,
  sort,
  isOwner,
  ...(quantity === undefined ? {} : { system: { quantity } }),
  flags: { "acks-extras": run ? { itemRun: run } : {} },
});
const toggle = (active = false, extra = {}) => ({ activation: { kind: "toggle", state: { active, activationId: active ? "a" : "", regionId: "" }, ...extra }, rows: [] });
const kind = (k, extra = {}) => ({ activation: { kind: k, ...extra }, rows: [] });
const ids = (controls) => controls.map((c) => c.id);

await t("only an item with an activation draws; an always-on item, an unflagged one, a spell and an unknown kind draw none", () => {
  const items = [
    item("a", toggle()),
    item("b", { rows: [{ key: "r" }] }),
    item("c", null),
    item("d", kind("once"), { type: "spell" }),
    item("e", kind("nonsense")),
    item("f", kind("once")),
  ];
  assert.deepEqual(ids(itemRunHudControls(items)), ["a", "f"]);
  assert.deepEqual(itemRunHudControls([]), []);
  assert.deepEqual(itemRunHudControls(null), []);
});

await t("a toggle reads Raise while lowered and Lower and active while raised; a fuse reads Light and every other kind reads Use, none ever active", () => {
  const [lowered] = itemRunHudControls([item("a", toggle(false))]);
  assert.equal(lowered.verb, "raise");
  assert.equal(lowered.active, false);
  const [raised] = itemRunHudControls([item("a", toggle(true))]);
  assert.equal(raised.verb, "lower");
  assert.equal(raised.active, true);
  for (const k of ["once", "fuse", "consume"]) {
    const [c] = itemRunHudControls([item("a", kind(k))]);
    assert.equal(c.verb, k === "fuse" ? "light" : "use", k);
    assert.equal(c.active, false, k);
    assert.equal(c.kind, k);
  }
  assert.equal(itemRunHudControls([item("a", toggle(true))])[0].name, "Thing a", "the control carries the item's name for its label");
});

await t("a seat sees only the items it owns, by the predicate it is given and by isOwner without one", () => {
  const items = [item("mine", kind("once")), item("theirs", kind("once"), { isOwner: false })];
  assert.deepEqual(ids(itemRunHudControls(items)), ["mine"]);
  assert.deepEqual(ids(itemRunHudControls(items, { owns: () => true })), ["mine", "theirs"]);
  assert.deepEqual(ids(itemRunHudControls(items, { owns: (i) => i.id === "theirs" })), ["theirs"]);
  assert.deepEqual(ids(itemRunHudControls([{ ...item("x", kind("once")), isOwner: undefined }])), [], "an unanswered ownership is not ownership");
});

await t("a spending kind with a count of none is used up and draws nothing", () => {
  for (const k of SPENDING_KINDS) {
    assert.deepEqual(ids(itemRunHudControls([item("a", kind(k), { quantity: 0 })])), [], `${k} at 0`);
    assert.deepEqual(ids(itemRunHudControls([item("a", kind(k), { quantity: 1 })])), ["a"], `${k} at 1`);
  }
  assert.deepEqual(ids(itemRunHudControls([item("a", kind("consume"), { quantity: -1 })])), [], "a count below none is none");
});

await t("a kind that names `uses` spends a count too, and a kind that does not is never used up", () => {
  const counted = kind("once", { uses: { doc: "d", table: "t", row: "r", figure: "uses" } });
  assert.deepEqual(ids(itemRunHudControls([item("a", counted, { quantity: 0 })])), []);
  assert.deepEqual(ids(itemRunHudControls([item("a", counted, { quantity: 2 })])), ["a"]);
  const ticked = kind("once", { uses: {} });
  assert.deepEqual(ids(itemRunHudControls([item("a", ticked, { quantity: 0 })])), [], "the editor's tick, an empty `uses`, names a count: none draws no control");
  assert.deepEqual(ids(itemRunHudControls([item("a", ticked, { quantity: 1 })])), ["a"], "and one left draws it");
  assert.deepEqual(ids(itemRunHudControls([item("a", kind("once"), { quantity: 0 })])), ["a"], "an uncounted once-only item keeps its press");
  assert.deepEqual(ids(itemRunHudControls([item("a", toggle(false), { quantity: 0 })])), ["a"], "an uncounted toggle keeps its press");
});

await t("an item with no count is not used up: no quantity read is not a count of none", () => {
  assert.deepEqual(ids(itemRunHudControls([item("a", kind("consume"))])), ["a"]);
  assert.deepEqual(ids(itemRunHudControls([item("a", kind("fuse"), { quantity: "none" })])), ["a"]);
});

await t("a raised item always draws, so a count of none never strands it without its Lower", () => {
  const counted = toggle(true, { uses: { doc: "d", table: "t", row: "r", figure: "uses" } });
  const [c] = itemRunHudControls([item("a", counted, { quantity: 0 })]);
  assert.equal(c.verb, "lower");
  assert.equal(c.active, true);
  assert.deepEqual(ids(itemRunHudControls([item("a", toggle(false, { uses: { doc: "d" } }), { quantity: 0 })])), [], "lowered at none is used up");
});

await t("the picture is the item's own, else the aura glyph; a default picture counts as none", () => {
  const defaults = () => [SACK, "icons/other/default.webp"];
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: OWN })], { defaultImgsOf: defaults })[0].img, OWN);
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: SACK })], { defaultImgsOf: defaults })[0].img, HUD_FALLBACK_IMG);
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: "icons/other/default.webp" })], { defaultImgsOf: defaults })[0].img, HUD_FALLBACK_IMG);
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: "" })], { defaultImgsOf: defaults })[0].img, HUD_FALLBACK_IMG);
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: null })])[0].img, HUD_FALLBACK_IMG);
  assert.equal(itemRunHudControls([item("a", kind("once"), { img: SACK })])[0].img, SACK, "with no defaults named, any picture is the item's own");
  assert.equal(HUD_FALLBACK_IMG, "icons/svg/aura.svg");
  const seen = [];
  itemRunHudControls([item("a", kind("once"), { type: "item" }), item("b", kind("once"), { type: "weapon" })], { defaultImgsOf: (i) => (seen.push(i.type), []) });
  assert.deepEqual(seen, ["item", "weapon"], "the default is asked for each item, by its type");
});

await t("the controls follow the actor's item order: by sort, ties in the list's order, an item with no sort first", () => {
  const items = [item("c", kind("once"), { sort: 300 }), item("a", kind("once"), { sort: 100 }), item("tie1", kind("once"), { sort: 200 }), item("tie2", kind("once"), { sort: 200 }), item("z", kind("once"), { sort: undefined })];
  assert.deepEqual(ids(itemRunHudControls(items)), ["z", "a", "tie1", "tie2", "c"]);
  assert.deepEqual(ids(itemRunHudControls(new Set(items.slice(0, 2)))), ["a", "c"], "any iterable of items");
});

await t("a fuse that is lit draws Light only while the stack holds a spare, reading the lit fuses through the effects dep", () => {
  const fuse = (quantity) => ({ ...item("f", kind("fuse"), quantity === undefined ? {} : { quantity }), uuid: "I.f" });
  const record = (source, dueAt) => ({ flags: { "acks-extras": { fuse: { source, activationId: `a${dueAt}`, spot: {}, dueAt } } } });
  const lit = [record("I.f", 100)];
  const withEffects = (effects) => ({ effectsOf: () => effects });
  assert.deepEqual(ids(itemRunHudControls([fuse(2)], withEffects(lit))), ["f"], "two in the stack, one lit");
  assert.equal(itemRunHudControls([fuse(2)], withEffects(lit))[0].verb, "light");
  assert.deepEqual(itemRunHudControls([fuse(1)], withEffects(lit)), [], "one in the stack, one lit: no spare");
  assert.deepEqual(itemRunHudControls([fuse()], withEffects(lit)), [], "no quantity counts one");
  assert.deepEqual(itemRunHudControls([fuse(2)], withEffects([record("I.f", 100), record("I.f", 200)])), [], "two lit of two");
  assert.deepEqual(ids(itemRunHudControls([fuse(2)], withEffects([record("I.other", 100)]))), ["f"], "another item's fuse is not this one's");
  assert.deepEqual(ids(itemRunHudControls([fuse(1)], withEffects([]))), ["f"], "nothing lit");
  assert.deepEqual(ids(itemRunHudControls([{ ...fuse(1), actor: { effects: lit } }])), [], "by default the item's actor's effects");
  assert.deepEqual(ids(itemRunHudControls([{ ...fuse(1), actor: { effects: [] } }])), ["f"]);
  assert.deepEqual(ids(itemRunHudControls([{ ...item("o", kind("once"), { quantity: 1 }), uuid: "I.f" }], withEffects(lit))), ["o"], "only a fuse is held off by a lit one");
});

await t("a control holds only what the HUD draws from", () => {
  const [c] = itemRunHudControls([item("a", toggle(true), { sort: 5 })]);
  assert.deepEqual(Object.keys(c).sort(), ["active", "id", "img", "kind", "name", "verb"]);
});

console.log(`\ntest-item-run-hud: ${passed} checks passed.`);
