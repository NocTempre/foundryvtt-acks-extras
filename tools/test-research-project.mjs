/**
 * Offline tests for research projects at a location: the model
 * (`scripts/magic/research-project.mjs`), its live wrapper
 * (`research-project-live.mjs`: the linked characters, the write and the GM
 * relay) and the Research tab's template. Mocked Foundry globals; every figure,
 * name and page below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-research-project.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

/** A localizer that echoes the key and its data, so a test reads what a string was asked for. */
const echo = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);

globalThis.Hooks = { on() {}, once() {} };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s), randomID: (() => { let i = 0; return () => `id${++i}`; })() } };
const state = { isGM: true, worldTime: 4 * 86400, actors: new Map(), canModify: true, activeGM: true, relayed: [] };
globalThis.game = {
  i18n: { format: echo, localize: (k) => k },
  get user() {
    return { id: state.isGM ? "gm1" : "pl1", isGM: state.isGM };
  },
  users: { get: (id) => ({ id, isGM: id === "gm1" }), get activeGM() { return state.activeGM ? { id: "gm1" } : null; } },
  time: { get worldTime() { return state.worldTime; }, calendar: null },
  actors: { filter: (fn) => [...state.actors.values()].filter(fn) },
};
globalThis.ui = { notifications: { warn: (m) => (state.warned ??= []).push(m), info: (m) => (state.informed ??= []).push(m) } };
globalThis.fromUuidSync = (uuid) => state.actors.get(uuid) ?? null;

const M = await import("../scripts/magic/research-project.mjs");
const L = await import("../scripts/magic/research-project-live.mjs");
const { PROJECT_HANDLER } = await import("../scripts/magic/constants.mjs");
const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ------------------------------ invented tables ------------------------------ */

const facility = (o) => ({ kind: "x", present: true, minimum: null, step: null, minimums: null, bonus: { step: null, size: null, cap: null }, share: null, cite: "Invented p. 1", byHand: false, ...o });
const TABLES = {
  ladder: { present: true, rungs: [{ level: 4, rate: 30, throw: 15, marked: false }, { level: 5, rate: 90, throw: 11, marked: false }], otherProjectsRate: null, markedProjects: null, cite: "Invented p. 2", byHand: false },
  facilities: {
    library: facility({ minimum: 3000, step: 1500, bonus: { step: 7000, size: 2, cap: 5 } }),
    workshop: facility({ minimum: 3500, step: 1700, bonus: { step: 6000, size: 1, cap: 4 } }),
    identify: facility({ bonus: { step: 8000, size: 1, cap: 2 } }),
    ritualLibrary: facility({ minimums: [{ level: 5, gp: 13000 }, { level: 6, gp: 14900 }], bonus: { step: 9000, size: 1, cap: 2 } }),
    ritualWorkshop: facility({ minimums: [{ level: 5, gp: 12000 }], bonus: { step: 5000, size: 2, cap: 6 } }),
  },
  identification: { present: true, research: 800 },
};
const NOTHING = { ladder: { present: false, rungs: [], otherProjectsRate: null, markedProjects: null, cite: null, byHand: false }, facilities: Object.fromEntries(Object.keys(TABLES.facilities).map((k) => [k, facility({ present: false, cite: null })])), identification: { present: false, research: null } };

const proj = (o = {}) => M.cleanProject({ id: "p1", kind: "spell", level: 2, researcher: "A.hero", status: "open", ...o });

/* --------------------------------- the record --------------------------------- */

t("a project is cleaned to its shape; an unknown kind, a missing id or a non-object is no project", () => {
  const p = M.cleanProject({ id: "x", kind: "spell", subject: { name: " Lantern ", img: 4 }, level: "3.7", costs: { material: "12", research: -1, component: "" }, researcher: "A.hero", assistants: ["A.hero", "A.pell", "A.pell", ""], paid: { material: "5", day: "2" }, credited: [{ day: 3, amount: 4, by: "A.hero" }, { day: 3, amount: 0 }], bucket: [{ uuid: "Item.a", qty: "2" }, { uuid: "Item.a" }, {}], throw: { target: "9" }, status: "weird", opened: 1 });
  assert.deepEqual(p.subject, { uuid: "", name: "Lantern", img: "" });
  assert.equal(p.level, 3);
  assert.deepEqual(p.costs, { material: 12, component: null, research: null });
  assert.deepEqual(p.assistants, ["A.pell"], "the researcher is never an assistant, and each assistant stands once");
  assert.deepEqual(p.paid, { material: 5, day: 2 });
  assert.deepEqual(p.credited, [{ day: 3, amount: 4, by: "A.hero" }], "a credit that adds nothing is dropped");
  assert.deepEqual(p.bucket, [{ uuid: "Item.a", qty: 2, fit: "" }]);
  assert.deepEqual(p.throw, { target: 9 });
  assert.equal(p.status, "open");
  assert.equal(M.cleanProject({ id: "x", kind: "nope" }), null);
  assert.equal(M.cleanProject({ kind: "spell" }), null);
  assert.equal(M.cleanProject("x"), null);
});

t("a record reads empty from an unknown shape and keeps the facility values it holds", () => {
  assert.deepEqual(M.readRecord(undefined), { facilities: { library: null, workshop: null }, projects: [] });
  const r = M.readRecord({ facilities: { library: "9000", workshop: -2 }, projects: [{ id: "a", kind: "item" }, { kind: "item" }] });
  assert.deepEqual(r.facilities, { library: 9000, workshop: null });
  assert.equal(r.projects.length, 1);
});

t("credited research adds up, and a closed project is not open", () => {
  assert.equal(M.creditedTotal(proj({ credited: [{ day: 1, amount: 4 }, { day: 2, amount: 6.5 }] })), 10.5);
  assert.deepEqual(M.openProjects([proj(), proj({ id: "p2", status: "closed" })]).map((p) => p.id), ["p1"]);
});

/* ---------------------------------- facilities ---------------------------------- */

t("sharers count the open projects reading a facility, and the one being created", () => {
  const projects = [proj({ id: "a", kind: "spell" }), proj({ id: "b", kind: "item" }), proj({ id: "c", kind: "ritual" }), proj({ id: "d", kind: "spell", status: "closed" })];
  assert.equal(M.sharersOf(projects, "library"), 2, "a spell and a ritual read the library; the closed one does not");
  assert.equal(M.sharersOf(projects, "workshop"), 2, "an item and a ritual read the workshop");
  assert.equal(M.sharersOf(projects, "library", { adding: "identify" }), 3);
  assert.equal(M.sharersOf(projects, "workshop", { adding: "spell" }), 2, "a spell reads no workshop");
});

t("a facility's verdict reads the share against the minimum its level needs and the bonus the surplus buys", () => {
  const p = proj({ level: 2 });
  const at = (gp, projects = [p]) => M.facilityVerdicts(p, { facilities: { library: gp, workshop: null }, projects, tables: TABLES })[0];
  assert.equal(at(4500).minimum, 4500, "3000 for the first level and 1500 for the second");
  assert.equal(at(4500).verdict, "ok");
  assert.equal(at(4499).verdict, "below");
  assert.equal(at(4500).bonus, 0);
  assert.equal(at(4500 + 14000).bonus, 4, "two steps of 7000 above the minimum, 2 for each");
  assert.equal(at(4500 + 70000).bonus, 5, "held to the cap");
  const shared = at(20000, [p, proj({ id: "p2", kind: "spell" })]);
  assert.equal(shared.sharers, 2);
  assert.equal(shared.share, 10000);
  assert.equal(shared.bonus, 0, "the bonus reads the same share the minimum does: 10000 less 4500 is under a step");
  assert.equal(at(null).gp, 0, "a value the Judge has not written counts as nothing");
  assert.equal(at(null).verdict, "below");
});

t("a figure that is not read gives no verdict, no minimum and no bonus; and a level that is not entered the same", () => {
  const p = proj();
  const v = M.facilityVerdicts(p, { facilities: { library: 100, workshop: 0 }, projects: [p], tables: NOTHING })[0];
  assert.deepEqual([v.verdict, v.minimum, v.bonus, v.present, v.cite], ["unknown", null, null, false, null]);
  const noLevel = M.facilityVerdicts(proj({ level: null }), { facilities: { library: 100 }, projects: [], tables: TABLES })[0];
  assert.deepEqual([noLevel.verdict, noLevel.minimum, noLevel.bonus], ["unknown", null, null]);
  assert.deepEqual(M.facilityVerdicts(p, { facilities: {}, projects: [p], tables: undefined })[0].verdict, "unknown");
});

t("an identification reads its library against the imported research figure, and a ritual reads both its facilities", () => {
  const id = proj({ kind: "identify", level: null });
  const v = M.facilityVerdicts(id, { facilities: { library: 800 }, projects: [id], tables: TABLES });
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].minimum, v[0].verdict, v[0].bonus], [800, "ok", 0]);
  const rit = proj({ kind: "ritual", level: 5 });
  const both = M.facilityVerdicts(rit, { facilities: { library: 13000, workshop: 11999 }, projects: [rit], tables: TABLES });
  assert.deepEqual(both.map((x) => [x.value, x.minimum, x.verdict]), [["library", 13000, "ok"], ["workshop", 12000, "below"]]);
  assert.equal(M.facilityVerdicts(proj({ kind: "ritual", level: 7 }), { facilities: {}, projects: [], tables: TABLES })[0].minimum, null, "a level the passage lists no minimum for is unread");
});

t("a share below the minimum blocks a Player and warns a Judge; an unread figure does neither", () => {
  const below = [{ verdict: "ok" }, { verdict: "below" }];
  assert.deepEqual(M.facilityGate(below, { judge: false }), { ok: false, reason: "facility" });
  assert.deepEqual(M.facilityGate(below, { judge: true }), { ok: true, warn: "facility" });
  assert.deepEqual(M.facilityGate([{ verdict: "unknown" }, { verdict: "ok" }], { judge: false }), { ok: true });
  assert.deepEqual(M.facilityGate([], { judge: false }), { ok: true });
});

t("the throw reads the ladder by the researcher's level, and nothing without one", () => {
  assert.equal(M.ladderThrow(TABLES.ladder, 5), 11);
  assert.equal(M.ladderThrow(TABLES.ladder, 9), null);
  assert.equal(M.ladderThrow(TABLES.ladder, null), null);
  assert.equal(M.ladderThrow(NOTHING.ladder, 5), null);
});

t("a character's links are derived across locations from the open projects it is on", () => {
  const entries = [
    { location: { uuid: "L.a", name: "Tower" }, projects: [proj({ id: "a", subject: { name: "Lantern" } }), proj({ id: "b", researcher: "A.pell", assistants: ["A.hero"] }), proj({ id: "c", status: "closed" })] },
    { location: { uuid: "L.b", name: "Vault" }, projects: [proj({ id: "d", researcher: "A.other" })] },
  ];
  assert.deepEqual(M.linksFor(entries, "A.hero"), [
    { locationUuid: "L.a", locationName: "Tower", id: "a", name: "Lantern", role: "researcher" },
    { locationUuid: "L.a", locationName: "Tower", id: "b", name: "", role: "assistant" },
  ]);
  assert.deepEqual(M.linksFor(entries, "A.nobody"), []);
});

/* --------------------------------- the operations --------------------------------- */

/** Ops over an in-memory location; `who` is the requester's rule. */
function rig({ judge = true, canWrite = true, owned = ["A.hero"], linked = ["A.hero", "A.pell", "A.lena"], tables = TABLES, relay, levels = {}, ints = {} } = {}) {
  const loc = { uuid: "L.a", flag: undefined, writes: [] };
  const clock = { day: 4 };
  let seq = 0;
  const deps = {
    read: (l) => l.flag,
    write: async (l, patch) => {
      l.flag = { ...(l.flag ?? {}), ...patch };
      l.writes.push(Object.keys(patch).join());
    },
    canWrite: () => canWrite,
    relay: relay ?? (async () => undefined),
    today: () => clock.day,
    isJudge: () => judge,
    owns: (uuid) => judge || owned.includes(uuid),
    linked: () => linked,
    levelOf: (u) => levels[u] ?? null,
    intBonusOf: (u) => ints[u] ?? 0,
    tables: () => tables,
    newId: () => `n${++seq}`,
  };
  return { loc, ops: M.projectOps(deps), clock };
}

await ta("a facility's value is the Judge's, whole or blank", async () => {
  const { loc, ops } = rig();
  assert.deepEqual(await ops.setFacility(loc, "library", "9000"), { ok: true, key: "library", gp: 9000 });
  assert.deepEqual(await ops.setFacility(loc, "library", ""), { ok: true, key: "library", gp: null });
  assert.equal((await ops.setFacility(loc, "library", -5)).reason, "amount");
  assert.equal((await ops.setFacility(loc, "moat", 5)).reason, "facility");
  assert.equal(M.readRecord(loc.flag).facilities.library, null);
  const player = rig({ judge: false });
  assert.deepEqual(await player.ops.setFacility(player.loc, "library", 5), { ok: false, reason: "judge" });
  assert.equal(player.loc.writes.length, 0);
});

await ta("a project is created from the characters linked to the place, stamped with the day, and nobody else", async () => {
  const { loc, ops } = rig();
  const made = await ops.create(loc, { kind: "spell", subject: { name: "Lantern" }, level: 2, researcher: "A.hero", assistants: ["A.pell", "A.hero"], costs: { research: 40 }, paid: { material: 9 } });
  assert.equal(made.ok, true);
  assert.equal(made.id, "n1");
  const p = M.readRecord(loc.flag).projects[0];
  assert.deepEqual([p.opened, p.status, p.assistants, p.costs.research, p.paid], [4, "open", ["A.pell"], 40, { material: 9, day: 4 }]);
  assert.deepEqual([p.credited, p.bucket, p.throw], [[], [], null]);
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.stranger" })).reason, "researcher");
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.hero", assistants: ["A.stranger"] })).reason, "assistant");
  assert.equal((await ops.create(loc, { kind: "moat", researcher: "A.hero" })).reason, "kind");
  assert.equal((await ops.create(null, { kind: "spell", researcher: "A.hero" })).reason, "noLocation");
});

await ta("a Player starts a project for a character they own, and holds none of the Judge's fields", async () => {
  const { loc, ops } = rig({ judge: false });
  loc.flag = { facilities: { library: 99999 } };
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.pell" })).reason, "owner", "a linked character the Player does not own");
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.hero", costs: { research: 1 } })).reason, "judge");
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.hero", paid: { material: 1 } })).reason, "judge");
  assert.equal((await ops.create(loc, { kind: "spell", researcher: "A.hero", throw: { target: 5 } })).reason, "judge");
  assert.equal(loc.writes.length, 0, "nothing was written by a refusal");
  const made = await ops.create(loc, { kind: "spell", subject: { name: "Lantern" }, level: 2, researcher: "A.hero" });
  assert.equal(made.ok, true);
  assert.equal(made.warn, undefined);
});

await ta("a project below its facility is blocked for a Player and warned for a Judge, and the minimum is read as one share", async () => {
  const player = rig({ judge: false });
  player.loc.flag = { facilities: { library: 4499 } };
  const blocked = await player.ops.create(player.loc, { kind: "spell", level: 2, researcher: "A.hero" });
  assert.deepEqual(blocked, { ok: false, reason: "facility" });
  assert.equal(player.loc.writes.length, 0);
  player.loc.flag = { facilities: { library: 4500 } };
  assert.equal((await player.ops.create(player.loc, { kind: "spell", level: 2, researcher: "A.hero" })).ok, true, "the value alone meets the minimum");
  const second = await player.ops.create(player.loc, { kind: "spell", level: 2, researcher: "A.hero" });
  assert.deepEqual(second, { ok: false, reason: "facility" }, "a second project divides the same value, so each share is below it");
  const judge = rig();
  judge.loc.flag = { facilities: { library: 4499 } };
  const warned = await judge.ops.create(judge.loc, { kind: "spell", level: 2, researcher: "A.hero" });
  assert.equal(warned.ok, true);
  assert.equal(warned.warn, "facility");
  assert.equal(M.readRecord(judge.loc.flag).projects.length, 1, "a Judge's below-minimum project is written");
  const unread = rig({ judge: false, tables: NOTHING });
  assert.equal((await unread.ops.create(unread.loc, { kind: "spell", level: 2, researcher: "A.hero" })).ok, true, "nothing imported: neither blocked nor warned");
});

const ids0 = "A.hero";
await ta("an update changes the fields it names; a Player's holds to what the Judge does not own", async () => {
  const j = rig();
  const { id } = await j.ops.create(j.loc, { kind: "item", level: 3, researcher: "A.hero", costs: { material: 10, research: 50 } });
  const r = await j.ops.update(j.loc, id, { costs: { component: 7 }, subject: { name: "Rod" }, level: 4, throw: { target: 8 }, assistants: ["A.pell"], bucket: [{ uuid: "Item.x", qty: 2 }] });
  assert.equal(r.ok, true);
  const p = M.readRecord(j.loc.flag).projects[0];
  assert.deepEqual(p.costs, { material: 10, component: 7, research: 50 }, "a patch of a keyed field leaves its other keys");
  assert.deepEqual([p.subject.name, p.level, p.throw, p.assistants, p.bucket], ["Rod", 4, { target: 8 }, ["A.pell"], [{ uuid: "Item.x", qty: 2, fit: "" }]]);
  assert.equal((await j.ops.update(j.loc, id, { researcher: "A.pell" })).reason, "field", "the researcher is not a field an update changes");
  assert.equal((await j.ops.update(j.loc, id, { kind: "spell" })).reason, "field");
  assert.equal((await j.ops.update(j.loc, id, { credited: [{ day: 1, amount: 9 }] })).reason, "field", "crediting is not an update");
  assert.equal((await j.ops.update(j.loc, id, { assistants: ["A.stranger"] })).reason, "assistant");
  assert.equal((await j.ops.update(j.loc, "gone", {})).reason, "noProject");
  j.loc.flag = { ...j.loc.flag, projects: j.loc.flag.projects.map((x) => ({ ...x, credited: [{ day: 3, amount: 7, by: ids0 }] })) };
  await j.ops.update(j.loc, id, { subject: { name: "Rod 3" }, bucket: [] });
  assert.deepEqual(M.readRecord(j.loc.flag).projects[0].credited, [{ day: 3, amount: 7, by: ids0 }], "an update leaves what crediting wrote");

  const pl = rig({ judge: false });
  pl.loc.flag = j.loc.flag;
  assert.equal((await pl.ops.update(pl.loc, id, { assistants: ["A.lena"], subject: { name: "Rod 2" } })).ok, true, "the researcher's owner changes the assistants and the subject");
  assert.equal((await pl.ops.update(pl.loc, id, { bucket: [] })).ok, true);
  for (const patch of [{ level: 1 }, { costs: { research: 1 } }, { paid: { material: 1 } }, { throw: { target: 1 } }]) assert.equal((await pl.ops.update(pl.loc, id, patch)).reason, "judge", JSON.stringify(patch));
  const stranger = rig({ judge: false, owned: [] });
  stranger.loc.flag = j.loc.flag;
  assert.equal((await stranger.ops.update(stranger.loc, id, { assistants: [] })).reason, "owner");
  assert.equal((await stranger.ops.close(stranger.loc, id)).reason, "owner");
});

await ta("closing keeps the record, stamps the day and frees the facility's share", async () => {
  const { loc, ops, clock } = rig();
  const a = await ops.create(loc, { kind: "spell", level: 1, researcher: "A.hero" });
  await ops.create(loc, { kind: "spell", level: 1, researcher: "A.pell" });
  assert.equal(M.sharersOf(M.readRecord(loc.flag).projects, "library"), 2);
  clock.day = 9;
  assert.deepEqual(await ops.close(loc, a.id), { ok: true, id: a.id });
  const after = M.readRecord(loc.flag).projects;
  assert.deepEqual(after.map((p) => [p.status, p.closed]), [["closed", 9], ["open", null]]);
  assert.equal(M.sharersOf(after, "library"), 1);
  assert.equal((await ops.close(loc, a.id)).reason, "noProject", "a closed project is not closed twice");
  assert.equal((await ops.update(loc, a.id, { level: 2 })).reason, "noProject");
});

await ta("a seat that cannot write the place asks the GM's client, and an unanswered ask reads noGm", async () => {
  const asked = [];
  const { loc, ops } = rig({ judge: false, canWrite: false, relay: async (req) => (asked.push(req), { ok: true, id: "from-gm" }) });
  assert.deepEqual(await ops.create(loc, { kind: "spell", researcher: "A.hero" }), { ok: true, id: "from-gm" });
  assert.deepEqual(asked, [{ locationUuid: "L.a", op: "create", args: { spec: { kind: "spell", researcher: "A.hero" } } }]);
  assert.equal(loc.writes.length, 0, "this seat wrote nothing");
  const none = rig({ canWrite: false });
  assert.deepEqual(await none.ops.setFacility(none.loc, "library", 5), { ok: false, reason: "noGm" });
});

await ta("the relayed rule is the requester's: a Player's request on a Judge's field is refused where it runs", async () => {
  const { loc, ops } = rig({ judge: true });
  const player = { judge: false, owns: (u) => u === "A.hero" };
  loc.flag = { facilities: { library: 99999 } };
  assert.equal((await ops.apply(loc, "facility", { key: "library", gp: 5 }, player)).reason, "judge");
  assert.equal((await ops.apply(loc, "create", { spec: { kind: "spell", researcher: "A.pell" } }, player)).reason, "owner");
  assert.equal((await ops.apply(loc, "create", { spec: { kind: "spell", researcher: "A.hero", level: 2 } }, player)).ok, true);
  assert.equal((await ops.apply(loc, "wipe", { id: "n1" }, player)).reason, "op");
});

/* ------------------------------- the live wrapper ------------------------------- */

const actor = (uuid, type, extra = {}) => ({ uuid, documentName: "Actor", type, name: uuid.split(".")[1], img: "", testUserPermission: () => false, canUserModify: () => false, ...extra });
const place = (uuid, roster = [], flag) => actor(uuid, "acks-extras.location", { system: { roster, sceneUuid: "" }, flags: { "acks-extras": { magic: flag } }, canUserModify: () => state.canModify, update: async function (patch) { this.updates = (this.updates ?? []).concat([patch]); } });

await ta("the linked characters are the roster's characters still in the world, each once", async () => {
  state.actors.clear();
  for (const [u, type] of [["A.hero", "character"], ["A.pell", "character"], ["A.beast", "monster"]]) state.actors.set(u, actor(u, type));
  const row = (uuid) => ({ uuid, name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: uuid === "A.pell" });
  const loc = place("Actor.L1", [row("A.hero"), row("A.beast"), row("A.gone"), row("A.hero"), row("A.pell")]);
  state.actors.set(loc.uuid, loc);
  assert.deepEqual(L.linkedCharacters(loc).map((a) => a.uuid), ["A.hero", "A.pell"], "a hidden row is still linked: the Judge's hiding is a view, not a link");
});

await ta("the live deps write the flag under the module and ask for the write by Foundry's permission, not by ownership", async () => {
  state.isGM = false;
  state.canModify = true;
  const loc = place("Actor.L2", []);
  const deps = L.liveDeps();
  assert.equal(deps.canWrite(loc), true, "a Player whom Foundry lets write the place writes it");
  state.canModify = false;
  assert.equal(deps.canWrite(loc), false);
  state.isGM = true;
  state.canModify = false;
  assert.equal(L.liveDeps().canWrite(loc), false, "being a GM is not what decides it; canUserModify is");
  await deps.write(loc, { facilities: { library: 5 } });
  assert.deepEqual(loc.updates, [{ "flags.acks-extras.magic.facilities": { library: 5 } }]);
  assert.equal(deps.today(), 4);
  assert.equal(L.liveDeps().owns("A.hero"), true, "a Judge owns every actor");
  state.isGM = false;
  state.activeGM = false;
  assert.equal(await L.liveDeps().relay({}), undefined, "no GM to ask");
  state.activeGM = true;
  state.isGM = true;
});

await ta("the GM's handler authorizes on the sender Foundry attested, never on the payload", async () => {
  state.actors.clear();
  const hero = actor("A.hero", "character", { testUserPermission: (user) => user.id === "pl1" });
  const pell = actor("A.pell", "character");
  const loc = place("Actor.L3", [{ uuid: "A.hero", name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: false }, { uuid: "A.pell", name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: false }]);
  loc.update = async (patch) => {
    loc.updates = (loc.updates ?? []).concat([patch]);
    for (const [path, value] of Object.entries(patch)) loc.flags["acks-extras"].magic = { ...(loc.flags["acks-extras"].magic ?? {}), [path.split(".").pop()]: value };
  };
  for (const a of [hero, pell, loc]) state.actors.set(a.uuid, a);
  resetTables();
  state.isGM = true;
  const own = await L.projectHandler({ locationUuid: loc.uuid, op: "create", args: { spec: { kind: "spell", researcher: "A.hero", level: 2 } }, requestUserId: "pl1" });
  assert.equal(own.ok, true, `the owner of the researcher: ${JSON.stringify(own)}`);
  const other = await L.projectHandler({ locationUuid: loc.uuid, op: "create", args: { spec: { kind: "spell", researcher: "A.pell" } }, requestUserId: "pl1" });
  assert.deepEqual(other, { ok: false, reason: "owner" });
  const claim = await L.projectHandler({ locationUuid: loc.uuid, op: "facility", args: { key: "library", gp: 99 }, requestUserId: "pl1", judge: true });
  assert.equal(claim.reason, "judge", "a payload's own claim of being the Judge changes nothing");
  const gm = await L.projectHandler({ locationUuid: loc.uuid, op: "facility", args: { key: "library", gp: 99 }, requestUserId: null });
  assert.equal(gm.ok, true);
  assert.equal((await L.projectHandler({ locationUuid: "Actor.nowhere", op: "create" })).reason, "noLocation");
  assert.equal((await L.projectHandler({ locationUuid: loc.uuid, op: "weird", requestUserId: null })).reason, "op");
  assert.equal(PROJECT_HANDLER, "magicProject");
  assert.equal(L.recordOf(loc).projects.length, 1);
  assert.equal(L.researchApi.open(loc).length, 1);
  assert.deepEqual(L.researchApi.projectsOf(hero).map((p) => [p.locationUuid, p.role]), [["Actor.L3", "researcher"]], "the researcher's link is derived, and nothing is written on the character");
  assert.equal(hero.updates, undefined);
});

await ta("the API reads the verdicts of a project against the registry's imported figures", async () => {
  resetTables();
  const loc = [...state.actors.values()].find((a) => a.uuid === "Actor.L3");
  const id = L.recordOf(loc).projects[0].id;
  assert.deepEqual(L.researchApi.verdicts(loc, id).map((v) => [v.verdict, v.minimum]), [["unknown", null]], "nothing imported: no minimum");
  registerTable({ id: "magicResearch", source: { pages: "Invented 1-2" }, cites: { libraryProse: "Invented p. 3" }, tables: { libraryProse: { minimum: 3000, step: 1500, bonusStep: 7000, bonusSize: 2, bonusCap: 5, share: 25 } } }, { priority: PRIORITY.WORLD, source: "test" });
  const v = L.researchApi.verdicts(loc, id)[0];
  assert.deepEqual([v.minimum, v.verdict, v.cite], [4500, "below", "Invented p. 3"], "the library is 99 gp, far under the minimum for the second level");
  state.isGM = false;
  assert.deepEqual(L.researchApi.gate(loc, id), { ok: false, reason: "facility" });
  state.isGM = true;
  assert.deepEqual(L.researchApi.gate(loc, id), { ok: true, warn: "facility" });
  assert.deepEqual(L.researchApi.verdicts(loc, "none"), []);
  resetTables();
});

/* ------------------------------ posted and credited days ------------------------------ */

/** Invented tables for the days: a ladder with a lesser rate for other projects, an ancillary share and assistant levels. */
const RATES = {
  ...TABLES,
  // The invented footnote names the spell kind's word and not the ritual's: the reverse of any printed list, so a kind chosen by a guess fails here.
  ladder: { present: true, rungs: [{ level: 2, rate: 8, throw: 17, marked: false }, { level: 4, rate: 30, throw: 15, marked: false }, { level: 5, rate: 90, throw: 11, marked: false }, { level: 6, rate: 210, throw: 9, marked: true }], otherProjectsRate: 150, markedProjects: ["glassblowing", "spellcraft"], cite: "Invented p. 2", byHand: false },
  prose: { present: true, ancillary: { numerator: 1, denominator: 4, share: 0.25 }, cite: "Invented p. 4", byHand: false },
  assistants: { present: true, managerLevel: 4, managerBase: 2, aidLevel: 2, spellLevel: 6, itemLevel: 9, cite: "Invented p. 5", byHand: false },
};
const LEVELS = { "A.hero": 5, "A.pell": 4, "A.lena": 2, "A.mira": 2, "A.kid": 1, "A.low": 3 };
const ctx = (o = {}) => ({ today: 10, tables: RATES, levelOf: (u) => LEVELS[u] ?? null, intBonusOf: () => 0, ...o });
const spell = (o = {}) => proj({ kind: "spell", level: null, researcher: "A.hero", ...o });

t("a project keeps its posted days in order, once each, and credited rows once for a day and a participant", () => {
  const p = M.cleanProject({ id: "x", kind: "spell", researcher: "A.hero", dueDays: "6.9", posted: [{ day: 7, pace: "both" }, { day: 5, pace: "dedicated" }, { day: 5, pace: "ancillary" }, { day: 6, pace: "weird" }, { pace: "dedicated" }, "x"], credited: [{ day: 1, amount: 4, by: "A.hero" }, { day: 1, amount: 9, by: "A.hero" }, { day: 1, amount: 2, by: "A.pell" }, { day: 2, amount: null, by: "" }, { day: 3, amount: 0, by: "A.hero" }, { amount: 5, by: "A.hero" }] });
  assert.deepEqual(p.posted, [{ day: 5, pace: "dedicated" }, { day: 7, pace: "both" }]);
  assert.deepEqual(p.credited, [{ day: 1, amount: 4, by: "A.hero" }, { day: 1, amount: 2, by: "A.pell" }], "a row with no amount, or none above zero, is never a credit");
  assert.equal(p.dueDays, 6);
  assert.equal(M.creditedTotal(p), 6);
  assert.equal(M.cleanProject({ id: "y", kind: "spell" }).dueDays, null);
});

t("a pace is the whole rate, the imported share of it, or both, and nothing where the share is not read", () => {
  const prose = RATES.prose;
  assert.equal(M.paceFactor(prose, "dedicated"), 1);
  assert.equal(M.paceFactor(prose, "ancillary"), 0.25);
  assert.equal(M.paceFactor(prose, "both"), 1.25);
  assert.equal(M.paceFactor(prose, "weird"), null);
  assert.equal(M.paceFactor(NOTHING.prose, "dedicated"), 1, "a dedicated day needs no share");
  assert.equal(M.paceFactor({ ancillary: null }, "ancillary"), null);
  assert.equal(M.paceFactor(undefined, "both"), null);
});

t("an assistant counts only at the level that aids and within the number the researcher manages", () => {
  const people = (project, o) => M.weighParticipants(project, ctx(o)).map((x) => [x.uuid, x.counts, x.why, x.rate]);
  const p = spell({ assistants: ["A.pell", "A.lena", "A.mira", "A.kid"] });
  assert.deepEqual(people(p), [["A.hero", true, "", 90], ["A.pell", true, "", 30], ["A.lena", true, "", 8], ["A.mira", false, "over", 8], ["A.kid", false, "below", null]], "two assistants managed with no Intellect bonus: the third is past the number managed, the fourth under the level");
  assert.deepEqual(people(p, { intBonusOf: () => 1 }).map((x) => x[2]), ["", "", "", "", "below"], "each point of Intellect bonus adds one");
  assert.deepEqual(people(spell({ assistants: ["A.pell"] }), { levelOf: (u) => (u === "A.hero" ? 3 : 4) }).map((x) => x[2]), ["", "over"], "a researcher under the managing level manages none");
  assert.deepEqual(people(spell({ assistants: ["A.pell"] }), { tables: TABLES }).map((x) => [x[1], x[2]]), [[true, ""], [false, "unread"]], "no assistant levels read: nobody is counted as an assistant");
  assert.deepEqual(people(spell({ assistants: ["A.pell"] }), { levelOf: () => null }).map((x) => x[2]), ["", "unread"], "a researcher with no level has no number to manage");
  const atSix = (project, ladder = {}) => M.weighParticipants(project, ctx({ tables: { ...RATES, ladder: { ...RATES.ladder, ...ladder } }, levelOf: (u) => (u === "A.hero" ? 6 : null) }))[0].rate;
  assert.equal(atSix(spell({ level: 3 })), 210, "a marked rung reads its own rate for a kind the imported footnote names");
  assert.equal(atSix(spell({ kind: "ritual" })), 150, "and the footnote's rate for a kind it does not: the kind is no fixed one");
  assert.equal(atSix(spell({ kind: "item" })), 150);
  assert.equal(atSix(spell({ kind: "ritual" }), { markedProjects: ["glassblowing", "ritual rites"] }), 210, "the list is the page's: name the ritual and it reads the rung's own rate");
  assert.equal(atSix(spell({ kind: "spell" }), { markedProjects: ["glassblowing", "ritual rites"] }), 150);
  assert.equal(atSix(spell(), { otherProjectsRate: null }), 210, "a footnote rate not read costs the named kind nothing");
  assert.equal(atSix(spell({ kind: "ritual" }), { otherProjectsRate: null }), null, "and leaves another kind's rate unread");
  assert.equal(atSix(spell(), { markedProjects: null }), null, "a list not read leaves the marked rung unread for every kind");
  assert.equal(atSix(spell({ kind: "ritual" }), { markedProjects: null }), null);
  assert.equal(atSix(spell(), { rungs: RATES.ladder.rungs.map(({ marked, ...r }) => r) }), null, "a rung whose mark is not read is unknown, not unmarked");
  assert.equal(M.weighParticipants(spell({ kind: "ritual" }), ctx({ levelOf: () => 5 }))[0].rate, 90, "an unmarked rung is its printed rate for every kind");
  assert.equal(M.weighParticipants(spell({ kind: "item" }), ctx({ levelOf: () => 5, tables: { ...RATES, ladder: { ...RATES.ladder, markedProjects: null, otherProjectsRate: null } } }))[0].rate, 90, "and needs neither the list nor the footnote's rate");
  assert.equal(M.weighParticipants(spell(), ctx({ levelOf: () => 9 }))[0].rate, null, "a level the ladder has no rung for");
});

t("a day is each counted participant's rate at the pace, and null where a figure is not read", () => {
  const people = M.weighParticipants(spell({ assistants: ["A.pell"] }), ctx());
  assert.deepEqual(M.dayAmounts(people, RATES.prose, "dedicated"), { entries: [{ by: "A.hero", amount: 90 }, { by: "A.pell", amount: 30 }], total: 120 });
  assert.deepEqual(M.dayAmounts(people, RATES.prose, "ancillary").entries.map((e) => e.amount), [22.5, 7.5]);
  assert.equal(M.dayAmounts(people, RATES.prose, "both").total, 150);
  assert.equal(M.dayAmounts(people, NOTHING.prose ?? undefined, "ancillary").total, null);
  assert.equal(M.dayAmounts(M.weighParticipants(spell(), ctx({ levelOf: () => null })), RATES.prose, "dedicated").total, null);
});

t("crediting takes the posted days world time has passed, once, at the pace each was posted", () => {
  const p = spell({ assistants: ["A.pell"], posted: [{ day: 8, pace: "dedicated" }, { day: 9, pace: "ancillary" }, { day: 10, pace: "dedicated" }, { day: 12, pace: "dedicated" }] });
  const first = M.creditDue(p, ctx());
  assert.equal(first.credited, 2, "days 8 and 9 have passed; today, day 10, and the future have not");
  assert.deepEqual(first.project.posted, [{ day: 10, pace: "dedicated" }, { day: 12, pace: "dedicated" }]);
  assert.deepEqual(first.project.credited, [{ day: 8, amount: 90, by: "A.hero" }, { day: 8, amount: 30, by: "A.pell" }, { day: 9, amount: 22.5, by: "A.hero" }, { day: 9, amount: 7.5, by: "A.pell" }]);
  const again = M.creditDue(first.project, ctx());
  assert.equal(again.credited, 0);
  assert.equal(again.project, first.project, "a second call changes nothing and returns the same record");
  const later = M.creditDue(first.project, ctx({ today: 11 }));
  assert.equal(later.credited, 1);
  assert.equal(M.creditedTotal(later.project), 90 + 30 + 22.5 + 7.5 + 90 + 30);
  const dragged = M.creditDue(later.project, ctx({ today: 3 }));
  assert.equal(dragged.credited, 0, "a clock dragged back credits nothing and removes nothing");
  assert.equal(M.creditDue(dragged.project, ctx({ today: 20 })).project.credited.filter((c) => c.day === 8).length, 2, "and forward again credits no day twice");
  const stale = spell({ posted: [{ day: 8, pace: "dedicated" }], credited: [{ day: 8, amount: 90, by: "A.hero" }] });
  assert.deepEqual(M.creditDue(stale, ctx()).project.credited, [{ day: 8, amount: 90, by: "A.hero" }], "a day already credited is never credited again, even if a write left it posted too");
  const staleUnread = M.creditDue(stale, ctx({ tables: NOTHING }));
  assert.deepEqual([staleUnread.credited, staleUnread.project.posted], [1, []], "and it leaves posted even while the rates are unread, since it is credited");
});

t("a passed day whose rates are not all read stays posted and writes nothing, and a later sweep credits it once they are read", () => {
  const p = spell({ assistants: ["A.pell"], posted: [{ day: 8, pace: "dedicated" }, { day: 9, pace: "ancillary" }] });
  const none = M.creditDue(p, ctx({ tables: NOTHING }));
  assert.equal(none.credited, 0, "no rate read: no day credited");
  assert.equal(none.project, p, "and the same record comes back, so nothing is written");
  const noShare = M.creditDue(p, ctx({ tables: { ...RATES, prose: { ...RATES.prose, ancillary: null } } }));
  assert.deepEqual(noShare.project.credited, [{ day: 8, amount: 90, by: "A.hero" }, { day: 8, amount: 30, by: "A.pell" }], "the dedicated day is credited");
  assert.deepEqual(noShare.project.posted, [{ day: 9, pace: "ancillary" }], "an ancillary day with no share read stays posted");
  assert.equal(noShare.credited, 1, "the count is the days credited, not the days passed");
  const lowAssistant = M.creditDue(spell({ assistants: ["A.pell"], posted: [{ day: 8, pace: "dedicated" }] }), ctx({ levelOf: (u) => (u === "A.pell" ? 3 : LEVELS[u]) }));
  assert.deepEqual([lowAssistant.credited, lowAssistant.project.credited, lowAssistant.project.posted.length], [0, [], 1], "a counted assistant whose rung is unread holds the whole day: crediting the researcher alone could never be corrected");
  const unreadAid = { ...RATES, assistants: { ...RATES.assistants, aidLevel: null } };
  assert.equal(M.creditDue(p, ctx({ tables: unreadAid })).credited, 0, "an assistant whose counting is unread leaves the day undecided");
  assert.equal(M.creditDue(spell({ posted: [{ day: 8, pace: "dedicated" }] }), ctx({ tables: unreadAid })).credited, 1, "a project with no assistant is not held for the assistants' figures");
  const free = { ...RATES, ladder: { ...RATES.ladder, rungs: [{ level: 5, rate: 0, throw: 11, marked: false }] } };
  assert.equal(M.creditDue(spell({ posted: [{ day: 8, pace: "dedicated" }] }), ctx({ tables: free })).credited, 0, "a rate of nothing is no figure to credit");
  const later = M.creditDue(none.project, ctx());
  assert.equal(later.credited, 2);
  assert.deepEqual(later.project.credited, [{ day: 8, amount: 90, by: "A.hero" }, { day: 8, amount: 30, by: "A.pell" }, { day: 9, amount: 22.5, by: "A.hero" }, { day: 9, amount: 7.5, by: "A.pell" }], "each held day is credited at the pace it was posted, once the rates are read");
  assert.deepEqual(later.project.posted, []);
  assert.ok(later.project.credited.every((c) => c.amount > 0 && c.by), "no row carries a null amount or a blank participant");
  assert.equal(M.creditDue(later.project, ctx()).project, later.project, "and the next sweep changes nothing");
});

t("progress computes the due from the rates while they are read, and takes the Judge's days until then", () => {
  const costs = { research: 1000 };
  const base = spell({ costs, assistants: ["A.pell"] });
  const fresh = M.progressOf(base, ctx());
  assert.deepEqual([fresh.daily, fresh.dueDays, fresh.dueBy, fresh.complete, fresh.creditedDays, fresh.posted], [120, 9, "ladder", false, 0, 0], "ceil(1000 / 120)");
  const mid = M.progressOf({ ...base, credited: [{ day: 1, amount: 90, by: "A.hero" }, { day: 1, amount: 30, by: "A.pell" }, { day: 2, amount: 90, by: "A.hero" }, { day: 2, amount: 30, by: "A.pell" }], posted: [{ day: 10, pace: "dedicated" }] }, ctx());
  assert.deepEqual([mid.creditedGp, mid.creditedDays, mid.posted, mid.waiting, mid.dueDays, mid.dueBy], [240, 2, 1, 0, 9, "ladder"], "the days credited and posted, and what is left at a day's rate");
  assert.equal(mid.dueDay, 16, "six more days from the day after the last one posted");
  const passedDay = M.progressOf({ ...base, posted: [{ day: 4, pace: "dedicated" }] }, ctx());
  assert.deepEqual([passedDay.waiting, passedDay.unread], [1, 0], "a posted day that has passed and is not yet credited, with its rates read: no figure holds it back");
  assert.equal(M.progressOf({ ...base, credited: [{ day: 1, amount: 1000, by: "A.hero" }] }, ctx()).complete, true);
  assert.equal(M.progressOf({ ...base, credited: [{ day: 1, amount: 999, by: "A.hero" }] }, ctx()).complete, false);
  const ancillary = M.progressOf({ ...base, posted: [{ day: 10, pace: "ancillary" }] }, ctx());
  assert.equal(ancillary.dueDays, 1 + Math.ceil((1000 - 30) / 120), "a posted day counts at its own pace");
  const heldDays = [{ day: 1, pace: "dedicated" }, { day: 2, pace: "dedicated" }, { day: 3, pace: "dedicated" }];
  const hand = M.progressOf({ ...base, dueDays: 4, posted: heldDays }, ctx({ tables: NOTHING }));
  assert.deepEqual([hand.dueDays, hand.dueBy, hand.complete, hand.daily], [4, "judge", false, null]);
  assert.deepEqual([hand.creditedDays, hand.waiting, hand.unread, hand.posted], [0, 3, 3, 0], "days with no rate read are posted and held: counted nowhere as worked");
  assert.equal(M.progressOf({ ...base, dueDays: 3, posted: heldDays }, ctx({ tables: NOTHING })).complete, false, "the Judge's days are not met by days that are held");
  assert.equal(M.progressOf({ ...base, dueDays: 6, posted: heldDays }, ctx({ tables: NOTHING })).dueDay, 15, "and nor do they shorten what is left: the held days are no pending days");
  const credited3 = [1, 2, 3].map((day) => ({ day, amount: 5, by: "A.hero" }));
  assert.equal(M.progressOf({ ...base, dueDays: 3, credited: credited3 }, ctx({ tables: NOTHING })).complete, true, "days credited while the rates were read count against the Judge's days");
  const mixed = M.progressOf({ ...base, dueDays: 5, credited: credited3, posted: [{ day: 4, pace: "dedicated" }] }, ctx({ tables: NOTHING }));
  assert.deepEqual([mixed.creditedDays, mixed.unread, mixed.complete], [3, 1, false]);
  const noShareHeld = M.progressOf({ ...base, posted: [{ day: 8, pace: "ancillary" }] }, ctx({ tables: { ...RATES, prose: { ...RATES.prose, ancillary: null } } }));
  assert.deepEqual([noShareHeld.unread, noShareHeld.dueBy, noShareHeld.daily], [1, null, 120], "a held day stops the computed due even where a dedicated day's rate is read");
  const undecided = M.progressOf(base, ctx({ tables: { ...RATES, assistants: { ...RATES.assistants, aidLevel: null } }, today: 10 }));
  assert.deepEqual([undecided.dueBy, undecided.dueDays], [null, null], "an assistant whose counting is unread makes the computed due a guess, so none is computed");
  assert.equal(M.progressOf({ ...base, dueDays: 7 }, ctx()).dueDays, 9, "the computed due is the one in force while the rates are read");
  const none = M.progressOf(spell(), ctx({ tables: NOTHING }));
  assert.deepEqual([none.dueDays, none.dueBy, none.complete, none.dueDay], [null, null, null, null]);
  assert.equal(M.progressOf(spell({ costs: { research: 50 } }), ctx({ tables: NOTHING })).complete, false, "a cost and no rates: not complete until the gold is in");
});

t("assistants who do not count block a Player and warn a Judge; an unread figure does neither; a removal never trips it", () => {
  const people = M.weighParticipants(spell({ assistants: ["A.pell", "A.lena", "A.mira", "A.kid"] }), ctx());
  assert.deepEqual(M.assistantGate(people, { judge: false }), { ok: false, reason: "assistantLevel" });
  assert.deepEqual(M.assistantGate(people, { judge: true }), { ok: true, warn: "assistantLevel" });
  assert.deepEqual(M.assistantGate(people, { judge: false, names: ["A.mira"] }), { ok: false, reason: "assistantCount" });
  assert.deepEqual(M.assistantGate(people, { judge: false, names: ["A.pell"] }), { ok: true });
  assert.deepEqual(M.assistantGate(M.weighParticipants(spell({ assistants: ["A.kid"] }), ctx({ tables: TABLES })), { judge: false }), { ok: true });
});

await ta("a day is posted at a pace, once, and a Player posts today alone", async () => {
  const j = rig({ tables: RATES, levels: LEVELS });
  const { id } = await j.ops.create(j.loc, { kind: "spell", researcher: "A.hero", costs: { research: 1000 } });
  assert.deepEqual(await j.ops.post(j.loc, id), { ok: true, id, day: 4, pace: "dedicated" });
  assert.deepEqual(M.readRecord(j.loc.flag).projects[0].posted, [{ day: 4, pace: "dedicated" }]);
  assert.equal((await j.ops.post(j.loc, id)).reason, "duplicate");
  assert.equal((await j.ops.post(j.loc, id, { pace: "weird", day: 6 })).reason, "pace");
  assert.equal((await j.ops.post(j.loc, id, { day: "x" })).reason, "day");
  assert.equal((await j.ops.post(j.loc, id, { pace: "both", day: 6 })).ok, true, "a Judge posts any day");
  assert.equal((await j.ops.post(j.loc, id, { pace: "ancillary", day: 2 })).ok, true);
  assert.deepEqual(M.readRecord(j.loc.flag).projects[0].posted.map((r) => [r.day, r.pace]), [[2, "ancillary"], [4, "dedicated"], [6, "both"]]);
  assert.equal((await j.ops.post(j.loc, "gone")).reason, "noProject");

  const pl = rig({ judge: false, tables: RATES, levels: LEVELS });
  pl.loc.flag = j.loc.flag;
  const wrote = pl.loc.writes.length;
  assert.equal((await pl.ops.post(pl.loc, id, { day: 5 })).reason, "day", "a Player does not post another day");
  assert.equal((await pl.ops.post(pl.loc, id, { day: 3 })).reason, "day", "nor a past one, which would be credited at once");
  assert.equal((await pl.ops.post(pl.loc, id)).reason, "duplicate");
  pl.clock.day = 7;
  assert.deepEqual(await pl.ops.post(pl.loc, id, { pace: "both" }), { ok: true, id, day: 7, pace: "both" });
  assert.equal(pl.loc.writes.length, wrote + 1);
  const stranger = rig({ judge: false, owned: [], tables: RATES, levels: LEVELS });
  stranger.loc.flag = j.loc.flag;
  assert.equal((await stranger.ops.post(stranger.loc, id)).reason, "owner");
  assert.equal(M.readRecord(j.loc.flag).projects[0].posted.length, 3, "a refusal wrote nothing");
});

await ta("posting reads the facility again: a share below the minimum blocks a Player and warns a Judge, and an assistant who does not count the same", async () => {
  const seed = (extra = {}) => ({ facilities: { library: 4499 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", status: "open", opened: 1, ...extra }] });
  const player = rig({ judge: false, tables: RATES, levels: LEVELS });
  player.loc.flag = seed();
  assert.deepEqual(await player.ops.post(player.loc, "a"), { ok: false, reason: "facility" });
  assert.equal(player.loc.writes.length, 0);
  const judge = rig({ tables: RATES, levels: LEVELS });
  judge.loc.flag = seed();
  const warned = await judge.ops.post(judge.loc, "a");
  assert.deepEqual([warned.ok, warned.warn, warned.warns], [true, "facility", ["facility"]]);
  assert.equal(M.readRecord(judge.loc.flag).projects[0].posted.length, 1, "a Judge's day is written");
  const kid = rig({ judge: false, tables: RATES, levels: LEVELS });
  kid.loc.flag = { facilities: { library: 99999 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", assistants: ["A.kid"], status: "open", opened: 1 }] };
  assert.deepEqual(await kid.ops.post(kid.loc, "a"), { ok: false, reason: "assistantLevel" });
  const both = rig({ tables: RATES, levels: LEVELS });
  both.loc.flag = { facilities: { library: 100 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", assistants: ["A.kid"], status: "open", opened: 1 }] };
  assert.deepEqual((await both.ops.post(both.loc, "a")).warns, ["facility", "assistantLevel"], "every warning is told");
  const unread = rig({ judge: false, tables: NOTHING, levels: LEVELS });
  unread.loc.flag = seed();
  assert.equal((await unread.ops.post(unread.loc, "a")).ok, true, "nothing imported: neither blocked nor warned");
});

await ta("a Judge posts a range of days, each once: a day already posted or credited is skipped and named, and one write is made", async () => {
  const j = rig({ tables: RATES, levels: LEVELS });
  const { id } = await j.ops.create(j.loc, { kind: "spell", researcher: "A.hero", costs: { research: 1000 } });
  await j.ops.post(j.loc, id, { day: 5, pace: "ancillary" });
  j.loc.flag.projects[0].credited = [{ day: 7, amount: 90, by: "A.hero" }];
  const wrote = j.loc.writes.length;
  const done = await j.ops.postRange(j.loc, id, { pace: "both", from: 4, days: 5 });
  assert.deepEqual([done.ok, done.posted, done.skipped, done.pace], [true, [4, 6, 8], [5, 7], "both"]);
  assert.equal(j.loc.writes.length, wrote + 1, "the days are one write");
  assert.deepEqual(M.readRecord(j.loc.flag).projects[0].posted.map((r) => [r.day, r.pace]), [[4, "both"], [5, "ancillary"], [6, "both"], [8, "both"]], "the day already posted keeps its own pace, the credited day is not posted again");
  assert.deepEqual(await j.ops.postRange(j.loc, id, { from: 4, days: 3 }), { ok: true, id, pace: "dedicated", posted: [], skipped: [4, 5, 6] }, "every day skipped: nothing posted");
  assert.equal(j.loc.writes.length, wrote + 1, "and nothing written");
  const today = await j.ops.postRange(j.loc, id, { days: 1 });
  assert.deepEqual([today.ok, today.posted, today.skipped], [true, [], [4]], "the first day defaults to today");
  const bad = async (o) => (await j.ops.postRange(j.loc, id, o)).reason;
  assert.equal(await bad({ from: 20, days: 0 }), "range");
  assert.equal(await bad({ from: 20, days: -2 }), "range");
  assert.equal(await bad({ from: 20, days: 1.5 }), "range");
  assert.equal(await bad({ from: 20, days: "x" }), "range");
  assert.equal(await bad({ from: 20 }), "range", "a count is required");
  assert.equal(await bad({ from: "x", days: 2 }), "range");
  assert.equal(await bad({ from: 20, days: M.RANGE_MAX + 1 }), "range");
  assert.equal(await bad({ from: 20, days: 2, pace: "weird" }), "pace");
  assert.equal((await j.ops.postRange(j.loc, id, { from: 20, days: M.RANGE_MAX })).posted.length, M.RANGE_MAX, "the bound itself is allowed");
  assert.equal((await j.ops.postRange(j.loc, "gone", { days: 2 })).reason, "noProject");
  assert.equal(M.daysText([3, 4, 5, 9, 9, 11, 10]), "3\u20135, 9\u201311");
  assert.equal(M.daysText([]), "");
});

await ta("a range is a Judge's alone, and its warnings are told once", async () => {
  const pl = rig({ judge: false, tables: RATES, levels: LEVELS });
  const { id } = await pl.ops.create(pl.loc, { kind: "spell", researcher: "A.hero" });
  assert.deepEqual(await pl.ops.postRange(pl.loc, id, { from: 4, days: 2 }), { ok: false, reason: "judge" }, "a Player's own project does not open a range");
  assert.equal(M.readRecord(pl.loc.flag).projects[0].posted.length, 0, "and writes nothing");
  const stranger = rig({ judge: false, owned: [], tables: RATES, levels: LEVELS });
  stranger.loc.flag = pl.loc.flag;
  assert.equal((await stranger.ops.postRange(stranger.loc, id, { days: 2 })).reason, "owner");
  const both = rig({ tables: RATES, levels: LEVELS });
  both.loc.flag = { facilities: { library: 100 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", assistants: ["A.kid"], status: "open", opened: 1 }] };
  const warned = await both.ops.postRange(both.loc, "a", { from: 4, days: 6 });
  assert.deepEqual([warned.ok, warned.posted.length, warned.warns], [true, 6, ["facility", "assistantLevel"]], "six days, each warning once");
  const asked = [];
  const remote = rig({ judge: false, canWrite: false, relay: async (req) => (asked.push(req), { ok: true }), tables: RATES, levels: LEVELS });
  await remote.ops.postRange(remote.loc, "a", { pace: "both", from: 5, days: 3 });
  await remote.ops.withdraw(remote.loc, "a", 5);
  assert.deepEqual(asked.map((r) => [r.op, r.args]), [["postRange", { id: "a", pace: "both", from: 5, days: 3 }], ["withdraw", { id: "a", day: 5 }]], "a seat that cannot write asks the GM's client");
  const noGm = rig({ judge: false, canWrite: false, tables: RATES, levels: LEVELS });
  assert.deepEqual(await noGm.ops.postRange(noGm.loc, "a", { days: 2 }), { ok: false, reason: "noGm" });
});

await ta("a posted day is withdrawn by a Judge or by the owner of the researcher, and a credited day never", async () => {
  const j = rig({ tables: RATES, levels: LEVELS });
  const { id } = await j.ops.create(j.loc, { kind: "spell", researcher: "A.hero", costs: { research: 1000 } });
  await j.ops.postRange(j.loc, id, { from: 4, days: 4 });
  j.loc.flag.projects[0].credited = [{ day: 4, amount: 90, by: "A.hero" }];
  const posted = () => M.readRecord(j.loc.flag).projects[0].posted.map((r) => r.day);
  assert.deepEqual(await j.ops.withdraw(j.loc, id, 6), { ok: true, id, day: 6 });
  assert.deepEqual(posted(), [4, 5, 7], "a Judge withdraws any posted day, and the others stand");
  assert.equal((await j.ops.withdraw(j.loc, id, 4)).reason, "credited", "a day credited is never taken back, even left posted too by a stale write");
  assert.deepEqual(posted(), [4, 5, 7]);
  assert.equal((await j.ops.withdraw(j.loc, id, 9)).reason, "notPosted");
  assert.equal((await j.ops.withdraw(j.loc, id, "x")).reason, "notPosted");
  assert.equal((await j.ops.withdraw(j.loc, id)).reason, "notPosted");
  assert.equal((await j.ops.withdraw(j.loc, "gone", 5)).reason, "noProject");
  const mine = rig({ judge: false, tables: RATES, levels: LEVELS });
  mine.loc.flag = j.loc.flag;
  const wrote = mine.loc.writes.length;
  assert.deepEqual(await mine.ops.withdraw(mine.loc, id, 5), { ok: true, id, day: 5 }, "a Player takes back a posted day of their own project");
  assert.equal(mine.loc.writes.length, wrote + 1);
  assert.equal((await mine.ops.withdraw(mine.loc, id, 4)).reason, "credited", "and not a credited one");
  j.loc.flag = mine.loc.flag;
  const other = rig({ judge: false, owned: [], tables: RATES, levels: LEVELS });
  other.loc.flag = j.loc.flag;
  assert.equal((await other.ops.withdraw(other.loc, id, 7)).reason, "owner", "a Player has no say over another's project");
  assert.deepEqual(posted(), [4, 7], "a refusal wrote nothing");
  const closed = rig({ tables: RATES, levels: LEVELS });
  closed.loc.flag = j.loc.flag;
  await closed.ops.close(closed.loc, id);
  assert.equal((await closed.ops.withdraw(closed.loc, id, 7)).reason, "noProject", "a closed project is not withdrawn from");
  assert.equal(M.PROJECT_OP.withdraw, "withdraw");
  assert.equal(M.PROJECT_OP.postRange, "postRange");
});

await ta("an assistant is gated when added, in an update and in a new project, by the researcher's number and the assistant's level", async () => {
  const pl = rig({ judge: false, tables: RATES, levels: LEVELS, linked: ["A.hero", "A.pell", "A.lena", "A.mira", "A.kid"] });
  const made = await pl.ops.create(pl.loc, { kind: "spell", researcher: "A.hero", assistants: ["A.pell"] });
  assert.equal(made.ok, true, "one assistant is within the two a researcher without Intellect bonus manages");
  const id = made.id;
  assert.deepEqual(await pl.ops.update(pl.loc, id, { assistants: ["A.pell", "A.lena", "A.mira"] }), { ok: false, reason: "assistantCount" });
  assert.deepEqual(await pl.ops.update(pl.loc, id, { assistants: ["A.pell", "A.kid"] }), { ok: false, reason: "assistantLevel" });
  assert.equal((await pl.ops.update(pl.loc, id, { assistants: [] })).ok, true, "a removal is never refused");
  assert.equal((await pl.ops.update(pl.loc, id, { subject: { name: "Rod" } })).ok, true);
  assert.deepEqual((await pl.ops.create(pl.loc, { kind: "spell", researcher: "A.hero", assistants: ["A.kid"] })).reason, "assistantLevel", "and a new project's assistants are held to the same");
  const judge = rig({ tables: RATES, levels: LEVELS, linked: ["A.hero", "A.pell", "A.lena", "A.kid"] });
  const jm = await judge.ops.create(judge.loc, { kind: "spell", researcher: "A.hero" });
  const warned = await judge.ops.update(judge.loc, jm.id, { assistants: ["A.pell", "A.kid"] });
  assert.deepEqual([warned.ok, warned.warn], [true, "assistantLevel"]);
  assert.deepEqual(M.readRecord(judge.loc.flag).projects[0].assistants, ["A.pell", "A.kid"], "a Judge's choice stands, and the one who does not count adds nothing");
  assert.equal((await judge.ops.update(judge.loc, jm.id, { dueDays: 5 })).ok, true, "the due in days is the Judge's");
  assert.equal(M.readRecord(judge.loc.flag).projects[0].dueDays, 5);
  assert.equal((await pl.ops.update(pl.loc, id, { dueDays: 5 })).reason, "judge");
  assert.equal((await pl.ops.create(pl.loc, { kind: "spell", researcher: "A.hero", dueDays: 3 })).reason, "judge");
});

await ta("an update, a close and a facility change leave the posted days and the credited rows as they were", async () => {
  const j = rig({ tables: RATES, levels: LEVELS });
  const { id } = await j.ops.create(j.loc, { kind: "spell", researcher: "A.hero" });
  await j.ops.post(j.loc, id, { day: 3 });
  await j.ops.credit(j.loc);
  await j.ops.post(j.loc, id, { pace: "both" });
  await j.ops.update(j.loc, id, { subject: { name: "Rod" }, bucket: [] });
  await j.ops.setFacility(j.loc, "library", 5);
  const p = M.readRecord(j.loc.flag).projects[0];
  assert.deepEqual(p.posted, [{ day: 4, pace: "both" }]);
  assert.deepEqual(p.credited, [{ day: 3, amount: 90, by: "A.hero" }]);
  assert.equal((await j.ops.update(j.loc, id, { posted: [] })).reason, "field", "posting is not an update");
});

await ta("the GM's handler takes a range and a withdraw on the sender's authority", async () => {
  state.actors.clear();
  const hero = actor("A.hero", "character", { testUserPermission: (user) => user.id === "pl1" });
  const pell = actor("A.pell", "character");
  const row = (uuid) => ({ uuid, name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: false });
  const loc = place("Actor.L4", [row("A.hero"), row("A.pell")], { projects: [{ id: "a", kind: "spell", researcher: "A.hero", status: "open" }, { id: "b", kind: "spell", researcher: "A.pell", status: "open", posted: [{ day: 9, pace: "dedicated" }] }] });
  loc.update = async (patch) => {
    loc.updates = (loc.updates ?? []).concat([patch]);
    for (const [path, value] of Object.entries(patch)) loc.flags["acks-extras"].magic = { ...(loc.flags["acks-extras"].magic ?? {}), [path.split(".").pop()]: value };
  };
  for (const a of [hero, pell, loc]) state.actors.set(a.uuid, a);
  resetTables();
  state.isGM = true;
  const ask = (op, args, requestUserId, extra = {}) => L.projectHandler({ locationUuid: loc.uuid, op, args, requestUserId, ...extra });
  assert.equal((await ask("postRange", { id: "a", from: 4, days: 3 }, "pl1")).reason, "judge", "a Player's range is refused where it runs");
  assert.equal((await ask("postRange", { id: "a", from: 4, days: 3 }, "pl1", { judge: true })).reason, "judge", "and a payload's claim of being the Judge changes nothing");
  assert.equal(loc.updates, undefined, "nothing written");
  const range = await ask("postRange", { id: "a", from: 4, days: 3 }, null);
  assert.deepEqual([range.ok, range.posted], [true, [4, 5, 6]]);
  assert.deepEqual(await ask("withdraw", { id: "a", day: 5 }, "pl1"), { ok: true, id: "a", day: 5 }, "the owner of the researcher withdraws a posted day through the relay");
  assert.equal((await ask("withdraw", { id: "b", day: 9 }, "pl1")).reason, "owner", "and not another's");
  assert.equal((await ask("withdraw", { id: "b", day: 9 }, "pl1", { judge: true })).reason, "owner");
  assert.deepEqual(await ask("withdraw", { id: "b", day: 9 }, null), { ok: true, id: "b", day: 9 }, "the Judge withdraws any");
  assert.deepEqual(L.recordOf(loc).projects.map((p) => p.posted.map((r) => r.day)), [[4, 6], []]);
});

await ta("credit writes the passed days once, from whichever seat asks, and nothing when none is due", async () => {
  const j = rig({ tables: RATES, levels: LEVELS });
  const a = await j.ops.create(j.loc, { kind: "spell", researcher: "A.hero" });
  const b = await j.ops.create(j.loc, { kind: "spell", researcher: "A.pell" });
  await j.ops.post(j.loc, a.id);
  await j.ops.post(j.loc, b.id, { pace: "ancillary" });
  const writes = j.loc.writes.length;
  assert.deepEqual(await j.ops.credit(j.loc), { ok: true, credited: 0 }, "day 4 has not passed");
  assert.equal(j.loc.writes.length, writes, "nothing due: nothing written");
  j.clock.day = 5;
  const player = rig({ judge: false, owned: ["A.hero"], tables: RATES, levels: LEVELS });
  player.loc.flag = j.loc.flag;
  player.clock.day = 5;
  assert.deepEqual(await player.ops.credit(player.loc), { ok: true, credited: 1 }, "a Player's request credits the projects of the characters they own");
  assert.equal(M.readRecord(player.loc.flag).projects[1].posted.length, 1, "and leaves another's alone");
  j.loc.flag = player.loc.flag;
  assert.deepEqual(await j.ops.credit(j.loc, b.id), { ok: true, credited: 1 }, "a Judge credits one project by id");
  assert.deepEqual(await j.ops.credit(j.loc), { ok: true, credited: 0 });
  player.loc.flag = j.loc.flag;
  assert.deepEqual(await player.ops.credit(player.loc), { ok: true, credited: 0 });
  const after = M.readRecord(j.loc.flag).projects;
  assert.deepEqual(after.map((p) => [p.posted.length, p.credited.map((c) => c.amount)]), [[0, [90]], [0, [7.5]]]);
  j.clock.day = 3;
  assert.equal((await j.ops.credit(j.loc)).credited, 0, "a clock dragged back changes nothing");
  j.clock.day = 9;
  assert.equal((await j.ops.credit(j.loc)).credited, 0, "and forward again credits no day twice");
  assert.equal(M.readRecord(j.loc.flag).projects[0].credited.length, 1);
  await j.ops.post(j.loc, a.id, { day: 7 });
  assert.equal((await j.ops.close(j.loc, a.id)).ok, true);
  await j.ops.post(j.loc, b.id, { day: 6 });
  j.clock.day = 12;
  assert.equal((await j.ops.credit(j.loc)).credited, 1, "a closed project is not credited");
  const asked = [];
  const remote = rig({ judge: false, canWrite: false, relay: async (req) => (asked.push(req), { ok: true, credited: 0 }), tables: RATES, levels: LEVELS });
  await remote.ops.credit(remote.loc, "p9");
  await remote.ops.post(remote.loc, "p9", { pace: "both" });
  assert.deepEqual(asked.map((r) => [r.op, r.args]), [["credit", { id: "p9" }], ["post", { id: "p9", pace: "both", day: undefined }]], "a seat that cannot write asks the GM's client");
});

/* ---------------------------------- the panel ---------------------------------- */

const loc2 = (key, data) => echo(key, data);
const linked = [{ uuid: "A.hero", name: "Hero", img: "hero.png" }, { uuid: "A.pell", name: "Pell", img: "" }];
const panel = (record, o = {}) => M.panelModel({ record: M.readRecord(record), tables: TABLES, linked, today: 4, loc: loc2, bucketLoc: loc2, judge: false, owns: (u) => u === "A.hero", levelOf: (u) => (u === "A.hero" ? 5 : null), ...o });

t("the panel draws each facility with its value, who may write it and how many open projects use it", () => {
  const p = panel({ facilities: { library: 9000 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero" }, { id: "b", kind: "ritual", level: 5, researcher: "A.pell" }] });
  const lib = p.facilities.find((f) => f.key === "library");
  assert.deepEqual([lib.value, lib.text, lib.editable, lib.users], [9000, "9000", false, 2]);
  assert.equal(p.facilities.find((f) => f.key === "workshop").text, "", "an unset value stays blank");
  assert.equal(panel({}, { judge: true }).facilities[0].editable, true);
  assert.match(lib.tip, /cite.library/);
});

t("a project's chips say where each verdict came from: parts and page, the page alone where nothing is read", () => {
  const record = { facilities: { library: 4499, workshop: 1 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero" }, { id: "b", kind: "item", researcher: "A.hero" }] };
  const [spell, item] = panel(record).projects;
  assert.equal(spell.verdicts[0].tone, "warn");
  assert.match(spell.verdicts[0].tip, /"minimum":"4500"/);
  assert.match(spell.verdicts[0].tip, /"cite":" \(Invented p\. 1\)"/);
  assert.equal(item.verdicts[0].tone, "", "no level entered: unread");
  assert.equal(item.verdicts[0].text, "", "an unread chip carries no words");
  assert.match(item.verdicts[0].tip, /cite.workshop|Invented p\. 1/);
  const ok = panel({ facilities: { library: 18500 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero" }] }).projects[0].verdicts[0];
  assert.deepEqual([ok.tone, ok.text], ["ok", 'bonus{"n":4}']);
  const none = panel({ facilities: { library: 18500 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero" }] }, { tables: NOTHING }).projects[0];
  assert.equal(none.verdicts[0].tone, "");
  assert.match(none.verdicts[0].tip, /cite.library/, "nothing imported: the page reference this module ships");
  assert.equal(none.throw.text, "", "no ladder, no throw");
});

t("progress, the throw and Finish read the record: Finish says why it cannot", () => {
  const rec = { projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", costs: { research: 40, component: 20 }, credited: [{ day: 2, amount: 15 }, { day: 3, amount: 10 }] }] };
  const p = panel(rec).projects[0];
  assert.equal(p.progress.text, 'progress{"done":"25","due":"40"}');
  assert.equal(p.progress.pct, 63);
  assert.equal(p.finish.why, "finishWhy.credited");
  assert.equal(p.throw.text, 'throw{"n":11}', "the ladder's throw for the researcher's level");
  const fixed = panel({ projects: [{ ...rec.projects[0], throw: { target: 8 } }] }).projects[0];
  assert.equal(fixed.throw.text, 'throw{"n":8}');
  const done = panel({ projects: [{ ...rec.projects[0], credited: [{ day: 2, amount: 40 }] }] }).projects[0];
  assert.deepEqual([done.finish.why, done.finish.live], ["", true], "credited and the throw read: Finish is live for the researcher's owner, with no reason");
  const over = panel({ projects: [{ ...rec.projects[0], credited: [{ day: 2, amount: 99 }] }] }).projects[0];
  assert.equal(over.progress.pct, 100, "the bar is held to full");
  const blank = panel({ projects: [{ id: "a", kind: "spell", researcher: "A.hero" }] }).projects[0];
  assert.equal(blank.progress.pct, 0);
  assert.equal(blank.progress.text, "0", "no due entered: the credited figure alone");
});

t("who may act: the researcher's owner and the Judge; anyone else reads", () => {
  const rec = { projects: [{ id: "a", kind: "spell", researcher: "A.pell", assistants: ["A.hero"] }, { id: "b", kind: "spell", researcher: "A.hero" }] };
  const [stranger, mine] = panel(rec).projects;
  assert.deepEqual([stranger.can, mine.can], [false, true]);
  assert.equal(stranger.bucket.canDrop, false, "a bucket a viewer may not change is locked");
  assert.equal(mine.bucket.canDrop, true);
  assert.deepEqual(mine.addChoices.map((a) => a.uuid), ["A.pell"], "linked characters not already on the project");
  assert.equal(stranger.costs.every((c) => c.editable === false), true);
  const judge = panel(rec, { judge: true, owns: () => true });
  assert.equal(judge.projects[0].can, true);
  assert.equal(judge.projects[0].costs.every((c) => c.editable), true);
  assert.equal(panel(rec).canCreate, true);
  assert.equal(panel(rec, { owns: () => false }).canCreate, false);
  assert.equal(panel(rec, { linked: [] }).noLinked, true);
});

t("closed projects are listed apart and counted out of the open ones", () => {
  const p = panel({ projects: [{ id: "a", kind: "spell", researcher: "A.hero" }, { id: "b", kind: "item", researcher: "A.hero", status: "closed", closed: 3, subject: { name: "Rod" } }] });
  assert.equal(p.openCount, 1);
  assert.deepEqual(p.closed, [{ id: "b", name: "Rod", day: 3, dayText: 'closedOn{"day":3}' }]);
});

t("the components bucket reads its due from the project and keeps its drop zone to those who may drop", () => {
  const entry = { uuid: "Item.x", kind: "item", name: "Thing", img: "", qty: 1, cap: 1, value: { gp: 12, source: "cost", cite: null }, fit: "", effects: [] };
  const p = panel({ projects: [{ id: "a", kind: "spell", researcher: "A.hero", costs: { component: 20 } }] }, { entries: { a: [entry] } }).projects[0];
  assert.equal(p.bucket.key, "a");
  assert.equal(p.bucket.rows.length, 1);
  assert.equal(p.bucket.head.status, "short");
  assert.equal(p.bucket.dropLabel, "dropComponents");
});

/* ---------------------------------- the template ---------------------------------- */

const { default: Handlebars } = await import("handlebars");
const render = (model) => {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => String(key));
  hb.registerPartial("modules/acks-extras/templates/lib/bucket.hbs", fs.readFileSync("templates/lib/bucket.hbs", "utf8"));
  hb.registerPartial("modules/acks-extras/templates/lib/bucket-row.hbs", fs.readFileSync("templates/lib/bucket-row.hbs", "utf8"));
  return hb.compile(fs.readFileSync("templates/magic/research-tab.hbs", "utf8"))({ research: model });
};

t("the tab writes no id and no title attribute, and a viewer's controls are the ones the sheet leaves live", () => {
  const rec = { facilities: { library: 5000 }, projects: [{ id: "a", kind: "spell", level: 2, researcher: "A.hero", assistants: ["A.pell"], costs: { research: 40 } }, { id: "b", kind: "item", researcher: "A.pell" }] };
  for (const html of [render(panel(rec)), render(panel(rec, { judge: true, owns: () => true }))]) {
    assert.doesNotMatch(html, /\sid=/, "a window may be open twice");
    assert.doesNotMatch(html, /\stitle=/, "core's tooltip manager, never a title attribute");
    assert.doesNotMatch(html, /<summary>[^]*<(button|a|input|select)\b[^]*<\/summary>/);
  }
  const player = render(panel(rec, { linked: [...linked, { uuid: "A.lena", name: "Lena", img: "" }] }));
  assert.doesNotMatch(player, /data-research-facility/, "a Player gets no facility input");
  assert.doesNotMatch(player, /data-research-field="(level|costs|paid)/, "a Player gets none of the Judge's fields");
  const mine = player.slice(player.indexOf('data-project-id="a"'), player.indexOf('data-project-id="b"'));
  assert.match(mine, /data-action="closeResearchProject"[^>]*data-research-control/);
  assert.match(mine, /data-research-add-assistant/);
  assert.match(mine, /data-action="removeResearchAssistant"[^>]*data-uuid="A\.pell"/);
  const theirs = player.slice(player.indexOf('data-project-id="b"'));
  assert.doesNotMatch(theirs, /closeResearchProject|data-research-add-assistant|removeResearchAssistant|data-research-field/, "a project the viewer does not own draws no control");
  assert.match(player, /<button type="button" class="acks-btn acks-btn--roll" data-action="finishResearchProject" disabled data-tooltip-text="finishWhy.credited">/, "Finish is drawn disabled, with no control mark, while the research is not credited");
  assert.match(player, /finishWhy\.credited/, "and its reason is text on the surface");
  const judge = render(panel(rec, { judge: true, owns: () => true }));
  assert.match(judge, /data-research-facility="library"/);
  assert.match(judge, /data-research-field="costs\.research"/);
  assert.match(judge, /data-research-field="paid\.material"/);
  assert.match(judge, /data-research-field="level"/);
});

t("a place with no linked character says so and offers no new project; one with none open says that", () => {
  const html = render(panel({}, { linked: [] }));
  assert.match(html, /research\.noLinked/);
  assert.doesNotMatch(html, /newResearchProject/);
  const open = render(panel({}));
  assert.match(open, /research\.noProjects/);
  assert.match(open, /newResearchProject/);
});

t("the sheet carries the tab after Storage on every place, leaves its controls live for a viewer and keeps the drop to the bucket", () => {
  const sheet = fs.readFileSync("scripts/location/apps/location-sheet.mjs", "utf8");
  const ids = [...sheet.matchAll(/\{ id: "(\w+)", icon/g)].map((m) => m[1]);
  assert.equal(ids[ids.indexOf("storage") + 1], "research");
  assert.match(sheet, /VIEWER_CONTROLS = [^\n]*\[data-research-control\]/);
  assert.match(sheet, /VIEWER_CONTROLS = [^\n]*\[data-tab="research"\] \[data-bucket\] button/, "a bucket row's X is live for a viewer who may change the bucket");
  assert.doesNotMatch(sheet, /VIEWER_CONTROLS = [^\n]*\[data-tab="research"\] (:is\()?button/, "Finish lifts the lock by its own control mark, not by a rule over every button of the tab");
  assert.doesNotMatch(sheet, /MARKET_TABS = [^\n]*research/, "the tab is not gated on a market");
  const template = fs.readFileSync("templates/location/location-sheet.hbs", "utf8");
  const at = template.indexOf('data-tab="research"');
  assert.ok(at > 0 && at < template.indexOf("{{#if isGM}}\n  {{!-- ------------------------- GM settings"), "the section stands outside the Judge's block");
  const tab = fs.readFileSync("scripts/magic/research-tab.mjs", "utf8");
  assert.ok((tab.match(/stopPropagation\(\)/g) ?? []).length >= 4, "each of the three change listeners and the drop zones stops its event");
  assert.doesNotMatch(tab, /instanceof (HTML|Element)/, "a node is told by nodeType, and the tab tells none");
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  assert.ok(lang["ACKS-HENCHMEN.location.tab.research"]);
});

t("every string the tab asks for exists, and none is a printed value", () => {
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  const sources = ["scripts/magic/research-project.mjs", "scripts/magic/research-tab.mjs", "scripts/magic/research-project-live.mjs", "scripts/magic/research-outcome-live.mjs"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const GROUP = ["ACKS-MAGIC", "research", ""].join(".");
  const keys = new Set([...sources.matchAll(/\bloc\("([\w.]+)"/g)].map((m) => m[1]));
  // The keys the code builds from its own enumerations.
  for (const k of M.PROJECT_KINDS) keys.add(`kind.${k}`);
  for (const k of M.FACILITY_KEYS) keys.add(`facility.${k}`);
  for (const k of M.COST_KEYS) keys.add(`cost.${k}`);
  for (const k of new Set(Object.values(M.KIND_FACILITIES).flat().map((f) => f.table))) keys.add(`cite.${k}`);
  for (const k of ["library", "workshop", "ladder", "costs"]) keys.add(`cite.${k}`);
  for (const k of ["noLocation", "op", "judge", "facility", "amount", "kind", "researcher", "assistant", "owner", "noProject", "field", "noGm", "drop.noDrop", "drop.gone", "drop.kind", "drop.duplicate", "drop.subject"]) keys.add(`refused.${k}`);
  keys.add("warn.facility");
  for (const k of M.PACES) for (const prefix of ["pace", "paceTip"]) keys.add(`${prefix}.${k}`);
  for (const k of ["below", "over", "unread"]) keys.add(`assistantWhy.${k}`);
  for (const k of ["prose", "assistants"]) keys.add(`cite.${k}`);
  for (const k of ["pace", "day", "duplicate", "assistantLevel", "assistantCount", "noClock"]) keys.add(`refused.${k}`);
  for (const k of ["assistantLevel", "assistantCount"]) keys.add(`warn.${k}`);
  for (const k of ["range", "credited", "notPosted"]) keys.add(`refused.${k}`);
  for (const k of ["postedRange", "postedSkipped", "postedNone"]) keys.add(k);
  for (const k of ["ritual", "throw", "subject", "credited"]) keys.add(`finishWhy.${k}`);
  for (const k of ["notComplete", "throwUnread", "ritual", "subject", "bucketOwner", "subjectOwner"]) keys.add(`refused.${k}`);
  for (const k of M.PACES) keys.add(`paceName.${k}`);
  for (const k of Object.values(M.COMPONENT_FIT)) keys.add(`fit.${k}`);
  for (const k of ["identify", "spell", "item", "blank", "formula", "settle", "card"]) keys.add(`card.what.${k}`);
  assert.ok(keys.size > 40);
  for (const k of keys) assert.ok(lang[`${GROUP}${k}`] !== undefined, `${GROUP}${k}`);
  for (const [k, v] of Object.entries(lang)) if (k.startsWith(GROUP) && !k.includes(".cite.")) assert.doesNotMatch(v, /\d/, `${k} carries a number: ${v}`);
});

/* ------------------------- the days on the panel and the sweep ------------------------- */

const dayPanel = (projects, o = {}) => panel({ projects }, { tables: RATES, levelOf: (u) => LEVELS[u] ?? null, owns: (u) => u === "A.hero", linked: [...linked, { uuid: "A.lena", name: "Lena", img: "" }], ...o });
const dayRecord = { id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell"], costs: { research: 1000 }, credited: [{ day: 1, amount: 90, by: "A.hero" }, { day: 1, amount: 30, by: "A.pell" }], posted: [{ day: 4, pace: "ancillary" }] };

t("a project draws its day, its strip, each participant's rate and the pace, from the record and the imported rows", () => {
  const p = dayPanel([dayRecord]).projects[0];
  assert.equal(p.day.text, 'dayChip{"d":2,"due":10}', "one credited day, one posted, and the 1000 less 120 and 30 at a day's rate");
  assert.equal(p.day.tone, "pow");
  assert.match(p.day.tip, /dueLadder/);
  assert.deepEqual(p.strip.cells.slice(0, 3), ["c", "p", ""]);
  assert.equal(p.strip.cells.length, 10);
  assert.equal(p.strip.aria, 'stripAria{"credited":1,"posted":1,"waiting":0}');
  assert.deepEqual([p.postedRow.text, p.post.disabled, p.post.can], ["1", true, true], "today is posted: the control is disabled and says why");
  assert.match(p.post.tip, /postedToday/);
  assert.deepEqual([p.researcher.rate.text, p.assistants[0].rate.text, p.assistants[0].rate.tone], ['perDay{"rate":"90"}', 'perDay{"rate":"30"}', ""]);
  assert.match(p.progress.tip, /creditedTip/);
  assert.ok(p.progress.tip.includes("Hero") && p.progress.tip.includes("90") && p.progress.tip.includes("Pell"), "each participant's credited gold is named");
  assert.deepEqual(p.pace.options.map((o) => [o.value, o.checked]), [["dedicated", true], ["ancillary", false], ["both", false]]);
  assert.equal(p.pace.options[1].tip, 'paceTip.ancillary{"share":"1/4","cite":"cite.prose"}', "the share is the imported fraction, interpolated at render");
  assert.equal(dayPanel([dayRecord], { paceOf: () => "both" }).projects[0].pace.options[2].checked, true, "the window's own choice is the one drawn");
  assert.equal(p.pace.name, "pace-a");
});

t("a project with nothing posted and no rate read draws no strip and no due, and every blank figure carries its page", () => {
  const p = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell"] }], { tables: NOTHING }).projects[0];
  assert.equal(p.day.text, "");
  assert.equal(p.strip.show, false);
  assert.equal(p.post.disabled, false);
  assert.equal(p.researcher.rate.text, "", "an unread rate is blank");
  assert.match(p.researcher.rate.tip, /rateUnread.*cite.ladder/);
  assert.match(p.pace.options[1].tip, /paceUnread/);
  const judged = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", dueDays: 5, posted: [{ day: 1, pace: "dedicated" }] }], { tables: NOTHING }).projects[0];
  assert.equal(judged.day.text, 'dayChip{"d":1,"due":5}', "the Judge's days stand in while the rates are not read, and a passed day is shown as posted");
  assert.match(judged.day.tip, /dueJudge/);
  assert.equal(judged.strip.cells.length, 5);
  assert.deepEqual(judged.strip.cells.slice(0, 2), ["w", ""], "a held day is a waiting cell, posted and not credited");
  assert.equal(judged.postedRow.text, "1");
  assert.equal(judged.postedRow.tip, 'postedTipUnread{"n":1,"cite":"cite.ladder"}', "the tooltip says the day is held for a rate not read, with the page");
  assert.equal(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", posted: [{ day: 1, pace: "dedicated" }] }], { tables: NOTHING }).projects[0].day.text, 'dayChipOpen{"d":1}', "no due known: the day alone");
  const swept = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", posted: [{ day: 1, pace: "dedicated" }] }]).projects[0];
  assert.match(swept.postedRow.tip, /postedTipWaiting/, "with the rates read a passed day only waits for the sweep, and no page is named");
});

t("an assistant who does not count says so on the chip, a Player without the project has no Post, and the strip is held to its cells", () => {
  const p = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell", "A.kid"] }]).projects[0];
  assert.deepEqual([p.assistants[1].rate.tone, p.assistants[1].rate.text], ["warn", ""]);
  assert.match(p.assistants[1].rate.tip, /assistantWhy.below/);
  const stranger = dayPanel([{ id: "a", kind: "spell", researcher: "A.pell" }]).projects[0];
  assert.equal(stranger.post.can, false);
  const long = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", costs: { research: 90 * 400 } }]).projects[0];
  assert.equal(long.strip.cells.length, 60);
  assert.equal(long.day.text, 'dayChip{"d":0,"due":400}', "the figure is the whole, whatever the strip draws");
});

t("Finish reads whether the research is complete, by the gold in", () => {
  const done = dayPanel([{ ...dayRecord, level: 2, credited: [{ day: 1, amount: 1000, by: "A.hero" }], posted: [] }]).projects[0];
  assert.equal(done.finish.why, "", "and nothing stands in the way once it is");
  const noLevel = dayPanel([{ ...dayRecord, credited: [{ day: 1, amount: 1000, by: "A.hero" }], posted: [] }]).projects[0];
  assert.equal(noLevel.finish.why, "finishWhy.bonus", "with no level entered the facility's bonus cannot be read, and the throw is not made without it");
  assert.equal(dayPanel([dayRecord]).projects[0].finish.why, "finishWhy.credited");
});

t("the tab draws the strip, the chip and the pace radios outside any form, with a Post control for those who may post", () => {
  const rec = { projects: [dayRecord, { id: "b", kind: "item", researcher: "A.pell" }] };
  const html = render(dayPanel(rec.projects));
  assert.doesNotMatch(html, /\sid=/);
  assert.match(html, /class="acks-extras-research__days" role="img" aria-label="stripAria/);
  assert.equal((html.match(/<i class="is-c">/g) ?? []).length, 1);
  assert.equal((html.match(/<i class="is-p">/g) ?? []).length, 1);
  const mine = html.slice(html.indexOf('data-project-id="a"'), html.indexOf('data-project-id="b"'));
  assert.equal((mine.match(/type="radio"/g) ?? []).length, 3);
  assert.match(mine, /type="radio" form="acks-extras-research-pace" name="pace-a-" value="dedicated" data-research-pace data-research-control checked/);
  assert.match(mine, /data-action="postResearchDay" disabled/, "today is posted: disabled, and out of the controls the sheet's lock lifts for a viewer");
  assert.doesNotMatch(mine, /data-action="postResearchDay"[^>]*data-research-control/);
  const fresh = render(dayPanel([{ id: "c", kind: "spell", researcher: "A.hero" }]));
  assert.match(fresh, /data-action="postResearchDay" data-research-control data-tooltip-text/, "an unposted day's Post is live for a viewer who may post");
  assert.match(mine, /day\.aria|dayChip/);
  const theirs = html.slice(html.indexOf('data-project-id="b"'));
  assert.doesNotMatch(theirs, /postResearchDay/, "a project the viewer does not own draws no Post");
  assert.match(theirs, /type="radio"[^>]*disabled/, "and its pace is read-only");
  assert.doesNotMatch(theirs, /data-research-pace[^>]*data-research-control/, "and the sheet's lock is not lifted on it");
});

t("the tab keeps the pace in the window and never writes it", () => {
  const tab = fs.readFileSync("scripts/magic/research-tab.mjs", "utf8");
  assert.match(tab, /paceMemory = new WeakMap\(\)/);
  assert.match(tab, /postResearchDay: onPostDay/);
  assert.match(tab, /researchApi\.post\(this\.actor, id, \{ pace: paceOf\(this, id\) \}\)/, "Post posts the pace this window chose");
  assert.doesNotMatch(tab.slice(tab.indexOf("data-research-pace")), /researchApi\.update\(location, id, \{ ?pace/);
  assert.equal(JSON.stringify(M.UPDATE_FIELDS).includes("posted"), false);
  assert.ok(M.UPDATE_FIELDS.includes("dueDays") && M.JUDGE_FIELDS.includes("dueDays"));
});

t("the Judge's days-due box stands only while the due cannot be computed, and a Player is shown the due as text", () => {
  const unread = { id: "a", kind: "spell", researcher: "A.hero", dueDays: 5 };
  const box = dayPanel([unread], { tables: NOTHING, judge: true }).projects[0];
  assert.deepEqual([box.due.byHand, box.due.value, box.due.label], [true, 5, "dueByHand"], "no rate read: the Judge types the due");
  assert.match(box.due.tip, /dueByHandTip.*cite.ladder/, "and the tooltip carries the page reference");
  const noCost = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero" }], { tables: RATES, judge: true }).projects[0];
  assert.equal(noCost.due.byHand, true, "rates read but no research cost entered: still not computable, still the Judge's");
  assert.equal(noCost.due.value, "", "a blank until a figure is typed");
  const computed = dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell"], costs: { research: 1000 }, dueDays: 99 }], { tables: RATES, judge: true }).projects[0];
  assert.deepEqual([computed.due.byHand, computed.due.text, computed.due.label], [false, "9", "dueRow"], "once computed the computed due is text, whatever the Judge entered");
  assert.match(computed.due.tip, /dueLadder/);
  const player = dayPanel([unread], { tables: NOTHING, judge: false }).projects[0];
  assert.deepEqual([player.due.byHand, player.due.text], [false, "5"], "a Player sees the Judge's due as text");
  assert.match(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero" }], { tables: NOTHING }).projects[0].due.tip, /dueUnread.*cite.ladder/, "unknown: blank, the page in the tooltip");
  assert.equal(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero" }], { tables: NOTHING }).projects[0].due.text, "");
  const judgeHtml = render(dayPanel([unread], { tables: NOTHING, judge: true, owns: () => true }));
  assert.match(judgeHtml, /<input type="number"[^>]*data-research-field="dueDays" value="5"[^>]*aria-label="dueInput"[^>]*data-tooltip-text="dueByHandTip/);
  assert.doesNotMatch(judgeHtml, /\sid=/);
  assert.doesNotMatch(render(dayPanel([unread], { tables: NOTHING, judge: false })), /dueDays/, "a Player's tab has no days-due field");
  assert.doesNotMatch(render(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell"], costs: { research: 1000 } }], { tables: RATES, judge: true })), /dueDays/, "and the box is gone once the due is computed");
});

t("a held day is a waiting cell and a waiting tag, each posted day has its row, and a credited day has none", () => {
  const noShare = { ...RATES, prose: { ...RATES.prose, ancillary: null } };
  const rec = { id: "a", kind: "spell", researcher: "A.hero", credited: [{ day: 1, amount: 90, by: "A.hero" }], posted: [{ day: 2, pace: "dedicated" }, { day: 3, pace: "ancillary" }, { day: 9, pace: "both" }] };
  const p = dayPanel([rec], { tables: noShare }).projects[0];
  assert.deepEqual(p.strip.cells.slice(0, 4), ["c", "p", "w", "p"], "a passed day with its rate read is posted, a passed day whose share is unread waits, and a day yet to come is posted whatever its rate");
  const held = dayPanel([{ ...rec, posted: [{ day: 2, pace: "dedicated" }, { day: 3, pace: "ancillary" }] }], { tables: noShare }).projects[0];
  assert.deepEqual(held.strip.cells.slice(0, 3), ["c", "p", "w"]);
  assert.deepEqual(held.postedList.rows.map((r) => [r.day, r.tag.text, r.tag.tone]), [[2, "tagPosted", ""], [3, "tagWaiting", "warn"]], "no credited day is listed");
  assert.match(held.postedList.rows[0].label, /postedDay.*"day":2.*paceName.dedicated/, "the list reads the capitalised name the board draws, not the radio's lowercase one");
  assert.equal(held.postedList.rows[0].tag.tip, "", "a posted tag has no tooltip");
  assert.equal(held.postedList.rows[1].tag.tip, 'waitingTip{"cite":"cite.ladder"}', "a waiting tag names the page of the rate it waits on");
  assert.deepEqual(held.postedList.rows.map((r) => r.canWithdraw), [true, true], "the owner of the researcher withdraws");
  assert.match(held.postedList.rows[1].withdrawLabel, /withdrawDay.*"day":3/);
  const stranger = dayPanel([{ ...rec, researcher: "A.pell" }], { tables: noShare }).projects[0];
  assert.equal(stranger.postedList.show, true, "the list is read by anyone");
  assert.deepEqual(stranger.postedList.rows.map((r) => r.canWithdraw), [false, false, false], "a Player has no withdraw on another's project");
  const judge = dayPanel([{ ...rec, researcher: "A.pell" }], { tables: noShare, judge: true }).projects[0];
  assert.deepEqual(judge.postedList.rows.map((r) => r.canWithdraw), [true, true, true], "a Judge withdraws any");
  assert.equal(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero", credited: [{ day: 1, amount: 90, by: "A.hero" }] }]).projects[0].postedList.show, false, "nothing posted: no list");

  const html = render(dayPanel([{ ...rec, posted: [{ day: 2, pace: "dedicated" }, { day: 3, pace: "ancillary" }] }, { ...rec, id: "b", researcher: "A.pell" }], { tables: noShare }));
  assert.doesNotMatch(html, /\sid=/);
  const mine = html.slice(html.indexOf('data-project-id="a"'), html.indexOf('data-project-id="b"'));
  assert.equal((mine.match(/<i class="is-w">/g) ?? []).length, 1);
  assert.equal((mine.match(/data-action="withdrawResearchDay"[^>]*data-research-control data-day="\d+"[^>]*aria-label="withdrawDay/g) ?? []).length, 2, "an X per posted day, live for a viewer who may withdraw");
  assert.match(mine, /class="acks-tag is-warn" tabindex="0" data-tooltip-text="waitingTip/);
  assert.match(mine, /data-posted-day="2"/);
  const theirs = html.slice(html.indexOf('data-project-id="b"'));
  assert.doesNotMatch(theirs, /withdrawResearchDay/, "no X on a project the viewer cannot act on");
  assert.match(theirs, /data-posted-day="3"/, "though its days are listed");
});

t("a Judge's Post reads Post days and opens the range prompt; a Player's stays Post day and posts today", () => {
  const rec = { id: "a", kind: "spell", researcher: "A.hero", posted: [{ day: 4, pace: "dedicated" }] };
  const judge = dayPanel([rec], { judge: true, owns: () => true }).projects[0];
  assert.deepEqual([judge.post.label, judge.post.range, judge.post.disabled], ["postDays", true, false], "today posted does not spend a Judge's control: a range starts anywhere");
  const player = dayPanel([rec]).projects[0];
  assert.deepEqual([player.post.label, player.post.range, player.post.disabled], ["post", false, true]);
  assert.match(render(dayPanel([rec], { judge: true, owns: () => true })), /data-action="postResearchDays" data-research-control data-tooltip-text="postDaysTip">postDays</);
  assert.match(render(dayPanel([rec])), /data-action="postResearchDay" disabled/);
  const fresh = render(dayPanel([{ id: "a", kind: "spell", researcher: "A.hero" }]));
  assert.match(fresh, /data-action="postResearchDay" data-research-control/);
  assert.doesNotMatch(fresh, /postResearchDays/, "a Player's button never opens the range prompt");
});

t("the tab wires the range prompt and the withdraw, names its classes and tells no node by instanceof", () => {
  const tab = fs.readFileSync("scripts/magic/research-tab.mjs", "utf8");
  assert.match(tab, /postResearchDays: onPostDays/);
  assert.match(tab, /withdrawResearchDay: onWithdrawDay/);
  assert.match(tab, /researchApi\.postRange\(this\.actor, id, picks\)/);
  assert.match(tab, /researchApi\.withdraw\(this\.actor, id, Number\(target\.dataset\.day\)\)/);
  const prompt = tab.slice(tab.indexOf("async function promptDays"), tab.indexOf("async function onPostDays"));
  assert.match(prompt, /classes: DIALOG_CLASSES/, "the prompt names the module's classes: scroll contract and drag corner");
  assert.match(prompt, /aria-pressed/);
  assert.match(prompt, /role="group"/);
  assert.match(prompt, /elementOf\(dialog\?\.element\)/);
  assert.doesNotMatch(prompt, /\sid=|instanceof/);
  assert.match(prompt, /<label[^>]*>[^]*<input[^]*<\/label>/, "each field's label wraps its control");
  const css = fs.readFileSync("styles/magic.css", "utf8");
  assert.match(css, /\.acks-extras-research__days i\.is-w \{[^}]*dashed var\(--acks-warning\)/, "the waiting cell is a dashed warning border on the tokens, no pattern");
  assert.doesNotMatch(css.slice(css.indexOf(".acks-extras-research__days i.is-w"), css.indexOf(".acks-extras-research__pace {")), /gradient|url\(|\d(px|rem)\b/, "no generated art and no bare size in the new rules");
});

await ta("a range's result is told with the days it posted and the days it skipped, and a withdraw's refusal like any", async () => {
  state.warned = [];
  state.informed = [];
  L.announce({ ok: true, posted: [4, 5, 6], skipped: [] });
  L.announce({ ok: true, posted: [4, 6, 7], skipped: [5], warns: ["facility", "assistantLevel"], warn: "facility" });
  L.announce({ ok: true, posted: [], skipped: [4, 5] });
  L.announce({ ok: false, reason: "credited" });
  L.announce({ ok: true, id: "a", day: 5 });
  assert.deepEqual(state.informed, ['postedRange{"posted":"4\u20136","skipped":""}'.replace(/^/, "ACKS-MAGIC.research."), 'postedSkipped{"posted":"4, 6\u20137","skipped":"5"}'.replace(/^/, "ACKS-MAGIC.research."), 'postedNone{"posted":"","skipped":"4\u20135"}'.replace(/^/, "ACKS-MAGIC.research.")]);
  assert.deepEqual(state.warned.map((m) => m.replace("ACKS-MAGIC.research.", "")), ["warn.facility", "warn.assistantLevel", "refused.credited"], "each warning once, then the refusal");
  state.warned = [];
  state.informed = [];
});

await ta("the sweep credits the world's passed days once, writes only the places with a day due, and the API reads the standing", async () => {
  state.actors.clear();
  resetTables();
  registerTable(
    {
      id: "magicResearch",
      source: { pages: "Invented 1-9" },
      cites: { researchLadder: "Invented p. 2", researchLadderNote: "Invented p. 2", researchProse: "Invented p. 4", assistantProse: "Invented p. 5" },
      tables: {
        researchLadder: { a: { label: "4", rate: "30gp", throw: "15+", marked: false }, b: { label: "5", rate: "90gp", throw: "11+", marked: false } },
        researchLadderNote: { otherProjectsRate: 150, markedProjects: "4 5 * for glassblowing, ritual rites. u se 150gp" },
        researchProse: { ancillaryFraction: "1/4" },
        assistantProse: { managerLevel: 4, managerBase: 2, aidLevel: 2, spellLevel: 6, itemLevel: 9 },
      },
    },
    { priority: PRIORITY.WORLD, source: "test" }
  );
  const hero = actor("A.hero", "character", { system: { details: { level: 5 }, scores: { int: { mod: 0 } } } });
  const pell = actor("A.pell", "character", { system: { details: { level: 4 }, scores: { int: { mod: 0 } } } });
  const row = (uuid) => ({ uuid, name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: false });
  const withFlag = (uuid, flag) => {
    const loc = place(uuid, [row("A.hero"), row("A.pell")], flag);
    loc.update = async (patch) => {
      loc.updates = (loc.updates ?? []).concat([patch]);
      for (const [path, value] of Object.entries(patch)) loc.flags["acks-extras"].magic = { ...(loc.flags["acks-extras"].magic ?? {}), [path.split(".").pop()]: value };
    };
    return loc;
  };
  const due = withFlag("Actor.Ldue", { projects: [{ id: "a", kind: "spell", researcher: "A.hero", assistants: ["A.pell"], status: "open", costs: { research: 1000 }, posted: [{ day: 3, pace: "dedicated" }, { day: 4, pace: "both" }] }] });
  const idle = withFlag("Actor.Lidle", { projects: [{ id: "z", kind: "spell", researcher: "A.hero", status: "open", posted: [{ day: 4, pace: "dedicated" }] }] });
  const empty = withFlag("Actor.Lnone", undefined);
  for (const a of [hero, pell, due, idle, empty]) state.actors.set(a.uuid, a);
  state.isGM = true;
  state.canModify = true;
  state.worldTime = 4 * 86400;
  assert.equal(await L.creditPassedDays(), 1, "day 3 has passed; day 4 is today");
  assert.equal(due.updates.length, 1);
  assert.equal(idle.updates, undefined, "a place with no day due is not written");
  assert.equal(empty.updates, undefined);
  const p = L.recordOf(due).projects[0];
  assert.deepEqual(p.credited, [{ day: 3, amount: 90, by: "A.hero" }, { day: 3, amount: 30, by: "A.pell" }]);
  assert.equal(await L.creditPassedDays(), 0, "a second sweep finds nothing due");
  assert.equal(due.updates.length, 1);
  state.worldTime = 5 * 86400;
  assert.equal(await L.creditPassedDays(), 2, "day 4 now has passed, on both places");
  assert.deepEqual(L.recordOf(due).projects[0].credited.slice(2), [{ day: 4, amount: 112.5, by: "A.hero" }, { day: 4, amount: 37.5, by: "A.pell" }], "an overtime day is the whole rate and its share");
  state.worldTime = 2 * 86400;
  assert.equal(await L.creditPassedDays(), 0, "a clock dragged back credits nothing");
  state.worldTime = 9 * 86400;
  assert.equal(await L.creditPassedDays(), 0, "and forward again credits no day twice");
  assert.equal(L.recordOf(due).projects[0].credited.length, 4);
  const standing = L.researchApi.progress(due, "a");
  assert.deepEqual([standing.creditedDays, standing.creditedGp, standing.dueBy, standing.complete], [2, 270, "ladder", false]);
  assert.equal(standing.dueDays, 2 + Math.ceil(730 / 120), "the 1000 less 270, at 120 a day");
  assert.equal(L.researchApi.dueDay(due, "a"), 9 + (standing.dueDays - 2) - 1, "counted from today, when nothing is posted");
  assert.equal(L.researchApi.progress(due, "none"), null);
  assert.equal(L.researchApi.dueDay(due, "none"), null);
  assert.equal((await L.researchApi.post(due, "a", { pace: "ancillary" })).ok, true);
  assert.deepEqual(L.recordOf(due).projects[0].posted, [{ day: 9, pace: "ancillary" }]);
  const range = await L.researchApi.postRange(due, "a", { pace: "both", from: 9, days: 3 });
  assert.deepEqual([range.ok, range.posted, range.skipped], [true, [10, 11], [9]], "the API's range skips the day already posted");
  assert.equal((await L.researchApi.withdraw(due, "a", 10)).ok, true);
  assert.deepEqual(L.recordOf(due).projects[0].posted.map((r) => r.day), [9, 11], "and takes one back");
  assert.equal(L.researchApi.RANGE_MAX, M.RANGE_MAX);
  assert.deepEqual(L.researchApi.PACES, ["dedicated", "ancillary", "both"]);
  assert.equal(typeof L.registerProjects, "function");
  resetTables();
  state.worldTime = 4 * 86400;
});

await ta("the sweep leaves a passed day posted while a rate is unread, writes nothing for it, and credits it once the rate is read", async () => {
  state.actors.clear();
  resetTables();
  const hero = actor("A.hero", "character", { system: { details: { level: 5 }, scores: { int: { mod: 0 } } } });
  const row = (uuid) => ({ uuid, name: "", img: "", kind: "actor", quantity: 1, ownerUuid: "", notes: "", hidden: false });
  const loc = place("Actor.Lheld", [row("A.hero")], { projects: [{ id: "a", kind: "spell", researcher: "A.hero", status: "open", costs: { research: 1000 }, dueDays: 3, posted: [{ day: 3, pace: "dedicated" }] }] });
  loc.update = async (patch) => {
    loc.updates = (loc.updates ?? []).concat([patch]);
    for (const [path, value] of Object.entries(patch)) loc.flags["acks-extras"].magic = { ...(loc.flags["acks-extras"].magic ?? {}), [path.split(".").pop()]: value };
  };
  for (const a of [hero, loc]) state.actors.set(a.uuid, a);
  state.isGM = true;
  state.canModify = true;
  state.worldTime = 8 * 86400;
  assert.equal(await L.creditPassedDays(), 0, "nothing imported: the day is not credited");
  assert.equal(loc.updates, undefined, "and nothing is written for it");
  const held = L.recordOf(loc).projects[0];
  assert.deepEqual([held.posted, held.credited], [[{ day: 3, pace: "dedicated" }], []], "the day stays posted, as posted");
  const waiting = L.researchApi.progress(loc, "a");
  assert.deepEqual([waiting.waiting, waiting.unread, waiting.creditedDays, waiting.complete], [1, 1, 0, false], "the Judge's day is not met by a day held for a rate");
  registerTable(
    {
      id: "magicResearch",
      source: { pages: "Invented 1-9" },
      cites: { researchLadder: "Invented p. 2" },
      tables: { researchLadder: { a: { label: "5", rate: "90gp", throw: "11+", marked: false } } },
    },
    { priority: PRIORITY.WORLD, source: "test" }
  );
  assert.equal(await L.creditPassedDays(), 1, "the rate is read: a later sweep credits the held day");
  const done = L.recordOf(loc).projects[0];
  assert.deepEqual([done.posted, done.credited], [[], [{ day: 3, amount: 90, by: "A.hero" }]]);
  assert.equal(await L.creditPassedDays(), 0);
  assert.equal(loc.updates.length, 1, "one write in all");
  resetTables();
  state.actors.clear();
  state.worldTime = 4 * 86400;
});

await ta("a refusal and every warning are told to the user, and a level is read whole from zero up", async () => {
  state.warned = [];
  L.announce({ ok: false, reason: "day" });
  L.announce({ ok: true, warn: "facility", warns: ["facility", "assistantLevel"] });
  L.announce({ ok: true, warn: "assistantCount" });
  L.announce({ ok: true });
  L.announce(undefined);
  assert.deepEqual(state.warned.map((m) => m.replace("ACKS-MAGIC.research.", "")), ["refused.day", "warn.facility", "warn.assistantLevel", "warn.assistantCount"]);
  state.actors.clear();
  for (const [uuid, level] of [["A.zero", 0], ["A.two", "2.9"], ["A.neg", -1], ["A.none", undefined]]) state.actors.set(uuid, actor(uuid, "character", { system: { details: { level }, scores: { int: { mod: uuid === "A.two" ? 2 : "x" } } } }));
  assert.deepEqual(["A.zero", "A.two", "A.neg", "A.none", "A.gone"].map(L.levelOf), [0, 2, null, null, null]);
  assert.deepEqual(["A.two", "A.zero", "A.gone"].map(L.intBonusOf), [2, 0, 0]);
});

await ta("registering the projects watches the clock for forward steps and the first ready, once", async () => {
  const seen = [];
  const saved = globalThis.Hooks;
  globalThis.Hooks = { on: (name) => seen.push(`on:${name}`), once: (name) => seen.push(`once:${name}`) };
  try {
    L.registerProjects();
    L.registerProjects();
  } finally {
    globalThis.Hooks = saved;
  }
  assert.deepEqual(seen, ["on:updateWorldTime", "once:ready"], "each registered once, however often it is asked");
});

/* ----------------------------- finishing a project (ruling 223) ----------------------------- */

const { makeEntry, settlementPlan } = await import("../scripts/lib/bucket.mjs");
const { COMPONENT_FIT, COMPONENT_SETTLE, THROW_DIE } = M;

/** The invented tables with an automatic-failure band and a substitution penalty (neither is a printed figure). */
const FIN = { ...RATES, prose: { ...RATES.prose, autoFail: { min: 1, max: 2 }, penalty: -3, penaltyMinimum: -2 } };
const part = (uuid, o = {}) => makeEntry({ uuid, kind: "item", name: uuid, qty: 1, value: { gp: 40, source: "cost" }, fit: COMPONENT_FIT.matched, ...o });

/**
 * A location with one project ready to finish (spell, level 2, the hero researching, the research cost credited, a facility
 * with a surplus of two), over deps whose world half records what it is asked and in what order.
 */
function finRig({ project = {}, judge = true, owned = ["A.hero"], here = true, canWrite = here, tables = FIN, die = 15, bucket = [], formulas = [], subject = null, failing = [], relay, facilities = { library: 12000, workshop: 12000 } } = {}) {
  const calls = [];
  const recorded = [];
  const settlements = [];
  const cards = [];
  const loc = { uuid: "L.f", flag: { facilities, projects: [{ id: "f1", kind: "spell", level: 2, researcher: "A.hero", subject: { name: "Lantern" }, costs: { research: 90, component: 100 }, credited: [{ day: 1, amount: 90, by: "A.hero" }], status: "open", ...project }] } };
  const done = (name, ret) => async () => {
    calls.push(name);
    if (failing.includes(name)) throw new Error(`${name} failed`);
    return ret;
  };
  const deps = {
    read: (l) => l.flag,
    write: async (l, patch) => {
      calls.push("write");
      l.flag = { ...l.flag, ...patch };
    },
    canWrite: () => canWrite,
    canFinish: () => here,
    relay: relay ?? (async () => undefined),
    today: () => 10,
    isJudge: () => judge,
    owns: (u) => judge || owned.includes(u),
    linked: () => ["A.hero", "A.pell"],
    levelOf: (u) => LEVELS[u] ?? null,
    intBonusOf: () => 0,
    tables: () => tables,
    newId: () => "n1",
    outcome: {
      subject: async () => subject,
      entries: async () => bucket,
      formulas: async () => formulas,
      roll: async (formula) => {
        calls.push(`roll:${formula}`);
        return { die, roll: { total: die } };
      },
      deliver: done("deliver", { name: "Lantern", actor: "Hero" }),
      identify: done("identify", { name: "Lantern" }),
      addSpell: done("addSpell", { name: "Lantern", actor: "Hero" }),
      blank: done("blank", { uuid: "Item.blank", name: "Lantern" }),
      recordFormula: async (p, entry) => {
        calls.push("formula");
        if (failing.includes("formula")) throw new Error("formula failed");
        recorded.push(entry);
        return { name: "Lantern", actor: "Hero" };
      },
      settle: async (p, plan) => {
        calls.push("settle");
        if (failing.includes("settle")) throw new Error("settle failed");
        settlements.push(plan);
        return { spent: plan.filter((s) => s.action === "consume").length, marked: 0, power: [] };
      },
      card: async (c) => {
        calls.push("card");
        cards.push(c);
      },
    },
  };
  return { loc, ops: M.projectOps(deps), calls, recorded, settlements, cards, now: () => M.readRecord(loc.flag).projects[0] };
}

t("the components' policy offers matched and substitute, opens a row on the subject's name, and spends everything on every outcome", () => {
  const p = proj({ subject: { name: "Lantern of Dusk" }, costs: { component: 100 } });
  const policy = M.componentPolicy(p, { loc: (k) => k, cite: "Invented p. 9" });
  assert.deepEqual(policy.fit.options.map((o) => o.key), ["matched", "substitute"]);
  assert.equal(policy.fit.fallback, "substitute", "a row nothing names is a substitute until the seat says otherwise");
  assert.deepEqual(policy.due, { gp: 100, cite: "Invented p. 9" });
  assert.deepEqual(policy.fit.options[0].names, ["Lantern of Dusk"]);
  assert.deepEqual(M.componentPolicy(proj({}), {}).fit.options[0].names, [], "no subject name, nothing to match");
  assert.deepEqual(Object.values(COMPONENT_SETTLE), ["consume", "consume", "consume"]);
  const plan = settlementPlan([part("Item.a", { qty: 2 }), makeEntry({ uuid: "Actor.b", kind: "actor", name: "b" })], "failure", COMPONENT_SETTLE);
  assert.deepEqual(plan.map((s) => [s.uuid, s.action]), [["Item.a", "consume"], ["Actor.b", "mark"]], "an item is spent and a creature marked, never deleted");
});

t("the substituted share is the substitutes' value over the component cost, and unread when a figure is", () => {
  const matched = part("Item.m");
  const sub = part("Item.s", { fit: "substitute", value: { gp: 25, source: "cost" } });
  assert.deepEqual(M.substitutedShare([matched], 100), { share: 0, substituted: 0 });
  assert.deepEqual(M.substitutedShare([matched, sub], 100), { share: 0.25, substituted: 1 });
  assert.equal(M.substitutedShare([sub], 10).share, 1, "held to the whole");
  assert.equal(M.substitutedShare([sub], null).share, null, "no cost read, no share");
  assert.equal(M.substitutedShare([part("Item.n", { fit: "substitute", value: null })], 100).share, null, "a value not read is not none");
  assert.deepEqual(M.substitutedShare([part("Item.x", { fit: "substitute", reason: "barred" })], 100), { share: 0, substituted: 0 }, "a row that counts for nothing is no substitute");
});

t("the formulas a researcher holds are matched by cookbook id, else uuid, else name, and recorded once", () => {
  const entry = { kind: "spell", key: "lantern", name: "Lantern", uuid: "Item.a", cookbookId: "ck1", day: 3, project: "p" };
  assert.deepEqual(M.cleanFormulas([entry, { ...entry, uuid: "Item.z" }, { kind: "ritual", key: "x" }, { kind: "spell" }, null]), [{ ...entry }], "a repeat, a kind not recorded and an empty row are dropped");
  const ref = (s, c = "") => M.subjectRef(s, c);
  assert.equal(M.knowsFormula([entry], "spell", ref({ uuid: "Item.q", name: "Other" }, "ck1")), true, "the cookbook id decides when both have one");
  assert.equal(M.knowsFormula([entry], "spell", ref({ uuid: "Item.q", name: "Lantern" }, "ck2")), false, "and a different id is a different spell whatever the name");
  assert.equal(M.knowsFormula([{ ...entry, cookbookId: "" }], "spell", ref({ uuid: "Item.a", name: "Zzz" })), true, "else the uuid");
  assert.equal(M.knowsFormula([{ ...entry, cookbookId: "", uuid: "" }], "spell", ref({ name: " LANTERN! " })), true, "else the name, folded");
  assert.equal(M.knowsFormula([entry], "item", ref({ uuid: "Item.a", name: "Lantern" })), false, "a spell's formula is not an item's");
  assert.equal(M.withFormula([entry], { ...entry, project: "q" }).length, 1);
  assert.equal(M.withFormula([entry], { kind: "item", key: "lamp", name: "Lamp" }).length, 2);
});

t("the throw is the stored target else the ladder's, plus the facility bonus, less a substitute's penalty; the formula is applied only with no substitute", () => {
  const p = proj({ level: 2, costs: { component: 100 } });
  const verdicts = M.facilityVerdicts(p, { facilities: { library: 12000 }, projects: [p], tables: FIN });
  const base = M.throwPlan(p, { tables: FIN, levelOf: (u) => LEVELS[u], verdicts, entries: [], known: false });
  assert.deepEqual([base.target, base.by, base.bonus, base.bonusRead, base.penalty, base.modifier], [11, "ladder", 2, true, 0, 2]);
  const hand = M.throwPlan({ ...p, throw: { target: 8 } }, { tables: FIN, levelOf: (u) => LEVELS[u], verdicts, entries: [], known: false });
  assert.deepEqual([hand.target, hand.by], [8, "hand"], "a Judge's stored target outranks the ladder");
  const sub = [part("Item.s", { fit: "substitute", value: { gp: 50, source: "cost" } })];
  const pen = M.throwPlan(p, { tables: FIN, levelOf: (u) => LEVELS[u], verdicts, entries: sub, known: true });
  assert.deepEqual([pen.share, pen.penalty, pen.modifier, pen.formula], [0.5, -3, -1, { known: true, used: false }], "the invented per-level size over level two, pro-rated by half and rounded up, with the formula off");
  assert.equal(M.throwPlan(p, { tables: FIN, levelOf: (u) => LEVELS[u], verdicts, entries: [part("Item.m")], known: true }).formula.used, true, "a matched row leaves the formula on");
  const unreadPenalty = M.throwPlan(p, { tables: RATES, levelOf: (u) => LEVELS[u], verdicts, entries: sub, known: false });
  assert.deepEqual([unreadPenalty.penalty, unreadPenalty.modifier], [null, 2], "a penalty whose figures are not read adds nothing and says so");
  const none = M.throwPlan(p, { tables: NOTHING, levelOf: () => null, verdicts: [], entries: [], known: false });
  assert.deepEqual([none.target, none.by, none.bonusRead], [null, null, false], "no ladder, no target: nothing is made up");
});

t("a die in the imported automatic-failure band fails whatever it totals, and any other meets the target or not", () => {
  const plan = { target: 11, modifier: 2 };
  assert.deepEqual(M.throwResult(plan, FIN.prose, 9), { die: 9, total: 11, target: 11, auto: false, success: true, outcome: "success" }, "the total meets the target");
  assert.equal(M.throwResult(plan, FIN.prose, 8).success, false);
  const high = { target: 1, modifier: 30 };
  assert.deepEqual([M.throwResult(high, FIN.prose, 2).auto, M.throwResult(high, FIN.prose, 2).success], [true, false], "the band's top edge is a failure");
  assert.equal(M.throwResult(high, FIN.prose, 3).success, true, "one past the band is not");
  assert.equal(M.throwResult({ target: 1, modifier: 0 }, RATES.prose, 1).success, true, "the band unread is no band");
});

t("Finish is allowed once the cost is credited and a target is read, and says why not otherwise", () => {
  const p = proj({ level: 2 });
  const plan = { target: 11 };
  assert.deepEqual(M.finishState(p, { complete: true }, plan), { ok: true, why: "" });
  assert.equal(M.finishState(p, { complete: false }, plan).why, "credited");
  assert.equal(M.finishState(p, { complete: null }, plan).why, "credited", "unknown is not complete");
  assert.equal(M.finishState(p, { complete: true }, { target: null }).why, "throw");
  assert.equal(M.finishState(proj({ kind: "ritual" }), { complete: true }, plan).why, "ritual");
  assert.equal(M.finishState(proj({ kind: "identify" }), { complete: true }, plan).why, "subject", "an identification needs an item");
  assert.equal(M.finishState(proj({ kind: "identify" }), { complete: true }, plan, { subjectType: "item" }).ok, true);
  assert.equal(M.finishState(p, { complete: true }, plan, { subjectType: "item" }).why, "subject", "a spell project's subject is a spell");
  assert.equal(M.finishState(proj({ kind: "item" }), { complete: true }, plan, { subjectType: "spell" }).why, "subject", "and an item project's is not");
  assert.equal(M.finishState(p, { complete: true }, plan, { subjectType: "spell" }).ok, true);
});

await ta("a known spell succeeds: the die, the one write that closes the project with the outcome, the spell added, the formula, the bucket settled, the card", async () => {
  const f = finRig({ die: 9, subject: { type: "spell", cookbookId: "" }, bucket: [part("Item.a", { qty: 2 })] });
  const r = await f.ops.finish(f.loc, "f1");
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls, [`roll:${THROW_DIE}`, "write", "addSpell", "formula", "settle", "card"], "closed before anything is written, settled and posted whatever came");
  assert.deepEqual([r.outcome, r.die, r.total, r.target, r.modifier, r.auto], ["success", 9, 11, 11, 2, false], "the die and the facility's two against the ladder's throw");
  const p = f.now();
  assert.deepEqual([p.status, p.closed, p.outcome], ["closed", 10, { result: "success", die: 9, total: 11, target: 11, day: 10 }]);
  assert.deepEqual(f.recorded, [{ cookbookId: "", uuid: "", key: "lantern", day: 10 }], "the formula for the subject, by its name where nothing else names it");
  assert.deepEqual(f.settlements[0].map((s) => [s.uuid, s.qty, s.action]), [["Item.a", 2, "consume"]]);
  assert.deepEqual(r.written.map((w) => w.what), ["spell", "formula"]);
  assert.equal(f.cards[0].result.success, true);
  assert.equal(M.readRecord(f.loc.flag).projects.length, 1, "the project stays on the record");
});

await ta("a known item is delivered, an identification marks the item and records no formula, and each is a different writer", async () => {
  const item = finRig({ project: { kind: "item", subject: { uuid: "Item.known", name: "Lamp" } }, subject: { type: "item" }, die: 10 });
  assert.deepEqual((await item.ops.finish(item.loc, "f1")).written.map((w) => w.what), ["item", "formula"]);
  assert.deepEqual(item.calls.filter((c) => !c.startsWith("roll") && c !== "write"), ["deliver", "formula", "settle", "card"]);
  assert.equal(item.recorded[0].uuid, "Item.known", "the formula keeps the subject's own uuid");
  const id = finRig({ project: { kind: "identify", subject: { uuid: "Item.cursed", name: "Ring" }, costs: { research: 90 } }, subject: { type: "item" }, die: 12 });
  const r = await id.ops.finish(id.loc, "f1");
  assert.deepEqual(r.written.map((w) => w.what), ["identify"]);
  assert.deepEqual(id.recorded, [], "an identification is no formula");
  assert.equal(id.calls.includes("deliver") || id.calls.includes("addSpell") || id.calls.includes("blank"), false);
});

await ta("a subject no document answers to becomes a blank document for the Judge, and the formula keeps its uuid", async () => {
  const f = finRig({ die: 12, subject: null });
  const r = await f.ops.finish(f.loc, "f1");
  assert.deepEqual(f.calls.filter((c) => !c.startsWith("roll") && c !== "write"), ["blank", "formula", "settle", "card"]);
  assert.deepEqual(f.recorded, [{ cookbookId: "", uuid: "Item.blank", key: "lantern", day: 10 }]);
  assert.equal(r.written[0].uuid, "Item.blank");
  assert.equal(f.cards[0].made.uuid, "Item.blank");
  const item = finRig({ project: { kind: "item" }, die: 12, subject: null });
  await item.ops.finish(item.loc, "f1");
  assert.equal(item.calls.includes("blank"), true, "an item subject with no document is blank too");
});

await ta("a failure writes no result and records no formula, but closes the project and settles the bucket and posts the card", async () => {
  const f = finRig({ die: 3, subject: { type: "spell" }, bucket: [part("Item.a")] });
  const r = await f.ops.finish(f.loc, "f1");
  assert.deepEqual([r.ok, r.outcome, r.total, r.written], [true, "failure", 5, []]);
  assert.deepEqual(f.calls, [`roll:${THROW_DIE}`, "write", "settle", "card"]);
  assert.deepEqual(f.now().outcome.result, "failure");
  assert.deepEqual(f.settlements[0].map((s) => s.action), ["consume"], "components are spent on a failure as on a success");
  assert.equal(f.recorded.length, 0);
  const auto = finRig({ die: 2, project: { throw: { target: 1 } }, subject: { type: "spell" } });
  const a = await auto.ops.finish(auto.loc, "f1");
  assert.deepEqual([a.outcome, a.auto, a.total >= a.target], ["failure", true, true], "the band's die fails although the total meets a target of one");
  assert.equal(auto.calls.includes("addSpell"), false);
});

await ta("it refuses, before rolling or writing, a project not credited, with no target read, a ritual, or a subject that does not suit", async () => {
  const ask = async (o) => {
    const f = finRig(o);
    const r = await f.ops.finish(f.loc, "f1");
    return { r, calls: f.calls, status: f.now().status };
  };
  const reasons = [
    [{ project: { credited: [{ day: 1, amount: 50, by: "A.hero" }] } }, "notComplete"],
    [{ tables: { ...FIN, ladder: NOTHING.ladder } }, "throwUnread"],
    [{ tables: { ...FIN, facilities: NOTHING.facilities } }, "bonusUnread"],
    [{ project: { level: null } }, "bonusUnread"],
    [{ tables: { ...FIN, prose: { ...FIN.prose, penalty: null } }, bucket: [part("Item.s", { fit: "substitute" })] }, "penaltyUnread"],
    [{ bucket: [part("Item.s", { fit: "substitute", value: { gp: null, source: "" } })] }, "penaltyUnread"],
    [{ project: { kind: "ritual", level: 5 } }, "ritual"],
    [{ project: { kind: "identify" }, subject: null }, "subject"],
    [{ subject: { type: "item" } }, "subject"],
  ];
  for (const [o, reason] of reasons) {
    const { r, calls, status } = await ask({ subject: null, ...o });
    assert.deepEqual([r.ok, r.reason, calls, status], [false, reason, [], "open"], reason);
  }
  assert.equal((await ask({ subject: null })).r.ok, true, "the same project, ready, is not refused");
  const unreadPenalty = { ...FIN, prose: { ...FIN.prose, penalty: null } };
  assert.equal((await ask({ subject: null, tables: unreadPenalty, bucket: [part("Item.m")] })).r.ok, true, "a penalty's size left unread holds nothing while no substitute is in the bucket");
  assert.equal((await ask({ subject: null, tables: unreadPenalty })).r.ok, true, "nor with an empty bucket");
  const plain = M.throwPlan({ costs: { component: 100 }, level: 2, researcher: "A.hero" }, { tables: unreadPenalty, levelOf: () => 5, verdicts: [{ bonus: 2 }], entries: [part("Item.s", { fit: "substitute" })] });
  assert.deepEqual([plain.penaltyUnread, plain.bonusUnread, plain.penalty], [true, false, null], "the plan names an unread penalty and no unread bonus");
  const unread = M.throwPlan({ costs: { component: 100 }, level: 2, researcher: "A.hero" }, { tables: FIN, levelOf: () => 5, verdicts: [{ bonus: 2 }, { bonus: null }], entries: [] });
  assert.deepEqual([unread.bonusUnread, unread.bonusRead, unread.penaltyUnread, unread.modifier], [true, false, false, 2], "one facility's bonus unread is unread, and counts as nothing in the modifier for display only");
  assert.equal(M.finishState({ kind: "item" }, { complete: true }, unread).why, "bonus");
  assert.equal(M.finishState({ kind: "item" }, { complete: true }, plain).why, "penalty");
  const f = finRig();
  assert.equal((await f.ops.finish(f.loc, "nope")).reason, "noProject");
});

await ta("a facility below its minimum blocks a Player's Finish and only warns a Judge's", async () => {
  const low = { library: 100 };
  const player = finRig({ judge: false, facilities: low, subject: null });
  assert.deepEqual([(await player.ops.finish(player.loc, "f1")).reason, player.calls], ["facility", []]);
  const judge = finRig({ facilities: low, subject: null });
  const r = await judge.ops.finish(judge.loc, "f1");
  assert.deepEqual([r.ok, r.warn], [true, "facility"]);
});

await ta("a Player's Finish is held to what they own: a component or an item to identify they do not own is refused, unrolled", async () => {
  const mine = finRig({ judge: false, bucket: [part("Item.mine")], owned: ["A.hero", "Item.mine"], subject: null });
  assert.equal((await mine.ops.finish(mine.loc, "f1")).ok, true, "their own component is spent");
  const theirs = finRig({ judge: false, bucket: [part("Item.theirs")], subject: null });
  assert.deepEqual([(await theirs.ops.finish(theirs.loc, "f1")).reason, theirs.calls], ["bucketOwner", []]);
  const power = finRig({ judge: false, bucket: [makeEntry({ uuid: "power:divine", kind: "power", name: "Power", qty: 1 })], subject: null });
  assert.equal((await power.ops.finish(power.loc, "f1")).ok, true, "a power row is the researcher's own ledger's");
  const id = finRig({ judge: false, project: { kind: "identify", subject: { uuid: "Item.world", name: "Ring" } }, subject: { type: "item" } });
  assert.deepEqual([(await id.ops.finish(id.loc, "f1")).reason, id.calls], ["subjectOwner", []]);
  const other = finRig({ judge: false, project: { researcher: "A.pell" }, subject: null });
  assert.equal((await other.ops.finish(other.loc, "f1")).reason, "owner", "and a project of a character they do not own is not theirs to finish");
});

await ta("a seat that may not write everything asks the GM's client with the id alone, and no GM answering is not written", async () => {
  const asked = [];
  const remote = finRig({ here: false, relay: async (req) => (asked.push(req), { ok: true, outcome: "success" }) });
  assert.deepEqual(await remote.ops.finish(remote.loc, "f1"), { ok: true, outcome: "success" });
  assert.deepEqual(asked, [{ locationUuid: "L.f", op: "finish", args: { id: "f1" } }]);
  assert.deepEqual(remote.calls, [], "nothing is rolled or written on the seat that asked");
  const none = finRig({ here: false });
  assert.deepEqual(await none.ops.finish(none.loc, "f1"), { ok: false, reason: "noGm" });
  const partial = finRig({ here: false, canWrite: true, relay: async () => ({ ok: true, outcome: "failure" }) });
  assert.deepEqual(await partial.ops.finish(partial.loc, "f1"), { ok: true, outcome: "failure" }, "a seat that may write the place but not everything else a Finish touches asks the GM");
  assert.deepEqual(partial.calls, [], "and writes nothing itself");
});

await ta("a writer that throws is reported and stops nothing: the bucket is settled and the card posted", async () => {
  const f = finRig({ die: 9, subject: { type: "spell" }, failing: ["addSpell"], bucket: [part("Item.a")] });
  const r = await f.ops.finish(f.loc, "f1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed.map((x) => [x.what, x.error]), [["spell", "addSpell failed"]]);
  assert.deepEqual(f.calls.slice(-3), ["formula", "settle", "card"]);
  const s = finRig({ die: 9, subject: { type: "spell" }, failing: ["settle"] });
  const rs = await s.ops.finish(s.loc, "f1");
  assert.deepEqual([rs.failed.map((x) => x.what), s.calls.at(-1)], [["settle"], "card"]);
  assert.equal(s.now().status, "closed");
});

await ta("a second Finish finds the project closed and throws nothing", async () => {
  const f = finRig({ die: 9, subject: { type: "spell" } });
  await f.ops.finish(f.loc, "f1");
  f.calls.length = 0;
  assert.deepEqual([(await f.ops.finish(f.loc, "f1")).reason, f.calls], ["noProject", []]);
});

await ta("the next project for the same subject reads the recorded formula, and a substitute among its components turns it off", async () => {
  const known = [{ kind: "spell", key: "lantern", name: "Lantern", day: 1 }];
  const on = finRig({ die: 9, formulas: known, subject: null, bucket: [part("Item.m")] });
  const r = await on.ops.finish(on.loc, "f1");
  assert.deepEqual(r.formula, { known: true, used: true });
  const off = finRig({ die: 9, formulas: known, subject: null, bucket: [part("Item.s", { fit: "substitute", value: { gp: 50, source: "cost" } })] });
  const o = await off.ops.finish(off.loc, "f1");
  assert.deepEqual([o.formula, o.modifier], [{ known: true, used: false }, -1], "the formula is off and the pro-rated penalty is taken");
  const stranger = finRig({ die: 9, formulas: [{ kind: "spell", key: "other", name: "Other" }], subject: null });
  assert.equal((await stranger.ops.finish(stranger.loc, "f1")).formula.known, false);
  assert.equal(M.cleanProject({ ...on.now(), outcome: { result: "maybe" } }).outcome, null, "an outcome that is not read is none");
  assert.equal(M.cleanProject({ id: "x", kind: "spell", status: "open", outcome: { result: "success" } }).outcome, null, "and an open project holds none");
});

/* ---- the live half: the die, the permission to write everything, the flag on the researcher ---- */

await ta("the live outcome rolls the pinned die, records the formula under the module's flag, and a seat writes all or asks the GM", async () => {
  state.actors.clear();
  const made = [];
  globalThis.Roll = class {
    constructor(formula) {
      made.push(formula);
    }
    async evaluate() {
      this.total = 7;
      return this;
    }
  };
  const hero = actor("A.hero", "character", { flags: { "acks-extras": { magic: { formulas: [{ kind: "spell", key: "old", name: "Old" }] } } }, update: async function (patch) { this.patch = patch; } });
  state.actors.set("A.hero", hero);
  const live = L.liveDeps();
  const thrown = await live.outcome.roll(THROW_DIE);
  assert.equal(thrown.die, 7);
  assert.deepEqual(made, ["1d20"], "the formula the live seat throws is the die the suite pins");
  assert.deepEqual(L.formulasOf("A.hero").map((x) => x.key), ["old"]);
  const project = M.cleanProject({ id: "f1", kind: "spell", researcher: "A.hero", subject: { name: "New One" } });
  await live.outcome.recordFormula(project, { key: "newone", day: 4 });
  assert.deepEqual(Object.keys(hero.patch), ["flags.acks-extras.magic.formulas"]);
  assert.deepEqual(hero.patch["flags.acks-extras.magic.formulas"].map((x) => x.key), ["old", "newone"], "the new formula joins the old ones");
  assert.deepEqual([hero.patch["flags.acks-extras.magic.formulas"][1].project, hero.patch["flags.acks-extras.magic.formulas"][1].kind], ["f1", "spell"], "and names the project and the kind it came from");
  // Who may write what.
  state.isGM = false;
  const rec = { id: "f1", kind: "item", researcher: "A.hero", subject: { uuid: "Item.sub", name: "Lamp" }, bucket: [{ uuid: "Item.c1", qty: 1 }, { uuid: "power:divine", qty: 1 }] };
  const loc = place("Actor.Lf", [], { projects: [rec] });
  const doc = (uuid, may) => ({ uuid, documentName: "Item", type: "item", canUserModify: () => may });
  state.actors.set("Item.sub", doc("Item.sub", false));
  state.actors.set("Item.c1", doc("Item.c1", true));
  hero.canUserModify = () => true;
  state.canModify = true;
  assert.equal(L.liveDeps().canFinish(loc, "f1"), true, "a seat Foundry lets write the place, the researcher and every component writes the finish itself");
  state.actors.set("Item.c1", doc("Item.c1", false));
  assert.equal(L.liveDeps().canFinish(loc, "f1"), false, "one component it may not spend, and the GM's client is asked");
  state.actors.set("Item.c1", doc("Item.c1", true));
  state.actors.delete("Item.sub");
  assert.equal(L.liveDeps().canFinish(loc, "f1"), false, "a subject no document answers to is made on a Judge's client");
  assert.equal(L.liveDeps().canFinish(loc, "none"), false);
  state.isGM = true;
  assert.equal(L.liveDeps().canFinish(loc, "f1"), true, "a Judge writes it all");
  assert.equal(L.researchApi.THROW_DIE, "1d20");
  assert.equal(typeof L.researchApi.finish, "function");
  delete globalThis.Roll;
  state.actors.clear();
});

await ta("the live writers: a held spell is not added twice, an identification marks full and lifts the mask, a blank document fills from the project and opens for a Judge only, and the card carries the roll", async () => {
  state.actors.clear();
  state.isGM = true;
  const hooks = [];
  const was = globalThis.Hooks;
  globalThis.Hooks = { ...was, callAll: (...a) => hooks.push(a) };
  const created = [];
  const opened = [];
  globalThis.Item = { create: async (data) => { created.push(data); return { uuid: "Item.blank", name: data.name, sheet: { render: (o) => opened.push(o) } }; } };
  const posted = [];
  globalThis.ChatMessage = { create: async (data) => { posted.push(data); return data; }, getSpeaker: ({ actor: a }) => ({ actor: a.uuid }) };
  globalThis.fromUuid = async (uuid) => state.actors.get(uuid) ?? null;
  const flagged = [];
  const spell = { uuid: "Item.sp", documentName: "Item", type: "spell", name: "Invented Glow", toObject: () => ({ _id: "x", name: "Invented Glow", type: "spell", system: { lvl: 2 } }) };
  const relic = { uuid: "Item.rel", documentName: "Item", type: "item", name: "Invented Relic", flags: {}, getFlag: () => ({ cursed: true }), setFlag: async (...a) => flagged.push(a) };
  const embedded = [];
  const hero = actor("A.hero", "character", { items: [], createEmbeddedDocuments: async (kind, rows) => { embedded.push(...rows); return rows.map((r, i) => ({ id: `n${i}` })); } });
  state.actors.set("A.hero", hero);
  state.actors.set("Item.sp", spell);
  state.actors.set("Item.rel", relic);
  const out = L.liveDeps().outcome;
  const project = (extra) => M.cleanProject({ id: "w1", kind: "spell", researcher: "A.hero", subject: { uuid: "Item.sp", name: "Invented Glow" }, ...extra });
  const first = await out.addSpell(project());
  assert.deepEqual([first.held, embedded.length, embedded[0]._id], [undefined, 1, undefined], "an uncarried spell is added, minus its id");
  hero.items = [{ type: "spell", name: "invented  GLOW" }];
  const held = await out.addSpell(project());
  assert.deepEqual([held.held, embedded.length], [true, 1], "one the researcher carries is reported held and nothing is added");
  await out.identify(project({ kind: "identify", subject: { uuid: "Item.rel", name: "Invented Relic" } }));
  assert.equal(flagged[0][2].identified, "full", "an identification marks the item fully identified");
  assert.equal(flagged[0][2].curseKnown, true, "and a full one lets the curse be known (lib's mark)");
  assert.deepEqual([hooks[0]?.[1]?.method, hooks[0]?.[1]?.depth, hooks[0]?.[1]?.item === relic], ["research", "full", true], "the markets' identified hook is called so its mask lifts");
  const blank = await out.blank(project({ subject: { name: "Invented Thing", img: "icons/x.svg" }, level: 3 }));
  assert.deepEqual(created[0], { name: "Invented Thing", type: "spell", img: "icons/x.svg", system: { lvl: 3 } }, "a spell's blank carries the name, picture and level");
  await out.blank(project({ kind: "item", subject: { name: "Invented Gear" } }));
  assert.deepEqual([created[1].type, created[1].system, created[1].img], ["item", undefined, undefined], "an item's blank is an item with no level and no picture");
  assert.deepEqual([blank.uuid, opened.length], ["Item.blank", 2], "a Judge's client opens each blank document's sheet");
  state.isGM = false;
  await out.blank(project({ kind: "item", subject: { name: "Invented Gear" } }));
  assert.equal(opened.length, 2, "a seat that is not a Judge's opens nothing");
  state.isGM = true;
  const plan = M.throwPlan(project({ costs: { component: 10 } }), { tables: FIN, levelOf: () => 5, verdicts: [], entries: [], known: false });
  const result = M.throwResult(plan, FIN.prose, 14);
  await out.card({ project: project(), plan, result, rolled: { die: 14, roll: { total: 14 } }, written: [{ what: "spell", name: "Invented Glow", actor: "hero" }], failed: [], settled: { spent: 0, marked: 0, power: [] }, made: null });
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].rolls, [{ total: 14 }], "the card carries the dice that were thrown");
  assert.match(posted[0].content, /is-success/, "a success is marked as one");
  assert.match(posted[0].content, /throwTip(?!Hand)/, "the target says it came from the ladder");
  const lost = M.throwResult(plan, FIN.prose, 1);
  await out.card({ project: project(), plan, result: lost, rolled: { die: 1, roll: { total: 1 } }, written: [], failed: [], settled: null, made: null });
  assert.match(posted[1].content, /is-failure/, "a failure is marked as one");
  // A seat that may write the place and the researcher but not the identified item asks the GM.
  state.isGM = false;
  hero.canUserModify = () => true;
  const rec = { id: "w1", kind: "identify", researcher: "A.hero", subject: { uuid: "Item.rel", name: "Invented Relic" }, bucket: [] };
  const loc = place("Actor.Lw", [], { projects: [rec] });
  loc.canUserModify = () => true;
  relic.canUserModify = () => false;
  assert.equal(L.liveDeps().canFinish(loc, "w1"), false, "an item to identify the seat may not modify is the GM's to write");
  relic.canUserModify = () => true;
  assert.equal(L.liveDeps().canFinish(loc, "w1"), true);
  loc.canUserModify = () => false;
  assert.equal(L.liveDeps().canFinish(loc, "w1"), false, "a place the seat may not write is the GM's too");
  state.isGM = true;
  globalThis.Hooks = was;
  delete globalThis.Item;
  delete globalThis.ChatMessage;
  delete globalThis.fromUuid;
  state.actors.clear();
});

t("the panel draws Finish live only where the viewer may act and the project allows it, names the throw's parts, and shows the formula and the fits", () => {
  const credited = { id: "a", kind: "spell", level: 2, subject: { name: "Lantern" }, researcher: "A.hero", costs: { research: 90, component: 100 }, credited: [{ day: 1, amount: 90, by: "A.hero" }], bucket: [{ uuid: "Item.m", qty: 1, fit: "" }] };
  const base = { tables: FIN, levelOf: (u) => LEVELS[u] ?? null, owns: (u) => u === "A.hero" };
  const owner = panel({ facilities: { library: 12000 }, projects: [credited] }, base).projects[0];
  assert.deepEqual([owner.finish.live, owner.finish.why], [true, ""]);
  assert.match(owner.finish.tip, /finishTip/);
  assert.match(owner.throw.tip, /throwTip.*throwPartBonus\{"n":2\}/, "the throw's tooltip names where the target came from and the facility bonus");
  assert.equal(owner.formula, null, "no formula held, no chip");
  const stranger = panel({ projects: [{ ...credited, researcher: "A.pell" }] }, { ...base, owns: () => false }).projects[0];
  assert.deepEqual([stranger.finish.live, stranger.finish.why], [false, ""], "allowed, but not this viewer's to press");
  const waiting = panel({ projects: [{ ...credited, credited: [] }] }, base).projects[0];
  assert.deepEqual([waiting.finish.live, waiting.finish.why], [false, "finishWhy.credited"]);
  const ritual = panel({ projects: [{ ...credited, kind: "ritual", level: 5 }] }, base).projects[0];
  assert.equal(ritual.finish.why, "finishWhy.ritual");
  const unread = panel({ projects: [credited] }, { ...base, tables: { ...FIN, ladder: NOTHING.ladder } }).projects[0];
  assert.equal(unread.finish.why, "finishWhy.throw");
  const noBonus = panel({ projects: [credited] }, { ...base, tables: { ...FIN, facilities: { ...FIN.facilities, library: { ...FIN.facilities.library, minimum: null, minimums: null, cite: "Invented p. 7" } } } }).projects[0];
  assert.deepEqual([noBonus.finish.live, noBonus.finish.why], [false, "finishWhy.bonus"], "a facility's bonus not read holds Finish with the reason named");
  assert.match(noBonus.finish.tip, /throwPartBonusUnread.*Invented p\. 7/, "and the tooltip names the page of the facility passage");
  const noPenalty = panel({ projects: [credited] }, { ...base, tables: { ...FIN, prose: { ...FIN.prose, penalty: null } }, entries: { a: [part("Item.s", { fit: "substitute", value: { gp: 50, source: "cost" } })] } }).projects[0];
  assert.deepEqual([noPenalty.finish.live, noPenalty.finish.why], [false, "finishWhy.penalty"], "a substitute held with its penalty unread holds Finish");
  assert.match(noPenalty.finish.tip, /throwPartPenaltyUnread/);
  const matchedOnly = panel({ projects: [credited] }, { ...base, tables: { ...FIN, prose: { ...FIN.prose, penalty: null } }, entries: { a: [part("Item.m")] } }).projects[0];
  assert.equal(matchedOnly.finish.live, true, "the same penalty unread holds nothing with no substitute");
  const known = panel({ projects: [credited] }, { ...base, formulasOf: () => [{ kind: "spell", key: "lantern", name: "Lantern" }] }).projects[0];
  assert.deepEqual([known.formula.tone, known.formula.text], ["ok", "formulaKnown"]);
  assert.match(known.throw.tip, /throwPartFormula/);
  const subst = panel({ projects: [credited] }, { ...base, formulasOf: () => [{ kind: "spell", key: "lantern", name: "Lantern" }], entries: { a: [part("Item.s", { fit: "substitute", value: { gp: 50, source: "cost" } })] } }).projects[0];
  assert.equal(subst.formula.tone, "", "a substitute turns it off");
  assert.match(subst.throw.tip, /throwPartPenalty.*throwPartFormulaOff/);
  const rows = panel({ projects: [credited] }, { ...base, entries: { a: [part("Item.m")] } }).projects[0].bucket.rows;
  assert.deepEqual([rows[0].fit.label, rows[0].fit.changeable], ["fit.matched", true], "a component row carries its fit chip, which the seat may change");
  const html = render(panel({ facilities: { library: 12000 }, projects: [credited] }, base));
  assert.match(html, /data-action="finishResearchProject" data-research-control data-tooltip-text="finishTip/, "Finish carries the control mark where it is live");
  assert.doesNotMatch(html, /fa-scroll/, "no formula, no chip");
  const chip = render(panel({ projects: [credited] }, { ...base, formulasOf: () => [{ kind: "spell", key: "lantern", name: "Lantern" }] }));
  assert.match(chip, /fa-scroll[^>]*><\/i> formulaKnown/);
});

t("the posted list and the prompt's pills read the names the board draws, and the radios keep their own lowercase words", () => {
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  const G = "ACKS-MAGIC.research.";
  assert.deepEqual(M.PACES.map((p) => lang[`${G}paceName.${p}`]), ["Dedicated", "Ancillary", "Both"]);
  assert.deepEqual(M.PACES.map((p) => lang[`${G}pace.${p}`]), ["dedicated", "ancillary", "both (overtime)"]);
  const tab = fs.readFileSync("scripts/magic/research-tab.mjs", "utf8");
  assert.match(tab, /loc\(`paceName\.\$\{value\}`\)/, "the prompt's pills");
  assert.doesNotMatch(tab, /loc\(`pace\.\$\{value\}`\)/);
});

t("the sheet wires Finish and the fit chip, and writes no result itself", () => {
  const tab = fs.readFileSync("scripts/magic/research-tab.mjs", "utf8");
  assert.match(tab, /finishResearchProject: onFinishProject/);
  assert.match(tab, /\[BUCKET_ACTIONS\.fit\]: onBucketFit/);
  assert.match(tab, /researchApi\.finish\(this\.actor, id\)/, "the press asks the API, which is the one place a Finish is made");
  assert.doesNotMatch(tab, /deliverDrop|markIdentified|createEmbeddedDocuments/, "no writer of the result is in the sheet's file");
});

console.log(`research-project: ${n} cases passed`);
