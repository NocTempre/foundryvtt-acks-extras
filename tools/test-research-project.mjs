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
globalThis.ui = { notifications: { warn: (m) => (state.warned ??= []).push(m) } };
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
  ladder: { present: true, rungs: [{ level: 4, rate: 30, throw: 15 }, { level: 5, rate: 90, throw: 11 }], otherProjectsRate: null, cite: "Invented p. 2", byHand: false },
  facilities: {
    library: facility({ minimum: 3000, step: 1500, bonus: { step: 7000, size: 2, cap: 5 } }),
    workshop: facility({ minimum: 3500, step: 1700, bonus: { step: 6000, size: 1, cap: 4 } }),
    identify: facility({ bonus: { step: 8000, size: 1, cap: 2 } }),
    ritualLibrary: facility({ minimums: [{ level: 5, gp: 13000 }, { level: 6, gp: 14900 }], bonus: { step: 9000, size: 1, cap: 2 } }),
    ritualWorkshop: facility({ minimums: [{ level: 5, gp: 12000 }], bonus: { step: 5000, size: 2, cap: 6 } }),
  },
  identification: { present: true, research: 800 },
};
const NOTHING = { ladder: { present: false, rungs: [], otherProjectsRate: null, cite: null, byHand: false }, facilities: Object.fromEntries(Object.keys(TABLES.facilities).map((k) => [k, facility({ present: false, cite: null })])), identification: { present: false, research: null } };

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
function rig({ judge = true, canWrite = true, owned = ["A.hero"], linked = ["A.hero", "A.pell", "A.lena"], tables = TABLES, relay } = {}) {
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
  assert.equal(done.finish.why, "finishWhy.outcome");
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
  assert.match(player, /<button type="button" class="acks-btn acks-btn--roll" disabled>/, "Finish is drawn disabled");
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
  assert.doesNotMatch(sheet, /VIEWER_CONTROLS = [^\n]*\[data-tab="research"\] (:is\()?button/, "Finish stays disabled: the lock is not lifted on every button of the tab");
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
  const sources = ["scripts/magic/research-project.mjs", "scripts/magic/research-tab.mjs", "scripts/magic/research-project-live.mjs"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
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
  assert.ok(keys.size > 40);
  for (const k of keys) assert.ok(lang[`${GROUP}${k}`] !== undefined, `${GROUP}${k}`);
  for (const [k, v] of Object.entries(lang)) if (k.startsWith(GROUP) && !k.includes(".cite.")) assert.doesNotMatch(v, /\d/, `${k} carries a number: ${v}`);
});

console.log(`research-project: ${n} cases passed`);
