/**
 * Live walk, the organisation chart: docs/lib/TESTING.md "The organisation chart
 * through the API", steps 1 to 10 but for the player seat's standing row, and the
 * service tree beside it (docs/henchmen/MODEL.md "Who serves whom"). Every call is
 * a page-context call on `acksExtras.lib.org` and every observable is the stored
 * rows or the call's answer: a row added on each kind of host, `orgHostOf`, the
 * nested count and `covered`, the chieftain's morale part reaching a gang while he
 * is up and leaving at 0 hit points and on the dead status, send out and recall,
 * the empty row's made group, join, a twin, leave, the delete path, who a faction
 * affiliates, and `serviceNodes` against the Followers tab's cards.
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): `lib/org-faction`,
 * `lib/org-warband`, `lib/org-gang`, `lib/org-chief`, `lib/org-place`, and the
 * stacks' monster `lib/org-monster`; for the service tree `henchmen/service-employer`
 * (the henchmen walk's fixture too, so the containment of its roster is asserted and
 * its other hirelings are left alone), `henchmen/service-hench-a`,
 * `henchmen/service-hench-b`, `henchmen/service-unit` and `henchmen/service-officer`.
 * A step reads the shape it needs and the shape step writes it where it differs;
 * the walk writes it again at the end. Disposable, by the run's own ledger: the
 * made group, the delete path's two groups and its faction.
 * The one write outside the ledger is the service fixtures' own wiring, undone at the end.
 *
 * Not driven: step 10's standing row hidden from a player's reaction roll, which
 * wants a player seat and the influence dialog.
 */
import { connect } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const MORALE_PART = 3;

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => ({
    user: game.user.name,
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    api: !!(globalThis.acksExtras?.lib?.org && globalThis.acksExtras.lib.groups && game.modules.get("acks-extras")?.api?.henchmen?.serviceNodes),
  }),

  /** The chart fixtures at their shape: what they hold now is read first and returned, then written where it differs. */
  shape: async (a) => {
    const groups = acksExtras.lib.groups;
    const doc = (id) => game.actors.get(id);
    const [faction, warband, gang, chief, place, monster] = [a.factionId, a.warbandId, a.gangId, a.chiefId, a.placeId, a.monsterId].map(doc);
    const before = {
      units: [faction, warband, gang].map((d) => d.system.units.length),
      parents: [warband, gang].map((d) => d.system.unit.parentGroupUuid),
      officer: [warband.system.unit.officerUuid === chief.uuid, warband.system.unit.officerMoraleBonus, gang.system.unit.officerUuid, gang.system.unit.officerMoraleBonus, gang.system.unit.morale],
      roster: place.system.roster.length,
      hp: chief.system.hp.value,
      dead: chief.statuses.has("dead"),
    };
    await monster.update({ "system.hp": { hd: "1d4", value: 6, max: 6 } });
    if (before.dead) await chief.toggleStatusEffect("dead", { active: false });
    await chief.update({ "system.hp": { value: 8, max: 8 } });
    const rebuilt = [];
    for (const [g, n] of [[warband, 4], [gang, 3]]) {
      const [s, ...more] = g.system.toObject().stacks;
      if (s && !more.length && s.template.uuid === monster.uuid && s.size.current === n && s.size.initial === n && !s.roster.length) continue;
      await g.update({ "system.stacks": [] });
      await groups.addStack(g, monster, { count: n });
      rebuilt.push(g.name);
    }
    const unit = { "system.units": [], "system.unit.parentGroupUuid": "" };
    await warband.update({ ...unit, "system.unit.officerUuid": chief.uuid, "system.unit.officerMoraleBonus": a.part });
    await gang.update({ ...unit, "system.unit.officerUuid": "", "system.unit.officerMoraleBonus": null, "system.unit.morale": 0 });
    await faction.update({ "system.units": [], "system.members": [] });
    await place.update({ "system.roster": [] });
    return { before, rebuilt };
  },

  /** Both charts, the gang's parent and morale, the place's roster and the faction's headcount, as stored now. */
  read: async (a) => {
    const doc = (id) => game.actors.get(id);
    const units = (id) => doc(id).system.toObject().units;
    return {
      faction: units(a.factionId),
      warband: units(a.warbandId),
      gang: units(a.gangId),
      gangParent: doc(a.gangId).system.unit.parentGroupUuid,
      roster: doc(a.placeId).system.roster.map((r) => r.uuid),
      morale: doc(a.gangId).system.commandMorale,
      ownMorale: doc(a.gangId).system.unit.morale,
      headcount: doc(a.factionId).system.headcount,
    };
  },

  /** One call on `acksExtras.lib.org` over the documents named by id, its answer reduced to plain values. */
  call: async ({ fn, docs, args }) => {
    const found = docs.map((id) => game.actors.get(id));
    const r = await acksExtras.lib.org[fn](...found, ...args);
    const out = Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, v?.documentName ? { uuid: v.uuid, name: v.name } : v]));
    out.holder = found[0]?.system?.toObject?.().units?.find((u) => u.key === args[0])?.holderUuid ?? null;
    return out;
  },

  hostOf: async ({ uuid }) => {
    const found = acksExtras.lib.org.orgHostOf(uuid);
    return found ? { host: found.host.uuid, key: found.row.key } : null;
  },

  chart: async ({ hostId }) => {
    const chart = acksExtras.lib.org.orgChart(game.actors.get(hostId));
    return {
      total: chart.total,
      empty: chart.empty,
      rows: chart.rows.map((r) => ({ key: r.key, parentKey: r.parentKey, count: r.count, covered: r.covered, empty: r.empty, twin: r.twin, officer: r.officer?.name ?? null })),
    };
  },

  chartOf: async ({ id }) => {
    const c = acksExtras.lib.org.chartOf(game.actors.get(id));
    return c ? { host: c.host.uuid, key: c.row.key, above: c.above, below: c.below } : null;
  },

  /** Only this place's entry of the locations view: the world holds other places and names. */
  locations: async ({ placeUuid }) => {
    const entry = acksExtras.lib.org.locations({ isGM: true }).places.find((p) => p.uuid === placeUuid) ?? null;
    return entry && { total: entry.total, groups: entry.groups.map((g) => ({ uuid: g.uuid, count: g.count, covered: g.covered, rows: g.rows.map((r) => ({ key: r.key, inside: r.inside })) })) };
  },

  nest: async ({ id, parentUuid }) => (await acksExtras.lib.groups.setParentGroup(game.actors.get(id), parentUuid)).ok,

  write: async ({ id, path, value }) => {
    await game.actors.get(id).update({ [path]: value });
    return true;
  },

  /** The chieftain's state: hit points, or the dead status, settled before it answers. */
  chief: async ({ id, hp, dead }) => {
    const chief = game.actors.get(id);
    if (hp !== undefined) await chief.update({ "system.hp.value": hp });
    if (dead !== undefined) {
      await chief.toggleStatusEffect("dead", { active: dead });
      for (let n = 0; n < 40 && chief.statuses.has("dead") !== dead; n++) await new Promise((r) => setTimeout(r, 100));
    }
    return { hp: chief.system.hp.value, dead: chief.statuses.has("dead") };
  },

  remove: async ({ id }) => {
    await game.actors.get(id).delete();
    return !game.actors.has(id);
  },

  member: async ({ factionId, uuid }) => ({ is: game.actors.get(factionId).system.hasMember(uuid) }),

  /** The service fixtures wired: the hirelings on the employer's list (core's own add, a direct write where it did not land), the unit hired with its officer. */
  serviceShape: async (a) => {
    const doc = (id) => game.actors.get(id);
    const employer = doc(a.employerId);
    await employer.update({ "prototypeToken.actorLink": true });
    const how = [];
    for (const [id, category] of [[a.aId, "henchman"], [a.bId, "henchman"], [a.officerId, "specialist"]]) {
      await doc(id).update({ "prototypeToken.actorLink": true, "system.retainer": { enabled: true, managerid: employer.id, category, wage: "5", quantity: 1 } });
      if (!employer.system.henchmenList.includes(id)) await employer.addHenchman(id);
      if (!employer.system.henchmenList.includes(id)) {
        await employer.update({ "system.henchmenList": [...employer.system.henchmenList, id] });
        how.push(`direct ${id}`);
      }
    }
    await doc(a.unitId).update({ "system.unit.employerUuid": employer.uuid, "system.unit.officerUuid": doc(a.officerId).uuid, "system.unit.category": "mercenary" });
    return { how, list: a.ids.every((id) => employer.system.henchmenList.includes(id)) };
  },

  /** The service tree, and a fresh read of the sheet's Followers tab, with each fixture's data before and after the tree is read. */
  service: async (a) => {
    const doc = (id) => game.actors.get(id);
    const employer = doc(a.employerId);
    const mine = a.fixtureIds.map(doc);
    const before = mine.map((d) => JSON.stringify(d.toObject()));
    const nodes = game.modules.get("acks-extras").api.henchmen.serviceNodes(employer);
    const after = mine.map((d) => JSON.stringify(d.toObject()));
    const units = game.actors.filter((g) => g.type === "acks-extras.group" && g.system.unit.employerUuid === employer.uuid);
    const leaders = units.map((u) => u.system.unit.officerUuid).filter(Boolean);
    const Sheet = CONFIG.Actor.sheetClasses.character?.["acks-extras.AcksCharacterSheet"]?.cls;
    if (!Sheet) return { nodes, unchanged: before.every((b, i) => b === after[i]), sheet: null };
    const app = new Sheet({ document: employer });
    (globalThis.__org = globalThis.__org ?? { opened: [] }).opened.push(app);
    app.render(true);
    const root = () => (app.element?.nodeType === 1 ? app.element : app.element?.[0]);
    for (let n = 0; n < 60 && !root()?.querySelector(".acks-extras-frame__band"); n++) await new Promise((r) => setTimeout(r, 200));
    app.changeTab("followers", "primary");
    for (let n = 0; n < 60 && !root()?.querySelector(".acks-lib-follower-card[data-item-id]"); n++) await new Promise((r) => setTimeout(r, 200));
    return {
      nodes,
      unchanged: before.every((b, i) => b === after[i]),
      leaders,
      units: units.map((u) => u.uuid),
      cards: [...(root()?.querySelectorAll(".acks-lib-follower-card[data-item-id]") ?? [])].map((c) => c.dataset.itemId),
    };
  },

  closeAll: async () => {
    for (const app of globalThis.__org?.opened ?? []) { try { await app.close({ force: true }); } catch (_e) { /* closed */ } }
    if (globalThis.__org) globalThis.__org.opened = [];
    return true;
  },

  /** The wiring this walk wrote on the employer taken off again, and the unit unhired. */
  serviceRelease: async (a) => {
    const employer = game.actors.get(a.employerId);
    await employer.update({ "system.henchmenList": employer.system.henchmenList.filter((id) => !a.ids.includes(id)) });
    await game.actors.get(a.unitId).update({ "system.unit.employerUuid": "", "system.unit.officerUuid": "" });
    return employer.system.henchmenList.length;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

const open = {};
const swept = [];
let shapeArgs = null;
let serviceArgs = null;

try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf });
  if (!census.api) blocked("acksExtras.lib.org or the henchmen api is not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);

  section("fixtures");
  const named = (what) => `QA Org ${what}${TAG}`;
  const monster = await gm.fixture("lib/org-monster", "Actor", { name: named("beast"), type: "monster", items: [] });
  const faction = await gm.fixture("lib/org-faction", "Actor", { name: named("village"), type: "acks-extras.faction", items: [] });
  const warband = await gm.fixture("lib/org-warband", "Actor", { name: named("warband"), type: "acks-extras.group", items: [] });
  const gang = await gm.fixture("lib/org-gang", "Actor", { name: named("gang"), type: "acks-extras.group", items: [] });
  const chief = await gm.fixture("lib/org-chief", "Actor", { name: named("chief"), type: "character", items: [], system: { hp: { value: 8, max: 8 } } });
  const place = await gm.fixture("lib/org-place", "Actor", { name: named("place"), type: "acks-extras.location", items: [] });
  shapeArgs = { factionId: faction.id, warbandId: warband.id, gangId: gang.id, chiefId: chief.id, placeId: place.id, monsterId: monster.id, part: MORALE_PART };
  const shaped = await run(gm, P.shape, shapeArgs);
  note("found at", shaped.before);
  let s = await run(gm, P.read, shapeArgs);
  check("the kept fixtures stand at their shape: no row anywhere, the gang inside none, an empty roster, the chieftain up", !s.faction.length && !s.warband.length && !s.gang.length && s.gangParent === "" && !s.roster.length && s.morale === s.ownMorale, s);
  const org = (fn, docs, ...args) => run(gm, P.call, { fn, docs, args });
  const hostOf = (uuid) => run(gm, P.hostOf, { uuid });

  section("1. a row on each kind of host");
  const top = await org("addRow", [faction.id], "", { label: "Village row" });
  const band = await org("addRow", [faction.id], top.key, { label: "Band row" });
  const lone = await org("addRow", [warband.id], "", { label: "Gang row" });
  check("each answers ok with a key", [top, band, lone].every((r) => r.ok && r.key), [top.ok, band.ok, lone.ok]);
  s = await run(gm, P.read, shapeArgs);
  check("the faction holds two rows, the second under the first, the warband one, every holder blank", s.faction.length === 2 && s.faction[1].parentKey === top.key && s.warband.length === 1 && [...s.faction, ...s.warband].every((r) => !r.holderUuid), s);
  const nope = await org("addRow", [faction.id], "nope");
  check("a parent naming no row answers noRow and writes nothing", nope.ok === false && nope.reason === "noRow" && (await run(gm, P.read, shapeArgs)).faction.length === 2, nope);

  section("2. fill the rows, find a holder");
  await org("setHolder", [faction.id], top.key, warband.uuid);
  await org("setHolder", [faction.id], band.key, gang.uuid);
  await org("setHolder", [warband.id], lone.key, chief.uuid);
  const found = { gang: await hostOf(gang.uuid), warband: await hostOf(warband.uuid), chief: await hostOf(chief.uuid), faction: await hostOf(faction.uuid) };
  check("the gang is found on the faction's band row", found.gang?.host === faction.uuid && found.gang.key === band.key, found.gang);
  check("the warband is found on the top row", found.warband?.host === faction.uuid && found.warband.key === top.key, found.warband);
  check("the chief is found on the warband's lone row", found.chief?.host === warband.uuid && found.chief.key === lone.key, found.chief);
  check("the faction is on no row", found.faction === null, found.faction);

  section("3. nest and count");
  const nested = await run(gm, P.nest, { id: gang.id, parentUuid: warband.uuid });
  let chart = await run(gm, P.chart, { hostId: faction.id });
  const rowOf = (key) => chart.rows.find((r) => r.key === key);
  check("the top row counts 7, the band row 3 and covered, the total 7, the chief its officer, none empty", nested && rowOf(top.key)?.count === 7 && rowOf(band.key)?.count === 3 && rowOf(band.key).covered === true && chart.total === 7 && rowOf(top.key).officer === chief.name && chart.empty === 0, chart);

  section("4. the chieftain's morale part reaches the gang");
  const unitsBefore = (await run(gm, P.read, shapeArgs)).faction;
  const morale = {};
  morale.up = (await run(gm, P.read, shapeArgs)).morale;
  const own = (await run(gm, P.read, shapeArgs)).ownMorale;
  check("up, the gang's morale is its own plus the warband's part", morale.up === own + MORALE_PART, { own, morale: morale.up });
  await run(gm, P.chief, { id: chief.id, hp: 0 });
  morale.down = (await run(gm, P.read, shapeArgs)).morale;
  await run(gm, P.chief, { id: chief.id, hp: 8 });
  morale.back = (await run(gm, P.read, shapeArgs)).morale;
  check("at 0 hit points the part is gone, and back at 8", morale.down === own && morale.back === own + MORALE_PART, morale);
  await run(gm, P.chief, { id: chief.id, dead: true });
  morale.dead = (await run(gm, P.read, shapeArgs)).morale;
  await run(gm, P.chief, { id: chief.id, dead: false });
  morale.cleared = (await run(gm, P.read, shapeArgs)).morale;
  check("marked dead the part is gone, and back once the status is cleared", morale.dead === own && morale.cleared === own + MORALE_PART, morale);
  check("the faction's chart did not change", same((await run(gm, P.read, shapeArgs)).faction, unitsBefore));

  section("5. send out");
  const before = await run(gm, P.read, shapeArgs);
  const sent = await org("sendOut", [faction.id], band.key, place.uuid);
  s = await run(gm, P.read, shapeArgs);
  chart = await run(gm, P.chart, { hostId: faction.id });
  const where = await run(gm, P.locations, { placeUuid: place.uuid });
  const outer = where?.groups.find((g) => g.uuid === gang.uuid);
  check("it answers ok, the place's roster holds the gang, and the gang's parent is blank", sent.ok === true && same(s.roster, [gang.uuid]) && s.gangParent === "", { sent: sent.ok, roster: s.roster.length, parent: s.gangParent });
  check("the faction's rows are as they were", same(s.faction, before.faction));
  check("the warband's row counts 4 and the gang's is no longer covered", chart.rows.find((r) => r.key === top.key)?.count === 4 && chart.rows.find((r) => r.key === band.key)?.covered === false, chart.rows.map((r) => [r.count, r.covered]));
  check("the locations view lists the place with the gang outermost, carrying the band row", !!outer && outer.covered === false && outer.rows.some((r) => r.key === band.key && r.inside === false), where);
  await org("sendOut", [faction.id], band.key, place.uuid);
  s = await run(gm, P.read, shapeArgs);
  check("a second press changes nothing", same(s.roster, [gang.uuid]) && s.gangParent === "" && same(s.faction, before.faction), { roster: s.roster.length });

  section("6. recall");
  const recalled = await org("recall", [faction.id], band.key);
  s = await run(gm, P.read, shapeArgs);
  check("the gang is back inside the warband and the roster is empty", recalled.ok === true && s.gangParent === warband.uuid && !s.roster.length, { ok: recalled.ok, roster: s.roster.length });
  const unitsNow = s.faction;
  const topRow = await org("recall", [faction.id], top.key);
  check("a top row answers topRow and writes nothing", topRow.ok === false && topRow.reason === "topRow" && same((await run(gm, P.read, shapeArgs)).faction, unitsNow), topRow);

  section("7. an empty row's press makes its group");
  const open1 = await org("addRow", [faction.id], top.key, { label: "Open band" });
  const made = await org("sendOut", [faction.id], open1.key, place.uuid);
  const madeUuid = made.group?.uuid ?? made.holder;
  if (madeUuid) swept.push(gm.track(madeUuid, "Actor"));
  s = await run(gm, P.read, shapeArgs);
  check("it answers ok and made, the group is named for the row and the row names it, and the place holds it", made.ok === true && made.made === true && made.group?.name === "Open band" && made.holder === made.group.uuid && s.roster.includes(made.group.uuid), { ok: made.ok, made: made.made, name: made.group?.name });
  const again = await org("sendOut", [faction.id], open1.key, place.uuid);
  check("a second press makes nothing", again.ok === true && again.made === false, again);

  section("8. join, a twin and leave");
  const joined = await org("join", [warband.id, faction.id], top.key);
  s = await run(gm, P.read, shapeArgs);
  const loneOn = s.faction.filter((r) => r.key === lone.key);
  const below = await run(gm, P.chartOf, { id: warband.id });
  check("it moves the lone row, the faction holds it once under the top row, the warband holds none", joined.ok === true && same(joined.moved, [lone.key]) && loneOn.length === 1 && loneOn[0].parentKey === top.key && !s.warband.length, { moved: joined.moved, on: loneOn.length, warband: s.warband.length });
  check("the warband's chart lists the faction's rows beneath its own, and the chief is hosted by the faction", below?.host === faction.uuid && [lone.key, band.key].every((k) => below.below.includes(k)) && (await hostOf(chief.uuid))?.host === faction.uuid, below);
  await run(gm, P.write, { id: warband.id, path: "system.units", value: [loneOn[0]] });
  chart = await run(gm, P.chart, { hostId: faction.id });
  check("the row written back on the warband reads twin, and the faction still hosts the chief", chart.rows.find((r) => r.key === lone.key)?.twin === true && (await hostOf(chief.uuid))?.host === faction.uuid, chart.rows.find((r) => r.key === lone.key));
  const rejoined = await org("join", [warband.id, faction.id], top.key);
  s = await run(gm, P.read, shapeArgs);
  check("a second press moves none, writes no row twice and clears the warband", rejoined.ok === true && same(rejoined.moved, []) && s.faction.filter((r) => r.key === lone.key).length === 1 && !s.warband.length, { moved: rejoined.moved, warband: s.warband.length });
  const left = await org("leave", [faction.id], band.key);
  s = await run(gm, P.read, shapeArgs);
  check("leave puts the band row at the top of the gang's own chart and takes it off the faction", left.ok === true && s.gang.some((r) => r.key === band.key && r.parentKey === "") && !s.faction.some((r) => r.key === band.key) && (await hostOf(gang.uuid))?.host === gang.uuid, { ok: left.ok, gang: s.gang.length });
  const back = await org("join", [gang.id, faction.id], top.key);
  s = await run(gm, P.read, shapeArgs);
  check("joined again, the band row stands under the top row and the gang holds none", back.ok === true && s.faction.some((r) => r.key === band.key && r.parentKey === top.key) && !s.gang.length, { ok: back.ok });
  const lonely = await org("leave", [faction.id], lone.key);
  check("leave of the chief's lone row answers holderNotGroup", lonely.ok === false && lonely.reason === "holderNotGroup", lonely);

  section("9. the delete path");
  const g1 = await gm.create("Actor", { name: named("doomed group"), type: "acks-extras.group", items: [] });
  const g2 = await gm.create("Actor", { name: named("second group"), type: "acks-extras.group", items: [] });
  const f1 = await gm.create("Actor", { name: named("doomed village"), type: "acks-extras.faction", items: [] });
  swept.push(g1.uuid, g2.uuid, f1.uuid);
  const r1 = await org("addRow", [f1.id], "", { label: "One" });
  const r2 = await org("addRow", [f1.id], "", { label: "Two" });
  await org("setHolder", [f1.id], r1.key, g1.uuid);
  await org("setHolder", [f1.id], r2.key, g2.uuid);
  check("both disposables are found on the disposable faction", (await hostOf(g1.uuid))?.host === f1.uuid && (await hostOf(g2.uuid))?.host === f1.uuid);
  await run(gm, P.remove, { id: g1.id });
  chart = await run(gm, P.chart, { hostId: f1.id });
  check("a deleted holder answers null at once and its row reads empty", (await hostOf(g1.uuid)) === null && chart.rows.find((r) => r.key === r1.key)?.empty === true, chart.rows.map((r) => r.empty));
  await run(gm, P.remove, { id: f1.id });
  check("a deleted host answers null for the group it named", (await hostOf(g2.uuid)) === null);

  section("10. who belongs");
  s = await run(gm, P.read, shapeArgs);
  const member = await run(gm, P.member, { factionId: faction.id, uuid: gang.uuid });
  check("the gang is a member through its row", member.is === true);
  check("the headcount is 8: the warband's 7 once, the gang inside it not again, 1 for the chief, none for the made group", s.headcount === 8, s.headcount);

  section("11. the service tree");
  const hire = async (what, data) => gm.fixture(`henchmen/service-${what}`, "Actor", { items: [], ...data });
  const employer = await hire("employer", { name: "QA Service employer", type: "character", system: { scores: { cha: { value: 13 } }, details: { level: 4 } } });
  const hA = await hire("hench-a", { name: named("henchman A"), type: "character" });
  const hB = await hire("hench-b", { name: named("henchman B"), type: "character" });
  const officer = await hire("officer", { name: named("officer"), type: "character" });
  const unit = await hire("unit", { name: named("hired unit"), type: "acks-extras.group" });
  serviceArgs = { employerId: employer.id, aId: hA.id, bId: hB.id, officerId: officer.id, unitId: unit.id, ids: [hA.id, hB.id, officer.id], fixtureIds: [employer.id, hA.id, hB.id, officer.id, unit.id] };
  note("wired", await run(gm, P.serviceShape, serviceArgs));
  const tree = await run(gm, P.service, serviceArgs);
  check("the character sheet class answers and its Followers tab drew cards", !!tree.cards?.length, tree.cards?.length ?? null);
  const nodes = tree.nodes;
  const keys = nodes.map((n) => n.key);
  const under = nodes.filter((n) => n.parentKey === employer.uuid);
  check("the root is the employer", nodes[0]?.key === employer.uuid && nodes[0].parentKey === "", nodes[0]);
  check("both henchmen and the unit stand under the employer", [hA.uuid, hB.uuid, unit.uuid].every((u) => under.some((n) => n.key === u)), under.map((n) => n.kind));
  check("the officer has no node, though the roster lists it", !keys.includes(officer.uuid) && !nodes.some((n) => n.holderUuid === officer.uuid), keys.length);
  check("no key stands twice", new Set(keys).size === keys.length, keys.length);
  check("reading the tree writes nothing to any of the five fixtures", tree.unchanged === true);
  if (!tree.cards) throw new Error("the Followers tab could not be read");
  const actorOf = (uuid) => uuid.split(".").pop();
  const hirelings = under.filter((n) => !tree.units.includes(n.key)).map((n) => actorOf(n.key));
  const cards = tree.cards.filter((id) => !tree.leaders.map(actorOf).includes(id));
  check("the Followers tab draws a card for each hireling, the officer's among them, and none for the unit", [hA.id, hB.id, officer.id].every((id) => tree.cards.includes(id)) && !tree.cards.includes(unit.id), tree.cards.length);
  check("the cards but a unit's officer are the employer's non-unit nodes, in order", same(cards, hirelings), { cards: cards.length, nodes: hirelings.length });

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  try { if (gm) await run(gm, P.closeAll); } catch (err) { console.error("close:", err?.message ?? err); }
  try { if (gm && swept.length) note("swept", await gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm && shapeArgs) note("shape at the end", (await run(gm, P.shape, shapeArgs)).rebuilt); } catch (err) { console.error("shape:", err?.message ?? err); }
  try { if (gm && serviceArgs) note("unwired, the employer's list now holds", await run(gm, P.serviceRelease, serviceArgs)); } catch (err) { console.error("unwire:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
