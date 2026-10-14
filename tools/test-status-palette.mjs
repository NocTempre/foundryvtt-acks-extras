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
import { CONDITION_IDS } from "../scripts/lib/conditions.mjs";

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
globalThis.game = { settings: { get: () => stored.value } };
globalThis.CONFIG = {
  // What is there when the module takes the palette: Foundry's own, by shape.
  statusEffects: [
    { id: "dead", name: "EFFECT.StatusDead", img: "core/dead.svg" },
    { id: "blind", name: "EFFECT.StatusBlind", img: "core/blind.svg" },
    { id: "stun", name: "EFFECT.StatusStunned", img: "core/stun.svg", order: 9 },
    { id: "fly", name: "EFFECT.StatusFlying", img: "core/fly.svg" },
  ],
  specialStatusEffects: {},
  ACKS: {
    statusEffects: [
      { id: "done", name: "Done", img: "sys/done.svg" },
      { id: "readied", name: "Readied", img: "sys/readied.svg", duration: { rounds: 1 } },
    ],
  },
};
const fx = await import("../scripts/lib/status-effects.mjs");
const STATES = ["dead", "invisible", "acks-extras.running"];
const config = (id) => CONFIG.statusEffects.find((s) => s.id === id);
const configIds = () => CONFIG.statusEffects.map((s) => s.id);
const store = (value) => { stored.value = value; return fx.applyStatusPalette(); };

ok("taking the palette registers the conditions and the engine's states, unordered, and nothing else", () => {
  fx.registerStatusEffects();
  assert.deepEqual(configIds().sort(), [...CONDITION_IDS, ...STATES].sort());
  for (const status of CONFIG.statusEffects) {
    assert.deepEqual([status.order, status.hud], [undefined, undefined], status.id);
    assert.ok(status.name && status.img, status.id);
  }
  assert.equal(CONFIG.specialStatusEffects.BLIND, "blinded");
  // The module's own entry for an id Foundry also uses, not Foundry's.
  assert.equal(config("dead").img, "icons/svg/skull.svg");
});

ok("what Foundry and the system offer is known, off by default; an alias of a condition is not offered", () => {
  const all = new Map(fx.knownStatuses().map((s) => [s.id, s]));
  assert.deepEqual([all.get("stun").source, all.get("stun").defaultOn, all.get("stun").keep], ["foreign", false, false]);
  assert.equal(all.get("fly").source, "foreign");
  assert.deepEqual([all.get("done").source, all.get("done").defaultOn], ["system", false]);
  assert.equal(all.has("blind"), false);
  assert.equal(all.get("readied").source, "condition");
  assert.equal(all.get("dead").source, "state");
  assert.equal(all.size, CONDITION_IDS.length + STATES.length + 3);
  const taken = fx.takenStatusIds();
  for (const id of ["blind", "prone", "stun", "done", "dead"]) assert.ok(taken.has(id), id);
});

ok("an arranged palette carries each status's place, and a status put back is registered with what it brought", () => {
  const palette = store({ layout: ["stun", "prone", "dead"], off: ["blinded"] });
  assert.deepEqual([config("stun").order, config("prone").order, config("dead").order], [0, 1, 2]);
  assert.deepEqual([config("stun").name, config("stun").img], ["EFFECT.StatusStunned", "core/stun.svg"]);
  // Every other default follows the arranged ones.
  assert.ok(CONFIG.statusEffects.filter((s) => !["stun", "prone", "dead", "blinded"].includes(s.id)).every((s) => s.order >= 3));
  // Off the palette, but toggled by id: kept, and hidden from the HUD.
  assert.deepEqual([config("blinded").hud, config("blinded").order], [false, undefined]);
  assert.equal(config("fly"), undefined);
  assert.equal(palette.find((e) => e.id === "stun").on, true);
  assert.deepEqual(fx.readStatusPalette().filter((e) => e.on).slice(0, 3).map((e) => e.id), ["stun", "prone", "dead"]);
});

ok("a tracker mark the catalogue does not hold can be put on, with its name and icon only", () => {
  store({ layout: ["done"] });
  assert.deepEqual(config("done"), { id: "done", name: "Done", img: "sys/done.svg", order: 0 });
  store({});
  assert.equal(config("done"), undefined);
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
