/**
 * A record's modifiers at the roll (scripts/lib/roll-mods.mjs): the parts an
 * Active Effect carries in its `rollMods` flag, resolved beside a weapon's own
 * bonus, scoped against the roll's other party, and put on the attack seam.
 *
 * Stand-in actors, effects, items and libWrapper: what this pins is the
 * resolution (which part is kept, which yields, what row each makes), the scope
 * handling, and that the contributor reaches only the questions it declared.
 * That core's card carries a row's label into its dice tooltip is the live
 * recipe's to prove. Every spell, weapon, label and figure below is invented.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

const registered = {};
const noop = function () {};
const said = [];
const TEXT = {
  "ACKS-LIB.rollMods.yields": "{name}, yielding to {to}",
  "ACKS-LIB.rollMods.onTarget": "{name} on {target}",
};
const format = (key, data = {}) => (TEXT[key] ?? `${key} ${JSON.stringify(data)}`).replace(/\{(\w+)\}/g, (_, n) => data[n] ?? "");
globalThis.game = {
  system: { id: "acks" },
  user: { targets: [] },
  i18n: { format, localize: (k) => k, has: () => false, translations: {} },
};
globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
globalThis.Hooks = { callAll: noop, on: noop };
globalThis.ui = { notifications: { warn: (m) => said.push(["warn", m]), info: (m) => said.push(["info", m]) } };
globalThis.Roll = { validate: () => true };
globalThis.ChatMessage = { getSpeakerActor: () => null };

class FakeItem {
  constructor(data, { parent } = {}) {
    this.name = data.name;
    this.type = data.type;
    this.parent = parent;
    this.id = data.id ?? null;
    this.flags = data.flags ?? {};
    this.system = {
      parent: this,
      ...data.system,
      getDamageFormula() { return this.damage?.base?.formula ?? ""; },
      getDamageModifiers() { return []; },
    };
  }
}
globalThis.CONFIG = {
  Actor: {
    documentClass: { prototype: { makeAttackThrow: noop } },
    dataModels: { character: { prototype: { getAttackThrowModifiers: noop, getDamageModifiers: noop } } },
  },
  Item: {
    documentClass: FakeItem,
    dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } },
  },
};

const seam = await import("../scripts/lib/patches/attack-throw.mjs");
const mods = await import("../scripts/lib/roll-mods.mjs");
const { stackingPart, isItemGate, gateVerdict } = await import("../scripts/lib/typed-modifiers.mjs");
const { MAGIC_ATTACK_TYPE, installAttackThrowPatch, spellCarrier } = seam;
const {
  rollModsOf, registerItemBonusSource, itemBonusParts, spellStackingPart, resolveItemParts, scopeCtxFor, rollModRows, saveModParts,
  sheetSaveShift, installRollMods, ROLL_MODS_ON,
} = mods;
installAttackThrowPatch();
installRollMods();
const makeAttackThrow = registered["CONFIG.Actor.documentClass.prototype.makeAttackThrow"];
const actorAttack = registered["CONFIG.Actor.dataModels.character.prototype.getAttackThrowModifiers"];
const actorDamage = registered["CONFIG.Actor.dataModels.character.prototype.getDamageModifiers"];

/* --- Stand-ins ------------------------------------------------------------- */

let serial = 0;
const SHARED = "kw:spellrecord";
const part = (on, value, over = {}) => ({ key: `${on}${value}`, on, value, provides: [SHARED], ...over });
/** An Active Effect carrying one record's flag. */
const effectOf = (parts, { id = "def.spell.testEdge", label = "Test Edge", cite = "Test cite", sourceAlignment = "lawful", ...rest } = {}) => ({
  id: `fx${++serial}`,
  disabled: false,
  flags: { "acks-extras": { rollMods: { id, label, cite, sourceAlignment, parts } } },
  ...rest,
});
const actorOf = (name, { effects = [], type = "character", types = [], alignment = "", disposition = null } = {}) => {
  const actor = {
    name,
    uuid: `Actor.${name}`,
    type,
    effects,
    appliedEffects: effects,
    system: { details: { alignment }, attack: { throw: 10 }, parent: null },
    getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" && types.length ? { types } : undefined),
    token: disposition === null ? null : { disposition, name },
  };
  actor.system.parent = actor;
  return actor;
};
const tokenOf = (actor) => ({ disposition: actor.token?.disposition ?? 0, name: actor.name, actor });
const weapon = (id, { magic = false } = {}) => new FakeItem({ id, name: `Blade ${id}`, type: "weapon", flags: { "acks-extras": { markets: { magic } } } });
/** The context one attack carries, as `attackContext` builds it. */
const attackCtx = (actor, foe, item = weapon("w1")) => ({
  actor,
  token: actor.token,
  item,
  weapon: item,
  target: foe ? tokenOf(foe) : null,
  targetActor: foe ?? null,
  targetName: foe?.name ?? null,
  options: {},
  terms: [],
  damageTerms: [],
});
const labelsOf = (rows) => rows.map((r) => `${r.label}|${r.value}`);
const MASTERWORK = "kw:masterwork";
/** A weapon's own bonus: the tier's figure on one field, as a source reports it. */
const tier = (figures) => (_item, on) => (figures[on] ? [{ key: `tier-${on}`, label: "Fine", value: figures[on], provides: [MASTERWORK], cite: "Tier cite" }] : []);

/* --- Reading ---------------------------------------------------------------- */

await ok("rollModsOf reads each part of each active effect, and skips a disabled or inactive one and an unknown field", () => {
  const live = effectOf([part("attack", 2), part("ac", 1), part("nonsense", 4)]);
  const off = effectOf([part("attack", 5)], { disabled: true });
  const expired = effectOf([part("attack", 6)], { active: false });
  const none = { id: "fxNone", disabled: false, flags: {} };
  const entries = rollModsOf(actorOf("Reader", { effects: [live, off, expired, none] }));
  assert.deepEqual(entries.map((e) => [e.part.on, e.part.value]), [["attack", 2], ["ac", 1]]);
  assert.deepEqual([entries[0].id, entries[0].label, entries[0].cite, entries[0].sourceAlignment, entries[0].effect], ["def.spell.testEdge", "Test Edge", "Test cite", "lawful", live]);
  assert.deepEqual(rollModsOf(null), []);
  assert.deepEqual(ROLL_MODS_ON, ["attack", "damage", "ac", "save", "ward"]);
});

await ok("the weapon gates are item gates: they read the weapon alone and answer null with none", () => {
  assert.equal(isItemGate("weaponMundane"), true);
  assert.equal(isItemGate("weaponMagical"), true);
  const plain = weapon("a");
  const fine = weapon("b", { magic: true });
  const ask = (kind, ctx) => gateVerdict(actorOf("Holder"), { kind }, ctx);
  assert.deepEqual([ask("weaponMundane", { item: plain }), ask("weaponMundane", { item: fine })], [true, false]);
  assert.deepEqual([ask("weaponMagical", { item: plain }), ask("weaponMagical", { item: fine })], [false, true]);
  assert.deepEqual([ask("weaponMundane", {}), ask("weaponMagical", { token: {} })], [null, null], "no weapon, no answer");
});

/* --- The weapon's own bonus -------------------------------------------------- */

await ok("an item bonus source is registered and removed, a zero figure is left out and a throwing source is reported", () => {
  const item = weapon("w1");
  assert.deepEqual(itemBonusParts(item, "attack"), []);
  const off = registerItemBonusSource(tier({ attack: 2, damage: 0 }));
  assert.deepEqual(itemBonusParts(item, "attack").map((p) => [p.label, p.value, p.caps, p.on, p.cite]), [["Fine", 2, [MASTERWORK], "attack", "Tier cite"]]);
  assert.deepEqual(itemBonusParts(item, "damage"), [], "a zero figure is no part");
  assert.deepEqual(itemBonusParts(null, "attack"), []);
  const failing = registerItemBonusSource(() => { throw new Error("source broke"); });
  const wasError = console.error;
  console.error = noop;
  try {
    assert.equal(itemBonusParts(item, "attack").length, 1, "the working source still answers");
  } finally {
    console.error = wasError;
  }
  failing();
  off();
  assert.deepEqual(itemBonusParts(item, "attack"), []);
  assert.equal(typeof registerItemBonusSource("nonsense"), "function", "a non-function registers nothing and still answers an unregister");
});

await ok("spellStackingPart stacks as the record's id, provides what the part provides, and carries its source", () => {
  const entry = rollModsOf(actorOf("Bearer", { effects: [effectOf([part("attack", 3, { vsKinds: ["undead"], notStacksWith: [MASTERWORK] })])] }))[0];
  const built = spellStackingPart(entry);
  assert.deepEqual(built.caps, ["kw:testedge", SHARED]);
  assert.deepEqual([built.ref.id, built.value, built.label, built.cite, built.sourceAlignment, built.on, built.vsKinds], ["def.spell.testEdge", 3, "Test Edge", "Test cite", "lawful", "attack", ["undead"]]);
  assert.deepEqual(built.notStacksWith, [MASTERWORK]);
  assert.equal(spellStackingPart(entry, -1).value, -3, "a reversing scope's sign is the figure's");
});

/* --- Resolution -------------------------------------------------------------- */

const itemPart = (value, over = {}) => stackingPart({ value, label: "Fine", ref: { provides: [MASTERWORK] }, cite: "Tier cite", ...over });
const spellPart = (value, over = {}) => stackingPart({ value, label: "Test Edge", ref: { id: "def.spell.testEdge", provides: [SHARED] }, cite: "Test cite", ...over });

await ok("a spell part that names the weapon's capability and is larger is kept, and the weapon's figure is taken back", () => {
  const r = resolveItemParts([itemPart(2)], [spellPart(3, { notStacksWith: [MASTERWORK] })]);
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite)|3", "Fine, yielding to Test Edge|-2"]);
  assert.equal(r.droppedItems.length, 1);
  assert.deepEqual(r.droppedSpells, []);
  assert.deepEqual(r.kept.map((p) => p.label), ["Test Edge"]);
});

await ok("a tie keeps the weapon's figure and adds no row; a smaller spell part yields too", () => {
  const tie = resolveItemParts([itemPart(2)], [spellPart(2, { notStacksWith: [MASTERWORK] })]);
  assert.deepEqual(tie.rows, []);
  assert.deepEqual(tie.droppedSpells.map((p) => [p.label, p.yieldsTo]), [["Test Edge", "Fine"]]);
  const less = resolveItemParts([itemPart(3)], [spellPart(2, { notStacksWith: [MASTERWORK] })]);
  assert.deepEqual(less.rows, []);
  assert.equal(less.droppedSpells.length, 1);
});

await ok("with nothing in common the weapon's figure and the spell's both stand, and only the spell is a row", () => {
  const r = resolveItemParts([itemPart(2)], [spellPart(3)]);
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite)|3"]);
  assert.equal(r.kept.length, 2);
});

await ok("two spell parts that share a capability give one row, the larger", () => {
  const first = spellPart(2, { key: "one" });
  const second = spellPart(4, { key: "two", label: "Test Ward", ref: { id: "def.spell.testWard", provides: [SHARED] } });
  const r = resolveItemParts([], [first, second]);
  assert.deepEqual(labelsOf(r.rows), ["Test Ward (Test cite)|4"]);
  assert.deepEqual(r.droppedSpells.map((p) => p.label), ["Test Edge"]);
});

await ok("stacksWith wins over a shared capability: the pair adds", () => {
  const r = resolveItemParts([itemPart(2)], [spellPart(3, { ref: { id: "def.spell.testEdge", provides: [SHARED, MASTERWORK] }, stacksWith: [MASTERWORK] })]);
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite)|3"]);
  assert.deepEqual([r.droppedItems.length, r.droppedSpells.length], [0, 0]);
});

await ok("a zero part is left out, and a part not built by stackingPart is never accepted", () => {
  assert.deepEqual(resolveItemParts([itemPart(0)], [spellPart(3, { notStacksWith: [MASTERWORK] })]).rows.map((r) => r.value), [3], "a zero weapon figure is nothing to take back");
  const bare = { value: 5, label: "Bare", ref: {}, stacksWith: [], notStacksWith: [] };
  const r = resolveItemParts([{ value: 9, label: "Bare item" }], [bare, spellPart(3)]);
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite)|3"], "a bare part is no row and stops nothing");
  assert.equal(r.kept.length, 1);
  assert.deepEqual(resolveItemParts(null, null), { rows: [], kept: [], droppedItems: [], droppedSpells: [] });
});

/* --- Scope ------------------------------------------------------------------- */

await ok("scopeCtxFor reads the other party's kinds and alignment, and carries the source's and the enemy answer", () => {
  const foe = actorOf("Foe", { type: "monster", types: ["Undead"], alignment: "Chaotic" });
  const ctx = scopeCtxFor(foe, { sourceAlignment: "lawful", enemy: true });
  assert.deepEqual([...ctx.kinds].sort(), ["enchanted", "undead"]);
  assert.deepEqual([ctx.alignment, ctx.sourceAlignment, ctx.enemy], ["chaotic", "lawful", true]);
  assert.deepEqual(scopeCtxFor(null).enemy, null);
});

/* --- The attacker's side ----------------------------------------------------- */

const hero = (parts, over = {}) => actorOf("Hero", { effects: [effectOf(parts, over.effect)], disposition: 1, ...over.actor });
const FOE = () => actorOf("Foe", { type: "monster", types: ["undead"], alignment: "Chaotic", disposition: -1 });

await ok("a kept part is a row labelled with the spell and its page, on its own field only", () => {
  const attacker = hero([part("attack", 2, { itemId: "w1" }), part("damage", 3, { itemId: "w1" })]);
  const ctx = attackCtx(attacker, FOE());
  assert.deepEqual(labelsOf(rollModRows(ctx, "melee", "attack").rows), ["Test Edge (Test cite)|2"]);
  assert.deepEqual(labelsOf(rollModRows(ctx, "melee", "damage").rows), ["Test Edge (Test cite)|3"]);
});

await ok("a part for one weapon adds nothing on another, and a part naming none reaches any", () => {
  const attacker = actorOf("Hero", {
    effects: [
      effectOf([part("attack", 2, { itemId: "w1" })], { id: "def.spell.testEdge", label: "Test Edge" }),
      effectOf([part("attack", 1, { key: "free", provides: ["kw:other"] })], { id: "def.spell.testWard", label: "Test Ward" }),
    ],
    disposition: 1,
  });
  assert.deepEqual(labelsOf(rollModRows(attackCtx(attacker, FOE(), weapon("w1")), "melee", "attack").rows), ["Test Edge (Test cite)|2", "Test Ward (Test cite)|1"]);
  assert.deepEqual(labelsOf(rollModRows(attackCtx(attacker, FOE(), weapon("w2")), "melee", "attack").rows), ["Test Ward (Test cite)|1"]);
  assert.deepEqual(rollModRows(attackCtx(attacker, FOE(), null), "melee", "attack").rows.length, 1, "no weapon: only the part that names none");
});

await ok("the item gates run against the weapon: a mundane gate skips a magic weapon and the mirror skips a mundane one", () => {
  const attacker = hero([
    part("attack", 2, { key: "m", gate: { kind: "weaponMundane" }, provides: ["kw:a"] }),
    part("attack", 3, { key: "g", gate: { kind: "weaponMagical" }, provides: ["kw:b"] }),
  ]);
  const rows = (item) => labelsOf(rollModRows(attackCtx(attacker, FOE(), item), "melee", "attack").rows);
  assert.deepEqual(rows(weapon("w1")), ["Test Edge (Test cite)|2"]);
  assert.deepEqual(rows(weapon("w2", { magic: true })), ["Test Edge (Test cite)|3"]);
  assert.deepEqual(rows(null), [], "a gate with no weapon to read adds nothing");
});

await ok("a dropped weapon figure is a negative row; a dropped spell part is told once over two questions", () => {
  const off = registerItemBonusSource(tier({ attack: 2 }));
  try {
    const win = hero([part("attack", 3, { notStacksWith: [MASTERWORK] })]);
    assert.deepEqual(labelsOf(rollModRows(attackCtx(win, FOE()), "melee", "attack").rows), ["Test Edge (Test cite)|3", "Fine, yielding to Test Edge|-2"]);
    const lose = hero([part("attack", 2, { notStacksWith: [MASTERWORK] })]);
    const ctx = attackCtx(lose, FOE());
    const first = rollModRows(ctx, "melee", "attack");
    assert.deepEqual(first.rows, []);
    assert.deepEqual(first.told.map((t) => [t.lang, t.level, t.data]), [["notice.yielded", "info", { spell: "Test Edge", item: "Blade w1", to: "Fine" }]]);
    assert.equal(rollModRows(ctx, "melee", "attack"), first, "one answer per question and kind, cached on the attack");
  } finally {
    off();
  }
});

await ok("an attacker's scoped part applies, fails, or is told when the target cannot settle it; a reversing scope reverses the figure", () => {
  const scoped = (over) => hero([part("attack", 2, over)]);
  const rowsFor = (attacker, foe) => rollModRows(attackCtx(attacker, foe), "melee", "attack");
  assert.deepEqual(labelsOf(rowsFor(scoped({ vsKinds: ["undead"] }), FOE()).rows), ["Test Edge (Test cite)|2"]);
  const fails = rowsFor(scoped({ vsKinds: ["undead"] }), actorOf("Plain", { type: "monster", types: ["beast"] }));
  assert.deepEqual([fails.rows, fails.told], [[], []]);
  const unknown = rowsFor(scoped({ vsKinds: ["undead"] }), actorOf("Blank", { type: "monster" }));
  assert.deepEqual(unknown.rows, []);
  assert.deepEqual(unknown.told.map((t) => [t.lang, t.data]), [["notice.undetermined", { spell: "Test Edge", target: "Hero", attacker: "Blank" }]]);
  const reversed = rowsFor(scoped({ vsAlignmentOf: "source", vsAlignmentMode: "sign" }), FOE());
  assert.deepEqual(labelsOf(reversed.rows), ["Test Edge (Test cite)|-2"], "a foe of the other alignment takes the figure with its sign flipped");
});

await ok("vsEnemy reads the attacker's token against the target's", () => {
  const scoped = (attacker, foe) => rollModRows(attackCtx(attacker, foe), "melee", "attack");
  const mine = hero([part("attack", 2, { vsEnemy: true })]);
  assert.equal(scoped(mine, actorOf("Foe", { disposition: -1 })).rows.length, 1);
  assert.equal(scoped(mine, actorOf("Friend", { disposition: 1 })).rows.length, 0);
  const neutral = scoped(mine, actorOf("Bystander", { disposition: 0 }));
  assert.deepEqual([neutral.rows.length, neutral.told.length], [0, 1]);
});

/* --- The target's side ------------------------------------------------------- */

const circled = (parts, effect) => actorOf("Ally", { effects: [effectOf(parts, effect)], disposition: 1 });
const striker = (over = {}) => actorOf("Striker", { type: "monster", types: ["undead"], alignment: "Chaotic", disposition: -1, ...over });

await ok("an AC part that applies is a term of minus its figure, named as the target's", () => {
  const ally = circled([part("ac", 2, { vsKinds: ["undead"] })]);
  const r = rollModRows(attackCtx(striker(), ally), "melee", "attack");
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite) on Ally|-2"]);
  assert.deepEqual(r.told, []);
  assert.deepEqual(rollModRows(attackCtx(striker(), ally), "melee", "damage").rows, [], "damage is read on the attacker's side only");
});

await ok("an AC part whose scope fails adds nothing and says nothing; one that cannot be settled is told", () => {
  const ally = circled([part("ac", 2, { vsKinds: ["undead"] })]);
  const fails = rollModRows(attackCtx(actorOf("Plain", { type: "monster", types: ["beast"], disposition: -1 }), ally), "melee", "attack");
  assert.deepEqual([fails.rows, fails.told], [[], []]);
  const blank = rollModRows(attackCtx(actorOf("Stranger", { type: "monster", disposition: -1 }), ally), "melee", "attack");
  assert.deepEqual(blank.rows, []);
  assert.deepEqual(blank.told.map((t) => [t.lang, t.level, t.data]), [["notice.undetermined", "warn", { spell: "Test Edge", target: "Ally", attacker: "Stranger" }]]);
});

await ok("a ward whose scope applies or is undetermined is told on the attacking seat and never adds a row", () => {
  const ally = circled([part("ward", 0, { vsKinds: ["undead"], value: undefined })]);
  const hit = rollModRows(attackCtx(striker(), ally), "melee", "attack");
  assert.deepEqual([hit.rows, hit.told.map((t) => [t.lang, t.data])], [[], [["notice.ward", { spell: "Test Edge", target: "Ally", attacker: "Striker" }]]]);
  assert.equal(rollModRows(attackCtx(actorOf("Stranger", { type: "monster", disposition: -1 }), ally), "melee", "attack").told[0].lang, "notice.ward");
  const outside = rollModRows(attackCtx(actorOf("Plain", { type: "monster", types: ["beast"], disposition: -1 }), ally), "melee", "attack");
  assert.deepEqual([outside.rows, outside.told], [[], []]);
});

await ok("the enemy test reads the attacker's token against the bearer's", () => {
  const ally = circled([part("ac", 2, { vsEnemy: true })]);
  assert.equal(rollModRows(attackCtx(striker(), ally), "melee", "attack").rows.length, 1);
  assert.equal(rollModRows(attackCtx(striker({ disposition: 1 }), ally), "melee", "attack").rows.length, 0, "the same side is no enemy");
  assert.equal(rollModRows(attackCtx(striker({ disposition: 0 }), ally), "melee", "attack").told.length, 1, "a neutral token is undetermined");
});

await ok("two records' AC parts resolve among themselves: one figure, the larger", () => {
  const ally = actorOf("Ally", {
    effects: [
      effectOf([part("ac", 2)], { id: "def.spell.testWard", label: "Test Ward" }),
      effectOf([part("ac", 3)], { id: "def.spell.testEdge", label: "Test Edge" }),
    ],
    disposition: 1,
  });
  const r = rollModRows(attackCtx(striker(), ally), "melee", "attack");
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite) on Ally|-3"]);
  assert.equal(r.told.length, 1);
  assert.equal(r.told[0].lang, "notice.yielded");
});

/* --- The seam ---------------------------------------------------------------- */

const ask = async (actor, foe, item, run) => {
  globalThis.game.user.targets = foe ? [{ document: tokenOf(foe) }] : [];
  let out;
  await makeAttackThrow.call(actor, async () => { out = await run(); return null; }, { item });
  return out;
};

await ok("the contributor answers a carrier's attack question but not its damage question", async () => {
  const attacker = hero([part("attack", 2, { key: "a" }), part("damage", 3, { key: "d", provides: ["kw:other"] })]);
  const carrier = spellCarrier(attacker, { key: "bolt", type: "damage", roll: "1d4", delivery: "missile" }, { castId: "c1" });
  const out = await ask(attacker, FOE(), carrier, () => ({
    attack: actorAttack.call(attacker.system, () => [{ label: "core", value: 1 }], MAGIC_ATTACK_TYPE),
    damage: actorDamage.call(attacker.system, () => [{ label: "core", value: 1 }], MAGIC_ATTACK_TYPE),
  }));
  assert.deepEqual(labelsOf(out.attack), ["core|1", "Test Edge (Test cite)|2"]);
  assert.deepEqual(out.damage, [], "a spell's damage is its own: nothing of the attacker's reaches it");
});

await ok("on a weapon both questions are answered; a notice is told once per attack however often it is asked", async () => {
  const off = registerItemBonusSource(tier({ attack: 5 }));
  try {
    const attacker = hero([part("attack", 2, { notStacksWith: [MASTERWORK] }), part("damage", 3, { key: "d", provides: ["kw:other"] })]);
    said.length = 0;
    const out = await ask(attacker, FOE(), weapon("w1"), () => ({
      melee: actorAttack.call(attacker.system, () => [{ label: "core", value: 5 }], "melee"),
      again: actorAttack.call(attacker.system, () => [{ label: "core", value: 5 }], "melee"),
      missile: actorAttack.call(attacker.system, () => [{ label: "core", value: 5 }], "missile"),
      damage: actorDamage.call(attacker.system, () => [], "melee"),
    }));
    assert.deepEqual(labelsOf(out.melee), ["core|5"], "the weapon's own figure stands, the spell yielded");
    assert.deepEqual(out.again, out.melee);
    assert.deepEqual(labelsOf(out.damage), ["Test Edge (Test cite)|3"]);
    assert.equal(said.filter(([, m]) => m.startsWith("ACKS-LIB.rollMods.notice.yielded")).length, 1, "one notice for the attack");
    said.length = 0;
    await ask(attacker, FOE(), weapon("w1"), () => actorAttack.call(attacker.system, () => [], "melee"));
    assert.equal(said.length, 1, "the next attack tells it again");
  } finally {
    off();
  }
});

await ok("outside an attack the system's own answer stands: a sheet drawing its boxes reads no record", async () => {
  const attacker = hero([part("attack", 2)]);
  const ctxless = actorAttack.call(attacker.system, () => [{ label: "core", value: 1 }], "melee");
  assert.deepEqual(ctxless, [{ label: "core", value: 1 }], "outside an attack the system's answer stands");
});

/* --- A saving throw from the sheet ------------------------------------------- */

await ok("the sheet's save reads unscoped, ungated save parts as one figure and tells each scoped one", () => {
  const saver = actorOf("Saver", {
    effects: [
      effectOf([part("save", 2, { key: "free" }), part("save", 1, { key: "scoped", vsKinds: ["undead"], provides: ["kw:o1"] })]),
      effectOf([part("save", 1, { key: "gated", gate: { kind: "weaponMundane" } })]),
    ],
  });
  const shift = sheetSaveShift(saver);
  assert.equal(shift.total, 2);
  assert.deepEqual(shift.parts.map((p) => [p.label, p.value]), [["Test Edge", 2]]);
  assert.deepEqual(shift.told.map((t) => t.lang), ["notice.saveScoped", "notice.saveApplied"]);
  assert.deepEqual(sheetSaveShift(actorOf("Plain")), { total: 0, parts: [], told: [] });
  const two = sheetSaveShift(actorOf("Twice", { effects: [effectOf([part("save", 1)]), effectOf([part("save", 4)])] }));
  assert.equal(two.total, 4, "two records of one kind give the larger figure");
});

await ok("saveModParts settles a scoped save part against what is resisted", () => {
  const saver = actorOf("Saver", { effects: [effectOf([part("save", 2, { vsKinds: ["undead"] })])] });
  assert.deepEqual(saveModParts(saver, { against: { actor: FOE() } }).parts.map((p) => [p.key, p.label, p.value, p.side]), [["save2", "Test Edge", 2, "target"]]);
  assert.equal(saveModParts(saver, { against: { actor: actorOf("Plain", { type: "monster", types: ["beast"] }) } }).parts.length, 0);
});

console.log(`\n${passed} roll-mods checks passed.`);
