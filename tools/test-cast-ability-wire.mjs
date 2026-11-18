/**
 * The caster-ability matcher's wiring into the cast (`scripts/magic/cast-ability-use.mjs`
 * and the sites that read it): the caster level every level-scaled figure reads,
 * the parts on a target's saving throw at each place a cast's save is made (the
 * casting client, the card's presses, the GM's relay), and the damage a spell's
 * attack contributor adds. Foundry-free with stand-in globals; every spell,
 * ability, figure and creature below is invented, so this file carries no book
 * content.
 *
 * Usage: node tools/test-cast-ability-wire.mjs
 */
import assert from "node:assert/strict";

/** A stand-in Roll: the formula's extremes by arithmetic, the throw landing on the high end. */
const extreme = (formula, high) => {
  const text = String(formula).replace(/(\d+)d(\d+)/g, (_m, n, die) => String(high ? Number(n) * Number(die) : Number(n)));
  return Function(`return (${text});`)();
};
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = {
  i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key },
  user: { id: "p1", isGM: false, targets: new Set() },
  users: { get: (id) => ({ id, isGM: true }), activeGM: { id: "gm" } },
  socket: { emit: (_channel, message) => emitted.push(message) },
};
const emitted = [];
const rolled = [];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
    rolled.push(formula);
  }
  async evaluate() {
    this.total = extreme(this.formula, true);
    this.result = String(this.total);
    return this;
  }
  evaluateSync({ minimize = false } = {}) {
    this.total = extreme(this.formula, !minimize);
    return this;
  }
};
const hooked = {};
globalThis.Hooks = { once() {}, on: (name, fn) => void (hooked[name] = fn), callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
class FakeItem {
  constructor(data, { parent } = {}) {
    this.name = data.name;
    this.type = data.type;
    this.parent = parent;
    this.system = { ...data.system, getDamageFormula() { return this.damage.base.formula; }, getDamageModifiers() { return []; } };
  }
}
globalThis.CONFIG = { Item: { documentClass: FakeItem } };
const docs = {};
globalThis.fromUuidSync = (uuid) => docs[uuid] ?? null;
globalThis.fromUuid = async (uuid) => docs[uuid] ?? null;

const { castAbilitiesOf, castSaveParts, castDamageRows, abilityDamageContributor, NO_ABILITIES } = await import("../scripts/magic/cast-ability-use.mjs");
const { levelTip, abilityTips } = await import("../scripts/magic/cast-ability-tips.mjs");
const { castSpellRun, rollResist, rowSpecOf, registerCastSpell } = await import("../scripts/magic/cast-spell.mjs");
const { worldFor, checkApplyRequest } = await import("../scripts/magic/cast-apply.mjs");
const { pressRecurSave } = await import("../scripts/magic/cast-recur.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { dialogContext } = await import("../scripts/magic/apps/cast-dialog.mjs");
const { damageModifiersFor, carrierOf } = await import("../scripts/lib/patches/attack-throw.mjs");
const { castDuration } = await import("../scripts/magic/cast-duration.mjs");

// The cast installs its claimant, its card hooks and the damage contributor, as the module does at `init`.
registerCastSpell();

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

/** The cast's lang root, as the stand-in localizer prints a key. */
const ROOT = "ACKS-MAGIC.cast.";
const flat = (v) => ({ kind: "flat", flat: v });
const perLevel = (base, per) => ({ kind: "perLevel", base, per });

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

/** An ability item as the importer leaves it: a cookbook id and its effect rows. */
const ability = (name, id, effects, extras = {}) => ({
  id: name.replace(/\W/g, ""),
  name,
  type: "ability",
  flags: { "acks-extras": { cookbook: { id }, extras: { effects, ...extras } } },
  effects: [],
});
const row = (target, value, narrow, over = {}) => ({ type: "spellcastingMod", target, value, ...narrow, ...over });
/** The one ability most tests carry: +2 to the level, -2 to the save and 1 per die of damage, for a school and an element. */
const tideweaver = () =>
  ability("Tideweaver", "def.prof.tideweaver", [
    row("casterLevel", 2, { schools: ["tideweaving"] }),
    row("save", -2, { elements: ["brine"] }),
    row("damage", 1, { schools: ["tideweaving"] }, { perDie: true }),
  ]);
/** A second ability, adding a flat figure to the same spell's damage. */
const brinelore = () => ability("Brinelore", "def.prof.brinelore", [row("damage", 3, { elements: ["brine"] })]);

const casterOf = (items, level = 5) => ({
  uuid: "Actor.c1",
  name: "Caster",
  type: "character",
  items,
  system: { details: { level } },
  getRollData: () => ({}),
});
const burn = (over = {}) => ({ key: "burn", type: "damage", roll: "1d4", damage: ["fire"], value: flat(2), ...over });
/** An invented spell on the caster, flagged for the school and element the abilities narrow on. */
const spellOn = (caster, rows, extra = {}) => {
  const item = {
    type: "spell",
    name: "Testbrine",
    uuid: "Actor.c1.Item.s1",
    img: "i.png",
    flags: { "acks-extras": { spell: { type: "tideweaving", schools: ["tideweaving"], elements: ["brine"], save: { category: "spell", effect: "negates" }, effects: rows, ...extra } } },
    parent: caster,
  };
  caster.parent = null;
  docs[item.uuid] = item;
  docs[caster.uuid] = caster;
  return item;
};
const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
/** An invented target creature: a saving throw of fourteen, hit dice as its sheet writes them. */
const creature = (hd = "3") => ({
  name: "Folk",
  type: "monster",
  system: { hp: { hd }, saves: { spell: { value: 14 } } },
  effects: [],
  getFlag: () => undefined,
});
let tokenAt = 0;
const tokenOf = (actor = creature()) => {
  const id = `k${++tokenAt}`;
  const token = { uuid: `Scene.s.Token.${id}`, name: `Target ${id}`, documentName: "Token", actor };
  docs[token.uuid] = token;
  return token;
};

/** The dependencies of a run, recorded: the shape `castSpellRun` takes, with the caster's own items read live. */
function runDeps({ answer, caster, tokens = [], gaps = {}, level = { matched: true, classLevel: 5, ladder: null }, isGM = false } = {}) {
  const calls = { notices: [], posts: [], spends: 0, pools: [], asked: null };
  const capacity = { verdict: "ok", max: 3, used: 1, source: "tradition" };
  return {
    calls,
    capacity,
    deps: {
      lookups: NO_TWIN,
      read: async () => ({ actor: caster, tokens, casterToken: null, gaps, statuses: [], capacity, level }),
      ask: async (ctx) => {
        calls.asked = ctx;
        return answer;
      },
      notify: (lvl, key) => calls.notices.push([lvl, key]),
      adjustPool: async (...args) => calls.pools.push(args.slice(1)),
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async () => ({ ok: true }),
      record: async () => {},
      throwRow: async () => null,
      now: () => 10,
      isGM: () => isGM,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  The gathering helpers                                             */
/* ------------------------------------------------------------------ */

t("castAbilitiesOf matches a caster's rows to the spell, and answers nothing for a caster with no abilities, no spell or no matching row", () => {
  const caster = casterOf([tideweaver(), brinelore()]);
  const spell = spellOn(caster, [burn()]);
  const out = castAbilitiesOf(caster, spell, NO_TWIN);
  assert.deepEqual([out.casterLevel.length, out.save.length, out.damage.length], [1, 1, 2]);
  assert.equal(castAbilitiesOf(casterOf([]), spell, NO_TWIN), NO_ABILITIES);
  assert.equal(castAbilitiesOf({ type: "monster" }, spell, NO_TWIN), NO_ABILITIES);
  assert.equal(castAbilitiesOf(caster, null, NO_TWIN), NO_ABILITIES);
  const other = spellOn(casterOf([tideweaver()]), [burn()], { type: "evocation", schools: ["evocation"], elements: ["ember"] });
  assert.deepEqual(Object.values(castAbilitiesOf(other.parent, other, NO_TWIN)).map((l) => l.length), [0, 0, 0], "a spell of another school and element meets none");
});

t("an ifHas names an ability the caster holds with no spellcasting row of its own, and fails where it is not held", () => {
  const gated = ability("Gated", "def.prof.gated", [row("casterLevel", 1, { schools: ["tideweaving"], ifHas: ["def.prof.plain"] })]);
  const plain = ability("Plain", "def.prof.plain", [{ type: "modifier", target: "ac", value: 1 }]);
  const withPlain = casterOf([gated, plain]);
  assert.equal(castAbilitiesOf(withPlain, spellOn(withPlain, [burn()]), NO_TWIN).casterLevel.length, 1, "held, though it carries no row");
  const without = casterOf([gated]);
  assert.equal(castAbilitiesOf(without, spellOn(without, [burn()]), NO_TWIN).casterLevel.length, 0, "not held");
});

t("castSaveParts lists only a part that applies, with its figure as written; castDamageRows multiplies a perDie part by the dice and leaves a zero out", () => {
  const caster = casterOf([tideweaver(), brinelore()]);
  const matched = castAbilitiesOf(caster, spellOn(caster, [burn()]), NO_TWIN);
  const [save] = castSaveParts(matched);
  assert.deepEqual([save.label, save.value, save.key.startsWith("ability:")], ["Tideweaver", -2, true]);
  assert.deepEqual(castDamageRows(matched, "3d4 + 1"), [{ label: "Tideweaver", value: 3 }, { label: "Brinelore", value: 3 }]);
  assert.deepEqual(castDamageRows(matched, "flat"), [{ label: "Brinelore", value: 3 }], "no dice, so a perDie part is zero and is no row");
  assert.deepEqual(castSaveParts(NO_ABILITIES), []);
  const blank = casterOf([ability("Blank", "def.prof.blank", [row("save", null, { elements: ["brine"] })])]);
  assert.deepEqual(castSaveParts(castAbilitiesOf(blank, spellOn(blank, [burn()]), NO_TWIN)), [], "a blank figure applies nothing");
});

t("a save part that yields to another of one capability is not put on the roll, though the card keeps it with who it yielded to", () => {
  const one = ability("Tidecaller", "def.prof.tidecaller", [row("save", -2, { elements: ["brine"] })], { provides: ["kw:tidal"] });
  const two = ability("Wavecaller", "def.prof.wavecaller", [row("save", -1, { elements: ["brine"] })], { provides: ["kw:tidal"] });
  const caster = casterOf([one, two]);
  const matched = castAbilitiesOf(caster, spellOn(caster, [burn()]), NO_TWIN);
  assert.equal(matched.save.length, 2);
  assert.equal(matched.save.filter((p) => p.applies).length, 1, "one wins");
  assert.equal(matched.save.find((p) => !p.applies).yieldsTo !== null, true);
  assert.equal(castSaveParts(matched).length, 1, "only the winner is a part of the roll");
});

/* ------------------------------------------------------------------ */
/*  Caster level                                                      */
/* ------------------------------------------------------------------ */

const FAR = { range: { shape: "distancePerLevel", value: 10, unit: "feet" }, target: { model: "creature", count: flat(1) } };
const mend = { key: "mend", type: "heal", roll: "1d6" };

await ta("an ability's level reaches a per-level range and the cast: out of reach at the class level, in reach with the ability, and the card keeps the level and its parts", async () => {
  const far = tokenOf();
  const gaps = { [far.uuid]: 60 };
  const bare = casterOf([]);
  let r = runDeps({ answer: { mode: "normal", picks: {} }, caster: bare, tokens: [far], gaps });
  assert.equal((await castSpellRun(spellOn(bare, [mend], FAR), () => r.calls.spends++, r.deps)).reason, "outOfRange", "level 5 reaches fifty feet, not sixty");
  const caster = casterOf([tideweaver()]);
  r = runDeps({ answer: { mode: "normal", picks: {} }, caster, tokens: [far], gaps });
  assert.equal(r.capacity.max, 3);
  const out = await castSpellRun(spellOn(caster, [mend], FAR), () => r.calls.spends++, r.deps);
  assert.equal(out.ok, true, "level 7 reaches seventy feet");
  assert.equal(r.calls.asked.level.value, 7, "the dialog is shown the level with the ability on it");
  const { casterLevel: level } = r.calls.posts[0];
  assert.deepEqual([level.value, level.source, level.base], [7, "class", 5]);
  assert.deepEqual(level.parts.map((p) => [p.label, p.value, p.applies]), [["Tideweaver", 2, true]]);
  assert.deepEqual(level.listed, []);
  assert.deepEqual(JSON.parse(JSON.stringify(level)), level, "the level and its parts survive a flag's round trip");
});

await ta("a level typed by hand takes no ability: it reaches only its own range, and the parts are listed on the card, not added", async () => {
  const far = tokenOf();
  const caster = casterOf([tideweaver()]);
  const gaps = { [far.uuid]: 60 };
  let r = runDeps({ answer: { mode: "normal", picks: {}, casterLevel: "5" }, caster, tokens: [far], gaps });
  assert.equal((await castSpellRun(spellOn(caster, [mend], FAR), () => {}, r.deps)).reason, "outOfRange", "a typed 5 is 5, whatever the ability");
  r = runDeps({ answer: { mode: "normal", picks: {}, casterLevel: "6" }, caster, tokens: [far], gaps });
  assert.equal((await castSpellRun(spellOn(caster, [mend], FAR), () => {}, r.deps)).ok, true, "a typed 6 reaches sixty");
  const { casterLevel: level } = r.calls.posts[0];
  assert.deepEqual([level.value, level.source, level.base, level.parts], [6, "hand", 6, []]);
  assert.deepEqual(level.listed.map((p) => p.label), ["Tideweaver"]);
  const loc = (key, data) => game.i18n.format(`${ROOT}${key}`, data);
  const tip = levelTip(level, loc);
  assert.ok(tip.includes("ability.listed"), "the card's tip marks it as listed, not added");
  assert.equal((tip.match(/ability\.partBare\|/g) ?? []).length, 1, "and the part is told once, inside the listed line");
});

await ta("an ability's level reaches a per-level duration and the instances a no-throw row rolls", async () => {
  const caster = casterOf([tideweaver()]);
  const dread = { key: "dread", type: "conditionGrant", conditions: ["afraid"], lasts: "duration" };
  const duration = { shape: "perLevel", value: 1, unit: "minutes" };
  const r = runDeps({ answer: { mode: "normal", picks: {} }, caster });
  await castSpellRun(spellOn(caster, [dread], { duration }), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].duration, castDuration(duration, { casterLevel: 7 }));
  assert.notDeepEqual(r.calls.posts[0].duration, castDuration(duration, { casterLevel: 5 }), "not the class level's");
  rolled.length = 0;
  const volley = { key: "mend", type: "heal", roll: "1d6", value: perLevel(1, 1), max: flat(20) };
  const again = runDeps({ answer: { mode: "normal", picks: {} }, caster });
  await castSpellRun(spellOn(caster, [volley]), () => {}, again.deps);
  assert.deepEqual(rolled, ["7d6"], "the count of dice is the level with the ability");
  assert.equal(again.calls.posts[0].rows.mend.count.value, 7);
});

await ta("the Hit Dice cap a target gate reads is the level with the ability on it", async () => {
  const caster = casterOf([tideweaver()]);
  const big = tokenOf(creature("6"));
  const capped = { target: { model: "creature", hdCap: perLevel(1, 1) } };
  let r = runDeps({ answer: { mode: "normal", picks: {} }, caster, tokens: [big] });
  await castSpellRun(spellOn(caster, [mend], capped), () => {}, r.deps);
  assert.deepEqual(Object.values(r.calls.posts[0].entries).map((e) => e.state), ["pending"], "six Hit Dice meet a cap of seven");
  const bare = casterOf([]);
  r = runDeps({ answer: { mode: "normal", picks: {} }, caster: bare, tokens: [big] });
  await castSpellRun(spellOn(bare, [mend], capped), () => {}, r.deps);
  assert.deepEqual(Object.values(r.calls.posts[0].entries).map((e) => e.state), ["exempt"], "and are over a cap of five");
});

await ta("an ability changes no slot or use: a caster with abilities spends once, and the capacity the dialog is shown is the one it was read with", async () => {
  const caster = casterOf([tideweaver(), brinelore()]);
  const r = runDeps({ answer: { mode: "normal", picks: {} }, caster });
  let spends = 0;
  await castSpellRun(spellOn(caster, [mend]), () => spends++, r.deps);
  assert.equal(spends, 1);
  assert.deepEqual(r.calls.pools, [], "no pool is drawn from for a spell the tradition does not spend from one for");
  assert.deepEqual(r.calls.asked.capacity, r.capacity);
});

t("the dialog and the card tell the abilities' parts in their tooltips, the base figure named as it was", () => {
  const caster = casterOf([tideweaver()]);
  const matched = castAbilitiesOf(caster, spellOn(caster, [burn()]), NO_TWIN);
  const level = { value: 7, source: "class", base: 5, parts: matched.casterLevel, listed: [] };
  const ctx = { level, modes: ["normal"], caster, targets: [], capacity: null };
  const shown = dialogContext(ctx, {}).level;
  assert.equal(shown.line, `${ROOT}dialog.levelLine|{"value":7}`);
  assert.ok(shown.tip.includes('tip.level.class|{"value":5}'), "the base reads five, not seven");
  assert.ok(shown.tip.includes(`${ROOT}ability.partBare|`), "and the ability's part follows");
  const view = castCardView({ castId: "x", spellName: "S", casterName: "C", mode: "normal", casterLevel: level, abilities: { save: matched.save, damage: matched.damage }, rows: {}, order: [], targets: {}, entries: {} }, { isGM: false, canPress: false }, (k, d) => game.i18n.format(`${ROOT}${k}`, d));
  assert.equal((view.noteTooltip.match(/ability\.partBare\|/g) ?? []).length, 3, "level, save and damage parts each");
  assert.equal(abilityTips([], (k) => k).length, 0);
});

/* ------------------------------------------------------------------ */
/*  The save, at every place a cast's save is made                     */
/* ------------------------------------------------------------------ */

const SAVE = { category: "spell", effect: "negates" };

await ta("rollResist puts the caster's parts on the target's roll", async () => {
  const bare = await rollResist(creature(), SAVE, null, {});
  assert.equal(bare.resist.formula, "1d20");
  const made = await rollResist(creature(), SAVE, null, { parts: [{ key: "ability:a:0", label: "Tideweaver", value: -2 }] });
  assert.equal(made.resist.formula, "1d20 - 2");
  assert.ok(made.resist.parts.some((p) => p.label === "Tideweaver" && p.value === -2));
});

await ta("a cast rolls each target's save with the caster's abilities on it", async () => {
  const caster = casterOf([tideweaver()]);
  const token = tokenOf();
  const r = runDeps({ answer: { mode: "normal", picks: {} }, caster, tokens: [token] });
  await castSpellRun(spellOn(caster, [burn()]), () => {}, r.deps);
  const [target] = Object.values(r.calls.posts[0].targets);
  assert.equal(target.resist.formula, "1d20 - 2");
  assert.deepEqual(target.resist.parts.map((p) => [p.label, p.value]), [["Tideweaver", -2]]);
  assert.deepEqual([r.calls.posts[0].abilities.save.length, r.calls.posts[0].abilities.damage.length], [1, 1], "the card keeps the parts it was cast with");
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls.posts[0].abilities)), r.calls.posts[0].abilities, "and they survive a flag's round trip");
  const plain = casterOf([]);
  const again = runDeps({ answer: { mode: "normal", picks: {} }, caster: plain });
  await castSpellRun(spellOn(plain, [burn()]), () => {}, again.deps);
  assert.equal("abilities" in again.calls.posts[0], false, "a cast with no ability carries none");
});

await ta("a card's Apply to my targets rolls the new targets' saves with the caster's abilities on them", async () => {
  const caster = casterOf([tideweaver()]);
  const spell = spellOn(caster, [burn()]);
  const cast = runDeps({ answer: { mode: "normal", picks: {} }, caster });
  await castSpellRun(spell, () => {}, cast.deps);
  const updates = [];
  const message = { id: "m4", author: { id: "p1" }, flags: { "acks-extras": { castCard: cast.calls.posts[0] } }, update: async (u) => void updates.push(u) };
  const token = tokenOf();
  game.user.targets = new Set([{ document: token }]);
  let click;
  const button = { dataset: { action: "magicCastApplyTargets" }, addEventListener: (_event, fn) => void (click = fn) };
  const body = { innerHTML: "", querySelectorAll: () => [button] };
  hooked.renderChatMessageHTML(message, { nodeType: 1, querySelector: () => body });
  click({ preventDefault() {} });
  for (let i = 0; i < 200 && !updates.length; i++) await new Promise((resolve) => setImmediate(resolve));
  game.user.targets = new Set();
  const [update] = updates;
  const key = Object.keys(update).find((k) => /\.targets\.t\w+$/.test(k));
  assert.equal(update[key].resist.formula, "1d20 - 2");
});

/** A cast card for one target, as `worldFor` and a press read it. */
const cardFor = (caster, spell, token, over = {}) => ({
  castId: "castX",
  spellUuid: spell.uuid,
  casterUuid: caster.uuid,
  mode: "normal",
  picks: {},
  save: SAVE,
  situational: null,
  casterLevel: { value: 7, source: "class" },
  casterTokenUuid: null,
  duration: { none: "noDuration" },
  rows: {},
  order: [],
  targets: { t1: { uuid: token.uuid, name: token.name, resist: null } },
  entries: { t1_burn: { state: "pending" } },
  ...over,
});

await ta("the relay recomputes the save with the caster's abilities, so a total only that formula can roll stands and one it cannot is refused", async () => {
  const caster = casterOf([tideweaver()]);
  const spell = spellOn(caster, [burn()]);
  const token = tokenOf();
  const card = cardFor(caster, spell, token);
  const world = await worldFor({ requestUserId: "p1", targetKey: "t1" }, { id: "m1", author: { id: "p1" } }, { card });
  assert.deepEqual([world.resist.min, world.resist.max], [-1, 18], "1d20 - 2");
  const bare = casterOf([]);
  const bareSpell = spellOn(bare, [burn()]);
  const bareWorld = await worldFor({ requestUserId: "p1", targetKey: "t1" }, { id: "m1", author: { id: "p1" } }, { card: cardFor(bare, bareSpell, token) });
  assert.deepEqual([bareWorld.resist.min, bareWorld.resist.max], [1, 20], "a caster with no ability throws against a bare die");
  const low = { kind: "save", category: "spell", formula: "1d20 - 2", total: -1, target: 14, baseTarget: 14, success: false, parts: [] };
  const sent = { ...card, targets: { t1: { ...card.targets.t1, resist: low } } };
  const asked = { requestUserId: "p1", messageId: "m1", targetKey: "t1", resist: low, entries: [{ rowKey: "burn", rolled: 3 }] };
  const check = (w) => checkApplyRequest(asked, { ...w, card: sent, message: { authorId: "p1" }, boundsOf: () => ({ min: 1, max: 4 }) });
  assert.deepEqual(check(world), { ok: true }, "a total below the bare die's floor stands with the abilities");
  assert.equal(check(bareWorld).refused, "badResist", "and is refused without them");
});

await ta("a recurring Save is rolled with the caster's abilities on it, and sent with the parts it rolled", async () => {
  const caster = casterOf([tideweaver()]);
  const choke = { key: "choke", type: "conditionGrant", conditions: ["afraid"], recur: "eachRound", recurAt: "casterTurn", recurSave: "cast", saveEffect: "negates", lasts: "duration" };
  const spell = spellOn(caster, [choke], { duration: { shape: "fixed", value: 1, unit: "minutes" } });
  const token = tokenOf();
  const card = cardFor(caster, spell, token, { entries: { t1_choke: { state: "pending" } } });
  const message = { id: "m2", flags: { "acks-extras": { castCard: card } } };
  emitted.length = 0;
  await pressRecurSave(message, { target: "t1", row: "choke" });
  assert.equal(emitted.length, 1, "one press goes to the GM's client");
  assert.equal(emitted[0].payload.resist.formula, "1d20 - 2");
  assert.deepEqual(emitted[0].payload.resist.parts.map((p) => [p.label, p.value]), [["Tideweaver", -2]]);
  const bare = casterOf([]);
  const bareSpell = spellOn(bare, [choke], { duration: { shape: "fixed", value: 1, unit: "minutes" } });
  emitted.length = 0;
  await pressRecurSave({ id: "m3", flags: { "acks-extras": { castCard: cardFor(bare, bareSpell, token, { entries: { t1_choke: { state: "pending" } } }) } } }, { target: "t1", row: "choke" });
  assert.equal(emitted[0].payload.resist.formula, "1d20", "a caster with no ability rolls the bare die");
});

/* ------------------------------------------------------------------ */
/*  Damage                                                            */
/* ------------------------------------------------------------------ */

/** An actor whose model asks the attack seam for a spell's damage, as core's builder does. */
const askingCaster = (items) => {
  const caster = casterOf(items);
  caster.system.getDamageModifiers = function (type) {
    return damageModifiersFor(this, type, [{ label: "core", value: 100 }]);
  };
  caster.system.parent = caster;
  return caster;
};

await ta("a spell's damage takes the abilities' parts: a perDie part by the dice of the scaled formula, a flat part once, and core's own answer for the kind stays out", async () => {
  const caster = askingCaster([tideweaver(), brinelore()]);
  const spell = spellOn(caster, [burn()]);
  const scaled = burn({ value: perLevel(1, 1) });
  const spec = await rowSpecOf(caster, spell, { castId: "c", casterLevel: { value: 5 } }, { row: scaled, key: "burn" });
  assert.equal(spec.formula, "5d4 + 5 + 3", "five dice, one a die, and the flat three");
  assert.deepEqual(spec.modifiers.map((m) => m.label), ["Tideweaver", "Brinelore"]);
  const small = await rowSpecOf(caster, spell, { castId: "c", casterLevel: { value: 2 } }, { row: scaled, key: "burn" });
  assert.equal(small.formula, "2d4 + 2 + 3", "the relay's card level is the one the dice are counted at");
});

await ta("a spell the abilities do not narrow to, a caster with none, and a weapon's own attack take nothing", async () => {
  const caster = askingCaster([tideweaver()]);
  const other = spellOn(caster, [burn()], { type: "evocation", schools: ["evocation"], elements: ["ember"] });
  assert.equal((await rowSpecOf(caster, other, { castId: "c", casterLevel: { value: 5 } }, { row: burn(), key: "burn" })).formula, "2d4");
  const bare = askingCaster([]);
  assert.equal((await rowSpecOf(bare, spellOn(bare, [burn()]), { castId: "c", casterLevel: { value: 5 } }, { row: burn(), key: "burn" })).formula, "2d4");
  const weapon = new FakeItem({ name: "Pole", type: "weapon", system: { damage: { base: { formula: "1d6" } } } }, { parent: caster });
  assert.equal(carrierOf(weapon), null);
  const given = [{ label: "x", value: 1 }];
  assert.equal(abilityDamageContributor.damage({ actor: caster, item: weapon }, "melee", given), given, "a weapon's damage is returned as it came");
  assert.deepEqual(abilityDamageContributor.carriers, ["damage"], "and only a spell carrier's damage is asked");
});

console.log(`\n${n} cast ability wiring tests passed`);
