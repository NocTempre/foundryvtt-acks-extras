/**
 * The formation import: what `formation-binding.mjs` reads out of its prose
 * windows, what the travel binding's navigation reading yields, and what the
 * readers do with the figures once a world holds them — the swimming throw,
 * the rescue load, the delve clock's rest, and the marching order's
 * competence bonus.
 *
 * Every sentence and every figure below is INVENTED; no page is reproduced.
 * The only words shared with a book are the anchor phrases the shipped recipes
 * already carry, because the end-to-end checks run invented pages through
 * those recipes. What this pins is the reading: conditions paired with their
 * penalties in the order the sentence names them, a figure past the full stop
 * left alone, a share never read out of a fraction that is part of a weight,
 * a partial read assembling only what it read, and a reader with nothing
 * imported saying so rather than guessing.
 */
import assert from "node:assert/strict";
import { extractTable } from "../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";
import { recipeCite } from "../scripts/importer/produces.mjs";
import * as services from "../scripts/lib/services.mjs";
import { registerTable, unregisterTable, getLayer, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  FORMATION_DOC_ID, PRODUCES, WATER_KEYS, assembleFormationTables, applyFormationImport,
  firstCount, firstSentence, parseCarriedBody, parseFeet, parseRestInterval, parseShareOf,
  parseWaterModifiers, signedFigures,
} from "../scripts/importer/formation-binding.mjs";
import { assembleTravelTables, parseNavigationBonus } from "../scripts/importer/travel-binding.mjs";
import { FORMATION_DOC, carriedBody, restInterval } from "../scripts/formation/constants.mjs";
import { WATER, drowning, rescueStone, swimSpeed, swimmingThrow } from "../scripts/formation/swimming.mjs";
import { navigationCompetence } from "../scripts/formation/travel.mjs";
import { TRAVEL_DOC } from "../scripts/vehicles/vehicle-speed.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* --- the binding and the engine agree on names ---------------------------- */
check("the binding writes the document the feature reads", FORMATION_DOC_ID === FORMATION_DOC);
eq("the water keys are the engine's, less calm",
  [...WATER_KEYS].sort(), Object.keys(WATER).filter((k) => k !== "calm").sort());
eq("every engine key is read from a recipe of this document",
  [...new Set(Object.values(PRODUCES[FORMATION_DOC_ID]))].filter((raw) => !(raw in TABLE_RECIPES.formation.tables)), []);

/* --- the small readers ----------------------------------------------------- */
eq("a window is cut at its first full stop", firstSentence(" Ducks paddle -3. Geese -9 "), "ducks paddle -3");
check("a decimal point is not a full stop", firstSentence("a 2.5 stone kettle. more") === "a 2.5 stone kettle");
eq("signed figures keep their sign, hyphen or true minus", signedFigures("a +3, a -4 and a −6"), [3, -4, -6]);
eq("an unsigned figure is not a signed one", signedFigures("counts 12 of them"), []);
check("a count may be a word", firstCount("roughly seven gulps") === 7);
check("an article is not a count", firstCount("a few gulps") === null);
check("a count is not read out of a longer word", firstCount("often nineteen") === null);

/* --- water: paired in the order the sentence names them -------------------- */
eq("conditions take the penalties in the order they are named",
  parseWaterModifiers(" rough, then cold, a swimmer counts -6 and then -11."), { rough: -6, cold: -11 });
eq("a penalty is stored negative whatever sign is printed",
  parseWaterModifiers(" cold costs +2 here"), { cold: -2 });
eq("a condition the sentence leaves unpriced is left out",
  parseWaterModifiers(" cold or rough, -7 to the swimmer"), { cold: -7 });
check("a figure past the full stop belongs to the next rule",
  parseWaterModifiers(" cold, a dunking. Elsewhere -9") === null);
check("unsigned figures price nothing", parseWaterModifiers(" cold or rough, 3 or 5") === null);
check("no condition named, nothing paired", parseWaterModifiers(" choppy, -3") === null);

/* --- shares, feet, the carried body, the rest ------------------------------ */
check("a share word", near(parseShareOf(" shrinks to one-third of it"), 1 / 3));
check("a fraction is a share", near(parseShareOf(" 3/5 of the way"), 0.6));
check("a percentage is a share", near(parseShareOf(" 40% of the way"), 0.4));
check("half is never read out of a longer word", parseShareOf(" on behalf of nobody") === null);
check("a share above the whole is a misread", parseShareOf(" 5/4 of it") === null);
check("feet by mark", parseFeet(" 6’ a round") === 6);
check("feet by word", parseFeet(" twelve feet a round") === 12);
check("a figure with no length unit is not a rate in feet", parseFeet(" 30 per round") === null);
eq("a weight with a fraction, and the share read after it",
  parseCarriedBody(" (call it 9 1/4 stone and two-thirds of the pack)."), { stone: 9.25, gearShare: 2 / 3 });
eq("the fraction inside the weight is never taken for the share",
  parseCarriedBody(" (9 1/4 stone, the pack left behind)"), { stone: 9.25, gearShare: null });
eq("a decimal weight", parseCarriedBody(" 8.5 stone plus 25% of the kit"), { stone: 8.5, gearShare: 0.25 });
eq("no weight, nothing read", parseCarriedBody(" two-thirds of the pack"), { stone: null, gearShare: null });
check("the count past which an unrested party is winded",
  parseRestInterval(" a troupe that marches more than 4 turns unrested starts to wheeze.") === 4);
check("else the count its cadence is stated per",
  parseRestInterval(" the cook insists on one nap every six turns.") === 6);
check("the threshold the clock compares against wins over the cadence",
  parseRestInterval(" nap every 3 turns, or past more than 7 turns the lot of you wheeze.") === 7);
check("a rest with no count of turns is no interval", parseRestInterval(" rest when you like.") === null);

/* --- end to end: invented pages through the shipped recipes ---------------- */
// One run per line, stacked down the right-hand column the recipes read.
const page = (lines) => lines.map((str, i) => ({ x: 320, y: 100 + i * 12, str }));
const SWIM_PAGE = [
  "Otters scoff at all of this.",
  "If the water is rough, then cold, a swimmer counts -6 and then -11 against the eel king.",
  "A gnome who has the swimming proficiency adds +3 to the tally, or so the gnomes say.",
  "Her swimming movement shrinks to one-third of whatever she would manage ashore.",
  "Each luckless adventurer sinks 6’ a round for every stone he hauls.",
  "A limp body hauled up counts its weight in encumbrance (call it 9 1/4 stone and two-thirds of the pack).",
  "A pearl diver can hold her breath for 7 plus whatever her lungs allow.",
];
// A figure ahead of the one the clock needs, so a first-number reader fails.
const REST_PAGE = [
  "Rest and Recuperation",
  "The ogre union demands a 2 turn lunch. A troupe that marches more than 4 turns unrested starts to wheeze.",
];
const recipes = TABLE_RECIPES.formation.tables;
const raw = {
  swimmingProse: extractTable(page(SWIM_PAGE), recipes.swimmingProse),
  restProse: extractTable(page(REST_PAGE), recipes.restProse),
};
const engine = assembleFormationTables(raw);
eq("all eight figures assemble from the recipes' windows", Object.keys(engine).sort(), Object.keys(PRODUCES[FORMATION_DOC_ID]).sort());
eq("the water penalties", engine.swimWaterModifiers, { rough: -6, cold: -11 });
check("the proficiency bonus", engine.swimmingBonus === 3);
check("the swimmer's share of speed", near(engine.swimSpeedShare, 1 / 3));
check("the sink rate per stone", engine.sinkFeetPerStone === 6);
check("the breath's base", engine.breathRounds === 7);
check("the body's weight", engine.carriedBodyStone === 9.25);
check("the kit's share", near(engine.carriedGearShare, 2 / 3));
check("the rest interval", engine.restInterval === 4);

/* --- absent input is absent output, never a default ------------------------ */
eq("nothing assembles from nothing", assembleFormationTables({}), {});
eq("nor from an undefined raw", assembleFormationTables(), {});
eq("a partial read assembles only what it read",
  Object.keys(assembleFormationTables({ swimmingProse: { water: raw.swimmingProse.water } })), ["swimWaterModifiers"]);
eq("a drifted window costs its own figure and nothing beside it",
  Object.keys(assembleFormationTables({ ...raw, swimmingProse: { ...raw.swimmingProse, breath: " whatever her lungs allow" } })).length, 7);

/* --- the import writes the WORLD layer, citing the raw tables' page -------- */
services.resetServices();
check("no import service, nothing assembled", (await applyFormationImport()).assembled.length === 0);
const writes = [];
services.register("ruledata-import", {
  importDoc: async (doc, opts) => {
    writes.push({ doc, opts });
    registerTable(doc, { priority: opts.priority });
  },
});
registerTable({ id: FORMATION_DOC_ID, tables: { restProse: raw.restProse } }, { priority: PRIORITY.SAMPLE });
check("a sample alone is not an import", (await applyFormationImport()).assembled.length === 0 && writes.length === 0);
unregisterTable(FORMATION_DOC_ID);
check("nothing registered reads as no rest owed", restInterval() === null);
eq("nor any carried-body figure", carriedBody(), { stone: null, gearShare: null });

const cites = { swimmingProse: recipeCite(recipes.swimmingProse), restProse: recipeCite(recipes.restProse) };
registerTable({ id: FORMATION_DOC_ID, source: TABLE_RECIPES.formation.source, cites, tables: raw }, { priority: PRIORITY.WORLD });
const applied = await applyFormationImport();
check("the import assembles all eight", applied.assembled.length === 8);
const written = writes.at(-1);
check("into the WORLD layer", written?.opts.priority === PRIORITY.WORLD);
check("the raw windows stay beside the engine tables", "swimmingProse" in written.doc.tables && "restInterval" in written.doc.tables);
check("each engine table cites the page its window was read from",
  written.doc.cites.restInterval === cites.restProse && written.doc.cites.breathRounds === cites.swimmingProse
  && /^RR p\.\d+$/.test(cites.swimmingProse));
check("the layer read back is the written one", getLayer(FORMATION_DOC_ID, PRIORITY.WORLD)?.tables?.restInterval === 4);

/* --- the readers, priced by what was imported ------------------------------ */
check("the rest interval reads through", restInterval() === 4);
check("the rescue load: the body whole and its kit's share", near(rescueStone(6), 9.25 + 6 * (2 / 3)));
check("a swimmer's pace is the imported share of it", near(swimSpeed(90), 30));
let t = swimmingThrow({ encumbrance: 20, proficient: true, water: "cold" });
eq("cold water's penalty raises the target and the bonus lowers it", [t.target, t.needed, t.unknown], [20 - 3 + 11, true, []]);
t = swimmingThrow({ encumbrance: 2, proficient: true, water: "calm" });
eq("a target the bonus takes to zero or below is no throw at all", [t.target, t.needed], [-1, false]);
eq("breath and the sink rate", drowning({ conMod: 1, encumbrance: 4 }), { rounds: 8, feetPerRound: 24, depthAtDeath: 192 });

unregisterTable(FORMATION_DOC_ID);
t = swimmingThrow({ encumbrance: 5, water: "rough" });
eq("with nothing imported the throw names what it is missing", [t.target, t.needed, t.unknown], [null, null, ["swimWaterModifiers"]]);
t = swimmingThrow({ encumbrance: 5, proficient: true, water: "calm" });
eq("and the proficiency's bonus is missing too", t.unknown, ["swimmingBonus"]);
eq("an unencumbered swimmer in calm water needs no import", swimmingThrow({ encumbrance: 0 }).target, 0);
check("an unknown rescue load is unknown, never nothing", rescueStone(6) === null);
eq("an unknown drowning is unknown", drowning({ conMod: 1, encumbrance: 4 }), { rounds: null, feetPerRound: null, depthAtDeath: null });

/* --- the navigation bonus: one sentence, two figures ----------------------- */
eq("the first figure is either competence's, the second both together",
  parseNavigationBonus(" or a map: holding one is worth +2, holding both +5, and the moon frowns."), { either: 2, both: 5 });
eq("a sentence with one figure prices one competence", parseNavigationBonus(" worth +2 to the lucky"), { either: 2 });
check("a figure past the full stop is the next rule's",
  parseNavigationBonus(" no bonus at all. Then +9 for owls") === null);
check("no figure, no row", parseNavigationBonus(" a vague sense of north") === null);
const NAV_PAGE = [
  "Only a pathfinding class power or a decent map helps here: holding one is worth +2, holding both +5, and the moon frowns on the rest.",
];
const travel = assembleTravelTables({ navigationProse: extractTable(page(NAV_PAGE), TABLE_RECIPES.travel.tables.navigationProse) });
eq("the travel recipe's window carries both figures to the row", travel.navigationBonus, { either: 2, both: 5 });
eq("and assembles nothing else from that window alone", Object.keys(travel), ["navigationBonus"]);

/* --- harness: just enough Foundry for the readers and the turn engine ------ */
class Stub {}
globalThis.foundry = {
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: {
    escapeHTML: (s) => String(s),
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
  },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub } },
};
const settings = new Map();
const chat = [];
const gm = { id: "gm1", isGM: true, active: true };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.ChatMessage = { create: async (data) => (chat.push(data), data) };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.game = {
  user: gm,
  users: { filter: (fn) => [gm].filter(fn) },
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: (scope, key) => settings.get(`${scope}.${key}`),
    set: async (scope, key, value) => settings.set(`${scope}.${key}`, foundry.utils.deepClone(value)),
  },
  actors: new Map(),
  time: { worldTime: 0, advance: async () => {} },
};

/** An actor with ability items by name, and effects a marker can land on. */
function actor(id, abilities = []) {
  const effects = [];
  const a = {
    id,
    name: id,
    items: abilities.map((name) => ({ type: "ability", name })),
    effects,
    createEmbeddedDocuments: async (_type, list) => list.map((data) => {
      const e = {
        ...data,
        getFlag: (scope, key) => data.flags?.[scope]?.[key],
        delete: async () => effects.splice(effects.indexOf(e), 1),
      };
      effects.push(e);
      return e;
    }),
  };
  game.actors.set(id, a);
  return a;
}

/* --- the marching order's competence, priced by the imported row ----------- */
actor("navigator", ["Navigation"]);
actor("pathfinder", ["Pathfinding"]);
actor("passenger", []);
const order = (...ids) => ({ members: ids.map((actorId) => ({ actorId })) });

unregisterTable(TRAVEL_DOC);
eq("a competence with nothing imported counts for nothing and says so",
  navigationCompetence(order("navigator")), { navigation: true, pathfinding: false, bonus: 0, unpriced: true });
eq("nobody competent owes no figure", navigationCompetence(order("passenger")),
  { navigation: false, pathfinding: false, bonus: 0, unpriced: false });
registerTable({ id: TRAVEL_DOC, tables: travel }, { priority: PRIORITY.WORLD });
eq("either competence takes the first figure", navigationCompetence(order("passenger", "pathfinder")).bonus, 2);
eq("both take the second", navigationCompetence(order("navigator", "pathfinder")),
  { navigation: true, pathfinding: true, bonus: 5, unpriced: false });
registerTable({ id: TRAVEL_DOC, tables: { navigationBonus: parseNavigationBonus(" worth +2 to the lucky") } }, { priority: PRIORITY.WORLD });
eq("a figure the import did not read stays unpriced", navigationCompetence(order("navigator", "pathfinder")),
  { navigation: true, pathfinding: true, bonus: 0, unpriced: true });
unregisterTable(TRAVEL_DOC);

/* --- the delve clock winds past the imported interval ---------------------- */
const { advanceTurns } = await import("../scripts/formation/turn-engine.mjs");
const { getFormation } = await import("../scripts/formation/formation-model.mjs");
const walker = actor("walker");
const FID = "probe";
const clockOf = () => getFormation(FID).clock;
const windedMarks = () => walker.effects.filter((e) => e.getFlag("acks-extras", "winded")).length;
settings.set("acks-extras.encounterEvery", 0);
settings.set("acks-extras.formations", {
  [FID]: {
    id: FID, name: "Probe", members: [{ actorId: walker.id }], lights: [], spells: [],
    clock: { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, roundsPartial: 0, winded: false },
  },
});

unregisterTable(FORMATION_DOC_ID);
await advanceTurns(getFormation(FID), 9);
check("with no interval imported the clock counts and asks for no rest", clockOf().turnsSinceRest === 9 && !clockOf().winded);
await advanceTurns(getFormation(FID), 1, { resting: true });

registerTable({ id: FORMATION_DOC_ID, tables: raw }, { priority: PRIORITY.WORLD });
await applyFormationImport();
await advanceTurns(getFormation(FID), 4);
check("the imported interval itself is not yet winded", !clockOf().winded && windedMarks() === 0);
await advanceTurns(getFormation(FID), 1);
check("one turn past it winds the party", clockOf().winded === true);
check("and marks the member", windedMarks() === 1);
await advanceTurns(getFormation(FID), 1, { resting: true });
check("a rest turn clears both", !clockOf().winded && windedMarks() === 0 && clockOf().turnsSinceRest === 0);
check("each advance posted its turn card", chat.length === 5);
unregisterTable(FORMATION_DOC_ID);
services.resetServices();

console.log(`test-formation-binding: ${pass} checks passed.`);
