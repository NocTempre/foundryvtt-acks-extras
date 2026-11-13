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

check("a structured scope decides what a condition phrase used to say", () => {
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

console.log(`test-typed-modifiers: ${pass} passed`);
