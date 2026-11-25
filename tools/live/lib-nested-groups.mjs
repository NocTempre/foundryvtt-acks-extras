/**
 * Live walk, a group inside a group: docs/lib/TESTING.md "A group inside a
 * group". The nested count read now, the roster rows of a place and a faction
 * (the outer's count holds the inner's bodies, the total counts them once), an
 * outer group token added to a combat (every nested body deployed with a
 * combatant of its own and none for a group), the early gather, the combat's
 * end recalling each body into its own group, an emptied inner that stays on
 * both rosters at none, a labelled stack that whispers the Judges and places
 * nothing while the others deploy, the cycle refusal, and a stack's printed
 * hit points surviving a body's first record.
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Group combat acts on the primary GM's window: the walk prints who the active
 * GM is, and a combat that places nothing names it in its FAIL.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the groups
 * `lib/nested-group-outer` and `lib/nested-group-inner`, and the stacks'
 * monster `lib/nested-group-monster`. A step asserts the shape it reads at its
 * start: each group holds one resting stack over that monster at 2 and 3 with no
 * record, the inner's parent is the outer, the outer's is blank. Disposable, by
 * the run's own ledger: the scene, the outer's token, the combats, the place,
 * the faction, the whisper, and the group of the printed-hit-points check.
 * The only write outside the ledger is the kept fixtures' own shape, rewritten at
 * the start and again at the end.
 *
 * Not driven: the combat tracker's HUD button (a combatant is created through
 * the combat, which is what the hook reads).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const GROUP = "acks-extras.group";
const LOCATION = "acks-extras.location";
const FACTION = "acks-extras.faction";
const LABEL = "Test creature";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
// A figure the monster's own 6 and its 1d4 cannot produce.
const FIXED = 9;

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => ({
    user: game.user.name,
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    api: !!(globalThis.acksExtras?.lib?.groups && globalThis.acksExtras?.lib?.places),
  }),

  /** The kept fixtures at their shape: stacks rebuilt where they differ, the nesting written, the monster's dice set. */
  shape: async ({ outerId, innerId, monsterId, hd }) => {
    const groups = acksExtras.lib.groups;
    const monster = game.actors.get(monsterId);
    await monster.update({ "system.hp": { hd, value: 6, max: 6 } });
    const outer = game.actors.get(outerId);
    const inner = game.actors.get(innerId);
    const rewrote = [];
    for (const [g, n] of [[outer, 2], [inner, 3]]) {
      const [s, ...more] = g.system.toObject().stacks;
      const right = s && !more.length && s.template.uuid === monster.uuid && s.template.snapshot?.system?.hp?.hd === hd && s.size.current === n && s.size.initial === n && !s.roster.length && !s.fixedHp;
      if (right) continue;
      await g.update({ "system.stacks": [] });
      await groups.addStack(g, monster, { count: n });
      rewrote.push(g.name);
    }
    const up = await groups.setParentGroup(inner, outer.uuid);
    const down = await groups.setParentGroup(outer, "");
    const flagged = (g) => game.scenes.reduce((n, sc) => n + sc.tokens.filter((t) => t.getFlag("acks-extras", "group") === g.uuid).length, 0);
    return {
      rewrote,
      links: [up.reason ?? "ok", down.reason ?? "ok"],
      innerParent: inner.system.unit.parentGroupUuid === outer.uuid,
      outerParent: outer.system.unit.parentGroupUuid,
      stacks: [outer.system.toObject().stacks.length, inner.system.toObject().stacks.length],
      strays: flagged(outer) + flagged(inner),
    };
  },

  counts: async ({ outerId, innerId }) => {
    const groups = acksExtras.lib.groups;
    const outer = game.actors.get(outerId);
    const inner = game.actors.get(innerId);
    return { outer: groups.bodyCount(outer), inner: groups.bodyCount(inner), tree: groups.groupTree(outer).map((g) => g.id) };
  },

  /** Both groups on the place's roster and the faction's members, written once so a later count proves the live read. */
  roster: async ({ placeId, factionId, outerId, innerId }) => {
    const places = acksExtras.lib.places;
    const place = game.actors.get(placeId);
    const faction = game.actors.get(factionId);
    const outer = game.actors.get(outerId);
    const inner = game.actors.get(innerId);
    const added = [await places.addOccupant(place, outer), await places.addOccupant(place, inner)];
    await faction.update({ "system.members": [places.occupantRow(outer), places.occupantRow(inner)] });
    return added;
  },

  /** The two rosters as the data reads them now. */
  rows: async ({ placeId, factionId, outerId, innerId }) => {
    const groups = acksExtras.lib.groups;
    const uuid = { outer: game.actors.get(outerId).uuid, inner: game.actors.get(innerId).uuid };
    const read = (doc, list) => {
      const live = groups.liveRows(list.map((r) => r.toObject?.() ?? r));
      const row = (k) => live.find((r) => r.uuid === uuid[k]);
      return { rows: live.length, outer: row("outer")?.quantity ?? null, inner: row("inner")?.quantity ?? null, covered: !!row("inner")?.covered, headcount: doc.system.headcount };
    };
    const place = game.actors.get(placeId);
    const faction = game.actors.get(factionId);
    return { place: read(place, place.system.roster), faction: read(faction, faction.system.members) };
  },

  openSheet: async ({ docId }) => {
    const H = (globalThis.__nest = globalThis.__nest ?? { opened: [] });
    const app = game.actors.get(docId).sheet;
    H.opened.push(app);
    await app.render(true);
    return true;
  },

  closeAll: async () => {
    const H = globalThis.__nest;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true }); } catch (_e) { /* closed */ } }
    if (H) H.opened = [];
    return true;
  },

  /** What a window's roster table prints for each group and what its header tallies. */
  sheetRead: async ({ docId, kind, uuids }) => {
    const root = ((app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]))(game.actors.get(docId).sheet);
    if (!root) return null;
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const find = (u) => root.querySelector(kind === "place" ? `tr[data-occupant-uuid="${u}"]` : `.acks-extras-faction-table tr[data-uuid="${u}"]`);
    const tag = [...root.querySelectorAll(".acks-tag")].find((t) => t.querySelector(".fa-users"));
    return { outer: find(uuids.outer) ? text(find(uuids.outer).children[3]) : null, inner: find(uuids.inner) ? text(find(uuids.inner).children[3]) : null, headcount: tag ? text(tag) : null };
  },

  setCount: async ({ groupId, count }) => {
    const g = game.actors.get(groupId);
    const stacks = g.system.toObject().stacks;
    stacks[0].size.current = count;
    await g.update({ "system.stacks": stacks });
    return g.system.totalCurrent;
  },

  addLabelled: async ({ groupId, label, count }) => acksExtras.lib.groups.addLabelledStack(game.actors.get(groupId), { label, count }),
  removeStack: async ({ groupId, key }) => acksExtras.lib.groups.removeStack(game.actors.get(groupId), key),
  setParent: async ({ groupId, parentUuid }) => {
    const g = game.actors.get(groupId);
    const result = await acksExtras.lib.groups.setParentGroup(g, parentUuid);
    return { ...result, parent: g.system.unit.parentGroupUuid };
  },

  token: async ({ sceneId, groupId, x, y }) => {
    const scene = game.scenes.get(sceneId);
    const td = await game.actors.get(groupId).getTokenDocument({ x, y }, { parent: scene });
    const [made] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    return { id: made.id, uuid: made.uuid };
  },

  combat: async ({ sceneId }) => {
    const combat = await Combat.create({ scene: sceneId, active: true });
    return { id: combat.id };
  },

  /** The token joins the combat: a combatant it already holds goes first, which is the toggle's off half. */
  join: async ({ combatId, sceneId, tokenId }) => {
    const combat = game.combats.get(combatId);
    const had = combat.combatants.filter((c) => c.tokenId === tokenId).map((c) => c.id);
    if (had.length) await combat.deleteEmbeddedDocuments("Combatant", had);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId: game.scenes.get(sceneId).tokens.get(tokenId).actorId }]);
    return had.length;
  },

  endCombat: async ({ combatId }) => {
    await game.combats.get(combatId)?.delete();
    return !game.combats.has(combatId);
  },

  /** The scene, the combat and each group's records as they stand. */
  fight: async ({ sceneId, combatId, tokenId, outerId, innerId }) => {
    const scene = game.scenes.get(sceneId);
    const combat = game.combats.get(combatId);
    const token = scene.tokens.get(tokenId);
    const mine = (g) => scene.tokens.filter((t) => t.getFlag("acks-extras", "group") === game.actors.get(g).uuid);
    const records = (g) => game.actors.get(g).system.toObject().stacks.flatMap((s) => s.roster.map((r) => ({ state: r.state, token: r.tokenUuid })));
    const outerBodies = mine(outerId);
    const bodyIds = new Set([...outerBodies, ...mine(innerId)].map((t) => t.id));
    return {
      outer: outerBodies.length,
      inner: mine(innerId).length,
      outerStacks: [...new Set(outerBodies.map((t) => t.getFlag("acks-extras", "stack")))],
      tokens: scene.tokens.size,
      combatants: combat ? combat.combatants.size : null,
      ofGroups: combat ? combat.combatants.filter((c) => c.actor?.type === "acks-extras.group").length : null,
      ofBodies: combat ? combat.combatants.filter((c) => bodyIds.has(c.tokenId)).length : null,
      hidden: token.hidden,
      flag: token.getFlag("acks-extras", "groupCombat") ?? null,
      records: { outer: records(outerId), inner: records(innerId) },
      current: [game.actors.get(outerId).system.stacks[0].size.current, game.actors.get(innerId).system.stacks[0].size.current],
    };
  },

  messageIds: async () => game.messages.map((m) => m.id),
  whispers: async ({ before, alias, label, name }) => {
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const said = game.i18n.format("ACKS-LIB.group.warn.noCreature", { name, label });
    const plain = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el.textContent; };
    return game.messages
      .filter((m) => !before.includes(m.id) && m.speaker?.alias === alias && plain(m.content).includes(label))
      .map((m) => ({ id: m.id, toGMs: m.whisper.length > 0 && m.whisper.every((u) => gms.includes(u)), says: plain(m.content).includes(said) }));
  },

  /** A stack's printed hit points on a body's first record, and on its token. */
  printed: async ({ groupId, monsterId, sceneId, figure }) => {
    const groups = acksExtras.lib.groups;
    const group = game.actors.get(groupId);
    const scene = game.scenes.get(sceneId);
    const key = await groups.addStack(group, game.actors.get(monsterId), { count: 2, fixedHp: figure });
    const stack = group.system.stackOf(key);
    const records = await groups.materializeMembers(group, key, 2);
    const [token] = await groups.deploy(group, scene, { stackKey: key, count: 1, x: 100, y: 600 });
    const out = {
      fixedHp: stack.fixedHp,
      records: records.map((r) => [r.delta?.system?.hp?.value, r.delta?.system?.hp?.max]),
      token: token ? [token.actor.system.hp.value, token.actor.system.hp.max] : null,
    };
    await groups.recall(group, { scene });
    return out;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 60, every = 250 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}

const open = {};
const swept = [];
let shapeArgs = null;

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf, seat: census.user });
  if (!census.api) blocked("acksExtras.lib.groups and .places are not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);

  section("fixtures");
  const beast = await gm.fixture("lib/nested-group-monster", "Actor", { name: `QA Nested beast${TAG}`, type: "monster", items: [] });
  const outerFx = await gm.fixture("lib/nested-group-outer", "Actor", { name: `QA Nested outer${TAG}`, type: GROUP, items: [] });
  const innerFx = await gm.fixture("lib/nested-group-inner", "Actor", { name: `QA Nested inner${TAG}`, type: GROUP, items: [] });
  const ids = { outerId: outerFx.id, innerId: innerFx.id };
  shapeArgs = { ...ids, monsterId: beast.id, hd: "1d4" };
  const shape = await run(gm, P.shape, shapeArgs);
  note("shape", shape);
  check("each group is at its shape: one stack, the inner inside the outer, the outer inside none", shape.stacks.join() === "1,1" && shape.innerParent && shape.outerParent === "" && shape.links.every((r) => r === "ok" || r === "same"), shape);
  check("no body token of either group stands on any scene", shape.strays === 0, shape.strays);
  const scene = await gm.create("Scene", { name: `QA Nested scene${TAG}`, width: 1200, height: 800, grid: { size: 100 } });
  swept.push(scene.uuid);
  // A Judge's note keeps the place out of the empty-location prune, which the
  // primary GM's window runs once its election settles, possibly after this create.
  const place = await gm.create("Actor", { name: `QA Nested place${TAG}`, type: LOCATION, items: [], system: { gmNotes: "<p>Walk place</p>" } });
  swept.push(place.uuid);
  const faction = await gm.create("Actor", { name: `QA Nested faction${TAG}`, type: FACTION, items: [] });
  swept.push(faction.uuid);
  const outerToken = await run(gm, P.token, { sceneId: scene.id, groupId: outerFx.id, x: 200, y: 200 });
  swept.push(gm.track(outerToken.uuid, "Token"));
  const fightArgs = (combatId) => ({ sceneId: scene.id, combatId, tokenId: outerToken.id, ...ids });
  const uuids = { outer: `Actor.${outerFx.id}`, inner: `Actor.${innerFx.id}` };

  section("a count read now");
  let counts = await run(gm, P.counts, ids);
  check("the outer's count holds the inner's bodies", counts.outer === 5, counts);
  check("the inner's count is its own", counts.inner === 3, counts);
  check("the outer's tree is the outer and the inner", counts.tree.join() === `${outerFx.id},${innerFx.id}`, counts.tree);

  section("rosters");
  note("written", await run(gm, P.roster, { ...ids, placeId: place.id, factionId: faction.id }));
  const rowArgs = { ...ids, placeId: place.id, factionId: faction.id };
  let rows = await run(gm, P.rows, rowArgs);
  check("the place's rows read x5 and x3, the inner covered, and its header counts 5", rows.place.outer === 5 && rows.place.inner === 3 && rows.place.covered && rows.place.headcount === 5, rows.place);
  check("the faction's members read the same, and its headcount is 5", rows.faction.outer === 5 && rows.faction.inner === 3 && rows.faction.covered && rows.faction.headcount === 5, rows.faction);
  const lookAt = async (doc, kind) => {
    await run(gm, P.openSheet, { docId: doc.id });
    return until(gm, P.sheetRead, { docId: doc.id, kind, uuids }, (s) => s?.outer && s.inner);
  };
  let seen = await lookAt(place, "place");
  check("the location's sheet prints x5 and x3 and a header of 5", seen?.outer?.includes("×5") && seen.inner.includes("×3") && /\b5\b/.test(seen.headcount ?? ""), seen);
  seen = await lookAt(faction, "faction");
  check("the faction's members tab prints x5 and x3 and a header of 5", seen?.outer?.includes("×5") && seen.inner.includes("×3") && /\b5\b/.test(seen.headcount ?? ""), seen);

  section("an outer token joins a combat");
  const fight1 = await run(gm, P.combat, { sceneId: scene.id });
  swept.push(gm.track(fight1.id, "Combat"));
  await run(gm, P.join, fightArgs(fight1.id));
  let f = await until(gm, P.fight, fightArgs(fight1.id), (s) => s.outer + s.inner === 5 && s.combatants === 5 && s.flag);
  const stuck = () => (census.activeGMIsSelf ? `; the active GM is this seat (${census.activeGM}), so its lead window did not act` : `; the active GM is ${census.activeGM}, a client that is not this seat, so the deploy ran there or nowhere`);
  note("after the add", { ...f, records: undefined });
  const placed = f.outer + f.inner === 5;
  check("five body tokens stand, two flagged with the outer and three with the inner", f.outer === 2 && f.inner === 3, `${JSON.stringify({ outer: f.outer, inner: f.inner })}${placed ? "" : stuck()}`);
  if (placed) {
    check("five combatants, none for either group, the bodies' own", f.combatants === 5 && f.ofGroups === 0 && f.ofBodies === 5, { combatants: f.combatants, ofGroups: f.ofGroups, ofBodies: f.ofBodies });
    check("the outer's token is hidden and flagged with the combat", f.hidden === true && f.flag?.combatId === fight1.id, f.flag);

    section("added again: the bodies gather");
    await run(gm, P.join, fightArgs(fight1.id));
    f = await until(gm, P.fight, fightArgs(fight1.id), (s) => s.outer + s.inner === 0 && !s.flag && s.hidden === false);
    check("every body token and every body combatant is gone", f.outer + f.inner === 0 && f.ofBodies === 0, { outer: f.outer, inner: f.inner, ofBodies: f.ofBodies });
    check("the outer's token is back and the combat holds its combatant alone", f.hidden === false && f.flag === null && f.combatants === 1, { hidden: f.hidden, flag: f.flag, combatants: f.combatants });
    check("each group's records rest, none deployed, the counts as they were", [...f.records.outer, ...f.records.inner].every((r) => r.state === "materialized" && !r.token) && f.records.outer.length === 2 && f.records.inner.length === 3 && f.current.join() === "2,3", { records: [f.records.outer.length, f.records.inner.length], current: f.current });

    section("added once more, then the combat is deleted");
    await run(gm, P.join, fightArgs(fight1.id));
    f = await until(gm, P.fight, fightArgs(fight1.id), (s) => s.outer + s.inner === 5 && s.combatants === 5 && s.flag);
    check("the bodies stand again", f.outer === 2 && f.inner === 3 && f.combatants === 5, { outer: f.outer, inner: f.inner, combatants: f.combatants });
    await run(gm, P.endCombat, { combatId: fight1.id });
    f = await until(gm, P.fight, fightArgs(fight1.id), (s) => s.outer + s.inner === 0 && !s.flag && s.hidden === false);
    check("every body token is gone and the outer's token is visible, its flag cleared", f.outer + f.inner === 0 && f.hidden === false && f.flag === null, { outer: f.outer, inner: f.inner, hidden: f.hidden, flag: f.flag });
    check("each group's records are back in its own stacks, resting", f.records.outer.length === 2 && f.records.inner.length === 3 && [...f.records.outer, ...f.records.inner].every((r) => r.state === "materialized" && !r.token) && f.current.join() === "2,3", { records: [f.records.outer.length, f.records.inner.length], current: f.current });
  }

  section("an emptied inner, and a stack with no creature");
  await run(gm, P.setCount, { groupId: innerFx.id, count: 0 });
  counts = await run(gm, P.counts, ids);
  check("the inner reads none and the outer its own two", counts.inner === 0 && counts.outer === 2, counts);
  rows = await until(gm, P.rows, rowArgs, (r) => r.place.inner === 0 && r.faction.inner === 0);
  check("the place's rows read x2 and x0, both still listed, the header 2", rows.place.rows === 2 && rows.place.outer === 2 && rows.place.inner === 0 && rows.place.headcount === 2, rows.place);
  check("the faction's rows read x2 and x0, both still listed, the headcount 2", rows.faction.rows === 2 && rows.faction.outer === 2 && rows.faction.inner === 0 && rows.faction.headcount === 2, rows.faction);
  for (const [doc, kind] of [[place, "place"], [faction, "faction"]]) {
    await run(gm, P.openSheet, { docId: doc.id });
    seen = await until(gm, P.sheetRead, { docId: doc.id, kind, uuids }, (s) => s?.inner?.includes("×0"));
    check(`the ${kind}'s sheet prints x2, x0 and a header of 2`, seen?.outer?.includes("×2") && seen.inner?.includes("×0") && /\b2\b/.test(seen.headcount ?? ""), seen);
  }
  const labelled = await run(gm, P.addLabelled, { groupId: outerFx.id, label: LABEL, count: 2 });
  const before = await run(gm, P.messageIds);
  const fight2 = await run(gm, P.combat, { sceneId: scene.id });
  swept.push(gm.track(fight2.id, "Combat"));
  await run(gm, P.join, fightArgs(fight2.id));
  f = await until(gm, P.fight, fightArgs(fight2.id), (s) => s.outer === 2 && s.combatants === 2 && s.flag);
  check("the outer's own two bodies deploy with a combatant each and the labelled stack places none", f.outer === 2 && f.inner === 0 && f.combatants === 2 && f.ofBodies === 2 && f.outerStacks.length === 1 && f.outerStacks[0] !== labelled, `${JSON.stringify({ outer: f.outer, inner: f.inner, combatants: f.combatants, stacks: f.outerStacks.length })}${f.outer === 2 ? "" : stuck()}`);
  await sleep(1500);
  const said = (await run(gm, P.whispers, { before, alias: outerFx.name, label: LABEL, name: outerFx.name }));
  for (const w of said) swept.push(gm.track(w.id, "ChatMessage"));
  check("one whisper to the Judges alone names the label and says it has no creature behind it", said.length === 1 && said[0].toGMs && said[0].says, said);
  await run(gm, P.endCombat, { combatId: fight2.id });
  f = await until(gm, P.fight, fightArgs(fight2.id), (s) => s.outer + s.inner === 0 && !s.flag && s.hidden === false);
  check("the second combat's end recalls the outer's bodies and shows its token", f.outer === 0 && f.hidden === false && f.flag === null, { outer: f.outer, hidden: f.hidden, flag: f.flag });
  await run(gm, P.removeStack, { groupId: outerFx.id, key: labelled });

  section("the cycle refusal");
  const cycle = await run(gm, P.setParent, { groupId: outerFx.id, parentUuid: `Actor.${innerFx.id}` });
  check("the outer inside its own inner answers cycle and its parent is unchanged", cycle.ok === false && cycle.reason === "cycle" && cycle.parent === "", cycle);

  section("a stack's printed hit points");
  const body = await gm.create("Actor", { name: `QA Nested printed${TAG}`, type: GROUP, items: [] });
  swept.push(body.uuid);
  const printed = await run(gm, P.printed, { groupId: body.id, monsterId: beast.id, sceneId: scene.id, figure: FIXED });
  check("the stack keeps the figure and both records and the placed body take it, a figure its hit dice cannot roll", printed.fixedHp === FIXED && printed.records.length === 2 && printed.records.every((r) => r[0] === FIXED && r[1] === FIXED) && printed.token?.[0] === FIXED && printed.token?.[1] === FIXED, printed);

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.gm) await run(open.gm, P.closeAll); } catch (err) { console.error("close:", err?.message ?? err); }
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (open.gm && shapeArgs) note("shape at the end", await run(open.gm, P.shape, shapeArgs)); } catch (err) { console.error("shape:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
