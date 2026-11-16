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

console.log(`test-typed-modifiers: ${pass} passed`);
