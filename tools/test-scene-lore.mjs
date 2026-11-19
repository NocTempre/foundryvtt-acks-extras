/**
 * Lore checks on the scene search: a layer keyed to a proficiency is thrown by
 * the member's own imported ability, and a member without it gets the vague hint
 * (hasty) or a refusal (methodical).
 *
 * Joins the real party check (`resolveCheck`, `rollCheckFor`) to the scene
 * search's own `skillConfig` over ability items shaped like `bindAbility`'s
 * output, where `test-scene-session.mjs` supplies a mock for it. Every name,
 * page and figure here is this file's own invention; no throw target stands for
 * any printed one, and a figure is never the page's.
 *
 * What this pins: who holds a proficiency (the register stamp or a `provides`
 * entry, never a name); the throw a keyed check rolls (the ability's first
 * non-measure throw, at the member's level); that a second rank still reads the
 * first rank's figure (R-I1b is unbuilt); what a skill holder with no figure and
 * a held skill that prints no throw each get; and the pure rules around them.
 * What it does not reach: the screen's picker and the Judges' card (the live
 * recipe, docs/scene-search/TESTING.md, "S7a").
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

/* --- the real strings, so a key that does not exist fails here ------------- */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};
const format = (key, data = {}) => {
  const text = lookup(key);
  assert.equal(typeof text, "string", `lang key ${key} exists`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));
};

/* --- stand-ins -------------------------------------------------------------- */
class Stub {}
const dice = [];
globalThis.game = {
  user: { id: "gm1", isGM: true },
  users: [],
  i18n: { localize: (k) => (typeof lookup(k) === "string" ? lookup(k) : k), format, has: (k) => typeof lookup(k) === "string" },
  settings: { get: () => ({}) },
  actors: new Map(),
  items: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.Roll = class {
  static validate() { return true; }
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.total = dice.shift() ?? 10; this.dice = [{ results: [{ result: this.total }] }]; return this; }
};
globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor?.name }), create: async (data) => data };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))) },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    handlebars: { renderTemplate: async () => "<section>card</section>" },
  },
};

const { PARTY_CHECKS, resolveCheck, rollCheckFor } = await import("../scripts/formation/party-rolls.mjs");
const { citeOf } = await import("../scripts/abilities/ability-rolls.mjs");
const { hasCapability, itemHasCapability } = await import("../scripts/lib/capabilities.mjs");
const { capabilityForId } = await import("../scripts/lib/vocab.mjs");
const { AUTOMATIC_SKILLS, CHECK, CODE, REFUSAL } = await import("../scripts/scene-search/constants.mjs");
const { skillConfig, skillFigures } = await import("../scripts/scene-search/lore-logic.mjs");
const { layerOptions, layerRefusal, outcomeOf, sceneEntries } = await import("../scripts/scene-search/scene-logic.mjs");

/* --- fixtures ---------------------------------------------------------------- */
const flat = (n) => ({ kind: "flat", flat: n });
/** A throw as `materializeRolls` stores one from a recipe: a flat figure and no scale. */
const recipeThrow = (key, n) => ({ key, label: key, formula: "1d20", rollType: "above", target: flat(n) });
/** A throw as the effect scan lifts one: a positional key and a figure that moves with level. */
const liftedThrow = (base, per) => ({ key: "throw1", label: "", formula: "1d20", rollType: "above", target: { kind: "perLevel", base, per }, scale: "level", condition: "" });

let serial = 0;
/** An imported ability: the register stamp, the page it cites and the throws it stores. */
function ability(definition, rolls, { cite = "XX p.1", provides = [] } = {}) {
  const all = { "acks-extras": { extras: { rolls, effects: [], provides }, cookbook: { id: definition, cite } } };
  return { id: `i${++serial}`, type: "ability", name: definition.split(".").pop(), system: {}, flags: all, getFlag: (scope, key) => all[scope]?.[key] };
}
/** A hand-typed ability: a name and nothing the register stamped. */
function handmade(name, rolls) {
  const all = { "acks-extras": { extras: { rolls, effects: [], provides: [] } } };
  return { id: `i${++serial}`, type: "ability", name, system: {}, flags: all, getFlag: (scope, key) => all[scope]?.[key] };
}
/** A character at `level` holding `items`. */
function member(name, items, level = 6) {
  const a = {
    id: name, name, type: "character", statuses: new Set(), appliedEffects: [],
    system: { details: { level, morale: 0 }, adventuring: {}, hp: { value: 8 }, saves: {}, attack: { throw: 10 }, surprise: {}, initiative: {} },
    getFlag: () => undefined,
  };
  for (const i of items) i.actor = a;
  a.items = Object.assign([...items], { get: (id) => items.find((i) => i.id === id) });
  return a;
}

const DEF = {
  theology: "def.prof.theology",
  loremastery: "def.prof.loremastery",
  naturalism: "def.prof.naturalism",
  engineering: "def.prof.magicalEngineering",
  sensing: "def.prof.sensingPower",
};
const TOKEN = Object.fromEntries(Object.entries(DEF).map(([k, id]) => [k, capabilityForId(id)]));

/** What the activities read for one member at one token: their resolved target and the page their ability cites. */
const readFor = (actor) => (token) => {
  const held = actor.items.find((i) => itemHasCapability(i, token));
  return { target: resolveCheck(actor, skillConfig(token))?.target ?? null, cite: held ? citeOf(held) : "" };
};
/** `member` as `layerOptions` reads one, for these tokens. */
const asMember = (actor, tokens) => ({ id: actor.id, level: actor.system.details.level, capabilities: tokens.filter((t) => hasCapability(actor, t)), tools: [] });
/** A scene of one thing whose two checks name `token`. */
const sceneOf = (token, extra = {}) =>
  sceneEntries({
    things: [{ id: "fresco", kind: "fixture", layers: { hasty: { check: CHECK.SKILL, capability: token, tools: extra.tools ?? [], yields: { clue: "Found: a detail", lots: [], reveal: [] } }, methodical: { check: CHECK.SKILL, capability: token, yields: { clue: "Found: a deeper detail", lots: [], reveal: [] } } } }],
  });
const ctxOf = (entries, actor, tokens) => ({ entries, figures: skillFigures(tokens, readFor(actor)) });

/* --- the tokens the rail writes ------------------------------------------------ */
eq(TOKEN, { theology: "kw:theology", loremastery: "kw:loremastery", naturalism: "kw:naturalism", engineering: "kw:magicalengineering", sensing: "kw:sensingpower" }, "the rail's token for each proficiency is its register id's capability");
eq(AUTOMATIC_SKILLS, [TOKEN.sensing], "only the proficiency that prints no throw is listed as automatic");

/* --- who holds one ---------------------------------------------------------------- */
{
  const holder = member("holder", [ability(DEF.theology, [recipeThrow("recognize", 13)])]);
  ok(hasCapability(holder, TOKEN.theology), "an item stamped with the register id holds the proficiency");
  const typed = member("typed", [handmade("Theology", [recipeThrow("recognize", 13)])]);
  ok(!hasCapability(typed, TOKEN.theology), "a hand-typed item of the same name holds nothing the register knows");
  eq(resolveCheck(typed, skillConfig(TOKEN.theology)), null, "and gives no throw to the keyed check, whatever its name");
  const provider = member("provider", [handmade("Lorekeeper", [recipeThrow("recognize", 15)])]);
  provider.items[0].flags["acks-extras"].extras.provides = [TOKEN.theology];
  ok(hasCapability(provider, TOKEN.theology), "an ability that provides the capability holds it");
}

/* --- the throw a keyed check rolls ------------------------------------------------ */
{
  const one = member("one", [ability(DEF.theology, [recipeThrow("recognize", 13)])]);
  eq(resolveCheck(one, skillConfig(TOKEN.theology)).target, 13, "a holder's target is the figure their own ability stores");

  const lore = member("lore", [ability(DEF.loremastery, [liftedThrow(17, -1)])], 6);
  eq(resolveCheck(lore, skillConfig(TOKEN.loremastery)).target, 12, "a throw that moves with level reads at the holder's level");
  const lowLore = member("lowLore", [ability(DEF.loremastery, [liftedThrow(17, -1)])], 1);
  eq(resolveCheck(lowLore, skillConfig(TOKEN.loremastery)).target, 17, "and at another level reads that level's");

  const two = member("two", [ability(DEF.naturalism, [recipeThrow("first", 13), recipeThrow("second", 16)])]);
  eq(resolveCheck(two, skillConfig(TOKEN.naturalism)).target, 13, "a proficiency with two throws keys its first, and the layer cannot name the other");
  const swapped = member("swapped", [ability(DEF.naturalism, [recipeThrow("second", 16), recipeThrow("first", 13)])]);
  eq(resolveCheck(swapped, skillConfig(TOKEN.naturalism)).target, 16, "first means first in the stored order, not the lowest figure");

  const rank1 = member("rank1", [ability(DEF.engineering, [recipeThrow("items", 15)])]);
  const rank2 = member("rank2", [ability(DEF.engineering, [recipeThrow("items", 15)]), ability(DEF.engineering, [recipeThrow("items", 15)])]);
  eq([resolveCheck(rank1, skillConfig(TOKEN.engineering)).target, resolveCheck(rank2, skillConfig(TOKEN.engineering)).target], [15, 15], "a second rank reads the first rank's figure until R-I1b steps it");

  const blank = member("blank", [ability(DEF.theology, [])]);
  eq(resolveCheck(blank, skillConfig(TOKEN.theology)), null, "an ability with no throw read gives the check no figure");
}

/* --- the throw itself --------------------------------------------------------------- */
{
  const actor = member("roller", [ability(DEF.theology, [recipeThrow("recognize", 13)])]);
  dice.push(13);
  const hit = await rollCheckFor(actor, skillConfig(TOKEN.theology));
  eq([hit.row.target, hit.row.total, hit.row.success], [13, 13, true], "a total at the target passes");
  dice.push(12);
  const miss = await rollCheckFor(actor, skillConfig(TOKEN.theology));
  eq([miss.row.total, miss.row.success], [12, false], "a total under the target fails");
  eq(await rollCheckFor(member("none", [handmade("Theology", [])]), skillConfig(TOKEN.theology)), null, "a member with no such ability rolls nothing");
  eq(await rollCheckFor(member("quiet", [ability(DEF.sensing, [])]), skillConfig(TOKEN.sensing)), null, "a proficiency with no throw has nothing to roll");
}

/* --- skillFigures ------------------------------------------------------------------- */
{
  const read = (map) => (token) => map[token] ?? null;
  eq(skillFigures([TOKEN.theology], read({ [TOKEN.theology]: { target: 13, cite: " XX p.2 " } })), { skillTargets: { [TOKEN.theology]: 13 }, skillCites: { [TOKEN.theology]: "XX p.2" }, skillAutomatic: [] }, "a figure and its page are carried, the page trimmed");
  eq(skillFigures([TOKEN.sensing], read({ [TOKEN.sensing]: { target: null, cite: "XX p.3" } })).skillAutomatic, [TOKEN.sensing], "a listed skill with no figure is automatic");
  eq(skillFigures([TOKEN.sensing], read({ [TOKEN.sensing]: { target: 15 } })).skillAutomatic, [], "a listed skill whose ability carries a throw is thrown: an import that adds one wins");
  eq(skillFigures([TOKEN.sensing], read({ [TOKEN.sensing]: { target: 0 } })).skillAutomatic, [], "a figure of zero is a figure, not a blank");
  eq(skillFigures([TOKEN.theology], read({})).skillAutomatic, [], "a token not listed is never automatic, however empty its figure");
  eq(skillFigures(["kw:unlisted"], read({ "kw:unlisted": { target: null } })), { skillTargets: { "kw:unlisted": null }, skillCites: {}, skillAutomatic: [] }, "an unread token is a blank figure with no page");
  eq(skillFigures([TOKEN.sensing], () => null).skillTargets, { [TOKEN.sensing]: null }, "a read that answers nothing is a blank figure");
}

/* --- what each member is offered and answered ----------------------------------------- */
{
  const tokens = Object.values(TOKEN);
  const holder = member("holder", [ability(DEF.theology, [recipeThrow("recognize", 13)], { cite: "XX p.7" })]);
  const outsider = member("outsider", []);

  const entries = sceneOf(TOKEN.theology);
  const held = layerOptions(entries[0], asMember(holder, tokens), ctxOf(entries, holder, tokens));
  eq([held[0].mode, held[0].target, held[0].refusal, held[1].refusal], ["skill", 13, null, null], "a holder is offered both checks, thrown at their own target");
  const out = layerOptions(entries[0], asMember(outsider, tokens), ctxOf(entries, outsider, tokens));
  eq([out[0].mode, out[0].refusal, out[0].target], ["vague", null, null], "a member without it gets the vague hint at the hasty check, and no throw");
  eq(layerRefusal(entries[0], "methodical", asMember(outsider, tokens), ctxOf(entries, outsider, tokens)), { refusal: REFUSAL.CAPABILITY_MISSING, capability: TOKEN.theology }, "and a refusal naming the capability at the methodical check");

  const ctx = ctxOf(entries, holder, tokens);
  eq(outcomeOf(entries[0], "hasty", asMember(holder, tokens), ctx).code, CODE.NEEDS_ROLL, "a thrown check waits on its throw");
  eq(outcomeOf(entries[0], "hasty", asMember(holder, tokens), ctx, { passed: true }).code, CODE.FOUND, "a pass finds");
  const failed = outcomeOf(entries[0], "hasty", asMember(holder, tokens), ctx, { passed: false });
  eq([failed.code, failed.failed, failed.locks], [CODE.FOUND_NOTHING, true, true], "a failed hasty throw finds nothing and locks");
  const hint = outcomeOf(entries[0], "hasty", asMember(outsider, tokens), ctxOf(entries, outsider, tokens));
  eq(hint.code, CODE.VAGUE, "a member without it is told something more is here");

  // A holder whose ability stores no figure: refused, and the refusal names the page the ability cites.
  const blank = member("blank", [ability(DEF.theology, [], { cite: "XX p.7" })]);
  const blanked = layerOptions(entries[0], asMember(blank, tokens), ctxOf(entries, blank, tokens));
  eq([blanked[0].refusal, blanked[0].data], [REFUSAL.NOT_IMPORTED, { cite: "XX p.7" }], "a holder with no figure cannot be assigned, and the refusal carries the page");
  eq(layerRefusal(entries[0], "hasty", asMember(blank, tokens), ctxOf(entries, blank, tokens)), { refusal: REFUSAL.NOT_IMPORTED, cite: "XX p.7" }, "layerRefusal carries it the same way");
  const hand = member("hand", [handmade("Theology", [])]);
  hand.items[0].flags["acks-extras"].extras.provides = [TOKEN.theology];
  eq(layerOptions(entries[0], asMember(hand, tokens), ctxOf(entries, hand, tokens))[0].data, {}, "a hand-made ability cites no page, and the refusal carries none");
  eq(layerOptions(entries[0], asMember(blank, tokens), { entries, figures: { skillTargets: {}, skillCites: {} } })[0].data, {}, "no page read, no page named");

  // A tool the layer names is still needed.
  const tooled = sceneOf(TOKEN.theology, { tools: ["Item.kit"] });
  eq(layerRefusal(tooled[0], "hasty", asMember(holder, tokens), ctxOf(tooled, holder, tokens)), { refusal: REFUSAL.TOOL_MISSING, missing: ["Item.kit"] }, "a named tool is still required of a holder");

  // Sensing Power: held, no throw.
  const sensor = member("sensor", [ability(DEF.sensing, [], { cite: "XX p.9" })]);
  const sensing = sceneOf(TOKEN.sensing);
  const sensorCtx = ctxOf(sensing, sensor, tokens);
  const made = layerOptions(sensing[0], asMember(sensor, tokens), sensorCtx);
  eq([made[0].mode, made[0].automatic, made[0].target, made[0].refusal, made[1].automatic], ["skill", true, null, null, true], "a holder of a proficiency that prints no throw is offered the check, automatic, with no target");
  const found = outcomeOf(sensing[0], "hasty", asMember(sensor, tokens), sensorCtx);
  eq([found.code, found.clue], [CODE.FOUND, "Found: a detail"], "and it finds without a throw");
  eq(outcomeOf(sensing[0], "methodical", asMember(sensor, tokens), sensorCtx).code, CODE.FOUND, "at the methodical check too");
  const nobody = member("nobody", []);
  const unsensed = layerOptions(sensing[0], asMember(nobody, tokens), ctxOf(sensing, nobody, tokens));
  eq([unsensed[0].mode, unsensed[0].automatic, unsensed[0].refusal], ["vague", false, null], "a member without it is not made automatic: the vague hint");
  eq(layerRefusal(sensing[0], "methodical", asMember(nobody, tokens), ctxOf(sensing, nobody, tokens)).refusal, REFUSAL.CAPABILITY_MISSING, "and refused at the methodical check");
  const sensingTooled = sceneOf(TOKEN.sensing, { tools: ["Item.kit"] });
  eq(layerRefusal(sensingTooled[0], "hasty", asMember(sensor, tokens), ctxOf(sensingTooled, sensor, tokens)).refusal, REFUSAL.TOOL_MISSING, "an automatic check still needs its named tools");

  // A figure the context states always wins over an automatic listing.
  const both = layerOptions(sensing[0], asMember(sensor, tokens), { entries: sensing, figures: { skillTargets: { [TOKEN.sensing]: 16 }, skillAutomatic: [TOKEN.sensing] } })[0];
  eq([both.automatic, both.target], [false, 16], "a stated figure is thrown even where the listing names the skill automatic");

  // An import that gives it a throw makes it an ordinary thrown check.
  const thrown = member("thrown", [ability(DEF.sensing, [recipeThrow("sense", 16)])]);
  const thrownPlan = layerOptions(sensing[0], asMember(thrown, tokens), ctxOf(sensing, thrown, tokens))[0];
  eq([thrownPlan.mode, thrownPlan.automatic, thrownPlan.target], ["skill", false, 16], "a throw the member's own ability stores is rolled, not waived");
  eq(outcomeOf(sensing[0], "hasty", asMember(thrown, tokens), ctxOf(sensing, thrown, tokens)).code, CODE.NEEDS_ROLL, "and waits on it");

  // Any other proficiency with no figure is never waived.
  const quietLore = member("quietLore", [ability(DEF.loremastery, [])]);
  const loreScene = sceneOf(TOKEN.loremastery);
  eq(layerOptions(loreScene[0], asMember(quietLore, tokens), ctxOf(loreScene, quietLore, tokens))[0].refusal, REFUSAL.NOT_IMPORTED, "a holder of any other proficiency with no figure is never made automatic");
}

console.log(`test-scene-lore: ${checks} checks passed`);
