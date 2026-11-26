/**
 * The live reach (`aura-reach-logic.mjs`, `aura-reach.mjs`) and the creature
 * kinds it filters on (`actor-read.mjs`), offline: who of the tokens inside an
 * area counts and which clauses answer null, what each moment does, the
 * snapshot's area in pixels, the figure a row names, the raise's verdict and
 * the Region it asks core for, a hand-made behavior doing nothing, the bearer
 * going down, the row schema carrying a reach, and the editor's reach group
 * editing it as a diff (`reach-edit.mjs`). Foundry-free with stand-ins; every
 * kind, name and figure below is invented.
 *
 * Usage: node tools/test-aura-reach.mjs
 */
import assert from "node:assert/strict";

const hookCalls = [];
let randomN = 0;
globalThis.Hooks = { once() {}, on() {}, callAll: (...args) => hookCalls.push(args) };
globalThis.foundry = {
  utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj), randomID: () => `rid${++randomN}`, escapeHTML: (text) => String(text) },
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
  assert.equal(act("turnStart+moveIn", "enter"), "list", "a walk-in fires both events and only moveIn prompts: enter lists");
  assert.equal(act("turnStart+moveIn", "enter", false), "refuse", "a body the filter refuses is listed as no target");
  assert.equal(act("turnStart+moveIn", "enter", null), "undetermined");
  assert.equal(act("turnStart+moveIn", "enter", true, true), "list", "an immune body is listed too; the prompt skips it");
  assert.equal(act("turnStart+moveIn", "exit"), "out");
  assert.equal(act("turnStart+moveIn", "exit", false), "out", "out for whoever the filter says");
  assert.equal(act("turnStart+moveIn", "turnStart", false), "none", "no prompt for a body the filter refuses");
  assert.equal(act("action", "enter"), "none");
  assert.equal(act("action", "exit"), "none");
  assert.equal(act("turnStart+moveIn", "turnStart", true, true), "skip", "an immune subject is skipped");
  assert.equal(act("standing", "enter"), "on");
  assert.equal(act("standing", "exit", false), "off");
  assert.equal(act("standing", "moveIn"), "none");
  assert.equal(act("burst", "burst"), "prompt");
  assert.equal(act("burst", "burst", null), "undetermined");
  assert.equal(act("burst", "burst", false), "none");
  assert.equal(act("nonsense", "burst"), "none");
});

await t("the bearer is a subject only where the filter's self is count, and its other clauses still decide", () => {
  assert.equal(logic.readFilter({}).self, "no");
  assert.equal(logic.readFilter({ self: "count" }).self, "count");
  assert.equal(logic.readFilter({ self: "ask" }).self, "no", "a word outside the vocabulary is no");
  assert.equal(logic.reachAdmits(bearer, bearer, { self: "no" }, deps), false);
  assert.equal(logic.reachAdmits(bearer, bearer, { self: "count" }, deps), true);
  const mine = body({ id: "b", kinds: ["alpha"] });
  assert.equal(logic.reachAdmits(mine, mine, { self: "count", kinds: ["beta"] }, deps), false, "a kinds clause the bearer misses still refuses it");
  assert.equal(logic.reachAdmits(mine, mine, { self: "count", kinds: ["alpha"] }, deps), true);
  assert.equal(logic.reachAdmits(bearer, bearer, { self: "count" }, { ...deps, isMarker: () => true }), false, "a marker is never a subject");
  assert.equal(logic.readReach({ pulse: "standing", filter: { self: "count" } }).filter.self, "count");
});

await t("a held prompt key is held once, released on an answer, and pruned at a turn start for another initiative only", () => {
  const held = new Map();
  const stamp = logic.turnStamp({ combatId: "c1", round: 2, turn: 3 });
  assert.equal(stamp, "c1:2:3");
  assert.equal(logic.turnStamp({}), null);
  assert.equal(logic.turnStamp({ combatId: "" }), null);
  assert.equal(logic.holdMoment(held, "k1", stamp), true);
  assert.equal(logic.holdMoment(held, "k1", stamp), false, "asked once for the kind and the initiative");
  assert.equal(logic.holdMoment(held, "k2", "c1:2:2"), true);
  assert.equal(logic.holdMoment(held, "loose:k", null), true);
  assert.equal(logic.holdMoment(held, null), true, "a blank key cannot be told apart and always asks");
  assert.equal(logic.holdMoment(held, null), true);
  assert.deepEqual(logic.pruneMoments(held, stamp), ["k2"], "a key of another initiative goes");
  assert.deepEqual([...held.keys()], ["k1", "loose:k"], "this initiative's and a key held outside a fight stay");
  assert.equal(logic.releaseMoment(held, "k1"), true);
  assert.equal(logic.releaseMoment(held, "k1"), false);
  assert.equal(logic.releaseMoment(held, null), false);
  assert.equal(logic.holdMoment(held, "k1", stamp), true, "answered, it can be asked again");
});

await t("reaches group by item kind in the order met, and a reach with no kind is a group of its own", () => {
  const list = [{ n: 1, k: "a" }, { n: 2, k: "b" }, { n: 3, k: "a" }, { n: 4, k: "" }, { n: 5, k: "" }];
  assert.deepEqual(logic.groupByKind(list, (e) => e.k).map((g) => g.map((e) => e.n)), [[1, 3], [2], [4], [5]]);
  assert.deepEqual(logic.groupByKind(null, () => "x"), []);
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

await t("a reach's save narrowing reads as a lowercase circumstance word and a magic flag, and is none where it names neither", () => {
  assert.deepEqual(logic.readReach({ pulse: "standing", saveWhen: { when: " Fear ", magical: true } }).saveWhen, { when: "fear", magical: true });
  assert.deepEqual(logic.readReach({ pulse: "standing", saveWhen: { when: "fear" } }).saveWhen, { when: "fear", magical: false });
  assert.deepEqual(logic.readReach({ pulse: "standing", saveWhen: { magical: true } }).saveWhen, { when: "", magical: true });
  assert.equal(logic.readReach({ pulse: "standing", saveWhen: { when: "", magical: false } }).saveWhen, null);
  assert.equal(logic.readReach({ pulse: "standing", saveWhen: { magical: "true" } }).saveWhen, null, "only the boolean counts");
  assert.equal(logic.readReach({ pulse: "standing" }).saveWhen, null);
  assert.equal(logic.readSaveWhen(null), null);
});

await t("a reach reads only with a known pulse; a filter reads its words lowercase and defaults to any", () => {
  assert.equal(logic.readReach({ pulse: "nope", filter: {} }), null);
  assert.equal(logic.readReach(null), null);
  const r = logic.readReach({ pulse: "standing", radius: { value: "5" }, filter: { kinds: [" Alpha "], side: "weird", unit: "own" } });
  assert.deepEqual(r.filter, { kinds: ["alpha"], exceptKinds: [], side: "any", unit: "own", self: "no" });
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

/* --- the row schema: a reach, and the editor's group over it --- */
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
const reachEdit = await import("../scripts/lib/reach-edit.mjs");

await t("effectField carries a nullable reach of radius, filter and pulse, empty by default, so a row cleaned without one stays without", () => {
  const field = effectField().fields.reach;
  assert.ok(field instanceof Schema);
  assert.deepEqual(Object.keys(field.fields).sort(), ["engaged", "filter", "fraction", "immunity", "lasts", "modifier", "on", "pulse", "radius", "save", "saveWhen", "showReach"]);
  assert.deepEqual(Object.keys(field.fields.saveWhen.fields).sort(), ["magical", "when"]);
  for (const key of ["save", "immunity", "lasts", "modifier", "fraction"]) assert.deepEqual(Object.keys(field.fields[key].fields).sort(), ["doc", "figure", "row", "table", "value"], `${key} is a figure reference`);
  assert.deepEqual(Object.keys(field.fields.radius.fields).sort(), ["doc", "figure", "row", "table", "value"]);
  assert.deepEqual(Object.keys(field.fields.filter.fields).sort(), ["exceptKinds", "kinds", "self", "side", "unit"]);
});

await t("the gear and ability domains end every kind's fields with the reach group and a spell offers none; an edit that moves no reach control keeps a stored reach", () => {
  const types = Object.keys(vocab.EFFECT_TYPES);
  assert.ok(types.length > 30);
  for (const domain of [vocab.GEAR_DOMAIN, "ability"]) {
    for (const type of types) {
      const fields = editor.fieldsForType(type, domain);
      assert.equal(fields.filter((name) => name === "reach").length, 1, `${type} in ${domain} offers the reach group once`);
      assert.equal(fields.at(-1), "reach", `${type} in ${domain} ends with it`);
      assert.ok(!fields.some((name) => name.startsWith("reach.")), "and no reach member is a field of its own");
    }
  }
  for (const domain of ["spell", "domain", undefined]) {
    for (const type of types) assert.ok(!editor.fieldsForType(type, domain).some((name) => name === "reach" || name.startsWith("reach.")), `${type} in ${domain} offers no reach`);
  }
  const stored = { type: "modifier", key: "k", reach: { pulse: "standing", radius: { value: "5", doc: "d", table: "t", row: "r", figure: "f" }, filter: { kinds: ["alpha"], unit: "own", self: "count" }, save: { value: "x" }, on: ["attack"], saveWhen: { when: "w", magical: true } } };
  assert.deepEqual(editor.mergeRowEdit(stored, { note: "x" }).reach, stored.reach, "an edit that never names reach keeps it");
  // The window submits the whole group at its shown values on every change of any field.
  const shown = { mode: "distance", side: "all", kinds: ["alpha"], exceptKinds: [], showReach: false };
  assert.equal(editor.mergeRowEdit(stored, { note: "x", reach: shown }).reach, stored.reach, "the group submitted at its shown values leaves the stored reach as it is, the very object");
  assert.equal(editor.mergeRowEdit(stored, { note: "x", reach: shown }).note, "x");
  const none = editor.mergeRowEdit({ type: "modifier" }, { note: "x", reach: { mode: "distance", side: "all", kinds: [], exceptKinds: [], showReach: false } });
  assert.ok(!("reach" in none), "a row with none stays without one while no control is moved off its neutral position");
  assert.equal(none.note, "x");
  assert.equal(editor.mergeRowEdit({ type: "modifier", reach: null }, { reach: { side: "all" } }).reach, null, "a stored null stays null");
});

await t("a moved reach control writes only its own member and keeps every figure the group does not own", () => {
  const stored = { type: "modifier", key: "k", reach: { pulse: "standing", engaged: false, radius: { value: "5" }, save: { value: "x" }, immunity: { value: "i" }, lasts: { value: "2" }, modifier: { value: "1" }, on: ["attack"], saveWhen: { when: "w", magical: true }, filter: { kinds: ["alpha"], exceptKinds: [], side: "opposing", unit: "own", self: "count" }, showReach: false } };
  const at = (fragment) => editor.mergeRowEdit(stored, { reach: { mode: "distance", side: "foe", kinds: ["alpha"], exceptKinds: [], showReach: false, ...fragment } }).reach;
  const kept = ["radius", "save", "immunity", "lasts", "modifier", "on", "saveWhen"];
  const sameExcept = (next, ...changed) => {
    for (const key of kept) assert.deepEqual(next[key], stored.reach[key], `${key} is never written`);
    assert.equal(next.filter.unit, "own", "filter.unit is never written");
    assert.equal(next.filter.self, "count", "filter.self is never written");
    for (const key of Object.keys(stored.reach)) if (!changed.includes(key)) assert.deepEqual(next[key], stored.reach[key], `${key} is as stored`);
  };
  const ring = at({ showReach: true });
  assert.equal(ring.showReach, true);
  assert.deepEqual(ring.filter, stored.reach.filter);
  sameExcept(ring, "showReach");
  // Who counts: the three options write the three REACH_SIDES keys.
  for (const [option, key] of [["foe", "opposing"], ["side", "own"], ["all", "any"]]) assert.equal(at({ side: option }).filter.side, key, `${option} writes ${key}`);
  assert.deepEqual(Object.values(reachEdit.SIDE_OPTIONS).sort(), Object.keys(vocab.REACH_SIDES).sort(), "the options are the sides REACH_SIDES defines, one each");
  const side = at({ side: "all" });
  assert.equal(side.pulse, "standing", "the pulse is left as stored");
  sameExcept(side, "filter");
  // The kinds are keys only, deduplicated, and a stored word the pick cannot name is kept.
  const kinds = at({ kinds: ["alpha", "beta", "beta", " Gamma "], exceptKinds: ["delta"] });
  assert.deepEqual(kinds.filter.kinds, ["alpha", "beta", "gamma"]);
  assert.deepEqual(kinds.filter.exceptKinds, ["delta"]);
  assert.deepEqual(at({ kinds: [] }).filter.kinds, [], "untick the last kind and the filter is open again");
  const odd = editor.mergeRowEdit({ type: "modifier", reach: { pulse: "standing", filter: { kinds: ["a.b", "alpha"] } } }, { reach: { kinds: ["beta"] } }).reach;
  assert.deepEqual(odd.filter.kinds, ["beta", "a.b"], "a stored word no checkbox can name is not the pick's to drop");
  // Engaged writes the engaged flag and its pulse; switching back takes the engaged pulse off and leaves any other alone.
  const engaged = at({ mode: "engaged" });
  assert.deepEqual([engaged.engaged, engaged.pulse], [true, "turnStart+enter"]);
  sameExcept(engaged, "engaged", "pulse");
  const back = editor.mergeRowEdit({ type: "modifier", reach: engaged }, { reach: { mode: "distance" } }).reach;
  assert.ok(back.engaged === false && !("pulse" in back), "back to a distance, the engaged pulse is gone, so the reach engages nothing");
  assert.equal(logic.readReach(back), null, "and reads as acting on nothing until an import gives it a pulse");
  sameExcept(back, "engaged", "pulse");
  const other = editor.mergeRowEdit({ type: "modifier", reach: { ...engaged, pulse: "standing" } }, { reach: { mode: "distance" } }).reach;
  assert.deepEqual([other.engaged, other.pulse], [false, "standing"], "any other stored pulse is left alone");
  assert.equal(at({ mode: "distance" }).pulse, "standing", "a distance reach that was never engaged keeps its pulse");
  // A row with no reach takes one only where a control is moved, and then only the members that moved.
  const made = editor.mergeRowEdit({ type: "modifier" }, { reach: { mode: "distance", side: "foe", kinds: [], exceptKinds: [], showReach: false } }).reach;
  assert.deepEqual(made, { filter: { side: "opposing" } }, "no pulse is written for a distance reach a hand makes");
  assert.deepEqual(editor.mergeRowEdit({ type: "modifier" }, { reach: { showReach: true } }).reach, { showReach: true }, "no empty filter is left behind");
  assert.deepEqual(editor.mergeRowEdit({ type: "modifier" }, { reach: { mode: "engaged" } }).reach, { engaged: true, pulse: "turnStart+enter" });
  // A control the window did not submit (a seat that may not write) changes nothing.
  assert.equal(editor.mergeRowEdit(stored, { note: "y", reach: {} }).reach, stored.reach);
});

await t("kindKeys lists the closed keys matchKinds resolves onto, once each, and the pick offers a stored word beside them", () => {
  const closed = actorRead.kindKeys(["Beta", "alpha", "demi-human"]);
  assert.deepEqual(closed.slice(0, 2), actorRead.RACE_CATEGORIES, "the race categories lead");
  for (const key of [...actorRead.MEN_RACES, ...actorRead.DEMI_HUMAN_RACES, "alpha", "beta"]) assert.ok(closed.includes(key), `${key} is a closed key`);
  assert.equal(new Set(closed).size, closed.length, "no key twice");
  assert.deepEqual(actorRead.kindKeys(), actorRead.kindKeys([]), "the race keys stand without a caller's types");
  for (const key of closed) assert.deepEqual(actorRead.matchKinds(key, closed).kinds, [key], `${key} resolves to itself`);
  assert.deepEqual(reachEdit.kindOptions(closed, ["gamma", "alpha", "a.b"]).slice(closed.length), ["gamma"], "a stored word the checkbox can name is offered after the closed keys");
});

await t("How it is used folds once, fuse and consume into Used up, keeps the kind stored, and Always on removes the kind", () => {
  for (const kind of ["once", "fuse", "consume"]) {
    assert.equal(reachEdit.useOptionOf(kind), "spent", `${kind} reads as Used up`);
    assert.equal(reachEdit.useKindFor("spent", kind), kind, `Used up keeps a stored ${kind}`);
  }
  assert.equal(reachEdit.useOptionOf("toggle"), "toggle");
  for (const kind of ["", undefined, "unknown"]) assert.equal(reachEdit.useOptionOf(kind), "always", `${kind} reads as Always on`);
  assert.equal(reachEdit.useKindFor("spent", "toggle"), "once", "Used up on a toggle writes once");
  assert.equal(reachEdit.useKindFor("spent", ""), "once");
  assert.equal(reachEdit.useKindFor("toggle", "fuse"), "toggle");
  assert.equal(reachEdit.useKindFor("always", "toggle"), null, "Always on writes no kind");
  assert.deepEqual(Object.keys(vocab.ITEM_RUN_ACTIVATIONS).filter((kind) => reachEdit.useOptionOf(kind) === "spent"), ["once", "fuse", "consume"], "every activation kind the vocabulary knows has an option");
});

await t("the vocabularies hold exactly the keys the logic reads", () => {
  assert.deepEqual(Object.keys(vocab.REACH_PULSES), ["action", "turnStart+moveIn", "turnStart+enter", "standing", "burst"]);
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
  assert.deepEqual(logic.readFilter({ kinds: new Set(["A", " "]), exceptKinds: ["", "B "], unit: "stranger", side: "opposing" }), { kinds: ["a"], exceptKinds: ["b"], side: "opposing", unit: "any", self: "no" });
  assert.deepEqual(logic.readFilter(null), { kinds: [], exceptKinds: [], side: "any", unit: "any", self: "no" });
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
const holder = { id: "R9", hidden: false, parent: scene, attachment: { token: bearerTok }, _source: { attachment: { token: "bt" } }, behaviors: [] };
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
    await reach.dispatchReachMoment({ ...sys(), region: { ...holder, attachment: { token: "bt" }, _source: undefined } }, "enter", walker);
    assert.equal(got.length, 1, "a Region whose attachment holds the id, as the server's does, reaches its bearer as well");
    got.length = 0;
    await reach.dispatchReachMoment({ ...cfg }, "enter", walker);
    await reach.dispatchReachMoment(sys({ rowKey: "gone" }), "enter", walker);
    await reach.dispatchReachMoment(sys({ sourceUuid: "I.none" }), "enter", walker);
    await reach.dispatchReachMoment(sys(), "enter", null);
    await reach.dispatchReachMoment({ ...sys(), region: { ...holder, attachment: { token: null }, _source: { attachment: { token: "absent" } } } }, "enter", walker);
    await reach.dispatchReachMoment({ ...sys(), region: { ...holder, attachment: { token: null }, _source: undefined } }, "enter", walker);
    await reach.dispatchReachMoment({ ...sys(), region: { ...holder, attachment: { token: "absent" }, _source: undefined } }, "enter", walker);
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
  for (const name of [constants.TURN_BEGAN_HOOK, "deleteRegion", "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createCombatant", "updateCombat", "deleteCombatant", "deleteCombat", "deleteToken", "updateToken"]) assert.equal(hooksSeen[name]?.length, 1, `${name} once`);

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
  assert.deepEqual(keysOf(field.fields.filter.fields.self), Object.keys(vocab.REACH_SELF));
  assert.ok(field.fields.filter.fields.kinds instanceof List && field.fields.filter.fields.exceptKinds instanceof List);
  assert.ok(field.fields.radius instanceof Schema, "the radius is a figure reference");
});

await t("a turn start asks a subject once per item kind, prunes the keys of an earlier initiative, and reads the bearer's own attached reach only where its filter counts it", async () => {
  const turnBegan = hooksSeen[constants.TURN_BEGAN_HOOK][0];
  const aura = (activationId, rowKey) => ({ type: AURA, system: sys({ activationId, rowKey }) });
  const row = (key, over = {}) => ({ key, reach: { pulse: "turnStart+moveIn", radius: { value: "20" }, filter: {}, ...over } });
  const itemOf = (uuid, rows, cookbookId) => ({ uuid, name: "Charm", type: "item", flags: { "acks-extras": { itemRun: { rows }, ...(cookbookId ? { cookbook: { id: cookbookId } } : {}) } } });
  const items = { "I.a": itemOf("I.a", [row("k")], "kind-1"), "I.b": itemOf("I.b", [row("k")], "kind-1"), "I.c": itemOf("I.c", [row("k")], "kind-2"), "I.s": itemOf("I.s", [row("k", { filter: { self: "count" } })], "kind-3") };
  const priorFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => items[uuid] ?? priorFrom(uuid);
  const walker = tokenOf("w", ["alpha"], { regions: new Set([holder]), parent: { regions: [holder], tokens: scene.tokens } });
  const combat = { id: "c1", round: 2, turn: 1, combatants: { get: (id) => (id === "cm1" ? { token: walker } : id === "cmb" ? { token: bearerTok } : undefined) } };
  const heard = [];
  const answers = [];
  reach.setReachHandler((ctx) => { heard.push([ctx.moment, ctx.subject.token.id, ctx.item.uuid]); return answers.shift() ?? null; });
  const behaviorOf = (uuid, activationId) => ({ type: AURA, system: sys({ sourceUuid: uuid, activationId, rowKey: "k" }) });
  try {
    seat(true);
    holder.behaviors = [behaviorOf("I.a", "a1"), behaviorOf("I.b", "a2"), behaviorOf("I.c", "a3")];
    answers.push("prompt");
    await turnBegan(combat, "cm1");
    assert.deepEqual(heard, [["turnStart", "w", "I.a"], ["turnStart", "w", "I.c"]], "the second reach of kind-1 is not asked once the first settled it; kind-2 is its own kind");
    heard.length = 0;
    answers.push(null, "skip");
    await turnBegan(combat, "cm1");
    assert.deepEqual(heard.map((h) => h[2]), ["I.a", "I.b", "I.c"], "a reach that settles nothing leaves the kind to the next");
    heard.length = 0;
    answers.push("held");
    await turnBegan(combat, "cm1");
    assert.deepEqual(heard.map((h) => h[2]), ["I.a", "I.c"], "a prompt already held settles the kind too");

    // The held keys of another initiative go at a turn start; one held outside a fight stays.
    assert.equal(reach.holdReachMoment("c1:1:0:T.w:kind-1", "c1:1:0"), true);
    assert.equal(reach.holdReachMoment("T.w:kind-9", null), true);
    assert.equal(reach.holdReachMoment("c1:2:1:T.w:kind-1", "c1:2:1"), true);
    await turnBegan(combat, "cm1");
    assert.equal(reach.holdReachMoment("c1:1:0:T.w:kind-1", "c1:1:0"), true, "pruned, so free to hold again");
    assert.equal(reach.holdReachMoment("T.w:kind-9", null), false, "outside a fight it stays until answered");
    assert.equal(reach.holdReachMoment("c1:2:1:T.w:kind-1", "c1:2:1"), false, "this initiative's stays");
    assert.equal(reach.releaseReachMoment("T.w:kind-9"), true);
    assert.equal(reach.holdReachMoment("T.w:kind-9", null), true, "answered, it can be held again");
    reach.releaseReachMoment("T.w:kind-9");

    // The bearer: its attached reach is read at its own turn start only where the filter counts it in.
    holder.behaviors = [];
    const attach = (uuid) => {
      const region = { id: "RA", hidden: false, parent: scene, attachment: { token: bearerTok }, _source: { attachment: { token: "bt" } } };
      region.behaviors = [{ type: AURA, system: { ...cfg, sourceUuid: uuid, rowKey: "k", region } }];
      return region;
    };
    bearerTok.attachments = { regions: new Set([attach("I.a")]) };
    heard.length = 0;
    await turnBegan(combat, "cmb");
    assert.deepEqual(heard, [], "a reach that does not count the bearer in is not read at its turn start");
    bearerTok.attachments = { regions: new Set([attach("I.s")]) };
    await turnBegan(combat, "cmb");
    assert.deepEqual(heard, [["turnStart", "bt", "I.s"]], "counted in: the bearer's own turn start reads its attached reach");
  } finally {
    holder.behaviors = [];
    delete bearerTok.attachments;
    globalThis.fromUuidSync = priorFrom;
    reach.setReachHandler(null);
    seat(false);
  }
});

await t("every pulse the vocabulary held before answers as it did: onTurn is read by turnStart+enter alone", () => {
  const act = (pulse, moment, admitted, immune, onTurn) => logic.pulseAct({ pulse, moment, admitted, immune, onTurn });
  const pinned = {
    action: { press: ["prompt", "skip"], enter: ["none", "none"] },
    "turnStart+moveIn": { turnStart: ["prompt", "skip"], moveIn: ["prompt", "skip"], enter: ["list", "list"], exit: ["out", "out"] },
    standing: { enter: ["on", "on"], exit: ["off", "off"], moveIn: ["none", "none"] },
    burst: { burst: ["prompt", "skip"] },
  };
  for (const [pulse, moments] of Object.entries(pinned)) {
    for (const [moment, [open, immune]] of Object.entries(moments)) {
      for (const onTurn of [false, true, undefined]) {
        assert.equal(act(pulse, moment, true, false, onTurn), open, `${pulse} ${moment} onTurn ${onTurn}`);
        assert.equal(act(pulse, moment, true, true, onTurn), immune, `${pulse} ${moment} immune onTurn ${onTurn}`);
      }
    }
  }
  assert.equal(act("turnStart+moveIn", "enter", false, false, true), "refuse");
  assert.equal(act("turnStart+moveIn", "enter", null, false, true), "undetermined");
});

await t("turnStart+enter prompts at a turn start, and on an enter only for the combatant whose turn it is", () => {
  const act = (moment, admitted = true, immune = false, onTurn) => logic.pulseAct({ pulse: "turnStart+enter", moment, admitted, immune, onTurn });
  assert.equal(act("turnStart"), "prompt");
  assert.equal(act("turnStart", true, true), "skip", "an immune subject is skipped");
  assert.equal(act("turnStart", false), "none");
  assert.equal(act("turnStart", null), "undetermined");
  assert.equal(act("enter", true, false, true), "prompt", "walking in on its own turn asks at once");
  assert.equal(act("enter", true, true, true), "skip");
  assert.equal(act("enter", false, false, true), "none");
  assert.equal(act("enter", null, false, true), "undetermined");
  assert.equal(act("enter", true, false, false), "none", "walking in on another's turn waits for its own");
  assert.equal(act("enter", true), "none", "onTurn is off unless said");
  assert.equal(act("enter", null, false, false), "none", "no prompt and no listing off its turn");
  for (const moment of ["moveIn", "exit", "press", "burst"]) assert.equal(act(moment, true, false, true), "none", `${moment} is no moment of this pulse`);
  assert.equal(logic.readReach({ pulse: "turnStart+enter" }).pulse, "turnStart+enter", "a stored reach with this pulse reads");
});

await t("engagement fails for a hidden side or a helpless bearer, and reads the conditions through conditionSet so what paralysis implies counts", async () => {
  const { conditionSet } = await import("../scripts/lib/conditions.mjs");
  const held = (statuses) => ({ token: { id: "x" }, actor: { statuses: new Set(statuses) } });
  const conditionsOf = (actor) => conditionSet(actor?.statuses ?? []);
  const holds = (b, s) => logic.engagementHolds(held(b), held(s), { conditionsOf });
  assert.equal(holds([], []), true, "two bodies in the open engage");
  assert.equal(holds(["hidden"], []), false, "a hidden bearer engages nobody");
  assert.equal(holds([], ["hidden"]), false, "a hidden subject is engaged by nobody");
  assert.equal(holds(["helpless"], []), false, "a helpless bearer engages nobody");
  assert.equal(holds(["paralyzed"], []), false, "paralysis implies helpless");
  assert.equal(holds([], ["helpless"]), true, "a helpless subject can still be engaged");
  assert.equal(holds([], ["paralyzed"]), true);
  assert.equal(logic.engagementHolds(held([]), held([])), true, "no reader of conditions reads none");
  assert.equal(logic.engagementHolds(null, null, { conditionsOf }), true, "no bodies hold nothing");
});

await t("one verdict from many bearers: any true wins, else any null, else false", () => {
  assert.equal(logic.groupVerdict([false, true, null]), true);
  assert.equal(logic.groupVerdict([false, null, false]), null);
  assert.equal(logic.groupVerdict([false, undefined]), null, "no answer is unsettled");
  assert.equal(logic.groupVerdict([false, false]), false);
  assert.equal(logic.groupVerdict([]), false);
  assert.equal(logic.groupVerdict(undefined), false);
  assert.equal(logic.groupVerdict([null]), null);
});

await t("a reach reads its lasts figure and its engaged flag, and a figure reference names one only with a value or a whole address", () => {
  const read = logic.readReach({ pulse: "turnStart+enter", lasts: { value: "3" }, engaged: true, immunity: { value: "2" } });
  assert.deepEqual(read.lasts, { value: "3" });
  assert.equal(read.engaged, true);
  assert.equal(logic.readReach({ pulse: "standing" }).lasts, null);
  assert.equal(logic.readReach({ pulse: "standing" }).engaged, false);
  assert.equal(logic.readReach({ pulse: "standing", engaged: "yes" }).engaged, false, "only true engages");
  assert.equal(logic.namesFigure({ value: "3" }), true);
  assert.equal(logic.namesFigure({ value: 0 }), true);
  assert.equal(logic.namesFigure({ doc: "d", table: "t", row: "r", figure: "f" }), true);
  assert.equal(logic.namesFigure({ value: "", doc: "d", table: "t", row: "r", figure: "" }), false, "a cleaned reference that names nothing");
  assert.equal(logic.namesFigure({ value: "  " }), false);
  assert.equal(logic.namesFigure(null), false);
});

await t("a turn start settles a turnStart+enter kind once from every bearer's answer, carries who engaged, and a hidden or helpless bearer is none", async () => {
  const turnBegan = hooksSeen[constants.TURN_BEGAN_HOOK][0];
  const row = (pulse, over = {}) => ({ key: "k", reach: { pulse, radius: { value: "5" }, filter: { side: "opposing" }, ...over } });
  const itemOf = (uuid, rows, kind) => ({ uuid, name: "Gaze", type: "item", flags: { "acks-extras": { itemRun: { rows }, cookbook: { id: kind } } } });
  const items = {
    "I.e1": itemOf("I.e1", [row("turnStart+enter")], "kind-e"),
    "I.e2": itemOf("I.e2", [row("turnStart+enter")], "kind-e"),
    "I.e3": itemOf("I.e3", [row("turnStart+enter")], "kind-e"),
    "I.m1": itemOf("I.m1", [row("turnStart+moveIn")], "kind-m"),
    "I.m2": itemOf("I.m2", [row("turnStart+moveIn")], "kind-m"),
  };
  const priorFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => items[uuid] ?? priorFrom(uuid);
  const bearers = { b1: tokenOf("b1", undefined, { disposition: 1 }), b2: tokenOf("b2", undefined, { disposition: 1 }), b3: tokenOf("b3", undefined, { disposition: 1 }) };
  const world = { tokens: { get: (id) => bearers[id] ?? null }, regions: [] };
  const holderOf = (id, uuids) => ({ id: `R.${id}`, hidden: false, parent: world, attachment: { token: bearers[id] }, _source: { attachment: { token: id } }, behaviors: uuids.map((u) => ({ type: AURA, system: { ...cfg, sourceUuid: u, rowKey: "k", activationId: `act-${u}`, region: null } })) });
  const heard = [];
  reach.setReachHandler((ctx) => { heard.push({ moment: ctx.moment, subject: ctx.subject.token.id, item: ctx.item.uuid, admitted: ctx.admitted, engagedBy: ctx.engagedBy }); return "prompt"; });
  const run = async (regions, subject) => {
    const walker = tokenOf("w", undefined, { regions: new Set(regions), parent: { regions, tokens: world.tokens }, actor: { ...monsterActor(undefined), statuses: new Set(subject) } });
    for (const region of regions) for (const behavior of region.behaviors) behavior.system.region = region;
    heard.length = 0;
    await turnBegan({ id: "c1", round: 1, turn: 0, combatants: { get: () => ({ token: walker }) } }, "cm");
    return heard.map((h) => ({ ...h }));
  };
  try {
    seat(true);
    const r1 = holderOf("b1", ["I.e1"]);
    const r2 = holderOf("b2", ["I.e2"]);
    const r3 = holderOf("b3", ["I.e3"]);
    let got = await run([r1, r2, r3], []);
    assert.equal(got.length, 1, "three bearers of one kind ask a subject once");
    assert.deepEqual([got[0].moment, got[0].admitted, got[0].engagedBy], ["turnStart", true, ["T.b1", "T.b2", "T.b3"]], "every admitting bearer is named, in the order met");

    bearers.b2.actor = { ...bearers.b2.actor, statuses: new Set(["helpless"]) };
    got = await run([r1, r2, r3], []);
    assert.deepEqual(got.map((g) => g.engagedBy), [["T.b1", "T.b3"]], "a helpless bearer engages nobody");
    bearers.b1.actor = { ...bearers.b1.actor, statuses: new Set(["hidden"]) };
    bearers.b3.actor = { ...bearers.b3.actor, statuses: new Set(["paralyzed"]) };
    got = await run([r1, r2, r3], []);
    assert.deepEqual(got.map((g) => [g.admitted, g.engagedBy]), [[false, []]], "no bearer engages: one dispatch, admitted false, nobody named");
    bearers.b1.actor = monsterActor(undefined);
    bearers.b2.actor = monsterActor(undefined);
    bearers.b3.actor = monsterActor(undefined);
    got = await run([r1], ["hidden"]);
    assert.deepEqual(got.map((g) => g.admitted), [false], "a hidden subject is engaged by nobody");

    // A bearer the filter cannot settle (a neutral one) is null for the group where no other admits.
    const priorDisposition = bearers.b1.disposition;
    bearers.b1.disposition = 0;
    got = await run([r1], []);
    assert.deepEqual(got.map((g) => [g.admitted, g.engagedBy]), [[null, []]], "unsettled: null, and nobody named");
    got = await run([r1, r2], []);
    assert.deepEqual(got.map((g) => [g.admitted, g.engagedBy]), [[true, ["T.b2"]]], "one bearer admitting settles it for the group");
    assert.equal(got[0].item, "I.e2", "the handler is handed the admitting bearer's reach, not the first met");
    // With none admitting, the lead is the first the filter could not settle, ahead of one that refused.
    bearers.b1.actor = { ...bearers.b1.actor, statuses: new Set(["helpless"]) };
    bearers.b1.disposition = priorDisposition;
    bearers.b2.disposition = 0;
    got = await run([r1, r2], []);
    assert.deepEqual(got.map((g) => [g.item, g.admitted, g.engagedBy]), [["I.e2", null, []]], "the unsettled bearer leads over the one that refused");
    bearers.b1.actor = monsterActor(undefined);
    bearers.b2.disposition = priorDisposition;
    bearers.b1.disposition = priorDisposition;

    // The other pulse's serial loop is untouched: two bearers of one kind are offered in turn and the first prompt settles the kind.
    const m1 = holderOf("b1", ["I.m1"]);
    const m2 = holderOf("b2", ["I.m2"]);
    got = await run([m1, m2], []);
    assert.deepEqual(got.map((g) => [g.item, g.engagedBy]), [["I.m1", undefined]], "E4's reaches settle on the first prompt and carry no engagedBy");
    // Mixed on one body: each pulse keeps its own handling.
    got = await run([m1, m2, r1, r2], []);
    assert.deepEqual(got.map((g) => g.item), ["I.m1", "I.e1"], "the serial kind first, then one dispatch for the engaging kind");
    assert.equal(got[1].engagedBy.length, 2);
  } finally {
    globalThis.fromUuidSync = priorFrom;
    reach.setReachHandler(null);
    seat(false);
  }
});

await t("an engaged reach is made once for a started combat's bearer, always-on only, hidden and downed bodies skipped, with the lines told once per combat", async () => {
  const { feetToUnits } = await import("../scripts/lib/distance-units.mjs");
  const priors = { combats: globalThis.game.combats, users: [...globalThis.game.users], config: globalThis.CONFIG, data: globalThis.foundry.data, chat: globalThis.ChatMessage, from: globalThis.fromUuidSync, ui: globalThis.ui };
  const chat = [];
  const asked = [];
  const goneIds = [];
  globalThis.ChatMessage = { create: async (data) => { chat.push(data); } };
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  globalThis.game.users.push({ id: "gm1", isGM: true }, { id: "pl1", isGM: false });
  globalThis.foundry.data = { ...priors.data, EmanationShapeData: class {} };
  const build = (over = {}) => ({
    Region: {
      documentClass: {
        schema: { fields: { attachment: { fields: { token: {} } } } },
        createTokenEmanation: async (token, radius, data, options) => {
          await tick();
          if (over.refuse) throw new Error("no permission");
          const region = { id: `R${asked.length + 1}`, parent: token.parent, behaviors: data.behaviors.map((b) => ({ type: b.type, system: b.system })), delete: async () => { token.parent.regions.delete(region.id); token.attachments.regions.delete(region); goneIds.push(region.id); } };
          asked.push({ token, radius, data, options, region });
          token.parent.regions.set(region.id, region);
          token.attachments.regions.add(region);
          return region;
        },
        ...over.creator,
      },
    },
    specialStatusEffects: {},
  });
  globalThis.CONFIG = build();
  const sceneOf = (id, distance = 5, units = "ft") => ({ id, grid: { distance, units }, regions: new Map() });
  const engagedRow = (over = {}) => ({ key: "eng", reach: { pulse: "turnStart+enter", engaged: true, showReach: false, filter: {}, ...over } });
  const abilityOf = (uuid, rows) => ({ uuid, name: `Trait ${uuid}`, type: "ability", flags: { "acks-extras": { extras: { effects: rows } } } });
  const toggleOf = (uuid, rows) => ({ uuid, name: `Toggle ${uuid}`, type: "item", flags: { "acks-extras": { itemRun: { activation: { kind: "toggle", state: {} }, rows } } } });
  const tokenWith = (scene, id, items, over = {}) => {
    const actor = { uuid: `A.${id}`, isToken: false, items };
    for (const item of items) item.actor = actor;
    const token = { id, uuid: `T.${id}`, name: `Tok ${id}`, hidden: false, actorLink: true, parent: scene, actor, baseActor: { system: { hp: { value: 5, max: 9 } }, statuses: new Set() }, attachments: { regions: new Set() }, ...over };
    actor.getDependentTokens = () => [token];
    return token;
  };
  const combatOf = (id, tokens, { started = true } = {}) => {
    const combat = { id, started, combatants: [] };
    combat.combatants = tokens.map((token) => ({ id: `c.${token.id}`, name: `Row ${token.id}`, tokenId: token.id, sceneId: token.parent.id, token, actor: token.actor, combat }));
    return combat;
  };
  const lookup = new Map();
  const index = (...tokens) => { for (const tok of tokens) { lookup.set(tok.uuid, tok); for (const item of tok.actor.items) lookup.set(item.uuid, item); } };
  globalThis.fromUuidSync = (uuid) => lookup.get(uuid) ?? null;
  const liveRegions = (token) => [...token.attachments.regions];
  const readAura = logic.readAuraConfig;
  const lines = () => chat.splice(0).map((c) => c.content);
  const NONE = { made: 0, skipped: 0, scaleMismatch: false };
  seat(true);
  try {
    const scene = sceneOf("S1");
    const trait = abilityOf("I.a", [engagedRow()]);
    const ticked = abilityOf("I.b", [engagedRow({ showReach: true })]);
    const standing = abilityOf("I.q", [{ key: "plain", reach: { pulse: "standing", radius: { value: "20" }, filter: {} } }]);
    const bearer = tokenWith(scene, "a", [trait]);
    const shown = tokenWith(scene, "b", [ticked]);
    const plain = tokenWith(scene, "p", [standing]);
    const toggler = tokenWith(scene, "t", [toggleOf("I.t", [engagedRow()])]);
    index(bearer, shown, plain, toggler);
    const combat = combatOf("C1", [bearer, shown, plain, toggler]);
    globalThis.game.combats = [combat];

    // The two readers: an always-on item has no activation, and an engaged activation id is this module's own shape.
    const { alwaysOn } = await import("../scripts/lib/item-run-logic.mjs");
    assert.deepEqual([alwaysOn(trait), alwaysOn(toggleOf("I.t2", [])), alwaysOn(null), alwaysOn({ type: "spell", flags: {} })], [true, false, false, false]);
    assert.deepEqual([logic.isEngagedActivation(logic.engagedActivationId("x")), logic.isEngagedActivation("act1"), logic.isEngagedActivation("engaged:"), logic.isEngagedActivation(null)], [true, false, false, false]);

    // Made once, idempotent, and the four config fields.
    let got = await reach.ensureEngagedReaches(combat);
    assert.deepEqual(got, { made: 2, skipped: 0, scaleMismatch: false }, "the two engaged bodies; nothing for a standing reach or a toggle item (E3/E4/E9 untouched)");
    assert.equal(liveRegions(plain).length + liveRegions(toggler).length, 0, "no Region for an item with an activation, nor for a reach that is not engaged");
    assert.deepEqual(lines(), [], "silent where nothing is told");
    const config = readAura(liveRegions(bearer)[0].behaviors[0].system);
    assert.ok(config, "all four fields read");
    assert.deepEqual([config.sourceUuid, config.bearerUuid, config.rowKey], ["I.a", "A.a", "eng"]);
    assert.ok(logic.isEngagedActivation(config.activationId), "a per-Region id of its own, never a toggle state");
    assert.notEqual(readAura(liveRegions(shown)[0].behaviors[0].system).activationId, config.activationId, "one id per Region");
    assert.deepEqual(await reach.ensureEngagedReaches(combat), NONE, "idempotent");
    assert.equal(asked.length, 2);
    assert.equal(asked[0].data.visibility, 1, "an unticked showReach is GM-visible");
    assert.equal(asked[1].data.visibility, 2, "a ticked one is everyone's");
    assert.deepEqual([asked[0].options.gridBased, asked[0].data.hidden], [true, false]);

    // The radius goes through feetToUnits, on a feet scene and on a metre scene.
    assert.equal(asked[0].radius, 5, "feet scene: the adjacent square's feet");
    const metres = sceneOf("S2", 1.5, "m");
    const mBearer = tokenWith(metres, "m", [abilityOf("I.m", [engagedRow()])]);
    index(mBearer);
    const mCombat = combatOf("C2", [mBearer]);
    await reach.ensureEngagedReaches(mCombat);
    assert.equal(asked.at(-1).radius, feetToUnits(5, "m"), "metre scene: the feet converted to the scene's unit");
    assert.ok(Math.abs(asked.at(-1).radius - 1.524) < 0.001);
    lines();

    // A second call made while the first is still creating makes no second Region.
    const racer = tokenWith(scene, "r", [abilityOf("I.r", [engagedRow()])]);
    index(racer);
    const rCombat = combatOf("C3", [racer]);
    const before = asked.length;
    const [first, second] = await Promise.all([reach.ensureEngagedReaches(rCombat), reach.ensureEngagedReaches(rCombat, { combatants: rCombat.combatants })]);
    assert.equal(asked.length - before, 1, "two un-awaited calls, one create");
    assert.equal(first.made + second.made, 1);

    // A combat not begun makes none, and a combat with no such row is silent.
    const idle = tokenWith(scene, "i", [abilityOf("I.i", [engagedRow()])]);
    index(idle);
    assert.deepEqual(await reach.ensureEngagedReaches(combatOf("C4", [idle], { started: false })), NONE);
    assert.deepEqual(await reach.ensureEngagedReaches(combatOf("C5", [plain, toggler])), NONE);
    seat(false);
    assert.deepEqual(await reach.ensureEngagedReaches(combatOf("C6", [idle])), NONE, "off the primary GM's window nothing is made");
    seat(true);
    assert.deepEqual([liveRegions(idle).length, lines().length], [0, 0]);

    // A downed bearer and a hidden one are skipped silently.
    const downed = tokenWith(scene, "d", [abilityOf("I.d", [engagedRow()])]);
    downed.baseActor.system.hp.value = 0;
    const hiding = tokenWith(scene, "h", [abilityOf("I.h", [engagedRow()])], { hidden: true });
    index(downed, hiding);
    assert.deepEqual(await reach.ensureEngagedReaches(combatOf("C7", [downed, hiding])), { made: 0, skipped: 2, scaleMismatch: false });
    assert.deepEqual([liveRegions(downed).length, liveRegions(hiding).length, lines().length], [0, 0, 0], "no Region, no line");

    // A scene whose square is not the engagement square: one whispered line per combat.
    const wide = sceneOf("S3", 10, "ft");
    const wBearer = tokenWith(wide, "w", [abilityOf("I.w", [engagedRow()])]);
    index(wBearer);
    const wCombat = combatOf("C8", [wBearer]);
    assert.deepEqual(await reach.ensureEngagedReaches(wCombat), { made: 1, skipped: 0, scaleMismatch: true });
    const told = chat.splice(0);
    assert.equal(told.length, 1);
    assert.ok(told[0].content.includes("aura.engaged.scale"), "the scale line");
    assert.deepEqual(told[0].whisper, ["gm1"], "the Judges alone");
    assert.equal((await reach.ensureEngagedReaches(wCombat)).scaleMismatch, true, "the fact is returned every call");
    assert.equal(chat.length, 0, "the line is told once for the combat");
    await reach.ensureEngagedReaches(combatOf("C9", [wBearer]));
    assert.equal(chat.splice(0).length, 1, "another combat is told once again");
    await hooksSeen.deleteCombat[0](wCombat);
    await tick();
    await reach.ensureEngagedReaches(wCombat);
    assert.equal(chat.splice(0).length, 1, "a combat's lines are forgotten when it is deleted");
    assert.equal((await reach.ensureEngagedReaches(combatOf("C10", [tokenWith(wide, "n", [abilityOf("I.n", [])])]))).scaleMismatch, false, "a scene with no engaged body is no mismatch");
    assert.equal(chat.length, 0);

    // A refusal is one Judge line per combat: no token, and Foundry refusing the Region.
    const tokenless = tokenWith(scene, "z", [abilityOf("I.z", [engagedRow()])]);
    const nCombat = combatOf("C11", [tokenless]);
    nCombat.combatants[0].token = null;
    assert.deepEqual(await reach.ensureEngagedReaches(nCombat), NONE);
    assert.ok(lines()[0].includes("aura.engaged.noToken"));
    await reach.ensureEngagedReaches(nCombat);
    assert.equal(chat.length, 0, "once per combat");
    const refusing = tokenWith(scene, "f", [abilityOf("I.f", [engagedRow()])]);
    index(refusing);
    globalThis.CONFIG = build({ refuse: true });
    const fCombat = combatOf("C12", [refusing]);
    const errors = await quiet(async () => {
      assert.equal((await reach.ensureEngagedReaches(fCombat)).made, 0);
      await reach.ensureEngagedReaches(fCombat);
    });
    assert.ok(errors.some((line) => line.includes("could not be made")));
    const refusedLines = lines();
    assert.equal(refusedLines.length, 1, "one line per combat for a refusal");
    assert.ok(refusedLines[0].includes("aura.engaged.denied"));
    assert.equal(liveRegions(refusing).length, 0);
    globalThis.CONFIG = build({ creator: { createTokenEmanation: undefined } });
    await reach.ensureEngagedReaches(combatOf("C13", [refusing]));
    assert.ok(lines()[0].includes("aura.refused.unsupported"), "a build without what a reach is made of");
    globalThis.CONFIG = build();

    // Teardown. A raised toggle's reach on the same body stays through every path.
    const raisedToggle = (token) => {
      const r = { id: `RT${token.id}`, parent: token.parent, behaviors: [{ type: AURA, system: { sourceUuid: "I.t", bearerUuid: "A.t", activationId: "act-toggle", rowKey: "k" } }], delete: async () => { token.parent.regions.delete(r.id); token.attachments.regions.delete(r); goneIds.push(r.id); } };
      token.parent.regions.set(r.id, r);
      token.attachments.regions.add(r);
      return r;
    };
    const kept = raisedToggle(bearer);
    const engagedOn = (token) => liveRegions(token).filter((r) => logic.isEngagedActivation(readAura(r.behaviors[0].system)?.activationId)).length;
    const hook = async (name, ...args) => { await hooksSeen[name][0](...args); await tick(); };
    const other = combatOf("COther", [bearer]);
    globalThis.game.combats = [combat, other];
    assert.equal(engagedOn(bearer), 1);
    await hook("deleteCombatant", combat.combatants[0]);
    assert.equal(engagedOn(bearer), 1, "the token is a combatant of another started combat, so its Region stays");
    other.started = false;
    await hook("deleteCombatant", combat.combatants[0]);
    assert.equal(engagedOn(bearer), 0, "the combatant left and no other fight holds it");
    assert.ok(liveRegions(bearer).includes(kept), "a raised toggle's Region on the same token stays");
    other.started = true;
    await reach.ensureEngagedReaches(combat);
    assert.equal(engagedOn(bearer), 1, "made again");
    await hook("deleteCombat", combat);
    assert.equal(engagedOn(bearer), 1, "deleteCombat keeps what another started combat holds");
    globalThis.game.combats = [];
    await hook("deleteCombat", combat);
    assert.deepEqual([engagedOn(bearer), engagedOn(shown)], [0, 0], "deleteCombat lowers every combatant's Region");
    assert.ok(liveRegions(bearer).includes(kept), "and a toggle's Region survives it");
    globalThis.game.combats = [combat];
    await reach.ensureEngagedReaches(combat);
    await hook("deleteToken", bearer);
    assert.equal(engagedOn(bearer), 0, "deleting the token lowers its engaged Region");
    assert.ok(liveRegions(bearer).includes(kept));
    await reach.ensureEngagedReaches(combat);
    const cascaded = liveRegions(bearer).find((r) => r !== kept);
    scene.regions.delete(cascaded.id);
    goneIds.length = 0;
    assert.deepEqual(await quiet(() => hook("deleteToken", bearer)), [], "no error for a Region core already deleted with its token");
    assert.deepEqual(goneIds, [], "and no second delete");
    scene.regions.set(cascaded.id, cascaded);
    seat(false);
    await hook("deleteToken", bearer);
    await hook("deleteCombatant", combat.combatants[0]);
    await hook("deleteCombat", combat);
    assert.equal(engagedOn(bearer), 1, "off the primary GM's window nothing is lowered");
    seat(true);

    // The bearer going down lowers it, and its revival makes it again.
    const hp = (value) => { bearer.baseActor.system.hp.value = value; };
    hp(0);
    await hook("updateActor", bearer.actor, { system: { hp: { value: 0 } } });
    assert.equal(engagedOn(bearer), 0, "down: lowered");
    assert.deepEqual(await reach.ensureEngagedReaches(combat), { made: 0, skipped: 1, scaleMismatch: false }, "and not made while it is down");
    hp(5);
    await hook("updateActor", bearer.actor, { system: { hp: { value: 5 } } });
    assert.equal(engagedOn(bearer), 1, "revived: the reach is ensured again");
    await hook("updateActor", bearer.actor, { system: { hp: { value: 5 } } });
    assert.equal(engagedOn(bearer), 1, "and a second ensure makes no second");
    // The defeated status lowers it, and its removal or disabling restores it; a disabled effect is ignored on the way down.
    const dead = (over = {}) => ({ disabled: false, statuses: new Set(["dead"]), parent: bearer.actor, ...over });
    bearer.baseActor.statuses = new Set(["dead"]);
    await hook("createActiveEffect", dead());
    assert.equal(engagedOn(bearer), 0, "the defeated status lowers it");
    await hook("updateActiveEffect", dead({ disabled: true }));
    assert.equal(engagedOn(bearer), 0, "still down: its actor holds the status");
    bearer.baseActor.statuses = new Set();
    await hook("updateActiveEffect", dead({ disabled: true }));
    assert.equal(engagedOn(bearer), 1, "an effect disabled, the actor up: restored");
    bearer.baseActor.statuses = new Set(["dead"]);
    await hook("createActiveEffect", dead());
    assert.equal(engagedOn(bearer), 0);
    bearer.baseActor.statuses = new Set();
    await hook("deleteActiveEffect", dead({ disabled: true }));
    assert.equal(engagedOn(bearer), 1, "a deleted defeated effect, disabled or not, restores it");
    await hook("deleteActiveEffect", { disabled: false, statuses: new Set(["prone"]), parent: bearer.actor });
    assert.equal(engagedOn(bearer), 1);
    // A bearer revealed mid-fight has it made; a hide changes nothing.
    await reach.lowerEngagedReaches(bearer);
    bearer.hidden = true;
    await hook("updateToken", bearer, { hidden: true });
    assert.equal(engagedOn(bearer), 0);
    bearer.hidden = false;
    await hook("updateToken", bearer, { hidden: false });
    assert.equal(engagedOn(bearer), 1, "revealed: the reach is made");
    await hook("updateToken", bearer, { x: 5 });
    assert.equal(engagedOn(bearer), 1);
    // A combatant joining a started combat has its own made; a round change ensures the whole combat, a turn change does not.
    const late = tokenWith(scene, "l", [abilityOf("I.l", [engagedRow()])]);
    index(late);
    const [member] = combatOf("C20", [late]).combatants;
    member.combat = combat;
    await hook("createCombatant", member);
    assert.equal(engagedOn(late), 1, "createCombatant makes the joiner's reach");
    await reach.lowerEngagedReaches(late);
    combat.combatants.push(member);
    await hook("updateCombat", combat, { turn: 3 });
    assert.equal(engagedOn(late), 0, "a turn change makes nothing");
    await hook("updateCombat", combat, { round: 2 });
    assert.equal(engagedOn(late), 1, "a round change ensures the combat");
    seat(false);
    await reach.lowerEngagedReaches(late);
    await hook("createCombatant", member);
    await hook("updateCombat", combat, { round: 3 });
    assert.equal(engagedOn(late), 0, "off the primary GM's window neither hook makes");
    seat(true);
  } finally {
    seat(false);
    globalThis.game.combats = priors.combats;
    globalThis.game.users.splice(0, globalThis.game.users.length, ...priors.users);
    globalThis.CONFIG = priors.config;
    globalThis.foundry.data = priors.data;
    globalThis.ChatMessage = priors.chat;
    globalThis.fromUuidSync = priors.from;
    globalThis.ui = priors.ui;
  }
});

console.log(`\ntest-aura-reach: ${passed} checks passed.`);
