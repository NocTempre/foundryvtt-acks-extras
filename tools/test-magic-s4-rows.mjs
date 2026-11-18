/**
 * Offline tests for the register rows of the ten spells of slice S4e: each entry's
 * compiled recipe (`cookbook/spells.json`, from `register/rr/p196-p262-spells.json`)
 * holds the shape the cast reads, and the cast opens, gates and lines each kind as
 * built (`cast-kinds.mjs`, `cast-gates.mjs`, `cast-life.mjs`, `cast-mods.mjs`,
 * `cast-spell.mjs`, `describe.mjs`). Foundry-free.
 *
 * What a page prints is not here: every figure, creature, weapon and the clause
 * text below is invented, and a recipe's located fields are filled by hand where the
 * cast needs them. Whether the locators match the printed page is a rules test
 * (`tools/rules-tests/`, machine-local).
 *
 * Usage: node tools/test-magic-s4-rows.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, user: { targets: new Set() } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "7";
    return this;
  }
};
class FakeItem {
  constructor(data, { parent } = {}) {
    this.type = data.type;
    this.parent = parent;
    this.system = { ...data.system, getDamageFormula() { return this.damage.base.formula; }, getDamageModifiers() { return []; } };
  }
}
globalThis.CONFIG = { Item: { documentClass: FakeItem } };

const { materializeEffects } = await import("../scripts/importer/executor.mjs");
const { spellRecipeProblems } = await import("./importer/spell-recipe-rules.mjs");
const { CONDITIONS } = await import("../scripts/lib/conditions.mjs");
const { CONDITION_KEYS, resolveLevelValue } = await import("../scripts/lib/vocab.mjs");
const { targetGate } = await import("../scripts/magic/cast-gates.mjs");
const { rowOpens, rowResisted, placeOf, kindOf, livesKind, entryOf } = await import("../scripts/magic/cast-kinds.mjs");
const { lifeOf } = await import("../scripts/magic/cast-life.mjs");
const { conditionRecords } = await import("../scripts/magic/cast-apply.mjs");
const { modParts, isModRow, modifierFigure } = await import("../scripts/magic/cast-mods.mjs");
const { buildTargets, castSpellRun } = await import("../scripts/magic/cast-spell.mjs");
const { ROLLED_KINDS, keyedRows, pickGroups, rowsForMode, saveGoverns, saveFractionOf } = await import("../scripts/magic/cast-rows.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { vocabLabel } = await import("../scripts/lib/magic-vocab.mjs");

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cb = JSON.parse(fs.readFileSync(path.join(REPO, "cookbook", "spells.json"), "utf8"));

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

/* ------------------------------------------------------------------ */
/*  The compiled recipes                                               */
/* ------------------------------------------------------------------ */

const ID = {
  beguile: "def.spell.beguileHumanoid",
  beast: "def.spell.infuriateBeast",
  humanoid: "def.spell.infuriateHumanoid",
  slumber: "def.spell.slumber",
  command: "def.spell.wordOfCommand",
  fear: "def.spell.removeFear",
  dead: "def.spell.destroyDead",
  blade: "def.spell.shatterBlade",
  sanctuary: "def.spell.sanctuary",
  rest: "def.spell.salvingRest",
};
const specsOf = (id) => cb.entries[id].fields.effects.specs;
const valuesOf = (id) => cb.entries[id].fields.values.specs;
const rowOf = (id, key) => specsOf(id).find((s) => s.key === key);
/** The fields a spec's locators fill, in order, for every `values` spec of an entry. */
const locatedBy = (id) => valuesOf(id).flatMap((v) => (v.from ?? []).map((l) => l.into));
/** A spec as the row a materialized import leaves: no recipe keys, plus the located fields a test names. */
const asRow = (spec, located = {}) => {
  const { from, each, onMiss, noteFrom, ...row } = spec;
  return { ...row, origin: "register", ...located };
};
const flat = (v) => ({ kind: "flat", flat: v });

t("the ten entries carry recipes in the compiled cookbook, and the recipe lint finds nothing in them", () => {
  for (const id of Object.values(ID)) {
    assert.ok(specsOf(id)?.length, `${id} effects`);
    assert.deepEqual(spellRecipeProblems({ effects: specsOf(id), values: valuesOf(id) }), [], id);
    for (const s of specsOf(id)) assert.match(s.key, /^[a-z][A-Za-z0-9]*$/);
  }
});

t("every condition the recipes name is in lib's catalogue, and the row keys are the authored ones", () => {
  const named = Object.values(ID).flatMap((id) => specsOf(id).flatMap((s) => [...(s.conditions ?? []), ...(s.untimed ?? [])]));
  assert.deepEqual([...new Set(named)].sort(), ["bewitched", "frightened", "infuriated", "prone", "slumbering"]);
  for (const key of named) assert.ok(Object.hasOwn(CONDITIONS, key) && Object.hasOwn(CONDITION_KEYS, key), key);
  assert.deepEqual(Object.values(ID).map((id) => specsOf(id).map((s) => s.key)), [
    ["bewitch", "orders"], ["fury", "mate"], ["fury", "same"], ["sleep"], ["cmd"], ["calm", "cause"], ["crumble", "remains"], ["shatter"], ["ward", "exceptions"], ["restHeal", "enervated"],
  ]);
});

t("beguile: a conditionGrant that a save negates for the spell's duration, one line row, and its spell-level figures are all located", () => {
  const [bewitch, orders] = specsOf(ID.beguile);
  assert.deepEqual([bewitch.type, bewitch.conditions, bewitch.saveEffect, bewitch.lasts, bewitch.appliesTo], ["conditionGrant", ["bewitched"], "negates", "duration", "target"]);
  assert.equal(orders.type, "limitation");
  assert.deepEqual(locatedBy(ID.beguile), ["save.category", "target.filters", "target.hdBelow", "save.modifier"]);
  assert.deepEqual(valuesOf(ID.beguile)[0].save, { effect: "negates", kind: "save", perTarget: true });
});

t("infuriate: both spells grant the condition under a negating save; the beast's page gives the extra-save line row, the humanoid's a pointer row; the figures stay located", () => {
  for (const id of [ID.beast, ID.humanoid]) {
    const fury = rowOf(id, "fury");
    assert.deepEqual([fury.type, fury.conditions, fury.saveEffect, fury.lasts], ["conditionGrant", ["infuriated"], "negates", "duration"]);
    assert.deepEqual(locatedBy(id), ["save.category", "target.filters", "target.hdBelow"], "no save.modifier: the page's bonus belongs to the extra save");
  }
  assert.equal(rowOf(ID.beast, "mate").type, "limitation");
  assert.equal(rowOf(ID.humanoid, "same").type, "limitation");
});

t("slumber: an area condition row, a diameter sphere read from the page, and a gate on Hit Dice, kinds and the no-save threshold; no endsOn (lib's slumbering is lost to damage and moving)", () => {
  const sleep = rowOf(ID.slumber, "sleep");
  assert.deepEqual([sleep.type, sleep.appliesTo, sleep.conditions, sleep.lasts, sleep.saveEffect, sleep.endsOn], ["conditionGrant", "area", ["slumbering"], "duration", "negates", undefined]);
  assert.deepEqual(valuesOf(ID.slumber)[0].target, { model: "area", area: { shape: "sphere", measure: "diameter" } });
  assert.deepEqual(locatedBy(ID.slumber), ["save.category", "target.filters", "target.hdBelow", "save.exemptBelowHd", "target.area.size"]);
  assert.deepEqual([...CONDITIONS.slumbering.lost], ["damage", "moved"]);
});

t("word of command: one template row, expanded once per printed option into a pick group, each lasting to the bearer's following turn with prone untimed", () => {
  const [cmd] = specsOf(ID.command);
  assert.deepEqual([cmd.type, cmd.pick, cmd.lasts, cmd.saveEffect, cmd.untimed, cmd.conditions], ["conditionGrant", "command", "followingTurn", "negates", ["prone"], undefined]);
  assert.ok(cmd.each?.pattern && cmd.from.length === 1 && cmd.from[0].into === "conditions");
  assert.equal(cmd.pickOption, undefined, "each writes the option");
  assert.deepEqual(locatedBy(ID.command), ["save.category", "target.filters"]);
});

t("remove fear: a lifting row no save governs whose conditions are located, a reversed grant, and the reverse's duration read from the printed line", () => {
  const [calm, cause] = specsOf(ID.fear);
  assert.deepEqual([calm.type, calm.saveEffect, calm.conditions, calm.lasts], ["conditionRemove", "none", undefined, undefined]);
  assert.deepEqual(calm.from.map((l) => l.into), ["conditions"]);
  assert.deepEqual([cause.type, cause.conditions, cause.reversed, cause.saveEffect, cause.lasts], ["conditionGrant", ["frightened"], true, "negates", "duration"]);
  assert.equal(valuesOf(ID.fear)[0].reversedDurationFromNote, true);
  assert.deepEqual(locatedBy(ID.fear), ["save.category"], "no spell-wide filters: the reverse's kind would also gate the plain form");
});

t("destroy dead: a slay row a save negates, a line row for the remains, the undead filter and the Hit Dice bound located", () => {
  const crumble = rowOf(ID.dead, "crumble");
  assert.deepEqual([crumble.type, crumble.saveEffect, crumble.conditions, crumble.lasts], ["slay", "negates", undefined, undefined]);
  assert.equal(rowOf(ID.dead, "remains").type, "limitation");
  assert.deepEqual(locatedBy(ID.dead), ["save.category", "target.filters", "target.hdBelow"]);
});

t("shatter blade: a destroyItem row a save negates, with the spell's weapon count a located ladder on caster level", () => {
  const shatter = rowOf(ID.blade, "shatter");
  assert.deepEqual([shatter.type, shatter.saveEffect, shatter.conditions, shatter.lasts], ["destroyItem", "negates", undefined, undefined]);
  const count = valuesOf(ID.blade)[0].from.find((l) => l.into === "target.count");
  assert.deepEqual([count.on, count.pairs], ["level", true]);
});

t("sanctuary: a ward on the recipient against enemies that ends on the recipient's attack, the save category located, and a line row for the exceptions", () => {
  const ward = rowOf(ID.sanctuary, "ward");
  assert.deepEqual([ward.type, ward.appliesTo, ward.vsEnemy, ward.saveEffect, ward.lasts, ward.endsOn], ["ward", "recipient", true, "negates", "duration", ["attack"]]);
  assert.equal(rowOf(ID.sanctuary, "exceptions").type, "limitation");
  assert.deepEqual(valuesOf(ID.sanctuary)[0].save, { effect: "negates", kind: "save" });
  assert.deepEqual(locatedBy(ID.sanctuary), ["save.category"]);
});

t("salving rest: two line rows and no row that rolls, heals, writes a record or reads a save", () => {
  const rows = specsOf(ID.rest);
  assert.deepEqual(rows.map((r) => r.type), ["capability", "capability"]);
  assert.deepEqual(locatedBy(ID.rest), []);
  assert.ok(rows.every((r) => !ROLLED_KINDS.includes(r.type) && r.saveEffect === "none" && !r.lasts && !r.roll && !r.recur));
});

t("a row's `endsOn` and `untimed` are checked by the lint against lib's causes and the condition catalogue", () => {
  const row = (over) => ({ key: "r", type: "conditionGrant", conditions: ["prone"], ...over });
  const problems = (over) => spellRecipeProblems({ effects: [row(over)] });
  assert.deepEqual(problems({ endsOn: ["damage", "attack"], untimed: ["prone"] }), []);
  assert.match(problems({ endsOn: ["sunrise"] }).join(), /endsOn/);
  assert.match(problems({ endsOn: [] }).join(), /endsOn/);
  assert.match(problems({ untimed: ["notACondition"] }).join(), /untimed names "notACondition"/);
  assert.match(problems({ untimed: "prone" }).join(), /untimed is a non-empty list/);
});

/* ------------------------------------------------------------------ */
/*  Word of command: the option list                                   */
/* ------------------------------------------------------------------ */

// An invented list in the shape the recipe expects: a word, a colon, a sentence that says what the target becomes.
const LIST = [
  { text: "Intro that names “alpha,” “beta” and “gamma” in quotes, which are no options." },
  { text: " Alpha: The target immediately becomes frightened. On its initiative, it does a thing.  Beta: The target immediately falls prone and becomes mesmerized. On its initiative, it waits.  Gamma: The target immediately becomes unknown. On its initiative, it rests.  Delta: The target immediately starts faltering. On its initiative, it stops." },
  { text: "This list is invented and ends here." },
];

t("the template row expands once per option in page order into cmd<n> with pickOption n; an option that names no condition is dropped and its number left unused", () => {
  const rows = materializeEffects(specsOf(ID.command), LIST);
  assert.deepEqual(rows.map((r) => r.key), ["cmd1", "cmd2", "cmd4"]);
  assert.deepEqual(rows.map((r) => r.pickOption), ["1", "2", "4"]);
  assert.deepEqual(rows.map((r) => r.conditions), [["frightened"], ["prone", "mesmerized"], ["faltering"]]);
  for (const r of rows) assert.deepEqual([r.type, r.pick, r.lasts, r.untimed, r.saveEffect], ["conditionGrant", "command", "followingTurn", ["prone"], "negates"]);
});

t("the options are one pick group; a cast keeps one option's row", () => {
  const rows = materializeEffects(specsOf(ID.command), LIST);
  const groups = pickGroups(rows, "normal");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options.map((o) => o.token), ["1", "2", "4"]);
  assert.deepEqual(rowsForMode(rows, "normal", { command: "2" }).map(({ key }) => key), ["cmd2"]);
});

t("a page with no list yields no rows, so a seat without the book keeps no empty options", () => {
  assert.deepEqual(materializeEffects(specsOf(ID.command), [{ text: "nothing" }]), []);
  assert.deepEqual(materializeEffects(specsOf(ID.command), []), []);
});

t("an option row writes a record per condition: all but prone to the bearer's following turn, prone with no clock, all carrying the row", () => {
  const [row] = materializeEffects(specsOf(ID.command), LIST).filter((r) => r.key === "cmd2");
  const life = lifeOf(row, { fight: { combatId: "c1", combatantId: "k1" } });
  assert.deepEqual([life.kind, life.rounds, life.turnLife.edge, life.turnLife.count], ["followingTurn", 2, "start", 2]);
  const card = { spellUuid: "Item.s", spellName: "Invented", casterUuid: "Actor.c", castId: "x", duration: { value: 1, units: "rounds" } };
  const made = conditionRecords(row, card, { startTime: 100, spell: { img: "i.png" }, key: row.key, life });
  assert.equal(made.length, 2);
  const [prone, mesmerized] = made.map((d) => ({ status: d.statuses?.[0], record: spellEffectOf(d) }));
  assert.deepEqual([prone.status, mesmerized.status], ["prone", "mesmerized"]);
  assert.deepEqual([prone.record.turnLife, prone.record.startTime, prone.record.duration], [undefined, undefined, undefined], "prone ends when the bearer gets up, not on a clock");
  assert.deepEqual([mesmerized.record.turnLife.edge, mesmerized.record.turnLife.count, mesmerized.record.startTime, mesmerized.record.duration], ["start", 2, 100, { value: 2, units: "rounds" }]);
});

t("outside a fight the following turn is a two-round clock with no turn flag", () => {
  const row = asRow(rowOf(ID.command, "cmd") ?? specsOf(ID.command)[0], { conditions: ["mesmerized"] });
  const life = lifeOf(row);
  assert.deepEqual([life.kind, life.rounds, life.turnLife], ["followingTurn", 2, null]);
});

/* ------------------------------------------------------------------ */
/*  The gates                                                          */
/* ------------------------------------------------------------------ */

/** An invented creature: Hit Dice as its sheet writes them, its kinds, and a save. */
const creature = (hd, types = [], name = "Thing") => ({
  name,
  type: "monster",
  system: { hp: { hd }, saves: { spell: { value: 14 } } },
  effects: [],
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { types } : undefined),
});
const person = (level, name = "Folk") => ({ name, type: "character", system: { details: { level }, saves: { spell: { value: 14 } } }, effects: [], getFlag: () => undefined });

t("a strict Hit Dice bound with the living and kind filters gates a target as the recipes ask (figures invented)", () => {
  // The shape beguile, infuriate and destroy dead locate: filters, a strict bound.
  const extras = { target: { filters: ["living", "humanoid"], hdBelow: flat(4) } };
  const gate = (actor) => targetGate({ actor, extras, level: 1 });
  assert.equal(gate(creature("3", ["humanoid"])).affected, true);
  const atBound = gate(creature("4", ["humanoid"]));
  assert.deepEqual([atBound.affected, atBound.why.key], [false, "hd"], "at the bound is exempt");
  const beast = gate(creature("2", ["animal"]));
  assert.deepEqual([beast.affected, beast.why.key], [false, "kind"]);
  assert.equal(gate(creature("2", ["undead", "humanoid"])).affected, false, "living fails on the undead");
  assert.equal(gate(person(2)).affected, true, "a character counts as humanoid and living (owner question 1c.10)");
  assert.equal(gate(creature("3", [])).affected, true, "a creature whose kinds are unknown is not gated");
});

t("the undead-only filter (destroy dead) admits undead and exempts the living", () => {
  const extras = { target: { filters: ["undead"], hdBelow: flat(9) } };
  assert.equal(targetGate({ actor: creature("3", ["undead"]), extras }).affected, true);
  assert.equal(targetGate({ actor: creature("3", ["animal"]), extras }).why.key, "kind");
  assert.equal(targetGate({ actor: creature("9", ["undead"]), extras }).why.key, "hd");
});

t("slumber's figures: the living filter, the bound, and the Hit Dice under which a target takes the effect with no save", () => {
  const extras = { target: { filters: ["living"], hdBelow: flat(5) }, save: { exemptBelowHd: flat(2) } };
  const low = targetGate({ actor: creature("1", ["animal"]), extras });
  assert.deepEqual([low.affected, low.noSave, low.why.key], [true, true, "noSave"]);
  const mid = targetGate({ actor: creature("3", ["animal"]), extras });
  assert.deepEqual([mid.affected, mid.noSave], [true, false]);
  assert.equal(targetGate({ actor: creature("5", ["animal"]), extras }).affected, false);
  assert.equal(targetGate({ actor: creature("1", ["undead"]), extras }).affected, false);
});

t("a blank figure gates nothing: an entry the import left blank reads no bound and no filter", () => {
  assert.equal(targetGate({ actor: creature("30", ["undead"]), extras: { target: { filters: [], hdBelow: null }, save: { exemptBelowHd: null } } }).affected, true);
  assert.equal(targetGate({ actor: creature("30"), extras: null }).affected, true);
});

/* ------------------------------------------------------------------ */
/*  The kinds                                                          */
/* ------------------------------------------------------------------ */

t("remove fear's lifting row opens only with its located conditions and is resisted by no save; its reverse is a plain condition row", () => {
  const calm = asRow(rowOf(ID.fear, "calm"));
  assert.equal(calm.conditions, undefined, "blank where the page was not read");
  assert.equal(rowOpens({ type: calm.type, conditions: calm.conditions ?? [] }), false, "a blank list opens no entry");
  const read = { ...calm, conditions: ["frightened", "faltering"] };
  assert.equal(rowOpens(read), true);
  assert.equal(rowResisted(read, creature("3")), false);
  assert.equal(placeOf(read), "row");
  assert.equal(saveGoverns(read, { effect: "negates" }), false, "none beats the spell's effect");
  assert.deepEqual(saveFractionOf(read, { effect: "negates" }, { success: true }), { fraction: 1, effect: "none", saved: null });
  const cause = asRow(rowOf(ID.fear, "cause"));
  assert.equal(rowOpens(cause), true);
  assert.equal(livesKind(cause.type), true);
});

t("destroy dead's slay row opens with no figure and is governed by the spell's save; shatter blade's destroy row posts its line and is resisted only where a weapon is held", () => {
  const slay = asRow(rowOf(ID.dead, "crumble"));
  assert.deepEqual([rowOpens(slay), rowResisted(slay, creature("3")), livesKind(slay.type)], [true, true, false]);
  const smash = asRow(rowOf(ID.blade, "shatter"));
  const armed = { ...creature("3"), items: [{ id: "w1", name: "Invented blade", type: "weapon", system: { equipped: true }, getFlag: () => undefined }] };
  assert.deepEqual([rowOpens(smash), placeOf(smash), rowResisted(smash, armed), rowResisted(smash, creature("3"))], [true, "rowAndLine", true, false]);
  assert.deepEqual(entryOf(smash, armed), { item: { id: "w1", name: "Invented blade" } });
});

t("shatter blade's count locator reads an article as the base count, so the ladder has a level-1 rung", () => {
  const count = valuesOf(ID.blade)[0].from.find((l) => l.into === "target.count");
  assert.equal(count.articles, true);
  const prose = "The spell can destroy a weapon. A caster of 3rd level or higher can shatter two weapons, and one of 7th level or higher can shatter four weapons.";
  const [row] = materializeEffects(valuesOf(ID.blade).map((v) => ({ ...v, onMiss: "blank" })), [{ text: prose }]);
  assert.deepEqual(row.target.count, {
    kind: "breakpoints",
    breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }, { atLevel: 7, value: 4 }],
  });
  assert.equal(resolveLevelValue(row.target.count, 1), 1);
});

t("shatter blade's count is a LevelValue the cast reads at the caster level; a blank one caps nothing", () => {
  const ladder = { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 5, value: 2 }, { atLevel: 9, value: 3 }] };
  assert.deepEqual([1, 4, 5, 9].map((level) => modifierFigure({ value: ladder }, level)), [1, 1, 2, 3]);
  assert.equal(modifierFigure({ value: undefined }, 5), null);
  assert.equal(resolveLevelValue({ kind: "breakpoints", breakpoints: [{ atLevel: 5, value: 2 }] }, 1), null, "below the first rung nothing reads");
});

t("a ward row (sanctuary) becomes a part with the spell's save category, the enemy scope and the cause that ends it; no other kind of its entry is a part", () => {
  const ward = asRow(rowOf(ID.sanctuary, "ward"));
  const exceptions = asRow(rowOf(ID.sanctuary, "exceptions"));
  const built = modParts(keyedRows([ward, exceptions]), { save: { category: "spell", effect: "negates", kind: "save" } });
  assert.equal(built.parts.length, 1);
  const [part] = built.parts;
  assert.deepEqual([part.key, part.on, part.vsEnemy, part.save], ["ward", "ward", true, "spell"]);
  assert.deepEqual([built.endsOn, built.lasting], [["attack"], true]);
  assert.equal(isModRow(exceptions), false);
  const unread = modParts(keyedRows([ward]), { save: { category: "", effect: "negates", kind: "save" } });
  assert.equal(unread.parts[0].save, undefined, "no category read, no save named on the notice");
});

/* ------------------------------------------------------------------ */
/*  Line rows                                                          */
/* ------------------------------------------------------------------ */

const LINE_ROWS = [
  [ID.beguile, "orders"], [ID.beast, "mate"], [ID.humanoid, "same"], [ID.dead, "remains"], [ID.sanctuary, "exceptions"], [ID.rest, "restHeal"], [ID.rest, "enervated"],
];
const INVENTED = "an invented clause read from a page";

t("a line row is outside the dispatch, the rolled kinds and the buff rows, and carries its clause as the located note only", () => {
  for (const [id, key] of LINE_ROWS) {
    const spec = rowOf(id, key);
    assert.ok(["limitation", "capability"].includes(spec.type), `${id} ${key}`);
    assert.equal(kindOf(spec.type), null);
    assert.equal(ROLLED_KINDS.includes(spec.type), false);
    assert.equal(isModRow(spec), false);
    assert.equal(spec.note, undefined, "no authored prose");
    assert.ok(spec.noteFrom?.pattern, "the clause is read from the page");
    assert.equal(spec.saveEffect, "none");
    assert.equal(spec.condition, undefined);
  }
});

t("a line row reads as its located clause on the card, and as a dash where the clause was not read", () => {
  for (const [id, key] of LINE_ROWS) {
    assert.equal(describeSpellEffect(asRow(rowOf(id, key), { note: INVENTED })).text, INVENTED);
    assert.equal(describeSpellEffect(asRow(rowOf(id, key))).text, "—");
  }
});

const caster = { uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) };
let ids = 0;
const tokenOf = (actor, i = 1) => ({ uuid: `Scene.s.Token.k${i}`, name: actor.name, id: `k${i}`, actor });

await ta("a cast of line rows opens no entry, rolls no save and moves nothing, however many targets", async () => {
  const rows = LINE_ROWS.map(([id, key]) => asRow(rowOf(id, key), { note: INVENTED }));
  const cardRows = {};
  const built = await buildTargets({ tokens: [tokenOf(creature("3")), tokenOf(creature("4"), 2)], card: { rows: cardRows, casterLevel: { value: 5 } }, rows: keyedRows(rows), save: { category: "spell", effect: "negates" }, situational: null, caster, randomID: () => `x${++ids}`, extras: null });
  assert.deepEqual(Object.keys(built.entries), []);
  assert.deepEqual(Object.values(built.targets).map((t) => t.resist), [null, null]);
  assert.deepEqual(built.rolls, []);
});

await ta("the recipient of a ward rolls no save though the spell names a category: the ward opens its entry and the attacker's target rides the notice", async () => {
  const ward = asRow(rowOf(ID.sanctuary, "ward"));
  const exceptions = asRow(rowOf(ID.sanctuary, "exceptions"), { note: INVENTED });
  const cardRows = { ward: { type: "ward", key: "ward", on: "ward", blank: false, types: [], total: null } };
  const built = await buildTargets({ tokens: [tokenOf(creature("3"))], card: { rows: cardRows, casterLevel: { value: 5 } }, rows: keyedRows([ward, exceptions]), save: { category: "spell", effect: "negates", kind: "save" }, situational: null, caster, randomID: () => `x${++ids}`, extras: null });
  assert.deepEqual(Object.values(built.targets).map((t) => t.resist), [null]);
  assert.deepEqual(Object.values(built.entries).map((e) => e.state), ["pending"]);
  assert.deepEqual(built.rolls, []);
});

t("salving rest writes no buff part, so no figure of it reaches any roll until the reader that gates it exists", () => {
  const rows = specsOf(ID.rest).map((s) => asRow(s, { note: INVENTED }));
  const built = modParts(keyedRows(rows), { save: { category: "death", effect: "negates", kind: "save" } });
  assert.deepEqual([built.parts, built.blank, built.lasting, built.endsOn], [[], [], false, []]);
});

function runDeps() {
  const calls = { posts: [], applied: 0, records: 0 };
  return {
    calls,
    deps: {
      lookups: { byCookbookId: () => null, fromUuidSync: () => null },
      read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false } }),
      ask: async () => ({ mode: "normal", picks: {} }),
      notify: () => {},
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async () => {
        calls.applied++;
        return { ok: true };
      },
      record: async () => {
        calls.records++;
      },
      throwRow: async () => null,
      now: () => 10,
      isGM: () => false,
    },
  };
}
const spellOf = (rows) => ({ type: "spell", name: "Invented", uuid: "Actor.c1.Item.s1", img: "i.png", flags: { "acks-extras": { spell: { effects: rows } } }, parent: { isOwner: true, type: "character", uuid: "Actor.c1" } });

await ta("salving rest posts two lines and no section, so nothing rolls, heals or records at the cast", async () => {
  const r = runDeps();
  await castSpellRun(spellOf(specsOf(ID.rest).map((s) => asRow(s, { note: INVENTED }))), () => {}, r.deps);
  const [card] = r.calls.posts;
  assert.deepEqual(card.order, []);
  assert.deepEqual(card.lines, [INVENTED, INVENTED]);
  assert.deepEqual([r.calls.applied, r.calls.records], [0, 0]);
});

await ta("destroy dead posts its slay section and its remains line; sanctuary posts its ward section and its exceptions line", async () => {
  const dead = runDeps();
  await castSpellRun(spellOf(specsOf(ID.dead).map((s) => asRow(s, { note: INVENTED }))), () => {}, dead.deps);
  assert.deepEqual([dead.calls.posts[0].order, dead.calls.posts[0].lines], [["crumble"], [INVENTED]]);
  const sanctuary = runDeps();
  await castSpellRun(spellOf(specsOf(ID.sanctuary).map((s) => asRow(s, { note: INVENTED }))), () => {}, sanctuary.deps);
  assert.deepEqual([sanctuary.calls.posts[0].order, sanctuary.calls.posts[0].lines], [["ward"], [INVENTED]]);
});

await ta("remove fear casts the plain form as a lifting section, and the reverse as a condition section", async () => {
  const rows = [asRow(rowOf(ID.fear, "calm"), { conditions: ["frightened", "faltering"] }), asRow(rowOf(ID.fear, "cause"))];
  const plain = runDeps();
  await castSpellRun(spellOf(rows), () => {}, plain.deps);
  assert.deepEqual(plain.calls.posts[0].order, ["calm"]);
  assert.deepEqual(plain.calls.posts[0].rows.calm.conditions, ["frightened", "faltering"]);
  const reversed = runDeps();
  reversed.deps.ask = async () => ({ mode: "reversed", picks: {} });
  const spell = spellOf(rows);
  spell.flags["acks-extras"].spell.reversible = true;
  await castSpellRun(spell, () => {}, reversed.deps);
  assert.deepEqual(reversed.calls.posts[0].order, ["cause"]);
  assert.equal(vocabLabel("effectLasts", "followingTurn") !== "followingTurn", true, "the following turn has a label");
});

console.log(`\n${n} tests passed`);
