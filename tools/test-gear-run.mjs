/**
 * The beastman gear the item carrier runs (S8b-1), offline: the item minted from
 * an imported equipment row (its shape by the value keys the row holds, every
 * figure a live registry reference and no number on the item), the generation
 * copy (a basic entry gains nothing), the three runners' records (an action part
 * written straight to each admitted subject, a save raised on a reach with its
 * pass, fail and immune cases, a standing part held once per subject and kind,
 * lifted at an exit and kept while another reach of the kind still holds the
 * subject), the relayed press resolving its window and entry state on the GM's
 * side, and the morale read. Foundry-free with stand-ins; every name, key and
 * figure below is invented.
 *
 * Usage: node tools/test-gear-run.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = { utils: { randomID: () => "rid" }, data: { operators: { ForcedDeletion }, EmanationShapeData: class {} } };
const gameStub = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true }, time: { worldTime: 0 }, combat: null, messages: { get: () => null } };
globalThis.game = gameStub;
const notes = [];
globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text]), error: (text) => notes.push(["error", text]), info: (text) => notes.push(["info", text]) } };
globalThis.CONST = { REGION_VISIBILITY: { GAMEMASTER: 1 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };
globalThis.CONFIG = {
  Region: { documentClass: class { constructor(data) { this.data = data; } static schema = { fields: { attachment: { fields: { token: {} } } } }; static createTokenEmanation = async () => ({ id: "R1" }); } },
  specialStatusEffects: {},
  statusEffects: [{ id: "held", name: "Held Name", img: "held.svg" }],
};

const { gearRunItem, STANDING_ROLLS } = await import("../scripts/monsters/gear-run.mjs");
const org = await import("../scripts/monsters/organisation.mjs");
const logic = await import("../scripts/lib/item-run-logic.mjs");
const run = await import("../scripts/lib/item-run.mjs");
const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");
const { GROUP_FLAG } = await import("../scripts/lib/group-logic.mjs");
const { MORALE_ROLL_KEY } = await import("../scripts/lib/constants.mjs");
const rollMods = await import("../scripts/lib/roll-mods.mjs");
const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const DOC = org.ORGANISATION_DOC;
const TABLE = org.ORGANISATION_TABLES.equipment;
const fold = (word) => (word === "blinded" ? "held" : null);
const BASE = { doc: DOC, table: TABLE, fold };

/** An invented equipment row of each shape, figures as `importedOrganisation` reads them. */
const rows = {
  encourage: { key: "r1", label: "Alpha Item", cite: "XX p. 4", figures: { radius: 7, damage: 2, reachKind: "Alphas" } },
  banner: { key: "r2", label: "Beta Item", cite: "XX p. 4", figures: { radius: 9, saveKind: "paralysis", immunityTurns: 3, condition: "blinded" } },
  drum: { key: "r3", label: "Gamma Item", cite: "XX p. 5", figures: { radius: 11, bonus: 1, reachKind: "alphas" } },
};
const registerRows = (over = {}) => {
  resetTables();
  const tables = { [TABLE]: Object.fromEntries(Object.values(rows).map((r) => [r.key, { label: r.label, ...r.figures, ...(over[r.key] ?? {}) }])) };
  registerTable({ id: DOC, cites: { [TABLE]: "XX p. 4" }, tables }, { priority: PRIORITY.WORLD });
};

/* -------------------------------------------- */
/*  The minted item                              */
/* -------------------------------------------- */

const numbersIn = (value, found = []) => {
  if (typeof value === "number") found.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, found);
  return found;
};

await t("a row is the shape its value keys make it, never its key: an action item, a toggled save item and a toggled standing item", () => {
  const missed = [];
  const miss = (figure, word) => missed.push([figure, word]);
  const once = gearRunItem(rows.encourage, { ...BASE, miss });
  const flag = once.flags["acks-extras"].itemRun;
  assert.equal(flag.activation.kind, "once");
  assert.equal(flag.rows[0].reach.pulse, "action");
  assert.deepEqual(flag.rows[0].reach.filter, { kinds: ["alphas"], exceptKinds: [], side: "any", unit: "under" }, "the printed qualifier folded by kindToken, the bearer's subordinates");
  assert.deepEqual(flag.rows[0].reach.on, ["damage"]);
  assert.deepEqual(flag.rows[0].endsOn, ["attack"]);
  assert.deepEqual(flag.rows[0].reach.modifier, { doc: DOC, table: TABLE, row: "r1", figure: "damage" });
  assert.deepEqual(flag.rows[0].reach.radius, { doc: DOC, table: TABLE, row: "r1", figure: "radius" });

  const banner = gearRunItem(rows.banner, { ...BASE, miss }).flags["acks-extras"].itemRun;
  assert.equal(banner.activation.kind, "toggle");
  assert.equal(banner.rows[0].reach.pulse, "turnStart+moveIn");
  assert.deepEqual(banner.rows[0].conditions, ["held"], "the printed condition word folded onto the catalogue key");
  assert.deepEqual(banner.rows[0].reach.save, { doc: DOC, table: TABLE, row: "r2", figure: "saveKind" });
  assert.deepEqual(banner.rows[0].reach.immunity, { doc: DOC, table: TABLE, row: "r2", figure: "immunityTurns" });
  assert.deepEqual(banner.rows[0].reach.filter.kinds, [], "any creature");

  const drum = gearRunItem(rows.drum, { ...BASE, miss }).flags["acks-extras"].itemRun;
  assert.equal(drum.activation.kind, "toggle");
  assert.equal(drum.rows[0].reach.pulse, "standing");
  assert.deepEqual(drum.rows[0].reach.on, [...STANDING_ROLLS]);
  assert.equal(drum.rows[0].reach.filter.unit, "under", "the bearer's unit and those under it, not its own group alone");
  assert.deepEqual(missed, []);
  for (const item of [once, gearRunItem(rows.banner, BASE), gearRunItem(rows.drum, BASE)]) {
    assert.equal(item.type, "item");
    assert.equal(item.flags["acks-extras"].cookbook.id, `organisation.gear.${item.flags["acks-extras"].itemRun.rows[0].reach.radius.row}`, "the kind key `kindKeyOf` answers");
    assert.deepEqual(numbersIn(item.flags), [], "no figure sits on the item");
  }
});

await t("a row that cannot be resolved writes no reach and is reported, never guessed", () => {
  const missed = [];
  const miss = (figure, word) => missed.push([figure, word]);
  assert.equal(gearRunItem({ ...rows.banner, figures: { ...rows.banner.figures, condition: "unheardof" } }, { ...BASE, miss }), null);
  assert.equal(gearRunItem({ ...rows.banner, figures: { ...rows.banner.figures, condition: undefined } }, { ...BASE, miss }), null);
  assert.equal(gearRunItem({ ...rows.encourage, figures: { radius: 7, damage: 2 } }, { ...BASE, miss }), null, "no printed qualifier");
  assert.equal(gearRunItem({ ...rows.encourage, figures: { radius: 7 } }, { ...BASE, miss }), null, "a radius that fits no shape");
  assert.deepEqual(missed, [["condition", "unheardof"], ["condition", null], ["reachKind", null], ["shape", null]]);
  assert.equal(gearRunItem({ key: "r9", label: "No reach", figures: { healDice: "1d3" } }, { ...BASE, miss: () => assert.fail("a row with no radius is no reach item and is not reported") }), null);
  assert.equal(gearRunItem({ ...rows.banner, figures: { ...rows.banner.figures, radius: "far" } }, BASE), null, "a radius that is no number");
  const noWindow = gearRunItem({ ...rows.banner, figures: { radius: 9, saveKind: "paralysis", condition: "blinded" } }, BASE);
  assert.equal(noWindow.flags["acks-extras"].itemRun.rows[0].reach.immunity, undefined, "no window printed, none referenced");
});

await t("generation copies the minted item onto a creature whose gear axis chose it, and a basic entry gains nothing", () => {
  const gear = Object.values(rows).map((r) => ({ ...r }));
  const built = org.gearPayloads(gear, { items: [] });
  assert.deepEqual(built.reachItems.map((i) => i.flags["acks-extras"].itemRun.activation.kind), ["once", "toggle", "toggle"]);
  const orgStub = { equipment: { rows: gear, cite: "XX p. 4" } };
  const chosen = { items: [] };
  org.applyGeneratedOrganisation(chosen, { choices: { gear: ["r2", "r3"] }, org: orgStub });
  assert.deepEqual(chosen.items.map((i) => i.name), ["Beta Item", "Gamma Item"], "only the chosen rows");
  const basic = { items: [] };
  const out = org.applyGeneratedOrganisation(basic, { choices: {}, org: orgStub });
  assert.equal(out, null);
  assert.deepEqual(basic.items, [], "a basic entry has no gear pin");
  const warned = [];
  const odd = { items: [] };
  org.applyGeneratedOrganisation(odd, { choices: { gear: ["r2"] }, org: { equipment: { rows: [{ ...rows.banner, figures: { ...rows.banner.figures, condition: "unheardof" } }], cite: "" } }, warn: (m) => warned.push(m) });
  assert.deepEqual(odd.items, [], "an unresolved row writes no item");
  assert.equal(odd.flags["acks-extras"].extras.organisation.unresolved[0].figure, "condition");
  assert.equal(warned.length, 1);
});

/* -------------------------------------------- */
/*  Figures, parts and the diff                  */
/* -------------------------------------------- */

await t("a row's figures resolve live from the registry, an override reaches them at once, and a blank resolves to nothing", () => {
  registerRows();
  const banner = gearRunItem(rows.banner, BASE).flags["acks-extras"].itemRun.rows[0];
  assert.deepEqual(logic.reachFigures(banner), { radius: 9, modifier: null, immunityTurns: 3, save: "paralysis", on: [] });
  registerTable({ id: DOC, tables: { [TABLE]: { r2: { label: "Beta Item", radius: 4, saveKind: "death", immunityTurns: 1 } } } }, { priority: PRIORITY.OVERRIDE });
  const live = logic.reachFigures(banner);
  assert.deepEqual([live.radius, live.save, live.immunityTurns], [4, "death", 1]);
  resetTables();
  assert.deepEqual(logic.reachFigures(banner), { radius: null, modifier: null, immunityTurns: null, save: null, on: [] }, "nothing imported, nothing stands in");
  assert.deepEqual(logic.reachFigures({ key: "own", target: "paralysis", reach: { pulse: "action", radius: { value: "5" } } }).save, "paralysis", "a Judge's own item names its save on the row");
  assert.equal(logic.reachFigures({ key: "x" }), null);
});

await t("a modifier becomes parts on the named rolls, morale as a reaction part naming the morale roll, and a blank figure none", () => {
  assert.deepEqual(logic.reachParts(["damage"], 2), [{ on: "damage", value: 2 }]);
  assert.deepEqual(logic.reachParts(["ac", "attack", "morale"], 1), [{ on: "ac", value: 1 }, { on: "attack", value: 1 }, { on: "reaction", key: "morale", rollKey: MORALE_ROLL_KEY, value: 1 }]);
  assert.deepEqual(logic.reachParts(["ac"], null), []);
  assert.equal(logic.dueAtAfter(3, 600, 1000), 2800, "turns of the world's turn length from now");
  assert.equal(logic.dueAtAfter(0, 600, 1000), null);
  assert.equal(logic.dueAtAfter(null, 600, 1000), null);
  assert.equal(logic.dueAtAfter(3, 600, undefined), null, "no reading of the clock, no moment");
  assert.equal(logic.dueAtAfter(3, 0, 1000), null);
  const ids = { source: "I.1", activationId: "act", rowKey: "reach" };
  const a = logic.standingPartRecordData({ kindKey: "k", name: "N", parts: [{ on: "ac", value: 1 }], ...ids });
  assert.equal(logic.standingPartDiffers(null, a), true);
  assert.equal(logic.standingPartDiffers(a, a), false, "the same record is not written again");
  assert.equal(logic.standingPartDiffers(a, logic.standingPartRecordData({ kindKey: "k", name: "N", parts: [{ on: "ac", value: 2 }], ...ids })), true, "a changed figure");
  assert.equal(logic.standingPartDiffers(a, logic.standingPartRecordData({ kindKey: "k", name: "N", parts: [{ on: "ac", value: 1 }], source: "I.2", activationId: "other", rowKey: "reach" })), true, "another bearer's source");
  assert.equal(logic.entryStateOf({ entries: { s: { state: "applied" } } }, "s"), "applied");
  assert.equal(logic.entryStateOf({ entries: {} }, "s"), "open");
  assert.equal(logic.entryStateOf(null, "s"), "open");
});

/* -------------------------------------------- */
/*  A stage for the runners                      */
/* -------------------------------------------- */

class Users extends Array {
  get(id) { return this.find((u) => u.id === id); }
}
const seatOf = (primaryGM, list = [{ id: "owner" }, { id: "other" }]) => {
  const users = Users.from(list);
  users.activeGM = primaryGM ? { isSelf: true } : undefined;
  gameStub.users = users;
};

/** A monster that answers to `types`, with the effects it holds and the writes it was asked for. */
function creature(name, types, group = "") {
  const effects = [];
  effects.get = (id) => effects.find((e) => e.id === id);
  const writes = { created: [], deleted: [] };
  const actor = {
    documentName: "Actor", type: "monster", name, system: { details: { class: "" }, saves: { paralysis: { value: 12 } } }, effects, appliedEffects: effects, writes,
    getFlag: () => (types ? { types } : undefined),
    createEmbeddedDocuments: async (kind, records) => {
      writes.created.push(...records);
      return records.map((r, i) => {
        const made = { id: r._id ?? `E${effects.length}`, ...r, update: async (data) => { Object.assign(made, data); writes.updated = [...(writes.updated ?? []), data]; } };
        effects.push(made);
        return made;
      });
    },
    deleteEmbeddedDocuments: async (kind, ids, options) => {
      writes.deleted.push([ids, options]);
      for (const id of ids) {
        const at = effects.findIndex((e) => e.id === id);
        if (at >= 0) effects.splice(at, 1);
      }
    },
    testUserPermission: (user) => user?.id === "owner",
  };
  const token = { id: `t-${name}`, uuid: `T.${name}`, name, hidden: false, actor, parent: null, disposition: 1, flags: { "acks-extras": group ? { [GROUP_FLAG]: group } : {} }, x: 0, y: 0, width: 1, height: 1, testInsideRegion: () => true, testUserPermission: actor.testUserPermission, regions: new Set(), getFlag: (scope, key) => token.flags[scope]?.[key] };
  return { actor, token };
}

/** A scene of the given bodies; the bearer's token is the first. */
function scene(...bodies) {
  const regions = [];
  const sc = { dimensions: { distance: 5, distancePixels: 10 }, grid: { units: "ft" }, tokens: bodies.map((b) => b.token), regions };
  sc.tokens.get = (id) => bodies.map((b) => b.token).find((tk) => tk.id === id);
  for (const b of bodies) b.token.parent = sc;
  return sc;
}

let minted = null;
const updates = [];
const theItem = {
  uuid: "I.1", name: "Alpha Item", type: "item", actor: null, update: async (data) => { updates.push(data); },
  get flags() { return { "acks-extras": minted.flags["acks-extras"] }; },
};
globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : subjects[uuid] ?? null);
const subjects = {};

const presented = [];
const installed = new Set();
const install = () => {
  if (installed.has("x")) return;
  installed.add("x");
  run.installItemRun();
  run.setUsePresenter(async (result) => presented.push(result));
};

/* -------------------------------------------- */
/*  E3: once, an action part per subject         */
/* -------------------------------------------- */

await t("the action item writes its part on each subject the filter admits, the figure read live, and refuses a blank figure with nothing written", async () => {
  registerRows();
  seatOf(true);
  install();
  const bearer = creature("bearer", ["alphas"], "G1");
  const mine = creature("mine", ["alphas"], "G1");
  const other = creature("other", ["alphas"], "G2");
  const stranger = creature("stranger", ["betas"], "G1");
  const unknown = creature("unknown", null, "G1");
  scene(bearer, mine, other, stranger, unknown);
  bearer.actor.getActiveTokens = () => [bearer.token];
  theItem.actor = bearer.actor;
  for (const b of [mine, other, stranger, unknown]) subjects[b.token.uuid] = b.token;
  bearer.token.actor = bearer.actor;
  minted = gearRunItem(rows.encourage, BASE);

  const result = await run.runUse({ itemUuid: "I.1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.written.map((w) => w.name), ["mine"], "only the bearer's own group of its kind");
  assert.deepEqual(result.undetermined.map((u) => u.name), ["other", "unknown"], "a creature of another group (under is the bearer's own group until who leads what is written) and one of no known kind are the Judge's to tick");
  assert.equal(mine.actor.writes.created.length, 1);
  const record = mine.actor.writes.created[0];
  assert.deepEqual(record.flags["acks-extras"].rollMods.parts, [{ on: "damage", value: 2 }], "the registry's figure");
  assert.equal(record.flags["acks-extras"].rollMods.cite, "XX p. 4", "the item's page reference, from its cookbook cite");
  assert.deepEqual(record.flags["acks-extras"].endsOn, ["attack"]);
  assert.equal(record.flags["acks-extras"].itemRun.source, "I.1");
  assert.equal(record.flags["acks-extras"].managed, true);
  assert.deepEqual(result.written[0].recordIds, [mine.actor.effects[0].id], "the ids an Undo removes");
  for (const b of [other, stranger, unknown, bearer]) assert.equal(b.actor.writes.created.length, 0, `${b.actor.name} gains nothing`);

  registerTable({ id: DOC, tables: { [TABLE]: { r1: { label: "Alpha Item", radius: 7, damage: 5 } } } }, { priority: PRIORITY.OVERRIDE });
  await run.runUse({ itemUuid: "I.1" });
  assert.deepEqual(mine.actor.writes.created[1].flags["acks-extras"].rollMods.parts, [{ on: "damage", value: 5 }], "an override reaches the next press with no re-stamp");

  resetTables();
  notes.length = 0;
  mine.actor.writes.created.length = 0;
  const blank = await run.runUse({ itemUuid: "I.1" });
  assert.deepEqual(blank, { ok: false, reason: "noRange" }, "nothing imported: no radius, so nothing runs");
  assert.deepEqual(mine.actor.writes.created, []);
  assert.ok(notes.some(([level]) => level === "warn"), "a Judge is warned");
  for (const b of [mine, other, stranger, unknown, bearer]) delete subjects[b.token.uuid];
});

/* -------------------------------------------- */
/*  E4: the save, pass, fail and immune          */
/* -------------------------------------------- */

const stagePress = () => {
  registerRows();
  seatOf(true);
  install();
  const subject = creature("subject", ["alphas"]);
  const bearer = creature("bearer", ["alphas"]);
  scene(bearer, subject);
  theItem.actor = bearer.actor;
  subjects[subject.token.uuid] = subject.token;
  minted = gearRunItem(rows.banner, BASE);
  return { subject, bearer };
};

await t("E4's press: a failed save writes the condition on the subject's next-turn clock, a pass writes the immunity window, and an immune subject is not asked again", async () => {
  const { subject } = stagePress();
  const flagged = {};
  const message = { flags: { "acks-extras": { itemRunCard: { itemUuid: "I.1", rowKey: "reach", activationId: "act", entries: {} } } }, getFlag(scope, key) { return this.flags[scope][key]; }, async setFlag(scope, key, value) { this.flags[scope][key] = value; flagged[key] = value; } };
  gameStub.messages = { get: (id) => (id === "M1" ? message : null) };
  gameStub.combat = { id: "c1", combatants: [{ id: "m1", tokenId: subject.token.id }] };
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const target = saveSpec(subject.actor, "paralysis").target;
  const priorRoll = globalThis.Roll;
  let thrown = target - 1;
  globalThis.Roll = class { async evaluate() { return { total: thrown }; } };
  try {
    const failed = await run.pressRoll({ itemUuid: "I.1", rowKey: "reach", activationId: "act", subject: subject.token.uuid, messageId: "M1" });
    assert.equal(failed.ok, true);
    assert.equal(failed.saved, false);
    const [record] = subject.actor.writes.created;
    assert.deepEqual(record.statuses, ["held"], "the condition key the row names, through the status helper");
    assert.deepEqual(record.flags["acks-extras"].turnLife, { combatId: "c1", combatantId: "m1", edge: "start", count: 1 }, "lifts at the subject's next turn start");
    assert.equal(flagged.itemRunCard.entries[subject.token.uuid].state, "applied");

    // A second token's pass on a fresh card: the window, and then the subject is immune.
    message.flags["acks-extras"].itemRunCard.entries = {};
    subject.actor.writes.created.length = 0;
    subject.actor.effects.length = 0;
    thrown = target;
    const passed2 = await run.pressRoll({ itemUuid: "I.1", rowKey: "reach", activationId: "act", subject: subject.token.uuid, messageId: "M1" });
    assert.equal(passed2.saved, true);
    const [window] = subject.actor.writes.created;
    assert.deepEqual(window.flags["acks-extras"].rollMods.parts, [{ on: "immune", spells: ["organisation.gear.r2"] }], "the kind's key");
    assert.equal("duration" in window, false, "no core duration is written");
    assert.equal(window.flags["acks-extras"].itemRun.dueAt, 3 * 600, "the imported window, in turns, on the module's clock");
    assert.equal(window.flags["acks-extras"].rollMods.cite, "XX p. 4", "the item's page reference, from its cookbook cite");
    assert.notEqual(window.flags["acks-extras"].itemRun.activationId, "act", "the window is not the raised activation's, so lowering leaves it");

    // The reach's next moment on an immune subject asks for nothing.
    presented.length = 0;
    const row = minted.flags["acks-extras"].itemRun.rows[0];
    const ctx = { moment: "moveIn", config: { activationId: "act" }, item: theItem, row, reach: { pulse: "turnStart+moveIn" }, subject: { actor: subject.actor, token: subject.token }, admitted: true };
    await run.handleReachMoment(ctx);
    assert.deepEqual(presented.map((p) => p.act), ["skip"], "held is not asked again");
    subject.actor.effects.length = 0;
    presented.length = 0;
    await run.handleReachMoment(ctx);
    assert.deepEqual(presented.map((p) => p.act), ["prompt"], "a body with no window is asked");
  } finally {
    gameStub.messages = { get: () => null };
    gameStub.combat = null;
    globalThis.Roll = priorRoll;
    delete subjects[subject.token.uuid];
  }
});

await t("the relayed press carries ids and a total only: a forged window, entry state, figure or ids change nothing, and a second press of the row is refused", async () => {
  const { subject } = stagePress();
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const target = saveSpec(subject.actor, "paralysis").target;
  const message = { flags: { "acks-extras": { itemRunCard: { itemUuid: "I.1", rowKey: "reach", activationId: "act", entries: {} } } }, getFlag(scope, key) { return this.flags[scope][key]; }, async setFlag(scope, key, value) { this.flags[scope][key] = value; } };
  gameStub.messages = { get: (id) => (id === "M1" ? message : null) };
  const press = (over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "forged", activationId: "forged", subject: subject.token.uuid, messageId: "M1", total: target, target, requestUserId: "owner", window: () => ({ name: "Forged", duration: { seconds: 1 } }), entryState: "open", ...over });
  try {
    const first = await press();
    assert.equal(first.ok, true);
    assert.equal(subject.actor.writes.created[0].flags["acks-extras"].itemRun.dueAt, 1800, "the GM's reading of the row, not the request's window");
    assert.deepEqual(subject.actor.writes.created[0].flags["acks-extras"].itemRun, { source: "I.1", activationId: "rid", rowKey: "reach", dueAt: 1800 }, "the card's own row and a window id of its own");
    assert.equal((await press({ total: 1 })).reason, "applied", "the second press is refused from the card");
    assert.equal(subject.actor.writes.created.length, 1);
    // Two presses that overlap: the second is refused while the first is mid-write.
    message.flags["acks-extras"].itemRunCard.entries = {};
    subject.actor.writes.created.length = 0;
    const both = await Promise.all([press(), press()]);
    assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
    assert.equal(subject.actor.writes.created.length, 1, "one write");
    assert.equal((await press({ target: target + 1 })).reason, "applied", "a forged figure on an applied row is still refused");
    message.flags["acks-extras"].itemRunCard.entries = {};
    assert.equal((await press({ target: target + 1 })).reason, "figure", "a target the row's own figure does not give");
    assert.equal((await press({ messageId: "", rowKey: "reach" })).reason, "noCard", "a relayed press with no card");
  } finally {
    gameStub.messages = { get: () => null };
    delete subjects[subject.token.uuid];
  }
});

/* -------------------------------------------- */
/*  E9: a standing part                          */
/* -------------------------------------------- */

await t("E9: a standing part is held once per subject and kind, written only when it differs, and lifted when the subject leaves", async () => {
  registerRows();
  seatOf(true);
  install();
  minted = gearRunItem(rows.drum, BASE);
  const row = minted.flags["acks-extras"].itemRun.rows[0];
  const bearer = creature("bearer", ["alphas"], "G1");
  const sub = creature("sub", ["alphas"], "G1");
  scene(bearer, sub);
  theItem.actor = bearer.actor;
  const moment = (name, admitted = true, region = { id: "RA" }) => run.handleReachMoment({ moment: name, config: { activationId: "act" }, item: theItem, row, reach: { pulse: "standing" }, subject: { actor: sub.actor, token: sub.token }, admitted, region });

  await moment("enter");
  assert.equal(sub.actor.writes.created.length, 1);
  const record = sub.actor.writes.created[0];
  assert.equal(record._id, logic.standingPartId("organisation.gear.r3"), "the fixed id of the kind");
  assert.deepEqual(record.flags["acks-extras"].rollMods.parts.map((p) => [p.on, p.value, p.rollKey ?? null]), [["ac", 1, null], ["attack", 1, null], ["reaction", 1, MORALE_ROLL_KEY]]);
  assert.equal(record.flags["acks-extras"].rollMods.cite, "XX p. 5", "the standing part carries the item's page reference");
  await moment("enter");
  assert.equal(sub.actor.writes.created.length, 1, "written only when it differs");
  assert.equal(sub.actor.writes.updated, undefined);

  registerTable({ id: DOC, tables: { [TABLE]: { r3: { label: "Gamma Item", radius: 11, bonus: 2 } } } }, { priority: PRIORITY.OVERRIDE });
  await moment("enter");
  assert.equal(sub.actor.writes.created.length, 1, "an overridden figure updates the one record");
  assert.deepEqual(sub.actor.writes.updated[0].flags["acks-extras"].rollMods.parts.map((p) => p.value), [2, 2, 2]);
  registerRows();
  await moment("enter");

  await moment("exit", false);
  assert.deepEqual(sub.actor.writes.deleted, [[[logic.standingPartId("organisation.gear.r3")], managedDelete()]], "lifted when the subject leaves, as a managed delete");
  assert.equal(sub.actor.effects.length, 0);

  resetTables();
  sub.actor.writes.created.length = 0;
  await moment("enter");
  assert.deepEqual(sub.actor.writes.created, [], "a blank figure writes no part");
});

await t("E9: a subject inside two reaches of one kind keeps its part when it leaves one, and the first bearer lowering hands the part to the other", async () => {
  registerRows();
  seatOf(true);
  install();
  minted = gearRunItem(rows.drum, BASE);
  const row = minted.flags["acks-extras"].itemRun.rows[0];
  const bearer = creature("bearer", ["alphas"], "G1");
  const sub = creature("sub", ["alphas"], "G1");
  const sc = scene(bearer, sub);
  theItem.actor = bearer.actor;
  const AURA = (await import("../scripts/lib/constants.mjs")).AURA_BEHAVIOR_TYPE;
  const regionOf = (id, activationId) => ({ id, parent: sc, attachment: { token: bearer.token.id }, behaviors: [{ type: AURA, system: { sourceUuid: "I.1", bearerUuid: "A.1", activationId, rowKey: "reach" } }] });
  const A = regionOf("RA", "actA");
  const B = regionOf("RB", "actB");
  sc.regions.push(A, B);
  sub.token.regions = new Set([A, B]);
  const moment = (name, activationId, region) => run.handleReachMoment({ moment: name, config: { activationId }, item: theItem, row, reach: { pulse: "standing" }, subject: { actor: sub.actor, token: sub.token }, admitted: true, region });

  await moment("enter", "actA", A);
  assert.equal(sub.actor.effects[0].flags["acks-extras"].itemRun.activationId, "actA");
  sub.token.regions = new Set([B]);
  await moment("exit", "actA", A);
  assert.equal(sub.actor.effects.length, 1, "still inside the other reach of the kind: the part stays");
  assert.equal(sub.actor.effects[0].flags["acks-extras"].itemRun.activationId, "actB", "and is rewritten to the reach that still holds it");
  assert.equal(sub.actor.writes.deleted.length, 0);
  sub.token.regions = new Set();
  await moment("exit", "actB", B);
  assert.equal(sub.actor.effects.length, 0, "leaving the last one takes it off");

  // The first bearer lowers while the subject stands in both: its records go by activation id, then the other reach hands the part back.
  sub.actor.writes.created.length = 0;
  sub.token.regions = new Set([A, B]);
  await moment("enter", "actA", A);
  assert.equal(sub.actor.effects[0].flags["acks-extras"].itemRun.activationId, "actA");
  const repairs = await import("../scripts/lib/repair.mjs");
  gameStub.actors = [sub.actor];
  sub.actor.isToken = false;
  sub.actor.getActiveTokens = () => [sub.token];
  sub.token.regions = new Set([B]);
  await run.liftActivation({ config: { activationId: "actA", sourceUuid: "I.1" } });
  assert.equal(sub.actor.effects.length, 1, "the part is written back at once");
  assert.equal(sub.actor.effects[0].flags["acks-extras"].itemRun.activationId, "actB");
  delete gameStub.actors;
  void repairs;
});

/* -------------------------------------------- */
/*  Morale                                       */
/* -------------------------------------------- */

await t("a morale roll reads the creature's morale part, and a reaction roll never does", async () => {
  const sub = creature("sub", ["alphas"]);
  const effect = { id: "E", disabled: false, active: true, flags: { "acks-extras": { rollMods: { id: "k", label: "Gamma Item", cite: "", sourceAlignment: null, parts: logic.reachParts(["ac", "morale"], 1) } } }, getFlag(scope, key) { return this.flags[scope][key]; } };
  sub.actor.effects.push(effect);
  const shift = rollMods.moraleShift(sub.actor);
  assert.equal(shift.total, 1);
  assert.deepEqual(shift.parts.map((p) => p.label), ["Gamma Item"]);
  assert.deepEqual(shift.told[0].data, { name: "sub", rows: "Gamma Item +1" });
  const reaction = rollMods.recordParts(sub.actor, "reaction");
  assert.deepEqual(reaction.kept, [], "a reaction roll that names no roll reads no morale part");
  assert.equal(reaction.pending.length, 1, "it waits, naming nothing to roll");
  const other = creature("other", ["alphas"]);
  assert.equal(rollMods.moraleShift(other.actor).total, 0);
  assert.deepEqual(rollMods.moraleShift(other.actor).told, []);

  // Influence's morale page offers it as a ticked row; its reaction pages offer none.
  const { getRecordReactionMods } = await import("../scripts/influence/record-effects.mjs");
  const moraleRows = getRecordReactionMods(sub.actor, { rollKey: MORALE_ROLL_KEY });
  assert.deepEqual(moraleRows.map((r) => [r.label, r.value, r.family]), [["Gamma Item", 1, "morale"]]);
  assert.deepEqual(getRecordReactionMods(sub.actor, { tone: "diplomacy" }), [], "a reaction page reads no morale part");
  assert.deepEqual(getRecordReactionMods(other.actor, { rollKey: MORALE_ROLL_KEY }), []);

  // Core's fall-through adds it to the score the system's roll reads, with or without a status on the creature.
  const { withMoraleConditions } = await import("../scripts/lib/status-effects.mjs");
  sub.actor.system.details.morale = 2;
  let seen = null;
  withMoraleConditions(sub.actor, () => { seen = sub.actor.system.details.morale; });
  assert.equal(seen, 3, "the score the roll reads carries the part");
  assert.equal(sub.actor.system.details.morale, 2, "and is put back");
  assert.ok(notes.some(([, text]) => /moraleApplied/.test(text)), "told to the table");
});

console.log(`\ntest-gear-run: ${passed} checks passed.`);
