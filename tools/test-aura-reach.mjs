/**
 * The live reach (`aura-reach-logic.mjs`, `aura-reach.mjs`) and the creature
 * kinds it filters on (`actor-read.mjs`), offline: who of the tokens inside an
 * area counts and which clauses answer null, what each moment does, the
 * snapshot's area in pixels, the figure a row names, the raise's verdict and
 * the Region it asks core for, a hand-made behavior doing nothing, the bearer
 * going down, and the row schema carrying a reach no editor offers. Foundry-free
 * with stand-ins; every kind, name and figure below is invented.
 *
 * Usage: node tools/test-aura-reach.mjs
 */
import assert from "node:assert/strict";

const hookCalls = [];
globalThis.Hooks = { once() {}, on() {}, callAll: (...args) => hookCalls.push(args) };
globalThis.foundry = {
  utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj), randomID: () => "rid" },
  applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } } },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.CONST = { REGION_VISIBILITY: { GAMEMASTER: 1 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };

const logic = await import("../scripts/lib/aura-reach-logic.mjs");
const actorRead = await import("../scripts/lib/actor-read.mjs");
const reach = await import("../scripts/lib/aura-reach.mjs");
const constants = await import("../scripts/lib/constants.mjs");
const vocab = await import("../scripts/lib/vocab.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/** A token and its actor, with the flags a filter reads. */
const body = ({ id, kinds = [], group = "", disp = -1, type = "monster" } = {}) => ({
  token: { id, uuid: `T.${id}`, flags: { "acks-extras": group ? { group } : {} }, disposition: disp },
  actor: { type, kinds: new Set(kinds) },
});
const kindsOf = (actor) => actor.kinds;
const enemies = (a, b) => (a.disposition === 0 || b.disposition === 0 ? null : a.disposition !== b.disposition);
const deps = { kindsOf, enemies };
const bearer = body({ id: "b", group: "g1", disp: -1 });

await t("a kinds clause admits a match, refuses a miss, and cannot settle a creature with no kinds", () => {
  const f = { kinds: ["alpha"] };
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["alpha", "beta"] }), f, deps), true);
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["beta"] }), f, deps), false);
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: [] }), f, deps), null, "no kinds is undetermined, never false");
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: [] }), {}, deps), true, "no clause names a kind, so nothing is asked");
});

await t("exceptKinds excludes a match, and answers null where the kinds cannot be told", () => {
  const f = { exceptKinds: ["alpha"] };
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["alpha"] }), f, deps), false);
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["beta"] }), f, deps), true);
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: [] }), f, deps), null);
  const both = { kinds: ["alpha"], exceptKinds: ["beta"] };
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["alpha", "beta"] }), both, deps), false, "a kind in both lists is excluded");
});

await t("a character whose class names no race is null against a race category, and false against another kind", () => {
  const unknown = body({ id: "c", kinds: ["character"], type: "character" });
  assert.equal(logic.reachAdmits(bearer, unknown, { kinds: ["human"] }, deps), null, "unknown category");
  assert.equal(logic.reachAdmits(bearer, unknown, { exceptKinds: ["demi-human"] }, deps), null);
  assert.equal(logic.reachAdmits(bearer, unknown, { kinds: ["alpha"] }, deps), false, "a plain kind it does not have");
  const known = body({ id: "c", kinds: ["character", "dwarf", "demi-human"], type: "character" });
  assert.equal(logic.reachAdmits(bearer, known, { kinds: ["human"] }, deps), false, "a known category that differs");
  assert.equal(logic.reachAdmits(bearer, known, { kinds: ["demi-human"] }, deps), true);
});

await t("side reads dispositions: a neutral or secret token is null", () => {
  const foe = body({ id: "s", disp: 1 });
  const friend = body({ id: "s", disp: -1 });
  const neutral = body({ id: "s", disp: 0 });
  assert.equal(logic.reachAdmits(bearer, foe, { side: "opposing" }, deps), true);
  assert.equal(logic.reachAdmits(bearer, friend, { side: "opposing" }, deps), false);
  assert.equal(logic.reachAdmits(bearer, friend, { side: "own" }, deps), true);
  assert.equal(logic.reachAdmits(bearer, foe, { side: "own" }, deps), false);
  assert.equal(logic.reachAdmits(bearer, neutral, { side: "opposing" }, deps), null);
  assert.equal(logic.reachAdmits(bearer, neutral, { side: "own" }, deps), null);
  assert.equal(logic.reachAdmits(bearer, neutral, { side: "any" }, deps), true);
});

await t("unit own compares groups; under adds the registered ancestry and is null without it", () => {
  const mate = body({ id: "s", group: "g1" });
  const other = body({ id: "s", group: "g2" });
  const loose = body({ id: "s" });
  assert.equal(logic.reachAdmits(bearer, mate, { unit: "own" }, deps), true);
  assert.equal(logic.reachAdmits(bearer, other, { unit: "own" }, deps), false);
  assert.equal(logic.reachAdmits(bearer, loose, { unit: "own" }, deps), false);
  assert.equal(logic.reachAdmits(body({ id: "b" }), mate, { unit: "own" }, deps), null, "a bearer in no group has no unit to share");
  assert.equal(logic.reachAdmits(bearer, mate, { unit: "under" }, deps), true, "an own match holds before anything is registered");
  assert.equal(logic.reachAdmits(bearer, other, { unit: "under" }, deps), null, "any other is undetermined until registered");
  const calls = [];
  logic.registerUnitAncestry((a, b) => (calls.push([a.id, b.id]), b.id === "s" ? true : "no"));
  assert.equal(logic.reachAdmits(bearer, other, { unit: "under" }, deps), true, "the registration answers");
  assert.deepEqual(calls, [["b", "s"]]);
  const character = body({ id: "b", type: "character", kinds: ["character"] });
  assert.equal(logic.reachAdmits(character, other, { unit: "under" }, deps), null, "a character bearer leads no group");
  logic.registerUnitAncestry(() => "maybe");
  assert.equal(logic.reachAdmits(bearer, other, { unit: "under" }, deps), null, "a non-boolean answer is null");
  logic.registerUnitAncestry(null);
  assert.equal(logic.reachAdmits(bearer, other, { unit: "under" }, deps), null);
});

await t("the bearer and a marker token are never subjects; a false wins over a null", () => {
  assert.equal(logic.reachAdmits(bearer, bearer, {}, deps), false);
  assert.equal(logic.reachAdmits(bearer, body({ id: "m" }), {}, { ...deps, isMarker: () => true }), false);
  const f = { kinds: ["alpha"], side: "opposing" };
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["beta"], disp: 0 }), f, deps), false, "a miss beats an unsettled side");
  assert.equal(logic.reachAdmits(bearer, body({ id: "s", kinds: ["alpha"], disp: 0 }), f, deps), null);
});

await t("a pulse takes its own moments: enter alone does not prompt a turn-start pulse, and an exit always takes a standing part off", () => {
  const act = (pulse, moment, admitted = true, immune = false) => logic.pulseAct({ pulse, moment, admitted, immune });
  assert.equal(act("action", "press"), "prompt");
  assert.equal(act("action", "moveIn"), "none");
  assert.equal(act("turnStart+moveIn", "moveIn"), "prompt");
  assert.equal(act("turnStart+moveIn", "turnStart"), "prompt");
  assert.equal(act("turnStart+moveIn", "enter"), "none", "a walk-in fires both events and only one prompts");
  assert.equal(act("turnStart+moveIn", "turnStart", true, true), "skip", "an immune subject is skipped");
  assert.equal(act("standing", "enter"), "on");
  assert.equal(act("standing", "exit", false), "off");
  assert.equal(act("standing", "moveIn"), "none");
  assert.equal(act("burst", "burst"), "prompt");
  assert.equal(act("burst", "burst", null), "undetermined");
  assert.equal(act("burst", "burst", false), "none");
  assert.equal(act("nonsense", "burst"), "none");
});

await t("a hand-made behavior (empty config) reads as none and a handler is never reached", async () => {
  assert.equal(logic.readAuraConfig({}), null);
  assert.equal(logic.readAuraConfig({ sourceUuid: "a", bearerUuid: "b", activationId: "c" }), null, "all four are needed");
  assert.deepEqual(logic.readAuraConfig({ sourceUuid: "a", bearerUuid: "b", activationId: "c", rowKey: "d" }), { sourceUuid: "a", bearerUuid: "b", activationId: "c", rowKey: "d" });
  let reached = 0;
  reach.setReachHandler(() => { reached += 1; });
  await reach.dispatchReachMoment({}, "enter", { id: "x" });
  assert.equal(reached, 0);
  reach.setReachHandler(null);
});

await t("a reach reads only with a known pulse; a filter reads its words lowercase and defaults to any", () => {
  assert.equal(logic.readReach({ pulse: "nope", filter: {} }), null);
  assert.equal(logic.readReach(null), null);
  const r = logic.readReach({ pulse: "standing", radius: { value: "5" }, filter: { kinds: [" Alpha "], side: "weird", unit: "own" } });
  assert.deepEqual(r.filter, { kinds: ["alpha"], exceptKinds: [], side: "any", unit: "own" });
});

await t("the snapshot's radius is in pixels: range times the scene's pixels per unit, never the range", () => {
  const dims = { distance: 5, distancePixels: 20 };
  const bearerSource = { x: 100, y: 200, width: 1, height: 1, shape: 4, elevation: 0, depth: 1, level: "L1" };
  const made = logic.snapshotRegionData({ token: bearerSource }, 30, dims);
  assert.equal(made.ok, true);
  assert.equal(made.data.shapes[0].type, "emanation");
  assert.equal(made.data.shapes[0].radius, 600, "30 units at 20 pixels each");
  assert.equal(made.data.shapes[0].gridBased, true);
  assert.equal(made.data.shapes[0].base.type, "token");
  assert.equal(made.data.shapes[0].base.hole, false);
  assert.deepEqual(made.data.elevation, { bottom: -30, top: 35 });
  assert.deepEqual(made.data.levels, ["L1"]);
  const point = logic.snapshotRegionData({ point: { x: 10, y: 20, elevation: 5 } }, 10, dims);
  assert.deepEqual(point.data.shapes[0], { type: "circle", x: 10, y: 20, radius: 200 });
  assert.deepEqual(logic.snapshotRegionData({ token: bearerSource }, 0, dims), { ok: false, reason: "range" });
  assert.deepEqual(logic.snapshotRegionData({ token: bearerSource }, 5, {}), { ok: false, reason: "scale" });
  assert.deepEqual(logic.snapshotRegionData({}, 5, dims), { ok: false, reason: "centre" });
});

await t("a figure resolves from its own value, else live from the table, else to nothing", () => {
  const read = (doc, table, row, figure) => (doc === "d" && table === "t" && row === "r" ? { f: 12, dice: "1d4", blank: "" }[figure] : undefined);
  const ref = (extra) => ({ doc: "d", table: "t", row: "r", figure: "f", ...extra });
  assert.equal(logic.resolveFigure(ref({ value: "40" }), read), "40", "its own value wins");
  assert.equal(logic.resolveFigure(ref({ value: "" }), read), 12, "a blank value reads the table");
  assert.equal(logic.resolveFigure(ref({ figure: "dice" }), read), "1d4", "text stays text");
  assert.equal(logic.figureNumber(ref(), read), 12);
  assert.equal(logic.figureNumber(ref({ figure: "dice" }), read), null, "a formula is no number");
  assert.equal(logic.resolveFigure(ref({ figure: "blank" }), read), null);
  assert.equal(logic.resolveFigure(ref({ figure: "absent" }), read), null);
  assert.equal(logic.resolveFigure(ref({ row: "" }), read), null, "an incomplete reference names nothing");
  assert.equal(logic.resolveFigure(null, read), null);
  assert.equal(logic.resolveFigure(ref(), () => undefined), null, "with nothing imported the figure stays blank");
});

await t("a raise is refused without core's features, a token, an owner, a carrier or a radius; a downed bearer blocks a Player and warns a Judge", () => {
  const world = { supported: true, found: true, ownerIds: ["u1"], carries: true, down: false, rangeFeet: 30 };
  const run = (req, over = {}) => logic.checkRaise(req, { ...world, ...over });
  assert.deepEqual(run({}), { ok: true, rangeFeet: 30 });
  assert.equal(run({}, { supported: false }).reason, "unsupported");
  assert.equal(run({}, { found: false }).reason, "gone");
  assert.equal(run({ requestUserId: "u2" }).reason, "notOwner");
  assert.equal(run({ requestUserId: "u1" }).ok, true);
  assert.equal(run({}, { carries: false }).reason, "notCarried");
  for (const blank of [null, "", 0, -3, "x"]) assert.equal(run({}, { rangeFeet: blank }).reason, "noRange", `radius ${JSON.stringify(blank)}`);
  assert.equal(run({ requestUserId: "u1" }, { down: true }).reason, "down");
  assert.deepEqual(run({}, { down: true }), { ok: true, rangeFeet: 30, warn: ["down"] });
});

await t("a bearer is down at zero hit points or on the defeated status, hit points first", () => {
  assert.equal(logic.downCause({ hp: 0, defeated: false }), "hp");
  assert.equal(logic.downCause({ hp: -2, defeated: true }), "hp");
  assert.equal(logic.downCause({ hp: 3, defeated: true }), "defeated");
  assert.equal(logic.downCause({ hp: 3, defeated: false }), null);
  assert.equal(logic.downCause({ hp: null, defeated: false }), null, "unknown hit points are not down");
});

await t("the build check names each missing core feature", () => {
  assert.deepEqual(reach.auraSupport({ attachment: true, emanation: true, creator: true }), { ok: true, missing: [] });
  assert.deepEqual(reach.auraSupport({ attachment: false, emanation: true, creator: false }).missing, ["attachment.token", "createTokenEmanation"]);
  assert.equal(reach.auraSupport({ attachment: true, emanation: false, creator: true }).ok, false);
});

await t("raising asks core for a grid-based emanation in feet, hidden as the token is, GM-visible, holding the behavior", async () => {
  const asked = [];
  const token = { uuid: "T.1", id: "1", hidden: true, actor: { uuid: "A.1" }, testUserPermission: () => true };
  const item = { uuid: "I.1", name: "Gear", actor: token.actor, type: "item", flags: { "acks-extras": { itemRun: { rows: [{ key: "k", reach: { pulse: "standing", radius: { value: "30" } } }] } } } };
  globalThis.fromUuidSync = (uuid) => (uuid === "T.1" ? token : uuid === "I.1" ? item : null);
  globalThis.CONFIG = {
    Region: {
      documentClass: {
        schema: { fields: { attachment: { fields: { token: {} } } } },
        createTokenEmanation: async (...args) => { asked.push(args); return { id: "R1", uuid: "S.R1" }; },
      },
    },
    specialStatusEffects: {},
  };
  globalThis.foundry.data = { EmanationShapeData: class {} };
  const made = await reach.raiseReach({ tokenUuid: "T.1", sourceUuid: "I.1", rowKey: "k", activationId: "act" });
  assert.equal(made.ok, true);
  const [tok, range, data, options] = asked[0];
  assert.equal(tok, token);
  assert.equal(range, 30, "feet: core multiplies by the scene's pixels per unit");
  assert.equal(data.hidden, true);
  assert.equal(data.visibility, 1);
  assert.deepEqual(data.behaviors, [{ type: constants.AURA_BEHAVIOR_TYPE, name: "Gear", system: { sourceUuid: "I.1", bearerUuid: "A.1", activationId: "act", rowKey: "k" } }]);
  assert.deepEqual(options, { gridBased: true });
  const refused = await reach.raiseReach({ tokenUuid: "T.1", sourceUuid: "I.1", rowKey: "none", activationId: "act" });
  assert.equal(refused.ok, false, "a row naming no reach raises nothing");
  assert.equal(asked.length, 1);
});

/** A region with behaviors, deleting itself into a list. */
const deleted = [];
const regionOf = (id, types) => ({ id, behaviors: types.map((type) => ({ type, system: {} })), delete: async () => deleted.push(id) });

await t("a bearer at zero hit points loses its reaches and fires the hook; one on the defeated status too; a standing one does not", async () => {
  const aura = constants.AURA_BEHAVIOR_TYPE;
  const mk = (hp, statuses = []) => ({
    uuid: "T.9", actorLink: true, baseActor: { system: { hp: { value: hp, max: 9 } }, statuses: new Set(statuses) },
    attachments: { regions: new Set([regionOf("r1", [aura]), regionOf("r2", ["other"]), regionOf("r3", [aura])]) },
  });
  const run = async (token) => {
    deleted.length = 0;
    hookCalls.length = 0;
    const out = await reach.lowerForBearer({ isToken: false, getDependentTokens: () => [token] });
    return { out, deleted: [...deleted], hooks: hookCalls.map(([name, tok, info]) => [name, tok.uuid, info.cause]) };
  };
  const down = await run(mk(0));
  assert.deepEqual(down.deleted, ["r1", "r3"], "only the aura regions");
  assert.deepEqual(down.hooks, [[constants.BEARER_DOWN_HOOK, "T.9", "hp"]]);
  const defeated = await run(mk(4, ["dead"]));
  assert.equal(defeated.hooks[0][2], "defeated");
  assert.deepEqual(defeated.deleted, ["r1", "r3"]);
  const standing = await run(mk(4));
  assert.deepEqual(standing, { out: [], deleted: [], hooks: [] });
});

await t("a snapshot tests every non-marker token but the centre against an unsaved Region, and never throws", () => {
  const inside = new Set(["b", "n", "m"]);
  const tok = (id, marker = false) => ({ id, name: id, actor: { documentName: "Actor", type: marker ? "acks-extras.faction" : "monster" }, testInsideRegion: (region) => inside.has(id) && region.name === "reach" });
  const centre = tok("c");
  const scene = { dimensions: { distance: 5, distancePixels: 10 }, tokens: [centre, tok("b"), tok("n"), tok("z"), tok("m", true)] };
  centre._source = { x: 0, y: 0, width: 1, height: 1, shape: 4 };
  globalThis.CONFIG.Region.documentClass = class { constructor(data, options) { this.name = data.name; this.data = data; this.options = options; } };
  const found = reach.reachSnapshot(scene, { token: centre }, 20);
  assert.equal(found.ok, true);
  assert.deepEqual(found.tokens.map((x) => x.id), ["b", "n"], "inside, but not the centre and not a marker");
  const empty = reach.reachSnapshot(scene, { point: { x: 1, y: 1 } }, 20);
  assert.equal(empty.ok, true);
  globalThis.CONFIG.Region.documentClass = class { constructor() { throw new Error("no"); } };
  const origError = console.error;
  console.error = () => {};
  assert.deepEqual(reach.reachSnapshot(scene, { token: centre }, 20), { ok: false, reason: "snapshot" });
  console.error = origError;
  assert.equal(reach.reachSnapshot(scene, { token: centre }, 0).ok, false);
});

await t("creature kinds read a character's race and its category, and a monster's subtype split on commas", () => {
  const actor = (type, extras, cls = "") => ({ type, system: { details: { class: cls } }, getFlag: (scope, key) => (key === "extras" ? extras : undefined) });
  actorRead.registerCharacterRace(null);
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Fighter"))], ["character"], "no registration, no race");
  actorRead.registerCharacterRace((name) => ({ axeman: "dwarf", wanderer: "human", oddity: "people9" })[name.toLowerCase()] ?? null);
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Axeman"))], ["character", "dwarf", "demi-human"]);
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Wanderer"))], ["character", "human", "human"].filter((x, i, a) => a.indexOf(x) === i));
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Oddity"))], ["character", "people9"], "a race outside both sets has no category");
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Unknown"))], ["character"]);
  assert.deepEqual([...actorRead.creatureKinds(actor("monster", { types: ["Alpha"], subtype: "Beta Kind, Gamma_x ,  " }))], ["alpha", "beta-kind", "gamma-x"]);
  assert.deepEqual([...actorRead.creatureKinds(actor("monster", { types: ["undead"] }))], ["undead", "enchanted"]);
  actorRead.registerCharacterRace(() => { throw new Error("x"); });
  assert.deepEqual([...actorRead.creatureKinds(actor("character", undefined, "Axeman"))], ["character"], "a throwing reader is no race");
  actorRead.registerCharacterRace(null);
  assert.equal(actorRead.raceCategoryOf("Elf"), "demi-human");
  assert.equal(actorRead.raceCategoryOf("people2"), "human");
  assert.equal(actorRead.raceCategoryOf("other"), null);
  assert.equal(actorRead.kindToken(" Demi Human_x! "), "demi-human-x");
});

/* --- the row schema: a reach no editor offers --- */
class Field {
  constructor(options = {}) { this.options = options; }
}
class Schema extends Field {
  constructor(fields, options) { super(options); this.fields = fields; }
}
class List extends Field {
  constructor(element, options) { super(options); this.element = element; }
}
globalThis.foundry.data = { fields: { SchemaField: Schema, ArrayField: List, StringField: Field, NumberField: Field, BooleanField: Field, SetField: Field, HTMLField: Field } };
globalThis.game.i18n = { format: (key) => key, localize: (key) => key };
const { effectField } = await import("../scripts/lib/fields.mjs");
const editor = await import("../scripts/lib/apps/effect-row-editor.mjs");

await t("effectField carries a nullable reach of radius, filter and pulse, empty by default, so a row cleaned without one stays without", () => {
  const field = effectField().fields.reach;
  assert.ok(field instanceof Schema);
  assert.equal(field.options.nullable, true);
  assert.equal(field.options.initial, null);
  assert.equal(field.options.required, false);
  assert.deepEqual(Object.keys(field.fields).sort(), ["filter", "pulse", "radius"]);
  assert.deepEqual(Object.keys(field.fields.radius.fields).sort(), ["doc", "figure", "row", "table", "value"]);
  assert.deepEqual(Object.keys(field.fields.filter.fields).sort(), ["exceptKinds", "kinds", "side", "unit"]);
  assert.equal(field.fields.filter.fields.side.options.initial, "any");
});

await t("no editor field list offers reach, for any type in any domain, and an edit keeps a stored one", () => {
  const types = Object.keys(vocab.EFFECT_TYPES);
  assert.ok(types.length > 30);
  for (const domain of ["spell", "ability", "gear", "domain", undefined]) {
    for (const type of types) {
      const fields = editor.fieldsForType(type, domain);
      assert.ok(!fields.some((name) => name === "reach" || name.startsWith("reach.")), `${type} in ${domain} offers no reach`);
    }
  }
  const stored = { type: "modifier", key: "k", reach: { pulse: "standing", radius: { value: "5" }, filter: { kinds: ["alpha"] } } };
  assert.deepEqual(editor.mergeRowEdit(stored, { note: "x" }).reach, stored.reach, "an edit that never names reach keeps it");
  assert.equal(editor.mergeRowEdit({ type: "modifier" }, { note: "x" }).reach, undefined, "a row with none stays without");
});

await t("the vocabularies hold exactly the keys the logic reads", () => {
  assert.deepEqual(Object.keys(vocab.REACH_PULSES), ["action", "turnStart+moveIn", "standing", "burst"]);
  assert.deepEqual(Object.keys(vocab.REACH_SIDES), ["any", "own", "opposing"]);
  assert.deepEqual(Object.keys(vocab.REACH_UNITS), ["any", "own", "under"]);
  assert.deepEqual(Object.keys(vocab.ITEM_RUN_ACTIVATIONS), ["once", "toggle", "fuse", "consume"]);
  assert.equal(constants.AURA_BEHAVIOR_TYPE, "acks-extras.aura");
});

console.log(`\ntest-aura-reach: ${passed} checks passed.`);
