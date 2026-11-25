/**
 * The damage die of a spell row that states none (scripts/magic/spell-die.mjs,
 * spell-die-prompt.mjs, cast-rows.mjs `withKeptDice`).
 *
 * What this pins: a die kept for a row is read into the row by the copy's own
 * flag and, for a copy that follows its library twin, by the twin's; a row that
 * states a die is never replaced; a Judge's save writes the blank copies and the
 * entry, leaves a copy that has a die alone, and says a locked entry was not
 * written; the window takes whatever the dice roller parses, refuses the rest on
 * itself, and keeps where the seat may; a cast asks once for a row however many
 * instances throw; and the offer card is drawn from the world. The live window
 * and the writes through Foundry are the recipe's (docs/magic/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };
const MODULE = "acks-extras";

const warned = [];
const cards = [];
const hooks = {};
const shown = [];
let failWrites = false;
let mayModify = true;
let validFormula = (f) => /^[\d\s+\-d]+$/.test(f);

/** A DialogV2 stand-in: the config it was built with, the nodes the code queries, and its listeners. */
class FakeDialog {
  constructor(config) {
    this.config = config;
    this.closed = false;
    this.listeners = {};
    this.face = { textContent: "" };
    this.button = { attrs: {}, querySelector: () => this.face, setAttribute: (k, v) => { this.button.attrs[k] = v; } };
    this.error = { hidden: true, textContent: "" };
    this.field = { attrs: {}, setAttribute: (k, v) => { this.field.attrs[k] = v; }, focus() {} };
    this.keep = config.content.includes('name="keep"') ? { checked: false, addEventListener: (_t, fn) => { this.keep.onChange = fn; } } : null;
    const nodes = { 'button[data-action="attack"]': this.button, "[data-spell-die-error]": this.error, 'input[name="formula"]': this.field, 'input[name="keep"]': this.keep };
    this.element = { querySelector: (sel) => nodes[sel] ?? null };
    shown.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  render() { for (const fn of this.listeners.render ?? []) fn(); return this; }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.listeners.close ?? []) fn();
  }
  async press(formula, { keep } = {}) {
    if (this.keep && keep !== undefined) { this.keep.checked = keep; this.keep.onChange(); }
    const elements = { formula: { value: formula }, keep: this.keep ? { checked: this.keep.checked } : undefined };
    const answer = await this.config.buttons[0].callback(null, { form: { elements } });
    await this.config.submit(answer, this);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const judge = { id: "judge", name: "Judge", can: (p) => p === "SETTINGS_MODIFY" };
const player = { id: "player", name: "Player", can: () => false };
let me = player;
const worldItems = [];
const worldActors = [];
const byUuid = {};
const library = new Map();
const packs = new Map();

globalThis.foundry = { applications: { api: { DialogV2: FakeDialog } } };
globalThis.game = {
  i18n: { has: () => false, localize: (k) => k, format: (k, d) => (d && Object.keys(d).length ? `${k} ${JSON.stringify(d)}` : k) },
  get user() { return me; },
  users: [player, judge],
  items: worldItems,
  actors: worldActors,
  packs: Object.assign([], { get: (id) => packs.get(id) }),
};
void mayModify;
globalThis.ChatMessage = { create: async (data) => { cards.push(data); return data; }, getSpeaker: ({ actor }) => ({ alias: actor.name }) };
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
globalThis.ui = { notifications: { warn: (m) => warned.push(m), info() {} } };
globalThis.Roll = { validate: (f) => validFormula(f) };
globalThis.fromUuidSync = (uuid) => byUuid[uuid] ?? null;
globalThis.CONFIG = {
  Item: {
    documentClass: class {
      constructor(data, options = {}) { Object.assign(this, data); this.parent = options.parent ?? null; }
      updateSource(patch) {
        for (const [path, value] of Object.entries(patch)) {
          const parts = path.split(".");
          let node = this;
          for (const part of parts.slice(0, -1)) node = node[part];
          node[parts.at(-1)] = value;
        }
      }
    },
  },
};

let seq = 0;
/** A spell stand-in with its effect rows, its kept dice and the writes a seat may make. */
function spell({ name = "Missile", cookbook = "", source = "", rows = [], kept = null, pack = "", canWrite = true, parent = null } = {}) {
  const id = `s${++seq}`;
  const item = {
    id,
    name,
    type: "spell",
    pack,
    uuid: pack ? `Compendium.${pack}.Item.${id}` : `Item.${id}`,
    parent,
    _stats: source ? { compendiumSource: source } : {},
    flags: { [MODULE]: { ...(cookbook ? { cookbook: { id: cookbook } } : {}), spell: { effects: rows }, ...(kept ? { spellDie: kept } : {}) } },
    canUserModify: () => canWrite,
    async setFlag(_m, key, value) {
      if (failWrites) throw new Error("refused");
      item.flags[MODULE][key] = value;
      return item;
    },
  };
  byUuid[item.uuid] = item;
  if (cookbook && !pack.startsWith("copy")) library.set(cookbook, item);
  return item;
}
const damage = (key, roll = "", extra = {}) => ({ key, type: "damage", roll, delivery: "none", ...extra });

const lookups = { byCookbookId: (_t, id) => library.get(id) ?? null, fromUuidSync: (uuid) => byUuid[uuid] ?? null };

const { rowsOf, withKeptDice, damageBlank } = await import("../scripts/magic/cast-rows.mjs");
const D = await import("../scripts/magic/spell-die.mjs");
const P = await import("../scripts/magic/spell-die-prompt.mjs");
const { spellCarrier } = await import("../scripts/lib/patches/attack-throw.mjs");

await ok("a kept die fills a blank damage row and never replaces a stated one", () => {
  const rows = [damage("a"), damage("b", "2d6"), { key: "c", type: "heal", roll: "" }, damage("")];
  const copy = spell({ rows, kept: { a: "1d4+1", b: "9d9", "#3": "3", c: "5d5" } });
  const read = rowsOf(copy, lookups).rows;
  assert.equal(read[0].roll, "1d4+1");
  assert.equal(read[1].roll, "2d6", "a row that states a die is left as stated");
  assert.equal(read[2].roll, "", "only a damage row takes a kept die");
  assert.equal(read[3].roll, "3", "a row with no key of its own is told by its position");
  assert.equal(damageBlank(read[0]), false);
  assert.equal(damageBlank(rows[0]), true);
  const untouched = spell({ rows });
  assert.ok(rowsOf(untouched, lookups).rows.every((row, i) => row === rows[i]), "with nothing kept the rows are the very objects they were");
  assert.equal(withKeptDice(rows, untouched), rows);
});

await ok("a die typed at the cast rides on the card and fills a blank recurring row wherever the card is read back", async () => {
  const { castAt, rowsOfMode, rowsForMode } = await import("../scripts/magic/cast-rows.mjs");
  const rows = [damage("burn", "", { recur: "laterRounds" }), damage("stated", "1d8", { recur: "laterRounds" }), damage("other")];
  const card = { invocationLevel: 3, dice: { burn: "2d4+1", stated: "9d9", other: "  " } };
  assert.deepEqual(castAt(card), { invocationLevel: 3, dice: card.dice });
  assert.deepEqual(castAt({ invocationLevel: 3 }), { invocationLevel: 3 }, "a card with no typed die reads as it always did");
  assert.deepEqual(castAt({ dice: {} }), { invocationLevel: null }, "an empty record is no die");
  const read = rowsForMode(rows, "normal", {}, castAt(card));
  assert.equal(read[0].row.roll, "2d4+1");
  assert.equal(read[1].row.roll, "1d8", "a row that states a die keeps it");
  assert.equal(read[2].row.roll, "", "a blank typed answer fills nothing");
  const plain = rowsOfMode(rows, "normal", castAt({}));
  assert.ok(plain.every(({ row }, i) => row === rows[i]), "with no dice the rows are the very objects they were");
});

await ok("a copy with no rows follows its twin, and reads the die kept on the copy before the twin's", () => {
  const twin = spell({ cookbook: "mm", rows: [damage("a"), damage("b")], kept: { a: "1d6" } });
  const follower = spell({ cookbook: "mm", rows: [], pack: "copy" });
  assert.equal(rowsOf(follower, lookups).from, "twin");
  assert.equal(rowsOf(follower, lookups).rows[0].roll, "1d6", "the twin's kept die reaches a copy that follows it");
  follower.flags[MODULE].spellDie = { a: "2d8", b: "5" };
  const read = rowsOf(follower, lookups).rows;
  assert.equal(read[0].roll, "2d8", "the copy's own die comes first");
  assert.equal(read[1].roll, "5");
});

await ok("a copy is matched to its source by cookbook id, else by the compendium source, and never to itself", () => {
  const source = spell({ cookbook: "x1", pack: "lib.spells" });
  const byId = spell({ cookbook: "x1", pack: "copy" });
  const bySource = spell({ source: source.uuid, pack: "copy" });
  const other = spell({ cookbook: "x2", pack: "copy" });
  const bare = spell({ pack: "copy" });
  assert.equal(D.isCopyOf(byId, source), true);
  assert.equal(D.isCopyOf(bySource, source), true);
  assert.equal(D.isCopyOf(other, source), false);
  assert.equal(D.isCopyOf(bare, source), false, "no cookbook id and no compendium source is no copy");
  assert.equal(D.isCopyOf(source, source), false);
});

const world = (items) => ({ lookups, items });

await ok("the plan sorts the entry and each copy by whether the row has a die", () => {
  const source = spell({ cookbook: "p1", pack: "lib.spells", rows: [damage("a")] });
  const mine = spell({ cookbook: "p1", pack: "copy", rows: [damage("a")] });
  const blank = spell({ cookbook: "p1", pack: "copy", rows: [damage("a")] });
  const stated = spell({ cookbook: "p1", pack: "copy", rows: [damage("a", "1d8")] });
  const keptOne = spell({ cookbook: "p1", pack: "copy", rows: [damage("a")], kept: { a: "7" } });
  const follower = spell({ cookbook: "p1", pack: "copy", rows: [] });
  const plan = D.planKeepForAll(mine, "a", world([mine, blank, stated, keptOne, follower, source]));
  assert.equal(plan.source, source);
  assert.equal(plan.entryBlank, true);
  assert.deepEqual(plan.blank.map((c) => c.id).sort(), [mine.id, blank.id, follower.id].sort());
  assert.deepEqual(plan.kept.map((c) => c.id).sort(), [stated.id, keptOne.id].sort(), "a stated die and a kept die both count as having one");
  assert.equal(D.blankCount(plan), 4, "three copies and the entry");
});

await ok("a Judge's save writes the blank copies and the entry, and leaves a copy that has a die alone", async () => {
  const source = spell({ cookbook: "k1", pack: "lib.spells", rows: [damage("a")] });
  const mine = spell({ cookbook: "k1", pack: "copy", rows: [damage("a")] });
  const blank = spell({ cookbook: "k1", pack: "copy", rows: [damage("a")] });
  const stated = spell({ cookbook: "k1", pack: "copy", rows: [damage("a", "1d8")] });
  const keptOne = spell({ cookbook: "k1", pack: "copy", rows: [damage("a")], kept: { a: "7" } });
  packs.set("lib.spells", { locked: false });
  const made = await D.keepForAll(mine, "a", "2d4", world([mine, blank, stated, keptOne, source]));
  assert.deepEqual(made, { written: 2, kept: 2, failed: 0, entry: "written" });
  assert.equal(mine.flags[MODULE].spellDie.a, "2d4");
  assert.equal(blank.flags[MODULE].spellDie.a, "2d4");
  assert.equal(source.flags[MODULE].spellDie.a, "2d4");
  assert.equal(keptOne.flags[MODULE].spellDie.a, "7", "a copy with a die is never overwritten");
  assert.equal(stated.flags[MODULE].spellDie, undefined);
  const again = await D.keepForAll(mine, "a", "9d9", world([mine, blank, stated, keptOne, source]));
  assert.deepEqual(again, { written: 0, kept: 4, failed: 0, entry: "had" }, "a second save writes nothing");
});

await ok("an entry in a locked compendium is not written, and the blank copies still are", async () => {
  const source = spell({ cookbook: "l1", pack: "lib.locked", rows: [damage("a")] });
  const mine = spell({ cookbook: "l1", pack: "copy", rows: [damage("a")] });
  packs.set("lib.locked", { locked: true });
  const plan = D.planKeepForAll(mine, "a", world([mine, source]));
  assert.equal(D.blankCount(plan), 1, "the count leaves the entry out");
  const made = await D.keepForAll(mine, "a", "1d6", world([mine, source]));
  assert.deepEqual(made, { written: 1, kept: 0, failed: 0, entry: "locked" });
  assert.equal(source.flags[MODULE].spellDie, undefined);
  assert.equal(mine.flags[MODULE].spellDie.a, "1d6");
  assert.match(P.doneLine(made), /entryLocked/);
});

await ok("a write the world refuses is counted, not thrown", async () => {
  const source = spell({ cookbook: "f1", pack: "lib.spells", rows: [damage("a")] });
  const mine = spell({ cookbook: "f1", pack: "copy", rows: [damage("a")] });
  packs.set("lib.spells", { locked: false });
  failWrites = true;
  const made = await D.keepForAll(mine, "a", "1d6", world([mine, source]));
  failWrites = false;
  assert.deepEqual(made, { written: 0, kept: 0, failed: 1, entry: "failed" });
});

await ok("a Judge's window offers the every-copy box with the blank count, and keeps on a ticked press", async () => {
  me = judge;
  const source = spell({ cookbook: "w1", pack: "lib.spells", rows: [damage("a")] });
  const mine = spell({ cookbook: "w1", pack: "copy", rows: [damage("a")] });
  const other = spell({ cookbook: "w1", pack: "copy", rows: [damage("a")] });
  worldItems.length = 0;
  worldItems.push(mine, other, source);
  const caster = { name: "Hero" };
  const before = shown.length;
  const run = P.askSpellDie({ caster, spell: mine, rowKey: "a", castId: "c1", lookups });
  await tick();
  const w = shown.at(-1);
  assert.equal(shown.length, before + 1);
  assert.ok(w.keep, "the box is offered");
  assert.ok(w.config.content.includes("allLabel"), "it saves on every copy");
  assert.match(w.config.content, /count\D+3\b/, "the tooltip carries the blank count: two copies and the entry");
  w.keep.checked = true; w.keep.onChange();
  assert.equal(w.face.textContent, "ACKS-MAGIC.spellDie.save");
  assert.ok(w.button.attrs["data-tooltip-text"].includes("allSaveTip"));
  await w.press("1d6+2", { keep: true });
  assert.equal(await run, "1d6+2");
  assert.equal(other.flags[MODULE].spellDie.a, "1d6+2");
  assert.equal(source.flags[MODULE].spellDie.a, "1d6+2");
  assert.equal(cards.length, 0, "a Judge forwards nothing to anyone");
  worldItems.length = 0;
});

await ok("the window takes a flat figure and any formula the roller parses, and refuses the rest on itself", async () => {
  me = judge;
  const mine = spell({ cookbook: "v1", pack: "copy", rows: [damage("a")] });
  const run = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c2", lookups });
  await tick();
  const w = shown.at(-1);
  await w.press("a lot");
  assert.equal(w.closed, false, "a refusal leaves the window open");
  assert.equal(w.error.hidden, false);
  assert.ok(w.error.textContent.includes("invalid"));
  assert.equal(w.field.attrs["aria-invalid"], "true");
  await w.press("7");
  assert.equal(await run, "7", "a flat figure is a formula the row's reader parses");
});

await ok("an owner without world-settings permission keeps on the character's copy and the Judge is whispered the offer", async () => {
  me = player;
  const source = spell({ cookbook: "o1", pack: "lib.spells", rows: [damage("a")] });
  const mine = spell({ cookbook: "o1", pack: "copy", rows: [damage("a")], canWrite: true });
  cards.length = 0;
  const caster = { name: "Hero" };
  const run = P.askSpellDie({ caster, spell: mine, rowKey: "a", castId: "c3", lookups });
  await tick();
  const w = shown.at(-1);
  assert.ok(w.config.content.includes("copyLabel"), "the box keeps on the character's copy");
  assert.ok(!w.config.content.includes("allLabel"));
  await w.press("2d4", { keep: true });
  assert.equal(await run, "2d4");
  assert.equal(mine.flags[MODULE].spellDie.a, "2d4");
  assert.equal(source.flags[MODULE].spellDie, undefined, "the entry is the Judge's to write");
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].whisper, ["judge"]);
  const flag = cards[0].flags[MODULE].spellDieOffer;
  assert.deepEqual({ die: flag.die, rowKey: flag.rowKey, spellUuid: flag.spellUuid, character: flag.character }, { die: "2d4", rowKey: "a", spellUuid: mine.uuid, character: "Hero" });
  assert.ok(cards[0].content.includes("data-spell-die-offer-save"));
  assert.ok(cards[0].content.includes('"count":1') || cards[0].content.includes("count"), "the press names what it would write");
});

await ok("a seat that may write nothing has the field and Attack alone, and keeps nothing", async () => {
  me = player;
  const mine = spell({ cookbook: "n1", pack: "copy", rows: [damage("a")], canWrite: false });
  cards.length = 0;
  const run = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c4", lookups });
  await tick();
  const w = shown.at(-1);
  assert.equal(w.keep, null);
  assert.ok(w.config.content.includes("hintNone"));
  await w.press("1d4");
  assert.equal(await run, "1d4");
  assert.equal(mine.flags[MODULE].spellDie, undefined);
  assert.equal(cards.length, 0);
});

await ok("an unticked box keeps nothing, and a refused write is said and sends no offer", async () => {
  me = player;
  const mine = spell({ cookbook: "u1", pack: "copy", rows: [damage("a")] });
  cards.length = 0;
  let run = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c5", lookups });
  await tick();
  await shown.at(-1).press("1d4", { keep: false });
  assert.equal(await run, "1d4");
  assert.equal(mine.flags[MODULE].spellDie, undefined);
  assert.equal(cards.length, 0);
  failWrites = true;
  warned.length = 0;
  run = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c6", lookups });
  await tick();
  await shown.at(-1).press("1d4", { keep: true });
  failWrites = false;
  assert.equal(await run, "1d4", "the cast goes ahead with the die");
  assert.equal(cards.length, 0);
  assert.ok(warned.some((m) => m.includes("keepFailed")));
});

await ok("a cast asks once for a row, and a closed window cancels without being remembered", async () => {
  me = player;
  const mine = spell({ cookbook: "m1", pack: "copy", rows: [damage("a")], canWrite: false });
  const before = shown.length;
  const first = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c7", lookups });
  await tick();
  await shown.at(-1).close();
  assert.equal(await first, null, "closing cancels");
  const second = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c7", lookups });
  await tick();
  assert.equal(shown.length, before + 2, "a cancel is asked again");
  await shown.at(-1).press("2d6");
  assert.equal(await second, "2d6");
  const third = await P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "a", castId: "c7", lookups });
  assert.equal(third, "2d6", "the next instance reads the answer");
  assert.equal(shown.length, before + 2, "and opens no window");
  const other = P.askSpellDie({ caster: { name: "Hero" }, spell: mine, rowKey: "b", castId: "c7", lookups });
  await tick();
  assert.equal(shown.length, before + 3, "another row of the same cast asks for itself");
  await shown.at(-1).close();
  await other;
});

await ok("a carrier whose row states no die asks, carries the answer on the throw, and a stated die never asks", async () => {
  me = player;
  const mine = spell({ cookbook: "t1", pack: "copy", rows: [damage("a", "", { delivery: "missile" })], canWrite: false });
  const actor = { name: "Hero" };
  const carrier = spellCarrier(actor, mine.flags[MODULE].spell.effects[0], { spell: mine, castId: "c8", rowKey: "a" });
  const before = shown.length;
  const run = P.prepareSpellDie({ weapon: carrier });
  await tick();
  await shown.at(-1).press("1d10");
  assert.equal(await run, true);
  assert.equal(carrier.system.damage.base.formula, "1d10");
  const again = spellCarrier(actor, mine.flags[MODULE].spell.effects[0], { spell: mine, castId: "c8", rowKey: "a" });
  assert.equal(await P.prepareSpellDie({ weapon: again }), true);
  assert.equal(again.system.damage.base.formula, "1d10", "the second instance reads it without a window");
  assert.equal(shown.length, before + 1);
  const stated = spellCarrier(actor, damage("a", "1d6", { delivery: "missile" }), { spell: mine, castId: "c9", rowKey: "a" });
  assert.equal(await P.prepareSpellDie({ weapon: stated }), true);
  assert.equal(shown.length, before + 1, "a stated die opens no window");
  assert.equal(await P.prepareSpellDie({ weapon: { type: "weapon" } }), true, "a weapon that is no carrier is the weapon prompt's");
  const closing = spellCarrier(actor, mine.flags[MODULE].spell.effects[0], { spell: mine, castId: "c10", rowKey: "a" });
  const gone = P.prepareSpellDie({ weapon: closing });
  await tick();
  await shown.at(-1).close();
  assert.equal(await gone, false, "closing cancels the attack");
});

await ok("the offer card says what the world says and writes on one press", async () => {
  const source = spell({ cookbook: "r1", pack: "lib.locked", rows: [damage("a")] });
  const mine = spell({ cookbook: "r1", pack: "copy", rows: [damage("a")], kept: { a: "2d4" } });
  const other = spell({ cookbook: "r1", pack: "copy", rows: [damage("a")] });
  worldItems.length = 0;
  worldItems.push(mine, other, source);
  packs.set("lib.locked", { locked: true });
  assert.equal(P.offerState({ count: 2, mayKeep: true, found: true }), "offered");
  assert.equal(P.offerState({ count: 2, mayKeep: false, found: true }), "sent");
  assert.equal(P.offerState({ count: 0, mayKeep: true, found: true }), "saved");
  assert.equal(P.offerState({ count: 0, mayKeep: true, found: false }), "gone");
  P.registerSpellDiePrompt(() => lookups);
  const render = hooks.renderChatMessageHTML[0];
  const node = (extra = {}) => ({ hidden: false, dataset: {}, textContent: "", disabled: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, ...extra });
  const dom = () => {
    const parts = { "[data-spell-die-offer-save]": node(), "[data-spell-die-offer-result]": node({ hidden: true }), "[data-spell-die-offer-ignore]": node() };
    return { html: { querySelector: (s) => (s === "[data-spell-die-offer]" ? { querySelector: (q) => parts[q] ?? null } : null) }, parts };
  };
  const message = { getFlag: (_m, k) => (k === "spellDieOffer" ? { die: "2d4", rowKey: "a", spellUuid: mine.uuid, spell: "Missile", character: "Hero" } : null) };
  me = judge;
  let d = dom();
  render(message, d.html);
  assert.equal(d.parts["[data-spell-die-offer-save]"].hidden, false, "the press is shown to a seat that can save");
  await d.parts["[data-spell-die-offer-save]"].listeners.click({ preventDefault() {} });
  assert.equal(other.flags[MODULE].spellDie.a, "2d4");
  assert.equal(source.flags[MODULE].spellDie, undefined, "a locked entry is not written");
  assert.equal(d.parts["[data-spell-die-offer-save]"].hidden, true, "the press is gone once nothing is left to write");
  assert.ok(d.parts["[data-spell-die-offer-result]"].textContent.includes("offer.done"));
  assert.ok(d.parts["[data-spell-die-offer-result]"].textContent.includes("entryLocked"), "the card says the entry was not written");
  me = player;
  const unseen = spell({ cookbook: "r1", pack: "copy", rows: [damage("a")] });
  worldItems.push(unseen);
  d = dom();
  render(message, d.html);
  assert.equal(d.parts["[data-spell-die-offer-save]"].hidden, true, "a seat that cannot save sees no press");
  assert.ok(d.parts["[data-spell-die-offer-result]"].textContent.includes("offer.sent"));
  d = dom();
  render({ getFlag: () => null }, d.html);
  assert.equal(d.parts["[data-spell-die-offer-save]"].hidden, false, "a card with no offer is left alone");
  worldItems.length = 0;
});

console.log(`\n${passed} passed`);
