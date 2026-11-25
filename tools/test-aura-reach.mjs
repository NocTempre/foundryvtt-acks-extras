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
globalThis.CONST = { REGION_VISIBILITY: { GAMEMASTER: 1, ALWAYS: 2 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };

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

await t("a moment's key is combat, round, turn, subject and kind inside a fight, and subject and kind outside one", () => {
  const base = { combatId: "c1", round: 2, turn: 3, subjectUuid: "T.s", kindKey: "k" };
  assert.equal(logic.momentKey(base), "c1:2:3:T.s:k");
  assert.notEqual(logic.momentKey(base), logic.momentKey({ ...base, turn: 4 }), "another initiative is another prompt");
  assert.notEqual(logic.momentKey(base), logic.momentKey({ ...base, round: 3 }), "another round is another prompt");
  assert.notEqual(logic.momentKey(base), logic.momentKey({ ...base, kindKey: "j" }), "another item kind is another prompt");
  assert.notEqual(logic.momentKey(base), logic.momentKey({ ...base, subjectUuid: "T.u" }));
  assert.equal(logic.momentKey({ ...base, combatId: null }), "T.s:k", "no fight: the subject and the kind");
  assert.equal(logic.momentKey({ ...base, combatId: "" }), "T.s:k");
  assert.equal(logic.momentKey({ subjectUuid: "T.s", kindKey: "k" }), "T.s:k");
  assert.equal(logic.momentKey({ ...base, round: 0, turn: 0 }), "c1:0:0:T.s:k", "round and turn zero are kept");
  assert.equal(logic.momentKey({ ...base, subjectUuid: "" }), null);
  assert.equal(logic.momentKey({ ...base, kindKey: "  " }), null);
  assert.equal(logic.momentKey(), null);
});

await t("a printed qualifier resolves onto the closed kind keys, plurals generated from those keys alone, and nothing else becomes a key", () => {
  const types = ["gamma", "warman"];
  const match = (text, given = types) => actorRead.matchKinds(text, given);
  assert.deepEqual(match("gamma"), { kinds: ["gamma"], unresolved: [] }, "the key");
  assert.deepEqual(match("Gammas"), { kinds: ["gamma"], unresolved: [] }, "the key and s, folded");
  assert.deepEqual(match("gammaes").kinds, ["gamma"], "the key and es");
  assert.deepEqual(match("warmen").kinds, ["warman"], "the men plural of a key on the man stem");
  assert.deepEqual(match("humans").kinds, ["human"], "a race category the module holds");
  assert.deepEqual(match("Demi-Humans").kinds, ["demi-human"]);
  assert.deepEqual(match("dwarfs").kinds, ["dwarf"], "a race key of the closed sets");
  assert.deepEqual(match("people1s").kinds, ["people1"]);
  assert.deepEqual(match("dwarves"), { kinds: [], unresolved: ["dwarves"] }, "an irregular plural is no generated form, and no singularizer runs on the page's word");
  assert.deepEqual(match("gammaren"), { kinds: [], unresolved: ["gammaren"] });
  assert.deepEqual(match("gammas", []), { kinds: [], unresolved: ["gammas"] }, "a type the consumer did not pass is no key");
  assert.deepEqual(match("gamma, humans or demi-humans and gammas"), { kinds: ["gamma", "human", "demi-human"], unresolved: [] }, "split on commas, or and and, none twice, in the text's order");
  assert.deepEqual(match("warmen, zeta and gamma"), { kinds: ["warman", "gamma"], unresolved: ["zeta"] }, "an unresolved part is listed and the rest still resolve");
  assert.deepEqual(match("sorcerers or gammas", [...types, "sorcerer"]).kinds, ["sorcerer", "gamma"], "or inside a word splits nothing");
  assert.deepEqual(match("candor", [...types, "can"]), { kinds: [], unresolved: ["candor"] });
  assert.deepEqual(match(""), { kinds: [], unresolved: [] });
  assert.deepEqual(match(null), { kinds: [], unresolved: [] });
  assert.deepEqual(actorRead.matchKinds("gammas", new Set(types)).kinds, ["gamma"], "any iterable of keys");
  assert.deepEqual(actorRead.matchKinds("humans").kinds, ["human"], "no types passed: the race keys alone");
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

await t("a reach's own list of rolls keeps the roll keys and morale and drops any other word, and its Region is shown to everyone only where the row says so", () => {
  const { ROLL_MODS_ON, REACH_ON } = vocab;
  assert.deepEqual([...REACH_ON], [...ROLL_MODS_ON, "morale"], "the roll keys and morale, nothing else");
  assert.deepEqual(logic.readReach({ pulse: "standing", on: ["ac", " Morale ", "bogus", "attack", ""] }).on, ["ac", "morale", "attack"]);
  assert.deepEqual(logic.readReach({ pulse: "standing", on: "ac" }).on, [], "a stored value that is no list names no roll");
  assert.equal(logic.readReach({ pulse: "standing" }).showReach, false, "shown to the Judge alone by default");
  assert.equal(logic.readReach({ pulse: "standing", showReach: true }).showReach, true);
  assert.equal(logic.readReach({ pulse: "standing", showReach: "true" }).showReach, false, "only the boolean counts");
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
  item.flags["acks-extras"].itemRun.rows.push({ key: "shown", reach: { pulse: "standing", radius: { value: "30" }, showReach: true } });
  await reach.raiseReach({ tokenUuid: "T.1", sourceUuid: "I.1", rowKey: "shown", activationId: "act" });
  assert.equal(asked[1][2].visibility, 2, "a row that shows its reach draws the Region for everyone");
  assert.equal(asked[0][2].visibility, 1, "a row that does not keeps it the Judge's");
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
  assert.deepEqual(Object.keys(field.fields).sort(), ["filter", "immunity", "modifier", "on", "pulse", "radius", "save", "showReach"]);
  assert.equal(field.fields.showReach.options.initial, false, "a Region is the Judge's alone unless a row says otherwise");
  for (const key of ["save", "immunity", "modifier"]) assert.deepEqual(Object.keys(field.fields[key].fields).sort(), ["doc", "figure", "row", "table", "value"], `${key} is a figure reference`);
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

/* --- the pure half, pinned where a clause could be dropped unseen --- */

await t("a figure's own value is trimmed, a missing part of its reference names nothing, and the default read goes to the registry", async () => {
  const any = () => 12;
  const ref = (extra) => ({ doc: "d", table: "t", row: "r", figure: "f", ...extra });
  assert.equal(logic.resolveFigure(ref({ value: "  40 " }), any), "40", "the own value is trimmed");
  assert.equal(logic.resolveFigure(ref({ value: "   " }), any), 12, "a value of spaces is blank");
  for (const part of ["doc", "table", "row", "figure"]) assert.equal(logic.resolveFigure(ref({ [part]: "" }), any), null, `no ${part}, no read`);
  const tables = await import("../scripts/lib/tables.mjs");
  tables.registerTable({ id: "fixture.fig", tables: { grid: { rowA: { size: 7 } } } });
  try {
    assert.equal(logic.resolveFigure({ doc: "fixture.fig", table: "grid", row: "rowA", figure: "size" }), 7, "the registry's table, row and figure in that order");
    assert.equal(logic.resolveFigure({ doc: "fixture.fig", table: "rowA", row: "grid", figure: "size" }), null, "the path is not interchangeable");
    assert.equal(logic.resolveFigure({ doc: "fixture.none", table: "grid", row: "rowA", figure: "size" }), null, "an unregistered document is blank, never a throw");
  } finally {
    tables.unregisterTable("fixture.fig");
  }
});

await t("a stored filter and config read as written: sets and blanks, a stranger unit, a radius kept, a config trimmed", () => {
  assert.deepEqual(logic.readFilter({ kinds: new Set(["A", " "]), exceptKinds: ["", "B "], unit: "stranger", side: "opposing" }), { kinds: ["a"], exceptKinds: ["b"], side: "opposing", unit: "any" });
  assert.deepEqual(logic.readFilter(null), { kinds: [], exceptKinds: [], side: "any", unit: "any" });
  assert.deepEqual(logic.readReach({ pulse: "burst", radius: { value: "5" } }).radius, { value: "5" });
  assert.equal(logic.readReach({ pulse: "burst" }).radius, null);
  assert.equal(logic.readAuraConfig({ sourceUuid: "a", bearerUuid: "b", activationId: "c", rowKey: "   " }), null, "spaces are no row key");
  assert.deepEqual(logic.readAuraConfig({ sourceUuid: " a ", bearerUuid: "b", activationId: "c", rowKey: "d" }).sourceUuid, "a");
});

await t("a kinds clause tells a monster from a character, matches any of its names, and reads a token's group and identity from either shape", () => {
  const mon = body({ id: "s", kinds: ["alpha"] });
  assert.equal(logic.reachAdmits(bearer, mon, { kinds: ["human"] }, deps), false, "a monster against a race category is a plain miss");
  assert.equal(logic.reachAdmits(bearer, mon, { kinds: ["zeta", "alpha"] }, deps), true, "any of the names");
  assert.equal(logic.reachAdmits(bearer, mon, { exceptKinds: ["zeta", "alpha"] }, deps), false);
  const viaGetFlag = (id, group) => ({ token: { id, uuid: `T.${id}`, getFlag: () => group, flags: {} }, actor: { type: "monster", kinds: new Set(["alpha"]) } });
  assert.equal(logic.reachAdmits(viaGetFlag("b", "g1"), viaGetFlag("s", "g1"), { unit: "own" }, deps), true, "a token document's own getFlag");
  assert.equal(logic.reachAdmits(viaGetFlag("b", "g1"), viaGetFlag("s", "g2"), { unit: "own" }, deps), false);
  const twin = { ...bearer, token: { ...bearer.token } };
  assert.equal(logic.reachAdmits(bearer, twin, {}, deps), false, "the same uuid on another object is the bearer");
  const bare = (uuid) => ({ token: { uuid, flags: {} }, actor: { type: "monster", kinds: new Set(["alpha"]) } });
  assert.equal(logic.reachAdmits(bare("T.x"), bare("T.x"), {}, deps), false, "a uuid alone names a token");
  assert.equal(logic.reachAdmits(bare("T.x"), bare("T.y"), {}, deps), true);
  const plain = (id, parent) => ({ token: { id, parent, flags: {} }, actor: { type: "monster", kinds: new Set(["alpha"]) } });
  const sceneA = {};
  const sceneB = {};
  assert.equal(logic.reachAdmits(plain("x", sceneA), plain("x", sceneA), {}, deps), false, "one id in one scene is one token");
  assert.equal(logic.reachAdmits(plain("x", sceneA), plain("x", sceneB), {}, deps), true, "the same id in another scene is another token");
});

await t("a unit registration that answers false answers false, and a side with no answer is null whether it says null or nothing", () => {
  const other = body({ id: "s", group: "g2" });
  logic.registerUnitAncestry(() => false);
  assert.equal(logic.reachAdmits(bearer, other, { unit: "under" }, deps), false);
  logic.registerUnitAncestry(null);
  const silent = { kindsOf, enemies: () => undefined };
  assert.equal(logic.reachAdmits(bearer, body({ id: "s" }), { side: "opposing" }, silent), null);
});

await t("with the defaults, a neutral or secret token is a null side, and the kinds read the real creature", () => {
  const monster = (id, disp, types) => ({
    token: { id, uuid: `T.${id}`, flags: { "acks-extras": {} }, disposition: disp },
    actor: { type: "monster", system: { details: { class: "" } }, getFlag: () => (types ? { types } : undefined) },
  });
  const me = monster("me", -1, ["beta"]);
  assert.equal(logic.reachAdmits(me, monster("a", 1, ["alpha"]), { side: "opposing", kinds: ["alpha"] }), true);
  assert.equal(logic.reachAdmits(me, monster("a", -1, ["alpha"]), { side: "opposing" }), false);
  assert.equal(logic.reachAdmits(me, monster("a", 0, ["alpha"]), { side: "opposing" }), null, "neutral");
  assert.equal(logic.reachAdmits(me, monster("a", -2, ["alpha"]), { side: "own" }), null, "secret");
  assert.equal(logic.reachAdmits(me, monster("a", 1, ["alpha"]), { kinds: ["beta"] }), false, "its own kinds");
  assert.equal(logic.reachAdmits(me, monster("a", 1, undefined), { kinds: ["beta"] }), null, "no kinds at all");
});

await t("a pulse's act holds at the edges: nothing given, a truthy non-true, an immune subject by pulse, and an exit with no verdict", () => {
  assert.equal(logic.pulseAct({ pulse: "burst", moment: "burst" }), "undetermined", "no verdict is undetermined");
  assert.equal(logic.pulseAct({ pulse: "burst", moment: "burst", admitted: 1 }), "none", "only true admits");
  assert.equal(logic.pulseAct({ pulse: "burst", moment: "burst", admitted: true }), "prompt", "immune is off unless said");
  for (const pulse of ["action", "turnStart+moveIn", "burst"]) {
    const moment = { action: "press", "turnStart+moveIn": "turnStart", burst: "burst" }[pulse];
    assert.equal(logic.pulseAct({ pulse, moment, admitted: true, immune: true }), "skip", `${pulse} skips an immune subject`);
  }
  assert.equal(logic.pulseAct({ pulse: "standing", moment: "enter", admitted: true, immune: true }), "on", "a standing part is not an immunity's to skip");
  assert.equal(logic.pulseAct({ pulse: "standing", moment: "exit", admitted: null }), "off", "an exit takes the part off whatever the filter says");
  assert.equal(logic.pulseAct({ pulse: "standing", moment: "exit", admitted: true }), "off");
  assert.equal(logic.pulseAct({ pulse: "action", moment: "exit", admitted: false }), "none", "only a standing pulse has an exit");
  assert.equal(logic.pulseAct({ pulse: "standing", moment: "enter", admitted: null }), "undetermined");
});

await t("the snapshot's area carries the token's elevation and level, a point's elevation and level, and refuses a point with no x or y or a scene with no scale", () => {
  const dims = { distance: 5, distancePixels: 20 };
  const high = logic.snapshotRegionData({ token: { x: 0, y: 0, width: 1, height: 1, shape: 4, elevation: 10, depth: 2 } }, 10, dims);
  assert.deepEqual(high.data.elevation, { bottom: 0, top: 30 }, "10 up, two squares of 5 tall, 10 either way");
  assert.deepEqual(high.data.levels, [], "no level, none named");
  const point = logic.snapshotRegionData({ point: { x: 1, y: 2, elevation: 8, level: "L2" } }, 10, dims);
  assert.deepEqual(point.data.elevation, { bottom: -2, top: 18 });
  assert.deepEqual(point.data.levels, ["L2"]);
  assert.deepEqual(logic.snapshotRegionData({ point: { x: 1, y: 2 } }, 10, dims).data.levels, []);
  assert.deepEqual(logic.snapshotRegionData({ point: { x: 1 } }, 10, dims), { ok: false, reason: "centre" });
  assert.deepEqual(logic.snapshotRegionData({ point: { y: 1 } }, 10, dims), { ok: false, reason: "centre" });
  assert.deepEqual(logic.snapshotRegionData({ point: { x: 1, y: 1 } }, 10, { distancePixels: 0 }), { ok: false, reason: "scale" });
  assert.equal(logic.snapshotRegionData({ token: { x: 0, y: 0, shape: 4, level: "L3" } }, 10, dims).data.levels[0], "L3");
});

await t("a Player's raise with no owners listed is refused, never thrown, and a bearer at no hit points and defeated reads defeated when its points are unknown", () => {
  assert.equal(logic.checkRaise({ requestUserId: "u1" }, { supported: true, found: true, carries: true, rangeFeet: 10 }).reason, "notOwner");
  assert.equal(logic.downCause({ hp: null, defeated: true }), "defeated");
});

/* --- the Foundry half: the behavior, a moment, the listeners and the lowering --- */
const AURA = constants.AURA_BEHAVIOR_TYPE;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const seat = (primaryGM) => { globalThis.game.users.activeGM = primaryGM ? { isSelf: true } : undefined; };
const quiet = async (fn) => {
  const prior = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try { await fn(); } finally { console.error = prior; }
  return lines;
};
const monsterActor = (types, type = "monster") => ({ documentName: "Actor", type, system: { details: { class: "" } }, getFlag: () => (types ? { types } : undefined) });
const tokenOf = (id, types, over = {}) => ({ id, uuid: `T.${id}`, name: `Tok ${id}`, flags: { "acks-extras": {} }, disposition: -1, actor: monsterActor(types), ...over });
const bearerTok = tokenOf("bt", undefined, { disposition: 1 });
const cfg = { sourceUuid: "I.9", bearerUuid: "A.1", activationId: "act1", rowKey: "k" };
const reachRow = (over = {}) => ({ key: "k", reach: { pulse: "standing", radius: { value: "20" }, filter: { kinds: ["alpha"] }, ...over } });
let currentItem = { uuid: "I.9", name: "Charm", type: "item", flags: { "acks-extras": { itemRun: { rows: [reachRow()] } } } };
globalThis.fromUuidSync = (uuid) => (uuid === "I.9" ? currentItem : uuid === bearerTok.uuid ? bearerTok : null);
const scene = { tokens: { get: (id) => (id === "bt" ? bearerTok : null) }, regions: [] };
const holder = { id: "R9", hidden: false, parent: scene, attachment: { token: "bt" }, behaviors: [] };
const sys = (over = {}) => ({ ...cfg, region: holder, ...over });

await t("the aura behavior registers its type, its icon and its four config fields, and core's three events become enter, moveIn and exit for the primary GM alone", async () => {
  const saved = { data: globalThis.foundry.data, config: globalThis.CONFIG, events: globalThis.CONST.REGION_EVENTS };
  class Str { constructor(options) { this.options = options; } }
  globalThis.CONST.REGION_EVENTS = { TOKEN_ENTER: "evEnter", TOKEN_MOVE_IN: "evMoveIn", TOKEN_EXIT: "evExit", TOKEN_MOVE_OUT: "evMoveOut" };
  globalThis.foundry.data = { regionBehaviors: { RegionBehaviorType: class {} }, fields: { StringField: Str } };
  globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
  const seen = [];
  try {
    reach.registerAuraReach();
    const Model = globalThis.CONFIG.RegionBehavior.dataModels[AURA];
    assert.equal(typeof Model, "function");
    assert.equal(globalThis.CONFIG.RegionBehavior.typeIcons[AURA], "fa-solid fa-circle-dot");
    assert.deepEqual(Object.keys(Model.defineSchema()).sort(), ["activationId", "bearerUuid", "rowKey", "sourceUuid"]);
    assert.deepEqual(Object.keys(Model.events).sort(), ["evEnter", "evExit", "evMoveIn"], "tokenMoveOut is not heard");
    const walker = tokenOf("w", ["alpha"]);
    holder.behaviors = [];
    reach.setReachHandler((ctx) => { seen.push([ctx.moment, ctx.subject.token.id]); });
    seat(true);
    for (const [event, moment] of [["evEnter", "enter"], ["evMoveIn", "moveIn"], ["evExit", "exit"]]) {
      seen.length = 0;
      await Model.events[event].call(sys(), { data: { token: walker } });
      assert.deepEqual(seen, [[moment, "w"]], `${event} is ${moment}`);
    }
    seat(false);
    seen.length = 0;
    await Model.events.evEnter.call(sys(), { data: { token: walker } });
    assert.deepEqual(seen, [], "a window that is not the primary GM's does nothing");
    globalThis.CONFIG = { RegionBehavior: { dataModels: null } };
    reach.registerAuraReach();
    globalThis.CONFIG = {};
    reach.registerAuraReach();
  } finally {
    reach.setReachHandler(null);
    seat(false);
    globalThis.foundry.data = saved.data;
    globalThis.CONFIG = saved.config;
    globalThis.CONST.REGION_EVENTS = saved.events;
  }
});

await t("a moment reaches the one handler with the config, item, row, reach, bearer, subject, verdict and region, and anything unreadable reaches nothing", async () => {
  const got = [];
  reach.setReachHandler((ctx) => { got.push(ctx); });
  try {
    const walker = tokenOf("w", ["alpha"]);
    await reach.dispatchReachMoment(sys(), "enter", walker);
    assert.equal(got.length, 1);
    const [ctx] = got;
    assert.equal(ctx.moment, "enter");
    assert.deepEqual(ctx.config, cfg);
    assert.equal(ctx.item, currentItem);
    assert.equal(ctx.row.key, "k");
    assert.equal(ctx.reach.pulse, "standing");
    assert.equal(ctx.bearer.token, bearerTok);
    assert.equal(ctx.subject.token, walker);
    assert.equal(ctx.admitted, true);
    assert.equal(ctx.region, holder);
    got.length = 0;
    await reach.dispatchReachMoment(sys(), "enter", tokenOf("w", ["beta"]));
    assert.equal(got[0].admitted, false, "a kind the filter does not name");
    await reach.dispatchReachMoment(sys(), "enter", tokenOf("w", ["alpha"], { actor: monsterActor(["alpha"], "acks-extras.faction") }));
    assert.equal(got.at(-1).admitted, false, "a marker token is never a subject");
    got.length = 0;
    await reach.dispatchReachMoment({ ...cfg, parent: { region: holder } }, "exit", walker);
    assert.equal(got.length, 1, "a behavior reaches its Region through its parent as well");
    got.length = 0;
    await reach.dispatchReachMoment({ ...cfg }, "enter", walker);
    await reach.dispatchReachMoment(sys({ rowKey: "gone" }), "enter", walker);
    await reach.dispatchReachMoment(sys({ sourceUuid: "I.none" }), "enter", walker);
    await reach.dispatchReachMoment(sys(), "enter", null);
    await reach.dispatchReachMoment({ ...sys(), region: { ...holder, attachment: { token: "absent" } } }, "enter", walker);
    currentItem = { ...currentItem, flags: { "acks-extras": { itemRun: { rows: [{ key: "k", reach: { pulse: "nope" } }] } } } };
    await reach.dispatchReachMoment(sys(), "enter", walker);
    currentItem = { ...currentItem, flags: { "acks-extras": { itemRun: { rows: [{ key: "k" }] } } } };
    await reach.dispatchReachMoment(sys(), "enter", walker);
    assert.equal(got.length, 0, "no region, no row, no reach, no source, no subject: nothing is handed on");
    currentItem = { uuid: "I.9", name: "Charm", type: "item", flags: { "acks-extras": { itemRun: { rows: [reachRow()] } } } };
    reach.setReachHandler(() => { throw new Error("handler broke"); });
    const lines = await quiet(() => reach.dispatchReachMoment(sys(), "enter", walker));
    assert.ok(lines.some((line) => line.includes("could not be run")), "a throwing handler is contained and logged");
    reach.setReachHandler(null);
    assert.deepEqual(await quiet(() => reach.dispatchReachMoment(sys(), "enter", walker)), [], "no handler registered: nothing is attempted or logged");
  } finally {
    reach.setReachHandler(null);
    currentItem = { uuid: "I.9", name: "Charm", type: "item", flags: { "acks-extras": { itemRun: { rows: [reachRow()] } } } };
  }
});

/** A bearer token with an actor at `hp` and the given statuses on its base actor, and the Regions attached to it. */
const downable = (id, hp, statuses = [], regions = []) => ({
  uuid: `T.${id}`, actorLink: true, baseActor: { system: { hp: { value: hp, max: 9 } }, statuses: new Set(statuses) },
  attachments: { regions: new Set(regions) },
});
const regionWith = (id, behaviors) => ({ id, behaviors, delete: async () => { deleted.push(id); } });
const hooksSeen = {};

await t("installing wires lib's turn start, the Region's deletion, hit points and the defeated status, once, each on the primary GM alone", async () => {
  const priorOn = globalThis.Hooks.on;
  globalThis.Hooks.on = (name, fn) => { (hooksSeen[name] ??= []).push(fn); };
  try {
    reach.installAuraReach();
    reach.installAuraReach();
  } finally {
    globalThis.Hooks.on = priorOn;
  }
  for (const name of [constants.TURN_BEGAN_HOOK, "deleteRegion", "updateActor", "createActiveEffect", "updateActiveEffect"]) assert.equal(hooksSeen[name]?.length, 1, `${name} once`);

  // A turn begins: every aura a combatant's token stands in hears it, the live ones of the type alone.
  const aura = (extra = {}) => ({ type: AURA, system: sys(extra) });
  holder.behaviors = [aura(), { type: "other", system: sys({ activationId: "other-act" }) }, { ...aura(), disabled: true }];
  const walker = tokenOf("w", ["alpha"], { regions: new Set([holder]), parent: { regions: [holder], tokens: scene.tokens } });
  const combat = { combatants: { get: (id) => (id === "cm1" ? { token: walker } : id === "cm0" ? {} : undefined) } };
  const heard = [];
  reach.setReachHandler((ctx) => { heard.push([ctx.moment, ctx.subject.token.id, ctx.config.activationId]); });
  try {
    seat(true);
    await hooksSeen[constants.TURN_BEGAN_HOOK][0](combat, "cm1");
    assert.deepEqual(heard, [["turnStart", "w", "act1"]], "one live aura of the type, as turnStart");
    heard.length = 0;
    await hooksSeen[constants.TURN_BEGAN_HOOK][0](combat, "cm0");
    await hooksSeen[constants.TURN_BEGAN_HOOK][0](combat, "cm-none");
    assert.deepEqual(heard, [], "a combatant with no token hears nothing");
    seat(false);
    await hooksSeen[constants.TURN_BEGAN_HOOK][0](combat, "cm1");
    assert.deepEqual(heard, [], "off the primary GM's window nothing runs");
  } finally {
    reach.setReachHandler(null);
    holder.behaviors = [];
  }

  // A reach's Region is deleted: each aura config on it is torn down, once; a throw spares the rest.
  const torn = [];
  reach.setReachTeardown(async ({ config, region }) => {
    torn.push([config?.activationId ?? "none", region.id]);
    if (config.activationId === "act1") throw new Error("lift failed");
  });
  try {
    const gone = regionWith("R7", [{ type: AURA, system: cfg }, { type: AURA, system: { ...cfg, activationId: "act2" } }, { type: AURA, system: {} }, { type: "other", system: cfg }]);
    seat(true);
    const lines = await quiet(() => hooksSeen.deleteRegion[0](gone));
    assert.deepEqual(torn, [["act1", "R7"], ["act2", "R7"]], "both configs, never the hand-made one or another type, and the first's throw does not stop the second");
    assert.ok(lines.some((line) => line.includes("could not be lifted")));
    torn.length = 0;
    seat(false);
    await hooksSeen.deleteRegion[0](gone);
    assert.deepEqual(torn, []);
    seat(true);
    reach.setReachTeardown(null);
    await hooksSeen.deleteRegion[0](gone);
    assert.deepEqual(torn, [], "no teardown registered");
    assert.deepEqual(await quiet(() => hooksSeen.deleteRegion[0](gone)), [], "and nothing is logged for it");
  } finally {
    reach.setReachTeardown(null);
  }

  // A bearer's hit points change, or it takes the defeated status.
  const aurasOn = () => [regionWith("r1", [aura()]), regionWith("r2", [{ type: "other", system: {} }])];
  const asked = [];
  const linkedActor = (token) => ({ isToken: false, getDependentTokens: (opts) => { asked.push(opts); return [token]; } });
  const lowered = async (fire) => {
    deleted.length = 0;
    hookCalls.length = 0;
    await fire();
    await tick();
    return { deleted: [...deleted], hooks: hookCalls.map(([name, tok, info]) => [name, tok.uuid, info.cause]) };
  };
  seat(true);
  const down = downable("dn", 0, [], aurasOn());
  const after = await lowered(() => hooksSeen.updateActor[0](linkedActor(down), { system: { hp: { value: 0 } } }));
  assert.deepEqual(after.deleted, ["r1"], "only the aura Region");
  assert.deepEqual(after.hooks, [[constants.BEARER_DOWN_HOOK, "T.dn", "hp"]]);
  const direct = await reach.lowerForBearer(linkedActor(downable("dr", 0, [], aurasOn())));
  assert.deepEqual(direct.map((d) => [d.token.uuid, d.cause]), [["T.dr", "hp"]], "the bearers it lowered, with the cause");
  assert.deepEqual(asked.at(-1), { linked: true }, "the linked tokens of the actor");
  for (const change of [{ system: { other: 1 } }, { name: "x" }, undefined]) {
    assert.deepEqual((await lowered(() => hooksSeen.updateActor[0](linkedActor(down), change))).deleted, [], `${JSON.stringify(change)} is no hit-point change`);
  }
  seat(false);
  assert.deepEqual((await lowered(() => hooksSeen.updateActor[0](linkedActor(down), { system: { hp: {} } }))).deleted, [], "not the primary GM");
  seat(true);
  const synthetic = { isToken: true, token: downable("sy", -3, [], aurasOn()), getDependentTokens: () => { throw new Error("a synthetic actor has its one token"); } };
  assert.deepEqual((await lowered(() => hooksSeen.updateActor[0](synthetic, { system: { hp: {} } }))).hooks, [[constants.BEARER_DOWN_HOOK, "T.sy", "hp"]]);
  const noToken = { isToken: false, getDependentTokens: () => [null, downable("ok", 0, [], aurasOn())] };
  assert.deepEqual((await lowered(() => hooksSeen.updateActor[0](noToken, { system: { hp: {} } }))).hooks, [[constants.BEARER_DOWN_HOOK, "T.ok", "hp"]], "a missing token is passed over");
  const standing = downable("up", 5, [], aurasOn());
  assert.deepEqual(await lowered(() => hooksSeen.updateActor[0](linkedActor(standing), { system: { hp: {} } })), { deleted: [], hooks: [] }, "a bearer still up keeps its reaches");

  // The defeated status, enabled, on an effect of an actor or of a token's delta.
  const fallen = downable("fl", 5, ["dead"], aurasOn());
  const effect = (over = {}) => ({ disabled: false, statuses: new Set(["dead"]), parent: linkedActor(fallen), ...over });
  for (const name of ["createActiveEffect", "updateActiveEffect"]) {
    const out = await lowered(() => hooksSeen[name][0](effect()));
    assert.deepEqual(out.hooks, [[constants.BEARER_DOWN_HOOK, "T.fl", "defeated"]], name);
  }
  const viaDelta = await lowered(() => hooksSeen.createActiveEffect[0](effect({ parent: { documentName: "ActorDelta", parent: { actor: linkedActor(fallen) } } })));
  assert.equal(viaDelta.hooks.length, 1, "a token's delta reaches the token's actor");
  assert.deepEqual((await lowered(() => hooksSeen.createActiveEffect[0](effect({ disabled: true })))).hooks, [], "a disabled effect defeats nobody");
  assert.deepEqual((await lowered(() => hooksSeen.createActiveEffect[0](effect({ statuses: new Set(["prone"]) })))).hooks, [], "another status");
  seat(false);
  assert.deepEqual((await lowered(() => hooksSeen.createActiveEffect[0](effect()))).hooks, [], "not the primary GM");
  seat(true);
  const priorConfig = globalThis.CONFIG;
  globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "fallen" } };
  try {
    const custom = downable("cu", 5, ["fallen"], aurasOn());
    const named = await lowered(() => hooksSeen.createActiveEffect[0](effect({ statuses: new Set(["fallen"]), parent: linkedActor(custom) })));
    assert.deepEqual(named.hooks, [[constants.BEARER_DOWN_HOOK, "T.cu", "defeated"]], "core's own name for the defeated status");
    assert.deepEqual((await lowered(() => hooksSeen.createActiveEffect[0](effect()))).hooks, [], "lib's default is only the fallback");
    const onlyDead = downable("od", 5, ["dead"], aurasOn());
    assert.deepEqual((await lowered(() => hooksSeen.updateActor[0](linkedActor(onlyDead), { system: { hp: {} } }))).hooks, [], "the status read is core's name too");
  } finally {
    globalThis.CONFIG = priorConfig;
    seat(false);
  }
});

await t("lowering a bearer's reaches deletes the aura Regions of one activation or all, checks a Player's seat owns the token, and skips a Region already going", async () => {
  const users = globalThis.game.users;
  users.push({ id: "u1" }, { id: "u2" });
  const mk = () => {
    const r = (id, activationId, type = AURA) => regionWith(id, [{ type, system: { ...cfg, activationId } }]);
    const token = { uuid: "T.L", testUserPermission: (u) => u.id === "u1", attachments: { regions: new Set([r("a1", "act1"), r("a2", "act2"), r("o1", "act1", "other"), r("a3", "act1")]) } };
    return token;
  };
  let token = mk();
  const priorLookup = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "T.L" ? token : null);
  try {
    deleted.length = 0;
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", activationId: "act1" }), ["a1", "a3"], "one activation's aura Regions, not another's or another type");
    token = mk();
    deleted.length = 0;
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L" }), ["a1", "a2", "a3"], "without an activation, every aura Region");
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.none" }), [], "no token");
    token = mk();
    deleted.length = 0;
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", requestUserId: "u2" }), [], "a seat that does not own the token");
    assert.deepEqual(deleted, []);
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", requestUserId: "u1", activationId: "act2" }), ["a2"], "its owner");
    const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
    token = mk();
    assert.deepEqual(await executeAsGM("acks-extras.aura.lower", { tokenUuid: "T.L", activationId: "act2", requestUserId: "u2" }), [], "a relayed lower carries the seat that asked");
    assert.deepEqual(await executeAsGM("acks-extras.aura.lower", { tokenUuid: "T.L", activationId: "act2", requestUserId: "u1" }), ["a2"], "and the activation it names");
    // A delete that fails is contained and releases the Region; a delete that loops back skips itself.
    token = mk();
    const [first] = token.attachments.regions;
    first.delete = async () => { throw new Error("refused"); };
    const lines = await quiet(async () => assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", activationId: "act1" }), ["a3"]));
    assert.ok(lines.some((line) => line.includes("could not be lowered")));
    first.delete = async () => { deleted.push("a1-again"); };
    deleted.length = 0;
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", activationId: "act1" }), ["a1", "a3"], "a Region whose delete failed is lowered by the next call");
    token = mk();
    const [again] = token.attachments.regions;
    let inner = null;
    again.delete = async () => { inner = await reach.lowerReach({ tokenUuid: "T.L", activationId: "act1" }); };
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L", activationId: "act1" }), ["a1", "a3"]);
    assert.ok(!inner.includes("a1"), "the nested call skipped the Region already being deleted");
    // A Player's seat relays and gets nothing where no Judge is seated.
    token = mk();
    deleted.length = 0;
    globalThis.game.user = { isGM: false };
    seat(false);
    assert.deepEqual(await reach.lowerReach({ tokenUuid: "T.L" }), []);
    assert.deepEqual(deleted, [], "a Player's seat deletes nothing itself");
  } finally {
    globalThis.game.user = { isGM: true };
    globalThis.fromUuidSync = priorLookup;
    users.splice(0);
  }
});

await t("raising refuses a token, an item or a row that is gone, a carrier that is not the bearer, a seat that is not an owner and a build without core's parts, with the right line, and hands back the Region", async () => {
  const users = globalThis.game.users;
  users.push({ id: "u1" }, { id: "u2" });
  const asked = [];
  const bearerActor = { uuid: "A.1" };
  const tok = { uuid: "T.R", id: "R", hidden: false, actor: bearerActor, baseActor: { uuid: "A.1", system: { hp: { value: 5, max: 9 } }, statuses: new Set() }, testUserPermission: (u) => u.id === "u1" };
  const itemFor = (actor, radius = "45") => ({ uuid: "I.R", name: "Charm", actor, flags: { "acks-extras": { itemRun: { rows: [reachRow({ radius: { value: radius } })] } } } });
  let item = itemFor(bearerActor);
  const priorLookup = globalThis.fromUuidSync;
  const priorConfig = globalThis.CONFIG;
  const priorData = globalThis.foundry.data;
  const notes = [];
  const priorUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text]), error: (text) => notes.push(["error", text]) } };
  globalThis.fromUuidSync = (uuid) => (uuid === "T.R" ? tok : uuid === "I.R" ? item : null);
  const build = (over = {}) => ({
    Region: { documentClass: { schema: { fields: { attachment: { fields: { token: {} } } } }, createTokenEmanation: async (...args) => { asked.push(args); return { id: "R5", uuid: "S.R5" }; }, ...over } },
    specialStatusEffects: {},
  });
  globalThis.CONFIG = build();
  globalThis.foundry.data = { ...priorData, EmanationShapeData: class {} };
  const ask = (over = {}) => reach.raiseReach({ tokenUuid: "T.R", sourceUuid: "I.R", rowKey: "k", activationId: "act", ...over });
  const lastNote = () => notes.at(-1);
  try {
    const made = await ask();
    assert.deepEqual([made.ok, made.regionId, made.regionUuid], [true, "R5", "S.R5"]);
    assert.equal(asked.at(-1)[1], 45, "this row's radius, not another's");
    assert.equal(asked.at(-1)[2].name, "Charm");
    assert.equal(asked.at(-1)[2].hidden, false, "hidden as the token is");
    assert.equal(asked.at(-1)[2].behaviors[0].name, "Charm");
    notes.length = 0;
    const refuse = async (over, reason, kind = "warn") => {
      const out = await ask(over);
      assert.equal(out.ok, false);
      assert.equal(out.reason, reason);
      assert.equal(lastNote()[0], kind, `${reason} is a ${kind}`);
      assert.ok(lastNote()[1].endsWith(`aura.refused.${reason}`), `${reason}'s line`);
    };
    await refuse({ tokenUuid: "T.none" }, "gone");
    await refuse({ sourceUuid: "I.none" }, "gone");
    await refuse({ rowKey: "none" }, "gone");
    item = itemFor({ uuid: "A.other" });
    await refuse({}, "notCarried");
    item = itemFor({ uuid: "A.1" });
    tok.baseActor.uuid = "A.x";
    assert.equal((await ask()).ok, true, "the same actor by uuid carries it");
    tok.baseActor.uuid = "A.1";
    item = itemFor({ uuid: "A.9" });
    tok.actor = null;
    tok.baseActor.uuid = "A.9";
    assert.equal((await ask()).ok, true, "a token's base actor by uuid carries it");
    tok.actor = bearerActor;
    tok.baseActor.uuid = "A.1";
    item = itemFor(null);
    await refuse({}, "notCarried");
    item = itemFor(bearerActor, "");
    await refuse({}, "noRange");
    item = itemFor(bearerActor);
    notes.length = 0;
    await refuse({ requestUserId: "u2" }, "notOwner", "error");
    assert.equal((await ask({ requestUserId: "u1" })).ok, true, "an owner's request");
    tok.baseActor.system.hp.value = 0;
    await refuse({ requestUserId: "u1" }, "down", "error");
    notes.length = 0;
    const warned = await ask();
    assert.equal(warned.ok, true, "a Judge goes on");
    assert.ok(notes.some(([kind, text]) => kind === "warn" && text.endsWith("aura.refused.downWarn")), "with a line");
    tok.baseActor.system.hp.value = 5;
    globalThis.CONFIG = build({ createTokenEmanation: undefined });
    const unsupported = await ask();
    assert.equal(unsupported.reason, "unsupported");
    assert.deepEqual(unsupported.missing, ["createTokenEmanation"]);
    globalThis.CONFIG = build({ schema: undefined });
    assert.deepEqual((await ask()).missing, ["attachment.token"], "a Region that cannot attach to a token");
    globalThis.CONFIG = build();
    globalThis.foundry.data = { ...priorData };
    assert.deepEqual((await ask()).missing, ["emanation"], "no emanation shape");
    globalThis.foundry.data = { ...priorData, EmanationShapeData: class {} };
    globalThis.CONFIG = build();
    globalThis.game.user = { isGM: false };
    seat(false);
    const before = asked.length;
    const relayed = await ask();
    assert.deepEqual(relayed, { ok: false, reason: "relay" }, "a Player's seat with no Judge seated");
    assert.equal(asked.length, before, "and creates nothing itself");
  } finally {
    globalThis.game.user = { isGM: true };
    globalThis.fromUuidSync = priorLookup;
    globalThis.CONFIG = priorConfig;
    globalThis.foundry.data = priorData;
    globalThis.ui = priorUi;
    users.splice(0);
  }
});

await t("a snapshot leaves out the centre token itself, builds the Region with the scene as its parent and the token's own source, and answers the reason a shape was refused", () => {
  const made = [];
  const priorConfig = globalThis.CONFIG;
  globalThis.CONFIG = { Region: { documentClass: class { constructor(data, options) { this.name = data.name; this.data = data; this.options = options; made.push(this); } } } };
  try {
    const inside = new Set(["c", "n"]);
    const tok = (id) => ({ id, actor: { documentName: "Actor", type: "monster" }, testInsideRegion: () => inside.has(id) });
    const centre = tok("c");
    centre._source = { x: 7, y: 8, width: 1, height: 1, shape: 4 };
    centre.x = 99;
    const area = { dimensions: { distance: 5, distancePixels: 10 }, tokens: [centre, tok("n"), tok("z")] };
    const found = reach.reachSnapshot(area, { token: centre }, 20);
    assert.deepEqual(found.tokens.map((x) => x.id), ["n"], "the centre is inside its own area and is not a subject");
    assert.equal(made[0].name, "reach");
    assert.equal(made[0].options.parent, area);
    assert.equal(made[0].data.shapes[0].base.x, 7, "the token's source, not its prepared position");
    assert.deepEqual(reach.reachSnapshot(area, { token: centre }, 0), { ok: false, reason: "range" });
    assert.deepEqual(reach.reachSnapshot({ dimensions: {}, tokens: [] }, { token: centre }, 5), { ok: false, reason: "scale" });
    assert.equal(made.length, 1, "a refused shape builds no Region");
  } finally {
    globalThis.CONFIG = priorConfig;
  }
});

await t("a reach stored in feet is sized in the scene's own units, by the raise and by the snapshot: a metre scene gets metres, a feet or unnamed scene the figure as it stands", async () => {
  const { feetToUnits } = await import("../scripts/lib/distance-units.mjs");
  const asked = [];
  const made = [];
  const priorConfig = globalThis.CONFIG;
  const priorLookup = globalThis.fromUuidSync;
  const priorData = globalThis.foundry.data;
  globalThis.CONFIG = {
    Region: {
      documentClass: class {
        static schema = { fields: { attachment: { fields: { token: {} } } } };
        static createTokenEmanation = async (...args) => { asked.push(args); return { id: "R1", uuid: "S.R1" }; };
        constructor(data, options) { this.name = data.name; this.data = data; this.options = options; made.push(this); }
      },
    },
    specialStatusEffects: {},
  };
  globalThis.foundry.data = { ...priorData, EmanationShapeData: class {} };
  try {
    for (const [units, expected] of [["m", feetToUnits(30, "m")], ["ft", 30], [undefined, 30]]) {
      asked.length = 0;
      const token = { uuid: "T.1", id: "1", hidden: false, actor: { uuid: "A.1" }, parent: { grid: { units } }, testUserPermission: () => true };
      const item = { uuid: "I.1", name: "Gear", actor: token.actor, type: "item", flags: { "acks-extras": { itemRun: { rows: [{ key: "k", reach: { pulse: "standing", radius: { value: "30" } } }] } } } };
      globalThis.fromUuidSync = (uuid) => (uuid === "T.1" ? token : uuid === "I.1" ? item : null);
      assert.equal((await reach.raiseReach({ tokenUuid: "T.1", sourceUuid: "I.1", rowKey: "k", activationId: "act" })).ok, true);
      assert.equal(asked[0][1], expected, `${units}: core is handed the range in the scene's units`);
    }
    assert.ok(Math.abs(feetToUnits(30, "m") - 9.144) < 0.001, "30 feet is about 9.14 metres, never 30");
    for (const [units, expected] of [["m", feetToUnits(20, "m") * 10], ["ft", 20 * 10]]) {
      made.length = 0;
      const centre = { id: "c", actor: { documentName: "Actor", type: "monster" }, testInsideRegion: () => false, _source: { x: 0, y: 0, width: 1, height: 1, shape: 4 } };
      const scene = { grid: { units }, dimensions: { distance: 5, distancePixels: 10 }, tokens: [centre] };
      assert.equal(reach.reachSnapshot(scene, { token: centre }, 20).ok, true);
      assert.equal(made[0].data.shapes[0].radius, expected, `${units}: the snapshot's radius is the converted range times the pixels per unit`);
      made.length = 0;
      assert.equal(reach.reachSnapshot(scene, { point: { x: 1, y: 1 } }, 20).ok, true);
      assert.equal(made[0].data.shapes[0].radius, expected, `${units}: a point's circle likewise`);
    }
  } finally {
    globalThis.CONFIG = priorConfig;
    globalThis.fromUuidSync = priorLookup;
    globalThis.foundry.data = priorData;
  }
});

await t("a race is told into its category from the two race sets, a creature's kinds read the registered key as it is written, and a subtype that is an enchanted type makes the creature enchanted", () => {
  for (const key of ["human", "people1", "people2", " People1 "]) assert.equal(actorRead.raceCategoryOf(key), "human", key);
  for (const key of ["dwarf", "elf", "gnome", " GNOME "]) assert.equal(actorRead.raceCategoryOf(key), "demi-human", key);
  for (const key of ["people3", "", null, undefined]) assert.equal(actorRead.raceCategoryOf(key), null, String(key));
  assert.deepEqual([...actorRead.MEN_RACES].sort(), ["human", "people1", "people2"]);
  assert.deepEqual([...actorRead.DEMI_HUMAN_RACES].sort(), ["dwarf", "elf", "gnome"]);
  assert.deepEqual([...actorRead.RACE_CATEGORIES], ["human", "demi-human"]);
  const creature = (type, extras, cls = "") => ({ type, system: { details: { class: cls } }, getFlag: (scope, key) => (key === "extras" ? extras : undefined) });
  assert.deepEqual([...actorRead.creatureKinds(creature("monster", { subtype: "Construct, Odd" }))].sort(), ["construct", "enchanted", "odd"], "a subtype is read before the enchanted step");
  assert.equal(actorRead.creatureKinds(creature("monster", { subtype: "Odd" })).has("enchanted"), false);
  try {
    actorRead.registerCharacterRace(() => " Dwarf ");
    assert.deepEqual([...actorRead.creatureKinds(creature("character", undefined, "Any"))], ["character", "dwarf", "demi-human"], "the key is lowercased and trimmed");
    actorRead.registerCharacterRace(() => "People1");
    assert.deepEqual([...actorRead.creatureKinds(creature("character", undefined, "Any"))], ["character", "people1", "human"]);
    assert.deepEqual([...actorRead.creatureKinds(creature("character", undefined, ""))], ["character"], "a class field that is blank names no race");
    actorRead.registerCharacterRace(() => "");
    assert.deepEqual([...actorRead.creatureKinds(creature("character", undefined, "Any"))], ["character"]);
  } finally {
    actorRead.registerCharacterRace(null);
  }
  assert.equal(actorRead.kindToken("A  b_c"), "a-b-c");
  assert.equal(actorRead.kindToken(" X!y "), "xy");
});

await t("a reach's pulse, side and unit are choices of their own vocabularies, and the filter and figure reference carry the fields the logic reads", () => {
  const field = effectField().fields.reach;
  const keysOf = (f) => Object.keys(f.options.choices);
  assert.deepEqual(keysOf(field.fields.pulse), Object.keys(vocab.REACH_PULSES));
  assert.deepEqual(keysOf(field.fields.filter.fields.side), Object.keys(vocab.REACH_SIDES));
  assert.deepEqual(keysOf(field.fields.filter.fields.unit), Object.keys(vocab.REACH_UNITS));
  assert.equal(field.fields.pulse.options.initial, "", "a pulse nobody chose acts on nothing");
  assert.equal(field.fields.filter.fields.unit.options.initial, "any");
  assert.equal(field.fields.filter.fields.side.options.initial, "any");
  assert.ok(field.fields.filter.fields.kinds instanceof List && field.fields.filter.fields.exceptKinds instanceof List);
  assert.ok(field.fields.radius instanceof Schema, "the radius is a figure reference");
});

console.log(`\ntest-aura-reach: ${passed} checks passed.`);
