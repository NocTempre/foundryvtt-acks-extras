/**
 * lib/typed-modifiers.mjs: what happens to each imported modifier spec, how
 * the standing ones are valued on one actor, and how they meet.
 *
 * Every figure here is invented. Run: node tools/test-typed-modifiers.mjs
 */
import assert from "node:assert/strict";

globalThis.acksExtras = {};

const {
  modifierDisposition,
  modifierPaths,
  standingModifiers,
  registerGate,
  gateVerdict,
  specKey,
  isUnverified,
  DISPOSITION,
  isItemGate,
  resolveStacking,
  stackingPart,
  capabilitiesOf,
  saveKeyOf,
} = await import("../scripts/lib/typed-modifiers.mjs");

let pass = 0;
const check = (label, fn) => {
  fn();
  pass++;
};

const mod = (over = {}) => ({ type: "modifier", target: "ac", value: 1, ...over });
const kind = (spec) => modifierDisposition(spec)?.kind;

/** An ability item as the importer leaves it. */
const ability = (name, effects, { id = null, extras = {}, own = [], itemId = null, provides } = {}) => ({
  id: itemId ?? name.replace(/\W/g, ""),
  name,
  type: "ability",
  flags: { "acks-extras": { ...(id ? { cookbook: { id } } : {}), extras: { effects, ...(provides ? { provides } : {}), ...extras } } },
  effects: own,
});
const character = (items, { level = 1, type = "character", statuses } = {}) => ({
  type,
  items,
  system: { details: { level } },
  ...(statuses ? { statuses: new Set(statuses) } : {}),
});
const parts = (actor, opts) => standingModifiers(actor, opts).parts;
const sum = (actor, path, opts) => parts(actor, opts).filter((p) => p.path === path).reduce((s, p) => s + p.value, 0);

/* --- The disposition table ------------------------------------------------ */

check("a flat self modifier on a field stands", () => assert.equal(kind(mod()), DISPOSITION.STANDING));
check("a non-modifier has no disposition", () => assert.equal(modifierDisposition({ type: "throw" }), null));
check("influence targets are consumed by influence", () => {
  for (const target of ["reaction", "morale", "loyalty"]) assert.equal(modifierDisposition(mod({ target })).consumer, "influence");
});
check("a proficiency-throw modifier is the abilities feature's", () => assert.equal(modifierDisposition(mod({ target: "proficiencyThrow" })).consumer, "abilities"));
check("a modifier on one of the ability's own throws is the abilities feature's", () =>
  assert.equal(modifierDisposition(mod({ target: "initiative", appliesToRoll: "throw1" })).consumer, "abilities"));
check("henchmen and markets targets are consumed", () => {
  assert.equal(modifierDisposition(mod({ target: "marketClass" })).consumer, "henchmen");
  assert.equal(modifierDisposition(mod({ target: "marketImpact" })).consumer, "markets");
});
check("a replace or set mode is not applied", () => {
  assert.equal(kind(mod({ mode: "replace" })), DISPOSITION.UNSUPPORTED);
  assert.equal(kind(mod({ mode: "set" })), DISPOSITION.UNSUPPORTED);
});
check("a target with no field is not applied", () => {
  for (const target of ["mortalWounds", "casterLevel", "research", "hp", "speed"]) assert.equal(kind(mod({ target })), DISPOSITION.UNSUPPORTED, target);
});
check("an ally's modifier is not applied", () => assert.equal(kind(mod({ appliesTo: "ally" })), DISPOSITION.UNSUPPORTED));
check("a creature-kind, alignment or tone scope waits for the roll", () => {
  assert.equal(kind(mod({ vsKinds: ["beast"] })), DISPOSITION.AT_ROLL);
  assert.equal(kind(mod({ vsAlignment: "chaotic" })), DISPOSITION.AT_ROLL);
  assert.equal(kind(mod({ target: "initiative", tones: ["diplomacy"] })), DISPOSITION.AT_ROLL);
});
check("a free-text condition is situational", () => assert.equal(kind(mod({ condition: "situational" })), DISPOSITION.SITUATIONAL));
check("a gate nothing registered is situational", () => assert.equal(kind(mod({ gate: { kind: "nobodyKnowsThis" } })), DISPOSITION.SITUATIONAL));
check("a registered gate is gated, whatever the condition prose says", () => assert.equal(kind(mod({ gate: { kind: "status", status: "x" }, condition: "prose" })), DISPOSITION.GATED));
check("an empty gate is no gate", () => assert.equal(kind(mod({ gate: { kind: "" } })), DISPOSITION.STANDING));
check("a monster's modifiers are not touched", () => assert.equal(modifierDisposition(mod(), { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED));

/* --- The field each target writes ------------------------------------------ */

check("self surprise lands on avoid surprise", () => assert.deepEqual(modifierPaths(mod({ target: "surprise" }), "character"), [{ path: "system.surprise.avoidsurprise", type: "add" }]));
check("opponent surprise lands on surprise others", () =>
  assert.deepEqual(modifierPaths(mod({ target: "surprise", appliesTo: "opponent", value: -3 }), "character"), [{ path: "system.surprise.surpriseothers", type: "add" }]));
check("an opponent's attack penalty waits for the roll", () => assert.equal(kind(mod({ target: "attackThrow", appliesTo: "opponent" })), DISPOSITION.AT_ROLL));
check("an unnarrowed attack bonus reaches melee and missile", () =>
  assert.deepEqual(modifierPaths(mod({ target: "attackThrow" }), "character").map((p) => p.path), ["system.attack.mod.melee", "system.attack.mod.missile"]));
check("an attack bonus narrowed to missile reaches missile only", () =>
  assert.deepEqual(modifierPaths(mod({ target: "attackThrow", forWhat: "Missile" }), "character").map((p) => p.path), ["system.attack.mod.missile"]));
check("an attack bonus narrowed to an activity waits for the roll", () => assert.equal(kind(mod({ target: "attackThrow", forWhat: "Ambushing" })), DISPOSITION.AT_ROLL));
check("a bonus to one save lowers that save's target", () =>
  assert.deepEqual(modifierPaths(mod({ target: "save", forWhat: "Blast" }), "character"), [{ path: "system.saves.blast.value", type: "subtract" }]));
check("a save narrowed to something that is no save waits for the roll", () => assert.equal(kind(mod({ target: "save", forWhat: "Poison" })), DISPOSITION.AT_ROLL));
check("an all-save bonus lands on the save modifier", () => assert.deepEqual(modifierPaths(mod({ target: "save" }), "character"), [{ path: "system.save.mod", type: "add" }]));

/* --- One actor ---------------------------------------------------------- */

check("a standing spec becomes one part with the ability's name", () => {
  const p = parts(character([ability("Steady", [mod({ value: 2 })], { id: "def.prof.steady" })]));
  assert.equal(p.length, 1);
  assert.equal(p[0].label, "Steady");
  assert.equal(p[0].value, 2);
  assert.equal(p[0].path, "system.ac.mod");
});
check("opponent surprise from an actor lands on surprise others", () =>
  assert.equal(sum(character([ability("Hush", [mod({ target: "surprise", appliesTo: "opponent", value: -3 })])]), "system.surprise.surpriseothers"), -3));
check("an unresolved value contributes nothing and is listed", () => {
  const r = standingModifiers(character([ability("Ladder", [mod({ value: { kind: "progression", as: "x" } })])]));
  assert.equal(r.parts.length, 0);
  assert.equal(r.listed[0].reason, "unresolved");
});
check("a ladder resolves at the actor's level", () => {
  const ladder = { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 5, value: 3 }] };
  const a = (level) => character([ability("Ladder", [mod({ value: ladder })])], { level });
  assert.equal(sum(a(4), "system.ac.mod"), 1);
  assert.equal(sum(a(5), "system.ac.mod"), 3);
});
check("a monster carries no parts", () => assert.equal(parts(character([ability("Steady", [mod()])], { type: "monster" })).length, 0));

check("copies of one definition count once", () => {
  const a = character([ability("Steady", [mod({ value: 2 })], { id: "def.prof.steady", itemId: "s1" }), ability("Steady", [mod({ value: 2 })], { id: "def.prof.steady", itemId: "s2" })]);
  assert.equal(sum(a, "system.ac.mod"), 2);
});
check("copies of one definition are valued at their rank", () => {
  const byRank = { kind: "conditional", on: "rank", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 2, value: 4 }] };
  const one = character([ability("Deep", [mod({ value: byRank })], { id: "def.prof.deep", itemId: "d1" })]);
  const two = character([ability("Deep", [mod({ value: byRank })], { id: "def.prof.deep", itemId: "d1" }), ability("Deep", [mod({ value: byRank })], { id: "def.prof.deep", itemId: "d2" })]);
  assert.equal(sum(one, "system.ac.mod"), 1);
  assert.equal(sum(two, "system.ac.mod"), 4);
});
check("abilities providing one capability do not stack; the larger applies", () => {
  const a = character([
    ability("Watchful (power)", [mod({ target: "surprise", value: 1 })], { id: "def.power.watchful" }),
    ability("Watchful", [mod({ target: "surprise", value: 3 })], { id: "def.prof.watchful" }),
  ]);
  const p = parts(a).filter((x) => x.path === "system.surprise.avoidsurprise");
  assert.equal(p.length, 1);
  assert.equal(p[0].value, 3);
  const listed = standingModifiers(a).listed.find((l) => l.reason === "notStacking");
  assert.equal(listed.yieldsTo, "Watchful");
});
check("a provided capability groups two differently named abilities", () => {
  const a = character([
    ability("Alpha", [mod({ value: 2 })], { id: "def.power.alpha", provides: ["kw:guard"] }),
    ability("Beta", [mod({ value: 1 })], { id: "def.power.beta", provides: ["kw:guard"] }),
  ]);
  assert.equal(sum(a, "system.ac.mod"), 2);
});
check("the larger of a notStacksWith pair applies", () => {
  const a = character([
    ability("Alpha", [mod({ value: 1, notStacksWith: ["def.power.beta"] })], { id: "def.power.alpha" }),
    ability("Beta", [mod({ value: 3 })], { id: "def.power.beta" }),
  ]);
  assert.equal(sum(a, "system.ac.mod"), 3);
});
check("a notStacksWith pair on different fields still adds on each", () => {
  const a = character([
    ability("Alpha", [mod({ value: 1, notStacksWith: ["def.power.beta"] })], { id: "def.power.alpha" }),
    ability("Beta", [mod({ target: "initiative", value: 3 })], { id: "def.power.beta" }),
  ]);
  assert.equal(sum(a, "system.ac.mod"), 1);
  assert.equal(sum(a, "system.initiative.mod"), 3);
});
check("unpaired abilities add", () => {
  const a = character([ability("Alpha", [mod({ value: 1 })], { id: "def.power.alpha" }), ability("Beta", [mod({ value: 2 })], { id: "def.power.beta" })]);
  assert.equal(sum(a, "system.ac.mod"), 3);
});
check("a stacksWith pair adds even where it shares a capability", () => {
  const a = character([
    ability("Alpha", [mod({ value: 1, stacksWith: ["def.power.beta"] })], { id: "def.power.alpha", provides: ["kw:guard"] }),
    ability("Beta", [mod({ value: 2 })], { id: "def.power.beta", provides: ["kw:guard"] }),
  ]);
  assert.equal(sum(a, "system.ac.mod"), 3);
});

check("an ability whose own effect writes the field stands aside", () => {
  const own = [{ disabled: false, changes: [{ key: "system.ac.mod", type: "add", value: "2" }] }];
  const r = standingModifiers(character([ability("Hand", [mod({ value: 2 }), mod({ target: "initiative", value: 1 })], { own })]));
  assert.equal(r.parts.filter((p) => p.path === "system.ac.mod").length, 0);
  assert.equal(r.parts.filter((p) => p.path === "system.initiative.mod").length, 1, "only the field its effect writes");
  assert.equal(r.listed.find((l) => l.reason === "standAside").path, "system.ac.mod");
});

check("a situational row whose own effect is started is listed as stood aside, not as situational", () => {
  const own = [{ disabled: false, changes: [{ key: "system.ac.mod", type: "add", value: 2 }] }];
  const r = standingModifiers(character([ability("Quick", [mod({ value: 2, condition: "situational" })], { own })]));
  const row = r.listed.find((l) => l.path === "system.ac.mod");
  assert.equal(row?.reason, "standAside", JSON.stringify(row));
  const off = standingModifiers(character([ability("Quick", [mod({ value: 2, condition: "situational" })], { own: [{ ...own[0], disabled: true }] })]));
  assert.notEqual(off.listed.find((l) => l.path === "system.ac.mod")?.reason, "standAside", "an effect turned off stands nothing aside");
});

check("a scan-found spec applies, marked unverified", () => {
  const scanned = ability("Scanned", [mod({ value: 2 })], { extras: { effectsFrom: "scan", unaudited: true } });
  const p = parts(character([scanned]));
  assert.equal(p[0].value, 2);
  assert.equal(p[0].unverified, true);
  assert.equal(isUnverified(scanned), true);
});
check("a recipe-backed spec is not unverified, audited or not", () => {
  const recipe = ability("Recipe", [mod()], { extras: { effectsFrom: "recipe", unaudited: true } });
  assert.equal(parts(character([recipe]))[0].unverified, false);
});
check("a copy with no stamp is not unverified, audited or not", () => {
  assert.equal(isUnverified(ability("Plain", [mod()], { extras: { unaudited: true } })), false);
  assert.equal(isUnverified(ability("Plain", [mod()], { extras: { unaudited: false } })), false);
});

/* --- Gates ----------------------------------------------------------- */

registerGate("testDressed", (_actor, gate, ctx) => (gate.armourMax ? ctx.armour === gate.armourMax : null));
check("a gate answering yes applies the part, marked gated", () => {
  const a = character([ability("Dancer", [mod({ value: 2, gate: { kind: "testDressed", armourMax: "light" } })])]);
  const p = parts(a, { ctx: { armour: "light" } });
  assert.equal(p[0].value, 2);
  assert.equal(p[0].gated, true);
});
check("a gate answering no lists the part", () => {
  const a = character([ability("Dancer", [mod({ value: 2, gate: { kind: "testDressed", armourMax: "light" } })])]);
  const r = standingModifiers(a, { ctx: { armour: "heavy" } });
  assert.equal(r.parts.length, 0);
  assert.equal(r.listed[0].reason, "gateOff");
});
check("a gate that cannot decide lists the part as situational", () => {
  const a = character([ability("Dancer", [mod({ value: 2, gate: { kind: "testDressed" } })])]);
  const r = standingModifiers(a, { ctx: { armour: "light" } });
  assert.equal(r.parts.length, 0);
  assert.equal(r.listed[0].kind, DISPOSITION.SITUATIONAL);
});
check("a throwing evaluator cannot decide", () => {
  registerGate("testThrows", () => {
    throw new Error("x");
  });
  assert.equal(gateVerdict({}, { kind: "testThrows" }), null);
});
check("lib's status gate reads the actor's statuses", () => {
  const spec = mod({ value: 2, gate: { kind: "status", status: "invented" } });
  assert.equal(sum(character([ability("Rage", [spec])], { statuses: ["invented"] }), "system.ac.mod"), 2);
  assert.equal(sum(character([ability("Rage", [spec])], { statuses: [] }), "system.ac.mod"), 0);
});

/* --- Conditions: the scope decides, a label keeps the row as it was --- */

check("a structured scope decides what a condition phrase says", () => {
  // A throw named by appliesToRoll is the abilities feature's, whatever label stands beside it.
  assert.equal(modifierDisposition(mod({ target: "initiative", appliesToRoll: "careful", condition: "by method (QQ p.7)" })).consumer, "abilities");
  // A gate decides where a phrase once only described.
  assert.equal(kind(mod({ gate: { kind: "status", status: "invented" }, condition: "situational" })), DISPOSITION.GATED);
});
check("a neutral label, or the page's own words, leaves a row situational exactly as the phrase did", () => {
  for (const condition of ["by speed (QQ p.7)", "while riding a giant newt", "situational"]) {
    const r = standingModifiers(character([ability("Rider", [mod({ value: 2, condition })])]));
    assert.equal(r.parts.length, 0, condition);
    assert.equal(r.listed[0].reason, "condition", condition);
  }
});
check("a specialized-style bonus waits, situational, where no equipment evaluator is loaded", () => {
  const a = character([ability("Stance", [mod({ value: 2, gate: { kind: "specializedStyle", style: "single" } })])]);
  assert.equal(standingModifiers(a, { ctx: { loadout: { activeStyle: "single" } } }).listed[0].kind, DISPOSITION.SITUATIONAL);
});
check("a style bonus applies only with its style active", () => {
  // The shape equipment's evaluator has: the loadout's active style against the gate's.
  registerGate("testStyle", (_a, gate, ctx) => (gate.style && ctx.loadout ? ctx.loadout.activeStyle === gate.style : null));
  const a = character([ability("Stance", [mod({ target: "initiative", value: 2, gate: { kind: "testStyle", style: "single" } })])]);
  assert.equal(sum(a, "system.initiative.mod", { ctx: { loadout: { activeStyle: "single" } } }), 2);
  assert.equal(sum(a, "system.initiative.mod", { ctx: { loadout: { activeStyle: "dual" } } }), 0);
  assert.equal(standingModifiers(a, { ctx: {} }).listed[0].reason, "gate", "no loadout, no verdict");
});

/* --- Roll gates: read at the roll, on any actor ----------------------- */

const { isRollGate, rollGatedModifiers } = await import("../scripts/lib/typed-modifiers.mjs");
const { rollGateRows } = await import("../scripts/lib/roll-gates.mjs");

/** A token on a scene whose sky is day (or night), 100px squares. Every figure is invented. */
const tokenIn = ({ day = true, lights = [] } = {}) => {
  const scene = {
    grid: { size: 100, distance: 10, units: "ft" },
    environment: { darknessLevel: day ? 0 : 0.9, globalLight: { enabled: day, darkness: { min: 0, max: 1 } } },
    lights,
    tokens: [],
    regions: [],
  };
  return { x: 0, y: 0, width: 1, height: 1, parent: scene };
};
const lightRow = (over = {}) => mod({ target: "attackThrow", value: -2, gate: { kind: "light", light: "daylight" }, ...over });
const asActor = (items, type = "character") => character(items, { type });

check("the light gate is a roll gate and the status gate is not", () => {
  assert.equal(isRollGate("light"), true);
  assert.equal(isRollGate("status"), false);
  assert.equal(isRollGate(undefined), false);
});
check("registering a gate again replaces whether it is read at the roll", () => {
  registerGate("testFlip", () => true, { at: "roll" });
  assert.equal(isRollGate("testFlip"), true);
  registerGate("testFlip", () => true);
  assert.equal(isRollGate("testFlip"), false);
});
check("a roll-gated row waits for the roll on a character and on a monster", () => {
  for (const actorType of ["character", "monster"]) {
    const d = modifierDisposition(lightRow(), { actorType });
    assert.equal(d.kind, DISPOSITION.AT_ROLL, actorType);
    assert.equal(d.reason, "gate", actorType);
    assert.deepEqual(d.paths, [], actorType);
    assert.equal(d.gate.light, "daylight", actorType);
  }
});
check("a roll gate does not claim a consumed target, a replace mode or a foreign subject", () => {
  assert.equal(modifierDisposition(lightRow({ target: "morale" }), { actorType: "character" }).kind, DISPOSITION.CONSUMED);
  assert.equal(modifierDisposition(lightRow({ mode: "set" }), { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED);
  assert.equal(modifierDisposition(lightRow({ appliesTo: "ally" }), { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED);
});
check("a monster's row with no roll gate stays unsupported", () => {
  assert.equal(modifierDisposition(mod({ target: "attackThrow" }), { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED);
  assert.equal(modifierDisposition(mod({ target: "attackThrow", gate: { kind: "status", status: "invented" } }), { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED);
});
check("saveKeyOf reads a save's name as the system's key, the plural included, and nothing else", () => {
  assert.deepEqual(["Death", "paralysis", "Blasts", "implements", "spells"].map(saveKeyOf), ["death", "paralysis", "blast", "implements", "spell"]);
  assert.deepEqual([saveKeyOf(""), saveKeyOf("charm"), saveKeyOf(undefined)], [null, null, null]);
});
check("a declared attackKinds is atRoll narrowed for either reader, on a character and with bearer on a monster", () => {
  const narrowed = mod({ target: "ac", attackKinds: ["missile"] });
  assert.deepEqual([modifierDisposition(narrowed).kind, modifierDisposition(narrowed).reason], [DISPOSITION.AT_ROLL, "narrowed"]);
  assert.deepEqual(modifierDisposition(narrowed, { actorType: "monster", bearer: true }).reason, "narrowed");
  assert.equal(modifierDisposition(narrowed, { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED, "without bearer a monster is refused first");
  assert.equal(modifierDisposition(mod({ target: "ac", attackKinds: [] })).kind, DISPOSITION.STANDING, "an empty list narrows nothing");
});
check("with bearer, a set on ac is atRoll set; without it the mode is unsupported as before", () => {
  const set = mod({ target: "ac", mode: "set", appliesTo: "target", attackKinds: ["missile", "thrown"] });
  for (const actorType of ["character", "monster"]) {
    const d = modifierDisposition(set, { actorType, bearer: true });
    assert.deepEqual([d.kind, d.reason], [DISPOSITION.AT_ROLL, "set"], actorType);
  }
  assert.deepEqual(modifierDisposition(set, { bearer: false }).reason, "mode");
  assert.deepEqual(modifierDisposition(mod({ target: "ac", mode: "set", appliesTo: "ally" }), { bearer: true }).reason, "mode", "a foreign subject is not the bearer's");
  assert.deepEqual(modifierDisposition(mod({ target: "save", mode: "set" }), { bearer: true }).reason, "mode", "only armour class takes a set");
  assert.deepEqual(modifierDisposition(mod({ target: "ac", mode: "auto" }), { bearer: true }).reason, "mode");
});
check("with bearer, a status-gated row is atRoll gate (tested at the roll); without it the row stays gated", () => {
  const gated = mod({ target: "save", forWhat: "death", gate: { kind: "status", status: "wasted", occasion: true } });
  const d = modifierDisposition(gated, { bearer: true });
  assert.deepEqual([d.kind, d.reason, d.gate.status], [DISPOSITION.AT_ROLL, "gate", "wasted"]);
  assert.equal(modifierDisposition(gated, { actorType: "monster", bearer: true }).kind, DISPOSITION.AT_ROLL);
  assert.equal(modifierDisposition(gated).kind, DISPOSITION.GATED, "the ability reader's answer is unchanged");
  assert.equal(modifierDisposition(gated, { actorType: "monster" }).kind, DISPOSITION.UNSUPPORTED);
});
check("standingModifiers writes nothing for a light-gated row, even standing in daylight, and lists it at the roll", () => {
  const a = asActor([ability("Sun Shy", [lightRow()])]);
  const r = standingModifiers(a, { ctx: { token: tokenIn({ day: true }) } });
  assert.deepEqual(r.parts, []);
  assert.equal(r.listed.length, 1);
  assert.equal(r.listed[0].kind, DISPOSITION.AT_ROLL);
  assert.equal(r.listed[0].reason, "gate");
});
check("the light gate answers null without a token, or for a level it does not know, or a token on no scene", () => {
  const actor = asActor([]);
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }), null);
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }, { token: null }), null);
  assert.equal(gateVerdict(actor, { kind: "light", light: "" }, { token: tokenIn() }), null);
  assert.equal(gateVerdict(actor, { kind: "light", light: "noon" }, { token: tokenIn() }), null);
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }, { token: { x: 0, y: 0, parent: null } }), null);
});
check("the light gate asks the token's place: daylight satisfies daylight only, bright and dim by ordering", () => {
  const actor = asActor([]);
  const day = tokenIn({ day: true });
  const night = tokenIn({ day: false });
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }, { token: day }), true);
  assert.equal(gateVerdict(actor, { kind: "light", light: "bright" }, { token: day }), true);
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }, { token: night }), false);
  assert.equal(gateVerdict(actor, { kind: "light", light: "dim" }, { token: night }), false);
  // A lamp on the dark scene: bright is met, daylight is not.
  const lit = tokenIn({ day: false, lights: [{ x: 0, y: 0, width: 0, height: 0, config: { bright: 30, dim: 60 } }] });
  assert.equal(gateVerdict(actor, { kind: "light", light: "bright" }, { token: lit }), true);
  assert.equal(gateVerdict(actor, { kind: "light", light: "daylight" }, { token: lit }), false);
});

const { consumedRows } = await import("../scripts/lib/typed-modifiers.mjs");
check("consumedRows reads the rows of one target on any actor, once per definition, with the value resolved and the gate left to the caller", () => {
  const row = (extra = {}) => mod({ target: "damageReduction", value: 2, ...extra });
  const items = [
    ability("Plates", [row(), mod({ target: "ac" })], { id: "def.ability.plates" }),
    ability("Plates", [row()], { id: "def.ability.plates", itemId: "copy" }),
    ability("Gated", [row({ gate: { kind: "weaponMundane" } }), row({ value: null })]),
    { ...ability("Gear", [row()]), type: "weapon" },
    ability("Other", [row({ type: "throw" })]),
  ];
  const rows = consumedRows(asActor(items, "monster"), "damageReduction");
  assert.deepEqual(rows.map((r) => [r.item.name, r.index]), [["Plates", 0], ["Gated", 0], ["Gated", 1]], "one Plates row: a copy counts once, a weapon and a non-modifier are not read");
  assert.equal(rows[0].value, 2);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].value, null, "a figure that does not resolve is null, the row kept");
  assert.equal(rows[1].spec.gate.kind, "weaponMundane", "the spec comes back whole");
  assert.deepEqual(consumedRows(null, "damageReduction"), []);
  assert.equal(modifierDisposition(row()).consumer, "defenses");
  assert.equal(modifierDisposition(mod({ target: "acWaiver", value: undefined })).consumer, "conditions");
});

check("rollGatedModifiers reads a monster's rows, once per definition, and leaves out blank, zero, opponent and other targets", () => {
  const items = [
    ability("Sun Shy", [lightRow(), lightRow({ value: null }), lightRow({ value: 0 }), lightRow({ appliesTo: "opponent" }), lightRow({ target: "save" }), mod()]),
    ability("Sun Shy", [lightRow()]),
  ];
  const rows = rollGatedModifiers(asActor(items, "monster"), "attackThrow");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, -2);
  assert.equal(rows[0].item.name, "Sun Shy");
  assert.equal(rollGatedModifiers(asActor(items, "monster"), "save").length, 1);
  assert.deepEqual(rollGatedModifiers(null, "attackThrow"), []);
});

check("the attack contributor adds a labelled row while the attacker's token stands in the light, on a character and a monster", () => {
  for (const type of ["character", "monster"]) {
    const actor = asActor([ability("Sun Shy", [lightRow()])], type);
    assert.deepEqual(rollGateRows({ actor, token: tokenIn({ day: true }) }, "melee"), [{ label: "Sun Shy · daylight", value: -2 }], type);
    assert.deepEqual(rollGateRows({ actor, token: tokenIn({ day: false }) }, "melee"), [], `${type} in the dark`);
    assert.deepEqual(rollGateRows({ actor, token: null }, "melee"), [], `${type} with no token: no guess`);
    assert.deepEqual(rollGateRows({ actor }, "missile"), [], `${type} with no token key`);
  }
});
check("the contributor's label carries the ability's page reference, and a narrowed row rides only its own delivery", () => {
  const item = ability("Sun Shy", [lightRow({ forWhat: "melee" })]);
  item.flags["acks-extras"].cookbook = { cite: "Test Book p. 9" };
  const actor = asActor([item], "monster");
  const ctx = { actor, token: tokenIn({ day: true }) };
  assert.deepEqual(rollGateRows(ctx, "melee"), [{ label: "Sun Shy · daylight (Test Book p. 9)", value: -2 }]);
  assert.deepEqual(rollGateRows(ctx, "missile"), []);
  const other = asActor([ability("Sun Shy", [lightRow({ forWhat: "Ambushing" })])], "monster");
  assert.deepEqual(rollGateRows({ actor: other, token: tokenIn({ day: true }) }, "melee"), [], "an activity that is no delivery is another roll's");
});
check("the contributor adds nothing for a row with no figure", () => {
  const actor = asActor([ability("Sun Shy", [lightRow({ value: "" }), lightRow({ value: "x" })])], "monster");
  assert.deepEqual(rollGateRows({ actor, token: tokenIn({ day: true }) }, "melee"), []);
});

/* --- The attack-moment roll gates: target condition, round, sides, range --- */

const { gateLabel } = await import("../scripts/lib/roll-gates.mjs");

/** A scene whose grid measures straight lines in feet, 100px a 10ft square. Invented. */
let arenas = 0;
const arena = () => ({
  id: `arena${++arenas}`,
  grid: { size: 100, distance: 10, units: "ft", measurePath: ([a, b]) => ({ distance: (Math.hypot(b.x - a.x, b.y - a.y) / 100) * 10 }) },
  tokens: [],
});
/** A token at a grid cell, on a side (1 friendly, -1 hostile, 0 neutral). */
const fighter = (scene, id, cell, disposition = 1) => ({ id, x: cell * 100, y: 0, width: 1, height: 1, parent: scene, disposition });
/** A combat of `[token, defeated]` pairs at a round; every token's combatant is wired back to it. */
const combatOf = (round, entries) => {
  const combat = { round, combatants: [] };
  for (const [token, defeated] of entries) {
    const combatant = { id: `c${token.id}`, tokenId: token.id, token, isDefeated: defeated === true, parent: combat };
    token.combatant = combatant;
    combat.combatants.push(combatant);
  }
  return combat;
};
const gated = (gate, over = {}) => mod({ target: "attackThrow", value: 2, gate, ...over });
const rowsFor = (gate, ctx, attackType = "melee", over = {}) =>
  rollGateRows({ actor: asActor([ability("Cunning", [gated(gate, over)])], "monster"), ...ctx }, attackType);

check("the four attack-moment gates are roll gates, read on any actor and never written as standing", () => {
  for (const kindName of ["targetCondition", "combatRound", "outnumbering", "rangeBand"]) {
    assert.equal(isRollGate(kindName), true, kindName);
    assert.equal(modifierDisposition(gated({ kind: kindName }), { actorType: "monster" }).kind, DISPOSITION.AT_ROLL, kindName);
  }
});

check("targetCondition: true while the target carries the condition or one it implies, false without, null with no target or no known id", () => {
  const webbed = { targetActor: { statuses: new Set(["webbed"]) } };
  const clear = { targetActor: { statuses: new Set() } };
  const actor = asActor([]);
  const gate = { kind: "targetCondition", condition: "webbed" };
  assert.equal(gateVerdict(actor, gate, webbed), true);
  assert.equal(gateVerdict(actor, gate, clear), false);
  assert.equal(gateVerdict(actor, { kind: "targetCondition", condition: "vulnerable" }, webbed), true, "an implied state counts");
  assert.equal(gateVerdict(actor, { kind: "targetCondition", condition: ["blinded", "webbed"] }, webbed), true, "any of a list");
  assert.equal(gateVerdict(actor, { kind: "targetCondition", condition: ["blinded", "prone"] }, webbed), false);
  assert.equal(gateVerdict(actor, gate, {}), null, "no target");
  assert.equal(gateVerdict(actor, gate, { targetActor: {} }), null, "a target that cannot say");
  assert.equal(gateVerdict(actor, { kind: "targetCondition" }, webbed), null, "no id read");
  assert.equal(gateVerdict(actor, { kind: "targetCondition", condition: "notACondition" }, webbed), null, "an id the catalogue lacks");
});

check("combatRound: an exact round, a span and open ends decide from the token's combat; no combat or an unbegun one is null", () => {
  const scene = arena();
  const me = fighter(scene, "a", 0);
  const actor = asActor([]);
  const ask = (round, gate) => {
    combatOf(round, [[me, false]]);
    return gateVerdict(actor, { kind: "combatRound", ...gate }, { token: me });
  };
  assert.equal(ask(3, { round: { from: 3, to: 3 } }), true);
  assert.equal(ask(3, { round: 3 }), true, "a bare number is that round");
  assert.equal(ask(4, { round: 3 }), false);
  assert.equal(ask(2, { round: { from: 2, to: 4 } }), true);
  assert.equal(ask(4, { round: { from: 2, to: 4 } }), true);
  assert.equal(ask(5, { round: { from: 2, to: 4 } }), false);
  assert.equal(ask(1, { round: { from: 2, to: 4 } }), false);
  assert.equal(ask(9, { round: { from: 2 } }), true, "no upper bound");
  assert.equal(ask(1, { round: { from: 2 } }), false);
  assert.equal(ask(1, { round: { to: 2 } }), true, "no lower bound");
  assert.equal(ask(3, { round: { to: 2 } }), false);
  assert.equal(ask(3, { round: { from: null, to: null } }), null, "no figure read");
  assert.equal(ask(3, {}), null, "no round on the gate");
  assert.equal(ask(0, { round: 1 }), null, "a combat not begun");
  const loose = fighter(scene, "b", 1);
  assert.equal(gateVerdict(actor, { kind: "combatRound", round: 1 }, { token: loose }), null, "a token in no combat");
  assert.equal(gateVerdict(actor, { kind: "combatRound", round: 1 }, {}), null, "no token");
  // A combat the tracker does not view: core's `token.combatant` is null, so the token is found among every combat.
  const unseen = fighter(scene, "c", 2);
  const prior = globalThis.game;
  try {
    const elsewhere = { round: 2, active: false, scene: { id: "other" }, combatants: [{ tokenId: "c", sceneId: "other" }] };
    const here = { round: 3, active: false, scene: { id: scene.id }, combatants: [{ tokenId: "c", sceneId: scene.id }] };
    globalThis.game = { combats: [elsewhere, here] };
    assert.equal(gateVerdict(actor, { kind: "combatRound", round: 3 }, { token: unseen }), true, "a combat on the token's scene, not viewed");
    assert.equal(gateVerdict(actor, { kind: "combatRound", round: 2 }, { token: unseen }), false, "never another scene's");
    globalThis.game = { combats: [elsewhere] };
    assert.equal(gateVerdict(actor, { kind: "combatRound", round: 2 }, { token: unseen }), null, "no combat on its scene holds it");
  } finally {
    globalThis.game = prior;
  }
});

check("outnumbering: the attacker's side against the other by token disposition among the undefeated, null where it cannot be told", () => {
  const scene = arena();
  const me = fighter(scene, "me", 0, -1);
  const mate = fighter(scene, "mate", 1, -1);
  const third = fighter(scene, "third", 2, -1);
  const foe = fighter(scene, "foe", 3, 1);
  const other = fighter(scene, "other", 4, 1);
  const actor = asActor([]);
  const gate = (over) => ({ kind: "outnumbering", ratio: 2, ...over });
  combatOf(1, [[me, false], [mate, false], [third, false], [foe, false], [other, false]]);
  assert.equal(gateVerdict(actor, gate(), { token: me }), false, "three to two is not twice");
  assert.equal(gateVerdict(actor, gate({ ratio: 1.5 }), { token: me }), true, "three to two is one and a half");
  assert.equal(gateVerdict(actor, gate({ ratio: 1 }), { token: me }), true);
  assert.equal(gateVerdict(actor, gate({ side: "against", ratio: 1 }), { token: me }), false, "the other side is not larger");
  assert.equal(gateVerdict(actor, gate({ side: "against", ratio: 1 }), { token: foe }), true, "the same fight from the other seat");
  combatOf(1, [[me, false], [mate, false], [third, false], [foe, false], [other, true]]);
  assert.equal(gateVerdict(actor, gate(), { token: me }), true, "a defeated combatant does not count");
  combatOf(1, [[me, false], [mate, true], [third, true], [foe, false], [other, false]]);
  assert.equal(gateVerdict(actor, gate({ ratio: 1 }), { token: me }), false, "the fallen on the attacker's side do not count either");
  combatOf(1, [[me, false], [mate, false], [third, false]]);
  assert.equal(gateVerdict(actor, gate(), { token: me }), null, "nobody on the other side");
  const watcher = fighter(scene, "watcher", 5, 0);
  combatOf(1, [[watcher, false], [foe, false], [me, false]]);
  assert.equal(gateVerdict(actor, gate(), { token: watcher }), null, "a neutral attacker has no side");
  assert.equal(gateVerdict(actor, gate({ ratio: undefined }), { token: me }), null, "no ratio read");
  assert.equal(gateVerdict(actor, gate({ ratio: 0 }), { token: me }), null);
  assert.equal(gateVerdict(actor, gate(), { token: fighter(scene, "loose", 6) }), null, "no combat");
  assert.equal(gateVerdict(actor, gate(), {}), null, "no token");
});

check("rangeBand: melee by the delivery, a ranged band by the gap to the target and the weapon's own reaches, null where either cannot say", () => {
  const scene = arena();
  const me = fighter(scene, "me", 0);
  const at = (cell) => fighter(scene, `t${cell}`, cell, -1);
  const bow = { system: { range: { short: 20, medium: 40, long: 60 } } };
  const actor = asActor([]);
  const ask = (band, ctx) => gateVerdict(actor, { kind: "rangeBand", band }, ctx);
  assert.equal(ask("melee", { type: "melee" }), true);
  assert.equal(ask("short", { type: "melee" }), false);
  assert.equal(ask("short", { type: "missile", token: me, target: at(2), item: bow }), true, "20 ft is within the short reach");
  assert.equal(ask("medium", { type: "missile", token: me, target: at(2), item: bow }), false);
  assert.equal(ask("medium", { type: "missile", token: me, target: at(3), item: bow }), true);
  assert.equal(ask("long", { type: "thrown", token: me, target: at(6), item: bow }), true);
  assert.equal(ask("melee", { type: "missile", token: me, target: at(1), item: bow }), false);
  assert.equal(ask(["short", "medium"], { type: "missile", token: me, target: at(3), item: bow }), true, "any of a list");
  assert.equal(ask("long", { type: "missile", token: me, target: at(7), item: bow }), null, "beyond the long reach");
  assert.equal(ask("short", { type: "missile", token: me, item: bow }), null, "no target");
  assert.equal(ask("short", { type: "missile", token: me, target: at(1) }), null, "no weapon");
  assert.equal(ask("short", { type: "missile", token: me, target: at(1), item: { system: { range: { short: 0, medium: 0, long: 0 } } } }), null, "a weapon with no reaches");
  assert.equal(ask("short", { type: "missile", token: me, target: { ...at(1), parent: arena() }, item: bow }), null, "another scene");
  assert.equal(ask("short", { token: me, target: at(1), item: bow }), null, "no delivery");
  assert.equal(ask("near", { type: "melee" }), null, "a band that is no band");
  assert.equal(gateVerdict(actor, { kind: "rangeBand" }, { type: "melee" }), null, "no band read");
});

check("gateLabel names each kind, and the light level and an unknown kind as before", () => {
  assert.equal(gateLabel({ kind: "light", light: "daylight" }), "daylight");
  assert.equal(gateLabel({ kind: "targetCondition", condition: "webbed" }), "against a target that is Webbed");
  assert.equal(gateLabel({ kind: "targetCondition", condition: ["webbed", "blinded"] }), "against a target that is Webbed, Blinded");
  assert.equal(gateLabel({ kind: "combatRound", round: 3 }), "in round 3");
  assert.equal(gateLabel({ kind: "combatRound", round: { from: 2, to: 2 } }), "in round 2");
  assert.equal(gateLabel({ kind: "combatRound", round: { from: 2, to: 4 } }), "in rounds 2 to 4");
  assert.equal(gateLabel({ kind: "combatRound", round: { from: 2, to: null } }), "from round 2");
  assert.equal(gateLabel({ kind: "combatRound", round: { from: null, to: 4 } }), "through round 4");
  assert.equal(gateLabel({ kind: "outnumbering", ratio: 2 }), "while outnumbering");
  assert.equal(gateLabel({ kind: "outnumbering", ratio: 2, side: "against" }), "while outnumbered");
  assert.equal(gateLabel({ kind: "rangeBand", band: "short" }), "at short range");
  assert.equal(gateLabel({ kind: "rangeBand", band: ["short", "medium"] }), "at short, medium range");
  assert.equal(gateLabel({ kind: "rangeBand", band: "melee" }), "in melee");
  assert.equal(gateLabel({ kind: "somethingElse" }), "somethingElse");
});

const { readFileSync } = await import("node:fs");
const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
check("every phrase gateLabel uses is a key en.json holds, placeholders and all", () => {
  const prior = globalThis.game;
  // A stub that answers only from en.json and marks each answer, so a key the file lacks falls back unmarked.
  globalThis.game = { i18n: { has: (key) => key in lang, localize: (key) => `~${lang[key]}` } };
  try {
    assert.equal(gateLabel({ kind: "targetCondition", condition: ["webbed"] }), "~against a target that is Webbed");
    assert.equal(gateLabel({ kind: "combatRound", round: 3 }), "~in round 3");
    assert.equal(gateLabel({ kind: "combatRound", round: { from: 2, to: 4 } }), "~in rounds 2 to 4");
    assert.equal(gateLabel({ kind: "combatRound", round: { from: 2 } }), "~from round 2");
    assert.equal(gateLabel({ kind: "combatRound", round: { to: 4 } }), "~through round 4");
    assert.equal(gateLabel({ kind: "outnumbering", ratio: 2 }), "~while outnumbering");
    assert.equal(gateLabel({ kind: "outnumbering", ratio: 2, side: "against" }), "~while outnumbered");
    assert.equal(gateLabel({ kind: "rangeBand", band: ["short", "long"] }), "~at ~short, ~long range");
    assert.equal(gateLabel({ kind: "rangeBand", band: ["medium"] }), "~at ~medium range");
    assert.equal(gateLabel({ kind: "rangeBand", band: ["melee"] }), "~in melee");
    assert.equal(gateLabel({ kind: "light", light: "dim" }), "~Dim light", "the light level reads its own key");
  } finally {
    globalThis.game = prior;
  }
});
check("a modifier under each gate adds its labelled row to the throw only while the gate answers yes", () => {
  const scene = arena();
  const me = fighter(scene, "me", 0, -1);
  const foe = fighter(scene, "foe", 2, 1);
  const mate = fighter(scene, "mate", 1, -1);
  const combat = combatOf(3, [[me, false], [mate, false], [foe, false]]);
  const bow = { system: { range: { short: 20, medium: 40, long: 60 } } };
  const base = { token: me, target: foe, targetActor: { statuses: new Set(["webbed"]) }, item: bow };
  const row = (label) => [{ label: `Cunning · ${label}`, value: 2 }];
  const yes = [
    [{ kind: "targetCondition", condition: "webbed" }, "against a target that is Webbed"],
    [{ kind: "combatRound", round: { from: 2, to: 4 } }, "in rounds 2 to 4"],
    [{ kind: "outnumbering", ratio: 1 }, "while outnumbering"],
    [{ kind: "rangeBand", band: "short" }, "at short range"],
  ];
  const no = [
    { kind: "targetCondition", condition: "blinded" },
    { kind: "combatRound", round: { from: 4, to: 6 } },
    { kind: "outnumbering", ratio: 3 },
    { kind: "rangeBand", band: "long" },
  ];
  for (const [gate, label] of yes) assert.deepEqual(rowsFor(gate, base, "missile"), row(label), gate.kind);
  for (const gate of no) assert.deepEqual(rowsFor(gate, base, "missile"), [], `${gate.kind} answering no`);
  for (const [gate] of [yes[0], yes[3]]) assert.deepEqual(rowsFor(gate, { token: me }, "missile"), [], `${gate.kind} with no target or weapon`);
  assert.deepEqual(rowsFor(yes[1][0], {}, "missile"), [], "a round with no token");
  combat.round = 0;
  assert.deepEqual(rowsFor(yes[1][0], base, "missile"), [], "a combat not begun");
  assert.deepEqual(rowsFor(yes[0][0], base, "missile", { forWhat: "melee" }), [], "a row narrowed to melee does not ride a missile attack");
  assert.deepEqual(rowsFor(yes[0][0], base, "melee", { forWhat: "melee" }), row("against a target that is Webbed"));
});

/* --- Keys ------------------------------------------------------------ */

check("a spec key follows content, not position or locator", () => {
  assert.equal(specKey(mod({ value: 2 })), specKey({ value: 2, target: "ac", type: "modifier" }));
  assert.equal(specKey(mod({ from: { pattern: "a" } })), specKey(mod({ from: { pattern: "b" } })));
  assert.notEqual(specKey(mod({ value: 2 })), specKey(mod({ value: 3 })));
});

check("a disabled effect of the ability's own does not stand aside", () => {
  const own = [{ disabled: true, changes: [{ key: "system.ac.mod", type: "add", value: "1" }] }];
  assert.equal(sum(character([ability("Guarded", [mod({ value: 2 })], { own })]), "system.ac.mod"), 2);
});
check("a scan's modifier applies and its part says unverified; a recipe's does not", () => {
  const scan = parts(character([ability("Scanned", [mod({ value: 2 })], { extras: { effectsFrom: "scan" } })]));
  assert.equal(scan.length, 1);
  assert.equal(scan[0].unverified, true);
  const recipe = parts(character([ability("Read", [mod({ value: 2 })], { extras: { effectsFrom: "recipe", unaudited: true } })]));
  assert.equal(recipe[0].unverified, false);
});
check("a monster's abilities write nothing and list nothing", () => {
  const r = standingModifiers(character([ability("Hide", [mod({ value: 2 })])], { type: "monster" }));
  assert.deepEqual(r, { parts: [], listed: [] });
});

// The origin stamp: what the cookbook entry says about its effects.
const { effectsOriginOf } = await import("../scripts/importer/effects-origin.mjs");
const recipeEntry = { fields: { effects: { op: "effects", specs: [{ type: "modifier", target: "initiative", from: { pattern: "x" } }] } } };
check("origin: an entry with a recipe reads recipe, one without reads scan", () => {
  assert.equal(effectsOriginOf(recipeEntry), "recipe");
  assert.equal(effectsOriginOf({ fields: {} }), "scan");
  assert.equal(effectsOriginOf(null), "scan");
});

/* --- The bearer reading, item gates and the stacking builder -------------- */

registerGate("testWeaponKind", () => true, { at: "item" });
registerGate("testPlaceKind", () => true, { at: "roll" });
const asBearer = (spec, actorType = "character") => modifierDisposition(spec, { actorType, bearer: true });

check("without bearer a record's subjects stay unsupported; with it they read as the bearer's own", () => {
  for (const appliesTo of ["target", "recipient", "area"]) {
    const spec = mod({ appliesTo });
    assert.deepEqual([modifierDisposition(spec).kind, modifierDisposition(spec).reason], [DISPOSITION.UNSUPPORTED, "subject"]);
    assert.equal(asBearer(spec).kind, DISPOSITION.STANDING);
  }
  // A subject no record names stays refused on either path.
  assert.equal(asBearer(mod({ appliesTo: "ally" })).reason, "subject");
  assert.equal(modifierDisposition(mod({ appliesTo: "opponent", target: "surprise" }), { bearer: true }).kind, DISPOSITION.STANDING);
});
check("a monster bearer's scoped row answers at the roll; without bearer a monster is refused first", () => {
  const scoped = mod({ appliesTo: "recipient", vsKinds: ["undead"] });
  assert.deepEqual([asBearer(scoped, "monster").kind, asBearer(scoped, "monster").reason], [DISPOSITION.AT_ROLL, "scope"]);
  assert.deepEqual([modifierDisposition(scoped, { actorType: "monster" }).kind, modifierDisposition(scoped, { actorType: "monster" }).reason], [DISPOSITION.UNSUPPORTED, "actorType"]);
  const own = mod({ vsKinds: ["undead"] });
  assert.equal(modifierDisposition(own, { actorType: "monster" }).reason, "actorType");
  assert.equal(asBearer(own, "monster").kind, DISPOSITION.AT_ROLL);
  // Nothing at the roll to wait for: a plain row on a monster is still refused.
  assert.equal(asBearer(mod({ appliesTo: "recipient" }), "monster").reason, "actorType");
});
check("an item-gated row answers at the roll, reason item, on a character and on a monster bearer", () => {
  const gated = mod({ target: "damage", gate: { kind: "testWeaponKind" } });
  for (const [spec, opts] of [
    [gated, { actorType: "character" }],
    [gated, { actorType: "character", bearer: true }],
    [mod({ target: "damage", appliesTo: "recipient", gate: { kind: "testWeaponKind" } }), { actorType: "monster", bearer: true }],
  ]) {
    const d = modifierDisposition(spec, opts);
    assert.deepEqual([d.kind, d.reason, d.gate.kind, d.paths], [DISPOSITION.AT_ROLL, "item", "testWeaponKind", []]);
  }
  assert.equal(modifierDisposition(gated, { actorType: "monster" }).reason, "actorType", "a monster is refused first where no bearer is read");
});
check("a roll gate and an item gate are told apart, and a later registration replaces the earlier timing", () => {
  assert.equal(isItemGate("testWeaponKind"), true);
  assert.equal(isRollGate("testWeaponKind"), false);
  assert.equal(isRollGate("testPlaceKind"), true);
  assert.equal(isItemGate("testPlaceKind"), false);
  assert.equal(modifierDisposition(mod({ gate: { kind: "testPlaceKind" } })).reason, "gate");
  registerGate("testSwitchKind", () => true, { at: "roll" });
  registerGate("testSwitchKind", () => true, { at: "item" });
  assert.deepEqual([isRollGate("testSwitchKind"), isItemGate("testSwitchKind")], [false, true]);
  registerGate("testSwitchKind", () => true);
  assert.deepEqual([isRollGate("testSwitchKind"), isItemGate("testSwitchKind")], [false, false], "no timing is neither");
  assert.equal(isItemGate("nothing"), false);
});
check("rollGatedModifiers leaves an item-gated row out and keeps a roll-gated one", () => {
  const item = (kindName) => ability(kindName, [mod({ target: "attackThrow", value: 2, gate: { kind: kindName } })], { id: `def.prof.${kindName}` });
  const actor = character([item("testWeaponKind"), item("testPlaceKind")]);
  assert.deepEqual(rollGatedModifiers(actor, "attackThrow").map((r) => r.gate.kind), ["testPlaceKind"]);
});
check("stackingPart always carries the capabilities and the reference resolveStacking reads", () => {
  const bare = stackingPart({ value: 2, label: "Bare" });
  assert.deepEqual([bare.caps, bare.ref, bare.stacksWith, bare.notStacksWith], [[], {}, [], []]);
  const part = stackingPart({ value: 3, label: "Ward", ref: { id: "def.spell.testWard", provides: ["KW:Shared"] }, on: "ac", key: "k1" });
  assert.deepEqual(part.caps, ["kw:testward", "kw:shared"]);
  assert.deepEqual([part.on, part.key, part.value, part.label], ["ac", "k1", 3, "Ward"], "the caller's own fields ride along");
  assert.deepEqual(capabilitiesOf({ id: "def.spell.testWard", provides: ["kw:x"] }), ["kw:testward", "kw:x"]);
  assert.deepEqual(capabilitiesOf(undefined), []);
});
check("parts from the builder stack as abilities do: a shared capability keeps the larger, stacksWith adds", () => {
  const a = stackingPart({ value: 2, label: "A", ref: { id: "def.spell.testA", provides: ["kw:shared"] } });
  const b = stackingPart({ value: 3, label: "B", ref: { id: "def.spell.testB", provides: ["kw:shared"] } });
  const r = resolveStacking([a, b]);
  assert.deepEqual(r.kept.map((p) => p.label), ["B"]);
  assert.deepEqual(r.dropped.map((p) => [p.label, p.yieldsTo]), [["A", "B"]]);
  const c = stackingPart({ value: 2, label: "C", ref: { id: "def.spell.testC", provides: ["kw:shared"] }, stacksWith: ["def.spell.testB"] });
  assert.deepEqual(resolveStacking([c, b]).kept.map((p) => p.label), ["C", "B"]);
  assert.throws(() => resolveStacking([{ value: 1, label: "x" }, { value: 2, label: "y" }]), "a part built any other way throws in the resolver");
});

/* --- spellcastingRows: the caster abilities an actor carries ---------------- */

const { spellcastingRows } = await import("../scripts/lib/typed-modifiers.mjs");
const caster = (over = {}) => ({ type: "spellcastingMod", target: "casterLevel", value: 1, schools: ["tideweaving"], ...over });
const picked = (name, effects, selections, opts = {}) => ability(name, effects, { ...opts, extras: { ...(opts.extras ?? {}), selections } });

check("spellcastingRows gathers a spellcastingMod row with its item, index, value and ref", () => {
  const lore = ability("Tide Lore", [mod(), caster({ value: 2 })], { id: "def.prof.tideLore", provides: ["kw:tides"] });
  const rows = spellcastingRows(character([lore]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, lore);
  assert.equal(rows[0].index, 1, "the index is the row's place among the ability's effects");
  assert.equal(rows[0].spec.schools[0], "tideweaving", "the narrowing fields ride on the spec");
  assert.equal(rows[0].value, 2);
  assert.deepEqual(rows[0].ref, { id: "def.prof.tideLore", provides: ["kw:tides"] });
  assert.equal(rows[0].unverified, false);
  assert.deepEqual(rows[0].selections, []);
});
check("spellcastingRows leaves out every row that is not a spellcastingMod, and an actor with no abilities", () => {
  const other = ability("Plain", [mod(), { type: "spellLike", spell: "Glow" }, { type: "throw", target: "x" }], { id: "def.prof.plain" });
  assert.deepEqual(spellcastingRows(character([other])), []);
  assert.deepEqual(spellcastingRows(character([])), []);
  assert.deepEqual(spellcastingRows(null), []);
  assert.deepEqual(spellcastingRows({ type: "character" }), []);
});
check("spellcastingRows counts copies of one definition once and pools their picks, each once", () => {
  const a = picked("Tide Lore (Brine)", [caster()], ["Brine"], { id: "def.prof.tideLore", itemId: "a" });
  const b = picked("Tide Lore (Surf)", [caster()], ["Surf", "Brine"], { id: "def.prof.tideLore", itemId: "b" });
  const c = picked("Tide Lore (Foam)", [caster()], [" Foam "], { id: "def.prof.tideLore", itemId: "c" });
  const rows = spellcastingRows(character([a, b, c]));
  assert.equal(rows.length, 1, "three copies are one definition");
  assert.equal(rows[0].item, a);
  assert.deepEqual(rows[0].selections, ["Brine", "Surf", "Foam"]);
});
check("spellcastingRows keeps two definitions apart, and copies without a cookbook id count by name", () => {
  const one = picked("Brine Lore", [caster()], ["Brine"], { id: "def.prof.brineLore" });
  const two = picked("Surf Lore", [caster()], ["Surf"], { id: "def.prof.surfLore" });
  const rows = spellcastingRows(character([one, two]));
  assert.deepEqual(rows.map((r) => r.item.name), ["Brine Lore", "Surf Lore"]);
  assert.deepEqual(rows.map((r) => r.selections), [["Brine"], ["Surf"]]);
  const x = picked("Reef Gift (Coral)", [caster()], ["Coral"], { itemId: "x" });
  const y = picked("Reef Gift (Kelp)", [caster()], ["Kelp"], { itemId: "y" });
  assert.equal(spellcastingRows(character([x, y])).length, 1, "the name without its pick is the definition");
});
check("spellcastingRows carries the prose-scan flag, and a recipe's row is verified", () => {
  const scanned = ability("Scanned", [caster()], { id: "def.prof.scanned", extras: { effectsFrom: "scan" } });
  const recipe = ability("Recipe", [caster()], { id: "def.prof.recipe", extras: { effectsFrom: "register" } });
  assert.deepEqual(spellcastingRows(character([scanned, recipe])).map((r) => r.unverified), [true, false]);
});
check("spellcastingRows resolves a located value at the actor's level, and keeps a blank one as null", () => {
  const ladder = { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 5, value: 2 }] };
  const lore = ability("Laddered", [caster({ value: ladder }), caster({ value: null, elements: ["brine"] }), caster({ value: { kind: "progression", as: "x" } })], { id: "def.prof.laddered" });
  assert.deepEqual(spellcastingRows(character([lore], { level: 4 })).map((r) => r.value), [1, null, null]);
  assert.deepEqual(spellcastingRows(character([lore], { level: 5 })).map((r) => r.value)[0], 2);
  const ranked = ability("Ranked", [caster({ value: { kind: "perLevel", base: 1, per: 1 } })], { id: "def.prof.ranked" });
  assert.equal(spellcastingRows(character([ranked], { level: 3 }))[0].value, 3);
  assert.equal(spellcastingRows(character([ranked]), { resolve: () => 9 })[0].value, 9, "the resolver option reaches the value");
});
check("spellcastingRows reads the abilities feature's picks where it is live, and an ability with no rows is skipped", () => {
  const prior = globalThis.acksExtras;
  globalThis.acksExtras = { abilities: { selectionsOf: (item) => (item.name.includes("(Brine)") ? ["Brine"] : []) } };
  try {
    const named = ability("Tide Lore (Brine)", [caster()], { id: "def.prof.tideLore" });
    const bare = ability("No Rows", [mod()], { id: "def.prof.noRows" });
    const rows = spellcastingRows(character([bare, named]));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].selections, ["Brine"]);
  } finally {
    globalThis.acksExtras = prior;
  }
});
check("a spellcastingMod row is not a modifier: no disposition, and standingModifiers never lists it", () => {
  assert.equal(modifierDisposition(caster()), null);
  const lore = ability("Tide Lore", [caster()], { id: "def.prof.tideLore" });
  const actor = character([lore]);
  assert.deepEqual(standingModifiers(actor), { parts: [], listed: [] });
});

/* --- The narrowing fields on effectField ------------------------------------ */

await (async () => {
  const prior = globalThis.foundry;
  class Field {
    constructor(a, b) {
      this.a = a;
      this.b = b;
    }
  }
  class Schema extends Field {
    get fields() {
      return this.a;
    }
  }
  class List extends Field {
    get element() {
      return this.a;
    }
  }
  class Bool extends Field {}
  globalThis.foundry = { data: { fields: { SchemaField: Schema, ArrayField: List, StringField: Field, NumberField: Field, BooleanField: Bool, SetField: Field, HTMLField: Field } } };
  try {
    const { effectField } = await import("../scripts/lib/fields.mjs");
    const row = effectField().fields;
    check("effectField carries the word lists as arrays of non-blank strings", () => {
      for (const key of ["schools", "elements", "saveCategories"]) {
        assert.ok(row[key] instanceof List, key);
        assert.equal(row[key].element.a.blank, false, `${key} members are never blank`);
      }
    });
    check("effectField carries bySelection and perDie as booleans that start false", () => {
      for (const key of ["bySelection", "perDie"]) {
        assert.ok(row[key] instanceof Bool, key);
        assert.equal(row[key].a.initial, false, key);
      }
    });
    check("effectField carries attackKinds as a set of attack kinds and the booleans and size key a record row needs", () => {
      assert.deepEqual(Object.keys(row.attackKinds.a.a.choices), ["melee", "missile", "thrown"]);
      for (const key of ["ownSave", "pickKind"]) {
        assert.ok(row[key] instanceof Bool, key);
        assert.equal(row[key].a.initial, false, key);
      }
      for (const key of ["condition", "side", "band", "ratio"]) assert.ok(key in row.gate.fields, `gate.${key}`);
      assert.deepEqual(Object.keys(row.gate.fields.round.fields), ["from", "to"], "gate.round is a span, either end open");
      for (const key of ["condition", "band"]) assert.ok(row.gate.fields[key] instanceof List, `gate.${key} is a list of words`);
      assert.ok(row.gate.fields.occasion instanceof Bool);
      assert.equal(row.gate.fields.occasion.a.initial, false);
      assert.equal(row.exemptSizeOver.a.initial, "");
    });
    check("effectField carries a row name as an optional blank-by-default string beside ref", () => {
      assert.ok(row.name instanceof Field && !(row.name instanceof Schema) && !(row.name instanceof List), "a plain string field");
      assert.equal(row.name.a.initial, "", "blank until the import names it");
      assert.equal(row.name.a.required, false);
      assert.equal(row.name.a.blank, true);
      assert.ok("ref" in row, "ref stays");
    });
    check("effectField keeps the ability row's existing spell fields", () => {
      for (const key of ["school", "spell", "spellRef", "casterLevelDelta"]) assert.ok(key in row, key);
    });
  } finally {
    globalThis.foundry = prior;
  }
})();

console.log(`test-typed-modifiers: ${pass} passed`);
