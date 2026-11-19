/**
 * The entry step and the Judges' hazard card (`scripts/formation/hazard-entry-logic.mjs`
 * and the card `hazard-entry.mjs` draws from it). Foundry's globals are stand-ins,
 * the places and their things are invented in the shape lib's `normalizeThings`
 * returns, and no book is imported, so no figure here is a printed one.
 *
 * What this pins: a place is newly entered when it is under the party now and
 * not in the list the last move left, so one left and entered again posts again;
 * a place posts only when it holds an obstacle whose hazard resolves, and one
 * holding only traps or conditions posts nothing; a row carries the figures its
 * kind's setup offers, blank as null; conditions are listed once each and a
 * hidden thing is listed, marked; Begin's seed is picked by place and thing
 * together (two places both hold `thing-1`) with the conditions of every place
 * the party stands in unioned, and is null for a place the party has left; a halt
 * is a found or sprung wall in `runTrapCheck`'s results and nothing else; the
 * card names the Begin button's three ids, cites the page the crossing setup
 * cites for each figure, and every lang key the card reads exists.
 *
 * Run: node tools/test-hazard-entry.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
class Stub {}
const field = (kind) => class { constructor(options = {}) { this.kind = kind; this.options = options; } };
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
/** A lang key's text: the file holds flat dotted keys and nested blocks. */
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};
const format = (key, data = {}) => String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (_, name) => data[name] ?? `{${name}}`);

globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class { static defineSchema() { return {}; } } },
  data: {
    regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } },
    fields: { StringField: field("string"), HTMLField: field("html") },
    operators: { ForcedReplacement: { create: (value) => value }, ForcedDeletion: class {} },
  },
  utils: {
    deepClone: (v) => JSON.parse(JSON.stringify(v)),
    randomID: () => "id",
    escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    sheets: { ItemSheetV2: Stub },
    handlebars: {},
  },
};
globalThis.game = { i18n: { localize: (key) => String(lookup(key) ?? key), format, has: (key) => lookup(key) !== undefined }, user: { isGM: true } };
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

const logic = await import("../scripts/formation/hazard-entry-logic.mjs");
const { newlyEntered, moveHalted, entryModel, seedForThing, figureKeysOf, refsOf } = logic;
const { runEntryStep, entryCard, pressBegin, BEGIN_ACTION, PLACES_UNDER_FLAG } = await import("../scripts/formation/hazard-entry.mjs");
const { registerTable, resetTables, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");
const { hazardLabelKey } = await import("../scripts/formation/hazard-keys.mjs");
const { stackStops } = await import("../scripts/formation/trap-rules.mjs");

/** A thing in the normalized shape: every key present, `params` and `state` objects. */
const thing = (id, kind, ref, params = {}, hidden = false) => ({ id, kind, ref, hidden, hint: null, point: null, params, layers: {}, state: {} });
/** A resolver over invented refs: `ref:<key>` is the hazard with that key, anything else is no hazard. */
const hazardKeyOf = (ref) => (typeof ref === "string" && ref.startsWith("ref:") ? ref.slice(4) || null : null);
const obstacle = (id, key, params, hidden) => thing(id, "obstacle", `ref:${key}`, params, hidden);
const condition = (id, key, hidden) => thing(id, "condition", `ref:${key}`, {}, hidden);
const trap = (id) => thing(id, "trap", "Item.somewhere");
const place = (uuid, name, things) => ({ uuid, name, things });

/* --- newly entered ---------------------------------------------------------- */
await ok("newly entered is the places under the party now that the last move's list does not hold, in order", () => {
  assert.deepEqual(newlyEntered(["A", "B", "C"], ["B"]), ["A", "C"]);
  assert.deepEqual(newlyEntered(["A", "B"], ["A", "B"]), [], "a move inside the same places enters none");
  assert.deepEqual(newlyEntered(["A"], []), ["A"]);
  assert.deepEqual(newlyEntered(["A", "A", "B"], undefined), ["A", "B"], "no list yet reads as empty, and a place is named once");
  assert.deepEqual(newlyEntered([], ["A"]), [], "leaving a place enters nothing");
  assert.deepEqual(newlyEntered(null, null), []);
});

await ok("a place left and entered again is newly entered again", () => {
  let list = [];
  const walk = (now) => { const entered = newlyEntered(now, list); list = now; return entered; };
  assert.deepEqual(walk(["A"]), ["A"]);
  assert.deepEqual(walk(["A"]), []);
  assert.deepEqual(walk([]), []);
  assert.deepEqual(walk(["A"]), ["A"], "back in after a move out");
});

/* --- which places post, and what a row holds -------------------------------- */
await ok("only a place holding an obstacle posts; conditions and traps alone post nothing", () => {
  const places = [
    place("P1", "Pit", [obstacle("thing-1", "sheerClimb", { length: 40 })]),
    place("P2", "Wet", [condition("thing-1", "waterFast")]),
    place("P3", "Rigged", [trap("thing-1")]),
    place("P4", "Both", [trap("thing-1"), condition("thing-2", "ropeFixed"), obstacle("thing-3", "jump", { gap: 12 })]),
  ];
  const model = entryModel(places, hazardKeyOf, ["P1", "P2", "P3", "P4"]);
  assert.deepEqual(model.map((p) => p.uuid), ["P1", "P4"]);
  assert.deepEqual(entryModel(places, hazardKeyOf, ["P2", "P3"]), []);
  assert.deepEqual(entryModel(places, hazardKeyOf, ["P4"]).map((p) => p.uuid), ["P4"], "a place not newly entered is left out whatever it holds");
});

await ok("an obstacle whose hazard does not resolve, or names a condition key, is no row", () => {
  const model = entryModel([
    place("P1", "A", [thing("thing-1", "obstacle", "Compendium.gone.Item.x"), obstacle("thing-2", "ropeFixed")]),
    place("P2", "B", [obstacle("thing-1", "swim")]),
  ], hazardKeyOf, ["P1", "P2"]);
  assert.deepEqual(model.map((p) => p.uuid), ["P2"]);
});

await ok("a row carries the figures its kind's setup offers, blank as null", () => {
  assert.deepEqual(figureKeysOf("sheerClimb"), ["length", "depth"]);
  assert.deepEqual(figureKeysOf("jump"), ["gap", "depth"]);
  assert.deepEqual(figureKeysOf("squeeze"), ["length"]);
  assert.deepEqual(figureKeysOf("swim"), [], "the swim setup reads no length, gap or depth");
  assert.deepEqual(figureKeysOf("ropeFixed"), []);
  const [row] = entryModel([place("P1", "Pit", [obstacle("thing-1", "sheerClimb", { length: 40, depth: "" , gap: 7 })])], hazardKeyOf, ["P1"])[0].obstacles;
  assert.deepEqual(row.figures, [{ param: "length", value: 40 }, { param: "depth", value: null }], "a gap is no climb's figure, and a blank is null, never zero");
  const refused = entryModel([place("P1", "Pit", [obstacle("thing-1", "squeeze", { length: 0 })])], hazardKeyOf, ["P1"])[0].obstacles[0];
  assert.deepEqual(refused.figures, [{ param: "length", value: null }], "a figure the sheet's reader refuses reads as blank");
  assert.deepEqual([row.thingId, row.key, row.hidden], ["thing-1", "sheerClimb", false]);
});

await ok("conditions are listed once each, a hidden thing is listed and marked, and an all-hidden condition is hidden", () => {
  const [model] = entryModel([place("P1", "Pit", [
    obstacle("thing-1", "sheerClimb", {}, true),
    condition("thing-2", "ropeFixed"),
    condition("thing-3", "ropeFixed", true),
    condition("thing-4", "waterCold", true),
    condition("thing-5", "waterCold", true),
  ])], hazardKeyOf, ["P1"]);
  assert.equal(model.obstacles[0].hidden, true);
  assert.deepEqual(model.conditions, [{ key: "ropeFixed", hidden: false }, { key: "waterCold", hidden: true }]);
});

await ok("every ref is named once for the caller to resolve", () => {
  assert.deepEqual(refsOf([place("P1", "A", [obstacle("thing-1", "jump"), obstacle("thing-2", "jump"), thing("thing-3", "body", "ref:body"), trap("thing-4")]), place("P2", "B", [condition("thing-1", "ropeFixed")])]).sort(), ["ref:jump", "ref:ropeFixed"], "a trap's or a body's ref is never resolved");
});

/* --- the seed a Begin opens ------------------------------------------------- */
await ok("the seed is picked by place and thing together, so two places holding thing-1 stay apart", () => {
  const places = [
    place("P1", "North", [obstacle("thing-1", "sheerClimb", { length: 40 })]),
    place("P2", "South", [obstacle("thing-1", "jump", { gap: 12 })]),
  ];
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P1", "thing-1"), { kind: "sheerClimb", setup: { length: 40 } });
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P2", "thing-1"), { kind: "jump", setup: { gap: 12 } });
});

await ok("the conditions of every place the party stands in are unioned into the pick", () => {
  const places = [
    place("P1", "Shaft", [obstacle("thing-1", "sheerClimb", { length: 40 }), condition("thing-2", "ropeFixed")]),
    place("P2", "Ledge", [condition("thing-1", "precarious"), condition("thing-2", "waterFast")]),
    place("P3", "Rope", [obstacle("thing-1", "jump", { gap: 9 }), condition("thing-2", "noRunUp")]),
  ];
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P1", "thing-1").setup, { length: 40, ropeFixed: true }, "the climb reads its own place's rope and no other place's jump or water facts");
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P3", "thing-1").setup, { gap: 9, ropeFixed: true, runUp: false, precarious: true }, "a jump takes a condition from another place");
});

await ok("the picks a place's obstacle states are seeded only through the options the caller passes", () => {
  const places = [place("P1", "Pool", [obstacle("thing-1", "swim", { penaltyPick: "larger", penaltyLarger: 15, movement: "running", judgeMod: 2 }), condition("thing-2", "waterRough")])];
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P1", "thing-1", { penaltyPicks: ["none", "larger"] }), { kind: "swim", setup: { penaltyPick: "larger", penaltyLarger: 15, waterRough: true } });
  assert.deepEqual(seedForThing(places, hazardKeyOf, "P1", "thing-1").setup, { waterRough: true }, "no options, no pick");
  const squeeze = [place("P1", "Gap", [obstacle("thing-1", "squeeze", { shape: "squeeze" })])];
  assert.deepEqual(seedForThing(squeeze, hazardKeyOf, "P1", "thing-1"), { kind: "squeeze", setup: { shape: "squeeze" } });
});

await ok("a place the party has left, a thing that is gone or one that is no obstacle seeds nothing", () => {
  const stands = [place("P1", "Pit", [obstacle("thing-1", "sheerClimb"), condition("thing-2", "ropeFixed")])];
  assert.equal(seedForThing(stands, hazardKeyOf, "P9", "thing-1"), null, "not under the party now");
  assert.equal(seedForThing(stands, hazardKeyOf, "P1", "thing-7"), null, "gone from the place");
  assert.equal(seedForThing(stands, hazardKeyOf, "P1", "thing-2"), null, "a condition begins nothing");
  assert.equal(seedForThing([], hazardKeyOf, "P1", "thing-1"), null);
  assert.deepEqual(seedForThing([stands[0], stands[0]], hazardKeyOf, "P1", "thing-1"), { kind: "sheerClimb", setup: { ropeFixed: true } }, "a place under the party twice counts once");
});

/* --- the halt rule ---------------------------------------------------------- */
await ok("a found or sprung wall halts the move; a zone, a crossed wall and an off-line find do not", () => {
  const wall = (outcome) => ({ outcome, placement: { kind: "wall" } });
  const zone = (outcome) => ({ outcome, placement: { kind: "zone" } });
  assert.equal(moveHalted({ outcome: "found", results: [wall("found")] }), true);
  assert.equal(moveHalted({ outcome: "sprung", results: [zone("crossed"), wall("sprung")] }), true, "a halt among several results");
  for (const outcome of ["crossed", "byHand"]) assert.equal(moveHalted({ outcome, results: [wall(outcome)] }), false, outcome);
  for (const outcome of ["found", "sprung"]) assert.equal(moveHalted({ outcome, results: [zone(outcome)] }), false, `a zone ${outcome}`);
  assert.equal(moveHalted({ outcome: "found", results: [] }), false, "a trap the sweep found off the line stops nothing");
  assert.equal(moveHalted({ outcome: null, results: [] }), false);
  assert.equal(moveHalted(null), false);
  assert.equal(moveHalted({ outcome: "found" }), false);
  for (const outcome of ["found", "sprung", "crossed"]) for (const kind of ["wall", "zone"]) {
    assert.equal(moveHalted({ results: [{ outcome, placement: { kind } }] }), stackStops({ outcome }, { kind }), `${kind} ${outcome} agrees with stackStops`);
  }
});

await ok("runTrapCheck's callback names the kind of placement each result came from", () => {
  const source = fs.readFileSync(new URL("../scripts/formation/trap-zone.mjs", import.meta.url), "utf8");
  assert.match(source, /return answer && \{ \.\.\.answer, placement: \{ kind: entry\.placement\.kind \} \};/);
});

/* --- the card --------------------------------------------------------------- */
await ok("the card names Begin's ids, cites the setup's own page for each figure and marks what is hidden", () => {
  const model = entryModel([place("Actor.p1", "Flooded <shaft>", [
    obstacle("thing-1", "sheerClimb", { length: 40 }, true),
    obstacle("thing-2", "swim"),
    obstacle("thing-3", "jump", {}),
    condition("thing-4", "ropeFixed"),
    condition("thing-5", "waterFast", true),
  ])], hazardKeyOf, ["Actor.p1"]);
  const html = entryCard({ id: "f1" }, model);
  assert.ok(html.includes(">The party reaches<") && html.includes(">To the Judges<"), "the banner");
  assert.ok(html.includes("Begin opens that crossing"), "the note");
  assert.ok(html.includes("Flooded &lt;shaft&gt;"), "the place's name, escaped");
  assert.equal((html.match(new RegExp(`data-action="${BEGIN_ACTION}"`, "g")) ?? []).length, 3, "a Begin per obstacle");
  assert.ok(html.includes('data-formation-id="f1" data-place-uuid="Actor.p1" data-thing-id="thing-1" data-place-name="Flooded &lt;shaft&gt;"'));
  assert.ok(html.includes("Length 40 ft · Depth —"), "a figure, and a blank as a dash");
  assert.ok(html.includes("Gap —"));
  assert.ok(html.includes(`${lookup("ACKS-FORMATION.crossing.ref.spelunking")}"`) && html.includes(`${lookup("ACKS-FORMATION.crossing.ref.jumping")}"`), "each tooltip ends in the page the setup cites");
  assert.ok(html.includes("Length, Depth"), "the tooltip names the params");
  assert.equal((html.match(/Hidden from players/g) ?? []).length, 2, "a hidden obstacle and a hidden condition");
  assert.ok(html.includes('class="acks-extras-roll-chip">') && html.includes(`>${lookup("ACKS-FORMATION.crossing.ropeFixed")}<`), "a chip per condition");
});

await ok("every lang key the card and Begin read exists", () => {
  const source = fs.readFileSync(new URL("../scripts/formation/hazard-entry.mjs", import.meta.url), "utf8");
  const keys = [...source.matchAll(/\bloc\("([\w.]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 15, `read ${keys.length} keys`);
  for (const key of [...keys, "param.length", "param.gap", "param.depth"]) assert.equal(typeof lookup(`ACKS-FORMATION.HAZARD_ENTRY.${key}`), "string", key);
  for (const ref of ["spelunking", "jumping", "swimming", "squeezing"]) assert.equal(typeof lookup(`ACKS-FORMATION.crossing.ref.${ref}`), "string", ref);
});

/* --- the step itself, over a stood-up party ---------------------------------- */
/** A document with a flag store, counting its flag writes. */
const flagged = (props, flags = {}) => ({
  ...props,
  flags,
  writes: 0,
  getFlag(scope, key) { return this.flags[`${scope}.${key}`]; },
  async setFlag(scope, key, value) { this.flags[`${scope}.${key}`] = value; this.writes += 1; },
});
const raw = (id, kind, key, params = {}) => ({ id, kind, ref: `Compendium.x.Item.${key}`, params });

/** A world with a party standing in two regions, and a ledger of the cards posted. */
function stand() {
  const posted = [];
  const placeA = flagged({ uuid: "Actor.A", name: "Shaft" }, { "acks-extras.things": [raw("thing-1", "obstacle", "sheerClimb", { length: 40 }), raw("thing-2", "condition", "ropeFixed")] });
  const placeB = flagged({ uuid: "Actor.B", name: "Damp" }, { "acks-extras.things": [raw("thing-1", "condition", "waterFast")] });
  const regionA = { name: "rA" };
  const regionB = { name: "rB" };
  const regionC = { name: "rC" };
  const inside = new Set([regionA, regionB]);
  const token = { regions: inside, parent: { regions: [regionA, regionB, regionC] } };
  const party = flagged({ id: "party" });
  const formation = { id: "f1", name: "Party", actorId: "party", sceneId: "s1", tokenId: "t1", travel: {} };
  globalThis.game.actors = { get: (id) => (id === "party" ? party : null) };
  globalThis.game.scenes = { get: () => ({ tokens: { get: () => token, *[Symbol.iterator]() {} } }) };
  globalThis.game.users = [{ id: "gm1", isGM: true }];
  globalThis.acksExtras = { location: { scenes: { locationOfRegion: (region) => ({ rA: placeA, rB: placeB })[region.name] ?? null } } };
  globalThis.fromUuid = async (ref) => ({ type: "acks-extras.hazard", system: { key: ref.split(".").pop() } });
  globalThis.ChatMessage = { create: async (message) => { posted.push(message); return message; } };
  return { posted, party, formation, inside, regionA, placeA };
}
const wall = (outcome) => ({ outcome, placement: { kind: "wall" } });

await ok("the step posts one card for the places newly entered, once, and again after a move out and back", async () => {
  assert.equal(PLACES_UNDER_FLAG, "placesUnder");
  const w = stand();
  const clear = { outcome: null, results: [] };
  assert.equal(await runEntryStep(w.formation, clear), true);
  assert.equal(w.posted.length, 1);
  assert.deepEqual(w.posted[0].whisper, ["gm1"], "to the Judges alone");
  assert.ok(w.posted[0].content.includes("Shaft") && !w.posted[0].content.includes("Damp"), "the place with an obstacle, not the one with only a condition");
  assert.deepEqual(w.party.getFlag("acks-extras", "placesUnder"), ["Actor.A", "Actor.B"]);
  assert.equal(await runEntryStep(w.formation, clear), false, "a move inside the same places posts nothing");
  assert.equal(w.party.writes, 1, "and writes nothing");
  w.inside.clear();
  assert.equal(await runEntryStep(w.formation, clear), false);
  assert.deepEqual(w.party.getFlag("acks-extras", "placesUnder"), [], "leaving is written");
  w.inside.add(w.regionA);
  assert.equal(await runEntryStep(w.formation, clear), true, "entered again");
  assert.equal(w.posted.length, 2);
});

await ok("a move a wall stopped posts nothing and leaves the list alone, so the place posts when it is reached", async () => {
  const w = stand();
  assert.equal(await runEntryStep(w.formation, { outcome: "sprung", results: [wall("sprung")] }), false);
  assert.deepEqual([w.posted.length, w.party.writes], [0, 0]);
  assert.equal(await runEntryStep(w.formation, { outcome: "crossed", results: [wall("crossed")] }), true, "a wall crossed unsprung stops nothing");
});

/** `stand()` with what a press on Begin touches: settings, a party update that writes flags, notifications and a confirm dialog. */
function press() {
  const w = stand();
  const warned = [];
  const asked = [];
  const answer = { value: true, during: null };
  const { ForcedDeletion } = globalThis.foundry.data.operators;
  w.party.sheet = { rendered: 0, render() { this.rendered += 1; } };
  w.party.update = async (data) => {
    for (const [path, value] of Object.entries(data)) {
      const key = path.replace(/^flags\./, "").replace(/^acks-extras\./, "acks-extras.");
      if (value instanceof ForcedDeletion) delete w.party.flags[key]; else w.party.flags[key] = value;
    }
  };
  w.party[Symbol.iterator] = function* () {};
  globalThis.game.actors[Symbol.iterator] = function* () {};
  globalThis.game.settings = { get: () => ({ f1: w.formation }) };
  globalThis.game.user.isGM = true;
  globalThis.ui = { notifications: { warn: (message) => warned.push(message) } };
  globalThis.foundry.applications.api.DialogV2 = {
    confirm: async (options) => { asked.push(options); await answer.during?.(); return answer.value; },
  };
  const crossing = () => w.party.getFlag("acks-extras", "crossing");
  return { ...w, warned, asked, answer, crossing, ids: { formationId: "f1", placeUuid: "Actor.A", thingId: "thing-1", placeName: "Shaft" } };
}

await ok("Begin seeds the crossing from the place's figures and the conditions of every place stood in, and opens the party sheet", async () => {
  const w = press();
  assert.deepEqual(await pressBegin(w.ids), { ok: true });
  assert.deepEqual([w.crossing().kind, w.crossing().length, w.crossing().ropeFixed, w.crossing().waterFast], ["sheerClimb", 40, true, undefined], "the climb takes its length and its place's rope, and not the water of the place beside it");
  assert.equal(w.party.sheet.rendered, 1);
  assert.equal(w.asked.length, 0, "no crossing was open, so no question");
});

await ok("Begin opens a squeeze in the shape the place states and a swim at the penalty pick it states", async () => {
  const squeeze = press();
  squeeze.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "squeeze", { shape: "squeeze", length: 12 })];
  assert.deepEqual(await pressBegin(squeeze.ids), { ok: true });
  assert.deepEqual([squeeze.crossing().kind, squeeze.crossing().shape, squeeze.crossing().length], ["squeeze", "squeeze", 12]);

  const blank = press();
  blank.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "squeeze", { shape: "tight" })];
  assert.deepEqual(await pressBegin(blank.ids), { ok: true });
  assert.equal(blank.crossing().shape, "chokepoint", "a shape the place cannot state leaves the crossing's own default");

  const swim = press();
  swim.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "swim", { penaltyPick: "larger", penaltyLarger: 15, movement: "running" })];
  assert.deepEqual(await pressBegin(swim.ids), { ok: true });
  assert.deepEqual([swim.crossing().kind, swim.crossing().penaltyPick, swim.crossing().penaltyLarger, swim.crossing().movement], ["swim", "larger", 15, "combat"], "the movement is the table's");

  const unlisted = press();
  unlisted.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "swim", { penaltyPick: "7" })];
  assert.deepEqual(await pressBegin(unlisted.ids), { ok: true });
  assert.equal(unlisted.crossing().penaltyPick, "none", "with no steps imported a step pick is no valid pick");

  registerTable({ id: FORMATION_DOC, source: "invented", tables: { swimWaterPenaltySteps: [7, 12.5] } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    const listed = press();
    listed.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "swim", { penaltyPick: "12.5" })];
    assert.deepEqual(await pressBegin(listed.ids), { ok: true });
    assert.equal(listed.crossing().penaltyPick, "12.5", "a step the world imports is a valid pick at the press");

    const gone = press();
    gone.placeA.flags["acks-extras.things"] = [raw("thing-1", "obstacle", "swim", { penaltyPick: "9" })];
    assert.deepEqual(await pressBegin(gone.ids), { ok: true });
    assert.equal(gone.crossing().penaltyPick, "none", "a step the world does not import is not");
  } finally { resetTables(); }
});

await ok("Begin refuses a player's seat, a place the party has left and a thing that is gone, and writes nothing", async () => {
  const w = press();
  globalThis.game.user.isGM = false;
  assert.deepEqual(await pressBegin(w.ids), { ok: false, refused: "seat" });
  globalThis.game.user.isGM = true;
  assert.equal((await pressBegin({ ...w.ids, placeUuid: "Actor.Z" })).refused, "left");
  assert.equal((await pressBegin({ ...w.ids, thingId: "thing-9" })).refused, "gone");
  assert.equal(w.warned.length, 2);
  assert.equal(w.crossing(), undefined);
  for (const mode of ["journey", "settlement"]) {
    w.formation.travel = { mode };
    assert.equal((await pressBegin(w.ids)).refused, "mode", mode);
  }
  assert.equal(w.crossing(), undefined, "a card posted while delving opens nothing once the party has changed mode");
});

await ok("Begin over an open crossing asks first: Cancel keeps it, End and begin replaces it, and a crossing that changed meanwhile refuses", async () => {
  const w = press();
  w.party.flags["acks-extras.crossing"] = { id: "c1", kind: "squeeze", members: {} };
  w.answer.value = false;
  assert.equal((await pressBegin(w.ids)).refused, "cancelled");
  assert.equal(w.crossing().id, "c1", "Cancel leaves the open crossing");
  assert.deepEqual(w.asked[0].classes, ["acks-ui", "acks-extras", "acks-extras-scroll"]);
  assert.equal(w.asked[0].no.callback(), false, "a Cancel answers false, never null");
  assert.equal(w.asked[0].yes.callback(), true);
  assert.ok(w.asked[0].content.includes(lookup("ACKS-FORMATION.crossing.kind.squeeze")) && w.asked[0].content.includes(lookup(hazardLabelKey("sheerClimb"))), "the question names both crossings");

  w.answer.value = true;
  w.answer.during = () => { w.party.flags["acks-extras.crossing"] = { id: "c2", kind: "jump", members: {} }; };
  assert.equal((await pressBegin(w.ids)).refused, "changed");
  assert.equal(w.crossing().id, "c2", "a crossing the question did not name is left alone");

  w.answer.during = null;
  w.party.flags["acks-extras.crossing"] = { id: "c3", kind: "squeeze", members: {} };
  assert.deepEqual(await pressBegin(w.ids), { ok: true });
  assert.deepEqual([w.crossing().kind, w.crossing().length], ["sheerClimb", 40], "ended, then begun with the seed");
  assert.notEqual(w.crossing().id, "c3");
});

await ok("journey and settlement begin nothing, no location feature means no places, and a failed hazard read is no row", async () => {
  for (const mode of ["journey", "settlement"]) {
    const w = stand();
    w.formation.travel = { mode };
    assert.equal(await runEntryStep(w.formation, null), false, mode);
    assert.equal(w.posted.length, 0);
    assert.deepEqual(w.party.getFlag("acks-extras", "placesUnder"), ["Actor.A", "Actor.B"], `${mode} still keeps the list`);
  }
  const bare = stand();
  globalThis.acksExtras = {};
  assert.equal(await runEntryStep(bare.formation, null), false);
  assert.equal(bare.posted.length, 0);
  const broken = stand();
  globalThis.fromUuid = async () => { throw new Error("gone"); };
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal(await runEntryStep(broken.formation, null), false); } finally { console.error = quiet; }
  assert.equal(broken.posted.length, 0);
});

console.log(`\n${passed} passed`);
