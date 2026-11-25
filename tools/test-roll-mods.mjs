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
  "ACKS-LIB.rollMods.onTargetKind": "{name} on {target}, {kind} attack",
  "ACKS-LIB.rollMods.kind.melee": "melee",
  "ACKS-LIB.rollMods.kind.missile": "missile",
  "ACKS-LIB.rollMods.kind.thrown": "thrown",
  "ACKS-LIB.rollMods.ownAc": "{target}'s own armour class",
  "ACKS-LIB.conditionRoll.targetAc.kinded": "{label}, {kind}",
};
// Invented words for Foundry's change types, so a label proves it was read, not hard-coded.
const KIND_WORDS = { "EFFECT.CHANGES.TYPES.override": "Replacer", "EFFECT.CHANGES.TYPES.multiply": "Scaler" };
const format = (key, data = {}) => (TEXT[key] ?? `${key} ${JSON.stringify(data)}`).replace(/\{(\w+)\}/g, (_, n) => data[n] ?? "");
globalThis.game = {
  system: { id: "acks" },
  user: { targets: [] },
  i18n: { format, localize: (k) => KIND_WORDS[k] ?? k, has: () => false, translations: {} },
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
const {
  CONDITION_ORDER, CONDITION_KEYS, actorOf: conditionActor, conditionValue, coreConditions, effectOf: conditionEffect,
  implyingEffect,
} = await import("./core-conditions-fixture.mjs");
globalThis.CONFIG = {
  ACKS: { conditions: coreConditions() },
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
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");
const mods = await import("../scripts/lib/roll-mods.mjs");
const { stackingPart, isItemGate, gateVerdict } = await import("../scripts/lib/typed-modifiers.mjs");
const { MAGIC_ATTACK_TYPE, installAttackThrowPatch, spellCarrier } = seam;
const {
  rollModsOf, registerItemBonusSource, itemBonusParts, spellStackingPart, resolveItemParts, scopeCtxFor, rollModRows, saveModParts,
  sheetSaveShift, installRollMods, ROLL_MODS_ON, partHolds, recordParts, throwResolution, recordImmunity, ownSaveParts,
  conditionSteps, countsOnce, CONDITION_STEP_KEYS,
} = mods;
const { acWaivedSet, subjectOf } =await import("../scripts/lib/conditions.mjs");
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
  assert.deepEqual(ROLL_MODS_ON, ["attack", "damage", "ac", "save", "ward", "throw", "reaction", "grant", "immune"]);
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

await ok("a ward that names a save carries the attacker's save target, still told and never refused", () => {
  const ally = circled([part("ward", 0, { vsKinds: ["undead"], value: undefined, save: "spell" })]);
  const foe = striker();
  foe.system.saves = { spell: { value: 14 } };
  const hit = rollModRows(attackCtx(foe, ally), "melee", "attack");
  assert.deepEqual(hit.rows, [], "a ward adds no row");
  assert.deepEqual(hit.told.map((t) => [t.lang, t.level, t.data]), [["notice.wardSave", "warn", { spell: "Test Edge", target: "Ally", attacker: "Striker", save: "Spells", number: 14 }]]);
  // The target is the attacker's after its own conditions: a stored figure it has none for tells the plain notice.
  const unstored = striker();
  assert.equal(rollModRows(attackCtx(unstored, ally), "melee", "attack").told[0].lang, "notice.ward", "no stored target, no figure");
  const unnamed = circled([part("ward", 0, { vsKinds: ["undead"], value: undefined })]);
  assert.equal(rollModRows(attackCtx(foe, unnamed), "melee", "attack").told[0].lang, "notice.ward", "a ward naming no save tells the plain notice");
  const outside = actorOf("Plain", { type: "monster", types: ["beast"], disposition: -1 });
  outside.system.saves = { spell: { value: 14 } };
  assert.deepEqual(rollModRows(attackCtx(outside, ally), "melee", "attack").told, [], "an attacker outside the scope is told nothing");
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

await ok("the sheet's save reads unscoped save parts as one figure, tells each scoped one, and tells a gate it cannot decide", () => {
  const saver = actorOf("Saver", {
    effects: [
      effectOf([part("save", 2, { key: "free" }), part("save", 1, { key: "scoped", vsKinds: ["undead"], provides: ["kw:o1"] })]),
      effectOf([part("save", 1, { key: "gated", gate: { kind: "weaponMundane" } })]),
    ],
  });
  const shift = sheetSaveShift(saver);
  assert.equal(shift.total, 2);
  assert.deepEqual(shift.parts.map((p) => [p.label, p.value]), [["Test Edge", 2]]);
  assert.deepEqual(shift.told.map((t) => t.lang), ["notice.saveScoped", "notice.savePending", "notice.saveApplied"]);
  assert.deepEqual(shift.pending.map((p) => [p.label, p.value, p.when]), [["Test Edge", 1, "gate"]], "an item gate with no weapon cannot be told: pending, not applied");
  assert.deepEqual(sheetSaveShift(actorOf("Plain")), { total: 0, parts: [], pending: [], told: [] });
  const two = sheetSaveShift(actorOf("Twice", { effects: [effectOf([part("save", 1)]), effectOf([part("save", 4)])] }));
  assert.equal(two.total, 4, "two records of one kind give the larger figure");
});

await ok("saveModParts settles a scoped save part against what is resisted", () => {
  const saver = actorOf("Saver", { effects: [effectOf([part("save", 2, { vsKinds: ["undead"] })])] });
  assert.deepEqual(saveModParts(saver, { against: { actor: FOE() } }).parts.map((p) => [p.key, p.label, p.value, p.side]), [["save2", "Test Edge", 2, "target"]]);
  assert.equal(saveModParts(saver, { against: { actor: actorOf("Plain", { type: "monster", types: ["beast"] }) } }).parts.length, 0);
});
/* --- A record's parts read at a roll: recordParts and its siblings ------------- */

/** An ability item that provides capabilities and is stamped with a definition id. */
const ability = (id, provides = []) => ({
  type: "ability",
  name: id,
  flags: { "acks-extras": { cookbook: { id } } },
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { provides } : undefined),
});
/** A bearer of the records `effects`, holding `items` and carrying `statuses`. */
const bearer = (effects, { items = [], statuses = [], type = "character" } = {}) => {
  const actor = actorOf("Bearer", { effects, type });
  actor.items = items;
  actor.statuses = new Set(statuses);
  return actor;
};
/** A record by short id: the spell is "def.spell.<id>", labelled with the capitalised id. */
const rec = (id, parts) => effectOf(parts, { id: `def.spell.${id}`, label: id[0].toUpperCase() + id.slice(1) });
const spokenFor = (list) => list.map((p) => [p.spell, p.value]);
const SUBJECT = { id: "def.prof.tumbling", provides: [] };

await ok("partHolds answers true, false or null for a gate, an ifHas and an occasion gate, and a false beats a null", () => {
  const holder = bearer([], { items: [ability("def.prof.tumbling")], statuses: ["wasted"] });
  assert.equal(partHolds(holder, {}), true, "no gate and no ifHas holds");
  assert.equal(partHolds(holder, { gate: { kind: "status", status: "wasted" } }), true);
  assert.equal(partHolds(holder, { gate: { kind: "status", status: "other" } }), false);
  assert.equal(partHolds(holder, { gate: { kind: "nothingRegistered" } }), null, "a gate kind nothing evaluates cannot be told");
  assert.equal(partHolds(holder, { gate: { kind: "weaponMundane" } }, {}), null, "an item gate with no weapon cannot be told");
  assert.equal(partHolds(holder, { ifHas: ["kw:tumbling"] }), true);
  assert.equal(partHolds(holder, { ifHas: ["kw:tumbling", "kw:absent"] }), false);
  const occasion = { kind: "status", status: "wasted", occasion: true };
  assert.equal(partHolds(holder, { gate: occasion }), null, "an occasion gate that holds waits for the roll to name its occasion");
  assert.equal(partHolds(holder, { gate: occasion }, { occasion: "wasted" }), true);
  assert.equal(partHolds(holder, { gate: occasion }, { occasion: "other" }), null);
  assert.equal(partHolds(bearer([]), { gate: occasion }, { occasion: "wasted" }), false, "a gate that is off adds nothing, whatever the occasion");
  assert.equal(partHolds(holder, { gate: { kind: "nothingRegistered" }, ifHas: ["kw:absent"] }), false, "false wins over null");
});

await ok("ruling 130: ref, rollKey, saves and attackKinds narrow BEFORE stacking, so a larger part that misses this roll never displaces a smaller one that reaches it", () => {
  const cases = [
    ["ref", "throw", { ref: "kw:other" }, { ref: "kw:tumbling" }, { subject: SUBJECT }],
    ["refs", "throw", { refs: ["kw:other"] }, { refs: ["kw:other", "kw:tumbling"] }, { subject: SUBJECT }],
    ["rollKey", "throw", { rollKey: "first" }, { rollKey: "second" }, { rollKey: "second" }],
    ["saves", "save", { saves: ["death"] }, { saves: ["blast"] }, { save: "blast" }],
    ["attackKinds", "ac", { attackKinds: ["melee"] }, { attackKinds: ["missile"] }, { kind: "missile" }],
  ];
  for (const [what, on, bigger, smaller, ask] of cases) {
    const holder = bearer([rec("alpha", [part(on, 5, bigger)]), rec("beta", [part(on, 2, smaller)])]);
    const { kept, dropped } = recordParts(holder, on, ask);
    assert.deepEqual([spokenFor(kept), dropped], [[["Beta", 2]], []], what);
  }
});

await ok("a part that declares a narrowing the caller named nothing to test goes to pending, never to the roll", () => {
  const holder = bearer([rec("alpha", [part("throw", 5, { rollKey: "first" })]), rec("beta", [part("throw", 2)]), rec("gamma", [part("throw", 4, { ref: "kw:tumbling" })])]);
  const r = recordParts(holder, "throw", {});
  assert.deepEqual(spokenFor(r.kept), [["Beta", 2]]);
  assert.deepEqual(r.pending.map((p) => [p.label, p.why]), [["Alpha (Test cite)", "narrow"], ["Gamma (Test cite)", "narrow"]]);
});

await ok("owner ruling 2: a second record of one kind leaves one figure, the larger, which stays until the last record ends", () => {
  const big = rec("alpha", [part("throw", 4)]);
  const small = rec("beta", [part("throw", 2)]);
  const holder = bearer([big, small]);
  const read = () => recordParts(holder, "throw", {});
  assert.deepEqual(spokenFor(read().kept), [["Alpha", 4]]);
  assert.equal(read().kept[0].label, "Alpha (Test cite)", "labelled with the spell and its page reference");
  assert.deepEqual(read().dropped.map((p) => [p.spell, p.yieldsTo]), [["Beta", "Alpha (Test cite)"]]);
  holder.appliedEffects = [small];
  assert.deepEqual(spokenFor(read().kept), [["Beta", 2]], "the larger's record ends and the smaller stands");
  holder.appliedEffects = [];
  assert.deepEqual(read().kept, [], "the last record ends and nothing applies");
});

await ok("a gate that is off drops a part, one that cannot be told is pending, and ifHas is tested through hasCapability", () => {
  const holder = bearer(
    [
      rec("alpha", [part("throw", 5, { gate: { kind: "status", status: "other" } })]),
      rec("beta", [part("throw", 4, { gate: { kind: "nothingRegistered" } })]),
      rec("gamma", [part("throw", 3, { ifHas: ["kw:absent"] })]),
      rec("delta", [part("throw", 2, { ifHas: ["kw:tumbling"] })]),
    ],
    { items: [ability("def.prof.tumbling")] },
  );
  const r = recordParts(holder, "throw", {});
  assert.deepEqual(spokenFor(r.kept), [["Delta", 2]]);
  assert.deepEqual(r.pending.map((p) => [p.label, p.why]), [["Beta (Test cite)", "gate"]]);
});

await ok("a part with no figure never reaches stacking, even where it is the only one of its group", () => {
  const holder = bearer([rec("alpha", [part("throw", 0), part("throw", null, { key: "blank" })]), rec("beta", [part("reaction", null, { key: "blank" })])]);
  assert.deepEqual([recordParts(holder, "throw", {}).kept, recordParts(holder, "reaction", {}).kept], [[], []]);
});

await ok("a part with no figure never reaches stacking; a grant and an auto throw carry none by nature", () => {
  const holder = bearer([
    rec("alpha", [part("throw", 0), part("throw", null, { key: "blank" }), part("throw", 3, { key: "real" })]),
    rec("beta", [part("throw", null, { key: "auto", mode: "auto", ref: "kw:tumbling" })]),
  ]);
  const r = recordParts(holder, "throw", { subject: SUBJECT });
  assert.deepEqual(r.kept.map((p) => [p.spell, p.value, p.mode ?? "add"]), [["Alpha", 3, "add"], ["Beta", null, "auto"]]);
});

const grant = (ref, value, over = {}) => ({ key: `g-${ref}-${value}`, on: "grant", ref, value, ...(value == null ? {} : { mode: "set" }), provides: [SHARED], ...over });

await ok("a grant applies only while no ability of the bearer provides its ref's capability, and two grants of one ref leave the better target", () => {
  const holder = bearer([rec("alpha", [grant("def.prof.tumbling", 14)]), rec("beta", [grant("def.prof.tumbling", 11)]), rec("gamma", [grant("def.prof.hiding", 16)])]);
  const lowest = recordParts(holder, "grant", {});
  assert.deepEqual(lowest.kept.map((p) => [p.spell, p.value, p.refTo]), [["Beta", 11, "def.prof.tumbling"], ["Gamma", 16, "def.prof.hiding"]], "a target to roll over: the lower; two refs do not compete");
  assert.deepEqual(lowest.dropped.map((p) => [p.spell, p.yieldsTo]), [["Alpha", "Beta (Test cite)"]]);
  assert.deepEqual(spokenFor(recordParts(holder, "grant", { rollType: "below" }).kept.filter((p) => p.refTo === "def.prof.tumbling")), [["Alpha", 14]], "a roll-under throw: the higher");
  holder.items = [ability("def.prof.tumbling")];
  assert.deepEqual(recordParts(holder, "grant", {}).kept.map((p) => p.refTo), ["def.prof.hiding"], "a bearer who holds it needs no grant");
});

await ok("a grant with a blank figure is still a grant with value null; a figured grant of its ref takes its place", () => {
  const blank = bearer([rec("alpha", [grant("def.prof.tumbling", null)])]);
  assert.deepEqual(recordParts(blank, "grant", {}).kept.map((p) => [p.spell, p.value, p.refTo]), [["Alpha", null, "def.prof.tumbling"]]);
  const both = bearer([rec("alpha", [grant("def.prof.tumbling", null)]), rec("beta", [grant("def.prof.tumbling", 12)])]);
  const r = recordParts(both, "grant", {});
  assert.deepEqual([spokenFor(r.kept), r.dropped.map((p) => p.spell)], [[["Beta", 12]], ["Alpha"]]);
});

await ok("throwResolution gives the added bonuses (resolved among themselves), a set target and an automatic throw, per ref", () => {
  const holder = bearer([
    rec("alpha", [part("throw", 2, { ref: "kw:tumbling" })]),
    rec("beta", [part("throw", 3, { ref: "kw:tumbling" }), part("throw", 12, { ref: "kw:tumbling", mode: "set", key: "set12" })]),
    rec("gamma", [part("throw", 10, { ref: "kw:tumbling", mode: "set", key: "set10" })]),
    rec("delta", [part("throw", 9, { ref: "kw:hiding" })]),
  ]);
  const r = throwResolution(holder, { subject: SUBJECT });
  assert.deepEqual([r.outcome, r.total, spokenFor(r.add), r.set?.spell, r.set?.value, r.auto], ["throw", 3, [["Beta", 3]], "Gamma", 10, null]);
  const auto = bearer([rec("alpha", [part("throw", null, { ref: "kw:tumbling", mode: "auto", key: "auto" }), part("throw", 1, { ref: "kw:tumbling" })])]);
  const a = throwResolution(auto, { subject: SUBJECT });
  assert.deepEqual([a.outcome, a.auto?.spell, a.total], ["auto", "Alpha", 1]);
  assert.deepEqual(throwResolution(auto, { subject: { id: "def.prof.hiding" } }).outcome, "throw", "another ref's throw is not automatic");
});

await ok("recordImmunity reads the spells and conditions a record's immune parts name, through partHolds", () => {
  const parts = (over) => ({ key: "i", on: "immune", provides: [SHARED], ...over });
  const holder = bearer([
    rec("alpha", [parts({ spells: ["kw:dread"], conditions: ["frozen"] })]),
    rec("beta", [parts({ conditions: ["frozen", "dazed"], gate: { kind: "status", status: "wasted" } })]),
    rec("gamma", [parts({ conditions: ["blinded"], gate: { kind: "nothingRegistered" } })]),
  ]);
  const ask = { spell: { id: "def.spell.dread" }, conditions: ["frozen", "dazed", "blinded", "other"] };
  const r = recordImmunity(holder, ask);
  assert.deepEqual([r.spell?.label, Object.keys(r.conditions), r.conditions.frozen.label, r.pending.map((p) => p.label)], ["Alpha (Test cite)", ["frozen"], "Alpha (Test cite)", ["Gamma (Test cite)"]]);
  holder.statuses = new Set(["wasted"]);
  assert.deepEqual(Object.keys(recordImmunity(holder, ask).conditions).sort(), ["dazed", "frozen"]);
  assert.equal(recordImmunity(holder, { spell: { id: "def.spell.other" } }).spell, null);
  assert.deepEqual(recordImmunity(bearer([]), ask), { spell: null, conditions: {}, pending: [] });
});

/* --- An armour class set by the kind of attack --------------------------------- */

const armoured = (parts, { ac = 12, dex = 2, type = "character", effects } = {}) => {
  const actor = actorOf("Ally", { type, effects: effects ?? [effectOf(parts)], disposition: 1 });
  actor.system.ac = { value: ac };
  actor.system.scores = { dex: { mod: dex } };
  return actor;
};
const setAc = (value, over = {}) => part("ac", value, { mode: "set", attackKinds: ["missile", "thrown"], ...over });
const against = (ally, kind = "missile") => rollModRows(attackCtx(striker(), ally), kind, "attack");

await ok("a set armour class is a term of its lift over the target's own, named with the spell and the kind", () => {
  const r = against(armoured([setAc(14)]));
  assert.deepEqual(labelsOf(r.rows), ["Test Edge (Test cite) on Ally, missile attack|-4"], "14 - (12 - 2 dex)");
  assert.deepEqual(labelsOf(against(armoured([setAc(14)]), "thrown").rows), ["Test Edge (Test cite) on Ally, thrown attack|-4"]);
  assert.deepEqual(against(armoured([setAc(14)]), "melee").rows, [], "narrowed by the attack's kind");
});

await ok("a set whose lift is 0 is told as yielding to the target's own armour class and adds no row", () => {
  const r = against(armoured([setAc(10)], { ac: 12, dex: 2 }));
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.told.map((t) => [t.lang, t.data]), [["notice.yielded", { spell: "Test Edge", item: "Ally", to: "Ally's own armour class" }]]);
  assert.deepEqual(against(armoured([setAc(14)], { ac: 16, dex: 2 })).rows, [], "armour, shield and powers (all in ac.value) compete with the set and never add to it");
});

await ok("a character's lift reads its Dexterity modifier out of the comparison; a monster has none", () => {
  assert.deepEqual(labelsOf(against(armoured([setAc(14)], { ac: 12, dex: 0 })).rows), ["Test Edge (Test cite) on Ally, missile attack|-2"]);
  assert.deepEqual(labelsOf(against(armoured([setAc(13)], { ac: 10, dex: 3, type: "monster" })).rows), ["Test Edge (Test cite) on Ally, missile attack|-3"], "a monster's figure is its stat line's: no Dexterity is read out");
});

/** `ally` holding the system's effect for condition `id`, as its own statuses and effects say. */
const holding = (ally, id) => {
  ally.effects.push(conditionEffect(id));
  ally.statuses = new Set([...(ally.statuses ?? []), id]);
  return ally;
};
const SET_FIGURE = 400;

await ok("the target's conditions compete with the set: a monster's step on its armour class raises the lift", () => {
  const step = conditionValue("disordered", "system.ac.mod");
  const monster = holding(armoured([setAc(SET_FIGURE)], { ac: 12, type: "monster" }), "disordered");
  assert.deepEqual(labelsOf(against(monster).rows), [`Test Edge (Test cite) on Ally, missile attack|${-(SET_FIGURE - (12 + step))}`], "the step is read once from the effect, the monster's field holding none");
  // A waiver the creature carries takes the step out of the comparison, as it takes it out of the throw.
  const waived = holding(armoured([setAc(SET_FIGURE)], { ac: 12, type: "monster" }), "disordered");
  waived.items = [{ type: "ability", flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "acWaiver", conditions: ["disordered"] }] } } } }];
  assert.deepEqual(labelsOf(against(waived).rows), [`Test Edge (Test cite) on Ally, missile attack|${-(SET_FIGURE - 12)}`]);
});

await ok("a character's Armor Class already holds the system's step, so the lift counts it once", () => {
  const step = conditionValue("disordered", "system.ac.mod");
  // A prepared character: core folded the step into ac.value.
  const character = holding(armoured([setAc(SET_FIGURE)], { ac: 12 + step, dex: 2 }), "disordered");
  assert.deepEqual(labelsOf(against(character).rows), [`Test Edge (Test cite) on Ally, missile attack|${-(SET_FIGURE - (12 + step - 2))}`]);
});

await ok("the module's own Armor Class rows still compete with the set: Defend's", () => {
  registerTable({ id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: { defendingShield: { thrown: 3, missile: 8 } } } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const small = armoured([setAc(14)], { ac: 12, dex: 2 });
    small.statuses = new Set(["defendingShield"]);
    assert.deepEqual(against(small).rows, [], "14 against 12 - 2 + 8 leaves nothing to lift");
    const bigger = armoured([setAc(30)], { ac: 12, dex: 2 });
    bigger.statuses = new Set(["defendingShield"]);
    assert.deepEqual(labelsOf(against(bigger).rows), [`Test Edge (Test cite) on Ally, missile attack|${-(30 - (12 - 2 + 8))}`]);
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
});

await ok("two sets give the larger lift, and a set and an add resolve together so the larger stands", () => {
  const two = armoured(null, { effects: [rec("alpha", [setAc(14)]), rec("beta", [setAc(16)])] });
  const r = against(two);
  assert.deepEqual(labelsOf(r.rows), ["Beta (Test cite) on Ally, missile attack|-6"]);
  assert.deepEqual(r.told.map((t) => [t.lang, t.data.spell, t.data.to]), [["notice.yielded", "Alpha", "Beta"]]);
  const setWins = armoured(null, { effects: [rec("alpha", [setAc(14)]), rec("beta", [part("ac", 3)])] });
  assert.deepEqual(labelsOf(against(setWins).rows), ["Alpha (Test cite) on Ally, missile attack|-4"]);
  const addWins = armoured(null, { effects: [rec("alpha", [setAc(14)]), rec("beta", [part("ac", 5)])] });
  assert.deepEqual(labelsOf(against(addWins).rows), ["Beta (Test cite) on Ally|-5"]);
});

await ok("ruling 130 on the target's side: a larger set that misses the attack's kind never displaces a smaller part that reaches it", () => {
  const ally = armoured(null, { effects: [rec("alpha", [setAc(30, { attackKinds: ["melee"] })]), rec("beta", [part("ac", 2)])] });
  assert.deepEqual(labelsOf(against(ally).rows), ["Beta (Test cite) on Ally|-2"]);
  assert.deepEqual(labelsOf(against(ally, "melee").rows), ["Alpha (Test cite) on Ally, melee attack|-20"], "asked as melee, the larger set is the one that reaches it: 30 - 10");
});

await ok("a set with no figure never reaches stacking, and a gated AC part is tested through partHolds", () => {
  assert.deepEqual(against(armoured([part("ac", null, { mode: "set", attackKinds: ["missile"] })])).rows, []);
  const gated = (gate) => against(armoured([part("ac", 2, { gate })]));
  assert.deepEqual(gated({ kind: "status", status: "other" }).rows, [], "a gate that is off adds nothing");
  const unknown = gated({ kind: "nothingRegistered" });
  assert.deepEqual([unknown.rows, unknown.told.map((t) => t.lang)], [[], ["notice.undetermined"]]);
  const heldAlly = armoured([part("ac", 2, { gate: { kind: "status", status: "wasted" } })]);
  heldAlly.statuses = new Set(["wasted"]);
  assert.equal(against(heldAlly).rows.length, 1);
});

/* --- What a condition's effect does to a field ----------------------------------- */

const AC = CONDITION_STEP_KEYS.ac;
const SAVE = CONDITION_STEP_KEYS.save;
const waiverRow = (...conditions) => ({ type: "ability", flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "acWaiver", conditions }] } } } });
const monsterOf = (effects, waives = []) => conditionActor("monster", effects, { extra: { items: waives.length ? [waiverRow(...waives)] : [] } });

await ok("the step reader takes the steps of the effects whose statuses core's list gives changes, and no other effect's", () => {
  const plain = conditionEffect("restrained", { changes: [{ key: AC, type: "add", value: 5 }] });
  const statusless = { id: "fxGear", disabled: false, statuses: new Set(), changes: [{ key: AC, type: "add", value: 7 }] };
  const real = conditionEffect("disordered");
  const read = conditionSteps(monsterOf([plain, statusless, real]), AC);
  assert.deepEqual(read.steps.map((s) => [s.condition, s.value, s.effect]), [["disordered", conditionValue("disordered", AC), real]]);
  assert.deepEqual(read.waived, []);
  // Another field: only the effects with a change on it.
  assert.deepEqual(conditionSteps(monsterOf([real]), SAVE).steps, []);
  assert.deepEqual(conditionSteps(monsterOf([conditionEffect("hungry")]), SAVE).steps.map((s) => [s.condition, s.value]), [["hungry", conditionValue("hungry", SAVE)]]);
});

await ok("the reader reads each of the eleven's step on its fields from the effect, and a disabled effect makes none", () => {
  for (const id of CONDITION_ORDER) {
    for (const key of [AC, SAVE]) {
      const wanted = CONDITION_KEYS[id].includes(key) ? [conditionValue(id, key)] : [];
      assert.deepEqual(conditionSteps(monsterOf([conditionEffect(id)]), key).steps.map((s) => s.value), wanted, `${id} ${key}`);
      assert.deepEqual(conditionSteps(monsterOf([conditionEffect(id, { disabled: true })]), key).steps, [], `${id} disabled`);
    }
  }
});

await ok("the reader knows no ids of its own: with none in core's list it reads nothing", () => {
  const was = CONFIG.ACKS.conditions;
  CONFIG.ACKS.conditions = was.filter((entry) => entry.id !== "disordered");
  try {
    assert.deepEqual(conditionSteps(monsterOf([conditionEffect("disordered")]), AC), { steps: [], waived: [] });
    CONFIG.ACKS = undefined;
    assert.deepEqual(conditionSteps(monsterOf([conditionEffect("disordered")]), AC), { steps: [], waived: [] });
  } finally {
    CONFIG.ACKS = { conditions: was };
  }
  assert.deepEqual(conditionSteps(null, AC), { steps: [], waived: [] });
});

/* --- One line per effect that moves a field ------------------------------------- */

const { effectLines, stepLabel, lineLabel, kindWords, kindedLabel } = mods;
const condName = (id) => `ACKS-LIB.condition.${id}`;
const namedBy = (effect, id) => format("ACKS-LIB.conditionRoll.targetAc.named", { effect, condition: condName(id) });
const plainOf = (line) => ({ name: line.name, condition: line.condition, value: line.value });

await ok("an effect's line carries its own name and the signed step read from the effect, with no condition where it is its own", () => {
  const rage = conditionEffect("berserk", { name: condName("berserk") });
  const lines = effectLines(monsterOf([rage]), AC);
  assert.deepEqual(lines.map(plainOf), [{ name: condName("berserk"), condition: undefined, value: conditionValue("berserk", AC) }]);
  assert.ok(!("condition" in lines[0]), "no condition key where the effect is its condition's own");
  assert.equal(lines[0].effect, rage, "the document rides along for a caller that lists its changes itself");
  assert.deepEqual(effectLines(monsterOf([]), AC), []);
  assert.deepEqual(effectLines(null, AC), []);
});

await ok("two effects are listed in the order Foundry applied them, and a disabled one not at all", () => {
  const first = conditionEffect("shaken", { name: condName("shaken") });
  const second = conditionEffect("berserk", { name: condName("berserk") });
  const off = conditionEffect("blessed", { name: condName("blessed"), disabled: true });
  const lines = effectLines(monsterOf([first, off, second]), AC);
  assert.deepEqual(lines.map((l) => [l.name, l.value]), [[condName("shaken"), conditionValue("shaken", AC)], [condName("berserk"), conditionValue("berserk", AC)]]);
  const late = { ...conditionEffect("berserk", { name: "Test Late" }), changes: [{ key: AC, type: "add", value: 3, priority: 1 }] };
  const early = { ...conditionEffect("shaken", { name: "Test Early" }), changes: [{ key: AC, type: "add", value: 4, priority: -1 }], statuses: new Set() };
  assert.deepEqual(effectLines(monsterOf([late, early]), AC).map((l) => l.name), ["Test Early", "Test Late"], "priority orders the lines, document order breaks a tie");
});

await ok("a charge's Armor Class step is named with the condition it belongs to, and an effect with no name by its condition", () => {
  const charge = implyingEffect("charging", { name: "Test Charge" });
  const [line] = effectLines(monsterOf([charge]), AC);
  assert.deepEqual(plainOf(line), { name: "Test Charge", condition: "disordered", value: conditionValue("disordered", AC) });
  assert.equal(lineLabel(line), namedBy("Test Charge", "disordered"));
  assert.equal(stepLabel(charge, "disordered"), namedBy("Test Charge", "disordered"), "the label a saving throw's part takes is the same");
  assert.equal(stepLabel(conditionEffect("disordered", { name: condName("disordered") }), "disordered"), condName("disordered"), "named as its condition once");
  assert.equal(effectLines(monsterOf([conditionEffect("disordered", { name: "" })]), AC)[0].name, condName("disordered"));
  assert.equal(stepLabel({ name: "Test Hand" }, null), "Test Hand", "a step that belongs to no condition has only the effect");
  assert.equal(stepLabel(null, "disordered"), condName("disordered"));
});

await ok("a condition two effects carry is one line, under the first carrier", () => {
  const state = implyingEffect("starving", { name: "Test State" });
  const hand = conditionEffect("hungry", { name: condName("hungry") });
  for (const order of [[state, hand], [hand, state]]) {
    const lines = effectLines(monsterOf(order), SAVE);
    assert.deepEqual(lines.map((l) => l.effect), [order[0]], "the later carrier makes no line");
    assert.equal(lines[0].value, conditionValue("hungry", SAVE));
  }
});

await ok("an effect's changes on the field are one line, a net of nothing is none, and an override replays from the stored value", () => {
  const two = { id: "fxTwo", name: "Test Two", disabled: false, statuses: new Set(), changes: [{ key: AC, type: "add", value: 5 }, { key: AC, type: "subtract", value: 2 }] };
  assert.deepEqual(effectLines(monsterOf([two]), AC).map((l) => [l.name, l.value]), [["Test Two", 3]]);
  const cancels = { id: "fxNone", name: "Test None", disabled: false, statuses: new Set(), changes: [{ key: AC, type: "add", value: 5 }, { key: AC, type: "subtract", value: 5 }] };
  assert.deepEqual(effectLines(monsterOf([cancels]), AC), []);
  const set = { id: "fxSet", name: "Test Set", disabled: false, statuses: new Set(), changes: [{ key: AC, type: "override", value: 9 }] };
  assert.deepEqual(effectLines(monsterOf([set]), AC, { base: 4 }).map((l) => l.value), [5], "the step is the shift the override made from the stored value");
  assert.deepEqual(effectLines(monsterOf([set]), AC, { base: 9 }), [], "an override that moves nothing is no line");
});

await ok("a line lists the change types of its effect other than add and subtract, each once, in the order met", () => {
  const fx = (id, changes) => ({ id, name: `Test ${id}`, disabled: false, statuses: new Set(), changes: changes.map(([type, value]) => ({ key: AC, type, value })) });
  const kindsOf = (effect, base) => effectLines(monsterOf([effect]), AC, { base })[0].kinds;
  assert.deepEqual(kindsOf(fx("fxOver", [["override", 9]]), 4), ["override"]);
  assert.deepEqual(kindsOf(fx("fxMult", [["multiply", 2]]), 4), ["multiply"]);
  assert.deepEqual(kindsOf(fx("fxMix", [["add", 1], ["override", 9]]), 4), ["override"], "the add is left out, the override alone is said");
  assert.deepEqual(kindsOf(fx("fxBoth", [["multiply", 2], ["override", 9]]), 4), ["multiply", "override"], "in the order the changes apply");
  assert.deepEqual(kindsOf(fx("fxAdds", [["add", 5], ["subtract", 2]]), 4), [], "an effect that only adds and subtracts says no type");
  assert.deepEqual(kindsOf(fx("fxTwice", [["multiply", 2], ["add", 1], ["multiply", 3]]), 4), ["multiply"], "a type met twice is listed once");
  assert.deepEqual(kindsOf({ ...fx("fxNone", []), changes: [{ key: AC, value: 5 }] }), [], "a change that names no type adds");
  assert.deepEqual(effectLines(monsterOf([fx("fxMoves", [["override", 9]])]), AC, { base: 9 }), [], "a change that moves nothing is no line, and says nothing");
});

await ok("a step label says the change's type in Foundry's word where it is not add or subtract, and reads as before where it is", () => {
  const effect = { name: "Test Hand" };
  assert.equal(stepLabel(effect, null), "Test Hand");
  assert.equal(stepLabel(effect, null, "add"), "Test Hand");
  assert.equal(stepLabel(effect, null, "subtract"), "Test Hand");
  assert.equal(stepLabel(effect, null, "override"), "Test Hand, Replacer");
  assert.equal(stepLabel(effect, null, "multiply"), "Test Hand, Scaler");
  const charge = implyingEffect("charging", { name: "Test Charge" });
  assert.equal(stepLabel(charge, "disordered", "override"), `${namedBy("Test Charge", "disordered")}, Replacer`, "the condition's bracket stays, the word follows it");
  assert.equal(stepLabel(effect, null, "upgrade"), "Test Hand, upgrade", "a type Foundry has no word for here reads as itself");
  assert.equal(kindWords(["multiply", "override"]), "Scaler, Replacer");
  const waivedSet = { id: "fxWaivedSet", name: "Test Waived", disabled: false, statuses: new Set(["disordered"]), changes: [{ key: AC, type: "override", value: 9 }] };
  assert.deepEqual(conditionSteps(monsterOf([waivedSet], ["disordered"]), AC).waived.map((w) => w.type), ["override"], "a waived step carries its type through");
});

await ok("kindedLabel ends a name with the type's word where it is not add or subtract, and gives the name as it is otherwise", () => {
  for (const type of [undefined, null, "", "add", "subtract"]) assert.equal(kindedLabel("Test Name", type), "Test Name", `type ${JSON.stringify(type)}`);
  assert.equal(kindedLabel("Test Name", "override"), "Test Name, Replacer");
  assert.equal(kindedLabel("Test Name", "multiply"), "Test Name, Scaler");
  assert.equal(kindedLabel("Test Name", "upgrade"), "Test Name, upgrade", "a type Foundry has no word for here reads as itself");
  assert.equal(stepLabel({ name: "Test Hand" }, null, "override"), kindedLabel("Test Hand", "override"), "a step label is the helper's");
});

await ok("a directly waived condition's step lands in waived with its effect, valued as the field takes it; a change the rule cannot attribute is not waived on a guess", () => {
  const step = conditionValue("disordered", AC);
  const own = conditionEffect("disordered");
  const waived = conditionSteps(monsterOf([own], ["disordered"]), AC);
  assert.deepEqual([waived.steps, waived.waived], [[], [{ condition: "disordered", type: "add", value: step, effect: own }]]);
  // Two statuses of one effect that both carry a change on the key: the change is no one's, so the all-statuses test decides.
  const shared = conditionEffect("disordered", { statuses: ["disordered", "shaken"], changes: [{ key: AC, type: "add", value: step }] });
  const kept = conditionSteps(monsterOf([shared], ["disordered"]), AC);
  assert.deepEqual([kept.steps.map((s) => [s.condition, s.value]), kept.waived], [[["disordered", step]], []], "an effect naming a status the waiver does not reach is not waived on a guess");
  assert.deepEqual(conditionSteps(monsterOf([shared], ["disordered", "shaken"]), AC).steps, [], "every status decided");
  // A status that carries no change on the key does not make the change ambiguous: it belongs to Disordered.
  const hungry = conditionEffect("disordered", { statuses: ["disordered", "hungry"] });
  assert.deepEqual(conditionSteps(monsterOf([hungry], ["disordered"]), AC).steps, []);
  // The waiver is the Armor Class figure's: the same condition's save step stands.
  assert.deepEqual(conditionSteps(monsterOf([conditionEffect("hungry")], ["hungry"]), SAVE).steps.map((s) => s.value), [conditionValue("hungry", SAVE)]);
});

await ok("a step is attributed to the status its change belongs to: the charge's Armor Class step is Disordered's, its own figure is the charge's", () => {
  const charging = implyingEffect("charging");
  const read = conditionSteps(monsterOf([charging]), AC);
  assert.deepEqual(read.steps.map((s) => [s.condition, s.value, s.effect]), [["disordered", conditionValue("disordered", AC), charging]]);
  assert.deepEqual(conditionSteps(monsterOf([charging]), "system.attack.mod.melee").steps.map((s) => [s.condition, s.value]), [["charging", conditionValue("charging", "system.attack.mod.melee")]]);
  const starving = implyingEffect("starving");
  assert.deepEqual(conditionSteps(monsterOf([starving]), SAVE).steps.map((s) => [s.condition, s.value]), [["hungry", conditionValue("hungry", SAVE)]]);
});

await ok("a waived charge's disorder: the one on the charging effect gets no step, and a hand Disordered or a countercharge beside it keeps one", () => {
  const step = conditionValue("disordered", AC);
  const charging = implyingEffect("charging");
  const alone = monsterOf([charging], ["charging"]);
  assert.deepEqual(subjectOf(alone).implied, ["disordered"]);
  assert.equal(acWaivedSet(subjectOf(alone)).has("disordered"), true, "the implied disorder follows the waived charge");
  const read = conditionSteps(alone, AC);
  assert.deepEqual([read.steps, read.waived.map((s) => [s.condition, s.value, s.effect])], [[], [["disordered", step, charging]]], "a waived charge alone leaves no step");
  for (const beside of [conditionEffect("disordered"), implyingEffect("countercharging")]) {
    for (const effects of [[implyingEffect("charging"), beside], [beside, implyingEffect("charging")]]) {
      const target = monsterOf(effects, ["charging"]);
      assert.equal(acWaivedSet(subjectOf(target)).has("disordered"), false, "a disorder carried in its own right, or by another state, stands");
      const kept = conditionSteps(target, AC);
      assert.deepEqual([kept.steps.map((s) => [s.condition, s.value]), kept.waived], [[["disordered", step]], []], "the condition set twice counts once, and is kept");
    }
  }
});

/* --- A condition counted once ---------------------------------------------------- */

/** The change of `effect` on `key`. */
const changeOf = (effect, key) => effect.system.changes.find((c) => c.key === key);
const MELEE = "system.attack.mod.melee";

await ok("a lone effect's changes all count, and so does a change nothing can be attributed to", () => {
  const charging = implyingEffect("charging");
  const actor = conditionActor("character", [charging]);
  actor.statuses = new Set();
  assert.deepEqual(charging.system.changes.map((c) => countsOnce(charging, c)), [true, true]);
  assert.equal(countsOnce(charging, { key: "" }), true);
  assert.equal(countsOnce(charging, { key: "system.invented.mod" }), true, "no status's entry carries it");
  assert.equal(countsOnce(charging, null), true);
  assert.equal(countsOnce(null, { key: AC }), true);
  const stray = conditionEffect("disordered");
  assert.equal(countsOnce(stray, changeOf(stray, AC)), true, "an effect with no actor counts");
});

await ok("an implying state then a hand effect of the condition it brings: the state's change counts and the hand's does not; the reverse order reverses it", () => {
  const charging = implyingEffect("charging");
  const hand = conditionEffect("disordered");
  conditionActor("monster", [charging, hand]);
  assert.deepEqual([countsOnce(charging, changeOf(charging, AC)), countsOnce(hand, changeOf(hand, AC))], [true, false]);
  assert.equal(countsOnce(charging, changeOf(charging, MELEE)), true, "the charge's own figure is not shadowed");
  const first = conditionEffect("disordered");
  const second = implyingEffect("charging");
  conditionActor("monster", [first, second]);
  assert.deepEqual([countsOnce(first, changeOf(first, AC)), countsOnce(second, changeOf(second, AC))], [true, false]);
  assert.equal(countsOnce(second, changeOf(second, MELEE)), true);
});

await ok("two states that bring one condition count it once, and one that brings another does not shadow it", () => {
  const a = implyingEffect("charging");
  const b = implyingEffect("countercharging");
  const c = implyingEffect("starving");
  conditionActor("monster", [a, b, c]);
  assert.deepEqual([a, b].map((e) => countsOnce(e, changeOf(e, AC))), [true, false]);
  assert.equal(countsOnce(c, changeOf(c, SAVE)), true, "Hungry's step is another condition's");
  const twins = [implyingEffect("starving"), implyingEffect("underfed")];
  conditionActor("monster", twins);
  assert.deepEqual(twins.map((e) => countsOnce(e, changeOf(e, SAVE))), [true, false]);
});

await ok("an earlier effect that is disabled, or inactive, or carries the status without a change on the key, shadows nothing", () => {
  for (const earlier of [conditionEffect("disordered", { disabled: true }), conditionEffect("disordered", { active: false }), conditionEffect("disordered", { changes: [] }), conditionEffect("disordered", { changes: [{ key: MELEE, type: "add", value: 3 }] })]) {
    const charging = implyingEffect("charging");
    conditionActor("monster", [earlier, charging]);
    assert.equal(countsOnce(charging, changeOf(charging, AC)), true);
  }
  // A later effect never shadows an earlier one.
  const charging = implyingEffect("charging");
  conditionActor("monster", [charging, conditionEffect("disordered", { disabled: true })]);
  assert.equal(countsOnce(charging, changeOf(charging, AC)), true);
});

await ok("a change two statuses of its effect could own counts: no attribution, no filter", () => {
  const hand = conditionEffect("disordered");
  const both = conditionEffect("disordered", { statuses: ["disordered", "shaken"], changes: [{ key: AC, type: "add", value: 5 }] });
  conditionActor("monster", [hand, both]);
  assert.equal(countsOnce(both, both.system.changes[0]), true);
});

await ok("the order is the actor's allApplicableEffects, and the actor's own effects where it has none", () => {
  const charging = implyingEffect("charging");
  const hand = conditionEffect("disordered");
  const actor = conditionActor("monster", []);
  actor.effects = [];
  actor.allApplicableEffects = function* () { yield hand; yield charging; };
  for (const effect of [hand, charging]) Object.defineProperty(effect, "actor", { value: actor, configurable: true });
  assert.deepEqual([hand, charging].map((e) => countsOnce(e, changeOf(e, AC))), [true, false]);
  // With no `allApplicableEffects`, the actor's own effects are the order.
  const plain = conditionActor("monster", [hand, charging]);
  delete plain.allApplicableEffects;
  assert.deepEqual([hand, charging].map((e) => countsOnce(e, changeOf(e, AC))), [true, false]);
});

await ok("the readers agree with the filter: an Armor Class step and a save step are read once beside a hand-set copy, in either order", () => {
  const step = conditionValue("disordered", AC);
  for (const order of [["charging", "disordered"], ["disordered", "charging"]]) {
    const effects = order.map((id) => (id === "charging" ? implyingEffect("charging") : conditionEffect("disordered")));
    const read = conditionSteps(monsterOf(effects), AC);
    assert.deepEqual(read.steps.map((s) => [s.condition, s.value, s.effect]), [["disordered", step, effects[0]]], order.join());
  }
  for (const order of [["starving", "hungry"], ["hungry", "starving"]]) {
    const effects = order.map((id) => (id === "starving" ? implyingEffect("starving") : conditionEffect("hungry")));
    const read = conditionSteps(monsterOf(effects), SAVE);
    assert.deepEqual(read.steps.map((s) => [s.condition, s.value]), [["hungry", conditionValue("hungry", SAVE)]], order.join());
  }
});

/* --- A saving throw under a condition ------------------------------------------ */

const occasioned = (over = {}) => part("save", 2, { saves: ["death"], gate: { kind: "status", status: "wasted", occasion: true }, ...over });

await ok("a gated save part is tested through partHolds: off adds nothing, an occasion the roll does not name is pending, and one it names applies", () => {
  const saver = bearer([rec("alpha", [occasioned()])], { statuses: ["wasted"] });
  const pendingOnly = saveModParts(saver, { save: "death" });
  assert.deepEqual([pendingOnly.parts, pendingOnly.pending], [[], [{ label: "Alpha", value: 2, when: "gate" }]]);
  assert.deepEqual(saveModParts(saver, { save: "death", occasion: "wasted" }).parts.map((p) => [p.label, p.value]), [["Alpha", 2]]);
  assert.deepEqual(saveModParts(saver, { save: "blast", occasion: "wasted" }), { parts: [], pending: [] }, "another save is not this part's");
  assert.deepEqual(saveModParts(saver, { occasion: "wasted" }).pending, [{ label: "Alpha", value: 2, when: "save" }], "a roll that names no save cannot tell");
  const well = bearer([rec("alpha", [occasioned()])]);
  assert.deepEqual(saveModParts(well, { save: "death", occasion: "wasted" }), { parts: [], pending: [] }, "a creature without the status adds nothing");
});

await ok("ruling 130 on a save: a larger part for another save never displaces a smaller one for this save", () => {
  const saver = bearer([rec("alpha", [part("save", 5, { saves: ["death"] })]), rec("beta", [part("save", 2, { saves: ["blast"] })])]);
  assert.deepEqual(saveModParts(saver, { save: "blast" }).parts.map((p) => [p.label, p.value]), [["Beta", 2]]);
  assert.equal(sheetSaveShift(saver, { save: "blast" }).total, 2);
});

await ok("the sheet's throw takes the save and the occasion: a held occasion applies, an unnamed one is pending and told", () => {
  const saver = bearer([rec("alpha", [occasioned()])], { statuses: ["wasted"] });
  assert.equal(sheetSaveShift(saver, { save: "death", occasion: "wasted" }).total, 2);
  const waiting = sheetSaveShift(saver, { save: "death" });
  assert.deepEqual([waiting.total, waiting.pending.length, waiting.told.map((t) => t.lang)], [0, 1, ["notice.savePending"]]);
});

await ok("ownSaveParts tests each row per saver: a holding row is a target part, an undecided one is pending, the rest add nothing", () => {
  const rows = [
    { label: "Test Edge", cite: "Test cite", value: 2, ifHas: ["kw:tumbling"], key: "mine" },
    { label: "Other", value: 3, gate: { kind: "status", status: "wasted" } },
    { label: "Blank", value: 0 },
    { label: "Unknown", value: 1, gate: { kind: "nothingRegistered" } },
    { label: "Narrowed", value: 4, saves: ["death"] },
  ];
  const saver = bearer([], { items: [ability("def.prof.tumbling")] });
  const r = ownSaveParts(saver, rows, { save: "blast" });
  assert.deepEqual(r.parts, [{ key: "mine", label: "Test Edge (Test cite)", value: 2, side: "target" }]);
  assert.deepEqual(r.pending, [{ label: "Unknown", value: 1, when: "gate" }]);
  assert.deepEqual(ownSaveParts(saver, rows, {}).pending.map((p) => [p.label, p.when]), [["Unknown", "gate"], ["Narrowed", "save"]], "a roll that names no save cannot tell a narrowed row");
  assert.deepEqual(ownSaveParts(bearer([]), rows, { save: "blast" }).parts, [], "a saver without the capability takes nothing");
  assert.deepEqual(ownSaveParts(saver, null), { parts: [], pending: [] });
});

console.log(`\n${passed} roll-mods checks passed.`);
