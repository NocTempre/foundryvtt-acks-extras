/**
 * The token palette: the stored arrangement, and what it writes to the list a
 * token's HUD reads.
 *
 * The first half is the Foundry-free model (`status-palette.mjs`): ids, the
 * stored shape, and which status is on the palette at which place. The second
 * drives `status-effects.mjs` against a stand-in for `CONFIG.statusEffects`,
 * to pin what is registered, what is only hidden, and that a status another
 * package brings is neither dropped nor mistaken for one this module wrote.
 */
import assert from "node:assert/strict";
import {
  CUSTOM_EFFECT_FIELDS, PALETTE_SOURCES, isArranged, isDefaultPalette, normalizeCustom, normalizePalette,
  paletteSetting, resolvePalette, slugStatusId, statusIdError,
} from "../scripts/lib/status-palette.mjs";
import { CONDITION_IDS, CONDITIONS, conditionNameKey } from "../scripts/lib/conditions.mjs";
import { LANG_PREFIX } from "../scripts/lib/constants.mjs";
import { BROUGHT, CONDITION_ORDER, IMPLYING_IDS, actorOf, conditionChanges, coreConditions, effectOf, implyingEffect } from "./core-conditions-fixture.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const known = (id, extra = {}) => ({ id, source: "condition", name: id, img: `${id}.svg`, defaultOn: true, keep: true, ...extra });
const KNOWN = [
  known("alpha"),
  known("bravo"),
  known("charlie"),
  known("tracker", { source: "system", defaultOn: false, keep: false }),
  known("outside", { source: "foreign", defaultOn: false, keep: false }),
];
const onIds = (palette) => palette.filter((e) => e.on).map((e) => e.id);
const byId = (palette, id) => palette.find((e) => e.id === id);

/* --- ids ------------------------------------------------------------------- */

ok("a status id is a letter, then letters, digits and hyphens", () => {
  for (const id of ["ab", "warded", "Fire-Shield", "a1", "x".repeat(40)]) assert.equal(statusIdError(id), null, id);
  for (const id of ["", "a", "1up", "-ab", "two words", "dotted.id", "x".repeat(41), null, 7]) {
    assert.equal(statusIdError(id), "shape", String(id));
  }
});

ok("an id the status list already answers to is reserved, and a known one is taken", () => {
  for (const id of ["fill", "length", "push", "constructor"]) assert.equal(statusIdError(id), "reserved", id);
  assert.equal(statusIdError("alpha", ["alpha"]), "taken");
  assert.equal(statusIdError("alpha", new Set(["bravo"])), null);
});

ok("a name becomes a free id", () => {
  assert.equal(slugStatusId("Warded by Flame!"), "warded-by-flame");
  assert.equal(slugStatusId("Émigré"), "emigre");
  assert.equal(slugStatusId("  9 Lives "), "status-9-lives");
  assert.equal(slugStatusId(""), "status");
  assert.equal(slugStatusId("Q"), "status-q");
  // A taken or reserved slug is numbered until it is free.
  assert.equal(slugStatusId("Warded", ["warded", "warded-2"]), "warded-3");
  assert.equal(slugStatusId("Fill"), "fill-2");
  assert.equal(statusIdError(slugStatusId("x".repeat(80), ["x".repeat(32)])), null);
});

/* --- the stored shape -------------------------------------------------------- */

ok("anything stored is read as one shape", () => {
  for (const raw of [undefined, null, {}, [], "text", { layout: "alpha", off: 4, custom: {} }]) {
    assert.deepEqual(normalizePalette(raw), { layout: [], off: [], custom: [] });
  }
  assert.deepEqual(
    normalizePalette({ layout: ["alpha", "alpha", "", 3, "bravo"], off: ["bravo", "charlie", "charlie"] }),
    { layout: ["alpha", "bravo"], off: ["charlie"], custom: [] },
  );
});

ok("a status of the Judge's own keeps its id, name, icon and the effect fields, and nothing else", () => {
  const made = normalizeCustom({
    id: " warded ", name: " Warded ", img: " w.svg ", stray: 1,
    effect: { system: { changes: [{ key: "system.x", type: "add", value: "1" }] }, duration: { value: 3, units: "rounds" }, flags: { a: 1 } },
  });
  assert.deepEqual(made, {
    id: "warded", name: "Warded", img: "w.svg",
    effect: { system: { changes: [{ key: "system.x", type: "add", value: "1" }] }, duration: { value: 3, units: "rounds" } },
  });
  assert.deepEqual(Object.keys(normalizeCustom({ id: "plain", name: "Plain", img: "p.svg", effect: {} })), ["id", "name", "img"]);
  assert.deepEqual([...CUSTOM_EFFECT_FIELDS].sort(), ["description", "duration", "system", "tint"]);
  for (const bad of [null, {}, { id: "1x", name: "N", img: "i" }, { id: "ok", name: " ", img: "i" }, { id: "ok", name: "N", img: "" }]) {
    assert.equal(normalizeCustom(bad), null);
  }
  // Two entries with one id: the first stands.
  const { custom } = normalizePalette({ custom: [{ id: "ab", name: "One", img: "1" }, { id: "ab", name: "Two", img: "2" }, { id: "9", name: "N", img: "i" }] });
  assert.deepEqual(custom, [{ id: "ab", name: "One", img: "1" }]);
});

/* --- which status is on the palette, and where -------------------------------- */

ok("with nothing stored each status takes its source's default, in the order it is known", () => {
  const palette = resolvePalette({}, KNOWN);
  assert.deepEqual(onIds(palette), ["alpha", "bravo", "charlie"]);
  assert.deepEqual(palette.map((e) => e.order), [0, 1, 2, null, null]);
  // Off and not needed by id: not registered at all.
  assert.deepEqual(palette.filter((e) => !e.registered).map((e) => e.id), ["tracker", "outside"]);
  assert.equal(isArranged({}), false);
  assert.equal(isDefaultPalette({}), true);
});

ok("an arranged palette is in the stored order, and takes a status its source keeps off", () => {
  const setting = { layout: ["outside", "charlie", "alpha"], off: ["bravo"] };
  const palette = resolvePalette(setting, KNOWN);
  assert.deepEqual(onIds(palette), ["outside", "charlie", "alpha"]);
  assert.equal(byId(palette, "outside").registered, true);
  // Off, but code toggles it by id: still registered.
  assert.deepEqual([byId(palette, "bravo").on, byId(palette, "bravo").registered], [false, true]);
  assert.equal(isArranged(setting), true);
  assert.equal(isDefaultPalette(setting), false);
});

ok("a status that became known after the arrangement was stored takes its default, after the arranged ones", () => {
  const palette = resolvePalette({ layout: ["charlie", "alpha"], off: ["bravo"] }, [...KNOWN, known("delta"), known("late", { defaultOn: false, keep: false })]);
  assert.deepEqual(onIds(palette), ["charlie", "alpha", "delta"]);
  assert.equal(byId(palette, "late").on, false);
});

ok("an id that is no longer known drops out, and the first of two with one id stands", () => {
  const palette = resolvePalette({ layout: ["gone", "bravo"], off: ["vanished"] }, [...KNOWN, known("alpha", { name: "second" })]);
  assert.deepEqual(onIds(palette), ["bravo", "alpha", "charlie"]);
  assert.equal(byId(palette, "alpha").name, "alpha");
  assert.equal(palette.length, KNOWN.length);
});

/* --- storing an edited palette ------------------------------------------------ */

ok("an edited palette is stored as its order, and only the defaults taken off are listed", () => {
  const edited = [
    { id: "outside", on: true, defaultOn: false },
    { id: "alpha", on: true, defaultOn: true },
    { id: "bravo", on: false, defaultOn: true },
    { id: "charlie", on: false, defaultOn: true },
    { id: "tracker", on: false, defaultOn: false },
  ];
  const setting = paletteSetting(edited, [{ id: "mine", name: "Mine", img: "m.svg" }]);
  assert.deepEqual(setting, { layout: ["outside", "alpha"], off: ["bravo", "charlie"], custom: [{ id: "mine", name: "Mine", img: "m.svg" }] });
  // What is stored resolves back to what was edited.
  assert.deepEqual(onIds(resolvePalette(setting, KNOWN)), ["outside", "alpha"]);
});

ok("a palette the Judge has not ordered stores no order, unless a status is on only by the Judge's hand", () => {
  const unordered = [
    { id: "alpha", on: true, defaultOn: true },
    { id: "bravo", on: false, defaultOn: true },
    { id: "charlie", on: true, defaultOn: true },
  ];
  const setting = paletteSetting(unordered, [], { arranged: false });
  assert.deepEqual(setting, { layout: [], off: ["bravo"], custom: [] });
  assert.equal(isArranged(setting), false);
  assert.deepEqual(onIds(resolvePalette(setting, KNOWN)), ["alpha", "charlie"]);
  const forced = paletteSetting([...unordered, { id: "outside", on: true, defaultOn: false }], [], { arranged: false });
  assert.deepEqual(forced.layout, ["alpha", "charlie", "outside"]);
  assert.deepEqual(paletteSetting(null), { layout: [], off: [], custom: [] });
});

ok("every source the editor groups by is one a known status can carry", () => {
  assert.deepEqual([...PALETTE_SOURCES], ["condition", "state", "custom", "system", "foreign"]);
});

/* --- the list a token's HUD reads ---------------------------------------------- */

const stored = { value: {} };
// The system's world settings, read by namespace and key; `unreadable` makes them throw as before they register.
const system = { "core-status-effects": false, unreadable: false };
globalThis.game = {
  settings: {
    get: (namespace, key) => {
      if (namespace !== "acks") return stored.value;
      if (system.unreadable) throw new Error("not registered");
      return system[key];
    },
  },
};
// The system's own lists, in the shape core 14.2.0 gives them. The figures are invented.
const CORE_CHANGES = [{ key: "system.invented.mod", type: "add", value: 7 }];
// The ids the system ships and the catalogue holds with no name of its own, apart from the tracker's two.
const SHIPPED_BY_CATALOGUE = CONDITION_IDS.filter((id) => CONDITIONS[id].label === undefined && !["readied", "delayed"].includes(id));
const CORE_CONDITIONS = [
  // The ids the catalogue also holds: the eleven carry changes (invented), the rest carry none.
  ...coreConditions(),
  ...SHIPPED_BY_CATALOGUE.filter((id) => !coreConditions().some((entry) => entry.id === id)).map((id) => ({ id, name: `core.${id}`, img: `core/${id}.svg` })),
  { id: "coreonly", name: "ACKS.conditions.coreonly", img: "sys/coreonly.svg", system: { changes: CORE_CHANGES } },
];
const CORE_COMBAT_STATES = [
  { id: "overnumbering", name: "ACKS.combatStates.overnumbering", img: "icons/svg/regen.svg", hud: false },
  { id: "done", name: "ACKS.combatStates.done", img: "icons/svg/cancel.svg", hud: false },
  { id: "readied", name: "ACKS.combatStates.readied", img: "icons/svg/ice-aura.svg", hud: false },
  { id: "delayed", name: "ACKS.combatStates.delayed", img: "icons/svg/clockwork.svg", hud: false },
];
globalThis.CONFIG = {
  // What the system's `init` has already written when the module takes the palette: its conditions, its
  // combat states, the Foundry ids it always keeps, and (its setting on) the rest of Foundry's list.
  statusEffects: [
    ...CORE_CONDITIONS,
    ...CORE_COMBAT_STATES,
    { id: "dead", name: "EFFECT.StatusDead", img: "core/dead.svg" },
    { id: "fly", name: "EFFECT.StatusFlying", img: "core/fly.svg" },
    { id: "blind", name: "EFFECT.StatusBlind", img: "core/blind.svg" },
    { id: "stun", name: "EFFECT.StatusStunned", img: "core/stun.svg", order: 9 },
  ],
  specialStatusEffects: {},
  ACKS: { conditions: CORE_CONDITIONS, combatStates: CORE_COMBAT_STATES },
  // Foundry's own answer: a change applies in the phase that asks for it.
  ActiveEffect: { documentClass: class { shouldApplyChange(change, options) { return change.phase === options?.phase; } } },
};
const fx = await import("../scripts/lib/status-effects.mjs");
const STATES = ["dead", "invisible", "acks-extras.running"];
const config = (id) => CONFIG.statusEffects.find((s) => s.id === id);
const configIds = () => CONFIG.statusEffects.map((s) => s.id);
const store = (value) => { stored.value = value; return fx.applyStatusPalette(); };

ok("taking the palette registers the catalogue, the engine's states, the system's own and the Foundry ids the system keeps, unordered", () => {
  fx.registerStatusEffects();
  assert.deepEqual(configIds().sort(), [...CONDITION_IDS, ...STATES, "done", "overnumbering", "coreonly", "fly"].sort());
  for (const status of CONFIG.statusEffects) {
    assert.deepEqual([status.order], [undefined], status.id);
    assert.ok(status.name && status.img, status.id);
  }
  // The module's own entry for an id Foundry also uses, not Foundry's.
  assert.equal(config("dead").img, "icons/svg/skull.svg");
  // Foundry's blindness is pointed at Blinded by the system, not rewritten here.
  assert.equal(CONFIG.specialStatusEffects.BLIND, undefined);
});

ok("the system's combat states are registered with nothing arranged, so the tracker's Done can toggle them", () => {
  for (const id of ["overnumbering", "done", "readied", "delayed"]) assert.ok(config(id), id);
  // The states the system leaves off the HUD are off the palette and hidden.
  assert.equal(config("done").hud, false);
  assert.equal(config("overnumbering").hud, false);
  assert.equal(config("done").name, "ACKS.combatStates.done");
  const all = new Map(fx.knownStatuses().map((s) => [s.id, s]));
  assert.deepEqual([all.get("done").source, all.get("done").defaultOn, all.get("done").keep], ["system", false, true]);
  // The catalogue names Readied and Delayed too: each is offered once, under "system", on the palette, with the system's name and image.
  for (const id of ["readied", "delayed"]) {
    assert.equal(fx.knownStatuses().filter((entry) => entry.id === id).length, 1, `${id} is known once`);
    assert.deepEqual([all.get(id).source, all.get(id).defaultOn, all.get(id).keep], ["system", true, true], id);
    assert.deepEqual([config(id).name, config(id).img, config(id).hud], [`ACKS.combatStates.${id}`, CORE_COMBAT_STATES.find((c) => c.id === id).img, undefined], id);
  }
});

ok("a system condition the catalogue lacks is registered and off the HUD, with the figures it carries", () => {
  assert.equal(config("coreonly").hud, false);
  assert.deepEqual(config("coreonly").system.changes, CORE_CHANGES);
  const entry = fx.knownStatuses().find((s) => s.id === "coreonly");
  assert.deepEqual([entry.source, entry.defaultOn, entry.keep], ["system", false, true]);
  assert.equal(fx.readStatusPalette().find((e) => e.id === "coreonly").on, false);
});

ok("an id the system ships takes the system's name and image; an id it does not ship keeps the catalogue's", () => {
  assert.deepEqual([config("blinded").name, config("blinded").img], ["core.blinded", "core/blinded.svg"]);
  assert.deepEqual([config("beholding").name, config("beholding").img], ["core.beholding", "core/beholding.svg"], "one the mock list gives no change");
  assert.equal(fx.knownStatuses().filter((s) => s.id === "blinded").length, 1);
  assert.equal(fx.knownStatuses().find((s) => s.id === "blinded").source, "condition");
  for (const id of ["casting", "immune"]) {
    assert.deepEqual([config(id).name, config(id).img], [`${LANG_PREFIX}.condition.${id}`, CONDITIONS[id].img], id);
  }
  // The system's entry rides as the whole of the entry's data, less its `hud`.
  assert.deepEqual(config("beholding").system, undefined);
  assert.equal(config("beholding").hud, undefined);
});

ok("the status module re-exports the one name reader", () => {
  assert.equal(fx.conditionNameKey, conditionNameKey);
  assert.equal(fx.conditionNameKey("blinded"), "core.blinded");
  assert.equal(fx.conditionNameKey("casting"), `${LANG_PREFIX}.condition.${"casting"}`);
});

ok("the palette's groups: States hold the module's own marks, Conditions hold the rest, the tracker's four marks sit under Combat tracker", () => {
  const all = new Map(fx.knownStatuses().map((s) => [s.id, s]));
  const under = (source) => [...all.values()].filter((s) => s.source === source).map((s) => s.id).sort();
  assert.deepEqual(under("state"), [
    "acks-extras.running", "casting", "countercharging", "cover-chest-high", "cover-waist-high", "dead", "defending",
    "diseased", "frostbitten", "invisible", "retreating", "withdrawing",
  ]);
  assert.deepEqual(under("system"), ["coreonly", "delayed", "done", "overnumbering", "readied"]);
  assert.deepEqual(under("condition"), CONDITION_IDS.filter((id) => !CONDITIONS[id].state && !["readied", "delayed"].includes(id)).sort());
  for (const id of ["immune", "resistant", "subjacent", "vomiting", "concentrating-and-stationary"]) assert.equal(all.get(id).source, "condition", id);
  // Every mark the module files under States, and Readied and Delayed, is on the palette by default; the system's other two are not.
  for (const id of [...under("state"), "readied", "delayed"]) assert.deepEqual([all.get(id).defaultOn, all.get(id).keep], [true, true], id);
  assert.deepEqual(["done", "overnumbering"].map((id) => all.get(id).defaultOn), [false, false]);
  // The three ids the catalogue renamed are not known, and the two it added are known once.
  for (const old of ["concentratingStationary", "covered", "coveredGreater"]) assert.equal(all.has(old), false, old);
  assert.equal(fx.knownStatuses().filter((s) => s.id === "vomiting" || s.id === "concentrating-and-stationary").length, 2);
  assert.deepEqual([config("vomiting").name, config("vomiting").img], ["core.vomiting", "core/vomiting.svg"]);
});

ok("with no system loaded a catalogue id is still known and registered, under the module's own key and with no image", () => {
  const was = CONFIG.ACKS;
  delete CONFIG.ACKS;
  try {
    const all = new Map(fx.knownStatuses().map((s) => [s.id, s]));
    const id = "hungry";
    assert.deepEqual([all.get(id).name, all.get(id).img, all.get(id).source], [`${LANG_PREFIX}.condition.${id}`, undefined, "condition"]);
    assert.deepEqual([all.get("casting").img, all.get("casting").source], [CONDITIONS.casting.img, "state"]);
    assert.equal(all.get("readied").source, "condition", "with no tracker list the tracker's marks are filed with the conditions");
    assert.equal(all.get("hungry").data, undefined);
  } finally {
    CONFIG.ACKS = was;
  }
});

ok("an id the system ships carries the system's changes on the catalogue's entry, so a toggled status holds them", () => {
  for (const id of CONDITION_ORDER.filter((candidate) => !IMPLYING_IDS.includes(candidate))) {
    assert.deepEqual(config(id).system?.changes, conditionChanges(id), id);
    assert.deepEqual([config(id).name, config(id).img], [`core.${id}`, `core/${id}.svg`], `${id} takes the system's name and image`);
    assert.equal(config(id).hud, undefined, `${id} stays on the palette`);
  }
  // A system id with no change adds none; an id the system does not ship carries nothing of its own.
  assert.equal(config("restrained").system, undefined);
  assert.equal(config("diseased").system, undefined);
  // Readied and Delayed are combat states in the system: on the palette, with the system's entry as their data.
  for (const id of ["readied", "delayed"]) assert.deepEqual([config(id).system, config(id).hud], [undefined, undefined], id);
  // The changes ride off the palette and under an arrangement too.
  store({ layout: ["stun"], off: ["berserk"] });
  assert.deepEqual([config("berserk").system?.changes, config("berserk").hud], [conditionChanges("berserk"), false]);
  assert.deepEqual(config("shaken").system?.changes, conditionChanges("shaken"));
  store({});
  // The module is still the one writer: the system's own entries are not on the list twice.
  for (const id of CONDITION_ORDER) assert.equal(configIds().filter((s) => s === id).length, 1, id);
});

/** The static `_id` each state that brings a condition carries. Effects are stored under them, so they never change. */
const PINNED_IDS = {
  charging: "hkopszYi2vJpXKTu",
  countercharging: "tZVR3XNWjv7KUztM",
  retreating: "398ND2NgK48N4MSl",
  starving: "C8KaxEtSpHQuGU0L",
  underfed: "2vi1eW1piPFCKnzh",
};
/** The change rows a state's entry should carry: its own, then each brought condition's, read from the mock list. */
const mergedChanges = (id) => [
  ...(CORE_CONDITIONS.find((entry) => entry.id === id)?.system?.changes ?? []),
  ...conditionChanges(BROUGHT[id]),
];

ok("the static id is a pure function of the status id: 16 letters and digits, pinned, and distinct", () => {
  for (const [id, pinned] of Object.entries(PINNED_IDS)) {
    assert.equal(fx.conditionEffectId(id), pinned, id);
    assert.equal(fx.conditionEffectId(id), fx.conditionEffectId(id), "the same twice");
  }
  assert.equal(new Set(Object.values(PINNED_IDS)).size, Object.keys(PINNED_IDS).length);
  // Hyphens, one letter and a long id still give a valid document id.
  for (const id of ["a", "a-b-c", "x".repeat(40)]) assert.match(fx.conditionEffectId(id), /^[a-zA-Z0-9]{16}$/, id);
});

ok("the states that bring a condition are derived from the catalogue and the system's list, and carry the brought statuses, a static id and the merged changes in order", () => {
  const bringing = fx.knownStatuses().filter((entry) => entry.data?._id).map((entry) => entry.id);
  assert.deepEqual(bringing.sort(), [...IMPLYING_IDS].sort());
  for (const id of IMPLYING_IDS) {
    assert.deepEqual(config(id).statuses, [BROUGHT[id]], id);
    assert.equal(config(id)._id, PINNED_IDS[id], id);
    assert.deepEqual(config(id).system.changes, mergedChanges(id), `${id}: its own changes, then the brought condition's`);
    const ofModule = CONDITIONS[id].label !== undefined;
    assert.deepEqual([config(id).name, config(id).img], ofModule ? [`${LANG_PREFIX}.condition.${id}`, CONDITIONS[id].img] : [`core.${id}`, `core/${id}.svg`], id);
  }
  // A state the system's list does not ship still carries what it brings.
  assert.equal(CORE_CONDITIONS.some((entry) => entry.id === "countercharging"), false);
  assert.deepEqual(config("countercharging").system.changes, conditionChanges("disordered"));
  // The brought condition's own entry is unchanged.
  assert.deepEqual([config("disordered").statuses, config("disordered")._id], [undefined, undefined]);
});

ok("registering a state copies the system's rows: changing the registered entry leaves the system's list as it was", () => {
  const rows = config("charging").system.changes;
  rows[0].value = 999999;
  rows.push({ key: "system.invented.mod", type: "add", value: 1 });
  assert.deepEqual(CORE_CONDITIONS.find((entry) => entry.id === "charging").system.changes, conditionChanges("charging"));
  assert.deepEqual(CORE_CONDITIONS.find((entry) => entry.id === "disordered").system.changes, conditionChanges("disordered"));
  store({});
  assert.deepEqual(config("charging").system.changes, mergedChanges("charging"));
});

ok("a state whose closure takes away acting, and one that brings only conditions with no change, get no static id", () => {
  // Slumbering brings Blinded, which carries changes in the list, and Helpless, which forbids acting.
  assert.ok(CONDITIONS.slumbering.implies.includes("blinded"));
  assert.deepEqual([config("slumbering")._id, config("slumbering").statuses, config("slumbering").system], [undefined, undefined, undefined]);
  // Prone carries changes of its own and brings a condition that has none.
  assert.ok(CONDITIONS.prone.implies.length);
  assert.deepEqual([config("prone")._id, config("prone").statuses], [undefined, undefined]);
  assert.deepEqual(config("prone").system.changes, conditionChanges("prone"));
  // The folded Defend has no palette entry of its own.
  const folded = ["defending", "Shield"].join("");
  assert.equal(fx.knownStatuses().some((s) => s.id === folded), false);
  assert.equal(config(folded), undefined);
});

ok("the set follows the system's list at registration: with the brought condition's changes gone, the state brings nothing", () => {
  const was = CONFIG.ACKS.conditions;
  CONFIG.ACKS.conditions = was.map((entry) => (entry.id === "hungry" ? { id: entry.id, name: entry.name, img: entry.img } : entry));
  try {
    assert.deepEqual(fx.knownStatuses().filter((entry) => entry.data?._id).map((entry) => entry.id).sort(), ["charging", "countercharging", "retreating"]);
  } finally {
    CONFIG.ACKS.conditions = was;
  }
  assert.equal(fx.knownStatuses().filter((entry) => entry.data?._id).length, IMPLYING_IDS.length);
});

ok("Foundry's shouldApplyChange is wrapped once: its refusal stands, a repeat of one condition's change is refused, and a throw leaves its answer", () => {
  const apply = CONFIG.ActiveEffect.documentClass.prototype.shouldApplyChange;
  fx.registerStatusEffects();
  assert.equal(CONFIG.ActiveEffect.documentClass.prototype.shouldApplyChange, apply, "wrapped once, not again");
  const ask = (effect, change, phase = "initial", asked = "initial") => apply.call(effect, { ...change, phase }, { phase: asked });
  const hand = effectOf("disordered");
  const charge = implyingEffect("charging");
  actorOf("character", [hand, charge]);
  const acOf = (effect) => effect.system.changes.find((change) => change.key === "system.ac.mod");
  assert.equal(ask(hand, acOf(hand)), true, "the first of Disordered's change counts");
  assert.equal(ask(charge, acOf(charge)), false, "the later copy does not");
  assert.equal(ask(charge, charge.system.changes[0]), true, "the charge's own figure still counts");
  assert.equal(ask(hand, acOf(hand), "final", "initial"), false, "Foundry's refusal stands, though the change would count");
  // A throw in this module's part: the logged error, and Foundry's answer.
  const errors = [];
  const logged = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const broken = { system: { changes: [] }, get statuses() { throw new Error("test failure"); } };
    assert.equal(ask(broken, { key: "system.ac.mod" }), true);
    assert.equal(ask(broken, { key: "system.ac.mod" }, "final", "initial"), false, "a refusal is returned before the part runs");
  } finally {
    console.error = logged;
  }
  assert.equal(errors.length, 1);
});

ok("the system's setting off: no Foundry status is on the palette, and only the ids the system always keeps are registered", () => {
  system["core-status-effects"] = false;
  const palette = store({});
  assert.ok(palette.some((e) => e.source === "foreign") && palette.filter((e) => e.source === "foreign").every((e) => !e.on));
  for (const id of ["stun", "blind"]) {
    assert.deepEqual([fx.knownStatuses().find((s) => s.id === id).defaultOn, config(id)], [false, undefined], id);
  }
  // The system keeps `fly` registered whatever its setting says, so it is registered here, off the HUD.
  assert.deepEqual([fx.knownStatuses().find((s) => s.id === "fly").keep, config("fly").hud], [true, false]);
});

ok("the system's setting on: Foundry's statuses are on by default, and the ids the system always keeps are not turned on by it", () => {
  system["core-status-effects"] = true;
  try {
    const known = new Map(fx.knownStatuses().map((s) => [s.id, s]));
    for (const id of ["stun", "blind"]) assert.deepEqual([known.get(id).source, known.get(id).defaultOn, known.get(id).keep], ["foreign", true, false], id);
    assert.deepEqual([known.get("fly").source, known.get("fly").defaultOn, known.get("fly").keep], ["foreign", false, true]);
    store({});
    assert.deepEqual([config("stun").hud, config("blind").hud, config("fly").hud], [undefined, undefined, false]);
    // Foundry's own entry carries over, order and all, as the palette places it.
    assert.deepEqual([config("stun").name, config("stun").img], ["EFFECT.StatusStunned", "core/stun.svg"]);
    // The engine's own `dead` and `invisible` are the module's whichever way the setting reads.
    assert.equal(config("dead").img, "icons/svg/skull.svg");
    // A setting that cannot be read answers off.
    system.unreadable = true;
    assert.equal(fx.knownStatuses().find((s) => s.id === "stun").defaultOn, false);
  } finally {
    system.unreadable = false;
    system["core-status-effects"] = false;
    store({});
  }
});

ok("the ids Foundry's list once used for a condition are no longer reserved or rewritten", () => {
  const known = new Set(fx.knownStatuses().map((s) => s.id));
  const taken = fx.takenStatusIds();
  assert.deepEqual([...taken].sort(), [...known].sort());
  for (const id of ["deaf", "fear", "paralysis", "restrain", "sleep", "bless", "silence"]) assert.equal(taken.has(id), false, id);
  // Foundry's own `blind` is a status like any other the system's list carried.
  assert.ok(taken.has("blind"));
});

ok("an arranged palette carries each status's place, and a status put back is registered with what it brought", () => {
  const palette = store({ layout: ["stun", "prone", "dead"], off: ["blinded"] });
  assert.deepEqual([config("stun").order, config("prone").order, config("dead").order], [0, 1, 2]);
  assert.deepEqual([config("stun").name, config("stun").img], ["EFFECT.StatusStunned", "core/stun.svg"]);
  // Every other default follows the arranged ones; what is off the palette carries no place.
  const rest = CONFIG.statusEffects.filter((s) => s.hud !== false && !["stun", "prone", "dead", "blinded"].includes(s.id));
  assert.ok(rest.length && rest.every((s) => s.order >= 3));
  // Off the palette, but toggled by id: kept, and hidden from the HUD.
  assert.deepEqual([config("blinded").hud, config("blinded").order], [false, undefined]);
  assert.deepEqual([config("fly").hud, config("fly").order], [false, undefined]);
  assert.equal(palette.find((e) => e.id === "stun").on, true);
  assert.deepEqual(fx.readStatusPalette().filter((e) => e.on).slice(0, 3).map((e) => e.id), ["stun", "prone", "dead"]);
});

ok("a tracker mark the catalogue does not hold can be put on, and the system's `hud: false` does not follow it", () => {
  store({ layout: ["done"] });
  assert.deepEqual(config("done"), { id: "done", name: "ACKS.combatStates.done", img: "icons/svg/cancel.svg", order: 0 });
  store({});
  // Off the palette it stays registered, and hidden.
  assert.deepEqual([config("done").hud, config("done").order], [false, undefined]);
});

ok("a status another package registers afterwards stays, on the palette by default and registered off it", () => {
  CONFIG.statusEffects.push({ id: "modmark", name: "Mod Mark", img: "mod/mark.svg", extra: true });
  store({});
  assert.deepEqual(config("modmark"), { id: "modmark", name: "Mod Mark", img: "mod/mark.svg", extra: true });
  const entry = fx.knownStatuses().find((s) => s.id === "modmark");
  assert.deepEqual([entry.source, entry.defaultOn, entry.keep], ["foreign", true, true]);
  store({ layout: ["prone"], off: ["modmark"] });
  assert.equal(config("modmark").hud, false);
  store({});
  assert.equal(config("modmark").hud, undefined);
});

ok("a status of the Judge's own is registered with the effect it carries, and is gone once deleted", () => {
  const mine = {
    id: "warded", name: "Warded", img: "w.svg",
    effect: { system: { changes: [{ key: "system.x", type: "add", value: "1" }] }, duration: { value: 3, units: "rounds" } },
  };
  store({ custom: [mine] });
  assert.deepEqual(config("warded"), { ...mine.effect, id: "warded", name: "Warded", img: "w.svg" });
  assert.equal(fx.knownStatuses().find((s) => s.id === "warded").source, "custom");
  assert.ok(fx.takenStatusIds().has("warded"));
  // Off the palette it stays registered: an effect on a token still names it.
  store({ off: ["warded"], custom: [mine] });
  assert.equal(config("warded").hud, false);
  // Deleted: not registered, and not read back as another package's.
  store({});
  assert.equal(config("warded"), undefined);
  assert.equal(fx.knownStatuses().some((s) => s.id === "warded"), false);
  store({});
  assert.equal(config("warded"), undefined);
});

ok("a changed arrangement rewrites the list with no canvas to redraw", () => {
  stored.value = { layout: ["dead", "prone"] };
  fx.onStatusPaletteChange();
  assert.deepEqual([config("dead").order, config("prone").order], [0, 1]);
  stored.value = {};
  fx.onStatusPaletteChange();
  assert.equal(config("dead").order, undefined);
});

console.log(`\n${passed} status palette checks passed.`);
